'use strict';
(function () {
  var COLORS = { A: '#1E9E5A', B: '#E8912B', C: '#E0432F', D: '#A32118', none: '#8595A0' };
  function gc(g) { return COLORS[g] || COLORS.none; }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]; }); }
  function nfmt(n) { return Number(n).toLocaleString('en-IN'); }

  var map = L.map('natmap').setView([22.5, 80], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  var layer = L.layerGroup().addTo(map);

  async function load() {
    var data;
    try {
      var r = await fetch('/api/admin/map', { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (e) { document.getElementById('live').textContent = 'Error'; return; }

    var outlets = data.outlets || [], cities = data.cities || [];
    var totReviews = 0, starSum = 0;
    outlets.forEach(function (o) { totReviews += o.reviewCount; starSum += o.avgStars * o.reviewCount; });
    document.getElementById('tReviews').textContent = nfmt(totReviews);
    document.getElementById('tOutlets').textContent = nfmt(outlets.length);
    document.getElementById('tScore').textContent = totReviews ? Math.round((starSum / totReviews) * 20) : 0;
    document.getElementById('tCities').textContent = cities.length;

    layer.clearLayers();
    outlets.forEach(function (o) {
      var radius = 5 + Math.sqrt(o.reviewCount || 0) * 1.8;
      var m = L.circleMarker([o.lat, o.lng], { radius: Math.min(radius, 26), color: '#fff', weight: 1.5, fillColor: gc(o.grade), fillOpacity: 0.8 });
      m.bindPopup('<b>' + esc(o.name) + '</b><br>' + esc(o.city || '') + '<br>' + (o.grade ? 'Grade ' + o.grade + ' · ' + o.score + '/100' : 'unrated') + ' · ' + nfmt(o.reviewCount) + ' reviews');
      m.addTo(layer);
    });

    var rows = cities.map(function (c) {
      return '<div class="trow"><span class="c">' + esc(c.city) + ' <span class="r">· ' + c.outlets + ' outlets</span></span>' +
        '<span class="r">' + nfmt(c.reviews) + '</span>' +
        '<span class="sc" style="background:' + gc(c.avgScore >= 82 ? 'A' : c.avgScore >= 64 ? 'B' : c.avgScore >= 45 ? 'C' : 'D') + '">' + c.avgScore + '</span></div>';
    }).join('');
    document.getElementById('cityRows').innerHTML = rows || '<div class="trow"><span>No data yet</span></div>';
  }
  load();
})();
