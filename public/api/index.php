<?php

declare(strict_types=1);

// Keep application code, .env, and Firebase credentials outside public_html.
$backendRoot = getenv('GMH_BACKEND_ROOT') ?: '/home/u457184656/domains/aleemcore.com/gmh-backend';
$entrypoint = $backendRoot . '/public/index.php';
if (!is_file($entrypoint)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => ['code' => 'backend_not_installed', 'message' => 'GMH backend is not installed.']]);
    exit;
}
require $entrypoint;
