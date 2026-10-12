// Serves the static app from ./public and proxies Google Places requests so
// the API key stays on the server (read from the environment, see .env).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
// Sent to Google for keys that are restricted by HTTP referrer.
const API_REFERER = process.env.GOOGLE_API_REFERER;
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PLACES_API = "https://places.googleapis.com/v1";
const MAX_RADIUS_METERS = 50000;

if (!API_KEY) {
  console.error("GOOGLE_MAPS_API_KEY is not set");
  process.exit(1);
}

const NEARBY_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.currentOpeningHours",
  "places.location",
  "places.priceLevel",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.photos",
].join(",");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function google(path, { method = "GET", fieldMask, body } = {}) {
  const headers = { "X-Goog-Api-Key": API_KEY };
  if (fieldMask) headers["X-Goog-FieldMask"] = fieldMask;
  if (API_REFERER) headers.Referer = API_REFERER;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${PLACES_API}/${path}`, {
    method,
    headers,
    body: body && JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, data.error?.message ?? `Google API HTTP ${response.status}`);
  }
  return data;
}

function coordinate(value, limit, name) {
  const number = Number(value);
  if (value == null || value === "" || !Number.isFinite(number) || Math.abs(number) > limit) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return number;
}

function sessionToken(value) {
  return /^[\w-]{1,36}$/.test(value ?? "") ? value : undefined;
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new HttpError(413, "Request body too large");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

const routes = {
  "POST /api/nearby": async (req) => {
    const body = await readJson(req);
    const radius = Number(body.radius);
    if (!(radius > 0 && radius <= MAX_RADIUS_METERS)) throw new HttpError(400, "Invalid radius");
    const data = await google("places:searchNearby", {
      method: "POST",
      fieldMask: NEARBY_FIELD_MASK,
      body: {
        locationRestriction: {
          circle: {
            center: {
              latitude: coordinate(body.lat, 90, "lat"),
              longitude: coordinate(body.lng, 180, "lng"),
            },
            radius,
          },
        },
        includedTypes: ["restaurant", "bar"],
        maxResultCount: 20,
      },
    });
    // Only the first photo's name is used by the client.
    const places = (data.places ?? []).map((place) => ({
      ...place,
      photos: place.photos?.slice(0, 1).map((photo) => ({ name: photo.name })),
    }));
    return { json: { places } };
  },

  "GET /api/autocomplete": async (req, query) => {
    const input = (query.get("q") ?? "").trim().slice(0, 200);
    if (input.length < 2) return { json: { suggestions: [] } };
    const body = { input, sessionToken: sessionToken(query.get("session")) };
    if (query.has("lat") && query.has("lng")) {
      body.locationBias = {
        circle: {
          center: {
            latitude: coordinate(query.get("lat"), 90, "lat"),
            longitude: coordinate(query.get("lng"), 180, "lng"),
          },
          radius: 8000,
        },
      };
    }
    const data = await google("places:autocomplete", { method: "POST", body });
    const suggestions = (data.suggestions ?? [])
      .map((suggestion) => suggestion.placePrediction)
      .filter(Boolean)
      .map((prediction) => ({
        placeId: prediction.placeId,
        main: prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "",
        secondary: prediction.structuredFormat?.secondaryText?.text ?? "",
      }));
    return { json: { suggestions } };
  },

  "GET /api/place": async (req, query) => {
    const id = query.get("id") ?? "";
    if (!/^[\w-]{1,300}$/.test(id)) throw new HttpError(400, "Invalid place id");
    const token = sessionToken(query.get("session"));
    const data = await google(`places/${id}${token ? `?sessionToken=${token}` : ""}`, {
      fieldMask: "id,displayName,formattedAddress,location",
    });
    return {
      json: {
        name: data.displayName?.text ?? "",
        address: data.formattedAddress ?? "",
        location: data.location
          ? { lat: data.location.latitude, lng: data.location.longitude }
          : null,
      },
    };
  },

  // Redirects to the image on Google's CDN; that URL carries no API key.
  "GET /api/photo": async (req, query) => {
    const name = query.get("name") ?? "";
    if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(name)) throw new HttpError(400, "Invalid photo");
    const width = Math.min(Math.max(Math.round(Number(query.get("w")) || 400), 50), 1600);
    const data = await google(`${name}/media?maxWidthPx=${width}&skipHttpRedirect=true`);
    if (!data.photoUri) throw new HttpError(404, "Photo not found");
    return { redirect: data.photoUri };
  },
};

async function serveStatic(pathname, res) {
  let relative;
  try {
    relative = normalize(decodeURIComponent(pathname));
  } catch {
    throw new HttpError(400, "Bad path");
  }
  if (relative.endsWith(sep)) relative = join(relative, "index.html");
  const filePath = join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + sep)) throw new HttpError(403, "Forbidden");
  let content;
  try {
    content = await readFile(filePath);
  } catch {
    throw new HttpError(404, "Not found");
  }
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(content);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) {
      const result = await route(req, url.searchParams);
      if (result.redirect) {
        res.writeHead(302, { Location: result.redirect, "Cache-Control": "private, max-age=600" });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(result.json));
      }
    } else if (url.pathname.startsWith("/api/")) {
      throw new HttpError(404, "Not found");
    } else if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(url.pathname, res);
    } else {
      throw new HttpError(405, "Method not allowed");
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: status === 500 ? "Internal error" : error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`best-near-me listening on http://${HOST}:${PORT}`);
});
