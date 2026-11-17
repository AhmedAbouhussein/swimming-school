import { createFluidSolver } from './fluid.js?v=8';
import { School } from './school.js?v=8';

function showError(msg) {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c00;color:#fff;padding:12px;z-index:999;font-size:13px;white-space:pre-wrap;';
  el.textContent = msg;
  document.body.appendChild(el);
}
window.addEventListener('error', e => showError(`JS Error: ${e.message}\n${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', e => showError(`Unhandled: ${e.reason}`));

const params = new URLSearchParams(location.search);
const container  = document.getElementById('canvas-container');
const glCanvas   = document.getElementById('gl-canvas');
const overlay    = document.getElementById('overlay-canvas');
const slider     = document.getElementById('slider');
const countLabel = document.getElementById('count');
const modeBtn    = document.getElementById('mode-btn');
const effLabel   = document.getElementById('eff');
const signBtn    = document.getElementById('sign-btn');
const holdBtn    = document.getElementById('hold-btn');
const errLabel   = document.getElementById('err');
const debugEl    = document.getElementById('debug');
let frameNo = 0;

let darkMode = params.get('mode') !== 'light';
let signMode = params.get('sign') === '1';
let hold = params.get('hold') !== '0';
const pushDirs = { upstream: [-1, 0], downstream: [1, 0], up: [0, -1], down: [0, 1] };
const pushDir = pushDirs[params.get('push')];
const pushAt = parseFloat(params.get('pushAt') || '6');
let pushed = false;
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

function applyHold() {
  school.hold = hold;
  holdBtn.classList.toggle('on', hold);
}

function applyMode() {
  signBtn.classList.toggle('on', signMode);
  modeBtn.textContent = darkMode ? '☀ Light' : '☾ Dark';
  document.body.style.background = darkMode ? '#000' : '#fff';
}

function flowOf(W) {
  return { inflow: fluid.inflow, cellsPerPx: fluid.simW / W };
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
  school.hold = hold;
}

function init() {
  gl = glCanvas.getContext('webgl2');
  if (!gl) { showError('WebGL2 is not supported in this browser.'); return; }
  ctx2d = overlay.getContext('2d');
  try { build(); } catch (e) { showError(`Fluid solver failed: ${e.message}`); }
  applyMode();
  applyHold();
  const warm = parseInt(params.get('warm') || '0');
  for (let i = 0; i < warm && fluid; i++) tick(1 / 60);
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
});

signBtn.addEventListener('click', () => {
  signMode = !signMode;
  fluid?.setSign(signMode);
  signBtn.classList.toggle('on', signMode);
});

holdBtn.addEventListener('click', () => {
  hold = !hold;
  applyHold();
});

container.addEventListener('click', e => {
  if (!school || e.target.closest('#ui')) return;
  const r = container.getBoundingClientRect();
  school.pushAt(e.clientX - r.left, e.clientY - r.top);
});

modeBtn.addEventListener('click', () => {
  darkMode = !darkMode;
  applyMode();
});

function tick(dt) {
  if (pushDir && !pushed && school.time >= pushAt) { pushed = true; school.pushAll(pushDir[0] * 0.5, pushDir[1] * 0.5); }
  school.update(dt);
  fluid.step(dt, school.bodyStrips());
  if (frameNo++ % 4 === 0) school.setLocalFlow(fluid.probe(school.probePoints()));
  if (frameNo % 10 === 0) {
    const eff = school.efficiency().mean, off = school.offset();
    effLabel.textContent = Math.round(eff * 100) + '%';
    errLabel.textContent = off.toFixed(2) + ' L';
    if (!debugEl.hidden && frameNo % 30 === 0) {
      const s = school.swimmers[0], L = s.length;
      log.push(`t=${school.time.toFixed(1).padStart(5)} dx=${(s.dx / L).toFixed(2)} dy=${(s.dy / L).toFixed(2)} psi=${s.psi.toFixed(2)} f=${s.ctrl.f.toFixed(2)} eta=${Math.round(eff * 100)}% off=${off.toFixed(2)}`);
      if (log.length > 40) log.shift();
      debugEl.textContent = log.join('\n');
    }
  }
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
