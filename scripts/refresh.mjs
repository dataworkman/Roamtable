// Batch refresh: fetch restaurant candidates for a destination, score them,
// run the sanity checks and store the ranked list. Public pages read only
// from the database, so this is the only place that searches Google Places.
//
//   node --env-file=.env scripts/refresh.mjs charleston-sc savannah-ga
//   node --env-file=.env scripts/refresh.mjs --all
//   node --env-file=.env scripts/refresh.mjs --oldest 3   (least recently refreshed)
import { config, db, now, rerankCity, seedCities, slugify, monthSpendUsd } from "../lib/db.mjs";
import { BudgetError, searchNearby } from "../lib/places.mjs";
import {
  distanceMeters,
  isChain,
  poolStats,
  sanityFlags,
  scoreCandidate,
  searchTiles,
} from "../lib/ranking.mjs";

function neighborhoodOf(place) {
  const components = place.addressComponents ?? [];
  for (const type of ["neighborhood", "sublocality_level_1", "sublocality", "locality"]) {
    const match = components.find((component) => component.types?.includes(type));
    if (match) return match.longText;
  }
  return null;
}

async function fetchCandidates(city) {
  const centers = JSON.parse(city.centers_json);
  const byId = new Map();
  for (const center of centers) {
    for (const tile of searchTiles(center)) {
      for (const place of await searchNearby(tile, city.slug)) {
        if (!place.id || !place.location) continue;
        const location = { lat: place.location.latitude, lng: place.location.longitude };
        if (!centers.some((c) => distanceMeters(c, location) <= c.radius)) continue;
        byId.set(place.id, place);
      }
    }
  }
  const candidates = [...byId.values()].map((place) => {
    const name = place.displayName?.text ?? "";
    const chain = isChain(name);
    const input = { rating: place.rating, reviews: place.userRatingCount, chain };
    return {
      place,
      name,
      chain,
      input,
      flags: sanityFlags({ ...input, businessStatus: place.businessStatus, primaryType: place.primaryType }),
    };
  });
  const pool = poolStats(candidates.map((candidate) => candidate.input));
  for (const candidate of candidates) candidate.score = scoreCandidate(candidate.input, pool);
  return candidates;
}

function storeCity(city, candidates) {
  const verifiedAt = now();
  const keep = candidates.sort((a, b) => b.score - a.score).slice(0, config.selection.candidates_stored);
  // A second location of the same restaurant should not take another slot.
  const seen = new Set();
  for (const candidate of keep) {
    const slug = slugify(candidate.name);
    if (seen.has(slug)) candidate.flags.push("duplicate");
    seen.add(slug);
  }
  const upsert = db.prepare(`
    INSERT INTO restaurants (
      city_id, name, slug, place_id, internal_score, cuisine, category, neighborhood,
      photo_reference, google_maps_url, official_website_url, last_verified_at,
      active, is_chain, flags_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT (city_id, place_id) DO UPDATE SET
      name = excluded.name, slug = excluded.slug, internal_score = excluded.internal_score,
      cuisine = excluded.cuisine, category = excluded.category,
      neighborhood = COALESCE(restaurants.neighborhood, excluded.neighborhood),
      photo_reference = excluded.photo_reference, google_maps_url = excluded.google_maps_url,
      official_website_url = COALESCE(restaurants.official_website_url, excluded.official_website_url),
      last_verified_at = excluded.last_verified_at, active = 1,
      is_chain = excluded.is_chain, flags_json = excluded.flags_json
    RETURNING id
  `);
  const snapshot = db.prepare(`
    INSERT INTO ranking_snapshots
      (restaurant_id, rating_input, review_volume_input, derived_score, rank, captured_at)
    VALUES (?, ?, ?, ?, (SELECT rank FROM restaurants WHERE id = ?), ?)
  `);
  const storeRaw = config.storage.store_raw_google_inputs;

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE restaurants SET active = 0, rank = NULL WHERE city_id = ?").run(city.id);
    const stored = keep.map((candidate) => {
      const { place, name } = candidate;
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(place.id)}`;
      const { id } = upsert.get(
        city.id, name, slugify(name), place.id, candidate.score,
        place.primaryTypeDisplayName?.text ?? null, place.primaryType ?? null,
        neighborhoodOf(place), place.photos?.[0]?.name ?? null, mapsUrl,
        place.websiteUri ?? null, verifiedAt, candidate.chain ? 1 : 0,
        JSON.stringify(candidate.flags),
      );
      return { id, candidate };
    });
    rerankCity(city.id);
    for (const { id, candidate } of stored) {
      snapshot.run(
        id,
        storeRaw ? (candidate.input.rating ?? null) : null,
        storeRaw ? (candidate.input.reviews ?? null) : null,
        candidate.score, id, verifiedAt,
      );
    }
    db.prepare("UPDATE cities SET last_refreshed_at = ? WHERE id = ?").run(verifiedAt, city.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return keep;
}

// Ratings and review counts are printed for the sanity review only; they are
// not written to the database unless storage.store_raw_google_inputs is on.
function printReview(city, candidates) {
  const ranks = new Map(
    db.prepare("SELECT place_id, rank FROM restaurants WHERE city_id = ?").all(city.id)
      .map((row) => [row.place_id, row.rank]),
  );
  console.log(`\n${city.name}, ${city.state} — ${candidates.length} stored candidates`);
  for (const candidate of candidates.slice(0, config.selection.top_internal + 5)) {
    const rank = ranks.get(candidate.place.id);
    console.log(
      [
        (rank ? `#${rank}` : "—").padEnd(4),
        candidate.score.toFixed(1).padStart(5),
        `${candidate.input.rating ?? "?"}★`.padEnd(5),
        String(candidate.input.reviews ?? 0).padStart(6),
        candidate.name.slice(0, 38).padEnd(38),
        (candidate.place.primaryTypeDisplayName?.text ?? "").slice(0, 24).padEnd(24),
        candidate.flags.join(","),
      ].join("  "),
    );
  }
}

seedCities();
const args = process.argv.slice(2);
const oldest = args.indexOf("--oldest");
const cities = args.includes("--all")
  ? db.prepare("SELECT * FROM cities WHERE active = 1 ORDER BY priority").all()
  : oldest !== -1
    ? db
        .prepare("SELECT * FROM cities WHERE active = 1 ORDER BY last_refreshed_at IS NOT NULL, last_refreshed_at, priority LIMIT ?")
        .all(Number(args[oldest + 1]) || 1)
    : args.map((slug) => {
      const city = db.prepare("SELECT * FROM cities WHERE slug = ?").get(slug);
      if (!city) throw new Error(`Unknown destination: ${slug}`);
      return city;
    });
if (cities.length === 0) {
  console.log("Usage: node --env-file=.env scripts/refresh.mjs <city-slug>… | --all | --oldest <n>");
  process.exit(1);
}

for (const city of cities) {
  try {
    const candidates = await fetchCandidates(city);
    printReview(city, storeCity(city, candidates));
  } catch (error) {
    // A city is only written once all of its searches succeeded.
    console.error(`\n${city.name}: ${error.message}`);
    if (error instanceof BudgetError) break;
  }
}
console.log(
  `\nEstimated API spend this month: $${monthSpendUsd().toFixed(2)} of $${config.api.monthly_budget_usd}`,
);
