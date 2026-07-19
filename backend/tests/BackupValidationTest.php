<?php

declare(strict_types=1);

namespace GMH\Backend\Tests;

use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Service\BackupService;
use PDO;
use PHPUnit\Framework\TestCase;

final class BackupValidationTest extends TestCase
{
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
