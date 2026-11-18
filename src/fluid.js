// Stable-fluids (Stam) solver in WebGL2, set up as a wind tunnel:
//   - a steady current U enters at the left edge and leaves through the open right edge,
//   - top/bottom are free-slip walls,
//   - swimmers are moving solid bodies stamped into the velocity field (no-slip), so they
//     shed real wake vortices into the current.
// Units: velocity in sim cells/s, time in seconds.
// The stored field is the perturbation from the free stream (u - U), which keeps half-float precision
// meaningful; the uniform U is added back when advecting.

const SIM_H = 288;
const INFLOW = 40;          // cells/s
const PRESSURE_ITERS = 40;
const CONFINEMENT = 6;
const GATE_LO = 0.3, GATE_HI = 1.2; // confinement only acts where |vorticity| is already significant (else it amplifies noise)
const STAMP_MODE = new URLSearchParams(location.search).get('stamp') || 'lateral';

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const BODY_VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_vel;
out vec2 v_vel;
void main() { v_vel = a_vel; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_texel;
`;

const BODY_FRAG = `#version 300 es
precision highp float;
in vec2 v_vel;
uniform float u_inflow;
out vec4 o;
void main() { o = vec4(v_vel - vec2(u_inflow, 0.0), 0.0, 1.0); }`;

const ADVECT = HEAD + `
uniform sampler2D u_vel;
uniform float u_dt, u_inflow;
void main() {
  vec2 vel = texture(u_vel, v_uv).xy + vec2(u_inflow, 0.0);
  vec2 prev = v_uv - vel * u_dt * u_texel;
  vec2 r = texture(u_vel, prev).xy;
  if (v_uv.x < 2.5 * u_texel.x) r = vec2(0.0);
  if (v_uv.y < u_texel.y || v_uv.y > 1.0 - u_texel.y) r.y = 0.0;
  o = vec4(r, 0.0, 1.0);
}`;

const PROBE = HEAD + `
uniform sampler2D u_vel;
uniform vec2 u_pts[24];
uniform float u_inflow;
void main() {
  vec2 p = u_pts[int(gl_FragCoord.x)];
  vec2 v = texture(u_vel, p).xy;
  o = vec4(v.x + u_inflow, v.y, 0.0, 1.0);
}`;

const CURL = HEAD + `
uniform sampler2D u_vel;
void main() {
  float l = texture(u_vel, v_uv - vec2(u_texel.x, 0.0)).y;
  float r = texture(u_vel, v_uv + vec2(u_texel.x, 0.0)).y;
  float t = texture(u_vel, v_uv + vec2(0.0, u_texel.y)).x;
  float b = texture(u_vel, v_uv - vec2(0.0, u_texel.y)).x;
  o = vec4(0.5 * ((r - l) - (t - b)), 0.0, 0.0, 1.0);
}`;

const CONFINE = HEAD + `
uniform sampler2D u_vel, u_curl;
uniform float u_dt, u_eps;
void main() {
  float l = texture(u_curl, v_uv - vec2(u_texel.x, 0.0)).x;
  float r = texture(u_curl, v_uv + vec2(u_texel.x, 0.0)).x;
  float t = texture(u_curl, v_uv + vec2(0.0, u_texel.y)).x;
  float b = texture(u_curl, v_uv - vec2(0.0, u_texel.y)).x;
  float c = texture(u_curl, v_uv).x;
  vec2 g = 0.5 * vec2(abs(r) - abs(l), abs(t) - abs(b));
  vec2 n = g / (length(g) + 1e-5);
  vec2 f = u_eps * vec2(n.y, -n.x) * c * smoothstep(${GATE_LO.toFixed(2)}, ${GATE_HI.toFixed(2)}, abs(c));
  if (v_uv.x < 6.0 * u_texel.x) f = vec2(0.0);
  vec2 v = texture(u_vel, v_uv).xy + u_dt * f;
  o = vec4(v, 0.0, 1.0);
}`;

const DIVERGENCE = HEAD + `
uniform sampler2D u_vel;
void main() {
  float l = texture(u_vel, v_uv - vec2(u_texel.x, 0.0)).x;
  float r = texture(u_vel, v_uv + vec2(u_texel.x, 0.0)).x;
  float t = texture(u_vel, v_uv + vec2(0.0, u_texel.y)).y;
  float b = texture(u_vel, v_uv - vec2(0.0, u_texel.y)).y;
  o = vec4(0.5 * ((r - l) + (t - b)), 0.0, 0.0, 1.0);
}`;

const PRESSURE_FETCH = `
float P(vec2 uv) { return uv.x > 1.0 ? 0.0 : texture(u_p, uv).x; }
`;

const JACOBI = HEAD + `
uniform sampler2D u_p, u_div;
` + PRESSURE_FETCH + `
void main() {
  float l = P(v_uv - vec2(u_texel.x, 0.0));
  float r = P(v_uv + vec2(u_texel.x, 0.0));
  float t = P(v_uv + vec2(0.0, u_texel.y));
  float b = P(v_uv - vec2(0.0, u_texel.y));
  float d = texture(u_div, v_uv).x;
  o = vec4(0.25 * (l + r + t + b - d), 0.0, 0.0, 1.0);
}`;

const GRADIENT = HEAD + `
uniform sampler2D u_p, u_vel;
` + PRESSURE_FETCH + `
void main() {
  float l = P(v_uv - vec2(u_texel.x, 0.0));
  float r = P(v_uv + vec2(u_texel.x, 0.0));
  float t = P(v_uv + vec2(0.0, u_texel.y));
  float b = P(v_uv - vec2(0.0, u_texel.y));
  vec2 v = texture(u_vel, v_uv).xy - 0.5 * vec2(r - l, t - b);
  if (v_uv.x < 2.5 * u_texel.x) v = vec2(0.0);
  if (v_uv.y < u_texel.y || v_uv.y > 1.0 - u_texel.y) v.y = 0.0;
  o = vec4(v, 0.0, 1.0);
}`;

const DISPLAY = HEAD + `
uniform sampler2D u_curl;
uniform float u_dark, u_sign;
void main() {
  float ws = texture(u_curl, v_uv).x;
  float w = abs(ws);
  float a = smoothstep(0.6, 3.0, w);
  vec3 bg = mix(vec3(1.0), vec3(0.0), u_dark);
  vec3 ink = mix(vec3(0.95, 0.42, 0.42), vec3(0.18, 0.95, 0.45), u_dark);
  if (u_sign > 0.5) ink = ws > 0.0 ? vec3(1.0, 0.25, 0.2) : vec3(0.25, 0.55, 1.0);
  o = vec4(mix(bg, ink, a), 1.0);
}`;

export function createFluidSolver(gl, W, H) {
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not supported');

  const simH = SIM_H;
  const simW = Math.round(SIM_H * W / H);
  const texel = [1 / simW, 1 / simH];

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      loc[name] = gl.getUniformLocation(p, name);
    }
    return { p, loc };
  }
  function target(internal, format, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, simW, simH, 0, format, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('framebuffer incomplete for internal format ' + internal);
    }
    return { tex, fbo };
  }
  function pair(internal, format, filter) {
    const a = target(internal, format, filter), b = target(internal, format, filter);
    return { read: a, write: b, swap() { const t = this.read; this.read = this.write; this.write = t; } };
  }

  // velocity: half float, bilinear (needed for advection). pressure/divergence: full float, nearest.
  const velocity = pair(gl.RG16F, gl.RG, gl.LINEAR);
  const pressure = pair(gl.R32F, gl.RED, gl.NEAREST);
  const divergence = target(gl.R32F, gl.RED, gl.NEAREST);
  const curl = target(gl.R16F, gl.RED, gl.LINEAR);
  const probeT = (() => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 24, 1, 0, gl.RGBA, gl.FLOAT, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  })();
  const probeOut = new Float32Array(24 * 4);
  let debugSign = new URLSearchParams(location.search).get('sign') === '1';

  for (const t of [velocity.read, velocity.write]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
  }
  for (const t of [pressure.read, pressure.write]) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
  }

  const progs = {
    advect: program(VERT, ADVECT),
    probe: program(VERT, PROBE),
    curl: program(VERT, CURL),
    confine: program(VERT, CONFINE),
    div: program(VERT, DIVERGENCE),
    jacobi: program(VERT, JACOBI),
    grad: program(VERT, GRADIENT),
    display: program(VERT, DISPLAY),
    body: program(BODY_VERT, BODY_FRAG),
  };

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // swimmer strips: [x, y, vx, vy] per vertex
  const bodyVao = gl.createVertexArray();
  gl.bindVertexArray(bodyVao);
  const bodyBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bodyBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindVertexArray(null);

  function bindTex(unit, tex, loc) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  function pass(prog, out, setup) {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, simW, simH);
    gl.uniform2f(prog.loc.u_texel, texel[0], texel[1]);
    setup(prog.loc);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function stamp(strips) {
    gl.useProgram(progs.body.p);
    gl.uniform1f(progs.body.loc.u_inflow, INFLOW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, velocity.read.fbo);
    gl.viewport(0, 0, simW, simH);
    gl.bindVertexArray(bodyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bodyBuf);
    if (STAMP_MODE === 'lateral') gl.colorMask(false, true, false, false);
    for (const s of strips) {
      gl.bufferData(gl.ARRAY_BUFFER, s, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, s.length / 4);
    }
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(null);
  }

  function computeCurl() {
    pass(progs.curl, curl, L => bindTex(0, velocity.read.tex, L.u_vel));
  }

  function step(dt, strips) {
    gl.disable(gl.BLEND);

    pass(progs.advect, velocity.write, L => {
      bindTex(0, velocity.read.tex, L.u_vel);
      gl.uniform1f(L.u_dt, dt);
      gl.uniform1f(L.u_inflow, INFLOW);
    });
    velocity.swap();

    computeCurl();
    pass(progs.confine, velocity.write, L => {
      bindTex(0, velocity.read.tex, L.u_vel);
      bindTex(1, curl.tex, L.u_curl);
      gl.uniform1f(L.u_dt, dt);
      gl.uniform1f(L.u_eps, CONFINEMENT);
    });
    velocity.swap();

    stamp(strips);

    pass(progs.div, divergence, L => bindTex(0, velocity.read.tex, L.u_vel));
    for (let i = 0; i < PRESSURE_ITERS; i++) {
      pass(progs.jacobi, pressure.write, L => {
        bindTex(0, pressure.read.tex, L.u_p);
        bindTex(1, divergence.tex, L.u_div);
      });
      pressure.swap();
    }
    pass(progs.grad, velocity.write, L => {
      bindTex(0, pressure.read.tex, L.u_p);
      bindTex(1, velocity.read.tex, L.u_vel);
    });
    velocity.swap();

    stamp(strips);
    computeCurl();
  }

  function render(w, h, dark) {
    gl.useProgram(progs.display.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(progs.display.loc.u_texel, texel[0], texel[1]);
    bindTex(0, curl.tex, progs.display.loc.u_curl);
    gl.uniform1f(progs.display.loc.u_dark, dark ? 1 : 0);
    gl.uniform1f(progs.display.loc.u_sign, debugSign ? 1 : 0);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Total streamwise velocity (cells/s) at points given in canvas pixels.
  function probe(pts) {
    const n = Math.min(pts.length, 24);
    const uv = new Float32Array(48);
    for (let i = 0; i < n; i++) { uv[2 * i] = pts[i][0] / W; uv[2 * i + 1] = 1 - pts[i][1] / H; }
    gl.useProgram(progs.probe.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, probeT.fbo);
    gl.viewport(0, 0, n, 1);
    bindTex(0, velocity.read.tex, progs.probe.loc.u_vel);
    gl.uniform2fv(progs.probe.loc['u_pts[0]'], uv);
    gl.uniform1f(progs.probe.loc.u_inflow, INFLOW);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, probeOut);
    const out = [];
    for (let i = 0; i < n; i++) out.push(probeOut[4 * i]);
    return out;
  }

  return { step, render, probe, setSign(v) { debugSign = v; }, inflow: INFLOW, simW, simH };
}
