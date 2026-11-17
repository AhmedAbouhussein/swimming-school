// Tuna-profile swimmer with sinusoidal body-wave kinematics.

export class Swimmer {
  constructor(x, y, length) {
    this.x = x;
    this.y = y;
    this.length = length;
    this.phase = Math.random() * Math.PI * 2;
  }

  update(dt) {
    this.phase += dt * 3.5; // tail-beat frequency
  }

  // Returns array of {x,y} spine points from nose to tail
  getSpine(nPoints = 20) {
    const pts = [];
    for (let i = 0; i < nPoints; i++) {
      const t = i / (nPoints - 1); // 0=nose, 1=tail
      const bx = this.x - t * this.length;
      // body wave: amplitude grows toward tail, zero near head
      const amp = this.length * 0.08 * t * t;
      const wave = amp * Math.sin(2 * Math.PI * (t * 1.2 - this.phase * 0.5));
      pts.push({ x: bx, y: this.y + wave });
    }
    return pts;
  }

  // Tuna profile: half-width at normalized position t along body
  profileWidth(t) {
    // widest at t≈0.35, tapers sharply at tail
    const w = Math.sqrt(Math.max(0, t * (1 - t) * 4));
    const taper = Math.pow(1 - t, 0.6) * Math.pow(t + 0.05, 0.3);
    return w * taper * 0.52;
  }

  // Build polygon vertices for rendering
  getPolygon(nPoints = 24) {
    const spine = this.getSpine(nPoints);
    const upper = [], lower = [];

    for (let i = 0; i < nPoints; i++) {
      const t = i / (nPoints - 1);
      const hw = this.profileWidth(t) * this.length;

      // normal perpendicular to spine direction
      let nx = 0, ny = 1;
      if (i > 0 && i < nPoints - 1) {
        const dx = spine[i + 1].x - spine[i - 1].x;
        const dy = spine[i + 1].y - spine[i - 1].y;
        const len = Math.sqrt(dx * dx + dy * dy) + 1e-9;
        nx = -dy / len;
        ny = dx / len;
      }

      upper.push({ x: spine[i].x + nx * hw, y: spine[i].y + ny * hw });
      lower.push({ x: spine[i].x - nx * hw, y: spine[i].y - ny * hw });
    }

    // closed polygon: upper forward, lower backward
    return [...upper, ...lower.reverse()];
  }

  // Inject velocity into the fluid along the body outline
  injectFluid(fluidSolver, canvasW, canvasH) {
    const spine = this.getSpine(12);
    const baseVx = 0.004; // background flow speed (UV units per step)

    for (let i = 1; i < spine.length; i++) {
      const p = spine[i];
      const uvX = p.x / canvasW;
      const uvY = 1.0 - p.y / canvasH;

      // tangential velocity from body motion
      const dx = spine[i].x - spine[i - 1].x;
      const dy = spine[i].y - spine[i - 1].y;

      fluidSolver.splatVelocity(uvX, uvY, baseVx + dx * 0.5, -dy * 0.5, 0.012);
    }
  }
}
