// SQLite storage for destinations, curated restaurants, ranking history,
// API usage and analytics events.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const config = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));

export const db = new DatabaseSync(process.env.DB_PATH ?? join(ROOT, "data", "best.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    centers_json TEXT NOT NULL,
    priority INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_refreshed_at TEXT
  );

  -- rank is 1..N among publishable candidates and NULL otherwise; the public
  -- site shows rank <= selection.top_public. Rows are kept when a place drops
  -- out (active = 0) so editorial text survives if it comes back.
  CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY,
    city_id INTEGER NOT NULL REFERENCES cities(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    place_id TEXT NOT NULL,
    rank INTEGER,
    internal_score REAL,
    cuisine TEXT,
    category TEXT,
    neighborhood TEXT,
    short_description TEXT,
    recommended_items_json TEXT,
    photo_reference TEXT,
    google_maps_url TEXT,
    official_website_url TEXT,
    last_verified_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    is_chain INTEGER NOT NULL DEFAULT 0,
    flags_json TEXT NOT NULL DEFAULT '[]',
    excluded INTEGER NOT NULL DEFAULT 0,
    UNIQUE (city_id, place_id)
  );

  -- rating_input / review_volume_input stay NULL unless
  -- storage.store_raw_google_inputs is enabled in config.json.
  CREATE TABLE IF NOT EXISTS ranking_snapshots (
    id INTEGER PRIMARY KEY,
    restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
    rating_input REAL,
    review_volume_input INTEGER,
    derived_score REAL,
    rank INTEGER,
    captured_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_calls (
    id INTEGER PRIMARY KEY,
    endpoint TEXT NOT NULL,
    city_slug TEXT,
    estimated_cost_usd REAL NOT NULL,
    ok INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    city_slug TEXT,
    restaurant_id INTEGER,
    value TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_type_created ON events (type, created_at);
`);

export function now() {
  return new Date().toISOString();
}

export function monthStart() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’‘`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function seedCities() {
  const cities = JSON.parse(readFileSync(join(ROOT, "data", "cities.json"), "utf8"));
  const upsert = db.prepare(`
    INSERT INTO cities (name, state, slug, latitude, longitude, centers_json, priority)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (slug) DO UPDATE SET
      name = excluded.name, state = excluded.state, latitude = excluded.latitude,
      longitude = excluded.longitude, centers_json = excluded.centers_json,
      priority = excluded.priority
  `);
  cities.forEach((city, index) => {
    const slug = slugify(`${city.name} ${city.state}`);
    const [first] = city.centers;
    upsert.run(city.name, city.state, slug, first.lat, first.lng, JSON.stringify(city.centers), index + 1);
  });
}

// Blocking flags keep a candidate out of the ranked list. National chains
// (data/chains.json) are blocked when ranking.exclude_national_chains is on;
// otherwise they stay in and only carry ranking.chain_penalty.
const BLOCKING_FLAGS = new Set(["closed", "not_restaurant", "low_reviews", "duplicate"]);
if (config.ranking.exclude_national_chains) BLOCKING_FLAGS.add("chain");

export function isPublishable(restaurant) {
  if (!restaurant.active || restaurant.excluded) return false;
  return !JSON.parse(restaurant.flags_json).some((flag) => BLOCKING_FLAGS.has(flag));
}

export function rerankCity(cityId) {
  const rows = db
    .prepare("SELECT * FROM restaurants WHERE city_id = ? ORDER BY internal_score DESC, id")
    .all(cityId);
  const setRank = db.prepare("UPDATE restaurants SET rank = ? WHERE id = ?");
  let rank = 0;
  for (const row of rows) {
    setRank.run(isPublishable(row) && rank < config.selection.top_internal ? ++rank : null, row.id);
  }
}

export function monthSpendUsd() {
  return db
    .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total FROM api_calls WHERE created_at >= ?")
    .get(monthStart()).total;
}

export function logApiCall(endpoint, citySlug, costUsd, ok) {
  db.prepare(
    "INSERT INTO api_calls (endpoint, city_slug, estimated_cost_usd, ok, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(endpoint, citySlug ?? null, costUsd, ok ? 1 : 0, now());
}

export function logEvent(type, { citySlug = null, restaurantId = null, value = null } = {}) {
  db.prepare(
    "INSERT INTO events (type, city_slug, restaurant_id, value, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(type, citySlug, restaurantId, value, now());
}
