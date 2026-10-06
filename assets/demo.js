/* Mefi Studio — Home page motion (pairs with demo.css).
   The "works with" marquee, the animated Studio walkthrough, the count-up
   numbers and the theme section. Every piece is optional: without script the
   page shows the same words, just still. */
(function () {
  "use strict";
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---- marquee ------------------------------------------------------------
  // Duplicate the list once so the loop has no seam; the copy is hidden from readers.
  qsa("[data-marquee]").forEach(function (box) {
    var track = qs(".marquee-track", box);
    if (!track || motion.matches) return;
    qsa("li", track).forEach(function (li) {
      var copy = li.cloneNode(true);
      copy.setAttribute("aria-hidden", "true");
      track.appendChild(copy);
    });
    box.classList.add("ready");
  });

  // ---- numbers count up as they scroll into view ----------------------------
  function countUp(el, to) {
    var text = function (n) { return Math.round(n).toLocaleString(); };
    if (motion.matches || !("IntersectionObserver" in window)) { el.textContent = text(to); return; }
    el.textContent = "0";
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      var start = performance.now(), span = 1500;
      (function step(now) {
        var p = Math.min(1, (now - start) / span), eased = 1 - Math.pow(1 - p, 3);
        el.textContent = text(to * eased);
        if (p < 1) requestAnimationFrame(step);
      })(start);
    }, { threshold: 0.6 });
    io.observe(el);
  }
  qsa("[data-count]").forEach(function (el) {
    if (el.closest("[data-live-members]")) return;
    countUp(el, Number(el.dataset.count) || 0);
  });
  var live = qs("[data-live-members]");
  if (live && window.SITE && SITE.fetchDiscordCounts) {
    SITE.fetchDiscordCounts().then(function (c) {
      var num = qs(".num", live);
      live.hidden = false;
      countUp(num, c.members);
    }).catch(function () { /* the stat simply stays hidden */ });
  }

  // ---- theme section --------------------------------------------------------
  (function themeSection() {
    var T = window.MefiTheme, Fx = window.MefiFx;
    var picker = qs("[data-swatches]"), stack = qs("[data-skin-stack]"), cap = qs("[data-skin-cap]");
    if (!T || !Fx || !picker || !stack || !cap) return;
    // Real screenshots of the Map (the live tree, called Command view up to 0.4.4) that exist for these themes.
    var SHOTS = {
      chrome: "assets/shots/thumb-command-chrome.webp",
      aurora: "assets/shots/thumb-command-aurora.webp",
      midnight: "assets/shots/thumb-command-midnight.webp",
      ember: "assets/shots/thumb-command-ember.webp",
      gold: "assets/shots/thumb-command-gold.webp",
      abyss: "assets/shots/thumb-command-abyss.webp",
      dusk: "assets/shots/thumb-command-dusk.webp",
      eclipse: "assets/shots/thumb-command-eclipse.webp"
    };
    var plain = T.order.filter(function (id) { return !T.themes[id].collection; });
    var duo = T.order.filter(function (id) { return T.themes[id].collection === "void"; });
    picker.appendChild(Fx.el("h3", "", "Colour themes"));
    picker.appendChild(Fx.buildSwatches(plain));
    picker.appendChild(Fx.el("h3", "", "The Void collection"));
    picker.appendChild(Fx.buildSwatches(duo));

    function show(id) {
      var name = T.themes[id].name, has = Boolean(SHOTS[id]), used = has ? id : T.defaultId;
      var img = qs("img[data-skin-theme=\"" + used + "\"]", stack);
      if (!img) {
        img = new Image();
        img.decoding = "async";
        img.alt = "The Map (called Command view in 0.4.4) in the " + T.themes[used].name + " theme: tasks and builders drawn as a connected tree, with a Live work panel at the right";
        img.dataset.skinTheme = used;
        img.src = SHOTS[used];
        stack.appendChild(img);
      }
      function on() { qsa("img", stack).forEach(function (i) { i.classList.toggle("on", i === img); }); }
      if (img.complete) on(); else img.addEventListener("load", on, { once: true });
      cap.textContent = "";
      var lead = document.createElement("strong");
      lead.textContent = has ? "The Map in " + name + "." : name + " is on the page around you.";
      cap.appendChild(lead);
      cap.appendChild(document.createTextNode(has
        ? (id === T.defaultId ? " Studio's default theme from 0.5, with sample data." : " A real screenshot from Studio, using sample data.")
        : " This preview stays on " + T.themes[T.defaultId].name + " because the site has no " + name + " screenshot yet."));
    }
    T.onChange(show);
    if (T.current() !== T.defaultId) show(T.current());
  })();

  // ---- the walkthrough ------------------------------------------------------
  var flowRoot = qs("[data-flow]");
  if (flowRoot) initFlow(flowRoot);

  function initFlow(root) {
    var demo = qs(".demo", root), toggle = qs(".flow-toggle", root), tabs = qsa(".flow-tab", root);
    if (!demo || !tabs.length) return;
    // How long each beat plays, which tab a beat belongs to, and each tab's first beat.
    var BEATS = [4800, 4600, 6800, 3800, 3600, 6400];
    var TAB_OF = [0, 1, 2, 3, 3, 4];
    var TAB_FIRST = [0, 1, 2, 3, 5];
    var TAB_MS = tabs.map(function (_, t) { return BEATS.reduce(function (sum, ms, b) { return sum + (TAB_OF[b] === t ? ms : 0); }, 0); });

    // "0:a|2:b" -> one value per beat, holding the last value given.
    function table(str) {
      var given = {}, out = [], cur = "";
      str.split("|").forEach(function (part) { var i = part.indexOf(":"); given[Number(part.slice(0, i))] = part.slice(i + 1); });
      for (var b = 0; b < BEATS.length; b++) { if (given[b] !== undefined) cur = given[b]; out.push(cur); }
      return out;
    }
    var shows = qsa("[data-show]", demo).map(function (el) { var m = /^(\d+)-(\d+)$/.exec(el.dataset.show); return { el: el, from: Number(m[1]), to: Number(m[2]) }; });
    var maps = qsa("[data-map]", demo).map(function (el) { return { el: el, table: table(el.dataset.map) }; });
    var bars = qsa("[data-w]", demo).map(function (el) { return { el: el, table: table(el.dataset.w) }; });
    var typed = qs(".d-typed", demo), typeText = typed.dataset.type || "";
    var send = qs(".d-send", demo), cursor = qs(".d-cursor", demo), ripple = qs(".d-ripple", demo), nbox = qs(".d-nbox", demo), rec = qs(".d-opt.rec", demo);

    var timers = [], beat = 0, playing = false, userPaused = motion.matches, visible = false;
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function clear() { timers.forEach(clearTimeout); timers = []; }
    function setTyped(n) { typed.textContent = typeText.slice(0, n); }

    function apply(b) {
      // The arrow belongs to the decision beat only, whichever way we leave it.
      if (b !== 2) { cursor.classList.remove("on"); rec.classList.remove("hover"); }
      beat = b;
      demo.dataset.beat = String(b);
      demo.dataset.view = b >= 5 ? "cmd" : "vibe";
      shows.forEach(function (s) { s.el.classList.toggle("on", b >= s.from && b <= s.to); });
      maps.forEach(function (m) { var v = m.table[b]; if (m.el.textContent !== v) m.el.textContent = v; });
      bars.forEach(function (x) { var v = x.table[b]; x.el.style.setProperty("--w", (v === "" ? 0 : v) + "%"); });
      tabs.forEach(function (t, i) { if (i === TAB_OF[b]) t.setAttribute("aria-current", "step"); else t.removeAttribute("aria-current"); });
      follow(tabs[TAB_OF[b]]);
    }
    // On a phone the steps sit in a sideways strip: keep the playing one centred.
    var strip = qs(".flow-steps", root);
    function follow(tab) {
      if (!strip || strip.scrollWidth <= strip.clientWidth + 2) return;
      strip.scrollTo({ left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2, behavior: motion.matches ? "auto" : "smooth" });
    }

    function resetNeeds() {
      cursor.classList.remove("on", "jump");
      ripple.classList.remove("go");
      rec.classList.remove("hover", "picked");
      nbox.classList.remove("answered");
    }
    // Where the arrow should rest: over the recommended answer, measured once the card has opened.
    function aim() {
      var d = demo.getBoundingClientRect(), r = rec.getBoundingClientRect();
      return { x: r.left - d.left + r.width * 0.5, y: r.top - d.top + r.height * 0.55, w: d.width, h: d.height };
    }
    function setCursor(x, y) { demo.style.setProperty("--cx", x.toFixed(1) + "px"); demo.style.setProperty("--cy", y.toFixed(1) + "px"); }

    function runDecision() {
      var a = aim();
      cursor.classList.add("jump", "on");
      setCursor(a.w * 0.92, a.h * 0.96);
      void cursor.offsetWidth;
      cursor.classList.remove("jump");
      setCursor(a.x, a.y);
      later(function () { rec.classList.add("hover"); }, 1150);
      later(function () {
        ripple.classList.remove("go"); void ripple.offsetWidth; ripple.classList.add("go");
        rec.classList.remove("hover"); rec.classList.add("picked");
      }, 1500);
      later(function () { nbox.classList.add("answered"); }, 1800);
      later(function () { cursor.classList.remove("on"); }, 2500);
    }

    // The still picture of a beat, for pause, reduced motion and off-screen.
    function settle(b) {
      clear();
      root.classList.remove("run");
      if (b <= 2) resetNeeds();
      setTyped(b === 0 ? typeText.length : 0);
      send.classList.remove("press");
      if (b === 2) {
        later(function () {
          var a = aim();
          rec.classList.add("hover");
          cursor.classList.add("jump", "on");
          setCursor(a.x, a.y);
        }, 700);
      }
    }

    function startRun(t) {
      root.classList.remove("run");
      void root.offsetWidth;
      root.style.setProperty("--dur", TAB_MS[t] + "ms");
      root.classList.add("run");
    }

    function go(b, restartTab) {
      apply(b);
      if (!playing) { settle(b); return; }
      clear();
      if (b <= 2) resetNeeds();
      if (restartTab || TAB_FIRST.indexOf(b) >= 0) startRun(TAB_OF[b]);
      setTyped(0);
      if (b === 0) {
        later(function () {
          var i = 0;
          (function tick() {
            setTyped(++i);
            if (i < typeText.length) later(tick, 34 + Math.random() * 38);
            else later(function () { send.classList.add("press"); later(function () { send.classList.remove("press"); }, 380); }, 380);
          })();
        }, 500);
      } else {
        send.classList.remove("press");
      }
      if (b === 2) later(runDecision, 800);
      later(function () { go((beat + 1) % BEATS.length); }, BEATS[b]);
    }

    function sync() {
      var want = !userPaused && visible && !document.hidden && !motion.matches;
      if (want && !playing) { playing = true; go(TAB_FIRST[TAB_OF[beat]], true); }
      else if (!want && playing) { playing = false; settle(beat); }
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { go(TAB_FIRST[i], true); });
    });
    function paintToggle() {
      toggle.setAttribute("aria-pressed", String(userPaused));
      qs("span", toggle).textContent = userPaused ? "Play" : "Pause";
    }
    if (motion.matches) toggle.hidden = true;
    toggle.addEventListener("click", function () { userPaused = !userPaused; paintToggle(); sync(); });
    paintToggle();

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; sync(); }, { threshold: 0.35 }).observe(root);
    }
    document.addEventListener("visibilitychange", sync);
    if (motion.addEventListener) motion.addEventListener("change", function () { toggle.hidden = motion.matches; sync(); });

    apply(0);
    settle(0);
  }
})();
