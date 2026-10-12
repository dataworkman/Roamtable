# Best Nearby Restaurant Finder — PRD v2
## Curated Top 10 City Database MVP

## 1. Product Goal

Build a very simple restaurant discovery service that answers one question:

> **“I’m in an unfamiliar city. Where are the 10 restaurants I should seriously consider?”**

The product should not feel like Google Maps, Yelp, or TripAdvisor.

It should not ask the user to sort through hundreds of restaurants, filters, ratings, review counts, or sponsored listings.

The product should make the decision easier by showing a **small, curated Top 10 list** for each supported city.

---

## 2. Core Product Principle

### Keep it extremely simple.

The user should see only what helps them choose quickly.

The public-facing experience should not expose the internal ranking machinery.

### User sees:
- Restaurant name
- One representative photo
- One short description
- Recommended food / what the restaurant is known for
- Neighborhood or general location
- Link to Google Maps
- Optional link to official restaurant website

### User does NOT need to see:
- Google review count
- Google rating
- Raw ranking score
- Detailed scoring formula
- Long review excerpts
- Complex filters
- Large maps
- Dozens of result pages

The ranking data exists to help us choose restaurants, not to make the user analyze the data again.

---

## 3. Initial Market Scope

Start with the United States only.

Do **not** begin with the largest, most obvious restaurant cities such as New York City, Los Angeles, Chicago, Las Vegas, Miami, Orlando, San Francisco, Washington DC, Boston, and Honolulu.

Reason: these destinations already have overwhelming restaurant coverage and users are more likely to know major restaurants or easily find many strong guides.

The MVP should focus on destinations where a traveler is more likely to think:

> “I’ve never been here. Where should I eat?”

---

## 4. Initial 20 Target Destinations

1. Charleston, SC
2. Savannah, GA
3. Santa Fe, NM
4. St. Augustine, FL
5. Asheville, NC
6. Sedona, AZ
7. Key West, FL
8. Napa, CA
9. Gatlinburg / Pigeon Forge, TN
10. Alexandria, VA
11. Greenville, SC
12. Monterey / Carmel, CA
13. Santa Barbara, CA
14. Newport, RI
15. Portland, ME
16. Sarasota, FL
17. Naples, FL
18. Park City, UT
19. Taos, NM
20. Healdsburg, CA

Target:

> **20 destinations × 10 restaurants = approximately 200 restaurant records**

Do not expand beyond this until the MVP proves useful.

---

## 5. Ranking Strategy

The restaurant list should be created using a scoring model based primarily on large-scale public restaurant signals.

If the existing weighting from the prior prototype is available, preserve it.

If not, start with a simple configurable formula such as:

```text
Restaurant Score =
Review Volume Component
+
Rating Component
+
Optional Quality Adjustments
```

Possible starting point:

```text
Review Volume Weight: 60%
Rating Weight: 40%
```

This is only a starting point and must remain configurable.

Do not rank by review count alone.
Do not rank by star rating alone.

The score should reward both:
- strong rating
- strong evidence / review volume

---

## 6. Chain Restaurant Handling

Large chains may receive disproportionately strong visibility because of brand awareness and review volume.

The MVP should support an optional chain penalty.

Possible rule:

```text
Independent / local restaurant = no penalty
Small regional group = small or no penalty
Large national chain = ranking penalty
```

Do not automatically exclude every chain.

The goal is to avoid a Top 10 list dominated by obvious national brands when better local destinations exist.

---

## 7. Data Acquisition Strategy

Google Places may be used as an **internal research and ranking input**.

The user-facing product should not depend on a live Google Places request every time someone opens the page.

Preferred model:

```text
Scheduled batch research
        ↓
Candidate restaurants
        ↓
Ranking calculation
        ↓
Human / automated sanity check
        ↓
Top 10 selection
        ↓
Internal database
        ↓
User-facing static/mostly-static result
```

This prevents API usage from scaling directly with page views.

---

## 8. Update Frequency

Real-time updates are unnecessary.

Recommended starting schedule:
- monthly refresh, or
- twice per month

Refresh should check:
- restaurant still open
- major rating/review changes
- new high-performing restaurant
- restaurant permanently closed
- ranking movement significant enough to change Top 10

---

## 9. API Cost Control

The system must have a monthly API budget.

Requirements:
- API calls logged
- estimated monthly usage visible
- configurable monthly ceiling
- no unnecessary per-user Places API calls
- reuse batch discovery results whenever possible

The service should remain usable even when no external API calls are being made.

---

## 10. Google Data Storage Warning

