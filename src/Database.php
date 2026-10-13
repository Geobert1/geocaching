<?php
declare(strict_types=1);

class Database
{
    private PDO $pdo;

    public function __construct(string $dbFile)
    {
        $dir = dirname($dbFile);
        if (!is_dir($dir)) {
            mkdir($dir, 0750, true);
        }

        $this->pdo = new PDO('sqlite:' . $dbFile, options: [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);

        $this->pdo->exec('PRAGMA journal_mode=WAL');
        $this->pdo->exec('PRAGMA foreign_keys=ON');
        $this->initSchema();
    }

    private function initSchema(): void
    {
        $this->pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS caches (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                gc_code          TEXT UNIQUE NOT NULL,
                reference_code   TEXT,
                name             TEXT NOT NULL,
                cache_type       INTEGER DEFAULT 2,
                cache_type_name  TEXT,
                difficulty       REAL DEFAULT 1.0,
                terrain          REAL DEFAULT 1.0,
                container_size   TEXT,
                status           TEXT DEFAULT 'active',
                lat              REAL NOT NULL,
                lng              REAL NOT NULL,
                owner            TEXT,
                placed_date      TEXT,
                last_found_date  TEXT,
                short_description TEXT,
                encoded_hints    TEXT,
                favorite_points  INTEGER DEFAULT 0,
                premium_only     INTEGER DEFAULT 0,
                last_synced      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                raw_json         TEXT
            );

            CREATE TABLE IF NOT EXISTS logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                gc_code     TEXT NOT NULL,
                log_type    TEXT,
                log_date    TEXT,
                finder_name TEXT,
                log_text    TEXT,
                FOREIGN KEY (gc_code) REFERENCES caches(gc_code) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sync_log (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                min_lat   REAL NOT NULL,
                min_lng   REAL NOT NULL,
                max_lat   REAL NOT NULL,
                max_lng   REAL NOT NULL,
                synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS waypoints (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                lat        REAL NOT NULL,
                lng        REAL NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS saved_routes (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                points_json TEXT NOT NULL,
                roundtrip  INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS cache_coordinate_overrides (
                gc_code   TEXT PRIMARY KEY,
                lat       REAL NOT NULL,
                lng       REAL NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (gc_code) REFERENCES caches(gc_code) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_caches_coords   ON caches(lat, lng);
            CREATE INDEX IF NOT EXISTS idx_caches_synced   ON caches(last_synced);
            CREATE INDEX IF NOT EXISTS idx_logs_gc_code    ON logs(gc_code);
            CREATE INDEX IF NOT EXISTS idx_sync_log_time   ON sync_log(synced_at);
        SQL);

        foreach ([
            "ALTER TABLE caches ADD COLUMN found_by_user INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE caches ADD COLUMN found_date TEXT",
            "ALTER TABLE caches ADD COLUMN long_description TEXT",
            "ALTER TABLE saved_routes ADD COLUMN roundtrip INTEGER NOT NULL DEFAULT 0",
        ] as $ddl) {
            try { $this->pdo->exec($ddl); } catch (\PDOException) { /* column already exists */ }
        }
    }

    // ── Area coverage check ────────────────────────────────────────────────────

    /**
     * Prüft ob der angeforderte Bereich vollständig durch einen früheren Sync abgedeckt ist.
     * Gibt false zurück sobald auch nur ein Teil der Area neu ist — dann wird die API aufgerufen.
     */
    public function isAreaCovered(array $p, int $maxAgeHours): bool
    {
        [$minLat, $minLng, $maxLat, $maxLng] = $this->toBBox($p);
        $threshold = date('Y-m-d H:i:s', strtotime("-{$maxAgeHours} hours"));

        $stmt = $this->pdo->prepare("
            SELECT COUNT(*) FROM sync_log
            WHERE min_lat <= :minLat AND max_lat >= :maxLat
              AND min_lng <= :minLng AND max_lng >= :maxLng
              AND synced_at >= :ts
        ");
        $stmt->execute([
            'minLat' => $minLat, 'maxLat' => $maxLat,
            'minLng' => $minLng, 'maxLng' => $maxLng,
            'ts'     => $threshold,
        ]);
        return (int)$stmt->fetchColumn() > 0;
    }

    /** Speichert eine erfolgreich synchronisierte Area im Log. */
    public function logSyncArea(array $p): void
    {
        [$minLat, $minLng, $maxLat, $maxLng] = $this->toBBox($p);
        $this->pdo->prepare("
            INSERT INTO sync_log (min_lat, min_lng, max_lat, max_lng)
            VALUES (:minLat, :minLng, :maxLat, :maxLng)
        ")->execute(['minLat' => $minLat, 'minLng' => $minLng,
                     'maxLat' => $maxLat, 'maxLng' => $maxLng]);
    }

    /** Bereinigt veraltete Sync-Log-Einträge. */
    public function cleanSyncLog(int $maxAgeHours): void
    {
        $threshold = date('Y-m-d H:i:s', strtotime("-{$maxAgeHours} hours"));
        $this->pdo->prepare("DELETE FROM sync_log WHERE synced_at < :ts")
                  ->execute(['ts' => $threshold]);
    }

    private function toBBox(array $p): array
    {
        if ($p['mode'] === 'circle') {
            $latD = $p['radius'] / 111_000;
            $lngD = $p['radius'] / (111_000 * cos(deg2rad($p['lat'])));
            return [$p['lat'] - $latD, $p['lng'] - $lngD,
                    $p['lat'] + $latD, $p['lng'] + $lngD];
        }
        return [$p['minLat'], $p['minLng'], $p['maxLat'], $p['maxLng']];
    }

    // ── Found-by-user ─────────────────────────────────────────────────────────

    /** Seconds since last global found-sync, or null if never run. */
    public function foundSyncAge(): ?int
    {
        $stmt = $this->pdo->prepare("SELECT value FROM settings WHERE key = 'found_synced_at'");
        $stmt->execute();
        $ts = $stmt->fetchColumn();
        return $ts ? (int)(time() - strtotime($ts)) : null;
    }

    public function logFoundSync(): void
    {
        $this->pdo->prepare(
            "INSERT INTO settings (key, value) VALUES ('found_synced_at', CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )->execute();
    }

    public function updateCacheDetails(string $gcCode, ?string $shortDescription, ?string $longDescription, ?string $encodedHints): void
    {
        $this->pdo->prepare(
            "UPDATE caches SET short_description = :sd, long_description = :ld, encoded_hints = :eh WHERE gc_code = :gc"
        )->execute(['sd' => $shortDescription, 'ld' => $longDescription, 'eh' => $encodedHints, 'gc' => $gcCode]);
    }

    public function clearAllFoundStatuses(): void
    {
        $this->pdo->exec("UPDATE caches SET found_by_user = 0, found_date = NULL");
    }

    public function setFoundStatus(string $gcCode, ?string $foundDate): void
    {
        $this->pdo->prepare(
            "UPDATE caches SET found_by_user = 1, found_date = :d WHERE gc_code = :gc"
        )->execute(['d' => $foundDate, 'gc' => $gcCode]);
    }

    // ── Write ──────────────────────────────────────────────────────────────────

    public function upsertCache(array $c): void
    {
        $this->pdo->prepare(<<<SQL
            INSERT INTO caches (
                gc_code, reference_code, name, cache_type, cache_type_name,
                difficulty, terrain, container_size, status,
                lat, lng, owner, placed_date, last_found_date,
                short_description, encoded_hints, favorite_points,
                premium_only, last_synced, raw_json
            ) VALUES (
                :gc_code, :reference_code, :name, :cache_type, :cache_type_name,
                :difficulty, :terrain, :container_size, :status,
                :lat, :lng, :owner, :placed_date, :last_found_date,
                :short_description, :encoded_hints, :favorite_points,
                :premium_only, CURRENT_TIMESTAMP, :raw_json
            )
            ON CONFLICT(gc_code) DO UPDATE SET
                reference_code    = excluded.reference_code,
                name              = excluded.name,
                cache_type        = excluded.cache_type,
                cache_type_name   = excluded.cache_type_name,
                difficulty        = excluded.difficulty,
                terrain           = excluded.terrain,
                container_size    = excluded.container_size,
                status            = excluded.status,
                lat               = excluded.lat,
                lng               = excluded.lng,
                owner             = excluded.owner,
                placed_date       = excluded.placed_date,
                last_found_date   = excluded.last_found_date,
                short_description = excluded.short_description,
                encoded_hints     = excluded.encoded_hints,
                favorite_points   = excluded.favorite_points,
                premium_only      = excluded.premium_only,
                last_synced       = CURRENT_TIMESTAMP,
                raw_json          = excluded.raw_json
        SQL)->execute($c);
    }

    public function deleteLogsForCache(string $gcCode): void
    {
        $this->pdo->prepare('DELETE FROM logs WHERE gc_code = ?')->execute([$gcCode]);
    }

    public function insertLog(string $gcCode, array $log): void
    {
        $this->pdo->prepare(<<<SQL
            INSERT INTO logs (gc_code, log_type, log_date, finder_name, log_text)
            VALUES (:gc_code, :log_type, :log_date, :finder_name, :log_text)
        SQL)->execute([
            'gc_code'     => $gcCode,
            'log_type'    => $log['log_type']    ?? null,
            'log_date'    => $log['log_date']    ?? null,
            'finder_name' => $log['finder_name'] ?? null,
            'log_text'    => $log['log_text']    ?? null,
        ]);
    }

    // ── Read ───────────────────────────────────────────────────────────────────

    public function getCachesInBBox(float $s, float $w, float $n, float $e): array
    {
        $stmt = $this->pdo->prepare(<<<SQL
            SELECT c.gc_code, c.name, c.cache_type, c.cache_type_name, c.difficulty, c.terrain,
                   c.container_size, c.status,
                   COALESCE(o.lat, c.lat) AS lat, COALESCE(o.lng, c.lng) AS lng,
                   c.lat AS original_lat, c.lng AS original_lng,
                   CASE WHEN o.gc_code IS NULL THEN 0 ELSE 1 END AS coordinates_overridden,
                   c.owner, c.placed_date, c.last_found_date, c.favorite_points, c.premium_only,
                   c.last_synced, c.found_by_user, c.found_date
            FROM caches c LEFT JOIN cache_coordinate_overrides o ON o.gc_code = c.gc_code
            WHERE CAST(COALESCE(o.lat, c.lat) AS REAL) BETWEEN CAST(:s AS REAL) AND CAST(:n AS REAL)
              AND CAST(COALESCE(o.lng, c.lng) AS REAL) BETWEEN CAST(:w AS REAL) AND CAST(:e AS REAL)
            ORDER BY c.name
        SQL);
        $stmt->execute(['s' => $s, 'n' => $n, 'w' => $w, 'e' => $e]);
        return $stmt->fetchAll();
    }

    public function getAllCaches(): array
    {
        return $this->pdo->query(<<<SQL
            SELECT c.gc_code, c.name, c.cache_type, c.cache_type_name, c.difficulty, c.terrain,
                   c.container_size, c.status,
                   COALESCE(o.lat, c.lat) AS lat, COALESCE(o.lng, c.lng) AS lng,
                   c.lat AS original_lat, c.lng AS original_lng,
                   CASE WHEN o.gc_code IS NULL THEN 0 ELSE 1 END AS coordinates_overridden,
                   c.owner, c.placed_date, c.last_found_date, c.favorite_points, c.premium_only,
                   c.last_synced, c.found_by_user, c.found_date
            FROM caches c LEFT JOIN cache_coordinate_overrides o ON o.gc_code = c.gc_code
            ORDER BY c.name
        SQL)->fetchAll();
    }

    public function searchCaches(string $query): array
    {
        $stmt = $this->pdo->prepare(<<<SQL
            SELECT c.gc_code, c.name, c.cache_type, c.cache_type_name, c.difficulty, c.terrain,
                   c.container_size, c.status,
                   COALESCE(o.lat, c.lat) AS lat, COALESCE(o.lng, c.lng) AS lng,
                   c.lat AS original_lat, c.lng AS original_lng,
                   CASE WHEN o.gc_code IS NULL THEN 0 ELSE 1 END AS coordinates_overridden,
                   c.owner, c.placed_date, c.last_found_date, c.favorite_points, c.premium_only,
                   c.last_synced, c.found_by_user, c.found_date
            FROM caches c LEFT JOIN cache_coordinate_overrides o ON o.gc_code = c.gc_code
            WHERE c.name LIKE :query COLLATE NOCASE OR c.gc_code LIKE :query COLLATE NOCASE
            ORDER BY c.name
        SQL);
        $stmt->execute(['query' => '%' . $query . '%']);
        return $stmt->fetchAll();
    }

    public function getWaypoints(): array
    {
        return $this->pdo->query("SELECT id, name, lat, lng, created_at,
            CASE WHEN id = (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'home_waypoint_id') THEN 1 ELSE 0 END AS is_home
            FROM waypoints ORDER BY name COLLATE NOCASE, id")->fetchAll();
    }

    public function setHomeWaypoint(?int $id): bool
    {
        if ($id === null) {
            $stmt = $this->pdo->prepare("DELETE FROM settings WHERE key = 'home_waypoint_id'");
            $stmt->execute();
            return true;
        }
        $check = $this->pdo->prepare('SELECT id FROM waypoints WHERE id = ?');
        $check->execute([$id]);
        if (!$check->fetchColumn()) return false;
        $stmt = $this->pdo->prepare("INSERT INTO settings (key, value) VALUES ('home_waypoint_id', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        $stmt->execute([(string)$id]);
        return true;
    }

    public function createWaypoint(string $name, float $lat, float $lng): array
    {
        $stmt = $this->pdo->prepare('INSERT INTO waypoints (name, lat, lng) VALUES (?, ?, ?)');
        $stmt->execute([$name, $lat, $lng]);
        $id = (int)$this->pdo->lastInsertId();
        $stmt = $this->pdo->prepare('SELECT id, name, lat, lng, created_at FROM waypoints WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function deleteWaypoint(int $id): bool
    {
        $stmt = $this->pdo->prepare("DELETE FROM settings WHERE key = 'home_waypoint_id' AND value = ?");
        $stmt->execute([(string)$id]);
        $stmt = $this->pdo->prepare('DELETE FROM waypoints WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    public function getSavedRoutes(): array
    {
        $routes = $this->pdo->query('SELECT id, name, points_json, roundtrip, created_at, updated_at FROM saved_routes ORDER BY name COLLATE NOCASE, id')->fetchAll();
        foreach ($routes as &$route) {
            $route['id'] = (int)$route['id'];
            $route['roundtrip'] = (bool)$route['roundtrip'];
            $route['points'] = json_decode($route['points_json'], true) ?: [];
            unset($route['points_json']);
        }
        return $routes;
    }

    public function saveRoute(string $name, array $points, bool $roundtrip = false, ?int $id = null): array
    {
        $pointsJson = json_encode($points, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if ($id !== null) {
            $stmt = $this->pdo->prepare('UPDATE saved_routes SET name = ?, points_json = ?, roundtrip = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
            $stmt->execute([$name, $pointsJson, (int)$roundtrip, $id]);
            if ($stmt->rowCount() === 0) {
                $check = $this->pdo->prepare('SELECT id FROM saved_routes WHERE id = ?');
                $check->execute([$id]);
                if (!$check->fetchColumn()) return [];
            }
            $routeId = $id;
        } else {
            $stmt = $this->pdo->prepare('INSERT INTO saved_routes (name, points_json, roundtrip) VALUES (?, ?, ?)');
            $stmt->execute([$name, $pointsJson, (int)$roundtrip]);
            $routeId = (int)$this->pdo->lastInsertId();
        }
        $stmt = $this->pdo->prepare('SELECT id, name, points_json, roundtrip, created_at, updated_at FROM saved_routes WHERE id = ?');
        $stmt->execute([$routeId]);
        $route = $stmt->fetch();
        $route['id'] = (int)$route['id'];
        $route['roundtrip'] = (bool)$route['roundtrip'];
        $route['points'] = json_decode($route['points_json'], true) ?: [];
        unset($route['points_json']);
        return $route;
    }

    public function deleteSavedRoute(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM saved_routes WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    public function getCacheDetail(string $gcCode): ?array
    {
        $stmt = $this->pdo->prepare(<<<SQL
            SELECT c.*, COALESCE(o.lat, c.lat) AS effective_lat,
                   COALESCE(o.lng, c.lng) AS effective_lng,
                   CASE WHEN o.gc_code IS NULL THEN 0 ELSE 1 END AS coordinates_overridden
            FROM caches c LEFT JOIN cache_coordinate_overrides o ON o.gc_code = c.gc_code
            WHERE c.gc_code = ?
        SQL);
        $stmt->execute([$gcCode]);
        $cache = $stmt->fetch();
        if (!$cache) return null;
        $cache['original_lat'] = $cache['lat'];
        $cache['original_lng'] = $cache['lng'];
        $cache['lat'] = $cache['effective_lat'];
        $cache['lng'] = $cache['effective_lng'];
        unset($cache['effective_lat'], $cache['effective_lng']);

        $logStmt = $this->pdo->prepare(
            'SELECT * FROM logs WHERE gc_code = ? ORDER BY log_date DESC LIMIT 10'
        );
        $logStmt->execute([$gcCode]);
        $cache['logs'] = $logStmt->fetchAll();

        return $cache;
    }

    public function setCacheCoordinateOverride(string $gcCode, float $lat, float $lng): bool
    {
        $stmt = $this->pdo->prepare(<<<SQL
            INSERT INTO cache_coordinate_overrides (gc_code, lat, lng, updated_at)
            SELECT gc_code, :lat, :lng, CURRENT_TIMESTAMP
            FROM caches WHERE gc_code = :gc_code AND cache_type = 8
            ON CONFLICT(gc_code) DO UPDATE SET lat = excluded.lat, lng = excluded.lng,
                updated_at = CURRENT_TIMESTAMP
        SQL);
        $stmt->execute(['lat' => $lat, 'lng' => $lng, 'gc_code' => $gcCode]);
        return $stmt->rowCount() > 0;
    }

    public function restoreCacheCoordinates(string $gcCode): bool
    {
        $stmt = $this->pdo->prepare(<<<SQL
            DELETE FROM cache_coordinate_overrides
            WHERE gc_code = :gc_code AND EXISTS (
                SELECT 1 FROM caches WHERE gc_code = :gc_code AND cache_type = 8
            )
        SQL);
        $stmt->execute(['gc_code' => $gcCode]);
        return $stmt->rowCount() > 0;
    }

    public function hasRecentLogs(string $gcCode, int $maxAgeHours = 24): bool
    {
        $threshold = date('Y-m-d H:i:s', strtotime("-{$maxAgeHours} hours"));
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) FROM logs l
             JOIN caches c ON c.gc_code = l.gc_code
             WHERE l.gc_code = ? AND c.last_synced >= ?'
        );
        $stmt->execute([$gcCode, $threshold]);
        return (int)$stmt->fetchColumn() > 0;
    }

    public function getStats(): array
    {
        return $this->pdo->query(<<<SQL
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'active'   THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN status = 'disabled'  THEN 1 ELSE 0 END) as disabled,
                SUM(CASE WHEN status = 'archived'  THEN 1 ELSE 0 END) as archived,
                MAX(last_synced) as last_sync
            FROM caches
        SQL)->fetch();
    }
}
