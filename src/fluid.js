// 2D Navier-Stokes fluid solver on WebGL2 textures.
// Ping-pong FBOs for velocity, pressure, dye.

export function createFluidSolver(gl, width, height) {
  const ext = gl.getExtension('EXT_color_buffer_float');
  if (!ext) throw new Error('EXT_color_buffer_float not supported');

  // ── shader sources ────────────────────────────────────────────────────────

  const vsQuad = `#version 300 es
    in vec2 a_pos;
    out vec2 v_uv;
    void main() {
      v_uv = a_pos * 0.5 + 0.5;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }`;

  const fsAdvect = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform sampler2D u_source;
    uniform float u_dt;
    uniform vec2 u_texel;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      vec2 vel = texture(u_velocity, v_uv).xy;
      vec2 prev = v_uv - vel * u_dt * u_texel;
      fragColor = texture(u_source, prev);
    }`;

  const fsDivergence = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform vec2 u_texel;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      float l = texture(u_velocity, v_uv - vec2(u_texel.x, 0.0)).x;
      float r = texture(u_velocity, v_uv + vec2(u_texel.x, 0.0)).x;
      float b = texture(u_velocity, v_uv - vec2(0.0, u_texel.y)).y;
      float t = texture(u_velocity, v_uv + vec2(0.0, u_texel.y)).y;
      fragColor = vec4((r - l + t - b) * 0.5, 0.0, 0.0, 1.0);
    }`;

  const fsPressure = `#version 300 es
    precision highp float;
    uniform sampler2D u_pressure;
    uniform sampler2D u_divergence;
    uniform vec2 u_texel;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      float l = texture(u_pressure, v_uv - vec2(u_texel.x, 0.0)).x;
      float r = texture(u_pressure, v_uv + vec2(u_texel.x, 0.0)).x;
      float b = texture(u_pressure, v_uv - vec2(0.0, u_texel.y)).x;
      float t = texture(u_pressure, v_uv + vec2(0.0, u_texel.y)).x;
      float div = texture(u_divergence, v_uv).x;
      fragColor = vec4((l + r + b + t - div) * 0.25, 0.0, 0.0, 1.0);
    }`;

  const fsSubtract = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform sampler2D u_pressure;
    uniform vec2 u_texel;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      float l = texture(u_pressure, v_uv - vec2(u_texel.x, 0.0)).x;
      float r = texture(u_pressure, v_uv + vec2(u_texel.x, 0.0)).x;
      float b = texture(u_pressure, v_uv - vec2(0.0, u_texel.y)).x;
      float t = texture(u_pressure, v_uv + vec2(0.0, u_texel.y)).x;
      vec2 vel = texture(u_velocity, v_uv).xy;
      vel -= vec2(r - l, t - b) * 0.5;
      fragColor = vec4(vel, 0.0, 1.0);
    }`;

  const fsVorticity = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform vec2 u_texel;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      float l = texture(u_velocity, v_uv - vec2(u_texel.x, 0.0)).y;
      float r = texture(u_velocity, v_uv + vec2(u_texel.x, 0.0)).y;
      float b = texture(u_velocity, v_uv - vec2(0.0, u_texel.y)).x;
      float t = texture(u_velocity, v_uv + vec2(0.0, u_texel.y)).x;
      fragColor = vec4((r - l - t + b) * 0.5, 0.0, 0.0, 1.0);
    }`;

  const fsVortForce = `#version 300 es
    precision highp float;
    uniform sampler2D u_velocity;
    uniform sampler2D u_vorticity;
    uniform vec2 u_texel;
    uniform float u_curl;
    uniform float u_dt;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      float l = abs(texture(u_vorticity, v_uv - vec2(u_texel.x, 0.0)).x);
      float r = abs(texture(u_vorticity, v_uv + vec2(u_texel.x, 0.0)).x);
      float b = abs(texture(u_vorticity, v_uv - vec2(0.0, u_texel.y)).x);
      float t = abs(texture(u_vorticity, v_uv + vec2(0.0, u_texel.y)).x);
      float vort = texture(u_vorticity, v_uv).x;
      vec2 force = vec2(t - b, r - l);
      float len = length(force) + 1e-5;
      force = force / len * u_curl * vort;
      vec2 vel = texture(u_velocity, v_uv).xy;
      fragColor = vec4(vel + force * u_dt, 0.0, 1.0);
    }`;

  const fsSplat = `#version 300 es
    precision highp float;
    uniform sampler2D u_base;
    uniform vec2 u_point;
    uniform vec2 u_value;
    uniform float u_radius;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      float d = length(v_uv - u_point);
      float w = exp(-d * d / u_radius);
      vec2 base = texture(u_base, v_uv).xy;
      fragColor = vec4(base + u_value * w, 0.0, 1.0);
    }`;

  const fsDye = `#version 300 es
    precision highp float;
    uniform sampler2D u_dye;
    uniform sampler2D u_vorticity;
    uniform float u_darkMode;
    in vec2 v_uv;
    out vec4 fragColor;
    void main() {
      float dye = texture(u_dye, v_uv).x;
      float vort = texture(u_vorticity, v_uv).x;
      float v = clamp(vort * 4.0, -1.0, 1.0);

      vec3 col;
      if (u_darkMode > 0.5) {
        // dark: black bg, green vortices
        float pos = max(v, 0.0);
        float neg = max(-v, 0.0);
        col = vec3(neg * 0.3, pos * 0.9 + neg * 0.4, neg * 0.3);
      } else {
        // light: white bg, red vortices
        float pos = max(v, 0.0);
        float neg = max(-v, 0.0);
        col = vec3(1.0 - neg * 0.0, 1.0 - pos * 0.65 - neg * 0.35, 1.0 - pos * 0.65 - neg * 0.0);
      }
      fragColor = vec4(col, 1.0);
    }`;

  // ── compile ────────────────────────────────────────────────────────────────

  function compile(vsSrc, fsSrc) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs));

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs));

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    return prog;
  }

  const progAdvect    = compile(vsQuad, fsAdvect);
  const progDiv       = compile(vsQuad, fsDivergence);
  const progPressure  = compile(vsQuad, fsPressure);
  const progSubtract  = compile(vsQuad, fsSubtract);
  const progVorticity = compile(vsQuad, fsVorticity);
  const progVortForce = compile(vsQuad, fsVortForce);
  const progSplat     = compile(vsQuad, fsSplat);
  const progDye       = compile(vsQuad, fsDye);

  // ── quad VAO ───────────────────────────────────────────────────────────────

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function bindAttr(prog) {
    gl.bindAttribLocation(prog, 0, 'a_pos');
    gl.linkProgram(prog);
  }
  [progAdvect,progDiv,progPressure,progSubtract,progVorticity,progVortForce,progSplat,progDye]
    .forEach(bindAttr);

  // ── FBO helpers ────────────────────────────────────────────────────────────

  function makeFBO(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, w, h, 0, gl.RG, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  function makeScalarFBO(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  function makePing(w, h, scalar = false) {
    const a = scalar ? makeScalarFBO(w, h) : makeFBO(w, h);
    const b = scalar ? makeScalarFBO(w, h) : makeFBO(w, h);
    return { read: a, write: b, swap() { const t = this.read; this.read = this.write; this.write = t; } };
  }

  const SIM = 256;
  let velocity  = makePing(SIM, SIM);
  let pressure  = makePing(SIM, SIM, true);
  let divergence= makeScalarFBO(SIM, SIM);
  let vorticity = makeScalarFBO(SIM, SIM);

  // ── draw helpers ──────────────────────────────────────────────────────────

  function useProgram(prog) { gl.useProgram(prog); gl.bindVertexArray(vao); }

  function setTex(prog, name, unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
  }

  function drawToFBO(fbo, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  const texelX = 1 / SIM, texelY = 1 / SIM;

  // ── splat velocity ─────────────────────────────────────────────────────────

  function splatVelocity(uvX, uvY, vx, vy, radius) {
    useProgram(progSplat);
    setTex(progSplat, 'u_base', 0, velocity.read.tex);
    gl.uniform2f(gl.getUniformLocation(progSplat, 'u_point'), uvX, uvY);
    gl.uniform2f(gl.getUniformLocation(progSplat, 'u_value'), vx, vy);
    gl.uniform1f(gl.getUniformLocation(progSplat, 'u_radius'), radius * radius);
    drawToFBO(velocity.write.fbo, SIM, SIM);
    velocity.swap();
  }

  // ── step ──────────────────────────────────────────────────────────────────

  function step(dt) {
    gl.disable(gl.BLEND);

    // advect velocity
    useProgram(progAdvect);
    setTex(progAdvect, 'u_velocity', 0, velocity.read.tex);
    setTex(progAdvect, 'u_source',   1, velocity.read.tex);
    gl.uniform1f(gl.getUniformLocation(progAdvect, 'u_dt'), dt * SIM);
    gl.uniform2f(gl.getUniformLocation(progAdvect, 'u_texel'), texelX, texelY);
    drawToFBO(velocity.write.fbo, SIM, SIM);
    velocity.swap();

    // vorticity
    useProgram(progVorticity);
    setTex(progVorticity, 'u_velocity', 0, velocity.read.tex);
    gl.uniform2f(gl.getUniformLocation(progVorticity, 'u_texel'), texelX, texelY);
    drawToFBO(vorticity.fbo, SIM, SIM);

    // vorticity confinement
    useProgram(progVortForce);
    setTex(progVortForce, 'u_velocity',  0, velocity.read.tex);
    setTex(progVortForce, 'u_vorticity', 1, vorticity.tex);
    gl.uniform2f(gl.getUniformLocation(progVortForce, 'u_texel'), texelX, texelY);
    gl.uniform1f(gl.getUniformLocation(progVortForce, 'u_curl'), 18.0);
    gl.uniform1f(gl.getUniformLocation(progVortForce, 'u_dt'), dt);
    drawToFBO(velocity.write.fbo, SIM, SIM);
    velocity.swap();

    // divergence
    useProgram(progDiv);
    setTex(progDiv, 'u_velocity', 0, velocity.read.tex);
    gl.uniform2f(gl.getUniformLocation(progDiv, 'u_texel'), texelX, texelY);
    drawToFBO(divergence.fbo, SIM, SIM);

    // pressure solve (20 iterations)
    for (let i = 0; i < 20; i++) {
      useProgram(progPressure);
      setTex(progPressure, 'u_pressure',   0, pressure.read.tex);
      setTex(progPressure, 'u_divergence', 1, divergence.tex);
      gl.uniform2f(gl.getUniformLocation(progPressure, 'u_texel'), texelX, texelY);
      drawToFBO(pressure.write.fbo, SIM, SIM);
      pressure.swap();
    }

    // subtract pressure gradient
    useProgram(progSubtract);
    setTex(progSubtract, 'u_velocity', 0, velocity.read.tex);
    setTex(progSubtract, 'u_pressure', 1, pressure.read.tex);
    gl.uniform2f(gl.getUniformLocation(progSubtract, 'u_texel'), texelX, texelY);
    drawToFBO(velocity.write.fbo, SIM, SIM);
    velocity.swap();

    // recompute vorticity for display
    useProgram(progVorticity);
    setTex(progVorticity, 'u_velocity', 0, velocity.read.tex);
    gl.uniform2f(gl.getUniformLocation(progVorticity, 'u_texel'), texelX, texelY);
    drawToFBO(vorticity.fbo, SIM, SIM);
  }

  // ── render to screen ──────────────────────────────────────────────────────

  function render(screenW, screenH, darkMode) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, screenW, screenH);
    useProgram(progDye);
    setTex(progDye, 'u_dye',       0, velocity.read.tex);
    setTex(progDye, 'u_vorticity', 1, vorticity.tex);
    gl.uniform1f(gl.getUniformLocation(progDye, 'u_darkMode'), darkMode ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return { step, splatVelocity, render, getVorticity: () => vorticity };
}
