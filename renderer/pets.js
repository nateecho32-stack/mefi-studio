// Mefi's Studio AI+ — the studio pets (window.MefiPets).
//
// Ember is a small dragon that lives over the studio, and the Shop has more
// pets: a cloud dragon, a phoenix and a will-o'-wisp. A pet is drawn on a
// small canvas of its own (#studio-pet) that travels with it, so nothing
// under it repaints, and clicks always go through it (pointer-events: none).
// It wanders near the edges of the window, comes over to look at the pointer
// when the pointer rests, curls up on the edge of a bar to nap, does a loop
// and a puff of fire when a job finishes, and flies to the Inbox when
// something needs you. Rest the pointer on it and it stops, turns to look at
// the pointer and purrs, with a few hearts and its name; circle the pointer
// quickly near it and it gives chase for a moment. Now and then it does a
// little thing of its own: a stretch and a yawn as it wakes, a flick of the
// tail while it rests, a tiny sneeze of sparks, a firefly to chase. While you
// type it stays on its perch; after a few quiet minutes, or while the window
// is in the background, it sleeps; while the window is hidden it stops
// altogether. With motion off (html[data-motion=off]) it naps in one still
// pose and never moves, and with calm motion it keeps to its perch and its
// little things stay small.
//
// Ember comes free with every Studio: a new profile's first run switches it
// on (renderer/setup-helper.js, the look step), and Settings › Appearance
// switches it on or off. The other pets and the skins are Shop items
// (renderer/friends-shop.js): nothing here decides what is owned, it asks
// MefiShop.owns(), and a pet or skin that is not owned falls back to Ember in
// its theme's colours. A Try in the Shop borrows one for a while (preview)
// without saving anything. The owner's choices live in localStorage
// mefiStudio.pet.v1, so a restart brings the pet back the way it was.
//
//   kinds(), skins(), state(), set(patch), preview(look, ms), endPreview(),
//   react("celebrate" | "alert" | "wake"), guests(list),
//   paintPreview(canvas, { kind, skin, time, pose, size }), one frame, any size,
//   livePreview(canvas, { kind, skin, pose }) -> { set(options), stop() }, kept moving while on screen
//
// Kill switches, per device (localStorage): "mefiStudio.pet.antics" = "off"
// stops the little things, and "mefiStudio.pet.livePreview" = "off" keeps
// the Settings and first-run previews still. Petting and the chase follow
// the card's "Plays with your pointer" switch (touch).
//
// The flight is a small simulation (flight below) stepped by a clamped
// clock, kept apart from the drawing (paint below), so the tests fly it
// without a canvas: MefiPets.simulate(options) returns one to step.
(function () {
  "use strict";
  const STORE = "mefiStudio.pet.v1";
  // Ember is free with every Studio: no Shop item. The others are the Shop's
  // ("studio:pet-<kind>", the relay's own check: relay/src/pets.mjs).
  const KINDS = Object.freeze([
    Object.freeze({ id: "dragon", item: null, name: "Ember the dragon", noun: "dragon", called: "Ember", moves: "flies" }),
    Object.freeze({ id: "cloud", item: "studio:pet-cloud", name: "Cloud dragon", noun: "cloud dragon", called: "Nimbus", moves: "swims" }),
    Object.freeze({ id: "phoenix", item: "studio:pet-phoenix", name: "Phoenix", noun: "phoenix", called: "Blaze", moves: "flies" }),
    Object.freeze({ id: "wisp", item: "studio:pet-wisp", name: "Will-o'-wisp", noun: "will-o'-wisp", called: "Flicker", moves: "floats" }),
  ]);
  const KIND = Object.freeze(Object.fromEntries(KINDS.map((kind) => [kind.id, kind])));
  const SKIN_LIST = Object.freeze([
    { id: "theme", item: null, name: "Your theme's colours" },
    { id: "frost", item: "studio:skin-frost", name: "Frost scales" },
    { id: "jade", item: "studio:skin-jade", name: "Jade scales" },
    { id: "void", item: "studio:skin-void", name: "Void scales" },
    { id: "gold", item: "studio:skin-gold", name: "Gold scales" },
  ]);
  const DEFAULTS = Object.freeze({ on: false, kind: "dragon", skin: "theme", name: "Ember", calm: true, come: true, touch: true, size: 1 });
  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrap = (angle) => { let a = angle % TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
  const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
  // A hump from 0 up to 1 and back over t in 0..1.
  const hump = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));

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

  // ---- the bodies -----------------------------------------------------------
  // A spine of points from the head to the tail tip. Each point follows the
  // one before it at a fixed distance and may bend only so far, so the body
  // trails the head's path in a smooth curve; the radius profile gives it its
  // shape. Each kind has its own: Ember's neck, chest and long tapering tail;
  // the cloud dragon's long, even, serpent's body; the phoenix's small body
  // and its long tail of flame feathers; the wisp's flame and its trail.
  //   wave: the path's sway (radians, radians a second); move: how it keeps
  //   aloft (wings flap, a cloud dragon swims, a wisp floats); coil and lift:
  //   how it curls up on a perch; trail: seconds between the bits of its own
  //   trail (moving, sitting).
  function shape(spec) {
    const { segments, link, bend, profile } = spec;
    const at = (t) => {
      for (let index = 1; index < profile.length; index += 1) {
        const [t1, r1] = profile[index];
        const [t0, r0] = profile[index - 1];
        if (t <= t1) { const k = (t - t0) / (t1 - t0 || 1); return lerp(r0, r1, k * k * (3 - 2 * k)); }
      }
      return profile[profile.length - 1][1];
    };
    const value = (rule, t) => (typeof rule === "function" ? rule(t) : Array.isArray(rule) ? lerp(rule[0], rule[1], t) : rule);
    const ts = Array.from({ length: segments }, (_, index) => index / (segments - 1));
    return Object.freeze({ ...spec, links: Object.freeze(ts.map((t) => value(link, t))), bends: Object.freeze(ts.map((t) => value(bend, t))), radii: Object.freeze(ts.map(at)) });
  }
  const BODIES = Object.freeze({
    dragon: shape({ segments: 26, link: [5.6, 3.3], bend: 0.42, profile: [[0, 6.4], [0.06, 4.9], [0.16, 8.2], [0.3, 7.7], [0.44, 6], [0.64, 3.6], [0.84, 2], [1, 1.1]],
      shoulder: 5, hip: 11, wingEnd: 9, coil: 15, curl: 11.57, lift: 16, wave: [0.34, 2.7], move: "wings", speed: 1, head: 18, trail: null }),
    cloud: shape({ segments: 40, link: [4.7, 3.6], bend: 0.34, profile: [[0, 4.9], [0.035, 4], [0.12, 5.6], [0.42, 5.2], [0.7, 4], [0.9, 2.6], [1, 1.6]],
      shoulder: 7, hip: 26, coil: 24, curl: 8.5, lift: 17, wave: [0.42, 2.1], move: "swim", speed: 0.95, head: 20, trail: [0.42, 1.6] }),
    phoenix: shape({ segments: 26, link: (t) => (t < 0.3 ? 3.7 : 5.5), bend: (t) => (t < 0.3 ? 0.2 : 0.44), profile: [[0, 5.2], [0.05, 4.3], [0.13, 7.2], [0.22, 6.3], [0.3, 2.6], [0.5, 1.7], [1, 1]],
      shoulder: 3, hip: 7, wingEnd: 6, tail: 8, coil: 15, curl: 3.6, lift: 15, wave: [0.18, 2], move: "wings", speed: 1.05, head: 14, trail: [0.14, 0.55] }),
    wisp: shape({ segments: 18, link: [3.4, 2.3], bend: 0.58, profile: [[0, 8.4], [0.12, 6.8], [0.3, 3.8], [0.55, 1.9], [1, 0.4]],
      coil: 13, curl: 7, lift: 20, wave: [0.46, 3.3], move: "float", speed: 0.85, head: 10, trail: [0.08, 0.22] }),
  });
  const shapeOf = (kind) => BODIES[kind] || BODIES.dragon;

  function follow(points, size, body = BODIES.dragon) {
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1], b = points[index];
      let angle = Math.atan2(b.y - a.y, b.x - a.x);
      if (index >= 2) {
        const before = points[index - 2];
        const base = Math.atan2(a.y - before.y, a.x - before.x);
        const bend = wrap(angle - base);
        const limit = body.bends[index];
        if (Math.abs(bend) > limit) angle = base + Math.sign(bend) * limit;
      }
      const link = body.links[index] * size;
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
  // needs you and hover there), play (chase round another pet), petted (stop
  // under a resting pointer, look at it and purr), chase (after a pointer
  // going round in quick circles), firefly (after a firefly), and for a
  // friend's pet that visits: arrive (fly in from an edge) and leave (fly out
  // again). A step reads only `world` (the window size, the pointer,
  // rectangles to keep clear of, perch spots, the other pets) and the clock.
  const SPEED = { wander: 150, perch: 170, dash: 380, curious: 190, visit: 260, loop: 230, play: 235, arrive: 280, leave: 320, chase: 330, firefly: 175 };
  const TURN = 4.6; // radians a second
  // The little things, in seconds: how long each lasts, and how long between them.
  const ANTICS = Object.freeze({ sneeze: [240, 540], firefly: [300, 620], flick: [6, 15], sneezeFor: 1, flickFor: 0.7, stretchFor: 2, fireflyFor: [3.5, 5.5] });
  // Where petting can start, and how long the pointer rests first.
  const TOUCHABLE = new Set(["wander", "perch", "coil", "rest", "sleep", "curious", "play", "firefly"]);
  const PET_AFTER = 0.5;
  function flight({ seed = 7, size = 1, width = 1280, height = 800, id = "you", arrive = false, kind = "dragon", at = null } = {}) {
    const body = shapeOf(kind);
    const random = seeded(seed);
    const pick = (low, high) => low + random() * (high - low);
    // The little things draw from a stream of their own, so the flight itself repeats as before.
    const chance = seeded((Number(seed) ^ 0x5bd1e995) >>> 0);
    const between = ([low, high]) => low + chance() * (high - low);
    // A visiting pet starts just outside a side of the window.
    const side = Math.floor(random() * 4);
    const start = at
      ? { x: at.x, y: at.y }
      : arrive
        ? { x: side === 0 ? -70 : side === 1 ? width + 70 : pick(80, width - 80), y: side === 2 ? -70 : side === 3 ? height + 70 : pick(80, height - 80) }
        : { x: width * 0.72, y: height * 0.2 };
    const pet = {
      id, kind: BODIES[kind] ? kind : "dragon", x: start.x, y: start.y, heading: Number.isFinite(at?.heading) ? at.heading : arrive ? Math.atan2(height / 2 - start.y, width / 2 - start.x) : Math.PI * 0.85, speed: 0, size,
      mode: "wander", modeAt: 0, clock: 0, flap: 0, flapRate: 8, flapAmp: 1, glide: 0,
      target: null, waypoints: 0, perch: null, coilAngle: 0, coilFrom: 0, blinkAt: 2, blink: 0,
      look: 0, lookGoal: 0, lookAt: 3, breathe: 0, fire: 0, mouth: 0, sleepy: 0, held: false,
      playWith: null, playFor: 0, playPhase: 0, gone: false,
      // Touch: whether the pointer is on the body, for how long, and the petting and chase it starts.
      over: false, overFor: 0, touchFrom: 99, petAway: 0, petAt: null, petSat: false, hearts: 0, purr: 0, tag: 0, sated: false, chaseFor: 0, chaseCool: 0,
      // The little things: their timers (counting down) and the firefly, when there is one.
      stretch: 0, yawn: 0, flick: 0, flickAt: between(ANTICS.flick), sneeze: 0, sneezeAt: between(ANTICS.sneeze), sneezeCalm: false,
      firefly: null, fireflyAt: between(ANTICS.firefly), fireflyFor: 0, snap: 0, trailAt: 0,
      spine: [], particles: [], events: [],
    };
    if (arrive) pet.mode = "arrive";
    // A new pet lies along the x axis to start; one given a new body lies along its heading.
    const lie = at ? pet.heading : 0;
    for (let index = 0; index < body.segments; index += 1) pet.spine.push({ x: pet.x - Math.cos(lie) * index * body.links[index] * size, y: pet.y - Math.sin(lie) * index * body.links[index] * size });
    follow(pet.spine, size, body);

    const inside = (rect, x, y, pad = 0) => x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
    const sitting = () => pet.mode === "rest" || pet.mode === "sleep" || (pet.mode === "petted" && pet.petSat);
    function waypoint(world) {
      const margin = 46;
      const w = Math.max(world.width, 200), h = Math.max(world.height, 200);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        let x, y;
        // Mostly the edges of the window, where it covers the least.
        if (random() < 0.85) {
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
      const was = pet.mode;
      pet.mode = mode; pet.modeAt = pet.clock;
      if (mode === "wander") { pet.target = waypoint(world); }
      if (mode === "perch") {
        const spots = (world.perches || []).filter((spot) => !(world.avoid || []).some((rect) => inside(rect, spot.x, spot.y, 10)));
        pet.perch = spots.length ? spots[Math.floor(random() * spots.length)] : { x: Math.max(80, world.width - 140), y: Math.max(60, world.height - 60) };
        pet.target = { x: pet.perch.x, y: pet.perch.y - body.lift * size };
      }
      if (mode === "coil") { pet.coilFrom = Math.atan2(pet.y - pet.target.y, pet.x - pet.target.x); pet.coilAngle = 0; }
      if (mode === "dash") {
        const away = world.pointer ? Math.atan2(pet.y - world.pointer.y, pet.x - world.pointer.x) : pet.heading;
        pet.target = { x: clamp(pet.x + Math.cos(away) * 260, 40, world.width - 40), y: clamp(pet.y + Math.sin(away) * 260, 40, world.height - 40) };
        puff(pet, "smoke", 6);
      }
      if (mode === "loop") { pet.loopCenter = { x: pet.x + Math.cos(pet.heading) * 46 * size, y: pet.y + Math.sin(pet.heading) * 46 * size }; pet.loopFrom = pet.heading - Math.PI / 2; pet.fire = 0.55; }
      if (mode === "sleep") { pet.sleepy = 1; }
      if (mode === "play") { pet.playFor = pick(3.5, 6.5); pet.playPhase = random() * TAU; }
      if (mode === "petted") {
        // Sitting, it stays sitting; flying, it hovers where the hand found it.
        pet.petSat = ["rest", "sleep", "coil"].includes(was);
        pet.petAt = { x: pet.x, y: pet.y };
        pet.petAway = 0; pet.hearts = 0; pet.sleepy = 0; pet.overFor = 0;
      }
      if (mode === "chase") { pet.chaseFor = 2.2 + chance() * 1.2; puff(pet, "spark", 3); }
      if (mode === "firefly") { pet.fireflyFor = between(ANTICS.fireflyFor); }
      if (mode === "leave") {
        // Out by the nearest side.
        const w = world.width, h = world.height;
        const gaps = [pet.x, w - pet.x, pet.y, h - pet.y];
        const out = gaps.indexOf(Math.min(...gaps));
        pet.target = out === 0 ? { x: -120, y: pet.y } : out === 1 ? { x: w + 120, y: pet.y } : out === 2 ? { x: pet.x, y: -120 } : { x: pet.x, y: h + 120 };
      }
      pet.events.push(mode);
      if (pet.events.length > 40) pet.events.shift();
    }
    // Waking from a nap: a stretch and a yawn first (a small one with calm motion), unless the little things are off.
    function wakeUp(world, calm) {
      pet.sleepy = 0;
      enter("rest", world);
      if (world.antics !== false) { pet.stretch = calm ? ANTICS.stretchFor * 0.65 : ANTICS.stretchFor; pet.stretchFor = pet.stretch; }
    }
    // The closest other pet, by its head.
    function nearest(world) {
      let best = null;
      for (const other of world.friends || []) {
        if (other.id === pet.id) continue;
        const distance = Math.hypot(other.x - pet.x, other.y - pet.y);
        if (!best || distance < best.distance) best = { id: other.id, x: other.x, y: other.y, distance };
      }
      return best;
    }
    // Heads for (x, y), turning at most TURN a second and slowing to arrive.
    function steer(dt, x, y, top, sway = 1) {
      const dx = x - pet.x, dy = y - pet.y;
      const distance = Math.hypot(dx, dy);
      const want = Math.atan2(dy, dx);
      const turn = TURN * dt * (pet.mode === "dash" ? 1.7 : 1);
      pet.heading = wrap(pet.heading + clamp(wrap(want - pet.heading), -turn, turn));
      const goal = Math.min(top * body.speed, Math.max(26, distance * 2.4));
      pet.speed += clamp(goal - pet.speed, -520 * dt, 360 * dt);
      // A pet swims through the air: the path snakes a little, and the body
      // carries the wave down to the tail (a cloud dragon's the most).
      const snake = Math.sin(pet.clock * body.wave[1]) * body.wave[0] * clamp(pet.speed / 170, 0, 1) * sway;
      const direction = pet.heading + snake;
      pet.x += Math.cos(direction) * pet.speed * dt;
      pet.y += Math.sin(direction) * pet.speed * dt + lift(dt);
      return distance;
    }
    // The bob that keeps it aloft: a wingbeat's, a swimming body's, a floating light's.
    function lift(dt) {
      if (body.move === "wings") return Math.sin(pet.flap) * 7 * dt * pet.flapAmp;
      if (body.move === "swim") return Math.sin(pet.flap * 0.5) * 5 * dt * pet.flapAmp;
      return Math.sin(pet.clock * 2.3) * 9 * dt;
    }
    // Whether (x, y) is on the body: the head, or within reach of the spine.
    function onBody(x, y) {
      const s = pet.size, spine = pet.spine;
      const head = spine[0], neck = spine[1];
      if (Math.abs(x - head.x) > 260 * s && Math.abs(x - spine[spine.length - 1].x) > 260 * s) return false;
      const angle = Math.atan2(head.y - neck.y, head.x - neck.x);
      const reach = body.head * 0.4 * s;
      if (Math.hypot(x - (head.x + Math.cos(angle) * reach), y - (head.y + Math.sin(angle) * reach)) < body.head * 0.62 * s + 3) return true;
      for (let index = 1; index < spine.length; index += 1) {
        const a = spine[index - 1], b = spine[index];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        if (Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)) < body.radii[index] * s + 4) return true;
      }
      return false;
    }
    // The hand on it: a pointer resting on the body for half a second pets
    // it, if the pointer came to the pet (one it flew under that had been
    // still a while does not count, nor does a swipe across it). Quick
    // circles near the owner's own pet start a chase.
    function touch(dt, world, pointer, calm, typing) {
      pet.chaseCool = Math.max(0, pet.chaseCool - dt);
      if (world.touch === false || !pointer) { pet.over = false; pet.overFor = 0; return; }
      const over = onBody(pointer.x, pointer.y);
      if (over && !pet.over) pet.touchFrom = pointer.still;
      pet.over = over;
      if (!over) pet.sated = false;
      if (pet.mode === "petted") return;
      if (over && pet.touchFrom < 1.2 && pointer.speed < 700 && !typing && !world.background && !pet.sated && TOUCHABLE.has(pet.mode)) {
        pet.overFor += dt;
        // It feels the hand: a flying pet slows under it.
        if (!sitting() && pet.mode !== "coil") pet.speed *= 1 - clamp(dt * 4, 0, 0.5);
        if (pet.overFor >= PET_AFTER) enter("petted", world);
      } else pet.overFor = Math.max(0, pet.overFor - dt * 2);
      if (pet.mode !== "petted" && pet.id === "you" && pointer.circling && !calm && !typing && pet.chaseCool <= 0 && ["wander", "rest", "curious", "play", "perch", "firefly"].includes(pet.mode)) {
        const spot = pointer.circle || pointer;
        if (Math.hypot(spot.x - pet.x, spot.y - pet.y) < 300) { pet.sleepy = 0; enter("chase", world); }
      }
    }
    // The little things, each on its own slow clock: a tiny sneeze, a firefly,
    // a flick of the tail while resting. None with the kill switch.
    function antics(dt, world, calm) {
      if (world.antics === false) return;
      const awake = ["wander", "perch", "rest", "curious", "play"].includes(pet.mode);
      pet.sneezeAt -= dt;
      pet.fireflyAt -= dt;
      if (pet.mode === "rest") pet.flickAt -= dt;
      if (pet.flickAt <= 0) { pet.flick = ANTICS.flickFor; pet.flickAt = between(ANTICS.flick); }
      if (pet.sneezeAt <= 0) {
        if (awake && pet.sneeze <= 0) { pet.sneeze = ANTICS.sneezeFor; pet.sneezeCalm = calm; }
        pet.sneezeAt = awake ? between(ANTICS.sneeze) : 20 + chance() * 40;
      }
      if (pet.fireflyAt <= 0 && !pet.firefly) {
        if (pet.mode === "wander" && !calm) { firefly(world, false); enter("firefly", world); pet.fireflyAt = between(ANTICS.firefly); }
        // Sitting (and with calm motion), one drifts past and the pet only watches it.
        else if (pet.mode === "rest") { firefly(world, true); pet.fireflyAt = between(ANTICS.firefly); }
        else pet.fireflyAt = 20 + chance() * 40;
      }
    }
    function firefly(world, drift) {
      const head = pet.spine[0];
      const side = chance() < 0.5 ? -1 : 1;
      const angle = pet.heading + side * (0.9 + chance() * 0.6);
      const reach = (drift ? 64 : 82) * pet.size;
      pet.firefly = {
        x: clamp(head.x + Math.cos(angle) * reach, 10, world.width - 10), y: clamp(head.y + Math.sin(angle) * reach - (drift ? 18 * pet.size : 0), 10, world.height - 10),
        vx: 0, vy: 0, wander: chance() * TAU, glow: chance() * TAU, life: drift ? 6.5 : 9, drift, side, leaving: false, fade: 1,
      };
    }
    function fireflyStep(dt, world) {
      const fly = pet.firefly;
      if (!fly) return;
      fly.glow += dt * 5.5;
      fly.life -= dt;
      const head = pet.spine[0];
      if (fly.leaving || fly.life <= 0) {
        // Away up and out, dimming.
        fly.leaving = true;
        fly.fade -= dt / 1.1;
        fly.vy -= 90 * dt;
        fly.vx *= 1 - dt;
        if (fly.fade <= 0) { pet.firefly = null; return; }
      } else if (fly.drift) {
        // Past the sitting pet, slowly, bobbing.
        fly.vx = lerp(fly.vx, -fly.side * 22 * pet.size, clamp(dt * 2, 0, 1));
        fly.vy = Math.sin(fly.life * 2.1) * 10 * pet.size;
      } else {
        // Flits about, just out of reach, never far.
        fly.wander += (chance() - 0.5) * dt * 7;
        const dx = fly.x - head.x, dy = fly.y - head.y, distance = Math.hypot(dx, dy) || 1;
        let ax = Math.cos(fly.wander) * 130, ay = Math.sin(fly.wander) * 130;
        if (distance < 42 * pet.size) { ax += (dx / distance) * 560; ay += (dy / distance) * 560; }
        if (distance > 92 * pet.size) { ax -= (dx / distance) * 380; ay -= (dy / distance) * 380; }
        fly.vx = (fly.vx + ax * dt) * (1 - clamp(dt * 1.6, 0, 1));
        fly.vy = (fly.vy + ay * dt) * (1 - clamp(dt * 1.6, 0, 1));
      }
      fly.x = clamp(fly.x + fly.vx * dt, 6, world.width - 6);
      fly.y = clamp(fly.y + fly.vy * dt, -40, world.height - 6);
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
        pet.firefly = null; pet.purr = 0; pet.tag = 0; pet.stretch = 0; pet.yawn = 0; pet.flick = 0; pet.sneeze = 0; pet.mouth = 0; pet.snap = 0;
        return;
      }
      touch(dt, world, pointer, calm, typing);
      antics(dt, world, calm);
      // How long it has been in this mode, read after any reaction changed it.
      const time = pet.clock - pet.modeAt;
      switch (pet.mode) {
        case "wander": {
          if (!pet.target) pet.target = waypoint(world);
          const distance = steer(dt, pet.target.x, pet.target.y, SPEED.wander);
          if (typing && world.calm !== false) { enter("perch", world); break; }
          if (calm || world.background) { enter("perch", world); break; }
          if (pointer && pointer.speed > 1400 && Math.hypot(pointer.x - pet.x, pointer.y - pet.y) < 110) { enter("dash", world); break; }
          // Another pet nearby: now and then they chase round each other.
          const friend = nearest(world);
          if (friend && friend.distance < 420 && random() < dt * 0.3) { pet.playWith = friend.id; enter("play", world); break; }
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
          const radius = body.coil * pet.size;
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
          if (!typing && !calm && time > pet.restFor && pet.stretch <= 0) enter("wander", world);
          else if (!typing && !calm && pointer && pointer.still > 1.4 && pointer.still < 30 && time > 4 && Math.hypot(pointer.x - pet.x, pointer.y - pet.y) < 260 && random() < dt * 0.25) enter("curious", world);
          break;
        }
        case "sleep": {
          pet.speed = 0;
          if (!world.background && quietFor < 1 && pointer && pointer.speed > 60 && Math.hypot(pointer.x - pet.x, pointer.y - pet.y) < 180) { wakeUp(world, calm); pet.restFor = pick(3, 8); }
          else if (!world.background && quietFor < 1 && time > 6 && !typing && !calm) { wakeUp(world, calm); pet.restFor = pick(2, 6); }
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
        case "play": {
          const friend = (world.friends || []).find((other) => other.id === pet.playWith);
          if (!friend || time > pet.playFor || typing || calm) { pet.playWith = null; enter(calm || typing ? "perch" : "wander", world); break; }
          // Round and round: a point on a circle about the friend, and never
          // so close that the two bodies tangle.
          const angle = pet.clock * 2.6 + pet.playPhase;
          let goalX = friend.x + Math.cos(angle) * 74 * pet.size, goalY = friend.y + Math.sin(angle) * 52 * pet.size;
          const apart = Math.hypot(pet.x - friend.x, pet.y - friend.y);
          if (apart < 44 * pet.size) { goalX = pet.x + (pet.x - friend.x) * 2; goalY = pet.y + (pet.y - friend.y) * 2; }
          steer(dt, goalX, goalY, SPEED.play, 0.5);
          if (time > 0.6 && (pet.clock % 2.4) < dt) puff(pet, "heart", 1);
          break;
        }
        case "petted": {
          // Still under the hand: hovering in place, or sitting where it sat.
          pet.petAway = pet.over ? 0 : pet.petAway + dt;
          pet.speed = lerp(pet.speed, 0, clamp(dt * 6, 0, 1));
          if (!pet.petSat && pet.petAt) {
            pet.x = lerp(pet.x, pet.petAt.x, clamp(dt * 3, 0, 1));
            pet.y = lerp(pet.y, pet.petAt.y + Math.sin(pet.clock * 2.2) * 2 * pet.size, clamp(dt * 3, 0, 1));
          }
          // A few small hearts, then just the purr.
          if (pet.hearts < 4 && time > 0.15 + pet.hearts * 0.95) { pet.hearts += 1; puff(pet, "heart", 1, 0.75); }
          if (!pointer || typing || world.background || world.touch === false || pet.petAway > 0.6 || time > 18) {
            if (time > 18) pet.sated = true;
            if (pet.petSat) { enter("rest", world); pet.restFor = pick(4, 9); } else enter("wander", world);
          }
          break;
        }
        case "chase": {
          if (!pointer || typing || calm || world.background) { enter("wander", world); break; }
          // Right behind the pointer, as if it might catch it.
          steer(dt, pointer.x, pointer.y, SPEED.chase, 0.3);
          if (time > pet.chaseFor) { pet.chaseCool = 6; enter("wander", world); }
          break;
        }
        case "firefly": {
          const fly = pet.firefly;
          if (!fly || fly.leaving || calm || typing || world.background) { if (fly) fly.leaving = true; enter(calm || typing ? "perch" : "wander", world); break; }
          steer(dt, fly.x, fly.y, SPEED.firefly, 0.4);
          const head = pet.spine[0];
          // A snap at it, just too late: away it goes.
          if (time > pet.fireflyFor || Math.hypot(fly.x - head.x, fly.y - head.y) < 9 * pet.size) { pet.snap = 0.32; fly.leaving = true; enter("wander", world); }
          break;
        }
        case "arrive": {
          // In from the edge, toward the owner's pet if there is one.
          const host = (world.friends || []).find((other) => other.id === "you");
          const goal = host || { x: world.width / 2, y: world.height / 3 };
          const distance = steer(dt, goal.x, goal.y, SPEED.arrive, 0.4);
          if (distance < 120 || time > 6) { if (host) { pet.playWith = "you"; enter("play", world); } else enter("wander", world); }
          break;
        }
        case "leave": {
          steer(dt, pet.target.x, pet.target.y, SPEED.leave, 0.3);
          if (pet.x < -90 || pet.y < -90 || pet.x > world.width + 90 || pet.y > world.height + 90) pet.gone = true;
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
      // Stay inside the window (a visitor comes in and goes out past its edge).
      if (!["arrive", "leave"].includes(pet.mode)) {
        pet.x = clamp(pet.x, 12, Math.max(13, world.width - 12));
        pet.y = clamp(pet.y, 12, Math.max(13, world.height - 12));
      }
      pet.spine[0].x = pet.x; pet.spine[0].y = pet.y;
      follow(pet.spine, pet.size, body);
      wings(dt);
      face(dt, pointer);
      if (pet.fire > 0) { pet.fire -= dt; breathe(pet, dt); }
      pet.mouth = lerp(pet.mouth, pet.fire > 0 || pet.snap > 0 ? 1 : 0, clamp(dt * 12, 0, 1));
      little(dt);
      fireflyStep(dt, world);
      pet.purr = lerp(pet.purr, pet.mode === "petted" ? 1 : 0, clamp(dt * (pet.mode === "petted" ? 2.5 : 4), 0, 1));
      pet.tag = lerp(pet.tag, pet.mode === "petted" ? 1 : 0, clamp(dt * 5, 0, 1));
      // Its own trail, slower while it sits, none while it sleeps.
      if (body.trail && pet.mode !== "sleep") {
        pet.trailAt -= dt;
        if (pet.trailAt <= 0) { pet.trailAt = sitting() ? body.trail[1] : body.trail[0]; trail(pet, body); }
      }
      ageParticles(pet, dt);
    }
    // The little things' own clocks: a stretch's yawn, a sneeze's burst, a flick, a snap.
    function little(dt) {
      if (pet.stretch > 0) {
        pet.stretch = Math.max(0, pet.stretch - dt);
        const t = 1 - pet.stretch / (pet.stretchFor || 1);
        pet.yawn = hump(clamp((t - 0.18) / 0.62, 0, 1)) * (pet.stretchFor < ANTICS.stretchFor ? 0.6 : 1);
      } else pet.yawn = Math.max(0, pet.yawn - dt * 3);
      if (pet.sneeze > 0) {
        const before = 1 - pet.sneeze / ANTICS.sneezeFor;
        pet.sneeze = Math.max(0, pet.sneeze - dt);
        const after = 1 - pet.sneeze / ANTICS.sneezeFor;
        if (before < 0.5 && after >= 0.5) { sneezeBurst(pet, pet.sneezeCalm); pet.speed *= 0.55; }
      }
      pet.flick = Math.max(0, pet.flick - dt);
      pet.snap = Math.max(0, pet.snap - dt);
    }
    // Wings: quicker and deeper when climbing or fast, a glide now and then,
    // folded back when sitting; spread for a moment in a waking stretch. A
    // cloud dragon's swim and a wisp's float beat with the speed instead.
    function wings(dt) {
      const seated = sitting();
      const coiling = pet.mode === "coil";
      const reach = pet.stretch > 0 ? hump(1 - pet.stretch / (pet.stretchFor || 1)) * (pet.stretchFor < ANTICS.stretchFor ? 0.55 : 1) : 0;
      if (body.move !== "wings") {
        pet.flapAmp = lerp(pet.flapAmp, seated ? 0.15 : coiling ? 0.5 : 1, clamp(dt * 3, 0, 1));
        pet.fold = lerp(pet.fold ?? 0, seated ? 1 - reach * 0.8 : 0, clamp(dt * 4, 0, 1));
        pet.flap += dt * (seated ? 1.2 : 2.4 + pet.speed / 55);
      } else {
        const climbing = Math.sin(pet.heading) < -0.4;
        const phoenix = pet.kind === "phoenix";
        let rate = pet.speed > 260 ? 15 : climbing ? 11.5 : 8.5;
        if (["curious", "visit"].includes(pet.mode)) rate = 10.5;
        if (pet.mode === "petted") rate = 7;
        if (phoenix) rate *= 0.78;
        pet.glide -= dt;
        if (pet.glide < -pick(2.5, 6) * (phoenix ? 0.6 : 1) && pet.mode === "wander" && !climbing) pet.glide = pick(0.8, 1.8) * (phoenix ? 1.5 : 1);
        const gliding = pet.glide > 0;
        const goal = seated ? reach * 0.3 : coiling ? 0.35 : gliding ? 0.08 : pet.mode === "petted" ? 0.55 : 1;
        pet.flapAmp = lerp(pet.flapAmp, goal, clamp(dt * 5, 0, 1));
        pet.fold = lerp(pet.fold ?? 0, (seated ? 1 : coiling ? 0.6 : 0) * (1 - reach * 0.8), clamp(dt * 4, 0, 1));
        if (!seated) pet.flap += dt * rate * (gliding ? 0.25 : 1);
        else if (reach > 0) pet.flap += dt * 4;
      }
      pet.breathe += dt * (pet.mode === "sleep" ? 1.5 : 2.2);
      pet.blinkAt -= dt;
      if (pet.blinkAt <= 0) { pet.blink = 0.16; pet.blinkAt = pick(2.2, 6.5); }
      pet.blink = Math.max(0, pet.blink - dt);
    }
    // Where the head looks when the body does not move: around, at the
    // pointer, at a firefly drifting past, and at the hand petting it.
    function face(dt, pointer) {
      if (pet.mode === "petted" && pointer) {
        const head = pet.spine[0], neck = pet.spine[1];
        const facing = Math.atan2(head.y - neck.y, head.x - neck.x);
        pet.lookGoal = clamp(wrap(Math.atan2(pointer.y - head.y, pointer.x - head.x) - facing), -1.05, 1.05);
        pet.look = lerp(pet.look, pet.lookGoal, clamp(dt * 6, 0, 1));
        return;
      }
      if (!["rest", "sleep"].includes(pet.mode)) { pet.look = lerp(pet.look, 0, clamp(dt * 6, 0, 1)); return; }
      pet.lookAt -= dt;
      if (pet.lookAt <= 0) { pet.lookGoal = pick(-0.5, 0.5); pet.lookAt = pick(1.5, 4); }
      const head = pet.spine[0], neck = pet.spine[1];
      const toward = (x, y) => clamp(wrap(Math.atan2(y - head.y, x - head.x) - Math.atan2(head.y - neck.y, head.x - neck.x)), -0.9, 0.9);
      if (pet.firefly && pet.mode === "rest") pet.lookGoal = toward(pet.firefly.x, pet.firefly.y);
      else if (pointer && pointer.still < 3 && pet.mode === "rest") pet.lookGoal = clamp(toward(pointer.x, pointer.y), -0.7, 0.7);
      pet.look = lerp(pet.look, pet.mode === "sleep" ? 0 : pet.lookGoal, clamp(dt * 3, 0, 1));
    }
    // A sitting pet is put straight onto its perch (motion off, or a still preview).
    function settleOnPerch(world) {
      const spot = pet.perch || { x: world.width - 140, y: world.height - 60 };
      const cx = spot.x, cy = spot.y - body.lift * pet.size;
      const radius = body.coil * pet.size;
      // Round the spot as far as its kind curls (Ember nearly twice; a phoenix
      // only part way, so its tail drapes).
      const turn = body.curl / 89;
      for (let index = 0; index < 90; index += 1) {
        const angle = index * turn;
        pet.x = cx + Math.cos(angle) * radius; pet.y = cy + Math.sin(angle) * radius * (2 / 3);
        pet.spine[0].x = pet.x; pet.spine[0].y = pet.y;
        follow(pet.spine, pet.size, body);
      }
      pet.heading = body.curl + Math.PI / 2;
      pet.speed = 0; pet.flapAmp = 0; pet.fold = 1;
    }
    return { pet, step, enter: (mode, world) => enter(mode, world), settle: settleOnPerch, onBody, leave: (world) => { if (pet.mode !== "leave") enter("leave", world); } };
  }

  // ---- particles --------------------------------------------------------------
  const MAX_PARTICLES = 90;
  function snoutOf(pet) {
    const head = pet.spine[0], neck = pet.spine[1];
    const angle = Math.atan2(head.y - neck.y, head.x - neck.x);
    const reach = shapeOf(pet.kind).head * 0.85 * pet.size;
    return { angle, x: head.x + Math.cos(angle) * reach, y: head.y + Math.sin(angle) * reach, head };
  }
  function puff(pet, kind, count, scale = 1) {
    const { angle, head } = snoutOf(pet);
    for (let index = 0; index < count && pet.particles.length < MAX_PARTICLES; index += 1) {
      const spread = (Math.random() - 0.5) * 1.2;
      if (kind === "z") pet.particles.push({ kind, x: head.x + 6, y: head.y - 10, vx: 8, vy: -16, life: 2.2, max: 2.2, size: 9 });
      else if (kind === "heart") pet.particles.push({ kind, x: head.x + (Math.random() - 0.5) * 8, y: head.y - 8, vx: (Math.random() - 0.5) * 24, vy: -30, life: 1.4, max: 1.4, size: 7 * scale });
      else if (kind === "smoke") pet.particles.push({ kind, x: head.x, y: head.y, vx: Math.cos(angle + Math.PI + spread) * 40, vy: Math.sin(angle + Math.PI + spread) * 40, life: 0.7, max: 0.7, size: 5 + Math.random() * 4 });
      else pet.particles.push({ kind: "spark", x: head.x + (Math.random() - 0.5) * 50, y: head.y + (Math.random() - 0.5) * 50, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50 - 20, life: 0.9, max: 0.9, size: 2 + Math.random() * 2.5 });
    }
  }
  // A tiny sneeze: a burst of little sparks from the snout, and a wisp of smoke.
  function sneezeBurst(pet, calm) {
    const { angle, x, y } = snoutOf(pet);
    const count = calm ? 3 : 8;
    for (let index = 0; index < count && pet.particles.length < MAX_PARTICLES; index += 1) {
      const spread = (Math.random() - 0.5) * 0.9;
      const speed = 55 + Math.random() * 70;
      pet.particles.push({ kind: "spark", x, y, vx: Math.cos(angle + spread) * speed, vy: Math.sin(angle + spread) * speed, life: 0.55, max: 0.55, size: 1.5 + Math.random() * 1.3 });
    }
    if (pet.particles.length < MAX_PARTICLES - 1) for (const side of [-1, 1]) pet.particles.push({ kind: "smoke", x, y, vx: Math.cos(angle + side * 0.5) * 28, vy: Math.sin(angle + side * 0.5) * 28, life: 0.5, max: 0.5, size: 3 + Math.random() * 2 });
  }
  // Fire from the snout, along the way the head points.
  function breathe(pet, dt) {
    const { angle, x, y } = snoutOf(pet);
    const count = Math.ceil(dt * 90);
    for (let index = 0; index < count && pet.particles.length < MAX_PARTICLES; index += 1) {
      const spread = (Math.random() - 0.5) * 0.5;
      const speed = 150 + Math.random() * 120;
      pet.particles.push({ kind: "fire", x, y, vx: Math.cos(angle + spread) * speed + Math.cos(pet.heading) * pet.speed * 0.4, vy: Math.sin(angle + spread) * speed + Math.sin(pet.heading) * pet.speed * 0.4, life: 0.32 + Math.random() * 0.26, max: 0.58, size: 5 + Math.random() * 4 });
    }
  }
  // A kind's own trail: a wisp sheds drifting sparks, a phoenix embers from
  // its tail feathers, a cloud dragon little clouds from under its feet.
  function trail(pet, body) {
    if (pet.particles.length >= MAX_PARTICLES - 4) return;
    const s = pet.size, spine = pet.spine;
    const jitter = () => (Math.random() - 0.5);
    if (pet.kind === "wisp") {
      const at = spine[2 + Math.floor(Math.random() * 7)];
      pet.particles.push({ kind: "drift", x: at.x + jitter() * 8 * s, y: at.y + jitter() * 8 * s, vx: jitter() * 18, vy: -10 - Math.random() * 14, life: 1.3, max: 1.3, size: (1 + Math.random() * 1.3) * s, phase: Math.random() * TAU });
    } else if (pet.kind === "phoenix") {
      const at = spine[spine.length - 1 - Math.floor(Math.random() * 6)];
      pet.particles.push({ kind: "ember", x: at.x + jitter() * 10 * s, y: at.y + jitter() * 10 * s, vx: jitter() * 24, vy: 6 + Math.random() * 14, life: 0.9, max: 0.9, size: (1.2 + Math.random() * 1.6) * s });
    } else if (pet.kind === "cloud") {
      const at = spine[Math.random() < 0.5 ? body.shoulder : body.hip];
      pet.particles.push({ kind: "puff", x: at.x + jitter() * 8 * s, y: at.y + 4 * s + jitter() * 4 * s, vx: jitter() * 10, vy: 4 + Math.random() * 6, life: 1.6, max: 1.6, size: (3.6 + Math.random() * 2.6) * s });
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
      else if (bit.kind === "drift") { bit.vx = Math.sin(bit.life * 4 + bit.phase) * 9; }
      else if (bit.kind === "ember") { bit.vx *= 1 - dt * 1.2; bit.vy += 10 * dt; }
      else if (bit.kind === "puff") { bit.vx *= 1 - dt; bit.vy *= 1 - dt * 0.8; }
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
  const shine = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const SKINS = {
    frost: { body: [127, 211, 255], body2: [44, 104, 196], belly: [232, 248, 255], wing: [150, 222, 255], edge: [210, 244, 255], horn: [240, 251, 255], eye: [200, 246, 255], fire: [[233, 251, 255], [143, 227, 255], [63, 169, 245]] },
    jade: { body: [47, 191, 113], body2: [14, 110, 70], belly: [218, 242, 196], wing: [240, 200, 82], edge: [255, 226, 140], horn: [241, 210, 122], eye: [255, 226, 122], fire: [[244, 255, 214], [182, 236, 90], [64, 170, 70]] },
    void: { body: [56, 34, 92], body2: [16, 9, 30], belly: [112, 78, 170], wing: [150, 92, 255], edge: [205, 170, 255], horn: [214, 196, 255], eye: [226, 178, 255], fire: [[246, 226, 255], [182, 124, 255], [93, 43, 209]] },
    gold: { body: [255, 211, 107], body2: [196, 132, 26], belly: [255, 243, 200], wing: [255, 222, 140], edge: [255, 246, 214], horn: [255, 248, 222], eye: [255, 255, 255], fire: [[255, 255, 230], [255, 214, 110], [240, 150, 40]] },
  };
  // The theme skin: the accent and second accent of whatever theme is on,
  // read once per theme (a theme change or a Shop pack clears it).
  let themeCache = null;
  function themeSkin() {
    if (themeCache) return themeCache;
    let style = null;
    try { style = getComputedStyle(document.documentElement); } catch { style = null; }
    const read = (...names) => { for (const name of names) { const value = rgbOf(style?.getPropertyValue?.(name)); if (value) return value; } return null; };
    const accent = read("--canvas-accent", "--gold") || [255, 140, 60];
    const second = read("--canvas-accent2", "--accent-2") || mix(accent, [120, 60, 255], 0.55);
    const text = read("--canvas-text", "--ivory") || [240, 240, 240];
    const skin = { body: accent, body2: mix(accent, second, 0.55), belly: mix(accent, WHITE, 0.55), wing: second, edge: mix(second, WHITE, 0.45), horn: mix(text, accent, 0.18), eye: [255, 214, 100], fire: [[255, 244, 200], [255, 178, 72], [255, 92, 54]] };
    // Only a real reading is kept: a page still loading its theme asks again.
    if (style) themeCache = skin;
    return skin;
  }
  const skinColours = (skin) => (SKINS[skin] || themeSkin());
  // A light theme's page (html[data-studio-theme-tone="light"]): glows give way to edges there.
  const lightPage = () => { try { return document.documentElement?.dataset?.studioThemeTone === "light"; } catch { return false; } };

  // ---- paint ------------------------------------------------------------------
  // Everything is drawn in window coordinates; the caller sets the transform.
  function normalAt(spine, index) {
    const a = spine[Math.max(0, index - 1)], b = spine[Math.min(spine.length - 1, index + 1)];
    const dx = a.x - b.x, dy = a.y - b.y;
    const length = Math.hypot(dx, dy) || 1;
    return { fx: dx / length, fy: dy / length, nx: -dy / length, ny: dx / length };
  }
  const seated = (pet) => pet.mode === "rest" || pet.mode === "sleep" || (pet.mode === "petted" && pet.petSat);
  // The outline of a body: each point of the spine nudged sideways (a wag, a
  // flick, a purr's tremble, a swimming wave), then pushed out by its radius.
  function outline(spine, radius, nudge) {
    return spine.map((point, index) => {
      const { fx, fy, nx, ny } = normalAt(spine, index);
      const r = radius(index);
      const shift = nudge(index);
      const x = point.x + nx * shift, y = point.y + ny * shift;
      return { x, y, fx, fy, nx, ny, r, lx: x + nx * r, ly: y + ny * r, rx: x - nx * r, ry: y - ny * r };
    });
  }
  // The sideways nudges every body shares: a sitting tail's slow wag, a
  // resting tail's quick flick, and a purr's fine tremble through the chest.
  function nudges(pet, body) {
    const s = pet.size, n = body.segments;
    const sat = seated(pet);
    const wagRate = pet.mode === "sleep" ? 0.8 : 2.4;
    const flick = pet.flick > 0 ? 1 - pet.flick / ANTICS.flickFor : -1;
    const purr = pet.purr;
    return (index) => {
      let shift = 0;
      if (sat && index > n - 6) shift += Math.sin(pet.clock * wagRate) * (index - (n - 6)) * 0.55 * s;
      if (flick >= 0 && index > n - 8) { const k = (index - (n - 8)) / 7; shift += Math.sin(flick * TAU) * (1 - flick) * k * k * 15 * s; }
      if (purr > 0.02 && index > 1 && index < n * 0.55) shift += Math.sin(pet.clock * 44 + index * 1.3) * 0.55 * purr * s;
      return shift;
    };
  }
  // A body's outline as one path, from point `from` to `to`; `cap` rounds its
  // front (a wisp's flame) instead of cutting it straight across.
  function bodyPath(ctx, sides, from = 0, to = sides.length - 1, cap = false) {
    ctx.beginPath();
    ctx.moveTo(sides[from].lx, sides[from].ly);
    for (let index = from + 1; index <= to; index += 1) {
      const a = sides[index - 1], b = sides[index];
      ctx.quadraticCurveTo(a.lx, a.ly, (a.lx + b.lx) / 2, (a.ly + b.ly) / 2);
    }
    const end = sides[to];
    ctx.lineTo(end.x, end.y);
    for (let index = to; index > from; index -= 1) {
      const a = sides[index], b = sides[index - 1];
      ctx.quadraticCurveTo(a.rx, a.ry, (a.rx + b.rx) / 2, (a.ry + b.ry) / 2);
    }
    const front = sides[from];
    ctx.lineTo(front.rx, front.ry);
    if (cap) { const ahead = Math.atan2(front.fy, front.fx); ctx.arc(front.x, front.y, front.r, ahead - Math.PI / 2, ahead + Math.PI / 2); }
    ctx.closePath();
  }
  // A soft shadow below, so it reads as above the page.
  function shadow(ctx, pet, sides, alpha = 1) {
    const s = pet.size;
    ctx.save();
    ctx.globalAlpha = (seated(pet) ? 0.16 : 0.12) * alpha;
    ctx.translate(0, seated(pet) ? 3 * s : 14 * s);
    bodyPath(ctx, sides);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }
  // The sneeze's jerk of the head, along the way it faces: back for the
  // "ah", then forward for the "choo".
  function jerkOf(pet) {
    if (pet.sneeze <= 0) return 0;
    const t = 1 - pet.sneeze / ANTICS.sneezeFor;
    const strength = pet.sneezeCalm ? 0.5 : 1;
    return (t < 0.5 ? -(t / 0.5) * 1.6 : (1 - (t - 0.5) / 0.5) * 2.6) * strength;
  }
  const eyesShut = (pet) => pet.mode === "sleep" || pet.blink > 0 || pet.yawn > 0.4 || (pet.sneeze > 0 && Math.abs(0.5 - (1 - pet.sneeze / ANTICS.sneezeFor)) < 0.18);
  // Purring: little lines that pulse out from the chest.
  function purrLines(ctx, pet, at, colours, light) {
    if (pet.purr < 0.05) return;
    const s = pet.size;
    const pulse = 0.5 + 0.5 * Math.sin(pet.clock * 9);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1.2 * s;
    ctx.strokeStyle = css(light ? mix(colours.body2, BLACK, 0.25) : mix(colours.belly, WHITE, 0.3), 0.6 * pet.purr * (0.35 + 0.65 * pulse));
    for (const side of [1, -1]) {
      const toward = Math.atan2(at.ny * side, at.nx * side);
      for (let ring = 0; ring < 2; ring += 1) {
        ctx.beginPath();
        ctx.arc(at.x, at.y, at.r + (4 + ring * 3.4 + pulse * 1.4) * s, toward - 0.42, toward + 0.42);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // A pet's name above its head: a friend's pet always (with its owner's
  // name), your own while it is petted. Outlined so it reads on any page.
  function nameTag(ctx, pet, label, alpha = 1) {
    const head = pet.spine[0];
    const lift = (shapeOf(pet.kind).head * 0.7 + 12) * pet.size + 4;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10, 12, 16, 0.75)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeText(label, head.x, head.y - lift);
    ctx.fillText(label, head.x, head.y - lift);
    ctx.restore();
  }
  // A firefly: a dark little body and its lamp, glowing on and off.
  function paintFirefly(ctx, pet, light) {
    const fly = pet.firefly;
    if (!fly) return;
    const s = pet.size;
    const pulse = 0.5 + 0.5 * Math.sin(fly.glow);
    const fade = clamp(fly.fade, 0, 1);
    const glow = (0.35 + 0.65 * pulse * pulse) * fade;
    ctx.save();
    const halo = ctx.createRadialGradient(fly.x, fly.y, 0, fly.x, fly.y, 10 * s);
    halo.addColorStop(0, `rgba(222, 255, 120, ${(light ? 0.5 : 0.62) * glow})`);
    halo.addColorStop(1, "rgba(222, 255, 120, 0)");
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(fly.x, fly.y, 10 * s, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    const heading = Math.atan2(fly.vy || -1, fly.vx || 0.01);
    ctx.fillStyle = `rgba(52, 48, 30, ${0.85 * fade})`;
    ctx.beginPath(); ctx.ellipse(fly.x - Math.cos(heading) * 1.6 * s, fly.y - Math.sin(heading) * 1.6 * s, 2 * s, 1.3 * s, heading, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(${light ? "170, 210, 40" : "240, 255, 170"}, ${(0.45 + 0.55 * glow) * fade})`;
    ctx.beginPath(); ctx.arc(fly.x + Math.cos(heading) * 0.6 * s, fly.y + Math.sin(heading) * 0.6 * s, 1.6 * s, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // -- Ember, the dragon --
  function paintDragon(ctx, pet, colours, detail, body) {
    const s = pet.size;
    const spine = pet.spine;
    const breath = 1 + Math.sin(pet.breathe) * (pet.mode === "sleep" ? 0.035 : 0.02);
    const radius = (index) => body.radii[index] * s * (index > 1 && index < 12 ? breath : 1);
    const sides = outline(spine, radius, nudges(pet, body));
    const head = sides[0], tail = sides[sides.length - 1];
    if (detail > 0) shadow(ctx, pet, sides);
    // Wings behind the body.
    for (const side of [1, -1]) wing(ctx, pet, sides, side, colours, body);
    // Legs, tucked back in flight and set down when sitting.
    for (const at of [body.shoulder + 1, body.hip]) for (const side of [1, -1]) leg(ctx, pet, sides, at, side, colours, body);
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
        const { fx, fy, nx, ny } = sides[index];
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
    dragonHead(ctx, pet, colours);
    return sides[body.shoulder + 1];
  }
  function wing(ctx, pet, sides, side, colours, body) {
    const s = pet.size;
    const { fx, fy, nx, ny } = normalAt(pet.spine, body.shoulder);
    const ox = nx * side, oy = ny * side; // out from the body
    const root = sides[body.shoulder];
    const sx = root.x + ox * body.radii[body.shoulder] * s * 0.7, sy = root.y + oy * body.radii[body.shoulder] * s * 0.7;
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
    const back = sides[body.wingEnd + 1];
    const bx = back.x + ox * body.radii[body.wingEnd + 1] * s * 0.6, by = back.y + oy * body.radii[body.wingEnd + 1] * s * 0.6;
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
    const sheen = ctx.createLinearGradient(sx, sy, fingers[1].x, fingers[1].y);
    sheen.addColorStop(0, css(colours.wing, 0.78));
    sheen.addColorStop(1, css(mix(colours.wing, colours.edge, 0.5), 0.5));
    ctx.fillStyle = sheen;
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
  // A leg: tucked back in flight, set down when sitting, reaching forward in
  // a waking stretch; `paddle` swings it (a cloud dragon's walk on the air).
  function leg(ctx, pet, sides, at, side, colours, body, { size = 1, paddle = 0, toes = 3, tone = null, splay = 1.15 } = {}) {
    const s = pet.size * size;
    const p = sides[at];
    const { fx, fy, nx, ny } = p;
    const ox = nx * side, oy = ny * side;
    const hipX = p.x + ox * p.r * 0.75, hipY = p.y + oy * p.r * 0.75;
    const sitting = seated(pet) || pet.mode === "coil";
    const front = at < body.segments * 0.35;
    const reach = pet.stretch > 0 && front ? hump(1 - pet.stretch / (pet.stretchFor || 1)) : 0;
    // Tucked: pointing back along the body (or splayed, for a cloud dragon). Sitting: out to the side. Stretching: forward.
    const angle = (sitting ? 0.35 : splay) + paddle - reach * 1.25;
    const dx = Math.cos(angle) * ox - Math.sin(angle) * fx, dy = Math.cos(angle) * oy - Math.sin(angle) * fy;
    const kneeX = hipX + dx * 5.2 * s, kneeY = hipY + dy * 5.2 * s;
    const bend = sitting ? 0.2 : 0.9;
    const footX = kneeX + (dx * 0.4 - fx * (bend - reach * 1.2)) * 5 * s, footY = kneeY + (dy * 0.4 - fy * (bend - reach * 1.2)) * 5 * s;
    ctx.lineCap = "round";
    if (tone) {
      // An outline under a leg in the body's own colour, so it reads against the body.
      ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.4), 0.8);
      ctx.lineWidth = 3.8 * s; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
      ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
    }
    ctx.strokeStyle = css(tone || colours.body2);
    ctx.lineWidth = 2.6 * s; ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.lineWidth = 1.9 * s; ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
    ctx.strokeStyle = css(colours.horn);
    ctx.lineWidth = 0.8 * s;
    const fan = toes === 4 ? [-0.75, -0.25, 0.25, 0.75] : [-0.5, 0, 0.5];
    for (const spread of fan) {
      const cx = Math.cos(spread) * (footX - kneeX) - Math.sin(spread) * (footY - kneeY), cy = Math.sin(spread) * (footX - kneeX) + Math.cos(spread) * (footY - kneeY);
      const length = Math.hypot(cx, cy) || 1;
      ctx.beginPath(); ctx.moveTo(footX, footY); ctx.lineTo(footX + (cx / length) * 2.2 * s, footY + (cy / length) * 2.2 * s); ctx.stroke();
    }
    return { x: kneeX, y: kneeY };
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
  // The head's frame: at the first point, turned the way it looks, nudged by
  // a sneeze, at `scale` (the pet's size times the kind's head size).
  function headFrame(ctx, pet, scale) {
    const head = pet.spine[0], neck = pet.spine[1];
    const facing = Math.atan2(head.y - neck.y, head.x - neck.x);
    const angle = facing + pet.look;
    const jerk = jerkOf(pet) * pet.size;
    ctx.save();
    ctx.translate(head.x + Math.cos(facing) * jerk, head.y + Math.sin(facing) * jerk);
    ctx.rotate(angle);
    ctx.scale(scale * (1 + 0.08 * pet.yawn), scale * (1 + 0.08 * pet.yawn));
  }
  // An open mouth: wide for fire or a snap, rounder and pink inside for a yawn.
  function mouthOpen(ctx, pet, x, reach) {
    const fire = pet.mouth, yawn = pet.yawn;
    if (fire < 0.05 && yawn < 0.05) return;
    if (yawn > fire) {
      ctx.fillStyle = css([60, 14, 22], 0.9 * Math.min(1, yawn * 1.4));
      ctx.beginPath(); ctx.ellipse(x + reach * 0.55, 0, reach * 0.55, 3.6 * yawn, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = css([236, 120, 140], 0.85 * yawn);
      ctx.beginPath(); ctx.ellipse(x + reach * 0.5, 0, reach * 0.28, 1.2 * yawn, 0, 0, TAU); ctx.fill();
      return;
    }
    ctx.fillStyle = css([40, 10, 10], 0.85 * fire);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + reach, -1.8 * fire); ctx.lineTo(x + reach, 1.8 * fire); ctx.closePath(); ctx.fill();
  }
  // Eyes: a soft glow, the eye, a slit; shut while asleep, blinking, yawning
  // or sneezing; happy arcs while it purrs.
  function eyes(ctx, pet, colours, at, { size = 1, slit = true } = {}) {
    const shut = eyesShut(pet);
    const happy = pet.purr > 0.45 && !shut;
    for (const side of [1, -1]) {
      const ex = at.x, ey = side * at.y;
      if (shut || happy) {
        ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.55));
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        if (happy) ctx.arc(ex - 0.4, ey, 1.9 * size, -Math.PI / 2 - 1.1, -Math.PI / 2 + 1.1);
        else ctx.arc(ex, ey - side * 0.3, 1.9 * size, side > 0 ? 0.2 : Math.PI + 0.2, side > 0 ? Math.PI - 0.2 : TAU - 0.2);
        ctx.stroke();
        continue;
      }
      const halo = ctx.createRadialGradient(ex, ey, 0, ex, ey, 4.6 * size);
      halo.addColorStop(0, css(colours.eye, 0.55));
      halo.addColorStop(1, css(colours.eye, 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(ex, ey, 4.6 * size, 0, TAU); ctx.fill();
      ctx.fillStyle = css(colours.eye);
      ctx.beginPath(); ctx.ellipse(ex, ey, 2.3 * size, 1.6 * size, side * 0.25, 0, TAU); ctx.fill();
      ctx.fillStyle = css([20, 12, 8]);
      if (slit) { ctx.beginPath(); ctx.ellipse(ex + 0.3, ey, 0.55 * size, 1.35 * size, 0, 0, TAU); ctx.fill(); }
      else { ctx.beginPath(); ctx.arc(ex + 0.5 * size, ey, 1.05 * size, 0, TAU); ctx.fill(); ctx.fillStyle = "rgba(255, 255, 255, 0.85)"; ctx.beginPath(); ctx.arc(ex + 0.9 * size, ey - 0.6 * size, 0.42 * size, 0, TAU); ctx.fill(); }
    }
  }
  function dragonHead(ctx, pet, colours) {
    const s = pet.size;
    headFrame(ctx, pet, s * 1.32);
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
    mouthOpen(ctx, pet, 10, 7);
    // Brow ridges and nostrils.
    ctx.fillStyle = css(colours.belly, 0.5);
    for (const side of [1, -1]) { ctx.beginPath(); ctx.ellipse(4, side * 4.2, 3.4, 1.3, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = css(mix(colours.body2, BLACK, 0.6), 0.9);
    for (const side of [1, -1]) { ctx.beginPath(); ctx.arc(14.3, side * 1.3, 0.7, 0, TAU); ctx.fill(); }
    eyes(ctx, pet, colours, { x: 5.4, y: 3.9 });
    ctx.restore();
  }

  // -- The cloud dragon: long, wingless, swimming through the air in waves --
  // A mane down its neck, antlers, long whiskers, four small legs that paddle
  // as it swims, a tuft at the tail and little clouds under its feet.
  function paintCloud(ctx, pet, colours, detail, body, light) {
    const s = pet.size, n = body.segments;
    const sat = seated(pet) || pet.mode === "coil";
    const breath = 1 + Math.sin(pet.breathe) * (pet.mode === "sleep" ? 0.03 : 0.018);
    // The swim: a wave runs down the body, strongest mid-body, as big as the speed asks.
    const swim = sat ? 0.1 : clamp(0.35 + pet.speed / 210, 0.35, 1);
    const base = nudges(pet, body);
    const wave = (index) => base(index) + Math.sin(index * 0.4 - pet.flap) * 4.4 * s * swim * clamp((index - 2) / 6, 0, 1) * (1 - 0.4 * index / n);
    const sides = outline(pet.spine, (index) => body.radii[index] * s * (index > 2 && index < 20 ? breath : 1), wave);
    const head = sides[0], tail = sides[n - 1];
    const mane = colours.wing, maneLit = mix(colours.wing, colours.edge, 0.55);
    if (detail > 0) shadow(ctx, pet, sides);
    // The mane, behind the neck: tufts that stream back and out, longest at the head.
    ctx.fillStyle = css(mix(mane, colours.body2, 0.2));
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.45), 0.45);
    ctx.lineWidth = Math.max(0.5, 0.6 * s);
    ctx.beginPath();
    for (let index = 1; index <= 10; index += 1) {
      for (const side of [1, -1]) tuft(ctx, sides[index], side, (14 - index * 0.85 + (index % 2) * 1.5) * s, 0.55 + Math.sin(pet.flap * 0.9 + index * 0.8 + side) * 0.2, 2.7 * s);
    }
    ctx.fill();
    ctx.stroke();
    // Four small legs, paddling as it swims, each with a tuft at the elbow.
    for (const [at, phase] of [[body.shoulder, 0], [body.hip, Math.PI]]) {
      for (const side of [1, -1]) {
        const paddle = sat ? 0 : Math.sin(pet.flap + phase + (side > 0 ? 0 : Math.PI)) * 0.45;
        const knee = leg(ctx, pet, sides, at, side, colours, body, { size: 1.15, paddle, toes: 4, tone: colours.body, splay: 0.62 });
        ctx.fillStyle = css(mane);
        ctx.beginPath();
        tuft(ctx, { x: knee.x, y: knee.y, fx: sides[at].fx, fy: sides[at].fy, nx: sides[at].nx, ny: sides[at].ny, r: 0 }, side, 6 * s, 0.55, 1.6 * s);
        ctx.fill();
      }
    }
    // The body.
    bodyPath(ctx, sides);
    const shade = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    shade.addColorStop(0, css(colours.body));
    shade.addColorStop(0.5, css(mix(colours.body, colours.body2, 0.55)));
    shade.addColorStop(1, css(mix(colours.body2, BLACK, 0.2)));
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.45), 0.75);
    ctx.stroke();
    // Its back: rows of scales across it as bands, and down the middle a
    // crest of little pale spines pointing back.
    ctx.lineCap = "round";
    if (detail > 0 && s > 0.45) {
      ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.35), 0.4);
      ctx.lineWidth = Math.max(0.55, 0.75 * s);
      ctx.beginPath();
      for (let index = 3; index < n - 4; index += 2) {
        const p = sides[index];
        const back = Math.atan2(-p.fy, -p.fx);
        // A band: an arc bowed toward the tail, from edge to edge.
        ctx.moveTo(p.x + p.nx * p.r * 0.92, p.y + p.ny * p.r * 0.92);
        ctx.quadraticCurveTo(p.x + Math.cos(back) * p.r * 0.75, p.y + Math.sin(back) * p.r * 0.75, p.x - p.nx * p.r * 0.92, p.y - p.ny * p.r * 0.92);
      }
      ctx.stroke();
    }
    ctx.fillStyle = css(mix(colours.horn, colours.belly, 0.4), 0.92);
    ctx.beginPath();
    for (let index = 4; index < n - 5; index += 2) {
      const p = sides[index];
      const long = p.r * 1.05, wide = p.r * 0.34;
      ctx.moveTo(p.x + p.fx * long * 0.25 + p.nx * wide, p.y + p.fy * long * 0.25 + p.ny * wide);
      ctx.lineTo(p.x - p.fx * long, p.y - p.fy * long);
      ctx.lineTo(p.x + p.fx * long * 0.25 - p.nx * wide, p.y + p.fy * long * 0.25 - p.ny * wide);
      ctx.closePath();
    }
    ctx.fill();
    // A flame of a tuft at the tail tip.
    tailTuft(ctx, pet, sides, mane, maneLit);
    // The mane's crest along the top of the neck, over the body.
    ctx.fillStyle = css(maneLit);
    ctx.beginPath();
    for (let index = 1; index <= 7; index += 2) tuft(ctx, sides[index], index % 4 === 1 ? 0.35 : -0.35, (9 - index * 0.7) * s, 0.12 + Math.sin(pet.flap * 0.9 + index) * 0.12, 1.8 * s);
    ctx.fill();
    cloudHead(ctx, pet, colours, mane, maneLit);
    return sides[body.shoulder];
  }
  // A lock of hair from the body's edge on `side` (or a fraction of it, for
  // the crest), streaming back at `angle` from straight back: added to the
  // current path, so a whole mane is one fill.
  function tuft(ctx, p, side, length, angle, width) {
    const out = side < 0 ? -1 : 1;
    const rootX = p.x + p.nx * side * p.r * 0.7, rootY = p.y + p.ny * side * p.r * 0.7;
    // The tip: back along the body, swung out to its side.
    const dirX = -p.fx * Math.cos(angle) + p.nx * out * Math.sin(angle), dirY = -p.fy * Math.cos(angle) + p.ny * out * Math.sin(angle);
    const tipX = rootX + dirX * length, tipY = rootY + dirY * length;
    const px = -dirY * width, py = dirX * width;
    ctx.moveTo(rootX + p.fx * width * 0.8, rootY + p.fy * width * 0.8);
    ctx.quadraticCurveTo(rootX + dirX * length * 0.45 + px, rootY + dirY * length * 0.45 + py, tipX, tipY);
    ctx.quadraticCurveTo(rootX + dirX * length * 0.4 - px * 0.6, rootY + dirY * length * 0.4 - py * 0.6, rootX - p.fx * width * 0.6, rootY - p.fy * width * 0.6);
    ctx.closePath();
  }
  function tailTuft(ctx, pet, sides, mane, lit) {
    const s = pet.size, n = sides.length;
    const end = sides[n - 1], before = sides[n - 4];
    const angle = Math.atan2(end.y - before.y, end.x - before.x);
    const sway = Math.sin(pet.flap * 0.9) * 0.25;
    ctx.fillStyle = css(mane);
    ctx.beginPath();
    for (const [spread, length] of [[-0.45, 11], [0, 15], [0.45, 11], [-0.2, 13], [0.2, 13]]) {
      const a = angle + spread + sway;
      const tipX = end.x + Math.cos(a) * length * s, tipY = end.y + Math.sin(a) * length * s;
      const px = -Math.sin(a) * 2.2 * s, py = Math.cos(a) * 2.2 * s;
      ctx.moveTo(end.x - Math.cos(angle) * 3 * s + px, end.y - Math.sin(angle) * 3 * s + py);
      ctx.quadraticCurveTo(end.x + Math.cos(a) * length * 0.5 * s + px * 1.4, end.y + Math.sin(a) * length * 0.5 * s + py * 1.4, tipX, tipY);
      ctx.quadraticCurveTo(end.x + Math.cos(a) * length * 0.5 * s - px * 1.4, end.y + Math.sin(a) * length * 0.5 * s - py * 1.4, end.x - Math.cos(angle) * 3 * s - px, end.y - Math.sin(angle) * 3 * s - py);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = css(lit, 0.8);
    ctx.beginPath();
    const a = angle + sway * 1.3;
    ctx.moveTo(end.x, end.y);
    ctx.quadraticCurveTo(end.x + Math.cos(a + 0.25) * 6 * s, end.y + Math.sin(a + 0.25) * 6 * s, end.x + Math.cos(a) * 10 * s, end.y + Math.sin(a) * 10 * s);
    ctx.quadraticCurveTo(end.x + Math.cos(a - 0.25) * 6 * s, end.y + Math.sin(a - 0.25) * 6 * s, end.x, end.y);
    ctx.fill();
  }
  function cloudHead(ctx, pet, colours, mane, lit) {
    const s = pet.size;
    const scale = s * 1.3;
    headFrame(ctx, pet, scale);
    const sway = Math.sin(pet.clock * 2.6) * 2.4 + clamp(pet.speed / 70, 0, 3.5);
    ctx.lineCap = "round";
    // Cheek fringe, swept back behind the jaw.
    ctx.fillStyle = css(mane);
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.4), 0.5);
    ctx.lineWidth = Math.max(0.5, 0.6 / scale);
    ctx.beginPath();
    for (const side of [1, -1]) {
      for (const [x, y, length, angle] of [[-7, 4, 12, 0.95], [-4.5, 5.6, 13.5, 0.72], [-1, 6, 12, 0.5], [3, 5.8, 9, 0.34]]) {
        const a = Math.PI - angle * side;
        const tipX = x + Math.cos(a) * length, tipY = side * y + Math.sin(a) * length + side * Math.sin(pet.clock * 2 + x) * 0.8;
        ctx.moveTo(x + 2, side * (y - 1.2));
        ctx.quadraticCurveTo(x - length * 0.4, side * (y + 3.2), tipX, tipY);
        ctx.quadraticCurveTo(x - length * 0.3, side * (y - 0.6), x - 1, side * (y - 1.6));
        ctx.closePath();
      }
    }
    ctx.fill();
    ctx.stroke();
    // Antlers: a curved beam back from the brow with two tines, drawn over a darker edge.
    const antlers = () => {
      for (const side of [1, -1]) {
        ctx.moveTo(-1.5, side * 3.4);
        ctx.quadraticCurveTo(-8, side * 8.5, -17, side * 8.2);
        ctx.moveTo(-8.2, side * 7.4); ctx.quadraticCurveTo(-10.5, side * 11.5, -13.5, side * 12.6);
        ctx.moveTo(-12.6, side * 8.3); ctx.quadraticCurveTo(-15, side * 11.2, -18.5, side * 11.6);
      }
    };
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.5), 0.85);
    ctx.lineWidth = Math.max(2.6, 2 / scale);
    ctx.beginPath(); antlers(); ctx.stroke();
    ctx.strokeStyle = css(colours.horn);
    ctx.lineWidth = Math.max(1.5, 1.1 / scale);
    ctx.beginPath(); antlers(); ctx.stroke();
    // Whiskers: two long barbels from the upper lip, curling back and waving.
    ctx.strokeStyle = css(mix(colours.belly, lit, 0.4), 0.95);
    ctx.lineWidth = Math.max(0.85, 0.75 / scale);
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(16.4, side * 3.6);
      ctx.bezierCurveTo(13, side * (12 + sway * 0.4), -4, side * (13.5 + sway), -14 - sway, side * (11.5 + sway * 0.8));
      ctx.bezierCurveTo(-22 - sway, side * (9.5 + sway * 0.6), -27, side * (13 + Math.sin(pet.clock * 3.3) * 2), -30 - sway * 0.6, side * (17 + sway * 0.5));
      ctx.stroke();
    }
    // The head: wide at the cheeks, a broad snout and a big round nose.
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.bezierCurveTo(-7, -6.8, -1, -8.4, 4, -6.6);
    ctx.quadraticCurveTo(9, -4.4, 12.5, -4.6);
    ctx.bezierCurveTo(17.5, -5.6, 19.6, -2.4, 19.2, 0);
    ctx.bezierCurveTo(19.6, 2.4, 17.5, 5.6, 12.5, 4.6);
    ctx.quadraticCurveTo(9, 4.4, 4, 6.6);
    ctx.bezierCurveTo(-1, 8.4, -7, 6.8, -7, 0);
    const skull = ctx.createLinearGradient(-7, 0, 19, 0);
    skull.addColorStop(0, css(mix(colours.body, colours.body2, 0.18)));
    skull.addColorStop(1, css(mix(colours.body, WHITE, 0.14)));
    ctx.fillStyle = skull;
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.45), 0.75);
    ctx.stroke();
    mouthOpen(ctx, pet, 11, 8);
    // Heavy brows, a ridge down the nose, and nostrils that curl.
    ctx.fillStyle = css(mix(colours.belly, colours.horn, 0.3), 0.75);
    for (const side of [1, -1]) { ctx.beginPath(); ctx.ellipse(3.2, side * 5, 4.2, 1.7, side * -0.22, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = css(colours.belly, 0.45);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(15, 0); ctx.stroke();
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.55), 0.9);
    ctx.lineWidth = 0.85;
    for (const side of [1, -1]) { ctx.beginPath(); ctx.arc(16.8, side * 2.2, 1.05, side > 0 ? -0.5 : 0.5, side > 0 ? 2.6 : -2.6, side < 0); ctx.stroke(); }
    eyes(ctx, pet, colours, { x: 5.2, y: 4.2 }, { size: 1.1, slit: false });
    ctx.restore();
  }

  // -- The phoenix: a firebird with a long flowing tail of flame feathers --
  function paintPhoenix(ctx, pet, colours, detail, body, light) {
    const s = pet.size;
    const breath = 1 + Math.sin(pet.breathe) * (pet.mode === "sleep" ? 0.03 : 0.018);
    const sides = outline(pet.spine, (index) => body.radii[index] * s * (index > 1 && index < body.tail ? breath : 1), nudges(pet, body));
    const head = sides[0], base = sides[body.tail];
    if (detail > 0) { shadow(ctx, pet, sides, 0.8); }
    plumes(ctx, pet, sides, colours, body, light);
    for (const side of [1, -1]) featherWing(ctx, pet, sides, side, colours, body, light);
    // The body, head to the root of the tail.
    bodyPath(ctx, sides, 0, body.tail);
    const shade = ctx.createLinearGradient(head.x, head.y, base.x, base.y);
    shade.addColorStop(0, css(mix(colours.body, WHITE, 0.1)));
    shade.addColorStop(0.6, css(mix(colours.body, colours.body2, 0.4)));
    shade.addColorStop(1, css(colours.body2));
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, 0.9 * s);
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.45), 0.7);
    ctx.stroke();
    // Feathers on its back: little scallops in rows.
    if (detail > 0 && s > 0.5) {
      ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.3), 0.3);
      ctx.lineWidth = 0.7 * s;
      ctx.beginPath();
      for (let index = 2; index < body.tail - 1; index += 1) {
        const p = sides[index];
        const back = Math.atan2(p.fy, p.fx);
        for (const off of index % 2 ? [-0.45, 0.45] : [0]) {
          const cx = p.x + p.nx * off * p.r, cy = p.y + p.ny * off * p.r;
          ctx.moveTo(cx + Math.cos(back + 1.3) * p.r * 0.36, cy + Math.sin(back + 1.3) * p.r * 0.36);
          ctx.arc(cx, cy, p.r * 0.36, back + 1.3, back - 1.3, true);
        }
      }
      ctx.stroke();
    }
    // Feet, when it sits: two small three-toed feet just ahead of the wings.
    if (seated(pet) || pet.mode === "coil") {
      ctx.strokeStyle = css(colours.horn);
      ctx.lineCap = "round";
      ctx.lineWidth = 1 * s;
      const p = sides[body.shoulder - 1];
      ctx.beginPath();
      for (const side of [1, -1]) {
        const fx = p.x + p.nx * side * p.r * 0.55 + p.fx * 2 * s, fy = p.y + p.ny * side * p.r * 0.55 + p.fy * 2 * s;
        for (const spread of [-0.5, 0, 0.5]) {
          const a = Math.atan2(p.fy, p.fx) + spread;
          ctx.moveTo(fx, fy); ctx.lineTo(fx + Math.cos(a) * 3 * s, fy + Math.sin(a) * 3 * s);
        }
      }
      ctx.stroke();
    }
    phoenixHead(ctx, pet, colours, light);
    return sides[body.shoulder];
  }
  // The tail: five long feathers fanning out from the root of the tail, the
  // middle one longest, each a ribbon ending in a flickering flame.
  function plumes(ctx, pet, sides, colours, body, light) {
    const s = pet.size, n = sides.length;
    const from = body.tail, count = n - from;
    const root = sides[from], end = sides[n - 1];
    const [hot, warm, cool] = colours.fire;
    const ribbon = ctx.createLinearGradient(root.x, root.y, end.x, end.y);
    ribbon.addColorStop(0, css(mix(colours.body2, colours.wing, 0.3), 0.95));
    ribbon.addColorStop(0.55, css(mix(colours.wing, warm, 0.55), 0.92));
    ribbon.addColorStop(1, css(mix(warm, cool, 0.35), 0.85));
    const lanes = [[-2, 0.72], [2, 0.72], [-1, 0.86], [1, 0.86], [0, 1]];
    const tips = [];
    ctx.fillStyle = ribbon;
    for (const [lane, reach] of lanes) {
      const last = Math.max(3, Math.round((count - 1) * reach));
      const left = [], right = [];
      for (let k = 0; k <= last; k += 1) {
        const p = sides[from + k];
        const t = k / (count - 1);
        const off = lane * Math.pow(t, 1.15) * 6.2 * s + lane * Math.sin(pet.clock * 3 + k * 0.5) * t * 0.8 * s;
        const width = (lane === 0 ? 2.3 : 1.8) * s * (1 - t * 0.55);
        const x = p.x + p.nx * off, y = p.y + p.ny * off;
        left.push([x + p.nx * width, y + p.ny * width]);
        right.push([x - p.nx * width, y - p.ny * width]);
        if (k === last) tips.push({ x, y, angle: Math.atan2(-p.fy, -p.fx), lane });
      }
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (let k = 1; k < left.length; k += 1) ctx.quadraticCurveTo(left[k - 1][0], left[k - 1][1], (left[k - 1][0] + left[k][0]) / 2, (left[k - 1][1] + left[k][1]) / 2);
      ctx.lineTo(left[left.length - 1][0], left[left.length - 1][1]);
      ctx.lineTo(right[right.length - 1][0], right[right.length - 1][1]);
      for (let k = right.length - 1; k > 0; k -= 1) ctx.quadraticCurveTo(right[k][0], right[k][1], (right[k - 1][0] + right[k][0]) / 2, (right[k - 1][1] + right[k][1]) / 2);
      ctx.closePath();
      ctx.fill();
    }
    // Their flames: an outer flame and a hot heart, each flickering on its own.
    for (const [index, tip] of tips.entries()) {
      const flicker = 1 + Math.sin(pet.clock * 11 + index * 2.1) * 0.12 + Math.sin(pet.clock * 7.3 + index) * 0.08;
      const length = (tip.lane === 0 ? 11 : 8.5) * s * flicker, width = (tip.lane === 0 ? 4.6 : 3.6) * s;
      flame(ctx, tip.x, tip.y, tip.angle, length, width, css(light ? mix(cool, warm, 0.5) : warm, 0.95));
      flame(ctx, tip.x + Math.cos(tip.angle) * length * 0.15, tip.y + Math.sin(tip.angle) * length * 0.15, tip.angle, length * 0.55, width * 0.5, css(hot, 0.95));
    }
  }
  // A flame: a teardrop from (x, y) along `angle`, round at the root and pointed at the tip.
  function flame(ctx, x, y, angle, length, width, fill) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const at = (along, across) => [x + cos * along - sin * across, y + sin * along + cos * across];
    ctx.beginPath();
    ctx.moveTo(...at(-width * 0.6, 0));
    ctx.bezierCurveTo(...at(-width * 0.6, width), ...at(length * 0.35, width * 1.05), ...at(length, 0));
    ctx.bezierCurveTo(...at(length * 0.35, -width * 1.05), ...at(-width * 0.6, -width), ...at(-width * 0.6, 0));
    ctx.fillStyle = fill;
    ctx.fill();
  }
  // A bird's wing seen from above: an arm out to the wrist, long flight
  // feathers fanning from it, shorter ones along its back edge, and flame at
  // the tips. Flaps as the dragon's does and folds back along the body.
  function featherWing(ctx, pet, sides, side, colours, body, light) {
    const s = pet.size;
    const p = sides[body.shoulder];
    const { fx, fy, nx, ny } = p;
    const ox = nx * side, oy = ny * side;
    const sx = p.x + ox * p.r * 0.55, sy = p.y + oy * p.r * 0.55;
    const beat = 0.5 + 0.5 * Math.cos(pet.flap);
    const fold = pet.fold ?? 0;
    const spread = lerp(1, 0.32 + 0.68 * beat, pet.flapAmp) * (1 - fold * 0.72);
    const sweep = lerp(0.08, 1.3, fold) + (1 - beat) * 0.2 * pet.flapAmp;
    const turn = (angle) => [Math.cos(angle) * ox - Math.sin(angle) * fx, Math.cos(angle) * oy - Math.sin(angle) * fy];
    const tuck = 1 - fold * 0.42;
    const arm = 19 * s * (0.5 + 0.5 * spread) * tuck;
    const [ax, ay] = turn(sweep - 0.12);
    const wx = sx + ax * arm, wy = sy + ay * arm;
    const [hot, warm, cool] = colours.fire;
    const reach = (length) => length * s * (0.45 + 0.55 * spread) * tuck;
    // Flight feathers: the long primaries fanning from the wrist, and the
    // secondaries along the arm's back edge, longest near the wrist, so the
    // wing has a broad trailing edge.
    const primaries = [], secondaries = [];
    for (let k = 0; k < 6; k += 1) {
      const [dx, dy] = turn(sweep + 0.04 + k * 0.22 * (1 - fold * 0.4));
      const length = reach(33 - k * 2.6);
      primaries.push([wx - ax * 2 * s, wy - ay * 2 * s, wx + dx * length, wy + dy * length, (3.1 - k * 0.08) * s]);
    }
    for (let k = 0; k < 6; k += 1) {
      const t = 0.12 + k * 0.17;
      const rx = lerp(sx, wx, t), ry = lerp(sy, wy, t);
      const [dx, dy] = turn(sweep + 1.5 - k * 0.07);
      const length = reach(12 + k * 2.4);
      secondaries.push([rx, ry, rx + dx * length, ry + dy * length, 3.2 * s]);
    }
    const fan = ctx.createLinearGradient(sx, sy, wx + ax * reach(30), wy + ay * reach(30));
    fan.addColorStop(0, css(mix(colours.body, colours.wing, 0.3)));
    fan.addColorStop(0.45, css(mix(colours.wing, warm, 0.5)));
    fan.addColorStop(1, css(light ? mix(warm, cool, 0.45) : warm));
    const edge = css(mix(colours.body2, BLACK, 0.4), light ? 0.55 : 0.45);
    ctx.lineWidth = Math.max(0.55, 0.65 * s);
    ctx.strokeStyle = edge;
    // Back to front: secondaries, the coverts over their roots, then the primaries.
    ctx.fillStyle = fan;
    ctx.beginPath();
    for (const [x0, y0, x1, y1, width] of secondaries) quill(ctx, x0, y0, x1, y1, width);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (const [x0, y0, x1, y1, width] of primaries) quill(ctx, x0, y0, x1, y1, width);
    ctx.fill(); ctx.stroke();
    // Coverts: the wing's solid inner part, from the shoulder along the arm and over the feathers' roots.
    const [cx0, cy0] = turn(sweep + 1.35);
    ctx.beginPath();
    ctx.moveTo(sx - fx * 2 * s, sy - fy * 2 * s);
    ctx.lineTo(wx, wy);
    ctx.quadraticCurveTo(wx + cx0 * reach(9), wy + cy0 * reach(9), lerp(sx, wx, 0.35) + cx0 * reach(10), lerp(sy, wy, 0.35) + cy0 * reach(10));
    ctx.quadraticCurveTo(sx + cx0 * reach(6), sy + cy0 * reach(6), sx - fx * 6 * s, sy - fy * 6 * s);
    ctx.closePath();
    ctx.fillStyle = css(mix(colours.body, colours.wing, 0.25));
    ctx.fill();
    ctx.stroke();
    // Flame at the tips of the long feathers.
    for (const [index, [, , x1, y1]] of primaries.entries()) {
      const angle = Math.atan2(y1 - wy, x1 - wx);
      const flicker = 1 + Math.sin(pet.clock * 10 + index * 1.7) * 0.15;
      flame(ctx, x1 - Math.cos(angle) * 5.5 * s, y1 - Math.sin(angle) * 5.5 * s, angle, 8.5 * s * flicker * (0.5 + 0.5 * spread), 2.2 * s, css(light ? mix(warm, cool, 0.3) : hot, 0.92));
    }
    // The arm's leading edge.
    ctx.strokeStyle = css(mix(colours.body, colours.edge, 0.4), 0.95);
    ctx.lineCap = "round";
    ctx.lineWidth = 2.3 * s;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(wx, wy); ctx.stroke();
  }
  // A feather's outline, added to the current path: every feather turns the
  // same way, so overlapping ones fill as one.
  function quill(ctx, x0, y0, x1, y1, width) {
    const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy) || 1;
    const px = (-dy / length) * width, py = (dx / length) * width;
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + dx * 0.45 + px, y0 + dy * 0.45 + py, x1, y1);
    ctx.quadraticCurveTo(x0 + dx * 0.45 - px, y0 + dy * 0.45 - py, x0, y0);
    ctx.closePath();
  }
  function phoenixHead(ctx, pet, colours, light) {
    const s = pet.size;
    headFrame(ctx, pet, s * 1.15);
    const [hot, warm] = colours.fire;
    // A crest: three short flame-coloured feathers swept back from the crown.
    const sway = Math.sin(pet.clock * 3.4) * 0.12;
    ctx.beginPath();
    for (const [y, length, lean] of [[-1.6, 8, -0.32], [0, 10, 0], [1.6, 8, 0.32]]) {
      const angle = Math.PI + lean + sway;
      quill(ctx, -2.5, y, -2.5 + Math.cos(angle) * length, y + Math.sin(angle) * length, 1.5);
    }
    const crest = ctx.createLinearGradient(-2, 0, -13, 0);
    crest.addColorStop(0, css(mix(colours.body, warm, 0.4)));
    crest.addColorStop(1, css(light ? mix(warm, colours.fire[2], 0.35) : mix(warm, hot, 0.3)));
    ctx.fillStyle = crest;
    ctx.fill();
    // The head: round, with a hooked beak.
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.4, 5.4, 0, 0, TAU);
    const skull = ctx.createLinearGradient(-6, 0, 7, 0);
    skull.addColorStop(0, css(mix(colours.body, colours.body2, 0.2)));
    skull.addColorStop(1, css(mix(colours.body, WHITE, 0.16)));
    ctx.fillStyle = skull;
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.45), 0.7);
    ctx.stroke();
    mouthOpen(ctx, pet, 5, 6);
    ctx.beginPath();
    ctx.moveTo(4.6, -2.6);
    ctx.quadraticCurveTo(10.5, -2.2, 12.6, 0.6);
    ctx.quadraticCurveTo(10.2, 0.4, 9.4, 1.4);
    ctx.quadraticCurveTo(7.4, 2.6, 4.6, 2.6);
    ctx.closePath();
    ctx.fillStyle = css(mix(colours.horn, warm, 0.35));
    ctx.fill();
    ctx.strokeStyle = css(mix(colours.body2, BLACK, 0.5), 0.6);
    ctx.lineWidth = 0.6;
    ctx.stroke();
    eyes(ctx, pet, colours, { x: 1.8, y: 3.4 }, { size: 0.66, slit: false });
    ctx.restore();
  }

  // -- The will-o'-wisp: a small ghostly flame with a trail of drifting sparks --
  // Its flame: the brighter of a skin's body and wing colours, so a dark skin still glows.
  const wispFire = (colours) => (shine(colours.body) < 0.28 ? mix(colours.body, colours.wing, 0.8) : colours.body);
  function paintWisp(ctx, pet, colours, detail, body, light) {
    const s = pet.size, n = body.segments;
    const asleep = pet.mode === "sleep";
    const glow = asleep ? 0.5 : 1;
    const fire = wispFire(colours);
    const core = mix(fire, WHITE, 0.62);
    const ink = mix(colours.body2, BLACK, 0.35);
    const base = nudges(pet, body);
    // The trail flickers more the further it is from the head.
    const flicker = (index) => base(index) + (Math.sin(pet.clock * 9 + index * 1.7) * 2.2 + Math.sin(pet.clock * 5.3 + index * 0.9) * 1.4) * (index / n) * s;
    const sides = outline(pet.spine, (index) => body.radii[index] * s * (1 + 0.07 * Math.sin(pet.clock * 7 + index)), flicker);
    const head = sides[0], tail = sides[n - 1];
    // A soft light around it.
    const reach = (asleep ? 20 : 30) * s;
    const halo = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, reach);
    halo.addColorStop(0, css(fire, (light ? 0.24 : 0.34) * glow));
    halo.addColorStop(1, css(fire, 0));
    ctx.save();
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(head.x, head.y, reach, 0, TAU); ctx.fill();
    ctx.restore();
    // Its flame, licking up from the top of it (up, whichever way it flies,
    // like its face): a tall tongue between two small ones, a hotter one inside.
    const lick = asleep ? 0.5 : 1;
    const r0 = head.r;
    for (const [index, [dx, length, width, lean]] of [[-0.55, 1.9, 0.46, -0.32], [0.55, 1.75, 0.44, 0.3], [0, 2.75, 0.7, 0]].entries()) {
      const sway = Math.sin(pet.clock * (5.5 + index * 1.3) + index * 2) * 0.24 + lean;
      const flick = 1 + Math.sin(pet.clock * 10 + index * 1.9) * 0.14;
      flame(ctx, head.x + dx * r0, head.y - r0 * 0.1, -Math.PI / 2 + sway, length * r0 * flick * lick, width * r0, css(mix(fire, colours.body2, 0.18), 0.82 * glow + 0.12));
    }
    flame(ctx, head.x, head.y - r0 * 0.3, -Math.PI / 2 + Math.sin(pet.clock * 6.1) * 0.2, 1.9 * r0 * lick, 0.42 * r0, css(core, 0.8 * glow + 0.1));
    // The flame and its trail, round at the front and fading toward the tail.
    bodyPath(ctx, sides, 0, n - 1, true);
    const fade = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    fade.addColorStop(0, css(fire, 0.9 * glow + 0.1));
    fade.addColorStop(0.3, css(fire, 0.55 * glow + 0.05));
    fade.addColorStop(0.7, css(mix(fire, colours.body2, 0.25), 0.2 * glow));
    fade.addColorStop(1, css(fire, 0));
    ctx.fillStyle = fade;
    ctx.fill();
    if (light) {
      // On a pale page its edge is drawn, faintly, so the flame keeps its shape.
      ctx.lineWidth = Math.max(0.6, 0.8 * s);
      ctx.strokeStyle = css(ink, 0.32);
      ctx.stroke();
    }
    // A brighter heart inside it.
    const inner = sides.slice(0, Math.ceil(n * 0.45)).map((p, index) => {
      const r = p.r * (0.5 - index * 0.014);
      return { ...p, r, lx: p.x + p.nx * r, ly: p.y + p.ny * r, rx: p.x - p.nx * r, ry: p.y - p.ny * r };
    });
    bodyPath(ctx, inner, 0, inner.length - 1, true);
    ctx.fillStyle = css(core, 0.7 * glow + 0.15);
    ctx.fill();
    // The core: white-hot in the middle.
    const heart = ctx.createRadialGradient(head.x, head.y - 0.6 * s, 0, head.x, head.y, head.r * 1.1);
    heart.addColorStop(0, css(WHITE, 0.95 * glow + 0.05));
    heart.addColorStop(0.55, css(core, 0.88 * glow));
    heart.addColorStop(1, css(fire, 0));
    ctx.fillStyle = heart;
    ctx.beginPath(); ctx.arc(head.x, head.y, head.r * 1.1, 0, TAU); ctx.fill();
    if (light) {
      ctx.lineWidth = Math.max(0.6, 0.9 * s);
      ctx.strokeStyle = css(ink, 0.3);
      ctx.beginPath(); ctx.arc(head.x, head.y, head.r * 1.02, 0, TAU); ctx.stroke();
    }
    wispFace(ctx, pet, head, colours);
    return sides[2];
  }
  // A wisp's face is drawn upright, whichever way it flies: two eyes that look
  // the way it goes, closed asleep, happy arcs while it purrs, and a little
  // round mouth for a yawn.
  function wispFace(ctx, pet, head, colours) {
    const s = pet.size;
    const neck = pet.spine[1];
    const facing = Math.atan2(head.y - neck.y, head.x - neck.x) + pet.look;
    const lookX = Math.cos(facing) * 1.6 * s, lookY = Math.sin(facing) * 0.9 * s;
    const ink = css(mix(colours.body2, BLACK, 0.72), 0.92);
    const shut = eyesShut(pet);
    const happy = pet.purr > 0.45 && !shut;
    const jerk = jerkOf(pet) * 0.6 * s;
    const cx = head.x + lookX + Math.cos(facing) * jerk, cy = head.y + lookY - 0.6 * s;
    ctx.save();
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.8, 1 * s);
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      const ex = cx + side * 2.6 * s, ey = cy;
      ctx.beginPath();
      if (happy) ctx.arc(ex, ey + 0.6 * s, 1.3 * s, Math.PI + 0.5, TAU - 0.5);
      else if (shut) ctx.arc(ex, ey - 0.4 * s, 1.3 * s, 0.5, Math.PI - 0.5);
      else ctx.ellipse(ex, ey, 1.05 * s, 1.55 * s, 0, 0, TAU);
      if (happy || shut) ctx.stroke(); else ctx.fill();
    }
    if (!happy && !shut) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + side * 2.6 * s + 0.35 * s, cy - 0.6 * s, 0.38 * s, 0, TAU); ctx.fill(); }
    }
    const open = Math.max(pet.yawn, pet.mouth * 0.6);
    if (open > 0.05) {
      ctx.fillStyle = ink;
      ctx.beginPath(); ctx.ellipse(cx, cy + 3 * s, 1.1 * s * (0.5 + open), 1.4 * s * open + 0.3 * s, 0, 0, TAU); ctx.fill();
    } else if (happy) {
      ctx.beginPath(); ctx.arc(cx, cy + 2.2 * s, 1.1 * s, 0.4, Math.PI - 0.4); ctx.stroke();
    }
    ctx.restore();
  }

  const PAINTERS = Object.freeze({ dragon: paintDragon, cloud: paintCloud, phoenix: paintPhoenix, wisp: paintWisp });
  function paintPet(ctx, pet, skin, { detail = 1, label = "", name = "", light = null } = {}) {
    const body = shapeOf(pet.kind);
    const colours = skinColours(skin);
    const onLight = light === null ? lightPage() : Boolean(light);
    const chest = (PAINTERS[pet.kind] || paintDragon)(ctx, pet, colours, detail, body, onLight);
    if (chest) purrLines(ctx, pet, chest, colours, onLight);
    paintFirefly(ctx, pet, onLight);
    particles(ctx, pet, colours, onLight);
    if (label) nameTag(ctx, pet, label);
    else if (name && pet.tag > 0.03) nameTag(ctx, pet, name, pet.tag);
  }
  function particles(ctx, pet, colours, light) {
    if (!pet.particles.length) return;
    const glowing = light ? "source-over" : "lighter";
    const misty = pet.kind === "cloud";
    ctx.save();
    for (const bit of pet.particles) {
      const age = 1 - bit.life / bit.max;
      if (bit.kind === "fire") {
        const [hot, warm, cool] = colours.fire;
        const colour = age < 0.35 ? mix(hot, warm, age / 0.35) : mix(warm, cool, clamp((age - 0.35) / 0.65, 0, 1));
        ctx.globalCompositeOperation = misty ? "source-over" : "lighter";
        // A cloud dragon breathes a shining mist rather than flame.
        ctx.fillStyle = css(misty ? mix(colour, WHITE, 0.45) : colour, (1 - age) * (misty ? 0.5 : 0.85));
        ctx.beginPath(); ctx.arc(bit.x, bit.y, Math.max(0.5, bit.size * (misty ? 0.6 + age : 1 - age * 0.7) * pet.size), 0, TAU); ctx.fill();
      } else if (bit.kind === "smoke") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = css([150, 150, 160], (1 - age) * 0.35);
        ctx.beginPath(); ctx.arc(bit.x, bit.y, bit.size * (0.6 + age), 0, TAU); ctx.fill();
      } else if (bit.kind === "z") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = css(light ? mix(colours.body2, BLACK, 0.2) : colours.belly, (1 - age) * 0.9);
        ctx.font = `600 ${Math.round(bit.size + age * 5)}px system-ui, sans-serif`;
        ctx.fillText("z", bit.x, bit.y);
      } else if (bit.kind === "heart") {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = css([255, 96, 140], (1 - age));
        const r = bit.size * 0.5;
        ctx.beginPath();
        ctx.moveTo(bit.x, bit.y + r);
        ctx.bezierCurveTo(bit.x - r * 2, bit.y - r * 0.4, bit.x - r * 0.6, bit.y - r * 2, bit.x, bit.y - r * 0.7);
        ctx.bezierCurveTo(bit.x + r * 0.6, bit.y - r * 2, bit.x + r * 2, bit.y - r * 0.4, bit.x, bit.y + r);
        ctx.fill();
      } else if (bit.kind === "drift") {
        // A wisp's spark: a point of its light with a little glow.
        const fire = wispFire(colours);
        const twinkle = 0.65 + 0.35 * Math.sin(bit.life * 12 + bit.phase);
        ctx.globalCompositeOperation = glowing;
        ctx.fillStyle = css(light ? mix(fire, colours.body2, 0.35) : fire, (1 - age) * 0.22 * twinkle);
        ctx.beginPath(); ctx.arc(bit.x, bit.y, bit.size * 2, 0, TAU); ctx.fill();
        ctx.fillStyle = css(light ? mix(fire, BLACK, 0.15) : mix(fire, WHITE, 0.6), (1 - age) * twinkle);
        ctx.beginPath(); ctx.arc(bit.x, bit.y, bit.size, 0, TAU); ctx.fill();
      } else if (bit.kind === "ember") {
        const [hot, warm, cool] = colours.fire;
        ctx.globalCompositeOperation = glowing;
        ctx.fillStyle = css(age < 0.4 ? mix(hot, warm, age / 0.4) : mix(warm, cool, (age - 0.4) / 0.6), (1 - age) * 0.9);
        ctx.beginPath(); ctx.arc(bit.x, bit.y, bit.size * (1 - age * 0.5), 0, TAU); ctx.fill();
      } else if (bit.kind === "puff") {
        // A little cloud: a big round between two small ones, as one shape.
        ctx.globalCompositeOperation = "source-over";
        const tone = light ? mix(colours.body2, WHITE, 0.62) : mix(colours.belly, WHITE, 0.55);
        const alpha = hump(Math.min(1, age * 1.3 + 0.08)) * (light ? 0.6 : 0.5);
        const r = bit.size * (0.7 + age * 0.5);
        ctx.beginPath();
        for (const [dx, dy, k] of [[-0.78, 0.18, 0.58], [0, -0.12, 0.82], [0.8, 0.22, 0.52]]) {
          ctx.moveTo(bit.x + dx * r + k * r, bit.y + dy * r);
          ctx.arc(bit.x + dx * r, bit.y + dy * r, k * r, 0, TAU);
        }
        ctx.fillStyle = css(tone, alpha);
        ctx.fill();
      } else {
        ctx.globalCompositeOperation = glowing;
        const twinkle = 0.6 + 0.4 * Math.sin(bit.life * 30);
        ctx.fillStyle = css(light ? mix(colours.body2, colours.fire[1], 0.5) : mix(colours.edge, WHITE, 0.4), (1 - age) * twinkle);
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
    const out = { ...DEFAULTS, names: {} };
    if (saved && typeof saved === "object") {
      if (typeof saved.on === "boolean") out.on = saved.on;
      if (KIND[saved.kind]) out.kind = saved.kind;
      if (SKIN_LIST.some((skin) => skin.id === saved.skin)) out.skin = saved.skin;
      if (typeof saved.name === "string" && saved.name.trim()) out.name = saved.name.trim().slice(0, 24);
      // The other pets' own names (Ember's stays in `name`, as it always was).
      if (saved.names && typeof saved.names === "object") {
        for (const kind of KINDS) {
          const value = saved.names[kind.id];
          if (kind.id !== "dragon" && typeof value === "string" && value.trim()) out.names[kind.id] = value.trim().slice(0, 24);
        }
      }
      if (typeof saved.calm === "boolean") out.calm = saved.calm;
      if (typeof saved.come === "boolean") out.come = saved.come;
      if (typeof saved.touch === "boolean") out.touch = saved.touch;
      if ([0.8, 1, 1.25].includes(Number(saved.size))) out.size = Number(saved.size);
    }
    return out;
  }
  let prefs = readStore();
  const writeStore = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch { /* a private store: the choice lasts this session */ } };
  const owns = (item) => !item || window.MefiShop?.owns?.(item) === true;
  // Kill switches, per device, read once.
  const killed = (key) => { try { return localStorage.getItem(key) === "off"; } catch { return false; } };
  const switches = { antics: !killed("mefiStudio.pet.antics"), live: !killed("mefiStudio.pet.livePreview") };
  // Each pet's name: Ember's in `name`, the others' in `names` or their own.
  const nameOf = (kind) => (kind === "dragon" || !KIND[kind] ? prefs.name : prefs.names[kind] || KIND[kind].called);
  let borrowed = null; // a Shop Try: { kind, skin, until, timer }
  function look() {
    if (borrowed) return { on: true, kind: borrowed.kind, skin: borrowed.skin, name: nameOf(borrowed.kind) };
    const kind = KIND[prefs.kind] || KIND.dragon;
    const skin = SKIN_LIST.find((item) => item.id === prefs.skin) || SKIN_LIST[0];
    // A pet or skin that is not owned (a lost Shop cache, a Try's leftover) is Ember in the theme's colours.
    const id = owns(kind.item) ? kind.id : "dragon";
    return { on: prefs.on, kind: id, skin: owns(skin.item) ? skin.id : "theme", name: nameOf(id) };
  }

  // ---- living on the page -----------------------------------------------------
  // Each pet on screen is a view: its flight, a small canvas of its own and
  // whose it is. "you" is the owner's pet; a friend's pet visiting from a
  // room is a guest (MefiPets.guests). One clock steps and paints them all.
  const CANVAS = 360; // css px; a pet and its fire fit inside
  const MAX_GUESTS = 5;
  const loop = { running: false, raf: 0, timer: 0, last: 0, dpr: 1, cost: 0, painted: 0 };
  const views = new Map(); // id -> { id, canvas, ctx, sim, skin, label, guest }
  const input = { x: null, y: null, at: 0, speed: 0, keyAt: -1e9, anyAt: now(), still: 0, turn: null, turns: [], cx: 0, cy: 0, circleAt: -1e9 };
  const world = { width: 1280, height: 800, pointer: null, quiet: 0, typing: false, motion: "on", avoid: [], perches: [], react: null, visit: null, come: true, calm: true, touch: true, antics: true, background: false, friends: [] };
  let pending = null; // a reaction waiting for the owner's pet's next step
  const headless = () => /[?&](smoke|capture)=1\b/.test(String(window.location?.search || ""));
  const motionMode = () => {
    const mode = document.documentElement?.dataset?.motion;
    if (window.MefiNav?.noMotion?.() === true || mode === "off") return "off";
    return mode === "calm" ? "calm" : "on";
  };
  function makeView(id, { guest = false, kind = "dragon", skin = "theme", label = "", size = 1 } = {}) {
    const canvas = document.createElement("canvas");
    if (!guest) canvas.id = "studio-pet";
    canvas.setAttribute("aria-hidden", "true");
    canvas.className = guest ? "studio-pet is-guest" : "studio-pet";
    document.body.append(canvas);
    readPage();
    const view = { id, canvas, ctx: canvas.getContext?.("2d") || null, skin, label, guest,
      sim: flight({ id, kind, seed: Math.floor(Math.random() * 1e9), size, width: world.width, height: world.height, arrive: guest }) };
    sizeCanvas(view);
    views.set(id, view);
    return view;
  }
  // Another kind for a pet already on screen: a new body where the old one was.
  function reshape(view, kind) {
    const old = view.sim.pet;
    view.sim = flight({ id: view.id, kind, seed: Math.floor(Math.random() * 1e9), size: old.size, width: world.width, height: world.height, at: { x: old.x, y: old.y, heading: old.heading } });
  }
  function dropView(id) {
    const view = views.get(id);
    if (!view) return;
    view.canvas.remove();
    views.delete(id);
  }
  function sizeCanvas(view) {
    loop.dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    view.canvas.width = Math.round(CANVAS * loop.dpr);
    view.canvas.height = Math.round(CANVAS * loop.dpr);
    view.canvas.style.width = `${CANVAS}px`;
    view.canvas.style.height = `${CANVAS}px`;
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
  // The pointer, as the pets need it: where it is, how fast it goes, how long
  // it has rested, and whether it is going round in quick circles (its turns
  // over the last 0.9 s add up to a whole circle, at speed).
  const CIRCLE_MS = 900;
  function noteInput(event) {
    const at = now();
    input.anyAt = at;
    if (event.type === "keydown") { input.keyAt = at; return; }
    if (typeof event.clientX !== "number") return;
    if (input.x !== null) {
      const gap = Math.max(1, at - input.at);
      const dx = event.clientX - input.x, dy = event.clientY - input.y;
      const moved = Math.hypot(dx, dy);
      input.speed = lerp(input.speed, (moved / gap) * 1000, 0.5);
      if (event.type === "pointermove" && moved >= 3) {
        const heading = Math.atan2(dy, dx);
        if (input.turn !== null) input.turns.push({ at, by: wrap(heading - input.turn) });
        input.turn = heading;
        while (input.turns.length && at - input.turns[0].at > CIRCLE_MS) input.turns.shift();
        input.cx = lerp(input.cx || event.clientX, event.clientX, 0.2);
        input.cy = lerp(input.cy || event.clientY, event.clientY, 0.2);
        const spin = input.turns.reduce((sum, turn) => sum + turn.by, 0);
        if (Math.abs(spin) >= TAU && input.speed > 300) { input.circleAt = at; input.turns.length = 0; }
      }
    }
    input.x = event.clientX; input.y = event.clientY; input.at = at;
  }
  function inputWorld(at) {
    world.quiet = (at - input.anyAt) / 1000;
    world.typing = at - input.keyAt < 2500;
    if (input.x === null) { world.pointer = null; return; }
    const still = (at - input.at) / 1000;
    if (still > 0.15) { input.speed = lerp(input.speed, 0, 0.3); input.turns.length = 0; input.turn = null; }
    world.pointer = { x: input.x, y: input.y, speed: input.speed, still, circling: at - input.circleAt < 450, circle: { x: input.cx, y: input.cy } };
  }
  // A step for every frame; a paint as often as the busiest pet needs: smooth
  // in flight, slower while sitting, slowest asleep.
  const FPS = { rest: 15, sleep: 6, coil: 40 };
  function frame(at) {
    loop.raf = 0; loop.timer = 0;
    if (!loop.running) return;
    const dt = Math.min(0.05, Math.max(0, (at - (loop.last || at)) / 1000));
    loop.last = at;
    if (at - lookedAt > 700) readPage();
    inputWorld(at);
    world.motion = motionMode();
    world.background = typeof document.hasFocus === "function" ? !document.hasFocus() : false;
    world.calm = prefs.calm; world.come = prefs.come; world.touch = prefs.touch; world.antics = switches.antics;
    // Where every pet's head is, so they can find each other to play.
    world.friends = [...views.values()].map((view) => ({ id: view.id, x: view.sim.pet.x, y: view.sim.pet.y }));
    for (const view of views.values()) {
      // Reactions (a finished job, something needing you) are the owner's pet's alone.
      world.react = view.id === "you" ? pending : null;
      view.sim.step(dt, world);
      if (view.id === "you") pending = null;
    }
    world.react = null;
    for (const view of [...views.values()]) {
      if (view.sim.pet.gone) dropView(view.id);
      else paint(view);
    }
    if (!views.size) { stop(); return; }
    schedule();
  }
  function schedule() {
    if (!loop.running || loop.raf || loop.timer) return;
    const pets = [...views.values()].map((view) => view.sim.pet);
    // With motion off every pet sits asleep, drawn once.
    if (world.motion === "off" && pets.every((pet) => pet.mode === "sleep")) return;
    // A rest with something going on (a purr, a stretch, a flick, a firefly) is drawn smoothly, and
    // one with a trail drifting off it at 30 frames a second; a sleeping pet's z's keep its slow pace.
    const busy = (pet) => pet.purr > 0.02 || pet.tag > 0.02 || pet.stretch > 0 || pet.flick > 0 || pet.sneeze > 0 || pet.firefly;
    const pace = (pet) => (busy(pet) ? 60 : pet.particles.length && pet.mode !== "sleep" ? Math.max(30, FPS[pet.mode] || 60) : FPS[pet.mode] || 60);
    const fps = Math.max(...pets.map(pace));
    if (fps >= 60 || typeof setTimeout !== "function") loop.raf = requestAnimationFrame(frame);
    else loop.timer = setTimeout(() => { loop.timer = 0; loop.raf = requestAnimationFrame(frame); }, 1000 / fps);
  }
  function paint(view) {
    const { canvas, ctx, sim } = view;
    if (!canvas || !ctx || !sim) return;
    const pet = sim.pet;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of pet.spine) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
    // A firefly it is after stays in the picture.
    if (pet.firefly) { minX = Math.min(minX, pet.firefly.x); maxX = Math.max(maxX, pet.firefly.x); minY = Math.min(minY, pet.firefly.y); maxY = Math.max(maxY, pet.firefly.y); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const left = Math.round(cx - CANVAS / 2), top = Math.round(cy - CANVAS / 2);
    canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    const started = now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(loop.dpr, 0, 0, loop.dpr, -left * loop.dpr, -top * loop.dpr);
    const shown = view.guest ? null : look();
    paintPet(ctx, pet, view.guest ? view.skin : shown.skin, { detail: loop.cost > 5 ? 0 : 1, label: view.guest ? view.label : "", name: shown?.name || "" });
    loop.cost = lerp(loop.cost, now() - started, 0.1);
    loop.painted += 1;
  }
  function start() {
    if (loop.running || headless() || typeof requestAnimationFrame !== "function" || !views.size) return;
    if (![...views.values()].some((view) => view.ctx)) return;
    loop.running = true;
    for (const view of views.values()) view.canvas.hidden = false;
    loop.last = 0;
    schedule();
  }
  function stop() {
    loop.running = false;
    if (loop.raf) cancelAnimationFrame(loop.raf);
    if (loop.timer) clearTimeout(loop.timer);
    loop.raf = 0; loop.timer = 0;
    for (const view of views.values()) view.canvas.hidden = true;
  }
  // The relay hears which pet this member has (main.cjs hub:pet), so rooms can
  // show it to friends: the saved choice only (a Try is not announced), and
  // only when it changed. hub-client says it again after a reconnect, and
  // says Ember instead to a relay that does not know the pet's kind yet.
  let announced = null;
  function announce() {
    const shown = look();
    const pet = shown.on ? { kind: shown.kind, skin: shown.skin, name: shown.name } : null;
    const key = JSON.stringify(pet);
    if (key === announced || typeof window.mefiStudio?.hubPet !== "function") return;
    announced = key;
    Promise.resolve(window.mefiStudio.hubPet(pet)).catch(() => { announced = null; });
  }
  // The owner's pet is there while it is on; guests while their room is open.
  function sync() {
    if (!borrowed) announce();
    if (headless()) return;
    const shown = look();
    if (shown.on && !views.has("you")) makeView("you", { kind: shown.kind, size: prefs.size });
    else if (shown.on && views.get("you").sim.pet.kind !== shown.kind) reshape(views.get("you"), shown.kind);
    if (!shown.on && views.has("you")) dropView("you");
    const visible = document.visibilityState !== "hidden";
    if (views.size && visible) start(); else stop();
    spinShows();
  }
  function wake() { if (loop.running && !loop.raf && !loop.timer) { loop.last = 0; schedule(); } }
  // Motion is nav.js's html[data-motion], rewritten on every change of the
  // body's classes; only a real change counts. Off sends friends' pets home at
  // once, and On wakes the loop that stopped while every pet slept.
  let motionSeen = null;
  function onMotion() {
    const mode = motionMode();
    if (mode === motionSeen) return;
    motionSeen = mode;
    world.motion = mode;
    if (roomList.length) guests(roomList);
    wake();
    spinShows();
  }

  // ---- friends' pets ------------------------------------------------------------
  // A room's other members' pets (relay "roomPets", through renderer/rooms.js):
  // each new one flies in from an edge and plays with the owner's pet, each
  // one that left flies out again. Only while the owner's own pet is on (one
  // switch for every creature on screen), never with motion off, five at most.
  // A kind this Studio does not know comes as Ember.
  const SKINS_OK = new Set(SKIN_LIST.map((skin) => skin.id));
  let roomList = [];
  function guests(list = roomList) {
    roomList = Array.isArray(list) ? list : [];
    const wanted = new Map();
    if (look().on && motionMode() !== "off" && !headless()) {
      for (const entry of Array.isArray(list) ? list : []) {
        const id = String(entry?.id ?? entry?.userId ?? "");
        const pet = entry?.pet;
        if (!id || id === "you" || !pet || typeof pet !== "object" || wanted.size >= MAX_GUESTS) continue;
        const owner = String(entry.name ?? "").trim().slice(0, 32);
        const name = String(pet.name ?? "").trim().slice(0, 24);
        wanted.set(`guest:${id}`, { kind: KIND[pet.kind] ? pet.kind : "dragon", skin: SKINS_OK.has(pet.skin) ? pet.skin : "theme", label: owner && name ? `${name} · ${owner}` : name || owner });
      }
    }
    for (const [id, view] of views) {
      if (!view.guest || wanted.has(id)) continue;
      // Flies out, unless motion is Off: a guest asleep there could not leave.
      if (loop.running && motionMode() !== "off") view.sim.leave(world); else dropView(id);
    }
    for (const [id, guest] of wanted) {
      const view = views.get(id);
      if (view) {
        view.skin = guest.skin; view.label = guest.label;
        if (view.sim.pet.kind !== guest.kind) reshape(view, guest.kind);
        if (view.sim.pet.mode === "leave") view.sim.enter("wander", world);
        continue;
      }
      makeView(id, { guest: true, ...guest });
    }
    sync();
    return [...views.values()].filter((view) => view.guest && view.sim.pet.mode !== "leave").map((view) => view.id.slice(6));
  }

  // ---- reacting to the studio -------------------------------------------------
  let running = null;
  let inbox = null;
  function react(kind) {
    if (!views.has("you") || !["celebrate", "alert", "wake"].includes(kind)) return false;
    pending = kind;
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
    const next = { ...prefs, names: { ...prefs.names } };
    if (typeof patch.on === "boolean") next.on = patch.on;
    if (KIND[patch.kind]) next.kind = patch.kind;
    if (SKIN_LIST.some((skin) => skin.id === patch.skin)) next.skin = patch.skin;
    if (typeof patch.name === "string") {
      // The name belongs to the pet it was given to: the one named in the patch, else the one on show.
      const kind = KIND[patch.kind] ? patch.kind : look().kind;
      const clean = patch.name.replace(/\s+/g, " ").trim().slice(0, 24);
      if (kind === "dragon") next.name = clean || DEFAULTS.name;
      else if (clean && clean !== KIND[kind].called) next.names[kind] = clean;
      else delete next.names[kind];
    }
    if (typeof patch.calm === "boolean") next.calm = patch.calm;
    if (typeof patch.come === "boolean") next.come = patch.come;
    if (typeof patch.touch === "boolean") next.touch = patch.touch;
    if ([0.8, 1, 1.25].includes(Number(patch.size))) next.size = Number(patch.size);
    prefs = next;
    writeStore();
    if (views.has("you")) views.get("you").sim.pet.size = prefs.size;
    sync();
    if (roomList.length) guests(roomList);
    window.dispatchEvent?.(new CustomEvent("mefi:pet", { detail: state() }));
    return state();
  }
  function state() {
    const shown = look();
    return {
      on: shown.on, kind: shown.kind, skin: shown.skin, name: shown.name, calm: prefs.calm, come: prefs.come, touch: prefs.touch, size: prefs.size,
      chosen: { ...prefs, names: { ...prefs.names } }, preview: Boolean(borrowed),
      // The per-device kill switches, as read at load.
      antics: switches.antics, livePreview: switches.live,
    };
  }
  function preview(choice = {}, ms = 120000) {
    endPreview({ quiet: true });
    const kept = look();
    const kind = KIND[choice.kind] ? choice.kind : kept.kind;
    const skin = SKIN_LIST.some((item) => item.id === choice.skin) ? choice.skin : kept.skin;
    borrowed = { kind, skin, until: Date.now() + Math.max(1000, Math.min(600000, Number(ms) || 120000)) };
    borrowed.timer = setTimeout(() => endPreview(), borrowed.until - Date.now());
    sync();
    react("wake");
    window.dispatchEvent?.(new CustomEvent("mefi:pet", { detail: state() }));
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

  // ---- previews: one frame of a pet, at any size ---------------------------------
  // A calm loop for each kind: Ember and the phoenix circle, the cloud dragon
  // and the wisp swim a figure of eight. `span` is how much room a pet needs
  // at size 1, so a preview fills its canvas small or large.
  const PREVIEW = Object.freeze({
    dragon: { span: 230, path: "ring", rate: 1.1, beats: 8 },
    cloud: { span: 260, path: "eight", rate: 0.8, beats: 6 },
    phoenix: { span: 250, path: "ring", rate: 0.95, beats: 6 },
    wisp: { span: 140, path: "eight", rate: 1.15, beats: 4 },
  });
  const previewed = new WeakMap(); // canvas -> { key, sim, time }: the flight kept between frames
  function previewPath(kind, width, height, scale) {
    const look = PREVIEW[kind];
    const rx = Math.max(24, width * 0.28), ry = Math.max(14, height * 0.2);
    const cx = width / 2, cy = height / 2;
    if (look.path === "eight") return (t) => { const a = t * look.rate; return { x: cx + Math.sin(a) * rx * 1.05, y: cy + Math.sin(a) * Math.cos(a) * ry * 1.6 + Math.sin(a * 2) * 2.5 * scale }; };
    return (t) => { const a = t * look.rate; return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }; };
  }
  function paintPreview(canvas, { kind = "dragon", skin = "theme", time = 0, pose = "fly", size = null } = {}) {
    const ctx = canvas?.getContext?.("2d");
    if (!ctx || !BODIES[kind]) return false;
    const width = canvas.clientWidth || canvas.width, height = canvas.clientHeight || canvas.height;
    const dpr = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const look = PREVIEW[kind];
    const scale = Number(size) > 0 ? Number(size) : clamp(Math.min(width / look.span, height / (look.span * 0.6)), 0.3, 2);
    const t = Number(time) || 0;
    const key = `${kind}|${pose}|${scale}|${width}|${height}`;
    let kept = previewed.get(canvas);
    if (!kept || kept.key !== key || t < kept.time || t - kept.time > 0.5) {
      kept = { key, sim: flight({ seed: 3, size: scale, width, height, kind }), time: null };
      previewed.set(canvas, kept);
    }
    const { sim } = kept;
    const pet = sim.pet;
    const body = shapeOf(kind);
    const cx = width / 2, cy = height / 2;
    if (pose === "rest" || pose === "sleep") {
      if (kept.time === null) { pet.perch = { x: cx, y: cy + body.lift * scale * 0.6 }; sim.settle({ width, height }); }
      pet.mode = pose; pet.clock = t; pet.breathe = t * (pose === "sleep" ? 1.5 : 2.2); pet.flap = t * 1.2; pet.flapAmp = 0.15; pet.fold = 1; pet.speed = 0; pet.look = pose === "rest" ? Math.sin(t * 0.7) * 0.35 : 0;
      pet.sleepy = pose === "sleep" ? 1 : 0;
    } else {
      // The head goes round a slow path and the body trails it: a long first
      // reach lays the whole body along the path, then a frame steps on.
      const path = previewPath(kind, width, height, scale);
      const from = kept.time === null ? t - 4 : kept.time;
      for (let at = from; at <= t + 1e-6; at += 1 / 45) {
        const q = path(at);
        pet.x = q.x; pet.y = q.y;
        pet.spine[0].x = pet.x; pet.spine[0].y = pet.y;
        follow(pet.spine, pet.size, body);
      }
      const ahead = path(t + 0.05), q = path(t);
      pet.mode = "wander"; pet.clock = t; pet.flap = t * look.rate * look.beats; pet.fold = 0; pet.speed = Math.hypot(ahead.x - q.x, ahead.y - q.y) * 20 / Math.max(0.4, scale);
      // A phoenix glides between its wingbeats; the others beat on.
      pet.flapAmp = kind === "phoenix" ? 0.25 + 0.75 * clamp(0.5 + Math.sin(t * look.rate) * 0.9, 0, 1) : 1;
      pet.breathe = t * 2.2;
    }
    kept.time = t;
    pet.particles = previewTrail(kind, pet, t, pose, scale);
    // Centred on the body and the head, whatever pose it ended in, and a
    // little higher than the middle for the shadow under it.
    const head = pet.spine[0], neck = pet.spine[1];
    const facing = Math.atan2(head.y - neck.y, head.x - neck.x);
    const snout = { x: head.x + Math.cos(facing) * body.head * 1.2 * pet.size, y: head.y + Math.sin(facing) * body.head * 1.2 * pet.size };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of [...pet.spine, snout]) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
    const sitting = pose === "rest" || pose === "sleep";
    const shiftX = cx - (minX + maxX) / 2, shiftY = cy - (minY + maxY) / 2 - (sitting ? 2 : 7) * pet.size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, shiftX * dpr, shiftY * dpr);
    paintPet(ctx, pet, skin);
    return true;
  }
  // A preview's trail, made from the clock so every frame agrees with the
  // last: a wisp's sparks, a phoenix's embers, a cloud dragon's puffs, each
  // born at a beat of the clock where the body was then and drifting since.
  function previewTrail(kind, pet, t, pose, scale) {
    const body = shapeOf(kind);
    if (!body.trail) return [];
    const every = pose === "fly" ? body.trail[0] : body.trail[1];
    const life = kind === "wisp" ? 1.3 : kind === "phoenix" ? 0.9 : 1.6;
    const out = [];
    const noise = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
    for (let beat = Math.floor(t / every); beat * every > t - life && out.length < 24; beat -= 1) {
      const age = t - beat * every;
      if (age < 0) continue;
      const r1 = noise(beat), r2 = noise(beat + 0.37), r3 = noise(beat + 0.71);
      // Where it was born: a point of the body, as it is now (the body moves slowly in a preview).
      const at = kind === "wisp" ? pet.spine[2 + Math.floor(r1 * 7)] : kind === "phoenix" ? pet.spine[pet.spine.length - 1 - Math.floor(r1 * 6)] : pet.spine[r1 < 0.5 ? body.shoulder : body.hip];
      const bit = kind === "wisp"
        ? { kind: "drift", vx: (r2 - 0.5) * 18, vy: -10 - r3 * 14, size: (1 + r3 * 1.3) * scale, phase: r2 * TAU }
        : kind === "phoenix" ? { kind: "ember", vx: (r2 - 0.5) * 24, vy: 6 + r3 * 14, size: (1.2 + r3 * 1.6) * scale }
          : { kind: "puff", vx: (r2 - 0.5) * 10, vy: 4 + r3 * 6, size: (3.6 + r3 * 2.6) * scale };
      out.push({ ...bit, x: at.x + (r2 - 0.5) * 8 * scale + bit.vx * age, y: at.y + (r3 - 0.5) * 8 * scale + bit.vy * age, life: life - age, max: life });
    }
    return out;
  }
  // Previews kept moving while they are on screen (Settings' card, the first
  // run): about 30 frames a second, only while seen, the window shows and
  // motion is on; otherwise one still frame. The kill switch keeps them still.
  const shows = { list: new Set(), seen: new Set(), watch: null, raf: 0, last: 0 };
  function showFrame(entry, at) {
    const still = motionMode() === "off" || !switches.live;
    try { paintPreview(entry.canvas, { ...entry.options, time: still ? 0 : at }); } catch { /* the next frame tries again */ }
  }
  function spinShows() {
    if (shows.raf || !shows.seen.size || typeof requestAnimationFrame !== "function") return;
    if (motionMode() === "off" || !switches.live || document.visibilityState === "hidden") { for (const entry of shows.seen) showFrame(entry, 0); return; }
    shows.raf = requestAnimationFrame(showLoop);
  }
  function showLoop(at) {
    shows.raf = 0;
    for (const entry of [...shows.seen]) if (entry.canvas.isConnected === false) { shows.seen.delete(entry); shows.list.delete(entry); shows.watch?.unobserve?.(entry.canvas); }
    if (!shows.seen.size || document.visibilityState === "hidden") return;
    if (motionMode() === "off" || !switches.live) { for (const entry of shows.seen) showFrame(entry, 0); return; }
    if (at - shows.last >= 33) { shows.last = at; for (const entry of shows.seen) showFrame(entry, at / 1000); }
    shows.raf = requestAnimationFrame(showLoop);
  }
  function livePreview(canvas, options = {}) {
    if (!canvas) return null;
    const entry = { canvas, options: { ...options } };
    shows.list.add(entry);
    showFrame(entry, now() / 1000);
    // Without a way to know it is on screen, it stays one still frame.
    if (typeof IntersectionObserver === "function") {
      shows.watch ??= new IntersectionObserver((entries) => {
        for (const seen of entries) {
          const hit = [...shows.list].find((item) => item.canvas === seen.target);
          if (!hit) continue;
          if (seen.isIntersecting) shows.seen.add(hit); else shows.seen.delete(hit);
        }
        spinShows();
      });
      shows.watch.observe(canvas);
    }
    return {
      set(next = {}) { Object.assign(entry.options, next); showFrame(entry, now() / 1000); },
      stop() { shows.list.delete(entry); shows.seen.delete(entry); shows.watch?.unobserve?.(canvas); },
    };
  }

  // ---- Settings › Appearance › Interface: the pet and the menu effect ---------
  // One card for the pet and the menu effect: which pet (the Shop's ones once
  // owned), its name and colours with a live picture of it, how it behaves,
  // and what the Shop has that is not owned yet, with its two-minute Try.
  // Nothing here sells anything.
  const SHOP = (view) => () => { if (window.MefiShop?.open) window.MefiShop.open(view); else window.MefiNav?.go?.("friends", { place: "shop" }); };
  let card = null;
  let cardShow = null;
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  // A switch and its words (a string, or a span kept to rename it later).
  function switchRow(words, on, change, disabled = false) {
    const label = el("label", "switch");
    const input = el("input"); input.type = "checkbox"; input.checked = Boolean(on); input.disabled = disabled;
    input.addEventListener("change", () => change(input.checked));
    label.append(input, el("span", "track"), typeof words === "string" ? el("span", "", words) : words);
    return label;
  }
  // A control with its own visible name above it.
  function labelled(text, control, id) {
    const label = el("label", "settings-flair-pick");
    control.id = id;
    label.htmlFor = id;
    label.append(el("span", "field-label", text), control);
    return label;
  }
  const lineFor = (name, kind) => `${name} the ${kind.noun} ${kind.moves} around the studio`;
  function paintCard({ focus = null } = {}) {
    if (!card) return;
    const body = card.querySelector(".settings-flair-body");
    const shown = state();
    const kind = KIND[shown.kind] || KIND.dragon;
    const rows = [];
    const save = fromCard((patch) => set(patch));
    // The pet: a live picture of it, which one, its name and its colours.
    const pet = el("div", "field settings-flair-pet");
    const stage = el("canvas", "settings-flair-preview");
    stage.setAttribute("role", "img");
    stage.setAttribute("aria-label", `${shown.name} the ${kind.noun}`);
    const picks = el("div", "settings-flair-picks");
    const kinds = el("select");
    for (const item of KINDS) {
      const option = el("option", "", owns(item.item) ? item.name : `${item.name} (in the Shop)`);
      option.value = item.id; option.disabled = !owns(item.item);
      kinds.append(option);
    }
    kinds.value = shown.kind;
    kinds.addEventListener("change", () => { save({ kind: kinds.value }); paintCard({ focus: "settings-pet-kind" }); });
    const name = el("input", "settings-flair-name"); name.type = "text"; name.maxLength = 24; name.value = shown.name; name.autocomplete = "off";
    const switchWords = el("span", "", lineFor(shown.name, kind));
    const hint = el("span", "field-hint", `Rest the pointer on ${shown.name} to pet it. Circle the pointer quickly near it to play chase.`);
    name.addEventListener("change", () => {
      const saved = save({ name: name.value });
      name.value = saved.name;
      switchWords.textContent = lineFor(saved.name, kind);
      hint.textContent = `Rest the pointer on ${saved.name} to pet it. Circle the pointer quickly near it to play chase.`;
      stage.setAttribute("aria-label", `${saved.name} the ${kind.noun}`);
    });
    const skins = el("select");
    for (const skin of SKIN_LIST) {
      const option = el("option", "", owns(skin.item) ? skin.name : `${skin.name} (in the Shop)`);
      option.value = skin.id; option.disabled = !owns(skin.item);
      skins.append(option);
    }
    skins.value = shown.skin;
    skins.addEventListener("change", () => { save({ skin: skins.value }); cardShow?.set({ skin: state().skin }); });
    picks.append(labelled("Pet", kinds, "settings-pet-kind"), labelled("Name", name, "settings-pet-name"), labelled("Colours", skins, "settings-pet-skin"));
    pet.append(stage, picks);
    pet.append(switchRow(switchWords, prefs.on, (on) => save({ on })));
    pet.append(switchRow("Stays on its perch while you type", prefs.calm, (calm) => save({ calm })));
    pet.append(switchRow("Comes to tell you when something needs you", prefs.come, (come) => save({ come })));
    pet.append(switchRow("Plays with your pointer", prefs.touch, (touch) => save({ touch })), hint);
    // What is not owned yet: a Try and the way to the Shop.
    const missingPet = KINDS.find((item) => item.item && !owns(item.item));
    const missingSkin = SKIN_LIST.find((skin) => skin.item && !owns(skin.item));
    if (missingPet || missingSkin) {
      const line = el("div", "settings-you-row settings-flair-row");
      if (missingPet) {
        const tryPet = el("button", "ghost mini", "Try a pet for 2 minutes"); tryPet.type = "button";
        tryPet.addEventListener("click", () => preview({ kind: missingPet.id }));
        line.append(tryPet);
      }
      if (missingSkin) {
        const trySkin = el("button", "ghost mini", "Try a skin for 2 minutes"); trySkin.type = "button";
        trySkin.addEventListener("click", () => preview({ skin: missingSkin.id }));
        line.append(trySkin);
      }
      const get = el("button", "ghost mini", "More pets and skins in the Shop"); get.type = "button";
      get.addEventListener("click", SHOP("studio"));
      line.append(get);
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
    // The picture: a still frame now, moving while the card is on screen.
    cardShow?.stop();
    cardShow = livePreview(stage, { kind: shown.kind, skin: shown.skin });
    if (focus) document.getElementById?.(focus)?.focus?.({ preventScroll: true });
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
    words.append(el("h3", "", "Pet and menu effects"), el("p", "muted", "Ember comes with every Studio. More pets, skins and menu effects are in the Shop: try any for two minutes first."));
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
    window.addEventListener("resize", () => { for (const view of views.values()) sizeCanvas(view); readPage(); });
    document.addEventListener("visibilitychange", () => { sync(); spinShows(); });
    window.addEventListener("focus", wake);
    motionSeen = motionMode();
    if (typeof MutationObserver === "function" && document.documentElement) {
      new MutationObserver(onMotion).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    }
    window.addEventListener("mefi:nav-badges", onBadges);
    window.addEventListener("mefi:inbox", onInbox);
    window.addEventListener("mefi-shop-owned", sync);
    // The theme skin follows the theme.
    window.addEventListener("mefi-theme-change", () => {
      themeCache = null;
      if (loop.running) for (const view of views.values()) paint(view);
      for (const entry of shows.list) showFrame(entry, now() / 1000);
    });
    sync();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else setTimeout(init, 0);

  window.MefiPets = {
    kinds: () => KINDS.map((kind) => ({ ...kind })),
    skins: () => SKIN_LIST.map((skin) => ({ ...skin })),
    state, set, preview, endPreview, react, paintPreview, livePreview, guests,
    // The pets on screen now: whose, what kind and what each is doing.
    flying: () => [...views.values()].map((view) => ({ id: view.id, kind: view.sim.pet.kind, mode: view.sim.pet.mode, guest: view.guest, x: view.sim.pet.x, y: view.sim.pet.y })),
    // For tests and the Shop: a pet's flight to step without the page.
    simulate: (options) => flight(options),
    paint: (ctx, pet, skin, options) => paintPet(ctx, pet, skin, options),
  };
})();
