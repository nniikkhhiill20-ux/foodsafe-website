'use strict';
const { pool } = require('./db');
const { ensureSchema } = require('./migrate');

// All restaurants below are FICTIONAL sample data for the concept.
// Coordinates are approximate real locations so the map and "near me"
// demo behave realistically. tier drives generated review sentiment.
const RESTAURANTS = [
  // ---- Mumbai cluster (dense, for the "within 3 km" demo) ----
  ['Mumbai Tiffin Junction', 'North Indian', 'Bandra West', 'Mumbai', 19.0620, 72.8390, 'A'],
  ['Green Leaf Veg Kitchen', 'Pure veg', 'Khar', 'Mumbai', 19.0700, 72.8360, 'A'],
  ['Sagar Gomantak Thali', 'Coastal thali', 'Dadar', 'Mumbai', 19.0176, 72.8562, 'A-'],
  ['Fresh Catch Seafood', 'Coastal', 'Mahim', 'Mumbai', 19.0410, 72.8410, 'A-'],
  ['Spice Route Rolls', 'Rolls & wraps', 'Bandra East', 'Mumbai', 19.0680, 72.8450, 'B+'],
  ['Juhu Beach Grill', 'Grill', 'Juhu', 'Mumbai', 19.0990, 72.8265, 'B+'],
  ['Bandra Bhel House', 'Chaat', 'Bandra West', 'Mumbai', 19.0555, 72.8295, 'B'],
  ["Anna's Idli Corner", 'South Indian', 'Santacruz', 'Mumbai', 19.0810, 72.8410, 'B'],
  ['Cloud Kitchen Collective', 'Multi-brand', 'Andheri West', 'Mumbai', 19.1136, 72.8360, 'B-'],
  ['Corner Chinese Fast Food', 'Indo-Chinese', 'Bandra West', 'Mumbai', 19.0480, 72.8280, 'C'],
  ['Midnight Biryani Express', 'Biryani', 'Kurla', 'Mumbai', 19.0330, 72.8500, 'D'],
  ['Highway Dhaba 47', 'Punjabi', 'Andheri East', 'Mumbai', 19.0900, 72.8500, 'D'],

  // ---- Delhi ----
  ['Connaught Curry Co', 'North Indian', 'Connaught Place', 'Delhi', 28.6330, 77.2190, 'B+'],
  ['Old Delhi Kebab Corner', 'Mughlai', 'Chandni Chowk', 'Delhi', 28.6560, 77.2300, 'C'],
  ['Saket Salad Bar', 'Healthy', 'Saket', 'Delhi', 28.5245, 77.2066, 'A'],

  // ---- Bengaluru ----
  ['Koramangala Dosa Hub', 'South Indian', 'Koramangala', 'Bengaluru', 12.9352, 77.6245, 'A'],
  ['Indiranagar Bowl Co', 'Continental', 'Indiranagar', 'Bengaluru', 12.9719, 77.6412, 'B+'],
  ['MG Road Biryani', 'Biryani', 'MG Road', 'Bengaluru', 12.9750, 77.6060, 'C'],

  // ---- Hyderabad ----
  ['Charminar Biryani House', 'Biryani', 'Charminar', 'Hyderabad', 17.3616, 78.4747, 'B'],
  ['Banjara Veg', 'Pure veg', 'Banjara Hills', 'Hyderabad', 17.4126, 78.4482, 'A-'],
  ['Hitech Cloud Eats', 'Multi-brand', 'Hitech City', 'Hyderabad', 17.4435, 78.3772, 'B-'],

  // ---- Chennai ----
  ['Marina Meals', 'South Indian', 'Marina', 'Chennai', 13.0500, 80.2824, 'B+'],
  ['T Nagar Tiffin', 'Tiffin', 'T. Nagar', 'Chennai', 13.0418, 80.2341, 'A-'],
  ['ECR Seafood Shack', 'Seafood', 'ECR', 'Chennai', 12.9500, 80.2500, 'B'],

  // ---- Kolkata ----
  ['Park Street Rolls', 'Rolls', 'Park Street', 'Kolkata', 22.5530, 88.3520, 'B+'],
  ['New Market Biryani', 'Biryani', 'New Market', 'Kolkata', 22.5646, 88.3510, 'C'],
  ['Salt Lake Veg', 'Pure veg', 'Salt Lake', 'Kolkata', 22.5800, 88.4200, 'B'],

  // ---- Pune ----
  ['FC Road Fresh', 'Healthy', 'FC Road', 'Pune', 18.5210, 73.8410, 'A-'],
  ['Koregaon Bowls', 'Continental', 'Koregaon Park', 'Pune', 18.5362, 73.8939, 'B+'],
  ['Camp Kebabs', 'Mughlai', 'Camp', 'Pune', 18.5150, 73.8790, 'C'],

  // ---- Other cities (national map coverage) ----
  ['SG Highway Thali', 'Gujarati thali', 'SG Highway', 'Ahmedabad', 23.0300, 72.5100, 'B'],
  ['Manek Chowk Bites', 'Street food', 'Manek Chowk', 'Ahmedabad', 23.0225, 72.5871, 'C'],
  ['Pink City Kachori', 'Rajasthani', 'MI Road', 'Jaipur', 26.9124, 75.7873, 'B'],
  ['Hawa Mahal Sweets', 'Sweets', 'Hawa Mahal', 'Jaipur', 26.9239, 75.8267, 'B-'],
  ['Hazratganj Kebabs', 'Awadhi', 'Hazratganj', 'Lucknow', 26.8500, 80.9490, 'B'],
  ['Aminabad Tiffin', 'Tiffin', 'Aminabad', 'Lucknow', 26.8560, 80.9200, 'C'],
  ['Sector 17 Fresh', 'Healthy', 'Sector 17', 'Chandigarh', 30.7410, 76.7822, 'A-'],
  ['Fort Kochi Seafood', 'Seafood', 'Fort Kochi', 'Kochi', 9.9658, 76.2422, 'A'],
  ['MG Road Meals', 'South Indian', 'MG Road', 'Kochi', 9.9816, 76.2999, 'B'],
  ['Fancy Bazar Thali', 'Assamese', 'Fancy Bazar', 'Guwahati', 26.1830, 91.7460, 'B-'],
  ['New Market Bites', 'Street food', 'New Market', 'Bhopal', 23.2330, 77.4000, 'B'],
  ['Boring Road Biryani', 'Biryani', 'Boring Road', 'Patna', 25.6100, 85.1100, 'C'],
  ['Sitabuldi Tiffin', 'Tiffin', 'Sitabuldi', 'Nagpur', 21.1450, 79.0800, 'B'],
  ['Ghod Dod Thali', 'Gujarati thali', 'Ghod Dod Road', 'Surat', 21.1700, 72.8000, 'B'],
];

