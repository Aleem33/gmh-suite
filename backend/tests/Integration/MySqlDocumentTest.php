<?php

declare(strict_types=1);

namespace GMH\Backend\Tests\Integration;

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Auth\Policy;
use GMH\Backend\Http\ApiException;
use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Repository\EventRepository;
use GMH\Backend\Service\DocumentService;
use GMH\Backend\Service\IdempotencyService;
use PDO;
use PHPUnit\Framework\TestCase;

final class MySqlDocumentTest extends TestCase
{
    private PDO $pdo;
    private DocumentRepository $repository;
    private DocumentService $service;
    private AuthContext $admin;

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
        $config = require dirname(__DIR__, 2) . '/config/collections.php';
        $this->repository = new DocumentRepository($this->pdo, $config);
        $this->service = new DocumentService(
            $this->pdo,
            $this->repository,
            new EventRepository($this->pdo),
            new Policy($config),
        );
        $this->admin = new AuthContext('integration-admin', 'admin@example.test', [], [
            'uid' => 'integration-admin',
            'username' => 'admin',
            'role' => 'admin',
            'permissions' => [],
        ]);
    }

    public function testDocumentAndOutboxCommitTogetherAndVersionConflictsAreBlocked(): void
    {
        $id = 'integration-' . bin2hex(random_bytes(5));
        $this->pdo->beginTransaction();
        $saved = $this->repository->upsert('medicines', $id, ['name' => 'Test', 'stock' => 10], 0, 'test', 'admin');
        $this->pdo->commit();
        self::assertSame(1, $saved['version']);
        self::assertSame(1, (int) $this->pdo->query(
            "SELECT COUNT(*) FROM document_events WHERE collection_name = 'medicines' AND document_id = " . $this->pdo->quote($id)
        )->fetchColumn());
    }

    public function testIndexedCollectionListingReturnsSavedDocuments(): void
    {
        $id = 'list-' . bin2hex(random_bytes(5));
        $this->pdo->beginTransaction();
        $this->repository->upsert('medicines', $id, ['name' => 'Indexed Medicine', 'stock' => 3], 0, 'test', 'admin');
        $this->pdo->commit();

        $result = $this->service->list(
            $this->admin,
            'medicines',
            [['field' => 'name', 'op' => '==', 'value' => 'Indexed Medicine']],
            'name',
            'asc',
            20,
            null,
        );

        self::assertContains($id, array_column($result['documents'], 'id'));
    }

    public function testAtomicStockInvariantRollsBackDocumentAndOutbox(): void
    {
        $id = 'stock-' . bin2hex(random_bytes(5));
        $this->pdo->beginTransaction();
        $this->repository->upsert('medicines', $id, ['name' => 'Stock Medicine', 'stock' => 5], 0, 'test', 'admin');
        $this->pdo->commit();
        $eventsBefore = (int) $this->pdo->query('SELECT COUNT(*) FROM document_events')->fetchColumn();

        try {
            $this->service->atomic($this->admin, [[
                'type' => 'update',
                'collection' => 'medicines',
                'id' => $id,
                'expectedVersion' => 1,
                'data' => ['stock' => ['__gmhTransform' => 'increment', 'operand' => -6]],
            ]]);
            self::fail('The stock invariant should reject a negative balance.');
        } catch (ApiException $exception) {
            self::assertSame('insufficient_stock', $exception->errorCode);
        }

        self::assertSame(5.0, (float) $this->repository->findData('medicines', $id)['stock']);
        self::assertSame($eventsBefore, (int) $this->pdo->query('SELECT COUNT(*) FROM document_events')->fetchColumn());
    }

    public function testIdempotencyReplaysACommittedResponseOnce(): void
    {
        $calls = 0;
        $service = new IdempotencyService($this->pdo);
        $key = 'integration:' . bin2hex(random_bytes(8));
        $operation = static function () use (&$calls): array {
            $calls++;
            return ['ok' => true, 'call' => $calls];
        };

        $first = $service->execute($this->admin, $key, 'POST /test\n{}', $operation);
        $second = $service->execute($this->admin, $key, 'POST /test\n{}', $operation);

        self::assertFalse($first['replayed']);
        self::assertTrue($second['replayed']);
        self::assertSame($first['body'], $second['body']);
        self::assertSame(1, $calls);
    }
}
