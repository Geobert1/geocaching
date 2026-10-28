<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
@set_time_limit(80);

function routeProfileReply(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function routeProfileDistance(array $a, array $b): float
{
    $rad = M_PI / 180;
    $lat1 = $a[1] * $rad;
    $lat2 = $b[1] * $rad;
    $dLat = ($b[1] - $a[1]) * $rad;
    $dLng = ($b[0] - $a[0]) * $rad;
    $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
    return 6371000 * 2 * atan2(sqrt($h), sqrt(max(0, 1 - $h)));
}

function routeProfileSample(array $path, int $count): array
{
    $cumulative = [0.0];
    for ($i = 1, $n = count($path); $i < $n; $i++) {
        $cumulative[$i] = $cumulative[$i - 1] + routeProfileDistance($path[$i - 1], $path[$i]);
    }
    $total = end($cumulative) ?: 0.0;
    if ($total <= 0) return [];

    $samples = [];
    for ($i = 0; $i < $count; $i++) {
        $distance = $count === 1 ? 0 : $total * $i / ($count - 1);
        $segment = 1;
        while ($segment < count($cumulative) - 1 && $cumulative[$segment] < $distance) $segment++;
        $segmentLength = $cumulative[$segment] - $cumulative[$segment - 1];
        $fraction = $segmentLength > 0 ? ($distance - $cumulative[$segment - 1]) / $segmentLength : 0;
        $samples[] = [
            'distance_m' => $distance,
            'lng' => $path[$segment - 1][0] + ($path[$segment][0] - $path[$segment - 1][0]) * $fraction,
            'lat' => $path[$segment - 1][1] + ($path[$segment][1] - $path[$segment - 1][1]) * $fraction,
        ];
    }
    return $samples;
}

function routeProfileFetch(string $url, string $method, ?string $body, string $contentType, int $timeout): array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        // Overpass may redirect an interpreter request to a backend. Treat
        // valid 3xx responses as transport redirects instead of API failures.
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_POSTREDIR => CURL_REDIR_POST_ALL,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => 'GeocacheMap route profile/1.0 (personal mapping application)',
        CURLOPT_HTTPHEADER => ['Content-Type: ' . $contentType, 'Accept: application/json'],
    ]);
    if ($method === 'POST') {
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body ?? '');
    }
    $raw = curl_exec($curl);
    $error = curl_error($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if (!is_string($raw) || $status < 200 || $status >= 300) {
        throw new RuntimeException($error !== '' ? $error : 'Geodaten-Dienst antwortet mit HTTP ' . $status . '.');
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) throw new RuntimeException('Geodaten-Dienst hat ungültige Daten geliefert.');
    return $decoded;
}

function routeProfilePointSegmentDistance(array $point, array $a, array $b): float
{
    $latRad = $point[1] * M_PI / 180;
    $scaleX = 111320 * cos($latRad);
    $scaleY = 111320;
    $px = $point[0] * $scaleX;
    $py = $point[1] * $scaleY;
    $ax = $a[0] * $scaleX;
    $ay = $a[1] * $scaleY;
    $bx = $b[0] * $scaleX;
    $by = $b[1] * $scaleY;
    $dx = $bx - $ax;
    $dy = $by - $ay;
    $lengthSquared = $dx * $dx + $dy * $dy;
    $t = $lengthSquared > 0 ? (($px - $ax) * $dx + ($py - $ay) * $dy) / $lengthSquared : 0;
    $t = max(0, min(1, $t));
    return hypot($px - ($ax + $t * $dx), $py - ($ay + $t * $dy));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    routeProfileReply(405, ['success' => false, 'error' => 'Nur POST ist erlaubt.']);
}

$request = json_decode(file_get_contents('php://input'), true);
$rawPath = is_array($request) ? ($request['coordinates'] ?? null) : null;
if (!is_array($rawPath) || count($rawPath) < 2 || count($rawPath) > 10000) {
    routeProfileReply(400, ['success' => false, 'error' => 'Die Route benötigt zwischen 2 und 10.000 Koordinaten.']);
}

$path = [];
foreach ($rawPath as $coordinate) {
    if (!is_array($coordinate) || count($coordinate) < 2 || !is_numeric($coordinate[0]) || !is_numeric($coordinate[1])) {
        routeProfileReply(400, ['success' => false, 'error' => 'Die Route enthält eine ungültige Koordinate.']);
    }
    $lng = (float)$coordinate[0];
    $lat = (float)$coordinate[1];
    if (!is_finite($lat) || !is_finite($lng) || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
        routeProfileReply(400, ['success' => false, 'error' => 'Die Route enthält Koordinaten außerhalb des gültigen Bereichs.']);
    }
    $path[] = [$lng, $lat];
}