const TIER = {
  'A':  { avg: 4.6, nMin: 18, nMax: 30, pos: 0.90 },
  'A-': { avg: 4.2, nMin: 14, nMax: 24, pos: 0.80 },
  'B+': { avg: 3.9, nMin: 12, nMax: 22, pos: 0.70 },
  'B':  { avg: 3.5, nMin: 10, nMax: 18, pos: 0.55 },
  'B-': { avg: 3.2, nMin: 8,  nMax: 16, pos: 0.45 },
  'C':  { avg: 2.6, nMin: 8,  nMax: 16, pos: 0.25 },
  'D':  { avg: 1.9, nMin: 6,  nMax: 14, pos: 0.12 },
};

const POS = ['Kitchen looked spotless when I picked up.', 'Fresh and hot every single time.', 'Great packaging, properly sealed.', 'Been ordering here for years, never an issue.', 'You can taste how fresh it is.', 'Clean counter, staff wore gloves.', 'Reliable and consistent quality.'];
const MID = ['Decent, but quality varies day to day.', 'Fine most days, nothing to complain about.', 'Packaging good, food a bit average.', 'Hit or miss depending on the item.', 'Tasty but slightly oily for me.'];
const NEG = ['Food tasted stale this time.', 'Saw hygiene issues near the prep area.', 'Oil smelled reused.', 'Had a stomach upset after ordering.', 'Spotted pests near the storage.', "Won't be ordering again."];

