# vector-demos

Generative, artificial-life and 3D demos built on the `@vector-display` packages. The full list of planned demos is in [`../demoideas.md`](../demoideas.md).

## Layout

| Path | What it is |
| --- | --- |
| `site` | The website: the vector-font index at `/` and one route per demo (`/particle-life/`, `/lenia/`, `/travel-globe/`, `/life/`, `/boids/`, `/slime-mold/`, `/ca-terrain/`, `/biomorphs/`, `/attractors/`, `/gray-scott/`, `/polytopes/`, `/oscilloscope/`, `/text-crawl/`, `/epicycles/`, `/live-earth/`, `/meshes/`). The demo list lives in `site/src/catalog.ts` |
| `packages/demo-kit` | Shared code: `DemoHost` (canvas, renderer, phosphor, fixed-step loop, crisp overlay pass), `DemoHud`, `DynamicGeometry` (per-frame lines and paths), `ContourTracer` (marching squares as chained paths, used by Lenia and Gray-Scott), beam paths (`buildPath`, `glyphStrokes`: shapes and font text as strokes for the beam to follow), the demo font, seeded random, page helpers |
| `demos/particle-life` | Particle Life |
| `demos/travel-globe` | Rick's travel map on a vector globe; meant to replace ricksegrest.com/globe |
| `demos/life`, `demos/boids` | Life on the Beam and Boids on the Beam. The rule and beam-geometry modules and their tests are copied unchanged from `~/code/2026/vector-display/examples/demo`; only the full-screen adapters are new |
| `demos/lenia` | Lenia: an FFT-based simulation in a Web Worker, drawn as chained marching-squares contours. Creatures come from the Lenia reference catalog (Chakazul/Lenia, MIT) |
| `demos/slime-mold` | Slime Mold: Physarum agents that follow each other's chemical trail. Only the agents are drawn; the display's own phosphor decay becomes the visible network |
| `demos/ca-terrain` | Cellular Terrain: elementary cellular automata (Rule 30, 90, 110…) extruded as ridgelines scrolling toward a perspective camera |
| `demos/biomorphs` | Biomorphs: Dawkins' nine-gene recursive creatures, bred by choosing one of eight mutant children |
| `demos/attractors` | Strange Attractors: particles flowing through six chaotic systems, crossfading by blending the equations |
| `demos/gray-scott` | Gray-Scott: reaction-diffusion patterns drawn as contour lines |
| `demos/polytopes` | 4D Polytopes: the six regular polytopes rotating through four dimensions |
| `demos/oscilloscope` | Oscilloscope: a stereo signal drawn as an XY beam, with sound |
| `demos/text-crawl` | Text Crawl: vector-font text receding on a plane, shattering into its strokes |
| `demos/epicycles` | Fourier Epicycles: chains of turning circles that redraw a shape |
| `demos/live-earth` | Live Earth: real satellites, the ISS ground track and recent earthquakes on a wireframe globe |
| `demos/meshes` | Feature Edges: the teapot, the bunny and other meshes as line drawings, with hidden lines removed |
| `tools/screenshot.mjs` | Serves a Vite root, opens a route in headless Chrome with software WebGL2, and saves screenshots. `--chrome-flags` passes extra switches, e.g. `--autoplay-policy=no-user-gesture-required` to test audio |

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

Thousands of Physarum agents crawl across a toroidal chemical field. Each one sniffs three points ahead, turns toward the strongest smell, steps forward and deposits a little more. The demo draws **only the agents**, as short ticks along their heading, and sets the phosphor's persistence long. The display's own decay *is* the trail, which is exactly the package feature this demo exists to show: the mesh of bright veins is where the beam has been.

Two limits keep the network a network. A grid cell holds only so many agents, and the trail in a cell has a ceiling. Without them every strand is free to merge with its neighbour, and the whole dish drains into one line within half a minute; `tests/physarum.test.ts` checks each preset against exactly that.

Click or drag to drop **food**: a standing smell that never fades. Veins within reach bend toward it and stay, so a few sources become the hubs of the network. Food sources are drawn as small amber rings.