// Compute route length without relying on the elevation provider.
$routeLength = 0.0;
for ($i = 1, $n = count($path); $i < $n; $i++) $routeLength += routeProfileDistance($path[$i - 1], $path[$i]);
if ($routeLength <= 0 || $routeLength > 250000) {
    routeProfileReply(400, ['success' => false, 'error' => 'Die Streckenlänge muss zwischen 0 und 250 km liegen.']);
}
$profileSamples = routeProfileSample($path, min(100, max(2, (int)ceil($routeLength / 250) + 1)));
// Keep the OSM query close to the actual route, including on long routes.
// The previous 180 point cap left gaps of more than a kilometre on long routes.
$surfaceSamples = routeProfileSample($path, min(2500, max(2, (int)ceil($routeLength / 35) + 1)));
$warnings = [];
$elevation = null;
$surface = null;

try {
    $locations = implode('|', array_map(
        static fn(array $point): string => sprintf('%.6f,%.6f', $point['lat'], $point['lng']),
        $profileSamples
    ));
    $elevationData = routeProfileFetch(
        'https://api.opentopodata.org/v1/eudem25m,srtm90m',
        'POST',
        json_encode(['locations' => $locations, 'interpolation' => 'bilinear'], JSON_THROW_ON_ERROR),
        'application/json',
        20
    );
    if (($elevationData['status'] ?? '') !== 'OK' || !is_array($elevationData['results'] ?? null)) {
        throw new RuntimeException((string)($elevationData['error'] ?? 'Höhenwerte sind nicht verfügbar.'));
    }
    $points = [];
    foreach ($elevationData['results'] as $index => $result) {
        $height = $result['elevation'] ?? null;
        $points[] = [
            'distance_m' => $profileSamples[$index]['distance_m'] ?? 0,
            'elevation_m' => is_numeric($height) ? (float)$height : null,
        ];
    }
    $known = array_values(array_filter($points, static fn(array $point): bool => $point['elevation_m'] !== null));
    if (!$known) throw new RuntimeException('Für diese Route liegen keine Höhenwerte vor.');
    $ascent = 0.0;
    $descent = 0.0;
    for ($i = 1; $i < count($points); $i++) {
        $before = $points[$i - 1]['elevation_m'];
        $after = $points[$i]['elevation_m'];
        if ($before === null || $after === null) continue;
        $change = $after - $before;
        if ($change > 3) $ascent += $change;
        elseif ($change < -3) $descent += abs($change);
    }
    $heights = array_column($known, 'elevation_m');
    $datasets = array_values(array_unique(array_filter(array_column($elevationData['results'], 'dataset'))));
    $elevation = [
        'datasets' => $datasets,
        'ascent_m' => (int)round($ascent),
        'descent_m' => (int)round($descent),
        'min_m' => (int)round(min($heights)),
        'max_m' => (int)round(max($heights)),
        'points' => $points,
    ];
} catch (Throwable $error) {
    $warnings[] = 'Höhenprofil: ' . $error->getMessage();
}

