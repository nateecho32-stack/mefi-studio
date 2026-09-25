// Command's camera motion: Zen visits branches and regularly reveals the
// tree; automatic Overview gently pans and resizes with every branch in view.
// idle.js supplies the painted anchors and the real perspective projection.
(function () {
  "use strict";
  const LEG_S = 10;
  const LINGER = 0.55;
  const SMOOTH_S = 0.85;
  const ZOOM = { close: 2.1, near: 1.6, wide: 0.86 };
  const SPIN = { wide: 0.0014, close: 0.00055 }; // radians per 30 fps frame
  const KIND_WEIGHT = { session: 1.5, task: 1.8, "task-group": 1.6, todo: 0.6 };
  const axes = ["x", "y", "z"];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  // Monotone cubic: shared tangents keep the flight smooth, while each axis
  // stays between its stops. An unconstrained Catmull-Rom can overshoot into
  // empty space on a turn between widely separated branches.
  function spline(a, b, c, d, t) {
    const slope = (x, y) => x * y <= 0 ? 0 : 2 * x * y / (x + y);
    const m0 = slope(b - a, c - b), m1 = slope(c - b, d - c);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * b + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * c + (t3 - t2) * m1;
  }

  function damp(current, target, vel, key, smoothTime, dt) {
    if (!(dt > 0)) return current;
    const omega = 2 / smoothTime, x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target;
    const temp = ((vel[key] ?? 0) + omega * change) * dt;
    vel[key] = ((vel[key] ?? 0) - omega * temp) * decay;
    return target + (change + temp) * decay;
  }

  function midpoint(points) {
    const center = { x: 0, y: 0, z: 0 };
    if (points.length) for (const axis of axes) {
      let low = Infinity, high = -Infinity;
      for (const point of points) { low = Math.min(low, point[axis]); high = Math.max(high, point[axis]); }
      center[axis] = (low + high) / 2;
    }
    return center;
  }

  // Fit the subject and its neighbours inside a generous safe frame, using
  // the same projection as the canvas. Spare space absorbs spring lag, the
  // next orbit frame, node rims and labels without pumping the zoom.
  function fitZoom(points, shot, ctx, limit) {
    const area = ctx.viewport;
    if (!points.length || !ctx.project || !(area?.w > 0 && area?.h > 0)) return limit;
    const padX = Math.min(140, area.w * 0.18), padY = Math.min(110, area.h * 0.2);
    const fits = (zoom) => points.every((point) => {
      const p = ctx.project(point, { ...shot, zoom });
      return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= area.x + padX && p.x <= area.x + area.w - padX && p.y >= area.y + padY && p.y <= area.y + area.h - padY;
    });
    if (fits(limit)) return limit;
    let low = 0.45, high = limit;
    for (let i = 0; i < 10; i += 1) {
      const mid = (low + high) / 2;
      if (fits(mid)) low = mid; else high = mid;
    }
    return low;
  }

  function create({ seed = Date.now() } = {}) {
    const tour = { stops: [], t: 0, time: 0, out: null, vel: {}, basePitch: 0, count: 0, recent: [], seed: seed | 0 };

    function random() {
      tour.seed = (tour.seed + 0x6d2b79f5) | 0;
      let value = Math.imul(tour.seed ^ (tour.seed >>> 15), 1 | tour.seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    function nextStop(nodes, from) {
      tour.count += 1;
      if (tour.count % 4 === 0 || nodes.length < 2) return { kind: "wide" };
      const fresh = nodes.filter((item) => !tour.recent.includes(item.id));
      const pool = fresh.length ? fresh : nodes;
      const center = midpoint(nodes);
      const spread = Math.max(60, ...nodes.map((item) => distance(item, center)));
      let total = 0;
      const weights = pool.map((item) => {
        const near = from ? 1 / (1 + distance(item, from) / spread) : 1;
        const weight = (KIND_WEIGHT[item.kind] ?? 1) * (item.running ? 2 : 1) * (0.5 + 1.5 * near);
        total += weight;
        return weight;
      });
      let pick = random() * total, chosen = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i += 1) {
        pick -= weights[i];
        if (pick <= 0) { chosen = pool[i]; break; }
      }
      tour.recent = [chosen.id, ...tour.recent].slice(0, Math.min(6, Math.max(1, nodes.length - 2)));
      // Include a parent and nearby children first; fill sparse branches with
      // their nearest neighbours. Keep the group stable until the next stop.
      const neighbours = nodes.filter((node) => node.id !== chosen.id).sort((a, b) => {
        const related = (node) => node.id === chosen.parentId || node.parentId === chosen.id;
        return Number(related(b)) - Number(related(a)) || distance(a, chosen) - distance(b, chosen);
      });
      return { kind: "node", id: chosen.id, group: [chosen.id, ...neighbours.slice(0, 3).map((node) => node.id)], zoom: chosen.running ? ZOOM.close : ZOOM.near };
    }

    function stopPoint(stop, nodes, byId) {
      if (stop.kind === "here") return { ...stop, points: [] };
      const chosen = byId.get(stop.id);
      // A retired target resolves to the live tree. The output spring glides
      // there; we never tour an empty, stale coordinate.
      if (stop.kind === "wide" || !chosen) return { ...midpoint(nodes), zoom: ZOOM.wide, points: nodes };
      const points = stop.group.map((id) => byId.get(id)).filter(Boolean);
      const center = midpoint(points);
      for (const axis of axes) center[axis] = mix(center[axis], chosen[axis], 0.55);
      return { ...center, zoom: stop.zoom, points };
    }

    function begin(ctx, nodes) {
      const here = { kind: "here", x: -ctx.camera.x, y: -ctx.camera.y, z: -ctx.camera.z, zoom: ctx.zoom };
      tour.basePitch = clamp(Number(ctx.pitch) || 0, -0.55, 0.55);
      // Establish the scene before the first branch visit.
      tour.stops = [here, { ...here }, { kind: "wide" }, nextStop(nodes, here)];
      tour.out = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z, lz: Math.log(ctx.zoom), pitch: tour.basePitch };
    }

    function step(ctx) {
      const dt = clamp(Number(ctx.dt) || 0, 0, 0.05);
      const visible = (ctx.nodes?.() ?? []).filter((node) => axes.every((axis) => Number.isFinite(node[axis])));
      // Workers orbit their hosts in screen space. Visit the stable branches
      // they work on rather than chasing an unrelated raw orbital position.
      const anchors = visible.filter((node) => node.kind !== "agent");
      const nodes = anchors.length ? anchors : visible;
      const byId = new Map(nodes.map((node) => [node.id, node]));
      if (!tour.out) begin(ctx, nodes);
      tour.time += dt;
      tour.t += dt / LEG_S;
      while (tour.t >= 1) {
        tour.t -= 1;
        tour.stops.shift();
        const last = stopPoint(tour.stops.at(-1), nodes, byId);
        tour.stops.push(nextStop(nodes, last));
      }
      const [a, b, c, d] = tour.stops.map((stop) => stopPoint(stop, nodes, byId));
      const u = tour.t - LINGER * Math.sin(2 * Math.PI * tour.t) / (2 * Math.PI);
      for (const axis of axes) tour.out[axis] = damp(tour.out[axis], -spline(a[axis], b[axis], c[axis], d[axis], u), tour.vel, axis, SMOOTH_S, dt);
      // Tilt, pan and zoom ease from the owner's current shot together.
      const sway = 0.085 * Math.sin(tour.time * 0.17) + 0.035 * Math.sin(tour.time * 0.31);
      const pitch = ctx.view === "2d" ? tour.basePitch : clamp(tour.basePitch + sway, -0.45, 0.45);
      tour.out.pitch = damp(tour.out.pitch, pitch, tour.vel, "pitch", SMOOTH_S, dt);

      // Reveal the destination before passing between branches. At mid-leg
      // both groups fit, so a flight across a large gap still shows the tree.
      // At either stop only that branch determines the close-up.
      const points = [];
      for (const [group, weight] of [[b.points, 1 - ease((u - 0.65) / 0.35)], [c.points, ease(u / 0.35)]]) {
        for (const point of group) {
          const framed = {};
          for (const axis of axes) framed[axis] = mix(-tour.out[axis], point[axis], weight);
          points.push(framed);
        }
      }
      const travel = Math.sin(Math.PI * u) ** 2;
      const wanted = Math.exp(spline(Math.log(a.zoom), Math.log(b.zoom), Math.log(c.zoom), Math.log(d.zoom), u));
      const limit = mix(wanted, Math.min(wanted, ZOOM.wide), travel * 0.65);
      const zoomGoal = fitZoom(points, tour.out, ctx, limit);
      tour.out.lz = damp(tour.out.lz, Math.log(zoomGoal), tour.vel, "lz", SMOOTH_S, dt);
      const zoom = Math.exp(tour.out.lz);
      const closeness = clamp((zoom - ZOOM.wide) / (ZOOM.close - ZOOM.wide), 0, 1);
      return {
        x: tour.out.x, y: tour.out.y, z: tour.out.z, zoom, pitch: tour.out.pitch,
        spin: ctx.view === "2d" ? 0 : mix(SPIN.wide, SPIN.close, closeness),
      };
    }

    function velocity() {
      return { x: tour.vel.x ?? 0, y: tour.vel.y ?? 0, z: tour.vel.z ?? 0, zoom: tour.vel.lz ?? 0, pitch: tour.vel.pitch ?? 0 };
    }

    return { step, velocity, stops: () => tour.stops.map((stop) => stop.id ?? stop.kind) };
  }

  // Overview borrows the tour's soft motion, but its subject is always the
  // entire tree. Work in projected coordinates so every arrangement and
  // perspective angle uses the same hard frame, without moving any anchors.
  function createOverview() {
    let time = 0, out = null;
    const velocity = {};
    function step({ points, viewport, dt = 0, moving = false, still = false, initial = { scale: 1, x: 0, y: 0 }, ceiling = Infinity }) {
      dt = clamp(Number(dt) || 0, 0, 0.05);
      const visible = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!visible.length) return { ...initial };
      const animate = moving && !still;
      if (animate) time += dt;
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const p of visible) {
        left = Math.min(left, p.x); right = Math.max(right, p.x);
        top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
      }
      const halfW = Math.max(1, viewport.w / 2 - 32), halfH = Math.max(1, viewport.h / 2 - 32);
      // The caller's own frame (Command's whole-turn fit) caps the zoom too.
      const cap = Number.isFinite(ceiling) && ceiling > 0 ? ceiling : Infinity;
      const limit = Math.min(1.35, cap, halfW * 2 / Math.max(1, right - left), halfH * 2 / Math.max(1, bottom - top));
      const goal = limit * (0.91 + 0.055 * Math.sin(time * 0.16));
      out ??= { ...initial };
      // Ease ordinary zoom changes; shrinking windows and new branches take
      // precedence over the spring so work never crosses the panel boundary.
      out.scale = Math.min(limit, animate ? damp(out.scale, goal, velocity, "scale", 1.4, dt) : out.scale);
      const xMin = -halfW - left * out.scale, xMax = halfW - right * out.scale;
      const yMin = -halfH - top * out.scale, yMax = halfH - bottom * out.scale;
      const x = (xMin + xMax) / 2 + (xMax - xMin) * 0.28 * Math.sin(time * 0.11);
      const y = (yMin + yMax) / 2 + (yMax - yMin) * 0.22 * Math.sin(time * 0.083);
      out.x = clamp(animate ? damp(out.x, x, velocity, "x", 1.4, dt) : out.x, xMin, xMax);
      out.y = clamp(animate ? damp(out.y, y, velocity, "y", 1.4, dt) : out.y, yMin, yMax);
      if (!animate) { velocity.scale = 0; velocity.x = 0; velocity.y = 0; }
      return { ...out };
    }
    return { step };
  }

  window.MefiCameraTour = { create, createOverview, LEG_S, ZOOM, SPIN };
})();
