<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';

try {
    $db = new Database(__DIR__ . '/../data/geocaching.sqlite');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'GET') {
        echo json_encode(['success' => true, 'routes' => $db->getSavedRoutes()]);
        exit;
    }

    $payload = json_decode(file_get_contents('php://input'), true);
    if (!is_array($payload)) throw new InvalidArgumentException('Ungültige Anfrage.');
    if ($method === 'DELETE') {
        if (!empty($payload['last_plan'])) {
            echo json_encode(['success' => true, 'deleted' => $db->clearLastPlanRoute()]);
            exit;
        }
        $id = filter_var($payload['id'] ?? null, FILTER_VALIDATE_INT);
        if ($id === false || $id < 1) throw new InvalidArgumentException('Ungültige Routen-ID.');
        if ($db->isLastPlanRoute((int)$id)) throw new InvalidArgumentException('„Letzte Planung“ wird automatisch verwaltet und kann nicht gelöscht werden.');
        echo json_encode(['success' => true, 'deleted' => $db->deleteSavedRoute($id)]);
        exit;
    }
    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'error' => 'Methode nicht erlaubt.']);
        exit;
    }

    $isLastPlan = !empty($payload['last_plan']);
    $name = $isLastPlan ? 'Letzte Planung' : trim((string)($payload['name'] ?? ''));
    $normalizedName = function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
    if (!$isLastPlan && $normalizedName === 'letzte planung') {
        throw new InvalidArgumentException('Der Name „Letzte Planung“ ist für die automatische Planung reserviert.');
    }
    $nameLength = function_exists('mb_strlen') ? mb_strlen($name, 'UTF-8') : strlen($name);
    if ($name === '' || $nameLength > 120) throw new InvalidArgumentException('Der Routenname muss zwischen 1 und 120 Zeichen lang sein.');
    $points = $payload['points'] ?? null;
    if (!is_array($points) || count($points) > 100) {
        throw new InvalidArgumentException('Eine Route muss zwischen 2 und 100 Punkten enthalten.');
    }
    if ($isLastPlan && count($points) === 0) {
        $db->clearLastPlanRoute();
        echo json_encode(['success' => true, 'cleared' => true]);
        exit;
    }
    if (count($points) < ($isLastPlan ? 1 : 2)) {
        throw new InvalidArgumentException($isLastPlan
            ? 'Die letzte Planung muss mindestens einen Punkt enthalten.'
            : 'Eine Route muss zwischen 2 und 100 Punkten enthalten.');
    }
    $normalized = [];
    foreach ($points as $point) {
        if (!is_array($point)) throw new InvalidArgumentException('Ungültiger Routenpunkt.');
        $lat = filter_var($point['lat'] ?? null, FILTER_VALIDATE_FLOAT);
        $lng = filter_var($point['lng'] ?? null, FILTER_VALIDATE_FLOAT);
        $pointName = trim((string)($point['name'] ?? ''));
        if ($lat === false || $lng === false || !is_finite((float)$lat) || !is_finite((float)$lng)
            || (float)$lat < -90 || (float)$lat > 90 || (float)$lng < -180 || (float)$lng > 180
            || $pointName === '') {
            throw new InvalidArgumentException('Ein Routenpunkt hat ungültige Koordinaten oder keinen Namen.');
        }
        $gcCode = isset($point['gc_code']) && preg_match('/^GC[A-Z0-9]{2,}$/i', (string)$point['gc_code'])
            ? strtoupper((string)$point['gc_code']) : null;
        $normalized[] = [
            'name' => function_exists('mb_substr') ? mb_substr($pointName, 0, 160, 'UTF-8') : substr($pointName, 0, 160),
            'lat' => (float)$lat,
            'lng' => (float)$lng,
            'isCache' => $gcCode !== null,
            'gc_code' => $gcCode,
            'is_home' => $gcCode === null && !empty($point['is_home']),
        ];
    }
    $id = null;
    $distanceMeters = null;
    $distanceApproximate = false;
    if (!$isLastPlan && array_key_exists('distance_m', $payload) && $payload['distance_m'] !== null && $payload['distance_m'] !== '') {
        $validatedDistance = filter_var($payload['distance_m'], FILTER_VALIDATE_FLOAT);
        if ($validatedDistance === false || !is_finite((float)$validatedDistance) || (float)$validatedDistance < 0) {
            throw new InvalidArgumentException('Ungültige Routenlänge.');
        }
        $distanceMeters = (float)$validatedDistance;
        $distanceApproximate = !empty($payload['distance_approximate']);
    }
    if ($isLastPlan) {
        $id = $db->getLastPlanRouteId();
    } elseif (array_key_exists('id', $payload) && $payload['id'] !== null && $payload['id'] !== '') {
        $id = filter_var($payload['id'], FILTER_VALIDATE_INT);
        if ($id === false || $id < 1) throw new InvalidArgumentException('Ungültige Routen-ID.');
        if ($db->isLastPlanRoute((int)$id)) throw new InvalidArgumentException('„Letzte Planung“ wird automatisch verwaltet.');
    }
    $route = $db->saveRoute($name, $normalized, !empty($payload['roundtrip']), $id, $isLastPlan, $distanceMeters, $distanceApproximate);
    if (!$route) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Gespeicherte Route nicht gefunden.']);
        exit;
    }
    echo json_encode(['success' => true, 'route' => $route]);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Routen konnten nicht verarbeitet werden.']);
}
