<?php

declare(strict_types=1);

namespace GMH\Backend\Tests;

use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Service\BackupService;
use PDO;
use PHPUnit\Framework\TestCase;

final class BackupValidationTest extends TestCase
{
    public function testExportAlwaysContainsQuotationCollectionAndDocuments(): void
    {
        if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
            self::markTestSkipped('pdo_sqlite is required for this validation-only test.');
        }
        $pdo = new PDO('sqlite::memory:');
        $pdo->exec('CREATE TABLE documents (
            collection_name TEXT NOT NULL,
            document_id TEXT NOT NULL,
            data TEXT NOT NULL,
            deleted_at TEXT NULL
        )');
        $statement = $pdo->prepare('INSERT INTO documents (collection_name, document_id, data, deleted_at) VALUES (?, ?, ?, NULL)');
        $statement->execute(['quotations', 'quote-1', json_encode([
            'quotationNo' => 'QUOTE-00001',
            'items' => [['medicineId' => 'medicine-1', 'quantity' => 2]],
            'total' => 250,
        ], JSON_THROW_ON_ERROR)]);

        $config = require dirname(__DIR__) . '/config/collections.php';
        $service = new BackupService($pdo, new DocumentRepository($pdo, $config), $config, 100);
        $backup = $service->export();

        self::assertArrayHasKey('quotations', $backup['collections']);
        self::assertSame('quote-1', $backup['collections']['quotations'][0]['_id']);
        self::assertSame('QUOTE-00001', $backup['collections']['quotations'][0]['quotationNo']);
        self::assertSame(1, $backup['manifest']['collections']['quotations']['count']);
    }

    public function testQuotationDocumentsAreIncludedInValidationManifest(): void
    {
        if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
            self::markTestSkipped('pdo_sqlite is required for this validation-only test.');
        }
        $pdo = new PDO('sqlite::memory:');
        $config = require dirname(__DIR__) . '/config/collections.php';
        $service = new BackupService($pdo, new DocumentRepository($pdo, $config), $config, 100);

        $result = $service->validate([
            'scope' => 'gmh-suite',
            'collections' => [
                'quotations' => [[
                    '_id' => 'quote-1',
                    'quotationNo' => 'QUOTE-00001',
                    'items' => [['medicineId' => 'medicine-1', 'quantity' => 2]],
                    'total' => 250,
                ]],
            ],
        ]);

        self::assertTrue($result['valid']);
        self::assertSame(1, $result['totalDocuments']);
        self::assertSame(1, $result['manifest']['collections']['quotations']['count']);
        self::assertSame([], $result['warnings']);
    }

    public function testLegacyBackupWithoutQuotationsReportsMergeSafeWarning(): void
    {
        if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
            self::markTestSkipped('pdo_sqlite is required for this validation-only test.');
        }
        $pdo = new PDO('sqlite::memory:');
        $config = require dirname(__DIR__) . '/config/collections.php';
        $service = new BackupService($pdo, new DocumentRepository($pdo, $config), $config, 100);

        $result = $service->validate([
            'scope' => 'gmh-suite',
            'collections' => ['patients' => []],
        ]);

        self::assertTrue($result['valid']);
        self::assertStringContainsString('no quotations collection', $result['warnings'][0]);
    }

    public function testManifestIsDeterministicAcrossCollectionOrder(): void
    {
        if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
            self::markTestSkipped('pdo_sqlite is required for this validation-only test.');
        }
        $pdo = new PDO('sqlite::memory:');
        $config = require dirname(__DIR__) . '/config/collections.php';
        $service = new BackupService($pdo, new DocumentRepository($pdo, $config), $config, 100);
        $first = $service->validate([
            'scope' => 'gmh-suite',
            'collections' => [
                'patients' => [['_id' => 'p2', 'name' => 'B'], ['_id' => 'p1', 'name' => 'A']],
                'medicines' => [['_id' => 'm1', 'stock' => 2]],
            ],
        ]);
        $second = $service->validate([
            'scope' => 'gmh-suite',
            'collections' => [
                'medicines' => [['_id' => 'm1', 'stock' => 2]],
                'patients' => [['_id' => 'p1', 'name' => 'A'], ['_id' => 'p2', 'name' => 'B']],
            ],
        ]);
        self::assertTrue($first['valid']);
        self::assertSame($first['manifest']['sha256'], $second['manifest']['sha256']);
        self::assertSame(3, $first['manifest']['totalDocuments']);
    }
}
