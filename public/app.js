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
  var map = L.map('map', { scrollWheelZoom: false }).setView(DEFAULT, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  var markerLayer = L.layerGroup().addTo(map);
  var markersById = {};
  var selectedId = null;
  var addMode = false;
  var loadTimer = null;

  function renderMarkers(list) {
    markerLayer.clearLayers(); markersById = {};
    list.forEach(function (o) {
      var col = o.grade ? gradeColor(o.grade) : COLORS.none;
      var m = L.circleMarker([o.lat, o.lng], {
        radius: o.id === selectedId ? 11 : 8, color: '#fff', weight: 2,
        fillColor: col, fillOpacity: 0.95
      });
      m.bindTooltip(o.name + (o.grade ? ' · ' + o.grade : ' · new'), { direction: 'top' });
      m.on('click', function () { selectRestaurant(o.id); });
      m.addTo(markerLayer); markersById[o.id] = m;
    });
  }

  async function loadForView(fit) {
    var c = map.getCenter();
    var radius = Math.min(20000, Math.round(c.distanceTo(map.getBounds().getNorthEast())));
    try {
      var list = await api('/api/restaurants/near?lat=' + c.lat + '&lng=' + c.lng + '&radius=' + radius);
      renderMarkers(list);
      if (fit && list.length) {
        var b = L.latLngBounds(list.slice(0, 20).map(function (o) { return [o.lat, o.lng]; }));
        b.extend([c.lat, c.lng]); map.fitBounds(b.pad(0.2), { maxZoom: 15 });
      }
      if (!list.length) say('No kitchens on the register here yet — be the first to add one.');
    } catch (e) { say('Could not load kitchens: ' + e.message); }
  }
  map.on('moveend', function () { if (addMode) return; clearTimeout(loadTimer); loadTimer = setTimeout(function () { loadForView(false); }, 350); });

  // ---------------- review card ----------------
  var revCard = document.getElementById('revCard');
  var pickStars = 0, pickFlags = {};

  async function selectRestaurant(id) {
    selectedId = id;
    Object.keys(markersById).forEach(function (k) { markersById[k].setStyle({ radius: (+k === id) ? 11 : 8 }); });
    revCard.innerHTML = '<div class="rev-empty"><div class="big">Loading…</div></div>';
    try { renderRev(await api('/api/restaurants/' + id)); }
    catch (e) { revCard.innerHTML = '<div class="rev-empty"><div class="big">Error</div><div>' + esc(e.message) + '</div></div>'; }
  }

  function renderRev(o) {
    pickStars = 0; pickFlags = {};
    var hasR = o.reviewCount > 0;
    var col = o.grade ? gradeColor(o.grade) : COLORS.none;
    var flagsHtml = (o.flags || []).map(function (f) { return '<span class="flag">' + esc(f.flag) + ' <b>' + f.c + '</b></span>'; }).join('');
    var cmts = (o.reviews || []).map(function (r) {
      return '<div class="cmt"><div class="meta"><span class="st">' + starStr(r.stars).slice(0, r.stars) + '</span> ' + esc(r.author) + ' · ' + relTime(r.createdAt) + '</div>' +
        (r.comment ? '<p>' + esc(r.comment) + '</p>' : '') + '</div>';
    }).join('');
    revCard.innerHTML =
      '<div class="rev-top">' +
        '<div class="grade-stamp ' + (hasR ? '' : 'empty') + '" style="' + (hasR ? 'background:' + col : '') + '"><span class="g">' + (o.grade || '?') + '</span><span class="s">GRADE</span></div>' +
        '<div><div class="name">' + esc(o.name) + '</div>' +
          '<div class="sub">' + esc(o.cuisine || '') + (o.city ? ' · ' + esc(o.city) : '') + ' · score ' + (hasR ? o.score + '/100' : 'unrated') + '</div>' +
          '<div class="stars">' + starStr(o.avgStars) + '<b>' + (hasR ? o.avgStars.toFixed(1) + ' · ' + nfmt(o.reviewCount) + ' review' + (o.reviewCount === 1 ? '' : 's') : 'no reviews yet') + '</b></div>' +
        '</div></div>' +
      '<div class="rev-body">' +
        (flagsHtml ? '<p class="rlabel">What diners report</p><div class="flags">' + flagsHtml + '</div>' : '') +
        (cmts ? '<p class="rlabel">Recent reviews</p><div class="comments">' + cmts + '</div>' : (hasR ? '' : '<p style="color:var(--muted);font-size:14px;margin:0 0 6px">No reviews yet. Be the first to grade this kitchen.</p>')) +
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
  }

  async function submitReview(o) {
    if (!pickStars) { document.getElementById('formErr').textContent = 'Pick a star rating first.'; return; }
    var body = {
      stars: pickStars,
      comment: document.getElementById('cmtBox').value.trim(),
      author: document.getElementById('authorBox').value.trim(),
      flags: Object.keys(pickFlags).filter(function (f) { return pickFlags[f]; })
    };
    var btn = document.getElementById('submitRev'); btn.textContent = 'Posting…';
    try {
      await api('/api/restaurants/' + o.id + '/reviews', { method: 'POST', body: JSON.stringify(body) });
      say('Review posted — thank you for keeping it honest.');
      await selectRestaurant(o.id);
      loadForView(false);
      loadStats();
    } catch (e) { document.getElementById('formErr').textContent = e.message; btn.textContent = 'Post review'; }
  }

  // ---------------- geolocation ----------------
  document.getElementById('geoBtn').onclick = function () {
    if (!navigator.geolocation) { say('Location not available in this browser.'); return; }
    say('Requesting your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      map.setView([pos.coords.latitude, pos.coords.longitude], 14);
      document.getElementById('locLabel').textContent = 'Near you';
      loadForView(false);
      say('Centred on you.');
    }, function () { say('Could not get location — showing default area.'); }, { timeout: 8000 });
  };

  // ---------------- add a kitchen ----------------
  var addBtn = document.getElementById('addBtn'), addBanner = document.getElementById('addBanner');
  var addModal = document.getElementById('addModal'), pickedLatLng = null;
  function setAddMode(on) {
    addMode = on; addBanner.classList.toggle('on', on);
    addBtn.textContent = on ? 'Cancel adding' : 'Add a kitchen';
    map.getContainer().style.cursor = on ? 'crosshair' : '';
  }
  addBtn.onclick = function () { setAddMode(!addMode); };
  map.on('click', function (e) {
    if (!addMode) return;
    pickedLatLng = e.latlng;
    document.getElementById('addErr').textContent = '';
    addModal.classList.add('on');
  });
  document.getElementById('addCancel').onclick = function () { addModal.classList.remove('on'); };
  addModal.addEventListener('click', function (e) { if (e.target === addModal) addModal.classList.remove('on'); });
  document.getElementById('addSubmit').onclick = async function () {
    var name = document.getElementById('fName').value.trim();
    if (name.length < 2) { document.getElementById('addErr').textContent = 'Enter the kitchen name.'; return; }
    if (!pickedLatLng) { document.getElementById('addErr').textContent = 'Pick a location on the map.'; return; }
    var body = {
      name: name, cuisine: document.getElementById('fCuisine').value.trim(),
      city: document.getElementById('fCity').value.trim(), address: document.getElementById('fAddr').value.trim(),
      lat: pickedLatLng.lat, lng: pickedLatLng.lng
    };
    try {
      var r = await api('/api/restaurants', { method: 'POST', body: JSON.stringify(body) });
      addModal.classList.remove('on'); setAddMode(false);
      ['fName', 'fCuisine', 'fCity', 'fAddr'].forEach(function (id) { document.getElementById(id).value = ''; });
      say('Added to the register — now leave the first review.');
      await loadForView(false);
      selectRestaurant(r.id);
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
  var pledgeBtn = document.getElementById('pledgeBtn');
  function showPledged() {
    var msg = encodeURIComponent('I just took the FoodSafe Pro pledge: I’ll check the grade before I order and rate the kitchens I eat from. Join the movement for public food safety. #GradeBeforeYouEat');
    var url = encodeURIComponent(location.href);
    document.getElementById('pledgeState').innerHTML =
      '<div class="done">You’re in. ✓</div>' +
      '<div class="donenum">Now send it to 3 people who eat out — that’s how movements move.</div>' +
      '<div class="share-row">' +
        '<a class="btn btn-gold" target="_blank" rel="noopener" href="https://wa.me/?text=' + msg + '%20' + url + '">Share on WhatsApp</a>' +
        '<a class="btn btn-ghost" style="color:var(--on-navy);border-color:rgba(255,255,255,.5)" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=' + msg + '&url=' + url + '">Share on X</a>' +
        '<button class="btn btn-ghost" style="color:var(--on-navy);border-color:rgba(255,255,255,.5)" id="copyLink">Copy link</button>' +
      '</div>';
    var cl = document.getElementById('copyLink');
    if (cl) cl.onclick = function () {
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { say('Link copied.'); }, function () { say('Copy failed.'); });
    };
  }
  pledgeBtn.onclick = async function () {
    var t = pledgeToken();
    try {
      var r = await api('/api/pledge', { method: 'POST', body: JSON.stringify({ token: t }) });
      localStorage.setItem(PKEY, t);
      document.getElementById('pledgeCount').textContent = nfmt(r.count);
      updateGoal(r.count);
      showPledged(); say('Pledge taken — thank you.');
    } catch (e) { say('Could not record pledge: ' + e.message); }
  };
  function updateGoal(count) {
    var pct = Math.max(2, Math.min(100, (count / 100000) * 100));
    document.getElementById('goalFill').style.width = pct.toFixed(1) + '%';
  }

  // ---------------- stats ----------------
  async function loadStats() {
    try {
      var s = await api('/api/stats');
      document.getElementById('statReviews').textContent = nfmt(s.reviews);
      var r2 = document.getElementById('statReviews2'); if (r2) r2.textContent = nfmt(s.reviews);
      document.getElementById('statOutlets').textContent = nfmt(s.outlets);
      document.getElementById('statScore').textContent = s.avgScore;
      document.getElementById('statCities').textContent = s.cities;
      document.getElementById('pledgeCount').textContent = nfmt(s.pledges);
      updateGoal(s.pledges);
    } catch (e) { /* leave placeholders */ }
  }

  // ---------------- init ----------------
  if (localStorage.getItem(PKEY)) showPledged();
  setTimeout(function () { map.invalidateSize(); loadForView(true); }, 100);
  loadStats();
})();