Five presets (`N`) change how far the mold can smell, how sharply it turns and how crowded a cell may get; they range from a fine filigree to a few long strands. Left alone, the demo starts a fresh dish with the next preset every 35 seconds. URL: `seed`, `agents` (2000–24000), `preset`.

| Input | Action |
| --- | --- |
| Click or drag / Shift+drag | Drop food / erase trail and food |
| `[` `]`, `-` `+` | Agent count, simulation steps per frame |
| `N` `R` `C` `E` | Next preset, reseed, clear the dish, auto-evolve |
| `T` | Persistence: short, medium, long, echo |
| `Space`, `.` | Pause, single step |
| `H` `F` | HUD, fullscreen |

## Cellular Terrain

Elementary cellular automata (Rule 30, 90, 110 and friends) are stacked into terrain. Each new generation appears as a ridgeline at the horizon and slides toward a perspective camera, so you fly over the computation: Rule 30's chaotic ranges, Rule 90's nested basins, Rule 110's Turing-complete traffic.

- **Height** is not the raw on/off cell but how crowded its neighbourhood has been over the last three generations (`sim/heightField.ts`), so busy regions pile up and the empty triangles become basins.
- **Hidden lines** are removed with a floating horizon (`render/TerrainRenderer.ts`): rows are traced nearest first, and a farther row shows only where it rises above everything already drawn. `L` turns this off to see the difference.
- **The land fills the view.** The automaton is a ring of 400 cells, tiled sideways as far as each row needs, so the terrain reaches the horizon on both sides.
- **Motion is continuous.** Rows slide between generations rather than jumping a row at a time.
- **Changing the rule does not cut.** The new rule carries on from the current generation, so its country arrives from the horizon. `G` and `R` likewise plant a single cell or a random row at the horizon.

There is no `@vector-display/3d` package in this repo, so the demo carries its own tiny pinhole projector (`render/terrainProjector.ts`); it is tested on its own.

URL: `rule` (1-based index into the preset list), `seed`, `camera`.

| Input | Action |
| --- | --- |
| `N` `B` | Next / previous rule |
| `R` `G` | Random row, single-cell seed |
| `A` | Auto-advance through rules |
| `-` `+` | Generations per second |
| `C` `L` | Camera height, toggle hidden-line removal |
| `[` `]` | Ridge height |
| `T`, `Space`, `.`, `H`, `F` | Persistence, pause, step, HUD, fullscreen |

## Biomorphs

Dawkins' *Blind Watchmaker* creatures, built from a nine-gene recursive tree. The parent sits in the middle of a 3×3 grid with eight mutant children around it; click a child (or use the arrows and `Enter`) and it becomes the parent of the next generation. The eight direction genes share mirror pairs, so the drawing is bilaterally symmetric.

Choosing a child is animated: it travels to the middle, and its own litter grows out of it, each child flowing from the parent's shape into its own. This works because every branch is a smooth function of the genes, so a creature part-way between two genomes is just the tree grown from part-way genes (`render/biomorph.ts`).

`Backspace` walks back up the lineage, and `P` cycles eight starting creatures. Left alone, the autopilot (`A`) breeds on its own, steering away from creatures it has already visited and from nearly bare ones.

URL: `genes=1,2,3,4,5,6,7,8,9`, `seed`. The address follows the parent as you breed, so copying it shares the creature.

| Input | Action |
| --- | --- |
| Click / arrows / `Enter` | Choose a child to breed |
| `Backspace` | Undo one generation |
| `R` `P` `G` | Random creature, preset genome, reroll children |
| `A`, `Space` | Autopilot, pause |
| `H` `F` | HUD, fullscreen |

## Strange Attractors

Thousands of particles follow one of six chaotic systems: Lorenz, Aizawa, Thomas, Halvorsen, Rössler and Dadras. Nothing draws the attractor itself. Each particle is the short stroke it just travelled, and the phosphor remembers the rest, so the shape appears only because the particles keep retracing it. Colour is flow speed: slow reaches glow blue, fast ones burn toward orange.

Each system lives at its own size and pace, so each is measured once at start-up (`sim/attractors.ts`) and from then on handled in a common frame: centred, about one unit in radius, moving at about one unit per unit of time. In that frame two systems can simply be averaged, which is how the demo crossfades: it blends the equations, not the pictures, so every particle keeps moving under one consistent law the whole way across. A particle that leaves an attractor's basin is put back near the middle.

