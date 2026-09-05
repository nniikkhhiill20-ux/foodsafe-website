'use strict';
const { pool } = require('./db');

// Plain-Postgres schema. Geo "within N km" is done with the haversine
// formula over lat/lng columns (see server.js), so no PostGIS extension
// is required — this keeps Railway deploys friction-free. A bounding-box
// index on (lat, lng) keeps the scan cheap.
const SQL = `
CREATE TABLE IF NOT EXISTS restaurants (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  cuisine     TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  fssai       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'live',   -- live | hidden (moderation)
  source      TEXT NOT NULL DEFAULT 'seed',   -- seed | community
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rest_latlng ON restaurants (lat, lng);
CREATE INDEX IF NOT EXISTS idx_rest_city   ON restaurants (city);

CREATE TABLE IF NOT EXISTS reviews (
  id            SERIAL PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  stars         SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment       TEXT NOT NULL DEFAULT '',
  flags         TEXT[] NOT NULL DEFAULT '{}',
  author        TEXT NOT NULL DEFAULT 'Anonymous',
  ip_hash       TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'live',   -- live | hidden
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rev_rest ON reviews (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_rev_created ON reviews (created_at);

CREATE TABLE IF NOT EXISTS pledges (
  id          SERIAL PRIMARY KEY,
  token       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function ensureSchema() {
  await pool.query(SQL);
  console.log('[migrate] schema ensured');
}

// Allow running standalone: `npm run migrate`
if (require.main === module) {
  ensureSchema()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[migrate] failed', e);
      process.exit(1);
    });
}

module.exports = { ensureSchema };
