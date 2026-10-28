<?php
declare(strict_types=1);

@set_time_limit(45);

function windError(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['success' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function windHttp(string $url, int $timeout = 12): string
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => 'GeocacheMap/1.0 (ICON-EU wind overlay)',
        CURLOPT_HTTPHEADER => ['Accept: */*'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($curl);
    $error = curl_error($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if (!is_string($body) || $status < 200 || $status >= 300) {
        throw new RuntimeException($error !== '' ? $error : 'DWD HTTP ' . $status);
    }
    return $body;
}

function windRunProcess(array $command, ?string $stdin = null): array
{
    $pipes = [];
    $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($process)) throw new RuntimeException('GRIB-Werkzeug konnte nicht gestartet werden.');
    if ($stdin !== null) fwrite($pipes[0], $stdin);
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    $code = proc_close($process);
    if ($code !== 0) throw new RuntimeException(trim($stderr) ?: 'GRIB-Verarbeitung fehlgeschlagen.');
    return [$stdout, $stderr];
}

function windExecutable(array $paths): ?string
{
    foreach ($paths as $path) if (is_executable($path)) return $path;
    return null;
}

function windFetchIndex(string $url, string $cacheFile): string
{
    if (is_file($cacheFile) && time() - filemtime($cacheFile) < 600) return (string)file_get_contents($cacheFile);
    $html = windHttp($url, 10);
    @file_put_contents($cacheFile, $html, LOCK_EX);
    return $html;
}

function windFindFrame(int $now, string $cacheDir, string $model): array
{
    $base = "https://opendata.dwd.de/weather/nwp/$model/grib";
    $cycleHours = $model === 'icon' ? 6 : 3;
    $indexErrors = [];
    for ($back = 0; $back < 8; $back++) {
        $cycleTime = $now - ($back * $cycleHours + ((int)gmdate('G', $now) % $cycleHours)) * 3600;
        $runHour = (int)gmdate('G', $cycleTime);
        $cycleKey = gmdate('YmdH', $cycleTime);
        try {
            $uIndex = windFetchIndex("$base/" . sprintf('%02d', $runHour) . '/u_10m/', "$cacheDir/index_{$model}_{$cycleKey}_u.html");
            $vIndex = windFetchIndex("$base/" . sprintf('%02d', $runHour) . '/v_10m/', "$cacheDir/index_{$model}_{$cycleKey}_v.html");
        } catch (Throwable $error) {
            // DWD may not have published the newest cycle yet. Try an older
            // cycle rather than failing the complete wind request on one 404.
            if (!str_contains($error->getMessage(), 'HTTP 404')) throw $error;
            $indexErrors[] = "$cycleKey: " . $error->getMessage();
            continue;
        }
        preg_match_all('/href="([^"]+_(\d{10})_(\d{3})_U_10M\.grib2\.bz2)"/i', $uIndex, $uMatches, PREG_SET_ORDER);
        preg_match_all('/href="([^"]+_(\d{10})_(\d{3})_V_10M\.grib2\.bz2)"/i', $vIndex, $vMatches, PREG_SET_ORDER);
        $vFiles = [];
        foreach ($vMatches as $match) $vFiles[$match[2] . '_' . $match[3]] = $match[1];
        $candidates = [];
        foreach ($uMatches as $match) {
            $key = $match[2] . '_' . $match[3];
            if (!isset($vFiles[$key])) continue;
            $run = DateTimeImmutable::createFromFormat('!YmdH', $match[2], new DateTimeZone('UTC'));
            if (!$run) continue;
            $runTs = $run->getTimestamp();
            if ($runTs > $now || $now - $runTs > ($cycleHours === 3 ? 14 : 30) * 3600) continue;
            $validTs = $runTs + ((int)$match[3] * 3600);
            $candidates[] = [
                'run' => $match[2], 'step' => $match[3], 'valid' => $validTs,
                'u' => $match[1], 'v' => $vFiles[$key], 'score' => abs($validTs - $now),
            ];
        }
        if ($candidates) {
            usort($candidates, static function (array $a, array $b) use ($now): int {
                return $a['score'] <=> $b['score']
                    ?: strcmp($b['run'], $a['run'])
                    ?: (($a['valid'] <= $now ? 0 : 1) <=> ($b['valid'] <= $now ? 0 : 1));
            });
            return $candidates[0];
        }
    }
    $details = $indexErrors ? ' ' . implode(' | ', array_slice($indexErrors, 0, 2)) : '';
    throw new RuntimeException("DWD hat derzeit keinen passenden $model-Windprognoselauf bereitgestellt." . $details);
}

function windFindIconGridCoordinateFiles(string $base, int $runHour, string $cacheDir): array
{
    $hour = sprintf('%02d', $runHour);
    $clatIndex = windFetchIndex("$base/$hour/clat/", "$cacheDir/index_icon_grid_{$hour}_clat.html");
    $clonIndex = windFetchIndex("$base/$hour/clon/", "$cacheDir/index_icon_grid_{$hour}_clon.html");
    preg_match_all('/href="([^"]+_time-invariant_(\d{10})_CLAT\.grib2\.bz2)"/i', $clatIndex, $clatMatches, PREG_SET_ORDER);
    preg_match_all('/href="([^"]+_time-invariant_(\d{10})_CLON\.grib2\.bz2)"/i', $clonIndex, $clonMatches, PREG_SET_ORDER);
    $clonFiles = [];
    foreach ($clonMatches as $match) $clonFiles[$match[2]] = $match[1];
    $pairs = [];
    foreach ($clatMatches as $match) {
        if (isset($clonFiles[$match[2]])) $pairs[$match[2]] = [$match[1], $clonFiles[$match[2]]];
    }
    if (!$pairs) throw new RuntimeException('DWD stellt keine passenden ICON-Gitterkoordinaten (CLAT/CLON) bereit.');
    krsort($pairs, SORT_STRING);
    return reset($pairs);
}

function windDownloadAndInflate(string $url, string $target): void
{
    $compressed = $target . '.bz2';
    if (!is_file($target) || filesize($target) < 1000) {
        if (!is_file($compressed) || time() - filemtime($compressed) > 86400) {
            $handle = fopen($compressed . '.part', 'wb');
            if (!$handle) throw new RuntimeException('Temporäre Modelldatei kann nicht angelegt werden.');
            $curl = curl_init($url);
            curl_setopt_array($curl, [
                CURLOPT_FILE => $handle, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
                CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 25,
                CURLOPT_USERAGENT => 'GeocacheMap/1.0 (ICON-EU wind overlay)',
                CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            ]);
            $ok = curl_exec($curl);
            $error = curl_error($curl);
            $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
            curl_close($curl);
            fclose($handle);
            if ($ok !== true || $status < 200 || $status >= 300 || filesize($compressed . '.part') < 1000) {
                @unlink($compressed . '.part');
                throw new RuntimeException($error !== '' ? $error : 'DWD-Modelldatei HTTP ' . $status);
            }
            rename($compressed . '.part', $compressed);
        }
        $decoded = fopen($target . '.part', 'wb');
        if (!$decoded) throw new RuntimeException('Temporäre GRIB-Datei kann nicht angelegt werden.');
        $process = proc_open([WIND_BZIP2, '-dc', $compressed], [0 => ['pipe', 'r'], 1 => $decoded, 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($process)) { fclose($decoded); throw new RuntimeException('Bzip2 konnte nicht gestartet werden.'); }
        fclose($pipes[0]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[2]);
        fclose($decoded);
        if (proc_close($process) !== 0 || filesize($target . '.part') < 1000) {
            @unlink($target . '.part');
            throw new RuntimeException(trim($error) ?: 'DWD-GRIB-Datei ist beschädigt.');
        }
        rename($target . '.part', $target);
    }
}

function windMergeIconGridCoordinates(array $files, string $target): string
{
    $fresh = is_file($target);
    if ($fresh) {
        foreach ($files as $file) {
            if (!is_file($file) || filemtime($file) > filemtime($target)) { $fresh = false; break; }
        }
    }
    if ($fresh) return $target;
    $output = fopen($target . '.part', 'wb');
    if (!$output) throw new RuntimeException('Temporäre ICON-Gitterdatei kann nicht angelegt werden.');
    try {
        foreach ($files as $file) {
            $input = fopen($file, 'rb');
            if (!$input) throw new RuntimeException('ICON-Gitterdatei kann nicht gelesen werden.');
            stream_copy_to_stream($input, $output);
            fclose($input);
        }
    } catch (Throwable $error) {
        fclose($output);
        @unlink($target . '.part');
        throw $error;
    }
    fclose($output);
    if (!rename($target . '.part', $target)) throw new RuntimeException('ICON-Gitterdatei konnte nicht gespeichert werden.');
    return $target;
}

function windCsv(string $gribFile, float $west, float $east, float $south, float $north, string $cacheDir, string $suffix, string $model, int $cols, int $rows): array
{
    if ($model === 'icon') {
        // ICON global is on an unstructured icosahedral grid. Its CLAT/CLON
        // records must define the grid before wgrib2 can emit geographic CSV.
        // Regrid directly to the requested view mesh before making CSV. Dumping
        // every global ICON node to CSV can exceed the web request time limit.
        $lonStep = ($east - $west) / max(1, $cols - 1);
        $latStep = ($north - $south) / max(1, $rows - 1);
        $target = "$cacheDir/icon_mesh_" . md5($gribFile . '|' . implode(',', [$west, $east, $south, $north, $cols, $rows])) . '.grb2';
        if (!is_file($target) || filesize($target) < 100 || filemtime($target) < filemtime($gribFile)) {
            @unlink($target . '.part');
            windRunProcess([
                WIND_WGRIB2, $gribFile, '-grid_def', '-not_if', ':GEO(LAT|LON):',
                '-lola', "$west:$cols:$lonStep", "$south:$rows:$latStep", $target . '.part', 'grib',
            ]);
            if (!is_file($target . '.part') || filesize($target . '.part') < 100
                || !rename($target . '.part', $target)) {
                @unlink($target . '.part');
                throw new RuntimeException('ICON-Winddaten konnten nicht auf das Kartengitter umgerechnet werden.');
            }
        }
        [$output] = windRunProcess([WIND_WGRIB2, $target, '-csv', '/dev/stdout']);
        $points = [];
        foreach (preg_split('/\\r?\\n/', trim($output)) ?: [] as $line) {
            $parts = str_getcsv($line);
            if (count($parts) < 3 || !is_numeric(trim((string)$parts[count($parts) - 1]))) continue;
            $lon = (float)$parts[count($parts) - 3];
            $lat = (float)$parts[count($parts) - 2];
            $value = (float)$parts[count($parts) - 1];
            if (!is_finite($lon) || !is_finite($lat) || !is_finite($value)) continue;
            if ($lon > 180) $lon -= 360;
            $points[sprintf('%.5f,%.5f', $lon, $lat)] = ['lon' => $lon, 'lat' => $lat, 'value' => $value];
        }
        return array_values($points);
    }
    if ($model === 'icon-eu') {
        $west = max(-25.0, $west); $east = min(45.0, $east);
        $south = max(25.0, $south); $north = min(72.0, $north);
    } else {
        $west = max(-180.0, $west); $east = min(180.0, $east);
        $south = max(-90.0, $south); $north = min(90.0, $north);
    }
    $west = floor($west * 2) / 2; $east = ceil($east * 2) / 2;
    $south = floor($south * 2) / 2; $north = ceil($north * 2) / 2;
    $crop = "$cacheDir/crop_{$suffix}_" . md5($gribFile . '|' . implode(',', [$west, $east, $south, $north])) . '.grb2';
    $csv = $crop . '.csv';
    if (!is_file($csv) || time() - filemtime($csv) > 3600) {
        windRunProcess([WIND_WGRIB2, $gribFile, '-small_grib', "$west:$east", "$south:$north", $crop]);
        [$output] = windRunProcess([WIND_WGRIB2, $crop, '-csv', '/dev/stdout']);
        file_put_contents($csv . '.part', $output, LOCK_EX);
        rename($csv . '.part', $csv);
    }
    $rows = [];
    $normalMatches = 0;
    $swappedMatches = 0;
    foreach (file($csv, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $parts = str_getcsv($line);
        if (count($parts) < 3) continue;
        $rawValue = trim((string)$parts[count($parts) - 1]);
        if (!is_numeric($rawValue)) continue;
        $firstCoordinate = (float)$parts[count($parts) - 3];
        $secondCoordinate = (float)$parts[count($parts) - 2];
        $value = (float)$rawValue;
        if (!is_finite($firstCoordinate) || !is_finite($secondCoordinate) || !is_finite($value)) continue;
        $secondAsLon = $secondCoordinate > 180 ? $secondCoordinate - 360 : $secondCoordinate;
        $firstAsLon = $firstCoordinate > 180 ? $firstCoordinate - 360 : $firstCoordinate;
        if ($firstCoordinate >= $west - 0.1 && $firstCoordinate <= $east + 0.1 && $secondCoordinate >= $south - 0.1 && $secondCoordinate <= $north + 0.1) $normalMatches++;
        if ($secondAsLon >= $west - 0.1 && $secondAsLon <= $east + 0.1 && $firstCoordinate >= $south - 0.1 && $firstCoordinate <= $north + 0.1) $swappedMatches++;
        $rows[] = [$firstCoordinate, $secondCoordinate, $value];
    }
    $swapAxes = $swappedMatches > $normalMatches;
    $points = [];
    foreach ($rows as [$firstCoordinate, $secondCoordinate, $value]) {
        $lon = $swapAxes ? $secondCoordinate : $firstCoordinate;
        $lat = $swapAxes ? $firstCoordinate : $secondCoordinate;
        if ($lon > 180) $lon -= 360;
        $points[sprintf('%.5f,%.5f', $lon, $lat)] = ['lon' => $lon, 'lat' => $lat, 'value' => $value];
    }
    return array_values($points);
}

function windInterpolate(array $points, float $lon, float $lat): ?float
{
    // ICON-EU's released regular-lat-lon files can contain scan/grid edges
    // where all four bilinear corners are not present after cropping. Use the
    // four closest native model coordinates instead, with inverse-distance
    // weights. This also works for a partially clipped model domain.
    $cosLat = cos(deg2rad($lat));
    $nearest = [];
    foreach ($points as $point) {
        $dx = ($point['lon'] - $lon) * $cosLat;
        $dy = $point['lat'] - $lat;
        $distance2 = $dx * $dx + $dy * $dy;
        if ($distance2 < 1.0e-12) return $point['value'];
        if ($distance2 > 0.04) continue; // at most 0.2 degrees from a model node
        $nearest[] = [$distance2, $point['value']];
    }
    if (!$nearest) return null;
    usort($nearest, static fn(array $a, array $b): int => $a[0] <=> $b[0]);
    $weightedValue = 0.0; $weightTotal = 0.0;
    foreach (array_slice($nearest, 0, 4) as [$distance2, $value]) {
        $weight = 1 / $distance2;
        $weightedValue += $value * $weight;
        $weightTotal += $weight;
    }
    return $weightTotal > 0 ? $weightedValue / $weightTotal : null;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    windError(405, 'Nur GET ist erlaubt.');
}
$west = filter_var($_GET['w'] ?? null, FILTER_VALIDATE_FLOAT);
$south = filter_var($_GET['s'] ?? null, FILTER_VALIDATE_FLOAT);
$east = filter_var($_GET['e'] ?? null, FILTER_VALIDATE_FLOAT);
$north = filter_var($_GET['n'] ?? null, FILTER_VALIDATE_FLOAT);
if ($west === false || $south === false || $east === false || $north === false || $west >= $east || $south >= $north
    || $west < -180 || $east > 180 || $south < -85 || $north > 85) windError(400, 'Ungültiger Kartenausschnitt.');
$west = max(-180.0, $west); $east = min(180.0, $east); $south = max(-90.0, $south); $north = min(90.0, $north);
if ($west >= $east || $south >= $north) windError(422, 'ICON deckt diesen Kartenausschnitt nicht ab.');
$viewWidth = $east - $west;
$viewHeight = $north - $south;
if ($viewWidth > 80 || $viewHeight > 35 || $viewWidth * $viewHeight > 2500) {
    windError(422, 'Der Kartenausschnitt ist für die Windberechnung noch zu groß. Bitte etwas näher heranzoomen.');
}
$longitudeScale = max(0.2, cos(deg2rad(($south + $north) / 2)));
$aspectRatio = ($viewWidth * $longitudeScale) / max(0.1, $viewHeight);
$cols = max(12, min(32, (int)round(sqrt(300 * $aspectRatio))));
$rows = max(8, min(24, (int)round(300 / $cols)));
$cacheDir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'geocaching-icon-wind';
if (!is_dir($cacheDir) && !@mkdir($cacheDir, 0770, true) && !is_dir($cacheDir)) windError(500, 'Winddaten-Cache kann nicht angelegt werden.');
foreach (glob($cacheDir . '/*') ?: [] as $cacheFile) {
    if (is_file($cacheFile) && @filemtime($cacheFile) < time() - 3 * 86400) @unlink($cacheFile);
}

try {
    $wgrib2 = windExecutable(['/usr/local/bin/wgrib2', '/usr/bin/wgrib2']);
    $bzip2 = windExecutable(['/usr/bin/bzip2', '/usr/local/bin/bzip2']);
    if ($wgrib2 === null || $bzip2 === null) throw new RuntimeException('Für die Windebene werden die Programme wgrib2 und bzip2 benötigt.');
    define('WIND_WGRIB2', $wgrib2);
    define('WIND_BZIP2', $bzip2);
    $bboxKey = implode(',', array_map(static fn(float $value): string => number_format($value, 5, '.', ''), [$west, $south, $east, $north]));
    $nextStep = (intdiv(time(), 3600) + 1) * 3600;
    $modelErrors = [];
    $modelOrder = ($viewWidth > 25 || $viewHeight > 20) ? ['icon'] : ['icon-eu', 'icon'];
    foreach ($modelOrder as $model) {
        try {
            $frame = windFindFrame(time(), $cacheDir, $model);
            $responseCache = "$cacheDir/response_{$model}_v5_{$frame['run']}_{$frame['step']}" . md5($bboxKey) . '.json';
            if (is_file($responseCache) && filemtime($responseCache) >= $nextStep - 3600) {
                header('Content-Type: application/json; charset=utf-8');
                header('Cache-Control: public, max-age=' . max(1, $nextStep - time()) . ', stale-while-revalidate=1800');
                readfile($responseCache);
                exit;
            }
            $base = "https://opendata.dwd.de/weather/nwp/$model/grib";
            $runHour = substr($frame['run'], 8, 2);
            $uPath = "$cacheDir/{$model}_{$frame['run']}_{$frame['step']}_u.grb2";
            $vPath = "$cacheDir/{$model}_{$frame['run']}_{$frame['step']}_v.grb2";
            windDownloadAndInflate("$base/$runHour/u_10m/{$frame['u']}", $uPath);
            windDownloadAndInflate("$base/$runHour/v_10m/{$frame['v']}", $vPath);
            $uSource = $uPath; $vSource = $vPath;
            if ($model === 'icon') {
                [$clatName, $clonName] = windFindIconGridCoordinateFiles($base, (int)$runHour, $cacheDir);
                $gridDate = preg_match('/_(\d{10})_CLAT/', $clatName, $gridDateMatch) ? $gridDateMatch[1] : 'latest';
                $clatPath = "$cacheDir/icon_grid_{$gridDate}_clat.grb2";
                $clonPath = "$cacheDir/icon_grid_{$gridDate}_clon.grb2";
                windDownloadAndInflate("$base/$runHour/clat/$clatName", $clatPath);
                windDownloadAndInflate("$base/$runHour/clon/$clonName", $clonPath);
                $uSource = windMergeIconGridCoordinates([$clatPath, $clonPath, $uPath], "$cacheDir/icon_{$frame['run']}_{$frame['step']}_u_geo.grb2");
                $vSource = windMergeIconGridCoordinates([$clatPath, $clonPath, $vPath], "$cacheDir/icon_{$frame['run']}_{$frame['step']}_v_geo.grb2");
            }
            $uPoints = windCsv($uSource, $west, $east, $south, $north, $cacheDir, "{$model}_u", $model, $cols, $rows);
            $vPoints = windCsv($vSource, $west, $east, $south, $north, $cacheDir, "{$model}_v", $model, $cols, $rows);
            if (!$uPoints || !$vPoints) throw new RuntimeException("Im Ausschnitt sind keine $model-Windwerte vorhanden.");
            $values = [];
            for ($row = 0; $row < $rows; $row++) {
                $lat = $rows === 1 ? ($south + $north) / 2 : $north - ($north - $south) * $row / ($rows - 1);
                for ($col = 0; $col < $cols; $col++) {
                    $lon = $cols === 1 ? ($west + $east) / 2 : $west + ($east - $west) * $col / ($cols - 1);
                    $u = windInterpolate($uPoints, $lon, $lat);
                    $v = windInterpolate($vPoints, $lon, $lat);
                    if ($u === null || $v === null) continue;
                    $speed = hypot($u, $v);
                    $values[] = ['lat' => $lat, 'lon' => $lon, 'u' => $u, 'v' => $v, 'speed' => $speed, 'bearing' => fmod(rad2deg(atan2($u, $v)) + 360, 360)];
                }
            }
            if (count($values) !== $cols * $rows) {
                throw new RuntimeException(sprintf(
                    'Winddaten decken den Kartenausschnitt nur teilweise ab (%d von %d Punkten).',
                    count($values), $cols * $rows
                ));
            }
            $modelLabel = $model === 'icon-eu' ? 'DWD ICON-EU' : 'DWD ICON (13 km)';
            $json = json_encode([
                'success' => true, 'model' => $modelLabel, 'run' => $frame['run'], 'forecastHour' => (int)$frame['step'],
                'validTime' => gmdate('c', $frame['valid']), 'grid' => ['cols' => $cols, 'rows' => $rows], 'units' => 'm/s', 'points' => $values,
            ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
            if (!is_string($json)) throw new RuntimeException('Winddaten konnten nicht als JSON gespeichert werden.');
            file_put_contents($responseCache . '.part', $json, LOCK_EX);
            rename($responseCache . '.part', $responseCache);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: public, max-age=' . max(1, $nextStep - time()) . ', stale-while-revalidate=1800');
            echo $json;
            exit;
        } catch (Throwable $modelError) {
            $modelErrors[] = $model . ': ' . $modelError->getMessage();
            error_log("GeocacheMap $model wind: " . $modelError->getMessage());
        }
    }
    throw new RuntimeException(implode(' | ', $modelErrors));
} catch (Throwable $error) {
    error_log('GeocacheMap wind: ' . $error->getMessage());
    windError(502, 'Winddaten aus ICON-EU und ICON 13 konnten nicht geladen werden: ' . $error->getMessage());
}
