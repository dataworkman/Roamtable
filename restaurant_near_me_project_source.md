# Restaurant Near Me Project — Source of Truth
## Consolidated Project Context / History / Decisions

This document consolidates the prior discussions and decisions for the restaurant finder project so it can be used as project context for future development.

---

# 1. Original Problem

The project started from a very simple personal frustration:

> When traveling or visiting an unfamiliar area, finding a genuinely good restaurant takes too much time.

Typical current behavior:

1. Open Google Maps or Yelp.
2. Search “restaurants near me.”
3. Sort through many listings.
4. Compare ratings.
5. Compare review counts.
6. Open individual restaurant pages.
7. Read reviews.
8. Try to decide whether a restaurant is actually good.
9. Repeat until finally choosing somewhere.

The product goal is to remove that decision friction.

The product is not intended to be another restaurant search engine.

The product should answer:

> **“Where should I actually eat?”**

---

# 2. Core Product Philosophy

The service should be:

- extremely simple
- fast
- decision-oriented
- low-friction
- visually clean
- useful within seconds
- not overloaded with filters
- not another Google/Yelp clone

Core principle:

> **The user came for an answer, not another search engine.**

The service should do the difficult filtering internally and only show a small number of strong choices.

---

# 3. Original “Best Nearby Restaurant” Concept

The first concept was location-based.

User flow:

1. Open the app/site.
2. Use current location.
3. Choose a radius.
4. Immediately see the best nearby restaurants.

Initial radius ideas:

- 1 mile
- 3 miles
- 5 miles
- 10 miles

The main value proposition was:

> **“Best restaurants near me without manually comparing hundreds of listings.”**

The user explicitly preferred a decision site rather than a discovery/search interface.

---

# 4. Google Places UI Kit Prototype

A prototype was previously built to test whether Google’s own ranking could be sufficient.

Prototype configuration:

- Test location: H Mart Johns Creek
- Restaurant type only
- Radius options:
  - 1 mile
  - 3 miles
  - 5 miles
- Display up to 10 results
- Google Places UI Kit
- `rankPreference = POPULARITY`
- No custom ranking
- No backend
- No database
- Mobile-first

Purpose:

> Test whether Google POPULARITY alone produces a sufficiently good “best restaurant” list.

---

# 5. Google POPULARITY Test Result

The prototype worked technically and the result quality was “not bad,” but Google POPULARITY was not considered strong enough to define “best restaurant.”

Important observations:

- POPULARITY is not simply rating descending.
- POPULARITY is not simply review-count descending.
- Google uses opaque internal prominence/popularity signals.
- Chains and well-known brands may rank unusually high.
- The result is closer to “popular/prominent nearby restaurants” than “best restaurants.”

Conclusion:

> Google POPULARITY can be useful as a signal, but should not be the final ranking logic.

The project therefore moved toward a custom ranking system.

---

# 6. Custom Ranking Concept

The preferred logic combines:

- rating
- review volume
- optional chain penalty
- optional quality adjustments

A prior remembered weighting was approximately:

```text
Review Volume Weight: 60%
Rating Weight: 40%
```

This weighting is not considered permanently fixed.

It should remain configurable.

Reasoning:

A rating alone is weak.

Example:

```text
5.0 stars / 35 reviews
```

should not automatically rank above:

```text
4.7 stars / 8,000 reviews
```

Likewise, review volume alone is weak.

A huge chain with enormous review volume and mediocre quality should not automatically become #1.

Therefore the score should combine:

- strength of rating
- strength of evidence
- optional chain correction

---

# 7. Chain Restaurant Problem

Google prominence/popularity may over-favor:

- major chains
- internationally known brands
- high-traffic locations

The product should support an optional chain penalty.

Possible logic:

```text
Independent restaurant = no penalty

Small regional group = little or no penalty

Large national chain = ranking penalty
```

Do not automatically ban every chain.

The goal is simply to prevent obvious national chains from dominating local Top 10 lists because of brand scale.

---

# 8. API Cost Problem

The original live “near me” concept had a major weakness:

> Every user interaction could trigger paid Places API requests.

