// WiNS Hub Comercial: interface sobre a API do google-maps-scraper.
(function () {
    'use strict';

    // Quantidade escolhida -> profundidade de rolagem no Maps e tempo limite padrão.
    var QTY = {
        20: { depth: 2, label: '~1 min', max: 600 },
        60: { depth: 5, label: '~3 min', max: 1200 },
        120: { depth: 10, label: '~6 min', max: 1800 },
        200: { depth: 18, label: '15+ min', max: 3600 }
    };

    var STATUS = { pending: 'Na fila', working: 'Buscando', ok: 'Concluída', failed: 'Falhou' };

    var $ = function (id) { return document.getElementById(id); };

    var state = {
        qty: 60,
        radiusKm: 5,
        email: false,
        geo: null,          // { lat, lon, label }
        jobs: [],
        counts: {},         // jobId -> nº de empresas
        selected: null,     // job selecionado
        places: [],
        selectedKeys: {},
        filter: 'all',
        sortKey: null,
        sortDir: 'asc',
        view: 'map'
    };

    // ---------- Mapa ----------

    var map = L.map('map', { zoomControl: false, attributionControl: true })
        .setView([-23.5505, -46.6333], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.attributionControl.setPrefix('Leaflet');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: 'abc',
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    var circle = null;
    var markers = L.layerGroup().addTo(map);
    var markerByKey = {};

    function panelOffset() {
        return window.innerWidth > 900 ? [440, 40] : [40, 40];
    }

    function drawCircle(lat, lon, km, fit) {
        if (circle) map.removeLayer(circle);
        circle = L.circle([lat, lon], {
            radius: km * 1000,
            color: '#f3f4f6',
            weight: 2,
            dashArray: '6 6',
            fillColor: '#f3f4f6',
            fillOpacity: 0.08
        }).addTo(map);
        if (fit) {
            map.flyToBounds(circle.getBounds(), {
                paddingTopLeft: panelOffset(),
                paddingBottomRight: [40, 40],
                duration: 0.8
            });
        }
    }

    function distKm(aLat, aLon, bLat, bLon) {
        var r = Math.PI / 180;
        var dLat = (bLat - aLat) * r;
        var dLon = (bLon - aLon) * r;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function zoomFor(km) {
        if (km <= 1.5) return 16;
        if (km <= 3) return 15;
        if (km <= 7) return 14;
        if (km <= 15) return 13;
        return 12;
    }

    // ---------- Formatação ----------

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function digits(phone) { return String(phone || '').replace(/\D/g, ''); }

    // Celular brasileiro: DDD + 9 dígitos começando com 9.
    function whatsapp(phone) {
        var d = digits(phone);
        if (d.indexOf('55') === 0 && d.length === 13) d = d.slice(2);
        if (d.length === 11 && d.charAt(2) === '9') return '55' + d;
        return null;
    }

    function siteKind(url) {
        if (!url) return 'none';
        if (/instagram\.com|facebook\.com|linktr\.ee|wa\.me|whatsapp\.com|tiktok\.com/i.test(url)) return 'social';
        return 'site';
    }

    function domain(url) {
        return String(url).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/$/, '');
    }

    function rating(n) { return n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : ''; }
    function int(n) { return Number(n || 0).toLocaleString('pt-BR'); }

    function dateBR(iso) {
        var d = new Date(iso);
        return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function toast(msg) {
        var t = $('toast');
        t.textContent = msg;
        t.classList.add('on');
        clearTimeout(toast.timer);
        toast.timer = setTimeout(function () { t.classList.remove('on'); }, 2200);
    }

    var ICON = {
        list: '<svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="18" r=".6"/></svg>',
        trash: '<svg viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
        phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
        globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
        pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
        mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
        arrow: '<svg viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M7 17 17 7M8 7h9v9"/></svg>'
    };

    // ---------- Formulário ----------

    function updateQtyDesc() {
        var q = QTY[state.qty];
        $('qtyDesc').textContent = 'Aproximado, leva ' + q.label + (state.email ? ' + e-mails' : '');
    }

    function updateRange() {
        var el = $('radius');
        var pct = (el.value - el.min) / (el.max - el.min) * 100;
        el.style.background = 'linear-gradient(to right, #f3f4f6 ' + pct + '%, #23293a ' + pct + '%)';
        $('radiusVal').textContent = el.value + ' km';
    }

    function segmented(containerId, attr, onPick) {
        $(containerId).addEventListener('click', function (e) {
            var b = e.target.closest('button');
            if (!b) return;
            Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
            onPick(b.getAttribute(attr));
        });
    }

    segmented('qty', 'data-qty', function (v) { state.qty = Number(v); updateQtyDesc(); });

    $('radius').addEventListener('input', function () {
        state.radiusKm = Number(this.value);
        updateRange();
        if (state.geo) drawCircle(state.geo.lat, state.geo.lon, state.radiusKm, false);
    });
    $('radius').addEventListener('change', function () {
        if (state.geo) drawCircle(state.geo.lat, state.geo.lon, state.radiusKm, true);
    });

    $('email').addEventListener('click', function () {
        state.email = !state.email;
        this.setAttribute('aria-pressed', String(state.email));
        updateQtyDesc();
    });

    // Geolocaliza o texto do campo "Onde?" (OpenStreetMap / Nominatim).
    var geoTimer = null;
    var geoSeq = 0;
    var hintDefault = $('locHint').innerHTML;

    function geocode(text) {
        var seq = ++geoSeq;
        $('locSpin').classList.add('on');
        var base = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt-BR&q=' + encodeURIComponent(text);
        return fetch(base + '&countrycodes=br')
            .then(function (r) { return r.json(); })
            .then(function (res) { return res.length ? res : fetch(base).then(function (r) { return r.json(); }); })
            .then(function (res) {
                if (seq !== geoSeq) return;
                $('locSpin').classList.remove('on');
                if (!res.length) {
                    state.geo = null;
                    $('locHint').className = 'hint';
                    $('locHint').textContent = 'Não achei esse local no mapa. A busca ainda funciona, só sem raio.';
                    return;
                }
                var parts = res[0].display_name.split(',').map(function (s) { return s.trim(); });
                state.geo = { lat: Number(res[0].lat), lon: Number(res[0].lon), label: parts.slice(0, 3).join(', ') };
                $('locHint').className = 'hint ok';
                $('locHint').textContent = state.geo.label;
                drawCircle(state.geo.lat, state.geo.lon, state.radiusKm, true);
            })
            .catch(function () {
                if (seq !== geoSeq) return;
                $('locSpin').classList.remove('on');
                state.geo = null;
            });
    }

    $('loc').addEventListener('input', function () {
        clearTimeout(geoTimer);
        var v = this.value.trim();
        if (!v) {
            state.geo = null;
            $('locHint').className = 'hint';
            $('locHint').innerHTML = hintDefault;
            if (circle) { map.removeLayer(circle); circle = null; }
            return;
        }
        geoTimer = setTimeout(function () { geocode(v); }, 650);
    });

    function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    // Traduz o CNAE na atividade correspondente, para permitir buscar sem
    // digitar o tipo de empresa.
    function resolveCnaeTerm(cnae) {
        return fetch('/api/v1/cnae/' + encodeURIComponent(cnae))
            .then(function (r) {
                return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || 'CNAE não encontrado'); return j; });
            })
            .then(function (j) { return j.termo; });
    }

    function submit() {
        var terms = $('q').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var loc = $('loc').value.trim();
        var cnaeVal = $('cnae').value.trim();
        $('err').textContent = '';
        if (!terms.length && !cnaeVal) {
            $('q').focus();
            $('err').textContent = 'Informe o tipo de empresa ou um CNAE.';
            return;
        }

        if (terms.length) { postJob(terms, loc); return; }

        resolveCnaeTerm(cnaeVal).then(function (term) {
            $('q').value = term;
            postJob([term], loc);
        }, function (e) {
            $('err').textContent = 'Não consegui usar esse CNAE: ' + e.message;
        });
    }

    function postJob(terms, loc) {
        var q = QTY[state.qty];
        var maxSel = $('maxTime').value;
        var maxTime = maxSel === 'auto' ? q.max * (state.email ? 2 : 1) : Number(maxSel);
        var shortLoc = loc ? loc.split(',')[0].trim() : '';

        var body = {
            name: terms.map(cap).join(', ') + (shortLoc ? ' · ' + cap(shortLoc) : ''),
            keywords: terms.map(function (t) { return loc ? t + ' em ' + loc : t; }),
            lang: $('lang').value,
            zoom: zoomFor(state.radiusKm),
            radius: state.radiusKm * 1000,
            depth: q.depth,
            email: state.email,
            max_time: maxTime,
            cnae: $('cnae').value.trim() || undefined
        };
        if (state.geo) {
            body.lat = String(state.geo.lat);
            body.lon = String(state.geo.lon);
        }

        $('go').disabled = true;
        $('go').textContent = 'Enviando...';
        fetch('/api/v1/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || 'Erro'); return j; }); })
            .then(function (res) {
                toast('Busca enviada. As empresas vão aparecendo no mapa.');
                return loadJobs().then(function () {
                    var job = state.jobs.filter(function (j) { return j.ID === res.id; })[0];
                    if (job) selectJob(job);
                });
            })
            .catch(function (e) { $('err').textContent = 'Não consegui iniciar a busca: ' + e.message; })
            .then(function () {
                $('go').disabled = false;
                $('go').textContent = 'Buscar empresas';
            });
    }

    $('go').addEventListener('click', submit);
    ['q', 'loc'].forEach(function (id) {
        $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            $('q').focus();
        }
    });

    // ---------- Suas buscas ----------

    function loadJobs() {
        return fetch('/api/v1/jobs')
            .then(function (r) { return r.json(); })
            .then(function (jobs) {
                $('engine').className = 'engine on';
                $('engine').innerHTML = '<i></i>motor online';
                state.jobs = (jobs || []).sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });
                if (state.selected) {
                    var fresh = state.jobs.filter(function (j) { return j.ID === state.selected.ID; })[0];
                    if (fresh) state.selected = fresh;
                }
                countMissing();
                renderJobs();
            })
            .catch(function () {
                $('engine').className = 'engine';
                $('engine').innerHTML = '<i></i>motor offline';
            });
    }

    function countMissing() {
        state.jobs.forEach(function (j) {
            if (j.Status === 'ok' && state.counts[j.ID] == null) {
                state.counts[j.ID] = '...';
                fetch('/api/v1/jobs/' + j.ID + '/places')
                    .then(function (r) { return r.json(); })
                    .then(function (p) { state.counts[j.ID] = p.length; renderJobs(); });
            }
        });
    }

    var pendingDelete = null;

    function renderJobs() {
        var list = $('jobList');
        if (!state.jobs.length) {
            list.innerHTML = '<div class="jobs-empty">Nenhuma busca ainda. A primeira aparece aqui.</div>';
            return;
        }
        list.innerHTML = state.jobs.map(function (j) {
            var sel = state.selected && state.selected.ID === j.ID;
            var st = STATUS[j.Status] || j.Status;
            var meta = [];
            if (j.Status === 'working' || j.Status === 'pending') {
                meta.push('<span class="run">' + st + '</span>');
                if (sel && state.places.length) meta.push('<b>' + state.places.length + '</b> até agora');
            } else {
                meta.push(st);
                if (j.Status === 'ok' && typeof state.counts[j.ID] === 'number') meta.push('<b>' + state.counts[j.ID] + '</b> empresas');
            }
            meta.push(dateBR(j.Date));
            if (j.Data && j.Data.email) meta.push('com e-mails');
            var cnae = j.Data && j.Data.cnae ? ' · CNAE: ' + j.Data.cnae : '';
            var conf = pendingDelete === j.ID;
            return '<div class="job' + (sel ? ' sel' : '') + '" data-id="' + j.ID + '">' +
                '<div class="job-icon">' + ICON.list + '</div>' +
                '<div class="job-body"><div class="job-name">' + esc(j.Name) + '</div>' +
                '<div class="job-meta">' + meta.join(' · ') + cnae + '</div></div>' +
                '<button type="button" class="job-del' + (conf ? ' confirm' : '') + '" data-del="' + j.ID + '" title="Excluir">' +
                (conf ? 'Excluir?' : ICON.trash) + '</button></div>';
        }).join('');
    }

    $('jobList').addEventListener('click', function (e) {
        var del = e.target.closest('[data-del]');
        if (del) {
            var id = del.getAttribute('data-del');
            if (pendingDelete !== id) {
                pendingDelete = id;
                renderJobs();
                setTimeout(function () { if (pendingDelete === id) { pendingDelete = null; renderJobs(); } }, 3000);
                return;
            }
            pendingDelete = null;
            fetch('/api/v1/jobs/' + id, { method: 'DELETE' }).then(function () {
                if (state.selected && state.selected.ID === id) clearSelection();
                loadJobs();
            });
            return;
        }
        var row = e.target.closest('.job');
        if (!row) return;
        var job = state.jobs.filter(function (j) { return j.ID === row.getAttribute('data-id'); })[0];
        if (job) selectJob(job);
    });

    function clearSelection() {
        state.selected = null;
        state.places = [];
        markers.clearLayers();
        markerByKey = {};
        $('livebar').hidden = true;
        renderBoard();
    }

    function jobCenter(job) {
        var d = job.Data || {};
        var lat = Number(d.lat), lon = Number(d.lon);
        if (!d.lat || !d.lon || isNaN(lat) || isNaN(lon)) return null;
        return { lat: lat, lon: lon, km: (d.radius || 5000) / 1000 };
    }

    function selectJob(job) {
        var changed = !state.selected || state.selected.ID !== job.ID;
        state.selected = job;
        if (changed) {
            state.places = [];
            state.filter = 'all';
            markers.clearLayers();
            markerByKey = {};
            var c = jobCenter(job);
            if (c) drawCircle(c.lat, c.lon, c.km, true);
        }
        renderJobs();
        loadPlaces(changed);
    }

    // ---------- Empresas ----------

    function placeKey(p) { return p.link || (p.title + p.latitude + p.longitude); }

    function popupHtml(p) {
        var wa = whatsapp(p.phone);
        var links = [];
        if (p.phone) {
            links.push(wa
                ? '<a href="https://wa.me/' + wa + '" target="_blank" rel="noopener">' + ICON.phone + esc(p.phone) + ' · WhatsApp</a>'
                : '<a href="tel:' + digits(p.phone) + '">' + ICON.phone + esc(p.phone) + '</a>');
        }
        if (p.website) links.push('<a href="' + esc(p.website) + '" target="_blank" rel="noopener">' + ICON.globe + esc(domain(p.website)) + '</a>');
        if (p.emails) links.push('<a href="mailto:' + esc(p.emails.split(',')[0]) + '">' + ICON.mail + esc(p.emails.split(',')[0]) + '</a>');
        if (p.link) links.push('<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + ICON.pin + 'Abrir no Google Maps</a>');
        return '<div class="pop-title">' + esc(p.title) + '</div>' +
            '<div class="pop-cat">' + esc([p.category, p.borough].filter(Boolean).join(' · ')) + '</div>' +
            (siteKind(p.website) === 'none' ? '<div style="margin-top:8px"><span class="tag dark">Sem site</span></div>' : '') +
            (p.review_rating ? '<div class="pop-rate">★ <b>' + rating(p.review_rating) + '</b> <span style="color:#8a8a8a">(' + int(p.review_count) + ' avaliações)</span></div>' : '') +
            (links.length ? '<div class="pop-links">' + links.join('') + '</div>' : '');
    }

    function addMarkers(list) {
        var c = state.selected ? jobCenter(state.selected) : null;
        list.forEach(function (p) {
            var key = placeKey(p);
            if (markerByKey[key]) return;
            var out = c && distKm(c.lat, c.lon, p.latitude, p.longitude) > c.km;
            var m = L.marker([p.latitude, p.longitude], {
                icon: L.divIcon({ className: '', html: '<div class="pin' + (out ? ' out' : '') + '"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
            }).bindPopup(popupHtml(p), { closeButton: false, offset: [0, -4] });
            markers.addLayer(m);
            markerByKey[key] = m;
        });
    }

    function loadPlaces(fit) {
        var job = state.selected;
        if (!job) return Promise.resolve();
        return fetch('/api/v1/jobs/' + job.ID + '/places')
            .then(function (r) { return r.json(); })
            .then(function (places) {
                if (!state.selected || state.selected.ID !== job.ID) return;
                // Durante a busca o CSV está sendo escrito: nunca regride a lista.
                if (places.length < state.places.length) return;
                state.places = places;
                if (job.Status === 'ok') state.counts[job.ID] = places.length;
                addMarkers(places);
                if (fit && places.length && !jobCenter(job)) {
                    map.flyToBounds(L.latLngBounds(places.map(function (p) { return [p.latitude, p.longitude]; })), {
                        paddingTopLeft: panelOffset(), paddingBottomRight: [40, 40], duration: 0.8
                    });
                }
                renderLive();
                renderJobs();
                renderBoard();
            });
    }

    function renderLive() {
        var job = state.selected;
        if (!job) { $('livebar').hidden = true; return; }
        var running = job.Status === 'working' || job.Status === 'pending';
        $('livebar').hidden = state.view !== 'map';
        $('liveDot').className = 'live-dot' + (running ? ' run' : '');
        var n = state.places.length;
        $('liveText').innerHTML = running
            ? (job.Status === 'pending' ? 'Na fila, já começa' : 'Buscando: <b>' + n + '</b> empresas até agora')
            : '<b>' + n + '</b> empresas em ' + esc(job.Name);
        $('liveDownload').hidden = running || !n;
    }

    // ---------- Painel ----------

    function sortVal(p, key) {
        if (key === 'title') return (p.title || '').toLowerCase();
        if (key === 'borough') return (p.borough || '').toLowerCase();
        if (key === 'rating') return (Number(p.review_rating || 0) * 100000) + Number(p.review_count || 0);
        if (key === 'phone') return (whatsapp(p.phone) ? '2_' : (p.phone ? '1_' : '0_')) + (p.phone || '');
        if (key === 'site') {
            var k = siteKind(p.website);
            var rank = k === 'none' ? '0_' : (k === 'social' ? '1_' : '2_');
            return rank + domain(p.website || '').toLowerCase();
        }
        return '';
    }

    function filtered() {
        var txt = $('filterText').value.trim().toLowerCase();
        var list = state.places.filter(function (p) {
            var k = siteKind(p.website);
            if (state.filter === 'nosite' && k !== 'none') return false;
            if (state.filter === 'social' && k !== 'social') return false;
            if (state.filter === 'whats' && !whatsapp(p.phone)) return false;
            if (state.filter === 'email' && !p.emails) return false;
            if (txt && (p.title + ' ' + p.borough + ' ' + p.category).toLowerCase().indexOf(txt) < 0) return false;
            return true;
        });
        if (state.sortKey) {
            var key = state.sortKey;
            var dir = state.sortDir === 'desc' ? -1 : 1;
            list = list.slice().sort(function (a, b) {
                var va = sortVal(a, key);
                var vb = sortVal(b, key);
                if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
                return String(va).localeCompare(String(vb), 'pt-BR') * dir;
            });
        }
        return list;
    }

    function renderBoard() {
        var job = state.selected;
        $('boardEmpty').hidden = !!job;
        $('boardMain').hidden = !job;
        if (!job) return;

        var all = state.places;
        var running = job.Status === 'working' || job.Status === 'pending';
        $('boardTitle').textContent = job.Name;
        $('boardMeta').textContent = (running ? 'Buscando agora · ' : '') + dateBR(job.Date) + ' · ' + (job.Data.keywords || []).join(', ');

        var rated = all.filter(function (p) { return p.review_rating; });
        var avg = rated.length ? rated.reduce(function (s, p) { return s + p.review_rating; }, 0) / rated.length : 0;
        var stats = [
            [int(all.length), 'Empresas'],
            [int(all.filter(function (p) { return whatsapp(p.phone); }).length), 'Com WhatsApp'],
            [int(all.filter(function (p) { return siteKind(p.website) === 'none'; }).length), 'Sem site'],
            [int(all.filter(function (p) { return siteKind(p.website) === 'social'; }).length), 'Só rede social'],
            [avg ? rating(avg) : '-', 'Nota média']
        ];
        $('stats').innerHTML = stats.map(function (s) {
            return '<div class="stat"><div class="stat-n">' + s[0] + '</div><div class="stat-l">' + s[1] + '</div></div>';
        }).join('');

        Array.prototype.forEach.call($('filters').children, function (b) {
            b.classList.toggle('on', b.getAttribute('data-f') === state.filter);
        });

        if ($('boardHead')) {
            Array.prototype.forEach.call($('boardHead').querySelectorAll('th[data-sort]'), function (th) {
                var k = th.getAttribute('data-sort');
                var active = state.sortKey === k;
                th.classList.toggle('active', active);
                var ind = th.querySelector('.sort-ind');
                if (ind) ind.textContent = active ? (state.sortDir === 'asc' ? '▲' : '▼') : '⇅';
            });
        }

        var rows = filtered();
        var picked = selectedRows(rows);
        var activeRows = picked.length ? picked : rows;
        $('download').textContent = 'Baixar planilha (' + activeRows.length + ')';
        if ($('sendToCrm')) {
            $('sendToCrm').textContent = picked.length ? 'Enviar para Agentes (' + picked.length + ')' : 'Enviar para Agentes';
        }
        if ($('selectAllRows')) {
            $('selectAllRows').checked = rows.length > 0 && picked.length === rows.length;
            $('selectAllRows').indeterminate = picked.length > 0 && picked.length < rows.length;
        }
        if (!rows.length) {
            $('rows').innerHTML = '<tr><td colspan="7" class="t-empty">' +
                (all.length ? 'Nenhuma empresa nesse filtro.' : (running ? 'As empresas aparecem aqui conforme a busca anda.' : 'Essa busca não trouxe empresas.')) +
                '</td></tr>';
            return;
        }
        $('rows').innerHTML = rows.map(function (p, i) {
            var pk = placeKey(p);
            var checked = state.selectedKeys[pk] ? ' checked' : '';
            var k = siteKind(p.website);
            var ig = instagramHandle(p.website);
            var site = k === 'none' ? '<span class="tag dark">Sem site</span>'
                : ig ? '<a class="t-site" href="' + esc(p.website) + '" target="_blank" rel="noopener">' + esc(ig) + '</a><span class="tag">Instagram</span>'
                : '<a class="t-site" href="' + esc(p.website) + '" target="_blank" rel="noopener">' + esc(domain(p.website)) + '</a>' +
                  (k === 'social' ? '<span class="tag">Rede social</span>' : '');
            var wa = whatsapp(p.phone);
            var phone = !p.phone ? '<span class="t-cat">sem telefone</span>'
                : wa ? '<a class="mono" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">' + esc(p.phone) + '</a><span class="wa">WHATS</span>'
                : '<span class="mono">' + esc(p.phone) + '</span>';
            return '<tr data-i="' + i + '">' +
                '<td class="chk-col"><input type="checkbox" class="row-chk" data-pk="' + esc(pk) + '"' + checked + '></td>' +
                '<td><div class="t-name">' + esc(p.title) + '</div><div class="t-cat">' + esc(p.category) + '</div></td>' +
                '<td>' + esc(p.borough) + '</td>' +
                '<td class="num">' + (p.review_rating ? '★ ' + rating(p.review_rating) + ' <span class="t-cat">(' + int(p.review_count) + ')</span>' : '') + '</td>' +
                '<td>' + phone + '</td>' +
                '<td>' + site + '</td>' +
                '<td>' + (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener" title="Abrir no Google Maps">' + ICON.arrow + '</a>' : '') + '</td>' +
                '</tr>';
        }).join('');
        renderBoard.rows = rows;

         // Display CNAE in job board meta
        var job = state.selected;
        var metaText = (running ? 'Buscando agora · ' : '') + dateBR(job.Date) + ' · ' + (job.Data.keywords || []).join(', ');
        if (job && job.Data && job.Data.cnae) {
            metaText += ' · CNAE: ' + job.Data.cnae;
        }
        $('boardMeta').textContent = metaText;
    }

    segmented('filters', 'data-f', function (v) { state.filter = v; renderBoard(); });
    $('filterText').addEventListener('input', renderBoard);
    if ($('boardHead')) {
        $('boardHead').addEventListener('click', function (e) {
            var th = e.target.closest('th[data-sort]');
            if (!th) return;
            var key = th.getAttribute('data-sort');
            if (state.sortKey === key) {
                state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                state.sortKey = key;
                state.sortDir = (key === 'rating' || key === 'phone') ? 'desc' : 'asc';
            }
            renderBoard();
        });
    }

    function selectedRows(rows) {
        return (rows || []).filter(function (p) { return !!state.selectedKeys[placeKey(p)]; });
    }

    function targetRows() {
        var rows = filtered();
        var picked = selectedRows(rows);
        return picked.length ? picked : rows;
    }

    // Clicar numa linha leva pro pin no mapa.
    $('rows').addEventListener('change', function (e) {
        var chk = e.target.closest('input.row-chk[data-pk]');
        if (!chk) return;
        var pk = chk.getAttribute('data-pk');
        if (chk.checked) state.selectedKeys[pk] = true;
        else delete state.selectedKeys[pk];
        renderBoard();
    });

    if ($('selectAllRows')) {
        $('selectAllRows').addEventListener('change', function () {
            var rows = filtered();
            var on = this.checked;
            rows.forEach(function (p) {
                var pk = placeKey(p);
                if (on) state.selectedKeys[pk] = true;
                else delete state.selectedKeys[pk];
            });
            renderBoard();
        });
    }

    $('rows').addEventListener('click', function (e) {
        if (e.target.closest('a, input, label')) return;
        var tr = e.target.closest('tr[data-i]');
        if (!tr) return;
        var p = renderBoard.rows[Number(tr.getAttribute('data-i'))];
        var m = markerByKey[placeKey(p)];
        setView('map');
        if (m) {
            map.flyTo(m.getLatLng(), 16, { duration: 0.6 });
            setTimeout(function () { m.openPopup(); }, 650);
        }
    });

    function setDrawer(open) {
        document.body.classList.toggle('drawer-open', !!open);
        if ($('drawerBackdrop')) $('drawerBackdrop').hidden = !open;
    }
    if ($('mobileMenuBtn')) $('mobileMenuBtn').addEventListener('click', function () { setDrawer(true); });
    if ($('drawerClose')) $('drawerClose').addEventListener('click', function () { setDrawer(false); });
    if ($('drawerBackdrop')) $('drawerBackdrop').addEventListener('click', function () { setDrawer(false); });
    if ($('jobs')) $('jobs').addEventListener('click', function () { setDrawer(false); });

    function setView(v) {
        state.view = v;
        setDrawer(false);
        document.body.classList.toggle('view-wide', v !== 'map');
        Array.prototype.forEach.call($('viewSeg').children, function (b) {
            b.classList.toggle('on', b.getAttribute('data-view') === v);
        });
        if ($('mobileNav')) {
            Array.prototype.forEach.call($('mobileNav').children, function (b) {
                b.classList.toggle('on', b.getAttribute('data-view') === v);
            });
        }
        $('board').hidden = v !== 'board';
        if ($('crmView')) $('crmView').hidden = v !== 'crm';
        renderLive();
        if (v === 'board') renderBoard();
        if (v === 'crm') loadCrm();
    }
    segmented('viewSeg', 'data-view', setView);
    if ($('mobileNav')) segmented('mobileNav', 'data-view', setView);

    // ---------- Exportação ----------

    function csvCell(v) {
        v = String(v == null ? '' : v);
        return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }

    function slug(s) {
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    function instagramHandle(url) {
        var m = String(url || '').match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
        if (!m) return '';
        var h = m[1].replace(/\/$/, '');
        if (!h || /^(p|reel|reels|stories|explore|accounts|tv)$/i.test(h)) return '';
        return '@' + h;
    }

    function buildCsvContent(rows) {
        var cnae = (state.selected && state.selected.Data && state.selected.Data.cnae) || '';
        var head = ['Empresa', 'Categoria', 'Telefone', 'WhatsApp', 'Instagram', 'Site', 'E-mail', 'Nota', 'Avaliações', 'Bairro', 'Cidade', 'Endereço', 'Google Maps', 'CNAE'];
        var lines = [head.join(';')].concat(rows.map(function (p) {
            var wa = whatsapp(p.phone);
            return [p.title, p.category, p.phone, wa ? 'https://wa.me/' + wa : '', instagramHandle(p.website), p.website, p.emails,
                p.review_rating ? rating(p.review_rating) : '', p.review_count || '', p.borough, p.city, p.address, p.link, p.cnae || cnae]
                .map(csvCell).join(';');
        }));
        return '\uFEFF' + lines.join('\r\n');
    }

    // Planilha no padrão do Excel brasileiro: ponto e vírgula, vírgula decimal e BOM.
    function download(rows) {
        if (!state.selected || !rows.length) return;
        var blob = new Blob([buildCsvContent(rows)], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'wins-hub-' + slug(state.selected.Name) + '-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        toast(rows.length + ' empresas exportadas');
    }

    $('download').addEventListener('click', function () { download(targetRows()); });
    $('liveDownload').addEventListener('click', function () { download(state.places); });

    if ($('sendToCrm')) {
        $('sendToCrm').addEventListener('click', function () {
            var rows = targetRows();
            if (!state.selected || !rows.length) return;
            var btn = this;
            btn.disabled = true;
            btn.textContent = 'Enviando...';
            fetch('/api/crm/import-csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: 'wins-hub-' + slug(state.selected.Name) + '.csv',
                    csvContent: buildCsvContent(rows),
                    limit: Math.max(25, rows.length)
                })
            })
                .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Erro'); return j; }); })
                .then(function () {
                    toast(rows.length + ' leads enviados para a fila dos agentes');
                    setView('crm');
                })
                .catch(function (e) { toast('Falha ao enviar para o CRM: ' + e.message); })
                .then(function () {
                    btn.disabled = false;
                    renderBoard();
                });
        });
    }

    $('copyPhones').addEventListener('click', function () {
        var phones = targetRows().map(function (p) { return p.phone; }).filter(Boolean);
        if (!phones.length) return;
        navigator.clipboard.writeText(phones.join('\n')).then(function () {
            toast(phones.length + ' telefones copiados');
        });
    });

    // ---------- CRM Nativo ----------

    var crmState = { data: null, filter: 'all', selectedKeys: {} };

    function selectedCrmKeys() {
        return Object.keys(crmState.selectedKeys).filter(function (k) { return !!crmState.selectedKeys[k]; });
    }

    function loadCrm() {
        if (!$('crmView')) return Promise.resolve();
        return fetch('/api/crm/overview')
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(function (d) { crmState.data = d; renderCrm(); })
            .catch(function () {
                if ($('crmMeta')) $('crmMeta').textContent = 'Agente offline ou aguardando conexão.';
            });
    }

    function renderCrm() {
        var d = crmState.data;
        if (!d) return;
        var c = d.counts;
        var enviados = c.enviado + c.visualizado + c.respondeu + c.proposto + c.fechado;
        var resp = c.respondeu + c.proposto + c.fechado;
        var taxa = enviados ? Math.round((resp / enviados) * 100) : 0;

        $('crmMeta').textContent = (d.worker.running ? 'Disparando agora · ' : 'Pronto · ') +
            d.daily.count + '/' + d.daily.max + ' envios hoje · ' + c.total + ' leads na base';
        $('crmStart').disabled = d.worker.running;
        $('crmDryRun').disabled = d.worker.running;
        $('crmStop').hidden = !d.worker.running;

        $('crmStats').innerHTML = [
            [int(c.na_fila), 'Na fila'],
            [d.daily.count + ' / ' + d.daily.max, 'Disparos hoje'],
            [resp + ' (' + taxa + '%)', 'Responderam'],
            [int(c.proposto), 'Handoffs (Ok!)'],
            [int(c.fechado), 'Fechados']
        ].map(function (s) {
            return '<div class="stat"><div class="stat-n">' + esc(s[0]) + '</div><div class="stat-l">' + esc(s[1]) + '</div></div>';
        }).join('');

        if ($('crmAgents') && d.agents) {
            var a = d.agents;
            var evoOn = a.evolution === 'open';
            var ant = a.anthropic || {};
            var antToday = ant.today || {};
            var antTok = (antToday.inputTokens || 0) + (antToday.outputTokens || 0);
            var antSub = ant.lastError
                ? 'Erro API'
                : (antToday.calls || 0) + ' reqs · ' + int(antTok) + ' tok · US$ ' + Number(antToday.costUsd || 0).toFixed(3);
            var cards = [
                { name: 'Evolution WhatsApp', sub: evoOn ? 'Conectado' : String(a.evolution || 'offline'), cls: evoOn ? 'on' : 'warn' },
                { name: 'SDR Auto-Resposta', sub: a.webhook === 'online' ? 'Ouvindo :3005' : 'Offline', cls: a.webhook === 'online' ? 'on' : '' },
                { name: 'Anthropic Claude', sub: antSub, cls: ant.lastError ? 'warn' : ((antToday.calls || 0) > 0 ? 'on' : ''), title: 'Total acumulado: ' + ((ant.total && ant.total.calls) || 0) + ' reqs · US$ ' + Number((ant.total && ant.total.costUsd) || 0).toFixed(4) },
                { name: 'Disparador', sub: a.workerRunning ? 'Disparando agora' : ('Ocioso · ' + d.daily.count + '/' + d.daily.max), cls: a.workerRunning ? 'on' : '' },
                { name: 'Auditor & Prévias', sub: int(a.auditedCount || 0) + ' sites auditados', cls: (a.auditedCount || 0) > 0 ? 'on' : '' }
            ];
            $('crmAgents').innerHTML = cards.map(function (c) {
                return '<div class="crm-agent-pill" title="' + esc(c.title || '') + '"><span class="crm-agent-left"><i class="crm-dot ' + c.cls + '"></i>' + esc(c.name) + '</span><span class="crm-agent-sub">' + esc(c.sub) + '</span></div>';
            }).join('');
        }

        var logs = $('crmLogs');
        logs.textContent = d.worker.logs.length ? d.worker.logs.join('\n') : 'Nenhuma execução nesta sessão.';
        logs.scrollTop = logs.scrollHeight;

        $('crmNiches').innerHTML = (d.byNiche || []).map(function (n) {
            return '<tr><td>' + esc(n.nicho) + '</td><td class="num">' + n.na_fila + '</td><td class="num">' + n.enviados + '</td><td class="num">' + n.respostas + '</td><td class="num">' + n.fechados + '</td></tr>';
        }).join('');

        var ST_LABELS = { all: 'Todos', na_fila: 'Na fila', enviado: 'Enviado', respondeu: 'Respondeu', proposto: 'Proposto', fechado: 'Fechado', descartado: 'Descartado' };
        Array.prototype.forEach.call(document.querySelectorAll('#crmFilters button[data-st]'), function (b) {
            var st = b.getAttribute('data-st');
            var cnt = st === 'all' ? (c.total || 0) : (c[st] || 0);
            b.textContent = (ST_LABELS[st] || st) + ' (' + cnt + ')';
        });

        var q = ($('crmSearch').value || '').trim().toLowerCase();
        var list = (d.leads || []).filter(function (l) {
            if (crmState.filter !== 'all' && l.state !== crmState.filter) return false;
            if (q && (l.nome + ' ' + l.nicho + ' ' + l.cidade).toLowerCase().indexOf(q) < 0) return false;
            return true;
        });

        var pickedCount = selectedCrmKeys().length;
        $('crmStart').textContent = pickedCount ? 'Start Disparo (' + pickedCount + ')' : 'Start Disparo';
        $('crmDryRun').textContent = pickedCount ? 'Simular (' + pickedCount + ')' : 'Simular';
        if ($('crmSelectAll')) {
            var visChecked = list.filter(function (l) { return !!crmState.selectedKeys[l.key]; }).length;
            $('crmSelectAll').checked = list.length > 0 && visChecked === list.length;
            $('crmSelectAll').indeterminate = visChecked > 0 && visChecked < list.length;
        }

        if (!list.length) {
            $('crmRows').innerHTML = '<tr><td colspan="7" class="t-empty">Nenhum lead nessa etapa.</td></tr>';
            return;
        }

        var ST_LIST = ['na_fila', 'enviado', 'respondeu', 'proposto', 'fechado', 'descartado'];
        $('crmRows').innerHTML = list.map(function (l) {
            var checked = crmState.selectedKeys[l.key] ? ' checked' : '';
            var stLabel = ST_LABELS[l.state] || l.state;
            var metaBadges = [
                '<span class="crm-meta-chip">★ ' + l.score + ' · ' + int(l.avaliacoes) + ' aval.</span>',
                '<span class="crm-meta-chip">' + (l.temSite ? 'Com site' : 'Sem site') + '</span>'
            ];
            if (l.instagram) metaBadges.push('<a class="crm-meta-chip link" href="' + esc(l.instagramUrl) + '" target="_blank" rel="noopener">' + esc(l.instagram) + '</a>');
            if (l.siteAudit) {
                metaBadges.push('<span class="crm-meta-chip' + (l.siteAudit.score < 70 ? ' warn' : ' ok') + '">Site ' + l.siteAudit.score + '/100</span>');
                if (l.siteAudit.stack && l.siteAudit.stack.length) metaBadges.push('<span class="crm-meta-chip">' + esc(l.siteAudit.stack[0]) + '</span>');
            }
            if (l.lighthouse && l.lighthouse.perf != null) {
                metaBadges.push('<span class="crm-meta-chip' + (l.lighthouse.perf < 70 ? ' warn' : ' ok') + '">LH ' + l.lighthouse.perf + '/100</span>');
            }
            var chatAttrs = 'data-chat="' + esc(l.telefone) + '" data-key="' + esc(l.key) + '" data-nome="' + esc(l.nome) + '" data-nicho="' + esc(l.nicho) + '"';
            return '<tr>' +
                '<td class="chk-col"><input type="checkbox" class="crm-chk" data-key="' + esc(l.key) + '"' + checked + '></td>' +
                '<td><div class="t-name"><button type="button" class="crm-lead-btn" ' + chatAttrs + '>' + esc(l.nome) + '</button></div><div class="crm-sub-meta">' + metaBadges.join('') + '</div></td>' +
                '<td><div class="crm-niche-main">' + esc(l.nicho) + '</div><div class="t-cat">' + esc(l.cidade) + '</div></td>' +
                '<td><span class="st-pill st-' + esc(l.state) + '">' + esc(stLabel) + '</span></td>' +
                '<td><button type="button" class="crm-chat-btn" ' + chatAttrs + '>💬 ' + l.msgCount + '</button></td>' +
                '<td><a class="crm-prev-link" href="' + esc(l.previewUrl) + '" target="_blank" rel="noopener">Prévia ↗</a></td>' +
                '<td><select class="crm-select" data-key="' + esc(l.key) + '">' +
                ST_LIST.map(function (s) { return '<option value="' + s + '"' + (l.state === s ? ' selected' : '') + '>' + (ST_LABELS[s] || s) + '</option>'; }).join('') +
                '</select></td>' +
                '</tr>';
        }).join('');
    }

    if ($('crmFilters')) {
        setInterval(function () {
            if (state.view === 'crm') loadCrm();
        }, 5000);
        segmented('crmFilters', 'data-st', function (v) { crmState.filter = v; renderCrm(); });
        $('crmSearch').addEventListener('input', renderCrm);

        $('crmRows').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-chat]');
            if (!btn) return;
            var phone = btn.getAttribute('data-chat');
            crmState.activeKey = btn.getAttribute('data-key');
            $('crmChatTitle').textContent = btn.getAttribute('data-nome');
            $('crmChatSub').textContent = btn.getAttribute('data-nicho') + ' · ' + phone;
            $('crmChatWa').href = 'https://wa.me/' + phone;
            if ($('crmPropostaBox')) { $('crmPropostaBox').hidden = true; $('crmPropostaBox').textContent = ''; }
            fetch('/api/crm/conversation?phone=' + encodeURIComponent(phone))
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    $('crmChatBody').innerHTML = (res.messages || []).length
                        ? res.messages.map(function (m) {
                            return '<div class="crm-msg ' + (m.role === 'assistant' ? 'assistant' : 'user') + '">' +
                                esc(m.content) + '<div class="crm-msg-at">' + dateBR(m.at) + '</div></div>';
                        }).join('')
                        : '<div class="t-cat">Nenhuma mensagem trocada ainda.</div>';
                    $('crmDrawer').hidden = false;
                });
        });

        $('crmRows').addEventListener('change', function (e) {
            var chk = e.target.closest('input.crm-chk[data-key]');
            if (chk) {
                var k = chk.getAttribute('data-key');
                if (chk.checked) crmState.selectedKeys[k] = true;
                else delete crmState.selectedKeys[k];
                renderCrm();
                return;
            }
            var sel = e.target.closest('select[data-key]');
            if (!sel) return;
            fetch('/api/crm/lead/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: sel.getAttribute('data-key'), state: sel.value })
            }).then(function () { toast('Status atualizado'); loadCrm(); });
        });

        if ($('crmSelectAll')) {
            $('crmSelectAll').addEventListener('change', function () {
                var on = this.checked;
                var d = crmState.data;
                if (!d) return;
                var ST_LABELS = { all: 'Todos', na_fila: 'Na fila', enviado: 'Enviado', respondeu: 'Respondeu', proposto: 'Proposto', fechado: 'Fechado', descartado: 'Descartado' };
        Array.prototype.forEach.call(document.querySelectorAll('#crmFilters button[data-st]'), function (b) {
            var st = b.getAttribute('data-st');
            var cnt = st === 'all' ? (c.total || 0) : (c[st] || 0);
            b.textContent = (ST_LABELS[st] || st) + ' (' + cnt + ')';
        });

        var q = ($('crmSearch').value || '').trim().toLowerCase();
                (d.leads || []).filter(function (l) {
                    if (crmState.filter !== 'all' && l.state !== crmState.filter) return false;
                    if (q && (l.nome + ' ' + l.nicho + ' ' + l.cidade).toLowerCase().indexOf(q) < 0) return false;
                    return true;
                }).forEach(function (l) {
                    if (on) crmState.selectedKeys[l.key] = true;
                    else delete crmState.selectedKeys[l.key];
                });
                renderCrm();
            });
        }

        $('crmChatClose').addEventListener('click', function () { $('crmDrawer').hidden = true; });

        if ($('crmAuditAll')) {
            $('crmAuditAll').addEventListener('click', function () {
                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Auditando...';
                fetch('/api/crm/audit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ all: true })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (!res.ok) { toast('Erro: ' + (res.error || 'falha')); return; }
                        toast(res.auditedCount + ' sites auditados');
                        loadCrm();
                    })
                    .catch(function () { toast('Erro ao auditar sites'); })
                    .finally(function () { btn.disabled = false; btn.textContent = 'Auditar Sites'; });
            });
        }

        if ($('crmAuditOne')) {
            $('crmAuditOne').addEventListener('click', function () {
                if (!crmState.activeKey) return;
                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Auditando...';
                fetch('/api/crm/audit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: crmState.activeKey })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (!res.ok) { toast('Erro: ' + (res.error || 'falha')); return; }
                        var a = res.audit;
                        var txt = 'Site: ' + a.url +
                            '\nScore Geral: ' + a.score + '/100 (Segurança: ' + a.securityScore + '/100 · Qualidade: ' + a.qualityScore + '/100)' +
                            (a.stack && a.stack.length ? '\nStack detectada: ' + a.stack.join(', ') : '') +
                            '\nPixels: ' + (a.pixels && a.pixels.length ? a.pixels.join(', ') : 'Nenhum detectado') +
                            (a.empresaInfo ? '\nCNPJ: ' + a.empresaInfo.cnpj + (a.empresaInfo.porte ? ' (' + a.empresaInfo.porte + ')' : '') + (a.empresaInfo.socios && a.empresaInfo.socios.length ? ' · Sócios: ' + a.empresaInfo.socios.join(', ') : '') : '') +
                            (a.instagram ? '\nInstagram encontrado: ' + a.instagram : '') +
                            (a.problems && a.problems.length ? '\n\nPontos encontrados:\n- ' + a.problems.join('\n- ') : '') +
                            '\n\nPitch sugerido (copiado):\n' + a.pitch;
                        var box = $('crmPropostaBox');
                        box.textContent = txt;
                        box.hidden = false;
                        if (navigator.clipboard) navigator.clipboard.writeText(a.pitch || '').catch(function () {});
                        toast('Site auditado: ' + a.score + '/100');
                        loadCrm();
                    })
                    .catch(function () { toast('Erro ao auditar site'); })
                    .finally(function () { btn.disabled = false; btn.textContent = 'Auditar Site'; });
            });
        }

        if ($('crmLighthouseOne')) {
            $('crmLighthouseOne').addEventListener('click', function () {
                if (!crmState.activeKey) return;
                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Rodando Lighthouse (~15s)...';
                fetch('/api/crm/lighthouse', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: crmState.activeKey })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (!res.ok) { toast('Erro: ' + (res.error || 'falha')); return; }
                        var lh = res.lighthouse;
                        var txt = 'Google Lighthouse (Oficial): ' + lh.url +
                            '\nPerformance Mobile: ' + (lh.perf ?? '-') + '/100' +
                            '\nSEO: ' + (lh.seo ?? '-') + '/100' +
                            '\nAcessibilidade: ' + (lh.acc ?? '-') + '/100' +
                            '\nBoas Práticas: ' + (lh.bp ?? '-') + '/100' +
                            (lh.lcp ? '\nLCP (Carregamento Principal): ' + lh.lcp : '') +
                            (lh.fcp ? '\nFCP (Primeiro Conteúdo): ' + lh.fcp : '') +
                            '\n\nPitch sugerido (copiado):\n' + lh.pitch;
                        var box = $('crmPropostaBox');
                        box.textContent = txt;
                        box.hidden = false;
                        if (navigator.clipboard) navigator.clipboard.writeText(lh.pitch || '').catch(function () {});
                        toast('Lighthouse: Perf ' + (lh.perf ?? '-') + '/100');
                        loadCrm();
                    })
                    .catch(function () { toast('Erro ao rodar Lighthouse'); })
                    .finally(function () { btn.disabled = false; btn.textContent = 'Lighthouse (Google)'; });
            });
        }

        if ($('crmGenProposta')) {
            $('crmGenProposta').addEventListener('click', function () {
                if (!crmState.activeKey) return;
                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Gerando...';
                fetch('/api/crm/proposta', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: crmState.activeKey })
                })
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (!res.ok) { toast('Erro: ' + (res.error || 'falha')); return; }
                        var box = $('crmPropostaBox');
                        box.textContent = res.proposta || '';
                        box.hidden = false;
                        if (navigator.clipboard) navigator.clipboard.writeText(res.proposta || '').catch(function () {});
                        toast('Proposta gerada e copiada!');
                    })
                    .catch(function () { toast('Erro ao gerar proposta'); })
                    .finally(function () { btn.disabled = false; btn.textContent = 'Gerar Proposta (Closer)'; });
            });
        }

        $('crmStart').addEventListener('click', function () {
            var keys = selectedCrmKeys();
            var msg = keys.length
                ? 'Iniciar disparo REAL no WhatsApp para os ' + keys.length + ' lead(s) selecionado(s)?'
                : 'Nenhum lead marcado — iniciar disparo REAL no WhatsApp para toda a fila (até o limite diário)?';
            if (!confirm(msg)) return;
            fetch('/api/crm/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: false, forceHorario: true, keys: keys })
            }).then(function () { toast('Disparo iniciado'); loadCrm(); });
        });

        $('crmDryRun').addEventListener('click', function () {
            var keys = selectedCrmKeys();
            fetch('/api/crm/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dryRun: true, forceHorario: true, keys: keys })
            }).then(function () { toast('Simulação iniciada'); loadCrm(); });
        });

        $('crmStop').addEventListener('click', function () {
            fetch('/api/crm/stop', { method: 'POST' }).then(function () { toast('Parada solicitada'); loadCrm(); });
        });

        $('crmCsvInput').addEventListener('change', function () {
            var file = this.files[0];
            if (!file) return;
            var input = this;
            file.text().then(function (csvContent) {
                return fetch('/api/crm/import-csv', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.name, csvContent: csvContent, limit: 25 })
                });
            }).then(function (r) { return r.json(); })
                .then(function (res) {
                    toast(res.ok ? 'CSV importado para a fila!' : ('Erro: ' + res.error));
                    input.value = '';
                    loadCrm();
                });
        });
    }

    // ---------- Ciclo ----------

    updateQtyDesc();
    updateRange();
    loadJobs();

    setInterval(function () {
        loadJobs().then(function () {
            var j = state.selected;
            if (j && (j.Status === 'working' || j.Status === 'pending' || state.counts[j.ID] !== state.places.length)) loadPlaces(false);
        });
        if (state.view === 'crm') loadCrm();
    }, 3000);
})();
