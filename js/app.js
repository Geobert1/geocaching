/* global $, L, bootstrap */
$(function () {
    'use strict';

    // ── Persistence ───────────────────────────────────────────────────────────
    const LS = {
        get: (k, def) => { try { const v = localStorage.getItem('gc_' + k); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
        set: (k, v)   => { try { localStorage.setItem('gc_' + k, JSON.stringify(v)); } catch {} },
    };

    // ── Place search and local bookmarks ─────────────────────────────────────
    let searchMarker = null;
    let lastGeocodeAt = 0;
    let searchedPlace = null;
    let distanceLayer = null;
    let distanceTargetPick = false;
    let distancePickMarker = null;
    let waypointPickMode = false;
    let waypointDraftMarker = null;
    let waypointDraftPoint = null;
    const searchLabel = (p) => p.label || `${(+p.lat).toFixed(5)}, ${(+p.lng).toFixed(5)}`;
    function showPlace(lat, lng, label, zoom = 14) {
        searchedPlace = { lat: +lat, lng: +lng, label };
        map.setView([+lat, +lng], Math.max(map.getZoom(), zoom));
        if (searchMarker) map.removeLayer(searchMarker);
        searchMarker = L.marker([+lat, +lng]).addTo(map).bindTooltip(escHtml(label));
    }
    async function reverseGeocode(lat, lng) {
        async function lookup(zoom) {
            const wait = Math.max(0, 1000 - (Date.now() - lastGeocodeAt));
            if (wait) await new Promise(resolve => setTimeout(resolve, wait));
            lastGeocodeAt = Date.now();
            const url = new URL('https://nominatim.openstreetmap.org/reverse');
            url.search = new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: String(zoom), 'accept-language': 'de' });
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        }
        let place = await lookup(18);
        let address = place.address || {};
        const getLocality = a => a.city_district || a.suburb || a.town || a.village || a.municipality || a.hamlet || a.city;
        if (!getLocality(address)) {
            try {
                const cityPlace = await lookup(10);
                address = { ...address, ...(cityPlace.address || {}) };
            } catch (_) { /* keep the detailed reverse-geocoding result */ }
        }
        const county = address.county || address.state_district || '';
        const locality = getLocality(address) || address.city_district || address.suburb || address.neighbourhood || '';
        const street = [address.road || address.pedestrian || address.residential || address.path, address.house_number]
            .filter(Boolean).join(' ');
        const label = locality || place.display_name;
        if (!label) throw new Error('Kein Ortsname gefunden');
        const details = String(place.display_name || '')
            .split(',').map(part => part.trim()).filter(Boolean)
            .filter((part, i, all) => part !== label && all.indexOf(part) === i)
            .join(', ');
        const supplemental = [county, street].filter(Boolean).filter(part => !details.includes(part));
        return { label, detail: [details, ...supplemental].filter(Boolean).join(', ') };
    }
    function parseCoordinatePair(value) {
        const dms = /^\s*([NS])?\s*([+-]?\d{1,2})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)([NS])?\s*(?:[,;]|\s+(?:und\s+)?)([EW])?\s*([+-]?\d{1,3})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)([EW])?\s*$/i.exec(value);
        if (dms) {
            function fromDms(degText, minText, secText, hemisphereText, axis) {
                const degrees = Number(degText), minutes = Number(minText), seconds = Number(secText);
                const hemisphere = (hemisphereText || '').toUpperCase();
                const limit = axis === 'lat' ? 90 : 180;
                const magnitude = Math.abs(degrees);
                if ((axis === 'lat' && /[EW]/.test(hemisphere)) || (axis === 'lng' && /[NS]/.test(hemisphere)) ||
                    minutes >= 60 || seconds >= 60 || magnitude > limit ||
                    (magnitude === limit && (minutes > 0 || seconds > 0)) ||
                    ((/[NE]/.test(hemisphere) && degrees < 0) || (/[SW]/.test(hemisphere) && degrees > 0))) return null;
                let result = magnitude + minutes / 60 + seconds / 3600;
                if (degrees < 0 || /[SW]/.test(hemisphere)) result *= -1;
                return result;
            }
            const lat = fromDms(dms[2], dms[3], dms[4], dms[1] || dms[5], 'lat');
            const lng = fromDms(dms[7], dms[8], dms[9], dms[6] || dms[10], 'lng');
            if (lat !== null && lng !== null) return { lat, lng };
        }
        function component(degreeText, minuteText, hemisphereText, axis) {
            const degrees = Number(degreeText);
            const minutes = minuteText === undefined ? 0 : Number(minuteText);
            const hemisphere = (hemisphereText || '').toUpperCase();
            if ((axis === 'lat' && /[EW]/.test(hemisphere)) || (axis === 'lng' && /[NS]/.test(hemisphere))) return null;
            if (minutes >= 60 || (minuteText !== undefined && degrees < 0)) return null;
            const limit = axis === 'lat' ? 90 : 180;
            if (Math.abs(degrees) > limit || (Math.abs(degrees) === limit && minutes > 0)) return null;
            if ((/[NE]/.test(hemisphere) && degrees < 0) || (/[SW]/.test(hemisphere) && degrees > 0)) return null;
            let result = Math.abs(degrees) + minutes / 60;
            if (degrees < 0 || /[SW]/.test(hemisphere)) result *= -1;
            return result;
        }
        const latDdmLngDecimal = /^\s*([NS])?\s*(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)([NS])?\s+([EW])?\s*([+-]?\d{1,3}(?:\.\d+)?)([EW])?\s*$/i.exec(value);
        if (latDdmLngDecimal) {
            const latHemisphere = latDdmLngDecimal[1] || latDdmLngDecimal[4];
            const lngHemisphere = latDdmLngDecimal[5] || latDdmLngDecimal[7];
            const lat = component(latDdmLngDecimal[2], latDdmLngDecimal[3], latHemisphere, 'lat');
            const lng = component(latDdmLngDecimal[6], undefined, lngHemisphere, 'lng');
            if (lat !== null && lng !== null) return { lat, lng };
        }
        const latDecimalLngDdm = /^\s*([NS])?\s*([+-]?\d{1,2}(?:\.\d+)?)([NS])?\s+([EW])?\s*(\d{1,3})\s+(\d{1,2}(?:\.\d+)?)([EW])?\s*$/i.exec(value);
        if (latDecimalLngDdm) {
            const latHemisphere = latDecimalLngDdm[1] || latDecimalLngDdm[3];
            const lngHemisphere = latDecimalLngDdm[4] || latDecimalLngDdm[7];
            const lat = component(latDecimalLngDdm[2], undefined, latHemisphere, 'lat');
            const lng = component(latDecimalLngDdm[5], latDecimalLngDdm[6], lngHemisphere, 'lng');
            if (lat !== null && lng !== null) return { lat, lng };
        }
        const plainDdm = /^\s*([+-]?\d{1,2})\s+(\d{1,2}(?:\.\d+)?)\s+([+-]?\d{1,3})\s+(\d{1,2}(?:\.\d+)?)\s*$/i.exec(value);
        if (plainDdm) {
            const latDegrees = Number(plainDdm[1]), latMinutes = Number(plainDdm[2]);
            const lngDegrees = Number(plainDdm[3]), lngMinutes = Number(plainDdm[4]);
            if (latMinutes >= 60 || lngMinutes >= 60 || Math.abs(latDegrees) > 90 || Math.abs(lngDegrees) > 180 || (Math.abs(latDegrees) === 90 && latMinutes > 0) || (Math.abs(lngDegrees) === 180 && lngMinutes > 0)) return null;
            return {
                lat: Math.sign(latDegrees || 1) * (Math.abs(latDegrees) + latMinutes / 60),
                lng: Math.sign(lngDegrees || 1) * (Math.abs(lngDegrees) + lngMinutes / 60),
            };
        }
        const hemisphereDdm = /^\s*([NS])\s*(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)\s+([EW])\s*(\d{1,3})\s+(\d{1,2}(?:\.\d+)?)\s*$/i.exec(value);
        if (hemisphereDdm) {
            const latDegrees = Number(hemisphereDdm[2]), latMinutes = Number(hemisphereDdm[3]);
            const lngDegrees = Number(hemisphereDdm[5]), lngMinutes = Number(hemisphereDdm[6]);
            if (latMinutes >= 60 || lngMinutes >= 60 || latDegrees > 90 || lngDegrees > 180 || (latDegrees === 90 && latMinutes > 0) || (lngDegrees === 180 && lngMinutes > 0)) return null;
            return {
                lat: (hemisphereDdm[1].toUpperCase() === 'S' ? -1 : 1) * (latDegrees + latMinutes / 60),
                lng: (hemisphereDdm[4].toUpperCase() === 'W' ? -1 : 1) * (lngDegrees + lngMinutes / 60),
            };
        }
        const part = String.raw`[NSEW]?\s*[+-]?\d{1,3}(?:\.\d+)?(?:\s*[°º]\s*\d{1,2}(?:\.\d+)?\s*['′]?)?\s*[NSEW]?`;
        const pair = new RegExp(`^\\s*(${part})\\s*(?:[,;]\\s*|\\s+)(${part})\\s*$`, 'i').exec(value);
        if (!pair) return null;
        function parsePart(raw, axis) {
            const match = /^([NSEW])?([+-]?\d{1,3}(?:\.\d+)?)(?:[°º](\d{1,2}(?:\.\d+)?)[′']?)?([NSEW])?$/i.exec(raw.replace(/\s+/g, ''));
            if (!match) return null;
            const hemisphere = (match[1] || match[4] || '').toUpperCase();
            if ((match[1] && match[4]) || (axis === 'lat' && /[EW]/.test(hemisphere)) || (axis === 'lng' && /[NS]/.test(hemisphere))) return null;
            const degrees = Number(match[2]);
            const minutes = match[3] === undefined ? 0 : Number(match[3]);
            if (minutes >= 60 || (match[3] !== undefined && degrees < 0)) return null;
            let result = Math.abs(degrees) + minutes / 60;
            if (degrees < 0 || /[SW]/.test(hemisphere)) result *= -1;
            if ((/[NE]/.test(hemisphere) && degrees < 0) || (/[SW]/.test(hemisphere) && degrees > 0)) return null;
            return result;
        }
        const lat = parsePart(pair[1], 'lat');
        const lng = parsePart(pair[2], 'lng');
        if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        return { lat, lng };
    }
    function renderBookmarks() {
        const places = LS.get('bookmarks', []);
        $('#bookmark-list').html(places.length ? places.map((p, i) =>
            `<div class="place-bookmark"><button type="button" class="place-bookmark-go" data-index="${i}" title="Auf Karte zeigen"><span class="place-bookmark-label">${escHtml(p.label)}</span>${p.detail ? `<small class="place-bookmark-detail">${escHtml(p.detail)}</small>` : ''}</button><button type="button" class="place-bookmark-delete" data-index="${i}" title="Lesezeichen löschen" aria-label="${escHtml(p.label)} löschen">×</button></div>`
        ).join('') : '<div class="small text-muted p-2">Noch keine gespeicherten Orte.</div>');
    }
    async function resolveDistancePoint(query) {
        const value = query.trim();
        if (!value) throw new Error('Bitte Start- und Zielpunkt angeben.');
        const coords = parseCoordinatePair(value);
        if (coords) return { ...coords, label: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` };
        const waypointMatches = Object.values(ownWaypoints).filter(wp => wp.name.toLocaleLowerCase('de').includes(value.toLocaleLowerCase('de')));
        if (/^(home|zuhause|daheim)$/i.test(value)) {
            const home = Object.values(ownWaypoints).find(wp => Number(wp.is_home) === 1);
            if (home) return { lat: +home.lat, lng: +home.lng, label: `Zuhause · ${home.name}` };
            throw new Error('Es ist noch kein Home-Standort festgelegt.');
        }
        if (waypointMatches.length === 1) {
            const wp = waypointMatches[0];
            return { lat: +wp.lat, lng: +wp.lng, label: wp.name };
        }
        if (waypointMatches.length > 1) throw new Error('Mehrere eigene Wegpunkte passen. Bitte den Namen genauer eingeben.');
        const gcCode = value.toUpperCase().match(/^GC[A-Z0-9]+$/)?.[0];
        if (gcCode) {
            const response = await fetch(`api/cache_detail.php?gc_code=${encodeURIComponent(gcCode)}`);
            const data = await response.json();
            if (!response.ok || !data.success || !data.cache) throw new Error(`${gcCode} ist nicht in der lokalen Cache-Datenbank.`);
            return { lat: +data.cache.lat, lng: +data.cache.lng, label: `${data.cache.name} (${gcCode})` };
        }
        const wait = Math.max(0, 1000 - (Date.now() - lastGeocodeAt));
        if (wait) await new Promise(resolve => setTimeout(resolve, wait));
        lastGeocodeAt = Date.now();
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.search = new URLSearchParams({ q: value, format: 'jsonv2', limit: '1', 'accept-language': 'de' });
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Ortssuche nicht erreichbar.');
        const [place] = await response.json();
        if (!place) throw new Error(`Kein Ort für „${value}“ gefunden.`);
        const bb = place.boundingbox?.map(Number);
        return {
            lat: bb?.length === 4 ? (bb[0] + bb[1]) / 2 : +place.lat,
            lng: bb?.length === 4 ? (bb[2] + bb[3]) / 2 : +place.lon,
            label: place.display_name,
        };
    }
    $('#btn-distance-toggle').on('click', function () {
        const open = $('#distance-form').hasClass('d-none');
        $('#distance-form').toggleClass('d-none', !open);
        $(this).attr('aria-expanded', String(open));
        if (open && !$('#distance-from').val()) {
            const center = map.getCenter();
            $('#distance-from').val(`${center.lat.toFixed(6)} ${center.lng.toFixed(6)}`);
        }
    });
    $('#btn-distance-pick-target').on('click', function () {
        distanceTargetPick = !distanceTargetPick;
        $(this).toggleClass('active', distanceTargetPick).attr('aria-pressed', String(distanceTargetPick));
        $('#map').toggleClass('distance-pick-mode', distanceTargetPick);
        $('#distance-status').text(distanceTargetPick ? 'Klicke auf die Karte, um den Zielpunkt festzulegen.' : 'Kartenwahl abgebrochen.');
    });
    $('#btn-distance-clear').on('click', function () {
        if (distanceLayer) map.removeLayer(distanceLayer);
        distanceLayer = null;
        if (distancePickMarker) map.removeLayer(distancePickMarker);
        distancePickMarker = null;
        $('#distance-status').text('');
    });
    $('#distance-form').on('submit', async function (event) {
        event.preventDefault();
        const button = $(this).find('[type="submit"]');
        button.prop('disabled', true);
        $('#distance-status').text('Punkte werden gesucht …');
        try {
            const from = await resolveDistancePoint($('#distance-from').val());
            const to = await resolveDistancePoint($('#distance-to').val());
            if (distancePickMarker) { map.removeLayer(distancePickMarker); distancePickMarker = null; }
            $('#distance-status').text('Fußweg wird berechnet …');
            const coordStr = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            let data;
            try {
                const response = await fetch(`https://osrm.oklabflensburg.de/foot/route/v1/driving/${coordStr}?overview=full&geometries=geojson`, { signal: controller.signal });
                data = response.ok ? await response.json() : null;
            } finally { clearTimeout(timeout); }
            const route = data?.code === 'Ok' ? data.routes?.[0] : null;
            if (!route?.geometry?.coordinates?.length) throw new Error('Keine Fußwegroute zwischen diesen Punkten gefunden.');
            if (distanceLayer) map.removeLayer(distanceLayer);
            distanceLayer = L.featureGroup([
                L.geoJSON(route.geometry, { style: { color: '#198754', weight: 5, opacity: .85 } }),
                L.circleMarker([from.lat, from.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#198754', fillOpacity: 1 }).bindTooltip(`Start: ${escHtml(from.label)}`),
                L.circleMarker([to.lat, to.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#dc3545', fillOpacity: 1 }).bindTooltip(`Ziel: ${escHtml(to.label)}`),
            ]).addTo(map);
            map.fitBounds(distanceLayer.getBounds(), { padding: [45, 45], maxZoom: 15 });
            const km = route.distance / 1000;
            const minutes = Math.round(route.duration / 60);
            $('#distance-status').text(`${from.label} → ${to.label}: ${km < 10 ? km.toFixed(2) : km.toFixed(1)} km · etwa ${minutes} Min. zu Fuß`);
        } catch (error) {
            $('#distance-status').text(error.name === 'AbortError' ? 'Die Routenberechnung hat zu lange gedauert.' : error.message || 'Die Route konnte nicht berechnet werden.');
        } finally { button.prop('disabled', false); }
    });
    $('#place-search-form').on('submit', async function (e) {
        e.preventDefault();
        const query = $('#place-search-input').val().trim();
        if (!query) return;
        const gcCode = query.toUpperCase().match(/^GC[A-Z0-9]+$/)?.[0];
        if (gcCode) {
            $('#place-search-status').text(`${gcCode} wird gesucht …`);
            $('#place-search-results').empty();
            try {
                const response = await fetch(`api/cache_detail.php?gc_code=${encodeURIComponent(gcCode)}`);
                const data = await response.json();
                if (!response.ok || !data.success || !data.cache) throw new Error();
                const cache = data.cache;
                const lat = +cache.lat, lng = +cache.lng;
                const label = `${cache.name} (${gcCode})`;
                cacheReg[gcCode] = cache;
                showPlace(lat, lng, label, 15);
                $('#distance-from').val(`${lat.toFixed(6)} ${lng.toFixed(6)}`);
                if (routeSelectMode) mapClickRouteSelect(gcCode);
                $('#place-search-status').text(`${label} gefunden.`);
            } catch (_) {
                $('#place-search-status').text(`${gcCode} wurde nicht in der lokalen Cache-Datenbank gefunden.`);
            }
            return;
        }
        const coords = parseCoordinatePair(query);
        if (coords) {
            const { lat, lng } = coords;
            showPlace(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`, 15);
            $('#place-search-status').text('Koordinate gefunden.');
            if (routeSelectMode) openWaypointModalAt({ lat, lng, label: 'Koordinatenpunkt' }, 'Wegpunkt');
            return;
        }
        const wait = Math.max(0, 1000 - (Date.now() - lastGeocodeAt));
        $('#place-search-status').text('Suche läuft …');
        await new Promise(resolve => setTimeout(resolve, wait));
        lastGeocodeAt = Date.now();
        try {
            const url = new URL('https://nominatim.openstreetmap.org/search');
            url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', 'accept-language': 'de' });
            const response = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const results = await response.json();
            if (!results.length) { $('#place-search-status').text('Kein Ort gefunden.'); return; }
            $('#place-search-status').text('Treffer: Mittelpunkt anklicken.');
            $('#place-search-results').html(results.map((r, i) => {
                const bb = r.boundingbox?.map(Number);
                const lat = bb?.length === 4 ? (bb[0] + bb[1]) / 2 : +r.lat;
                const lng = bb?.length === 4 ? (bb[2] + bb[3]) / 2 : +r.lon;
                return `<button type="button" class="place-result" data-index="${i}"><span>${escHtml(r.display_name)}</span><small>Mittelpunkt</small></button>`;
            }).join(''));
            $('#place-search-results').data('places', results);
        } catch (err) {
            $('#place-search-status').text('Ortssuche nicht erreichbar. Bitte später erneut versuchen.');
        }
    });
    $('#btn-current-location').on('click', function () {
        const $button = $(this);
        if (!navigator.geolocation) {
            $('#place-search-status').text('Standortbestimmung wird von diesem Browser nicht unterstützt.');
            return;
        }
        $button.prop('disabled', true).text('Standort wird ermittelt…');
        navigator.geolocation.getCurrentPosition(position => {
            const { latitude, longitude } = position.coords;
            showPlace(latitude, longitude, 'Aktueller Standort', 15);
            $('#place-search-status').text('Karte auf deinen aktuellen Standort gesetzt.');
            $button.prop('disabled', false).text('◎ Aktueller Standort');
        }, error => {
            const message = error.code === 1 ? 'Standortfreigabe wurde verweigert.'
                : error.code === 3 ? 'Standort konnte nicht rechtzeitig ermittelt werden.'
                : 'Aktueller Standort ist nicht verfügbar.';
            $('#place-search-status').text(message);
            $button.prop('disabled', false).text('◎ Aktueller Standort');
        }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
    $('#place-search-results').on('click', '.place-result', function () {
        const r = $('#place-search-results').data('places')?.[+this.dataset.index];
        if (!r) return;
        const bb = r.boundingbox?.map(Number);
        const lat = bb?.length === 4 ? (bb[0] + bb[1]) / 2 : +r.lat;
        const lng = bb?.length === 4 ? (bb[2] + bb[3]) / 2 : +r.lon;
        showPlace(lat, lng, r.display_name, 14);
        $('#distance-from').val(`${lat.toFixed(6)} ${lng.toFixed(6)}`);
        if (routeSelectMode) openWaypointModalAt({ lat, lng, label: r.display_name }, r.display_name.split(',')[0].slice(0, 120));
        $('#place-search-status').text('Kartenmittelpunkt auf den Treffer gesetzt.');
    });
    $('#bookmark-current').on('click', async function () {
        const c = map.getCenter();
        const $button = $(this);
        $button.prop('disabled', true).text('Ort wird ermittelt…');
        let label, detail = '', resolved = true;
        try {
            const place = await reverseGeocode(c.lat, c.lng);
            label = place.label;
            detail = place.detail;
        } catch (_) { label = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`; resolved = false; }
        const places = LS.get('bookmarks', []);
        places.unshift({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), label, detail });
        LS.set('bookmarks', places.slice(0, 50));
        renderBookmarks();
        $('#bookmark-list').removeClass('d-none');
        $('#place-search-status').text(resolved ? '' : 'Rückwärtssuche fehlgeschlagen; Koordinaten gespeichert.');
        $button.prop('disabled', false).text('Kartenmitte merken');
    });
    let centerFlagMarker = null;
    $('#btn-center-flag').on('click', function () {
        const $button = $(this);
        if (centerFlagMarker) {
            map.removeLayer(centerFlagMarker);
            centerFlagMarker = null;
            $button.removeClass('active').attr({ 'aria-pressed': 'false', title: 'Kartenmitte markieren', 'aria-label': 'Kartenmitte markieren' });
            return;
        }
        const center = map.getCenter();
        $('#distance-from').val(`${center.lat.toFixed(6)} ${center.lng.toFixed(6)}`);
        const icon = L.divIcon({
            className: 'center-flag-marker',
            html: '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34"><path d="M7 31V3" stroke="#263238" stroke-width="2.5" stroke-linecap="round"/><path d="M8 4h15l-4 5 4 5H8z" fill="#198754" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/><circle cx="7" cy="31" r="3" fill="#198754" stroke="#fff" stroke-width="1.2"/></svg>',
            iconSize: [28, 34],
            iconAnchor: [7, 31],
        });
        centerFlagMarker = L.marker(center, { icon, keyboard: false, zIndexOffset: 1000 }).addTo(map);
        $button.addClass('active').attr({ 'aria-pressed': 'true', title: 'Markierung ausblenden', 'aria-label': 'Markierung der Kartenmitte ausblenden' });
    });
    $('#bookmark-toggle').on('click', function () { $('#bookmark-list').toggleClass('d-none'); renderBookmarks(); });
    $('#bookmark-list').on('click', '.place-bookmark-go', function () {
        const p = LS.get('bookmarks', [])[+this.dataset.index];
        if (p) showPlace(p.lat, p.lng, p.label, p.zoom || 14);
    }).on('click', '.place-bookmark-delete', function () {
        const places = LS.get('bookmarks', []);
        places.splice(+this.dataset.index, 1);
        LS.set('bookmarks', places);
        renderBookmarks();
    });
    renderBookmarks();
    function setPlaceSearchOpen(open) {
        $('#place-search').toggleClass('place-search-hidden', !open);
        $('#btn-toggle-search').toggleClass('active', open).attr('aria-expanded', String(open));
        LS.set('placeSearchOpen', open);
    }
    setPlaceSearchOpen(LS.get('placeSearchOpen', true));
    $('#btn-toggle-search').on('click', function () {
        setPlaceSearchOpen($('#place-search').hasClass('place-search-hidden'));
    });

    // ── Map init ──────────────────────────────────────────────────────────────
    const saved  = LS.get('map', null);
    const map = L.map('map', { zoomControl: false, keyboard: false })
        .setView(saved ? [saved.lat, saved.lng] : [54.75, 9.5], saved ? saved.zoom : 12);
    map.createPane('coordinateGridPane');
    map.getPane('coordinateGridPane').style.zIndex = 450;
    const mapElement = map.getContainer();
    mapElement.setAttribute('tabindex', '0');
    mapElement.setAttribute('aria-label', 'Karte. Plus und Minus zoomen, Pfeiltasten verschieben die Karte.');
    let pointerPosition = null;
    document.addEventListener('pointermove', event => {
        pointerPosition = { x: event.clientX, y: event.clientY };
    });
    function zoomMapAtPointer(delta, recenter = false) {
        const rect = mapElement.getBoundingClientRect();
        const pointerIsOverMap = pointerPosition && pointerPosition.x >= rect.left && pointerPosition.x <= rect.right &&
            pointerPosition.y >= rect.top && pointerPosition.y <= rect.bottom;
        const point = pointerIsOverMap
            ? L.point(pointerPosition.x - rect.left, pointerPosition.y - rect.top)
            : map.getSize().divideBy(2);
        const zoom = map.getZoom() + delta;
        if (recenter && pointerIsOverMap) {
            map.setView(map.containerPointToLatLng(point), zoom);
        } else {
            map.setZoomAround(point, zoom);
        }
    }
    $(document).on('keydown', function (event) {
        const target = event.target;
        const rect = mapElement.getBoundingClientRect();
        const pointerOverMap = pointerPosition && pointerPosition.x >= rect.left && pointerPosition.x <= rect.right &&
            pointerPosition.y >= rect.top && pointerPosition.y <= rect.bottom;
        const editingText = target?.matches('input, textarea, select, [contenteditable="true"]');
        if (editingText || $(target).closest('.modal.show').length || !(pointerOverMap || target === mapElement)) return;

        if (event.key === '+' || event.key === '*' || event.key === '=' || event.code === 'NumpadAdd') {
            event.preventDefault();
            zoomMapAtPointer(1, event.shiftKey);
        } else if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
            event.preventDefault();
            zoomMapAtPointer(-1, event.shiftKey);
        } else {
            const pan = {
                ArrowLeft: [-80, 0], ArrowRight: [80, 0],
                ArrowUp: [0, -80], ArrowDown: [0, 80],
            }[event.key];
            if (pan) {
                event.preventDefault();
                map.panBy(pan, { animate: true });
            }
        }
    });
    map.on('move', function () {
        if (centerFlagMarker) {
            const center = map.getCenter();
            centerFlagMarker.setLatLng(center);
            $('#distance-from').val(`${center.lat.toFixed(6)} ${center.lng.toFixed(6)}`);
        }
    });
    function hideSidePanelsOnMapClick() {
        if (!routeSelectMode && !inRouteMode && $('#list-panel').hasClass('panel-open')) setPanelOpen(false);
        if ($('#sidebar').hasClass('sidebar-open')) closeSidebar();
    }
    function closeAdditionalMapMenus() {
        $('#map-style-menu, #map-overlay-menu, #map-filter-menu').addClass('d-none');
        $('#btn-map-styles, #btn-map-overlays, #btn-map-filters')
            .removeClass('active').attr('aria-expanded', 'false');
    }
    map.on('click', function (event) {
        hideSidePanelsOnMapClick();
        closeAdditionalMapMenus();
        if (waypointPickMode) {
            event.distanceTargetPickHandled = true;
            waypointPickMode = false;
            $('#map').removeClass('waypoint-pick-mode');
            $('#btn-waypoint-pick').removeClass('active').attr('aria-pressed', 'false');
            const { lat, lng } = event.latlng;
            waypointDraftPoint = { lat, lng, label: 'Kartenpunkt' };
            $('#waypoint-location').val(`${lat.toFixed(6)} ${lng.toFixed(6)}`);
            $('#waypoint-modal-status').text(`Position gewählt: ${lat.toFixed(6)} ${lng.toFixed(6)}`);
            if (waypointDraftMarker) map.removeLayer(waypointDraftMarker);
            waypointDraftMarker = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#7c3aed', fillOpacity: 1 }).addTo(map);
            waypointModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('waypoint-modal'));
            waypointModal.show();
            return;
        }
        if (!distanceTargetPick) return;
        event.distanceTargetPickHandled = true;
        distanceTargetPick = false;
        $('#btn-distance-pick-target').removeClass('active').attr('aria-pressed', 'false');
        $('#map').removeClass('distance-pick-mode');
        const { lat, lng } = event.latlng;
        $('#distance-to').val(`${lat.toFixed(6)} ${lng.toFixed(6)}`);
        if (distancePickMarker) map.removeLayer(distancePickMarker);
        distancePickMarker = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#dc3545', fillOpacity: 1 }).addTo(map);
        $('#distance-status').text('Zielpunkt auf der Karte gesetzt.');
    });

    const mapStyles = {
        standard: {
            url: window.GC_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
        hot: {
            url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · style <a href="https://www.openstreetmap.fr/">OpenStreetMap France / HOT</a>',
        },
        cyclosm: {
            url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · style <a href="https://www.cyclosm.org/">CyclOSM</a>',
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Imagery sources: <a href="https://www.esri.com/">Esri</a>, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community',
        },
        hybrid: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Imagery sources: <a href="https://www.esri.com/">Esri</a>, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community',
            overlayUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
            overlayAttribution: 'Place names and boundaries: Esri, Garmin, HERE, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community',
            roadsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
            roadsAttribution: 'Roads and transportation labels: Esri, Garmin, HERE, and the GIS user community',
        },
    };
    let mapStyle = LS.get('mapStyle', 'standard');
    if (!mapStyles[mapStyle]) mapStyle = 'standard';
    $('#map-style-select').val(mapStyle);
    let baseLayer;
    let baseOverlays = [];
    function applyMapStyle(style) {
        if (baseLayer) map.removeLayer(baseLayer);
        baseOverlays.forEach(layer => map.removeLayer(layer));
        baseOverlays = [];
        const config = mapStyles[style];
        baseLayer = L.tileLayer(config.url, {
            attribution: config.attribution,
            maxZoom: 19,
            crossOrigin: 'anonymous',
        }).addTo(map);
        if (config.roadsUrl) {
            baseOverlays.push(L.tileLayer(config.roadsUrl, {
                attribution: config.roadsAttribution,
                maxZoom: 19,
                crossOrigin: 'anonymous',
                zIndex: 2,
            }).addTo(map));
        }
        if (config.overlayUrl) {
            baseOverlays.push(L.tileLayer(config.overlayUrl, {
                attribution: config.overlayAttribution,
                maxZoom: 19,
                crossOrigin: 'anonymous',
                zIndex: 3,
            }).addTo(map));
        }
    }
    applyMapStyle(mapStyle);

    ['map-ctrl-col', 'map-style-menu', 'map-overlay-menu', 'map-filter-menu'].forEach(id => {
        const element = document.getElementById(id);
        if (element) L.DomEvent.disableClickPropagation(element);
    });
    const mapMenuAnchors = [
        ['#map-style-menu', '#btn-map-styles'],
        ['#map-overlay-menu', '#btn-map-overlays'],
        ['#map-filter-menu', '#btn-map-filters'],
    ];
    function positionMapMenu(menuSelector, buttonSelector) {
        const menu = document.querySelector(menuSelector);
        const button = document.querySelector(buttonSelector);
        if (!menu || !button || menu.classList.contains('d-none')) return;
        const buttonRect = button.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const left = Math.min(buttonRect.right + 8, window.innerWidth - menuRect.width - 8);
        const top = Math.max(8, Math.min(buttonRect.top, window.innerHeight - menuRect.height - 8));
        menu.style.left = `${Math.max(8, left)}px`;
        menu.style.top = `${top}px`;
    }
    function positionOpenMapMenus() {
        mapMenuAnchors.forEach(([menu, button]) => positionMapMenu(menu, button));
    }

    $('#btn-map-styles').on('click', function () {
        const open = $('#map-style-menu').hasClass('d-none');
        $('#map-style-menu').toggleClass('d-none', !open);
        $('#map-overlay-menu').addClass('d-none');
        $('#map-filter-menu').addClass('d-none');
        $('#btn-map-overlays').removeClass('active').attr('aria-expanded', 'false');
        $('#btn-map-filters').removeClass('active').attr('aria-expanded', 'false');
        $(this).toggleClass('active', open).attr('aria-expanded', String(open));
        if (open) positionMapMenu('#map-style-menu', '#btn-map-styles');
    });
    $('#btn-map-overlays').on('click', function () {
        const open = $('#map-overlay-menu').hasClass('d-none');
        $('#map-overlay-menu').toggleClass('d-none', !open);
        $('#map-style-menu').addClass('d-none');
        $('#map-filter-menu').addClass('d-none');
        $('#btn-map-styles').removeClass('active').attr('aria-expanded', 'false');
        $('#btn-map-filters').removeClass('active').attr('aria-expanded', 'false');
        $(this).toggleClass('active', open).attr('aria-expanded', String(open));
        if (open) positionMapMenu('#map-overlay-menu', '#btn-map-overlays');
    });
    $('#map-style-select').on('change', function () {
        mapStyle = this.value;
        if (!mapStyles[mapStyle]) return;
        applyMapStyle(mapStyle);
        LS.set('mapStyle', mapStyle);
    });

    // ── Optional imagery and weather layers ─────────────────────────────────
    const satelliteAttribution = 'Wolken-Satellitenbild © <a href="https://www.dwd.de/DE/leistungen/geodienste/geodienste.html">Deutscher Wetterdienst (DWD)</a>';
    let satelliteLayerEnabled = false;
    let satelliteLayer = null;
    let satelliteOpacity = Math.min(80, Math.max(20, Number(LS.get('satelliteOpacity', 45)) || 45));
    $('#satellite-opacity').val(satelliteOpacity);
    $('#satellite-opacity-value').text(`${satelliteOpacity} %`);
    $('#satellite-opacity').on('input', function () {
        satelliteOpacity = Math.min(80, Math.max(20, Number(this.value) || 45));
        $('#satellite-opacity-value').text(`${satelliteOpacity} %`);
        LS.set('satelliteOpacity', satelliteOpacity);
        satelliteLayer?.setOpacity(satelliteOpacity / 100);
    });
    function setSatelliteLayerEnabled(enabled) {
        satelliteLayerEnabled = enabled;
        $('#toggle-satellite-layer').prop('checked', enabled);
        LS.set('satelliteOverlay', enabled);
        if (enabled) {
            satelliteLayer = L.tileLayer.wms('api/satellite.php', {
                layers: 'SAT_EU_central_RGB_cloud',
                format: 'image/png', transparent: true, version: '1.1.1',
                opacity: satelliteOpacity / 100, maxZoom: 19, zIndex: 6,
                updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1,
                attribution: satelliteAttribution,
            });
            satelliteLayer.on('loading', () => $('#satellite-layer-status').text('DWD-Wolkenbild wird geladen …'));
            satelliteLayer.on('load', () => $('#satellite-layer-status').text('DWD-Meteosat · Wolkenbild geladen.'));
            satelliteLayer.on('tileerror', () => $('#satellite-layer-status').text('DWD-Wolkenbild über den Server nicht erreichbar.'));
            satelliteLayer.addTo(map);
            map.attributionControl?.addAttribution(satelliteAttribution);
        } else {
            if (satelliteLayer) { map.removeLayer(satelliteLayer); satelliteLayer = null; }
            map.attributionControl?.removeAttribution(satelliteAttribution);
            $('#satellite-layer-status').text('');
        }
    }
    $('#toggle-satellite-layer').prop('checked', satelliteLayerEnabled);
    if (LS.get('satelliteOverlay', false)) setSatelliteLayerEnabled(true);
    $('#toggle-satellite-layer').on('change', function () {
        setSatelliteLayerEnabled(this.checked);
    });

    const radarEnabled = LS.get('radarLayer', false);
    let radarLayer = null;
    let radarRefreshTimer = null;
    let radarRequestId = 0;
    $('#toggle-radar-layer').prop('checked', radarEnabled);
    async function refreshRadarLayer() {
        if (!$('#toggle-radar-layer').prop('checked')) return;
        const requestId = ++radarRequestId;
        $('#radar-layer-status').text('Radardaten werden geladen …');
        try {
            const response = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const manifest = await response.json();
            const frame = manifest.radar?.past?.at(-1);
            if (!manifest.host || !frame?.path) throw new Error('Kein aktuelles Radarbild verfügbar.');
            if (requestId !== radarRequestId || !$('#toggle-radar-layer').prop('checked')) return;
            if (radarLayer) map.removeLayer(radarLayer);
            radarLayer = L.tileLayer(`${manifest.host}${frame.path}/256/{z}/{x}/{y}/2/0_0.png`, {
                attribution: 'Wetterradar © <a href="https://www.rainviewer.com/">RainViewer</a>',
                maxNativeZoom: 7, maxZoom: 19, opacity: 0.68, zIndex: 7,
                crossOrigin: 'anonymous', updateWhenIdle: true,
            }).addTo(map);
            map.attributionControl?.addAttribution('Wetterradar © <a href="https://www.rainviewer.com/">RainViewer</a>');
            const frameTime = new Date(Number(frame.time) * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            $('#radar-layer-status').text(`RainViewer · Bildzeit ${frameTime} · Aktualisierung alle 5 Min.`);
        } catch (error) {
            if (requestId === radarRequestId) $('#radar-layer-status').text(`Radarbild nicht erreichbar: ${error.message || 'Verbindungsfehler'}`);
        } finally {
            clearTimeout(radarRefreshTimer);
            if ($('#toggle-radar-layer').prop('checked')) radarRefreshTimer = setTimeout(refreshRadarLayer, 5 * 60 * 1000);
        }
    }
    $('#toggle-radar-layer').on('change', function () {
        LS.set('radarLayer', this.checked);
        if (this.checked) {
            map.attributionControl?.addAttribution('Wetterradar © <a href="https://www.rainviewer.com/">RainViewer</a>');
            refreshRadarLayer();
        } else {
            radarRequestId++;
            clearTimeout(radarRefreshTimer);
            if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
            map.attributionControl?.removeAttribution('Wetterradar © <a href="https://www.rainviewer.com/">RainViewer</a>');
            $('#radar-layer-status').text('');
        }
    });
    if (radarEnabled) {
        map.attributionControl?.addAttribution('Wetterradar © <a href="https://www.rainviewer.com/">RainViewer</a>');
        refreshRadarLayer();
    }

    // ── ICON-EU 10 m wind vectors ────────────────────────────────────────────
    const windAttribution = 'Windmodell ICON-EU © <a href="https://www.dwd.de/">Deutscher Wetterdienst</a>';
    const windPane = map.createPane('windVectorsPane');
    windPane.style.zIndex = '650';
    windPane.style.pointerEvents = 'auto';
    const windLayer = L.layerGroup([], { pane: 'windVectorsPane' });
    let windRequestId = 0;
    let windRefreshTimer = null;
    let windAbortController = null;
    const windModelControl = L.control({ position: 'bottomleft' });
    let windModelControlElement = null;
    windModelControl.onAdd = () => {
        windModelControlElement = L.DomUtil.create('div', 'wind-model-control d-none');
        L.DomEvent.disableClickPropagation(windModelControlElement);
        L.DomEvent.disableScrollPropagation(windModelControlElement);
        return windModelControlElement;
    };
    windModelControl.addTo(map);
    $('#toggle-wind-layer').prop('checked', LS.get('windLayer', false));
    function updateWindModelControl(data) {
        if (!windModelControlElement) return;
        const match = String(data.run || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
        const runLabel = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}Z` : 'unbekannter Lauf';
        const forecastHour = String(Number(data.forecastHour) || 0).padStart(2, '0');
        windModelControlElement.innerHTML = `<strong>${data.model || 'ICON-EU'}</strong><span>Lauf ${runLabel} · H+${forecastHour}</span>`;
        windModelControlElement.classList.remove('d-none');
    }
    function windDescription(point) {
        const speedKmh = point.speed * 3.6;
        const speedKnots = point.speed * 1.943844;
        const degrees = (Math.round(point.bearing) + 360) % 360;
        const compassPoints = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const compass = compassPoints[Math.round(degrees / 22.5) % 16];
        return `${speedKmh.toFixed(1)} km/h · ${point.speed.toFixed(1)} m/s · ${speedKnots.toFixed(1)} kt · weht nach ${degrees}° (${compass})`;
    }
    function windBarbSvg(point) {
        const windDirection = (point.bearing + 180) % 360;
        const speedKmh = point.speed * 3.6;
        const lengthScale = Math.min(1.55, Math.max(0.75, 0.75 + speedKmh / 100 * 0.8));
        let knots = Math.round(point.speed * 1.943844 / 5) * 5;
        const marks = [];
        while (knots >= 50) { marks.push('pennant'); knots -= 50; }
        while (knots >= 10) { marks.push('full'); knots -= 10; }
        if (knots >= 5) marks.push('half');
        if (!marks.length) {
            return `<svg class="wind-barb-svg" viewBox="0 0 88 88" role="img" aria-label="Windstille"><circle cx="44" cy="44" r="5" fill="#123653" stroke="#fff" stroke-width="2.5"/></svg>`;
        }
        // Lay out marks from the outer end of the staff toward the station.
        // Each barb projects perpendicular to the staff.
        let y = 15;
        let feathers = '';
        let featherOutlines = '';
        for (const mark of marks) {
            if (mark === 'pennant') {
                const d = `M44 ${y} L59 ${y + 7} L44 ${y + 14} Z`;
                feathers += `<path class="wind-barb-filled" d="${d}"/>`;
                featherOutlines += `<path class="wind-barb-outline" d="${d}"/>`;
                y += 14;
            } else if (mark === 'full') {
                const d = `M44 ${y} L58 ${y}`;
                feathers += `<path class="wind-barb-line" d="${d}"/>`;
                featherOutlines += `<path class="wind-barb-outline" d="${d}"/>`;
                y += 6;
            } else {
                const d = `M44 ${y} L51 ${y}`;
                feathers += `<path class="wind-barb-line" d="${d}"/>`;
                featherOutlines += `<path class="wind-barb-outline" d="${d}"/>`;
            }
        }
        return `<svg class="wind-barb-svg" viewBox="0 0 88 88" role="img" aria-label="${windDescription(point)}"><g transform="translate(44 44) rotate(${windDirection}) scale(1 ${lengthScale}) translate(-44 -44)"><path class="wind-barb-outline" d="M44 44 L44 13"/>${featherOutlines}<path class="wind-barb-staff" d="M44 44 L44 13"/>${feathers}</g></svg>`;
    }
    function scheduleWindRefresh(delay = 350) {
        clearTimeout(windRefreshTimer);
        windRefreshTimer = setTimeout(refreshWindLayer, delay);
    }
    async function refreshWindLayer() {
        if (!$('#toggle-wind-layer').prop('checked')) return;
        const requestId = ++windRequestId;
        windAbortController?.abort();
        windAbortController = new AbortController();
        const bounds = map.getBounds();
        const params = new URLSearchParams({
            w: bounds.getWest().toFixed(5), s: bounds.getSouth().toFixed(5),
            e: bounds.getEast().toFixed(5), n: bounds.getNorth().toFixed(5),
        });
        if (windModelControlElement) {
            windModelControlElement.textContent = 'Windmodell wird geladen …';
            windModelControlElement.classList.remove('d-none');
        }
        $('#wind-layer-status').text('Winddaten werden geladen (große Ausschnitte mit ICON 13) …');
        try {
            const response = await fetch(`api/wind.php?${params}`, { cache: 'no-store', signal: windAbortController.signal });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
            if (requestId !== windRequestId || !$('#toggle-wind-layer').prop('checked')) return;
            windLayer.clearLayers();
            for (const point of data.points || []) {
                const marker = L.marker([point.lat, point.lon], {
                    pane: 'windVectorsPane',
                    interactive: true,
                    bubblingMouseEvents: true,
                    keyboard: false,
                    icon: L.divIcon({
                        className: 'wind-vector-icon',
                        html: windBarbSvg(point),
                        iconSize: [32, 32], iconAnchor: [16, 16],
                    }),
                    title: windDescription(point),
                });
                marker.bindTooltip(windDescription(point), { direction: 'top', offset: [0, -8], opacity: 0.95 });
                windLayer.addLayer(marker);
            }
            windLayer.addTo(map);
            map.attributionControl?.addAttribution(windAttribution);
            updateWindModelControl(data);
            const valid = new Date(data.validTime).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
            $('#wind-layer-status').text(`${data.model} · gültig ${valid} · ${data.points.length} Punkte · Fieder zeigt die Richtung, in die der Wind weht`);
        } catch (error) {
            if (error.name === 'AbortError' || requestId !== windRequestId) return;
            if (windModelControlElement) windModelControlElement.textContent = 'Winddaten nicht verfügbar';
            $('#wind-layer-status').text(`Winddaten nicht erreichbar: ${error.message || 'Verbindungsfehler'}`);
        }
    }
    $('#toggle-wind-layer').on('change', function () {
        LS.set('windLayer', this.checked);
        if (this.checked) {
            map.attributionControl?.addAttribution(windAttribution);
            refreshWindLayer();
        } else {
            windRequestId++;
            clearTimeout(windRefreshTimer);
            windAbortController?.abort();
            windLayer.clearLayers();
            if (map.hasLayer(windLayer)) map.removeLayer(windLayer);
            map.attributionControl?.removeAttribution(windAttribution);
            windModelControlElement?.classList.add('d-none');
            $('#wind-layer-status').text('');
        }
    });
    map.on('moveend zoomend', () => {
        if ($('#toggle-wind-layer').prop('checked')) scheduleWindRefresh();
    });
    if ($('#toggle-wind-layer').prop('checked')) {
        map.attributionControl?.addAttribution(windAttribution);
        scheduleWindRefresh(0);
    }

    // ── Coordinate grid, country boundaries and coastlines ──────────────────
    const contextOverlay = L.layerGroup();
    const coordinateGrid = L.layerGroup();
    const boundaryLines = L.layerGroup();
    contextOverlay.addLayer(coordinateGrid);
    contextOverlay.addLayer(boundaryLines);
    const contextAttribution = 'Ländergrenzen und Küsten © <a href="https://www.naturalearthdata.com/">Natural Earth</a>';
    let boundaryDataPromise = null;
    let boundaryDataLoaded = false;
    async function loadBoundaryData() {
        if (boundaryDataLoaded || boundaryDataPromise) return boundaryDataPromise;
        $('#coordinate-grid-status').text('Ländergrenzen und Küsten werden geladen …');
        boundaryDataPromise = Promise.all([
            fetch('assets/data/ne_50m_admin_0_boundary_lines_land.geojson'),
            fetch('assets/data/ne_50m_land_coastline.geojson'),
        ]).then(async ([countryResponse, coastResponse]) => {
            if (!countryResponse.ok || !coastResponse.ok) throw new Error('Lokale Grenzdaten nicht erreichbar.');
            const [countries, coastlines] = await Promise.all([countryResponse.json(), coastResponse.json()]);
            L.geoJSON(coastlines, {
                pane: 'coordinateGridPane',
                interactive: false,
                style: { color: '#b8edff', weight: 1.35, opacity: 0.95 },
            }).addTo(boundaryLines);
            L.geoJSON(countries, {
                pane: 'coordinateGridPane',
                interactive: false,
                style: { color: '#ffe28a', weight: 1.5, opacity: 0.95, dashArray: '4 2' },
            }).addTo(boundaryLines);
            boundaryDataLoaded = true;
            $('#coordinate-grid-status').text('Küsten und Ländergrenzen · Natural Earth');
        }).catch(error => {
            boundaryDataPromise = null;
            $('#coordinate-grid-status').text(error.message || 'Grenzdaten konnten nicht geladen werden.');
        });
        return boundaryDataPromise;
    }
    function gridStep(zoom) {
        if (zoom < 3) return 30;
        if (zoom < 5) return 10;
        if (zoom < 7) return 5;
        if (zoom < 9) return 2;
        if (zoom < 11) return 1;
        if (zoom < 13) return 0.5;
        if (zoom < 15) return 0.1;
        return 0.05;
    }
    function coordinateLabel(value, axis, step) {
        const abs = Math.abs(value);
        const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
        const direction = axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
        return `${abs.toFixed(decimals)}°${direction}`;
    }
    function updateCoordinateGrid() {
        if (!map.hasLayer(contextOverlay)) return;
        coordinateGrid.clearLayers();
        const bounds = map.getBounds();
        const south = Math.max(-85, bounds.getSouth()), north = Math.min(85, bounds.getNorth());
        const west = bounds.getWest(), east = bounds.getEast();
        const step = gridStep(map.getZoom());
        const lineStyle = { color: '#fff', weight: 1, opacity: 0.48, dashArray: '4 5', interactive: false, pane: 'coordinateGridPane' };
        const addLabel = (lat, lng, text) => L.marker([lat, lng], {
            pane: 'coordinateGridPane',
            icon: L.divIcon({ className: 'coordinate-grid-label', html: escHtml(text), iconSize: null }),
            interactive: false, keyboard: false,
        }).addTo(coordinateGrid);

        for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
            const value = +lat.toFixed(6);
            L.polyline([[value, west], [value, east]], lineStyle).addTo(coordinateGrid);
            addLabel(value, west, coordinateLabel(value, 'lat', step));
        }
        for (let lng = Math.ceil(west / step) * step; lng <= east; lng += step) {
            const value = +lng.toFixed(6);
            L.polyline([[south, value], [north, value]], lineStyle).addTo(coordinateGrid);
            addLabel(south, value, coordinateLabel(value, 'lng', step));
        }
    }
    const coordinateGridEnabled = LS.get('coordinateGrid', false);
    $('#toggle-coordinate-grid').prop('checked', coordinateGridEnabled);
    if (coordinateGridEnabled) {
        contextOverlay.addTo(map);
        map.attributionControl?.addAttribution(contextAttribution);
        loadBoundaryData();
    }
    updateCoordinateGrid();
    map.on('moveend zoomend resize', updateCoordinateGrid);
    $('#toggle-coordinate-grid').on('change', function () {
        LS.set('coordinateGrid', this.checked);
        if (this.checked) {
            contextOverlay.addTo(map);
            map.attributionControl?.addAttribution(contextAttribution);
            loadBoundaryData();
            updateCoordinateGrid();
        } else {
            coordinateGrid.clearLayers();
            map.removeLayer(contextOverlay);
            map.attributionControl?.removeAttribution(contextAttribution);
            $('#coordinate-grid-status').text('');
        }
    });

    // ── Shopping POI overlay (OpenStreetMap / Overpass API) ─────────────────
    const shoppingLayer = L.layerGroup();
    const shoppingLayerEnabled = LS.get('shoppingLayer', false);
    const shoppingBrandsEnabled = LS.get('shoppingBrands', true);
    const shoppingOtherEnabled = LS.get('shoppingOther', true);
    const shoppingCacheKey = 'shoppingPoiCacheV2';
    const shoppingCacheTtl = 24 * 60 * 60 * 1000;
    let shoppingLoadTimer = null;
    let shoppingRequest = null;
    let shoppingRequestId = 0;
    let shoppingCurrentElements = null;
    let shoppingCurrentBounds = null;
    let shoppingCurrentSource = '';
    $('#toggle-shopping-layer').prop('checked', shoppingLayerEnabled);
    $('#toggle-shopping-brands').prop('checked', shoppingBrandsEnabled);
    $('#toggle-shopping-other').prop('checked', shoppingOtherEnabled);
    $('#shopping-category-options input').prop('disabled', !shoppingLayerEnabled);

    const shopLabels = {
        supermarket: 'Supermarkt', convenience: 'Kiosk / Nahversorgung', grocery: 'Lebensmittelgeschäft',
        mall: 'Einkaufszentrum', department_store: 'Kaufhaus', general: 'Gemischtwarenladen',
        bakery: 'Bäckerei', butcher: 'Fleischerei', greengrocer: 'Obst- und Gemüseladen',
        farm: 'Hofladen', beverages: 'Getränkemarkt', alcohol: 'Spirituosengeschäft', kiosk: 'Kiosk',
        clothes: 'Bekleidungsgeschäft', shoes: 'Schuhgeschäft', chemist: 'Drogerie', pharmacy: 'Apotheke',
        discount: 'Discounter', electronics: 'Elektronikgeschäft', hardware: 'Baumarkt',
        books: 'Buchhandlung', optician: 'Optiker', florist: 'Blumengeschäft', furniture: 'Möbelgeschäft',
        variety_store: 'Sonderpostenmarkt', toys: 'Spielwarengeschäft', gift: 'Geschenkeladen',
    };
    // Use the shop's own site icon as a compact brand mark, rather than drawing
    // its name into the map marker. Unknown brands keep the generic shop icon.
    const shopBrands = [
        { match: /netto\s*(marken.discount|markendiscount)|netto\s*discount/i, label: 'Netto Marken-Discount', domain: 'netto-online.de' },
        { match: /aldi\s*nord/i, label: 'ALDI Nord', domain: 'aldi-nord.de', className: 'aldi' },
        { match: /aldi\s*s[uü]d|\baldi\b/i, label: 'ALDI Süd', domain: 'aldi-sued.de', className: 'aldi' },
        { match: /lidl/i, label: 'Lidl', domain: 'lidl.de' },
        { match: /rewe/i, label: 'REWE', domain: 'rewe.de' },
        { match: /edeka/i, label: 'EDEKA', domain: 'edeka.de' },
        { match: /penny/i, label: 'PENNY', domain: 'penny.de' },
        { match: /kaufland/i, label: 'Kaufland', domain: 'kaufland.de' },
        { match: /rossmann/i, label: 'ROSSMANN', domain: 'rossmann.de' },
        { match: /(^|\s)dm(\s|$)|dm-drogerie/i, label: 'dm', domain: 'dm.de', className: 'dm' },
        { match: /m[uü]ller/i, label: 'Müller', domain: 'mueller.de' },
        { match: /norma/i, label: 'NORMA', domain: 'norma-online.de' },
        { match: /tegut/i, label: 'tegut', domain: 'tegut.com' },
    ];
    function getShopBrand(tags) {
        const identity = [tags.brand, tags.operator, tags.name].filter(Boolean).join(' ');
        return shopBrands.find(brand => brand.match.test(identity)) || null;
    }
    function renderShoppingPlaces(elements, bounds) {
        shoppingLayer.clearLayers();
        let count = 0;
        elements.forEach(function (element) {
            const lat = element.lat ?? element.center?.lat;
            const lng = element.lon ?? element.center?.lon;
            if (!Number.isFinite(+lat) || !Number.isFinite(+lng) || !bounds.contains([+lat, +lng])) return;
            const tags = element.tags || {};
            const brand = getShopBrand(tags);
            if (brand ? !$('#toggle-shopping-brands').prop('checked') : !$('#toggle-shopping-other').prop('checked')) return;
            const type = tags.amenity === 'marketplace' ? 'Markt'
                : tags.amenity === 'pharmacy' ? 'Apotheke'
                : (shopLabels[tags.shop] || 'Geschäft');
            const title = tags.name || tags.brand || tags.operator || type;
            const address = [tags['addr:street'], tags['addr:housenumber'], tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
            const icon = L.divIcon({
                className: 'shopping-poi-icon',
                html: brand
                    ? `<span class="shopping-brand-logo ${brand.className || ''}" title="${escHtml(brand.label)}"><img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(brand.domain)}&amp;sz=64" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"></span>`
                    : '<span class="shopping-cart-logo" aria-hidden="true">🛒</span>',
                iconSize: brand?.className === 'aldi' || brand?.className === 'dm' ? [38, 38] : brand ? [32, 32] : [28, 28],
                iconAnchor: brand?.className === 'aldi' || brand?.className === 'dm' ? [19, 19] : brand ? [16, 16] : [14, 14],
            });
            L.marker([+lat, +lng], { icon, keyboard: false, bubblingMouseEvents: false })
                .bindTooltip(`<strong>${escHtml(title)}</strong><br>${escHtml(type)}${address ? `<br>${escHtml(address)}` : ''}`, { direction: 'top' })
                .addTo(shoppingLayer);
            count++;
        });
        return count;
    }
    function loadShoppingPlaces() {
        clearTimeout(shoppingLoadTimer);
        if (!$('#toggle-shopping-layer').prop('checked')) return;
        shoppingLoadTimer = setTimeout(async function () {
            if (map.getZoom() < 12) {
                $('#shopping-layer-status').text('Zum Laden bitte näher heranzoomen (Zoom 12 oder höher).');
                shoppingLayer.clearLayers();
                return;
            }
            const bounds = map.getBounds();
            const currentBox = { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
            const now = Date.now();
            const cacheEntries = LS.get(shoppingCacheKey, []).filter(entry =>
                entry && Array.isArray(entry.elements) && now - entry.savedAt < shoppingCacheTtl
            );
            const cached = cacheEntries.find(entry =>
                entry.bbox.south <= currentBox.south && entry.bbox.west <= currentBox.west &&
                entry.bbox.north >= currentBox.north && entry.bbox.east >= currentBox.east
            );
            if (cached) {
                shoppingCurrentElements = cached.elements;
                shoppingCurrentBounds = bounds;
                shoppingCurrentSource = 'lokal gespeichert';
                const count = renderShoppingPlaces(cached.elements, bounds);
                $('#shopping-layer-status').text(`${count} Einkaufsmöglichkeiten · lokal gespeichert`);
                return;
            }

            // Round outward so nearby views can reuse this saved coverage.
            const step = 0.01;
            const box = [
                Math.floor(currentBox.south / step) * step,
                Math.floor(currentBox.west / step) * step,
                Math.ceil(currentBox.north / step) * step,
                Math.ceil(currentBox.east / step) * step,
            ];
            const queryBox = { south: box[0], west: box[1], north: box[2], east: box[3] };
            const bbox = box.join(',');
            const query = `[out:json][timeout:20];(nwr["shop"](${bbox});nwr["amenity"~"^(marketplace|pharmacy)$"](${bbox}););out center;`;
            const requestId = ++shoppingRequestId;
            if (shoppingRequest) shoppingRequest.abort();
            shoppingLayer.clearLayers();
            $('#shopping-layer-status').text('Einkaufsmöglichkeiten werden geladen …');
            try {
                const endpoints = [
                    'https://overpass-api.de/api/interpreter',
                    'https://overpass.private.coffee/api/interpreter',
                ];
                let data = null;
                let lastError = null;
                for (const endpoint of endpoints) {
                    if (requestId !== shoppingRequestId) return;
                    const controller = new AbortController();
                    shoppingRequest = controller;
                    const timeoutId = setTimeout(() => controller.abort(), 9000);
                    try {
                        const response = await fetch(endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                            body: new URLSearchParams({ data: query }),
                            signal: controller.signal,
                        });
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        const result = await response.json();
                        if (!Array.isArray(result.elements)) throw new Error('Ungültige Antwort');
                        data = result;
                        break;
                    } catch (error) {
                        if (requestId !== shoppingRequestId) return;
                        lastError = error;
                    } finally {
                        clearTimeout(timeoutId);
                    }
                }
                if (!data) throw lastError || new Error('Kein Overpass-Endpunkt erreichbar.');
                if (requestId !== shoppingRequestId || !$('#toggle-shopping-layer').prop('checked')) return;
                const elements = data.elements || [];
                shoppingCurrentElements = elements;
                shoppingCurrentBounds = bounds;
                shoppingCurrentSource = 'OpenStreetMap';
                const count = renderShoppingPlaces(elements, bounds);
                const usefulTags = ['shop', 'amenity', 'name', 'brand', 'operator', 'addr:street', 'addr:housenumber', 'addr:postcode', 'addr:city'];
                const compactElements = elements.map(element => ({
                    lat: element.lat ?? null,
                    lon: element.lon ?? null,
                    center: element.center ? { lat: element.center.lat, lon: element.center.lon } : undefined,
                    tags: Object.fromEntries(usefulTags.filter(key => element.tags?.[key]).map(key => [key, element.tags[key]])),
                }));
                cacheEntries.unshift({ savedAt: now, bbox: queryBox, elements: compactElements });
                LS.set(shoppingCacheKey, cacheEntries.slice(0, 8));
                $('#shopping-layer-status').text(`${count} Einkaufsmöglichkeiten · OpenStreetMap`);
            } catch (error) {
                if (error.name === 'AbortError') return;
                $('#shopping-layer-status').text('Einkaufsdaten aktuell nicht erreichbar.');
            }
        }, 450);
    }
    $('#toggle-shopping-layer').on('change', function () {
        const enabled = this.checked;
        LS.set('shoppingLayer', enabled);
        $('#shopping-category-options input').prop('disabled', !enabled);
        if (enabled) {
            shoppingLayer.addTo(map);
            map.attributionControl?.addAttribution('Einkaufsdaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
            loadShoppingPlaces();
        } else {
            clearTimeout(shoppingLoadTimer);
            shoppingRequest?.abort();
            shoppingRequestId++;
            shoppingLayer.clearLayers();
            map.removeLayer(shoppingLayer);
            map.attributionControl?.removeAttribution('Einkaufsdaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
            $('#shopping-layer-status').text('');
        }
    });
    $('#toggle-shopping-brands').on('change', function () {
        LS.set('shoppingBrands', this.checked);
        if (!$('#toggle-shopping-layer').prop('checked')) return;
        if (shoppingCurrentElements && shoppingCurrentBounds) {
            const count = renderShoppingPlaces(shoppingCurrentElements, shoppingCurrentBounds);
            $('#shopping-layer-status').text(`${count} Einkaufsmöglichkeiten${shoppingCurrentSource ? ` · ${shoppingCurrentSource}` : ''}`);
        } else loadShoppingPlaces();
    });
    $('#toggle-shopping-other').on('change', function () {
        LS.set('shoppingOther', this.checked);
        if (!$('#toggle-shopping-layer').prop('checked')) return;
        if (shoppingCurrentElements && shoppingCurrentBounds) {
            const count = renderShoppingPlaces(shoppingCurrentElements, shoppingCurrentBounds);
            $('#shopping-layer-status').text(`${count} Einkaufsmöglichkeiten${shoppingCurrentSource ? ` · ${shoppingCurrentSource}` : ''}`);
        } else loadShoppingPlaces();
    });
    map.on('moveend', loadShoppingPlaces);
    if (shoppingLayerEnabled) {
        shoppingLayer.addTo(map);
        map.attributionControl?.addAttribution('Einkaufsdaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
        loadShoppingPlaces();
    }

    // ── Electric vehicle charging overlay (OpenStreetMap / BNetzA fallback) ─
    const chargingLayer = L.layerGroup();
    const chargingLayerEnabled = LS.get('chargingLayer', false);
    let chargingLoadTimer = null;
    let chargingRequest = null;
    let chargingRequestId = 0;
    const chargingCacheKey = 'chargingPoiCacheV2';
    const chargingCacheTtl = 24 * 60 * 60 * 1000;
    $('#toggle-charging-layer').prop('checked', chargingLayerEnabled);

    function renderChargingStations(elements, bounds) {
        chargingLayer.clearLayers();
        let count = 0;
        elements.forEach(element => {
            const lat = element.lat ?? element.center?.lat;
            const lng = element.lon ?? element.center?.lon;
            if (!Number.isFinite(+lat) || !Number.isFinite(+lng) || !bounds.contains([+lat, +lng])) return;
            const tags = element.tags || {};
            const title = tags.name || tags.operator || 'E-Ladestation';
            const connectors = Object.entries(tags)
                .filter(([key, value]) => /^(socket:|charging_station:|charge:)/.test(key) && value)
                .map(([key, value]) => `${key.replace(/^socket:/, '').replaceAll('_', ' ')}: ${value}`);
            const details = [
                tags.operator ? `Betreiber: ${tags.operator}` : '',
                tags.capacity ? `Ladepunkte: ${tags.capacity}` : '',
                ...connectors.slice(0, 4),
            ].filter(Boolean);
            const icon = L.divIcon({
                className: 'charging-poi-icon',
                html: '<span aria-hidden="true">⚡</span>',
                iconSize: [22, 22], iconAnchor: [11, 11],
            });
            L.marker([+lat, +lng], { icon, keyboard: false, bubblingMouseEvents: false })
                .bindTooltip(`<strong>${escHtml(title)}</strong>${details.length ? `<br>${details.map(escHtml).join('<br>')}` : ''}`, { direction: 'top' })
                .addTo(chargingLayer);
            count++;
        });
        return count;
    }

    async function queryChargingBox(box, requestId) {
        if (requestId !== chargingRequestId) throw new DOMException('Anfrage abgebrochen', 'AbortError');
        const controller = new AbortController();
        chargingRequest = controller;
        const timeoutId = setTimeout(() => controller.abort(), 65000);
        try {
            const response = await fetch('api/charging_stations.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bbox: box }),
                signal: controller.signal,
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
            if (!Array.isArray(data.elements)) throw new Error('Ungültige Antwort vom lokalen Ladesäulen-Endpunkt.');
            return { elements: data.elements, source: data.source || 'OpenStreetMap' };
        } catch (error) {
            if (requestId !== chargingRequestId) throw new DOMException('Anfrage abgebrochen', 'AbortError');
            if (error.name === 'AbortError') throw new Error('Zeitüberschreitung beim lokalen Ladesäulen-Endpunkt.');
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    function loadChargingStations() {
        clearTimeout(chargingLoadTimer);
        if (!$('#toggle-charging-layer').prop('checked')) return;
        chargingLoadTimer = setTimeout(async function () {
            if (map.getZoom() < 12) {
                $('#charging-layer-status').text('Zum Laden bitte näher heranzoomen (Zoom 12 oder höher).');
                chargingLayer.clearLayers();
                return;
            }
            const bounds = map.getBounds();
            const view = { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
            const now = Date.now();
            const entries = LS.get(chargingCacheKey, []).filter(entry =>
                entry && Array.isArray(entry.elements) && now - entry.savedAt < chargingCacheTtl
            );
            const cached = entries.find(entry => entry.bbox.south <= view.south && entry.bbox.west <= view.west &&
                entry.bbox.north >= view.north && entry.bbox.east >= view.east);
            if (cached) {
                const count = renderChargingStations(cached.elements, bounds);
                $('#charging-layer-status').text(`${count} Ladestationen · lokal gespeichert · ${cached.source || 'OpenStreetMap'}`);
                return;
            }
            const step = 0.01;
            const box = [Math.floor(view.south / step) * step, Math.floor(view.west / step) * step,
                Math.ceil(view.north / step) * step, Math.ceil(view.east / step) * step];
            const queryBox = { south: box[0], west: box[1], north: box[2], east: box[3] };
            const requestId = ++chargingRequestId;
            chargingRequest?.abort();
            chargingLayer.clearLayers();
            $('#charging-layer-status').text('Ladesäulen werden geladen …');
            try {
                let elements;
                let source;
                let splitQuery = false;
                try {
                    const result = await queryChargingBox(box, requestId);
                    elements = result.elements;
                    source = result.source;
                } catch (initialError) {
                    if (initialError.name === 'AbortError') return;
                    // Busy public instances often time out on a full viewport.
                    // Retry as four smaller requests to reduce server work.
                    $('#charging-layer-status').text('Großer Kartenausschnitt: Ladesäulen werden in Teilbereichen geladen …');
                    const south = (box[0] + box[2]) / 2;
                    const west = (box[1] + box[3]) / 2;
                    const tiles = [
                        [box[0], box[1], south, west], [box[0], west, south, box[3]],
                        [south, box[1], box[2], west], [south, west, box[2], box[3]],
                    ];
                    elements = [];
                    for (const tile of tiles) {
                        const result = await queryChargingBox(tile, requestId);
                        elements.push(...result.elements);
                        source = result.source;
                    }
                    splitQuery = true;
                }
                if (requestId !== chargingRequestId || !$('#toggle-charging-layer').prop('checked')) return;
                const uniqueElements = [...new Map(elements.map((element, index) => [`${element.type || 'item'}:${element.id ?? index}`, element])).values()];
                const count = renderChargingStations(uniqueElements, bounds);
                const keys = ['name', 'operator', 'brand', 'capacity', 'socket:type2', 'socket:type2:output', 'socket:type2_combo', 'socket:type2_combo:output', 'socket:chademo', 'socket:chademo:output', 'socket:ccs', 'socket:ccs:output', 'charging_station:output', 'charge:output'];
                const compact = uniqueElements.map(element => ({
                    lat: element.lat ?? null, lon: element.lon ?? null,
                    center: element.center ? { lat: element.center.lat, lon: element.center.lon } : undefined,
                    tags: Object.fromEntries(keys.filter(key => element.tags?.[key]).map(key => [key, element.tags[key]])),
                }));
                entries.unshift({ savedAt: now, bbox: queryBox, source, elements: compact });
                LS.set(chargingCacheKey, entries.slice(0, 8));
                $('#charging-layer-status').text(`${count} Ladestationen · ${source || 'OpenStreetMap'}${splitQuery ? ' · in Teilbereichen geladen' : ''}`);
            } catch (error) {
                if (error.name === 'AbortError') return;
                $('#charging-layer-status').text(`Ladesäulendaten nicht erreichbar: ${error.message || 'Verbindungsfehler'}`);
            }
        }, 450);
    }
    $('#toggle-charging-layer').on('change', function () {
        const enabled = this.checked;
        LS.set('chargingLayer', enabled);
        if (enabled) {
            chargingLayer.addTo(map);
            map.attributionControl?.addAttribution('Ladesäulendaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html">Bundesnetzagentur</a>');
            loadChargingStations();
        } else {
            clearTimeout(chargingLoadTimer);
            chargingRequest?.abort();
            chargingRequestId++;
            chargingLayer.clearLayers();
            map.removeLayer(chargingLayer);
            map.attributionControl?.removeAttribution('Ladesäulendaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html">Bundesnetzagentur</a>');
            $('#charging-layer-status').text('');
        }
    });
    map.on('moveend', loadChargingStations);
    if (chargingLayerEnabled) {
        chargingLayer.addTo(map);
        map.attributionControl?.addAttribution('Ladesäulendaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / <a href="https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/start.html">Bundesnetzagentur</a>');
        loadChargingStations();
    }

    // ── Parking overlay (OpenStreetMap / Overpass API) ──────────────────────
    const parkingLayer = L.layerGroup();
    const parkingLayerEnabled = LS.get('parkingLayer', false);
    let parkingLoadTimer = null;
    let parkingRequest = null;
    let parkingRequestId = 0;
    const parkingCacheKey = 'parkingPoiCacheV1';
    const parkingCacheTtl = 24 * 60 * 60 * 1000;
    $('#toggle-parking-layer').prop('checked', parkingLayerEnabled);

    function renderParkingPlaces(elements, bounds) {
        parkingLayer.clearLayers();
        let count = 0;
        elements.forEach(element => {
            const lat = element.lat ?? element.center?.lat;
            const lng = element.lon ?? element.center?.lon;
            if (!Number.isFinite(+lat) || !Number.isFinite(+lng) || !bounds.contains([+lat, +lng])) return;
            const tags = element.tags || {};
            const privateAccess = ['access', 'vehicle', 'motor_vehicle'].some(key =>
                String(tags[key] || '').trim().toLowerCase() === 'private'
            );
            if (privateAccess) return;
            const title = tags.name || tags.operator || 'Parkplatz';
            const details = [
                tags.operator ? `Betreiber: ${tags.operator}` : '',
                tags.capacity ? `Stellplätze: ${tags.capacity}` : '',
                tags['capacity:disabled'] ? `Behindertengerechte Stellplätze: ${tags['capacity:disabled']}` : '',
                tags.fee ? `Gebühren: ${tags.fee === 'yes' ? 'kostenpflichtig' : tags.fee === 'no' ? 'kostenlos' : tags.fee}` : '',
                tags.access && tags.access !== 'yes' ? `Zugang: ${tags.access}` : '',
                tags.surface ? `Oberfläche: ${tags.surface}` : '',
                tags.wheelchair ? `Barrierefrei: ${tags.wheelchair === 'yes' ? 'ja' : tags.wheelchair === 'no' ? 'nein' : tags.wheelchair}` : '',
                tags.opening_hours ? `Öffnungszeiten: ${tags.opening_hours}` : '',
                tags.maxstay ? `Maximale Parkdauer: ${tags.maxstay}` : '',
            ].filter(Boolean);
            const icon = L.divIcon({
                className: 'parking-poi-icon',
                html: '<span aria-hidden="true">P</span>',
                iconSize: [22, 22], iconAnchor: [11, 11],
            });
            L.marker([+lat, +lng], { icon, keyboard: false, bubblingMouseEvents: false })
                .bindTooltip(`<strong>${escHtml(title)}</strong>${details.length ? `<br>${details.map(escHtml).join('<br>')}` : ''}`, { direction: 'top' })
                .addTo(parkingLayer);
            count++;
        });
        return count;
    }

    async function queryParkingBox(box, requestId) {
        if (requestId !== parkingRequestId) throw new DOMException('Anfrage abgebrochen', 'AbortError');
        const controller = new AbortController();
        parkingRequest = controller;
        // The parking API tries multiple independent Overpass instances in
        // sequence, so allow that server-side fallback chain to finish.
        const timeoutId = setTimeout(() => controller.abort(), 45000);
        try {
            const response = await fetch('api/parking.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bbox: box }),
                signal: controller.signal,
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
            if (!Array.isArray(data.elements)) throw new Error('Ungültige Antwort vom Parkplatz-Endpunkt.');
            return data;
        } catch (error) {
            if (requestId !== parkingRequestId) throw new DOMException('Anfrage abgebrochen', 'AbortError');
            if (error.name === 'AbortError') throw new Error('Zeitüberschreitung beim Parkplatz-Endpunkt.');
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    function loadParkingPlaces() {
        clearTimeout(parkingLoadTimer);
        if (!$('#toggle-parking-layer').prop('checked')) return;
        parkingLoadTimer = setTimeout(async () => {
            if (map.getZoom() < 12) {
                $('#parking-layer-status').text('Zum Laden bitte näher heranzoomen (Zoom 12 oder höher).');
                parkingLayer.clearLayers();
                return;
            }
            const bounds = map.getBounds();
            const view = { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
            const now = Date.now();
            const entries = LS.get(parkingCacheKey, []).filter(entry =>
                entry && Array.isArray(entry.elements) && now - entry.savedAt < parkingCacheTtl
            );
            const cached = entries.find(entry => entry.bbox.south <= view.south && entry.bbox.west <= view.west
                && entry.bbox.north >= view.north && entry.bbox.east >= view.east);
            if (cached) {
                const count = renderParkingPlaces(cached.elements, bounds);
                $('#parking-layer-status').text(`${count} Parkplätze · lokal gespeichert · OpenStreetMap`);
                return;
            }
            const step = 0.01;
            const box = [Math.floor(view.south / step) * step, Math.floor(view.west / step) * step,
                Math.ceil(view.north / step) * step, Math.ceil(view.east / step) * step];
            const queryBox = { south: box[0], west: box[1], north: box[2], east: box[3] };
            const requestId = ++parkingRequestId;
            parkingRequest?.abort();
            parkingLayer.clearLayers();
            $('#parking-layer-status').text('Parkplätze werden geladen …');
            try {
                const result = await queryParkingBox(box, requestId);
                if (requestId !== parkingRequestId || !$('#toggle-parking-layer').prop('checked')) return;
                const elements = result.elements;
                const uniqueElements = [...new Map(elements.map((element, index) => [`${element.type || 'item'}:${element.id ?? index}`, element])).values()];
                const count = renderParkingPlaces(uniqueElements, bounds);
                const keys = ['name', 'operator', 'capacity', 'capacity:disabled', 'fee', 'access', 'opening_hours', 'parking', 'surface', 'wheelchair', 'maxstay'];
                const compact = uniqueElements.map(element => ({
                    lat: element.lat ?? null, lon: element.lon ?? null,
                    center: element.center ? { lat: element.center.lat, lon: element.center.lon } : undefined,
                    tags: Object.fromEntries(keys.filter(key => element.tags?.[key]).map(key => [key, element.tags[key]])),
                }));
                entries.unshift({ savedAt: now, bbox: queryBox, elements: compact });
                LS.set(parkingCacheKey, entries.slice(0, 8));
                $('#parking-layer-status').text(`${count} Parkplätze · ${result.source || 'OpenStreetMap'}`);
            } catch (error) {
                if (error.name === 'AbortError') return;
                $('#parking-layer-status').text(`Parkplatzdaten nicht erreichbar: ${error.message || 'Verbindungsfehler'}`);
            }
        }, 450);
    }
    async function refreshParkingDataAfterGeocacheSync() {
        const bounds = map.getBounds();
        const step = 0.01;
        const box = [
            Math.floor(bounds.getSouth() / step) * step,
            Math.floor(bounds.getWest() / step) * step,
            Math.ceil(bounds.getNorth() / step) * step,
            Math.ceil(bounds.getEast() / step) * step,
        ];
        try {
            const response = await fetch('api/parking.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bbox: box, refresh: true }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
            // Drop the browser copy so the next render reads the refreshed DB entry.
            LS.set(parkingCacheKey, []);
            if ($('#toggle-parking-layer').prop('checked')) loadParkingPlaces();
        } catch (error) {
            if ($('#toggle-parking-layer').prop('checked')) {
                $('#parking-layer-status').text(`Parkplatzdaten nach Sync nicht aktualisiert: ${error.message || 'Verbindungsfehler'}`);
            }
        }
    }
    $('#toggle-parking-layer').on('change', function () {
        const enabled = this.checked;
        LS.set('parkingLayer', enabled);
        if (enabled) {
            parkingLayer.addTo(map);
            map.attributionControl?.addAttribution('Parkplatzdaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
            loadParkingPlaces();
        } else {
            clearTimeout(parkingLoadTimer);
            parkingRequest?.abort();
            parkingRequestId++;
            parkingLayer.clearLayers();
            map.removeLayer(parkingLayer);
            map.attributionControl?.removeAttribution('Parkplatzdaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
            $('#parking-layer-status').text('');
        }
    });
    map.on('moveend', loadParkingPlaces);
    if (parkingLayerEnabled) {
        parkingLayer.addTo(map);
        map.attributionControl?.addAttribution('Parkplatzdaten © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
        loadParkingPlaces();
    }

    map.on('moveend zoomend', () => {
        const c = map.getCenter();
        LS.set('map', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    });

    // ── Marker clustering ─────────────────────────────────────────────────────
    const cluster = L.markerClusterGroup({
        maxClusterRadius: 60,
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
    });
    map.addLayer(cluster);

    // ── Draw layer ────────────────────────────────────────────────────────────
    const drawnLayer = new L.FeatureGroup();
    map.addLayer(drawnLayer);

    let drawControl  = null;
    let drawMode     = 'view';
    let currentArea  = null;

    function initDrawCtrl(mode) {
        if (drawControl) map.removeControl(drawControl);
        drawControl = new L.Control.Draw({
            position: 'bottomleft',
            draw: {
                circle:      mode === 'circle'    ? { shapeOptions: { color: '#0d6efd', weight: 2 } } : false,
                rectangle:   mode === 'bbox'      ? { shapeOptions: { color: '#0d6efd', weight: 2 }, showArea: false } : false,
                polygon: false, polyline: false, marker: false, circlemarker: false,
            },
            edit: { featureGroup: drawnLayer },
        });
        map.addControl(drawControl);
    }

    // Restore draw-mode + max-age, then init
    const savedMode   = LS.get('drawmode', 'view');
    const savedMaxAge = LS.get('maxage', null);
    drawMode = savedMode;
    if (drawMode !== 'view') {
        $('[data-mode="view"]').removeClass('active');
        $(`[data-mode="${drawMode}"]`).addClass('active');
        $('#radius-display').toggle(drawMode === 'circle');
        initDrawCtrl(drawMode);
    } else {
        setAreaFromMapView();
    }
    if (savedMaxAge) $('#sel-maxage').val(savedMaxAge);

    // Save draw-mode + max-age on change
    $('#sel-maxage').on('change', () => LS.set('maxage', $('#sel-maxage').val()));

    $('#btn-mode-circle, #btn-mode-bbox, #btn-mode-view').on('click', function () {
        drawMode = $(this).data('mode');
        LS.set('drawmode', drawMode);
        $('#btn-mode-circle, #btn-mode-bbox, #btn-mode-view').removeClass('active');
        $(this).addClass('active');
        $('#radius-display').toggle(drawMode === 'circle');
        drawnLayer.clearLayers();
        currentArea = null;

        if (drawMode === 'view') {
            if (drawControl) { map.removeControl(drawControl); drawControl = null; }
            setAreaFromMapView();
        } else {
            initDrawCtrl(drawMode);
        }
        refreshSyncBtn();
    });

    function setAreaFromMapView() {
        const b = map.getBounds();
        currentArea = {
            mode: 'bbox',
            minLat: b.getSouth(), minLng: b.getWest(),
            maxLat: b.getNorth(), maxLng: b.getEast(),
        };
        refreshSyncBtn();
    }

    let skipNextDbLoad = false;

    map.on('moveend', function () {
        if (drawMode === 'view' && drawnLayer.getLayers().length === 0) setAreaFromMapView();
        if (skipNextDbLoad) { skipNextDbLoad = false; return; }
        scheduleLoadFromDB();
    });

    map.on(L.Draw.Event.CREATED, function (e) {
        drawnLayer.clearLayers();
        drawnLayer.addLayer(e.layer);

        if (e.layerType === 'circle') {
            const c = e.layer.getLatLng();
            const r = Math.round(e.layer.getRadius());
            currentArea = { mode: 'circle', lat: c.lat, lng: c.lng, radius: r };
            $('#radius-display').text((r / 1000).toFixed(1) + ' km');
        } else {
            const b = e.layer.getBounds();
            currentArea = {
                mode: 'bbox',
                minLat: b.getSouth(), minLng: b.getWest(),
                maxLat: b.getNorth(), maxLng: b.getEast(),
            };
        }
        // Switch back to view mode — shape stays on map, currentArea preserved for Sync
        drawMode = 'view';
        $('#btn-mode-circle, #btn-mode-bbox, #btn-mode-view').removeClass('active');
        $('#btn-mode-view').addClass('active');
        $('#radius-display').hide();
        if (drawControl) { map.removeControl(drawControl); drawControl = null; }
        refreshSyncBtn();
    });

    function refreshSyncBtn() {
        $('#btn-sync').prop('disabled', !currentArea);
    }

    function switchToViewMode() {
        drawMode = 'view';
        $('#btn-mode-circle, #btn-mode-bbox, #btn-mode-view').removeClass('active');
        $('#btn-mode-view').addClass('active');
        $('#radius-display').hide();
        drawnLayer.clearLayers();
        currentArea = null;
        if (drawControl) { map.removeControl(drawControl); drawControl = null; }
        setAreaFromMapView();
    }

    // ── Cache type styles ─────────────────────────────────────────────────────
    const TYPE_COLOR = {
        2: '#16a34a', 3: '#2563eb', 4: '#0891b2', 5: '#92400e',
        6: '#dc2626', 8: '#d97706', 11: '#7c3aed', 13: '#059669',
        137: '#65a30d', 453: '#4f46e5', 1304: '#0284c7',
        1858: '#db2777', 3653: '#be185d', 3773: '#0d9488',
    };
    const TYPE_SYMBOL = {
        2: 'T',  3: '?',  4: 'V',  5: 'L',   6: 'E',
        8: 'M',  11: '📷', 13: '♻', 137: '⛰', 453: 'Q',
        1304: 'W', 1858: '★', 3653: '★★', 3773: '⚗',
    };

    const mapFilterTypeLabels = {
        2: 'Traditional Cache', 3: 'Multi-Cache', 4: 'Virtual Cache', 5: 'Letterbox Hybrid',
        6: 'Event', 8: 'Mystery Cache', 9: 'Project A.P.E.', 11: 'Webcam Cache',
        12: 'Locationless Cache', 13: 'CITO Event', 137: 'EarthCache', 453: 'Mega-Event',
        1304: 'GPS Adventures Exhibit', 1858: 'Wherigo', 3653: 'Community Celebration Event',
        3773: 'Geocaching HQ', 3774: 'HQ Celebration', 4738: 'HQ Block Party', 7005: 'Giga-Event',
    };
    let mapCacheFilters = {
        types: Object.keys(mapFilterTypeLabels),
        statuses: ['active', 'disabled', 'archived', 'waypoint'],
        found: ['found', 'notFound'],
    };
    const mapFilterStatuses = { active: 'Aktiv', disabled: 'Deaktiviert', archived: 'Archiviert', waypoint: 'Eigene Wegpunkte' };

    function cacheFoundFilterState(cache) {
        return Number(cache.found_by_user) === 1 || cache.found_by_user === true ? 'found' : 'notFound';
    }

    function cachePassesMapFilters(cache) {
        return mapCacheFilters.types.includes(String(cache.cache_type))
            && mapCacheFilters.statuses.includes(String(cache.status || 'active'))
            && mapCacheFilters.found.includes(cacheFoundFilterState(cache));
    }

    function ownWaypointPassesMapFilters() {
        return mapCacheFilters.statuses.includes('waypoint');
    }

    function renderMapFilterMenu(caches = []) {
        const foundCounts = {
            found: caches.filter(cache => cacheFoundFilterState(cache) === 'found').length,
            notFound: caches.filter(cache => cacheFoundFilterState(cache) === 'notFound').length,
        };
        caches.forEach(cache => {
            const id = String(cache.cache_type);
            if (!(id in mapFilterTypeLabels)) {
                mapFilterTypeLabels[id] = cache.cache_type_name || `Cache-Typ ${id}`;
                mapCacheFilters.types.push(id);
            }
        });
        $('#map-filter-statuses').html(Object.entries(mapFilterStatuses).map(([value, label]) =>
            `<label class="map-filter-option"><input class="form-check-input map-filter-input" type="checkbox" data-filter-group="statuses" value="${value}"${mapCacheFilters.statuses.includes(value) ? ' checked' : ''}><span>${label}</span></label>`
        ).join(''));
        $('#map-filter-found').html([
            ['found', 'Gefunden'], ['notFound', 'Nicht gefunden'],
        ].map(([value, label]) =>
            `<label class="map-filter-option"><input class="form-check-input map-filter-input" type="checkbox" data-filter-group="found" value="${value}"${mapCacheFilters.found.includes(value) ? ' checked' : ''}><span>${label} (${foundCounts[value]})</span></label>`
        ).join(''));
        $('#map-filter-types').html(Object.entries(mapFilterTypeLabels).map(([value, label]) =>
            `<label class="map-filter-option"><input class="form-check-input map-filter-input" type="checkbox" data-filter-group="types" value="${value}"${mapCacheFilters.types.includes(value) ? ' checked' : ''}><span>${escHtml(label)}</span></label>`
        ).join(''));
        const visibilityCount = mapCacheFilters.statuses.filter(id => id in mapFilterStatuses).length
            + mapCacheFilters.found.filter(id => ['found', 'notFound'].includes(id)).length;
        const visibilityTotal = Object.keys(mapFilterStatuses).length + 2;
        const typeCount = Object.keys(mapFilterTypeLabels).filter(id => mapCacheFilters.types.includes(id)).length;
        const typeTotal = Object.keys(mapFilterTypeLabels).length;
        $('#toggle-map-visibility')
            .prop('checked', visibilityCount === visibilityTotal)
            .prop('indeterminate', visibilityCount > 0 && visibilityCount < visibilityTotal);
        $('#toggle-all-cache-types')
            .prop('checked', typeCount === typeTotal)
            .prop('indeterminate', typeCount > 0 && typeCount < typeTotal);
        const allTypesSelected = Object.keys(mapFilterTypeLabels).every(id => mapCacheFilters.types.includes(id));
        const allStatusesSelected = Object.keys(mapFilterStatuses).every(id => mapCacheFilters.statuses.includes(id));
        const allFoundSelected = ['found', 'notFound'].every(id => mapCacheFilters.found.includes(id));
        const hasActiveFilters = !allTypesSelected || !allStatusesSelected || !allFoundSelected;
        $('#btn-map-filters').toggleClass('filtered', hasActiveFilters);
        $('#btn-map-filters').attr('title', hasActiveFilters ? 'Cache-Filter aktiv' : 'Cache-Arten und Status filtern');
    }

    renderMapFilterMenu();
    L.DomEvent.disableClickPropagation(document.getElementById('map-filter-menu'));
    L.DomEvent.disableClickPropagation(document.getElementById('btn-map-filters'));
    $('#btn-map-filters').on('click', function () {
        const open = $('#map-filter-menu').hasClass('d-none');
        $('#map-filter-menu').toggleClass('d-none', !open);
        $('#map-style-menu, #map-overlay-menu').addClass('d-none');
        $('#btn-map-styles, #btn-map-overlays').removeClass('active').attr('aria-expanded', 'false');
        $(this).toggleClass('active', open).attr('aria-expanded', String(open));
        if (open) positionMapMenu('#map-filter-menu', '#btn-map-filters');
    });
    $(document).on('change', '.map-filter-input', function () {
        const group = this.dataset.filterGroup;
        const values = mapCacheFilters[group];
        mapCacheFilters[group] = this.checked
            ? [...new Set([...values, this.value])]
            : values.filter(value => value !== this.value);
        renderMapFilterMenu(panelCaches);
        renderCaches(panelCaches);
    });
    $('#toggle-map-visibility').on('change', function () {
        mapCacheFilters.statuses = this.checked ? Object.keys(mapFilterStatuses) : [];
        mapCacheFilters.found = this.checked ? ['found', 'notFound'] : [];
        renderMapFilterMenu(panelCaches);
        renderCaches(panelCaches);
    });
    $('#toggle-all-cache-types').on('change', function () {
        mapCacheFilters.types = this.checked ? Object.keys(mapFilterTypeLabels) : [];
        renderMapFilterMenu(panelCaches);
        renderCaches(panelCaches);
    });

    function cacheIcon(type, status, found, foundDate) {
        const col    = status === 'archived' ? '#9ca3af' : (TYPE_COLOR[type] || '#6b7280');
        const sym    = TYPE_SYMBOL[type] || '#';
        const isLong = sym.length > 1;
        const fs     = sym.length > 2 ? 5 : isLong ? 6.5 : 8.5;
        const filter = status === 'archived' ? 'grayscale(75%) opacity(.65)'
                     : status === 'disabled' ? 'opacity(.55)' : '';
        const svgPin = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28">'
            + '<path d="M10 1C5.03 1 1 5.03 1 10c0 7 9 17 9 17s9-10 9-17c0-4.97-4.03-9-9-9z"'
            + ' fill="' + col + '" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/>'
            + '<text x="10" y="10.5" text-anchor="middle" dominant-baseline="middle"'
            + ' font-size="' + fs + '" font-weight="700" fill="#fff" font-family="Arial,sans-serif">' + sym + '</text>'
            + '</svg>';
        const styleAttr = filter ? ' style="filter:' + filter + ';width:22px;height:22px;object-fit:contain"'
                                 : ' style="width:22px;height:22px;object-fit:contain"';
        const svgUri = 'data:image/svg+xml,' + encodeURIComponent(svgPin);
        const badge = found
            ? '<div style="position:absolute;top:-3px;right:-3px;width:11px;height:11px;background:#eab308;border-radius:50%;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;">'
              + '<svg width="6" height="5" viewBox="0 0 7 6" fill="none"><path d="M1 3l1.5 1.5L6 1" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
              + '</div>'
            : '';
        return L.divIcon({
            className: '',
            html: '<div style="position:relative;width:22px;height:22px;">'
                + '<img src="assets/img/cache-types/' + type + '.png"' + styleAttr
                + ' onerror="this.src=\'' + svgUri + '\';this.onerror=null">'
                + badge + '</div>',
            iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -13],
        });
    }

    function makeRouteIcon(num) {
        const pin = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="28" viewBox="0 0 20 28">`
            + `<path d="M10 1C5.03 1 1 5.03 1 10c0 7 9 17 9 17s9-10 9-17c0-4.97-4.03-9-9-9z"`
            + ` fill="#0d6efd" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/>`
            + `<text x="10" y="10.5" text-anchor="middle" dominant-baseline="middle"`
            + ` font-size="8.5" font-weight="700" fill="#fff" font-family="Arial,sans-serif">${num}</text>`
            + `</svg>`;
        return L.divIcon({
            className: '',
            html: pin,
            iconSize: [20, 28], iconAnchor: [10, 27], popupAnchor: [0, -28],
        });
    }

    function refreshAllMarkerIcons() {
        Object.entries(markerMap).forEach(function ([gc, m]) {
            const c = cacheReg[gc];
            if (!c) return;
            const idx = selOrder.indexOf(gc);
            m.setIcon(idx > -1 ? makeRouteIcon(idx + 1) : cacheIcon(c.cache_type, c.status, c.found_by_user, c.found_date));
            if (gc === focusedCacheGc) m._icon?.classList.add('marker-focused');
        });
        refreshOwnWaypointMarkers();
    }

    // ── Markers ───────────────────────────────────────────────────────────────
    const markerMap = {};
    let focusedCacheGc = null;
    let globalSearchCaches = [];
    let cacheMarkersVisible = true;
    LS.set('cacheMarkersVisible', true);
    $('#toggle-cache-markers').prop('checked', cacheMarkersVisible);

    function focusCacheOnMap(gcCode) {
        let marker = markerMap[gcCode];
        if (!marker && cacheReg[gcCode]) {
            const c = cacheReg[gcCode];
            const foundNote = c.found_by_user
                ? (c.found_date ? `<br><span style="color:#a16207">✓ Gefunden am ${c.found_date}</span>` : '<br><span style="color:#a16207">✓ Gefunden</span>')
                : '';
            marker = L.marker([c.lat, c.lng], { icon: cacheIcon(c.cache_type, c.status, c.found_by_user, c.found_date) });
            marker.bindTooltip(`<strong>${escHtml(c.name)}</strong><br><span>${escHtml(c.gc_code)}</span><br>${escHtml(c.cache_type_name)} · D${c.difficulty}/T${c.terrain}${foundNote}`, { direction: 'top', offset: [0, -15] });
            marker.on('click', function () {
                hideSidePanelsOnMapClick();
                if (routeSelectMode) mapClickRouteSelect(c.gc_code, true); else showDetail(c.gc_code);
            });
            markerMap[gcCode] = marker;
        }
        if (!marker) return;
        if (!cacheMarkersVisible) {
            focusedCacheGc = gcCode;
            map.flyTo(marker.getLatLng(), 12, { duration: 0.5 });
            return;
        }
        const previous = focusedCacheGc && markerMap[focusedCacheGc];
        if (clusteringOn && previous && previous !== marker) {
            map.removeLayer(previous);
            if (!cluster.hasLayer(previous)) cluster.addLayer(previous);
        }
        focusedCacheGc = gcCode;
        if (clusteringOn && cluster.hasLayer(marker)) cluster.removeLayer(marker);
        if (!map.hasLayer(marker)) map.addLayer(marker);
        Object.values(markerMap).forEach(m => m._icon?.classList.remove('marker-focused'));
        marker._icon?.classList.add('marker-focused');
        map.flyTo(marker.getLatLng(), 12, { duration: 0.5 });
    }

    function renderCaches(caches) {
        renderMapFilterMenu(caches);
        Object.values(ownWaypointMarkers).forEach(marker => {
            if (ownWaypointPassesMapFilters()) {
                if (!map.hasLayer(marker)) marker.addTo(map);
            } else if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        });
        // cluster.clearLayers() rebuilds from internal _layers via _generateInitialClusters,
        // so old markers would reappear. removeLayers() actually removes them from internal state.
        const oldMarkers = Object.values(markerMap);
        if (oldMarkers.length) {
            if (clusteringOn) {
                cluster.removeLayers(oldMarkers);
                oldMarkers.forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
            }
            else              oldMarkers.forEach(m => map.removeLayer(m));
        }
        Object.keys(markerMap).forEach(k => delete markerMap[k]);

        caches.forEach(function (c) {
            // Register before creating clickable markers so route selection can
            // always resolve the cache, even during a marker/list refresh.
            cacheReg[c.gc_code] = c;
            const selIdx   = selOrder.indexOf(c.gc_code);
            const icon     = selIdx > -1 ? makeRouteIcon(selIdx + 1) : cacheIcon(c.cache_type, c.status, c.found_by_user, c.found_date);
            const foundNote = c.found_by_user
                ? (c.found_date ? `<br><span style="color:#a16207">✓ Gefunden am ${c.found_date}</span>`
                                : '<br><span style="color:#a16207">✓ Gefunden</span>')
                : '';
            const m = L.marker([c.lat, c.lng], { icon });
            m.bindTooltip(
                `<strong>${escHtml(c.name)}</strong><br><span>${escHtml(c.gc_code)}</span><br>${escHtml(c.cache_type_name)} · D${c.difficulty}/T${c.terrain}${foundNote}`,
                { direction: 'top', offset: [0, -15] }
            );
            m.on('click', function () {
                hideSidePanelsOnMapClick();
                if (routeSelectMode) { mapClickRouteSelect(c.gc_code, true); }
                else                 { showDetail(c.gc_code); }
            });
            if (cacheMarkersVisible && (selIdx > -1 || cachePassesMapFilters(c))) {
                if (clusteringOn && c.gc_code !== focusedCacheGc) { cluster.addLayer(m); }
                else { map.addLayer(m); }
            }
            markerMap[c.gc_code] = m;
        });

        updateStats();
        if ($('#cache-search').val().trim() && globalSearchCaches.length) renderCacheList(globalSearchCaches, true);
        else renderCacheList(caches);
        // Re-apply active marker highlight after markers are (re)created
        if (activeMarkerGc && markerMap[activeMarkerGc]?._icon) {
            markerMap[activeMarkerGc]._icon.classList.add('marker-active');
        }
        if (focusedCacheGc && markerMap[focusedCacheGc]?._icon) {
            markerMap[focusedCacheGc]._icon.classList.add('marker-focused');
        }
    }

    let dbLoadTimer;
    function scheduleLoadFromDB() {
        clearTimeout(dbLoadTimer);
        dbLoadTimer = setTimeout(loadFromDB, 350);
    }

    function loadFromDB() {
        const b = map.getBounds();
        $.get('api/caches.php', {
            s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast(),
        }).done(d => { if (d.success) renderCaches(d.caches); });
    }

    loadFromDB();   // initial paint

    // ── Sync ──────────────────────────────────────────────────────────────────
    $('#btn-sync').on('click', function () {
        if (!currentArea) return;

        const payload = Object.assign({}, currentArea, {
            force:         $('#chk-force').prop('checked'),
            max_age_hours: parseInt($('#sel-maxage').val(), 10) || 24,
        });

        setStatus('Synchronisiere…', 'text-warning', true);
        $('#btn-sync').prop('disabled', true);

        $.ajax({
            url: 'api/sync.php', type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(payload),
        }).done(function (d) {
            if (d.success) {
                const note = d.skipped ? '(DB-Cache)' : '(geocaching.com)';
                setStatus(`${d.message} ${note}`, 'text-success');
                loadFromDB();
                if (!d.skipped) refreshParkingDataAfterGeocacheSync();
                switchToViewMode();
            } else {
                setStatus('Fehler: ' + d.error, 'text-danger');
            }
        }).fail(function (xhr) {
            let err = xhr.responseText;
            try { err = JSON.parse(err).error; } catch (_) { /* raw */ }
            setStatus('Fehler: ' + err, 'text-danger');
        }).always(function () {
            $('#btn-sync').prop('disabled', false);
            $('#sync-spinner').hide();
        });
    });

    function setStatus(msg, cls, spin) {
        $('#status-msg')
            .removeClass('text-warning text-success text-danger text-muted')
            .addClass(cls).text(msg);
        $('#sync-spinner').toggle(!!spin);
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    function updateStats() {
        $.get('api/status.php').done(function (d) {
            if (!d.success) return;
            const s = d.stats;
            $('#stat-total').text(s.total  || 0);
            $('#stat-active').text(s.active || 0);
            const ts = s.last_sync
                ? new Date(s.last_sync.replace(' ', 'T') + 'Z').toLocaleString('de-DE')
                : '–';
            $('#stat-lastsync').text(ts);
        });
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────
    let currentCache     = null;
    let currentLogTotals = [];
    let currentRecentLogs = [];
    let activeMarkerGc   = null;

    function setActiveMarker(gcCode) {
        if (activeMarkerGc && markerMap[activeMarkerGc]?._icon) {
            markerMap[activeMarkerGc]._icon.classList.remove('marker-active');
        }
        activeMarkerGc = gcCode || null;
        if (activeMarkerGc && markerMap[activeMarkerGc]?._icon) {
            markerMap[activeMarkerGc]._icon.classList.add('marker-active');
        }
    }

    let detailCacheGc = null;
    function showDetail(gcCode) {
        detailCacheGc = gcCode;
        $('.cache-row').removeClass('detail-active').filter(function () {
            return String($(this).data('gc')) === gcCode;
        }).addClass('detail-active');
        $('#sidebar-detail').html(spinnerHtml('Lade Cache-Details…'));
        openSidebar();
        setActiveMarker(gcCode);

        $.get('api/cache_detail.php', { gc_code: gcCode }).done(function (d) {
            if (!d.success) {
                $('#sidebar-detail').html(alertHtml(d.error, 'danger'));
                return;
            }
            currentCache      = d.cache;
            currentLogTotals  = d.log_totals  || [];
            currentRecentLogs = d.recent_logs || [];

            $('#sidebar-detail').html(buildDetailHtml(currentCache));
            bindHintDecoder('#sidebar-detail');

            // Auto-load web details if not yet in DB
            if (!d.cache.encoded_hints && !d.cache.short_description && !d.cache.long_description) {
                fetchWebDetails(gcCode);
            }
        }).fail(function () {
            $('#sidebar-detail').html(alertHtml('Verbindungsfehler.', 'danger'));
        });
    }

    function fetchWebDetails(gcCode) {
        $('#web-details-status').html(spinnerSmall() + ' Lade Details…');
        $.get('api/cache_detail.php', { gc_code: gcCode, refresh_details: 1 }).done(function (d) {
            if (!d.success) { $('#web-details-status').empty(); return; }

            // Merge into currentCache so modal always has fresh data
            if (currentCache && d.cache.gc_code === currentCache.gc_code) {
                currentCache.encoded_hints     = d.cache.encoded_hints;
                currentCache.short_description = d.cache.short_description;
                currentCache.long_description  = d.cache.long_description;
                if (d.log_totals   && d.log_totals.length)   currentLogTotals  = d.log_totals;
                if (d.recent_logs  && d.recent_logs.length)  currentRecentLogs = d.recent_logs;
            }

            // Update sidebar hint
            if (d.cache.encoded_hints) {
                $('#hint-placeholder').html(buildHintHtml(d.cache.encoded_hints));
                bindHintDecoder('#hint-placeholder');
            }
            // Update sidebar short description only
            if (d.cache.short_description) {
                $('#desc-placeholder').html(buildShortDescHtml(d.cache.short_description));
            }
            $('#web-details-status').empty();
        }).fail(function () { $('#web-details-status').empty(); });
    }

    function bindHintDecoder(scope) {
        $(scope).find('#btn-decode-hint').on('click', function () {
            const $enc = $(this).closest('.hint-box').find('.hint-encoded');
            $enc.text(rot13($enc.text())).addClass('text-success');
            $(this).remove();
        });
    }

    function buildHintHtml(encoded) {
        return `<div class="hint-box">
          <div class="sidebar-header text-muted text-uppercase mb-1">Hinweis (ROT13)</div>
          <div class="font-monospace small border rounded p-2 bg-light hint-encoded" style="word-break:break-all;">${escHtml(encoded)}</div>
          <button class="btn btn-sm btn-outline-secondary mt-1" id="btn-decode-hint">Entschlüsseln</button>
        </div>`;
    }

    function buildShortDescHtml(html) {
        return `<div class="mb-2">
          <div class="text-muted text-uppercase mb-1" style="font-size:.68rem;letter-spacing:.04em">Kurzbeschreibung</div>
          <div class="small border rounded p-2 bg-light" style="max-height:100px;overflow:auto;">${html}</div>
        </div>`;
    }

    // ── Detail Modal ─────────────────────────────────────────────────────────
    $(document).on('click', '#btn-open-detail-modal', function () {
        if (!currentCache) return;
        const c = currentCache;
        const gcUrl = `https://www.geocaching.com/geocache/${c.gc_code}`;
        $('#cache-modal-title').text(c.name);
        $('#cache-modal-link').attr('href', gcUrl + '?log=y');
        $('#cache-modal-body').html(buildModalHtml(c, currentLogTotals, currentRecentLogs));
        bindHintDecoder('#cache-modal-body');
        new bootstrap.Modal(document.getElementById('cache-detail-modal')).show();

        // Logs nachladen falls noch nicht vorhanden
        if (!currentRecentLogs.length) {
            $('#modal-recent-logs').html(
                `<div class="text-muted small">${spinnerSmall()} Lade Logs…</div>`
            );
            $.get('api/cache_detail.php', { gc_code: c.gc_code, refresh_details: 1 })
                .done(function (d) {
                    if (!d.success) { $('#modal-recent-logs').empty(); return; }
                    if (d.cache && d.cache.gc_code === currentCache?.gc_code) {
                        currentCache = d.cache;
                        if (cacheReg[d.cache.gc_code]) cacheReg[d.cache.gc_code].status = d.cache.status;
                        refreshAllMarkerIcons();
                        $('#cache-modal-body').html(buildModalHtml(currentCache, currentLogTotals, currentRecentLogs));
                        bindHintDecoder('#cache-modal-body');
                        if (detailCacheGc === d.cache.gc_code) {
                            $('#sidebar-detail').html(buildDetailHtml(currentCache));
                            bindHintDecoder('#sidebar-detail');
                        }
                    }
                    if (d.log_totals  && d.log_totals.length)  { currentLogTotals  = d.log_totals;  $('#modal-log-totals').html(buildModalLogTotalsHtml(d.log_totals)); }
                    if (d.recent_logs && d.recent_logs.length) { currentRecentLogs = d.recent_logs; $('#modal-recent-logs').html(buildRecentLogsHtml(d.recent_logs)); }
                    else $('#modal-recent-logs').html('<p class="text-muted small">Keine Logs verfügbar.</p>');
                })
                .fail(() => $('#modal-recent-logs').html('<p class="text-muted small text-danger">Fehler beim Laden.</p>'));
        }
    });

    function buildModalLogTotalsHtml(logTotals) {
        const LOGTYPES = {'Found it':'✓',"Didn't find it":'✗','Write note':'📝','Attended':'🎉','Will Attend':'📅','Needs Maintenance':'🔧','Temporarily disable listing':'🔒','Enable listing':'🔓','Owner maintenance':'🔧','Owner attention requested':'⚠️'};
        if (!logTotals || !logTotals.length) return '';
        return logTotals.filter(t => t.count > 0).map(t => {
            const icon = LOGTYPES[t.name] || '📋';
            const date = t.last_date ? `<span class="text-muted ms-1" style="font-size:.75rem;">${t.last_date}</span>` : '';
            return `<span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1" style="font-size:.8rem;">${icon} ${t.count}× ${escHtml(t.name)}${date}</span>`;
        }).join('');
    }

    function fmtDate(iso) {
        if (!iso) return '';
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
    }

    function buildRecentLogsHtml(logs) {
        const LOGTYPES = {'Found it':'✓',"Didn't find it":'✗','Write note':'📝','Attended':'🎉','Will Attend':'📅','Needs Maintenance':'🔧','Temporarily disable listing':'🔒','Enable listing':'🔓','Owner maintenance':'🔧','Owner attention requested':'⚠️'};
        return logs.map(l => {
            const icon = LOGTYPES[l.type] || '📋';
            const fav  = l.fav ? ' ⭐' : '';
            const date = fmtDate(l.date);
            const txt  = l.text
                ? `<div class="text-muted mt-1" style="font-size:.82rem;white-space:pre-wrap;">${escHtml(l.text.slice(0, 400))}${l.text.length > 400 ? '…' : ''}</div>`
                : '';
            return `<div class="border-start border-2 border-primary ps-3 mb-3">
              <div class="d-flex justify-content-between align-items-baseline">
                <span class="fw-semibold small">${icon} ${escHtml(l.user)}${fav}</span>
                <span class="badge bg-light text-secondary" style="font-size:.72rem;">${date}</span>
              </div>
              <div class="text-muted" style="font-size:.75rem;">${escHtml(l.type)}</div>
              ${txt}
            </div>`;
        }).join('');
    }

    function buildModalHtml(c, logTotals, recentLogs) {
        const SI = 'assets/img/icons/';
        const stars = n => {
            n = parseFloat(n) || 0;
            const full  = Math.floor(n);
            const half  = (n % 1) >= 0.5 ? 1 : 0;
            const empty = 5 - full - half;
            const s = (file, op) => `<img src="${SI}${file}" width="16" height="16" style="object-fit:contain${op ? ';opacity:' + op : ''}">`;
            return Array(full).fill(s('star5.png')).join('')
                 + (half ? s('star3.png') : '')
                 + Array(empty).fill(s('star1.png', .25)).join('')
                 + ` <span class="text-muted">${n.toFixed(1)}</span>`;
        };

        const badge = status => ({
            active:   '<span class="badge bg-success">Aktiv</span>',
            disabled: '<span class="badge bg-warning text-dark">Deaktiviert</span>',
            archived: '<span class="badge bg-secondary">Archiviert</span>',
        }[status] || '');

        const needsMaintenance = Array.isArray(c.attributes) && c.attributes.some(attribute =>
            Number(attribute.id) === 42 && (attribute.isApplicable === true || attribute.isApplicable === 1 || attribute.isApplicable === '1')
        );
        const statusNotices = [];
        if (c.status === 'archived') {
            statusNotices.push('<div class="alert alert-secondary py-2 px-3 mb-3" role="status"><strong>Archiviert:</strong> Dieser Cache ist dauerhaft archiviert und kann in der Regel nicht mehr gesucht werden.</div>');
        } else if (c.status === 'disabled') {
            statusNotices.push('<div class="alert alert-warning py-2 px-3 mb-3" role="status"><strong>Deaktiviert:</strong> Dieser Cache ist vorübergehend deaktiviert.</div>');
        }
        if (needsMaintenance) {
            statusNotices.push('<div class="alert alert-warning py-2 px-3 mb-3" role="status"><strong>Wartung erforderlich:</strong> Für diesen Cache wurde Wartungsbedarf gemeldet.</div>');
        }

        const foundRow = c.found_by_user
            ? `<tr><th style="color:#a16207">✓ Gefunden</th><td style="color:#a16207">${c.found_date || 'Datum unbekannt'}</td></tr>`
            : '';

        const longDesc = c.long_description
            ? `<section class="mb-4">
                <h6 class="text-uppercase text-muted fw-semibold mb-2" style="letter-spacing:.05em;font-size:.75rem;">Beschreibung</h6>
                <div class="border rounded p-3 bg-light cache-description">${c.long_description}</div>
               </section>`
            : '';

        const shortDesc = c.short_description
            ? `<section class="mb-3">
                <h6 class="text-uppercase text-muted fw-semibold mb-2" style="letter-spacing:.05em;font-size:.75rem;">Kurzbeschreibung</h6>
                <div class="border rounded p-3 bg-light cache-description">${c.short_description}</div>
               </section>`
            : '';

        const attributeSlugs = {
            1:'dogs',2:'fee',3:'rappelling',4:'boat',5:'scuba',6:'kids',7:'onehour',8:'scenic',9:'hiking',10:'climbing',
            11:'wading',12:'swimming',13:'available',14:'night',15:'winter',16:'cactus',17:'poisonoak',18:'dangerousanimals',
            19:'ticks',20:'mine',21:'cliff',22:'hunting',23:'danger',24:'wheelchair',25:'parking',26:'public',27:'water',
            28:'restrooms',29:'phone',30:'picnic',31:'camping',32:'bicycles',33:'motorcycles',34:'quads',35:'jeeps',
            36:'snowmobiles',37:'horses',38:'campfires',39:'thorn',40:'stealth',41:'stroller',42:'firstaid',43:'cow',
            44:'flashlight',45:'landf',46:'rv',47:'field_puzzle',48:'UV',49:'snowshoes',50:'skiis',51:'s-tool',
            52:'nightcache',53:'parkngrab',54:'AbandonedBuilding',55:'hike_short',56:'hike_med',57:'hike_long',
            58:'fuel',59:'food',60:'wirelessbeacon',61:'partnership',62:'seasonal',63:'touristOK',64:'treeclimbing',
            65:'frontyard',66:'teamwork'
        };
        const attributes = Array.isArray(c.attributes) ? c.attributes : [];
        const attributesSection = attributes.length ? `<section class="mb-4">
          <h6 class="text-uppercase text-muted fw-semibold mb-2" style="letter-spacing:.05em;font-size:.75rem;">Attribute</h6>
          <div class="d-flex flex-wrap gap-2">${attributes.map(attribute => {
              const id = Number(attribute.id);
              const on = attribute.isApplicable === true || attribute.isApplicable === 1 || attribute.isApplicable === '1';
              const slug = attributeSlugs[id];
              const label = String(attribute.name || `Attribut ${id}`);
              const iconUrl = slug ? `https://www.geocaching.com/images/attributes/${encodeURIComponent(slug)}-${on ? 'yes' : 'no'}.gif` : '';
              return `<span class="cache-attribute" title="${escHtml(label)}: ${on ? 'Ja' : 'Nein'}">${iconUrl ? `<img src="${iconUrl}" alt="" loading="lazy" onerror="this.hidden=true">` : '<span class="cache-attribute-fallback">i</span>'}<span>${escHtml(label)}</span></span>`;
          }).join('')}</div>
        </section>` : '';

        const hintSection = c.encoded_hints
            ? `<section class="mb-4">
                <h6 class="text-uppercase text-muted fw-semibold mb-2" style="letter-spacing:.05em;font-size:.75rem;">Hinweis (ROT13)</h6>
                <div class="hint-box">
                  <div class="font-monospace border rounded p-3 bg-light hint-encoded" style="word-break:break-all;">${escHtml(c.encoded_hints)}</div>
                  <button class="btn btn-sm btn-outline-secondary mt-2" id="btn-decode-hint">Entschlüsseln</button>
                </div>
               </section>`
            : '';

        const logSection = `<section class="mb-3">
                <h6 class="text-uppercase text-muted fw-semibold mb-2" style="letter-spacing:.05em;font-size:.75rem;">Log-Statistik</h6>
                <div id="modal-log-totals" class="d-flex flex-wrap gap-2">${buildModalLogTotalsHtml(logTotals)}</div>
               </section>`;

        const recentSection = `<section class="mb-2">
                <h6 class="text-uppercase text-muted fw-semibold mb-3" style="letter-spacing:.05em;font-size:.75rem;">Letzte Logs</h6>
                <div id="modal-recent-logs">${recentLogs && recentLogs.length ? buildRecentLogsHtml(recentLogs) : ''}</div>
               </section>`;

        return `
<div class="d-flex align-items-center gap-2 mb-3">
  <a href="https://www.geocaching.com/geocache/${c.gc_code}" target="_blank" class="badge bg-primary text-decoration-none fs-6">${escHtml(c.gc_code)}</a>
  ${badge(c.status)}
  <span class="text-muted small">${escHtml(c.cache_type_name || '')} · ${escHtml(c.container_size || '–')}</span>
</div>

${statusNotices.join('')}

<div class="row g-2 mb-3">
  <div class="col-6">
    <div class="border rounded p-2 text-center">
      <div class="text-muted mb-1" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em">Schwierigkeit</div>
      <div>${stars(c.difficulty)}</div>
    </div>
  </div>
  <div class="col-6">
    <div class="border rounded p-2 text-center">
      <div class="text-muted mb-1" style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em">Gelände</div>
      <div>${stars(c.terrain)}</div>
    </div>
  </div>
</div>

<table class="table table-sm mb-4">
  ${foundRow}
  <tr><th class="text-muted fw-normal" style="width:35%">Owner</th><td>${escHtml(c.owner || '–')}</td></tr>
  <tr><th class="text-muted fw-normal">Versteckt</th><td>${c.placed_date || '–'}</td></tr>
  <tr><th class="text-muted fw-normal">Letzter Fund</th><td>${c.last_found_date || '–'}</td></tr>
  <tr><th class="text-muted fw-normal">Favoriten</th><td>★ ${c.favorite_points || 0}</td></tr>
  <tr><th class="text-muted fw-normal">Koordinaten</th><td><span class="font-monospace${Number(c.coordinates_overridden) === 1 ? ' fw-bold fst-italic' : ''}"${Number(c.coordinates_overridden) === 1 ? ' style="color:#7f1d1d"' : ''}>${(+c.lat).toFixed(6)}, ${(+c.lng).toFixed(6)}</span>${Number(c.coordinates_overridden) === 1 ? `<div class="small text-muted font-monospace">Original: ${(+c.original_lat).toFixed(6)}, ${(+c.original_lng).toFixed(6)}</div>` : ''}</td></tr>
</table>

${shortDesc}
${attributesSection}
${longDesc}
${hintSection}
${logSection}
${recentSection}`;
    }

    function openSidebar()  {
        $('#sidebar').addClass('sidebar-open');
        map.getContainer().classList.add('details-open');
    }
    function closeSidebar() {
        $('#sidebar').removeClass('sidebar-open');
        map.getContainer().classList.remove('details-open');
        detailCacheGc = null;
        $('.cache-row').removeClass('detail-active');
        $('#sidebar-detail').html(defaultSidebarHtml());
        setActiveMarker(null);
    }

    // Re-apply active marker class after Leaflet re-renders icons (e.g. after cluster expand)
    map.on('layeradd', function (e) {
        if (activeMarkerGc && e.layer === markerMap[activeMarkerGc] && e.layer._icon) {
            e.layer._icon.classList.add('marker-active');
        }
    });

    $(document).on('click', '#btn-close-sidebar', closeSidebar);

    // ── Hilfe-Modal ───────────────────────────────────────────────────────────
    $('#btn-help').on('click', function () {
        const iframe = document.getElementById('help-iframe');
        if (!iframe.src || iframe.src === window.location.href) {
            iframe.src = 'help.php?embedded';
        }
        new bootstrap.Modal(document.getElementById('help-modal')).show();
    });

    // ── Detail HTML builder ───────────────────────────────────────────────────
    function buildLogTotalsHtml(logTotals) {
        const ICONS = {
            'Found it': '✓', "Didn't find it": '✗', 'Write note': '📝',
            'Attended': '🎉', 'Will Attend': '📅', 'Needs Maintenance': '🔧',
            'Needs Archived': '🚫', 'Publish Listing': '📢',
            'Temporarily disable listing': '🔒', 'Enable listing': '🔓',
            'Owner maintenance': '🔧', 'Owner attention requested': '⚠️',
        };
        return logTotals
            .filter(t => t.count > 0)
            .map(t => {
                const icon = ICONS[t.name] || '📋';
                const date = t.last_date
                    ? ` <span class="text-muted" style="font-size:.68rem;">${t.last_date}</span>`
                    : '';
                return `<div class="d-flex justify-content-between align-items-baseline py-0" style="font-size:.75rem;">` +
                    `<span>${icon} <strong>${t.count}×</strong> ${escHtml(t.name)}</span>${date}</div>`;
            })
            .join('');
    }

    function buildDetailHtml(c) {
        const badge = status => ({
            active:   '<span class="badge bg-success">Aktiv</span>',
            disabled: '<span class="badge bg-warning text-dark">Deaktiviert</span>',
            archived: '<span class="badge bg-secondary">Archiviert</span>',
        }[status] || '');

        const SI = 'assets/img/icons/';
        const stars = n => {
            n = parseFloat(n) || 0;
            const full  = Math.floor(n);
            const half  = (n % 1) >= 0.5 ? 1 : 0;
            const empty = 5 - full - half;
            const s = (file, op) => `<img src="${SI}${file}" width="15" height="15" style="object-fit:contain${op ? ';opacity:' + op : ''}">`;
            return Array(full).fill(s('star5.png')).join('')
                 + (half ? s('star3.png') : '')
                 + Array(empty).fill(s('star1.png', .25)).join('')
                 + ` <small class="text-muted">${n.toFixed(1)}</small>`;
        };

        const syncDate = c.last_synced
            ? new Date(c.last_synced.replace(' ', 'T') + 'Z').toLocaleString('de-DE')
            : '–';

        const gcUrl = `https://www.geocaching.com/geocache/${c.gc_code}`;

        const premiumIcon = c.premium_only
            ? `<img src="${SI}row2_col1_glasses_filled.png" width="15" height="15" title="Premium" style="object-fit:contain;vertical-align:middle" class="ms-1">`
            : '';

        const foundRow = c.found_by_user
            ? `<tr><th class="fw-normal py-0" style="color:#a16207">✓ Gefunden</th>
               <td class="py-0" style="color:#a16207">${c.found_date || 'Datum unbekannt'}</td></tr>`
            : '';

        const hintSection = c.encoded_hints
            ? `<div class="mb-2">${buildHintHtml(c.encoded_hints)}</div>`
            : '<div id="hint-placeholder"></div>';

        let descSection;
        if (c.short_description) {
            descSection = `<div id="desc-placeholder">${buildShortDescHtml(c.short_description)}</div>`;
        } else if (c.long_description) {
            const preview = strip300(c.long_description);
            const fullLen = (c.long_description || '').replace(/<[^>]*>/g, '').trim().length;
            const previewHtml = escHtml(preview) + (preview.length < fullLen ? '…' : '');
            descSection = `<div id="desc-placeholder">${buildShortDescHtml(previewHtml)}</div>`;
        } else {
            descSection = '<div id="desc-placeholder"></div>';
        }

        return `
<div class="p-2">
  <div class="d-flex justify-content-between align-items-start mb-1">
    <div class="d-flex align-items-center flex-wrap gap-1">
      <a href="${gcUrl}" target="_blank" class="badge bg-primary text-decoration-none">${escHtml(c.gc_code)}</a>
      ${badge(c.status)}${premiumIcon}
    </div>
    <button class="btn btn-sm btn-link p-0 text-secondary" id="btn-close-sidebar">✕</button>
  </div>

  <div class="fw-bold small mb-0">${escHtml(c.name)}</div>
  <div class="text-muted mb-2" style="font-size:.75rem;">${escHtml(c.cache_type_name || '')} · ${escHtml(c.container_size || '–')}</div>

  <div class="d-flex gap-2 mb-2">
    <div class="flex-fill border rounded px-2 py-1 text-center">
      <div class="text-muted mb-1" style="font-size:.68rem;text-transform:uppercase;letter-spacing:.04em">Schwierigkeit</div>
      <div>${stars(c.difficulty)}</div>
    </div>
    <div class="flex-fill border rounded px-2 py-1 text-center">
      <div class="text-muted mb-1" style="font-size:.68rem;text-transform:uppercase;letter-spacing:.04em">Gelände</div>
      <div>${stars(c.terrain)}</div>
    </div>
  </div>

  <table class="table table-sm table-borderless mb-2" style="font-size:.78rem;">
    ${foundRow}
    <tr><th class="text-muted fw-normal py-0" style="width:44%">Owner</th>
        <td class="py-0">${escHtml(c.owner || '–')}</td></tr>
    <tr><th class="text-muted fw-normal py-0">Versteckt</th>
        <td class="py-0">${c.placed_date || '–'}</td></tr>
    <tr><th class="text-muted fw-normal py-0">Letzter Fund</th>
        <td class="py-0">${c.last_found_date || '–'}</td></tr>
    <tr><th class="text-muted fw-normal py-0">Favoriten</th>
        <td class="py-0">★ ${c.favorite_points || 0}</td></tr>
    <tr><th class="text-muted fw-normal py-0">Koordinaten</th>
        <td class="py-0" style="font-size:.72rem;"><span class="font-monospace${Number(c.coordinates_overridden) === 1 ? ' fw-bold fst-italic' : ''}"${Number(c.coordinates_overridden) === 1 ? ' style="color:#7f1d1d"' : ''}>${(+c.lat).toFixed(5)}, ${(+c.lng).toFixed(5)}</span>${Number(c.coordinates_overridden) === 1 ? `<div class="small text-muted font-monospace">Original: ${(+c.original_lat).toFixed(5)}, ${(+c.original_lng).toFixed(5)}</div>` : ''}</td></tr>
  </table>

  ${descSection}
  ${hintSection}
  <div id="web-details-status"></div>

  <hr class="my-2">
  <button class="btn btn-sm btn-outline-primary w-100 mb-1" id="btn-open-detail-modal">Vollständige Details</button>
  <p class="text-muted mb-0" style="font-size:.65rem;">Sync: ${syncDate}</p>
</div>`;
    }

    function buildLogsHtml(logs) {
        if (!logs || !logs.length) return '<p class="text-muted small">Keine Logs vorhanden.</p>';

        const ICON = {
            'Found It': '😀', "Didn't Find It": '😞', 'Write Note': '📝',
            'Enabled Cache': '✅', 'Disabled Cache': '🚫', 'Needs Maintenance': '🔧',
            'Publish Listing': '📢', 'Attended': '🎉',
        };

        return logs.map(l => {
            const icon = ICON[l.log_type] || '📋';
            const txt  = l.log_text
                ? `<div class="mt-1 text-muted small">${escHtml(l.log_text.slice(0, 220))}${l.log_text.length > 220 ? '…' : ''}</div>`
                : '';
            return `
<div class="border-start border-2 border-primary ps-2 mb-2">
  <div class="d-flex justify-content-between align-items-start">
    <span class="small fw-semibold">${icon} ${escHtml(l.finder_name || '?')}</span>
    <span class="text-muted" style="font-size:.75rem;">${l.log_date || ''}</span>
  </div>
  <div class="text-muted" style="font-size:.75rem;">${escHtml(l.log_type || '')}</div>
  ${txt}
</div>`;
        }).join('');
    }

    function defaultSidebarHtml() {
        return `
<div class="p-3 text-center text-muted mt-5">
  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="currentColor"
       class="bi bi-geo-alt mb-3 opacity-25" viewBox="0 0 16 16">
    <path d="M12.166 8.94c-.524 1.062-1.234 2.12-1.96 3.07A31.493 31.493 0 0 1 8 14.58a31.481 31.481 0 0 1-2.206-2.57c-.726-.95-1.436-2.008-1.96-3.07C3.304 7.867 3 6.862 3 6a5 5 0 0 1 10 0c0 .862-.305 1.867-.834 2.94zM8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10z"/>
    <path d="M8 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
  </svg>
  <p>Klicke auf einen Cache-Marker,<br>um die Details anzuzeigen.</p>
  <hr>
  <div class="text-start small">
    <div class="mb-1"><span class="badge" style="background:#22c55e">T</span> Traditional</div>
    <div class="mb-1"><span class="badge" style="background:#3b82f6">?</span> Mystery</div>
    <div class="mb-1"><span class="badge" style="background:#f59e0b">M</span> Multi</div>
    <div class="mb-1"><span class="badge" style="background:#84cc16">EC</span> EarthCache</div>
    <div class="mb-1"><span class="badge" style="background:#a855f7">W</span> Wherigo</div>
    <div class="mb-1"><span class="badge" style="background:#ef4444">E</span> Event</div>
    <div class="mb-1"><span class="badge" style="background:#06b6d4">V</span> Virtual</div>
    <div><span class="badge" style="background:#9ca3af">–</span> Archiviert</div>
  </div>
</div>`;
    }

    $('#sidebar-detail').html(defaultSidebarHtml());
    updateStats();

    // ── Cache registry ────────────────────────────────────────────────────────
    // Persists cache objects across map moves so route calc works even if cache
    // scrolls out of view between selection and calculation.
    const cacheReg = {};
    const ownWaypoints = {};
    const ownWaypointMarkers = {};

    // ── Left panel state ──────────────────────────────────────────────────────
    let panelCaches    = [];
    let selOrder        = [];   // mixed: gc_codes + '_wp_N' custom ids
    let customWaypoints = {};   // '_wp_N' -> {name, lat, lng, marker}
    let customWpCounter = 0;
    let routeLayer      = null;
    let routeKmLayer    = null;
    let routeGeometryPoints = [];
    let routeProfileCache = null;
    let activeRouteProfileData = null;
    let routeCsvCodes   = [];
    let inRouteMode     = false;
    let routeSelectMode = false;
    let savedRoutes = [];
    let editingSavedRouteId = null;
    let calculatedRouteMetrics = null;
    function routeSelectionSignature() {
        return JSON.stringify({
            points: selOrder.map(id => {
                const point = getWaypoint(id);
                return point ? [String(id), Number(point.lat), Number(point.lng)] : [String(id)];
            }),
            roundtrip: !!$('#chk-roundtrip').prop('checked'),
        });
    }
    $('#chk-route-km-labels').prop('checked', LS.get('routeKmLabels', true));
    $(document).on('change', '#chk-route-km-labels', function () {
        LS.set('routeKmLabels', this.checked);
        if (routeKmLayer) { map.removeLayer(routeKmLayer); routeKmLayer = null; }
        if (this.checked && routeLayer && routeGeometryPoints.length > 1) {
            routeKmLayer = L.layerGroup(createRouteKilometerMarkers(routeGeometryPoints)).addTo(map);
        }
    });

    function clearRouteMapLayers() {
        if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
        if (routeKmLayer) { map.removeLayer(routeKmLayer); routeKmLayer = null; }
        routeGeometryPoints = [];
        $('#route-km-toggle').addClass('d-none');
    }

    function getWaypoint(id) {
        if (ownWaypoints[id]) {
            const wp = ownWaypoints[id];
            return { id: String(id), name: wp.name, lat: +wp.lat, lng: +wp.lng, isCache: false, isHome: Number(wp.is_home) === 1, color: Number(wp.is_home) === 1 ? '#fff' : '#7c3aed' };
        }
        if (customWaypoints[id]) {
            const wp = customWaypoints[id];
            return { id: String(id), name: wp.name, lat: wp.lat, lng: wp.lng, isCache: !!wp.isCache, isHome: !!wp.isHome, gc_code: wp.gc_code || null, color: wp.isHome ? '#fff' : wp.isCache ? '#6b7280' : '#7c3aed' };
        }
        const c = cacheReg[id];
        if (c) return { id: String(id), gc_code: c.gc_code, name: c.name, lat: +c.lat, lng: +c.lng, isCache: true, color: TYPE_COLOR[c.cache_type] || '#6b7280' };
        return null;
    }

    function ownWaypointKey(wp) { return `own:${wp.id}`; }

    function makeOwnWaypointIcon(id) {
        const index = selOrder.indexOf(ownWaypointKey({ id }));
        const waypoint = ownWaypoints[ownWaypointKey({ id })];
        const isHome = Number(waypoint?.is_home) === 1;
        const label = index >= 0 ? index + 1 : isHome ? '⌂' : '⚑';
        return L.divIcon({ className: '', html: `<div class="custom-wp-pin${isHome ? ' home-location' : ''}">${label}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    }

    function addOwnWaypointMarker(wp) {
        const key = ownWaypointKey(wp);
        if (ownWaypointMarkers[key]) map.removeLayer(ownWaypointMarkers[key]);
        const marker = L.marker([+wp.lat, +wp.lng], { icon: makeOwnWaypointIcon(wp.id) })
            .bindTooltip(`<strong>${Number(wp.is_home) === 1 ? '⌂ Home · ' : ''}${escHtml(wp.name)}</strong><br><span>Eigener Wegpunkt</span>`, { direction: 'top' });
        if (ownWaypointPassesMapFilters()) marker.addTo(map);
        marker.on('click', function () {
            hideSidePanelsOnMapClick();
            if (routeSelectMode) mapClickRouteSelect(key, true);
            else map.setView(marker.getLatLng(), Math.max(map.getZoom(), 12));
        });
        ownWaypointMarkers[key] = marker;
    }

    function refreshOwnWaypointMarkers() {
        Object.entries(ownWaypoints).forEach(([key, wp]) => {
            if (ownWaypointMarkers[key]) ownWaypointMarkers[key].setIcon(makeOwnWaypointIcon(wp.id));
        });
    }

    async function loadOwnWaypoints() {
        try {
            const response = await fetch('api/waypoints.php');
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error('Wegpunkte konnten nicht geladen werden.');
            const incoming = new Set((data.waypoints || []).map(wp => ownWaypointKey(wp)));
            Object.keys(ownWaypointMarkers).forEach(key => {
                if (!incoming.has(key)) { map.removeLayer(ownWaypointMarkers[key]); delete ownWaypointMarkers[key]; }
            });
            Object.keys(ownWaypoints).forEach(key => { if (!incoming.has(key)) delete ownWaypoints[key]; });
            (data.waypoints || []).forEach(wp => {
                const key = ownWaypointKey(wp);
                ownWaypoints[key] = wp;
                addOwnWaypointMarker(wp);
            });
            if ((data.waypoints || []).some(wp => Number(wp.is_home) === 1) && !$('#distance-from').val().trim()) {
                $('#distance-from').val('Home');
            }
            refreshOwnWaypointMarkers();
            if (routeSelectMode) renderSelectionList();
            else renderCacheList(panelCaches);
        } catch (error) {
            console.error(error);
        }
    }
    loadOwnWaypoints();

    let waypointModal = null;
    function openWaypointModalAt(point, defaultName = '') {
        const name = !defaultName || /^Wegpunkt$/i.test(defaultName.trim())
            ? nextOwnWaypointName()
            : defaultName;
        $('#waypoint-name').val(name);
        $('#waypoint-location').val(`${point.lat.toFixed(6)} ${point.lng.toFixed(6)}`);
        $('#waypoint-modal-status').text(point.label ? `Position: ${point.label}` : '');
        waypointDraftPoint = point;
        waypointModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('waypoint-modal'));
        waypointModal.show();
    }
    function nextOwnWaypointName() {
        const highest = Object.values(ownWaypoints).reduce((max, waypoint) => {
            const match = /^Wegpunkt\s+(\d+)$/i.exec(String(waypoint.name || '').trim());
            return match ? Math.max(max, Number(match[1])) : max;
        }, 0);
        return `Wegpunkt ${highest + 1}`;
    }
    $('#btn-add-waypoint').on('click', function () {
        const center = map.getCenter();
        openWaypointModalAt({ lat: center.lat, lng: center.lng, label: 'Kartenmitte' });
    });
    $('#waypoint-modal').on('hidden.bs.modal', function () {
        if (waypointDraftMarker) { map.removeLayer(waypointDraftMarker); waypointDraftMarker = null; }
    });
    $('#waypoint-location').on('input', function () {
        waypointDraftPoint = null;
        if (waypointDraftMarker) { map.removeLayer(waypointDraftMarker); waypointDraftMarker = null; }
    });
    $('#btn-waypoint-pick').on('click', function () {
        waypointPickMode = !waypointPickMode;
        $(this).toggleClass('active', waypointPickMode).attr('aria-pressed', String(waypointPickMode));
        $('#map').toggleClass('waypoint-pick-mode', waypointPickMode);
        $('#waypoint-modal-status').text(waypointPickMode ? 'Klicke auf die Karte, um die Position auszuwählen.' : 'Kartenwahl abgebrochen.');
        if (waypointPickMode) bootstrap.Modal.getInstance(document.getElementById('waypoint-modal'))?.hide();
    });
    $(document).on('keydown', function (event) {
        if (event.key === 'Escape' && waypointPickMode) {
            waypointPickMode = false;
            $('#map').removeClass('waypoint-pick-mode');
            $('#btn-waypoint-pick').removeClass('active').attr('aria-pressed', 'false');
            $('#waypoint-modal-status').text('Kartenwahl abgebrochen.');
        }
    });
    $('#btn-waypoint-resolve').on('click', async function () {
        const $button = $(this).prop('disabled', true);
        $('#waypoint-modal-status').text('Position wird gesucht …');
        try {
            waypointDraftPoint = await resolveDistancePoint($('#waypoint-location').val());
            $('#waypoint-modal-status').text(`${waypointDraftPoint.label}: ${waypointDraftPoint.lat.toFixed(6)} ${waypointDraftPoint.lng.toFixed(6)}`);
            if (waypointDraftMarker) map.removeLayer(waypointDraftMarker);
            waypointDraftMarker = L.circleMarker([waypointDraftPoint.lat, waypointDraftPoint.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#7c3aed', fillOpacity: 1 }).addTo(map);
            map.setView([waypointDraftPoint.lat, waypointDraftPoint.lng], Math.max(map.getZoom(), 13));
        } catch (error) {
            waypointDraftPoint = null;
            $('#waypoint-modal-status').text(error.message || 'Position wurde nicht gefunden.');
        } finally { $button.prop('disabled', false); }
    });
    $('#waypoint-form').on('submit', async function (event) {
        event.preventDefault();
        const name = $('#waypoint-name').val().trim();
        const $save = $('#btn-waypoint-save').prop('disabled', true);
        try {
            const point = waypointDraftPoint || await resolveDistancePoint($('#waypoint-location').val());
            const response = await fetch('api/waypoints.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, lat: point.lat, lng: point.lng }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Wegpunkt konnte nicht gespeichert werden.');
            const key = ownWaypointKey(data.waypoint);
            if (routeSelectMode && !selOrder.includes(key)) selOrder.push(key);
            await loadOwnWaypoints();
            if (routeSelectMode) scheduleLastPlanSave();
            refreshOwnWaypointMarkers();
            updateRouteBtn();
            bootstrap.Modal.getInstance(document.getElementById('waypoint-modal'))?.hide();
        } catch (error) {
            $('#waypoint-modal-status').text(error.message || 'Wegpunkt konnte nicht gespeichert werden.');
        } finally { $save.prop('disabled', false); }
    });
    $(document).on('click', '.waypoint-row-select', function (event) {
        event.stopPropagation();
        toggleCacheWaypoint(String($(this).closest('.waypoint-row').data('waypoint-key')));
    });
    $(document).on('click', '.waypoint-home-toggle', async function (event) {
        event.stopPropagation();
        const key = String($(this).closest('.waypoint-row').data('waypoint-key'));
        const waypoint = ownWaypoints[key];
        if (!waypoint) return;
        const homeId = Number(waypoint.is_home) === 1 ? null : Number(waypoint.id);
        const $button = $(this).prop('disabled', true);
        try {
            const response = await fetch('api/waypoints.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'home', id: homeId }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Home-Standort konnte nicht gespeichert werden.');
            await loadOwnWaypoints();
            if (homeId !== null && !$('#distance-from').val().trim()) $('#distance-from').val('Home');
        } catch (error) {
            $button.prop('disabled', false).attr('title', error.message || 'Änderung fehlgeschlagen');
        }
    });
    $(document).on('click', '.waypoint-row-delete', async function (event) {
        event.stopPropagation();
        const $button = $(this).prop('disabled', true);
        const key = String($(this).closest('.waypoint-row').data('waypoint-key'));
        const id = Number(key.slice('own:'.length));
        try {
            const response = await fetch('api/waypoints.php', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Wegpunkt konnte nicht gelöscht werden.');
            selOrder = selOrder.filter(item => item !== key);
            scheduleLastPlanSave(selOrder.length === 0);
            await loadOwnWaypoints();
            refreshAllMarkerIcons();
            updateRouteBtn();
        } catch (error) {
            $button.prop('disabled', false).attr('title', error.message || 'Löschen fehlgeschlagen');
        }
    });

    function setRouteSelectMode(on) {
        routeSelectMode = on;
        $('#btn-route-mode').toggleClass('active', on);
        if (on) $('#btn-route-mode').removeClass('route-calculated');
        $('#route-mode-controls').toggleClass('d-none', !on).toggleClass('d-flex', on);

        if (on) {
            setPanelOpen(true);
            renderSelectionList();
            updateRouteBtn();
            $('#map').addClass('route-mode');
        }

        if (!on) {
            flushLastPlanSave();
            editingSavedRouteId = null;
            $('#btn-save-route').text('Sichern');
            inRouteMode = false;
            selOrder = [];
            refreshAllMarkerIcons();
            $('#map').removeClass('route-mode');
            Object.values(customWaypoints).forEach(wp => map.removeLayer(wp.marker));
            customWaypoints = {};
            customWpCounter = 0;
            clearRouteMapLayers();
            renderCaches(panelCaches);
            updateSelBadges();
            updateRouteBtn();
            setPanelOpen(false);
            $('#list-footer').html(
                '<button id="btn-clear-sel" class="btn btn-sm btn-outline-secondary w-100" disabled>Auswahl löschen</button>'
            );
        }
    }

    // ── Zoom buttons ──────────────────────────────────────────────────────────
    $('#btn-zoom-in').on('click',  function () { zoomMapAtPointer(1); });
    $('#btn-zoom-out').on('click', function () { zoomMapAtPointer(-1); });

    // ── Clustering toggle ─────────────────────────────────────────────────────
    let clusteringOn = LS.get('clustering', true);
    $('#btn-toggle-cluster').toggleClass('active', clusteringOn);

    $('#toggle-cache-markers').on('change', function () {
        cacheMarkersVisible = this.checked;
        LS.set('cacheMarkersVisible', cacheMarkersVisible);
        const markers = Object.values(markerMap);
        if (!cacheMarkersVisible) {
            cluster.removeLayers(markers);
            markers.forEach(marker => { if (map.hasLayer(marker)) map.removeLayer(marker); });
            return;
        }
        if (clusteringOn) {
            if (!map.hasLayer(cluster)) map.addLayer(cluster);
            Object.entries(markerMap).forEach(([gc, marker]) => {
                map.removeLayer(marker);
                if (gc === focusedCacheGc) map.addLayer(marker);
                else cluster.addLayer(marker);
            });
        } else {
            map.removeLayer(cluster);
            markers.forEach(marker => map.addLayer(marker));
        }
    });

    $('#btn-toggle-cluster').on('click', function () {
        clusteringOn = !clusteringOn;
        LS.set('clustering', clusteringOn);
        $(this).toggleClass('active', clusteringOn);
        if (!cacheMarkersVisible) {
            cluster.removeLayers(Object.values(markerMap));
            map.removeLayer(cluster);
        } else if (clusteringOn) {
            Object.entries(markerMap).forEach(([gc, m]) => {
                map.removeLayer(m);
                if (gc === focusedCacheGc) map.addLayer(m);
                else cluster.addLayer(m);
            });
            if (!map.hasLayer(cluster)) map.addLayer(cluster);
        } else {
            map.removeLayer(cluster);
            Object.values(markerMap).forEach(m => map.addLayer(m));
        }
    });

    function setPanelOpen(open) {
        $('#list-panel').toggleClass('panel-open', open);
        $('#map-area').css('margin-left', open ? '300px' : '');
        $('#map-area').one('transitionend', () => {
            map.invalidateSize({ animate: false });
            positionOpenMapMenus();
        });
        LS.set('panel', open);
    }

    // Restore panel state
    if (LS.get('panel', false)) {
        setPanelOpen(true);
        // list will be populated once loadFromDB fires
    }

    // ☰ button: just opens/closes the list panel; route-mode independent
    $('#btn-toggle-list').on('click', function () {
        const opening = !$('#list-panel').hasClass('panel-open');
        setPanelOpen(opening);
        if (opening && !inRouteMode) renderCacheList(panelCaches);
    });

    // Route-mode button (navbar): toggle selection mode
    $('#btn-route-mode').on('click', function () {
        setRouteSelectMode(!routeSelectMode);
    });

    // Cache clicked in route-mode: toggle selection
    function mapClickRouteSelect(gcCode, fromMap = false) {
        gcCode = String(gcCode);
        // Route points include caches and persisted/custom waypoints.
        if (!getWaypoint(gcCode)) return;
        const idx = selOrder.indexOf(gcCode);
        if (idx > -1) { selOrder.splice(idx, 1); } else { selOrder.push(gcCode); }
        scheduleLastPlanSave(selOrder.length === 0);
        refreshAllMarkerIcons();
        updateSavedRouteMarkerIcons();
        if (!fromMap && !$('#list-panel').hasClass('panel-open')) setPanelOpen(true);
        renderSelectionList();
        updateRouteBtn();
    }

    function renderRouteSelectionFooter() {
        $('#list-footer').html(
            '<div class="d-flex gap-1">' +
              '<button id="btn-clear-sel" class="btn btn-sm btn-outline-secondary flex-fill" disabled>Auswahl löschen</button>' +
              '<button id="btn-reverse-selection" class="btn btn-sm btn-outline-primary flex-fill" disabled title="Reihenfolge der ausgewählten Punkte umkehren">Reihenfolge umkehren</button>' +
            '</div>'
        );
        updateRouteBtn();
    }

    // ── Route selection list (shown in left panel while in routeSelectMode) ────
    function renderSelectionList() {
        if (!routeSelectMode || inRouteMode) return;
        renderRouteSelectionFooter();
        $('#cache-search-wrap').addClass('d-none');
        $('#list-count').text(selOrder.length);
        if (!selOrder.length) {
            $('#list-body').html(
                '<p class="text-muted small p-3 mb-0">Noch keine Punkte ausgewählt.<br>' +
                'Klicke auf einen Cache-Marker oder auf eine leere Stelle der Karte für einen eigenen Wegpunkt (lila).</p>'
            );
            return;
        }
        const rows = selOrder.map(function (id, i) {
            const wp = getWaypoint(id);
            if (!wp) return '';
            const numBadge = `<span class="route-num" style="background:${wp.color};color:${wp.isHome ? '#111827' : '#fff'};flex-shrink:0">${i + 1}</span>`;
            const sub = wp.isCache ? '' : '<div style="font-size:.7rem;color:#9ca3af">Eigener Wegpunkt</div>';
            return `<div class="sel-row d-flex align-items-center gap-2 px-2 py-1 border-bottom" draggable="true" data-id="${escHtml(id)}">
                <span class="drag-handle text-muted" style="cursor:grab;user-select:none;font-size:1.1rem;line-height:1;flex-shrink:0">⠿</span>
                ${numBadge}
                <div class="flex-grow-1 overflow-hidden">
                    <div class="small fw-semibold text-truncate">${escHtml(wp.name)}</div>
                    ${sub}
                </div>
                <button class="btn btn-link text-danger p-0 btn-remove-wp" data-id="${escHtml(id)}"
                        style="font-size:.85rem;line-height:1;flex-shrink:0" title="Entfernen">✕</button>
            </div>`;
        }).join('');
        $('#list-body').html(rows);
    }

    $(document).on('click', '#btn-reverse-selection', function () {
        if (selOrder.length < 2) return;
        if ($('#chk-roundtrip').prop('checked')) {
            // Keep the round trip's start (which is also appended as its end)
            // fixed, and reverse only the intermediate stops.
            selOrder = [selOrder[0], ...selOrder.slice(1).reverse()];
        } else {
            selOrder.reverse();
        }
        scheduleLastPlanSave(selOrder.length === 0);
        refreshAllMarkerIcons();
        updateSavedRouteMarkerIcons();
        renderSelectionList();
        updateRouteBtn();
    });

    // Remove single waypoint via ✕ button
    $(document).on('click', '.btn-remove-wp', function (e) {
        e.stopPropagation();
        const id = $(this).data('id');
        selOrder = selOrder.filter(x => x !== id);
        scheduleLastPlanSave(selOrder.length === 0);
        if (customWaypoints[id]) {
            map.removeLayer(customWaypoints[id].marker);
            delete customWaypoints[id];
        }
        refreshAllMarkerIcons();
        updateSavedRouteMarkerIcons();
        renderSelectionList();
        updateRouteBtn();
    });

    // Drag-and-drop reordering
    let dragId = null;
    $(document).on('dragstart', '.sel-row', function (e) {
        dragId = $(this).data('id');
        e.originalEvent.dataTransfer.effectAllowed = 'move';
    });
    $(document).on('dragover', '.sel-row', function (e) {
        e.preventDefault();
        $(this).addClass('drag-over');
    });
    $(document).on('dragleave', '.sel-row', function () {
        $(this).removeClass('drag-over');
    });
    $(document).on('drop', '.sel-row', function (e) {
        e.preventDefault();
        $(this).removeClass('drag-over');
        const targetId = $(this).data('id');
        if (dragId && targetId && dragId !== targetId) {
            const from = selOrder.indexOf(String(dragId));
            const to   = selOrder.indexOf(String(targetId));
            if (from > -1 && to > -1) {
                selOrder.splice(from, 1);
                selOrder.splice(to, 0, String(dragId));
            }
        }
        dragId = null;
        scheduleLastPlanSave();
        updateSavedRouteMarkerIcons();
        renderSelectionList();
        updateRouteBtn();
    });

    // ── Custom waypoint: leerer Kartenklick in Route-Mode ────────────────────
    map.on('click', function (e) {
        if (e.distanceTargetPickHandled) return;
        if (!routeSelectMode || inRouteMode) return;
        e.distanceTargetPickHandled = true;
        openWaypointModalAt({ lat: e.latlng.lat, lng: e.latlng.lng, label: 'Kartenpunkt' }, 'Wegpunkt');
    });

    $(document).on('click', '#btn-close-list', function () {
        setPanelOpen(false);
    });

    function renderCacheList(caches, globalSearch = false) {
        if (!globalSearch) panelCaches = caches;
        caches.forEach(c => { cacheReg[c.gc_code] = c; });
        renderMapFilterMenu(globalSearch ? panelCaches : caches);

        if (routeSelectMode) { renderSelectionList(); return; }
        if (inRouteMode) return;

        $('#cache-search-wrap').removeClass('d-none');
        const query = $('#cache-search').val().trim().toLocaleLowerCase('de');
        const mapFilteredCaches = caches.filter(cachePassesMapFilters);
        const filtered = query ? mapFilteredCaches.filter(c =>
            String(c.name || '').toLocaleLowerCase('de').includes(query) ||
            String(c.gc_code || '').toLocaleLowerCase('de').includes(query)
        ) : mapFilteredCaches;
        const filteredWaypoints = Object.entries(ownWaypoints).filter(([, wp]) => !query ||
            String(wp.name || '').toLocaleLowerCase('de').includes(query) ||
            `${(+wp.lat).toFixed(6)} ${(+wp.lng).toFixed(6)}`.includes(query)
        );
        const resultCount = filtered.length + filteredWaypoints.length;
        const totalCount = mapFilteredCaches.length + Object.keys(ownWaypoints).length;
        $('#list-count').text(query ? (globalSearch ? `${resultCount} Treffer` : `${resultCount}/${totalCount}`) : totalCount);

        if (!filtered.length && !filteredWaypoints.length) {
            const emptyMessage = totalCount ? 'Keine passenden Caches oder Wegpunkte.'
                : caches.length ? 'Alle Caches sind durch die Kartenfilter ausgeblendet.'
                : 'Keine Caches in der Ansicht.';
            $('#list-body').html(`<p class="text-muted small p-3">${emptyMessage}</p>`);
            return;
        }

        const waypointRows = filteredWaypoints.map(function ([key, wp]) {
            const idx = selOrder.indexOf(key);
            const isHome = Number(wp.is_home) === 1;
            return `<div class="cache-row waypoint-row${idx > -1 ? ' selected' : ''}${isHome ? ' home-location-row' : ''}" data-waypoint-key="${escHtml(key)}">
                <button type="button" class="sel-badge waypoint-row-select${idx > -1 ? ' active' : ''}" title="Als Wegpunkt auswählen" aria-label="Als Routenpunkt auswählen">${idx > -1 ? idx + 1 : ''}</button>
                <div class="flex-grow-1 overflow-hidden cache-row-name waypoint-row-name" role="button" tabindex="0" title="Wegpunkt auf der Karte anzeigen">
                    <div class="small fw-semibold text-truncate">${isHome ? '⌂' : '⚑'} ${escHtml(wp.name)}${isHome ? ' <span class="home-location-label">HOME</span>' : ''}</div>
                    <div style="font-size:.71rem;color:#6b7280">${isHome ? 'Home-Standort · ' : 'Eigener Wegpunkt · '}${(+wp.lat).toFixed(5)}, ${(+wp.lng).toFixed(5)}</div>
                </div>
                <button type="button" class="btn btn-sm btn-link p-0 waypoint-home-toggle${isHome ? ' text-primary' : ' text-secondary'}" title="${isHome ? 'Home-Standort lösen' : 'Als Home-Standort festlegen'}" aria-label="${isHome ? 'Home-Standort lösen' : 'Als Home-Standort festlegen'}">⌂</button>
                <button type="button" class="btn btn-sm btn-link text-danger p-0 waypoint-row-delete" title="Wegpunkt löschen" aria-label="${escHtml(wp.name)} löschen">×</button>
            </div>`;
        }).join('');
        const cacheRows = filtered.map(function (c) {
            const idx = selOrder.indexOf(c.gc_code);
            const col = TYPE_COLOR[c.cache_type] || '#6b7280';
            const changed = Number(c.coordinates_overridden) === 1;
            const editButton = Number(c.cache_type) === 8
                ? '<button type="button" class="btn btn-sm btn-link text-secondary p-1 cache-coordinates-edit" title="Mystery-Koordinaten anpassen" aria-label="Koordinaten für ' + escHtml(c.gc_code) + ' anpassen">✎</button>'
                : '';
            return '<div class="cache-row' + (detailCacheGc === c.gc_code ? ' detail-active' : '') + '" data-gc="' + escHtml(c.gc_code) + '">' +
                '<button type="button" class="sel-badge cache-row-select' + (idx > -1 ? ' active' : '') + '" title="Als Wegpunkt auswählen" aria-label="' + (idx > -1 ? 'Wegpunkt entfernen ' : 'Als Wegpunkt hinzufügen ') + escHtml(c.gc_code) + '">' +
                    (idx > -1 ? idx + 1 : '') + '</button>' +
                '<div class="flex-grow-1 overflow-hidden cache-row-name" role="button" tabindex="0" title="Details anzeigen und auf Karte fokussieren">' +
                    '<div class="small text-truncate' + (changed ? ' fw-bold fst-italic' : ' fw-semibold') + '"' + (changed ? ' style="color:#7f1d1d"' : '') + '>' + escHtml(c.name) + '</div>' +
                    '<div style="font-size:.71rem;color:#6b7280">' +
                        '<span class="cache-type-label">' + escHtml(c.cache_type_name || 'Cache') + '</span> &middot; ' +
                        '<span style="color:' + col + '">D' + c.difficulty + '/T' + c.terrain + '</span>' +
                        (changed ? ' <span class="coordinate-override-label">Koordinaten geändert</span>' : '') +
                    '</div>' +
                '</div>' + editButton + '</div>';
        }).join('');

        $('#list-body').html(waypointRows + cacheRows);
    }

    let editingCoordinateCache = null;
    $(document).on('click', '.cache-coordinates-edit', function (event) {
        event.stopPropagation();
        const gc = String($(this).closest('.cache-row').data('gc'));
        const cache = cacheReg[gc];
        if (!cache || Number(cache.cache_type) !== 8) return;
        editingCoordinateCache = gc;
        $('#cache-coordinates-name').text(`${cache.name} · ${gc}`);
        $('#cache-coordinates-value').val(`${(+cache.lat).toFixed(6)} ${(+cache.lng).toFixed(6)}`);
        $('#cache-coordinates-original').text(`Original: ${(+cache.original_lat).toFixed(6)} ${(+cache.original_lng).toFixed(6)}`);
        $('#cache-coordinates-status').removeClass('text-danger text-success').text('');
        $('#btn-restore-cache-coordinates').toggleClass('d-none', Number(cache.coordinates_overridden) !== 1);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('cache-coordinates-modal')).show();
    });

    async function persistMysteryCoordinates(restore = false) {
        if (!editingCoordinateCache) return;
        const $save = $('#btn-save-cache-coordinates').prop('disabled', true);
        const $restore = $('#btn-restore-cache-coordinates').prop('disabled', true);
        $('#cache-coordinates-status').removeClass('text-danger text-success').text('Speichere …');
        try {
            let payload = { gc_code: editingCoordinateCache };
            if (!restore) {
                const coordinates = parseCoordinatePair($('#cache-coordinates-value').val());
                if (!coordinates) throw new Error('Koordinate bitte als Breite und Länge eingeben.');
                payload = { ...payload, lat: coordinates.lat, lng: coordinates.lng };
            }
            const response = await fetch('api/cache_coordinates.php', {
                method: restore ? 'DELETE' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Koordinaten konnten nicht gespeichert werden.');
            $('#cache-coordinates-status').addClass('text-success').text(restore ? 'Originalkoordinaten wiederhergestellt.' : 'Koordinaten gespeichert.');
            if ($('#cache-search').val().trim()) $('#cache-search').trigger('input');
            loadFromDB();
            if (detailCacheGc === editingCoordinateCache) showDetail(editingCoordinateCache);
            if (restore) $('#btn-restore-cache-coordinates').addClass('d-none');
        } catch (error) {
            $('#cache-coordinates-status').addClass('text-danger').text(error.message || 'Fehler beim Speichern.');
        } finally {
            $save.prop('disabled', false);
            $restore.prop('disabled', false);
        }
    }
    $('#cache-coordinates-form').on('submit', function (event) {
        event.preventDefault();
        persistMysteryCoordinates(false);
    });
    $('#btn-restore-cache-coordinates').on('click', function () { persistMysteryCoordinates(true); });

    let cacheSearchTimer;
    let cacheSearchRequest = 0;
    $('#cache-search').on('input', function () {
        const query = this.value.trim();
        clearTimeout(cacheSearchTimer);
        if (!query) {
            cacheSearchRequest++;
            globalSearchCaches = [];
            renderCacheList(panelCaches);
            return;
        }
        const request = ++cacheSearchRequest;
        cacheSearchTimer = setTimeout(() => {
            $.get('api/caches.php', { q: query }).done(d => {
                if (request !== cacheSearchRequest || $('#cache-search').val().trim() !== query || !d.success) return;
                globalSearchCaches = d.caches;
                d.caches.forEach(c => { cacheReg[c.gc_code] = c; });
                renderCacheList(d.caches, true);
            });
        }, 180);
    });
    $('#btn-clear-cache-search').on('click', function () {
        $('#cache-search').val('').trigger('input').trigger('focus');
    });

    function toggleCacheWaypoint(gc) {
        const idx = selOrder.indexOf(gc);
        if (idx > -1) { selOrder.splice(idx, 1); } else { selOrder.push(gc); }
        scheduleLastPlanSave(selOrder.length === 0);
        refreshAllMarkerIcons();
        if (routeSelectMode) renderSelectionList();
        else updateSelBadges();
        updateRouteBtn();
    }

    $(document).on('click', '.cache-row-select', function (e) {
        e.stopPropagation();
        toggleCacheWaypoint(String($(this).closest('.cache-row').data('gc')));
    });

    $(document).on('click keydown', '.cache-row-name', function (e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        if (e.type === 'keydown') e.preventDefault();
        if ($(this).closest('.waypoint-row').length) {
            const key = String($(this).closest('.waypoint-row').data('waypoint-key'));
            const marker = ownWaypointMarkers[key];
            if (marker) { map.setView(marker.getLatLng(), Math.max(map.getZoom(), 12)); marker.openTooltip(); }
            return;
        }
        const gc = String($(this).closest('.cache-row').data('gc'));
        focusCacheOnMap(gc);
        showDetail(gc);
        openSidebar();
    });

    $(document).on('mouseenter', '.cache-row', function () {
        if ($(this).hasClass('waypoint-row')) {
            ownWaypointMarkers[String($(this).data('waypoint-key'))]?._icon?.classList.add('marker-highlight');
            return;
        }
        const m = markerMap[$(this).data('gc')];
        if (m?._icon) m._icon.classList.add('marker-highlight');
    });
    $(document).on('mouseleave', '.cache-row', function () {
        if ($(this).hasClass('waypoint-row')) {
            ownWaypointMarkers[String($(this).data('waypoint-key'))]?._icon?.classList.remove('marker-highlight');
            return;
        }
        const m = markerMap[$(this).data('gc')];
        if (m?._icon) m._icon.classList.remove('marker-highlight');
    });

    const routeHoverClusterMarkers = new Set();
    function setRoutePointGlow(id, enabled) {
        const key = String(id || '');
        const point = getWaypoint(key);
        if (!point) return;
        if (point.isCache && !cacheMarkersVisible) return;
        const marker = customWaypoints[key]?.marker || ownWaypointMarkers[key] || markerMap[point.gc_code || key];
        if (enabled && point.isCache && marker && !marker._icon && clusteringOn && cluster.hasLayer(marker)) {
            cluster.removeLayer(marker);
            map.addLayer(marker);
            routeHoverClusterMarkers.add(marker);
        }
        marker?._icon?.classList.toggle('marker-highlight', enabled);
        if (!enabled && marker && routeHoverClusterMarkers.has(marker)) {
            routeHoverClusterMarkers.delete(marker);
            map.removeLayer(marker);
            cluster.addLayer(marker);
        }
    }
    $(document).on('mouseenter', '.sel-row[data-id], .route-waypoint[data-route-id]', function () {
        setRoutePointGlow($(this).data('id') ?? $(this).data('route-id'), true);
    });
    $(document).on('mouseleave', '.sel-row[data-id], .route-waypoint[data-route-id]', function () {
        setRoutePointGlow($(this).data('id') ?? $(this).data('route-id'), false);
    });

    function updateSelBadges() {
        $('.cache-row').each(function () {
            const $row = $(this);
            const key = $row.hasClass('waypoint-row') ? $row.data('waypoint-key') : $row.data('gc');
            const idx = selOrder.indexOf(key);
            const $b  = $(this).find('.sel-badge');
            if (idx > -1) {
                $b.addClass('active').text(idx + 1);
                $row.addClass('selected');
            } else {
                $b.removeClass('active').text('');
                $row.removeClass('selected');
            }
        });
    }

    function updateRouteBtn() {
        const n = selOrder.length;
        $('#sel-count').text(n);
        $('#btn-calc-route').prop('disabled', n < 2);
        $('#btn-save-route').prop('disabled', n < 2);
        $('#btn-clear-sel').prop('disabled', n === 0);
        $('#btn-reverse-selection').prop('disabled', n < 2);
    }

    let lastPlanSaveTimer = null;
    let pendingLastPlanSnapshot = null;
    let lastPlanSaveQueue = Promise.resolve();

    function flushLastPlanSave() {
        clearTimeout(lastPlanSaveTimer);
        lastPlanSaveTimer = null;
        if (pendingLastPlanSnapshot) {
            const snapshot = pendingLastPlanSnapshot;
            pendingLastPlanSnapshot = null;
            lastPlanSaveQueue = lastPlanSaveQueue.catch(() => {}).then(async () => {
                const clear = snapshot.points.length === 0;
                const response = await fetch('api/routes.php', {
                    method: clear ? 'DELETE' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(clear
                        ? { last_plan: true }
                        : { last_plan: true, points: snapshot.points, roundtrip: snapshot.roundtrip }),
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Letzte Planung konnte nicht gesichert werden.');
            }).catch(error => console.error('Letzte Planung konnte nicht automatisch gesichert werden:', error));
        }
        return lastPlanSaveQueue;
    }

    function scheduleLastPlanSave(clearWhenEmpty = false) {
        if (!routeSelectMode || inRouteMode) return;
        if (!selOrder.length && !clearWhenEmpty) return;
        pendingLastPlanSnapshot = {
            points: selOrder.map(id => getWaypoint(id)).filter(Boolean).map(point => ({
                name: String(point.name || point.gc_code || 'Wegpunkt'),
                lat: Number(point.lat),
                lng: Number(point.lng),
                gc_code: point.gc_code || null,
                is_home: !!point.isHome,
            })),
            roundtrip: $('#chk-roundtrip').prop('checked'),
        };
        clearTimeout(lastPlanSaveTimer);
        lastPlanSaveTimer = setTimeout(flushLastPlanSave, 350);
    }
    $('#chk-roundtrip').on('change', scheduleLastPlanSave);

    async function refreshSavedRoutes() {
        try {
            const response = await fetch('api/routes.php');
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Gespeicherte Routen konnten nicht geladen werden.');
            savedRoutes = data.routes || [];
            renderSavedRoutes();
        } catch (error) {
            $('#saved-routes-list').html(`<div class="small text-danger p-2">${escHtml(error.message)}</div>`);
        }
    }

    function renderSavedRoutes() {
        if (!savedRoutes.length) {
            $('#saved-routes-list').html('<div class="small text-muted p-2">Noch keine Routen gespeichert.</div>');
            return;
        }
        const rows = savedRoutes.map(route => {
            const points = Array.isArray(route.points) ? route.points : [];
            const hasDistance = Number.isFinite(Number(route.distance_m)) && route.distance_m !== null;
            const lengthLabel = hasDistance
                ? ` · ${route.distance_approximate ? 'ca. ' : ''}${(Number(route.distance_m) / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
                : ' · Länge noch nicht berechnet';
            return `<div class="saved-route-row d-flex align-items-center gap-2 p-2">
            <div class="flex-grow-1 overflow-hidden">
                <button type="button" class="saved-route-edit saved-route-name" data-id="${Number(route.id)}" title="Route benutzen">${escHtml(route.name)}</button>
                <div class="small text-muted">${points.length} Punkte${lengthLabel}${route.is_last_plan ? ' · wird automatisch aktualisiert' : ''}</div>
            </div>
            <div class="saved-route-actions d-flex flex-nowrap gap-1">
                ${route.is_last_plan ? '' : `<button type="button" class="btn btn-sm btn-outline-danger saved-route-delete" data-id="${Number(route.id)}" aria-label="Route ${escHtml(route.name)} löschen">Löschen</button>`}
            </div>
        </div>`;
        }).join('');
        $('#saved-routes-list').html(rows);
    }

    $('#btn-save-route').on('click', function () {
        const existing = savedRoutes.find(route => Number(route.id) === Number(editingSavedRouteId));
        $('#route-name-title').text(existing ? 'Route bearbeiten' : 'Route speichern');
        $('#route-name-submit').text(existing ? 'Änderungen speichern' : 'Speichern');
        $('#route-save-new').toggleClass('d-none', !existing);
        $('#route-name-input').val(existing?.name || '').trigger('focus');
        $('#route-save-status').text('');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('route-name-modal')).show();
    });

    $('#route-save-new').on('click', function () {
        const existing = savedRoutes.find(route => Number(route.id) === Number(editingSavedRouteId));
        if (existing && $('#route-name-input').val().trim() === existing.name) {
            $('#route-name-input').val(`Kopie von ${existing.name}`);
        }
    });

    $('#route-name-form').on('submit', async function (event) {
        event.preventDefault();
        const saveAsNew = event.originalEvent?.submitter?.id === 'route-save-new';
        const name = $('#route-name-input').val().trim();
        const points = selOrder.map(id => getWaypoint(id)).filter(Boolean).map(point => ({
            name: point.name, lat: +point.lat, lng: +point.lng,
            gc_code: point.gc_code || null,
            is_home: !!point.isHome,
        }));
        if (points.length < 2) { $('#route-save-status').text('Bitte mindestens zwei Routenpunkte auswählen.'); return; }
        const $submit = $('#route-name-submit, #route-save-new').prop('disabled', true);
        $('#route-save-status').removeClass('text-danger').addClass('text-muted').text('Route wird gespeichert …');
        try {
            const routeMetrics = calculatedRouteMetrics?.signature === routeSelectionSignature() ? calculatedRouteMetrics : null;
            const response = await fetch('api/routes.php', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: saveAsNew ? null : editingSavedRouteId,
                    name, points, roundtrip: $('#chk-roundtrip').prop('checked'),
                    distance_m: routeMetrics?.distance_m ?? null,
                    distance_approximate: routeMetrics?.approximate ?? false,
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Route konnte nicht gespeichert werden.');
            editingSavedRouteId = Number(data.route.id);
            $('#btn-save-route').text('Update');
            await refreshSavedRoutes();
            bootstrap.Modal.getInstance(document.getElementById('route-name-modal'))?.hide();
        } catch (error) {
            $('#route-save-status').removeClass('text-muted').addClass('text-danger').text(error.message);
        } finally { $submit.prop('disabled', false); }
    });

    $('#btn-saved-routes').on('click', async function () {
        await refreshSavedRoutes();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('saved-routes-modal')).show();
    });

    function updateSavedRouteMarkerIcons() {
        Object.entries(customWaypoints).forEach(([id, wp]) => {
            if (!wp.savedRoutePoint || !wp.marker) return;
            const index = selOrder.indexOf(id);
            wp.marker.setIcon(index >= 0
                ? makeRouteIcon(index + 1)
                : L.divIcon({ className: '', html: `<div class="custom-wp-pin${wp.isHome ? ' home-location' : ''}">⚑</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }));
        });
    }

    $(document).on('click', '.saved-route-edit', function () {
        const route = savedRoutes.find(item => Number(item.id) === Number($(this).data('id')));
        if (!route || !Array.isArray(route.points) || route.points.length < (route.is_last_plan ? 1 : 2)) return;
        if (selOrder.length && !window.confirm('Die aktuelle Routenauswahl durch diese gespeicherte Route ersetzen?')) return;
        if (!routeSelectMode) setRouteSelectMode(true);
        inRouteMode = false;
        clearRouteMapLayers();
        Object.values(customWaypoints).forEach(wp => { if (wp.marker) map.removeLayer(wp.marker); });
        customWaypoints = {};
        customWpCounter = 0;
        selOrder = [];
        $('#chk-roundtrip').prop('checked', !!route.roundtrip);
        const bounds = [];
        route.points.forEach(point => {
            const gcCode = String(point.gc_code || '').toUpperCase();
            if (gcCode && markerMap[gcCode]) {
                selOrder.push(gcCode);
                bounds.push([+point.lat, +point.lng]);
                return;
            }
            const id = `_wp_${++customWpCounter}`;
            const savedPoint = {
                name: String(point.name || 'Routenpunkt'), lat: +point.lat, lng: +point.lng,
                gc_code: point.gc_code || null, isCache: !!point.gc_code, isHome: !!point.is_home, savedRoutePoint: true,
                marker: null,
            };
            const savedIcon = L.divIcon({ className: '', html: `<div class="custom-wp-pin${savedPoint.isHome ? ' home-location' : ''}">⚑</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
            savedPoint.marker = L.marker([savedPoint.lat, savedPoint.lng], { draggable: true, icon: savedIcon, zIndexOffset: 1000 })
                .bindTooltip(escHtml(savedPoint.name), { direction: 'top' }).addTo(map);
            savedPoint.marker.on('click', () => {
                hideSidePanelsOnMapClick();
                mapClickRouteSelect(id, true);
            });
            savedPoint.marker.on('dragend', event => {
                const position = event.target.getLatLng();
                savedPoint.lat = position.lat;
                savedPoint.lng = position.lng;
                scheduleLastPlanSave();
            });
            customWaypoints[id] = savedPoint;
            selOrder.push(id);
            bounds.push([savedPoint.lat, savedPoint.lng]);
        });
        calculatedRouteMetrics = Number.isFinite(Number(route.distance_m)) && route.distance_m !== null
            ? { signature: routeSelectionSignature(), distance_m: Number(route.distance_m), approximate: !!route.distance_approximate }
            : null;
        editingSavedRouteId = route.is_last_plan ? null : Number(route.id);
        $('#btn-save-route').text(route.is_last_plan ? 'Sichern' : 'Update');
        refreshAllMarkerIcons();
        updateSavedRouteMarkerIcons();
        renderSelectionList();
        updateRouteBtn();
        scheduleLastPlanSave();
        if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        bootstrap.Modal.getInstance(document.getElementById('saved-routes-modal'))?.hide();
    });

    $(document).on('click', '.saved-route-delete', async function () {
        const id = Number($(this).data('id'));
        const route = savedRoutes.find(item => Number(item.id) === id);
        if (!route || !window.confirm(`Route „${route.name}“ löschen?`)) return;
        try {
            const response = await fetch('api/routes.php', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Route konnte nicht gelöscht werden.');
            if (Number(editingSavedRouteId) === id) {
                editingSavedRouteId = null;
                $('#btn-save-route').text('Sichern');
            }
            await refreshSavedRoutes();
        } catch (error) { window.alert(error.message); }
    });

    refreshSavedRoutes();

    $(document).on('click', '#btn-clear-sel', function () {
        selOrder = [];
        scheduleLastPlanSave(true);
        Object.values(customWaypoints).forEach(wp => map.removeLayer(wp.marker));
        customWaypoints = {};
        customWpCounter = 0;
        refreshAllMarkerIcons();
        if (routeSelectMode) { renderSelectionList(); } else { renderCaches(panelCaches); updateSelBadges(); }
        updateRouteBtn();
    });

    $(document).on('click', '#btn-calc-route', calcRoute);

    async function calcRoute() {
        const planSignature = routeSelectionSignature();
        let caches = selOrder.map(id => getWaypoint(id)).filter(Boolean);
        if (caches.length < 2) return;
        if ($('#chk-roundtrip').prop('checked')) caches = [...caches, { ...caches[0] }];

        inRouteMode = true;
        $('#list-body').html(
            '<div class="text-center text-muted p-4">' +
            '<div class="spinner-border spinner-border-sm me-2"></div>Route wird berechnet…</div>'
        );

        const coordStr = caches.map(c => (+c.lng).toFixed(6) + ',' + (+c.lat).toFixed(6)).join(';');
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 15000);
        const osrmData = await fetch(
            'https://osrm.oklabflensburg.de/foot/route/v1/driving/' + coordStr +
            '?overview=full&geometries=geojson',
            { signal: ctrl.signal }
        ).then(r => r.ok ? r.json() : null).catch(() => null);

        const osrmRoute = osrmData?.code === 'Ok' ? osrmData.routes?.[0] : null;
        const legs = [], allCoords = [];

        if (osrmRoute?.geometry?.coordinates?.length >= 2) {
            osrmRoute.legs.forEach(leg => legs.push({ distance: leg.distance }));
            allCoords.push(...osrmRoute.geometry.coordinates);
        } else {
            caches.slice(0, -1).forEach((c, i) => {
                legs.push({ distance: hvDist(c, caches[i + 1]), fallback: true });
            });
            caches.forEach(c => allCoords.push([+c.lng, +c.lat]));
        }
        const distanceMeters = legs.reduce((sum, leg) => sum + leg.distance, 0);
        calculatedRouteMetrics = {
            signature: planSignature,
            distance_m: distanceMeters,
            approximate: legs.some(leg => leg.fallback),
        };
        const geometry = allCoords.length > 1 ? { type: 'LineString', coordinates: allCoords } : null;

        // Draw route on map
        clearRouteMapLayers();
        const routeLatLngs = geometry
            ? geometry.coordinates.map(([lng, lat]) => L.latLng(+lat, +lng))
            : caches.map(c => L.latLng(+c.lat, +c.lng));
        routeGeometryPoints = routeLatLngs;
        routeLayer = L.layerGroup([
            L.polyline(routeLatLngs, { color: '#fff', weight: 13, opacity: .95, lineCap: 'round', lineJoin: 'round' }),
            L.polyline(routeLatLngs, { color: '#dc2626', weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }),
        ]).addTo(map);
        if ($('#chk-route-km-labels').prop('checked')) {
            routeKmLayer = L.layerGroup(createRouteKilometerMarkers(routeLatLngs)).addTo(map);
        }
        $('#route-km-toggle').removeClass('d-none');
        map.fitBounds(L.latLngBounds(routeLatLngs), { padding: [40, 40] });

        $('#list-body').html(buildRouteHtml(caches, legs));
        $('#list-footer').html(
            '<div class="d-grid gap-1">' +
              '<button id="btn-back-sel" class="btn btn-sm btn-outline-secondary">← Zurück zur Auswahl</button>' +
              '<button id="btn-route-profile" class="btn btn-sm btn-outline-info">Höhenprofil &amp; Wegbeschaffenheit</button>' +
              '<div class="d-flex gap-1">' +
                '<button id="btn-export-route" class="btn btn-sm btn-success flex-fill">CSV</button>' +
                '<button id="btn-export-route-gpx" class="btn btn-sm btn-outline-success flex-fill" title="Route als GPX-Datei speichern" aria-label="Route als GPX-Datei speichern">GPX</button>' +
                '<button id="btn-save-route-image" class="btn btn-sm btn-outline-primary flex-fill">PNG</button>' +
                '<button id="btn-whatsapp-route" class="btn btn-sm btn-outline-success flex-fill">WhatsApp</button>' +
                '<button id="btn-gpx-help" class="btn btn-sm btn-outline-secondary px-2" title="GPX in Google Maps verwenden" aria-label="Hilfe zum GPX-Import">?</button>' +
              '</div>' +
            '</div>'
        );
        $('#btn-route-mode').addClass('route-calculated');
        routeCsvCodes = caches.filter(c => c.isCache !== false && c.gc_code).map(c => c.gc_code);
    }

    const routeSurfaceLabels = {
        paved: 'Befestigt', asphalt: 'Asphalt', concrete: 'Beton', 'concrete:plates': 'Betonplatten', paving_stones: 'Pflastersteine',
        sett: 'Kopfsteinpflaster', cobblestone: 'Kopfsteinpflaster', gravel: 'Schotter', fine_gravel: 'Feiner Schotter',
        compacted: 'Verdichteter Untergrund', unpaved: 'Unbefestigt', dirt: 'Erde', ground: 'Naturboden', earth: 'Erde',
        grass: 'Gras', sand: 'Sand', mud: 'Schlamm', wood: 'Holz', woodchips: 'Holzhackschnitzel', pebblestone: 'Kiesel',
        track: 'Fahrspur', footway: 'Fußweg', path: 'Pfad', cycleway: 'Radweg', service: 'Zufahrtsweg',
        residential: 'Wohnstraße', road: 'Straße', unknown: 'Nicht erfasst',
    };
    function routeSurfaceLabel(value) {
        const key = String(value || 'unknown');
        return routeSurfaceLabels[key] || key.replaceAll('_', ' ');
    }
    function routeProfileDistanceLabel(meters) {
        return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km` : `${Math.round(meters)} m`;
    }
    function renderRouteProfileChart(points, routeDistance) {
        const known = (points || []).filter(point => point.elevation_m !== null && point.elevation_m !== undefined && Number.isFinite(Number(point.elevation_m)));
        if (known.length < 2) return '<p class="small text-muted mb-0">Für diese Route liegen nicht genügend Höhenwerte vor.</p>';
        const width = 820, height = 230, left = 48, right = 14, top = 16, bottom = 32;
        const min = Math.min(...known.map(point => +point.elevation_m));
        const max = Math.max(...known.map(point => +point.elevation_m));
        const span = Math.max(10, max - min);
        const maxDistance = Math.max(1, +routeDistance || +known[known.length - 1].distance_m || 1);
        const x = distance => left + (width - left - right) * distance / maxDistance;
        const y = value => top + (height - top - bottom) * (max - value) / span;
        const line = known.map((point, i) => `${i ? 'L' : 'M'}${x(+point.distance_m || 0).toFixed(1)},${y(+point.elevation_m).toFixed(1)}`).join(' ');
        const area = `${line} L${x(+known[known.length - 1].distance_m || 0).toFixed(1)},${height - bottom} L${x(+known[0].distance_m || 0).toFixed(1)},${height - bottom} Z`;
        const grid = [0, .5, 1].map(ratio => {
            const gy = top + (height - top - bottom) * ratio;
            const elevation = Math.round(max - span * ratio);
            return `<line class="profile-grid" x1="${left}" y1="${gy}" x2="${width - right}" y2="${gy}"/><text class="profile-label" x="${left - 7}" y="${gy + 4}" text-anchor="end">${elevation} m</text>`;
        }).join('');
        return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Höhenprofil zwischen ${Math.round(min)} und ${Math.round(max)} Metern">
            ${grid}<path class="profile-area" d="${area}"/><path class="profile-line" d="${line}"/>
            <line id="route-profile-cursor-line" x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" stroke="#374151" stroke-dasharray="3 3" display="none"/>
            <circle id="route-profile-cursor-dot" cx="${left}" cy="${top}" r="5" fill="#f59e0b" stroke="#fff" stroke-width="2" display="none"/>
            <text class="profile-label" x="${left}" y="${height - 7}">0 km</text>
            <text class="profile-label" x="${width - right}" y="${height - 7}" text-anchor="end">${(maxDistance / 1000).toFixed(1)} km</text>
        </svg>`;
    }
    function renderRouteProfile(data) {
        const elevation = data.elevation;
        const stats = [
            ['Strecke', routeProfileDistanceLabel(data.distance_m)],
            ['Aufstieg', elevation ? `${elevation.ascent_m} m` : '–'],
            ['Abstieg', elevation ? `${elevation.descent_m} m` : '–'],
            ['Höhenlage', elevation ? `${elevation.min_m}–${elevation.max_m} m` : '–'],
        ];
        $('#route-profile-summary').html(stats.map(([label, value]) => `<div class="route-profile-stat"><strong>${escHtml(value)}</strong><span>${escHtml(label)}</span></div>`).join(''));
        activeRouteProfileData = data;
        $('#route-profile-cursor-readout').text('Entlang des Profils bewegen für Streckenhöhe');
        $('#route-profile-chart').html(elevation ? renderRouteProfileChart(elevation.points, data.distance_m) : '<p class="small text-muted">Höhendaten konnten nicht geladen werden.</p>');
        const elevationSources = { eudem25m: 'EU-DEM 25 m', srtm90m: 'SRTM 90 m' };
        $('#route-profile-elevation-source').text(elevation
            ? `Höhenmodell: ${(elevation.datasets || []).map(name => elevationSources[name] || name).join(', ') || 'unbekannt'}`
            : 'Höhenmodell nicht verfügbar.');

        const palette = ['#369b62', '#83b94a', '#c5bd38', '#e5a63b', '#dd7b3d', '#c95e4b', '#7e8f65', '#668ca0', '#9b83a8', '#9ca3af'];
        function renderRouteBreakdown(selector, categories, kind, helperText = '') {
            if (!categories) {
                $(selector).html('<p class="small text-muted">Diese Angaben konnten nicht geladen werden.</p>');
                return;
            }
            const all = (categories.categories || []).filter(item => +item.percent > 0).sort((a, b) => +b.meters - +a.meters);
            const visible = all.slice(0, 9);
            if (all.length > 9) {
                visible.push({
                    key: '__other', meters: all.slice(9).reduce((sum, item) => sum + +item.meters, 0),
                    percent: all.slice(9).reduce((sum, item) => sum + +item.percent, 0),
                });
            }
            const labelFor = key => {
                if (key === '__missing_surface') return 'Keine Oberflächenangabe';
                if (key === '__missing_waytype') return 'Wegtyp nicht erfasst';
                if (key === '__missing_tracktype') return 'Keine Angabe';
                if (key === '__missing_smoothness') return 'Keine Angabe';
                if (key === '__unmatched') return 'Keine OSM-Wegdaten';
                if (key === '__other') return 'Weitere';
                if (kind === 'surface') return routeSurfaceLabel(key);
                if (kind === 'tracktype') {
                    const firmness = { grade1: 'Grad 1 · fest', grade2: 'Grad 2 · überwiegend fest', grade3: 'Grad 3 · gemischt', grade4: 'Grad 4 · überwiegend weich', grade5: 'Grad 5 · weich' };
                    return firmness[key] || String(key).replaceAll('_', ' ');
                }
                if (kind === 'smoothness') {
                    const quality = { excellent: 'Sehr gut', good: 'Gut', intermediate: 'Mittel', bad: 'Schlecht', very_bad: 'Sehr schlecht', horrible: 'Schlimm', very_horrible: 'Sehr schlimm', impassable: 'Unpassierbar' };
                    return quality[key] || String(key).replaceAll('_', ' ');
                }
                const names = { footway: 'Fußweg', path: 'Pfad', track: 'Wirtschaftsweg', steps: 'Treppe', cycleway: 'Radweg', service: 'Zufahrtsweg', residential: 'Wohnstraße', pedestrian: 'Fußgängerweg', bridleway: 'Reitweg', unclassified: 'Nebenstraße', primary: 'Hauptstraße', secondary: 'Landstraße', tertiary: 'Kreisstraße', living_street: 'Verkehrsberuhigter Bereich' };
                return names[key] || String(key).replaceAll('_', ' ');
            };
            const bar = visible.map((item, index) => {
                const percent = Math.max(0, Math.min(100, +item.percent));
                return `<span class="route-profile-bar-segment" style="width:${percent}%;background:${palette[index % palette.length]}" title="${escHtml(labelFor(item.key))}: ${percent.toFixed(1)} %"></span>`;
            }).join('');
            const legend = visible.map((item, index) => `<div class="route-profile-legend-row">
                <div class="route-profile-legend-name"><span class="route-profile-legend-swatch" style="background:${palette[index % palette.length]}"></span><span class="route-profile-legend-label">${escHtml(labelFor(item.key))}</span></div>
                <span class="route-profile-legend-distance">${escHtml(routeProfileDistanceLabel(item.meters))}</span>
                <span class="route-profile-legend-percent">${escHtml(Number(item.percent).toFixed(1))} %</span>
            </div>`).join('');
            $(selector).html(visible.length
                ? `<div class="route-profile-bars" role="img" aria-label="Aufteilung der Route">${bar}</div><div class="route-profile-legend">${legend}</div>${helperText ? `<p class="small text-muted mt-2 mb-0">${escHtml(helperText)}</p>` : ''}`
                : '<p class="small text-muted">Keine passenden OSM-Wegdaten gefunden.</p>');
        }
        renderRouteBreakdown('#route-profile-waytypes', data.way_types, 'waytype');
        renderRouteBreakdown('#route-profile-surfaces', data.surface, 'surface', data.surface ? `${data.surface.tagged_percent} % der Strecke haben eine explizite Oberflächenangabe.` : '');
        renderRouteBreakdown('#route-profile-tracktypes', data.tracktypes, 'tracktype', data.tracktypes ? `${data.tracktypes.tagged_percent} % mit tracktype-Angabe.` : '');
        renderRouteBreakdown('#route-profile-smoothness', data.smoothness, 'smoothness', data.smoothness ? `${data.smoothness.tagged_percent} % mit smoothness-Angabe.` : '');
        const warnings = (data.warnings || []).map(escHtml);
        $('#route-profile-status').toggleClass('text-danger', warnings.length > 0 && !elevation && !surface)
            .toggleClass('text-muted', warnings.length === 0 || !!elevation || !!surface)
            .html(warnings.length ? warnings.join('<br>') : 'Profildaten geladen.');
    }
    $(document).on('pointermove', '#route-profile-chart svg', function (event) {
        const points = activeRouteProfileData?.elevation?.points || [];
        const bounds = this.getBoundingClientRect();
        if (!points.length || bounds.width <= 0) return;
        const viewX = (event.originalEvent.clientX - bounds.left) * 820 / bounds.width;
        const left = 48, right = 14;
        const ratio = Math.max(0, Math.min(1, (viewX - left) / (820 - left - right)));
        const distance = ratio * (+activeRouteProfileData.distance_m || 0);
        const known = points.filter(point => point.elevation_m !== null && point.elevation_m !== undefined);
        if (!known.length) return;
        const nearest = known.reduce((best, point) => Math.abs(+point.distance_m - distance) < Math.abs(+best.distance_m - distance) ? point : best, known[0]);
        const x = left + ratio * (820 - left - right);
        const elevationPoints = known.map(point => +point.elevation_m);
        const min = Math.min(...elevationPoints), max = Math.max(...elevationPoints), span = Math.max(10, max - min);
        const y = 16 + (230 - 16 - 32) * (max - +nearest.elevation_m) / span;
        $('#route-profile-cursor-line').attr({ x1: x, x2: x, display: 'inline' });
        $('#route-profile-cursor-dot').attr({ cx: x, cy: y, display: 'inline' });
        $('#route-profile-cursor-readout').text(`${routeProfileDistanceLabel(distance)} · ${Math.round(+nearest.elevation_m)} m`);
    });
    $(document).on('pointerout', '#route-profile-chart svg', function (event) {
        if (this.contains(event.originalEvent.relatedTarget)) return;
        $('#route-profile-cursor-line, #route-profile-cursor-dot').attr('display', 'none');
        $('#route-profile-cursor-readout').text('Entlang des Profils bewegen für Streckenhöhe');
    });
    $(document).on('click', '#btn-route-profile', async function () {
        const coordinates = routeGeometryPoints.map(point => [+point.lng, +point.lat]);
        if (coordinates.length < 2) return;
        const signature = JSON.stringify(coordinates.map(pair => pair.map(value => +value.toFixed(5))));
        $('#route-profile-summary, #route-profile-chart, #route-profile-waytypes, #route-profile-surfaces, #route-profile-tracktypes, #route-profile-smoothness, #route-profile-elevation-source').empty();
        $('#route-profile-status').removeClass('text-danger').addClass('text-muted').text('Höhen- und OSM-Daten werden geladen …');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('route-profile-modal')).show();
        if (routeProfileCache?.signature === signature
            && routeProfileCache.data.surface
            && routeProfileCache.data.elevation
            && !(routeProfileCache.data.warnings || []).length) {
            renderRouteProfile(routeProfileCache.data);
            return;
        }
        const $button = $(this).prop('disabled', true);
        try {
            const response = await fetch('api/route_profile.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ coordinates }),
                signal: AbortSignal.timeout(85000),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Streckenprofil konnte nicht berechnet werden.');
            // A transient provider failure must not poison the cache for this route.
            routeProfileCache = data.surface && data.elevation && !(data.warnings || []).length
                ? { signature, data }
                : null;
            renderRouteProfile(data);
        } catch (error) {
            $('#route-profile-status').removeClass('text-muted').addClass('text-danger').text(error.message || 'Profildaten konnten nicht geladen werden.');
        } finally { $button.prop('disabled', false); }
    });

    function createRouteKilometerMarkers(points) {
        const markers = [];
        let travelled = 0;
        let nextKm = 1000;
        for (let i = 1; i < points.length; i++) {
            const start = points[i - 1], end = points[i];
            const segmentLength = map.distance(start, end);
            if (!Number.isFinite(segmentLength) || segmentLength <= 0) continue;
            while (travelled + segmentLength >= nextKm) {
                const fraction = (nextKm - travelled) / segmentLength;
                const position = L.latLng(
                    start.lat + (end.lat - start.lat) * fraction,
                    start.lng + (end.lng - start.lng) * fraction
                );
                const marker = L.marker(position, {
                    interactive: false,
                    keyboard: false,
                    icon: L.divIcon({
                        className: 'route-km-icon',
                        html: `<span class="route-km-label">${Math.round(nextKm / 1000)}</span>`,
                        iconSize: [22, 22],
                        iconAnchor: [11, 11],
                    }),
                });
                marker._routeKmLabel = Math.round(nextKm / 1000);
                markers.push(marker);
                nextKm += 1000;
            }
            travelled += segmentLength;
        }
        return markers;
    }

    function drawRouteMapSnapshot() {
        const mapElement = map.getContainer();
        const rect = mapElement.getBoundingClientRect();
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(rect.width * scale);
        canvas.height = Math.round(rect.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(0, 0, rect.width, rect.height);

        // Draw the exact loaded raster tiles at their current screen positions.
        const tiles = Array.from(mapElement.querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded'));
        for (const tile of tiles) {
            if (!tile.complete || !tile.naturalWidth) continue;
            const tileRect = tile.getBoundingClientRect();
            try { ctx.drawImage(tile, tileRect.left - rect.left, tileRect.top - rect.top, tileRect.width, tileRect.height); }
            catch (_) { throw new Error('Der Kartenanbieter erlaubt den Bildexport für diese Kartenkacheln nicht.'); }
        }

        // Repaint the route line, which keeps the image crisp at export scale.
        if (routeLayer) routeLayer.eachLayer(layer => {
            if (typeof layer.getLatLngs !== 'function') return;
            const path = layer.getLatLngs();
            const points = (Array.isArray(path[0]) ? path.flat(Infinity) : path)
                .filter(point => point && Number.isFinite(point.lat) && Number.isFinite(point.lng))
                .map(point => map.latLngToContainerPoint(point));
            if (points.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.strokeStyle = layer.options.color || '#dc2626';
            ctx.lineWidth = layer.options.weight || 5;
            ctx.globalAlpha = layer.options.opacity ?? 1;
            ctx.stroke();
            ctx.globalAlpha = 1;
        });
        if (routeKmLayer) routeKmLayer.eachLayer(layer => {
            const point = map.latLngToContainerPoint(layer.getLatLng());
            ctx.beginPath();
            ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
            ctx.fillStyle = '#111';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.font = 'bold 10px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            ctx.fillText(String(layer._routeKmLabel), point.x, point.y);
        });

        // Add numbered route markers on top of the line.
        selOrder.forEach((id, index) => {
            const point = getWaypoint(id);
            if (!point) return;
            const p = map.latLngToContainerPoint([+point.lat, +point.lng]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
            ctx.fillStyle = point.isCache ? (TYPE_COLOR[cacheReg[point.gc_code]?.cache_type] || '#2563eb') : '#7c3aed';
            ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(index + 1), p.x, p.y + .5);

            const name = String(point.name || point.gc_code || 'Wegpunkt');
            const code = String(point.gc_code || '');
            ctx.font = '600 10px Arial, sans-serif';
            const maxTextWidth = 150;
            const shorten = (text, maxWidth) => {
                if (ctx.measureText(text).width <= maxWidth) return text;
                let result = text;
                while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
                return `${result}…`;
            };
            const shownName = shorten(name, maxTextWidth);
            ctx.font = '600 10px Arial, sans-serif';
            const nameWidth = ctx.measureText(shownName).width;
            ctx.font = '700 9px Arial, sans-serif';
            const shownCode = code ? shorten(code, maxTextWidth) : '';
            const codeWidth = shownCode ? ctx.measureText(shownCode).width : 0;
            const labelWidth = Math.max(nameWidth, codeWidth) + 12;
            const labelHeight = shownCode ? 26 : 16;
            const labelX = p.x + labelWidth + 18 <= rect.width ? p.x + 15 : p.x - labelWidth - 15;
            const labelY = Math.max(4, Math.min(rect.height - labelHeight - 4, p.y - labelHeight / 2));
            ctx.fillStyle = 'rgba(255,255,255,.94)';
            ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
            ctx.strokeStyle = 'rgba(17,24,39,.65)';
            ctx.lineWidth = .75;
            ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#111827';
            ctx.font = '600 10px Arial, sans-serif';
            ctx.fillText(shownName, labelX + 6, labelY + (shownCode ? 8 : labelHeight / 2));
            if (shownCode) {
                ctx.fillStyle = '#374151';
                ctx.font = '700 9px Arial, sans-serif';
                ctx.fillText(shownCode, labelX + 6, labelY + 19);
            }
        });

        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.fillRect(8, 8, 146, 25);
        ctx.fillStyle = '#111827'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(`Route · ${selOrder.length} Punkte`, 15, 20.5);
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        ctx.fillRect(Math.max(0, rect.width - 164), Math.max(0, rect.height - 20), 160, 16);
        ctx.fillStyle = '#374151'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText('© OpenStreetMap / Kartenanbieter', rect.width - 8, rect.height - 12);
        return canvas;
    }

    function downloadRouteSnapshot() {
        const canvas = drawRouteMapSnapshot();
        return new Promise((resolve, reject) => canvas.toBlob(blob => {
            if (!blob) return reject(new Error('Bildexport nicht möglich (Kartenkacheln ohne CORS-Freigabe).'));
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `geocaching-route-${new Date().toISOString().slice(0, 10)}.png`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            resolve();
        }, 'image/png'));
    }
    $(document).on('click', '#btn-save-route-image', async function () {
        const $button = $(this).prop('disabled', true);
        try {
            await downloadRouteSnapshot();
        } catch (error) {
            console.error('Routenbild konnte nicht exportiert werden:', error);
        } finally { $button.prop('disabled', false); }
    });
    $(document).on('click', '#btn-whatsapp-route', async function () {
        const $button = $(this).prop('disabled', true);
        const routePoints = selOrder.map(id => getWaypoint(id)).filter(Boolean);
        const distance = routeGeometryPoints.slice(1).reduce((sum, point, index) => sum + map.distance(routeGeometryPoints[index], point), 0);
        const lines = routePoints.slice(0, 35).map((point, index) => {
            const label = String(point.name || point.gc_code || `Wegpunkt ${index + 1}`).replace(/[\r\n]+/g, ' ').trim();
            const links = [];
            if (point.gc_code) links.push(`https://coord.info/${encodeURIComponent(point.gc_code)}`);
            const lat = Number(point.lat), lng = Number(point.lng);
            if (!point.isCache && Number.isFinite(lat) && Number.isFinite(lng)
                && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                links.push(`https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`);
            }
            const coordinates = !point.isCache && Number.isFinite(lat) && Number.isFinite(lng)
                && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
                ? ` (${lat.toFixed(6)}, ${lng.toFixed(6)})`
                : '';
            return `${index + 1}. ${links.length ? `${links.join(' · ')} · ` : ''}${label}${coordinates}`;
        });
        if (routePoints.length > lines.length) lines.push(`… und ${routePoints.length - lines.length} weitere Wegpunkte`);
        const message = [`Geocaching-Route · ${routePoints.length} Punkte · ${(distance / 1000).toFixed(1)} km`, ...lines].join('\n');
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
        // Open synchronously from the click gesture so popup blockers allow WhatsApp Web.
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
        try {
            await downloadRouteSnapshot();
        } catch (error) {
            console.error('Routenbild für WhatsApp konnte nicht exportiert werden:', error);
        } finally { $button.prop('disabled', false); }
    });

    $(document).on('click', '#btn-export-route', function () {
        const csv = routeCsvCodes.join(',');
        $('#route-csv-values').val(csv);
        $('#route-csv-copy-status').text('Kopieren läuft …');
        new bootstrap.Modal(document.getElementById('route-csv-modal')).show();
        let copyPromise;
        try {
            if (navigator.clipboard?.writeText) copyPromise = navigator.clipboard.writeText(csv);
            else throw new Error('Clipboard API nicht verfügbar');
        } catch (_) {
            copyPromise = Promise.reject();
        }
        copyPromise.then(() => {
            $('#route-csv-copy-status').text('Codes wurden in die Zwischenablage kopiert.');
        }).catch(() => {
            const temp = document.createElement('textarea');
            temp.value = csv;
            temp.style.position = 'fixed'; temp.style.opacity = '0';
            document.body.appendChild(temp); temp.select();
            const copied = document.execCommand('copy');
            temp.remove();
            $('#route-csv-copy-status').text(copied
                ? 'Codes wurden in die Zwischenablage kopiert.'
                : 'Automatisches Kopieren nicht möglich. Die Codes sind markiert.');
        });
    });

    function xmlEscape(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
        })[character]);
    }

    $(document).on('click', '#btn-export-route-gpx', function () {
        const points = selOrder.map(id => getWaypoint(id)).filter(Boolean);
        if (points.length < 2) return;
        const track = [];
        if (routeLayer) {
            routeLayer.eachLayer(layer => {
                if (layer.options?.color !== '#dc2626' || typeof layer.getLatLngs !== 'function') return;
                const values = layer.getLatLngs();
                const flattened = Array.isArray(values[0]) ? values.flat(Infinity) : values;
                flattened.forEach(point => {
                    if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) track.push(point);
                });
            });
        }
        const gpxStops = points.map(point => {
            const gcCode = /^[A-Z0-9]{2,}$/i.test(String(point.gc_code || '')) ? String(point.gc_code).toUpperCase() : '';
            const cacheUrl = gcCode ? `https://www.geocaching.com/geocache/${gcCode}` : '';
            const cacheLink = gcCode
                ? `<link href="${cacheUrl}"><text>Geocache auf geocaching.com</text><type>text/html</type></link>`
                : '';
            const homeSymbol = point.isHome ? '<sym>Home</sym>' : '';
            const cacheDescription = gcCode
                ? `<desc>Geocache ${xmlEscape(gcCode)}: ${xmlEscape(cacheUrl)}</desc>`
                : '';
            return `    <wpt lat="${(+point.lat).toFixed(7)}" lon="${(+point.lng).toFixed(7)}"><name>${xmlEscape(point.name)}</name>${gcCode ? `<cmt>${xmlEscape(gcCode)}</cmt>` : ''}${cacheDescription}${cacheLink}${homeSymbol}</wpt>`;
        }).join('\n');
        const gpxTrack = track.length > 1
            ? `\n  <trk><name>${xmlEscape(savedRoutes.find(route => Number(route.id) === Number(editingSavedRouteId))?.name || 'Geocaching-Route')}</name><trkseg>\n${track.map(point => `      <trkpt lat="${(+point.lat).toFixed(7)}" lon="${(+point.lng).toFixed(7)}"></trkpt>`).join('\n')}\n    </trkseg></trk>`
            : '';
        const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Geocaching-Karte" xmlns="http://www.topografix.com/GPX/1/1">\n${gpxStops}${gpxTrack}\n</gpx>`;
        const blob = new Blob([gpx], { type: 'application/gpx+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `geocaching-route-${new Date().toISOString().slice(0, 10)}.gpx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    $(document).on('click', '#btn-gpx-help', function () {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('gpx-import-help-modal')).show();
    });
    $('#route-csv-modal').on('shown.bs.modal', function () {
        $('#route-csv-values').trigger('focus').trigger('select');
    });

    $(document).on('click', '#btn-back-sel', function () {
        inRouteMode = false;
        clearRouteMapLayers();
        renderSelectionList();
        updateRouteBtn();
    });

    function buildRouteHtml(caches, legs) {
        const allFb   = legs.every(l => l.fallback);
        const anyFb   = legs.some(l => l.fallback);
        const total   = legs.reduce((s, l) => s + l.distance, 0);
        const srcNote = allFb ? '⚠ Luftlinie (OSRM nicht erreichbar)'
                      : anyFb ? '⚠ Teils Luftlinie (einzelne Abschnitte)'
                      : '🚶 Fußweg via OSRM';

        let h = '<div class="p-2">' +
            '<div class="route-source-note">' + srcNote + '</div>';

        caches.forEach(function (c, i) {
            const col = c.color || '#6b7280';
            const sub = c.isCache === false ? 'Eigener Wegpunkt' : (c.cache_type_name || '');
            h += '<div class="route-waypoint" data-route-id="' + escHtml(c.id || c.gc_code || '') + '">' +
                 '<span class="route-num" style="background:' + col + ';color:' + (c.isHome ? '#111827' : '#fff') + '">' + (i + 1) + '</span>' +
                 '<div class="overflow-hidden flex-grow-1">' +
                   '<div class="small fw-semibold text-truncate">' + escHtml(c.name) + '</div>' +
                   '<div style="font-size:.71rem;color:#6b7280">' + escHtml(sub) + '</div>' +
                 '</div></div>';
            if (legs[i]) {
                h += '<div class="route-leg-dist">' + fmtDist(legs[i].distance) + '</div>';
            }
        });

        h += '<div class="route-total">Gesamt: <strong>' + fmtDist(total) + '</strong></div></div>';
        return h;
    }

    function fmtDist(m) {
        return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
    }

    function hvDist(a, b) {
        const R = 6371000, r = d => d * Math.PI / 180;
        const f1 = r(+a.lat), f2 = r(+b.lat);
        const df = r(+b.lat - +a.lat), dl = r(+b.lng - +a.lng);
        const x  = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(x));
    }

    // ── Mouse position control ────────────────────────────────────────────────
    function toDDM(lat, lng) {
        const latH = lat >= 0 ? 'N' : 'S';
        const lngH = lng >= 0 ? 'E' : 'W';
        const aLat = Math.abs(lat), aLng = Math.abs(lng);
        const dLat = Math.floor(aLat), dLng = Math.floor(aLng);
        const mLat = (aLat - dLat) * 60, mLng = (aLng - dLng) * 60;
        const fmt = (d, pad, m) => {
            const wi = Math.floor(m);
            const fr = String(Math.round((m - wi) * 1000)).padStart(3, '0');
            return String(d).padStart(pad, '0') + '°' + String(wi).padStart(2, '0') + '.' + fr;
        };
        return `${latH} ${fmt(dLat, 2, mLat)}  ${lngH} ${fmt(dLng, 3, mLng)}`;
    }

    const MousePosCtrl = L.Control.extend({
        onAdd(m) {
            const el = L.DomUtil.create('div', 'mouse-pos-ctrl');
            el.innerHTML = '<div>–</div><div></div><div class="mouse-pos-zoom"></div>';
            const zoom = () => { el.children[2].textContent = 'Zoomstufe ' + m.getZoom(); };
            zoom();
            m.on('zoomend', zoom);
            m.on('mousemove', e => {
                const { lat, lng } = e.latlng;
                el.children[0].textContent = toDDM(lat, lng);
                el.children[1].textContent = lat.toFixed(6) + '  /  ' + lng.toFixed(6);
            });
            m.on('mouseout', () => {
                el.children[0].textContent = '–';
                el.children[1].textContent = '';
            });
            return el;
        }
    });
    new MousePosCtrl({ position: 'bottomright' }).addTo(map);

    // ── Rubber-band zoom (view mode, btn-zoom-box) ────────────────────────────
    const _mapEl = map.getContainer();
    let _zbActive = false, _zbStart = null, _zbBox = null;

    $('#btn-zoom-box').on('click', function () {
        _zbActive = !_zbActive;
        $(this).toggleClass('active', _zbActive);
        _mapEl.style.cursor = _zbActive ? 'crosshair' : '';
    });

    _mapEl.addEventListener('mousedown', function (e) {
        if (!_zbActive || e.button !== 0 || drawMode !== 'view') return;
        e.stopPropagation();
        e.preventDefault();
        const r = _mapEl.getBoundingClientRect();
        _zbStart = { x: e.clientX - r.left, y: e.clientY - r.top };
        _zbBox = document.createElement('div');
        Object.assign(_zbBox.style, {
            position: 'absolute', border: '2px dashed #0d6efd',
            background: 'rgba(13,110,253,.08)', pointerEvents: 'none',
            zIndex: 900, left: _zbStart.x + 'px', top: _zbStart.y + 'px', width: '0', height: '0',
        });
        _mapEl.appendChild(_zbBox);
        document.addEventListener('mousemove', _zbMove);
        document.addEventListener('mouseup', _zbEnd, { once: true });
    }, true);

    function _zbMove(e) {
        if (!_zbBox || !_zbStart) return;
        const r = _mapEl.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        Object.assign(_zbBox.style, {
            left: Math.min(_zbStart.x, cx) + 'px', top:    Math.min(_zbStart.y, cy) + 'px',
            width: Math.abs(cx - _zbStart.x) + 'px', height: Math.abs(cy - _zbStart.y) + 'px',
        });
    }

    function _zbEnd(e) {
        document.removeEventListener('mousemove', _zbMove);
        if (!_zbBox || !_zbStart) return;
        const r = _mapEl.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        _mapEl.removeChild(_zbBox); _zbBox = null;
        const x1 = Math.min(_zbStart.x, cx), y1 = Math.min(_zbStart.y, cy);
        const x2 = Math.max(_zbStart.x, cx), y2 = Math.max(_zbStart.y, cy);
        _zbStart = null;
        if (x2 - x1 > 10 && y2 - y1 > 10) {
            skipNextDbLoad = true;
            map.fitBounds([map.containerPointToLatLng([x1, y2]), map.containerPointToLatLng([x2, y1])]);
        }
        _zbActive = false;
        $('#btn-zoom-box').removeClass('active');
        _mapEl.style.cursor = '';
    }

    // ── Utilities ─────────────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s ?? '').replace(/[&<>"]/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
        }[c]));
    }

    function strip300(html) {
        const text = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return text.slice(0, 300);
    }

    function rot13(s) {
        return String(s).replace(/[a-zA-Z]/g, c => {
            const b = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
        });
    }

    function spinnerHtml(msg) {
        return `<div class="d-flex align-items-center gap-2 p-3 text-muted">
            <div class="spinner-border spinner-border-sm"></div><span>${msg}</span></div>`;
    }
    function spinnerSmall() {
        return '<span class="spinner-border spinner-border-sm"></span>';
    }
    function alertHtml(msg, type) {
        return `<div class="alert alert-${type} m-3">${escHtml(msg)}</div>`;
    }
});
