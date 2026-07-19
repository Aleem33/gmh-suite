<?php

declare(strict_types=1);

use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Service\BackupService;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
$path = $argv[1] ?? '';
if ($path === '' || !is_file($path)) {
    fwrite(STDERR, "Usage: php scripts/validate-backup.php /path/to/backup.json\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDERR, "Enable pdo_sqlite for the validation-only CLI. No database writes are performed.\n");
    exit(2);
}
$pdo = new PDO('sqlite::memory:');
$config = require $root . '/config/collections.php';
$service = new BackupService($pdo, new DocumentRepository($pdo, $config), $config, 100000);
$backup = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
$result = $service->validate($backup);
unset($result['normalized']);
fwrite(STDOUT, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
exit($result['valid'] ? 0 : 1);