A single user may change radius repeatedly:

```text
1 mile
2 miles
3 miles
5 miles
10 miles
```

That can create multiple queries per session.

At scale, API usage could become the largest operating cost.

This was one of the main reasons the original live-search version was deprioritized.

Important:

Exact Google Places pricing has changed over time and must be rechecked against current official Google Maps Platform pricing before production.

Do not rely on old quoted API prices without re-verification.

---

# 9. Caching / Google Data Limitation

An early idea was:

> Call Google once, then permanently cache the restaurant data.

The problem is that paid API access does not necessarily mean unrestricted ownership or permanent storage rights for all Google Places fields.

The project should assume:

- Google data has platform terms
- raw Google fields may have storage restrictions
- Google user photos should not be downloaded and permanently rehosted unless permitted
- Place IDs are generally more reusable than full raw listing data
- current terms must be checked before production

Design principle:

> Google should be treated as a source/refresh layer, not automatically as data we own permanently.

---

# 10. Alternative Data Sources Previously Considered

Several alternatives were discussed.

## Geoapify

Potential strengths:

- relatively inexpensive / free tier
- open-data-friendly
- useful POI coverage

Weakness:

- weak restaurant rating/review signals
- not sufficient by itself for “best restaurant” ranking

## Foursquare

Potential strengths:

- place data
- popularity signals

Weakness:

- pricing and usage restrictions
- must verify current caching/commercial terms

## TripAdvisor

Potential strengths:

- strong travel/restaurant relevance
- recognizable travel ranking signal

Weakness:

- API availability and current pricing/terms need verification
- not ideal as sole data source

## Yelp

Potential strengths:

- restaurant-focused
- strong ratings/review ecosystem

Weakness:

- public commercial API pricing/usage can be restrictive
- current terms must be checked

Conclusion:

No alternative source clearly solved all three at once:

```text
good restaurant quality signal
+
cheap
+
easy commercial reuse/caching
```

This led to the newer strategy.

---

# 11. New Strategic Direction: Curated City Database

Instead of performing expensive live ranking for every user:

> Build a curated internal database of strong restaurants in selected travel destinations.

New structure:

```text
Periodic Google/API research
        ↓
Candidate restaurants
        ↓
Custom score
        ↓
Sanity review
        ↓
Select Top 10
        ↓
Store curated result
        ↓
Serve repeatedly without live ranking API calls
```

This greatly reduces the relationship between traffic and API cost.

---

# 12. Why Travel Destinations

At home, people often already know local restaurants.

The service is more valuable when the user is somewhere unfamiliar.

Primary use case:

> “I just arrived somewhere I don’t know. What are the restaurants actually worth considering?”

Travel therefore became the stronger positioning.

This also means that a recurring monthly subscription may be psychologically weak.

Earlier monetization ideas included:

- one-time purchase
- 24-hour travel pass
- 7-day travel pass
- advertising
- affiliate reservation links

Subscription is not the preferred default.

---

# 13. Why Not Start With the Biggest Cities

Originally, a Top 100 US tourist-city list was considered.

But the strategy changed.

Cities such as:

- New York City
- Los Angeles
- Chicago
- Las Vegas
- Miami
- Orlando
- San Francisco
- Washington, DC
- Boston
- Honolulu

were intentionally deprioritized for the MVP.

Reason:

- restaurant information is already abundant
- famous restaurants are easier to discover
- users already expect to research those cities
- “Top 10 for NYC” is too reductive
- 10 restaurants is too small for mega-city restaurant ecosystems

The product may be more valuable in unfamiliar, medium-sized tourist destinations.

---

# 14. Initial 20 Destination MVP

Current first-market list:

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

Initial dataset target:

> **20 destinations × Top 10 = about 200 restaurants**

Do not jump directly to 100 cities.

Prove the concept with 200 records first.

---

# 15. Public-Facing Experience

The user-facing interface should NOT expose all the ranking mechanics.

Do not force users to interpret:

- Google rating
- review count
- raw score
- detailed formulas
- complex filters

Those values are internal selection inputs.

The user should simply see:

## Restaurant card