URL: `attractor` (1-based), `particles` (500–8000), `seed`.

| Input | Action |
| --- | --- |
| Drag, wheel | Rotate, zoom |
| `N` `B` | Next / previous attractor |
| `A` `C` | Auto-cycle, auto-camera |
| `R` | Scatter the particles and watch them find the attractor again |
| `[` `]`, `-` `+` | Particle count, speed |
| `T`, `Space`, `H`, `F` | Trails, pause, HUD, fullscreen |

## Gray-Scott

The Gray-Scott reaction-diffusion model: two chemicals, one feeding on the other, both spreading. Depending on two numbers, the feed and kill rates, it grows coral, mazes, spots that divide like cells, or restless turbulence. The concentration of one chemical is treated as a height map and drawn as nested contour lines, using the same marching-squares tracer as Lenia, so a spot is a small set of rings and a maze wall a pair of long parallel tracks.

Changing pattern (`N`) does not reset the dish. The rates slide to their new values over a few seconds and the old pattern is reworked into the new one where it stands. `M` switches to a **rate map**: kill rate rising across the screen and feed rate rising up it, so every regime appears side by side.

The simulation runs on the main thread: a 200×112 grid at 8 steps per frame costs about 4 ms. URL: `pattern` (1-based), `seed`.

| Input | Action |
| --- | --- |
| Drag / Shift+drag | Add chemical / wipe |
| `N` `B` | Next / previous pattern |
| `M` | Rate map |
| `R` `C` `E` | Reseed, clear, auto-evolve |
| `-` `+`, `[` `]` | Speed, number of contours |
| `Space`, `.`, `H`, `F` | Pause, step, HUD, fullscreen |

## 4D Polytopes

The six regular polytopes of four dimensions, the 4D cousins of the Platonic solids: the 5-cell, 16-cell, tesseract, 24-cell, 600-cell and 120-cell. Each is built from its textbook vertex coordinates (`sim/polytopes.ts`). Edges are never listed by hand: in a regular polytope they are exactly the pairs of vertices at the shortest distance. The 120-cell is derived as the dual of the 600-cell, with one vertex at the centre of each of its 600 tetrahedral cells. At 1200 edges it doubles as a load test for the renderer.

Rotation in 4D happens in a plane, not about an axis, and there are six planes; three involve w, the axis we cannot see. `W` turns those three off, and the shape becomes an ordinary rigid object; turn them back on to see what w adds. Colour is the fourth coordinate: edges far along w are deep blue, near ones hot.

`P` switches projection. **Perspective** is the 4D version of an ordinary camera and gives the familiar cube-within-a-cube. **Stereographic** projects from the 3-sphere the vertices lie on; it keeps angles true, so edges become arcs and the cells look like a foam of bubbles.

URL: `polytope` (1-based), `projection` (`perspective` or `stereographic`), `seed`.

| Input | Action |
| --- | --- |
| Drag / Shift+drag | Rotate in 3D / rotate through w |
| Wheel | Zoom |
| `N` `B`, `P` | Next / previous polytope, projection |
| `W` `R` | Rotation through w on/off, new spin |
| `A`, `-` `+` | Auto-cycle, speed |
| `T`, `Space`, `H`, `F` | Trails, pause, HUD, fullscreen |

## Oscilloscope

An XY oscilloscope: the left audio channel moves the beam across and the right channel moves it up. That is the whole display. No shape is drawn as a shape; the beam is only ever sent where the signal says. A vector display and an oscilloscope are the same idea, so this is the most literal demo here.

The page **starts silent**, because browsers do not let a page make sound until the visitor has pressed something. `S` (or a click) turns the sound on. The same signal runs silently before that, so the picture seen then is the picture heard afterwards.

