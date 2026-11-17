# swimming-school

**Live demo → https://ahmedabouhussein.github.io/swimming-school/**

A browser-based fluid simulation of a school of swimmers using WebGL2. All computation runs client-side on the visitor's GPU — no server, no cloud, no cost.

---

## What it does

A group of tuna-profiled swimmers holds a harlequin diamond formation while swimming through a left-to-right flow. Each swimmer undulates with a sinusoidal body wave that injects velocity into the surrounding fluid. The fluid responds with vortex structures visible in the wake.

A slider lets you scale the school from a single solitary swimmer up to 20. A dark/light mode toggle switches between a black background with green vortices and a white background with red vortices.

---

## Formation

Swimmers are placed on a harlequin diamond lattice — an offset grid where the gaps between adjacent swimmers form repeating diamond (rhombus) cells. The lead swimmer sits at the front. Each subsequent pair is added alternating right and left, extending the chain of diamond cells backward:

```
        ①
      ③   ②       ← diamond cell 1
      ⑤   ④       ← diamond cell 2
      ⑦   ⑥       ← diamond cell 3
         ...
```

Swimmer size is held constant until the formation would overflow the canvas, at which point all swimmers scale down uniformly to fit.

---

## Swimmer shape

Each swimmer is a smooth closed polygon approximating a tuna body profile: widest at ~35% from the nose, tapering to a narrow tail. The body shape is computed analytically from a spine driven by a sinusoidal wave that grows in amplitude toward the tail (zero at the nose, maximum at the tail).

---

## Fluid solver

The fluid is a 2D incompressible Navier-Stokes solver implemented entirely in GLSL fragment shaders running on a 256×256 texture grid:

1. **Advection** — semi-Lagrangian: each cell traces its velocity backward in time to sample the previous state
2. **Vorticity confinement** — amplifies small-scale vortex structures that numerical diffusion would otherwise damp
3. **Pressure projection** — 20 Jacobi iterations per frame to enforce incompressibility (∇·u = 0)
4. **Gradient subtraction** — removes the pressure gradient from velocity to keep the field divergence-free

Swimmers inject velocity into the solver along their spine at each frame. A uniform left-to-right background flow is injected from the left edge.

---

## Rendering

Two canvases are stacked in the same container:

- **WebGL canvas** (bottom) — renders the fluid as a full-screen quad, coloring each pixel by local vorticity
- **2D overlay canvas** (top) — draws swimmer polygons using the Canvas 2D API

Vorticity color mapping:
| Mode | Positive vortex | Negative vortex | Background |
|------|----------------|-----------------|------------|
| Dark | bright green | dim green | black |
| Light | rose/red | pale red | white |

---

## Hosting

Static files served by **GitHub Pages** — free, zero backend. The GPU compute happens entirely in the visitor's browser.

---

## Repo roadmap

| Tag | Checkpoint |
|-----|-----------|
| `v1.0` ← *current* | Swimmers + real WebGL fluid, fixed kinematics, harlequin formation |
| `v2.0` | Fluid-body coupling — swimmers respond to upstream vortices |
| `v3.0` | Individual RL — each swimmer optimizes its own kinematics |
| `v4.0` | Group RL — collective efficiency, compare individual vs group optimization |

---

## Running locally

No build step required. Serve the repo root with any static server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

> Direct `file://` access will fail due to ES module CORS restrictions — use a local server.
