// Mefi's Studio AI+ — the studio pet (window.MefiPets).
//
// Ember is a small dragon that lives over the studio. It is drawn on a small
// canvas of its own (#studio-pet) that travels with it, so nothing under it
// repaints, and clicks always go through it (pointer-events: none). It
// wanders near the edges of the window, comes over to look at the pointer
// when the pointer rests, curls up on the edge of a bar to nap, does a loop
// and a puff of fire when a job finishes, and flies to the Inbox when
// something needs you. While you type it stays on its perch; after a few
// quiet minutes, or while the window is in the background, it sleeps; while
// the window is hidden it stops altogether. With motion off
// (html[data-motion=off]) it naps in one still pose and never moves, and with
// calm motion it keeps to its perch.
//
// Ember comes free with every Studio: a new profile's first run switches it
// on (renderer/setup-helper.js, the look step), and Settings › Appearance
// switches it on or off. Its skins are Shop items (renderer/friends-shop.js):
// nothing here decides what is owned, it asks MefiShop.owns(). A Try in the
// Shop borrows a skin for a while (preview) without saving anything. The
// owner's choices live in localStorage mefiStudio.pet.v1, so a restart
// brings the pet back the way it was.
//
//   kinds(), skins(), state(), set(patch), preview(look, ms), endPreview(),
//   react("celebrate" | "alert" | "wake"), paintPreview(canvas, { kind, skin, time })
//
// The flight is a small simulation (flight below) stepped by a clamped
// clock, kept apart from the drawing (paint below), so the tests fly it
// without a canvas: MefiPets.simulate(options) returns one to step.
(function () {
  "use strict";
  const STORE = "mefiStudio.pet.v1";
  // Free with every Studio: no Shop item.
  const KINDS = Object.freeze([{ id: "dragon", item: null, name: "Ember the dragon" }]);
  const SKIN_LIST = Object.freeze([
    { id: "theme", item: null, name: "Your theme's colours" },
    { id: "frost", item: "studio:skin-frost", name: "Frost scales" },
    { id: "jade", item: "studio:skin-jade", name: "Jade scales" },
    { id: "void", item: "studio:skin-void", name: "Void scales" },
    { id: "gold", item: "studio:skin-gold", name: "Gold scales" },
  ]);
  const DEFAULTS = Object.freeze({ on: false, kind: "dragon", skin: "theme", name: "Ember", calm: true, come: true, size: 1 });
  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = (angle) => { let a = angle % TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

  // A small seeded random (mulberry32), so a test flight repeats exactly.
  function seeded(seed) {
    let s = (Number(seed) >>> 0) || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- the body -------------------------------------------------------------
  // A spine of points from the head to the tail tip. Each point follows the
  // one before it at a fixed distance and may bend only so far, so the body
  // trails the head's path in a smooth curve; the radius profile gives it a
  // neck, a chest and a long tapering tail.
  const SEGMENTS = 26;
  const LINKS = Array.from({ length: SEGMENTS }, (_, index) => lerp(5.6, 3.3, index / (SEGMENTS - 1)));
  const PROFILE = [[0, 6.4], [0.06, 4.9], [0.16, 8.2], [0.3, 7.7], [0.44, 6], [0.64, 3.6], [0.84, 2], [1, 1.1]];
  function radiusAt(t) {
    for (let index = 1; index < PROFILE.length; index += 1) {
      const [t1, r1] = PROFILE[index];
      const [t0, r0] = PROFILE[index - 1];
      if (t <= t1) { const k = (t - t0) / (t1 - t0); const smooth = k * k * (3 - 2 * k); return lerp(r0, r1, smooth); }
    }
    return PROFILE[PROFILE.length - 1][1];
  }
  const RADII = Array.from({ length: SEGMENTS }, (_, index) => radiusAt(index / (SEGMENTS - 1)));
  const SHOULDER = 5, HIP = 11, WING_END = 9;
  const MAX_BEND = 0.42;

  function follow(points, size) {
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1], b = points[index];
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (index >= 2) {
        const before = points[index - 2];
        const base = Math.atan2(a.y - before.y, a.x - before.x);
        const bend = wrap(angle - base);
        if (Math.abs(bend) > MAX_BEND) angle = base + Math.sign(bend) * MAX_BEND;
      }
      const link = LINKS[index] * size;
      b.x = a.x + Math.cos(angle) * link;
      b.y = a.y + Math.sin(angle) * link;
    }
  }

  // ---- the flight -----------------------------------------------------------
  // Modes: wander (waypoints near the edges), perch (fly to a spot on the edge
  // of a bar), coil (circle the spot so the body curls up), rest (sit there,
  // breathe, look around), sleep (eyes shut, little z's), curious (hover
  // beside a resting pointer), dash (dart away from a fast pointer), loop
  // (a celebration loop with a puff of fire), visit (fly to something that
  // needs you and hover there). A step reads only `world` (the window size,
  // the pointer, rectangles to keep clear of, perch spots) and the clock.
  const SPEED = { wander: 150, perch: 170, dash: 380, curious: 190, visit: 260, loop: 230 };
  const TURN = 4.6; // radians a second
  function flight({ seed = 7, size = 1, width = 1280, height = 800 } = {}) {
    const random = seeded(seed);
    const pick = (low, high) => low + random() * (high - low);
    const pet = {
      x: width * 0.72, y: height * 0.2, heading: Math.PI * 0.85, speed: 0, size,
      mode: "wander", modeAt: 0, clock: 0, flap: 0, flapRate: 8, flapAmp: 1, glide: 0,
      target: null, waypoints: 0, perch: null, coilAngle: 0, coilFrom: 0, blinkAt: 2, blink: 0,
      look: 0, lookGoal: 0, lookAt: 3, breathe: 0, fire: 0, mouth: 0, sleepy: 0, held: false,
      spine: [], particles: [], events: [],
    };
    for (let index = 0; index < SEGMENTS; index += 1) pet.spine.push({ x: pet.x - index * LINKS[index] * size, y: pet.y });
    follow(pet.spine, size);

    const inside = (rect, x, y, pad = 0) => x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
    function waypoint(world) {
      const margin = 46;
      const w = Math.max(world.width, 200), h = Math.max(world.height, 200);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        let x, y;
        // Mostly the edges of the window, where it covers the least.
        if (random() < 0.72) {
          const side = Math.floor(random() * 4);
          const band = 0.2;
          x = side === 0 ? pick(margin, w * band) : side === 1 ? pick(w * (1 - band), w - margin) : pick(margin, w - margin);
          y = side === 2 ? pick(margin, h * band) : side === 3 ? pick(h * (1 - band), h - margin) : pick(margin, h - margin);
        } else { x = pick(margin, w - margin); y = pick(margin, h - margin); }
        if (!(world.avoid || []).some((rect) => inside(rect, x, y, 30))) return { x, y };
      }
      return { x: pick(margin, w - margin), y: pick(margin, Math.min(h - margin, 120)) };
    }
    function enter(mode, world) {
      pet.mode = mode; pet.modeAt = pet.clock;
      if (mode === "wander") { pet.target = waypoint(world); }
      if (mode === "perch") {
        const spots = (world.perches || []).filter((spot) => !(world.avoid || []).some((rect) => inside(rect, spot.x, spot.y, 10)));
        pet.perch = spots.length ? spots[Math.floor(random() * spots.length)] : { x: Math.max(80, world.width - 140), y: Math.max(60, world.height - 60) };
        pet.target = { x: pet.perch.x, y: pet.perch.y - 16 * size };
      }
      if (mode === "coil") { pet.coilFrom = Math.atan2(pet.y - pet.target.y, pet.x - pet.target.x); pet.coilAngle = 0; }
      if (mode === "dash") {
        const away = world.pointer ? Math.atan2(pet.y - world.pointer.y, pet.x - world.pointer.x) : pet.heading;
        pet.target = { x: clamp(pet.x + Math.cos(away) * 260, 40, world.width - 40), y: clamp(pet.y + Math.sin(away) * 260, 40, world.height - 40) };
        puff(pet, "smoke", 6);
      }
      if (mode === "loop") { pet.loopCenter = { x: pet.x + Math.cos(pet.heading) * 46 * size, y: pet.y + Math.sin(pet.heading) * 46 * size }; pet.loopFrom = pet.heading - Math.PI / 2; pet.fire = 0.55; }
      if (mode === "sleep") { pet.sleepy = 1; }
      pet.events.push(mode);
      if (pet.events.length > 40) pet.events.shift();
    }
    // Heads for (x, y), turning at most TURN a second and slowing to arrive.
    function steer(dt, x, y, top, sway = 1) {
      const dx = x - pet.x, dy = y - pet.y;
      const distance = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx);
      const turn = TURN * dt * (pet.mode === "dash" ? 1.7 : 1);
      pet.heading = wrap(pet.heading + clamp(wrap(want - pet.heading), -turn, turn));
      const goal = Math.min(top, Math.max(26, distance * 2.4));
      pet.speed += clamp(goal - pet.speed, -520 * dt, 360 * dt);
      // A dragon swims through the air: the path snakes a little, and the body
      // carries the wave down to the tail.
      const snake = Math.sin(pet.clock * 2.7) * 0.34 * clamp(pet.speed / 170, 0, 1) * sway;
      const direction = pet.heading + snake;
      pet.x += Math.cos(direction) * pet.speed * dt;
      pet.y += Math.sin(direction) * pet.speed * dt + Math.sin(pet.flap) * 7 * dt * pet.flapAmp;
      return distance;
    }
    function step(dt, world) {
      dt = clamp(Number(dt) || 0, 0, 0.05);
      pet.clock += dt;
      const pointer = world.pointer || null;
      const quietFor = Math.max(0, Number(world.quiet) || 0); // seconds without input
      const typing = Boolean(world.typing);
      const still = world.motion === "off";
      const calm = world.motion === "calm";
      // Something new to react to.
      const ask = world.react;
      if (ask && !still) {
        world.react = null;
        if (ask === "celebrate" && !calm) enter("loop", world);
        else if (ask === "celebrate") puff(pet, "spark", 10);
        else if (ask === "alert" && world.visit && world.come !== false && !calm) { pet.visit = world.visit; enter("visit", world); }
        else if (ask === "wake" && (pet.mode === "sleep" || pet.mode === "rest")) { pet.sleepy = 0; enter(calm ? "rest" : "wander", world); }
      }
      if (still) {
        if (pet.mode !== "sleep") { if (!pet.perch) enter("perch", world); settleOnPerch(world); enter("sleep", world); }
        pet.particles.length = 0;
        return;
      }
      // How long it has been in this mode, read after any reaction changed it.
      const time = pet.clock - pet.modeAt;
      switch (pet.mode) {
        case "wander": {
          if (!pet.target) pet.target = waypoint(world);
          const distance = steer(dt, pet.target.x, pet.target.y, SPEED.wander);
          if (typing && world.calm !== false) { enter("perch", world); break; }
          if (calm || world.background) { enter("perch", world); break; }
          if (pointer && pointer.speed > 1400 && Math.hypot(pointer.x - pet.x, pointer.y - pet.y) < 110) { enter("dash", world); break; }
          // A pointer resting nearby draws it over now and then: sooner the closer it is.
          if (pointer && pointer.still > 1.6 && pointer.still < 60 && !(world.avoid || []).some((rect) => inside(rect, pointer.x, pointer.y, 20))) {
            const near = Math.hypot(pointer.x - pet.x, pointer.y - pet.y);
            if (near < 520 && random() < dt * (near < 300 ? 1.4 : 0.6)) { enter("curious", world); break; }
          }
          if (distance < 50 || time > 9) {
            pet.waypoints += 1;
            if (pet.waypoints >= 3 + Math.floor(random() * 4)) { pet.waypoints = 0; enter("perch", world); }
            else { pet.target = waypoint(world); pet.modeAt = pet.clock; }
          }
          break;
        }
        case "perch": {
          if (!pet.target) enter("perch", world);
          const distance = steer(dt, pet.target.x, pet.target.y, SPEED.perch, 0.6);
          if (distance < 10 || time > 12) enter("coil", world);
          break;
        }
        case "coil": {
          // Circle the spot once and a bit, slowing, so the body curls round.
          pet.coilAngle += dt * lerp(5.2, 1.6, clamp(time / 1.4, 0, 1));
          const radius = 15 * pet.size;
          const angle = pet.coilFrom + pet.coilAngle;
          const x = pet.target.x + Math.cos(angle) * radius, y = pet.target.y + Math.sin(angle) * radius * 0.7;
          pet.heading = wrap(angle + Math.PI / 2);
          pet.x = lerp(pet.x, x, clamp(dt * 9, 0, 1)); pet.y = lerp(pet.y, y, clamp(dt * 9, 0, 1));
          pet.speed = lerp(pet.speed, 0, clamp(dt * 3, 0, 1));
          if (time > 1.5) { pet.restFor = pick(10, 26); enter("rest", world); }
          break;
        }
        case "rest": {
          pet.speed = 0;
          if (quietFor > 150 || world.background) { enter("sleep", world); break; }
          if (!typing && !calm && time > pet.restFor) enter("wander", world);
          else if (!typing && !calm && pointer && pointer.still > 1.4 && pointer.still < 30 && time > 4 && Math.hypot(pointer.x - pet.x, pointer.y - pet.y) < 260 && random() < dt * 0.25) enter("curious", world);
          break;
        }
        case "sleep": {
          pet.speed = 0;
          if (!world.background && quietFor < 1 && pointer && pointer.speed > 60 && Math.hypot(pointer.x - pet.x, pointer.y - pet.y) < 180) { pet.sleepy = 0; enter("rest", world); pet.restFor = pick(3, 8); }
          else if (!world.background && quietFor < 1 && time > 6 && !typing && !calm) { pet.sleepy = 0; enter("rest", world); pet.restFor = pick(2, 6); }
          if (pet.mode === "sleep" && (pet.clock % 1.6) < dt) puff(pet, "z", 1);
          break;
        }
        case "curious": {
          if (!pointer || typing || world.background) { enter("wander", world); break; }
          // Hover a little way to the side of the pointer, facing it.
          const side = pet.x < pointer.x ? -1 : 1;
          const goalX = clamp(pointer.x + side * 74 * pet.size, 30, world.width - 30), goalY = clamp(pointer.y - 26 * pet.size, 30, world.height - 30);
          steer(dt, goalX, goalY, SPEED.curious, 0.4);
          if (pointer.speed > 1200 && Math.hypot(pointer.x - pet.x, pointer.y - pet.y) < 120) { enter("dash", world); break; }
          if (time > pick(3.5, 5.5) || pointer.still < 0.2 && time > 1.2) enter("wander", world);
          break;
        }
        case "dash": {
          const distance = steer(dt, pet.target.x, pet.target.y, SPEED.dash, 0.3);
          if (distance < 30 || time > 1.4) enter("wander", world);
          break;
        }
        case "loop": {
          // One full circle round a point ahead, then on its way.
          const angle = pet.loopFrom + clamp(time / 1.25, 0, 1) * TAU;
          const radius = 40 * pet.size;
          const x = pet.loopCenter.x + Math.cos(angle) * radius, y = pet.loopCenter.y + Math.sin(angle) * radius;
          const dx = x - pet.x, dy = y - pet.y;
          if (Math.hypot(dx, dy) > 0.01) pet.heading = Math.atan2(dy, dx);
          pet.speed = Math.hypot(dx, dy) / Math.max(dt, 1e-3);
          pet.x = x; pet.y = y;
          if (time > 0.45 && time < 0.5) puff(pet, "spark", 12);
          if (time > 1.25) { pet.speed = SPEED.wander; enter("wander", world); }
          break;
        }
        case "visit": {
          const spot = pet.visit || { x: world.width - 80, y: 60 };
          const goalX = clamp(spot.x - 60 * pet.size, 30, world.width - 30), goalY = clamp(spot.y + 40 * pet.size, 30, world.height - 30);
          const distance = steer(dt, goalX + Math.cos(pet.clock * 2) * 12, goalY + Math.sin(pet.clock * 3) * 8, SPEED.visit, 0.5);
          if ((distance < 40 && time > 4) || time > 9) { pet.visit = null; enter("perch", world); }
          break;
        }
        default: enter("wander", world);
      }
      // Stay inside the window.
      pet.x = clamp(pet.x, 12, Math.max(13, world.width - 12));
      pet.y = clamp(pet.y, 12, Math.max(13, world.height - 12));
      pet.spine[0].x = pet.x; pet.spine[0].y = pet.y;
      follow(pet.spine, pet.size);
      wings(dt);
      face(dt, pointer);
      if (pet.fire > 0) { pet.fire -= dt; breathe(pet, dt); }
      pet.mouth = lerp(pet.mouth, pet.fire > 0 ? 1 : 0, clamp(dt * 12, 0, 1));
      ageParticles(pet, dt);
    }
    // Wings: quicker and deeper when climbing or fast, a glide now and then,
    // folded back when sitting.
    function wings(dt) {
      const sitting = ["rest", "sleep"].includes(pet.mode);
      const coiling = pet.mode === "coil";
      const climbing = Math.sin(pet.heading) < -0.4;
      let rate = pet.speed > 260 ? 15 : climbing ? 11.5 : 8.5;
      if (["curious", "visit"].includes(pet.mode)) rate = 10.5;
      pet.glide -= dt;
      if (pet.glide < -pick(2.5, 6) && pet.mode === "wander" && !climbing) pet.glide = pick(0.8, 1.8);
      const gliding = pet.glide > 0;
      const goal = sitting ? 0 : coiling ? 0.35 : gliding ? 0.08 : 1;
      pet.flapAmp = lerp(pet.flapAmp, goal, clamp(dt * 5, 0, 1));
      pet.fold = lerp(pet.fold ?? 0, sitting ? 1 : coiling ? 0.6 : 0, clamp(dt * 4, 0, 1));
      if (!sitting) pet.flap += dt * rate * (gliding ? 0.25 : 1);
      pet.breathe += dt * (pet.mode === "sleep" ? 1.5 : 2.2);
      pet.blinkAt -= dt;
      if (pet.blinkAt <= 0) { pet.blink = 0.16; pet.blinkAt = pick(2.2, 6.5); }
      pet.blink = Math.max(0, pet.blink - dt);
    }
    // Where the head looks when the body does not move: around, and at the pointer.
    function face(dt, pointer) {
      if (!["rest", "sleep"].includes(pet.mode)) { pet.look = lerp(pet.look, 0, clamp(dt * 6, 0, 1)); return; }
      pet.lookAt -= dt;
      if (pet.lookAt <= 0) { pet.lookGoal = pick(-0.5, 0.5); pet.lookAt = pick(1.5, 4); }
      if (pointer && pointer.still < 3 && pet.mode === "rest") {
        const head = pet.spine[0], neck = pet.spine[1];
        const body = Math.atan2(head.y - neck.y, head.x - neck.x);
        pet.lookGoal = clamp(wrap(Math.atan2(pointer.y - head.y, pointer.x - head.x) - body), -0.7, 0.7);
      }
      pet.look = lerp(pet.look, pet.mode === "sleep" ? 0 : pet.lookGoal, clamp(dt * 3, 0, 1));
    }
    // A sitting dragon is put straight onto its perch (motion off, or a still preview).
    function settleOnPerch(world) {
      const spot = pet.perch || { x: world.width - 140, y: world.height - 60 };
      const cx = spot.x, cy = spot.y - 16 * pet.size;
      for (let index = 0; index < 90; index += 1) {
        const angle = index * 0.13;
        pet.x = cx + Math.cos(angle) * 15 * pet.size; pet.y = cy + Math.sin(angle) * 10 * pet.size;
        pet.spine[0].x = pet.x; pet.spine[0].y = pet.y;
        follow(pet.spine, pet.size);
      }
      pet.heading = 0.13 * 89 + Math.PI / 2;
      pet.speed = 0; pet.flapAmp = 0; pet.fold = 1;
    }
    return { pet, step, enter: (mode, world) => enter(mode, world), settle: settleOnPerch };
  }

  // ---- particles --------------------------------------------------------------
  const MAX_PARTICLES = 90;
  function puff(pet, kind, count) {
    const head = pet.spine[0], neck = pet.spine[1];
    const angle = Math.atan2(head.y - neck.y, head.x - neck.x);
    for (let index = 0; index < count && pet.particles.length < MAX_PARTICLES; index += 1) {
      const spread = (Math.random() - 0.5) * 1.2;
      if (kind === "z") pet.particles.push({ kind, x: head.x + 6, y: head.y - 10, vx: 8, vy: -16, life: 2.2, max: 2.2, size: 9 });
      else if (kind === "heart") pet.particles.push({ kind, x: head.x, y: head.y - 8, vx: (Math.random() - 0.5) * 24, vy: -30, life: 1.4, max: 1.4, size: 7 });
      else if (kind === "smoke") pet.particles.push({ kind, x: head.x, y: head.y, vx: Math.cos(angle + Math.PI + spread) * 40, vy: Math.sin(angle + Math.PI + spread) * 40, life: 0.7, max: 0.7, size: 5 + Math.random() * 4 });
      else pet.particles.push({ kind: "spark", x: head.x + (Math.random() - 0.5) * 50, y: head.y + (Math.random() - 0.5) * 50, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50 - 20, life: 0.9, max: 0.9, size: 2 + Math.random() * 2.5 });
    }
  }
  // Fire from the snout, along the way the head points.
  function breathe(pet, dt) {
    const head = pet.spine[0], neck = pet.spine[1];
    const angle = Math.atan2(head.y - neck.y, head.x - neck.x);
    const tip = { x: head.x + Math.cos(angle) * 16 * pet.size, y: head.y + Math.sin(angle) * 16 * pet.size };
    const count = Math.ceil(dt * 90);
    for (let index = 0; index < count && pet.particles.length < MAX_PARTICLES; index += 1) {
      const spread = (Math.random() - 0.5) * 0.5;
      const speed = 150 + Math.random() * 120;
      pet.particles.push({ kind: "fire", x: tip.x, y: tip.y, vx: Math.cos(angle + spread) * speed + Math.cos(pet.heading) * pet.speed * 0.4, vy: Math.sin(angle + spread) * speed + Math.sin(pet.heading) * pet.speed * 0.4, life: 0.32 + Math.random() * 0.26, max: 0.58, size: 5 + Math.random() * 4 });
    }
  }
  function ageParticles(pet, dt) {
    const keep = [];
    for (const bit of pet.particles) {
      bit.life -= dt;
      if (bit.life <= 0) continue;
      bit.x += bit.vx * dt; bit.y += bit.vy * dt;
      if (bit.kind === "fire") { bit.vx *= 1 - dt * 2.2; bit.vy = bit.vy * (1 - dt * 2.2) - 30 * dt; }
      else if (bit.kind === "z") { bit.vx = Math.sin(bit.life * 3) * 10; }
      else { bit.vx *= 1 - dt * 1.5; bit.vy *= 1 - dt * 1.5; }
      keep.push(bit);
    }
    pet.particles = keep;
  }

  // ---- colours ----------------------------------------------------------------
  const hex = (value) => {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value || "").trim());
    if (!match) return null;
    const n = parseInt(match[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbOf = (value) => {
    const text = String(value || "").trim();
    const direct = hex(text);
    if (direct) return direct;
    const match = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const mix = (a, b, t) => [0, 1, 2].map((index) => Math.round(lerp(a[index], b[index], t)));
  const css = (rgb, alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const SKINS = {
    frost: { body: [127, 211, 255], body2: [44, 104, 196], belly: [232, 248, 255], wing: [150, 222, 255], edge: [210, 244, 255], horn: [240, 251, 255], eye: [200, 246, 255], fire: [[233, 251, 255], [143, 227, 255], [63, 169, 245]] },
    jade: { body: [47, 191, 113], body2: [14, 110, 70], belly: [218, 242, 196], wing: [240, 200, 82], edge: [255, 226, 140], horn: [241, 210, 122], eye: [255, 226, 122], fire: [[244, 255, 214], [182, 236, 90], [64, 170, 70]] },
    void: { body: [56, 34, 92], body2: [16, 9, 30], belly: [112, 78, 170], wing: [150, 92, 255], edge: [205, 170, 255], horn: [214, 196, 255], eye: [226, 178, 255], fire: [[246, 226, 255], [182, 124, 255], [93, 43, 209]] },
    gold: { body: [255, 211, 107], body2: [196, 132, 26], belly: [255, 243, 200], wing: [255, 222, 140], edge: [255, 246, 214], horn: [255, 248, 222], eye: [255, 255, 255], fire: [[255, 255, 230], [255, 214, 110], [240, 150, 40]] },
  };
  // The theme skin: the accent and second accent of whatever theme is on.
  function themeSkin() {
    let style = null;
    try { style = getComputedStyle(document.documentElement); } catch { style = null; }
    const read = (...names) => { for (const name of names) { const value = rgbOf(style?.getPropertyValue?.(name)); if (value) return value; } return null; };
    const accent = read("--canvas-accent", "--gold") || [255, 140, 60];
    const second = read("--canvas-accent2", "--accent-2") || mix(accent, [120, 60, 255], 0.55);
    const text = read("--canvas-text", "--ivory") || [240, 240, 240];
    return { body: accent, body2: mix(accent, second, 0.55), belly: mix(accent, WHITE, 0.55), wing: second, edge: mix(second, WHITE, 0.45), horn: mix(text, accent, 0.18), eye: [255, 214, 100], fire: [[255, 244, 200], [255, 178, 72], [255, 92, 54]] };
  }
  const skinColours = (skin) => (SKINS[skin] || themeSkin());

  // ---- paint ------------------------------------------------------------------
  // Everything is drawn in window coordinates; the caller sets the transform.
  function normalAt(spine, index) {
    const a = spine[Math.max(0, index - 1)], b = spine[Math.min(spine.length - 1, index + 1)];
    const dx = a.x - b.x, dy = a.y - b.y;
    const length = Math.hypot(dx, dy) || 1;
    return { fx: dx / length, fy: dy / length, nx: -dy / length, ny: dx / length };
  }
  function paintPet(ctx, pet, skin, { detail = 1 } = {}) {
    const colours = skinColours(skin);
    const s = pet.size;
    const spine = pet.spine;
    const breath = 1 + Math.sin(pet.breathe) * (pet.mode === "sleep" ? 0.035 : 0.02);
    const radius = (index) => RADII[index] * s * (index > 1 && index < 12 ? breath : 1);
    const sides = spine.map((point, index) => {
      const { nx, ny } = normalAt(spine, index);
      const r = radius(index);
      // A sitting dragon's tail tip flicks now and then.
      let wag = 0;
      if (["rest", "sleep"].includes(pet.mode) && index > SEGMENTS - 6) wag = Math.sin(pet.clock * (pet.mode === "sleep" ? 0.8 : 2.4)) * (index - (SEGMENTS - 6)) * 0.55 * s;
      const x = point.x + nx * wag, y = point.y + ny * wag;
      return { x, y, lx: x + nx * r, ly: y + ny * r, rx: x - nx * r, ry: y - ny * r };
    });
    const head = sides[0], tail = sides[sides.length - 1];

    // A soft shadow below, so it reads as above the page.
    if (detail > 0) {
      ctx.save();
      ctx.globalAlpha = pet.mode === "sleep" || pet.mode === "rest" ? 0.16 : 0.12;
      ctx.translate(0, ["rest", "sleep"].includes(pet.mode) ? 3 * s : 14 * s);
      bodyPath(ctx, sides);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
    }
    // Wings behind the body.
    for (const side of [1, -1]) wing(ctx, pet, sides, side, colours);
    // Legs, tucked back in flight and set down when sitting.
    for (const at of [SHOULDER + 1, HIP]) for (const side of [1, -1]) leg(ctx, pet, sides, at, side, colours);
    // The body: one path, shaded from head to tail.
    bodyPath(ctx, sides);
    const shade = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    shade.addColorStop(0, css(colours.body));
    shade.addColorStop(0.55, css(colours.body2));
    shade.addColorStop(1, css(mix(colours.body2, BLACK, 0.25)));
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.lineWidth = 1 * s;
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.45), 0.7);
    ctx.stroke();
    // The lighter ridge down the back.
    ctx.lineCap = "round";
    for (let index = 1; index < sides.length - 2; index += 1) {
      const a = sides[index], b = sides[index + 1];
      ctx.strokeStyle = css(colours.belly, 0.42 - index * 0.012);
      ctx.lineWidth = Math.max(0.6, radius(index) * 0.62);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Plates along the spine.
    if (detail > 0) {
      ctx.fillStyle = css(colours.horn, 0.88);
      for (let index = 2; index < sides.length - 3; index += 2) {
        const { fx, fy, nx, ny } = normalAt(spine, index);
        const p = sides[index];
        const long = radius(index) * 0.62, wide = radius(index) * 0.34;
        ctx.beginPath();
        ctx.moveTo(p.x + fx * long, p.y + fy * long);
        ctx.lineTo(p.x + nx * wide, p.y + ny * wide);
        ctx.lineTo(p.x - fx * long * 0.8, p.y - fy * long * 0.8);
        ctx.lineTo(p.x - nx * wide, p.y - ny * wide);
        ctx.closePath(); ctx.fill();
      }
    }
    tailTip(ctx, pet, sides, colours);
    headShape(ctx, pet, colours);
    particles(ctx, pet, colours);
  }
  function bodyPath(ctx, sides) {
    ctx.beginPath();
    ctx.moveTo(sides[0].lx, sides[0].ly);
    for (let index = 1; index < sides.length; index += 1) {
      const a = sides[index - 1], b = sides[index];
      ctx.quadraticCurveTo(a.lx, a.ly, (a.lx + b.lx) / 2, (a.ly + b.ly) / 2);
    }
    const end = sides[sides.length - 1];
    ctx.lineTo(end.x, end.y);
    for (let index = sides.length - 1; index > 0; index -= 1) {
      const a = sides[index], b = sides[index - 1];
      ctx.quadraticCurveTo(a.rx, a.ry, (a.rx + b.rx) / 2, (a.ry + b.ry) / 2);
    }
    ctx.lineTo(sides[0].rx, sides[0].ry);
    ctx.closePath();
  }
  function wing(ctx, pet, sides, side, colours) {
    const s = pet.size;
    const { fx, fy, nx, ny } = normalAt(pet.spine, SHOULDER);
    const ox = nx * side, oy = ny * side; // out from the body
    const root = sides[SHOULDER];
    const sx = root.x + ox * RADII[SHOULDER] * s * 0.7, sy = root.y + oy * RADII[SHOULDER] * s * 0.7;
    // Seen from above, a wing on the downstroke looks wide and on the
    // upstroke looks short; folded, it lies back along the body.
    const beat = 0.5 + 0.5 * Math.cos(pet.flap);
    const fold = pet.fold ?? 0;
    const spread = lerp(1, 0.3 + 0.7 * beat, pet.flapAmp) * (1 - fold * 0.7);
    // How far the whole wing swings back from straight out.
    const sweep = lerp(0.12, 1.2, fold) + (1 - beat) * 0.18 * pet.flapAmp;
    const turn = (angle) => [Math.cos(angle) * ox - Math.sin(angle) * fx, Math.cos(angle) * oy - Math.sin(angle) * fy];
    // The arm: out from the shoulder and a little forward, to the wrist.
    const tuck = 1 - fold * 0.5;
    const arm = 23 * s * (0.45 + 0.55 * spread) * tuck;
    const [ax, ay] = turn(sweep - 0.22);
    const wx = sx + ax * arm, wy = sy + ay * arm;
    // Four fingers fan from the wrist, from the long one at the wing tip
    // round to a short one pointing back toward the hip, and the skin
    // stretches between them in scallops.
    const fingers = [[0.3, 35], [0.85, 31], [1.4, 26], [1.95, 20]].map(([bend, length]) => {
      const [dx, dy] = turn(sweep + bend * (1 - fold * 0.35));
      const reach = length * s * (0.42 + 0.58 * spread) * tuck;
      return { x: wx + dx * reach, y: wy + dy * reach };
    });
    const back = sides[WING_END + 1];
    const bx = back.x + ox * RADII[WING_END + 1] * s * 0.6, by = back.y + oy * RADII[WING_END + 1] * s * 0.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(wx, wy);
    ctx.lineTo(fingers[0].x, fingers[0].y);
    for (let index = 1; index < fingers.length; index += 1) {
      const a = fingers[index - 1], b = fingers[index];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ctx.quadraticCurveTo(lerp(mx, wx, 0.38), lerp(my, wy, 0.38), b.x, b.y);
    }
    const last = fingers[fingers.length - 1];
    ctx.quadraticCurveTo(lerp((last.x + bx) / 2, wx, 0.3), lerp((last.y + by) / 2, wy, 0.3), bx, by);
    ctx.closePath();
    const shine = ctx.createLinearGradient(sx, sy, fingers[1].x, fingers[1].y);
    shine.addColorStop(0, css(colours.wing, 0.78));
    shine.addColorStop(1, css(mix(colours.wing, colours.edge, 0.5), 0.5));
    ctx.fillStyle = shine;
    ctx.fill();
    ctx.lineWidth = 0.9 * s;
    ctx.strokeStyle = css(colours.edge, 0.75);
    ctx.stroke();
    // The bones over the membrane.
    ctx.strokeStyle = css(mix(colours.body2, colours.horn, 0.35), 0.95);
    ctx.lineCap = "round";
    ctx.lineWidth = 2.1 * s;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(wx, wy); ctx.stroke();
    ctx.lineWidth = 1.1 * s;
    for (const tip of fingers) { ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(tip.x, tip.y); ctx.stroke(); }
    // A little claw at the wrist.
    ctx.fillStyle = css(colours.horn);
    ctx.beginPath(); ctx.arc(wx, wy, 1.4 * s, 0, TAU); ctx.fill();
  }
  function leg(ctx, pet, sides, at, side, colours) {
    const s = pet.size;
    const { fx, fy, nx, ny } = normalAt(pet.spine, at);
    const ox = nx * side, oy = ny * side;
    const root = sides[at];
    const hipX = root.x + ox * RADII[at] * s * 0.75, hipY = root.y + oy * RADII[at] * s * 0.75;
    const sitting = ["rest", "sleep", "coil"].includes(pet.mode);
    // Tucked: pointing back along the body. Sitting: out to the side.
    const angle = sitting ? 0.35 : 1.15;
    const dx = Math.cos(angle) * ox - Math.sin(angle) * fx, dy = Math.cos(angle) * oy - Math.sin(angle) * fy;
    const kneeX = hipX + dx * 5.2 * s, kneeY = hipY + dy * 5.2 * s;
    const footX = kneeX + (dx * 0.4 - fx * (sitting ? 0.2 : 0.9)) * 5 * s, footY = kneeY + (dy * 0.4 - fy * (sitting ? 0.2 : 0.9)) * 5 * s;
    ctx.strokeStyle = css(colours.body2);
    ctx.lineCap = "round";
    ctx.lineWidth = 2.6 * s; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.lineWidth = 1.9 * s; ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
    ctx.strokeStyle = css(colours.horn);
    ctx.lineWidth = 0.8 * s;
    for (const spread of [-0.5, 0, 0.5]) {
      const cx = Math.cos(spread) * (footX - kneeX) - Math.sin(spread) * (footY - kneeY), cy = Math.sin(spread) * (footX - kneeX) + Math.cos(spread) * (footY - kneeY);
      const length = Math.hypot(cx, cy) || 1;
      ctx.beginPath(); ctx.moveTo(footX, footY); ctx.lineTo(footX + (cx / length) * 2.2 * s, footY + (cy / length) * 2.2 * s); ctx.stroke();
    }
  }
  function tailTip(ctx, pet, sides, colours) {
    const s = pet.size;
    const end = sides[sides.length - 1], before = sides[sides.length - 3];
    const angle = Math.atan2(end.y - before.y, end.x - before.x);
    const flicker = 1 + Math.sin(pet.clock * 9) * 0.08;
    const length = 12 * s * flicker, width = 5.5 * s;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const at = (along, across) => [end.x + cos * along - sin * across, end.y + sin * along + cos * across];
    ctx.beginPath();
    ctx.moveTo(...at(-1, 0));
    ctx.quadraticCurveTo(...at(length * 0.25, width * 1.15), ...at(length, 0));
    ctx.quadraticCurveTo(...at(length * 0.25, -width * 1.15), ...at(-1, 0));
    const glow = ctx.createLinearGradient(...at(0, 0), ...at(length, 0));
    glow.addColorStop(0, css(colours.body2));
    glow.addColorStop(1, css(mix(colours.wing, colours.edge, 0.4)));
    ctx.fillStyle = glow;
    ctx.fill();
  }
  function headShape(ctx, pet, colours) {
    const s = pet.size;
    const head = pet.spine[0], neck = pet.spine[1];
    const angle = Math.atan2(head.y - neck.y, head.x - neck.x) + pet.look;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(angle);
    ctx.scale(s * 1.32, s * 1.32);
    // Whiskers trail back and sway with the flight.
    const sway = Math.sin(pet.clock * 3.1) * 3 + clamp(pet.speed / 60, 0, 4);
    ctx.strokeStyle = css(colours.belly, 0.8);
    ctx.lineWidth = 0.75;
    ctx.lineCap = "round";
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(13, side * 2.6);
      ctx.bezierCurveTo(9, side * (9 + sway * 0.4), -2, side * (12 + sway), -11 - sway, side * (15 + sway * 0.6));
      ctx.stroke();
    }
    // Horns, swept back.
    ctx.fillStyle = css(colours.horn);
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(-0.5, side * 3);
      ctx.quadraticCurveTo(-6, side * 9.5, -15, side * 9.8);
      ctx.quadraticCurveTo(-7, side * 6.4, 1.5, side * 5.8);
      ctx.closePath(); ctx.fill();
    }
    // A little crest between them.
    ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-10, 1.6); ctx.lineTo(-8, 0); ctx.lineTo(-10, -1.6); ctx.closePath(); ctx.fill();
    // Skull and snout as one shape.
    ctx.beginPath();
    ctx.moveTo(-5.5, 0);
    ctx.bezierCurveTo(-5.5, -7.4, 3.5, -7.6, 6, -4.6);
    ctx.quadraticCurveTo(12.5, -4.1, 15.6, -2);
    ctx.quadraticCurveTo(17.4, 0, 15.6, 2);
    ctx.quadraticCurveTo(12.5, 4.1, 6, 4.6);
    ctx.bezierCurveTo(3.5, 7.6, -5.5, 7.4, -5.5, 0);
    const skull = ctx.createLinearGradient(-6, 0, 16, 0);
    skull.addColorStop(0, css(mix(colours.body, colours.body2, 0.2)));
    skull.addColorStop(1, css(mix(colours.body, WHITE, 0.12)));
    ctx.fillStyle = skull;
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.45), 0.7);
    ctx.stroke();
    // An open mouth while breathing fire.
    if (pet.mouth > 0.05) {
      ctx.fillStyle = css([40, 10, 10], 0.85 * pet.mouth);
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(17, -1.8 * pet.mouth); ctx.lineTo(17, 1.8 * pet.mouth); ctx.closePath(); ctx.fill();
    }
    // Brow ridges and nostrils.
    ctx.fillStyle = css(colours.belly, 0.5);
    for (const side of [1, -1]) { ctx.beginPath(); ctx.ellipse(4, side * 4.2, 3.4, 1.3, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = css(mix(colours.body2, BLACK, 0.6), 0.9);
    for (const side of [1, -1]) { ctx.beginPath(); ctx.arc(14.3, side * 1.3, 0.7, 0, TAU); ctx.fill(); }
    // Eyes: a soft glow, the eye, a slit; shut while asleep or blinking.
    const shut = pet.mode === "sleep" || pet.blink > 0;
    for (const side of [1, -1]) {
      const ex = 5.4, ey = side * 3.9;
      if (shut) {
        ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.55));
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.arc(ex, ey - side * 0.3, 1.9, side > 0 ? 0.2 : Math.PI + 0.2, side > 0 ? Math.PI - 0.2 : TAU - 0.2); ctx.stroke();
        continue;
      }
      const halo = ctx.createRadialGradient(ex, ey, 0, ex, ey, 4.6);
      halo.addColorStop(0, css(colours.eye, 0.55));
      halo.addColorStop(1, css(colours.eye, 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(ex, ey, 4.6, 0, TAU); ctx.fill();
      ctx.fillStyle = css(colours.eye);
      ctx.beginPath(); ctx.ellipse(ex, ey, 2.3, 1.6, side * 0.25, 0, TAU); ctx.fill();
      ctx.fillStyle = css([20, 12, 8]);
      ctx.beginPath(); ctx.ellipse(ex + 0.3, ey, 0.55, 1.35, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  function particles(ctx, pet, colours) {
    if (!pet.particles.length) return;
    ctx.save();
    for (const bit of pet.particles) {
      const age = 1 - bit.life / bit.max;
      if (bit.kind === "fire") {
        const [hot, warm, cool] = colours.fire;
        const colour = age < 0.35 ? mix(hot, warm, age / 0.35) : mix(warm, cool, clamp((age - 0.35) / 0.65, 0, 1));
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = css(colour, (1 - age) * 0.85);
        ctx.beginPath(); ctx.arc(bit.x, bit.y, Math.max(0.5, bit.size * (1 - age * 0.7) * pet.size), 0, TAU); ctx.fill();
      } else if (bit.kind === "smoke") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = css([150, 150, 160], (1 - age) * 0.35);
        ctx.beginPath(); ctx.arc(bit.x, bit.y, bit.size * (0.6 + age), 0, TAU); ctx.fill();
      } else if (bit.kind === "z") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = css(colours.belly, (1 - age) * 0.9);
        ctx.font = `600 ${Math.round(bit.size + age * 5)}px system-ui, sans-serif`;
        ctx.fillText("z", bit.x, bit.y);
      } else if (bit.kind === "heart") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = css([255, 110, 150], (1 - age));
        const r = bit.size * 0.5;
        ctx.beginPath();
        ctx.moveTo(bit.x, bit.y + r);
        ctx.bezierCurveTo(bit.x - r * 2, bit.y - r * 0.4, bit.x - r * 0.6, bit.y - r * 2, bit.x, bit.y - r * 0.7);
        ctx.bezierCurveTo(bit.x + r * 0.6, bit.y - r * 2, bit.x + r * 2, bit.y - r * 0.4, bit.x, bit.y + r);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = "lighter";
        const twinkle = 0.6 + 0.4 * Math.sin(bit.life * 30);
        ctx.fillStyle = css(mix(colours.edge, WHITE, 0.4), (1 - age) * twinkle);
        const r = bit.size;
        ctx.beginPath();
        ctx.moveTo(bit.x, bit.y - r * 2); ctx.lineTo(bit.x + r * 0.5, bit.y - r * 0.5); ctx.lineTo(bit.x + r * 2, bit.y); ctx.lineTo(bit.x + r * 0.5, bit.y + r * 0.5);
        ctx.lineTo(bit.x, bit.y + r * 2); ctx.lineTo(bit.x - r * 0.5, bit.y + r * 0.5); ctx.lineTo(bit.x - r * 2, bit.y); ctx.lineTo(bit.x - r * 0.5, bit.y - r * 0.5);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---- the owner's choices ----------------------------------------------------
  function readStore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { saved = null; }
    const out = { ...DEFAULTS };
    if (saved && typeof saved === "object") {
      if (typeof saved.on === "boolean") out.on = saved.on;
      if (KINDS.some((kind) => kind.id === saved.kind)) out.kind = saved.kind;
      if (SKIN_LIST.some((skin) => skin.id === saved.skin)) out.skin = saved.skin;
      if (typeof saved.name === "string" && saved.name.trim()) out.name = saved.name.trim().slice(0, 24);
      if (typeof saved.calm === "boolean") out.calm = saved.calm;
      if (typeof saved.come === "boolean") out.come = saved.come;
      if ([0.8, 1, 1.25].includes(Number(saved.size))) out.size = Number(saved.size);
    }
    return out;
  }
  let prefs = readStore();
  const writeStore = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch { /* a private store: the choice lasts this session */ } };
  const owns = (item) => !item || window.MefiShop?.owns?.(item) === true;
  let borrowed = null; // a Shop Try: { kind, skin, until, timer }
  function look() {
    if (borrowed) return { on: true, kind: borrowed.kind || prefs.kind, skin: borrowed.skin || prefs.skin };
    const kind = KINDS.find((item) => item.id === prefs.kind) || KINDS[0];
    const skin = SKIN_LIST.find((item) => item.id === prefs.skin) || SKIN_LIST[0];
    return { on: prefs.on && owns(kind.item), kind: kind.id, skin: owns(skin.item) ? skin.id : "theme" };
  }

  // ---- living on the page -----------------------------------------------------
  const CANVAS = 360; // css px; the pet and its fire fit inside
  const live = { canvas: null, ctx: null, sim: null, running: false, raf: 0, timer: 0, last: 0, painted: 0, dpr: 1, cost: 0, colours: null };
  const input = { x: null, y: null, at: 0, speed: 0, keyAt: -1e9, anyAt: now(), still: 0 };
  const world = { width: 1280, height: 800, pointer: null, quiet: 0, typing: false, motion: "on", avoid: [], perches: [], react: null, visit: null, come: true, calm: true, background: false };
  const headless = () => /[?&](smoke|capture)=1\b/.test(String(window.location?.search || ""));
  const motionMode = () => {
    const mode = document.documentElement?.dataset?.motion;
    if (window.MefiNav?.noMotion?.() === true || mode === "off") return "off";
    return mode === "calm" ? "calm" : "on";
  };
  function ensureCanvas() {
    if (live.canvas) return live.canvas;
    const canvas = document.createElement("canvas");
    canvas.id = "studio-pet";
    canvas.setAttribute("aria-hidden", "true");
    canvas.className = "studio-pet";
    document.body.append(canvas);
    live.canvas = canvas;
    live.ctx = canvas.getContext?.("2d") || null;
    sizeCanvas();
    return canvas;
  }
  function sizeCanvas() {
    if (!live.canvas) return;
    live.dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    live.canvas.width = Math.round(CANVAS * live.dpr);
    live.canvas.height = Math.round(CANVAS * live.dpr);
    live.canvas.style.width = `${CANVAS}px`;
    live.canvas.style.height = `${CANVAS}px`;
  }
  // The things it keeps clear of, and the edges it sits on: read now and then, not every frame.
  let lookedAt = 0;
  function readPage() {
    world.width = Math.max(200, window.innerWidth || 1280);
    world.height = Math.max(200, window.innerHeight || 800);
    const avoid = [];
    const dialog = document.querySelector?.('[aria-modal="true"]:not([hidden])');
    const box = (node) => { const rect = node?.getBoundingClientRect?.(); return rect && rect.width > 0 && rect.height > 0 ? rect : null; };
    const modal = box(dialog);
    if (modal) avoid.push(modal);
    const active = document.activeElement;
    if (active && active !== document.body && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) { const rect = box(active); if (rect) avoid.push(rect); }
    world.avoid = avoid;
    // Perches: the top edge of the status bar and the bottom edge of the top
    // bar, away from their middles, plus the window's lower corners.
    const perches = [];
    const bars = ["#app-status", ".shell-status", "#shell-status", "#app-top", ".shell-top", "#shell-top", "#app-tabs"];
    for (const selector of bars) {
      const rect = box(document.querySelector?.(selector));
      if (!rect || rect.width < 240) continue;
      const y = rect.top > world.height / 2 ? rect.top : rect.bottom;
      perches.push({ x: rect.left + rect.width * 0.12, y }, { x: rect.right - rect.width * 0.14, y });
    }
    if (!perches.length) perches.push({ x: 120, y: world.height - 24 }, { x: world.width - 140, y: world.height - 24 });
    world.perches = perches;
    lookedAt = now();
  }
  function noteInput(event) {
    const at = now();
    input.anyAt = at;
    if (event.type === "keydown") { input.keyAt = at; return; }
    if (typeof event.clientX !== "number") return;
    if (input.x !== null) {
      const gap = Math.max(1, at - input.at);
      const speed = Math.hypot(event.clientX - input.x, event.clientY - input.y) / gap * 1000;
      input.speed = lerp(input.speed, speed, 0.5);
    }
    input.x = event.clientX; input.y = event.clientY; input.at = at;
  }
  function inputWorld(at) {
    world.quiet = (at - input.anyAt) / 1000;
    world.typing = at - input.keyAt < 2500;
    if (input.x === null) { world.pointer = null; return; }
    const still = (at - input.at) / 1000;
    if (still > 0.15) input.speed = lerp(input.speed, 0, 0.3);
    world.pointer = { x: input.x, y: input.y, speed: input.speed, still };
  }
  // A step for every frame; a paint as often as the mode needs: smooth in
  // flight, slower while sitting, slowest asleep.
  const FPS = { rest: 15, sleep: 6, coil: 40 };
  function frame(at) {
    live.raf = 0; live.timer = 0;
    if (!live.running) return;
    const dt = Math.min(0.05, Math.max(0, (at - (live.last || at)) / 1000));
    live.last = at;
    if (at - lookedAt > 700) readPage();
    inputWorld(at);
    world.motion = motionMode();
    world.background = typeof document.hasFocus === "function" ? !document.hasFocus() : false;
    world.calm = prefs.calm; world.come = prefs.come;
    live.sim.step(dt, world);
    paint();
    schedule();
  }
  function schedule() {
    if (!live.running || live.raf || live.timer) return;
    const mode = live.sim?.pet?.mode;
    const still = world.motion === "off" && mode === "sleep";
    if (still) return; // drawn once, nothing moves
    const fps = FPS[mode] || 60;
    if (fps >= 60 || typeof setTimeout !== "function") live.raf = requestAnimationFrame(frame);
    else live.timer = setTimeout(() => { live.timer = 0; live.raf = requestAnimationFrame(frame); }, 1000 / fps);
  }
  function paint() {
    const { canvas, ctx, sim } = live;
    if (!canvas || !ctx || !sim) return;
    const pet = sim.pet;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of pet.spine) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const left = Math.round(cx - CANVAS / 2), top = Math.round(cy - CANVAS / 2);
    canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    const started = now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(live.dpr, 0, 0, live.dpr, -left * live.dpr, -top * live.dpr);
    paintPet(ctx, pet, look().skin, { detail: live.cost > 5 ? 0 : 1 });
    live.cost = lerp(live.cost, now() - started, 0.1);
    live.painted += 1;
  }
  function start() {
    if (live.running || headless() || typeof requestAnimationFrame !== "function") return;
    ensureCanvas();
    if (!live.ctx) return;
    readPage();
    if (!live.sim) live.sim = flight({ seed: Math.floor(Math.random() * 1e9), size: prefs.size, width: world.width, height: world.height });
    live.sim.pet.size = look().on ? prefs.size : 1;
    live.running = true;
    live.canvas.hidden = false;
    live.last = 0;
    schedule();
  }
  function stop() {
    live.running = false;
    if (live.raf) cancelAnimationFrame(live.raf);
    if (live.timer) clearTimeout(live.timer);
    live.raf = 0; live.timer = 0;
    if (live.canvas) live.canvas.hidden = true;
  }
  function sync() {
    const visible = document.visibilityState !== "hidden";
    if (look().on && visible) start(); else stop();
  }
  function wake() { if (live.running && !live.raf && !live.timer) { live.last = 0; schedule(); } }

  // ---- reacting to the studio -------------------------------------------------
  let running = null;
  let inbox = null;
  function react(kind) {
    if (!live.sim || !["celebrate", "alert", "wake"].includes(kind)) return false;
    world.react = kind;
    if (kind === "alert") {
      const target = document.querySelector?.('#app-inbox, [data-nav="inbox"], #shell-inbox, .shell-inbox');
      const rect = target?.getBoundingClientRect?.();
      world.visit = rect && rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: world.width - 90, y: 40 };
    }
    wake();
    return true;
  }
  function onBadges(event) {
    const badges = event?.detail?.badges || {};
    const busy = Number(badges.progress) || 0;
    // A job finished: fewer running than before, and nothing new needs you.
    if (running !== null && busy < running && !(Number(badges.questions) > 0)) react("celebrate");
    running = busy;
  }
  function onInbox(event) {
    const count = Number(event?.detail?.count) || 0;
    if (inbox !== null && count > inbox && prefs.come) react("alert");
    inbox = count;
  }

  // ---- settings and the Shop's Try --------------------------------------------
  function set(patch = {}) {
    const next = { ...prefs };
    if (typeof patch.on === "boolean") next.on = patch.on;
    if (KINDS.some((kind) => kind.id === patch.kind)) next.kind = patch.kind;
    if (SKIN_LIST.some((skin) => skin.id === patch.skin)) next.skin = patch.skin;
    if (typeof patch.name === "string") next.name = patch.name.trim().slice(0, 24) || DEFAULTS.name;
    if (typeof patch.calm === "boolean") next.calm = patch.calm;
    if (typeof patch.come === "boolean") next.come = patch.come;
    if ([0.8, 1, 1.25].includes(Number(patch.size))) next.size = Number(patch.size);
    prefs = next;
    writeStore();
    if (live.sim) live.sim.pet.size = prefs.size;
    sync();
    window.dispatchEvent?.(new CustomEvent("mefi:pet", { detail: state() }));
    return state();
  }
  function state() {
    const shown = look();
    return { on: shown.on, kind: shown.kind, skin: shown.skin, name: prefs.name, calm: prefs.calm, come: prefs.come, size: prefs.size, chosen: { ...prefs }, preview: Boolean(borrowed) };
  }
  function preview(choice = {}, ms = 120000) {
    endPreview({ quiet: true });
    const kind = KINDS.some((item) => item.id === choice.kind) ? choice.kind : prefs.kind;
    const skin = SKIN_LIST.some((item) => item.id === choice.skin) ? choice.skin : prefs.skin;
    borrowed = { kind, skin, until: Date.now() + Math.max(1000, Math.min(600000, Number(ms) || 120000)) };
    borrowed.timer = setTimeout(() => endPreview(), borrowed.until - Date.now());
    sync();
    react("wake");
    return borrowed.until;
  }
  function endPreview({ quiet = false } = {}) {
    if (!borrowed) return false;
    clearTimeout(borrowed.timer);
    borrowed = null;
    sync();
    if (!quiet) window.dispatchEvent?.(new CustomEvent("mefi:pet", { detail: state() }));
    return true;
  }
  // One frame of a pet for a Shop card: flying in a gentle circle at `time`.
  function paintPreview(canvas, { kind = "dragon", skin = "theme", time = 0, pose = "fly", size = null } = {}) {
    const ctx = canvas?.getContext?.("2d");
    if (!ctx || kind !== "dragon") return false;
    const width = canvas.clientWidth || canvas.width, height = canvas.clientHeight || canvas.height;
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    if (canvas.width !== Math.round(width * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const sim = flight({ seed: 3, size: Number(size) > 0 ? Number(size) : Math.min(1, Math.min(width, height) / 150), width, height });
    const pet = sim.pet;
    const cx = width / 2, cy = height / 2;
    if (pose === "rest") {
      pet.perch = { x: cx, y: cy + 22 * pet.size };
      sim.settle({ width, height });
      pet.mode = "rest"; pet.clock = time; pet.breathe = time * 2.2;
    } else {
      // Fly a circle: the head goes round, the body trails.
      const radius = Math.min(width, height) * 0.26;
      for (let at = time - 3; at <= time; at += 1 / 60) {
        const angle = at * 1.4;
        pet.x = cx + Math.cos(angle) * radius * 1.25; pet.y = cy + Math.sin(angle) * radius * 0.8;
        pet.spine[0].x = pet.x; pet.spine[0].y = pet.y;
        follow(pet.spine, pet.size);
      }
      pet.mode = "wander"; pet.clock = time; pet.flap = time * 8.5; pet.flapAmp = 1; pet.fold = 0; pet.speed = 150;
    }
    // Centred on the body and the snout, whatever pose it ended in, and a
    // little higher than the middle for the shadow under it.
    const head = pet.spine[0], neck = pet.spine[1];
    const facing = Math.atan2(head.y - neck.y, head.x - neck.x);
    const snout = { x: head.x + Math.cos(facing) * 22 * pet.size, y: head.y + Math.sin(facing) * 22 * pet.size };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of [...pet.spine, snout]) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
    const shiftX = cx - (minX + maxX) / 2, shiftY = cy - (minY + maxY) / 2 - (pose === "rest" ? 2 : 7) * pet.size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, shiftX * dpr, shiftY * dpr);
    paintPet(ctx, pet, skin);
    return true;
  }

  // ---- Settings › Appearance › Interface: the pet and the menu effect ---------
  // One card for both Shop looks. What is not owned yet says where to get it
  // and offers the Shop's two-minute Try; nothing here sells anything.
  const SHOP = (view) => () => { if (window.MefiShop?.open) window.MefiShop.open(view); else window.MefiNav?.go?.("friends", { place: "shop" }); };
  let card = null;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function switchRow(text, on, change, disabled = false) {
    const label = el("label", "switch");
    const input = el("input"); input.type = "checkbox"; input.checked = Boolean(on); input.disabled = disabled;
    input.addEventListener("change", () => change(input.checked));
    label.append(input, el("span", "track"), el("span", "", text));
    return label;
  }
  function paintCard() {
    if (!card) return;
    const body = card.querySelector(".settings-flair-body");
    const shown = state();
    const rows = [];
    // The pet.
    const pet = el("div", "field settings-flair-pet");
    pet.append(el("span", "field-label", "Pet"));
    const save = fromCard((patch) => set(patch));
    pet.append(switchRow(`${prefs.name} the dragon flies around the studio`, prefs.on, (on) => save({ on })));
    {
      const skins = el("select"); skins.setAttribute("aria-label", "Pet colours");
      for (const skin of SKIN_LIST) {
        const option = el("option", "", owns(skin.item) ? skin.name : `${skin.name} (in the Shop)`);
        option.value = skin.id; option.disabled = !owns(skin.item);
        skins.append(option);
      }
      skins.value = shown.skin;
      skins.addEventListener("change", () => save({ skin: skins.value }));
      const name = el("input", "settings-flair-name"); name.type = "text"; name.maxLength = 24; name.value = prefs.name; name.setAttribute("aria-label", "Pet name");
      name.addEventListener("change", () => save({ name: name.value }));
      const line = el("div", "settings-you-row settings-flair-row");
      line.append(skins, name);
      pet.append(line);
      pet.append(switchRow("Stays on its perch while you type", prefs.calm, (calm) => save({ calm })));
      pet.append(switchRow("Comes to tell you when something needs you", prefs.come, (come) => save({ come })));
    }
    // Skins that are not owned yet: a Try and the way to the Shop.
    if (SKIN_LIST.some((skin) => skin.item && !owns(skin.item))) {
      const line = el("div", "settings-you-row settings-flair-row");
      const tryIt = el("button", "ghost mini", "Try a skin for 2 minutes"); tryIt.type = "button";
      tryIt.addEventListener("click", () => preview({ kind: "dragon", skin: (SKIN_LIST.find((skin) => skin.item && !owns(skin.item)) || SKIN_LIST[0]).id }));
      const get = el("button", "ghost mini", "More skins in the Shop"); get.type = "button";
      get.addEventListener("click", SHOP("studio"));
      line.append(tryIt, get);
      pet.append(line);
    }
    rows.push(pet);
    // The menu effect.
    const effects = window.MefiEffects;
    if (effects?.list) {
      const field = el("div", "field settings-flair-effect");
      const label = el("label", "field-label", "When a menu closes"); label.htmlFor = "settings-exit-effect";
      const pick = el("select"); pick.id = "settings-exit-effect";
      const none = el("option", "", "It fades out"); none.value = "none"; pick.append(none);
      for (const effect of effects.list()) {
        const has = window.MefiShop?.owns?.(effect.item) === true;
        const option = el("option", "", has ? effect.name : `${effect.name} (in the Shop)`);
        option.value = effect.id; option.disabled = !has;
        pick.append(option);
      }
      pick.value = effects.current?.() || "none";
      pick.addEventListener("change", fromCard(() => effects.use(pick.value)));
      field.append(label, pick, el("span", "field-hint", "Motion Off always closes menus at once."));
      rows.push(field);
    }
    const shop = el("button", "ghost mini settings-flair-shop", "Open the Shop"); shop.type = "button";
    shop.addEventListener("click", SHOP("studio"));
    rows.push(shop);
    body.replaceChildren(...rows);
  }
  // A change made on the card is already shown there: repainting it would
  // only take the keyboard focus away. Changes from elsewhere repaint it.
  let cardChanging = false;
  const fromCard = (fn) => (...args) => { cardChanging = true; try { return fn(...args); } finally { cardChanging = false; } };
  const repaintCard = () => { if (!cardChanging) paintCard(); };
  function mountCard() {
    const pane = document.getElementById("settings-category-appearance");
    if (!pane || card) return;
    card = el("section", "settings-card settings-flair");
    card.id = "settings-flair";
    card.dataset.appearancePanel = "interface";
    const head = el("div", "settings-card-head");
    const words = el("div");
    words.append(el("h3", "", "Pet and menu effects"), el("p", "muted", "Ember comes with every Studio. Skins and menu effects are in the Shop: try any for two minutes first."));
    head.append(words);
    card.append(head, el("div", "settings-flair-body"));
    const after = pane.querySelector("#settings-appearance");
    if (after?.after) after.after(card); else pane.append(card);
    // Shown with the Interface section, as music.js shows the others.
    const pressed = pane.querySelector('[data-appearance-section][aria-pressed="true"]')?.dataset?.appearanceSection;
    card.hidden = document.body.classList.contains("appearance-settings-active") && pressed && pressed !== "interface";
    paintCard();
  }

  function init() {
    if (init.done) return;
    init.done = true;
    mountCard();
    for (const type of ["mefi-shop-owned", "mefi:pet", "mefi:effects"]) window.addEventListener(type, repaintCard);
    for (const type of ["pointermove", "pointerdown", "keydown", "wheel"]) window.addEventListener(type, noteInput, { passive: true, capture: true });
    window.addEventListener("resize", () => { sizeCanvas(); readPage(); });
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", wake);
    window.addEventListener("mefi:nav-badges", onBadges);
    window.addEventListener("mefi:inbox", onInbox);
    window.addEventListener("mefi-shop-owned", sync);
    // The theme skin follows the theme.
    window.addEventListener("mefi-theme-change", () => { if (live.running) paint(); });
    sync();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else setTimeout(init, 0);

  window.MefiPets = {
    kinds: () => KINDS.map((kind) => ({ ...kind })),
    skins: () => SKIN_LIST.map((skin) => ({ ...skin })),
    state, set, preview, endPreview, react, paintPreview,
    // For tests and the Shop: a pet's flight to step without the page.
    simulate: (options) => flight(options),
    paint: (ctx, pet, skin, options) => paintPet(ctx, pet, skin, options),
  };
})();
