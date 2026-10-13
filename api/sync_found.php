<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/GeocachingClient.php';

$configFile = __DIR__ . '/../config/credentials.php';
if (!file_exists($configFile)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'config/credentials.php fehlt.']);
    exit;
}

$config = require $configFile;
$db     = new Database(__DIR__ . '/../data/geocaching.sqlite');
$client = new GeocachingClient($config, __DIR__ . '/../session/cookies.txt');

try {
    $db->clearAllFoundStatuses();

    $total   = 0;
    $skip    = 0;
    $take    = 200;
    $maxPages = 25;   // cap: 5 000 finds

    for ($page = 0; $page < $maxPages; $page++) {
        $data    = $client->searchFound($skip, $take);
        $results = $data['results'] ?? [];

        if (!$results) break;

        foreach ($results as $item) {
            $gcCode = $item['code'] ?? $item['referenceCode'] ?? '';
            if (!$gcCode) continue;

            // Try several fields for the user's personal found date
            $foundDate = $item['userFoundDate']
                ?? $item['foundDate']
                ?? $item['userActivity']['loggedDate']
                ?? $item['userActivity']['foundDate']
                ?? null;

            if ($foundDate) {
                $foundDate = substr($foundDate, 0, 10);   // keep only YYYY-MM-DD
            }

            $db->setFoundStatus($gcCode, $foundDate);
            $total++;
        }

        if (count($results) < $take) break;
        $skip += $take;
    }

    echo json_encode([
        'success' => true,
        'found'   => $total,
        'message' => "{$total} gefundene Caches synchronisiert.",
    ]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
