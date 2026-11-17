// Harlequin diamond formation. Swimmers sit on a lattice of (i, j) points with i + j even:
// i = steps downstream (to the right, behind), j = steps sideways. One diamond is
//   front (i, j), sides (i+1, j+1) and (i+1, j-1), back (i+2, j).
// Diamonds are added as: first one, then to the side (+j), the other side (-j), then behind.

import { Swimmer } from './swimmer.js?v=6';

const DX = 0.85;            // stream-wise lattice step, in body lengths
const DY = 0.42;            // lateral lattice step, in body lengths
const MAX_LENGTH_FRAC = 0.26; // body length as a fraction of canvas height, before shrinking
const STROUHAL_K = parseFloat(new URLSearchParams(location.search).get('k') || '1.25'); // f = K * U / L
const PAD_CELLS = 1.0;      // fluid footprint is the drawn body dilated by this many sim cells

export function formationLattice(n) {
  const R = 5;
  const centers = [];
  for (let a = 0; a <= R; a++) {
    for (let b = -R; b <= R; b++) if (a + Math.abs(b) <= R) centers.push({ a, b });
  }
  centers.sort((p, q) =>
    (p.a + Math.abs(p.b)) - (q.a + Math.abs(q.b)) || p.a - q.a || q.b - p.b);

  const pts = [];
  const seen = new Set();
  const add = (i, j) => {
    const key = i + ',' + j;
    if (!seen.has(key)) { seen.add(key); pts.push({ i, j }); }
  };
  for (const c of centers) {
    const i = 2 * c.a, j = 2 * c.b;
    add(i, j); add(i + 1, j + 1); add(i + 1, j - 1); add(i + 2, j);
    if (pts.length >= n) break;
  }
  return pts.slice(0, n);
}

export class School {
  constructor(W, H, flow) {
    this.W = W; this.H = H; this.flow = flow;
    this.count = 7;
    this.time = 0;
    this.freq = 1;
    this.swimmers = [];
    this.setCount(this.count);
  }

  resize(W, H, flow) {
    this.W = W; this.H = H; this.flow = flow;
    this.setCount(this.count);
  }

  setCount(n) {
    this.count = n;
    const lattice = formationLattice(n);
    const iMin = Math.min(...lattice.map(p => p.i)), iMax = Math.max(...lattice.map(p => p.i));
    const jMin = Math.min(...lattice.map(p => p.j)), jMax = Math.max(...lattice.map(p => p.j));

    const wUnits = (iMax - iMin) * DX + 1.0;
    const hUnits = (jMax - jMin) * DY + 0.35;
    const availW = this.W * 0.44;
    const availH = this.H * 0.74;
    const L = Math.min(this.H * MAX_LENGTH_FRAC, availW / wUnits, availH / hUnits);

    const cy = this.H * 0.44;
    const left = this.W * 0.53;
    const jMid = (jMin + jMax) / 2;

    this.freq = STROUHAL_K * this.flow.inflow / (L * this.flow.cellsPerPx);
    this.swimmers = lattice.map(p =>
      new Swimmer(left + (p.i - iMin) * DX * L, cy - (p.j - jMid) * DY * L, L, 0));
    this.swimmers.forEach(s => { s.localU = this.flow.inflow / this.flow.cellsPerPx; s.update(this.time, this.freq); });
  }

  update(dt) {
    this.time += dt;
    const tau = 2 / this.freq;
    const a = Math.min(1, dt / tau);
    this.swimmers.forEach(s => {
      s.update(this.time, this.freq);
      // Lighthill elongated-body theory at the trailing edge (per unit virtual mass)
      const hd = s.vy[s.n - 1];
      const w = hd + s.localU * s.tailSlope;
      const thrust = hd * w - 0.5 * w * w;
      const power = s.localU * hd * w;
      s.tAvg += (thrust * s.localU - s.tAvg) * a;
      s.pAvg += (power - s.pAvg) * a;
    });
  }

  // Froude efficiency of each swimmer, and the school average.
  efficiency() {
    const etas = this.swimmers.map(s => (s.pAvg > 1e-6 ? Math.max(0, Math.min(1, s.tAvg / s.pAvg)) : 0));
    return { each: etas, mean: etas.reduce((x, y) => x + y, 0) / etas.length };
  }

  probePoints() {
    return this.swimmers.map(s => [s.noseX - 0.25 * s.length, s.y]);
  }

  setLocalFlow(cellsPerS) {
    const k = 1 / this.flow.cellsPerPx;
    const a = 0.15;
    cellsPerS.forEach((u, i) => {
      const s = this.swimmers[i];
      if (s) s.localU += (u * k - s.localU) * a;
    });
  }

  // One triangle strip per swimmer: [x_ndc, y_ndc, vx, vy] per vertex, velocities in sim cells/s.
  bodyStrips() {
    const sx = 2 / this.W, sy = 2 / this.H, cells = this.flow.cellsPerPx;
    const pad = PAD_CELLS / cells;
    return this.swimmers.map(s => {
      const d = new Float32Array(s.n * 2 * 4);
      let o = 0;
      for (let k = 0; k < s.n; k++) {
        const vy = -s.vy[k] * cells;
        const dx = s.upX[k] - s.loX[k], dy = s.upY[k] - s.loY[k];
        const m = pad / (Math.hypot(dx, dy) || 1);
        d[o++] = (s.upX[k] + dx * m) * sx - 1; d[o++] = 1 - (s.upY[k] + dy * m) * sy; d[o++] = 0; d[o++] = vy;
        d[o++] = (s.loX[k] - dx * m) * sx - 1; d[o++] = 1 - (s.loY[k] - dy * m) * sy; d[o++] = 0; d[o++] = vy;
      }
      return d;
    });
  }

  draw(ctx, darkMode) {
    const fill = darkMode ? '#3A6EA5' : '#14141f';
    this.swimmers.forEach(s => s.draw(ctx, fill));
  }
}
