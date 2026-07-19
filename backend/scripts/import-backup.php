<?php

declare(strict_types=1);

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Config;
use GMH\Backend\Database;
use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Service\BackupService;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
$path = $argv[1] ?? '';
if ($path === '' || !is_file($path)) {
    fwrite(STDERR, "Usage: php scripts/import-backup.php /path/to/backup.json [--dry-run] [--replace]\n");
    exit(2);
}

$config = new Config($root);
$pdo = (new Database($config))->pdo();
$collectionConfig = require $root . '/config/collections.php';
$service = new BackupService(
    $pdo,
    new DocumentRepository($pdo, $collectionConfig),
    $collectionConfig,
    $config->int('IMPORT_MAX_DOCUMENTS', 100000),
);
$backup = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
$dryRun = in_array('--dry-run', $argv, true);
$result = $dryRun
    ? $service->validate($backup)
    : $service->import(
        $backup,
        new AuthContext('migration-cli', 'migration@localhost', [], [
            'role' => 'admin', 'username' => 'migration', 'permissions' => [],
        ]),
        in_array('--replace', $argv, true),
    );
unset($result['normalized']);
fwrite(STDOUT, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
exit(($result['valid'] ?? true) ? 0 : 1);
