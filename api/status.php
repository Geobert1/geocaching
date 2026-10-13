<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';

$db = new Database(__DIR__ . '/../data/geocaching.sqlite');

try {
    echo json_encode(['success' => true, 'stats' => $db->getStats()]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
