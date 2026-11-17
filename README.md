# swimming-school

**Live demo → https://ahmedabouhussein.github.io/swimming-school/**

A browser fluid simulation of a school of slender, tuna-shaped swimmers holding station in a current. WebGL2, all compute on the visitor's GPU: no server, no cost. Hard-reload (Cmd/Ctrl+Shift+R) if the page looks stale.

URL options for testing: `?n=12` (swimmer count), `?mode=light`, `?warm=300` (pre-run N solver steps so the wake is already developed).

## What the flow field is doing

It is a small virtual wind tunnel:

- A **steady current** flows left → right at a fixed speed. It enters through the left edge and leaves through the open right edge. The top and bottom are free-slip walls.
- The swimmers face **upstream** (head left, tail right) and beat their tails just fast enough to hold position. They are moving solid bodies: every frame, each body's shape and lateral velocity are written into the velocity field (no-slip), then the solver enforces incompressibility.
- The fluid reacts: boundary layers form on each body and **wake vortices are shed** off the tails and carried downstream. That wake is what the colours show.
- Colour = |vorticity|. Uniform current has zero vorticity, so the left half of the screen is intentionally empty; only disturbances show up.

This is the physics the later RL checkpoints will optimise over: a follower's efficiency depends on the wake of the swimmers ahead of it.

## Formation

Swimmers sit on a harlequin (repeating-diamond) lattice. One diamond = front swimmer, two side swimmers, and a back swimmer directly behind the front one (same height, horizontal offset only):

```
 1 . 4        diamond 1 = swimmers 1,2,3,4
  2 3         (1 front, 2/3 sides, 4 directly behind 1)
```

Further diamonds are added in the same order as the first swimmers were: one to the side, the other side, then behind, and so on, sharing vertices with their neighbours (so diamond 2 adds 3 swimmers, etc.). The school lives in the right half of the domain, at constant size until it no longer fits, then shrinks uniformly.

## Swimmer

A closed slender envelope (about 9:1 length:max-thickness, rounded nose, tapering tail, no sharp points). A carangiform wave travels head → tail with amplitude growing from 2% to 10% of body length. Tail-beat frequency is set from the current speed (Strouhal-like: `f = 1.25 U / L`) so the swimmers hold station.

## Solver (`src/fluid.js`)

Stam stable-fluids on a 288-cell-high grid (aspect-matched, ~512 wide), in GLSL fragment shaders:

1. Semi-Lagrangian advection (stored field = perturbation from the free stream, so half-float precision stays good)
2. Vorticity confinement
3. Body stamping (no-slip moving solids)
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

Known limits: bodies are stamped as stationary (they don't get pushed by the fluid yet); no force/efficiency measurement yet.
