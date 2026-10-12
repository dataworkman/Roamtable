// Google Places client. Every call is logged with an estimated cost and
// refused once the month's estimate would pass the configured ceiling.
import { config, logApiCall, monthSpendUsd } from "./db.mjs";

const PLACES_API = "https://places.googleapis.com/v1";
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
// Sent to Google for keys that are restricted by HTTP referrer.
const API_REFERER = process.env.GOOGLE_API_REFERER;

// Thrown when further calls are pointless for now: our own monthly ceiling or
// Google's quota for the project.
export class BudgetError extends Error {}

async function google(endpoint, path, { citySlug, method = "GET", fieldMask, body } = {}) {
  if (!API_KEY) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const cost = config.api.estimated_cost_usd[endpoint];
  const spent = monthSpendUsd();
  if (spent + cost > config.api.monthly_budget_usd) {
    throw new BudgetError(
      `Monthly API budget reached ($${spent.toFixed(2)} of $${config.api.monthly_budget_usd})`,
    );
  }
  const headers = { "X-Goog-Api-Key": API_KEY };
  if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
  if (API_REFERER) headers.Referer = API_REFERER;
  if (body) headers["Content-Type"] = "application/json";
  let ok = false;
  try {
    const response = await fetch(`${PLACES_API}/${path}`, {
      method,
      headers,
      body: body && JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 429) throw new BudgetError(data.error?.message ?? "Google API quota exceeded");
    if (!response.ok) throw new Error(data.error?.message ?? `Google API HTTP ${response.status}`);
    ok = true;
    return data;
  } finally {
    // Failed requests are not billed.
    logApiCall(endpoint, citySlug, ok ? cost : 0, ok);
  }
}

const NEARBY_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.businessStatus",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.addressComponents",
  "places.websiteUri",
  "places.photos",
].join(",");

export async function searchNearby({ lat, lng, radius }, citySlug) {
  const data = await google("nearby_search", "places:searchNearby", {
    citySlug,
    method: "POST",
    fieldMask: NEARBY_FIELD_MASK,
    body: {
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius },
      },
      includedTypes: ["restaurant"],
      maxResultCount: 20,
    },
  });
  return data.places ?? [];
}

// Returns a short-lived image URL on Google's CDN that carries no API key.
export async function photoUri(photoName, width, citySlug) {
  const data = await google(
    "place_photo",
    `${photoName}/media?maxWidthPx=${width}&skipHttpRedirect=true`,
    { citySlug },
  );
  return data.photoUri ?? null;
}
