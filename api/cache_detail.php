<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/GeocachingClient.php';

$db = new Database(__DIR__ . '/../data/geocaching.sqlite');

try {
    $gcCode = strtoupper(trim($_GET['gc_code'] ?? ''));
    if (!$gcCode || !preg_match('/^GC[A-Z0-9]+$/i', $gcCode)) {
        throw new InvalidArgumentException('Ungültiger GC-Code.');
    }

    $refreshDetails = (bool)($_GET['refresh_details'] ?? false);
    $logTotals  = [];
    $recentLogs = [];

    // Webdaten (Hint, Beschreibung, Log-Statistik) von geocaching.com laden
    $detail = $db->getCacheDetail($gcCode);
    $needsWebData = $refreshDetails
        || ($detail && !$detail['short_description'] && !$detail['long_description']);

    if ($needsWebData) {
        $configFile = __DIR__ . '/../config/credentials.php';
        if (file_exists($configFile)) {
            try {
                $config = require $configFile;
                $client = new GeocachingClient($config, __DIR__ . '/../session/cookies.txt');
                $webData = $client->getCacheWebData($gcCode);
                $db->updateCacheDetails(
                    $gcCode,
                    $webData['short_description'] ?? null,
                    $webData['long_description']  ?? null,
                    $webData['encoded_hints']     ?? null
                );
                $logTotals = $webData['log_totals'] ?? [];

                // Merge last-date-per-type + recent log entries (only on explicit refresh)
                if ($refreshDetails && !empty($logTotals)) {
                    try {
                        $logData = $client->getCacheLogData($gcCode);
                        $logDates  = $logData['dates']  ?? [];
                        $recentLogs = $logData['recent'] ?? [];
                        foreach ($logTotals as &$t) {
                            if (isset($logDates[$t['id']])) {
                                $t['last_date'] = $logDates[$t['id']];
                            }
                        }
                        unset($t);
                    } catch (Throwable) {
                        $recentLogs = [];
                    }
                } else {
                    $recentLogs = [];
                }
            } catch (Throwable) {
                // Web-Daten sind optional; weiter mit DB-Daten
            }
        }
    }

    $cache = $db->getCacheDetail($gcCode);
    if (!$cache) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Cache nicht in der lokalen DB.']);
        exit;
    }

    echo json_encode(['success' => true, 'cache' => $cache, 'log_totals' => $logTotals, 'recent_logs' => $recentLogs]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
