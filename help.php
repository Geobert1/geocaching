<?php $embedded = isset($_GET['embedded']); ?>
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
    .section { scroll-margin-top: <?= $embedded ? '16' : '64' ?>px; }
    .tip { background: #f0fdf4; border-left: 3px solid #16a34a; padding: .5rem .85rem; border-radius: 0 .4rem .4rem 0; }
    .shortcut { display:inline-block; padding:.1em .5em; background:#f3f4f6; border:1px solid #d1d5db; border-radius:3px; font-family:monospace; font-size:.85em; }
    .pin { display:inline-block; width:14px; height:14px; border-radius:50%; vertical-align:middle; border:1px solid rgba(0,0,0,.3); }
  </style>
</head>
<body class="bg-light">

<?php if (!$embedded): ?>
<nav class="navbar navbar-dark bg-dark px-3 py-2 sticky-top">
  <a class="navbar-brand fw-bold" style="font-size:1rem;" href="/">🗺 GeocacheMap</a>
  <div class="ms-auto d-flex gap-3 small">
    <a href="#erste-schritte" class="text-light text-decoration-none">Erste Schritte</a>
    <a href="#karte"          class="text-light text-decoration-none">Karte</a>
    <a href="#sync"           class="text-light text-decoration-none">Sync</a>
    <a href="#details"        class="text-light text-decoration-none">Details</a>
    <a href="#route"          class="text-light text-decoration-none">Route</a>
    <a href="api_help.php"    class="text-light text-decoration-none opacity-50">API</a>
  </div>
</nav>
<?php endif; ?>

<div class="container py-5" style="max-width:800px;">

  <h1 class="h3 fw-bold mb-1">GeocacheMap – Hilfe</h1>
  <p class="text-muted mb-5">Lokale Geocaching-Karte mit Sync von geocaching.com</p>

  <!-- ── Erste Schritte ──────────────────────────────────────────────────── -->
  <h2 id="erste-schritte" class="section h5 fw-bold border-bottom pb-2 mb-3">Erste Schritte</h2>

  <p>GeocacheMap lädt Caches von geocaching.com in eine lokale Datenbank und zeigt sie auf einer interaktiven Karte. Du brauchst einen geocaching.com-Account.</p>

  <ol class="mb-3">
    <li class="mb-1">Zugangsdaten in <code>config/credentials.php</code> eintragen (Kopiervorlage: <code>config/credentials.example.php</code>).</li>
    <li class="mb-1">Karte auf den gewünschten Bereich navigieren.</li>
    <li class="mb-1">Oben im <strong>Sync</strong>-Menü den Modus wählen und <strong>Sync</strong> klicken.</li>
    <li>Caches erscheinen als farbige Kreise auf der Karte.</li>
  </ol>

  <div class="tip mb-4">
    Wenn der automatische Login scheitert, kann in <code>credentials.php</code> ein manuell exportierter Cookie-String hinterlegt werden (<code>gc_cookie_override</code>). Den String aus dem Browser holen: <strong>F12 → Application → Cookies → geocaching.com</strong>.
  </div>

  <!-- ── Karte ───────────────────────────────────────────────────────────── -->
  <h2 id="karte" class="section h5 fw-bold border-bottom pb-2 mb-3 mt-5">Karte</h2>

  <h6 class="fw-semibold mt-3">Navigation</h6>
  <table class="table table-sm table-bordered bg-white mb-3">
    <tbody>
      <tr><td style="width:42%">Karte verschieben</td><td>Klicken und ziehen oder mit den Cursortasten, wenn der Mauszeiger über der Karte steht</td></tr>
      <tr><td>Zoomen</td><td>Mausrad, Zoom-Buttons oder <span class="shortcut">+</span> / <span class="shortcut">−</span>, wenn der Mauszeiger über der Karte steht</td></tr>
      <tr><td>Karte per Tastatur verschieben</td><td><span class="shortcut">←</span> <span class="shortcut">→</span> <span class="shortcut">↑</span> <span class="shortcut">↓</span>, wenn der Mauszeiger über der Karte steht</td></tr>
      <tr><td>Bereich zoomen</td><td>Zoom-Box-Button ☐ aktivieren, dann Rechteck ziehen</td></tr>
      <tr><td>Clustering ein/aus</td><td>Cluster-Button ⬤⬤ (linke Spalte)</td></tr>
    </tbody>
  </table>

  <h6 class="fw-semibold mt-3">Kartenstile</h6>
  <p>Über das Kartenstil-Symbol links auf der Karte kannst du zwischen OpenStreetMap, einer humanitären Darstellung, einer Rad- und Geländekarte, Satellitenbildern sowie einer Hybridkarte mit Beschriftungen auf Satellitenbildern wechseln. Das Ebenen-Symbol öffnet ein eigenes Menü für Geocache-Marker, Einkaufsmöglichkeiten und E-Ladesäulen. Die Cache-Liste bleibt beim Ausblenden der Marker sichtbar. Einkaufsmöglichkeiten stammen aus OpenStreetMap. Für E-Ladesäulen wird zuerst OpenStreetMap abgefragt; wenn die öffentlichen Kartendienste nicht erreichbar sind, nutzt Deutschlanddaten aus dem Ladesäulenregister der Bundesnetzagentur. Zum Laden ist Zoomstufe 12 oder näher erforderlich. Die Layer werden beim Verschieben der Karte aktualisiert und die Auswahl gespeichert. Daten können unvollständig sein.</p>

  <h6 class="fw-semibold">Marker</h6>
  <p>Die Cache-Symbole zeigen den Cachetyp; deaktivierte und archivierte Caches werden ausgegraut. Ein gelber Haken kennzeichnet einen von dir gefundenen Cache. In der Routenauswahl bekommen die Punkte nummerierte Marker. Gespeicherte eigene Wegpunkte sind lila. Angepasste Mystery-Caches sind zusätzlich in der Liste am dunkelroten, fett-kursiven Namen und am Hinweis <strong>Koordinaten geändert</strong> zu erkennen.</p>

  <h6 class="fw-semibold">Cache-Liste</h6>
  <p>Das <strong>☰</strong>-Symbol (linke Spalte) öffnet die Cache-Liste. Ohne Suche zeigt sie die Caches im aktuellen Kartenausschnitt sowie deine dauerhaft gespeicherten eigenen Wegpunkte. Die Suche nach Namensbestandteilen oder GC-Code durchsucht dagegen den gesamten lokalen Cache-Datenbestand; ein Treffer außerhalb des Kartenausschnitts wird beim Anklicken auf der Karte fokussiert. Der Cachetyp steht unter dem Namen. Über <strong>＋</strong> legst du einen eigenen Wegpunkt an: Gib eine Koordinate, einen GC-Code oder einen Ort ein oder wähle die Position auf der Karte. Wegpunkte lassen sich über × löschen und per Auswahlknopf oder Kartenmarker für eine Route auswählen.</p>

  <p class="small text-muted">Kartenposition, gewählter Modus und Panel-Zustände werden automatisch im Browser gespeichert und beim nächsten Besuch wiederhergestellt.</p>

  <h6 class="fw-semibold mt-3">Ortssuche &amp; Lesezeichen</h6>
  <p>Das Suchfeld rechts oben lässt sich ein- und ausblenden. Du kannst dort Ortsnamen, GC-Codes sowie Koordinaten suchen. Akzeptierte Beispiele sind <code>54.435223 11.143474</code>, <code>54 25.818 11 08.060</code>, gemischte Formate wie <code>54 29.4544 11.1554</code> und Grad/Minuten/Sekunden wie <code>54 29 44.5848 11 5 19.3848</code>; die Reihenfolge ist immer Breite, Länge. Himmelsrichtungen N/S und E/W sind optional. Ortsnamen werden über OpenStreetMap gesucht; ein Treffer zentriert die Karte auf den Ortsmittelpunkt. <strong>Aktueller Standort</strong> verwendet die Browser-Geolokalisierung. <strong>Kartenmitte merken</strong> ermittelt per Rückwärtssuche eine Adresse und speichert den Punkt als Lesezeichen. Die Lesezeichen lassen sich einzeln löschen. Die optionale Fahne hält den Kartenmittelpunkt beim Verschieben sichtbar und kann zugleich als Startpunkt für die Entfernungsberechnung dienen.</p>
  <p>In der Entfernungsfunktion kannst du von einem Startpunkt eine Fußwegstrecke zu Koordinaten, Cache/GC-Code oder Ort berechnen lassen. Eine Position auf der Karte lässt sich als Zielpunkt auswählen.</p>
  <p class="small text-muted">Die Ortssuche nutzt Nominatim. Die öffentliche Instanz ist für gelegentliche Einzelabfragen gedacht; es gibt daher keine automatische Vorschlags- oder Tipp-Suche. <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noopener">Nutzungsregeln</a>.</p>

  <!-- ── Sync ────────────────────────────────────────────────────────────── -->
  <h2 id="sync" class="section h5 fw-bold border-bottom pb-2 mb-3 mt-5">Sync</h2>

  <p>Das <strong>Sync</strong>-Menü in der Navbar steuert, welche Caches geladen werden.</p>

  <h6 class="fw-semibold mt-3">Suchmodi</h6>
  <table class="table table-sm table-bordered bg-white mb-3">
    <tbody>
      <tr><td style="width:28%"><strong>Kreis</strong></td><td>Auf der Karte einen Mittelpunkt und Radius einzeichnen. Der Sync-Button wird danach aktiv.</td></tr>
      <tr><td><strong>Rechteck</strong></td><td>Einen Begrenzungsrahmen auf der Karte aufziehen.</td></tr>
      <tr><td><strong>Karte</strong></td><td>Aktuellen Kartenausschnitt direkt laden — kein Zeichnen nötig.</td></tr>
    </tbody>
  </table>

  <h6 class="fw-semibold">Max-Alter &amp; Erzwingen</h6>
  <p>Bevor ein neuer API-Request gestartet wird, prüft GeocacheMap ob der Bereich bereits in der Datenbank vorhanden ist und die Daten jünger als das gewählte <strong>Max-Alter</strong> sind. Ist das der Fall, wird der gespeicherte Stand verwendet — schneller und ohne geocaching.com-Request.</p>
  <p><strong>Erzwingen</strong> überspringt diesen Check und holt immer frische Daten.</p>

  <!-- ── Details ─────────────────────────────────────────────────────────── -->
  <h2 id="details" class="section h5 fw-bold border-bottom pb-2 mb-3 mt-5">Cache-Details</h2>

  <h6 class="fw-semibold">Rechte Sidebar</h6>
  <p>Öffnet sich beim Klick auf einen Marker oder eine Listenzeile. Enthält:</p>
  <ul class="mb-3">
    <li>GC-Code, Name, Typ, Behältergröße und Status (aktiv / deaktiviert)</li>
    <li>Schwierigkeit &amp; Geländewertung als Sterne</li>
    <li>Owner, Versteck- und letztes Funddatum, Favoritenpunkte, Koordinaten</li>
    <li>Kurzbeschreibung und ROT13-verschlüsselter Hinweis (falls vorhanden)</li>
  </ul>

  <h6 class="fw-semibold">Mystery-Koordinaten anpassen</h6>
  <p>Bei Mystery-Caches öffnet das Stiftsymbol in der Cache-Liste die Koordinateneingabe. Gib die gelösten Koordinaten in einem unterstützten Breite-Länge-Format ein und speichere sie. Die Änderung wird lokal getrennt von den geocaching.com-Originalkoordinaten gespeichert und bleibt deshalb auch nach einem erneuten Sync erhalten. Angepasste Koordinaten erscheinen in der Detailansicht dunkelrot, fett und kursiv; darunter stehen die Originalkoordinaten. Über <strong>Originalkoordinaten wiederherstellen</strong> entfernst du die Anpassung. Der Cache wird dann wieder an den zuletzt synchronisierten Originalkoordinaten angezeigt.</p>

  <h6 class="fw-semibold">Hinweis entschlüsseln</h6>
  <p>Cache-Hinweise sind ROT13-kodiert. Klick auf <strong>Entschlüsseln</strong> ersetzt den kodierten Text direkt durch den Klartext.</p>

  <h6 class="fw-semibold">Detail-Modal</h6>
  <p>Der Button <strong>Vollständige Details</strong> öffnet ein Fenster mit:</p>
  <ul class="mb-3">
    <li>Kurz- und Langbeschreibung (HTML, inkl. Bilder)</li>
    <li>ROT13-Hinweis</li>
    <li>Log-Statistik: Anzahl je Typ mit Datum des jeweils letzten Eintrags</li>
    <li>Letzte 5 Log-Einträge mit Datum, Autor und Text</li>
    <li>Direktlink zu geocaching.com</li>
  </ul>
  <div class="tip mb-3">
    Beschreibung und Logs werden einmalig pro Session von geocaching.com nachgeladen und dann lokal gespeichert. Bei einem Seitenneuladen werden sie beim nächsten Öffnen erneut abgerufen.
  </div>

  <!-- ── Route ───────────────────────────────────────────────────────────── -->
  <h2 id="route" class="section h5 fw-bold border-bottom pb-2 mb-3 mt-5">Route planen</h2>

  <ol class="mb-3">
    <li class="mb-1">Den <strong>Route</strong>-Button in der Navbar aktivieren (wird grün).</li>
    <li class="mb-1">Caches und gespeicherte Wegpunkte über den Auswahlknopf in der Liste oder durch Klick auf ihre Kartenmarker auswählen. Im Routenmodus öffnet ein Klick auf eine freie Kartenstelle die Wegpunkterstellung; der benannte Wegpunkt wird nach dem Speichern direkt zur Route hinzugefügt. Gesuchte Koordinaten, GC-Codes und Orte können ebenfalls als eigene Wegpunkte gespeichert werden. Die Auswahl lässt sich in der Liste sortieren und einzeln entfernen.</li>
    <li class="mb-1">Optional <strong>Runde</strong> aktivieren — dann wird auch die Strecke vom letzten zurück zum ersten Cache berechnet.</li>
    <li class="mb-1"><strong>Route berechnen (n)</strong> klicken, um die optimierte Route zu berechnen. Der Routenmodus beginnt bei jedem Öffnen mit einer leeren Auswahl. Änderungen an der Auswahl werden automatisch als gespeicherte Route <strong>Letzte Planung</strong> gesichert. Du kannst diese Route über <strong>Gespeicherte Routen</strong> gezielt wieder laden.</li>
    <li>Das Ergebnis erscheint als deutlich sichtbare rote Route mit heller Umrandung auf der Karte. Die linke Liste zeigt die Wegpunkte und Distanzen. <strong>Höhenprofil &amp; Wegbeschaffenheit</strong> öffnet ein Modal mit einem Höhenprofil sowie den entlang der Strecke erfassten OSM-Angaben zu Oberfläche und Wegtyp. Über <strong>CSV</strong> öffnest du die GC-Codes der Route; GPX exportiert Wegpunkte und – falls verfügbar – den berechneten Track. <strong>PNG</strong> lädt ein Bild der Karte herunter. <strong>WhatsApp</strong> öffnet WhatsApp Web mit einer vorbereiteten Nachricht und lädt das Routenbild herunter; GC-Codes und selbst definierte Wegpunkte enthalten anklickbare Links. Hänge die PNG-Datei im Chat manuell an und sende sie. Cache-Namen in der Liste öffnen die Details rechts.</li>
  </ol>

  <p class="small text-muted">Die Route wird über den Routing-Dienst <strong>OSRM</strong> (osrm.oklabflensburg.de) als Fußweg berechnet. Ist der Dienst nicht erreichbar, wird automatisch auf Luftlinie zurückgegriffen.</p>
  <p class="small text-muted">Das Höhenprofil nutzt EU-DEM mit 25 m Rasterweite, außerhalb der Abdeckung SRTM mit 90 m. Wegtypen, Oberflächen, Festigkeit (tracktype) und Befahrbarkeit (smoothness) stammen aus OpenStreetMap und werden den Wegen nahe der berechneten Route zugeordnet. Fehlende OSM-Angaben werden als unbekannt ausgewiesen.</p>

  <div class="mt-5 pt-3 border-top d-flex gap-3">
    <?php if (!$embedded): ?>
    <a href="/" class="btn btn-outline-secondary btn-sm">&larr; Zurück zur Karte</a>
    <?php endif; ?>
    <a href="api_help.php<?= $embedded ? '?embedded' : '' ?>" class="btn btn-outline-secondary btn-sm" <?= $embedded ? 'target="_blank"' : '' ?>>API-Referenz</a>
  </div>

</div>
</body>
</html>