Do not assume that all Google Places fields can be permanently stored in our own database.

Before production:
- verify current Google Maps Platform storage/caching terms
- do not permanently retain raw Google rating/review-count/photo data unless permitted
- prefer storing stable identifiers such as Place ID where allowed
- store our own derived ranking, editorial description, selected status, and internal metadata only where legally permitted
- treat Google-sourced attributes as refreshable source data rather than owned content

---

## 11. Public Restaurant Record

Suggested model:

```text
id
city_id
restaurant_name
slug
place_id
rank
internal_score
category
cuisine
neighborhood
short_description
recommended_items
photo_source
photo_reference
google_maps_url
official_website_url
last_verified_at
active
```

Google rating and review count may be used during ranking calculations, but should not automatically be treated as permanent public fields.

---

## 12. Restaurant Card

Each restaurant card should be simple.

### Display

**#1 Restaurant Name**

Representative photo

One sentence:
> “Modern Southern cooking known for seasonal seafood and locally sourced ingredients.”

Recommended:
> “Try: shrimp & grits, local oysters”

Location:
> “Historic District”

Buttons:
- View on Google Maps
- Official Site

That is enough.

---

## 13. Photography

Photos must not be copied from random websites.

Preferred MVP approach:
- use Google Places photo display only through an approved Google Maps Platform method
- comply with required attribution
- do not download and permanently rehost Google user photos unless explicitly permitted
- show only one strong representative image per restaurant

If Google photo terms make this cumbersome, alternatives are:
- restaurant-provided official images
- licensed images
- user-submitted images with permission

---

## 14. Short Description

Each restaurant needs a concise editorial description.

Length target:
> **1–2 sentences**

Example:
> “A polished Lowcountry restaurant focused on local seafood and seasonal Southern dishes. Best suited for a nicer dinner rather than a quick casual meal.”

Avoid generic AI language such as:
> “This amazing restaurant offers delicious food in a wonderful atmosphere.”

---

## 15. Recommended Food

Each restaurant should include approximately 2–4 notable dishes or food categories.

Examples:
```text
Shrimp & grits
Oysters
Wood-fired pizza
Dry-aged steak
Handmade pasta
```

The goal is to answer:
> “If I go there, what is it known for?”

---

## 16. Source Strategy for Descriptions and Menu Recommendations

Descriptions and recommendations may be synthesized from multiple reliable sources:

- restaurant official website
- official menu
- Google listing information
- Yelp
- TripAdvisor
- reputable local food publications

Do not copy review text verbatim.
Do not copy proprietary editorial descriptions.

Generate an original concise summary based on facts.

---

## 17. City Page

Example:
```text
/best-restaurants/charleston-sc
```

### Header

**10 Restaurants Worth Knowing in Charleston**

Subheading:
> “A short list for travelers who don’t want to compare hundreds of reviews.”

### Restaurant list

#1 through #10.

No pagination.
No 200-result search page.
No complex map required for MVP.

---

## 18. Home Page

### Hero

**Find the restaurants worth knowing.**

Subtext:
> “Ten carefully selected restaurants in destinations you may not know well.”

### Destination grid

Show the 20 supported destinations.

---

## 19. Search

User can search supported destination names.

If unsupported:
> “We haven’t added this destination yet.”

Do not dynamically call Google Places to generate a live answer for unsupported cities during MVP.

---

## 20. No Personalization in MVP

Do not add:
- account creation
- favorites
- itinerary builder
- AI chatbot
- personal food preferences
- dietary recommendation engine
- social sharing system
- reservation engine
- user reviews

The core product is the curated list.

---

## 21. Admin / Dataset Build Tool

A small internal admin tool may be useful.

For each destination:
1. fetch restaurant candidates
2. calculate ranking score
3. display Top 20 candidates internally
4. inspect obvious chain/problem results
5. approve final Top 10
6. generate/update restaurant records
7. mark verification date

The public user should never see this complexity.

---

## 22. Ranking Sanity Check

Before a restaurant becomes public Top 10, check:

- Is it actually located in or appropriately near the destination?
- Is it currently open?
- Is it primarily a restaurant?
- Is it a national chain dominating because of review volume?
- Is its ranking obviously distorted?
- Does it have enough evidence to justify Top 10?

For the first 200 restaurants, manual review is acceptable.

---

## 23. Database Recommendation

MVP:
- SQLite is sufficient for 200 records.

If the service expands substantially:
- PostgreSQL

If later adding true radius / geospatial search:
- PostgreSQL + PostGIS

Do not introduce PostGIS before it is needed.

---

## 24. Suggested Tables

