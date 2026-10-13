<?php
declare(strict_types=1);

class GeocachingClient
{
    private const BASE     = 'https://www.geocaching.com';
    private const UA       = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    private const TIMEOUT  = 30;

    private string $cookieFile;
    private string $username;
    private string $password;
    private ?string $cookieOverride;

    public function __construct(array $config, string $cookieFile)
    {
        $this->username       = $config['gc_username']      ?? '';
        $this->password       = $config['gc_password']      ?? '';
        $this->cookieOverride = $config['gc_cookie_override'] ?? null;
        $this->cookieFile     = $cookieFile;

        $dir = dirname($cookieFile);
        if (!is_dir($dir)) {
            mkdir($dir, 0750, true);
        }
    }

    // ── HTTP primitives ────────────────────────────────────────────────────────

    private function curl(string $url, array $extra = []): array
    {
        $ch = curl_init();

        $defaults = [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 10,
            CURLOPT_COOKIEFILE     => $this->cookieFile,
            CURLOPT_COOKIEJAR      => $this->cookieFile,
            CURLOPT_USERAGENT      => self::UA,
            CURLOPT_TIMEOUT        => self::TIMEOUT,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_ENCODING       => '',       // auto-accept gzip/br
        ];

        curl_setopt_array($ch, $extra + $defaults);

        $body  = curl_exec($ch);
        $code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $final = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $err   = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new RuntimeException("cURL-Fehler: $err");
        }

