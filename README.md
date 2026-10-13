# vector-demos

Generative, artificial-life and 3D demos built on the `@vector-display` packages. The full list of planned demos is in [`../demoideas.md`](../demoideas.md).

## Layout

| Path | What it is |
| --- | --- |
| `site` | The website: the vector-font index at `/` and one route per demo (`/particle-life/`, `/lenia/`, `/travel-globe/`, `/life/`, `/boids/`, `/slime-mold/`, `/ca-terrain/`, `/biomorphs/`). The demo list lives in `site/src/catalog.ts` |
| `packages/demo-kit` | Shared code: `DemoHost` (canvas, renderer, phosphor, fixed-step loop, crisp overlay pass), `DemoHud`, `DynamicGeometry` (per-frame lines and paths), the demo font, seeded random, page helpers |
| `demos/particle-life` | Particle Life |
| `demos/travel-globe` | Rick's travel map on a vector globe; meant to replace ricksegrest.com/globe |
| `demos/life`, `demos/boids` | Life on the Beam and Boids on the Beam. The rule and beam-geometry modules and their tests are copied unchanged from `~/code/2026/vector-display/examples/demo`; only the full-screen adapters are new |
| `demos/lenia` | Lenia: an FFT-based simulation in a Web Worker, drawn as chained marching-squares contours. Creatures come from the Lenia reference catalog (Chakazul/Lenia, MIT) |
| `demos/slime-mold` | Slime Mold: Physarum agents that follow each other's chemical trail. Only the agents are drawn; the display's own phosphor decay becomes the visible network |
| `demos/ca-terrain` | Cellular Terrain: elementary cellular automata (Rule 30, 90, 110…) extruded as ridgelines scrolling toward a perspective camera |
| `demos/biomorphs` | Biomorphs: Dawkins' nine-gene recursive creatures, bred by choosing one of eight mutant children |
| `tools/screenshot.mjs` | Serves a Vite root, opens a route in headless Chrome with software WebGL2, and saves screenshots |

Each demo package exports a `start…(canvas)` function and implements the `Demo` interface from `demo-kit` (`update`, `draw`, optional `drawOverlay` and `resize`), so a later "Vector OS" shell can host them all. Every demo returns to the index with Escape.

## Commands

```sh
npm install
npm run dev                    # http://localhost:5180 (also on the LAN: binds 0.0.0.0)
npm test                       # all workspaces
npm run build                  # static multi-page site in site/dist
npm run screenshot -- site /tmp/shot --path particle-life/ --at 3,10 --query "seed=777&preset=1"
```

To add a demo: create `demos/<name>` exporting a start function, add an entry to `site/src/catalog.ts`, and add `site/<name>/index.html` plus `site/src/pages/<name>.ts`.

## Particle Life

Particles of 2–10 species attract or repel each other according to an asymmetric rule matrix. Cells, worms, swimmers and predator–prey chases emerge from the rules alone. Each particle is drawn as a short stroke along its velocity, and faster particles burn brighter.

When left alone, the demo evolves on its own: every 22 seconds it mutates the rules, and every fourth time it switches to a fresh rule set. Each change blends smoothly over 5 seconds, and the camera drifts and zooms slowly. The overlay fades out after 10 seconds without input.

URL parameters: `seed`, `species` (2–10), `particles` (500–9000), `preset` (0 chaos, 1 chains, 2 cells, 3 predators). The address bar updates as you change settings, so a URL reproduces a starting setup.

| Input | Action |
| --- | --- |
| Drag / Shift+drag (or right-drag) | Attract / repel particles |
| Wheel, arrows, `0` | Zoom, pan, reset view |
| `R` `M` `P` `E` | New rules, mutate, next preset, toggle auto-evolve |
| `[` `]`, `-` `+` | Species count, particle count |
| `T` | Trail length: short, medium, long, ink |
| `C` `H` `F` | Auto camera, overlay, fullscreen |
| `Space`, `.` | Pause, single step |

## Lenia

