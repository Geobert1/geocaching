<?php
$gcUsername = '';
$tileUrl    = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
$credFile   = __DIR__ . '/config/credentials.php';
if (file_exists($credFile)) {
    $cred       = require $credFile;
    $gcUsername = $cred['gc_username'] ?? '';
    $tileUrl    = $cred['tile_url']    ?? $tileUrl;
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GeocacheMap</title>
  <link rel="icon" type="image/x-icon" href="favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="favicon-16.png">

  <!-- Vendor CSS (lokal) -->
  <link rel="stylesheet" href="assets/css/bootstrap.min.css">
  <link rel="stylesheet" href="assets/css/leaflet.css">
  <link rel="stylesheet" href="assets/css/leaflet.draw.min.css">
  <link rel="stylesheet" href="assets/css/MarkerCluster.css">
  <link rel="stylesheet" href="assets/css/MarkerCluster.Default.css">

  <!-- App -->
  <link rel="stylesheet" href="css/app.css?v=50">
</head>
<body>

<!-- ── Navbar ─────────────────────────────────────────────────────────────── -->
<nav class="navbar navbar-dark bg-dark px-3 py-1 gap-2">
  <a class="navbar-brand fw-bold" style="font-size:1rem;" href="#">
    🗺 GeocacheMap<?= $gcUsername ? ' (' . htmlspecialchars($gcUsername) . ')' : '' ?>
  </a>

  <!-- Sync-Menü (Dropdown) -->
  <div class="dropdown">
    <button class="btn btn-sm btn-outline-light dropdown-toggle" id="btn-sync-toggle"
            data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor"
           viewBox="0 0 16 16" class="me-1">
        <path fill-rule="evenodd"
              d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
        <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0
                 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
      </svg>Sync
    </button>
    <div class="dropdown-menu p-3 shadow-sm" style="min-width:300px;">

      <!-- Suchmodus -->
      <div class="d-flex align-items-center gap-2 mb-2">
        <div class="btn-group btn-group-sm" role="group" aria-label="Suchmodus">
          <button id="btn-mode-circle" data-mode="circle" type="button"
                  class="btn btn-outline-secondary">Kreis</button>
          <button id="btn-mode-bbox"   data-mode="bbox"   type="button"
                  class="btn btn-outline-secondary">Rechteck</button>
          <button id="btn-mode-view"   data-mode="view"   type="button"
                  class="btn btn-outline-secondary active">Karte</button>
        </div>
        <span id="radius-display" class="text-muted small" style="display:none">– km</span>
      </div>

      <!-- Freshness + Force -->
      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="text-muted small mb-0" for="sel-maxage">Max-Alter</label>
        <select id="sel-maxage" class="form-select form-select-sm" style="width:auto;">
          <option value="1">1 h</option>
          <option value="6">6 h</option>
          <option value="24" selected>24 h</option>
          <option value="72">3 d</option>
          <option value="168">1 Woche</option>
        </select>
        <div class="form-check mb-0 ms-1">
          <input class="form-check-input" type="checkbox" id="chk-force">
          <label class="form-check-label small" for="chk-force">Erzwingen</label>
        </div>
      </div>

      <!-- Sync-Button + Status -->
      <div class="d-flex align-items-center gap-2">
        <button id="btn-sync" class="btn btn-sm btn-primary" disabled>
          <span id="sync-spinner" class="spinner-border spinner-border-sm me-1 d-none"></span>
          Sync
        </button>
        <span id="status-msg" class="small text-muted"></span>
      </div>

    </div>
  </div>

  <!-- Route-mode toggle + controls (roundtrip, kilometer labels + calc button) -->
  <div class="d-flex align-items-center gap-2 text-nowrap">
    <button id="btn-route-mode" class="btn btn-sm btn-outline-success"
            title="Route-Modus: Caches per Klick auf der Karte auswählen">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor"
           viewBox="0 0 16 16" class="me-1">
        <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
      </svg>Route
    </button>
    <div id="route-mode-controls" class="d-none align-items-center gap-2">
<div class="form-check form-check-inline mb-0">
        <input class="form-check-input" type="checkbox" id="chk-roundtrip">
        <label class="form-check-label text-light small" for="chk-roundtrip">Runde</label>
      </div>
      <div id="route-km-toggle" class="form-check form-check-inline mb-0 d-none">
        <input class="form-check-input" type="checkbox" id="chk-route-km-labels" checked>
        <label class="form-check-label text-light small" for="chk-route-km-labels" title="Kilometermarkierungen anzeigen">km</label>
      </div>
      <div class="route-action-stack">
        <button id="btn-calc-route" class="btn btn-sm btn-warning" title="Route berechnen" disabled>
          Berechnen (<span id="sel-count">0</span>)
        </button>
        <button id="btn-save-route" class="btn btn-sm btn-outline-light" title="Route speichern" disabled>Sichern</button>
        <button id="btn-saved-routes" class="btn btn-sm btn-outline-light" title="Gespeicherte Routen">Routen</button>
      </div>
    </div>
  </div>

  <!-- DB Stats -->
  <div class="d-flex align-items-center gap-3 ms-auto text-light small">
    <span title="Gesamt in DB">&#x1F5C4; <strong id="stat-total">–</strong></span>
    <span title="Aktive Caches">&#x2705; <strong id="stat-active">–</strong></span>
    <span title="Letzter Sync" class="d-none d-lg-inline">
      Sync: <span id="stat-lastsync">–</span>
    </span>
    <button type="button" class="btn btn-sm btn-outline-light" id="btn-help" title="Hilfe">?</button>
  </div>
</nav>

<!-- ── Main content ───────────────────────────────────────────────────────── -->
<div id="content-wrapper">

  <!-- Left panel: Cache-Auswahl -->
  <div id="list-panel">
    <div id="list-panel-head">
      <span class="fw-semibold small">Cache-Liste</span>
      <span id="list-count" class="badge bg-secondary ms-1">0</span>
      <button id="btn-add-waypoint" class="btn btn-sm btn-outline-success py-0 px-2 ms-2" type="button" title="Eigenen Wegpunkt anlegen" aria-label="Eigenen Wegpunkt anlegen">＋</button>
      <button id="btn-close-list" class="btn btn-sm btn-link p-0 text-secondary ms-auto"
              title="Schließen">✕</button>
    </div>
    <div id="cache-search-wrap">
      <div class="input-group input-group-sm">
        <input id="cache-search" class="form-control" type="search"
               placeholder="Caches und Wegpunkte suchen…" aria-label="Cache-Liste durchsuchen">
        <button id="btn-clear-cache-search" class="btn btn-outline-secondary" type="button" aria-label="Cachefilter löschen" title="Filter löschen">×</button>
      </div>
    </div>
    <div id="list-body"></div>
    <div id="list-footer">
      <button id="btn-clear-sel" class="btn btn-sm btn-outline-secondary w-100"
              disabled>Auswahl löschen</button>
    </div>
  </div>

  <!-- Map -->
  <div id="map-area" style="flex:1; position:relative;">
    <div id="map"></div>
    <div id="place-search" class="shadow-sm">
      <form id="place-search-form" class="d-flex gap-1">
        <input id="place-search-input" class="form-control form-control-sm" type="search"
               placeholder="Ort oder lat, lng suchen" aria-label="Ort oder Koordinate suchen">
        <button class="btn btn-sm btn-primary" type="submit">Suchen</button>
      </form>
      <button id="btn-current-location" class="btn btn-sm btn-outline-primary w-100 mt-1" type="button">
        ◎ Aktueller Standort
      </button>
      <div id="place-search-status" class="small text-muted mt-1" aria-live="polite"></div>
      <div id="place-search-results"></div>
      <div class="d-flex gap-1 mt-1">
        <button id="bookmark-current" class="btn btn-sm btn-outline-secondary flex-grow-1" type="button">Kartenmitte merken</button>
        <button id="bookmark-toggle" class="btn btn-sm btn-outline-secondary" type="button" aria-label="Gespeicherte Orte anzeigen">★</button>
        <button id="btn-center-flag" class="btn btn-sm btn-outline-secondary" type="button" title="Kartenmitte markieren" aria-label="Kartenmitte markieren" aria-pressed="false">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 1.5a.5.5 0 0 1 1 0V2h8.1a.5.5 0 0 1 .4.8L10.7 5l1.8 2.2a.5.5 0 0 1-.4.8H4v6.5a.5.5 0 0 1-1 0v-13zM4 3v4h7.1L9.7 5.3a.5.5 0 0 1 0-.6L11.1 3H4z"/></svg>
        </button>
      </div>
      <div id="bookmark-list" class="d-none"></div>
      <button id="btn-distance-toggle" class="btn btn-sm btn-outline-success w-100 mt-2" type="button" aria-expanded="false">Fußwegdistanz berechnen</button>
      <form id="distance-form" class="d-none mt-2">
        <label for="distance-from" class="form-label small mb-1">Startpunkt</label>
        <input id="distance-from" class="form-control form-control-sm mb-2" type="text" placeholder="Ort, Koordinate oder GC-Code">
        <label for="distance-to" class="form-label small mb-1">Zielpunkt</label>
        <input id="distance-to" class="form-control form-control-sm" type="text" placeholder="Ort, Koordinate oder GC-Code">
        <button id="btn-distance-pick-target" class="btn btn-sm btn-outline-secondary w-100 mt-1" type="button" aria-pressed="false">⌖ Ziel auf Karte wählen</button>
        <div class="d-flex gap-1 mt-2">
          <button class="btn btn-sm btn-success flex-grow-1" type="submit">Fußweg berechnen</button>
          <button id="btn-distance-clear" class="btn btn-sm btn-outline-secondary" type="button" title="Route entfernen">×</button>
        </div>
        <div id="distance-status" class="small text-muted mt-1" aria-live="polite"></div>
      </form>
    </div>
    <!-- Custom map control column (replaces Leaflet default zoom) -->
    <div id="map-ctrl-col">
      <button id="btn-zoom-in"  title="Vergrößern">+</button>
      <button id="btn-zoom-out" title="Verkleinern">−</button>
      <button id="btn-toggle-list"    title="Cache-Liste ein-/ausblenden">☰</button>
      <button id="btn-toggle-search" title="Ortssuche ein-/ausblenden" aria-label="Ortssuche ein-/ausblenden">⌕</button>
      <button id="btn-map-styles" title="Kartenstil wählen" aria-label="Kartenstil wählen" aria-expanded="false">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 4.2 5 2l5 2 5-2v9.8L10 14l-5-2-4 2V4.2Zm4-.95L2 4.9v7.6l3-1.5V3.25Zm1 0v7.6l3.5 1.4V4.65L6 3.25Zm4.5 1.4v7.6l3.5-1.5v-7.6l-3.5 1.5Z"/></svg>
      </button>
      <button id="btn-map-overlays" title="Zusätzliche Kartenebenen" aria-label="Zusätzliche Kartenebenen" aria-expanded="false">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>
      </button>
      <button id="btn-map-filters" title="Cache-Arten und Status filtern" aria-label="Cache-Arten und Status filtern" aria-expanded="false">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5z"/></svg>
      </button>
      <button id="btn-toggle-cluster" title="Clustering ein-/ausschalten">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
             fill="currentColor">
          <circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/>
          <circle cx="12" cy="19" r="3"/>
          <circle cx="5" cy="5" r="1.5" fill="#fff"/><circle cx="19" cy="5" r="1.5" fill="#fff"/>
          <circle cx="12" cy="19" r="1.5" fill="#fff"/>
        </svg>
      </button>
      <button id="btn-zoom-box" title="Bereich zoomen (Klick + Ziehen)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
             stroke-width="1.5" stroke-linecap="round">
          <rect x="1" y="1" width="12" height="12" rx="1" stroke-dasharray="3,2"/>
          <path d="M7 4v6M4 7h6"/>
        </svg>
      </button>
    </div>
    <div id="map-style-menu" class="d-none shadow-sm">
      <label class="small fw-semibold mb-1" for="map-style-select">Kartenstil</label>
      <select id="map-style-select" class="form-select form-select-sm">
        <option value="standard">OpenStreetMap</option>
        <option value="hot">Humanitär</option>
        <option value="cyclosm">Rad- und Geländekarte</option>
        <option value="satellite">Satellit</option>
        <option value="hybrid">Hybrid (Satellit + Beschriftung)</option>
      </select>
    </div>
    <div id="map-overlay-menu" class="d-none shadow-sm">
      <div class="small fw-semibold mb-2">Kartenebenen</div>
      <div class="form-check">
        <input id="toggle-satellite-layer" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-satellite-layer">Wolken-Satellitenbild (DWD)</label>
      </div>
      <div class="ms-4 mb-1">
        <label class="small text-muted d-flex justify-content-between" for="satellite-opacity">
          <span>DWD-Bilddeckkraft</span><span id="satellite-opacity-value">45 %</span>
        </label>
        <input id="satellite-opacity" class="form-range mb-0" type="range" min="20" max="80" step="5" value="45" aria-label="Deckkraft des Wolken-Satellitenbilds">
      </div>
      <div id="satellite-layer-status" class="small text-muted ms-4 mb-1" aria-live="polite"></div>
      <div class="form-check">
        <input id="toggle-radar-layer" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-radar-layer">Niederschlagsradar</label>
      </div>
      <div id="radar-layer-status" class="small text-muted ms-4 mb-1" aria-live="polite"></div>
      <div class="form-check">
        <input id="toggle-wind-layer" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-wind-layer">Windvorhersage (ICON-EU)</label>
      </div>
      <div id="wind-layer-status" class="small text-muted ms-4 mb-1" aria-live="polite"></div>
      <div class="form-check">
        <input id="toggle-coordinate-grid" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-coordinate-grid">Koordinatengitter &amp; Ländergrenzen</label>
      </div>
      <div id="coordinate-grid-status" class="small text-muted ms-4 mb-1" aria-live="polite"></div>
      <hr class="my-2">
      <div class="form-check">
        <input id="toggle-cache-markers" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-cache-markers">Geocaches anzeigen</label>
      </div>
      <div class="form-check">
        <input id="toggle-parking-layer" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-parking-layer">Parkplätze anzeigen</label>
      </div>
      <div id="parking-layer-status" class="small text-muted ms-4 mb-1" aria-live="polite"></div>
      <hr class="my-2">
      <div class="form-check">
        <input id="toggle-shopping-layer" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-shopping-layer">Einkaufsmöglichkeiten anzeigen</label>
      </div>
      <div id="shopping-category-options" class="shopping-category-options ms-3 mt-1">
        <div class="form-check">
          <input id="toggle-shopping-brands" class="form-check-input" type="checkbox">
          <label class="form-check-label small" for="toggle-shopping-brands">Bekannte Ladenketten</label>
        </div>
        <div class="form-check">
          <input id="toggle-shopping-other" class="form-check-input" type="checkbox">
          <label class="form-check-label small" for="toggle-shopping-other">Weitere Geschäfte</label>
        </div>
      </div>
      <div id="shopping-layer-status" class="small text-muted mt-1" aria-live="polite"></div>
      <hr class="my-2">
      <div class="form-check">
        <input id="toggle-charging-layer" class="form-check-input" type="checkbox">
        <label class="form-check-label small" for="toggle-charging-layer">E-Ladesäulen anzeigen</label>
      </div>
      <div id="charging-layer-status" class="small text-muted mt-1" aria-live="polite"></div>
    </div>
    <div id="map-filter-menu" class="d-none shadow-sm" aria-label="Cache-Filter">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <div class="small fw-semibold">Sichtbarkeit</div>
        <label class="form-check form-switch map-filter-master mb-0">
          <input id="toggle-map-visibility" class="form-check-input" type="checkbox" role="switch" aria-label="Alle Status und Fundzustände anzeigen">
        </label>
      </div>
      <div class="small fw-semibold text-muted mb-1">Status</div>
      <div id="map-filter-statuses" class="map-filter-options mb-2"></div>
      <div class="small fw-semibold text-muted mb-1">Fundstatus</div>
      <div id="map-filter-found" class="map-filter-options mb-2"></div>
      <hr class="my-2">
      <div class="d-flex align-items-center justify-content-between mb-1">
        <div class="small fw-semibold text-muted">Cache-Arten</div>
        <label class="form-check form-switch map-filter-master mb-0">
          <input id="toggle-all-cache-types" class="form-check-input" type="checkbox" role="switch" aria-label="Alle Cache-Arten anzeigen">
        </label>
      </div>
      <div id="map-filter-types" class="map-filter-options"></div>
    </div>
  </div>

  <!-- Sidebar (hidden by default, slides in from right) -->
  <div id="sidebar">
    <div id="sidebar-detail"></div>
  </div>

</div>

<!-- ── Cache-Detail-Modal ─────────────────────────────────────────────────── -->
<div class="modal fade" id="waypoint-modal" tabindex="-1" aria-labelledby="waypoint-modal-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <form id="waypoint-form" class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="waypoint-modal-title">Eigenen Wegpunkt anlegen</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Schließen"></button>
      </div>
      <div class="modal-body">
        <label for="waypoint-name" class="form-label small">Name</label>
        <input id="waypoint-name" class="form-control form-control-sm mb-3" maxlength="120" required placeholder="z. B. Parkplatz am Einstieg">
        <label for="waypoint-location" class="form-label small">Position: Koordinate, GC-Code oder Ort</label>
        <input id="waypoint-location" class="form-control form-control-sm" required placeholder="Koordinate, GC123AB oder Ort">
        <div class="d-flex gap-2 mt-2">
          <button id="btn-waypoint-resolve" class="btn btn-sm btn-outline-primary flex-grow-1" type="button">Position suchen</button>
          <button id="btn-waypoint-pick" class="btn btn-sm btn-outline-secondary flex-grow-1" type="button" aria-pressed="false">Auf Karte wählen</button>
        </div>
        <div id="waypoint-modal-status" class="small text-muted mt-2" aria-live="polite"></div>
      </div>
      <div class="modal-footer py-2">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Abbrechen</button>
        <button id="btn-waypoint-save" class="btn btn-sm btn-success" type="submit">Wegpunkt speichern</button>
      </div>
    </form>
  </div>
</div>

<div class="modal fade" id="route-csv-modal" tabindex="-1" aria-labelledby="route-csv-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="route-csv-title">GC-Codes der Route (CSV)</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Schließen"></button>
      </div>
      <div class="modal-body">
        <label for="route-csv-values" class="form-label small text-muted">Reihenfolge der Cache-Wegpunkte</label>
        <textarea id="route-csv-values" class="form-control font-monospace" rows="3" readonly></textarea>
        <div id="route-csv-copy-status" class="small text-muted mt-2" aria-live="polite"></div>
      </div>
      <div class="modal-footer py-1">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Schließen</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="route-profile-modal" tabindex="-1" aria-labelledby="route-profile-title" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="route-profile-title">Streckenprofil</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Schließen"></button>
      </div>
      <div class="modal-body">
        <div id="route-profile-status" class="small text-muted mb-3" aria-live="polite">Profildaten werden geladen …</div>
        <div id="route-profile-summary" class="route-profile-summary mb-3"></div>
        <section class="route-profile-elevation mb-4" aria-labelledby="route-profile-elevation-title">
          <div class="d-flex align-items-baseline justify-content-between flex-wrap gap-2">
            <h6 id="route-profile-elevation-title" class="fw-semibold mb-0">Höhenprofil</h6>
            <span id="route-profile-cursor-readout" class="small text-muted">Entlang des Profils bewegen für Streckenhöhe</span>
          </div>
          <div id="route-profile-chart" class="route-profile-chart"></div>
          <div id="route-profile-elevation-source" class="small text-muted"></div>
        </section>
        <div class="row g-4">
          <section class="col-md-6" aria-labelledby="route-profile-waytype-title">
            <h6 id="route-profile-waytype-title" class="fw-semibold">Wegtypen</h6>
            <div id="route-profile-waytypes"></div>
          </section>
          <section class="col-md-6" aria-labelledby="route-profile-surface-title">
            <h6 id="route-profile-surface-title" class="fw-semibold">Untergrund</h6>
            <div id="route-profile-surfaces"></div>
          </section>
        </div>
        <section class="mt-4" aria-labelledby="route-profile-condition-title">
          <h6 id="route-profile-condition-title" class="fw-semibold">Wegzustand laut OSM</h6>
          <div class="row g-4">
            <div class="col-md-6"><div class="small text-muted mb-2">Festigkeit (tracktype)</div><div id="route-profile-tracktypes"></div></div>
            <div class="col-md-6"><div class="small text-muted mb-2">Befahrbarkeit (smoothness)</div><div id="route-profile-smoothness"></div></div>
          </div>
        </section>
        <p class="small text-muted mt-3 mb-0">
          Höhen basieren auf EU-DEM (25 m), mit SRTM (90 m) als Fallback. Wegtypen und Untergrund stammen aus OpenStreetMap und werden nahe der Route zugeordnet; nicht erfasste Angaben werden als unbekannt ausgewiesen.
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap-Mitwirkende</a> · Höhen: <a href="https://www.opentopodata.org/" target="_blank" rel="noopener">OpenTopoData · EU-DEM (EEA) / SRTM</a>.
        </p>
      </div>
      <div class="modal-footer py-1">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Schließen</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="gpx-import-help-modal" tabindex="-1" aria-labelledby="gpx-import-help-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <div class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="gpx-import-help-title">GPX in Google Maps importieren</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Schließen"></button>
      </div>
      <div class="modal-body small">
        <ol class="mb-2 ps-3">
          <li>Mit dem GPX-Button die Datei herunterladen.</li>
          <li>Am Computer <a href="https://mymaps.google.com/" target="_blank" rel="noopener">Google My Maps</a> öffnen und eine Karte erstellen oder auswählen.</li>
          <li>Auf <strong>Ebene hinzufügen</strong> und dann <strong>Importieren</strong> klicken; die GPX-Datei auswählen.</li>
          <li>Die importierte Karte lässt sich anschließend in Google Maps unter <strong>Gespeichert → Karten</strong> öffnen.</li>
        </ol>
        Die Datei enthält die Routenpunkte als Wegpunkte und, sofern die Routenberechnung eine Wegstrecke geliefert hat, den berechneten Verlauf als Track.
        <div class="mt-2"><a href="https://support.google.com/mymaps/answer/3024836?hl=de" target="_blank" rel="noopener">Google-Hilfe: Kartendaten aus einer Datei importieren</a></div>
      </div>
      <div class="modal-footer py-1">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Schließen</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="route-name-modal" tabindex="-1" aria-labelledby="route-name-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-sm">
    <form id="route-name-form" class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="route-name-title">Route speichern</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Schließen"></button>
      </div>
      <div class="modal-body">
        <label for="route-name-input" class="form-label small">Name der Route</label>
        <input id="route-name-input" class="form-control form-control-sm" maxlength="120" required placeholder="z. B. Runde am Strand">
        <div id="route-save-status" class="small text-danger mt-2" aria-live="polite"></div>
      </div>
      <div class="modal-footer py-2">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Abbrechen</button>
        <button id="route-save-new" type="submit" class="btn btn-sm btn-outline-primary d-none">Als neue Route speichern</button>
        <button id="route-name-submit" type="submit" class="btn btn-sm btn-success">Speichern</button>
      </div>
    </form>
  </div>
</div>

<div class="modal fade" id="saved-routes-modal" tabindex="-1" aria-labelledby="saved-routes-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="saved-routes-title">Gespeicherte Routen</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Schließen"></button>
      </div>
      <div id="saved-routes-list" class="modal-body p-2"></div>
      <div class="modal-footer py-1">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Schließen</button>
      </div>
    </div>
  </div>
</div>

<div class="modal fade" id="cache-coordinates-modal" tabindex="-1" aria-labelledby="cache-coordinates-title" aria-hidden="true">
  <div class="modal-dialog modal-dialog-centered">
    <form id="cache-coordinates-form" class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="cache-coordinates-title">Mystery-Koordinaten anpassen</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Schließen"></button>
      </div>
      <div class="modal-body">
        <div id="cache-coordinates-name" class="small fw-semibold mb-2"></div>
        <label for="cache-coordinates-value" class="form-label small">Neue Koordinate (Breite, Länge)</label>
        <input id="cache-coordinates-value" class="form-control form-control-sm font-monospace" required placeholder="z. B. 54.435223 11.143474">
        <div id="cache-coordinates-original" class="small text-muted mt-2"></div>
        <div id="cache-coordinates-status" class="small mt-2" aria-live="polite"></div>
      </div>
      <div class="modal-footer py-2 justify-content-between">
        <button id="btn-restore-cache-coordinates" class="btn btn-sm btn-outline-danger d-none" type="button">Originalkoordinaten wiederherstellen</button>
        <div class="d-flex gap-2 ms-auto">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Abbrechen</button>
          <button id="btn-save-cache-coordinates" class="btn btn-sm btn-primary" type="submit">Koordinaten speichern</button>
        </div>
      </div>
    </form>
  </div>
</div>

<div class="modal fade" id="cache-detail-modal" tabindex="-1" aria-labelledby="cache-modal-title" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header py-2">
        <h5 class="modal-title fw-bold" id="cache-modal-title"></h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body" id="cache-modal-body">
      </div>
      <div class="modal-footer py-1 justify-content-start">
        <a id="cache-modal-link" href="#" target="_blank" class="btn btn-sm btn-outline-primary">geocaching.com →</a>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Schließen</button>
      </div>
    </div>
  </div>
</div>

<!-- ── Hilfe-Modal ────────────────────────────────────────────────────────── -->
<div class="modal fade" id="help-modal" tabindex="-1" aria-labelledby="help-modal-title" aria-hidden="true">
  <div class="modal-dialog modal-xl modal-dialog-scrollable" style="height:90vh;">
    <div class="modal-content h-100">
      <div class="modal-header py-2">
        <h5 class="modal-title" id="help-modal-title">Hilfe</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body p-0">
        <iframe id="help-iframe" src="" style="width:100%;height:100%;border:none;" title="Hilfe"></iframe>
      </div>
    </div>
  </div>
</div>

<!-- ── Scripts ────────────────────────────────────────────────────────────── -->
<script>window.GC_TILE_URL = <?= json_encode($tileUrl) ?>;</script>
<!-- Vendor JS (lokal) -->
<script src="assets/js/jquery.min.js"></script>
<script src="assets/js/bootstrap.bundle.min.js"></script>
<script src="assets/js/leaflet.js"></script>
<script src="assets/js/leaflet.draw.min.js"></script>
<script src="assets/js/leaflet.markercluster.js"></script>
<script src="js/app.js?v=159"></script>

</body>
</html>
