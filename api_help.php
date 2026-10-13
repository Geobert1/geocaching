<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GeocacheMap – Hilfe</title>
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <link rel="stylesheet" href="assets/css/bootstrap.min.css">
  <style>
    body { font-size: .93rem; }
    h2   { font-size: 1.15rem; font-weight: 700; margin-top: 2rem; }
    h3   { font-size: .97rem; font-weight: 600; color: #374151; }
    pre  { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: .5rem; font-size: .82rem; }
    .method { font-family: monospace; font-weight: 600; }
    .get    { color: #22c55e; }
    .post   { color: #3b82f6; }
    .kbd    { display:inline-block; padding:.1em .45em; font-size:.85em; background:#f3f4f6;
              border:1px solid #d1d5db; border-radius:3px; font-family:monospace; }
    .section-anchor { scroll-margin-top: 70px; }
  </style>
</head>
<body class="bg-light">

<nav class="navbar navbar-dark bg-dark px-3 py-1 sticky-top">
  <a class="navbar-brand fw-bold" style="font-size:1rem;" href="/">🗺 GeocacheMap</a>
  <div class="ms-auto d-flex gap-3 small">
    <a href="#benutzung"   class="text-light text-decoration-none">Benutzung</a>
    <a href="#api"         class="text-light text-decoration-none">API</a>
    <a href="#konfiguration" class="text-light text-decoration-none">Konfiguration</a>
  </div>
</nav>

<div class="container py-4" style="max-width:860px;">

  <h1 class="h4 mb-1">GeocacheMap – Hilfe</h1>
  <p class="text-muted small mb-4">Lokale Geocaching-Karte mit Sync von geocaching.com</p>

  <!-- ══════════════════════════════════════════════════════════════ BENUTZUNG -->
  <h2 id="benutzung" class="section-anchor border-bottom pb-1">Benutzung</h2>

  <!-- Erste Schritte -->
  <h3 class="mt-3">Erste Schritte</h3>
  <ol>
    <li>Zugangsdaten in <code>config/credentials.php</code> hinterlegen (siehe <a href="#konfiguration">Konfiguration</a>).</li>
    <li>Karte auf den gewünschten Bereich navigieren.</li>
    <li>Sync-Menü öffnen (<strong>Sync</strong>-Button oben links), Modus wählen und <strong>Sync</strong> klicken.</li>
    <li>Caches erscheinen als farbige Pins auf der Karte.</li>
  </ol>

  <!-- Karte -->
  <h3 class="mt-3">Karte</h3>
  <table class="table table-sm table-bordered bg-white">
    <tbody>
      <tr><td style="width:36%"><strong>Zoomen</strong></td>
          <td>Mausrad · Doppelklick · Tasten <span class="kbd">+</span> / <span class="kbd">−</span></td></tr>
      <tr><td><strong>Bereich zoomen</strong></td>
          <td>Zoom-Box-Button ☐ aktivieren, dann auf der Karte ziehen</td></tr>
      <tr><td><strong>Cache-Details</strong></td>
          <td>Pin anklicken → rechte Sidebar öffnet sich</td></tr>
      <tr><td><strong>Clustering</strong></td>
          <td>Cluster-Button ⬤⬤ in der linken Spalte schaltet Marker-Bündelung ein/aus</td></tr>
    </tbody>
  </table>
  <p class="small text-muted">Die zuletzt geöffnete Kartenposition und alle Button-Zustände werden im Browser gespeichert und beim nächsten Besuch wiederhergestellt.</p>

  <!-- Marker-Farben -->
  <h3 class="mt-3">Marker-Farben</h3>
  <table class="table table-sm table-bordered bg-white">
    <tbody>
      <tr><td style="width:36%"><span style="color:#16a34a">●</span> <strong>Grün</strong></td><td>Von dir gefunden</td></tr>
      <tr><td><span style="color:#2563eb">●</span> <strong>Blau</strong></td><td>Traditional Cache</td></tr>
      <tr><td><span style="color:#9333ea">●</span> <strong>Lila</strong></td><td>Mystery / Unknown</td></tr>
      <tr><td><span style="color:#d97706">●</span> <strong>Orange</strong></td><td>Multi-Cache</td></tr>
      <tr><td><span style="color:#dc2626">●</span> <strong>Rot</strong></td><td>Andere Typen</td></tr>
      <tr><td><span style="color:#6b7280">●</span> <strong>Grau</strong></td><td>Deaktiviert / Archiviert</td></tr>
    </tbody>
  </table>

  <!-- Sync -->
  <h3 class="mt-3">Sync</h3>
  <p>Das Sync-Dropdown (Navbar) bietet drei Modi:</p>
  <table class="table table-sm table-bordered bg-white">
    <tbody>
      <tr><td style="width:28%"><strong>Kreis</strong></td><td>Caches im eingezeichneten Radius laden</td></tr>
      <tr><td><strong>Rechteck</strong></td><td>Caches in einem gezeichneten Begrenzungsrahmen laden</td></tr>
      <tr><td><strong>Karte</strong></td><td>Aktuellen Kartenausschnitt laden (kein Zeichnen nötig)</td></tr>
    </tbody>
  </table>
  <p><strong>Max-Alter:</strong> Caches, die jünger als der gewählte Wert sind, werden aus der lokalen DB geladen – kein neuer API-Request. <strong>Erzwingen</strong> umgeht diesen Cache.</p>

  <!-- Cache-Liste -->
  <h3 class="mt-3">Cache-Liste (linke Leiste)</h3>
  <p>☰-Button (linke Kartenspalte) öffnet/schließt die Cache-Liste. Die Liste zeigt alle aktuell geladenen Caches. Klick auf eine Zeile:</p>
  <ul>
    <li>Im <strong>Normal-Modus</strong>: Marker hervorheben, Cache anwählen (grauer → blauer Badge mit Reihenfolge).</li>
    <li>Im <strong>Route-Modus</strong>: Cache zur Route hinzufügen <em>und</em> Details im rechten Sidebar anzeigen.</li>
  </ul>

  <!-- Sidebar -->
  <h3 class="mt-3">Cache-Details (rechte Sidebar)</h3>
  <p>Öffnet sich beim Klick auf einen Marker oder eine Listenzeile. Zeigt:</p>
  <ul>
    <li>GC-Code, Name, Typ, Behältergröße, Status</li>
    <li>Schwierigkeit &amp; Geländewertung (Sterne)</li>
    <li>Owner, Versteck- und Funddaten, Favoritenpunkte, Koordinaten</li>
    <li>Kurzbeschreibung &amp; verschlüsselter Hinweis (ROT13-Decode-Button)</li>
  </ul>
  <p><strong>Vollständige Details</strong> öffnet das Modal mit langen Beschreibungen, allen Log-Statistiken und den letzten 5 Einträgen.</p>

  <!-- Route-Modus -->
  <h3 class="mt-3">Route-Modus</h3>
  <ol>
    <li><strong>Route</strong>-Button in der Navbar aktivieren (wird gelb).</li>
    <li>Caches durch Klick auf Marker oder Listenzeile zur Route hinzufügen.</li>
    <li>Optional <strong>Runde</strong> aktivieren (letzter → erster Cache).</li>
    <li><strong>Route (n)</strong> berechnen – Ergebnis mit Distanzangaben erscheint in der linken Liste.</li>
    <li>Zeilen in der Ergebnisliste sind klickbar und zeigen Details im rechten Sidebar.</li>
  </ol>
  <h4 class="mt-3 h6 fw-semibold">Routing-Dienst (OSRM)</h4>
  <p>Die Routenberechnung erfolgt clientseitig per <code>fetch()</code> direkt an den öffentlichen OSRM-Dienst <strong>osrm.oklabflensburg.de</strong> — ohne Umweg über das Backend.</p>
  <table class="table table-sm table-bordered small mb-2">
    <tbody>
      <tr><th style="width:9rem">Endpunkt</th><td><code>GET https://osrm.oklabflensburg.de/foot/route/v1/driving/{koordinaten}</code></td></tr>
      <tr><th>Koordinaten</th><td>Semikolon-separiert, je <code>lng,lat</code> — alle Wegpunkte in einem einzigen Request</td></tr>
      <tr><th>Parameter</th><td><code>overview=full</code> (vollständige Geometrie), <code>geometries=geojson</code></td></tr>
      <tr><th>Profil</th><td><code>foot</code> — Fußgänger-Routing inkl. Wege &amp; Feldwege</td></tr>
      <tr><th>Response</th><td><code>routes[0].geometry.coordinates</code> (LineString), <code>routes[0].legs[i].distance</code> (Meter je Etappe)</td></tr>
      <tr><th>CORS</th><td><code>Access-Control-Allow-Origin: *</code> — Browser-direktzugriff erlaubt</td></tr>
      <tr><th>Timeout</th><td>15 s (AbortController); bei Fehler oder <code>"code": "NoRoute"</code> → Haversine-Fallback</td></tr>
    </tbody>
  </table>
  <p class="small text-muted mb-0">Fallback: Haversine-Luftlinie für alle Etappen, wenn OSRM nicht erreichbar oder keine Route gefunden. In der Ergebnisliste wird der Fallback mit <em>⚠ Luftlinie</em> gekennzeichnet.</p>

  <!-- Detail-Modal -->
  <h3 class="mt-3">Detail-Modal</h3>
  <p>Wird beim ersten Öffnen von geocaching.com nachgeladen (einmalig je Browser-Session). Enthält:</p>
  <ul>
    <li>Kurz- &amp; Langbeschreibung</li>
    <li>Hinweis (ROT13-kodiert) – Klick auf <strong>Entschlüsseln</strong> dekodiert direkt im Feld</li>
    <li>Log-Statistik: Anzahl je Typ mit Datum des letzten Eintrags</li>
    <li>Letzte 5 Log-Einträge mit Datum, Autor und Text</li>
    <li>Direktlink zu geocaching.com (mit vorgefilterter Log-Ansicht)</li>
  </ul>

  <!-- ══════════════════════════════════════════════════════════════ API -->
  <h2 id="api" class="section-anchor border-bottom pb-1 mt-5">API-Referenz</h2>

  <!-- GET /api/caches.php -->
  <div class="card mb-3">
    <div class="card-header py-2">
      <span class="method get">GET</span> <code>/api/caches.php</code>
      – Caches aus der lokalen DB laden
    </div>
    <div class="card-body">
      <p class="mb-2"><strong>Query-Parameter (alle optional):</strong></p>
      <table class="table table-sm mb-3">
        <thead><tr><th>Parameter</th><th>Typ</th><th>Beschreibung</th></tr></thead>
        <tbody>
          <tr><td><code>s</code></td><td>float</td><td>Südliche Breite (Bounding-Box)</td></tr>
          <tr><td><code>w</code></td><td>float</td><td>Westliche Länge</td></tr>
          <tr><td><code>n</code></td><td>float</td><td>Nördliche Breite</td></tr>
          <tr><td><code>e</code></td><td>float</td><td>Östliche Länge</td></tr>
        </tbody>
      </table>
      <p class="small text-muted">Ohne Parameter: alle Caches in der DB.</p>
      <p><strong>Erfolg (200):</strong></p>
      <pre>{ "success": true, "caches": [ { "gc_code": "GC12345", "name": "…", "cache_type": 2,
  "cache_type_name": "Traditional Cache", "difficulty": 2.5, "terrain": 1.5,
  "container_size": "Regular", "status": "active", "lat": 51.12345, "lng": 10.12345,
  "owner": "CacherName", "placed_date": "2020-06-01", "last_found_date": "2024-01-15",
  "favorite_points": 42, "premium_only": 0, "last_synced": "2025-09-13 10:30:00" } ] }</pre>
      <p><strong>Fehler (500):</strong></p>
      <pre>{ "success": false, "error": "Fehlermeldung" }</pre>
    </div>
  </div>

  <!-- POST /api/sync.php -->
  <div class="card mb-3">
    <div class="card-header py-2">
      <span class="method post">POST</span> <code>/api/sync.php</code>
      – Caches von geocaching.com synchronisieren
    </div>
    <div class="card-body">
      <p><strong>Content-Type:</strong> <code>application/json</code></p>
      <p><strong>Body – Kreis-Modus:</strong></p>
      <pre>{ "mode": "circle", "lat": 51.0, "lng": 10.0, "radius": 5000,
  "max_age_hours": 24, "force": false }</pre>
      <p><strong>Body – Bounding-Box-Modus:</strong></p>
      <pre>{ "mode": "bbox", "minLat": 50.9, "minLng": 9.8, "maxLat": 51.1, "maxLng": 10.2,
  "max_age_hours": 24, "force": false }</pre>
      <p><strong>Body – Kartenausschnitt-Modus:</strong></p>
      <pre>{ "mode": "view", "minLat": 50.9, "minLng": 9.8, "maxLat": 51.1, "maxLng": 10.2,
  "max_age_hours": 24, "force": false }</pre>
      <p><strong>Erfolg – API-Request (200):</strong></p>
      <pre>{ "success": true, "skipped": false, "total_found": 83, "saved": 83,
  "found_synced": 12, "message": "83 Caches gespeichert (API: 83), 12 Funde markiert." }</pre>
      <p><strong>Erfolg – DB-Cache genutzt (200):</strong></p>
      <pre>{ "success": true, "skipped": true, "saved": 0, "count": 83,
  "message": "Bereich bereits aktuell (Daten &lt; 24 h alt). 83 Caches in der DB." }</pre>
      <p><strong>Fehler (500):</strong></p>
      <pre>{ "success": false, "error": "Login bei geocaching.com fehlgeschlagen." }</pre>
    </div>
  </div>

  <!-- GET /api/cache_detail.php -->
  <div class="card mb-3">
    <div class="card-header py-2">
      <span class="method get">GET</span> <code>/api/cache_detail.php</code>
      – Einzelnen Cache mit Beschreibung, Hinweis und Logs laden
    </div>
    <div class="card-body">
      <table class="table table-sm mb-3">
        <thead><tr><th>Parameter</th><th>Pflicht</th><th>Beschreibung</th></tr></thead>
        <tbody>
          <tr><td><code>gc_code</code></td><td>ja</td><td>GC-Code, z. B. <code>GC12345</code></td></tr>
          <tr><td><code>refresh_details</code></td><td>nein</td><td><code>1</code> = Webdaten + aktuelle Log-Einträge von geocaching.com laden</td></tr>
        </tbody>
      </table>
      <p><strong>Erfolg (200):</strong></p>
      <pre>{ "success": true,
  "cache": { "gc_code": "GC12345", "name": "…", "short_description": "…",
             "long_description": "…", "encoded_hints": "Ebg13-Uvag",
             "found_by_user": 1, "found_date": "2024-01-15", … },
  "log_totals": [ { "id": 2, "name": "Found it", "count": 765,
                    "last_date": "2026-09-10" } ],
  "recent_logs": [ { "type": "Found it", "date": "2026-09-10", "user": "CacherX",
                     "text": "Schöner Cache!", "fav": false } ] }</pre>
      <p><strong>Nicht gefunden (404):</strong></p>
      <pre>{ "success": false, "error": "Cache nicht in der lokalen DB." }</pre>
    </div>
  </div>

  <!-- GET /api/status.php -->
  <div class="card mb-3">
    <div class="card-header py-2">
      <span class="method get">GET</span> <code>/api/status.php</code>
      – Datenbankstatistiken
    </div>
    <div class="card-body">
      <p><strong>Erfolg (200):</strong></p>
      <pre>{ "success": true, "stats": { "total": 150, "active": 142,
  "disabled": 5, "archived": 3, "last_sync": "2025-09-13 10:30:00" } }</pre>
    </div>
  </div>

  <!-- ══════════════════════════════════════════════════════════════ KONFIGURATION -->
  <h2 id="konfiguration" class="section-anchor border-bottom pb-1 mt-5">Konfiguration</h2>

  <p>Kopiere <code>config/credentials.example.php</code> nach <code>config/credentials.php</code>:</p>
  <pre>&lt;?php
return [
    'gc_username' =&gt; 'dein@email.de',
    'gc_password' =&gt; 'deinPasswort',

    // Optional – Cookie-String aus dem Browser, falls Auto-Login scheitert:
    // 'gc_cookie_override' =&gt; 'gspkauth=xxx; _ga=xxx; ...',
];</pre>

  <h3 class="mt-3">Login-Fallback (Cookie-Override)</h3>
  <p class="small">Wenn der automatische Login über cURL scheitert (z. B. bei JavaScript-basierter Authentifizierung), exportiere den Cookie-String aus dem Browser:</p>
  <ol class="small">
    <li>In Chrome/Firefox: <span class="kbd">F12</span> → Application/Storage → Cookies → <code>geocaching.com</code></li>
    <li>Alle Cookies kopieren und als Semikolon-separierte Liste in <code>gc_cookie_override</code> eintragen.</li>
  </ol>

  <h3 class="mt-3">Freshness-Logik</h3>
  <p class="small">Vor jedem API-Request prüft der Sync-Endpunkt, ob im angeforderten Gebiet bereits Caches vorhanden sind, deren <code>last_synced</code>-Zeitstempel jünger als <code>max_age_hours</code> ist. Falls ja, wird der API-Request übersprungen und die lokale DB verwendet (<code>"skipped": true</code>). Mit <code>"force": true</code> wird dieser Check umgangen.</p>

  <div class="mt-4">
    <a href="/" class="btn btn-outline-secondary btn-sm">&larr; Zurück zur Karte</a>
  </div>

</div>
</body>
</html>
