<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/GeocachingClient.php';

$configFile = __DIR__ . '/../config/credentials.php';
if (!file_exists($configFile)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'config/credentials.php fehlt – bitte aus credentials.example.php kopieren und befüllen.']);
    exit;
}

$config = require $configFile;
$db     = new Database(__DIR__ . '/../data/geocaching.sqlite');
$client = new GeocachingClient($config, __DIR__ . '/../session/cookies.txt');

try {
    $body  = json_decode(file_get_contents('php://input'), true) ?? [];
    $mode  = $body['mode']         ?? 'circle';
    $force = (bool)($body['force'] ?? false);
    $maxAge = (int)($body['max_age_hours'] ?? 24);   // Freshness-Schwelle in Stunden

    // ── Bereich aus Request lesen ──────────────────────────────────────────────
    if ($mode === 'circle') {
        $lat    = (float)($body['lat']    ?? 0);
        $lng    = (float)($body['lng']    ?? 0);
        $radius = (int)  ($body['radius'] ?? 5000);
        if (!$lat || !$lng) throw new InvalidArgumentException('lat und lng sind erforderlich.');
        $areaParams = ['mode' => 'circle', 'lat' => $lat, 'lng' => $lng, 'radius' => $radius];
    } elseif ($mode === 'bbox') {
        $areaParams = [
            'mode'   => 'bbox',
            'minLat' => (float)($body['minLat'] ?? 0),
            'minLng' => (float)($body['minLng'] ?? 0),
            'maxLat' => (float)($body['maxLat'] ?? 0),
            'maxLng' => (float)($body['maxLng'] ?? 0),
        ];
    } else {
        throw new InvalidArgumentException('Unbekannter Modus: ' . $mode);
    }

    // ── Freshness-Check: gesamter Bereich bereits durch früheren Sync abgedeckt? ─
    if (!$force && $db->isAreaCovered($areaParams, $maxAge)) {
        $count = $mode === 'circle'
            ? count($db->getCachesInBBox(
                $areaParams['lat'] - $areaParams['radius'] / 111_000,
                $areaParams['lng'] - $areaParams['radius'] / 111_000,
                $areaParams['lat'] + $areaParams['radius'] / 111_000,
                $areaParams['lng'] + $areaParams['radius'] / 111_000
              ))
            : count($db->getCachesInBBox(
                $areaParams['minLat'], $areaParams['minLng'],
                $areaParams['maxLat'], $areaParams['maxLng']
              ));

        echo json_encode([
            'success' => true,
            'skipped' => true,
            'saved'   => 0,
            'count'   => $count,
            'message' => "Bereich bereits aktuell (Daten < {$maxAge} h alt). {$count} Caches in der DB.",
        ]);
        exit;
    }

    // ── API-Aufruf ─────────────────────────────────────────────────────────────
    if ($mode === 'circle') {
        $data = $client->searchByCircle($lat, $lng, $radius);
    } else {
        $data = $client->searchByBBox(
            $areaParams['minLat'], $areaParams['minLng'],
            $areaParams['maxLat'], $areaParams['maxLng']
        );
    }

    $results = $data['results'] ?? [];
    $saved   = 0;

    foreach ($results as $item) {
        $typeId    = (int)($item['geocacheType'] ?? 2);
        $container = $item['containerType'] ?? 3;
        $coords    = $item['postedCoordinates'] ?? [];
        $owner     = $item['owner'] ?? [];

        $lat = (float)($coords['latitude'] ?? $coords['lat'] ?? 0);
        $lng = (float)($coords['longitude'] ?? $coords['lng'] ?? 0);
        if (!$lat || !$lng) continue;

        $gcCode = $item['code'] ?? $item['referenceCode'] ?? '';
        if (!$gcCode) continue;

        $containerName = is_array($container)
            ? GeocachingClient::containerName((int)($container['containerTypeId'] ?? 3))
            : GeocachingClient::containerName((int)$container);

        $db->upsertCache([
            'gc_code'           => $gcCode,
            'reference_code'    => $item['referenceCode'] ?? $gcCode,
            'name'              => $item['name'] ?? 'Unbekannt',
            'cache_type'        => $typeId,
            'cache_type_name'   => GeocachingClient::typeName($typeId),
            'difficulty'        => (float)($item['difficulty'] ?? 1.0),
            'terrain'           => (float)($item['terrain']    ?? 1.0),
            'container_size'    => $containerName,
            'status'            => GeocachingClient::mapStatus($item['cacheStatus'] ?? 0),
            'lat'               => $lat,
            'lng'               => $lng,
            'owner'             => is_array($owner) ? ($owner['username'] ?? null) : $owner,
            'placed_date'       => isset($item['placedDate'])    ? substr($item['placedDate'],   0, 10) : null,
            'last_found_date'   => isset($item['lastFoundDate']) ? substr($item['lastFoundDate'], 0, 10) : null,
            'short_description' => $item['shortDescription'] ?? null,
            'encoded_hints'     => $item['encodedHints']     ?? null,
            'favorite_points'   => (int)($item['favoritePoints'] ?? 0),
            'premium_only'      => (int)(bool)($item['premiumOnly'] ?? false),
            'raw_json'          => json_encode($item),
        ]);

        $saved++;
    }

    $db->logSyncArea($areaParams);
    $db->cleanSyncLog($maxAge);

    // ── Found-Sync for this area (paginate so older finds are included) ───────
    $foundCount = 0;
    $foundError = null;
    try {
        $foundItems = [];
        $take = 200;
        for ($page = 0; $page < 25; $page++) {
            $foundData = $client->searchFoundInArea($areaParams, $page * $take, $take);
            $pageItems = $foundData['results'] ?? [];
            if ($pageItems) array_push($foundItems, ...$pageItems);
            if (count($pageItems) < $take) break;
        }

        // Only an explicit personal found date is evidence of a find. The web
        // search endpoint can return ordinary area results even when its found
        // filter is ignored, so never mark every returned item blindly.
        if ($mode === 'circle') {
            $latDelta = $areaParams['radius'] / 111_000;
            $lngDelta = $areaParams['radius'] / max(1, 111_000 * cos(deg2rad($areaParams['lat'])));
            $south = $areaParams['lat'] - $latDelta;
            $north = $areaParams['lat'] + $latDelta;
            $west = $areaParams['lng'] - $lngDelta;
            $east = $areaParams['lng'] + $lngDelta;
            $areaCaches = array_filter(
                $db->getCachesInBBox($south, $west, $north, $east),
                static function (array $cache) use ($areaParams): bool {
                    $lat1 = deg2rad($areaParams['lat']);
                    $lat2 = deg2rad((float)$cache['lat']);
                    $dLat = $lat2 - $lat1;
                    $dLng = deg2rad((float)$cache['lng'] - $areaParams['lng']);
                    $a = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
                    return 6_371_000 * 2 * asin(min(1, sqrt($a))) <= $areaParams['radius'];
                }
            );
        } else {
            $areaCaches = $db->getCachesInBBox(
                $areaParams['minLat'], $areaParams['minLng'],
                $areaParams['maxLat'], $areaParams['maxLng']
            );
        }
        $areaGcCodes = array_column($areaCaches, 'gc_code');
        $db->clearFoundStatusesForCaches($areaGcCodes);
        $verifiedFoundCodes = [];
        foreach (array_merge($results, $foundItems) as $item) {
            $gcCode = strtoupper((string)($item['code'] ?? $item['referenceCode'] ?? ''));
            if (!$gcCode) continue;
            $foundDate = $item['userFoundDate']
                ?? $item['userData']['foundDate']
                ?? null;
            $userFound = in_array($item['userFound'] ?? null, [true, 1, '1', 'true'], true);
            if (!$userFound && !$foundDate) continue;
            $foundDate = $foundDate ? substr((string)$foundDate, 0, 10) : null;
            if ($foundDate !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $foundDate)) $foundDate = null;
            $db->setFoundStatus($gcCode, $foundDate);
            $verifiedFoundCodes[$gcCode] = true;
        }
        $foundCount = count($verifiedFoundCodes);
    } catch (Throwable $e) {
        $foundError = $e->getMessage();
    }

    $msg = "{$saved} Caches gespeichert (API: " . ($data['total'] ?? '?') . ")";
    if ($foundError) {
        $msg .= " – Funde-Sync fehlgeschlagen: {$foundError}";
    } elseif ($foundCount > 0) {
        $msg .= ", {$foundCount} Funde markiert";
    } else {
        $msg .= ", keine gefundenen Caches im Bereich";
    }
    $msg .= '.';

    echo json_encode([
        'success'      => true,
        'skipped'      => false,
        'total_found'  => $data['total'] ?? count($results),
        'saved'        => $saved,
        'found_synced' => $foundCount,
        'message'      => $msg,
    ]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
