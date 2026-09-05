# FoodSafe Pro 🛡️

**A citizens' food-safety movement for India.** Take the pledge, rate the kitchens near you on a live map, and build a public, community-powered record of who's safe to eat from — with an administrator's all-India national view.

> Independent concept / citizens' initiative. Not affiliated with, endorsed by, or connected to Tukaram Mundhe, the FSSAI, any government body, or any delivery platform. His name is referenced only as a widely-recognised example of strict public-service enforcement.

---

## What's inside

| Feature | Where |
|---|---|
| Pledge with a **live global counter** + WhatsApp / X / copy sharing | `/` (pledge section) |
| **Map of kitchens within ~3 km**, colour-coded by community grade | `/` (rate section) |
| **Rate + review** a kitchen (stars, hygiene flags, comment) | `/` (review panel) |
| **Add a kitchen** anywhere by dropping a pin (crowdsourced) | `/` (add a kitchen) |
| Live **national stats** (reviews, outlets, avg score, cities) | `/` (national section) |
| Password-protected **all-India admin map** + city leaderboard | `/admin` |

## Stack

- **Node + Express** API and static server
- **PostgreSQL** — geo "within N km" via the haversine formula over `lat`/`lng` (no PostGIS extension needed, so it deploys clean on Railway)
- **Leaflet + OpenStreetMap** for the maps
- Auto-migrates the schema and seeds sample data on first boot

---

## Deploy to Railway (fastest path)

1. Push this repo to GitHub (already done if you're reading this there).
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo** → pick this repo.
3. In the project, **New → Database → Add PostgreSQL**. Railway injects `DATABASE_URL` automatically.
4. Open the web service → **Variables** and set:
   - `ADMIN_USER` — admin login (e.g. `admin`)
   - `ADMIN_PASS` — a strong password (protects `/admin`)
   - `SEED_ON_START` — `true` for the first deploy (seeds sample restaurants), then you can set it to `false`
5. Deploy. Railway runs `npm install` then `npm start`; the app creates its tables and seeds data on boot.
6. Under **Settings → Networking**, generate a public domain. Visit it — the movement is live.

Health check: `GET /healthz` (configured in `railway.json`).

## Run locally

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL + ADMIN_PASS
npm run migrate           # optional — boot does this automatically
npm run seed              # optional — boot seeds if the DB is empty
npm start                 # http://localhost:3000
```

You need a local PostgreSQL 14+ running and its URL in `DATABASE_URL`.
`npm run seed -- --force` re-seeds even if data exists.

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | — (required) |
| `DATABASE_SSL` | force SSL for external Postgres | `false` |
| `SEED_ON_START` | seed sample data on empty DB | `true` |
| `ADMIN_USER` / `ADMIN_PASS` | protect `/admin` and `/api/admin/*` | `admin` / (unset ⇒ admin disabled) |
| `PORT` | listen port | `3000` (Railway sets this) |

## API

- `GET /api/restaurants/near?lat=&lng=&radius=` — nearby outlets + aggregates
- `GET /api/restaurants/:id` — detail + recent reviews + flag tallies
- `POST /api/restaurants/:id/reviews` — `{ stars, comment, flags[], author }`
- `POST /api/restaurants` — add a kitchen `{ name, cuisine, city, address, lat, lng }`
- `GET|POST /api/pledge` — read / add to the global pledge count
- `GET /api/stats` — live national totals
- `GET /api/admin/map` — all outlets + city rollups *(basic auth)*

## Notes on going live for real

- **Moderation**: reviews are public and rate-limited, with a `status` column so abusive entries can be hidden. Before a real launch, add a report button, an admin hide/delete UI, and duplicate/spam controls.
- **Defamation risk**: community grades name real businesses. Show aggregates (not lone 1-stars), keep an audit trail (`ip_hash`, timestamps), and have a takedown process.
- **Accredited grades**: the "official audit" layer (agencies → portable score) can sit alongside community ratings later — the schema leaves room for it.

## Attribution

🤖 Built with [Claude Code](https://claude.com/claude-code)
