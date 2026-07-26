<?php

declare(strict_types=1);

namespace GMH\Backend\Tests\Integration;

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Auth\Policy;
use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Repository\EventRepository;
use GMH\Backend\Service\BackupService;
use GMH\Backend\Service\DocumentService;
use GMH\Backend\Service\DomainCommandService;
use GMH\Backend\Service\IdempotencyService;
use GMH\Backend\Service\MrnRepairService;
use PDO;
use PHPUnit\Framework\TestCase;

final class MrnIntegrityTest extends TestCase
{
    private PDO $pdo;
    private DocumentRepository $repository;
    private DocumentService $documents;
    private DomainCommandService $commands;
    private IdempotencyService $idempotency;
    private AuthContext $admin;
    /** @var array<string,mixed> */
    private array $collectionConfig;

    protected function setUp(): void
    {
        $dsn = getenv('TEST_DB_DSN') ?: '';
        if ($dsn === '') {
            self::markTestSkipped('Set TEST_DB_DSN, TEST_DB_USER, and TEST_DB_PASSWORD to run MySQL integration tests.');
        }
        $this->pdo = new PDO($dsn, getenv('TEST_DB_USER') ?: '', getenv('TEST_DB_PASSWORD') ?: '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $schema = (string) file_get_contents(dirname(__DIR__, 2) . '/database/schema.sql');
        foreach (array_filter(array_map('trim', preg_split('/;\s*(?:\r?\n|$)/', $schema) ?: [])) as $statement) {
            $this->pdo->exec($statement);
        }
        $this->pdo->exec(
            "DELETE FROM documents
              WHERE (collection_name = 'patients' AND (
                        document_id LIKE 'mrn-test-%'
                        OR JSON_UNQUOTE(JSON_EXTRACT(data, '$.name')) = 'Atomic Patient'
                    ))
                 OR (collection_name IN ('appointments', 'auditLogs') AND document_id LIKE 'mrn-test-%')
                 OR (collection_name = 'counters' AND document_id = 'mrn')"
        );

        $this->collectionConfig = require dirname(__DIR__, 2) . '/config/collections.php';
        $this->repository = new DocumentRepository($this->pdo, $this->collectionConfig);
        $this->documents = new DocumentService(
            $this->pdo,
            $this->repository,
            new EventRepository($this->pdo),
            new Policy($this->collectionConfig),
        );
        $this->commands = new DomainCommandService($this->pdo, $this->repository, $this->documents);
        $this->idempotency = new IdempotencyService($this->pdo);
        $this->admin = new AuthContext('mrn-test-admin', 'admin@example.test', [], [
            'uid' => 'mrn-test-admin',
            'username' => 'admin',
            'role' => 'admin',
            'permissions' => [],
        ]);
    }

    public function testPatientCreationReconcilesMissingAndStaleCountersAndIsIdempotent(): void
    {
        $this->save('patients', 'mrn-test-existing', [
            'name' => 'Existing',
            'mrn' => 'MRN-00137',
            'createdAt' => '2026-01-01T00:00:00.000Z',
        ]);

        $missingCounter = $this->nextMrn('missing');
        self::assertSame('MRN-00138', $missingCounter['formatted']);

        $counter = $this->repository->find('counters', 'mrn', includeDeleted: true);
        $this->repository->upsert(
            'counters',
            'mrn',
            ['value' => 1],
            (int) $counter['version'],
            $this->admin->uid,
            $this->admin->username(),
        );
        $staleCounter = $this->nextMrn('stale');
        self::assertSame('MRN-00138', $staleCounter['formatted']);

        $key = 'mrn-test-create-' . bin2hex(random_bytes(6));
        $operation = fn (): array => $this->commands->createPatient($this->admin, [
            'name' => 'Atomic Patient',
            'age' => 30,
            'createdAt' => '2026-01-02T00:00:00.000Z',
        ]);
        $first = $this->idempotency->execute($this->admin, $key, 'patient-create', $operation);
        $replay = $this->idempotency->execute($this->admin, $key, 'patient-create', $operation);

        self::assertSame('MRN-00139', $first['body']['mrn']);
        self::assertSame($first['body'], $replay['body']);
        self::assertTrue($replay['replayed']);
        self::assertSame(1, (int) $this->pdo->query(
            "SELECT COUNT(*) FROM documents
              WHERE collection_name = 'patients'
                AND deleted_at IS NULL
                AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.mrn')) = 'MRN-00139'"
        )->fetchColumn());

        $counter = $this->repository->find('counters', 'mrn', includeDeleted: true);
        $this->repository->upsert(
            'counters',
            'mrn',
            ['value' => 200],
            (int) $counter['version'],
            $this->admin->uid,
            $this->admin->username(),
        );
        self::assertSame('MRN-00201', $this->nextMrn('higher')['formatted']);
    }

    public function testRepairRenumbersNewerDuplicatesUpdatesLinksAndKeepsBusinessCounts(): void
    {
        $this->save('patients', 'mrn-test-old', [
            'name' => 'Original',
            'mrn' => 'MRN-00001',
            'createdAt' => '2026-01-01T00:00:00.000Z',
        ]);
        $this->save('patients', 'mrn-test-new', [
            'name' => 'Newer',
            'mrn' => 'MRN-00001',
            'createdAt' => '2026-07-01T00:00:00.000Z',
        ]);
        $this->save('patients', 'mrn-test-highest', [
            'name' => 'Highest',
            'mrn' => 'MRN-00137',
            'createdAt' => '2026-06-01T00:00:00.000Z',
        ]);
        $this->save('appointments', 'mrn-test-appointment', [
            'patientId' => 'mrn-test-new',
            'patientMRN' => 'MRN-00001',
        ]);
        $this->save('auditLogs', 'mrn-test-audit', [
            'patientId' => 'mrn-test-new',
            'patientMRN' => 'MRN-00001',
            'details' => 'Historical MRN remains unchanged',
        ]);
        $this->save('counters', 'mrn', ['value' => 1]);

        $backupDirectory = dirname(__DIR__, 2) . '/.phpunit.cache/mrn-backups';
        $repair = new MrnRepairService(
            $this->pdo,
            $this->repository,
            new BackupService($this->pdo, $this->repository, $this->collectionConfig, 100000),
            $backupDirectory,
        );
        $plan = $repair->dryRun();

        self::assertSame(1, $plan['duplicateMrnGroups']);
        self::assertSame([[
            'patientId' => 'mrn-test-new',
            'oldMrn' => 'MRN-00001',
            'newMrn' => 'MRN-00138',
        ]], $plan['renumberMappings']);
        self::assertSame(1, $plan['linkedDocumentsToUpdate']);

        $result = $repair->apply($plan['planSha256'], $this->admin);
        self::assertTrue($result['applied']);
        self::assertSame(1, $result['renumberedPatients']);
        self::assertSame(1, $result['updatedLinkedDocuments']);
        self::assertFileExists($result['backupPath']);
        self::assertSame($result['backupSha256'], hash_file('sha256', $result['backupPath']));
        self::assertSame('MRN-00001', $this->repository->findData('patients', 'mrn-test-old')['mrn']);
        self::assertSame('MRN-00138', $this->repository->findData('patients', 'mrn-test-new')['mrn']);
        self::assertSame('MRN-00138', $this->repository->findData('appointments', 'mrn-test-appointment')['patientMRN']);
        self::assertSame('MRN-00001', $this->repository->findData('auditLogs', 'mrn-test-audit')['patientMRN']);
        self::assertSame(138, $this->repository->findData('counters', 'mrn')['value']);

        $after = $repair->dryRun();
        self::assertSame(0, $after['duplicateMrnGroups']);
        self::assertSame(0, $after['pendingChanges']);
        $noOp = $repair->apply($after['planSha256'], $this->admin);
        self::assertFalse($noOp['applied']);
        self::assertNull($noOp['backupPath']);
    }

    /** @param array<string,mixed> $data */
    private function save(string $collection, string $id, array $data): void
    {
        $existing = $this->repository->find($collection, $id, includeDeleted: true);
        $this->repository->upsert(
            $collection,
            $id,
            $data,
            $existing ? (int) $existing['version'] : 0,
            $this->admin->uid,
            $this->admin->username(),
        );
    }

    /** @return array<string,mixed> */
    private function nextMrn(string $suffix): array
    {
        $key = 'mrn-test-counter-' . $suffix . '-' . bin2hex(random_bytes(5));
        return $this->idempotency->execute(
            $this->admin,
            $key,
            'counter-next-' . $suffix,
            fn (): array => $this->commands->nextCounter($this->admin, 'mrn', 'MRN'),
        )['body'];
    }
}
