<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';

try {
    $db = new Database(__DIR__ . '/../data/geocaching.sqlite');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        echo json_encode(['success' => true, 'waypoints' => $db->getWaypoints()]);
        exit;
    }

    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload)) {
        throw new InvalidArgumentException('Ungültige Anfrage.');
    }

    if ($method === 'POST') {
        if (($payload['action'] ?? '') === 'home') {
            $id = $payload['id'] ?? null;
            if ($id !== null) {
                $id = filter_var($id, FILTER_VALIDATE_INT);
                if ($id === false || $id < 1) throw new InvalidArgumentException('Ungültige Wegpunkt-ID.');
            }
            if (!$db->setHomeWaypoint($id)) throw new InvalidArgumentException('Wegpunkt wurde nicht gefunden.');
            echo json_encode(['success' => true, 'home_waypoint_id' => $id]);
            exit;
        }
        $name = trim((string)($payload['name'] ?? ''));
        $lat = filter_var($payload['lat'] ?? null, FILTER_VALIDATE_FLOAT);
        $lng = filter_var($payload['lng'] ?? null, FILTER_VALIDATE_FLOAT);
        $nameLength = function_exists('mb_strlen') ? mb_strlen($name, 'UTF-8') : strlen($name);
        if ($name === '' || $nameLength > 120) {
            throw new InvalidArgumentException('Der Name muss zwischen 1 und 120 Zeichen lang sein.');
        }
        if ($lat === false || $lng === false || !is_finite((float)$lat) || !is_finite((float)$lng)
            || (float)$lat < -90 || (float)$lat > 90 || (float)$lng < -180 || (float)$lng > 180) {
            throw new InvalidArgumentException('Ungültige Koordinaten.');
        }
        $waypoint = $db->createWaypoint($name, (float)$lat, (float)$lng);
        echo json_encode(['success' => true, 'waypoint' => $waypoint]);
        exit;
    }

    if ($method === 'DELETE') {
        $id = filter_var($payload['id'] ?? null, FILTER_VALIDATE_INT);
        if ($id === false || $id < 1) throw new InvalidArgumentException('Ungültige Wegpunkt-ID.');
        echo json_encode(['success' => true, 'deleted' => $db->deleteWaypoint($id)]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Methode nicht erlaubt.']);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Wegpunkte konnten nicht verarbeitet werden.']);
}
