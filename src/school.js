// A swimmer starts at rest on the right of a still-water domain and swims left with fixed kinematics,
// pushed only by the reaction force the fluid solver measures on its body (minus skin-friction drag).
// Schooling code (lattice, contact) is kept for later but the force measurement is for one swimmer.
// Formation (for n > 1): harlequin diamond lattice. Swimmers sit on points (i, j) with i + j even:
// i = steps behind (to the right), j = steps sideways. One diamond is
//   front (i, j), sides (i+1, j+1) and (i+1, j-1), back (i+2, j).
// Diamonds are added as: first one, then to the side (+j), the other side (-j), then behind.

import { Swimmer, bodyArea } from './swimmer.js?v=13';

const DX = 0.85;            // lattice step along the swimming direction, in body lengths
const DY = 0.42;            // lateral lattice step, in body lengths
const MAX_LENGTH_FRAC = 0.26; // body length as a fraction of canvas height, before shrinking
const STROUHAL_K = parseFloat(new URLSearchParams(location.search).get('k') || '1.25'); // f = K * U / L
const PAD_CELLS = 1.0;      // fluid footprint is the drawn body dilated by this many sim cells
const COLLIDE = new URLSearchParams(location.search).get('collide') !== '0';
const CONTACT_W = 40;       // contact spring frequency, rad per (U0 / L); critically damped
const START_RIGHT = 0.97;   // the school's tail starts at this fraction of the width
const PARAMS = new URLSearchParams(location.search);
const CF = parseFloat(PARAMS.get('cf') || '0.008');  // skin-friction coefficient (formula drag; grid cannot resolve it)
const PIN = PARAMS.get('pin') === '1';               // hold the body still (force-vs-flow experiments)

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
  // flow = { cruise, cellsPerPx }: cruise is the reference speed in sim cells/s that sets the beat frequency
  // (f = K U / L); the speed actually reached is whatever the fluid thrust and the drag give.
  constructor(W, H, flow) {
    this.W = W; this.H = H; this.flow = flow;
    this.count = 1;
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
    this.time = 0;
    const lattice = formationLattice(n);
    const iMin = Math.min(...lattice.map(p => p.i)), iMax = Math.max(...lattice.map(p => p.i));
    const jMin = Math.min(...lattice.map(p => p.j)), jMax = Math.max(...lattice.map(p => p.j));

    const wUnits = (iMax - iMin) * DX + 1.0;
    const hUnits = (jMax - jMin) * DY + 0.35;
    const availW = this.W * 0.44;
    const availH = this.H * 0.74;
    const L = Math.min(this.H * MAX_LENGTH_FRAC, availW / wUnits, availH / hUnits);

    const cy = this.H * 0.44;
    const left = this.W * START_RIGHT - L - (iMax - iMin) * DX * L;
    const jMid = (jMin + jMax) / 2;

    this.U0 = this.flow.cruise / this.flow.cellsPerPx;     // design swimming speed, px/s
    this.freq = STROUHAL_K * this.U0 / L;
    this.swimmers = lattice.map(p =>
      new Swimmer(left + (p.i - iMin) * DX * L, cy - (p.j - jMid) * DY * L, L, 0));
    const cells = this.flow.cellsPerPx;
    this.mass = bodyArea(L) * cells * cells;               // cells^2 (water density 1, neutral buoyancy)
    this.drag = CF * L * cells;                            // 1/2 Cf (2 L) in cells
    this.force = 0;                                        // latest measured streamwise force, cells^3/s^2
    this.beatSum = 0; this.beatN = 0; this.beatForce = 0; // mean force over the last full beat
    this.lastBeat = 0;
    this.swimmers.forEach(s => s.update(0, this.freq));
  }

  restart() { this.setCount(this.count); }

  // True once every swimmer has left the domain through the left edge.
  finished() {
    return this.swimmers.every(s => Math.max(...s.upX, ...s.loX) < 0);
  }

  // imp = momentum (cells^3/s) the bodies gave the fluid during the previous step (dtPrev seconds).
  setImpulse(imp, dtPrev) {
    this.force = dtPrev > 0 ? -imp[0] / dtPrev : 0;
    this.beatSum += this.force; this.beatN++;
  }

  update(dt) {
    this.time += dt;
    this.swimmers.forEach(s => {
      if (!PIN) s.advanceX(dt, this.force, this.mass, this.drag, this.flow.cellsPerPx);
      s.update(dt, this.freq);
      const beat = Math.floor(s.phi / (2 * Math.PI));
      if (beat > this.lastBeat) {
        this.lastBeat = beat;
        this.beatForce = this.beatN ? this.beatSum / this.beatN : 0;
        this.beatSum = 0; this.beatN = 0;
      }
    });
    if (COLLIDE && this.swimmers.length > 1) this.collide(dt);
  }

  // Soft contact between swimmers: overlapping body discs repel with a critically damped spring,
  // applied as equal and opposite accelerations on the two bodies' translational state.
  collide(dt) {
    const sw = this.swimmers, n = sw.length;
    for (let i = 0; i < n; i++) {
      const a = sw[i], L = a.length, w = CONTACT_W * this.U0 / L;
      for (let j = i + 1; j < n; j++) {
        const b = sw[j];
        if (Math.abs(a.discX[5] - b.discX[5]) > 1.3 * L || Math.abs(a.discY[5] - b.discY[5]) > 0.5 * L) continue;
        let ax = 0, ay = 0;
        for (let p = 0; p < a.discX.length; p++) {
          for (let q = 0; q < b.discX.length; q++) {
            const dx = a.discX[p] - b.discX[q], dy = a.discY[p] - b.discY[q];
            const d = Math.hypot(dx, dy), pen = a.discR[p] + b.discR[q] - d;
            if (pen <= 0) continue;
            const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : 1;
            const vn = (a.vxb - b.vxb) * nx + (a.vyb - b.vyb) * ny;
            const acc = Math.max(0, w * w * pen - 2 * w * vn);
            ax += acc * nx; ay += acc * ny;
          }
        }
        a.vxb += ax * dt; a.vyb += ay * dt;
        b.vxb -= ax * dt; b.vyb -= ay * dt;
      }
    }
  }

  // Mean swimming speed in body lengths per second (positive = forward, i.e. towards the left).
  speed() {
    return this.swimmers.reduce((a, s) => a - s.vxb / s.length, 0) / this.swimmers.length;
  }

  // One triangle strip per swimmer: [x_ndc, y_ndc, ubx, uby, nx, ny] per vertex. Body velocity in sim
  // cells/s (y up); n is the unit vector across the body (from lower to upper surface, y up).
  bodyStrips() {
    const sx = 2 / this.W, sy = 2 / this.H, cells = this.flow.cellsPerPx;
    const pad = PAD_CELLS / cells;
    return this.swimmers.map(s => {
      const d = new Float32Array(s.n * 2 * 6);
      let o = 0;
      const ubx = s.vxb * cells;
      for (let k = 0; k < s.n; k++) {
        const uby = -s.vyField[k] * cells;
        const dx = s.upX[k] - s.loX[k], dy = s.upY[k] - s.loY[k];
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len, ny = -dy / len, m = pad / len;
        d.set([(s.upX[k] + dx * m) * sx - 1, 1 - (s.upY[k] + dy * m) * sy, ubx, uby, nx, ny], o); o += 6;
        d.set([(s.loX[k] - dx * m) * sx - 1, 1 - (s.loY[k] - dy * m) * sy, ubx, uby, nx, ny], o); o += 6;
      }
      return d;
    });
  }

  draw(ctx, darkMode) {
    const fill = darkMode ? '#3A6EA5' : '#14141f';
    this.swimmers.forEach(s => s.draw(ctx, fill));
  }
}