        return ['body' => $body, 'status' => $code, 'url' => $final];
    }

    private function get(string $url, array $headers = []): array
    {
        $opts = $headers ? [CURLOPT_HTTPHEADER => $headers] : [];
        return $this->curl($url, $opts);
    }

    private function post(string $url, array $fields, array $headers = []): array
    {
        return $this->curl($url, [
            CURLOPT_POST       => true,
            CURLOPT_POSTFIELDS => http_build_query($fields),
            CURLOPT_HTTPHEADER => array_merge(
                ['Content-Type: application/x-www-form-urlencoded'],
                $headers
            ),
        ]);
    }

    // ── Auth ───────────────────────────────────────────────────────────────────

    private function hasCookies(): bool
    {
        if (!file_exists($this->cookieFile)) return false;
        $c = file_get_contents($this->cookieFile);
        // Any of the well-known geocaching session tokens
        return str_contains($c, 'gspkauth')
            || str_contains($c, '.ASPXAUTH')
            || str_contains($c, 'LoggedIn');
    }

    public function login(): bool
    {
        // If caller provided raw cookies, write them as a Netscape jar and skip auth flow
        if ($this->cookieOverride) {
            $jar = "# Netscape HTTP Cookie File\n";
            foreach (explode(';', $this->cookieOverride) as $pair) {
                [$name, $value] = array_map('trim', explode('=', trim($pair), 2));
                $jar .= implode("\t", [
                    '.geocaching.com', 'TRUE', '/', 'TRUE', '2147483647', $name, $value,
                ]) . "\n";
            }
            file_put_contents($this->cookieFile, $jar);
            return true;
        }

        // Step 1 – fetch the sign-in page (follows any OAuth redirects)
        $r    = $this->get(self::BASE . '/account/signin', [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: de-DE,de;q=0.9,en;q=0.8',
        ]);
        $html = $r['body'];
        $page = $r['url'];

        // Step 2 – extract form action + hidden fields
        $action = $page;
        if (preg_match('/<form[^>]+action=["\']([^"\']+)["\'][^>]*>/i', $html, $m)) {
            $action = html_entity_decode($m[1]);
        }
        if (!str_starts_with($action, 'http')) {
            $p      = parse_url($page);
            $action = $p['scheme'] . '://' . $p['host'] . '/' . ltrim($action, '/');
        }

        // Hidden fields (CSRF tokens etc.)
        $fields = [];
        preg_match_all('/<input[^>]+type=["\']hidden["\'][^>]*>/i', $html, $inputs);
        foreach ($inputs[0] as $tag) {
            $name = $value = '';
            if (preg_match('/name=["\']([^"\']+)["\']/', $tag, $nm)) $name  = $nm[1];
            if (preg_match('/value=["\']([^"\']*)["\']/', $tag, $vl)) $value = html_entity_decode($vl[1]);
            if ($name) $fields[$name] = $value;
        }

        // Credentials – geocaching.com accepts both field name variants
        $fields['Username']        = $this->username;
        $fields['Password']        = $this->password;
        $fields['UsernameOrEmail'] = $this->username;

        // Step 3 – POST
        $r = $this->post($action, $fields, [
            'Referer: ' . $page,
            'Origin: ' . parse_url($page, PHP_URL_SCHEME) . '://' . parse_url($page, PHP_URL_HOST),
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ]);

        // Step 4 – verify: final URL should be on geocaching.com, not on a login page
        $final = $r['url'];
        if (
            str_contains($final, 'geocaching.com') &&
            !str_contains($final, '/account/signin') &&
            !str_contains($final, 'id.geocaching.com/login')
        ) {
            return true;
        }

        if ($this->hasCookies()) return true;

        // Fallback: probe the dashboard
        $probe = $this->get(self::BASE . '/my/default.aspx');
        return !str_contains($probe['url'], 'login') && !str_contains($probe['url'], 'signin');
    }

    public function ensureLoggedIn(): void
    {
        if ($this->hasCookies()) return;
        if (!$this->login()) {
            throw new RuntimeException(
                'Login bei geocaching.com fehlgeschlagen. '
                . 'Bitte Zugangsdaten in config/credentials.php prüfen '
                . 'oder gc_cookie_override setzen.'
            );
        }
    }

    public function logout(): void
    {
        if (file_exists($this->cookieFile)) {
            unlink($this->cookieFile);
        }
    }

    // ── Search ─────────────────────────────────────────────────────────────────

    public function searchByCircle(float $lat, float $lng, int $radiusMeters, int $take = 200): array
    {
        $this->ensureLoggedIn();

        $url = self::BASE . '/api/proxy/web/search/v2?' . http_build_query([
            'lat'  => number_format($lat, 6, '.', ''),
            'lng'  => number_format($lng, 6, '.', ''),
            'rad'  => $radiusMeters,
            'skip' => 0,
            'take' => min($take, 200),
            'sort' => 'distance',
            'asc'  => 'true',
        ]);

        return $this->fetchSearch($url);
    }

    public function searchByBBox(float $s, float $w, float $n, float $e, int $take = 200): array
    {
        $this->ensureLoggedIn();

        $url = self::BASE . '/api/proxy/web/search/v2?' . http_build_query([
            'box'  => number_format($n, 6, '.', '') . ',' .
                      number_format($w, 6, '.', '') . ',' .
                      number_format($s, 6, '.', '') . ',' .
                      number_format($e, 6, '.', ''),
            'skip' => 0,
            'take' => min($take, 200),
            'sort' => 'distance',
            'asc'  => 'true',
        ]);

        return $this->fetchSearch($url);
    }

    private function fetchSearch(string $url): array
    {
        $r = $this->get($url, [
            'Accept: application/json',
            'X-Requested-With: XMLHttpRequest',
            'Referer: ' . self::BASE . '/play/map',
        ]);

        if ($r['status'] === 401) {
            $this->logout();
            $this->ensureLoggedIn();
            $r = $this->get($url, [
                'Accept: application/json',
                'X-Requested-With: XMLHttpRequest',
                'Referer: ' . self::BASE . '/play/map',
            ]);
        }

        if ($r['status'] !== 200) {
            throw new RuntimeException(
                'Such-API-Fehler HTTP ' . $r['status'] . "\n" . substr($r['body'], 0, 300)
            );
        }

        $data = json_decode($r['body'], true);
        if (!isset($data['results'])) {
            throw new RuntimeException(
                'Unerwartetes API-Format: ' . substr($r['body'], 0, 300)
            );
        }

        return $data;
    }

    /**
     * Returns an array of ['gc_code' => 'GCxxxx', 'found_date' => 'YYYY-MM-DD'|null]
     * by scraping the user's "Found It" log list page.
     */
    public function getFoundCacheCodes(): array
    {
        $this->ensureLoggedIn();
        $r = $this->get(self::BASE . '/my/logs.aspx?s=1&lt=2', [
            'Accept: text/html',
        ]);
        if ($r['status'] !== 200) {
            throw new RuntimeException('Found-Log-Seite nicht abrufbar: HTTP ' . $r['status']);
        }

        $body = $r['body'];
        $results = [];

        // Each table row: date in first TD, GC code in href of second TD
        // Pattern: dd.MM.yyyy</td>...(up to next TR)...geocache/GCxxxx
        preg_match_all(
            '/(\d{2}\.\d{2}\.\d{4})\s*<\/td>.*?\/geocache\/(GC[A-Z0-9]+)/s',
            $body,
            $matches,
            PREG_SET_ORDER
        );

        foreach ($matches as $m) {
            [$d, $mo, $y] = explode('.', $m[1]);
            $results[] = [
                'gc_code'    => $m[2],
                'found_date' => "$y-$mo-$d",
            ];
        }

        // Fallback: extract GC codes only (when date pattern fails)
        if (empty($results)) {
            preg_match_all('/\/geocache\/(GC[A-Z0-9]+)/', $body, $fm);
            foreach (array_unique($fm[1]) as $gc) {
                $results[] = ['gc_code' => $gc, 'found_date' => null];
            }
        }

        return $results;
    }

    /**
     * Fetches the cache detail page from geocaching.com and extracts:
     * - encoded_hints  (ROT13-encoded hint)
     * - short_description (HTML, may be empty)
     * - log_totals     (array of ['name'=>'Found it','count'=>123,...])
     */
    public function getCacheWebData(string $gcCode): array
    {
        $this->ensureLoggedIn();
        $r = $this->get(self::BASE . '/geocache/' . strtoupper($gcCode), [
            'Accept: text/html',
            'Referer: ' . self::BASE . '/play/map',
        ]);
        if ($r['status'] !== 200) {
            throw new RuntimeException('Cache-Seite nicht abrufbar: HTTP ' . $r['status']);
        }
        $body = $r['body'];
        $result = ['encoded_hints' => null, 'short_description' => null, 'long_description' => null, 'log_totals' => []];

        // Parse HTML with DOMDocument for reliable extraction
        $doc = new \DOMDocument();
        @$doc->loadHTML('<?xml encoding="utf-8"?>' . $body, LIBXML_NOERROR | LIBXML_NOWARNING);
        $xpath = new \DOMXPath($doc);

        // Hint: use the LAST element matching "hint" in id — div_hint contains the ROT13 text,
        // while ctl00_ContentBody_hints (earlier in DOM) is just the section header.
        $hintNodes = $xpath->query('//*[contains(translate(@id,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"hint")]');
        for ($i = $hintNodes->length - 1; $i >= 0; $i--) {
            $text = trim(preg_replace('/\s+/', ' ', $hintNodes->item($i)->textContent));
            // Skip empty text and known "no hint" placeholders / section headers
            if ($text === '') continue;
            if (stripos($text, 'No hints available') !== false) break; // no hint — stop looking
            if (stripos($text, 'Additional Hints')   !== false) break; // section header only
            $result['encoded_hints'] = $text;
            break;
        }

        // Short and long description: <span id="...ShortDescription..."> / <span id="...LongDescription...">
        $sdNodes = $xpath->query('//*[contains(@id,"ShortDescription")]');
        if ($sdNodes->length > 0) {
            $html = self::innerHtml($doc, $sdNodes->item(0));
            if (trim(strip_tags($html)) !== '') $result['short_description'] = $html;
        }
        $ldNodes = $xpath->query('//*[contains(@id,"LongDescription")]');
        if ($ldNodes->length > 0) {
            $html = self::innerHtml($doc, $ldNodes->item(0));
            if (trim(strip_tags($html)) !== '') $result['long_description'] = $html;
        }

        // Log totals: window.logTotals = JSON.parse('[{\"logTypeID\":...}]')
        // Quotes inside the JS string are backslash-escaped; stripcslashes restores them.
        if (preg_match("/window\\.logTotals\\s*=\\s*JSON\\.parse\\('(.+?)'\\)\\s*;/s", $body, $ltm)) {
            $totals = json_decode(str_replace('\\"', '"', $ltm[1]), true);
            if (is_array($totals)) {
                $result['log_totals'] = array_map(fn($t) => [
                    'id'    => (int)($t['logTypeID'] ?? 0),
                    'name'  => $t['logTypeName'] ?? '',
                    'count' => (int)($t['count'] ?? 0),
                ], $totals);
            }
        }

        return $result;
    }

    /**
     * Returns ['dates' => [logTypeID => 'YYYY-MM-DD'], 'recent' => [...last 5 entries]]
     * Fetches geocache_logs.aspx for the session token, then queries the logbook endpoint.
     */
    public function getCacheLogData(string $gcCode): array
    {
        $this->ensureLoggedIn();
        $gcCode = strtoupper($gcCode);

        $r = $this->get(self::BASE . '/seek/geocache_logs.aspx?code=' . $gcCode, ['Accept: text/html']);
        if ($r['status'] !== 200) return ['dates' => [], 'recent' => []];
        if (!preg_match("/userToken\s*=\s*['\"]([^'\"]+)/", $r['body'], $m)) return ['dates' => [], 'recent' => []];
        $token = $m[1];

        $url = self::BASE . '/seek/geocache.logbook?' . http_build_query([
            'tkn' => $token, 'idx' => 1, 'num' => 50,
            'sp' => 'false', 'sf' => 'false', 'showOwnerOnly' => 'false', 'decrypt' => 'false',
        ]);
        $r2 = $this->get($url, [
            'Accept: application/json',
            'Referer: ' . self::BASE . '/seek/geocache_logs.aspx?code=' . $gcCode,
        ]);
        if ($r2['status'] !== 200) return ['dates' => [], 'recent' => []];

        $data   = json_decode($r2['body'], true);
        $entries = $data['data'] ?? [];

        $lastDates = [];
        $recent    = [];

        foreach ($entries as $entry) {
            $typeId  = (int)($entry['LogTypeID'] ?? 0);
            $visited = $entry['Visited'] ?? ($entry['LogDate'] ?? '');
            $isoDate = null;
            if (preg_match('/(\d{1,2})\.(\d{1,2})\.(\d{4})/', $visited, $dm)) {
                // d.M.yyyy or dd.MM.yyyy
                $isoDate = sprintf('%04d-%02d-%02d', $dm[3], $dm[2], $dm[1]);
            } elseif (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $visited, $dm)) {
                // yyyy-MM-dd (ISO 8601)
                $isoDate = "{$dm[1]}-{$dm[2]}-{$dm[3]}";
            } elseif (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})#', $visited, $dm)) {
                // M/d/yyyy (US format)
                $isoDate = sprintf('%04d-%02d-%02d', $dm[3], $dm[1], $dm[2]);
            }

            if ($typeId && !isset($lastDates[$typeId]) && $isoDate) {
                $lastDates[$typeId] = $isoDate;
            }

            if (count($recent) < 5) {
                $recent[] = [
                    'type_id'  => $typeId,
                    'type'     => $entry['LogType']  ?? '',
                    'date'     => $isoDate,
                    'user'     => $entry['UserName'] ?? '',
                    'text'     => strip_tags($entry['LogText'] ?? ''),
                    'fav'      => (bool)($entry['FavoritePointUsed'] ?? false),
                ];
            }
        }

        return ['dates' => $lastDates, 'recent' => $recent];
    }

    public function searchFoundInArea(array $areaParams, int $skip = 0, int $take = 200): array
    {
        $this->ensureLoggedIn();

        $params = ['found' => 'true', 'skip' => $skip, 'take' => min($take, 200)];

        if ($areaParams['mode'] === 'circle') {
            $params['lat'] = number_format($areaParams['lat'], 6, '.', '');
            $params['lng'] = number_format($areaParams['lng'], 6, '.', '');
            $params['rad'] = $areaParams['radius'];
        } else {
            $params['box'] = number_format($areaParams['maxLat'], 6, '.', '') . ',' .
                             number_format($areaParams['minLng'], 6, '.', '') . ',' .
                             number_format($areaParams['minLat'], 6, '.', '') . ',' .
                             number_format($areaParams['maxLng'], 6, '.', '');
        }

        $url = self::BASE . '/api/proxy/web/search/v2?' . http_build_query($params);
        return $this->fetchSearch($url);
    }

    // ── Logs ───────────────────────────────────────────────────────────────────

    public function getCacheLogs(string $referenceCode, int $take = 5): array
    {
        $this->ensureLoggedIn();

        $url = self::BASE . '/api/proxy/web/geocache/' . $referenceCode
             . '/geocachelogs?' . http_build_query(['skip' => 0, 'take' => $take]);

        $r = $this->get($url, [
            'Accept: application/json',
            'X-Requested-With: XMLHttpRequest',
            'Referer: ' . self::BASE . '/geocache/' . $referenceCode,
        ]);

        if ($r['status'] !== 200) return [];

        return json_decode($r['body'], true) ?? [];
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private static function innerHtml(\DOMDocument $doc, \DOMNode $node): string
    {
        $html = '';
        foreach ($node->childNodes as $child) {
            $html .= $doc->saveHTML($child);
        }
        return $html;
    }

    public static function mapStatus(int $s): string
    {
        return match ($s) { 0 => 'active', 1 => 'disabled', 2 => 'archived', default => 'active' };
    }

    public static function typeName(int $id): string
    {
        return match ($id) {
            2    => 'Traditional Cache',
            3    => 'Multi-Cache',
            4    => 'Virtual Cache',
            5    => 'Letterbox Hybrid',
            6    => 'Event Cache',
            8    => 'Mystery Cache',
            11   => 'Webcam Cache',
            13   => 'CITO Event',
            137  => 'EarthCache',
            453  => 'Mega-Event Cache',
            1304 => 'GPS Adventures',
            1858 => 'Wherigo Cache',
            3653 => 'Community Celebration',
            3773 => 'Geocaching HQ',
            default => 'Sonstig (' . $id . ')',
        };
    }

    public static function containerName(int|string $s): string
    {
        if (is_int($s)) {
            return match ($s) {
                1 => 'Nicht gewählt', 2 => 'Micro', 3 => 'Regular',
                4 => 'Large', 5 => 'Virtual', 6 => 'Andere', 8 => 'Small',
                default => 'Unbekannt',
            };
        }
        return $s;
    }
}
