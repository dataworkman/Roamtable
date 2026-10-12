// Scoring and sanity checks for restaurant candidates. Weights come from
// config.json so the model can be tuned without code changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config } from "./db.mjs";

const CHAIN_NAMES = JSON.parse(readFileSync(join(ROOT, "data", "chains.json"), "utf8")).map(
  normalizeName,
);

// Google primary types that count as "primarily a restaurant" besides the
// ones that end in "restaurant".
const RESTAURANT_TYPES = new Set([
  "steak_house", "diner", "bar_and_grill", "bistro", "gastropub", "brasserie",
  "pizzeria", "food_court", "deli", "sandwich_shop", "brewpub", "tapas_bar",
  "oyster_bar", "noodle_shop", "ramen_shop", "taqueria", "cafeteria",
]);

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’‘`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

// A chain matches when the place name is the chain name or starts with it,
// so "Sonic Drive-In #12" matches but "Supersonic Wings" does not.
export function isChain(name) {
  const normalized = normalizeName(name ?? "");
  return CHAIN_NAMES.some((chain) => normalized === chain || normalized.startsWith(`${chain} `));
}

export function isRestaurantType(primaryType) {
  if (!primaryType) return false;
  return primaryType.endsWith("restaurant") || RESTAURANT_TYPES.has(primaryType);
}

// Reference values for one destination's candidate pool. Scores are relative
// to the pool so the weights mean the same thing in a small town as in a
// busy one.
export function poolStats(inputs) {
  const { minimum_reviews, review_reference_percentile } = config.ranking;
  const established = inputs.filter((input) => (input.reviews ?? 0) >= minimum_reviews && input.rating);
  if (established.length === 0) return { meanRating: 4.3, referenceReviews: minimum_reviews * 10 };
  const reviews = established.map((input) => input.reviews).sort((a, b) => a - b);
  const index = Math.min(reviews.length - 1, Math.floor(reviews.length * review_reference_percentile));
  return {
    meanRating: established.reduce((sum, input) => sum + input.rating, 0) / established.length,
    referenceReviews: Math.max(reviews[index], minimum_reviews * 2),
  };
}

const clamp = (value) => Math.min(Math.max(value, 0), 1);

// Both parts are scaled to 0..1 over the range restaurants actually occupy,
// so review_volume_weight / rating_weight are the real balance between them:
// - rating: pulled toward the pool average when there are few reviews, then
//   measured from rating_floor (not from zero) up to 5.
// - review volume: log scale from minimum_reviews up to the pool's reference
//   count (a high percentile), where it saturates.
export function scoreCandidate({ rating, reviews, chain }, pool) {
  const {
    rating_weight, review_volume_weight, chain_penalty,
    minimum_reviews, rating_floor, rating_prior_reviews,
  } = config.ranking;
  const count = reviews ?? 0;
  const adjustedRating =
    (count * (rating ?? pool.meanRating) + rating_prior_reviews * pool.meanRating) /
    (count + rating_prior_reviews);
  const ratingPart = clamp((adjustedRating - rating_floor) / (5 - rating_floor));
  const reviewPart = clamp(
    Math.log10(Math.max(count, 1) / minimum_reviews) /
      Math.log10(pool.referenceReviews / minimum_reviews),
  );
  const score = 100 * (ratingPart * rating_weight + reviewPart * review_volume_weight);
  return chain ? score * (1 - chain_penalty) : score;
}

export function sanityFlags({ businessStatus, primaryType, reviews, chain }) {
  const flags = [];
  if (businessStatus && businessStatus !== "OPERATIONAL") flags.push("closed");
  if (!isRestaurantType(primaryType)) flags.push("not_restaurant");
  if ((reviews ?? 0) < config.ranking.minimum_reviews) flags.push("low_reviews");
  if (chain) flags.push("chain");
  return flags;
}

export function distanceMeters(from, to) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// One Nearby Search returns at most 20 places, so each search area is covered
// with seven smaller circles (centre + hexagon ring).
export function searchTiles({ lat, lng, radius }) {
  const ring = (radius * Math.sqrt(3)) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = metersPerDegLat * Math.cos((lat * Math.PI) / 180);
  const tiles = [{ lat, lng }];
  for (let i = 0; i < 6; i++) {
    const angle = (60 * i * Math.PI) / 180;
    tiles.push({
      lat: lat + (ring * Math.sin(angle)) / metersPerDegLat,
      lng: lng + (ring * Math.cos(angle)) / metersPerDegLng,
    });
  }
  return tiles.map((tile) => ({ ...tile, radius: radius * 0.55 }));
}
