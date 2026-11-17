import { createFluidSolver } from './fluid.js';
import { School } from './school.js';

const canvas = document.getElementById('c');
const container = document.getElementById('canvas-container');
const slider = document.getElementById('slider');
const countLabel = document.getElementById('count');
const modeBtn = document.getElementById('mode-btn');

let darkMode = true;

// ── size canvas to viewport (16:9-ish, left half fluid, right half school) ──

function resize() {
  const W = Math.min(window.innerWidth, window.innerHeight * 1.78);
  const H = W / 1.78;
  canvas.width = Math.floor(W);
  canvas.height = Math.floor(H);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
}
resize();
window.addEventListener('resize', () => { resize(); init(); });

// ── WebGL + 2D canvas overlay ─────────────────────────────────────────────

// We use two canvases: WebGL for fluid, 2D for swimmers on top
const glCanvas = document.createElement('canvas');
glCanvas.style.position = 'absolute';
glCanvas.style.top = '0'; glCanvas.style.left = '0';
glCanvas.style.width = '100%'; glCanvas.style.height = '100%';
glCanvas.style.pointerEvents = 'none';

const overlayCanvas = document.createElement('canvas');
overlayCanvas.style.position = 'absolute';
overlayCanvas.style.top = '0'; overlayCanvas.style.left = '0';
overlayCanvas.style.width = '100%'; overlayCanvas.style.height = '100%';
overlayCanvas.style.pointerEvents = 'none';

// Replace main canvas with layered setup
canvas.style.display = 'none';
container.appendChild(glCanvas);
container.appendChild(overlayCanvas);

let gl, fluid, school, ctx2d;
let lastTime = 0;

function init() {
  const W = canvas.width, H = canvas.height;
  glCanvas.width = W; glCanvas.height = H;
  overlayCanvas.width = W; overlayCanvas.height = H;

  gl = glCanvas.getContext('webgl2');
  if (!gl) { alert('WebGL2 not supported'); return; }

  fluid = createFluidSolver(gl, W, H);
  school = new School(W, H);
  school.setCount(parseInt(slider.value));

  ctx2d = overlayCanvas.getContext('2d');
}

init();

// ── UI ────────────────────────────────────────────────────────────────────

slider.addEventListener('input', () => {
  const n = parseInt(slider.value);
  countLabel.textContent = n;
  school.setCount(n);
});

modeBtn.addEventListener('click', () => {
  darkMode = !darkMode;
  modeBtn.textContent = darkMode ? '☀ Light' : '☾ Dark';
  document.body.style.background = darkMode ? '#000' : '#f5f5f0';
});

// ── loop ──────────────────────────────────────────────────────────────────

function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min((ts - lastTime) / 1000, 0.033);
  lastTime = ts;

  const W = canvas.width, H = canvas.height;

  // 1. Inject background flow + swimmer forces into fluid
  school.injectBackgroundFlow(fluid);
  school.injectFluid(fluid);

  // 2. Step fluid solver
  fluid.step(dt);

  // 3. Render fluid to WebGL canvas
  fluid.render(W, H, darkMode);

  // 4. Draw swimmers on 2D overlay
  ctx2d.clearRect(0, 0, W, H);
  school.draw(ctx2d, darkMode);

  // 5. Update swimmer positions
  school.update(dt);
}

requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(frame); });