- rank
- restaurant name
- one representative photo
- 1–2 sentence description
- 2–4 recommended dishes / what it is known for
- neighborhood/general location
- View on Google Maps
- optional official restaurant website link

That is enough.

---

# 16. Important Decision: Do Not Display Google Rating / Review Count

Google rating and review volume may be used internally to select restaurants.

But the public page does not need to show:

```text
4.7 stars
8,432 reviews
```

Reason:

The whole point of the product is to make the decision for the user.

If the site shows the same raw data Google shows, the user is again forced to interpret it.

Product principle:

> **Use the data internally. Show the conclusion externally.**

---

# 17. Representative Photo Strategy

The product should ideally show one image per restaurant.

Do not scrape random restaurant photos from the internet.

Preferred MVP strategy:

- display a Google Places photo only through a permitted API/platform method
- follow Google attribution requirements
- do not permanently download/rehost user-contributed Google photos unless explicitly allowed
- link to Google Maps for more photos/details

Alternatives later:

- restaurant-provided official images
- licensed images
- user-uploaded images with permission

Only one strong photo is needed in the MVP.

---

# 18. Restaurant Description

Each listing should have a short, useful editorial description.

Target:

> 1–2 sentences

Good example:

> “A polished Lowcountry restaurant focused on local seafood and seasonal Southern dishes. Better suited for a nicer dinner than a quick casual meal.”

Bad example:

> “This amazing restaurant serves delicious food in a wonderful atmosphere.”

Descriptions must be:

- specific
- factual
- concise
- useful for choosing

Do not generate generic AI filler.

---

# 19. Recommended Food

Each restaurant should contain approximately 2–4 signature items or food categories.

Examples:

```text
Shrimp & grits
Local oysters
Wood-fired pizza
Dry-aged steak
Handmade pasta
```

The user should immediately understand:

> “If I go there, what should I consider ordering?”

Do not reproduce the full menu.

---

# 20. Sources for Description / Recommended Food

Possible reliable inputs:

- official restaurant website
- official menu
- Google listing information
- Yelp
- TripAdvisor
- reputable local food publications

Do not copy:

- full reviews
- proprietary editorial text
- long source descriptions

Generate an original concise summary based on factual signals.

---

# 21. City Page

Example:

```text
/best-restaurants/charleston-sc
```

Header example:

# 10 Restaurants Worth Knowing in Charleston

Subheading:

> A short list for travelers who don’t want to compare hundreds of reviews.

Then show:

```text
#1
#2
...
#10
```

No pagination.

No endless results.

No complex filters.

No giant interactive map required in MVP.

---

# 22. Home Page

Minimal home page.

Hero:

> **Find the restaurants worth knowing.**

Subtext:

> Ten carefully selected restaurants in destinations you may not know well.

Show the supported destination list.

Search supported destinations only.

If unsupported:

> “We haven’t added this destination yet.”

Do not make a live Google query for unsupported cities in MVP.

---

# 23. Update Frequency

Restaurants at the top of an established destination usually do not change dramatically every day.

Therefore real-time ranking is unnecessary.

Recommended refresh:

- once per month
- or twice per month

Refresh should check:

- restaurant still open
- major rating/review movement
- newly emerging strong restaurant
- permanent closure
- meaningful Top 10 ranking changes

---

# 24. API Usage Strategy

Do not tie Google Places API calls to public page views.

Instead:

```text
Batch refresh
↓
ranking calculation
↓
Top 10 selection
↓
cached / stored public result
```

Requirements:

- API calls logged
- monthly estimated cost visible
- monthly ceiling configurable
- batch process stops/reduces before cost limit is exceeded

Goal:

> **API cost should depend on refresh coverage, not website traffic.**

---

# 25. Database

For the first 200 restaurants:

> SQLite is sufficient.

Possible later upgrade:

- PostgreSQL

If true radius/location search returns later:

- PostgreSQL + PostGIS

Do not introduce PostGIS until needed.

---

# 26. Suggested Database Model

## cities

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

## restaurants

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

## ranking_snapshots

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

Raw source fields must only be stored if permitted under the current provider terms.

