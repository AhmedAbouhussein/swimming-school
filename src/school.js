// Harlequin diamond formation for a school of swimmers.
// Fish are added in pairs, alternating right/left, building a chain of diamond cells.
// The lead fish is at the front-center of the right half.

import { Swimmer } from './swimmer.js';

// Diamond lattice parameters (in units of swimmer body length)
const DX = 1.4;  // stream-wise spacing between rows
const DY = 1.1;  // lateral half-spacing (each side of center)

// Harlequin ordering: index → {row, side}
// row 0: lead (0, 0)
// row 1: (1, +DY), (1, -DY)
// row 2: (2, +DY), (2, -DY)
// ...
// Each set of 4 adjacent fish (rows r, r+1) encloses one diamond cell.
function formationPosition(index) {
  if (index === 0) return { rowOffset: 0, lateralOffset: 0 };
  const pair = Math.ceil(index / 2);
  const isRight = index % 2 === 1;
  return {
    rowOffset: pair,
    lateralOffset: isRight ? DY : -DY,
  };
}

export class School {
  constructor(canvasW, canvasH) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.swimmers = [];
    this.targetN = 7;
    this.setCount(7);
  }

  // Compute base length so the formation fits in the right half
  computeBodyLength(n) {
    if (n === 0) return 0;
    const maxRows = n <= 1 ? 0 : Math.ceil((n - 1) / 2);
    const formationH = (maxRows + 1) * DX;  // stream-wise extent
    const maxLateral = n <= 1 ? 0 : DY * 2; // lateral extent (both sides)

    // Available region: right half = canvasW/2 wide, full canvasH tall
    const availW = this.canvasH * 0.78;   // stream-wise fits in vertical
    const availH = this.canvasW * 0.44;   // lateral fits in horizontal (right half)

    const maxByH = availW / (formationH + 1.5);
    const maxByW = n <= 1 ? maxByH : availH / (maxLateral + 1.5);

    return Math.min(maxByH, maxByW, this.canvasH * 0.13);
  }

  resize(w, h) {
    this.canvasW = w;
    this.canvasH = h;
    this.setCount(this.targetN);
  }

  setCount(n) {
    this.targetN = n;
    const bodyLen = this.computeBodyLength(n);

    // Formation origin: right half, vertically centered
    const originX = this.canvasW * 0.72;
    const originY = this.canvasH * 0.5;

    this.swimmers = [];
    for (let i = 0; i < n; i++) {
      const pos = formationPosition(i);
      const x = originX - pos.rowOffset * DX * bodyLen;
      const y = originY + pos.lateralOffset * bodyLen;
      const s = new Swimmer(x, y, bodyLen);
      // Stagger phases so they don't all beat in sync
      s.phase = i * (Math.PI / 3);
      this.swimmers.push(s);
    }
  }

  update(dt) {
    this.swimmers.forEach(s => s.update(dt));
  }

  injectFluid(fluidSolver) {
    this.swimmers.forEach(s => s.injectFluid(fluidSolver, this.canvasW, this.canvasH));
  }

  // Inject a uniform background flow left→right
  injectBackgroundFlow(fluidSolver) {
    const rows = 18;
    for (let r = 0; r < rows; r++) {
      const uvY = (r + 0.5) / rows;
      fluidSolver.splatVelocity(0.05, uvY, 0.006, 0.0, 0.025);
    }
  }

  draw(ctx, darkMode) {
    this.swimmers.forEach(s => this._drawSwimmer(ctx, s, darkMode));
  }

  _drawSwimmer(ctx, swimmer, darkMode) {
    const poly = swimmer.getPolygon(28);
    if (poly.length < 3) return;

    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();

    ctx.fillStyle = darkMode ? '#3A6EA5' : '#1a1a2e';
    ctx.fill();
  }
}
