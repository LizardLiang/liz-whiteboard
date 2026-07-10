# Pan/zoom bottleneck measurement — GH #142

**Goal:** attribute React Flow whiteboard pan/zoom cost to one of three causes —
**raster/paint**, **React reconciliation**, or **SVG edge recompute** — so the
follow-up work (#143 virtualization, #144 memoization, #145 Canvas2D edges,
#146 LOD) is prioritized by evidence, not guesswork.

This is a **measurement protocol**, run by hand on real hardware/real GPU. It is
not automated (headless FPS numbers are not trusted for this call). The one code
lever it depends on — a dev-gated **edges-off toggle** — ships with this issue.

---

## Method: lean hybrid

| Cause | How it's isolated |
|-------|-------------------|
| **SVG edge recompute/paint** | FPS (or frame-ms p95) **delta** between edges-ON and edges-OFF, via the HUD "Edges: on/off" toggle. |
| **React reconciliation** | The tracker's `renders` / `setNodes` counters during the gesture. Near-zero during a pure pan ⇒ React is *not* the pan bottleneck. |
| **Raster/paint** | The residual after edges + React, corroborated by the Chrome DevTools Performance panel ("Painting"/"Rendering" time, layer count). Prior evidence: `src/styles/react-flow-theme.css` records a ~13 s pan at 12,887 DOM nodes (~330/table). |

---

## Setup

1. **Build the production bundle** — never dev/Vite (React StrictMode double-renders
   and the un-minified build both inflate the React cost):
   ```bash
   bun run build
   bun run serve
   ```
2. **Seed a stress board** at the desired scale (deterministic PRNG → runs are
   comparable):
   ```bash
   STRESS_TABLE_COUNT=<n> bun run e2e/seed-stress.ts
   ```
   Representative set: **30, 100, 200, 400**. (30 straddles the historic
   sub-30-table stutter; 200/400 sit above the culling threshold.)
3. **Open the board with the perf HUD:**
   `/whiteboard/20000000-0000-4000-8000-000000000001?perf=1`
   (the dedicated stress-board id, `IDS.stressWhiteboard`). The HUD shows
   Record, Edges: on/off, and a live FPS/counter readout.

### Culling control (important)

`onlyRenderVisibleElements` auto-enables above `VIEWPORT_CULLING_NODE_THRESHOLD =
150` (`ReactFlowCanvas.tsx`). Above 150 nodes it renders only a viewport's worth,
so a raw raster-cost read at 200/400 would be confounded. **For the attribution
runs, temporarily raise the threshold** (e.g. to `100000`) so every scale renders
all nodes; note that you did so. *(Optionally also run 200/400 with culling ON to
quantify the culling win — that informs #143, not this verdict.)*

`content-visibility` on table nodes (shipped #121, in `react-flow-theme.css`)
stays **enabled** — it is part of the current build we're measuring, not a
confound to remove.

---

## Fixed gesture protocol (manual)

Run identically for every scale × edge-state so numbers are comparable:

1. Fit view (the board loads fit-to-view).
2. Click **Record**.
3. **Pan:** drag the canvas full-width left↔right **×5** at a steady speed.
4. **Zoom:** zoom out **3** discrete steps, then back in **3**.
5. Click **Stop** — the tracker downloads a `perf-report-*.json`.

Do this twice per scale: once with **Edges: on**, once with **Edges: off**.
Then do **one** Chrome DevTools Performance recording of the same gesture
(Edges: on) per scale, to read paint/raster time and layer count.

---

## Results

Fill in on real hardware. FPS from the report's `overall` / `perGesture.pan`
(avg and p95); counters from `counters`; paint from DevTools.

| Scale | Edges | Pan FPS avg | Pan FPS p95 | Frame-ms worst | renders | setNodes | Long-task ms | DevTools paint ms |
|------:|:-----:|:-----------:|:-----------:|:--------------:|:-------:|:--------:|:------------:|:-----------------:|
| 30    | on    |             |             |                |         |          |              |                   |
| 30    | off   |             |             |                |         |          |              | —                 |
| 100   | on    |             |             |                |         |          |              |                   |
| 100   | off   |             |             |                |         |          |              | —                 |
| 200   | on    |             |             |                |         |          |              |                   |
| 200   | off   |             |             |                |         |          |              | —                 |
| 400   | on    |             |             |                |         |          |              |                   |
| 400   | off   |             |             |                |         |          |              | —                 |

**Environment:** _(fill in)_ CPU / GPU / browser / OS / build hash.

---

## Verdict

_(Fill in after measuring, then post to GH #142.)_

- **Dominant bottleneck:** _(raster / React / edges)_ at scale _(N)_.
- **Evidence:** _(edges-on vs edges-off FPS delta = X; renders during pan = Y; DevTools paint = Z ms)_.
- **Prioritizes:** _(#143 / #144 / #145 / #146)_ — _(one line why)_.

### Caveat

The edges-off toggle removes the SVG edge **render/paint**, but React Flow still
holds edge state and column handles when edges are ablated — so the edges-on/off
delta slightly **under-counts** total edge overhead. Fine for a prioritization
verdict; don't read it as the exact ceiling of a Canvas2D-edges (#145) win.
