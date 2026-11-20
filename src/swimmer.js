// Slender tuna-like swimmer. Head on the left (nose at s=0), tail on the right (s=1).
// A body wave travels head -> tail. The body moves only along x (rectilinear): its streamwise velocity
// is advanced from the force the fluid solver measures on it plus a skin-friction drag formula.

const WAVELENGTH = 1.0;          // body wavelength, in body lengths
const AMP_HEAD = 0.02;           // lateral amplitude at the nose (fraction of L)
const AMP_TAIL = parseFloat(new URLSearchParams(location.search).get('amp') || '0.10'); // tail amplitude (fraction of L)
const W_MAX = 0.055;             // max half-thickness (fraction of L)
const W_END = 0.18;              // half-thickness at the tail end, relative to W_MAX
const S_MAX = 0.30;              // position of max thickness
const N_POINTS = 48;
const PIVOT_S = 0.35;            // body rotates about this point
const DISC_S = [0.03, 0.12, 0.21, 0.31, 0.41, 0.51, 0.61, 0.71, 0.81, 0.90, 0.98]; // collision discs along the body
const DISC_PAD = 0.018;          // disc radius = local half-thickness + this (fraction of L)

const TWO_PI = 2 * Math.PI;

export function halfThickness(s) {
  if (s <= S_MAX) {
    const q = (S_MAX - s) / S_MAX;
    return W_MAX * Math.sqrt(Math.max(0, 1 - q * q));
  }
  const t = (s - S_MAX) / (1 - S_MAX);
  return W_MAX * (W_END + (1 - W_END) * (1 - Math.pow(t, 1.6)));
}

// Body area in px^2 (length^2 * integral of the full thickness over s).
export function bodyArea(L) {
  const N = 200;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += 2 * halfThickness((i + 0.5) / N) / N;
  return sum * L * L;
}

export class Swimmer {
  constructor(noseX, y, length, phase = 0) {
    this.homeX = noseX; this.homeY = y;
    this.length = length;
    this.phase = phase;
    this.n = N_POINTS;
    this.s = new Float32Array(N_POINTS);
    for (let k = 0; k < N_POINTS; k++) this.s[k] = 0.5 * (1 - Math.cos(Math.PI * k / (N_POINTS - 1)));
    this.upX = new Float32Array(N_POINTS);
    this.upY = new Float32Array(N_POINTS);
    this.loX = new Float32Array(N_POINTS);
    this.loY = new Float32Array(N_POINTS);
    this.vy = new Float32Array(N_POINTS);       // wave lateral velocity of the body, px/s (y down)
    this.vyField = new Float32Array(N_POINTS);  // wave + rigid motion, written into the fluid
    this.phi = 0;                               // integrated wave phase (rad)
    this.dx = 0; this.dy = 0;                   // offset from home slot, px (x downstream, y down)
    this.vxb = 0; this.vyb = 0;                 // body velocity, px/s (y stays 0: rectilinear)
    this.psi = 0; this.omega = 0;               // heading stays 0 (kept for the collision code and stamp)
    this.ctrl = { a: 1 };                       // amplitude scale
    this.noseX = noseX; this.noseY = y;
    this.discK = DISC_S.map(t => this.s.reduce((b, v, k) => (Math.abs(v - t) < Math.abs(this.s[b] - t) ? k : b), 0));
    this.discR = this.discK.map(k => (halfThickness(this.s[k]) + DISC_PAD) * length);
    this.discX = new Float32Array(DISC_S.length);
    this.discY = new Float32Array(DISC_S.length);
  }

  // Kinematics for the current state; freq is the beat frequency (Hz).
  update(dt, freq) {
    const L = this.length;
    this.phi += TWO_PI * freq * dt;
    const cosP = Math.cos(this.psi), sinP = Math.sin(this.psi);
    const x0 = this.homeX + this.dx, yc = this.homeY + this.dy;
    const xp = x0 + PIVOT_S * L;
    const asc = this.ctrl.a;
    for (let k = 0; k < this.n; k++) {
      const s = this.s[k];
      const a = (AMP_HEAD + (AMP_TAIL - AMP_HEAD) * s * s) * asc;
      const da = 2 * (AMP_TAIL - AMP_HEAD) * s * asc;
      const th = TWO_PI * s / WAVELENGTH - this.phi + this.phase;
      const sn = Math.sin(th), cs = Math.cos(th);

      const h = L * a * sn;
      const dhds = L * (da * sn + a * cs * TWO_PI / WAVELENGTH);
      this.vy[k] = -L * a * TWO_PI * freq * cs;

      const x = x0 + s * L;
      const y = yc + h;
      const norm = Math.hypot(L, dhds);
      const nx = -dhds / norm, ny = L / norm;
      const hw = halfThickness(s) * L;

      const ux = x + nx * hw, uy = y + ny * hw, lx = x - nx * hw, ly = y - ny * hw;
      this.upX[k] = xp + (ux - xp) * cosP + (uy - yc) * sinP;
      this.upY[k] = yc + (uy - yc) * cosP - (ux - xp) * sinP;
      this.loX[k] = xp + (lx - xp) * cosP + (ly - yc) * sinP;
      this.loY[k] = yc + (ly - yc) * cosP - (lx - xp) * sinP;
      this.vyField[k] = this.vy[k] + this.vyb - (x - xp) * this.omega;
    }
    for (let d = 0; d < this.discK.length; d++) {
      const k = this.discK[d];
      this.discX[d] = 0.5 * (this.upX[k] + this.loX[k]);
      this.discY[d] = 0.5 * (this.upY[k] + this.loY[k]);
    }
    this.noseX = 0.5 * (this.upX[0] + this.loX[0]);
    this.noseY = 0.5 * (this.upY[0] + this.loY[0]);
  }

  // Streamwise motion from the net force on the body (cells^3/s^2, +x = right) and its mass (cells^2);
  // cellsPerPx converts the stored px/s velocity.
  advanceX(dt, force, mass, drag, cellsPerPx) {
    const v = this.vxb * cellsPerPx;
    const a = (force - drag * Math.abs(v) * v) / mass;
    this.vxb = (v + a * dt) / cellsPerPx;
    this.dx += this.vxb * dt;
  }

  draw(ctx, fillStyle) {
    ctx.beginPath();
    ctx.moveTo(this.upX[0], this.upY[0]);
    for (let k = 1; k < this.n; k++) ctx.lineTo(this.upX[k], this.upY[k]);
    for (let k = this.n - 1; k >= 0; k--) ctx.lineTo(this.loX[k], this.loY[k]);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
}
