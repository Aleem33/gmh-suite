<?php

declare(strict_types=1);

namespace GMH\Backend\Service;

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Http\ApiException;
use GMH\Backend\Repository\DocumentRepository;
use PDO;
use Throwable;

final class BackupService
{
    /** @param array<string, mixed> $collectionConfig */
    public function __construct(
        private readonly PDO $pdo,
        private readonly DocumentRepository $documents,
        private readonly array $collectionConfig,
        private readonly int $maxDocuments,
    ) {
    }

    /** @return array<string, mixed> */
    public function export(): array
    {
        $collections = [];
        $statement = $this->pdo->query(
            'SELECT collection_name, document_id, data FROM documents
              WHERE deleted_at IS NULL ORDER BY collection_name, document_id'
        );
        while ($row = $statement->fetch()) {
            $data = json_decode((string) $row['data'], true, 512, JSON_THROW_ON_ERROR);
            $collections[$row['collection_name']][] = ['_id' => $row['document_id'], ...$data];
        }
        foreach ($this->collectionConfig['allowed'] as $collection) {
            $collections[$collection] ??= [];
        }
        ksort($collections);
        return [
            'exportedAt' => gmdate('Y-m-d\TH:i:s.v\Z'),
            'version' => '3.0-mysql',
            'scope' => 'gmh-suite',
            'collections' => $collections,
            'manifest' => $this->manifest($collections),
        ];
    }

    /** @param array<string, mixed> $backup @return array<string, mixed> */
    public function validate(array $backup): array
    {
        if (($backup['scope'] ?? null) !== 'gmh-suite' || !is_array($backup['collections'] ?? null)) {
            throw new ApiException('The file is not a GMH Suite backup.', 422, 'invalid_backup');
        }

        $errors = [];
        $warnings = [];
        $normalized = [];
        $ids = [];
        $total = 0;
        foreach ($backup['collections'] as $collection => $records) {
            if (!is_string($collection) || !in_array($collection, $this->collectionConfig['allowed'], true)) {
                $warnings[] = "Collection {$collection} is not used by this release and will be skipped.";
                continue;
            }
            if (!is_array($records)) {
                $errors[] = "Collection {$collection} is not an array.";
                continue;
            }
            $normalized[$collection] ??= [];
            $ids[$collection] ??= [];
            foreach ($records as $index => $record) {
                $total++;
                if ($total > $this->maxDocuments) {
                    throw new ApiException('Backup exceeds the configured document limit.', 413, 'backup_too_large');
                }
                if (!is_array($record) || !isset($record['_id']) || !is_string($record['_id']) || $record['_id'] === '') {
                    $errors[] = "{$collection}[{$index}] has no valid _id.";
                    continue;
                }
                $id = $record['_id'];
                if (isset($ids[$collection][$id])) {
                    $errors[] = "Duplicate ID {$collection}/{$id}.";
                    continue;
                }
                $ids[$collection][$id] = true;
                unset($record['_id']);
                $normalized[$collection][$id] = $record;
            }
        }

        $this->validateRelationships($normalized, $ids, $warnings);
        $collectionRecords = [];
        foreach ($normalized as $collection => $records) {
            $collectionRecords[$collection] = array_map(
                static fn (string $id, array $data): array => ['_id' => $id, ...$data],
                array_keys($records),
                array_values($records),
            );
        }
        return [
            'valid' => $errors === [],
            'totalDocuments' => $total,
            'collectionCount' => count($normalized),
            'errors' => array_slice($errors, 0, 200),
            'warnings' => array_slice($warnings, 0, 500),
            'manifest' => $this->manifest($collectionRecords),
            'normalized' => $normalized,
        ];
    }