### cities
```text
id
name
state
slug
latitude
longitude
priority
active
last_refreshed_at
```

### restaurants
```text
id
city_id
name
slug
place_id
rank
internal_score
cuisine
category
neighborhood
short_description
recommended_items_json
photo_reference
google_maps_url
official_website_url
last_verified_at
active
```

### ranking_snapshots
```text
id
restaurant_id
rating_input
review_volume_input
derived_score
rank
captured_at
```

Important:
Raw Google-derived fields should only be retained if current platform terms allow that specific storage pattern.

---

## 25. Ranking Configuration

Keep ranking settings configurable rather than hard-coded.

Example:

```json
{
  "review_volume_weight": 0.60,
  "rating_weight": 0.40,
  "chain_penalty": 0.10,
  "minimum_reviews": 100
}
```

---

## 26. Design Principles

The site should feel:
- fast
- clean
- quiet
- trustworthy
- curated

Avoid:
- clutter
- multiple ranking badges
- huge review counts
- endless filters
- popups
- dense maps
- excessive text
- generic AI copy

Core philosophy:

> **The user came for an answer, not another search engine.**

---

## 27. Performance

Because most content is relatively static:
- city pages should be cached
- restaurant descriptions should be pre-generated
- ranking should be calculated offline
- images should be optimized
- pages should load quickly on mobile

External API latency should not control normal page load speed.

---

## 28. Monetization — Not MVP Priority

Possible later monetization:
- display ads
- affiliate reservation links
- premium travel guides
- restaurant promotion with strict separation from organic rankings

Do not add paid placement into the ranking during MVP.

---

## 29. MVP Success Questions

1. Do travelers find a Top 10 list more useful than browsing Google/Yelp themselves?
2. Do users click through to Maps?
3. Do users spend less time deciding?
4. Do users return when visiting another destination?
5. Are the selected restaurants genuinely perceived as strong choices?
6. Can the database stay useful with monthly or twice-monthly refreshes?
7. Can API costs remain within the planned monthly budget?

---

## 30. Analytics

Track:
- destination page views
- restaurant card click rate
- Google Maps outbound click rate
- official website click rate
- search for unsupported destination
- repeat visitor rate

Unsupported destination searches are especially valuable because they tell us which cities to add next.

---

## 31. Expansion Rule

Do not jump from 20 cities to 100 cities automatically.

Expand based on actual demand.

---

## 32. MVP Build Order

### Phase 1
Database schema and 20 destination records.

### Phase 2
Build internal ranking pipeline for one test city.

### Phase 3
Validate ranking quality manually.

### Phase 4
Populate Top 10 for 5 cities.

### Phase 5
Build public home page and city page.

### Phase 6
Add representative photo, short description, recommended dishes, Maps link.

### Phase 7
Expand to all 20 destinations.

### Phase 8
Add scheduled refresh process.

### Phase 9
Add API budget tracking.

### Phase 10
Release and measure behavior.

---

## 33. MVP Completion Criteria

MVP is complete when:

- 20 destination pages exist
- each destination has 10 restaurants
- about 200 restaurant records exist
- each restaurant has a rank
- each restaurant has one short description
- each restaurant has recommended food
- each restaurant has a representative image strategy
- each restaurant links to Google Maps
- unsupported destination search is handled cleanly
- ranking calculations run independently of public page views
- normal page loads do not require a new Places API request
- API usage is measurable
- monthly API budget can be controlled
- restaurant data has a last-verified date
- the site remains visually simple

---

## 34. Critical Risks

### Risk 1 — Google data licensing / storage
The business cannot assume that paid API access means unrestricted ownership of Google Places data.

Mitigation:
Design around current platform terms and avoid permanent storage of restricted raw attributes.

### Risk 2 — Bad ranking
A mathematically neat score can still produce obviously bad restaurant recommendations.

Mitigation:
Manual sanity review for the first 200 restaurants.

### Risk 3 — Stale restaurants
Restaurants can close or decline.

Mitigation:
Periodic batch verification plus user feedback later.

### Risk 4 — Generic AI descriptions
Weak summaries will make the site feel cheap.

Mitigation:
Use factual, specific, short descriptions based on official/menu/reputable sources.

### Risk 5 — Too much functionality
Adding maps, accounts, filters, reviews, recommendations, and personalization would turn the product back into the complexity it is trying to avoid.

Mitigation:
Protect the Top 10-only concept.

---

# Final Product Principle

> **Don’t build another restaurant search engine.**
>
> **Build the shortest path from “I don’t know this city” to “these are the 10 places I should consider.”**
