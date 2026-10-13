# GeocacheMap

GeocacheMap ist eine lokal betriebene PHP-Webanwendung zum Erkunden und Planen von Geocaching-Touren. Sie zeigt Caches auf einer interaktiven Karte, synchronisiert Cache-Daten von geocaching.com in eine lokale SQLite-Datenbank und unterstützt eigene Wegpunkte sowie gespeicherte Routen.

## Funktionen

- Caches auf einer Leaflet-Karte und in einer Liste anzeigen und durchsuchen
- Cache-Daten für den sichtbaren Kartenausschnitt, einen Kreis oder ein Rechteck synchronisieren
- Synchronisierte Cache- und Funddaten lokal in SQLite speichern
- Cache-Details und Logs abrufen
- Eigene Wegpunkte und Mystery-Koordinaten verwalten
- Routen aus Caches und Wegpunkten planen, speichern und exportieren
- Routenberechnung über OSRM; bei Nichterreichbarkeit wird eine Luftlinienberechnung verwendet

## Voraussetzungen

- PHP 8 oder neuer mit den Erweiterungen **PDO_SQLite**, **cURL** und **DOM**
- Ein Webserver oder der eingebaute PHP-Entwicklungsserver
- Ein geocaching.com-Konto für die Synchronisierung
- Internetzugang für geocaching.com sowie die verwendeten Karten- und Routing-Dienste

Die benötigten Frontend-Bibliotheken liegen bereits im Verzeichnis `assets/`; ein Node.js-Build ist nicht erforderlich.

## Installation

1. Repository klonen oder das Projektverzeichnis herunterladen.
2. Lokale Zugangsdaten-Datei aus der Vorlage anlegen:

   ```bash
   cp config/credentials.example.php config/credentials.php
   ```

3. `config/credentials.php` bearbeiten und geocaching.com-Benutzername sowie Passwort eintragen.
4. Sicherstellen, dass PHP in `data/` und `session/` schreiben kann. Die SQLite-Datenbank wird beim ersten API-Zugriff automatisch angelegt.
5. Für einen lokalen Testserver im Projektverzeichnis starten:

   ```bash
   php -S 127.0.0.1:8000
   ```

6. Im Browser <http://127.0.0.1:8000> öffnen.

Der eingebaute PHP-Server ist für lokale Entwicklung gedacht. Für einen dauerhaften Betrieb einen geeigneten Webserver mit PHP-Unterstützung verwenden.

## Konfiguration

Die lokale Datei `config/credentials.php` wird nicht versioniert. Die Vorlage enthält außerdem optionale Einstellungen:

- `gc_cookie_override`: Cookie-String als Fallback, falls der automatische Login nicht funktioniert
- `tile_url`: eigenes URL-Template für Karten-Kacheln; ohne Angabe wird OpenStreetMap verwendet

Die Anwendung legt lokale Daten in `data/geocaching.sqlite` ab und speichert Sitzungs-Cookies in `session/cookies.txt`. Diese Dateien sind ebenfalls von Git ausgeschlossen.

## Sicherheit und GitHub

Zugangsdaten, Cookies und lokale Cache-Daten gehören nicht in ein öffentliches Repository. Die `.gitignore` schließt diese Dateien aus. Vor einem Commit prüfen:

```bash
git status --short
```

Die App ist für den persönlichen beziehungsweise lokalen Betrieb ausgelegt. Bei einer Veröffentlichung im Internet müssen insbesondere `config/`, `data/` und `session/` vor direktem Webzugriff geschützt und der Zugriff auf die Anwendung abgesichert werden. Für Apache enthält das Projekt entsprechende `.htaccess`-Dateien; bei anderen Webservern müssen gleichwertige Regeln eingerichtet werden.

## Projektstruktur

```text
api/       JSON-Endpunkte für Caches, Synchronisierung, Wegpunkte und Routen
assets/    lokal eingebundene Frontend-Bibliotheken und Grafiken
config/    Konfigurationsvorlage und lokale Zugangsdaten
css/       Anwendungsstile
data/      lokale SQLite-Datenbank
js/        Karten- und Anwendungslogik
session/   Sitzungs-Cookies
src/       Datenbank- und geocaching.com-Client
```

## Hinweise

Kartenkacheln und Routing werden von externen Diensten geladen und benötigen eine Internetverbindung. Verfügbarkeit und Nutzungsbedingungen dieser Dienste gelten unabhängig von diesem Projekt. Änderungen an geocaching.com können eine Anpassung des Clients erforderlich machen.
