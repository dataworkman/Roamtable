// Google Places is reached through the server (server.mjs), which holds the API key.
const API_BASE = "./api";
const METERS_PER_MILE = 1609.344;
const TOP_COUNT = 10;

const RADII = {
  1: { label: "1 mile", meters: 1 * METERS_PER_MILE },
  3: { label: "3 miles", meters: 3 * METERS_PER_MILE },
  5: { label: "5 miles", meters: 5 * METERS_PER_MILE },
  10: { label: "10 miles", meters: 10 * METERS_PER_MILE },
};

const PRICE_SYMBOLS = { 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// Matched against the start of the place name (see isChain), so "sonic" would
// also catch "Sonic Boom Wings" — use the full brand name where the short one
// is a common word.
const CHAIN_NAMES = [
  // Burgers
  "mcdonald's", "burger king", "wendy's", "five guys", "shake shack", "whataburger",
  "carl's jr", "hardee's", "jack in the box", "culver's", "sonic drive-in", "arby's",
  "steak 'n shake", "in-n-out burger", "white castle", "checkers", "rally's", "krystal",
  "cook out", "freddy's frozen custard", "smashburger", "the habit burger", "red robin",
  "a&w restaurant", "dairy queen",
  // Chicken
  "kfc", "popeyes", "chick-fil-a", "wingstop", "buffalo wild wings", "raising cane's",
  "zaxby's", "bojangles", "church's chicken", "church's texas chicken", "bonchon",
  "bb.q chicken", "kyochon", "el pollo loco", "pollo tropical", "slim chickens",
  "golden chick", "jollibee", "hooters",
  // Pizza
  "pizza hut", "domino's", "papa john's", "little caesars", "papa murphy's",
  "marco's pizza", "blaze pizza", "mod pizza", "cicis", "jet's pizza",
  "hungry howie's", "round table pizza", "sbarro", "california pizza kitchen",
  "stevi b's",
  // Sandwiches
  "subway", "jimmy john's", "jersey mike's", "firehouse subs", "potbelly",
  "mcalister's deli", "jason's deli", "which wich", "schlotzsky's", "charleys",
  "penn station east coast subs", "quiznos", "blimpie",
  // Mexican
  "chipotle", "taco bell", "qdoba", "moe's southwest grill", "del taco",
  "taco cabana", "on the border", "chuy's",
  // Coffee and bakery
  "dunkin'", "starbucks", "panera bread", "tim hortons", "krispy kreme",
  "einstein bros",
  // Casual dining
  "olive garden", "red lobster", "applebee's", "chili's", "tgi fridays", "ihop",
  "denny's", "waffle house", "cracker barrel", "golden corral", "outback steakhouse",
  "longhorn steakhouse", "texas roadhouse", "ruby tuesday", "cheesecake factory",
  "bj's restaurant", "cheddar's scratch kitchen", "carrabba's", "bonefish grill",
  "maggiano's", "buca di beppo", "yard house", "bahama breeze", "first watch",
  "bob evans", "perkins", "huddle house", "dave & buster's", "twin peaks",
  "captain d's", "long john silver's",
  // Asian and bowls
  "panda express", "p.f. chang's", "pei wei", "genghis grill", "noodles & company",
  "benihana", "cava", "sweetgreen",
].map(normalizeName);

const state = {
  basisLabel: "Current Location",
  basisLocation: null,
  radiusKey: "5",
  excludeFranchise: false,
};

const els = {
  header: document.querySelector(".app-header"),
  basisLabel: document.querySelector("#basisLabel"),
  statusPill: document.querySelector("#statusPill"),
  autocompleteMount: document.querySelector("#autocompleteMount"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCount: document.querySelector("#resultCount"),
  resultList: document.querySelector("#resultList"),
  radiusButtons: document.querySelectorAll(".radius-tab"),
  franchiseToggle: document.querySelector("#franchiseToggle"),
  detailsPanel: document.querySelector("#detailsPanel"),
  detailsEmpty: document.querySelector("#detailsEmpty"),
  detailsContent: document.querySelector("#detailsContent"),
  mapsLink: document.querySelector("#mapsLink"),
};

// Search results per location + radius, so toggling chains or returning to a
// radius does not hit the API again.
const placesCache = new Map();
let searchSeq = 0;

async function apiGet(path, params) {
  const response = await fetch(`${API_BASE}/${path}?${new URLSearchParams(params)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function requestCurrentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.basisLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        state.basisLabel = "Current Location";
        els.basisLabel.textContent = state.basisLabel;
        resolve(true);
      },
      () => {
        state.basisLabel = "Set a location to search";
        els.basisLabel.textContent = state.basisLabel;
        resolve(false);
      },
      { timeout: 6000, maximumAge: 60000 },
    );
  });
}

async function init() {
  syncHeaderHeight();
  setupAutocomplete();
  setupRadiusTabs();
  setupFranchiseToggle();
  if (await requestCurrentLocation()) {
    await runSearch();
  } else {
    els.resultList.innerHTML = '<p class="list-empty">Search for a location to get started</p>';
    els.resultCount.textContent = "";
    els.statusPill.textContent = "";
  }
}

// The controls bar sticks right below the header, whatever height it renders at.
function syncHeaderHeight() {
  const apply = () =>
    document.documentElement.style.setProperty("--header-h", `${els.header.offsetHeight}px`);
  apply();
  if (window.ResizeObserver) new ResizeObserver(apply).observe(els.header);
}

function setupAutocomplete() {
  const input = document.createElement("input");
  input.className = "basis-autocomplete";
  input.type = "search";
  input.placeholder = "Search location…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Search for a location");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", "autocompleteList");
  const list = document.createElement("ul");
  list.className = "autocomplete-list";
  list.id = "autocompleteList";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  els.autocompleteMount.append(input, list);

  let suggestions = [];
  let activeIndex = -1;
  let querySeq = 0;
  let debounce;
  // One token per typing session groups the keystrokes and the final lookup
  // into a single billed autocomplete session.
  let session = crypto.randomUUID();

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  };
  const setActive = (index) => {
    activeIndex = index;
    [...list.children].forEach((item, i) => item.classList.toggle("active", i === index));
  };
  const render = () => {
    list.innerHTML = "";
    suggestions.forEach((suggestion, index) => {
      const item = document.createElement("li");
      item.className = "autocomplete-item";
      item.setAttribute("role", "option");
      item.innerHTML = `<span class="autocomplete-main">${escapeHtml(suggestion.main)}</span><span class="autocomplete-secondary">${escapeHtml(suggestion.secondary)}</span>`;
      // mousedown fires before the input loses focus and the list closes.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        select(index);
      });
      list.appendChild(item);
    });
    list.hidden = suggestions.length === 0;
    input.setAttribute("aria-expanded", String(suggestions.length > 0));
    activeIndex = -1;
  };
  const select = async (index) => {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    querySeq++;
    clearTimeout(debounce);
    close();
    input.value = suggestion.main;
    input.blur();
    els.statusPill.textContent = "Loading location";
    try {
      const place = await apiGet("place", { id: suggestion.placeId, session });
      session = crypto.randomUUID();
      if (!place.location) {
        els.statusPill.textContent = "No location data";
        return;
      }
      state.basisLabel = place.name || place.address || "Selected place";
      state.basisLocation = place.location;
      await runSearch();
    } catch (error) {
      console.error(error);
      els.statusPill.textContent = "Could not load location";
    }
  };

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const seq = ++querySeq;
    const q = input.value.trim();
    if (q.length < 2) {
      suggestions = [];
      render();
      return;
    }
    debounce = setTimeout(async () => {
      try {
        const params = { q, session };
        if (state.basisLocation) Object.assign(params, state.basisLocation);
        const data = await apiGet("autocomplete", params);
        if (seq !== querySeq) return;
        suggestions = data.suggestions;
        render();
      } catch (error) {
        console.error(error);
      }
    }, 250);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!list.hidden) select(Math.max(activeIndex, 0));
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !list.hidden) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + suggestions.length) % suggestions.length);
    }
  });
  input.addEventListener("blur", close);
  input.addEventListener("focus", () => {
    if (suggestions.length) render();
  });
}

function setupRadiusTabs() {
  els.radiusButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.radiusKey = button.dataset.radiusKey;
      els.radiusButtons.forEach((other) => other.classList.toggle("active", other === button));
      runSearch();
    });
  });
}

function setupFranchiseToggle() {
  els.franchiseToggle.addEventListener("click", () => {
    state.excludeFranchise = !state.excludeFranchise;
    els.franchiseToggle.classList.toggle("active", state.excludeFranchise);
    els.franchiseToggle.textContent = state.excludeFranchise ? "Chains: Off" : "Chains: On";
    runSearch();
  });
}

async function runSearch() {
  if (!state.basisLocation) return;
  const seq = ++searchSeq;
  const radius = RADII[state.radiusKey];
  els.basisLabel.textContent = state.basisLabel;
  els.resultTitle.textContent = `Top ${TOP_COUNT} Restaurants within ${radius.label}`;
  els.resultCount.textContent = "Searching…";
  els.statusPill.textContent = "Searching";
  els.detailsEmpty.hidden = false;
  els.detailsContent.hidden = true;
  els.detailsContent.innerHTML = "";
  els.mapsLink.href = "#";
  els.mapsLink.setAttribute("aria-disabled", "true");
  els.resultList.innerHTML = '<p class="list-loading">Searching…</p>';
  try {
    const places = await loadPlaces(state.basisLocation, radius.meters);
    if (seq !== searchSeq) return;
    const candidates = state.excludeFranchise
      ? places.filter((place) => !isChain(place.displayName?.text))
      : places;
    const ranked = candidates
      .map((place) => ({ place, score: scorePlace(place) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_COUNT);
    renderResults(ranked);
    const excluded = state.excludeFranchise
      ? ` (chains excluded: ${places.length - candidates.length})`
      : "";
    els.resultCount.textContent = `Top ${ranked.length} of ${candidates.length} nearby${excluded}`;
    els.statusPill.textContent = "Done";
  } catch (error) {
    if (seq !== searchSeq) return;
    console.error(error);
    els.resultList.innerHTML = "";
    els.resultList.appendChild(errorBox(`Search failed: ${error.message}`));
    els.resultCount.textContent = "Error";
    els.statusPill.textContent = "Search error";
  }
}

// One Nearby Search returns at most 20 places, so the area is covered with
// seven smaller circles (centre + hexagon ring) and the results are merged.
async function loadPlaces(location, radiusMeters) {
  const cacheKey = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}|${radiusMeters}`;
  const cached = placesCache.get(cacheKey);
  if (cached) return cached;

  const tileRadius = radiusMeters * 0.55;
  const settled = await Promise.allSettled(
    searchCenters(location, radiusMeters).map((center) => fetchNearby(center, tileRadius)),
  );
  const fulfilled = settled.filter((result) => result.status === "fulfilled");
  if (fulfilled.length === 0) throw settled[0].reason;

  const byId = new Map();
  for (const { value } of fulfilled) {
    for (const place of value) {
      if (!place.id || !place.location) continue;
      if (distanceMeters(location, toLatLng(place.location)) > radiusMeters) continue;
      byId.set(place.id, place);
    }
  }
  const places = [...byId.values()];
  // A partial result is shown but not cached, so the next search retries.
  if (fulfilled.length === settled.length) placesCache.set(cacheKey, places);
  return places;
}

function searchCenters(center, radiusMeters) {
  const ringMeters = (radiusMeters * Math.sqrt(3)) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLng = metersPerDegLat * Math.cos(toRadians(center.lat));
  const centers = [center];
  for (let i = 0; i < 6; i++) {
    const angle = toRadians(60 * i);
    centers.push({
      lat: center.lat + (ringMeters * Math.sin(angle)) / metersPerDegLat,
      lng: center.lng + (ringMeters * Math.cos(angle)) / metersPerDegLng,
    });
  }
  return centers;
}

async function fetchNearby(center, radiusMeters) {
  const response = await fetch(`${API_BASE}/nearby`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: center.lat, lng: center.lng, radius: radiusMeters }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.places ?? [];
}

function scorePlace(place) {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  const ratingPart = rating / 5;
  const reviewPart = Math.min(Math.log10(reviews + 1) / Math.log10(50000), 1);
  return ratingPart * 40 + reviewPart * 60;
}

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

function isChain(name) {
  if (!name) return false;
  const normalized = normalizeName(name);
  return CHAIN_NAMES.some(
    (chain) => normalized === chain || normalized.startsWith(`${chain} `),
  );
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toLatLng(location) {
  return { lat: location.latitude, lng: location.longitude };
}

function distanceMeters(from, to) {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `${Math.max(10, Math.round((meters * 3.28084) / 10) * 10)} ft`;
  return `${miles.toFixed(1)} mi`;
}

function photoUrl(place, maxWidthPx = 400) {
  if (!place.photos?.length) return null;
  return `${API_BASE}/photo?${new URLSearchParams({ name: place.photos[0].name, w: maxWidthPx })}`;
}

function ratingHtml(place) {
  if (place.rating == null) return "";
  const reviews = (place.userRatingCount ?? 0).toLocaleString();
  return `<span class="card-rating">★ ${place.rating.toFixed(1)} <span class="card-reviews">(${reviews})</span></span>`;
}

function priceHtml(place) {
  const level = PRICE_LEVELS[place.priceLevel];
  return level != null ? `<span class="card-price">${PRICE_SYMBOLS[level] ?? ""}</span>` : "";
}

function renderResults(ranked) {
  els.resultList.innerHTML = "";
  if (ranked.length === 0) {
    els.resultList.innerHTML = '<p class="list-empty">No restaurants found in this area</p>';
    return;
  }
  ranked.forEach(({ place, score }, index) => {
    els.resultList.appendChild(createCard(place, score, index + 1));
  });
}

function createCard(place, score, rank) {
  const distance = distanceMeters(state.basisLocation, toLatLng(place.location));
  const openNow = place.currentOpeningHours?.openNow;
  const photo = photoUrl(place, 400);
  const name = place.displayName?.text ?? "Unknown";

  const card = document.createElement("div");
  card.className = "place-card";
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");

  const openHtml =
    openNow === true
      ? '<span class="card-open">Open</span>'
      : openNow === false
        ? '<span class="card-closed">Closed</span>'
        : "";
  const photoHtml = photo
    ? `<img class="card-photo" src="${escapeAttr(photo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-photo card-photo--placeholder'}))" />`
    : '<div class="card-photo card-photo--placeholder"></div>';

  card.innerHTML = `
    <div class="card-thumb">
      ${photoHtml}
      <div class="card-rank">${rank}</div>
    </div>
    <div class="card-body">
      <div class="card-name">${escapeHtml(name)}</div>
      <div class="card-meta">${ratingHtml(place)}${priceHtml(place)}<span class="card-distance">${formatDistance(distance)}</span>${openHtml}</div>
      <div class="card-address">${escapeHtml(place.formattedAddress ?? "")}</div>
    </div>
    <div class="card-score" title="Score: reviews 60% + rating 40%">${score.toFixed(0)}</div>
  `;
  card.addEventListener("click", () => {
    document
      .querySelectorAll(".place-card.selected")
      .forEach((selected) => selected.classList.remove("selected"));
    card.classList.add("selected");
    showDetails(place);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.click();
    }
  });
  return card;
}

function showDetails(place) {
  const openNow = place.currentOpeningHours?.openNow;
  const photo = photoUrl(place, 800);
  const hours = place.regularOpeningHours?.weekdayDescriptions ?? [];
  const name = place.displayName?.text ?? "";
  const openHtml =
    openNow === true
      ? '<span class="card-open">Open now</span>'
      : openNow === false
        ? '<span class="card-closed">Closed</span>'
        : "";

  els.detailsContent.innerHTML = `
    ${photo ? `<img class="detail-photo" src="${escapeAttr(photo)}" alt="" />` : ""}
    <div class="detail-body">
      <div class="detail-name">${escapeHtml(name)}</div>
      <div class="detail-meta">
        ${ratingHtml(place)}
        ${priceHtml(place)}
        ${openHtml}
      </div>
      ${place.formattedAddress ? `<p class="detail-row">📍 ${escapeHtml(place.formattedAddress)}</p>` : ""}
      ${place.nationalPhoneNumber ? `<p class="detail-row"><a class="detail-link" href="tel:${escapeAttr(place.nationalPhoneNumber)}">${escapeHtml(place.nationalPhoneNumber)}</a></p>` : ""}
      ${hours.length ? `<div class="detail-hours">${hours.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>` : ""}
    </div>
  `;
  els.detailsEmpty.hidden = true;
  els.detailsContent.hidden = false;
  if (place.id) {
    els.mapsLink.href = `https://www.google.com/maps/search/?api=1&query=restaurant&query_place_id=${encodeURIComponent(place.id)}`;
    els.mapsLink.setAttribute("aria-disabled", "false");
  }
  els.detailsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text) {
  return text.replace(/"/g, "&quot;");
}

function errorBox(message) {
  const box = document.createElement("div");
  box.className = "error-box";
  box.textContent = message;
  return box;
}

init();