---

# 27. Internal Admin / Dataset Builder

A small internal workflow may be useful.

Per destination:

1. Fetch candidate restaurants.
2. Calculate score.
3. Show internal Top 20.
4. Review obvious distortions.
5. Check chains.
6. Check closed businesses.
7. Approve final Top 10.
8. Create descriptions/recommended dishes.
9. Save verification date.

The public user should never see this complexity.

---

# 28. Sanity Review

For the initial 200 restaurants, some manual review is desirable.

Before publishing:

- Is it actually in/near the destination?
- Is it currently open?
- Is it primarily a restaurant?
- Is a chain ranking too high because of volume?
- Is the ranking obviously strange?
- Does it have enough evidence to justify Top 10?

A purely automated score should not be trusted at the beginning.

---

# 29. Expansion Strategy

Do not automatically expand:

```text
20 cities
→ 100 cities
→ 1,000 restaurants
```

Use actual demand.

Track unsupported searches.

If users repeatedly search:

```text
Palm Springs
Boulder
Boise
Providence
```

add those destinations next.

This makes expansion demand-driven rather than database-driven.

---

# 30. Analytics

Useful metrics:

- destination page views
- Maps click-through rate
- official website click-through rate
- restaurant card interaction
- unsupported city searches
- repeat visitor rate

The key product metric is not page views alone.

The real question:

> Did the list help users decide faster?

---

# 31. Monetization

Not an MVP priority.

Possible later:

- display advertising
- reservation affiliate links
- travel passes
- premium curated guides
- carefully labeled sponsored restaurant placements

Do not allow paid placement to secretly influence organic Top 10 ranking.

---

# 32. Explicit MVP Exclusions

Do not add:

- accounts
- favorites
- user reviews
- social feed
- AI chatbot
- dietary recommendation engine
- itinerary builder
- reservation engine
- large maps
- live radius search
- hundreds of filters
- full restaurant search engine behavior

---

# 33. Main Competitive Advantage

Google / Yelp answer:

> “Here are hundreds of restaurants. Decide.”

This product should answer:

> **“Here are the 10 you should seriously consider.”**

That is the fundamental difference.

---

# 34. Biggest Risks

## Risk 1 — Data licensing
Google data cannot automatically be treated as owned permanent data.

## Risk 2 — Ranking quality
A mathematically elegant score may still give bad recommendations.

## Risk 3 — Staleness
Restaurants close or change.

## Risk 4 — Weak descriptions
Generic AI copy destroys trust.

## Risk 5 — Scope creep
Adding every restaurant-search feature would destroy the simplicity advantage.

---

# 35. MVP Success Criteria

The MVP should answer:

1. Is a Top 10 list more useful than searching Google/Yelp manually?
2. Do people click through to Google Maps?
3. Do users make decisions faster?
4. Do users return when they visit another destination?
5. Are the selected restaurants perceived as genuinely strong?
6. Can monthly/twice-monthly refresh keep the list useful?
7. Can API spending stay within a fixed budget?

---

# 36. Current Recommended MVP Build

Phase 1:
- 20 destinations
- DB schema

Phase 2:
- build ranking pipeline for one city
- compare with manual judgment

Phase 3:
- populate 5 cities

Phase 4:
- build home + city Top 10 pages

Phase 5:
- add one photo
- short description
- recommended foods
- Maps link

Phase 6:
- expand to all 20 cities

Phase 7:
- scheduled refresh
- API usage tracking

Phase 8:
- launch small and measure behavior

---

# 37. Final Product Principle

> **Do not build another restaurant search engine.**
>
> **Build the shortest path from “I don’t know this city” to “these are the places I should consider.”**

---

# 38. Project Status

Current direction is no longer the original expensive live “Best Restaurant Near Me” search model.

The current preferred direction is:

> **Curated travel-destination Top 10 database with periodic batch refreshes.**

This direction keeps:

- the decision-first UX
- the restaurant ranking logic
- Google/other source signals

while reducing:

- live API cost
- interface complexity
- dependency on per-user queries

This is the current source of truth for the project.
