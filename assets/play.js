/* Mefi Studio website — "Try the app": a playable, made-up copy of Studio's
   Social mode, opened from Home's gate or its buttons (window.MefiPlay.open).
   The visitor picks or types an idea and presses Build it, three builders
   work on it while a friend chats, one asks a question and the answer changes
   what gets built, the checks pass, the visitor accepts (or reverts) the
   changes, tries what was built and shares it with friends in a room. The
   explaining waits for the end. Every step plays itself after a quiet while,
   Skip and Escape always leave, and nothing is sent anywhere. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var still = function () { return reduce.matches; };
  var NBH = String.fromCharCode(8209); // a hyphen that never breaks a line
  var EASE = "cubic-bezier(.22,1,.36,1)";

  var IDEAS = {
    game: {
      chip: "Game-night page", project: "Game night", lead: "your game" + NBH + "night page",
      text: "A game-night page with the time, the place and an RSVP button",
      tasks: [["Lay out the page", "Claude Code", ["reading the project", "writing index.html", "styling the card"]],
        ["Make the RSVP work", "Codex", ["reading rsvp.js", "wiring up the button", "saving who's going"]],
        ["Write the invite", "OpenCode", ["drafting the text", "adding the date", "checking its work"]]],
      ask: { q: "Should RSVPs close an hour before it starts?", yes: "Yes, an hour before", no: "No, keep them open" },
      files: [["index.html", "+88"], ["rsvp.js", "+41"], ["invite.md", "+12"]],
      share: "Made us a game-night page. RSVP in there!",
      replies: [["Maxwell", 146, "Wait, it's done already? That's actually useful."], ["Tess", 330, "RSVP'd. See you Friday!"], ["Juno", 268, "Can it list snacks too?"]]
    },
    pixel: {
      chip: "Pixel art tool", project: "Pixel pad", lead: "your pixel art tool",
      text: "A pixel art tool with a small canvas, a palette and Save as PNG",
      tasks: [["Draw the canvas", "Claude Code", ["reading the project", "writing canvas.js", "drawing the grid"]],
        ["Add the palette", "Codex", ["reading palette.js", "picking the colours", "testing the picker"]],
        ["Save as PNG", "OpenCode", ["adding the export", "naming the file", "checking its work"]]],
      ask: { q: "Start with a 12 by 12 canvas?", yes: "Yes, 12 by 12", no: "Make it 16 by 16" },
      files: [["canvas.js", "+120"], ["palette.js", "+36"], ["export.js", "+28"]],
      share: "Made a little pixel art tool. Draw something!",
      replies: [["Juno", 268, "Drawing a cat right now."], ["Maxwell", 146, "Could it export sprites for Pixel Forge?"], ["Rook", 32, "Saved my first one. So good."]]
    },
    band: {
      chip: "Our band's site", project: "The Late Shift", lead: "your band's site",
      text: "A site for our band with the next gig, our songs and a play button",
      tasks: [["Build the home page", "Claude Code", ["reading the project", "writing index.html", "setting the type"]],
        ["List the next gig", "Codex", ["reading gigs.json", "adding the date", "linking the venue"]],
        ["Add the player", "OpenCode", ["writing player.js", "adding the songs", "checking its work"]]],
      ask: { q: "Put the next gig above the songs?", yes: "Yes, gig first", no: "Songs first" },
      files: [["index.html", "+94"], ["gigs.json", "+18"], ["player.js", "+52"]],
      share: "Our band site is up. Press play!",
      replies: [["Rook", 32, "The player works!"], ["Tess", 330, "Putting Saturday in my calendar."], ["Maxwell", 146, "Sharing it with everyone."]]
    },
    own: {
      chip: "My own idea", project: "My app", lead: "your idea",
      text: "",
      tasks: [["Sketch the first screen", "Claude Code", ["reading the project", "writing the layout", "styling it"]],
        ["Build the main part", "Codex", ["reading the code", "writing the logic", "wiring it up"]],
        ["Check it works", "OpenCode", ["writing the tests", "running them", "checking its work"]]],
      ask: { q: "Keep it to one screen for now?", yes: "Yes, one screen", no: "Add a second screen" },
      files: [["index.html", "+64"], ["app.js", "+48"], ["style.css", "+30"]],
      share: "Built a first version. Have a look!",
      replies: [["Maxwell", 146, "Okay, that's actually cool."], ["Juno", 268, "What's next for it?"], ["Rook", 32, "Put it on the Project hub!"]]
    }
  };
  var STEPS = ["Idea", "Build", "Decide", "Review", "Try", "Share"];

  // ---- small helpers -------------------------------------------------------
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function avatar(name, hue) { var a = el("i", "av", name[0]); if (hue != null) a.style.setProperty("--h", String(hue)); return a; }
  var SVG = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6Z"/></svg>',
    today: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V20H4Z"/></svg>',
    work: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.2 11 15.8 7M8.2 13l7.6 4"/></svg>',
    friends: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>'
  };

  // ---- the app, as Studio draws it ----------------------------------------------
  function build() {
    var root = el("div", "play");
    root.id = "play";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Mefi Studio, a playable demo");
    root.innerHTML =
      '<div class="pl-app" data-step="0">' +
        '<header class="pl-top">' +
          '<span class="pl-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="pl-seg" aria-hidden="true"><b class="on">' + SVG.spark + 'Social</b><b>Studio</b></span>' +
          '<span class="pl-crumb"><span class="pl-proj">Game night</span><i>/</i><span class="pl-tail">Today</span></span>' +
          '<span class="pl-search" aria-hidden="true">Search or run a command <kbd>Ctrl K</kbd></span>' +
          '<span class="pl-pill need" aria-hidden="true"><i></i><em class="n-need">0</em> need you</span>' +
          '<span class="pl-pill work" aria-hidden="true"><i></i><em class="n-work">0</em> working</span>' +
          '<button type="button" class="pl-skip">Skip to the site' + SVG.close + '</button>' +
        '</header>' +
        '<div class="pl-body">' +
          '<nav class="pl-rail" aria-hidden="true"><i class="on" title="Today">' + SVG.today + '</i><i title="Work">' + SVG.work + '</i><i title="Map">' + SVG.map + '</i><i class="r-friends" title="Friends">' + SVG.friends + '<em class="badge">2</em></i></nav>' +
          '<main class="pl-main">' +
            '<div class="pl-hello"><span class="pl-orb" aria-hidden="true"></span><div><small><span class="pl-greet">Good evening</span> · Social</small><h2>What’s next for <span class="pl-proj">Game night</span>?</h2></div></div>' +
            '<form class="pl-box" autocomplete="off">' +
              '<label class="visually-hidden" for="pl-idea">Your idea</label>' +
              '<textarea id="pl-idea" rows="2" maxlength="120" spellcheck="false" placeholder="Describe an idea, a fix or a question…"></textarea>' +
              '<div class="pl-box-row">' +
                '<div class="pl-ideas" role="group" aria-label="Ideas to try"></div>' +
                '<button type="button" class="pl-talk"><span>Talk it over</span><kbd>Enter</kbd></button>' +
                '<button type="submit" class="pl-build">' + SVG.spark + '<span>Build it</span><kbd>Ctrl Enter</kbd></button>' +
              '</div>' +
            '</form>' +
            '<div class="pl-board">' +
              '<section class="pl-col" data-col="need"><h3>Needs you <em>0</em></h3><div class="pl-list"></div></section>' +
              '<section class="pl-col" data-col="run"><h3>Running <em>0</em></h3><div class="pl-list"></div></section>' +
              '<section class="pl-col" data-col="review"><h3>Review <em>0</em></h3><div class="pl-list"></div></section>' +
              '<section class="pl-col" data-col="done"><h3>Done <em>0</em></h3><div class="pl-list"></div></section>' +
            '</div>' +
          '</main>' +
          '<aside class="pl-side">' +
            '<div class="pl-tabs" role="tablist" aria-label="Panels"><button type="button" role="tab" data-tab="friends" aria-selected="true">Friends<em class="tab-dot"></em></button><button type="button" role="tab" data-tab="changes" aria-selected="false">Changes</button><button type="button" role="tab" data-tab="preview" aria-selected="false">Preview</button><i class="pl-tab-ink" aria-hidden="true"></i></div>' +
            '<div class="pl-panes">' +
              '<section class="pl-pane on" data-pane="friends">' +
                '<p class="pl-k"><i class="dot live"></i>3 online</p>' +
                '<ul class="pl-online"></ul>' +
                '<div class="pl-room"><p class="pl-room-head"><b>Friday game night</b><span>Hangout · 4 here</span></p><div class="pl-chat" aria-live="polite"></div></div>' +
              '</section>' +
              '<section class="pl-pane" data-pane="changes"><p class="pl-k">Changes</p><div class="pl-empty">Nothing changed yet.</div></section>' +
              '<section class="pl-pane" data-pane="preview"><p class="pl-k">Preview</p><div class="pl-empty">Nothing to preview yet.</div></section>' +
            '</div>' +
          '</aside>' +
        '</div>' +
        '<footer class="pl-foot"><ol class="pl-steps" aria-label="Steps"></ol></footer>' +
      '</div>' +
      '<div class="pl-hint" aria-hidden="true"><span></span></div>' +
      '<p class="visually-hidden pl-live" aria-live="polite"></p>';
    var steps = root.querySelector(".pl-steps");
    STEPS.forEach(function (s, i) { var li = el("li", i === 0 ? "on" : "", s); steps.appendChild(li); });
    var online = root.querySelector(".pl-online");
    [["Maxwell", 146, "In Friday game night"], ["Juno", 268, "In the Lobby"], ["Rook", 32, "Listening together"]].forEach(function (f) {
      var li = el("li"); li.appendChild(avatar(f[0], f[1])); var t = el("span"); t.appendChild(el("b", "", f[0])); t.appendChild(el("small", "", f[2])); li.appendChild(t); online.appendChild(li);
    });
    return root;
  }

  // ---- one play-through ----------------------------------------------------
  function open(opts) {
    opts = opts || {};
    if (document.getElementById("play")) return null;
    var root = build();
    var app = root.querySelector(".pl-app");
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
    var token = { alive: true }, timers = [];
    var idea = "game", custom = false, answer = "yes";
    var live = $(".pl-live");
    function say(text) { live.textContent = text; }
    function sleep(ms) { return new Promise(function (r) { timers.push(setTimeout(r, still() ? Math.min(ms, 40) : ms)); }); }
    function alive() { if (!token.alive) throw new Error("left"); }

    // the greeting and the time of day
    var h = new Date().getHours();
    $(".pl-greet").textContent = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";

    // ---- the hint: a pulse on what to press next, with one or two words ----
    var hintEl = $(".pl-hint"), hintTarget = null, hintSide = "above";
    function placeHint() {
      if (!hintTarget) return;
      var r = hintTarget.getBoundingClientRect(), b = hintEl.getBoundingClientRect();
      var below = hintSide === "below" ? r.bottom + b.height + 16 < window.innerHeight : r.top < 90;
      var x = Math.max(8, Math.min(window.innerWidth - b.width - 8, r.left + r.width / 2 - b.width / 2));
      var y = below ? r.bottom + 12 : r.top - b.height - 12;
      hintEl.style.transform = "translate(" + x.toFixed(0) + "px," + y.toFixed(0) + "px)";
      hintEl.classList.toggle("below", below);
    }
    // The hint follows its target while cards glide about.
    var hintRaf = 0;
    function follow() { placeHint(); hintRaf = requestAnimationFrame(follow); }
    function hint(target, label, side) {
      if (hintTarget) hintTarget.classList.remove("pl-target");
      cancelAnimationFrame(hintRaf);
      hintTarget = target;
      hintSide = side || "above";
      if (!target) { hintEl.classList.remove("on"); return; }
      target.classList.add("pl-target");
      hintEl.firstChild.textContent = label;
      hintEl.classList.add("on");
      follow();
    }
    window.addEventListener("resize", placeHint);

    // Waits for a click on one of the targets; after a quiet while it clicks the first itself.
    function waitClick(targets, label, idleMs, side, anchor) {
      targets = [].concat(targets);
      return new Promise(function (resolve) {
        var idle = null, done = false;
        function arm() { clearTimeout(idle); idle = setTimeout(function () { if (token.alive && !done) targets[0].click(); }, idleMs || 12000); timers.push(idle); }
        function finish(e) {
          if (done) return; done = true;
          clearTimeout(idle);
          targets.forEach(function (t) { t.removeEventListener("click", finish); });
          root.removeEventListener("pointermove", arm); root.removeEventListener("keydown", arm);
          hint(null);
          resolve(e && e.currentTarget);
        }
        targets.forEach(function (t) { t.addEventListener("click", finish); });
        root.addEventListener("pointermove", arm, { passive: true }); root.addEventListener("keydown", arm);
        hint(anchor || targets[0], label, side);
        arm();
      });
    }

    function step(i) {
      app.dataset.step = String(i);
      $$(".pl-steps li").forEach(function (li, k) { li.className = k < i ? "past" : k === i ? "on" : ""; });
    }

    // ---- the board -----------------------------------------------------------
    var lists = {};
    $$(".pl-col").forEach(function (c) { lists[c.dataset.col] = c.querySelector(".pl-list"); });
    function counts() {
      $$(".pl-col").forEach(function (c) { c.querySelector("h3 em").textContent = String(c.querySelector(".pl-list").children.length); c.classList.toggle("has", c.querySelector(".pl-list").children.length > 0); });
      $(".n-need").textContent = String(lists.need.children.length);
      $(".n-work").textContent = String(lists.run.children.length);
      app.classList.toggle("needs", lists.need.children.length > 0);
      app.classList.toggle("working", lists.run.children.length > 0);
    }
    // Cards glide to their new column (FLIP), the way Studio's board moves them.
    function move(pairs) {
      var cards = $$(".pl-card"), first = new Map();
      cards.forEach(function (c) { first.set(c, c.getBoundingClientRect()); });
      pairs.forEach(function (p) { p[1].appendChild(p[0]); });
      counts();
      if (still() || !Element.prototype.animate) return;
      cards.forEach(function (c) {
        var a = first.get(c), b = c.getBoundingClientRect();
        var dx = a.left - b.left, dy = a.top - b.top;
        if (Math.abs(dx) + Math.abs(dy) > 1) c.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: 760, easing: EASE });
      });
    }
    function card(t, i) {
      var c = el("article", "pl-card");
      c.style.setProperty("--i", String(i));
      c.appendChild(el("b", "pl-title", t[0]));
      var meta = el("small", "pl-meta"); meta.appendChild(el("span", "pl-who", t[1])); meta.appendChild(el("span", "pl-say", t[2][0])); c.appendChild(meta);
      var bar = el("i", "pl-bar"); bar.appendChild(el("i")); c.appendChild(bar);
      c.appendChild(el("span", "pl-tick", "✓"));
      return c;
    }
    function setSay(c, text) {
      var s = c.querySelector(".pl-say");
      if (s.textContent === text) return;
      s.textContent = text;
      if (!still() && s.animate) s.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE });
    }
    function progress(c, v) { c.style.setProperty("--v", String(v)); }

    // ---- the side panel ---------------------------------------------------------
    function tab(name) {
      $$(".pl-tabs [role=tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === name)); });
      $$(".pl-pane").forEach(function (p) { p.classList.toggle("on", p.dataset.pane === name); });
      var on = $(".pl-tabs [data-tab='" + name + "']"), ink = $(".pl-tab-ink");
      if (on && ink) { ink.style.width = on.offsetWidth + "px"; ink.style.transform = "translateX(" + on.offsetLeft + "px)"; }
      app.classList.toggle("sheet", name !== "friends" || app.classList.contains("sheet-friends"));
    }
    $$(".pl-tabs [role=tab]").forEach(function (b) { b.addEventListener("click", function () { tab(b.dataset.tab); }); });
    function chat(name, hue, text, me) {
      var box = $(".pl-chat");
      var row = el("div", "pl-msg" + (me ? " me" : ""));
      row.appendChild(me ? avatar("You") : avatar(name, hue));
      var p = el("p"); p.appendChild(el("b", "", me ? "You" : name)); p.appendChild(document.createTextNode(text)); row.appendChild(p);
      box.appendChild(row);
      while (box.children.length > 5) box.removeChild(box.firstChild);
      return row;
    }
    async function typing(name, hue, text, ms) {
      var box = $(".pl-chat");
      var t = el("div", "pl-typing"); t.appendChild(avatar(name, hue)); var dots = el("span"); dots.innerHTML = "<i></i><i></i><i></i>"; t.appendChild(dots);
      box.appendChild(t);
      await sleep(ms || 900); alive();
      t.remove();
      return chat(name, hue, text);
    }

    // ---- ideas -------------------------------------------------------------
    var box = $("#pl-idea"), ideasEl = $(".pl-ideas"), typer = null;
    Object.keys(IDEAS).forEach(function (k) {
      var b = el("button", "pl-idea", IDEAS[k].chip); b.type = "button"; b.dataset.idea = k; b.setAttribute("aria-pressed", String(k === "game"));
      b.addEventListener("click", function () { pick(k, true); });
      ideasEl.appendChild(b);
    });
    function typeText(text) {
      clearInterval(typer); box.value = "";
      if (!text) return;
      if (still()) { box.value = text; return; }
      var i = 0;
      typer = setInterval(function () { i += 1 + (Math.random() < 0.3 ? 1 : 0); box.value = text.slice(0, i); if (i >= text.length) clearInterval(typer); }, 26);
    }
    function pick(k, focus) {
      idea = k; custom = k === "own";
      $$(".pl-idea").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.idea === k)); });
      if (custom) { clearInterval(typer); box.value = ""; if (focus) box.focus(); }
      else typeText(IDEAS[k].text);
      $$(".pl-proj").forEach(function (n) { n.textContent = IDEAS[k].project; });
    }
    box.addEventListener("input", function () {
      clearInterval(typer);
      if (!custom) { custom = true; idea = "own"; $$(".pl-idea").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.idea === "own")); }); $$(".pl-proj").forEach(function (n) { n.textContent = IDEAS.own.project; }); }
    });
    // As in Studio: Enter talks it over, Ctrl Enter builds it.
    box.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      (e.ctrlKey || e.metaKey ? $(".pl-build") : $(".pl-talk")).click();
    });
    $(".pl-talk").addEventListener("click", function () { talkBack(); });
    $(".pl-box").addEventListener("submit", function (e) { e.preventDefault(); });

    // Talk it over: Mefi answers under the box, then Build it is the next thing to press.
    var TALK = {
      game: "Easy: the time, the place and an RSVP friends can press. Build it and I'll split it into three steps.",
      pixel: "A small canvas, a few colours and a Save button. Build it and I'll split it into three steps.",
      band: "Next gig on top, the songs below with a play button. Build it and I'll split it into three steps.",
      own: "Got it. Build it and I'll work out the steps and who does what."
    };
    function talkBack() {
      if (app.dataset.step !== "0") return;
      var old = $(".pl-talkback"); if (old) old.remove();
      var reply = el("div", "pl-talkback");
      reply.appendChild(el("span", "pl-orb sm"));
      var p = el("p"); p.appendChild(el("b", "", "Mefi")); p.appendChild(document.createTextNode(TALK[custom ? "own" : idea])); reply.appendChild(p);
      $(".pl-box").insertAdjacentElement("afterend", reply);
      hint($(".pl-build"), "Build it");
      say("Mefi: " + TALK[custom ? "own" : idea]);
    }

    // ---- leaving ---------------------------------------------------------------
    var leaving = false;
    function leave(how) {
      if (leaving) return;
      leaving = true;
      token.alive = false;
      timers.forEach(clearTimeout); clearInterval(typer);
      hint(null);
      window.removeEventListener("resize", placeHint);
      document.removeEventListener("keydown", onKey);
      var lead = (custom ? IDEAS.own : IDEAS[idea]).lead;
      if (opts.onLeave) opts.onLeave({ how: how, idea: custom ? "own" : idea, lead: lead, from: how === "skip" ? $(".pl-skip") : $(".pl-end .pl-enter") || $(".pl-skip") });
    }
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); leave("skip"); } }
    document.addEventListener("keydown", onKey);
    $(".pl-skip").addEventListener("click", function () { leave("skip"); });
    root.close = function () { if (root.parentNode) root.parentNode.removeChild(root); };

    // ---- the play-through ------------------------------------------------------
    async function run() {
      try {
        pick("game");
        // Idea: Build it listens from the first moment, so an early press is never lost.
        step(0);
        var buildBtn = $(".pl-build");
        await waitClick(buildBtn, "Build it", 14000); alive();
        var spec = custom ? IDEAS.own : IDEAS[idea];
        if (custom && !box.value.trim()) box.value = "Something for my friends and me";
        var asked = custom ? box.value.trim() : spec.text;
        clearInterval(typer);
        var talked = $(".pl-talkback"); if (talked) talked.remove();
        app.classList.add("sent");
        say("Three builders start on " + asked);
        await sleep(420); alive();
        box.value = "";
        app.classList.remove("sent");

        // Build
        step(1);
        var cards = spec.tasks.map(function (t, i) { var c = card(t, i); lists.run.appendChild(c); return c; });
        counts();
        // The entrance plays once: a card moved to another column must not fade in again.
        cards.forEach(function (c) {
          c.classList.add("in"); progress(c, 0.08);
          c.addEventListener("animationend", function done(e) { if (e.target === c) { c.classList.remove("in"); c.removeEventListener("animationend", done); } });
        });
        await sleep(700); alive();
        cards.forEach(function (c, i) { setSay(c, spec.tasks[i][2][1]); progress(c, 0.32 + i * 0.08); });
        typing("Maxwell", 146, "Ooh, what are you making?", 800).catch(function () {});
        await sleep(1500); alive();
        cards.forEach(function (c, i) { progress(c, 0.55 + i * 0.07); });
        await sleep(700); alive();

        // Decide: the second builder asks
        step(2);
        var asker = cards[1];
        asker.classList.add("asking");
        setSay(asker, "waiting for you");
        var q = el("div", "pl-ask");
        q.appendChild(el("p", "pl-q", spec.ask.q));
        var yes = el("button", "pl-opt rec"); yes.type = "button"; yes.appendChild(document.createTextNode(spec.ask.yes)); yes.appendChild(el("em", "", "Recommended"));
        var no = el("button", "pl-opt"); no.type = "button"; no.textContent = spec.ask.no;
        q.appendChild(yes); q.appendChild(no);
        q.appendChild(el("p", "pl-own", "or answer in your own words"));
        asker.appendChild(q);
        move([[asker, lists.need]]);
        say(spec.tasks[1][1] + " asks: " + spec.ask.q);
        var picked = await waitClick([yes, no], "Your call", 13000, "below", q); alive();
        answer = picked === no ? "no" : "yes";
        q.classList.add("answered");
        q.appendChild(el("p", "pl-answer", "✓ " + (answer === "yes" ? spec.ask.yes : spec.ask.no)));
        await sleep(650); alive();
        asker.classList.remove("asking");
        q.remove();
        setSay(asker, spec.tasks[1][2][2]);
        move([[asker, lists.run]]);
        await sleep(400); alive();

        // the rest of the build, then the checks
        cards.forEach(function (c, i) { setSay(c, spec.tasks[i][2][2]); progress(c, 1); });
        typing("Juno", 268, "Is that the game-night thing? Send it when it's done!", 900).catch(function () {});
        await sleep(1500); alive();
        for (var i = 0; i < cards.length; i++) {
          setSay(cards[i], "checking its work");
          move([[cards[i], lists.review]]);
          await sleep(260); alive();
        }
        step(3);
        var checks = el("div", "pl-checks");
        ["Tests pass", "Lint is clean", "It builds"].forEach(function (t) { var p = el("span", "", t); p.prepend(el("i")); checks.appendChild(p); });
        lists.review.parentNode.appendChild(checks);
        await sleep(80); alive();
        checks.classList.add("in");
        await sleep(1100); alive();

        // Review: the changes, Accept or Revert
        var pane = $("[data-pane='changes']");
        pane.innerHTML = "";
        pane.appendChild(el("p", "pl-k", "Changes"));
        var head = el("p", "pl-files-head"); head.appendChild(el("b", "", spec.files.length + " files changed")); pane.appendChild(head);
        var fl = el("ul", "pl-files");
        spec.files.forEach(function (f) { var li = el("li"); li.appendChild(el("code", "", f[0])); li.appendChild(el("span", "add", f[1])); li.appendChild(el("span", "tag", "Added")); fl.appendChild(li); });
        pane.appendChild(fl);
        var acts = el("div", "pl-acts");
        var accept = el("button", "pl-accept", "Accept changes"); accept.type = "button";
        var revert = el("button", "pl-revert", "Revert"); revert.type = "button";
        acts.appendChild(accept); acts.appendChild(revert); pane.appendChild(acts);
        var note = el("p", "pl-note", "Nothing lands until you say so."); pane.appendChild(note);
        tab("changes");
        say("Checks passed. " + spec.files.length + " files changed, waiting for you to accept them.");
        // Revert can be tried first: the files go back, and Accept brings them again.
        revert.addEventListener("click", function () {
          if (revert.disabled) return;
          fl.classList.add("reverted"); note.textContent = "Back as it was. Your files are untouched.";
          revert.textContent = "Reverted"; revert.disabled = true;
          accept.textContent = "Bring them back";
          hint(accept, "Bring them back", "below");
        });
        await waitClick(accept, "Accept", 12000, "below"); alive();
        fl.classList.remove("reverted");
        accept.disabled = true; revert.disabled = true; accept.textContent = "Accepted ✓";
        note.textContent = "Accepted. It's in your project now.";
        checks.classList.add("gone");
        for (var j = 0; j < cards.length; j++) {
          cards[j].classList.add("done");
          setSay(cards[j], "Done");
          move([[cards[j], lists.done]]);
          await sleep(220); alive();
        }
        await sleep(400); alive();
        checks.remove();

        // Try it: the thing that was built
        step(4);
        var pv = $("[data-pane='preview']");
        pv.innerHTML = "";
        pv.appendChild(el("p", "pl-k", "Preview"));
        var made = preview(custom ? "own" : idea, answer, asked);
        pv.appendChild(made.node);
        tab("preview");
        say("The preview is ready. Try it.");
        await waitClick(made.target, made.label, 9000); alive();
        await sleep(1100); alive();

        // Share it with friends
        step(5);
        var share = el("button", "pl-share"); share.type = "button"; share.innerHTML = SVG.friends + "<span>Share with friends</span>";
        pv.appendChild(share);
        await sleep(60); alive();
        share.classList.add("in");
        await waitClick(share, "Share it", 9000, "below"); alive();
        app.classList.add("shared");
        tab("friends");
        app.classList.add("sheet-friends");
        chat("You", null, spec.share, true).classList.add("link");
        say("Shared in Friday game night.");
        await sleep(700); alive();
        for (var k = 0; k < spec.replies.length; k++) {
          var r = spec.replies[k];
          await typing(r[0], r[1], r[2], 750); alive();
          if (k === 0) { var cr = el("span", "pl-credit", "+5 credits · " + r[0] + " played it"); $(".pl-chat").appendChild(cr); }
          await sleep(450); alive();
        }
        await sleep(900); alive();
        end(spec);
      } catch (e) { if (token.alive && window.console) console.warn("Demo stopped:", e); }
    }

    // ---- the end: now the explaining ------------------------------------------------
    function end(spec) {
      hint(null);
      var card = el("div", "pl-end");
      card.innerHTML =
        '<div class="pl-end-card" role="document">' +
          '<p class="pl-k">You just used Mefi Studio</p>' +
          '<h2>That’s the whole loop.</h2>' +
          '<ol class="pl-recap">' +
            '<li><b>You said what you wanted.</b> Builders like Claude Code, Codex and OpenCode did the work in your project.</li>' +
            '<li><b>You made the call</b> when it mattered, and nothing landed until you accepted it.</li>' +
            '<li><b>Your friends were there the whole time,</b> and saw it the moment you shared it.</li>' +
          '</ol>' +
          '<p class="pl-end-fine">In Studio a real build takes a few minutes and runs on the AI you choose. This one was sped up and made up.</p>' +
          '<p class="pl-end-fine" data-until="0.5">It shows Studio 0.5, out soon. Until then the download is 0.4.4.</p>' +
          '<div class="pl-end-acts"><button type="button" class="pl-enter">See the site</button><a class="pl-get" href="download.html">Download for Windows</a></div>' +
        '</div>';
      root.appendChild(card);
      if (window.SITE && window.SITE.applyRelease) window.SITE.applyRelease();
      requestAnimationFrame(function () { card.classList.add("in"); });
      var enter = card.querySelector(".pl-enter");
      enter.addEventListener("click", function () { leave("done"); });
      setTimeout(function () { try { enter.focus({ preventScroll: true }); } catch (e) { /* old engines */ } }, 400);
      say("That's the whole loop. See the site, or download Studio.");
    }

    // ---- what was built ----------------------------------------------------------
    function preview(kind, ans, asked) {
      var wrap = el("div", "pv pv-" + kind), target, label = "Try it";
      if (kind === "game") {
        var t = el("div", "pv-ticket");
        t.appendChild(el("p", "pv-day", "Friday"));
        t.appendChild(el("h4", "", "Game night"));
        t.appendChild(el("p", "pv-when", "8:00 PM · Juno’s place"));
        var going = el("div", "pv-going");
        [["Maxwell", 146], ["Tess", 330], ["Juno", 268]].forEach(function (f) { going.appendChild(avatar(f[0], f[1])); });
        var n = el("span", "", "3 going"); going.appendChild(n); t.appendChild(going);
        var rsvp = el("button", "pv-rsvp", "RSVP"); rsvp.type = "button"; t.appendChild(rsvp);
        t.appendChild(el("p", "pv-fine", ans === "yes" ? "RSVPs close an hour before." : "RSVPs stay open until it starts."));
        rsvp.addEventListener("click", function () {
          if (rsvp.disabled) return;
          rsvp.disabled = true; rsvp.textContent = "You’re going ✓";
          var me = avatar("You"); me.classList.add("pop"); going.insertBefore(me, n); n.textContent = "4 going";
        });
        wrap.appendChild(t); target = rsvp; label = "RSVP";
      } else if (kind === "pixel") {
        var size = ans === "yes" ? 12 : 16, colors = ["#f2f4f7", "#a8c5ff", "#c6b4ff", "#9de8da", "#ffd479"], color = colors[1];
        var cv = el("canvas", "pv-canvas"); cv.width = size; cv.height = size;
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#16161b"; ctx.fillRect(0, 0, size, size);
        // a little face to start with
        var seed = [[3, 4], [size - 4, 4], [3, 5], [size - 4, 5]];
        ctx.fillStyle = colors[0]; seed.forEach(function (p) { ctx.fillRect(p[0], p[1], 1, 1); });
        for (var x = 3; x < size - 3; x++) ctx.fillRect(x, size - 4, 1, 1);
        var painting = false;
        function paint(e) {
          var r = cv.getBoundingClientRect();
          var px = Math.floor((e.clientX - r.left) / r.width * size), py = Math.floor((e.clientY - r.top) / r.height * size);
          if (px < 0 || py < 0 || px >= size || py >= size) return;
          ctx.fillStyle = color; ctx.fillRect(px, py, 1, 1);
          cv.dispatchEvent(new Event("painted"));
        }
        cv.addEventListener("pointerdown", function (e) { painting = true; cv.setPointerCapture(e.pointerId); paint(e); });
        cv.addEventListener("pointermove", function (e) { if (painting) paint(e); });
        cv.addEventListener("pointerup", function () { painting = false; });
        var pal = el("div", "pv-pal");
        colors.forEach(function (c) { var b = el("button"); b.type = "button"; b.style.setProperty("--c", c); b.setAttribute("aria-label", "Colour " + c); if (c === color) b.className = "on"; b.addEventListener("click", function () { color = c; Array.prototype.forEach.call(pal.children, function (x) { x.className = x === b ? "on" : ""; }); }); pal.appendChild(b); });
        var save = el("button", "pv-save", "Save as PNG"); save.type = "button";
        save.addEventListener("click", function () {
          try { var a = document.createElement("a"); a.download = "pixel-art.png"; var big = document.createElement("canvas"); big.width = size * 16; big.height = size * 16; var g = big.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(cv, 0, 0, big.width, big.height); a.href = big.toDataURL("image/png"); a.click(); } catch (err) { /* blocked: nothing to save */ }
        });
        var top = el("div", "pv-pixel-top"); top.appendChild(el("b", "", "Pixel pad")); top.appendChild(el("small", "", size + " by " + size)); wrap.appendChild(top);
        wrap.appendChild(cv); wrap.appendChild(pal); wrap.appendChild(save);
        // A click on the canvas counts as trying it; when the demo plays itself, it paints a pixel too.
        cv.addEventListener("click", function (e) { if (!e.isTrusted) { ctx.fillStyle = color; ctx.fillRect(Math.floor(size / 2), Math.floor(size / 2) - 1, 1, 1); } });
        target = cv; label = "Draw";
      } else if (kind === "band") {
        var head = el("div", "pv-band-head"); head.appendChild(el("h4", "", "The Late Shift")); head.appendChild(el("p", "", "Loud, kind and on time."));
        var gig = el("div", "pv-gig"); gig.appendChild(el("b", "", "Next gig")); gig.appendChild(el("span", "", "Sat · The Basement · 9 PM"));
        var songs = el("ol", "pv-songs"), first = null;
        [["Night Bus", "3:12"], ["Static Heart", "2:48"], ["Last Train Home", "4:05"]].forEach(function (s) {
          var li = el("li"), b = el("button", "pv-play"); b.type = "button"; b.innerHTML = SVG.play; b.setAttribute("aria-label", "Play " + s[0]);
          li.appendChild(b); li.appendChild(el("span", "", s[0])); li.appendChild(el("em", "", s[1])); li.appendChild(el("i", "pv-prog"));
          b.addEventListener("click", function () {
            var on = !li.classList.contains("playing");
            Array.prototype.forEach.call(songs.children, function (x) { x.classList.remove("playing"); x.querySelector(".pv-play").innerHTML = SVG.play; });
            if (on) { li.classList.add("playing"); b.innerHTML = SVG.pause; }
          });
          if (!first) first = b;
          songs.appendChild(li);
        });
        wrap.appendChild(head);
        if (ans === "yes") { wrap.appendChild(gig); wrap.appendChild(songs); } else { wrap.appendChild(songs); wrap.appendChild(gig); }
        target = first; label = "Press play";
      } else {
        var o = el("div", "pv-own-card");
        var tabs = el("div", "pv-own-tabs"); tabs.appendChild(el("b", "on", "Home")); if (ans === "no") tabs.appendChild(el("b", "", "More"));
        o.appendChild(tabs);
        o.appendChild(el("h4", "", asked.length > 60 ? asked.slice(0, 58) + "…" : asked));
        o.appendChild(el("p", "", "A first screen, ready to grow."));
        var cnt = el("button", "pv-count"); cnt.type = "button"; cnt.appendChild(document.createTextNode("Click me ")); var num = el("b", "", "0"); cnt.appendChild(num);
        cnt.addEventListener("click", function () { num.textContent = String(Number(num.textContent) + 1); });
        o.appendChild(cnt);
        wrap.appendChild(o); target = cnt; label = "Click it";
      }
      return { node: wrap, target: target, label: label };
    }

    // ---- open it --------------------------------------------------------------
    document.body.appendChild(root);
    if (opts.from) {
      var r = opts.from.getBoundingClientRect();
      root.style.setProperty("--ox", (r.left + r.width / 2).toFixed(0) + "px");
      root.style.setProperty("--oy", (r.top + r.height / 2).toFixed(0) + "px");
    }
    // Opens on the next frame; a timer covers a tab that hands out no frames.
    requestAnimationFrame(function () { root.classList.add("open"); });
    setTimeout(function () { root.classList.add("open"); }, 140);
    setTimeout(function () { try { $(".pl-build").focus({ preventScroll: true }); } catch (e) { /* old engines */ } }, 700);
    tab("friends");
    // the room was already talking before you came in
    chat("Maxwell", 146, "Game night on Friday?");
    chat("Juno", 268, "Always. Someone make us a page this time.");
    run();
    return root;
  }

  window.MefiPlay = { open: open };
})();
