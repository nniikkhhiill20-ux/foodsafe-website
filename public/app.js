'use strict';
(function () {
  var FLAGSET = ['Clean kitchen', 'Fresh food', 'Great packaging', 'Reused oil', 'Stale / spoiled', 'Pest seen', 'Overpriced'];
  var COLORS = { A: '#1E9E5A', B: '#E8912B', C: '#E0432F', D: '#A32118', none: '#8595A0' };
  function gradeColor(g) { return COLORS[g] || COLORS.none; }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function starStr(avg) { var f = Math.round(avg), s = ''; for (var i = 1; i <= 5; i++) s += i <= f ? '★' : '☆'; return s; }
  function relTime(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 86400000;
    if (d < 1) return 'today'; if (d < 2) return 'yesterday';
    if (d < 30) return Math.round(d) + ' days ago'; if (d < 365) return Math.round(d / 30) + ' mo ago';
    return Math.round(d / 365) + ' yr ago';
  }
  function nfmt(n) { return Number(n).toLocaleString('en-IN'); }
  function keyOf(p) { return p.dbId ? 'd' + p.dbId : 'o' + p.osmId; }

  var toastEl = document.getElementById('toast'), toastT;
  function say(m) { toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2600); }

  async function api(url, opts) {
    var r = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    var data = null; try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
    return data;
  }

  // ---------------- map ----------------
  var DEFAULT = [19.0596, 72.8295];
  var map = L.map('map', { scrollWheelZoom: false }).setView(DEFAULT, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

  var markerLayer = L.layerGroup().addTo(map);
  var searchLayer = L.layerGroup().addTo(map);
  var markersByKey = {}, placeByKey = {};
  var selectedKey = null, addMode = false, loadTimer = null, loadSeq = 0;

  function styleFor(p) {
    var col = p.grade ? gradeColor(p.grade) : COLORS.none;
    var sel = keyOf(p) === selectedKey;
    return { radius: sel ? 11 : (p.reviewCount > 0 ? 8 : 6.5), color: '#fff', weight: 2, fillColor: col, fillOpacity: p.reviewCount > 0 ? 0.95 : 0.7 };
  }
  function renderMarkers(places) {
    markerLayer.clearLayers(); markersByKey = {}; placeByKey = {};
    places.forEach(function (p) {
      var k = keyOf(p); placeByKey[k] = p;
      var m = L.circleMarker([p.lat, p.lng], styleFor(p));
      m.bindTooltip(p.name + (p.grade ? ' · ' + p.grade : (p.reviewCount ? '' : ' · unrated')), { direction: 'top' });
      m.on('click', function () { selectPlace(p); });
      m.addTo(markerLayer); markersByKey[k] = m;
    });
  }
  function refreshStyles() { Object.keys(placeByKey).forEach(function (k) { if (markersByKey[k]) markersByKey[k].setStyle(styleFor(placeByKey[k])); }); }

  async function loadForView(fit) {
    var c = map.getCenter();
    var radius = Math.min(6000, Math.max(1200, Math.round(c.distanceTo(map.getBounds().getNorthEast()))));
    var seq = ++loadSeq;
    document.getElementById('locLabel').textContent = 'Loading nearby places…';
    try {
      var res = await api('/api/places/near?lat=' + c.lat + '&lng=' + c.lng + '&radius=' + radius);
      if (seq !== loadSeq) return; // a newer load superseded this one
      renderMarkers(res.places);
      document.getElementById('locLabel').textContent = res.places.length + ' places nearby';
      if (fit && res.places.length) {
        var b = L.latLngBounds(res.places.slice(0, 25).map(function (o) { return [o.lat, o.lng]; }));
        b.extend([c.lat, c.lng]); map.fitBounds(b.pad(0.2), { maxZoom: 16 });
      }
      if (!res.places.length) say('No places found here — try “Add a kitchen”.');
      else if (res.osmError) say('Showing saved places (OpenStreetMap was slow to respond).');
    } catch (e) { document.getElementById('locLabel').textContent = 'Could not load'; say('Could not load places: ' + e.message); }
  }
  map.on('moveend', function () { if (addMode) return; clearTimeout(loadTimer); loadTimer = setTimeout(function () { loadForView(false); }, 400); });

  // ---------------- review card ----------------
  var revCard = document.getElementById('revCard');
  var pickStars = 0, pickFlags = {};

  function placeToDetail(p) {
    return { id: p.dbId || null, osmId: p.osmId || null, name: p.name, cuisine: p.cuisine, city: p.city, lat: p.lat, lng: p.lng, source: p.source, reviewCount: 0, avgStars: 0, score: 0, grade: null, flags: [], reviews: [] };
  }
  async function selectPlace(p) {
    selectedKey = keyOf(p); refreshStyles();
    if (p.dbId) {
      revCard.innerHTML = '<div class="rev-empty"><div class="big">Loading…</div></div>';
      try { var d = await api('/api/restaurants/' + p.dbId); d.osmId = p.osmId || d.osm_id || null; d.lat = p.lat; d.lng = p.lng; d.source = p.source; renderRev(d); }
      catch (e) { revCard.innerHTML = '<div class="rev-empty"><div class="big">Error</div><div>' + esc(e.message) + '</div></div>'; }
    } else {
      renderRev(placeToDetail(p));
    }
  }

  function renderRev(o) {
    pickStars = 0; pickFlags = {};
    var hasR = o.reviewCount > 0;
    var col = o.grade ? gradeColor(o.grade) : COLORS.none;
    var srcTag = o.source === 'osm' ? 'OpenStreetMap' : (o.source === 'community' ? 'community-added' : '');
    var flagsHtml = (o.flags || []).map(function (f) { return '<span class="flag">' + esc(f.flag) + ' <b>' + f.c + '</b></span>'; }).join('');
    var cmts = (o.reviews || []).map(function (r) {
      return '<div class="cmt"><div class="meta"><span class="st">' + starStr(r.stars).slice(0, r.stars) + '</span> ' + esc(r.author) + ' · ' + relTime(r.createdAt) + '</div>' +
        (r.comment ? '<p>' + esc(r.comment) + '</p>' : '') + '</div>';
    }).join('');
    var fssaiHtml = o.fssai
      ? '<div class="fssai on"><span>FSSAI licence <b>on record</b> · <span class="mono">' + esc(o.fssai) + '</span></span> <a href="https://foscos.fssai.gov.in/" target="_blank" rel="noopener">verify ↗</a></div>'
      : '';
    revCard.innerHTML =
      '<div class="rev-top">' +
        '<div class="grade-stamp ' + (hasR ? '' : 'empty') + '" style="' + (hasR ? 'background:' + col : '') + '"><span class="g">' + (o.grade || '?') + '</span><span class="s">GRADE</span></div>' +
        '<div><div class="name">' + esc(o.name) + '</div>' +
          '<div class="sub">' + esc(o.cuisine || 'Restaurant') + (o.city ? ' · ' + esc(o.city) : '') + ' · ' + (hasR ? 'score ' + o.score + '/100' : 'unrated' + (srcTag ? ' · ' + srcTag : '')) + '</div>' +
          '<div class="stars">' + starStr(o.avgStars) + '<b>' + (hasR ? o.avgStars.toFixed(1) + ' · ' + nfmt(o.reviewCount) + ' review' + (o.reviewCount === 1 ? '' : 's') : 'no reviews yet') + '</b></div>' +
        '</div></div>' +
      '<div class="rev-body">' +
        fssaiHtml +
        (flagsHtml ? '<p class="rlabel">What diners report</p><div class="flags">' + flagsHtml + '</div>' : '') +
        (cmts ? '<p class="rlabel">Recent reviews</p><div class="comments">' + cmts + '</div>' : (hasR ? '' : '<p style="color:var(--muted);font-size:14px;margin:0 0 6px">No reviews yet. Be the first to grade this kitchen.</p>')) +
        '<a href="#" class="report-link" id="reportLink">⚠ Report unsafe food to the authorities →</a>' +
        '<div class="rev-form">' +
          '<p class="rlabel">Add your rating</p>' +
          '<div class="starpick" id="starpick">' + [1, 2, 3, 4, 5].map(function (i) { return '<button type="button" data-s="' + i + '" aria-label="' + i + ' star">★</button>'; }).join('') + '</div>' +
          '<div class="flagpick" id="flagpick">' + FLAGSET.map(function (f) { return '<span class="flag" role="button" tabindex="0" data-f="' + esc(f) + '">' + esc(f) + '</span>'; }).join('') + '</div>' +
          '<input type="text" id="authorBox" maxlength="40" placeholder="Your name (optional)" style="margin-bottom:10px">' +
          '<textarea id="cmtBox" maxlength="600" placeholder="What did you notice about hygiene, freshness, packaging? Be honest and specific."></textarea>' +
          '<div class="formerr" id="formErr"></div>' +
          '<div class="submitrow"><button class="btn btn-stamp" id="submitRev">Post review</button>' +
          '<span class="mono" style="font-size:11px;color:var(--muted)">Public · shared on the register</span></div>' +
        '</div>' +
      '</div>';

    var sp = document.getElementById('starpick');
    sp.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return;
      pickStars = +b.getAttribute('data-s');
      Array.prototype.forEach.call(sp.children, function (btn, i) { btn.classList.toggle('on', i < pickStars); });
      document.getElementById('formErr').textContent = '';
    });
    var fp = document.getElementById('flagpick');
    function toggleFlag(s) { var f = s.getAttribute('data-f'); pickFlags[f] = !pickFlags[f]; s.classList.toggle('sel', pickFlags[f]); }
    fp.addEventListener('click', function (e) { var s = e.target.closest('[data-f]'); if (s) toggleFlag(s); });
    fp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { var s = e.target.closest('[data-f]'); if (s) { e.preventDefault(); toggleFlag(s); } } });
    document.getElementById('submitRev').onclick = function () { submitReview(o); };
    var rl = document.getElementById('reportLink');
    if (rl) rl.onclick = function (e) { e.preventDefault(); openReport(o); };
  }

  // ---------------- report to authorities (official channels) ----------------
  var MH_CITIES = ['mumbai', 'pune', 'nagpur', 'nashik', 'nashik road', 'thane', 'navi mumbai', 'aurangabad', 'chhatrapati sambhajinagar', 'sambhajinagar', 'solapur', 'kolhapur', 'amravati', 'nanded', 'sangli', 'jalgaon', 'akola', 'latur', 'dhule', 'ahmednagar', 'chandrapur'];
  function officialLinks(city) {
    var isMH = city && MH_CITIES.indexOf(String(city).trim().toLowerCase()) >= 0;
    var mh = { name: 'Maharashtra FDA complaint portal', desc: 'The AI complaint portal launched by FDA Commissioner Tukaram Mundhe — report food adulteration and unsafe food, and track your complaint.', url: 'https://complaints.mahafda.in' };
    var fssai = { name: 'FSSAI Food Safety Connect', desc: "India's national food-safety regulator. Report unhygienic kitchens, adulteration, restaurants and delivery apps — with photos.", url: 'https://foscos.fssai.gov.in/consumergrievance/' };
    return isMH ? [mh, fssai] : [fssai, mh];
  }
  var reportModal = document.getElementById('reportModal');
  function openReport(o) {
    var links = officialLinks(o.city);
    document.getElementById('reportLinks').innerHTML = links.map(function (l) {
      return '<a class="reportopt" href="' + l.url + '" target="_blank" rel="noopener"><b>' + esc(l.name) + ' ↗</b><small>' + esc(l.desc) + '</small></a>';
    }).join('');
    reportModal.classList.add('on');
  }
  document.getElementById('reportClose').onclick = function () { reportModal.classList.remove('on'); };
  reportModal.addEventListener('click', function (e) { if (e.target === reportModal) reportModal.classList.remove('on'); });

  async function submitReview(o) {
    if (!pickStars) { document.getElementById('formErr').textContent = 'Pick a star rating first.'; return; }
    var fssaiEl = document.getElementById('fssaiBox');
    var fssaiVal = fssaiEl ? fssaiEl.value.replace(/\s/g, '') : '';
    if (fssaiVal && !/^\d{14}$/.test(fssaiVal)) { document.getElementById('formErr').textContent = 'FSSAI number must be 14 digits (or leave it blank).'; return; }
    var body = {
      stars: pickStars,
      comment: document.getElementById('cmtBox').value.trim(),
      author: document.getElementById('authorBox').value.trim(),
      flags: Object.keys(pickFlags).filter(function (f) { return pickFlags[f]; }),
      fssai: fssaiVal
    };
    var btn = document.getElementById('submitRev'); btn.textContent = 'Posting…'; btn.disabled = true;
    try {
      var id = o.id;
      if (!id) { // an OSM place not yet in our DB — create it first
        var ens = await api('/api/places/ensure', { method: 'POST', body: JSON.stringify({ osmId: o.osmId, name: o.name, cuisine: o.cuisine, city: o.city, lat: o.lat, lng: o.lng }) });
        id = ens.id;
      }
      await api('/api/restaurants/' + id + '/reviews', { method: 'POST', body: JSON.stringify(body) });
      say('Review posted — thank you for keeping it honest.');
      await selectPlace({ dbId: id, osmId: o.osmId, name: o.name, cuisine: o.cuisine, city: o.city, lat: o.lat, lng: o.lng, source: o.source });
      loadForView(false); loadStats();
    } catch (e) { document.getElementById('formErr').textContent = e.message; btn.textContent = 'Post review'; btn.disabled = false; }
  }

  // ---------------- geolocation ----------------
  document.getElementById('geoBtn').onclick = function () {
    if (!navigator.geolocation) { say('Location not available in this browser.'); return; }
    say('Requesting your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      loadForView(false); say('Centred on you.');
    }, function () { say('Could not get location — showing default area.'); }, { timeout: 8000 });
  };

  // A pulsing beacon marker at a searched location.
  function dropBeacon(lat, lng, label) {
    searchLayer.clearLayers();
    var icon = L.divIcon({ className: 'beacon', html: '<div class="beacon-ring"></div><div class="beacon-ring beacon-ring2"></div><div class="beacon-core"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    var mk = L.marker([lat, lng], { icon: icon, interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(searchLayer);
    if (label) mk.bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -10], className: 'beacon-label' }).openTooltip();
  }

  // ---------------- search (geocode) ----------------
  var searchBox = document.getElementById('placeSearch');
  var searchResults = document.getElementById('searchResults');
  var searchT, lastResults = [];
  function renderSearchResults(list) {
    lastResults = list;
    if (!list.length) { searchResults.innerHTML = '<div class="sr-empty">No matches — try adding the city, e.g. “Cafe Andora Mumbai”.</div>'; searchResults.hidden = false; return; }
    searchResults.innerHTML = list.map(function (r, i) {
      var parts = r.label.split(', ');
      return '<div class="sr" data-i="' + i + '"><b>' + esc(parts[0]) + '</b><small>' + esc(parts.slice(1, 4).join(', ')) + '</small></div>';
    }).join('');
    searchResults.hidden = false;
  }
  var FOOD_TYPES = ['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream', 'bar', 'pub', 'bakery', 'biergarten', 'deli'];
  function chooseResult(r) {
    if (!r) return;
    searchResults.hidden = true;
    var title = r.name || r.label.split(', ')[0];
    searchBox.value = title;
    var isFood = r.osmType && r.osmId && FOOD_TYPES.indexOf(r.type) >= 0;
    map.setView([r.lat, r.lng], isFood ? 17 : 15);
    dropBeacon(r.lat, r.lng, title);
    loadForView(false);
    if (isFood) {
      selectPlace({ dbId: null, osmId: r.osmType + '/' + r.osmId, name: title, cuisine: (r.type || '').replace(/_/g, ' '), city: r.city || '', lat: r.lat, lng: r.lng, source: 'osm' });
      document.getElementById('revCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  searchBox.addEventListener('input', function () {
    var q = searchBox.value.trim();
    clearTimeout(searchT);
    if (q.length < 2) { searchResults.hidden = true; return; }
    searchT = setTimeout(async function () {
      try { var c = map.getCenter(); var d = await api('/api/geocode?q=' + encodeURIComponent(q) + '&lat=' + c.lat + '&lng=' + c.lng); renderSearchResults(d.results || []); }
      catch (e) { /* silent */ }
    }, 350);
  });
  searchBox.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); chooseResult(lastResults[0]); }
    else if (e.key === 'Escape') { searchResults.hidden = true; }
  });
  searchResults.addEventListener('click', function (e) { var el = e.target.closest('[data-i]'); if (el) chooseResult(lastResults[+el.getAttribute('data-i')]); });
  document.addEventListener('click', function (e) { if (!e.target.closest('.mapsearch')) searchResults.hidden = true; });

  // ---------------- quick-jump cities ----------------
  var CITIES = [
    ['Mumbai', 19.0760, 72.8777], ['Delhi', 28.6139, 77.2090], ['Bengaluru', 12.9716, 77.5946],
    ['Hyderabad', 17.3850, 78.4867], ['Chennai', 13.0827, 80.2707], ['Kolkata', 22.5726, 88.3639],
    ['Pune', 18.5204, 73.8567], ['Ahmedabad', 23.0225, 72.5714], ['Jaipur', 26.9124, 75.7873]
  ];
  var cityRow = document.getElementById('cityRow');
  if (cityRow) {
    CITIES.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'citychip'; b.type = 'button'; b.textContent = c[0];
      b.onclick = function () {
        Array.prototype.forEach.call(cityRow.children, function (el) { el.classList.toggle('active', el === b); });
        searchLayer.clearLayers();
        map.setView([c[1], c[2]], 14);
        loadForView(false);
      };
      cityRow.appendChild(b);
    });
  }

  // ---------------- add a kitchen ----------------
  var addBtn = document.getElementById('addBtn'), addBanner = document.getElementById('addBanner');
  var addModal = document.getElementById('addModal'), pickedLatLng = null;
  function setAddMode(on) { addMode = on; addBanner.classList.toggle('on', on); addBtn.textContent = on ? 'Cancel adding' : 'Add a kitchen'; map.getContainer().style.cursor = on ? 'crosshair' : ''; }
  addBtn.onclick = function () { setAddMode(!addMode); };
  map.on('click', function (e) { if (!addMode) return; pickedLatLng = e.latlng; document.getElementById('addErr').textContent = ''; addModal.classList.add('on'); });
  document.getElementById('addCancel').onclick = function () { addModal.classList.remove('on'); };
  addModal.addEventListener('click', function (e) { if (e.target === addModal) addModal.classList.remove('on'); });
  document.getElementById('addSubmit').onclick = async function () {
    var name = document.getElementById('fName').value.trim();
    if (name.length < 2) { document.getElementById('addErr').textContent = 'Enter the kitchen name.'; return; }
    if (!pickedLatLng) { document.getElementById('addErr').textContent = 'Pick a location on the map.'; return; }
    var body = { name: name, cuisine: document.getElementById('fCuisine').value.trim(), city: document.getElementById('fCity').value.trim(), address: document.getElementById('fAddr').value.trim(), lat: pickedLatLng.lat, lng: pickedLatLng.lng };
    try {
      var r = await api('/api/restaurants', { method: 'POST', body: JSON.stringify(body) });
      addModal.classList.remove('on'); setAddMode(false);
      ['fName', 'fCuisine', 'fCity', 'fAddr'].forEach(function (id) { document.getElementById(id).value = ''; });
      say('Added to the register — now leave the first review.');
      await loadForView(false);
      selectPlace({ dbId: r.id, name: body.name, cuisine: body.cuisine, city: body.city, lat: body.lat, lng: body.lng, source: 'community' });
      document.getElementById('revCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { document.getElementById('addErr').textContent = e.message; }
  };

  // ---------------- pledge ----------------
  var PKEY = 'foodsafe_pledge_token';
  function pledgeToken() {
    var t = localStorage.getItem(PKEY);
    if (!t) { t = (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2))).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64); }
    return t;
  }
  var NKEY = 'foodsafe_pledge_name', NUMKEY = 'foodsafe_pledge_no', DKEY = 'foodsafe_pledge_date';
  function updateGoal(count) { document.getElementById('goalFill').style.width = Math.max(2, Math.min(100, (count / 100000) * 100)).toFixed(1) + '%'; }
  function certNo(n) { return n ? 'No. ' + String(n).padStart(5, '0') : ''; }

  function showCertificate(name, number, dateStr) {
    var no = certNo(number);
    var date = dateStr || new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    var msg = encodeURIComponent('I just took the FoodSafe Pro pledge' + (no ? ' (' + no + ')' : '') + ' — I’ll check the grade before I order and rate the kitchens I eat from. Join the movement for public food safety. #GradeBeforeYouEat');
    var url = encodeURIComponent(location.href);
    var seal = '<svg class="cseal" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="#E8A200" stroke-width="4"/><circle cx="50" cy="50" r="34" fill="none" stroke="#E8A200" stroke-width="2" stroke-dasharray="3 5"/><path d="M34 52l11 11 22-26" fill="none" stroke="#E8A200" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    document.getElementById('pledgeState').innerHTML =
      '<div class="certificate" id="certCard">' + seal +
        '<div class="ckicker">Certificate of Pledge</div>' +
        '<div class="cintro">This certifies that</div>' +
        '<div class="cname">' + esc(name) + '</div>' +
        '<div class="cbody">has taken the FoodSafe Pro pledge — to check the grade before they eat, rate the kitchens they visit, and stand for public, honest food safety.</div>' +
        '<div class="cmeta">Pledge ' + no + ' &nbsp;·&nbsp; ' + esc(date) + '</div>' +
        '<div class="cbrand">FoodSafe Pro</div>' +
        '<div class="ctag">#GradeBeforeYouEat</div>' +
      '</div>' +
      '<div class="share-row" style="margin-top:16px">' +
        '<button class="btn btn-gold" id="dlCert">Download certificate</button>' +
        '<a class="btn btn-ghost" style="color:var(--on-navy);border-color:rgba(255,255,255,.5)" target="_blank" rel="noopener" href="https://wa.me/?text=' + msg + '%20' + url + '">Share on WhatsApp</a>' +
        '<a class="btn btn-ghost" style="color:var(--on-navy);border-color:rgba(255,255,255,.5)" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=' + msg + '&url=' + url + '">Share on X</a>' +
      '</div>' +
      '<div class="donenum">You’re pledge ' + no + '. Send your certificate to 3 friends — that’s how movements move.</div>';
    var dl = document.getElementById('dlCert');
    if (dl) dl.onclick = function () { downloadCert(name); };
  }

  function downloadCert(name) {
    if (!window.html2canvas) { say('Preparing certificate… try again in a moment.'); return; }
    say('Generating your certificate…');
    window.html2canvas(document.getElementById('certCard'), { backgroundColor: '#0F212C', scale: 2, useCORS: true }).then(function (canvas) {
      var a = document.createElement('a');
      a.download = 'FoodSafePro-Pledge-' + String(name || 'certificate').replace(/[^A-Za-z0-9]+/g, '-') + '.png';
      a.href = canvas.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove();
    }).catch(function () { say('Could not generate the image.'); });
  }

  document.getElementById('pledgeBtn').onclick = async function () {
    var nameEl = document.getElementById('pledgeName');
    var name = (nameEl.value || '').trim().replace(/\s+/g, ' ');
    var errEl = document.getElementById('pledgeErr');
    if (name.length < 2) { errEl.textContent = 'Please enter your name to pledge.'; nameEl.focus(); return; }
    errEl.textContent = '';
    var t = pledgeToken();
    try {
      var r = await api('/api/pledge', { method: 'POST', body: JSON.stringify({ token: t, name: name }) });
      var date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      localStorage.setItem(PKEY, t); localStorage.setItem(NKEY, r.name || name);
      localStorage.setItem(NUMKEY, String(r.number || '')); localStorage.setItem(DKEY, date);
      document.getElementById('pledgeCount').textContent = nfmt(r.count); updateGoal(r.count);
      showCertificate(r.name || name, r.number, date); say('Pledge taken — thank you.');
    } catch (e) { document.getElementById('pledgeErr').textContent = e.message; }
  };

  // ---------------- stats ----------------
  async function loadStats() {
    try {
      var s = await api('/api/stats');
      document.getElementById('statReviews').textContent = nfmt(s.reviews);
      var r2 = document.getElementById('statReviews2'); if (r2) r2.textContent = nfmt(s.reviews);
      document.getElementById('statOutlets').textContent = nfmt(s.outlets);
      document.getElementById('statScore').textContent = s.avgScore;
      document.getElementById('statCities').textContent = s.cities;
      document.getElementById('pledgeCount').textContent = nfmt(s.pledges); updateGoal(s.pledges);
    } catch (e) {}
  }

  // ---------------- init ----------------
  if (localStorage.getItem(PKEY) && localStorage.getItem(NKEY)) showCertificate(localStorage.getItem(NKEY), localStorage.getItem(NUMKEY), localStorage.getItem(DKEY));
  setTimeout(function () { map.invalidateSize(); loadForView(true); }, 100);
  loadStats();
})();
