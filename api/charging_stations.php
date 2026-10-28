<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
@set_time_limit(65);

function chargingReply(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    chargingReply(405, ['success' => false, 'error' => 'Nur POST ist erlaubt.']);
}

$request = json_decode(file_get_contents('php://input'), true);
$bbox = is_array($request) ? ($request['bbox'] ?? null) : null;
if (!is_array($bbox) || count($bbox) !== 4 || !array_reduce($bbox, static fn(bool $valid, mixed $value): bool => $valid && is_numeric($value), true)) {
    chargingReply(400, ['success' => false, 'error' => 'Ungültiger Kartenausschnitt.']);
}
[$south, $west, $north, $east] = array_map('floatval', array_values($bbox));
if (!is_finite($south) || !is_finite($west) || !is_finite($north) || !is_finite($east)
    || $south < -90 || $north > 90 || $west < -180 || $east > 180
    || $south >= $north || $west >= $east || $north - $south > 1 || $east - $west > 1) {
    chargingReply(400, ['success' => false, 'error' => 'Der Kartenausschnitt ist ungültig oder zu groß. Bitte näher heranzoomen.']);
}

$query = sprintf(
    '[out:json][timeout:15];(nwr["amenity"="charging_station"](%.7F,%.7F,%.7F,%.7F);nwr["man_made"="charge_point"](%.7F,%.7F,%.7F,%.7F);nwr["amenity"="fuel"]["fuel:electricity"="yes"](%.7F,%.7F,%.7F,%.7F););out center;',
    $south, $west, $north, $east,
    $south, $west, $north, $east,
    $south, $west, $north, $east
);
$body = http_build_query(['data' => $query]);
$endpoints = [
    'https://overpass.private.coffee/api/interpreter',
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
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 18,
        CURLOPT_USERAGENT => 'GeocacheMap charging stations/1.0 (personal mapping application)',
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

    chargingReply(200, [
        'success' => true,
        'source' => 'OpenStreetMap',
        'elements' => $data['elements'],
    ]);
}

// Overpass is a community service and may be temporarily unavailable. For
// Germany, Esri republishes the BNetzA register as a queryable point layer.
$arcgisEndpoint = 'https://services2.arcgis.com/jUpNdisbWqRpMo35/arcgis/rest/services/Ladesaeulen_in_Deutschland/FeatureServer/0/query';
$arcgisQuery = http_build_query([
    'where' => '1=1',
    'geometry' => sprintf('%.7F,%.7F,%.7F,%.7F', $west, $south, $east, $north),
    'geometryType' => 'esriGeometryEnvelope',
    'inSR' => '4326',
    'spatialRel' => 'esriSpatialRelIntersects',
    'outFields' => '*',
    'returnGeometry' => 'true',
    'outSR' => '4326',
    'f' => 'geojson',
]);
$curl = curl_init($arcgisEndpoint . '?' . $arcgisQuery);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_USERAGENT => 'GeocacheMap charging stations/1.0 (personal mapping application)',
    CURLOPT_HTTPHEADER => ['Accept: application/geo+json, application/json'],
]);
$raw = curl_exec($curl);
$curlError = curl_error($curl);
$status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
curl_close($curl);

if (is_string($raw) && $status >= 200 && $status < 300) {
    $data = json_decode($raw, true);
    if (is_array($data) && is_array($data['features'] ?? null)) {
        $elements = [];
        foreach ($data['features'] as $feature) {
            $coordinates = $feature['geometry']['coordinates'] ?? null;
            $properties = $feature['properties'] ?? [];
            if (!is_array($coordinates) || count($coordinates) < 2 || !is_array($properties)) continue;
            [$lon, $lat] = array_map('floatval', array_slice($coordinates, 0, 2));
            if (!is_finite($lat) || !is_finite($lon) || $lat < $south || $lat > $north || $lon < $west || $lon > $east) continue;

            // Keep the display useful even if field names change in a future
            // version of the hosted layer. The raw properties remain available
            // as tags so the existing popup can show operator/name details.
            $tags = [];
            foreach ($properties as $key => $value) {
                if ($value === null || $value === '') continue;
                $tags[(string)$key] = is_scalar($value) ? (string)$value : '';
                if (preg_match('/operator|betreiber/i', (string)$key) && !isset($tags['operator'])) $tags['operator'] = (string)$value;
                if (preg_match('/anzahl.*ladepunkt|ladepunkt.*anzahl|capacity/i', (string)$key) && !isset($tags['capacity'])) $tags['capacity'] = (string)$value;
            }
            $name = '';
            foreach ($properties as $key => $value) {
                if (is_string($value) && trim($value) !== '' && preg_match('/name|bezeichnung|betreiber|operator/i', (string)$key)) {
                    $name = trim($value);
                    if (preg_match('/name|bezeichnung/i', (string)$key)) break;
                }
            }
            if ($name !== '') $tags['name'] = $name;
            $id = $feature['id'] ?? ($properties['OBJECTID'] ?? ($properties['objectid'] ?? count($elements)));
            $elements[] = [
                'type' => 'node', 'id' => 'bnetza-' . (string)$id,
                'lat' => $lat, 'lon' => $lon, 'source' => 'Bundesnetzagentur', 'tags' => $tags,
            ];
        }
        chargingReply(200, [
            'success' => true,
            'source' => 'Bundesnetzagentur (Esri)',
            'elements' => $elements,
        ]);
    }
    $errors[] = 'BNetzA/Esri: ungültige Antwort';
} else {
    $errors[] = 'BNetzA/Esri: ' . ($curlError !== '' ? $curlError : 'HTTP ' . $status);
}

chargingReply(502, [
    'success' => false,
    'error' => implode(' | ', $errors) ?: 'Kein Overpass-Endpunkt erreichbar.',
]);
