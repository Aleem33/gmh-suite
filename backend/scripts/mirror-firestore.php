<?php

declare(strict_types=1);

use GMH\Backend\Config;
use GMH\Backend\Database;
use GMH\Backend\Mirror\FirestoreMirror;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';

$config = new Config($root);
$mirror = new FirestoreMirror((new Database($config))->pdo(), $config);
$result = $mirror->run(in_array('--manual', $argv, true) ? 'manual' : 'cron');
fwrite(STDOUT, json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