    /** @param array<string, mixed> $backup @return array<string, mixed> */
    public function import(array $backup, AuthContext $actor, bool $replace = false): array
    {
        $validation = $this->validate($backup);
        if (!$validation['valid']) {
            throw new ApiException('Backup validation failed.', 422, 'backup_validation_failed', [
                'errors' => $validation['errors'],
                'warnings' => $validation['warnings'],
            ]);
        }
        $normalized = $validation['normalized'];
        $manageTransaction = !$this->pdo->inTransaction();
        if ($manageTransaction) {
            $this->pdo->beginTransaction();
        }
        try {
            if ($replace) {
                $this->deleteDocuments($actor, preserveUserId: $actor->uid);
            }
            $imported = 0;
            foreach ($normalized as $collection => $records) {
                ksort($records);
                foreach ($records as $id => $data) {
                    $existing = $this->documents->find($collection, $id, forUpdate: true, includeDeleted: true);
                    $this->documents->upsert(
                        $collection,
                        $id,
                        $data,
                        $existing ? (int) $existing['version'] : 0,
                        $actor->uid,
                        $actor->username(),
                    );
                    $imported++;
                }
            }
            $verification = $this->verifyImportedDocuments($normalized);
            if (!$verification['valid']) {
                throw new ApiException('The post-import content verification failed.', 500, 'import_verification_failed', [
                    'mismatches' => $verification['mismatches'],
                ]);
            }
            if ($manageTransaction) {
                $this->pdo->commit();
            }
            unset($validation['normalized']);
            return ['importedDocuments' => $imported, 'validation' => $validation, 'verification' => $verification];
        } catch (Throwable $exception) {
            if ($manageTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    /** @return array<string,mixed> */
    public function reset(AuthContext $actor): array
    {
        $manageTransaction = !$this->pdo->inTransaction();
        if ($manageTransaction) {
            $this->pdo->beginTransaction();
        }
        try {
            $deleted = $this->deleteDocuments($actor, preserveUserId: $actor->uid);
            if ($manageTransaction) {
                $this->pdo->commit();
            }
            return ['deletedDocuments' => $deleted, 'preservedUserId' => $actor->uid];
        } catch (Throwable $exception) {
            if ($manageTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    private function deleteDocuments(AuthContext $actor, string $preserveUserId): int
    {
        $statement = $this->pdo->query(
            'SELECT collection_name, document_id, version FROM documents
              WHERE deleted_at IS NULL ORDER BY collection_name, document_id FOR UPDATE'
        );
        $deleted = 0;
        foreach ($statement->fetchAll() as $row) {
            if ($row['collection_name'] === 'users' && $row['document_id'] === $preserveUserId) {
                continue;
            }
            $this->documents->delete(
                (string) $row['collection_name'],
                (string) $row['document_id'],
                (int) $row['version'],
                $actor->uid,
                $actor->username(),
            );
            $deleted++;
        }
        return $deleted;
    }

    /** @param array<string,array<string,array<string,mixed>>> $expected @return array<string,mixed> */
    private function verifyImportedDocuments(array $expected): array
    {
        $mismatches = [];
        $verified = 0;
        $hash = hash_init('sha256');
        foreach ($expected as $collection => $records) {
            ksort($records);
            foreach ($records as $id => $data) {
                $saved = $this->documents->findData($collection, $id);
                $expectedJson = $this->canonicalJson(['_id' => $id, ...$data]);
                $actualJson = $saved === null ? null : $this->canonicalJson(['_id' => $id, ...$saved]);
                if ($actualJson === null || !hash_equals(hash('sha256', $expectedJson), hash('sha256', $actualJson))) {
                    $mismatches[] = "{$collection}/{$id}";
                    if (count($mismatches) >= 100) {
                        break 2;
                    }
                }
                hash_update($hash, $collection . '/' . $id . ':' . hash('sha256', $actualJson ?? '') . "\n");
                $verified++;
            }
        }
        return [
            'valid' => $mismatches === [],
            'verifiedDocuments' => $verified,
            'sha256' => hash_final($hash),
            'mismatches' => $mismatches,
        ];
    }

    /** @param array<string, list<array<string,mixed>>> $collections @return array<string,mixed> */
    private function manifest(array $collections): array
    {
        $manifest = ['totalDocuments' => 0, 'collections' => []];
        foreach ($collections as $collection => $records) {
            usort($records, static fn (array $a, array $b): int => strcmp((string) ($a['_id'] ?? ''), (string) ($b['_id'] ?? '')));
            $hash = hash_init('sha256');
            foreach ($records as $record) {
                hash_update($hash, $this->canonicalJson($record) . "\n");
            }
            $count = count($records);
            $manifest['totalDocuments'] += $count;
            $manifest['collections'][$collection] = ['count' => $count, 'sha256' => hash_final($hash)];
        }
        ksort($manifest['collections']);
        $manifest['sha256'] = hash('sha256', $this->canonicalJson($manifest['collections']));
        return $manifest;
    }

    private function canonicalJson(mixed $value): string
    {
        $sort = function (mixed $item) use (&$sort): mixed {
            if (!is_array($item)) {
                return $item;
            }
            if (!array_is_list($item)) {
                ksort($item);
            }
            foreach ($item as $key => $child) {
                $item[$key] = $sort($child);
            }
            return $item;
        };
        return json_encode($sort($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
    }

    /** @param array<string,array<string,array<string,mixed>>> $documents @param array<string,array<string,bool>> $ids @param list<string> $warnings */
    private function validateRelationships(array $documents, array $ids, array &$warnings): void
    {
        $relations = [
            'appointments' => ['patientId' => 'patients'],
            'consultations' => ['patientId' => 'patients'],
            'admissions' => ['patientId' => 'patients', 'bedId' => 'beds'],
            'bedTreatments' => ['patientId' => 'patients', 'admissionId' => 'admissions'],
            'bills' => ['patientId' => 'patients'],
            'labOrders' => ['patientId' => 'patients'],
            'purchases' => ['medicineId' => 'medicines', 'supplierId' => 'suppliers'],
            'purchaseReturns' => ['purchaseId' => 'purchases', 'medicineId' => 'medicines'],
            'saleReturns' => ['saleId' => 'sales'],
            'customerPayments' => ['customerId' => 'customers', 'saleId' => 'sales'],
            'pharmacyOrders' => ['patientId' => 'patients', 'admissionId' => 'admissions'],
        ];
        foreach ($relations as $collection => $fields) {
            foreach ($documents[$collection] ?? [] as $id => $document) {
                foreach ($fields as $field => $target) {
                    $value = $document[$field] ?? null;
                    if (is_string($value) && $value !== '' && !isset($ids[$target][$value])) {
                        $warnings[] = "{$collection}/{$id} references missing {$target}/{$value} through {$field}.";
                    }
                }
            }
        }
    }
}