- **Figures.** Five Lissajous figures (two sine waves at simple frequency ratios), then shapes traced by the beam and turned as they play: star, triangle, spiral, heart, cube, octahedron and the word VECTOR in the vector font. The turning happens sample by sample, so a rotating cube is one continuous signal, not a sequence of frames, and sounds like a chord that slowly shifts.
- **Beam brightness.** A real beam is dimmer the faster it moves. Segments are sorted by the distance covered in one sample, so the quick jumps between letters show only as faint lines.
- **One sample stream.** `sim/ScopeEngine.ts` numbers every sample and both the speakers and the screen read from it. Audio is scheduled about 0.2 s ahead in blocks (`audio/AudioOutput.ts`); the scope draws the samples being heard at that moment. No audio worklet is involved.
- **Your own audio.** `O` opens an audio file, or drop one on the page. Recordings made for the purpose ("oscilloscope music", such as Jerobeam Fenderson's) draw pictures; anything else draws its own stereo field. No recordings are bundled.

URL: `figure` (1-based).

| Input | Action |
| --- | --- |
| `S` / `Enter` / click | Sound on or off |
| `←` `→` | Previous / next figure |
| `↑` `↓` | Pitch, in semitones |
| `[` `]` | Motion (drift and spin) |
| `-` `+` | Volume |
| `O`, or drop a file | Play an audio file through the scope |
| `A` `T` `K` `G` | Auto-cycle, trails, phosphor colour, grid |
| `Space`, `H`, `F` | Pause, HUD, fullscreen |

## Text Crawl

Text in the vector font, laid on a plane that recedes from the viewer and slides into the distance. The text is only ever its strokes: perspective comes from projecting each stroke's two ends, and when the page shatters the same strokes simply stop being held in place. Each becomes a small spinning stick thrown outward from the blast, and the next page assembles from scattered strokes flying into words.

Click anywhere in the text to shatter it from that point (`sim/CrawlScene.ts` finds where the click's line of sight meets the plane). Left alone, a page shatters once it has slid far enough away.

`?text=` shows your own words: `|` ends a line, `||` ends a page, and a line starting with `#` is a title. Keep lines under about 26 characters so the nearest ones fit the screen. Characters the font cannot draw become spaces. Example: `?text=%23HELLO|THIS IS MY OWN CRAWL||AND A SECOND PAGE`.

| Input | Action |
| --- | --- |
| `Space` / `Enter` / click | Shatter the page (a click shatters from that point) |
| `N` | Next page |
| `-` `+` | Crawl speed |
| `T`, `P`, `H`, `F` | Trails, pause, HUD, fullscreen |

## Fourier Epicycles

Any closed path can be drawn by a chain of circles, each turning at a steady whole-number rate with its centre riding on the rim of the one before. The Fourier transform says which circles (`sim/fourier.ts`): one radius and starting angle per turning speed. With few circles the tip traces a smooth caricature of the shape; each one added sharpens it. Left alone, the demo adds circles on every trip round, then moves to the next shape.

Shapes come from three places: built-in outlines (star, heart, triangle), glyphs of the vector font (press a digit to trace it; letters and the word VECTOR are in the list), and **your own sketch**: draw on the screen with the pointer and release.

A letter is several separate strokes, and the chain cannot lift its pen. So the path includes the jumps between strokes, crossed quickly, and the trace is simply not drawn while the tip is on one. The faint grey outline is the shape being aimed for.

URL: `shape` (1-based).

| Input | Action |
| --- | --- |
| Draw with the pointer | Trace your own shape |
| `N` `B` | Next / previous shape |
| `[` `]` | Fewer / more circles |
| `0`–`9` | Trace that digit |
| `A`, `-` `+` | Auto, speed |
| `C` `G` | Show circles, show the target shape |
| `T`, `Space`, `H`, `F` | Trails, pause, HUD, fullscreen |

## Live Earth

A wireframe Earth showing what is actually up there and what has actually happened. Nothing on it is invented.

- **Satellites.** About 170 real ones: the space stations and the brightest satellites, placed from their published orbital elements with the standard SGP4 model (`satellite.js`). Each is a small diamond with a tail showing its direction. The ISS and Tiangong are labelled.
- **ISS ground track.** The station's path over the ground for the last half hour and the next orbit and a half, with a line down to the point beneath it. `I` turns the globe to follow it.
- **Earthquakes.** Every earthquake of magnitude 4.5 or more in the past week, as a ring sized by magnitude and dimmed by age. Those of the last day ripple.
- **Day and night.** The line between them, and a mark where the Sun is overhead, from the date and time.
- **Pointing.** Point at a satellite or an earthquake for its name, height and orbit, or magnitude, place, depth and age.

**Time.** The clock starts at the present and by default runs at one minute per second, so the ISS circles the globe in about a minute and a half; the HUD always shows the moment being displayed and how far it is from now. `0` returns to now, and `W` winds back a week and replays it at an hour a second, so the week's earthquakes appear in the order they happened.

**Data.** Orbits come from [CelesTrak](https://celestrak.org) and earthquakes from the [USGS](https://earthquake.usgs.gov/earthquakes/feed/), fetched by the browser when the page opens. Orbit data is cached for two hours, as CelesTrak asks, and earthquakes for five minutes. If a feed cannot be reached, the demo uses a copy bundled with it and says so: the HUD reads `LIVE`, `CACHED` or `SNAPSHOT` with a date. Orbit predictions drift as elements age, so refresh the bundled copy now and then:

```
npm run update:snapshot -w @vector-demos/live-earth
```

**Reused from the travel globe:** the view that turns longitude and latitude into screen positions and hides the far side, the coastline and border data, and the star field (`@vector-demos/travel-globe/geo`). The renderer is new; the travel globe's is built around its hatching.

`satellite.js` is pinned to version 5. Version 7 ships WebAssembly that uses top-level await, which stops Vite's dev server.

| Input | Action |
| --- | --- |
| Drag, wheel | Rotate, zoom |
| Point | Details of the satellite or earthquake under the pointer |
| `I` | Follow the ISS |
| `-` `+` | How fast time runs |
| `0` `W` | Back to now, replay the week |
| `S` `Q` `G` `D` | Satellites, earthquakes, grid, day/night line |
| `A`, `Space`, `H`, `F` | Spin, pause, HUD, fullscreen |

## Feature Edges

Real meshes as line drawings. Drawing every edge of a mesh gives a grey tangle, because most edges are only there to approximate a curved surface. This draws the few that describe the shape, the way a draughtsman would:

- **Silhouette edges**, the outline: edges where a triangle facing the viewer meets one facing away. These change every frame as the object turns.
- **Crease edges**, the sharp folds: edges where the surface bends by more than a set angle (`[` `]`).
- **Border edges**, where an open surface simply stops.

`M` switches to all edges, to show the tangle being chosen from. The teapot's 9,560 edges come down to about 570.

**Hidden lines** are removed with a depth buffer on the CPU (`render/DepthBuffer.ts`), the method graphics hardware uses for surfaces. The triangles are not drawn, only measured: for each cell of a 512×512 grid, how near is the nearest surface. Each edge is then walked across the grid and the parts lying behind that surface are left out. It is approximate (a line can be cut a cell early or late) but it works for any mesh, however tangled, and costs about 4–6 ms a frame for these models. `L` turns it off to see through the object. This is the general-mesh hidden-line removal the `@vector-display/3d` package lacks; the Cellular Terrain demo's floating horizon only works for a height field.

**Meshes.** The Utah teapot (Martin Newell, 1975), the Stanford bunny (Stanford 3D Scanning Repository, 1994) and Spot (Keenan Crane, public domain) are bundled in a compact form and loaded only when first shown. A gear and a torus knot are generated from formulae: the gear is all flat faces, so nearly everything drawn is a crease; the knot is all smooth surface, so everything drawn is silhouette. The bunny's 69,451 triangles are thinned to about 7,500 and smoothed by the build tool, which re-downloads the originals:

```
npm run build:meshes -w @vector-demos/meshes
```

URL: `mesh` (1-based).

| Input | Action |
| --- | --- |
| Drag, wheel | Rotate, zoom |
| `N` `B` | Next / previous mesh |
| `M` | Feature edges / all edges |
| `L` | Remove / show hidden lines |
| `[` `]` | Crease angle |
| `A` `C` | Auto-cycle, auto-camera |
| `T`, `Space`, `H`, `F` | Trails, pause, HUD, fullscreen |
