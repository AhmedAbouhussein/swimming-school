// Slender tuna-like swimmer. Head on the left (nose at s=0), tail on the right (s=1).
// A body wave travels head -> tail, so thrust points left (upstream).

const WAVELENGTH = 1.0;          // body wavelength, in body lengths
const AMP_HEAD = 0.02;           // lateral amplitude at the nose (fraction of L)
const AMP_TAIL = 0.10;           // lateral amplitude at the tail (fraction of L)
const W_MAX = 0.055;             // max half-thickness (fraction of L)
const W_END = 0.18;              // half-thickness at the tail end, relative to W_MAX
const S_MAX = 0.30;              // position of max thickness
const N_POINTS = 48;

export function halfThickness(s) {
  if (s <= S_MAX) {
    const q = (S_MAX - s) / S_MAX;
    return W_MAX * Math.sqrt(Math.max(0, 1 - q * q));
  }
  const t = (s - S_MAX) / (1 - S_MAX);
  return W_MAX * (W_END + (1 - W_END) * (1 - Math.pow(t, 1.6)));
}

export class Swimmer {
  constructor(noseX, y, length, phase = 0) {
    this.noseX = noseX;
    this.y = y;
    this.length = length;
    this.phase = phase;
    this.n = N_POINTS;
    this.s = new Float32Array(N_POINTS);
    for (let k = 0; k < N_POINTS; k++) this.s[k] = 0.5 * (1 - Math.cos(Math.PI * k / (N_POINTS - 1)));
    this.upX = new Float32Array(N_POINTS);
    this.upY = new Float32Array(N_POINTS);
    this.loX = new Float32Array(N_POINTS);
    this.loY = new Float32Array(N_POINTS);
    this.vy = new Float32Array(N_POINTS); // lateral body velocity, canvas px/s (y down)
  }

  update(time, freq) {
    const L = this.length;
    const TWO_PI = 2 * Math.PI;
    for (let k = 0; k < this.n; k++) {
      const s = this.s[k];
      const a = AMP_HEAD + (AMP_TAIL - AMP_HEAD) * s * s;
      const da = 2 * (AMP_TAIL - AMP_HEAD) * s;
      const th = TWO_PI * (s / WAVELENGTH - freq * time) + this.phase;
      const sn = Math.sin(th), cs = Math.cos(th);

      const h = L * a * sn;
      const dhds = L * (da * sn + a * cs * TWO_PI / WAVELENGTH);
      this.vy[k] = -L * a * TWO_PI * freq * cs;

      const x = this.noseX + s * L;
      const y = this.y + h;
      const norm = Math.hypot(L, dhds);
      const nx = -dhds / norm, ny = L / norm;
      const hw = halfThickness(s) * L;

      this.upX[k] = x + nx * hw; this.upY[k] = y + ny * hw;
      this.loX[k] = x - nx * hw; this.loY[k] = y - ny * hw;
    }
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
