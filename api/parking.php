<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
@set_time_limit(50);
require_once __DIR__ . '/../src/Database.php';

function parkingReply(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function parkingIsPrivate(array $element): bool
{
    $tags = $element['tags'] ?? [];
    foreach (['access', 'vehicle', 'motor_vehicle'] as $key) {
        if (strtolower(trim((string)($tags[$key] ?? ''))) === 'private') return true;
    }
    return false;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    parkingReply(405, ['success' => false, 'error' => 'Nur POST ist erlaubt.']);
}

$request = json_decode(file_get_contents('php://input'), true);
$bbox = is_array($request) ? ($request['bbox'] ?? null) : null;
if (!is_array($bbox) || count($bbox) !== 4
    || !array_reduce($bbox, static fn(bool $valid, mixed $value): bool => $valid && is_numeric($value), true)) {
    parkingReply(400, ['success' => false, 'error' => 'Ungültiger Kartenausschnitt.']);
}
[$south, $west, $north, $east] = array_map('floatval', array_values($bbox));
if (!is_finite($south) || !is_finite($west) || !is_finite($north) || !is_finite($east)
    || $south < -90 || $north > 90 || $west < -180 || $east > 180
    || $south >= $north || $west >= $east || $north - $south > 1 || $east - $west > 1) {
    parkingReply(400, ['success' => false, 'error' => 'Der Kartenausschnitt ist ungültig oder zu groß. Bitte näher heranzoomen.']);
}

$db = new Database(__DIR__ . '/../data/geocaching.sqlite');
$forceRefresh = is_array($request) && !empty($request['refresh']);
$cached = $forceRefresh ? null : $db->getParkingData($south, $west, $north, $east);
if ($cached !== null) {
    $elements = array_values(array_filter($cached['elements'], static fn(array $element): bool => !parkingIsPrivate($element)));
    parkingReply(200, [
        'success' => true,
        'source' => $cached['source'],
        'elements' => $elements,
        'cached' => true,
        'saved_at' => $cached['saved_at'],
    ]);
}

$query = sprintf(
    '[out:json][timeout:12];nwr["amenity"~"^(parking|parking_space)$"](%.7F,%.7F,%.7F,%.7F);out tags center;',
    $south, $west, $north, $east
);
$body = http_build_query(['data' => $query]);
$endpoints = [
    'https://overpass.private.coffee/api/interpreter',
    // Independent community instance; helps when the two European instances
    // return transient 5xx responses or are temporarily overloaded.
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
];
$errors = [];

foreach ($endpoints as $endpoint) {
    $curl = curl_init($endpoint);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 4,
        CURLOPT_POSTREDIR => CURL_REDIR_POST_ALL,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 14,
        CURLOPT_USERAGENT => 'GeocacheMap parking overlay/1.0 (personal mapping application)',
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
    ]);
    $raw = curl_exec($curl);
    $curlError = curl_error($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);

    if (!is_string($raw) || $status < 200 || $status >= 300) {
        $errors[] = parse_url($endpoint, PHP_URL_HOST) . ': ' . ($curlError !== '' ? $curlError : 'HTTP ' . $status);
        continue;
    }
    $data = json_decode($raw, true);
    $remark = is_array($data) ? (string)($data['remark'] ?? '') : '';
    if (!is_array($data) || $remark !== '' || !is_array($data['elements'] ?? null)) {
        $errors[] = parse_url($endpoint, PHP_URL_HOST) . ': ' . ($remark !== '' ? $remark : 'ungültige Antwort');
        continue;
    }
    $elements = array_values(array_filter($data['elements'], static fn(array $element): bool => !parkingIsPrivate($element)));
    $db->saveParkingData($south, $west, $north, $east, 'OpenStreetMap', $elements);
    parkingReply(200, ['success' => true, 'source' => 'OpenStreetMap', 'elements' => $elements]);
}

$stale = $db->getParkingData($south, $west, $north, $east, 24 * 30);
if ($stale !== null) {
    $elements = array_values(array_filter($stale['elements'], static fn(array $element): bool => !parkingIsPrivate($element)));
    parkingReply(200, [
        'success' => true,
        'source' => $stale['source'] . ' (Datenbank-Cache)',
        'elements' => $elements,
        'cached' => true,
        'stale' => true,
        'saved_at' => $stale['saved_at'],
    ]);
}

parkingReply(502, ['success' => false, 'error' => implode(' | ', $errors) ?: 'Kein Overpass-Endpunkt erreichbar.']);
