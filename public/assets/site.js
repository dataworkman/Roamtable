const city = document.querySelector("[data-city]")?.dataset.city ?? null;
// Relative path back to the site root, set by the server for the current page.
const trackUrl = `${document.body.dataset.base ?? "/"}api/track`;

function track(type, detail = {}) {
  const body = JSON.stringify({ type, city, ...detail });
  // sendBeacon survives the navigation that follows an outbound click.
  if (!navigator.sendBeacon?.(trackUrl, new Blob([body], { type: "application/json" }))) {
    fetch(trackUrl, { method: "POST", body, keepalive: true }).catch(() => {});
  }
}

document.addEventListener("click", (event) => {
  const card = event.target.closest(".restaurant");
  if (!card) return;
  const link = event.target.closest("[data-track]");
  track(link ? link.dataset.track : "card_click", { restaurantId: Number(card.dataset.id) });
});

const search = document.querySelector("#destinationSearch");
if (search) {
  const destinations = [...document.querySelectorAll(".destination")];
  const unsupported = document.querySelector("#unsupported");
  const reported = new Set();
  let reportTimer;

  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    let matches = 0;
    for (const destination of destinations) {
      const match = destination.dataset.name.includes(query);
      destination.hidden = !match;
      if (match) matches++;
    }
    unsupported.hidden = matches > 0;

    // Unsupported searches tell us which destinations to add next; wait until
    // typing settles so partial words are not recorded.
    clearTimeout(reportTimer);
    if (matches === 0 && query.length >= 3 && !reported.has(query)) {
      reportTimer = setTimeout(() => {
        reported.add(query);
        track("unsupported_search", { value: query });
      }, 1500);
    }
  });
}
