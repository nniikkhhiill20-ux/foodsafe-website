'use strict';
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { pool, query } = require('./src/db');
const { ensureSchema } = require('./src/migrate');
const { seedIfEmpty } = require('./src/seed');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy

// ---- security + basics ----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com', "'unsafe-inline'"],
      styleSrc: ["'self'", 'https://unpkg.com', 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

const FLAGS = ['Clean kitchen', 'Fresh food', 'Great packaging', 'Reused oil', 'Stale / spoiled', 'Pest seen', 'Overpriced'];
const GRADE = (avg) => { const s = avg * 20; return s >= 82 ? 'A' : s >= 64 ? 'B' : s >= 45 ? 'C' : 'D'; };
const clientHash = (req) => crypto.createHash('sha256').update((req.ip || '') + '|foodsafe').digest('hex').slice(0, 32);

// ---- rate limiters ----
const writeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many submissions — try again later.' } });
const addLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many new kitchens added — try again later.' } });

// =====================  PUBLIC API  =====================

app.get('/healthz', async (_req, res) => {
  try { await query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: 'db' }); }
});

// Restaurants within radius (metres) of a point, with aggregates.
app.get('/api/restaurants/near', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  let radius = parseInt(req.query.radius, 10);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required' });
  if (!isFinite(radius)) radius = 3000;
  radius = Math.max(100, Math.min(radius, 20000));
  try {
    const sql = `
      SELECT * FROM (
        SELECT r.id, r.name, r.cuisine, r.address, r.city, r.lat, r.lng, r.source, r.osm_id,
          COALESCE(a.cnt,0)::int AS review_count, COALESCE(a.avg,0)::float AS avg_stars,
          (6371000 * acos(greatest(-1, least(1,
            cos(radians($1))*cos(radians(r.lat))*cos(radians(r.lng)-radians($2))
            + sin(radians($1))*sin(radians(r.lat)))))) AS distance_m
        FROM restaurants r
        LEFT JOIN (SELECT restaurant_id, COUNT(*) cnt, AVG(stars) avg FROM reviews WHERE status='live' GROUP BY restaurant_id) a
          ON a.restaurant_id = r.id
        WHERE r.status='live'
      ) t
      WHERE distance_m <= $3
      ORDER BY distance_m ASC
      LIMIT 200;`;
    const { rows } = await query(sql, [lat, lng, radius]);
    res.json(rows.map((r) => ({
      id: r.id, name: r.name, cuisine: r.cuisine, address: r.address, city: r.city,
      lat: r.lat, lng: r.lng, source: r.source,
      reviewCount: r.review_count, avgStars: Number(r.avg_stars) || 0,
      score: Math.round((Number(r.avg_stars) || 0) * 20),
      grade: r.review_count > 0 ? GRADE(Number(r.avg_stars)) : null,
      distanceM: Math.round(r.distance_m),
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// One restaurant: details + recent reviews + flag tallies.
app.get('/api/restaurants/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!isFinite(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const r = await query('SELECT id,name,cuisine,address,city,lat,lng,source,fssai FROM restaurants WHERE id=$1 AND status=$2', [id, 'live']);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    const agg = await query("SELECT COUNT(*)::int cnt, COALESCE(AVG(stars),0)::float avg FROM reviews WHERE restaurant_id=$1 AND status='live'", [id]);
    const recent = await query("SELECT stars, comment, flags, author, created_at FROM reviews WHERE restaurant_id=$1 AND status='live' ORDER BY created_at DESC LIMIT 8", [id]);
    const tally = await query("SELECT f AS flag, COUNT(*)::int c FROM (SELECT unnest(flags) f FROM reviews WHERE restaurant_id=$1 AND status='live') s GROUP BY f ORDER BY c DESC LIMIT 6", [id]);
    const avg = Number(agg.rows[0].avg) || 0;
    res.json({
      ...r.rows[0],
      reviewCount: agg.rows[0].cnt, avgStars: avg,
      score: Math.round(avg * 20), grade: agg.rows[0].cnt > 0 ? GRADE(avg) : null,
      flags: tally.rows,
      reviews: recent.rows.map((x) => ({ stars: x.stars, comment: x.comment, flags: x.flags, author: x.author, createdAt: x.created_at })),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// Post a review.
app.post('/api/restaurants/:id/reviews', writeLimiter, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const stars = parseInt(req.body.stars, 10);
  let comment = String(req.body.comment || '').trim().slice(0, 600);
  let author = String(req.body.author || 'Anonymous').trim().slice(0, 40) || 'Anonymous';
  let flags = Array.isArray(req.body.flags) ? req.body.flags.filter((f) => FLAGS.includes(f)).slice(0, 4) : [];
  let clientId = String(req.body.clientId || '').trim().slice(0, 64);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(clientId)) clientId = '';
  if (!isFinite(id)) return res.status(400).json({ error: 'bad id' });
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Pick a star rating between 1 and 5.' });
  try {
    const exists = await query('SELECT 1 FROM restaurants WHERE id=$1 AND status=$2', [id, 'live']);
    if (!exists.rows.length) return res.status(404).json({ error: 'not found' });
    await query('INSERT INTO reviews (restaurant_id, stars, comment, flags, author, ip_hash, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, stars, comment, flags, author, clientHash(req), clientId]);
    const fssai = String(req.body.fssai || '').replace(/\s/g, '');
    if (/^\d{14}$/.test(fssai)) {
      await query("UPDATE restaurants SET fssai=$1 WHERE id=$2 AND (fssai IS NULL OR fssai='')", [fssai, id]);
    }
    const agg = await query("SELECT COUNT(*)::int cnt, COALESCE(AVG(stars),0)::float avg FROM reviews WHERE restaurant_id=$1 AND status='live'", [id]);
    const avg = Number(agg.rows[0].avg) || 0;
    res.json({ ok: true, reviewCount: agg.rows[0].cnt, avgStars: avg, score: Math.round(avg * 20), grade: GRADE(avg) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// Add a kitchen (community-contributed).
app.post('/api/restaurants', addLimiter, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 120);
  const cuisine = String(req.body.cuisine || '').trim().slice(0, 60);
  const address = String(req.body.address || '').trim().slice(0, 160);
  const city = String(req.body.city || '').trim().slice(0, 80);
  const lat = parseFloat(req.body.lat), lng = parseFloat(req.body.lng);
  if (name.length < 2) return res.status(400).json({ error: 'Enter the kitchen name.' });
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return res.status(400).json({ error: 'Pick a location on the map.' });
  try {
    const { rows } = await query(
      `INSERT INTO restaurants (name, cuisine, address, city, lat, lng, source) VALUES ($1,$2,$3,$4,$5,$6,'community') RETURNING id`,
      [name, cuisine, address, city, lat, lng]);
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// Pledge — deduped by a client token, returns global total.
app.post('/api/pledge', writeLimiter, async (req, res) => {
  let token = String(req.body.token || '').trim().slice(0, 64);
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(token)) return res.status(400).json({ error: 'bad token' });
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  try {
    const ins = await query(
      'INSERT INTO pledges (token, name) VALUES ($1,$2) ON CONFLICT (token) DO UPDATE SET name = EXCLUDED.name RETURNING id, name',
      [token, name]);
    const c = await query('SELECT COUNT(*)::int AS c FROM pledges');
    res.json({ ok: true, count: c.rows[0].c, number: ins.rows[0].id, name: ins.rows[0].name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});
app.get('/api/pledge', async (_req, res) => {
  try { const c = await query('SELECT COUNT(*)::int AS c FROM pledges'); res.json({ count: c.rows[0].c }); }
  catch (e) { res.status(500).json({ error: 'server' }); }
});

// A visitor's own review history (identified by their browser client id).
app.get('/api/my/reviews', async (req, res) => {
  const cid = String(req.query.clientId || '').trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(cid)) return res.json({ reviews: [] });
  try {
    const { rows } = await query(
      `SELECT rv.id, rv.stars, rv.comment, rv.flags, rv.created_at,
              r.id AS rid, r.name, r.city, r.lat, r.lng
       FROM reviews rv JOIN restaurants r ON r.id = rv.restaurant_id
       WHERE rv.client_id = $1 AND rv.status='live' AND r.status='live'
       ORDER BY rv.created_at DESC LIMIT 100`, [cid]);
    res.json({
      reviews: rows.map((x) => ({
        id: x.id, stars: x.stars, comment: x.comment, flags: x.flags, createdAt: x.created_at,
        rid: x.rid, name: x.name, city: x.city, lat: x.lat, lng: x.lng,
      })),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// Public national map data (read-only) — same aggregates, no auth.
app.get('/api/national/map', async (_req, res) => {
  try { res.json(await nationalMapData()); } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// National stats (real, live).
app.get('/api/stats', async (_req, res) => {
  try {
    const s = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM reviews WHERE status='live') AS reviews,
        (SELECT COUNT(*)::int FROM restaurants WHERE status='live') AS outlets,
        (SELECT COUNT(DISTINCT city)::int FROM restaurants WHERE status='live' AND city <> '') AS cities,
        (SELECT COALESCE(AVG(stars),0)::float FROM reviews WHERE status='live') AS avg_stars,
        (SELECT COUNT(*)::int FROM pledges) AS pledges`);
    const row = s.rows[0];
    res.json({ reviews: row.reviews, outlets: row.outlets, cities: row.cities, pledges: row.pledges, avgScore: Math.round((Number(row.avg_stars) || 0) * 20) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// =====================  LIVE PLACES (OpenStreetMap)  =====================
// Real restaurants near a point, pulled live from OpenStreetMap's Overpass
// API (open data, ODbL). Fetched server-side (no CORS/CSP issues), cached
// briefly, and merged with our own reviewed outlets.
const placeCache = new Map(); // key -> { t, v }
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function overpassNear(lat, lng, radius) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3) + ',' + radius;
  const hit = placeCache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.v;
  const filter = '["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream)$"]';
  const q = `[out:json][timeout:20];(node${filter}(around:${radius},${lat},${lng});way${filter}(around:${radius},${lat},${lng}););out center 250;`;
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 18000);
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'FoodSafePro/1.0 (citizens food-safety project; contact via foodsafe-website-production.up.railway.app)' },
        body: 'data=' + encodeURIComponent(q), signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(url.split('/')[2] + ' HTTP ' + r.status + ' ' + t.slice(0, 80).replace(/\s+/g, ' ')); }
      const j = await r.json();
      const places = (j.elements || []).map((e) => {
        const t = e.tags || {}; if (!t.name) return null;
        const plat = e.lat != null ? e.lat : (e.center && e.center.lat);
        const plng = e.lon != null ? e.lon : (e.center && e.center.lon);
        if (plat == null || plng == null) return null;
        return { osmId: e.type + '/' + e.id, name: String(t.name).slice(0, 120), cuisine: String(t.cuisine || t.amenity || '').replace(/_/g, ' ').slice(0, 60), city: String(t['addr:city'] || '').slice(0, 80), lat: plat, lng: plng };
      }).filter(Boolean);
      placeCache.set(key, { t: Date.now(), v: places });
      return places;
    } catch (e) { lastErr = new Error(url.split('/')[2] + ': ' + e.message); }
  }
  throw lastErr || new Error('overpass unavailable');
}

// Merged nearby: real OSM places + our reviewed/community outlets.
app.get('/api/places/near', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  let radius = parseInt(req.query.radius, 10);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required' });
  if (!isFinite(radius)) radius = 3000;
  radius = Math.max(200, Math.min(radius, 6000));
  try {
    const dbSql = `
      SELECT * FROM (
        SELECT r.id, r.name, r.cuisine, r.city, r.lat, r.lng, r.source, r.osm_id,
          COALESCE(a.cnt,0)::int AS review_count, COALESCE(a.avg,0)::float AS avg_stars,
          (6371000 * acos(greatest(-1, least(1,
            cos(radians($1))*cos(radians(r.lat))*cos(radians(r.lng)-radians($2))
            + sin(radians($1))*sin(radians(r.lat)))))) AS distance_m
        FROM restaurants r
        LEFT JOIN (SELECT restaurant_id, COUNT(*) cnt, AVG(stars) avg FROM reviews WHERE status='live' GROUP BY restaurant_id) a ON a.restaurant_id=r.id
        WHERE r.status='live'
      ) t WHERE distance_m <= $3 ORDER BY distance_m ASC LIMIT 300;`;
    const dbRes = await query(dbSql, [lat, lng, radius]);

    const byKey = new Map();
    dbRes.rows.forEach((r) => {
      const avg = Number(r.avg_stars) || 0;
      const item = {
        dbId: r.id, osmId: r.osm_id || null, name: r.name, cuisine: r.cuisine, city: r.city,
        lat: r.lat, lng: r.lng, source: r.source, reviewCount: r.review_count, avgStars: avg,
        score: Math.round(avg * 20), grade: r.review_count > 0 ? GRADE(avg) : null, distanceM: Math.round(r.distance_m),
      };
      byKey.set(r.osm_id ? 'o:' + r.osm_id : 'd:' + r.id, item);
    });

    let osmError = false;
    try {
      const osm = await overpassNear(lat, lng, radius);
      osm.forEach((p) => {
        if (byKey.has('o:' + p.osmId)) return; // already in our DB (keeps its reviews)
        const d = haversineM(lat, lng, p.lat, p.lng);
        if (d > radius) return;
        byKey.set('o:' + p.osmId, {
          dbId: null, osmId: p.osmId, name: p.name, cuisine: p.cuisine, city: p.city,
          lat: p.lat, lng: p.lng, source: 'osm', reviewCount: 0, avgStars: 0, score: 0, grade: null, distanceM: Math.round(d),
        });
      });
    } catch (e) { osmError = true; console.warn('[overpass]', e.message); }

    const list = Array.from(byKey.values()).sort((a, b) => a.distanceM - b.distanceM).slice(0, 160);
    res.json({ places: list, osmError });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// Ensure an OSM place exists in our DB (so a review can attach to it).
app.post('/api/places/ensure', writeLimiter, async (req, res) => {
  const osmId = String(req.body.osmId || '').trim().slice(0, 40);
  const name = String(req.body.name || '').trim().slice(0, 120);
  const cuisine = String(req.body.cuisine || '').trim().slice(0, 60);
  const city = String(req.body.city || '').trim().slice(0, 80);
  const lat = parseFloat(req.body.lat), lng = parseFloat(req.body.lng);
  if (!/^(node|way|relation)\/\d+$/.test(osmId)) return res.status(400).json({ error: 'bad osmId' });
  if (name.length < 2 || !isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'bad place' });
  try {
    const { rows } = await query(
      `INSERT INTO restaurants (name, cuisine, city, lat, lng, source, osm_id)
       VALUES ($1,$2,$3,$4,$5,'osm',$6)
       ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name, cuisine, city, lat, lng, osmId]);
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// Geocode search — find a restaurant name, area, or landmark (OSM Nominatim),
// biased to the current map area so results are local, not all-India.
const geoCache = new Map();
async function nominatim(q, viewbox) {
  const base = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=' + encodeURIComponent(q) + viewbox;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  const r = await fetch(base, { headers: { 'User-Agent': 'FoodSafePro/1.0 (citizens food-safety project)', 'Accept': 'application/json', 'Accept-Language': 'en' }, signal: ctrl.signal });
  clearTimeout(to);
  if (!r.ok) throw new Error('geocode ' + r.status);
  return await r.json();
}
function mapNom(j) {
  return (j || []).map((x) => ({
    label: x.display_name, name: x.name || x.display_name.split(',')[0],
    lat: parseFloat(x.lat), lng: parseFloat(x.lon),
    osmType: x.osm_type, osmId: x.osm_id, type: x.type,
    city: (x.address && (x.address.city || x.address.town || x.address.suburb || x.address.village || x.address.state_district)) || '',
  })).filter((x) => isFinite(x.lat) && isFinite(x.lng)).slice(0, 6);
}
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q.length < 2) return res.json({ results: [] });
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  const hasView = isFinite(lat) && isFinite(lng);
  const key = q.toLowerCase() + (hasView ? '@' + lat.toFixed(2) + ',' + lng.toFixed(2) : '');
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return res.json({ results: hit.v });
  try {
    let results = [];
    if (hasView) {
      const d = 0.25;
      const vb = '&viewbox=' + (lng - d) + ',' + (lat + d) + ',' + (lng + d) + ',' + (lat - d) + '&bounded=1';
      results = mapNom(await nominatim(q, vb));
    }
    if (!results.length) results = mapNom(await nominatim(q, '')); // fall back to all-India
    geoCache.set(key, { t: Date.now(), v: results });
    res.json({ results });
  } catch (e) { console.warn('[geocode]', e.message); res.json({ results: [], error: true }); }
});

// =====================  ADMIN  =====================
function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || '';
  if (!pass) return res.status(503).send('Admin console disabled: set ADMIN_PASS.');
  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, p] = Buffer.from(encoded, 'base64').toString().split(':');
    if (u === user && p === pass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="FoodSafe Pro Admin"');
  res.status(401).send('Authentication required.');
}

// Every live outlet with aggregates, for the national map (public, read-only data).
async function nationalMapData() {
  const { rows } = await query(`
    SELECT r.id, r.name, r.city, r.lat, r.lng, r.source,
      COALESCE(a.cnt,0)::int AS review_count, COALESCE(a.avg,0)::float AS avg_stars
    FROM restaurants r
    LEFT JOIN (SELECT restaurant_id, COUNT(*) cnt, AVG(stars) avg FROM reviews WHERE status='live' GROUP BY restaurant_id) a ON a.restaurant_id=r.id
    WHERE r.status='live' ORDER BY review_count DESC;`);
  const outlets = rows.map((r) => ({
    id: r.id, name: r.name, city: r.city, lat: r.lat, lng: r.lng, source: r.source,
    reviewCount: r.review_count, avgStars: Number(r.avg_stars) || 0,
    score: Math.round((Number(r.avg_stars) || 0) * 20), grade: r.review_count > 0 ? GRADE(Number(r.avg_stars)) : null,
  }));
  const cityMap = {};
  for (const o of outlets) {
    const k = o.city || 'Unknown';
    if (!cityMap[k]) cityMap[k] = { city: k, outlets: 0, reviews: 0, starSum: 0 };
    cityMap[k].outlets++; cityMap[k].reviews += o.reviewCount; cityMap[k].starSum += o.avgStars * o.reviewCount;
  }
  const cities = Object.values(cityMap).map((c) => ({ city: c.city, outlets: c.outlets, reviews: c.reviews, avgScore: c.reviews ? Math.round((c.starSum / c.reviews) * 20) : 0 })).sort((a, b) => b.reviews - a.reviews);
  return { outlets, cities };
}

app.get('/api/admin/map', adminAuth, async (_req, res) => {
  try { res.json(await nationalMapData()); } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// Delete the fictional sample data (source='seed') and its reviews.
app.post('/api/admin/clear-seed', adminAuth, async (_req, res) => {
  try {
    const r = await query("DELETE FROM restaurants WHERE source='seed'");
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

app.get('/admin', adminAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ---- static (after routes) ----
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---- boot ----
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await ensureSchema();
    if (String(process.env.SEED_ON_START || 'true').toLowerCase() === 'true') {
      await seedIfEmpty();
    }
  } catch (e) {
    console.error('[boot] schema/seed error (continuing):', e.message);
  }
  app.listen(PORT, () => console.log('[boot] FoodSafe Pro listening on :' + PORT));
})();
