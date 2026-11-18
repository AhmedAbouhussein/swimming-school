// Harlequin diamond formation. Swimmers sit on a lattice of (i, j) points with i + j even:
// i = steps downstream (to the right, behind), j = steps sideways. One diamond is
//   front (i, j), sides (i+1, j+1) and (i+1, j-1), back (i+2, j).
// Diamonds are added as: first one, then to the side (+j), the other side (-j), then behind.

import { Swimmer, meanTailThrust } from './swimmer.js?v=9';

const DX = 0.85;            // stream-wise lattice step, in body lengths
const DY = 0.42;            // lateral lattice step, in body lengths
const MAX_LENGTH_FRAC = 0.26; // body length as a fraction of canvas height, before shrinking
const STROUHAL_K = parseFloat(new URLSearchParams(location.search).get('k') || '1.25'); // f = K * U / L
const PAD_CELLS = 1.0;      // fluid footprint is the drawn body dilated by this many sim cells
const PSI_MAX = 0.6;        // largest heading command, rad
export const CTRL = { kp: 1.5, kd: 4, ki: 0.4, kpy: 1.2, kdy: 1.5, boost: 1.0, iMax: 0.4, fMin: 0.7, fMax: 1.6 };
const PUSH_SPEED = 0.5;     // click / URL push kick, in free-stream speeds
const PUSH_RADIUS = 2.5;    // click push reach, in body lengths

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
    this.hold = true;
    this.rings = [];
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
    this.U0 = this.flow.inflow / this.flow.cellsPerPx;
    this.k0 = meanTailThrust(L, this.freq, this.U0) / (this.U0 * this.U0); // thrust balances drag at U0
    this.swimmers.forEach(s => { s.localU = this.U0; s.update(0, this.freq); });
  }

  update(dt) {
    this.time += dt;
    this.swimmers.forEach(s => {
      this.control(s, dt);
      const f = this.freq * s.ctrl.f;
      s.update(dt, f);
      // Lighthill elongated-body theory at the trailing edge (per unit virtual mass),
      // using the water speed relative to the swimmer.
      const ur = s.localU - s.vxb;
      const hd = s.vy[s.n - 1];
      const w = hd + ur * s.tailSlope;
      const thrust = hd * w - 0.5 * w * w;
      const power = ur * hd * w;
      const a = Math.min(1, dt * f / 2);
      s.tAvg += (thrust * ur - s.tAvg) * a;
      s.pAvg += (power - s.pAvg) * a;
      s.tForce += (thrust - s.tForce) * Math.min(1, dt * f);
      s.advance(dt, this.k0);
      this.clamp(s);
    });
    this.rings.forEach(r => { r.age += dt; });
    this.rings = this.rings.filter(r => r.age < 0.7);
  }

  // Baseline PID hold-station controller: beat frequency for x, heading for y.
  control(s, dt) {
    const c = s.ctrl;
    if (!this.hold) { c.f = 1; c.a = 1; c.psi = 0; s.ix = 0; return; }
    const L = s.length;
    s.ix = Math.max(-CTRL.iMax, Math.min(CTRL.iMax, s.ix + s.dx / L * dt));
    const u = CTRL.kp * s.dx / L + CTRL.kd * s.vxb / this.U0 + CTRL.ki * s.ix;
    const psi = -(CTRL.kpy * s.dy / L + CTRL.kdy * s.vyb / this.U0);
    c.psi = Math.max(-PSI_MAX, Math.min(PSI_MAX, psi));
    c.f = Math.max(CTRL.fMin, Math.min(CTRL.fMax, 1 + u + CTRL.boost * Math.abs(c.psi)));
  }

  clamp(s) {
    const L = s.length;
    const minX = this.W * 0.08 - s.homeX, maxX = this.W * 0.97 - L - s.homeX;
    const minY = this.H * 0.06 - s.homeY, maxY = this.H * 0.80 - s.homeY;
    if (s.dx < minX || s.dx > maxX) { s.dx = Math.max(minX, Math.min(maxX, s.dx)); s.vxb = 0; }
    if (s.dy < minY || s.dy > maxY) { s.dy = Math.max(minY, Math.min(maxY, s.dy)); s.vyb = 0; }
  }

  // Velocity kick (in free-stream speeds) applied to every swimmer.
  pushAll(ux, uy) {
    this.swimmers.forEach(s => { s.vxb += ux * this.U0; s.vyb += uy * this.U0; });
  }

  // Click push: kick swimmers within reach, directed away from the click.
  pushAt(x, y) {
    this.rings.push({ x, y, age: 0 });
    this.swimmers.forEach(s => {
      const cx = (s.upX[20] + s.loX[20]) / 2, cy = (s.upY[20] + s.loY[20]) / 2;
      const d = Math.hypot(cx - x, cy - y), reach = PUSH_RADIUS * s.length;
      if (d > reach) return;
      const k = PUSH_SPEED * this.U0 * (1 - d / reach) / (d || 1);
      s.vxb += (cx - x) * k; s.vyb += (cy - y) * k;
    });
  }

  // Mean distance from home slot, in body lengths.
  offset() {
    return this.swimmers.reduce((a, s) => a + Math.hypot(s.dx, s.dy) / s.length, 0) / this.swimmers.length;
  }

  // Froude efficiency of each swimmer, and the school average.
  efficiency() {
    const etas = this.swimmers.map(s => (s.pAvg > 1e-6 ? Math.max(0, Math.min(1, s.tAvg / s.pAvg)) : 0));
    return { each: etas, mean: etas.reduce((x, y) => x + y, 0) / etas.length };
  }

  probePoints() {
    return this.swimmers.map(s => [s.noseX - 0.25 * s.length, s.noseY]);
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
        const vy = -s.vyField[k] * cells;
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
    this.rings.forEach(r => {
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + r.age * 160, 0, 2 * Math.PI);
      ctx.strokeStyle = darkMode ? `rgba(255,255,255,${0.7 * (1 - r.age / 0.7)})` : `rgba(0,0,0,${0.6 * (1 - r.age / 0.7)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    });
  }
}