const POS_FLAGS = ['Clean kitchen', 'Fresh food', 'Great packaging'];
const NEG_FLAGS = ['Reused oil', 'Stale / spoiled', 'Pest seen', 'Overpriced'];
const AUTHORS = ['Priya S.', 'Arjun M.', 'Neha R.', 'Sam K.', 'Rahul D.', 'Meera P.', 'Kavya N.', 'Dev T.', 'Isha V.', 'Rohit G.', 'Tara B.', 'Vikram J.', 'Sana M.', 'Karan S.', 'Zoya H.', 'Nikhil P.', 'Ria S.', 'Amit K.', 'Anonymous'];

function rand(a, b) { return a + Math.random() * (b - a); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clampStar(x) { return Math.max(1, Math.min(5, Math.round(x))); }

function genReviews(restId, tier) {
  const t = TIER[tier];
  const n = Math.round(rand(t.nMin, t.nMax));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const stars = clampStar(t.avg + rand(-1.1, 1.1));
    let comment, flags = [];
    if (stars >= 4) { comment = pick(POS); if (Math.random() < 0.7) flags = [pick(POS_FLAGS)]; }
    else if (stars === 3) { comment = pick(MID); if (Math.random() < 0.4) flags = [pick(Math.random() < 0.5 ? POS_FLAGS : NEG_FLAGS)]; }
    else { comment = pick(NEG); if (Math.random() < 0.75) flags = [pick(NEG_FLAGS)]; }
    if (Math.random() < 0.25 && flags.length) flags.push(pick(flags[0] && POS_FLAGS.includes(flags[0]) ? POS_FLAGS : NEG_FLAGS));
    flags = Array.from(new Set(flags));
    const daysAgo = Math.round(rand(1, 180));
    rows.push({ restId, stars, comment, flags, author: pick(AUTHORS), daysAgo });
  }
  return rows;
}

async function seedIfEmpty(force = false) {
  await ensureSchema();
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM restaurants');
  if (rows[0].c > 0 && !force) {
    console.log('[seed] restaurants already present (' + rows[0].c + ') — skipping seed');
    return;
  }
  console.log('[seed] seeding sample data…');
  for (const r of RESTAURANTS) {
    const [name, cuisine, address, city, lat, lng, tier] = r;
    const res = await pool.query(
      `INSERT INTO restaurants (name, cuisine, address, city, lat, lng, source)
       VALUES ($1,$2,$3,$4,$5,$6,'seed') RETURNING id`,
      [name, cuisine, address, city, lat, lng]
    );
    const restId = res.rows[0].id;
    const revs = genReviews(restId, tier);
    for (const rv of revs) {
      await pool.query(
        `INSERT INTO reviews (restaurant_id, stars, comment, flags, author, created_at)
         VALUES ($1,$2,$3,$4,$5, now() - ($6 || ' days')::interval)`,
        [rv.restId, rv.stars, rv.comment, rv.flags, rv.author, String(rv.daysAgo)]
      );
    }
  }
  const total = await pool.query('SELECT COUNT(*)::int AS c FROM reviews');
  console.log('[seed] done — ' + RESTAURANTS.length + ' restaurants, ' + total.rows[0].c + ' reviews');
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  seedIfEmpty(force)
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[seed] failed', e); process.exit(1); });
}

module.exports = { seedIfEmpty };
