<?php

declare(strict_types=1);

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Config;
use GMH\Backend\Database;
use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Service\BackupService;
use GMH\Backend\Service\MrnRepairService;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';

$apply = in_array('--apply', $argv, true);
$expectedPlanSha = '';
foreach ($argv as $argument) {
    if (str_starts_with($argument, '--expected-plan-sha=')) {
        $expectedPlanSha = substr($argument, strlen('--expected-plan-sha='));
    }
}
if ($apply && $expectedPlanSha === '') {
    fwrite(STDERR, "Apply mode requires --expected-plan-sha=<SHA256> from the latest dry run.\n");
    exit(2);
}

$config = new Config($root);
$pdo = (new Database($config))->pdo();
$collectionConfig = require $root . '/config/collections.php';
$documents = new DocumentRepository($pdo, $collectionConfig);
$backups = new BackupService(
    $pdo,
    $documents,
    $collectionConfig,
    $config->int('IMPORT_MAX_DOCUMENTS', 100000),
);
$service = new MrnRepairService(
    $pdo,
    $documents,
    $backups,
    $config->string('BACKUP_DIRECTORY'),
);
$result = $apply
    ? $service->apply(
        strtolower($expectedPlanSha),
        new AuthContext('mrn-repair-cli', 'mrn-repair@localhost', [], [
            'role' => 'admin', 'username' => 'mrn-repair', 'permissions' => [],
        ]),
    )
    : $service->dryRun();

fwrite(STDOUT, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . PHP_EOL);
