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
    outlets.forEach(function (o) { o.reviewCount = Number(o.reviewCount) || 0; o.avgStars = Number(o.avgStars) || 0; totReviews += o.reviewCount; starSum += o.avgStars * o.reviewCount; });
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
  async function loadModeration() {
    var wrap = document.getElementById('modRows'); if (!wrap) return;
    try {
      var r = await fetch('/api/admin/reviews'); var d = await r.json();
      var list = d.reviews || [];
      wrap.innerHTML = list.map(function (x) {
        var stars = ''; for (var i = 0; i < x.stars; i++) stars += '★';
        return '<div class="modrow' + (x.status === 'hidden' ? ' hidden-row' : '') + '">' +
          '<div class="modmain"><b>' + esc(x.restaurant) + '</b>' + (x.city ? ' <span class="r">· ' + esc(x.city) + '</span>' : '') +
            ' <span class="r">· ' + stars + '</span>' + (x.reports ? '<span class="rep">⚑ ' + x.reports + '</span>' : '') + (x.status === 'hidden' ? '<span class="rep">hidden</span>' : '') +
            '<div class="modcmt">' + esc(x.comment || '(no comment)') + ' — ' + esc(x.author || 'Anonymous') + '</div></div>' +
          '<div class="modbtns">' +
            (x.status === 'hidden'
              ? '<button class="btn btn-ghost mod" data-act="unhide" data-id="' + x.id + '">Unhide</button>'
              : '<button class="btn btn-ghost mod" data-act="hide" data-id="' + x.id + '">Hide</button>') +
            '<button class="btn btn-ghost mod" data-act="delete" data-id="' + x.id + '">Delete</button>' +
          '</div></div>';
      }).join('') || '<div class="modrow"><span class="modmain">No reviews yet.</span></div>';
      Array.prototype.forEach.call(wrap.querySelectorAll('.mod'), function (b) {
        b.onclick = function () { modAction(b.getAttribute('data-act'), b.getAttribute('data-id')); };
      });
    } catch (e) { wrap.innerHTML = '<div class="modrow"><span class="modmain">Could not load reviews.</span></div>'; }
  }
  async function modAction(act, id) {
    if (act === 'delete' && !confirm('Delete this review permanently?')) return;
    var url = '/api/admin/reviews/' + id + (act === 'delete' ? '' : '/' + act);
    try { await fetch(url, { method: act === 'delete' ? 'DELETE' : 'POST' }); loadModeration(); load(); }
    catch (e) {}
  }

  var clearBtn = document.getElementById('clearSeedBtn');
  if (clearBtn) clearBtn.onclick = async function () {
    if (!confirm('Delete all fictional sample (seed) restaurants and their reviews? Real community/OSM data is kept. This cannot be undone.')) return;
    clearBtn.disabled = true; clearBtn.textContent = 'Clearing…';
    try {
      var r = await fetch('/api/admin/clear-seed', { method: 'POST' });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      document.getElementById('clearSeedMsg').textContent = 'Removed ' + (d.deleted || 0) + ' sample outlets. Set SEED_ON_START=false in Railway so they do not return.';
      load();
    } catch (e) { document.getElementById('clearSeedMsg').textContent = 'Failed: ' + e.message; }
    clearBtn.disabled = false; clearBtn.textContent = 'Clear sample (seed) data';
  };

  load();
  loadModeration();
})();
