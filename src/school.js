// Harlequin diamond formation. Swimmers sit on a lattice of (i, j) points with i + j even:
// i = steps downstream (to the right, behind), j = steps sideways. One diamond is
//   front (i, j), sides (i+1, j+1) and (i+1, j-1), back (i+2, j).
// Diamonds are added as: first one, then to the side (+j), the other side (-j), then behind.

import { Swimmer } from './swimmer.js?v=4';

const DX = 0.85;            // stream-wise lattice step, in body lengths
const DY = 0.42;            // lateral lattice step, in body lengths
const MAX_LENGTH_FRAC = 0.26; // body length as a fraction of canvas height, before shrinking
const STROUHAL_K = 1.25;    // tail-beat frequency = K * inflow / bodyLength

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

    const cx = this.W * 0.75, cy = this.H * 0.44;
    const left = cx - (wUnits * L) / 2;
    const jMid = (jMin + jMax) / 2;

    this.freq = STROUHAL_K * this.flow.inflow / (L * this.flow.cellsPerPx);
    this.swimmers = lattice.map(p =>
      new Swimmer(left + (p.i - iMin) * DX * L, cy - (p.j - jMid) * DY * L, L, 0));
    this.swimmers.forEach(s => s.update(this.time, this.freq));
  }

  update(dt) {
    this.time += dt;
    this.swimmers.forEach(s => s.update(this.time, this.freq));
  }

  // One triangle strip per swimmer: [x_ndc, y_ndc, vx, vy] per vertex, velocities in sim cells/s.
  bodyStrips() {
    const sx = 2 / this.W, sy = 2 / this.H, cells = this.flow.cellsPerPx;
    return this.swimmers.map(s => {
      const d = new Float32Array(s.n * 2 * 4);
      let o = 0;
      for (let k = 0; k < s.n; k++) {
        const vy = -s.vy[k] * cells;
        d[o++] = s.upX[k] * sx - 1; d[o++] = 1 - s.upY[k] * sy; d[o++] = 0; d[o++] = vy;
        d[o++] = s.loX[k] * sx - 1; d[o++] = 1 - s.loY[k] * sy; d[o++] = 0; d[o++] = vy;
      }
      return d;
    });
  }

  draw(ctx, darkMode) {
    const fill = darkMode ? '#3A6EA5' : '#14141f';
    this.swimmers.forEach(s => s.draw(ctx, fill));
  }
}
