/* Vibe Studio website — the companion orb (Home's hero and its last call).
   A liquid chrome sphere, like Studio's own companion, with four smaller orbs
   for friends that drift in, melt into it and part again. It is ray-marched
   in one small WebGL fragment shader and lit by a studio of soft boxes in the
   theme's colours, so it follows the theme picker. It draws only while it is
   on screen and the tab is visible, steps its resolution down on a slow GPU,
   paints one still frame under prefers-reduced-motion, and leaves a CSS pearl
   (.orb-fallback) where WebGL is missing. No libraries, no requests. */
(function () {
  "use strict";

  var VERT = "attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }";

  var FRAG = [
    "precision highp float;",
    "uniform vec2 uRes;",
    "uniform float uTime;",
    "uniform vec2 uMouse;",
    "uniform vec3 uA;", // bright
    "uniform vec3 uB;", // accent 2
    "uniform vec3 uC;", // accent 3
    "uniform vec3 uD;", // accent
    "uniform float uFriends;",
    "uniform float uFocal;",
    "uniform float uDist;",
    "",
    "float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }",
    "",
    // Friends orbit, breathe in to melt into the companion and out again (orb.js friendPos() is the same).
    "vec3 friendPos(float i, float t) {",
    "  float a = t * (0.3 + i * 0.045) + i * 1.9;",
    "  float breath = 0.5 + 0.5 * sin(t * 0.33 + i * 2.1);",
    "  float r = mix(1.08, 1.92, breath);",
    "  return vec3(cos(a) * r, sin(a * 0.8 + i) * 0.62, sin(a) * r * 0.72);",
    "}",
    "",
    "float map(vec3 p) {",
    "  float t = uTime;",
    "  float w = sin(p.x * 2.6 + t * 1.05) * sin(p.y * 2.2 + t * 0.85) * sin(p.z * 2.4 + t * 0.7);",
    "  float d = length(p) - 1.0 + w * 0.055;",
    "  if (uFriends > 0.001) {",
    "    for (int i = 0; i < 4; i++) {",
    "      float fi = float(i);",
    "      vec3 c = friendPos(fi, t);",
    "      float rr = (0.205 + 0.03 * sin(t * 1.3 + fi * 1.7)) * uFriends;",
    "      d = smin(d, length(p - c) - rr, 0.42 * uFriends + 0.001);",
    "    }",
    "  }",
    "  return d;",
    "}",
    "",
    "vec3 calcNormal(vec3 p) {",
    "  const vec2 e = vec2(1.0, -1.0) * 0.0016;",
    "  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));",
    "}",
    "",
    // A photo studio around the orb, the classic chrome-ball set: lit walls over a dark floor, a bright
    // horizon line all the way round, an overhead soft box, a big soft box behind the camera and coloured
    // strip lights at the sides in the theme's colours.
    "vec3 env(vec3 r) {",
    "  float ca = cos(uMouse.x * 0.7), sa = sin(uMouse.x * 0.7);",
    "  r.xz = mat2(ca, -sa, sa, ca) * r.xz;",
    "  float cb = cos(uMouse.y * 0.45), sb = sin(uMouse.y * 0.45);",
    "  r.yz = mat2(cb, -sb, sb, cb) * r.yz;",
    "  float y = r.y;",
    "  vec3 col = mix(vec3(0.02, 0.02, 0.026), vec3(0.11, 0.11, 0.13) + uD * 0.05, smoothstep(-0.5, 0.7, y));",
    "  col *= mix(0.3, 1.0, smoothstep(-0.22, 0.04, y));",
    "  col += mix(vec3(0.85), uA, 0.4) * exp(-abs(y - 0.03) * 16.0) * 0.55;",
    "  col += uA * smoothstep(0.58, 0.92, y) * 1.3;",
    "  vec2 q = vec2(r.x + 0.3, y - 0.3);",
    "  float box = smoothstep(0.1, 0.0, max(abs(q.x) - 0.3, abs(q.y) - 0.18)) * smoothstep(0.05, 0.35, r.z);",
    "  col += vec3(1.0) * box * 1.75;",
    "  col += uB * smoothstep(0.52, 0.95, r.x) * 1.1 * smoothstep(-0.6, 0.3, y);",
    "  col += uC * smoothstep(0.52, 0.95, -r.x) * 1.0 * smoothstep(-0.6, 0.3, y);",
    "  col += mix(uB, uC, 0.5) * smoothstep(0.62, 1.0, -r.z) * 0.6;",
    "  return col;",
    "}",
    "",
    // Anodised metal: a thin-film shimmer that moves with the viewing angle, pulled toward the theme.
    "vec3 film(float c, float t) {",
    "  vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + c * 1.5 + t * 0.04));",
    "  vec3 theme = mix(uB, uC, 0.5 + 0.5 * sin(c * 5.0 + t * 0.6));",
    "  return mix(rainbow, theme, 0.62);",
    "}",
    "",
    "vec3 shade(vec3 p, vec3 rd) {",
    "  vec3 n = calcNormal(p);",
    "  vec3 r = reflect(rd, n);",
    "  float c = clamp(dot(n, -rd), 0.0, 1.0);",
    "  float fres = pow(1.0 - c, 3.0);",
    "  vec3 col = env(r) * mix(vec3(0.92), film(c, uTime) * 1.3, 0.34 + 0.42 * fres);",
    "  col += mix(uB, uC, 0.5 + 0.5 * n.x) * fres * 0.5;",
    "  col += uA * pow(c, 8.0) * 0.06;",
    "  return col;",
    "}",
    "",
    "void main() {",
    "  float m = min(uRes.x, uRes.y);",
    "  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / m;",
    "  vec3 ro = vec3(0.0, 0.0, uDist);",
    "  vec3 rd = normalize(vec3(uv, -uFocal));",
    "  float du = 2.0 / m;",
    "  vec4 outc = vec4(0.0);",
    "  float b = dot(ro, rd);",
    "  float h = b * b - (dot(ro, ro) - 2.5 * 2.5);",
    "  if (h > 0.0) {",
    "    float sq = sqrt(h);",
    "    float t = max(0.0, -b - sq), tmax = -b + sq;",
    "    float hit = -1.0, bestRatio = 1e9, bestT = 0.0;",
    "    for (int i = 0; i < 72; i++) {",
    "      float d = map(ro + rd * t);",
    "      float foot = t * du / uFocal;",
    "      float ratio = d / foot;",
    "      if (ratio < bestRatio) { bestRatio = ratio; bestT = t; }",
    "      if (d < 0.0012) { hit = t; break; }",
    "      t += d * 0.92;",
    "      if (t > tmax) break;",
    "    }",
    "    float cover = hit > 0.0 ? 1.0 : clamp(1.0 - bestRatio, 0.0, 1.0);",
    "    if (cover > 0.0) {",
    "      vec3 col = shade(ro + rd * (hit > 0.0 ? hit : bestT), rd);",
    "      col = col / (1.0 + col * 0.32);",
    "      col = pow(col, vec3(0.94));",
    "      outc = vec4(col * cover, cover);",
    "    }",
    "  }",
    // A soft glow round the orb that fades out before the canvas edge, so the canvas never shows as a box.
    "  float rr = length(uv);",
    "  float halo = exp(-max(0.0, rr - 0.5) * 3.0) * 0.2 * (1.0 - outc.a) * smoothstep(1.0, 0.62, rr);",
    "  outc.rgb += mix(uB, uC, 0.5 + 0.5 * uv.x) * halo;",
    "  outc.a += halo;",
    "  gl_FragColor = outc;",
    "}"
  ].join("\n");

  var FOCAL = 2.1, DIST = 4.4;

  // The same orbit as the shader's friendPos(), for the name chips beside the friends.
  function friendPos(i, t) {
    var a = t * (0.3 + i * 0.045) + i * 1.9;
    var breath = 0.5 + 0.5 * Math.sin(t * 0.33 + i * 2.1);
    var r = 1.08 + (1.92 - 1.08) * breath;
    return [Math.cos(a) * r, Math.sin(a * 0.8 + i) * 0.62, Math.sin(a) * r * 0.72];
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log || "shader"); }
    return s;
  }

  function readColor(name, fallback) {
    var T = window.MefiTheme, c = T && T.channel ? T.channel(name) : null;
    return (c || fallback).map(function (v) { return v / 255; });
  }

  function mount(host, opts) {
    opts = opts || {};
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    var canvas = document.createElement("canvas");
    canvas.className = "orb-canvas";
    canvas.setAttribute("aria-hidden", "true");
    var gl = null;
    try { gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" }); } catch (e) { gl = null; }
    if (!gl) { host.classList.add("orb-fallback"); return null; }
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
    } catch (e) {
      host.classList.add("orb-fallback");
      if (window.console) console.warn("Mefi orb: WebGL shader failed, showing the still pearl.", e);
      return null;
    }
    host.appendChild(canvas);
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ["uRes", "uTime", "uMouse", "uA", "uB", "uC", "uD", "uFriends", "uFocal", "uDist"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1f(U.uFocal, FOCAL);
    gl.uniform1f(U.uDist, DIST);

    var state = {
      time: opts.seed || 6, last: 0, running: false, onScreen: false,
      mouse: [0, 0], aim: [0, 0], friends: opts.friends == null ? 1 : opts.friends, friendsAim: opts.friends == null ? 1 : opts.friends,
      quality: 1, slow: 0, fast: 0, w: 0, h: 0, cssW: 0, cssH: 0, listeners: []
    };

    function colors() {
      gl.uniform3fv(U.uA, readColor("--bright-rgb", [238, 241, 245]));
      gl.uniform3fv(U.uB, readColor("--accent-2-rgb", [168, 197, 255]));
      gl.uniform3fv(U.uC, readColor("--accent-3-rgb", [198, 180, 255]));
      gl.uniform3fv(U.uD, readColor("--accent-rgb", [195, 200, 208]));
    }

    // The layout size, not the drawn one: a transform (Home flies the orb in
    // from a small slot) must not leave it rendering at the small size.
    function size() {
      var cw = host.clientWidth, ch = host.clientHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr || 1.5) * state.quality;
      var w = Math.max(2, Math.round(cw * dpr)), h = Math.max(2, Math.round(ch * dpr));
      state.cssW = cw; state.cssH = ch;
      if (w !== state.w || h !== state.h) {
        state.w = w; state.h = h; canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(U.uRes, w, h);
      }
    }

    function draw() {
      gl.uniform1f(U.uTime, state.time);
      gl.uniform2f(U.uMouse, state.mouse[0], state.mouse[1]);
      gl.uniform1f(U.uFriends, state.friends);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (var i = 0; i < state.listeners.length; i++) state.listeners[i](api);
    }

    function frame(now) {
      if (!state.running) return;
      var dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 0.016;
      // A slow GPU gets fewer pixels (down to 60%), a quick one gets them back.
      if (state.last) {
        var ms = now - state.last;
        if (ms > 26) { state.slow++; state.fast = 0; } else if (ms < 18) { state.fast++; state.slow = 0; }
        if (state.slow > 40 && state.quality > 0.61) { state.quality = Math.max(0.6, state.quality - 0.1); state.slow = 0; size(); }
        else if (state.fast > 240 && state.quality < 1) { state.quality = Math.min(1, state.quality + 0.1); state.fast = 0; size(); }
      }
      state.last = now;
      state.time += dt * (opts.speed || 1);
      state.mouse[0] += (state.aim[0] - state.mouse[0]) * Math.min(1, dt * 3);
      state.mouse[1] += (state.aim[1] - state.mouse[1]) * Math.min(1, dt * 3);
      state.friends += (state.friendsAim - state.friends) * Math.min(1, dt * 1.6);
      draw();
      requestAnimationFrame(frame);
    }

    function start() {
      if (state.running || state.held || reduce.matches || document.hidden || !state.onScreen) return;
      state.running = true; state.last = 0;
      requestAnimationFrame(frame);
    }
    function stop() { state.running = false; }
    function still() { size(); draw(); }

    colors(); size(); still();
    if (window.MefiTheme && window.MefiTheme.onChange) window.MefiTheme.onChange(function () { colors(); if (!state.running) still(); });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { state.onScreen = e.isIntersecting; if (state.onScreen) start(); else stop(); });
      }, { rootMargin: "80px" }).observe(host);
    } else { state.onScreen = true; start(); }
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
    if (reduce.addEventListener) reduce.addEventListener("change", function () { if (reduce.matches) { stop(); still(); } else start(); });
    window.addEventListener("resize", function () { size(); if (!state.running) draw(); });
    if (window.ResizeObserver) new ResizeObserver(function () { size(); if (!state.running) draw(); }).observe(host);
    window.addEventListener("pointermove", function (e) {
      var r = host.getBoundingClientRect();
      var x = (e.clientX - (r.left + r.width / 2)) / Math.max(1, window.innerWidth / 2);
      var y = (e.clientY - (r.top + r.height / 2)) / Math.max(1, window.innerHeight / 2);
      state.aim[0] = Math.max(-1, Math.min(1, x));
      state.aim[1] = Math.max(-1, Math.min(1, y));
    }, { passive: true });
    canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); stop(); host.classList.add("orb-fallback"); });

    var api = {
      canvas: canvas,
      // Stop drawing while something covers the orb (Home's demo), and carry on after.
      hold: function (on) { state.held = !!on; if (on) stop(); else start(); },
      setFriends: function (v) { state.friendsAim = v; if (!state.running) { state.friends = v; still(); } },
      // Where friend i is on the host, in CSS pixels, and whether it is behind the companion.
      friend: function (i) {
        var p = friendPos(i, state.time);
        var depth = DIST - p[2];
        var k = FOCAL / depth, m = Math.min(state.cssW, state.cssH) / 2;
        return { x: state.cssW / 2 + p[0] * k * m, y: state.cssH / 2 - p[1] * k * m, behind: p[2] < -0.25 && Math.hypot(p[0], p[1]) < 1.15, depth: p[2], merged: Math.hypot(p[0], p[1], p[2]) < 1.3 };
      },
      onFrame: function (fn) { state.listeners.push(fn); fn(api); },
      time: function () { return state.time; }
    };
    return api;
  }

  window.MefiOrb = { mount: mount };
})();
