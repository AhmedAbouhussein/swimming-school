# swimming-school

**Live demo → https://ahmedabouhussein.github.io/swimming-school/**

A browser fluid simulation of a school of slender, tuna-shaped swimmers holding station in a current. WebGL2, all compute on the visitor's GPU: no server, no cost. Hard-reload (Cmd/Ctrl+Shift+R) if the page looks stale.

URL options for testing: `?n=12` (swimmer count), `?mode=light`, `?warm=300` (pre-run N solver steps so the wake is already developed), `?sign=1` or the **± Sign** button (colour vortices by rotation direction: red = counter-clockwise, blue = clockwise), `?k=1.25` (tail-beat frequency factor), `?amp=0.10` (tail amplitude, fraction of body length).

## Key modelling assumption (read this first)

**The swimmers are only partly "no-slip".** Each body forces the water's *sideways* (y) velocity to match the body's motion, but leaves the *along-stream* (x) velocity alone, so the current slides freely past the body. In other words: no-slip in y, free-slip in x.

Consequences:

- **No body drag.** There is no skin-friction boundary layer along the body, so the simulation says nothing about how much drag a swimmer has. It models thrust and wake interaction only.
- **Clean thrust wake.** Without a drag boundary layer, the vortices shed from the tail are not hidden, and a solitary swimmer produces a reverse von Kármán street. (`?stamp=full` enforces full no-slip instead, which buries the wake under a drag sheet.)
- **Same assumption as Lighthill's theory.** This is the same assumption made by Lighthill's elongated-body theory of fish propulsion: a slender body that pushes water sideways, with streamwise friction ignored. That is deliberate, because **efficiency is calculated with Lighthill's theory** (see "Efficiency" below), so the flow model and the efficiency model rest on the same footing.
- **Full no-slip was tried and rejected.** Stamping x as well (`?stamp=full`) does add an x-force on the body, but at this grid resolution (a body is ~4 cells thick) the numerical drag grows faster than thrust as tail amplitude increases, so net force and a thrust/drag split are not trustworthy and a force-based Froude efficiency could not be resolved. Getting that right would need a much finer body representation; for now efficiency stays Lighthill-based and blind to x-forcing.
- **Results are only as valid as this assumption.** Conclusions about drag-dependent effects (for example the energetic cost of holding position, or drafting that reduces drag) cannot be drawn from this model.

## What the flow field is doing

It is a small virtual wind tunnel:

- A **steady current** flows left → right at a fixed speed. It enters through the left edge and leaves through the open right edge. The top and bottom are free-slip walls.
- The swimmers face **upstream** (head left, tail right) and beat their tails just fast enough to hold position. They are moving solid bodies: every frame, each body's shape and lateral velocity are written into the velocity field, then the solver enforces incompressibility.
- The fluid reacts: **wake vortices are shed** off the tails and carried downstream. That wake is what the colours show.
- Colour = |vorticity|. Uniform current has zero vorticity, so the left half of the screen is intentionally empty; only disturbances show up.

This is the physics the later RL checkpoints will optimise over: a follower's efficiency depends on the wake of the swimmers ahead of it.

### Reverse Kármán street (solitary swimmer)

With one swimmer the wake is a **reverse von Kármán street**: two staggered rows of opposite-sign vortices, counter-clockwise above the centreline and clockwise below, with a jet between them pointing downstream (thrust). Check it with `?n=1&sign=1`. The kinematics sit in the efficient Strouhal band: `St = f·A/U = 1.25 × 0.20 = 0.25` (A = peak-to-peak tail excursion; efficient swimmers sit around 0.2–0.4).

## Efficiency (live readout)

Each swimmer's Froude efficiency `η = (thrust × U) / (power into the water)` is computed from **Lighthill's elongated-body theory** (the same assumption the flow model makes, see above) at the trailing edge, using the swimmer's actual tail velocity and slope and the **flow speed it actually sees**, measured from the fluid 0.25 body lengths ahead of its nose. Thrust and power are averaged over about two tail-beat periods, and the number shown is the simple average of all swimmers. A follower sitting in another swimmer's wake sees a different local flow, so formation changes the number. This is a model estimate from kinematics plus measured flow, not a force integrated over the body in the fluid solver.

## Formation

Swimmers sit on a harlequin (repeating-diamond) lattice. One diamond = front swimmer, two side swimmers, and a back swimmer directly behind the front one (same height, horizontal offset only):

```
 1 . 4        diamond 1 = swimmers 1,2,3,4
  2 3         (1 front, 2/3 sides, 4 directly behind 1)
```

Further diamonds are added in the same order as the first swimmers were: one to the side, the other side, then behind, and so on, sharing vertices with their neighbours (so diamond 2 adds 3 swimmers, etc.). The school lives in the right half of the domain (its left edge sits at 53% of the width, so small schools leave room for their wake), at constant size until it no longer fits, then shrinks uniformly.

## Swimmer

A closed slender envelope (about 9:1 length:max-thickness, rounded nose, tapering tail, no sharp points). A carangiform wave travels head → tail with amplitude growing from 2% to 10% of body length. Tail-beat frequency is set from the current speed (Strouhal-like: `f = 1.25 U / L`) so the swimmers hold station.

## Solver (`src/fluid.js`)

Stam stable-fluids on a 288-cell-high grid (aspect-matched, ~512 wide), in GLSL fragment shaders:

1. Semi-Lagrangian advection (stored field = perturbation from the free stream, so half-float precision stays good)
2. Vorticity confinement
3. Body stamping: only the body's **lateral** velocity is written into the field; streamwise flow passes freely (see the key modelling assumption above)
4. Divergence → 40 Jacobi pressure iterations (open outlet = pressure 0) → gradient subtraction
5. Bodies stamped again so the next advection sees them

Needs WebGL2 + `EXT_color_buffer_float`.

## Rendering

Two stacked canvases: WebGL for vorticity, 2D canvas for swimmers.

| Mode | Water | Vortices | Swimmers |
|------|-------|----------|----------|
| Dark | black | green | steel blue `#3A6EA5` |
| Light | white | light red | solid dark |

## Files

`index.html` UI · `src/main.js` loop/UI · `src/fluid.js` solver · `src/school.js` formation + coupling data · `src/swimmer.js` body shape and kinematics. Hosted as static files on GitHub Pages; module URLs carry `?v=N` to dodge Pages caching.

## Roadmap

| Tag | Checkpoint |
|-----|-----------|
| `v1.x` ← *current* | Real fluid, fixed kinematics, fixed diamond formation |
| `v2.0` | Swimmers respond to upstream vortices (two-way coupling) |
| `v3.0` | Individual RL: each swimmer optimises its own kinematics |
| `v4.0` | Group RL: collective efficiency vs individual optimisation, spacing |

Known limits: bodies are held in place (not pushed by the fluid yet; RL will add per-swimmer position/heading state and use distance from the assigned lattice position as its reward); efficiency is a Lighthill-theory estimate, not integrated CFD force; with the open right edge only about three wake wavelengths are visible.
