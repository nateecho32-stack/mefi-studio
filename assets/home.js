/* Mefi Studio website — Home. The gate (Try the app, or Skip to the site), the
   hero's orb and the friends around it, the window of real screens, the pinned
   walkthrough, the two modes, the permission dial, the theme gallery, this
   week's Build Jam and the co-work hours (worked out the way the relay does,
   relay/src/events.mjs, with no request) and the last call. The playable demo
   itself is assets/play.js. Each part starts on its own, so one failing leaves
   the rest working, and the page reads fine with reduced motion or no script. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var still = function () { return reduce.matches; };
  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };
  var SEEN = "mefiSite.gate.v1", IDEA = "mefiSite.idea.v1";
  var store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  function safely(name, fn) { try { fn(); } catch (e) { if (window.console) console.warn("Home: " + name + " did not start.", e); } }
  function visible(node, cb, margin) {
    if (!("IntersectionObserver" in window)) { cb(true); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { cb(e.isIntersecting); }); }, { rootMargin: margin || "0px" }).observe(node);
  }

  // =========================================================================
  // The orbs
  // =========================================================================
  var heroOrb = null, heroHost = $("#hero-orb"), orbFriends = 0;
  function mountOrbs() {
    if (!window.MefiOrb) return;
    if (heroHost) {
      heroOrb = window.MefiOrb.mount(heroHost, { friends: 0, seed: 4 });
      if (heroOrb) heroHost.classList.add("has-gl");
      else $(".hero-stage").classList.add("orb-static");
    }
    var fin = $("#final-orb");
    if (fin) { var f = window.MefiOrb.mount(fin, { friends: 1, seed: 31, speed: 0.8 }); if (f) fin.classList.add("has-gl"); }
  }

  // Name chips beside the friends' orbs, on their outer side, following them round.
  function friendChips() {
    var stage = $(".hero-stage"), chips = $$(".orb-friend");
    if (!heroOrb || !stage || !chips.length) return;
    var sizes = chips.map(function () { return null; });
    heroOrb.onFrame(function (orb) {
      var sw = stage.clientWidth, sh = stage.clientHeight;
      if (!sw || heroHost.classList.contains("orb-up")) return;
      var ox = heroHost.offsetLeft, oy = heroHost.offsetTop, hw = heroHost.clientWidth;
      chips.forEach(function (chip, i) {
        if (!sizes[i] || !sizes[i][0]) sizes[i] = [chip.offsetWidth, chip.offsetHeight];
        var f = orb.friend(i), w = sizes[i][0], h = sizes[i][1], gap = hw * 0.06 + 8;
        var x = f.x >= hw / 2 ? ox + f.x + gap : ox + f.x - gap - w, y = oy + f.y - h / 2;
        if (x + w > sw - 4) x = ox + f.x - gap - w; else if (x < 4) x = ox + f.x + gap;
        x = Math.max(4, Math.min(sw - w - 4, x));
        y = Math.max(4, Math.min(sh - h - 4, y));
        chip.style.setProperty("--fx", x.toFixed(1) + "px");
        chip.style.setProperty("--fy", y.toFixed(1) + "px");
        chip.style.setProperty("--fo", (f.behind || f.merged || orbFriends < 0.6) ? "0" : "1");
      });
    });
  }
  function friendsArrive() {
    if (!heroOrb) return;
    heroOrb.setFriends(1);
    var t0 = performance.now();
    (function ramp() { orbFriends = Math.min(1, (performance.now() - t0) / 1600); if (orbFriends < 1) requestAnimationFrame(ramp); })();
  }

  // The orb stays laid out in the hero; to sit somewhere else it is moved there with a transform (FLIP).
  function orbTo(slot) {
    if (!heroHost || !slot) return;
    heroHost.classList.add("orb-up");
    heroHost.style.transition = "none";
    heroHost.style.transform = "";
    var h = heroHost.getBoundingClientRect(), s = slot.getBoundingClientRect();
    if (!h.width || !s.width) return;
    var k = s.width / h.width;
    var dx = (s.left + s.width / 2) - (h.left + h.width / 2), dy = (s.top + s.height / 2) - (h.top + h.height / 2);
    heroHost.style.transform = "translate3d(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px,0) scale(" + k.toFixed(4) + ")";
  }
  function orbHome(ms) {
    if (!heroHost) return;
    heroHost.style.transition = ms ? "transform " + ms + "ms cubic-bezier(.65,0,.35,1)" : "none";
    heroHost.style.transform = "";
    setTimeout(function () { heroHost.classList.remove("orb-up"); heroHost.style.transition = ""; }, ms + 40);
  }

  // =========================================================================
  // The hero arrives
  // =========================================================================
  var heroStarted = false;
  function heroGo() {
    if (heroStarted) return;
    heroStarted = true;
    var hero = $("#hero");
    if (hero) hero.classList.add("hero-go");
    var t = $("#hero-title");
    if (t) setTimeout(function () { t.classList.add("in"); }, 120);
    setTimeout(friendsArrive, 900);
    $$("[data-play-demo]").forEach(function (b) { b.hidden = false; });
  }

  // =========================================================================
  // The gate, and the demo it opens
  // =========================================================================
  var gate = $("#gate");
  function setInert(on, except) {
    var nodes = $$(".site-head, .site-foot, .skip-link").concat($$("main > *").filter(function (n) { return n !== except; }));
    nodes.forEach(function (n) { if (on) n.setAttribute("inert", ""); else n.removeAttribute("inert"); });
  }
  function lock(on) { root.classList.toggle("page-lock", on); }
  // A circle opens from a point and shows the page under the overlay.
  function openHole(overlay, from, ms, done) {
    var x = window.innerWidth / 2, y = window.innerHeight / 2;
    if (from && from.getBoundingClientRect) { var b = from.getBoundingClientRect(); if (b.width) { x = b.left + b.width / 2; y = b.top + b.height / 2; } }
    var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    overlay.style.setProperty("--hx", x.toFixed(0) + "px");
    overlay.style.setProperty("--hy", y.toFixed(0) + "px");
    overlay.style.setProperty("--hole-max", Math.ceil(r + 40) + "px");
    if (still()) { done(); return; }
    overlay.classList.add("opening");
    setTimeout(done, ms);
  }

  function startGate() {
    if (!gate) return false;
    root.classList.add("gate-ready");
    gate.classList.add("ready");
    lock(true);
    setInert(true, gate);
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    var slot = $("#gate-orb-slot");
    if (heroOrb) { gate.classList.add("has-orb"); orbTo(slot); heroOrb.setFriends(1); orbFriends = 0; }
    var replace = function () { if (gate.classList.contains("ready") && !gate.classList.contains("gone") && heroHost && heroHost.classList.contains("orb-up")) orbTo(slot); };
    window.addEventListener("resize", replace);
    window.addEventListener("load", replace);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(replace);
    // The app opens out of the orb.
    $("#gate-play").addEventListener("click", function () { playDemo(slot, true); });
    $("#gate-skip").addEventListener("click", function (e) { skipGate(e.currentTarget); });
    gate.addEventListener("keydown", function (e) { if (e.key === "Escape") skipGate($("#gate-skip")); });
    setTimeout(function () { try { $("#gate-play").focus({ preventScroll: true }); } catch (e) { /* old engines */ } }, 80);
    return true;
  }

  function skipGate(from) {
    if (!gate || gate.classList.contains("opening")) return;
    store.set(SEEN, "1");
    orbHome(still() ? 0 : 1250);
    setTimeout(heroGo, still() ? 0 : 160);
    openHole(gate, from, 1180, function () {
      gate.classList.add("gone");
      lock(false); setInert(false);
      var t = $("#hero-title"); if (t) t.focus({ preventScroll: true });
    });
  }

  var demoOpen = false;
  function playDemo(from, fromGate) {
    if (demoOpen || !window.MefiPlay) return;
    demoOpen = true;
    store.set(SEEN, "1");
    lock(true);
    setInert(true);
    var app = window.MefiPlay.open({ from: from, onLeave: function (info) { leaveDemo(app, info, fromGate); } });
    if (!app) { demoOpen = false; lock(false); setInert(false); return; }
    // Once the app covers everything, the gate and the orb can rest behind it.
    setTimeout(function () {
      if (fromGate && gate) gate.classList.add("gone");
      if (heroOrb) { orbHome(0); heroOrb.hold(true); }
    }, still() ? 0 : 1100);
  }

  function leaveDemo(app, info, fromGate) {
    if (info && info.lead) { store.set(IDEA, JSON.stringify({ key: info.idea, lead: info.lead })); personalise(); }
    if (heroOrb) heroOrb.hold(false);
    if (fromGate) { orbHome(0); setTimeout(heroGo, still() ? 0 : 200); }
    app.classList.add("leaving");
    openHole(app, info && info.from, 1150, function () {
      app.close();
      demoOpen = false;
      lock(false); setInert(false);
      if (gate) gate.classList.add("gone");
      if (fromGate) { var t = $("#hero-title"); if (t) t.focus({ preventScroll: true }); }
    });
  }

  // The last call names what the visitor built in the demo.
  function personalise() {
    var saved = null;
    try { saved = JSON.parse(store.get(IDEA) || "null"); } catch (e) { saved = null; }
    if (!saved || !saved.lead) return;
    var title = $("#final-title");
    if (!title) return;
    title.textContent = "";
    title.appendChild(document.createTextNode("Ready to build "));
    var g = document.createElement("span"); g.className = "grad"; g.textContent = saved.lead + " for real?";
    title.appendChild(g);
    title.classList.remove("split-done", "in");
    if (window.MefiFx) { window.MefiFx.split(title.parentNode); window.MefiFx.reveal(title.parentNode); }
    var lede = $("#final-lede");
    if (lede) lede.textContent = "Download Studio, open a folder and say what you want. This time real builders do the work, and your friends are right there with you.";
  }

  // =========================================================================
  // The room: a made-up evening in a hangout, played on a loop while it is on
  // screen. Each step waits, then adds a line, a typing dot, an event, the
  // shared project or a change to the side panel.
  // =========================================================================
  var HUE = { Maxwell: 146, Juno: 268, Rook: 32, Tess: 330 };
  // Rooms are plain text with @mentions; your own build sits beside the chat, as on Social's Home, and a
  // play of your project arrives as a pop-up. (No cards are posted into rooms, and there is no voice.)
  var ROOM = [
    { wait: 500, say: ["Maxwell", "anyone around tonight?"] },
    { wait: 1300, type: "Juno", say: ["Juno", "here! fighting my tileset again"] },
    { wait: 1300, type: "Rook", say: ["Rook", "putting some music on for us"] },
    { wait: 700, listen: true },
    { wait: 1500, say: ["You", "what if the jam had a snack list"] },
    { wait: 1300, type: "Tess", say: ["Tess", "do it, I'll bring lemonade"] },
    { wait: 900, build: 0.12, step: 0, note: "Your project · 3 builders working" },
    { wait: 1300, build: 0.5, step: 1 },
    { wait: 1200, type: "Maxwell", say: ["Maxwell", "wait, you're building it right now?"] },
    { wait: 1300, build: 1, step: 3, note: "Checks passed · you accepted it" },
    { wait: 1100, note: "On the Project hub · ready to play" },
    { wait: 700, say: ["You", "@Maxwell it's on the Project hub, add your snacks"] },
    { wait: 1600, type: "Maxwell", say: ["Maxwell", "added chips. this is great"] },
    { wait: 1300, pop: ["Maxwell played Snack list", "+5 credits for you, +2 for Maxwell"] },
    { wait: 5000, reset: true }
  ];
  function room() {
    var sec = $("#room");
    if (!sec) return;
    var chat = $("#rm-chat", sec), now = $("#rm-now", sec), build = $("#rm-build", sec), stage = $(".rm-stage", sec), pop = $("#rm-pop", sec);
    var bar = build && $(".rm-bar i", build), steps = build ? $$(".rm-steps li", build) : [], say = $("#rm-build-say", sec), sayFirst = say ? say.textContent : "";
    var at = 0, timer = 0, popTimer = 0, running = false, minute = 41;
    function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function av(name) { var a = el("i", "av", name[0]); if (HUE[name] != null) a.style.setProperty("--h", String(HUE[name])); return a; }
    function add(node) {
      chat.appendChild(node);
      var rows = Array.prototype.filter.call(chat.children, function (c) { return !c.classList.contains("gone"); });
      if (rows.length > 7) rows.slice(0, rows.length - 7).forEach(function (c) { c.classList.add("gone"); setTimeout(function () { c.remove(); }, 450); });
    }
    function line(who, text) {
      var row = el("div", "rm-msg" + (who === "You" ? " me" : ""));
      row.appendChild(av(who));
      var p = el("p"); p.appendChild(el("b", "", who)); p.appendChild(el("time", "", "8:" + (minute++) + " PM"));
      var body = el("span");
      text.split(/(@\w+)/).forEach(function (part) { if (part) body.appendChild(part[0] === "@" ? el("em", "at", part) : document.createTextNode(part)); });
      p.appendChild(body);
      row.appendChild(p);
      add(row);
    }
    function typing(who) { var t = el("div", "rm-typing"); t.appendChild(av(who)); var s = el("span"); s.innerHTML = "<i></i><i></i><i></i>"; t.appendChild(s); add(t); return t; }
    function setBuild(v, step) {
      if (!build) return;
      build.classList.toggle("idle", v === 0);
      if (bar) bar.style.setProperty("--v", String(v));
      steps.forEach(function (li, i) { li.className = i < step || v >= 1 ? "done" : i === step ? "run" : ""; });
    }
    function popUp(title, sub) {
      if (!pop) return;
      $("b", pop).textContent = title; $("small", pop).textContent = sub;
      pop.classList.add("on");
      clearTimeout(popTimer);
      if (!still()) popTimer = setTimeout(function () { pop.classList.remove("on"); }, 3800);
    }
    function reset() {
      Array.prototype.forEach.call(chat.children, function (c) { c.classList.add("gone"); });
      setTimeout(function () { chat.textContent = ""; }, 460);
      if (now) now.classList.remove("on");
      if (pop) pop.classList.remove("on");
      if (say) say.textContent = sayFirst;
      setBuild(0, -1);
      minute = 41;
    }
    function apply(s) {
      if (s.reset) { reset(); return; }
      if (s.listen && now) now.classList.add("on");
      if (s.build != null) setBuild(s.build, s.step);
      if (s.note && say) say.textContent = s.note;
      if (s.say) line(s.say[0], s.say[1]);
      if (s.pop) popUp(s.pop[0], s.pop[1]);
    }
    function next() {
      if (!running) return;
      var s = ROOM[at];
      at = (at + 1) % ROOM.length;
      if (s.type) {
        var t = typing(s.type);
        timer = setTimeout(function () { t.remove(); apply(s); timer = setTimeout(next, (ROOM[at] || {}).wait || 800); }, 900);
        return;
      }
      apply(s);
      timer = setTimeout(next, ROOM[at].wait || 800);
    }
    // Still: the evening as it stands near the end, all at once.
    if (still()) {
      ROOM.forEach(function (s) { if (!s.reset) apply(s); });
      return;
    }
    function go(on) {
      if (on === running) return;
      running = on;
      clearTimeout(timer);
      if (on) timer = setTimeout(next, at === 0 ? ROOM[0].wait : 400);
    }
    stage.addEventListener("playing", function () { go(!document.hidden); });
    stage.addEventListener("paused", function () { go(false); });
    document.addEventListener("visibilitychange", function () { go(!document.hidden && stage.classList.contains("playing")); });
  }

  // =========================================================================
  // The window of real screens
  // =========================================================================
  function showcase() {
    var sec = $("#look");
    if (!sec) return;
    var tabs = $$(".win-tabs [role='tab']", sec), shots = $$(".win-shot", sec), title = $("[data-win-title]", sec);
    var names = ["The Lobby", "Rooms · Friday jam", "Social · Today", "Studio · Sessions"];
    var current = 0, manual = still();
    if (manual) sec.classList.add("manual");
    function show(i, focus) {
      current = i;
      tabs.forEach(function (t, k) { var on = k === i; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
      shots.forEach(function (s, k) { s.classList.toggle("is-on", k === i); });
      if (title) title.textContent = names[i] || "";
      var next = shots[(i + 1) % shots.length];
      if (next && next.loading === "lazy") next.loading = "eager";
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) { t.addEventListener("click", function () { manual = true; sec.classList.add("manual"); show(i); }); });
    $(".win-tabs", sec).addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault(); manual = true; sec.classList.add("manual");
      show((current + d + tabs.length) % tabs.length, true);
    });
    sec.addEventListener("animationend", function (e) { if (e.animationName === "tab-fill" && !manual && !still()) show((current + 1) % tabs.length); });
    visible(sec, function (on) { sec.classList.toggle("paused", !on); }, "-10% 0px");
    var stage = $(".show-stage", sec);
    stage.addEventListener("pointerenter", function () { sec.classList.add("hover", "paused"); });
    stage.addEventListener("pointerleave", function () { sec.classList.remove("hover", "paused"); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) sec.classList.add("paused"); else if (!sec.classList.contains("hover")) sec.classList.remove("paused"); });
    show(0);
  }

  // =========================================================================
  // The walkthrough (pinned; the beat follows the scroll)
  // =========================================================================
  function journey() {
    var sec = $("#how"), app = $("#jn-app"), fit = sec && $(".jn-fit", sec);
    if (!sec || !app || !fit) return;
    var steps = $$(".jn-steps li", sec), typed = $("#jn-typed");
    var TEXT = "A game-night page with the time, the place and an RSVP button";
    var COUNTS = [[0, 0, 0], [0, 0, 0], [0, 3, 0], [1, 3, 0], [0, 0, 1], [0, 0, 1]];
    var beat = -1, typer = null, press = null;
    function fitNow() { app.style.setProperty("--fit", (fit.clientWidth / 960).toFixed(4)); }
    if (window.ResizeObserver) new ResizeObserver(fitNow).observe(fit);
    window.addEventListener("resize", fitNow);
    fitNow();
    function stopTyping() { clearInterval(typer); typer = null; clearTimeout(press); }
    function typeIt() {
      stopTyping();
      typed.textContent = "";
      if (still()) { typed.textContent = TEXT; app.classList.add("pressed"); return; }
      var i = 0;
      typer = setInterval(function () {
        i += 1;
        typed.textContent = TEXT.slice(0, i);
        if (i >= TEXT.length) { clearInterval(typer); typer = null; press = setTimeout(function () { if (beat === 1) app.classList.add("pressed"); }, 380); }
      }, 26);
    }
    function setBeat(b) {
      if (b === beat) return;
      beat = b;
      app.dataset.beat = String(b);
      app.classList.remove("pressed");
      steps.forEach(function (li, i) { li.classList.toggle("is-on", i === b); li.classList.toggle("is-past", i < b); });
      var c = COUNTS[b] || COUNTS[0];
      $(".n-need", app).textContent = String(c[0]);
      $(".n-run", app).textContent = String(c[1]);
      $(".n-done", app).textContent = String(c[2]);
      if (b === 1) typeIt(); else { stopTyping(); typed.textContent = ""; }
    }
    setBeat(0);
    if (!still()) sec.addEventListener("scene", function (e) { setBeat(Math.max(0, Math.min(5, Math.floor(e.detail.p * 6)))); });
    steps.forEach(function (li, i) {
      li.addEventListener("click", function () {
        if (still()) { setBeat(i); return; }
        var top = sec.getBoundingClientRect().top + window.scrollY, span = sec.offsetHeight - window.innerHeight;
        window.scrollTo({ top: top + span * ((i + 0.5) / 6), behavior: "smooth" });
      });
    });
  }

  // =========================================================================
  // Social | Studio
  // =========================================================================
  function modes() {
    var sec = $("#modes");
    if (!sec) return;
    var tabs = $$(".mode-switch [role='tab']", sec), panel = $("#mode-panel");
    var mode = "social", auto = !still(), timer = null, onScreen = false;
    function set(m, focus) {
      mode = m;
      sec.dataset.mode = m;
      if (panel) panel.dataset.mode = m;
      tabs.forEach(function (t) { var on = t.dataset.mode === m; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    }
    function loop() {
      clearTimeout(timer);
      if (!auto || !onScreen || document.hidden) return;
      timer = setTimeout(function () { set(mode === "social" ? "studio" : "social"); loop(); }, 5200);
    }
    tabs.forEach(function (t) { t.addEventListener("click", function () { auto = false; clearTimeout(timer); set(t.dataset.mode); }); });
    $(".mode-switch", sec).addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault(); auto = false; clearTimeout(timer);
      set(mode === "social" ? "studio" : "social", true);
    });
    visible(sec, function (on) { onScreen = on; loop(); }, "-15% 0px");
    document.addEventListener("visibilitychange", loop);
    set("social");
  }

  // =========================================================================
  // The permission dial in Studio's cards
  // =========================================================================
  function dial() {
    var d = $("#perm-dial");
    if (!d || still()) return;
    var stop = 2, timer = null, on = false;
    function step() {
      clearTimeout(timer);
      if (!on || document.hidden) return;
      timer = setTimeout(function () { stop = (stop + 1) % 4; d.dataset.stop = String(stop); step(); }, 2600);
    }
    visible(d, function (v) { on = v; step(); });
    document.addEventListener("visibilitychange", step);
  }

  // =========================================================================
  // Twelve looks
  // =========================================================================
  function themes() {
    var T = window.MefiTheme, Fx = window.MefiFx, screens = $("#theme-screens");
    if (!T || !Fx || !screens) return;
    var plain = T.order.filter(function (id) { return !T.themes[id].collection; });
    var duo = T.order.filter(function (id) { return T.themes[id].collection === "void"; });
    $("#theme-plain").appendChild(Fx.buildSwatches(plain));
    $("#theme-void").appendChild(Fx.buildSwatches(duo));
    var shots = { chrome: $(".theme-shot", screens) };
    function img(id) {
      if (shots[id]) return shots[id];
      var n = new Image();
      n.className = "theme-shot"; n.decoding = "async"; n.width = 1440; n.height = 810;
      n.alt = "Studio's Today in the " + T.themes[id].name + " theme.";
      n.src = "assets/shots/site/theme-" + id + ".webp";
      screens.appendChild(n);
      shots[id] = n;
      return n;
    }
    function show(id) {
      var n = img(id), name = T.themes[id].name;
      var on = function () { Object.keys(shots).forEach(function (k) { shots[k].classList.toggle("is-on", shots[k] === n); }); };
      if (n.complete && n.naturalWidth) on(); else n.addEventListener("load", on, { once: true });
      $("#theme-name").textContent = name;
      $("#theme-win-name").textContent = name;
    }
    $$(".theme-picker .swatch").forEach(function (b) { b.addEventListener("pointerenter", function () { img(b.dataset.themeId); }, { passive: true }); });
    T.onChange(function (id) { show(id); });
    show(T.current());
  }

  // =========================================================================
  // This week's Build Jam and the co-work hours (relay/src/events.mjs)
  // =========================================================================
  var JAM_THEMES = [
    "One button", "Tiny worlds", "Night shift", "Echoes", "Gravity is optional", "Made of paper", "Lost and found",
    "Only one room", "Weather", "Machines with feelings", "Upside down", "Glow", "Something is following you",
    "Build it twice", "Shapes", "Time loop", "Under the sea", "Small sounds", "The last level", "Garden",
    "Signals", "Collect them all", "Fix it", "Mirror", "Fast and slow", "Home", "Out of order", "Friends",
    "Leftovers", "The map is wrong"
  ];
  var HOUR = 3600000, DAY = 24 * HOUR, WEEK = 7 * DAY, FIRST_MONDAY = Date.UTC(1970, 0, 5), COWORK_HOURS = [2, 10, 18];
  function when(ms, withDay) {
    var o = { hour: "numeric", minute: "2-digit" };
    if (withDay) o.weekday = "long";
    return new Date(ms).toLocaleString([], o);
  }
  function jam() {
    var themeEl = $("#jam-theme");
    if (!themeEl) return;
    function paint() {
      var now = Date.now(), week = Math.floor((now - FIRST_MONDAY) / WEEK);
      var start = FIRST_MONDAY + week * WEEK, entriesUntil = start + 5 * DAY, end = start + WEEK;
      var at = function (w) { return JAM_THEMES[((w % JAM_THEMES.length) + JAM_THEMES.length) % JAM_THEMES.length]; };
      themeEl.textContent = at(week);
      $$("[data-jam-theme]").forEach(function (n) { n.textContent = at(week); });
      $("#jam-phase").textContent = now < entriesUntil
        ? "Entries are open until " + when(entriesUntil, true) + " your time. Then everyone plays and votes until " + when(end, true) + ". Next week: " + at(week + 1) + "."
        : "Voting is open until " + when(end, true) + " your time: play the entries, then vote for your favourites. Next week: " + at(week + 1) + ".";
      var nowDot = $("#jam-now");
      if (nowDot) nowDot.style.setProperty("--now", (((now - start) / WEEK) * 100).toFixed(2) + "%");
      var list = $("#cowork-times"), big = $("#cowork-next");
      if (!list || !big) return;
      var day0 = Math.floor(now / DAY) * DAY, slots = [];
      for (var d = -1; d <= 2; d++) COWORK_HOURS.forEach(function (h) { var s = day0 + d * DAY + h * HOUR; if (s + HOUR > now) slots.push(s); });
      slots.sort(function (a, b) { return a - b; });
      slots = slots.slice(0, 3);
      list.innerHTML = "";
      var today = new Date(now).toDateString();
      slots.forEach(function (s, i) {
        var li = document.createElement("li"), dt = new Date(s);
        var t = dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        li.textContent = s <= now ? "Now · until " + when(s + HOUR) : dt.toDateString() === today ? t : dt.toLocaleDateString([], { weekday: "short" }) + " " + t;
        if (i === 0) li.className = "next";
        list.appendChild(li);
      });
      var first = slots[0];
      if (first <= now) big.textContent = "On now, until " + when(first + HOUR);
      else { var mins = Math.round((first - now) / 60000), hh = Math.floor(mins / 60), mm = mins % 60; big.textContent = "Next one in " + (hh ? hh + " h " : "") + mm + " min"; }
    }
    paint();
    setInterval(function () { if (!document.hidden) paint(); }, 30000);
  }

  // =========================================================================
  // The last call: the newest zip, straight from GitHub
  // =========================================================================
  function finalCall() {
    var btn = $("#final-download"), label = $("#final-download-label");
    if (!btn || !window.SITE || !window.SITE.fetchLatestRelease) return;
    window.SITE.fetchLatestRelease().then(function (rel) {
      if (!rel || rel.none || !rel.asset || !rel.asset.browser_download_url) return;
      btn.href = rel.asset.browser_download_url;
      if (label) label.textContent = "Download " + (rel.tag || "for Windows");
    }).catch(function () { /* the button keeps pointing at the download page */ });
  }

  // Links to the old Home's sections (the roadmap's "See the screens", posts on Discord) land on the closest new one.
  var OLD_ANCHORS = {
    "first-look": "look", "pillars-title": "look", "flow": "how", "flow-title": "how",
    "community-title": "friends", "tour-title": "studio", "skin-title": "themes", "install-title": "get",
    "rust": "roadmap.html#now", "rust-title": "roadmap.html#now", "roadmap-title": "roadmap.html"
  };
  function oldAnchors() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id || document.getElementById(id)) return;
    var to = OLD_ANCHORS[id] || (/^look-/.test(id) ? "look" : "");
    if (!to) return;
    if (to.indexOf(".html") > 0) { location.replace(to); return; }
    history.replaceState(null, "", "#" + to);
    var el = document.getElementById(to);
    if (el) el.scrollIntoView({ block: "start", behavior: "instant" });
  }

  // =========================================================================
  document.addEventListener("DOMContentLoaded", function () {
    safely("old links", oldAnchors);
    window.addEventListener("hashchange", function () { safely("old links", oldAnchors); });
    safely("orbs", mountOrbs);
    safely("friend chips", friendChips);
    var gated = false;
    safely("gate", function () { if (root.classList.contains("gate-on")) gated = startGate(); });
    if (!gated) { root.classList.remove("gate-on"); if (gate) gate.classList.add("gone"); setTimeout(heroGo, 60); }
    $$("[data-play-demo]").forEach(function (b) { b.addEventListener("click", function () { playDemo(b, false); }); });
    safely("personalise", personalise);
    safely("room", room);
    safely("showcase", showcase);
    safely("walkthrough", journey);
    safely("modes", modes);
    safely("dial", dial);
    safely("themes", themes);
    safely("jam", jam);
    safely("last call", finalCall);
  });
})();
