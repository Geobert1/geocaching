<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';

$db = new Database(__DIR__ . '/../data/geocaching.sqlite');

try {
    if (isset($_GET['q']) && trim((string)$_GET['q']) !== '') {
        $caches = $db->searchCaches(trim((string)$_GET['q']));
    } elseif (
        isset($_GET['s'], $_GET['w'], $_GET['n'], $_GET['e'])
    ) {
        $caches = $db->getCachesInBBox(
            (float)$_GET['s'], (float)$_GET['w'],
            (float)$_GET['n'], (float)$_GET['e']
        );
    } else {
        $caches = $db->getAllCaches();
    }

    echo json_encode(['success' => true, 'caches' => $caches]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
