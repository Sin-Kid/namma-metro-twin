# Namma Metro Twin

A 3D digital twin of Bengaluru's Namma Metro. Mapbox's 3D city is the base map; viaducts, tunnels, stations and 6-car trains are drawn on top with Three.js at exact coordinates. Trains run on BMRCL's published timetable pattern against the real clock (IST).

Features: live train positions from the timetable, station departures, journey planner, cab-view ride mode with next-station announcements, fly mode, cinematic tour, weather, X-ray (hide buildings to see tunnels), platform crowds, day/night lighting that follows the clock, minimap.

## Run locally

```bash
cp .env.example .env      # then put your Mapbox public token (pk.…) in .env
npm test                  # timetable engine checks
npm start                 # builds into dist/ and serves it
```

`.env` is git-ignored. The build script reads `MAPBOX_TOKEN` from `.env` locally, or from the environment in CI, and writes it into `dist/config.js`. The token is never committed.

## Deploy (Netlify, from GitHub)

Every push to `main` builds on Netlify with `npm test && npm run build` and publishes `dist/` (see `netlify.toml`).

Set `MAPBOX_TOKEN` in **Netlify → Project configuration → Environment variables**. A Mapbox `pk.` token is a public browser token by design, so it is visible in the shipped page; restrict it to your site's URL at account.mapbox.com/access-tokens so other sites can't use your quota. Never use an `sk.` secret token here; the build refuses one.

## Project layout

| Path | What it is |
| --- | --- |
| `src/index.html` | Page shell: top bar, side panel, cards, dock, popovers |
| `src/app.js` | Mapbox map, Three.js metro layer, modes (orbit, fly, ride, tour), UI logic |
| `src/engine.js` | Geometry, height profile, timetable, train physics, journey planner |
| `src/data.js` | Routes, stops and tunnel portals prepared from the source GeoJSON |
| `data/metro-lines-stations.geojson` | Source track and station data |
| `scripts/prepare_data.py` | Regenerates the route data from the GeoJSON |
| `scripts/build.mjs` | Builds `dist/` and injects the token |
| `scripts/check.mjs` | Engine sanity tests |

## Data and accuracy

- Track and station geometry: [geohacker/namma-metro](https://github.com/geohacker/namma-metro) (2020 snapshot, operational and proposed lines; proposed stations approximate).
- Timetable: terminal first/last trains and headway bands follow BMRCL's published pattern as reported in October 2026. Train positions are simulated from that timetable, not live GPS.
- Line status as of October 2026: Purple, Green and Yellow in service; Pink Line elevated section cleared and awaiting inauguration; Blue Line under construction.
- Base map © Mapbox © OpenStreetMap contributors.
