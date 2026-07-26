<?php

declare(strict_types=1);

namespace GMH\Backend\Service;

use DateTimeImmutable;
use DateTimeZone;
use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Http\ApiException;
use GMH\Backend\Repository\DocumentRepository;
use PDO;
use RuntimeException;
use Throwable;

final class MrnRepairService
{
    private const LOCK_NAME = 'gmh:mrn-sequence';

    public function __construct(
        private readonly PDO $pdo,
        private readonly DocumentRepository $documents,
        private readonly BackupService $backups,
        private readonly string $backupDirectory,
    ) {
    }

    /** @return array<string,mixed> */
    public function dryRun(): array
    {
        return $this->buildPlan($this->loadActiveDocuments(false));
    }

    /** @return array<string,mixed> */
    public function apply(string $expectedPlanSha, AuthContext $actor): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/', $expectedPlanSha)) {
            throw new ApiException('A valid dry-run plan SHA-256 is required.', 422, 'invalid_plan_sha');
        }

        $this->acquireLock();
        $backupPath = null;
        try {
            $this->pdo->beginTransaction();
            $rows = $this->loadActiveDocuments(true);
            $plan = $this->buildPlan($rows);
            if (!hash_equals($expectedPlanSha, (string) $plan['planSha256'])) {
                throw new ApiException('Production data changed after the dry run. Run the dry run again.', 409, 'mrn_plan_changed', [
                    'actualPlanSha256' => $plan['planSha256'],
                ]);
            }
            if ((int) $plan['pendingChanges'] === 0) {
                $this->pdo->commit();
                return [...$plan, 'applied' => false, 'backupPath' => null, 'backupSha256' => null];
            }

            [$backupPath, $backupSha] = $this->writeVerifiedBackup();
            foreach ($plan['renumberMappings'] as $mapping) {
                $existing = $this->documents->find('patients', $mapping['patientId'], forUpdate: true);
                if (!$existing) {
                    throw new RuntimeException("Patient {$mapping['patientId']} disappeared during MRN repair.");
                }
                $this->documents->upsert(
                    'patients',
                    $mapping['patientId'],
                    ['mrn' => $mapping['newMrn']],
                    (int) $existing['version'],
                    $actor->uid,
                    $actor->username(),
                    true,
                );
            }
            foreach ($plan['linkedUpdates'] as $update) {
                $existing = $this->documents->find($update['collection'], $update['documentId'], forUpdate: true);
                if (!$existing) {
                    throw new RuntimeException("Linked record {$update['collection']}/{$update['documentId']} disappeared during MRN repair.");
                }
                $this->documents->upsert(
                    $update['collection'],
                    $update['documentId'],
                    ['patientMRN' => $update['newMrn']],
                    (int) $existing['version'],
                    $actor->uid,
                    $actor->username(),
                    true,
                );
            }

            $counter = $this->documents->find('counters', 'mrn', forUpdate: true, includeDeleted: true);
            $this->documents->upsert(
                'counters',
                'mrn',
                ['value' => $plan['highestAssignedNumber']],
                $counter ? (int) $counter['version'] : 0,
                $actor->uid,
                $actor->username(),
                true,
            );

            $after = $this->buildPlan($this->loadActiveDocuments(false));
            $expectedActiveCount = (int) $plan['activeDocumentCount'] + ($plan['counterExists'] ? 0 : 1);
            if ((int) $after['activeDocumentCount'] !== $expectedActiveCount
                || (int) $after['businessDocumentCount'] !== (int) $plan['businessDocumentCount']
                || (int) $after['patientCount'] !== (int) $plan['patientCount']
                || (int) $after['duplicateMrnGroups'] !== 0
                || (int) $after['pendingChanges'] !== 0) {
                throw new RuntimeException('Post-repair MRN integrity verification failed.');
            }

            $this->pdo->commit();
            return [
                ...$after,
                'applied' => true,
                'renumberedPatients' => count($plan['renumberMappings']),
                'updatedLinkedDocuments' => count($plan['linkedUpdates']),
                'backupPath' => $backupPath,
                'backupSha256' => $backupSha,
            ];
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        } finally {
            $this->releaseLock();
        }
    }

    /** @return list<array<string,mixed>> */
    private function loadActiveDocuments(bool $forUpdate): array
    {
        $sql = 'SELECT collection_name, document_id, data, version, created_at
                  FROM documents WHERE deleted_at IS NULL
                  ORDER BY collection_name, document_id';
        if ($forUpdate) {
            $sql .= ' FOR UPDATE';
        }
        $rows = $this->pdo->query($sql)->fetchAll();
        return array_map(static function (array $row): array {
            $row['data'] = json_decode((string) $row['data'], true, 512, JSON_THROW_ON_ERROR);
            $row['version'] = (int) $row['version'];
            return $row;
        }, $rows);
    }

    /** @param list<array<string,mixed>> $rows @return array<string,mixed> */
    private function buildPlan(array $rows): array
    {
        $patientsByMrn = [];
        $invalidPatientIds = [];
        $currentCounter = 0;
        $counterExists = false;
        $patientCount = 0;

        foreach ($rows as $row) {
            if ($row['collection_name'] === 'counters' && $row['document_id'] === 'mrn') {
                $counterExists = true;
                $currentCounter = max(0, (int) ($row['data']['value'] ?? 0));
            }
            if ($row['collection_name'] !== 'patients') {
                continue;
            }
            $patientCount++;
            $mrn = (string) ($row['data']['mrn'] ?? '');
            if (!preg_match('/^MRN-(\d+)$/', $mrn, $matches) || (int) $matches[1] < 1) {
                $invalidPatientIds[] = $row['document_id'];
                continue;
            }
            $number = (int) $matches[1];
            $patientsByMrn[$number][] = [
                'patientId' => $row['document_id'],
                'mrn' => $mrn,
                'sortTime' => $this->sortTime($row),
            ];
        }
        ksort($patientsByMrn);
        sort($invalidPatientIds);
        $highestExisting = $patientsByMrn === [] ? 0 : max(array_keys($patientsByMrn));

        $duplicateGroups = 0;
        $renumberCandidates = [];
        foreach ($patientsByMrn as $number => $patients) {
            usort($patients, [$this, 'comparePatients']);
            if (count($patients) < 2) {
                continue;
            }
            $duplicateGroups++;
            foreach (array_slice($patients, 1) as $patient) {
                $renumberCandidates[] = $patient;
            }
        }
        usort($renumberCandidates, [$this, 'comparePatients']);

        $renumberMappings = [];
        $next = $highestExisting;
        foreach ($renumberCandidates as $patient) {
            $next++;
            $renumberMappings[] = [
                'patientId' => $patient['patientId'],
                'oldMrn' => $patient['mrn'],
                'newMrn' => $this->formatMrn($next),
            ];
        }
        $newMrnByPatient = array_column($renumberMappings, 'newMrn', 'patientId');

        $linkedUpdates = [];
        foreach ($rows as $row) {
            if (in_array($row['collection_name'], ['patients', 'auditLogs', 'counters'], true)) {
                continue;
            }
            $patientId = $row['data']['patientId'] ?? null;
            if (!is_string($patientId) || !isset($newMrnByPatient[$patientId])
                || !array_key_exists('patientMRN', $row['data'])
                || $row['data']['patientMRN'] === $newMrnByPatient[$patientId]) {
                continue;
            }
            $linkedUpdates[] = [
                'collection' => $row['collection_name'],
                'documentId' => $row['document_id'],
                'patientId' => $patientId,
                'oldMrn' => (string) $row['data']['patientMRN'],
                'newMrn' => $newMrnByPatient[$patientId],
            ];
        }
        usort($linkedUpdates, static fn (array $left, array $right): int =>
            [$left['collection'], $left['documentId']] <=> [$right['collection'], $right['documentId']]
        );

        $highestAssigned = max($highestExisting, $next);
        $counterNeedsUpdate = $currentCounter !== $highestAssigned;
        $hashPayload = [
            'activeDocumentCount' => count($rows),
            'businessDocumentCount' => count(array_filter(
                $rows,
                static fn (array $row): bool => $row['collection_name'] !== 'counters',
            )),
            'patientCount' => $patientCount,
            'invalidPatientIds' => $invalidPatientIds,
            'counterExists' => $counterExists,
            'currentCounter' => $currentCounter,
            'highestExistingNumber' => $highestExisting,
            'highestAssignedNumber' => $highestAssigned,
            'renumberMappings' => $renumberMappings,
            'linkedUpdates' => $linkedUpdates,
            'counterNeedsUpdate' => $counterNeedsUpdate,
        ];
        $planSha = hash('sha256', json_encode($hashPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));

        return [
            'mode' => 'dry-run',
            ...$hashPayload,
            'duplicateMrnGroups' => $duplicateGroups,
            'patientsToRenumber' => count($renumberMappings),
            'linkedDocumentsToUpdate' => count($linkedUpdates),
            'pendingChanges' => count($renumberMappings) + count($linkedUpdates) + ($counterNeedsUpdate ? 1 : 0),
            'planSha256' => $planSha,
        ];
    }

    /** @param array<string,mixed> $row */
    private function sortTime(array $row): string
    {
        $createdAt = $row['data']['createdAt'] ?? null;
        if (is_string($createdAt) && strtotime($createdAt) !== false) {
            return (new DateTimeImmutable($createdAt))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z');
        }
        return (new DateTimeImmutable((string) $row['created_at'], new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.u\Z');
    }

    /** @param array<string,mixed> $left @param array<string,mixed> $right */
    private function comparePatients(array $left, array $right): int
    {
        return [$left['sortTime'], $left['patientId']] <=> [$right['sortTime'], $right['patientId']];
    }

    private function formatMrn(int $number): string
    {
        return 'MRN-' . str_pad((string) $number, 5, '0', STR_PAD_LEFT);
    }

    /** @return array{string,string} */
    private function writeVerifiedBackup(): array
    {
        $directory = rtrim($this->backupDirectory, '/\\');
        if ($directory === '') {
            throw new RuntimeException('BACKUP_DIRECTORY is not configured.');
        }
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException("Could not create backup directory {$directory}.");
        }
        $path = $directory . DIRECTORY_SEPARATOR . 'gmh-pre-mrn-repair-' . gmdate('Y-m-d-His') . '-' . bin2hex(random_bytes(4)) . '.json';
        $json = json_encode(
            $this->backups->export(),
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
        if (file_put_contents($path, $json, LOCK_EX) === false) {
            throw new RuntimeException("Could not write backup {$path}.");
        }
        @chmod($path, 0600);
        $saved = file_get_contents($path);
        if ($saved === false || !hash_equals(hash('sha256', $json), hash('sha256', $saved))) {
            throw new RuntimeException('Pre-repair backup verification failed.');
        }
        $decoded = json_decode($saved, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($decoded) || ($decoded['scope'] ?? null) !== 'gmh-suite' || !isset($decoded['manifest']['sha256'])) {
            throw new RuntimeException('Pre-repair backup is not a valid GMH Suite backup.');
        }
        return [$path, hash('sha256', $saved)];
    }

    private function acquireLock(): void
    {
        $statement = $this->pdo->prepare('SELECT GET_LOCK(?, 30)');
        $statement->execute([self::LOCK_NAME]);
        if ((int) $statement->fetchColumn() !== 1) {
            throw new RuntimeException('Could not acquire the MRN maintenance lock.');
        }
    }

    private function releaseLock(): void
    {
        $statement = $this->pdo->prepare('SELECT RELEASE_LOCK(?)');
        $statement->execute([self::LOCK_NAME]);
    }
}