try {
    $line = implode(',', array_map(
        static fn(array $point): string => sprintf('%.6f,%.6f', $point['lat'], $point['lng']),
        $surfaceSamples
    ));
    $query = '[out:json][timeout:25];way["highway"](around:35,' . $line . ');out tags geom;';
    $osmBody = http_build_query(['data' => $query]);
    $osmErrors = [];
    $osmData = null;
    foreach ([
        'https://overpass-api.de/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
    ] as $overpassUrl) {
        try {
            $osmData = routeProfileFetch($overpassUrl, 'POST', $osmBody, 'application/x-www-form-urlencoded', 18);
            if (isset($osmData['remark'])) throw new RuntimeException((string)$osmData['remark']);
            $foundWays = array_filter($osmData['elements'] ?? [], static fn($element): bool =>
                is_array($element) && ($element['type'] ?? '') === 'way' && count($element['geometry'] ?? []) > 1
            );
            if (!$foundWays) throw new RuntimeException('Der Dienst hat keine Straßen- oder Wegabschnitte für die Route geliefert.');
            break;
        } catch (Throwable $error) {
            $osmErrors[] = parse_url($overpassUrl, PHP_URL_HOST) . ': ' . $error->getMessage();
            $osmData = null;
        }
    }
    if ($osmData === null) throw new RuntimeException($osmErrors
        ? implode(' | ', $osmErrors)
        : 'OpenStreetMap-Daten sind nicht verfügbar.');
    $ways = array_values(array_filter($osmData['elements'] ?? [], static fn($element): bool =>
        is_array($element) && ($element['type'] ?? '') === 'way' && count($element['geometry'] ?? []) > 1
    ));
    $ways = array_slice($ways, 0, 2500);
    $surfaceBins = [];
    $wayTypeBins = [];
    $tracktypeBins = [];
    $smoothnessBins = [];
    $unknownMeters = 0.0;
    $sampleWeight = $routeLength / max(1, count($surfaceSamples));
    foreach ($surfaceSamples as $sample) {
        $nearest = null;
        $nearestDistance = 35.0;
        foreach ($ways as $way) {
            $geometry = $way['geometry'];
            for ($i = 1, $n = count($geometry); $i < $n; $i++) {
                $a = [(float)$geometry[$i - 1]['lon'], (float)$geometry[$i - 1]['lat']];
                $b = [(float)$geometry[$i]['lon'], (float)$geometry[$i]['lat']];
                $distance = routeProfilePointSegmentDistance([$sample['lng'], $sample['lat']], $a, $b);
                if ($distance < $nearestDistance) {
                    $nearestDistance = $distance;
                    $nearest = $way;
                    if ($distance < 1) break;
                }
            }
        }
        if ($nearest === null) {
            $unknownMeters += $sampleWeight;
            continue;
        }
        $tags = $nearest['tags'] ?? [];
        $surfaceKey = trim((string)($tags['surface'] ?? ''));
        if ($surfaceKey === '') $surfaceKey = '__missing_surface';
        $wayTypeKey = (string)($tags['highway'] ?? '__missing_waytype');
        $tracktypeKey = trim((string)($tags['tracktype'] ?? '')) ?: '__missing_tracktype';
        $smoothnessKey = trim((string)($tags['smoothness'] ?? '')) ?: '__missing_smoothness';
        $surfaceBins[$surfaceKey] = ($surfaceBins[$surfaceKey] ?? 0.0) + $sampleWeight;
        $wayTypeBins[$wayTypeKey] = ($wayTypeBins[$wayTypeKey] ?? 0.0) + $sampleWeight;
        $tracktypeBins[$tracktypeKey] = ($tracktypeBins[$tracktypeKey] ?? 0.0) + $sampleWeight;
        $smoothnessBins[$smoothnessKey] = ($smoothnessBins[$smoothnessKey] ?? 0.0) + $sampleWeight;
    }
    $toCategories = static function (array $bins) use ($routeLength): array {
        $categories = [];
        foreach ($bins as $key => $meters) {
            $categories[] = ['key' => $key, 'meters' => round($meters), 'percent' => round(100 * $meters / $routeLength, 1)];
        }
        usort($categories, static fn(array $a, array $b): int => $b['meters'] <=> $a['meters']);
        return $categories;
    };
    $surfaceCoverage = array_sum(array_filter($surfaceBins, static fn($key): bool => $key !== '__missing_surface' && $key !== '__unmatched', ARRAY_FILTER_USE_KEY));
    $tracktypeCoverage = array_sum(array_filter($tracktypeBins, static fn($key): bool => $key !== '__missing_tracktype' && $key !== '__unmatched', ARRAY_FILTER_USE_KEY));
    $smoothnessCoverage = array_sum(array_filter($smoothnessBins, static fn($key): bool => $key !== '__missing_smoothness' && $key !== '__unmatched', ARRAY_FILTER_USE_KEY));
    $surfaceBins['__unmatched'] = $unknownMeters;
    $wayTypeBins['__unmatched'] = $unknownMeters;
    $tracktypeBins['__unmatched'] = $unknownMeters;
    $smoothnessBins['__unmatched'] = $unknownMeters;
    $surface = [
        'categories' => $toCategories($surfaceBins),
        'tagged_percent' => round(100 * $surfaceCoverage / $routeLength, 1),
        'unmatched_m' => round($unknownMeters),
        'unmatched_percent' => round(100 * $unknownMeters / $routeLength, 1),
        'matched_way_count' => count($ways),
    ];
    $wayTypes = ['categories' => $toCategories($wayTypeBins)];
    $tracktypes = ['categories' => $toCategories($tracktypeBins), 'tagged_percent' => round(100 * $tracktypeCoverage / $routeLength, 1)];
    $smoothness = ['categories' => $toCategories($smoothnessBins), 'tagged_percent' => round(100 * $smoothnessCoverage / $routeLength, 1)];
} catch (Throwable $error) {
    $warnings[] = 'Wegbeschaffenheit: ' . $error->getMessage();
}

routeProfileReply(200, [
    'success' => true,
    'distance_m' => (int)round($routeLength),
    'elevation' => $elevation,
    'surface' => $surface,
    'way_types' => $wayTypes ?? null,
    'tracktypes' => $tracktypes ?? null,
    'smoothness' => $smoothness ?? null,
    'warnings' => $warnings,
]);
