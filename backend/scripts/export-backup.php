<?php

declare(strict_types=1);

use GMH\Backend\Config;
use GMH\Backend\Database;
use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Service\BackupService;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
$config = new Config($root);
$pdo = (new Database($config))->pdo();
$collectionConfig = require $root . '/config/collections.php';
$service = new BackupService($pdo, new DocumentRepository($pdo, $collectionConfig), $collectionConfig, 1000000);
$target = $argv[1] ?? ('gmh-mysql-backup-' . gmdate('Y-m-d-His') . '.json');
$json = json_encode($service->export(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
if (file_put_contents($target, $json) === false) {
    throw new RuntimeException("Could not write {$target}");
}
fwrite(STDOUT, "Wrote {$target}\n");
