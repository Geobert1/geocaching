<?php
declare(strict_types=1);

@set_time_limit(60);

function satelliteError(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['success' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    satelliteError(405, 'Nur GET ist erlaubt.');
}

$params = array_change_key_case($_GET, CASE_UPPER);
$request = strtoupper(trim((string)($params['REQUEST'] ?? '')));
$srs = strtoupper(trim((string)($params['SRS'] ?? $params['CRS'] ?? '')));
$bboxParts = explode(',', (string)($params['BBOX'] ?? ''));
$width = filter_var($params['WIDTH'] ?? null, FILTER_VALIDATE_INT);
$height = filter_var($params['HEIGHT'] ?? null, FILTER_VALIDATE_INT);

if ($request !== 'GETMAP' || $srs !== 'EPSG:3857' || $width !== 256 || $height !== 256 || count($bboxParts) !== 4) {
    satelliteError(400, 'Ungültige Wolkenbild-Kachel.');
}
$bbox = array_map('floatval', $bboxParts);
if (count(array_filter($bbox, 'is_finite')) !== 4
    || $bbox[0] >= $bbox[2] || $bbox[1] >= $bbox[3]
    || max(array_map('abs', $bbox)) > 20050000) {
    satelliteError(400, 'Ungültiger Kartenausschnitt.');
}

$common = [
    'service' => 'WMS',
    'version' => '1.1.1',
    'request' => 'GetMap',
    'styles' => '',
    'format' => 'image/png',
    'transparent' => 'true',
    'width' => '256',
    'height' => '256',
    'srs' => 'EPSG:3857',
    'bbox' => implode(',', array_map(static fn(float $value): string => sprintf('%.8F', $value), $bbox)),
];
$sources = [
    ['url' => 'https://maps.dwd.de/geoproxy/wms', 'layer' => 'SAT_EU_central_RGB_cloud'],
    ['url' => 'https://maps.dwd.de/geoserver/dwd/wms', 'layer' => 'dwd:Satellite_meteosat_1km_euat_rgb_day_hrv_and_night_ir108_3h'],
];
$errors = [];

foreach ($sources as $source) {
    $query = http_build_query($common + ['layers' => $source['layer']], '', '&', PHP_QUERY_RFC3986);
    $curl = curl_init($source['url'] . '?' . $query);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; GeocacheMap/1.0; WMS client)',
        CURLOPT_HTTPHEADER => ['Accept: image/png, */*;q=0.8'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $image = curl_exec($curl);
    $curlError = curl_error($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $contentType = strtolower((string)curl_getinfo($curl, CURLINFO_CONTENT_TYPE));
    curl_close($curl);

    if (is_string($image) && $status >= 200 && $status < 300 && str_starts_with($contentType, 'image/')) {
        http_response_code(200);
        header('Content-Type: ' . $contentType);
        header('Cache-Control: public, max-age=300, stale-while-revalidate=600');
        header('X-Content-Type-Options: nosniff');
        echo $image;
        exit;
    }
    $detail = $curlError !== '' ? $curlError : 'HTTP ' . $status . ' (' . ($contentType ?: 'unbekannter Inhaltstyp') . ')';
    if (is_string($image) && $image !== '' && !str_starts_with($contentType, 'image/')) {
        $summary = trim(preg_replace('/\s+/', ' ', strip_tags(substr($image, 0, 1200))) ?? '');
        if ($summary !== '') $detail .= ' — ' . substr($summary, 0, 240);
    }
    $errors[] = $source['layer'] . ': ' . $detail;
}

error_log('GeocacheMap satellite tile failed: ' . implode(' | ', $errors));
satelliteError(502, 'DWD-Wolkenbild fehlgeschlagen: ' . implode(' | ', $errors));
