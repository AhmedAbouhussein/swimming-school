import { createFluidSolver } from './fluid.js?v=13';
import { School } from './school.js?v=13';

function showError(msg) {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c00;color:#fff;padding:12px;z-index:999;font-size:13px;white-space:pre-wrap;';
  el.textContent = msg;
  document.body.appendChild(el);
}
window.addEventListener('error', e => showError(`JS Error: ${e.message}\n${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => showError(`Unhandled: ${e.reason}`));

const CRUISE = 40;   // reference speed, sim cells/s: sets the beat frequency (f = K U / L)

const params = new URLSearchParams(location.search);
const container  = document.getElementById('canvas-container');
const glCanvas   = document.getElementById('gl-canvas');
const overlay    = document.getElementById('overlay-canvas');
const slider     = document.getElementById('slider');
const countLabel = document.getElementById('count');
const modeBtn    = document.getElementById('mode-btn');
const signBtn    = document.getElementById('sign-btn');
const speedLabel = document.getElementById('speed');
const debugEl    = document.getElementById('debug');
let frameNo = 0;

let darkMode = params.get('mode') !== 'light';
let signMode = params.get('sign') === '1';
const log = [];
if (params.get('debug')) debugEl.hidden = false;
let gl, fluid, school, ctx2d;
let lastTime = 0;

if (params.get('n')) {
  const n = Math.max(1, Math.min(20, parseInt(params.get('n'))));
  slider.value = n;
  countLabel.textContent = n;
}

function computeSize() {
  const maxW = window.innerWidth - 4;
  const maxH = window.innerHeight - 4;
  const aspect = 16 / 9;
  let W = maxW;
  let H = W / aspect;
  if (H > maxH) { H = maxH; W = H * aspect; }
  return { W: Math.floor(W), H: Math.floor(H) };
}

function applySize(W, H) {
  container.style.width = W + 'px';
  container.style.height = H + 'px';
  for (const c of [glCanvas, overlay]) {
    c.width = W; c.height = H;
    c.style.width = W + 'px';
    c.style.height = H + 'px';
  }
}

function applyMode() {
  signBtn.classList.toggle('on', signMode);
  modeBtn.textContent = darkMode ? '☀ Light' : '☾ Dark';
  document.body.style.background = darkMode ? '#000' : '#fff';
}

function flowOf(W) {
  return { cruise: CRUISE, cellsPerPx: fluid.simW / W };
}

function build() {
  const { W, H } = computeSize();
  applySize(W, H);
  fluid = createFluidSolver(gl, W, H);
  fluid.setSign(signMode);
  if (school) school.resize(W, H, flowOf(W));
  else {
    school = new School(W, H, flowOf(W));
    school.setCount(parseInt(slider.value));
  }
}

function init() {
  gl = glCanvas.getContext('webgl2');
  if (!gl) { showError('WebGL2 is not supported in this browser.'); return; }
  ctx2d = overlay.getContext('2d');
  try { build(); } catch (e) { showError(`Fluid solver failed: ${e.message}`); }
  applyMode();
  const warm = parseInt(params.get('warm') || '0');
  const warmDt = parseFloat(params.get('dt') || String(1 / 60));
  for (let i = 0; i < warm && fluid; i++) tick(warmDt);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { try { build(); } catch (e) { showError(e.message); } }, 150);
});

slider.addEventListener('input', () => {
  const n = parseInt(slider.value);
  countLabel.textContent = n;
  school?.setCount(n);
  fluid?.clear();
});

signBtn.addEventListener('click', () => {
  signMode = !signMode;
  fluid?.setSign(signMode);
  signBtn.classList.toggle('on', signMode);
});

modeBtn.addEventListener('click', () => {
  darkMode = !darkMode;
  applyMode();
});

function tick(dt) {
  school.update(dt);
  fluid.step(dt, school.bodyStrips());
  school.setImpulse(fluid.impulse(), dt);
  frameNo++;
  if (frameNo % 10 === 0) speedLabel.textContent = school.speed().toFixed(2) + ' L/s';
  if (!debugEl.hidden && frameNo % 30 === 0) {
    const s = school.swimmers[0];
    log.push(`t=${school.time.toFixed(1).padStart(5)} x=${(s.noseX / school.W).toFixed(2)}W speed=${school.speed().toFixed(3)}L/s beatF=${school.beatForce.toFixed(1)}`);
    if (log.length > 40) log.shift();
    debugEl.textContent = log.join('\n');
  }
  if (school.finished()) { school.restart(); fluid.clear(); }
}

function frame(ts) {
  requestAnimationFrame(frame);
  if (!fluid || !school || !ctx2d) return;

  const dt = Math.min((ts - lastTime) / 1000, 0.033);
  lastTime = ts;
  const W = glCanvas.width, H = glCanvas.height;

  tick(dt);
  fluid.render(W, H, darkMode);

  ctx2d.clearRect(0, 0, W, H);
  school.draw(ctx2d, darkMode);
}

init();
requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(frame); });
