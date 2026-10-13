<?php
// Kopiere diese Datei nach credentials.php und trage deine Zugangsdaten ein.
return [
    'gc_username' => '',   // geocaching.com Benutzername oder E-Mail
    'gc_password' => '',   // Passwort

    // Optionaler Fallback: Cookie-String aus dem Browser exportieren,
    // falls der automatische Login scheitert.
    // Anleitung: DevTools → Application → Cookies → geocaching.com → alle kopieren.
    // 'gc_cookie_override' => '',

    // Karten-Tiles: URL-Template für den Leaflet-TileLayer.
    // {z}/{x}/{y} sind Pflicht-Platzhalter. Ohne Eintrag wird OSM verwendet.
    // Beispiele:
    //   OSM (online):   'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    //   Lokal (mbtiles-server o.ä.): 'http://localhost:8080/tile/{z}/{x}/{y}.png'
    // 'tile_url' => 'http://localhost:8080/tile/{z}/{x}/{y}.png',
];
