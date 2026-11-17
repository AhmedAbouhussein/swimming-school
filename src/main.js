import { createFluidSolver } from './fluid.js';
import { School } from './school.js';

const container   = document.getElementById('canvas-container');
const glCanvas    = document.getElementById('gl-canvas');
const overlay     = document.getElementById('overlay-canvas');
const slider      = document.getElementById('slider');
const countLabel  = document.getElementById('count');
const modeBtn     = document.getElementById('mode-btn');

let darkMode = true;
let gl, fluid, school, ctx2d;
let lastTime = 0;

// ── sizing ────────────────────────────────────────────────────────────────

function computeSize() {
  const maxW = window.innerWidth  - 4;
  const maxH = window.innerHeight - 4;
  const aspect = 16 / 9;
  let W = maxW;
  let H = W / aspect;
  if (H > maxH) { H = maxH; W = H * aspect; }
  return { W: Math.floor(W), H: Math.floor(H) };
}

function applySize(W, H) {
  container.style.width  = W + 'px';
  container.style.height = H + 'px';
  for (const c of [glCanvas, overlay]) {
    c.width  = W; c.height = H;
    c.style.width  = W + 'px';
    c.style.height = H + 'px';
  }
}

// ── init / reinit ─────────────────────────────────────────────────────────

function init() {
  const { W, H } = computeSize();
  applySize(W, H);

  gl = glCanvas.getContext('webgl2');
  if (!gl) {
    glCanvas.style.background = '#111';
    glCanvas.getContext('2d')
      ?.fillText('WebGL2 not supported in this browser', 20, 40);
    return;
  }

  fluid  = createFluidSolver(gl, W, H);
  school = new School(W, H);
  school.setCount(parseInt(slider.value));
  ctx2d  = overlay.getContext('2d');
}

window.addEventListener('resize', () => {
  const { W, H } = computeSize();
  applySize(W, H);
  if (school) school.resize(W, H);
  if (fluid)  fluid  = createFluidSolver(gl, W, H);
});

init();

// ── UI ────────────────────────────────────────────────────────────────────

slider.addEventListener('input', () => {
  const n = parseInt(slider.value);
  countLabel.textContent = n;
  school?.setCount(n);
});

modeBtn.addEventListener('click', () => {
  darkMode = !darkMode;
  modeBtn.textContent = darkMode ? '☀ Light' : '☾ Dark';
  document.body.style.background = darkMode ? '#000' : '#f0f0eb';
});

// ── loop ──────────────────────────────────────────────────────────────────

function frame(ts) {
  requestAnimationFrame(frame);
  if (!fluid || !school || !ctx2d) return;

  const dt = Math.min((ts - lastTime) / 1000, 0.033);
  lastTime = ts;

  const W = glCanvas.width;
  const H = glCanvas.height;

  school.injectBackgroundFlow(fluid);
  school.injectFluid(fluid);
  fluid.step(dt);
  fluid.render(W, H, darkMode);

  ctx2d.clearRect(0, 0, W, H);
  school.draw(ctx2d, darkMode);
  school.update(dt);
}

requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(frame); });
