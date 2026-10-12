// Public site (home + destination pages rendered from SQLite), analytics
// endpoint, photo redirect and the internal admin tool. Page views never
// search Google Places; scripts/refresh.mjs does that in batches.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import {
  ROOT, config, db, logEvent, monthStart, monthSpendUsd, rerankCity, seedCities,
} from "./lib/db.mjs";
import { BudgetError, photoUri } from "./lib/places.mjs";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = join(ROOT, "public");
const TRACKED_EVENTS = new Set(["maps_click", "website_click", "card_click", "unsupported_search"]);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

// Browsers that still hold the old near-me page in cache request its script,
// which no longer exists and leaves the page unstyled. Answer with a one-time
// reload so they pick up the current page.
const LEGACY_SCRIPTS = new Set(["/assets/app.js", "/assets/index-BvunU4SZ.js"]);
const LEGACY_RELOAD_SCRIPT = `try {
  if (!sessionStorage.getItem("bnm-reloaded")) {
    sessionStorage.setItem("bnm-reloaded", "1");
    location.reload();
  }
} catch {}
`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

seedCities();

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// base is the relative path back to the site root ("./", "../", …) so pages
// also work when the site is mounted under a sub-path by a reverse proxy.
function layout({ base, title, description, body, admin = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#2D1206">
<meta name="description" content="${esc(description)}">
${admin ? '<meta name="robots" content="noindex">' : ""}
<link rel="manifest" href="${base}manifest.webmanifest">
<link rel="apple-touch-icon" href="${base}icon-180.png">
<link rel="icon" type="image/svg+xml" href="${base}icon.svg">
<link rel="stylesheet" href="${base}assets/site.css?v=5">
<title>${esc(title)}</title>
</head>
<body data-base="${base}"${admin ? ' class="admin"' : ""}>
<header class="site-header">
  <a class="brand" href="${base}"><img src="${base}icon.svg" alt="" width="28" height="28"><span>Best Near Me</span></a>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <p>Each list is short on purpose. Open a place in Google Maps for hours, photos and directions.</p>
</footer>
<script type="module" src="${base}assets/site.js?v=5"></script>
</body>
</html>`;
}

function publicCities() {
  return db
    .prepare(`
      SELECT c.*, (
        SELECT COUNT(*) FROM restaurants r
        WHERE r.city_id = c.id AND r.rank <= ?
      ) AS listed
      FROM cities c WHERE c.active = 1 ORDER BY c.priority
    `)
    .all(config.selection.top_public);
}

function homePage(base) {
  const cards = publicCities()
    .map(
      (city) => `
    <li class="destination" data-name="${esc(`${city.name} ${city.state}`.toLowerCase())}">
      <a href="${base}best-restaurants/${esc(city.slug)}">
        <span class="destination-name">${esc(city.name)}</span>
        <span class="destination-meta">${esc(city.state)}${city.listed ? "" : " · coming soon"}</span>
      </a>
    </li>`,
    )
    .join("");
  return layout({
    base,
    title: "Best Near Me — the restaurants worth knowing",
    description: "Ten carefully selected restaurants in destinations you may not know well.",
    body: `
<section class="hero">
  <h1>Find the restaurants worth knowing.</h1>
  <p>Ten carefully selected restaurants in destinations you may not know well.</p>
  <input id="destinationSearch" class="search" type="search" placeholder="Search a destination" aria-label="Search a destination" autocomplete="off">
</section>
<section class="destinations">
  <ul id="destinationGrid" class="destination-grid">${cards}</ul>
  <p id="unsupported" class="notice" hidden>We haven’t added this destination yet.</p>
</section>`,
  });
}

function restaurantCard(restaurant, base) {
  const items = JSON.parse(restaurant.recommended_items_json ?? "[]");
  const location = [restaurant.cuisine, restaurant.neighborhood].filter(Boolean).join(" · ");
  return `
  <li class="restaurant" data-id="${restaurant.id}">
    ${restaurant.photo_reference ? `<img class="restaurant-photo" src="${base}api/photo/${restaurant.id}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <div class="restaurant-body">
      <h2><span class="rank">#${restaurant.rank}</span> ${esc(restaurant.name)}</h2>
      ${restaurant.short_description ? `<p class="description">${esc(restaurant.short_description)}</p>` : ""}
      ${items.length ? `<p class="try"><span>Try:</span> ${esc(items.join(", "))}</p>` : ""}
      ${location ? `<p class="location">${esc(location)}</p>` : ""}
      <div class="actions">
        <a class="button primary" data-track="maps_click" href="${esc(restaurant.google_maps_url)}" target="_blank" rel="noopener">View on Google Maps</a>
        ${restaurant.official_website_url ? `<a class="button" data-track="website_click" href="${esc(restaurant.official_website_url)}" target="_blank" rel="noopener">Official Site</a>` : ""}
      </div>
    </div>
  </li>`;
}

function cityPage(slug, base) {
  const city = db.prepare("SELECT * FROM cities WHERE slug = ? AND active = 1").get(slug);
  if (!city) return null;
  const restaurants = db
    .prepare("SELECT * FROM restaurants WHERE city_id = ? AND rank <= ? ORDER BY rank")
    .all(city.id, config.selection.top_public);
  const verified = city.last_refreshed_at
    ? new Date(city.last_refreshed_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;
  const heading = restaurants.length
    ? `${restaurants.length} Restaurants Worth Knowing in ${city.name}`
    : `Restaurants Worth Knowing in ${city.name}`;
  return layout({
    base,
    title: `${heading} — Best Near Me`,
    description: `A short list of restaurants worth knowing in ${city.name}, ${city.state}.`,
    body: `
<section class="city-header" data-city="${esc(city.slug)}">
  <a class="back" href="${base}">← All destinations</a>
  <h1>${esc(heading)}</h1>
  <p>A short list for travelers who don’t want to compare hundreds of reviews.</p>
</section>
${
  restaurants.length
    ? `<ol class="restaurant-list">${restaurants.map((restaurant) => restaurantCard(restaurant, base)).join("")}</ol>
<p class="verified">Last verified ${esc(verified)}</p>`
    : '<p class="notice">We’re still putting this list together.</p>'
}`,
  });
}

// --- Admin (internal) -------------------------------------------------------

function adminHome(base) {
  const spent = monthSpendUsd();
  const calls = db
    .prepare("SELECT endpoint, COUNT(*) AS calls, SUM(estimated_cost_usd) AS cost FROM api_calls WHERE created_at >= ? GROUP BY endpoint")
    .all(monthStart());
  const events = db
    .prepare("SELECT type, COUNT(*) AS count FROM events WHERE created_at >= ? GROUP BY type ORDER BY count DESC")
    .all(monthStart());
  const searches = db
    .prepare("SELECT value, COUNT(*) AS count FROM events WHERE type = 'unsupported_search' GROUP BY value ORDER BY count DESC LIMIT 15")
    .all();
  const cities = db
    .prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM restaurants r WHERE r.city_id = c.id AND r.rank <= ?) AS listed,
        (SELECT COUNT(*) FROM restaurants r WHERE r.city_id = c.id AND r.rank <= ? AND r.short_description IS NOT NULL) AS described,
        (SELECT COUNT(*) FROM events e WHERE e.city_slug = c.slug AND e.type = 'page_view') AS views
      FROM cities c ORDER BY c.priority
    `)
    .all(config.selection.top_public, config.selection.top_public);
  const rows = (list, cells) => list.map((item) => `<tr>${cells(item).map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return layout({
    base,
    admin: true,
    title: "Admin — Best Near Me",
    description: "Internal",
    body: `
<h1>Admin</h1>
<h2>API budget (this month, estimated)</h2>
<p><strong>$${spent.toFixed(2)}</strong> of $${config.api.monthly_budget_usd} ceiling</p>
<table><tr><th>Endpoint</th><th>Calls</th><th>Est. cost</th></tr>
${rows(calls, (c) => [esc(c.endpoint), c.calls, `$${c.cost.toFixed(2)}`])}</table>
<h2>Destinations</h2>
<table><tr><th>Destination</th><th>Listed</th><th>With description</th><th>Page views</th><th>Last refreshed</th></tr>
${rows(cities, (c) => [
  `<a href="${base}admin/city/${esc(c.slug)}">${esc(c.name)}, ${esc(c.state)}</a>`,
  c.listed, c.described, c.views, esc(c.last_refreshed_at?.slice(0, 10) ?? "never"),
])}</table>
<h2>Events (this month)</h2>
<table><tr><th>Type</th><th>Count</th></tr>${rows(events, (e) => [esc(e.type), e.count])}</table>
<h2>Unsupported destination searches</h2>
<table><tr><th>Search</th><th>Count</th></tr>${rows(searches, (s) => [esc(s.value), s.count])}</table>`,
  });
}

function adminCity(slug, base) {
  const city = db.prepare("SELECT * FROM cities WHERE slug = ?").get(slug);
  if (!city) return null;
  const restaurants = db
    .prepare("SELECT * FROM restaurants WHERE city_id = ? AND active = 1 ORDER BY rank IS NULL, rank, internal_score DESC")
    .all(city.id);
  const forms = restaurants
    .map((r) => {
      const flags = JSON.parse(r.flags_json);
      const listed = r.rank && r.rank <= config.selection.top_public;
      return `
<form class="candidate${listed ? " listed" : ""}" method="post" action="${base}admin/restaurant/${r.id}">
  <div class="candidate-head">
    <strong>${r.rank ? `#${r.rank}` : "—"} ${esc(r.name)}</strong>
    <span>score ${r.internal_score.toFixed(1)}${flags.length ? ` · ${esc(flags.join(", "))}` : ""}${r.cuisine ? ` · ${esc(r.cuisine)}` : ""}</span>
    <a href="${esc(r.google_maps_url)}" target="_blank" rel="noopener">Maps</a>
  </div>
  <label>Description (1–2 sentences)<textarea name="short_description" rows="2">${esc(r.short_description)}</textarea></label>
  <label>Recommended items (comma separated)<input name="recommended_items" value="${esc(JSON.parse(r.recommended_items_json ?? "[]").join(", "))}"></label>
  <label>Neighborhood<input name="neighborhood" value="${esc(r.neighborhood)}"></label>
  <label>Official site<input name="official_website_url" value="${esc(r.official_website_url)}"></label>
  <label class="check"><input type="checkbox" name="excluded" value="1"${r.excluded ? " checked" : ""}> Exclude from the list</label>
  <button class="button primary" type="submit">Save</button>
</form>`;
    })
    .join("");
  return layout({
    base,
    admin: true,
    title: `${city.name} — Admin`,
    description: "Internal",
    body: `
<p><a href="${base}admin">← Admin</a> · <a href="${base}best-restaurants/${esc(city.slug)}">Public page</a></p>
<h1>${esc(city.name)}, ${esc(city.state)}</h1>
<p>Top ${config.selection.top_public} are public. Candidates are ordered by rank, then score. Last refreshed ${esc(city.last_refreshed_at?.slice(0, 10) ?? "never")}.</p>
${forms || '<p class="notice">No candidates yet. Run scripts/refresh.mjs for this destination.</p>'}`,
  });
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw new HttpError(413, "Request body too large");
  }
  return raw;
}

async function saveRestaurant(id, req) {
  const restaurant = db.prepare("SELECT r.*, c.slug AS city_slug FROM restaurants r JOIN cities c ON c.id = r.city_id WHERE r.id = ?").get(id);
  if (!restaurant) throw new HttpError(404, "Not found");
  const form = new URLSearchParams(await readBody(req));
  const text = (name) => (form.get(name) ?? "").trim() || null;
  const items = (form.get("recommended_items") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const website = text("official_website_url");
  if (website && !/^https?:\/\//i.test(website)) throw new HttpError(400, "Official site must start with http:// or https://");
  db.prepare(`
    UPDATE restaurants SET short_description = ?, recommended_items_json = ?, neighborhood = ?,
      official_website_url = ?, excluded = ? WHERE id = ?
  `).run(text("short_description"), JSON.stringify(items), text("neighborhood"), website, form.has("excluded") ? 1 : 0, id);
  rerankCity(restaurant.city_id);
  // Relative to /admin/restaurant/<id>, so the redirect survives a path prefix.
  return `../city/${restaurant.city_slug}`;
}

// --- Routing ----------------------------------------------------------------

async function track(req) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  if (!TRACKED_EVENTS.has(body.type)) throw new HttpError(400, "Unknown event");
  logEvent(body.type, {
    citySlug: typeof body.city === "string" ? body.city.slice(0, 80) : null,
    restaurantId: Number.isInteger(body.restaurantId) ? body.restaurantId : null,
    value: typeof body.value === "string" ? body.value.trim().toLowerCase().slice(0, 80) : null,
  });
}

async function photoRedirect(id) {
  const restaurant = db
    .prepare("SELECT r.photo_reference, c.slug FROM restaurants r JOIN cities c ON c.id = r.city_id WHERE r.id = ?")
    .get(id);
  if (!restaurant?.photo_reference) throw new HttpError(404, "No photo");
  try {
    const uri = await photoUri(restaurant.photo_reference, 800, restaurant.slug);
    if (!uri) throw new HttpError(404, "No photo");
    return uri;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(error instanceof BudgetError ? 503 : 502, error.message);
  }
}

async function serveStatic(pathname, res) {
  let relative;
  try {
    relative = normalize(decodeURIComponent(pathname));
  } catch {
    throw new HttpError(400, "Bad path");
  }
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

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(html);
}

function notFoundPage(base) {
  return layout({
    base,
    title: "Not found — Best Near Me",
    description: "Page not found",
    body: `<section class="city-header"><h1>Page not found</h1><p><a href="${base}">See all destinations</a></p></section>`,
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const isRead = req.method === "GET" || req.method === "HEAD";
  const base = "../".repeat(Math.max(path.split("/").length - 2, 0)) || "./";
  let match;
  try {
    if (path.startsWith("/admin")) {
      // Tailscale Serve adds this header for tailnet users and strips it from
      // incoming requests; it is absent on public (Funnel) traffic.
      if (!req.headers["tailscale-user-login"]) throw new HttpError(403, "Admin is only available over the tailnet");
      if (isRead && path === "/admin") return sendHtml(res, adminHome(base));
      if (isRead && (match = path.match(/^\/admin\/city\/([\w-]+)$/))) {
        const html = adminCity(match[1], base);
        if (html) return sendHtml(res, html);
      }
      if (req.method === "POST" && (match = path.match(/^\/admin\/restaurant\/(\d+)$/))) {
        res.writeHead(303, { Location: await saveRestaurant(Number(match[1]), req) });
        return res.end();
      }
      throw new HttpError(404, "Not found");
    }
    if (req.method === "POST" && path === "/api/track") {
      await track(req);
      res.writeHead(204);
      return res.end();
    }
    if (!isRead) throw new HttpError(405, "Method not allowed");
    if (path === "/") return sendHtml(res, homePage(base));
    if ((match = path.match(/^\/best-restaurants\/([\w-]+)\/?$/))) {
      const html = cityPage(match[1], base);
      if (!html) return sendHtml(res, notFoundPage(base), 404);
      if (req.method === "GET") logEvent("page_view", { citySlug: match[1] });
      return sendHtml(res, html);
    }
    if ((match = path.match(/^\/api\/photo\/(\d+)$/))) {
      res.writeHead(302, { Location: await photoRedirect(Number(match[1])), "Cache-Control": "private, max-age=600" });
      return res.end();
    }
    if (LEGACY_SCRIPTS.has(path)) {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(LEGACY_RELOAD_SCRIPT);
    }
    await serveStatic(path, res);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (status === 404 && isRead && !path.startsWith("/api/") && !extname(path)) {
      return sendHtml(res, notFoundPage(base), 404);
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: status === 500 ? "Internal error" : error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`best-near-me listening on http://${HOST}:${PORT}`);
});
