<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';

try {
    $db = new Database(__DIR__ . '/../data/geocaching.sqlite');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload)) $payload = [];

    $gcCode = strtoupper(trim((string)($payload['gc_code'] ?? $_GET['gc_code'] ?? '')));
    if (!preg_match('/^GC[A-Z0-9]+$/', $gcCode)) {
        throw new InvalidArgumentException('Ungültiger GC-Code.');
    }

    if ($method === 'POST') {
        $lat = filter_var($payload['lat'] ?? null, FILTER_VALIDATE_FLOAT);
        $lng = filter_var($payload['lng'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($lat === false || $lng === false || !is_finite((float)$lat) || !is_finite((float)$lng)
            || (float)$lat < -90 || (float)$lat > 90 || (float)$lng < -180 || (float)$lng > 180) {
            throw new InvalidArgumentException('Bitte gültige Koordinaten eingeben.');
        }
        if (!$db->setCacheCoordinateOverride($gcCode, (float)$lat, (float)$lng)) {
            throw new InvalidArgumentException('Nur Mystery-Caches aus der lokalen Datenbank können angepasst werden.');
        }
        echo json_encode(['success' => true]);
        exit;
    }

    if ($method === 'DELETE') {
        if (!$db->restoreCacheCoordinates($gcCode)) {
            throw new InvalidArgumentException('Für diesen Mystery-Cache ist keine Koordinatenänderung gespeichert.');
        }
        echo json_encode(['success' => true]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Methode nicht erlaubt.']);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Koordinaten konnten nicht gespeichert werden.']);
}
