# swimming-school

**Live demo → https://ahmedabouhussein.github.io/swimming-school/**

A browser fluid simulation of a slender, tuna-shaped swimmer that **propels itself through still water**. WebGL2, all compute on the visitor's GPU: no server, no cost. Hard-reload (Cmd/Ctrl+Shift+R) if the page looks stale.

The swimmer starts at rest on the right, beats its body with fixed kinematics (no control of any kind), and is pushed left only by the reaction force of the water it throws backwards. When it leaves the left edge it restarts from rest in fresh water. Colour = |vorticity|, so you see the wake it leaves behind.

## How the propulsion works

- **Still water**, free-slip top and bottom, open right edge. No imposed current.
- The body is an **impermeable, frictionless** moving solid: inside its footprint only the velocity component *normal* to the body is forced to the body's velocity (wave motion + streamwise motion); the tangential component is left to the fluid.
- Each step the solver sums the **momentum this gives the fluid** (before vs after the stamp, both stamps, on the GPU). Newton's third law: the force on the body is minus that, divided by dt. That force, plus drag, accelerates the body along x (`F/m`, mass = body area × water density, i.e. neutrally buoyant).
- The body moves **only along x** (rectilinear). Sideways force and yaw recoil are measured nowhere and ignored.
- **Drag is a formula**, not from the grid: `D = ½ Cf (2L) v²` with `Cf = 0.008` (`?cf=`). The grid (body ~4 cells thick) cannot resolve a boundary layer, so the skin friction is imposed. **The terminal speed therefore depends on this chosen Cf**; the thrust is whatever the fluid gives.

### What it does (headless-Chrome measurements)

Force on the body, averaged over a full beat, with the body pinned in a free stream of speed U (equivalent to swimming at U in still water; thrust is negative = leftward). Cells/s; body length ≈ 75 cells, beat ≈ 0.67 Hz.

| U (cells/s) | 0 | 20 | 40 | 90 |
|---|---|---|---|---|
| mean force (cells³/s²) | −12,800 | −6,500 | −1,840 | +13,200 |

Thrust falls with speed and crosses zero near U ≈ 45 cells/s ≈ 0.6 L/s, close to the body-wave speed (λf ≈ 0.67 L/s), as expected physically. Free swimming from rest accelerates for ~5 s and settles at **≈0.57 L/s** (60 fps) / 0.56 L/s (30 fps), where mean thrust ≈ 1,150 balances the drag. The swimmer crosses the domain in ≈12 s and restarts.

Caveats: the grid is coarse, so absolute thrust has some numerical error (earlier full no-slip attempts showed numerical drag growing with amplitude; this free-slip normal-only version avoids the boundary-layer drag but not all grid error). Force is measured from the total impulse, so it is valid for **one swimmer** only. A zero-force null test (static body) is not yet done.

URL options: `?mode=light`, `?sign=1` (red = counter-clockwise, blue = clockwise), `?warm=300` (pre-run N steps), `?dt=0.033` (step for warm frames), `?debug=1` (time, position, speed, last-beat mean force), `?cf=0.008` (drag coefficient), `?pin=1` (hold the body still; with `?flow=U` gives the force-vs-speed curve), `?flow=U` (free-stream, cells/s; default 0), `?k=1.25` (beat frequency factor, f = K·U₀/L), `?amp=0.10` (tail amplitude / L), `?conf=2` (vorticity confinement).

## Swimmer

Closed slender envelope (~9:1 length:thickness, no sharp points). A carangiform wave travels head → tail, amplitude 2% → 10% of body length, wavelength = one body length. Beat frequency uses a reference speed U₀ = 40 cells/s (`f = 1.25 U₀/L`, Strouhal ≈ 0.25); it is fixed, so the swimmer's actual speed is a result, not an input.

## Solver (`src/fluid.js`)

Stam stable-fluids on a 288-cell-high grid (~512 wide), GLSL fragment shaders:

1. Semi-Lagrangian advection (stored field = perturbation from the free stream)
2. Vorticity confinement (ε = 2, gated on |ω|). ε = 6 shredded wakes into noise; see the tag below
3. Body map drawn (velocity + normal), normal-only constraint applied, momentum change reduced to a number (8×8 blocks → sum → `readPixels`)
4. Divergence → 40 Jacobi pressure iterations (open outlet p = 0) → gradient subtraction
5. Constraint applied again (this is the second impulse term), then curl for display

Needs WebGL2 + `EXT_color_buffer_float`.

## Rendering

| Mode | Water | Vortices | Swimmer |
|------|-------|----------|---------|
| Dark | black | green | steel blue `#3A6EA5` |
| Light | white | light red | solid dark |

## Files

`index.html` UI · `src/main.js` loop/UI · `src/fluid.js` solver + force measurement · `src/school.js` placement, force → motion, restart (diamond-lattice and contact code kept dormant for later) · `src/swimmer.js` body shape and kinematics. Static files on GitHub Pages; module URLs carry `?v=N` to dodge caching.

## History and roadmap

Tag `station-keeping-v11` is the previous design: swimmers held station in an imposed current using *formula* thrust (Lighthill) and a PID controller, with lateral-only stamping, collisions and diamond schools. That was not self-propulsion, so it was set aside.

| Step | Status |
|------|--------|
| Solitary self-propulsion, fixed kinematics, still water | **current** |
| Diamond school (1–20) swimming in still water | next |
| Individual RL (kinematics, spacing) → group RL | later |