Twenty-one creatures from the Lenia reference catalog (Bert Wang-Chak Chan, [github.com/Chakazul/Lenia](https://github.com/Chakazul/Lenia), MIT License), each checked to survive on its own in this implementation. A few copies of one species are placed facing the same way. In auto mode the demo moves to the next species after 70 seconds, 12 seconds after the creatures "bloom" into a labyrinth (mass over 3× the start), or 2.5 seconds after they die out.

The simulation runs in a Web Worker at 10–60 steps per second; the page blends the last two steps so the contours move at the display rate. Each contour level is one chained path, so the beam joins segments without bright beads, and relief mode lifts each level a few units for a stacked-terrain look.

`?species=N` (1–21) starts on a given creature. Keys: `N`/`B` next and previous species, `R` reseed, `A` auto, `L` levels, `V` relief, `T` trails, `-`/`+` speed, `Space` pause, `.` step, click to drop a creature, Shift+click to erase.

## Travel Globe

Rick's travel map (the data from the travel-map app) on an orthographic vector globe. Countries and US states are hatched with parallels in their status color (visited cyan, seen purple, planned green, want amber, lived pink); tiny islands also get a ring marker. Unvisited land gets a faint X cross-hatch in earth tones, with neighbors never sharing a tone, and open water gets small dark-blue waves that grow denser as you zoom. Each view's static layers are cached, so the frozen US map costs almost nothing per frame. Click a place for its years, cities and linked blog post.

- **Data is static.** `src/data/travel.json` replaces the Supabase database, which went offline.
- **Editing** happens on the dev server (`npm run dev`, port 5180): the **Edit** button in the badge strip opens a panel for the title, home base and the selected place's status, years ("1995-1997, 2001"), blog post and cities (add one by clicking its spot on the globe). Only this PC and Rick's Mac (192.168.1.198) may save, checked by IP address on top of the LAN-only firewall rule; set `TRAVEL_EDITORS="ip,ip"` to change the list. Saves are validated, the previous file is kept in `src/data/backups/` (last 30), and the public build never loads the editor.
- **Publishing**: `npm run publish:globe` builds the standalone globe and pushes it on a fresh `globe-update` branch of the portfolio (in the worktree `~/code/2026/portfolio-gallery-vector-globe`) for a Vercel preview. After checking the preview, go live with `git -C ~/code/2026/portfolio-gallery-vector-globe push origin globe-update:master`. Add `-- --dry-run` to commit without pushing.
- **Map data** (`src/data/geo.json`) is built from Natural Earth via world-atlas (50m countries) and us-atlas (10m states) with `npm run build:geo -w @vector-demos/travel-globe`. Outlines keep more detail than the fill shapes, shared borders are stored once, and rings that cross the 180° meridian are unwrapped.
- **Two modes.** The world globe spins and flies to countries. The US map (`U`, or the button under the globe) freezes on the lower 48 with Alaska and Hawaii in inset windows, and dims other countries.
- **Badges and tour.** The HTML strip under the globe has a badge per place in the current mode (countries or states). Clicking one focuses it; `‹ ▶ ›` (or `[`, `P`, `]`) step through places or tour them automatically.
- **Overseas regions** (French Guiana, Guadeloupe, Martinique, Réunion, Mayotte, Caribbean Netherlands, Svalbard) are split from their countries in `build-geo.mjs`, so visiting France does not fill in French Guiana.
- **Cities** are diamonds with labels when zoomed in, on the US map, or when their place is selected. Add them in `travel.json` (name, lat, lng, kind: visited, lived or want) or through the travel-map admin and `import:travel`.
- Keys: drag or arrows rotate, wheel or pinch zoom, `W` world, `U` US map, `Enter` open the selected place's post, `Space` auto-rotation, `Esc` clear selection, then back to the globe.

## Slime Mold

Thousands of Physarum agents crawl across a toroidal chemical field. Each one sniffs three points ahead, turns toward the strongest smell, steps forward and deposits a little more. The demo draws **only the agents**, as short ticks along their heading, and sets the phosphor's persistence long. The display's own decay *is* the trail, which is exactly the package feature this demo exists to show: the mesh of bright highways is where the beam has been.

Five presets (`N`) change how far the mold can smell and how sharply it turns; they grow lattices, vines, blooms and webs. URL: `seed`, `agents` (1000–20000), `preset`.

| Input | Action |
| --- | --- |
| Drag / Shift+drag | Drop food / erase trail |
| `[` `]`, `-` `+` | Agent count, simulation steps per frame |
| `N` `R` `C` `E` | Next preset, reseed, clear trail, auto-evolve |
| `T` | Persistence: short, medium, long, echo |
| `Space`, `.` | Pause, single step |
| `H` `F` | HUD, fullscreen |

## Cellular Terrain

Elementary cellular automata (Rule 30, 90, 110 and friends) are stacked into terrain. Each new generation is extruded as a ridgeline and scrolls toward a perspective camera, so you fly over the computation: Rule 30's chaotic cliffs, Rule 90's Sierpinski forest, Rule 110's Turing-complete traffic. There is no `@vector-display/3d` package in this repo, so the demo carries its own tiny pinhole projector (`render/terrainProjector.ts`); it is tested on its own.

URL: `rule` (1-based index into the preset list), `seed`, `camera`.

| Input | Action |
| --- | --- |
| `N` `B` | Next / previous rule |
| `R` `G` | Random initial row, single-cell seed |
| `A` | Auto-advance through rules |
| `-` `+` | Generations per second |
| `C` `L` | Camera height, toggle walls |
| `[` `]` | Ridge height |
| `T`, `Space`, `.`, `H`, `F` | Persistence, pause, step, HUD, fullscreen |

## Biomorphs

Dawkins' *Blind Watchmaker* creatures, built from a nine-gene recursive tree. The parent sits in the middle of a 3×3 grid with eight mutant children around it; click a child (or use the arrows and `Enter`) and it becomes the parent of the next generation. The eight direction genes share mirror pairs, so the drawing is bilaterally symmetric. `Backspace` walks back up the lineage, and `P` cycles the famous Tree and Insect starting genomes. Left alone, the autopilot (`A`) breeds by random selection. Each child fades in branch by branch.

URL: `seed`, `genes=1,2,3,4,5,6,7,8,9`.

| Input | Action |
| --- | --- |
| Click / arrows / `Enter` | Choose a child to breed |
| `Backspace` | Undo one generation |
| `R` `P` `G` | Random creature, preset genome, reroll children |
| `A`, `Space` | Autopilot, pause |
| `H` `F` | HUD, fullscreen |
