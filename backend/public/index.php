<?php

declare(strict_types=1);

$backendRoot = getenv('GMH_BACKEND_ROOT') ?: dirname(__DIR__);
$autoload = $backendRoot . '/vendor/autoload.php';
if (!is_file($autoload)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => ['code' => 'backend_not_installed', 'message' => 'Backend dependencies are not installed.']]);
    exit;
}

require $autoload;

(new GMH\Backend\Application($backendRoot))->run();
