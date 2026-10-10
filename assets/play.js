/* Vibe Studio website — "Try the app": a playable, made-up copy of Studio's
   Social mode, opened from Home's gate or its buttons (window.MefiPlay.open).
   It is guided from start to end. The visitor picks one of six ready-made
   projects (the box types it for them; nothing is typed freely), presses
   Build it, three builders work while friends chat, one asks a question and
   the answer changes what gets built, the checks pass, the visitor accepts
   (or reverts) the changes, tries the finished site in a preview window and
   shares it in a room. Only what the current step asks for can be pressed:
   anything else nudges the hint. The explaining waits for the end card,
   which can start another project. Every step plays itself after a quiet
   while, Skip and Escape always leave, and nothing is sent anywhere. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var still = function () { return reduce.matches; };
  var NBH = String.fromCharCode(8209); // a hyphen that never breaks a line
  var EASE = "cubic-bezier(.22,1,.36,1)";
  var HUE = { Maxwell: 146, Juno: 268, Rook: 32, Tess: 330 };

  // ---- the six projects ------------------------------------------------------
  var IDEAS = {
    game: {
      name: "Game-night page", blurb: "RSVP with your friends", project: "Game night", lead: "your game" + NBH + "night page",
      text: "A game-night page with the time, the place and an RSVP button",
      talk: "Easy: the time, the place and an RSVP friends can press. I split it into three tasks, and three builders are on it.",
      peek: "Is that the game-night thing? Send it when it's done!",
      tasks: [["Lay out the page", "Claude Code", ["reading the project", "writing index.html", "styling the card"]],
        ["Make the RSVP work", "Codex", ["reading rsvp.js", "wiring up the button", "saving who's going"]],
        ["Write the invite", "OpenCode", ["drafting the text", "adding the date", "checking its work"]]],
      ask: { q: "Should RSVPs close an hour before it starts?", yes: "Yes, an hour before", no: "No, keep them open" },
      files: [["index.html", "+88"], ["rsvp.js", "+41"], ["invite.md", "+12"]],
      share: "Our game-night page is on the Project hub. RSVP in there!",
      replies: [["Maxwell", "Wait, it's done already? That's actually useful."], ["Tess", "RSVP'd. See you Friday!"], ["Juno", "Can it list snacks too?"]]
    },
    arcade: {
      name: "Tiny arcade game", blurb: "Catch the falling stars", project: "Star Catch", lead: "your arcade game",
      text: "A tiny game where you catch falling stars with a paddle and keep score",
      talk: "Stars fall, a paddle catches them and the score counts up. I split it into three tasks, and three builders are on it.",
      peek: "Is that a game? I'm in.",
      tasks: [["Draw the night sky", "Claude Code", ["reading the project", "writing game.js", "drawing the stars"]],
        ["Move the paddle", "Codex", ["reading input.js", "following the pointer", "testing the edges"]],
        ["Keep the score", "OpenCode", ["writing score.js", "saving the best score", "checking its work"]]],
      ask: { q: "Should the stars fall faster as you score?", yes: "Yes, speed up", no: "Keep one speed" },
      files: [["game.js", "+132"], ["input.js", "+38"], ["score.js", "+24"]],
      share: "Star Catch is on the Project hub. Beat my score!",
      replies: [["Rook", "14 stars. Your turn."], ["Juno", "One more round. Okay, two."], ["Maxwell", "Putting this on the Project hub."]]
    },
    band: {
      name: "Our band's site", blurb: "Next gig and a play button", project: "The Late Shift", lead: "your band's site",
      text: "A site for our band with the next gig, our songs and a play button",
      talk: "Next gig on top, the songs below with a play button. I split it into three tasks, and three builders are on it.",
      peek: "Wait, a site for The Late Shift?",
      tasks: [["Build the home page", "Claude Code", ["reading the project", "writing index.html", "setting the type"]],
        ["List the next gig", "Codex", ["reading gigs.json", "adding the date", "linking the venue"]],
        ["Add the player", "OpenCode", ["writing player.js", "adding the songs", "checking its work"]]],
      ask: { q: "Put the next gig above the songs?", yes: "Yes, gig first", no: "Songs first" },
      files: [["index.html", "+94"], ["gigs.json", "+18"], ["player.js", "+52"]],
      share: "Our band site is on the Project hub. Press play!",
      replies: [["Rook", "The player works!"], ["Tess", "Putting Saturday in my calendar."], ["Maxwell", "Sharing it with everyone."]]
    },
    pixel: {
      name: "Pixel art tool", blurb: "Draw, then save a PNG", project: "Pixel pad", lead: "your pixel art tool",
      text: "A pixel art tool with a small canvas, a palette and Save as PNG",
      talk: "A small canvas, a few colours and a Save button. I split it into three tasks, and three builders are on it.",
      peek: "A pixel tool? I have sprites to make.",
      tasks: [["Draw the canvas", "Claude Code", ["reading the project", "writing canvas.js", "drawing the grid"]],
        ["Add the palette", "Codex", ["reading palette.js", "picking the colours", "testing the picker"]],
        ["Save as PNG", "OpenCode", ["adding the export", "naming the file", "checking its work"]]],
      ask: { q: "Start with a 12 by 12 canvas?", yes: "Yes, 12 by 12", no: "Make it 16 by 16" },
      files: [["canvas.js", "+120"], ["palette.js", "+36"], ["export.js", "+28"]],
      share: "Pixel pad is on the Project hub. Draw something!",
      replies: [["Juno", "Drawing a cat right now."], ["Maxwell", "Could it export sprites for Pixel Forge?"], ["Rook", "Saved my first one. So good."]]
    },
    timer: {
      name: "Study timer", blurb: "Focus together, 25 minutes", project: "Focus Room", lead: "your study timer",
      text: "A study timer with 25 minutes of focus, a short break and friends focusing with you",
      talk: "A ring that fills over 25 minutes, then a short break, with friends beside you. I split it into three tasks, and three builders are on it.",
      peek: "Ooh, I need that for exams.",
      tasks: [["Draw the timer ring", "Claude Code", ["reading the project", "writing timer.js", "drawing the ring"]],
        ["Add focus and break", "Codex", ["reading modes.js", "switching the modes", "testing the clock"]],
        ["Show who's focusing", "OpenCode", ["writing friends.js", "adding the faces", "checking its work"]]],
      ask: { q: "Play a soft chime when the time is up?", yes: "Yes, a soft chime", no: "No sound" },
      files: [["timer.js", "+86"], ["modes.js", "+30"], ["friends.js", "+22"]],
      share: "Focus Room is on the Project hub. Focus with me?",
      replies: [["Juno", "Joining. 25 minutes, go."], ["Tess", "The ring is so calm."], ["Rook", "Break at the same time? Deal."]]
    },
    plants: {
      name: "Plant tracker", blurb: "Who needs water today", project: "Leaf Log", lead: "your plant tracker",
      text: "A plant tracker that shows which plants need water today",
      talk: "A card for each plant, a water button, and the thirsty ones first. I split it into three tasks, and three builders are on it.",
      peek: "My fern needs this.",
      tasks: [["List the plants", "Claude Code", ["reading the project", "writing plants.json", "laying out the cards"]],
        ["Add the water button", "Codex", ["reading water.js", "filling the gauge", "saving the day"]],
        ["Sort by who's thirsty", "OpenCode", ["writing thirst.js", "sorting the cards", "checking its work"]]],
      ask: { q: "Remind you on the days a plant is thirsty?", yes: "Yes, remind me", no: "No reminders" },
      files: [["plants.json", "+26"], ["water.js", "+44"], ["thirst.js", "+31"]],
      share: "Leaf Log is on the Project hub. My fern says thanks.",
      replies: [["Tess", "Adding my cactus. It never needs anything."], ["Maxwell", "Can it do my basil too?"], ["Juno", "This is so wholesome."]]
    }
  };
  var ORDER = ["game", "arcade", "band", "pixel", "timer", "plants"];
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
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.5-6 5 12 2.5-6h4"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7Z"/></svg>',
    drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3.6 4.7 6 8.1 6 11a6 6 0 0 1-12 0c0-2.9 2.4-6.3 6-11Z"/></svg>'
  };

  // Little pictures of each finished site for the picker; they move while hovered or picked.
  function pixelThumb() {
    var rows = ["..XX.XX..", ".XXXXXXX.", ".XXXXXXX.", "..XXXXX..", "...XXX...", "....X...."], out = "";
    rows.forEach(function (r, y) { for (var x = 0; x < r.length; x++) out += '<rect x="' + (24 + x * 8) + '" y="' + (11 + y * 8) + '" width="7" height="7" rx="1.5" class="' + (r[x] === "X" ? "t-px" : "t-off") + '" style="--d:' + ((x + y) * 60) + 'ms"/>'; });
    return '<svg viewBox="0 0 120 72" aria-hidden="true">' + out + "</svg>";
  }
  var THUMB = {
    game: '<svg viewBox="0 0 120 72" aria-hidden="true"><rect class="t-card" x="20" y="9" width="80" height="54" rx="10"/><rect class="t-acc" x="30" y="19" width="22" height="5" rx="2.5"/><rect class="t-ink" x="30" y="29" width="48" height="8" rx="3"/><circle class="t-a1" cx="35" cy="50" r="5"/><circle class="t-a2" cx="43" cy="50" r="5"/><circle class="t-a3" cx="51" cy="50" r="5"/><rect class="t-go t-rsvp" x="64" y="44" width="26" height="12" rx="6"/></svg>',
    arcade: '<svg viewBox="0 0 120 72" aria-hidden="true"><g class="t-fall"><path class="t-star" d="M38 8l2.2 5.3 5.3 2.2-5.3 2.2L38 23l-2.2-5.3-5.3-2.2 5.3-2.2z"/><path class="t-star" d="M66 18l1.8 4.2 4.2 1.8-4.2 1.8L66 30l-1.8-4.2-4.2-1.8 4.2-1.8z"/><path class="t-star" d="M86 4l1.5 3.5 3.5 1.5-3.5 1.5L86 14l-1.5-3.5-3.5-1.5 3.5-1.5z"/></g><rect class="t-go t-paddle" x="44" y="57" width="34" height="7" rx="3.5"/></svg>',
    band: '<svg viewBox="0 0 120 72" aria-hidden="true"><circle class="t-go" cx="36" cy="36" r="15"/><path class="t-dark" d="M32 28.5v15l12-7.5z"/><g class="t-bars"><rect x="60" y="29" width="6" height="14" rx="3"/><rect x="70" y="20" width="6" height="32" rx="3"/><rect x="80" y="25" width="6" height="22" rx="3"/><rect x="90" y="15" width="6" height="42" rx="3"/></g></svg>',
    pixel: pixelThumb(),
    timer: '<svg viewBox="0 0 120 72" aria-hidden="true"><circle class="t-track" cx="60" cy="36" r="24"/><circle class="t-ring" cx="60" cy="36" r="24" pathLength="100" transform="rotate(-90 60 36)"/><rect class="t-ink" x="49" y="32" width="22" height="8" rx="3"/></svg>',
    plants: '<svg viewBox="0 0 120 72" aria-hidden="true"><g class="t-plant"><path class="t-leaf" d="M60 46C48 42 44 30 49 16c12 5 16 17 11 30z"/><path class="t-leaf2" d="M60 46c11-4 16-14 13-26-11 3-16 14-13 26z"/></g><path class="t-pot" d="M45 46h30l-4 17H49z"/><path class="t-drop" d="M88 12c3.5 4.5 5.5 7.5 5.5 10a5.5 5.5 0 0 1-11 0c0-2.5 2-5.5 5.5-10z"/></svg>'
  };
  var PLANT = {
    fern: '<svg viewBox="0 0 80 96" aria-hidden="true"><g class="pv-leaves"><path class="lf" d="M40 64c-2-14-10-26-23-33 4 14 11 26 23 33z"/><path class="lf" d="M40 64c2-16 10-29 23-36-3 16-10 29-23 36z"/><path class="lf l2" d="M40 64c-2-19 0-35 6-48 4 17 1 33-6 48z"/><path class="lf l2" d="M40 64c-6-12-16-18-28-18 7 10 16 16 28 18z"/></g><path class="pot" d="M24 64h32l-4 24H28z"/></svg>',
    basil: '<svg viewBox="0 0 80 96" aria-hidden="true"><g class="pv-leaves"><path class="stem" d="M40 64V26"/><ellipse class="lf" cx="30" cy="50" rx="10" ry="6.5" transform="rotate(-25 30 50)"/><ellipse class="lf l2" cx="50" cy="46" rx="10" ry="6.5" transform="rotate(25 50 46)"/><ellipse class="lf" cx="31" cy="34" rx="9" ry="6" transform="rotate(-30 31 34)"/><ellipse class="lf l2" cx="49" cy="30" rx="9" ry="6" transform="rotate(30 49 30)"/><ellipse class="lf" cx="40" cy="20" rx="6" ry="8"/></g><path class="pot" d="M24 64h32l-4 24H28z"/></svg>',
    monstera: '<svg viewBox="0 0 80 96" aria-hidden="true"><g class="pv-leaves"><path class="stem" d="M40 64C40 52 38 44 34 38"/><path class="lf" d="M34 40C18 38 10 26 14 12c10-4 24-2 32 8 8 10 4 22-12 20z"/><ellipse class="hole" cx="24" cy="24" rx="3.2" ry="2" transform="rotate(30 24 24)"/><ellipse class="hole" cx="32" cy="18" rx="3.2" ry="2" transform="rotate(60 32 18)"/><path class="lf l2" d="M42 50c4-12 14-18 26-16 2 10-6 20-18 22z"/></g><path class="pot" d="M24 64h32l-4 24H28z"/></svg>'
  };

  // ---- the app, as Studio draws it ----------------------------------------------
  function template() {
    return '<div class="pl-app" data-step="0">' +
        '<header class="pl-top">' +
          '<span class="pl-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
          '<span class="pl-seg" aria-hidden="true"><b class="on">' + SVG.spark + 'Social</b><b>Studio</b></span>' +
          '<span class="pl-crumb"><span class="pl-proj">New project</span><i>/</i><span class="pl-tail">Today</span></span>' +
          '<span class="pl-search" aria-hidden="true">Search or run a command <kbd>Ctrl K</kbd></span>' +
          '<span class="pl-pill need" aria-hidden="true"><i></i><em class="n-need">0</em> need you</span>' +
          '<span class="pl-pill work" aria-hidden="true"><i></i><em class="n-work">0</em> working</span>' +
          '<button type="button" class="pl-skip">Skip to the site' + SVG.close + '</button>' +
        '</header>' +
        '<p class="pl-banner"><b>Simulated demo</b><span class="pl-banner-long">These people and projects are made up. Nothing connects to real users. Press the glowing button, or wait.</span><span class="pl-banner-short">Made-up people. No live connection.</span></p>' +
        '<div class="pl-body">' +
          '<nav class="pl-rail" aria-hidden="true"><i class="on" title="Home">' + SVG.today + '</i><i class="r-friends" title="Friends">' + SVG.friends + '<em class="badge">2</em></i><i title="Projects">' + SVG.folder + '</i><i title="Activity">' + SVG.pulse + '</i></nav>' +
          '<main class="pl-main">' +
            '<div class="pl-hello"><span class="pl-orb" aria-hidden="true"></span><div><small><span class="pl-greet">Good evening</span> · Social</small><h2 class="pl-ask-line">What do you want to make?</h2></div></div>' +
            '<form class="pl-box" autocomplete="off">' +
              '<label class="visually-hidden" for="pl-idea">Your idea</label>' +
              '<textarea id="pl-idea" rows="2" readonly tabindex="-1" spellcheck="false" placeholder="Pick something to make below…"></textarea>' +
              '<div class="pl-box-row">' +
                '<span class="pl-chips" aria-hidden="true"><span>Add files</span></span>' +
                '<button type="submit" class="pl-build">' + SVG.send + '<span>Send</span><kbd>Enter</kbd></button>' +
              '</div>' +
            '</form>' +
            '<div class="pl-gallery" role="group" aria-label="Pick something to build"></div>' +
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
                '<p class="pl-k">3 simulated friends</p>' +
                '<p class="pl-demo-context">Cowork rooms are for building alongside people. The Project hub is for sharing builds and finding testers. This preview uses sample activity and asks for no device permissions.</p>' +
                '<ul class="pl-online"></ul>' +
                '<div class="pl-room"><p class="pl-room-head"><b>Friday hangout</b><span>Sample room · 4 simulated people</span></p><div class="pl-chat" aria-live="polite"></div></div>' +
              '</section>' +
              '<section class="pl-pane" data-pane="changes"><p class="pl-k">Changes</p><div class="pl-empty">Nothing changed yet.</div></section>' +
              '<section class="pl-pane" data-pane="preview"><p class="pl-k">Preview</p><div class="pl-empty">Nothing to preview yet.</div></section>' +
            '</div>' +
          '</aside>' +
        '</div>' +
        '<footer class="pl-foot"><ol class="pl-steps" aria-label="Steps"></ol></footer>' +
      '</div>' +
      '<div class="pl-hint" aria-hidden="true"><span></span></div>' +
      '<p class="pl-toast" role="status"></p>' +
      '<p class="visually-hidden pl-live" aria-live="polite"></p>';
  }

  // ---- one play-through --------------------------------------------------------
  // `built` lists the projects finished in earlier play-throughs; `restart` starts another in the same window.
  function start(root, opts, built, again, restart) {
    root.innerHTML = template();
    var app = root.querySelector(".pl-app");
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
    var token = { alive: true }, timers = [], ctl = new AbortController(), on = { signal: ctl.signal };
    var idea = null, answer = "yes", started = false, leaving = false, typer = null;
    var live = $(".pl-live"), box = $("#pl-idea");
    function say(text) { live.textContent = text; }
    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
    function sleep(ms) { return new Promise(function (r) { later(r, still() ? Math.min(ms, 40) : ms); }); }
    function alive() { if (!token.alive) throw new Error("left"); }
    if (again) app.classList.add("fresh");

    var h = new Date().getHours();
    $(".pl-greet").textContent = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    STEPS.forEach(function (s, i) { $(".pl-steps").appendChild(el("li", i === 0 ? "on" : "", s)); });
    [["Maxwell", "In Friday hangout"], ["Juno", "In the Lobby"], ["Rook", "Listening together"]].forEach(function (f) {
      var li = el("li"); li.appendChild(avatar(f[0], HUE[f[0]])); var t = el("span"); t.appendChild(el("b", "", f[0])); t.appendChild(el("small", "", f[1])); li.appendChild(t); $(".pl-online").appendChild(li);
    });

    // ---- the rails: only what the current step asks for can be pressed --------
    var allowed = [];
    function allow(list) {
      allowed.forEach(function (a) { a.classList.remove("pl-ok"); });
      allowed = list.filter(Boolean);
      allowed.forEach(function (a) { a.classList.add("pl-ok"); });
    }
    root.addEventListener("click", function (e) {
      var t = e.target;
      if (!token.alive || !(t instanceof Element) || t.closest(".pl-skip, .pl-end")) return;
      for (var i = 0; i < allowed.length; i++) if (allowed[i].contains(t)) return;
      e.preventDefault(); e.stopPropagation();
      nudge();
    }, { capture: true, signal: ctl.signal });

    // ---- the hint: a pulse on what to press next, with one or two words ----
    var hintEl = $(".pl-hint"), hintTarget = null, hintSide = "above", hintRaf = 0;
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
    function follow() { placeHint(); hintRaf = requestAnimationFrame(follow); }
    function hint(target, label, side) {
      if (hintTarget) hintTarget.classList.remove("pl-target");
      cancelAnimationFrame(hintRaf);
      hintTarget = target;
      hintSide = side || "above";
      if (!target) { hintEl.classList.remove("on", "nudge"); return; }
      target.classList.add("pl-target");
      hintEl.firstChild.textContent = label;
      hintEl.classList.add("on");
      follow();
    }
    // A press anywhere else: a line says what this is and what to press, and the hint and its target
    // bounce. (Web Animations, so the target's own CSS animations are left alone.)
    var toast = $(".pl-toast"), toastTimer = 0;
    function nudge() {
      toast.textContent = hintTarget
        ? "This is a guided demo. Press “" + hintEl.firstChild.textContent + "” to go on."
        : "This is a guided demo. The next part plays by itself.";
      toast.classList.add("on");
      clearTimeout(toastTimer);
      toastTimer = later(function () { toast.classList.remove("on"); }, 2600);
      if (!hintTarget) return;
      hintEl.classList.add("nudge");
      if (still() || !hintEl.animate) return;
      hintEl.animate([{ scale: "1" }, { scale: "1.18" }, { scale: ".94" }, { scale: "1.04" }, { scale: "1" }], { duration: 500, easing: "ease-out" });
      hintTarget.animate([{ translate: "0 0" }, { translate: "-5px 0" }, { translate: "5px 0" }, { translate: "-3px 0" }, { translate: "2px 0" }, { translate: "0 0" }], { duration: 450, easing: "ease-out" });
    }
    window.addEventListener("resize", placeHint, on);

    // Waits for a click on one of the targets (and lets `also` be pressed meanwhile);
    // after a quiet while it clicks the first target itself.
    function waitClick(targets, label, idleMs, side, anchor, also) {
      targets = [].concat(targets);
      allow(targets.concat(also || []));
      return new Promise(function (resolve) {
        var idle = null, done = false;
        function arm() { clearTimeout(idle); idle = later(function () { if (token.alive && !done) targets[0].click(); }, idleMs || 12000); }
        function finish(e) {
          if (done) return; done = true;
          clearTimeout(idle);
          targets.forEach(function (t) { t.removeEventListener("click", finish); });
          root.removeEventListener("pointermove", arm); root.removeEventListener("keydown", arm);
          hint(null); allow([]);
          resolve(e && e.currentTarget);
        }
        targets.forEach(function (t) { t.addEventListener("click", finish); });
        root.addEventListener("pointermove", arm, { passive: true, signal: ctl.signal }); root.addEventListener("keydown", arm, on);
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
      var onTab = $(".pl-tabs [data-tab='" + name + "']"), ink = $(".pl-tab-ink");
      if (onTab && ink) { ink.style.width = onTab.offsetWidth + "px"; ink.style.transform = "translateX(" + onTab.offsetLeft + "px)"; }
      app.classList.toggle("sheet", name !== "friends" || app.classList.contains("sheet-friends"));
    }
    function chat(name, text, me) {
      var c = $(".pl-chat");
      var row = el("div", "pl-msg" + (me ? " me" : ""));
      row.appendChild(me ? avatar("You") : avatar(name, HUE[name]));
      var p = el("p"); p.appendChild(el("b", "", me ? "You" : name)); p.appendChild(document.createTextNode(text)); row.appendChild(p);
      c.appendChild(row);
      while (c.children.length > 5) c.removeChild(c.firstChild);
      return row;
    }
    async function typing(name, text, ms) {
      var c = $(".pl-chat");
      var t = el("div", "pl-typing"); t.appendChild(avatar(name, HUE[name])); var dots = el("span"); dots.innerHTML = "<i></i><i></i><i></i>"; t.appendChild(dots);
      c.appendChild(t);
      await sleep(ms || 900); alive();
      t.remove();
      return chat(name, text);
    }

    // ---- picking a project ---------------------------------------------------------
    var picks = ORDER.map(function (k, i) {
      var s = IDEAS[k];
      var b = el("button", "pl-pick"); b.type = "button"; b.dataset.idea = k; b.setAttribute("aria-pressed", "false"); b.style.setProperty("--i", String(i));
      var th = el("span", "pl-thumb"); th.innerHTML = THUMB[k]; b.appendChild(th);
      var words = el("span", "pl-pick-words"); words.appendChild(el("b", "", s.name)); words.appendChild(el("small", "", s.blurb)); b.appendChild(words);
      if (built.indexOf(k) >= 0) { b.classList.add("built"); b.appendChild(el("em", "pl-built", "Built")); }
      b.addEventListener("click", function () { pick(k); });
      $(".pl-gallery").appendChild(b);
      return b;
    });
    function typeText(text) {
      clearInterval(typer); box.value = "";
      if (still()) { box.value = text; return; }
      var i = 0;
      typer = setInterval(function () { i += 1 + (Math.random() < 0.3 ? 1 : 0); box.value = text.slice(0, i); if (i >= text.length) clearInterval(typer); }, 22);
    }
    // The box only ever holds one of the six ideas, typed for the visitor.
    function pick(k) {
      if (idea === k) return;
      idea = k;
      picks.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.idea === k)); });
      typeText(IDEAS[k].text);
      $(".pl-crumb .pl-proj").textContent = IDEAS[k].project;
      var line = $(".pl-ask-line"); line.textContent = "What’s next for ";
      line.appendChild(el("span", "pl-proj", IDEAS[k].project)); line.appendChild(document.createTextNode("?"));
      app.classList.add("picked");
    }
    // Mefi's line under the box, as on Social's Home: what it made of the message.
    function mefiSays(text) {
      var old = $(".pl-mefi"); if (old) old.remove();
      var row = el("div", "pl-mefi");
      row.appendChild(el("span", "pl-orb sm"));
      var p = el("p"); p.appendChild(el("b", "", "Mefi")); p.appendChild(document.createTextNode(text)); row.appendChild(p);
      row.appendChild(el("span", "pl-mefi-open", "Open conversation"));
      $(".pl-box").insertAdjacentElement("afterend", row);
      say("Mefi: " + text);
    }
    $(".pl-box").addEventListener("submit", function (e) { e.preventDefault(); });
    // As in Studio: Enter sends (the rails still decide).
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); leave("skip"); return; }
      if (e.key !== "Enter" || app.dataset.step !== "0" || !idea) return;
      var t = e.target;
      if (e.ctrlKey || e.metaKey || !(t instanceof Element) || !t.closest("button, a")) { e.preventDefault(); $(".pl-build").click(); }
    }, on);

    // ---- leaving ---------------------------------------------------------------
    function stop() {
      token.alive = false;
      timers.forEach(clearTimeout); clearInterval(typer);
      hint(null);
      ctl.abort();
    }
    function leave(how) {
      if (leaving) return;
      leaving = true;
      stop();
      var spec = started ? IDEAS[idea] : null;
      if (opts.onLeave) opts.onLeave({ how: how, idea: spec ? idea : null, lead: spec ? spec.lead : null, from: how === "skip" ? $(".pl-skip") : $(".pl-end .pl-enter") || $(".pl-skip") });
    }
    $(".pl-skip").addEventListener("click", function () { leave("skip"); });

    // ---- the play-through ------------------------------------------------------
    async function run() {
      try {
        // Idea: pick a project (a card can be pressed from the first moment), then Send.
        step(0);
        allow(picks);
        var first = picks.filter(function (b) { return !b.classList.contains("built"); })[0] || picks[0];
        await sleep(again ? 500 : 1000); alive();
        if (!idea) { await waitClick([first].concat(picks.filter(function (b) { return b !== first; })), "Pick one", 9000, "above", first); alive(); }
        await waitClick($(".pl-build"), "Send", 12000, "above", null, picks); alive();
        started = true;
        var spec = IDEAS[idea];
        clearInterval(typer); box.value = spec.text;
        app.classList.add("sent");
        await sleep(420); alive();
        box.value = ""; box.placeholder = "Ask Mefi anything, or describe something to make…";
        app.classList.remove("sent");
        mefiSays(spec.talk);

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
        typing("Maxwell", "Ooh, what are you making?", 800).catch(function () {});
        await sleep(1500); alive();
        cards.forEach(function (c) { progress(c, 0.55 + cards.indexOf(c) * 0.07); });
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
        typing("Juno", spec.peek, 900).catch(function () {});
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
        await waitClick(accept, "Accept", 12000, "below", null, [revert]); alive();
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

        // Try it: the finished site opens in a preview window over the board
        step(4);
        tab("friends");
        var made = site(idea, answer);
        var w = openSite(spec, made);
        say(spec.project + " is open in the preview. Try it.");
        await sleep(700); alive();
        await waitClick(made.target, made.label, 9000, made.side || "above", null, [w.body]); alive();
        allow([w.body]);
        await sleep(1700); alive();

        // Share it with friends (the site stays open to play with)
        step(5);
        var share = el("button", "pl-share"); share.type = "button"; share.innerHTML = SVG.friends + "<span>Put it on the Project hub</span>";
        w.bar.appendChild(share);
        await sleep(60); alive();
        share.classList.add("in");
        await waitClick(share, "Share it", 9000, "below", null, [w.body]); alive();
        allow([w.body]);
        share.disabled = true; share.classList.add("sent"); share.innerHTML = SVG.friends + "<span>On the Project hub</span>";
        app.classList.add("shared", "sheet-friends");
        tab("friends");
        chat("You", spec.share, true);
        say("On the Project hub, and Friday hangout knows.");
        await sleep(700); alive();
        for (var k = 0; k < spec.replies.length; k++) {
          var r = spec.replies[k];
          await typing(r[0], r[1], 750); alive();
          if (k === 0) $(".pl-chat").appendChild(el("span", "pl-credit", "+5 credits · " + r[0] + " played it"));
          await sleep(450); alive();
        }
        if (built.indexOf(idea) < 0) built.push(idea);
        await sleep(900); alive();
        end();
      } catch (e) { if (token.alive && window.console) console.warn("Demo stopped:", e); }
    }

    // ---- the end: now the explaining ------------------------------------------------
    function end() {
      hint(null);
      var more = ORDER.some(function (k) { return built.indexOf(k) < 0; });
      var c = el("div", "pl-end");
      c.innerHTML =
        '<div class="pl-end-card" role="document">' +
          '<p class="pl-k">You just used Vibe Studio</p>' +
          '<h2>That’s the whole loop.</h2>' +
          '<ol class="pl-recap">' +
            '<li><b>You said what you wanted.</b> Builders like Claude Code, Codex and OpenCode did the work in your project.</li>' +
            '<li><b>You made the call</b> when it mattered, and nothing landed until you accepted it.</li>' +
            '<li><b>Your friends were there the whole time,</b> and saw it the moment you shared it.</li>' +
          '</ol>' +
          '<p class="pl-end-fine">In Studio a real build takes a few minutes and runs on the AI you choose. This one was sped up and made up.</p>' +
          '<p class="pl-end-fine" data-until="0.5">It shows Studio 0.5, out soon. Until then the download is 0.4.4.</p>' +
          '<div class="pl-end-acts"><button type="button" class="pl-enter">See the site</button>' +
            (more ? '<button type="button" class="pl-again">Try another project</button>' : "") +
            '<a class="pl-get" href="download.html">Download for Windows</a></div>' +
        '</div>';
      root.appendChild(c);
      if (window.SITE && window.SITE.applyRelease) window.SITE.applyRelease();
      requestAnimationFrame(function () { c.classList.add("in"); });
      var enter = c.querySelector(".pl-enter"), anotherBtn = c.querySelector(".pl-again");
      enter.addEventListener("click", function () { leave("done"); });
      if (anotherBtn) anotherBtn.addEventListener("click", function () { if (!leaving) restart(); });
      later(function () { try { enter.focus({ preventScroll: true }); } catch (e) { /* old engines */ } }, 400);
      say("That's the whole loop. See the site, try another project, or download Studio.");
    }

    // ---- the preview window ------------------------------------------------------
    function openSite(spec, made) {
      var win = el("section", "pl-site"); win.setAttribute("aria-label", "Preview of " + spec.project);
      var bar = el("div", "pl-site-bar");
      bar.innerHTML = '<span class="pl-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl-url">' + SVG.lock + "<span>localhost:5173</span></span>";
      bar.appendChild(el("b", "pl-site-name", spec.project));
      var body = el("div", "pl-site-body"); body.appendChild(made.node);
      win.appendChild(bar); win.appendChild(body);
      $(".pl-body").appendChild(win);
      app.classList.add("trying");
      requestAnimationFrame(function () { win.classList.add("in"); });
      later(function () { win.classList.add("in"); }, 120);
      var pv = $("[data-pane='preview']");
      pv.innerHTML = "";
      pv.appendChild(el("p", "pl-k", "Preview"));
      var mini = el("div", "pl-pv-mini"); mini.appendChild(el("b", "", spec.project)); mini.appendChild(el("span", "", "Open in the preview window · localhost:5173")); pv.appendChild(mini);
      if (made.ready) later(made.ready, 650);
      return { win: win, bar: bar, body: body };
    }

    // Confetti from a button, for a moment worth it.
    function burst(host, from) {
      if (still()) return;
      var hr = host.getBoundingClientRect(), fr = from.getBoundingClientRect();
      var x = fr.left - hr.left + fr.width / 2, y = fr.top - hr.top + fr.height / 2;
      var colors = ["var(--accent-bright)", "rgb(var(--accent-2-rgb))", "rgb(var(--accent-3-rgb))", "#ffd479", "#9de8da"];
      for (var i = 0; i < 18; i++) {
        var b = el("i", "pv-bit"), a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 80;
        b.style.left = x + "px"; b.style.top = y + "px";
        b.style.setProperty("--dx", (Math.cos(a) * d).toFixed(0) + "px");
        b.style.setProperty("--dy", (Math.sin(a) * d - 40).toFixed(0) + "px");
        b.style.setProperty("--r", (Math.random() * 540 - 270).toFixed(0) + "deg");
        b.style.setProperty("--c", colors[i % colors.length]);
        host.appendChild(b);
        later(b.remove.bind(b), 1200);
      }
    }
    function head(name, extra) {
      var hd = el("header", "pv-head"); hd.appendChild(el("b", "pv-logo", name));
      if (extra) hd.appendChild(extra);
      return hd;
    }

    // ---- what was built: six small, working sites -------------------------------------
    function site(kind, ans) {
      var s = el("div", "site site-" + kind);
      if (kind === "game") {
        var nav = el("nav"); ["Games", "Snacks", "Who’s going"].forEach(function (t) { nav.appendChild(el("span", "", t)); });
        s.appendChild(head("Game night", nav));
        var hero = el("div", "pv-hero");
        hero.appendChild(el("p", "pv-day", "Friday · 8:00 PM"));
        hero.appendChild(el("h3", "", "Game night at Juno’s"));
        hero.appendChild(el("p", "pv-sub", "Board games, snacks and a very serious Uno rematch."));
        var row = el("div", "pv-rsvp-row"), going = el("div", "pv-going");
        ["Maxwell", "Tess", "Juno"].forEach(function (n) { going.appendChild(avatar(n, HUE[n])); });
        var count = el("span", "", "3 going"); going.appendChild(count);
        var rsvp = el("button", "pv-rsvp", "RSVP"); rsvp.type = "button";
        row.appendChild(going); row.appendChild(rsvp); hero.appendChild(row);
        hero.appendChild(el("p", "pv-fine", ans === "yes" ? "RSVPs close an hour before it starts." : "RSVPs stay open until it starts."));
        s.appendChild(hero);
        s.appendChild(el("p", "pv-k", "Who brings what"));
        var bring = el("ul", "pv-bring");
        [["Snacks", "Maxwell"], ["Uno, the good deck", "Tess"], ["Lemonade", "Juno"]].forEach(function (x) {
          var li = el("li"); li.appendChild(avatar(x[1], HUE[x[1]])); var t = el("span"); t.appendChild(el("b", "", x[0])); t.appendChild(el("small", "", x[1] + " brings it")); li.appendChild(t); bring.appendChild(li);
        });
        s.appendChild(bring);
        rsvp.addEventListener("click", function () {
          if (rsvp.disabled) return;
          rsvp.disabled = true; rsvp.textContent = "You’re going ✓";
          var me = avatar("You"); me.classList.add("pop"); going.insertBefore(me, count); count.textContent = "4 going";
          burst(hero, rsvp);
        });
        return { node: s, target: rsvp, label: "RSVP", side: "below" };
      }

      if (kind === "pixel") {
        var size = ans === "yes" ? 12 : 16, colors = ["#ff8fa3", "#ffd479", "#9de8da", "#a8c5ff", "#c6b4ff", "#f2f4f7"], color = colors[0];
        s.appendChild(head("Pixel pad", el("span", "pv-size", size + " × " + size)));
        var wrap = el("div", "pv-pixel");
        var cv = el("canvas", "pv-canvas"); cv.width = size; cv.height = size;
        var ctx = cv.getContext("2d");
        var clear = function () { ctx.fillStyle = "#16161b"; ctx.fillRect(0, 0, size, size); };
        clear();
        var painting = false;
        var paint = function (e) {
          var r = cv.getBoundingClientRect();
          var px = Math.floor((e.clientX - r.left) / r.width * size), py = Math.floor((e.clientY - r.top) / r.height * size);
          if (px < 0 || py < 0 || px >= size || py >= size) return;
          ctx.fillStyle = color; ctx.fillRect(px, py, 1, 1);
        };
        cv.addEventListener("pointerdown", function (e) { painting = true; cv.setPointerCapture(e.pointerId); paint(e); });
        cv.addEventListener("pointermove", function (e) { if (painting) paint(e); });
        cv.addEventListener("pointerup", function () { painting = false; });
        // When the demo plays itself, it draws a little heart.
        cv.addEventListener("click", function (e) {
          if (e.isTrusted) return;
          var rows = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."], pts = [], ox = Math.floor((size - 7) / 2), oy = Math.floor((size - 6) / 2);
          rows.forEach(function (rr, y) { for (var x = 0; x < rr.length; x++) if (rr[x] === "X") pts.push([ox + x, oy + y]); });
          (function next(n) { if (!token.alive || n >= pts.length) return; ctx.fillStyle = color; ctx.fillRect(pts[n][0], pts[n][1], 1, 1); later(function () { next(n + 1); }, 35); })(0);
        });
        var side = el("div", "pv-pixel-side");
        side.appendChild(el("p", "pv-k", "Colours"));
        var pal = el("div", "pv-pal");
        colors.forEach(function (c) {
          var b = el("button"); b.type = "button"; b.style.setProperty("--c", c); b.setAttribute("aria-label", "Colour " + c); if (c === color) b.className = "on";
          b.addEventListener("click", function () { color = c; Array.prototype.forEach.call(pal.children, function (x) { x.className = x === b ? "on" : ""; }); });
          pal.appendChild(b);
        });
        side.appendChild(pal);
        var tools = el("div", "pv-tools");
        var clr = el("button", "", "Clear"); clr.type = "button"; clr.addEventListener("click", clear);
        var save = el("button", "pv-save", "Save as PNG"); save.type = "button";
        save.addEventListener("click", function () {
          try { var a = document.createElement("a"); a.download = "pixel-art.png"; var big = document.createElement("canvas"); big.width = size * 16; big.height = size * 16; var g = big.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(cv, 0, 0, big.width, big.height); a.href = big.toDataURL("image/png"); a.click(); } catch (err) { /* blocked: nothing to save */ }
        });
        tools.appendChild(clr); tools.appendChild(save); side.appendChild(tools);
        side.appendChild(el("p", "pv-fine", "Drag on the canvas to draw. Save as PNG gives you a real picture."));
        wrap.appendChild(cv); wrap.appendChild(side); s.appendChild(wrap);
        return { node: s, target: cv, label: "Draw" };
      }

      if (kind === "band") {
        var bh = el("div", "pv-band-hero");
        bh.appendChild(el("p", "pv-day", "Live, loud and on time"));
        bh.appendChild(el("h3", "", "The Late Shift"));
        bh.appendChild(el("p", "pv-sub", "Four friends, one van, far too many cables."));
        var gig = el("div", "pv-gig"); gig.appendChild(el("b", "", "Next gig")); gig.appendChild(el("span", "", "Saturday · The Basement · 9 PM")); gig.appendChild(el("small", "", "Doors at 8. Free before 9."));
        var songs = el("ol", "pv-songs"), firstPlay = null;
        [["Night Bus", "3:12"], ["Static Heart", "2:48"], ["Last Train Home", "4:05"]].forEach(function (x) {
          var li = el("li"), b = el("button", "pv-play"); b.type = "button"; b.innerHTML = SVG.play; b.setAttribute("aria-label", "Play " + x[0]);
          var eq = el("span", "pv-eq"); eq.innerHTML = "<i></i><i></i><i></i><i></i>"; eq.setAttribute("aria-hidden", "true");
          li.appendChild(b); li.appendChild(el("span", "pv-song", x[0])); li.appendChild(eq); li.appendChild(el("em", "", x[1])); li.appendChild(el("i", "pv-prog"));
          b.addEventListener("click", function () {
            var play = !li.classList.contains("playing");
            Array.prototype.forEach.call(songs.children, function (o) { o.classList.remove("playing"); o.querySelector(".pv-play").innerHTML = SVG.play; });
            if (play) { li.classList.add("playing"); b.innerHTML = SVG.pause; }
          });
          if (!firstPlay) firstPlay = b;
          songs.appendChild(li);
        });
        var block = el("div", "pv-block"); block.appendChild(el("p", "pv-k", "Songs")); block.appendChild(songs);
        s.appendChild(head("The Late Shift", el("span", "pv-size", "Gigs · Songs · Contact")));
        s.appendChild(bh);
        if (ans === "yes") { s.appendChild(gig); s.appendChild(block); } else { s.appendChild(block); s.appendChild(gig); }
        return { node: s, target: firstPlay, label: "Press play" };
      }

      if (kind === "arcade") return arcade(s, ans);
      if (kind === "timer") return timer(s, ans);
      return plants(s, ans);
    }

    // Star Catch: stars fall, the paddle catches them. Left alone, the paddle plays by itself.
    function arcade(s, ans) {
      var hud = el("span", "pv-hud"), score = el("b", "", "0"), bestEl = el("small", "", "Best 0");
      hud.appendChild(document.createTextNode("Stars ")); hud.appendChild(score); hud.appendChild(bestEl);
      s.appendChild(head("Star Catch", hud));
      var stage = el("div", "pv-stage"), cv = el("canvas", "pv-game"), timeBar = el("i", "pv-timebar");
      var over = el("div", "pv-over"), title = el("p", "pv-over-title", "Catch the falling stars"), sub = el("p", "pv-over-sub", "Move with your mouse, a finger or the arrow keys.");
      var playBtn = el("button", "pv-start", "Play"); playBtn.type = "button";
      over.appendChild(title); over.appendChild(sub); over.appendChild(playBtn);
      stage.appendChild(cv); stage.appendChild(timeBar); stage.appendChild(over);
      s.appendChild(stage);
      s.appendChild(el("p", "pv-fine", ans === "yes" ? "The stars fall faster as you score. A round lasts 16 seconds." : "The stars keep one speed. A round lasts 16 seconds."));
      var ctx = cv.getContext("2d"), W = 0, H = 0, g = null, best = 0, lastPointer = 0, keyDir = 0, raf = 0, ROUND = 16000;
      var acc = getComputedStyle(document.documentElement).getPropertyValue("--accent-bright").trim() || "#cdd8ff";
      var sky = []; for (var i = 0; i < 46; i++) sky.push([Math.random(), Math.random(), Math.random() * 1.3 + 0.4, Math.random() * 6]);
      function size() {
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        W = Math.max(200, cv.clientWidth); H = Math.max(120, cv.clientHeight);
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      function star(x, y, r, rot) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
        ctx.shadowColor = acc; ctx.shadowBlur = 14; ctx.fillStyle = "#fff";
        ctx.beginPath();
        for (var k = 0; k < 8; k++) { var rr = k % 2 ? r * 0.4 : r, a = k * Math.PI / 4; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
      function draw(now) {
        var grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "#0a0c18"); grd.addColorStop(1, "#191330");
        ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fff";
        sky.forEach(function (p) { ctx.globalAlpha = 0.18 + 0.22 * (1 + Math.sin(now / 900 + p[3])) / 2; ctx.fillRect(p[0] * W, p[1] * H, p[2], p[2]); });
        ctx.globalAlpha = 1;
        if (!g) return;
        g.stars.forEach(function (st) { star(st.x, st.y, st.r, st.rot); });
        ctx.fillStyle = acc;
        g.bits.forEach(function (b) { ctx.globalAlpha = Math.max(0, b.life); ctx.fillRect(b.x, b.y, 2.5, 2.5); });
        ctx.globalAlpha = 1;
        var x = g.px - g.pw / 2, y = H - 20, pg = ctx.createLinearGradient(x, 0, x + g.pw, 0);
        pg.addColorStop(0, "#ffffff"); pg.addColorStop(1, acc);
        ctx.fillStyle = pg; ctx.shadowColor = acc; ctx.shadowBlur = 16;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, g.pw, 9, 5); else ctx.rect(x, y, g.pw, 9); ctx.fill();
        ctx.shadowBlur = 0;
      }
      function begin() {
        size();
        g = { t0: performance.now(), last: performance.now(), score: 0, stars: [], bits: [], spawn: 0, px: W / 2, pw: Math.max(56, W * 0.15) };
        score.textContent = "0"; over.classList.add("gone");
        cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
      }
      function tick(now) {
        if (!token.alive || !cv.isConnected) return;
        var dt = Math.min(0.05, (now - g.last) / 1000), left = ROUND - (now - g.t0);
        g.last = now;
        timeBar.style.transform = "scaleX(" + Math.max(0, left / ROUND).toFixed(3) + ")";
        g.spawn -= dt;
        if (g.spawn <= 0) {
          g.stars.push({ x: 14 + Math.random() * (W - 28), y: -12, r: 6 + Math.random() * 4, v: (ans === "yes" ? 115 + g.score * 9 : 130) * (0.85 + Math.random() * 0.3), rot: Math.random() * 3, spin: (Math.random() - 0.5) * 3 });
          g.spawn = ans === "yes" ? Math.max(0.3, 0.62 - g.score * 0.016) : 0.56;
        }
        if (keyDir) { g.px += keyDir * 440 * dt; lastPointer = now; }
        if (now - lastPointer > 900) {
          var low = null; g.stars.forEach(function (st) { if (!low || st.y > low.y) low = st; });
          if (low) g.px += Math.max(-310 * dt, Math.min(310 * dt, low.x - g.px));
        }
        g.px = Math.max(g.pw / 2, Math.min(W - g.pw / 2, g.px));
        var py = H - 20;
        for (var n = g.stars.length - 1; n >= 0; n--) {
          var st = g.stars[n]; st.y += st.v * dt; st.rot += st.spin * dt;
          if (st.y >= py - 6 && st.y <= py + 10 && Math.abs(st.x - g.px) <= g.pw / 2 + st.r * 0.6) {
            g.score++; score.textContent = String(g.score);
            for (var k = 0; k < 10; k++) g.bits.push({ x: st.x, y: py, vx: (Math.random() - 0.5) * 170, vy: -70 - Math.random() * 120, life: 1 });
            g.stars.splice(n, 1);
          } else if (st.y > H + 14) g.stars.splice(n, 1);
        }
        g.bits.forEach(function (b) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 320 * dt; b.life -= dt * 1.7; });
        g.bits = g.bits.filter(function (b) { return b.life > 0; });
        draw(now);
        if (left <= 0) {
          best = Math.max(best, g.score); bestEl.textContent = "Best " + best;
          title.textContent = "Round over · " + g.score + (g.score === 1 ? " star" : " stars");
          sub.textContent = g.score >= 12 ? "That's a lot of stars." : "Try to beat it.";
          playBtn.textContent = "Play again";
          g.stars = [];
          over.classList.remove("gone");
          return;
        }
        raf = requestAnimationFrame(tick);
      }
      function aim(e) { if (!g) return; g.px = e.clientX - cv.getBoundingClientRect().left; lastPointer = performance.now(); }
      cv.addEventListener("pointermove", aim);
      cv.addEventListener("pointerdown", aim);
      document.addEventListener("keydown", function (e) {
        if (!g || !over.classList.contains("gone")) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { keyDir = e.key === "ArrowLeft" ? -1 : 1; e.preventDefault(); }
      }, on);
      document.addEventListener("keyup", function (e) { if (e.key === "ArrowLeft" || e.key === "ArrowRight") keyDir = 0; }, on);
      window.addEventListener("resize", function () { if (cv.isConnected) { size(); if (!g || !over.classList.contains("gone")) draw(performance.now()); } }, on);
      playBtn.addEventListener("click", begin);
      return { node: s, target: playBtn, label: "Play", side: "below", ready: function () { size(); draw(performance.now()); } };
    }

    // Focus Room: a ring that fills over 25 minutes (a minute a second here), then a short break.
    function timer(s, ans) {
      var modes = el("span", "pv-modes"), mf = el("b", "on", "Focus 25"), mb = el("b", "", "Break 5");
      modes.appendChild(mf); modes.appendChild(mb);
      s.appendChild(head("Focus Room", modes));
      var main = el("div", "pv-timer"), clock = el("div", "pv-clock"), ring = el("div", "pv-ring");
      var C = 2 * Math.PI * 84;
      ring.innerHTML = '<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="pv-track" cx="100" cy="100" r="84"/><circle class="pv-fill" cx="100" cy="100" r="84" transform="rotate(-90 100 100)"/></svg>';
      var fill = ring.querySelector(".pv-fill");
      fill.style.strokeDasharray = C.toFixed(1);
      var mid = el("span", "pv-ring-mid"), label = el("small", "pv-mode-label", "Focus"), time = el("b", "pv-time", "25:00");
      mid.appendChild(label); mid.appendChild(time); ring.appendChild(mid);
      var startBtn = el("button", "pv-start", "Start"); startBtn.type = "button";
      clock.appendChild(ring); clock.appendChild(startBtn);
      var side = el("div", "pv-timer-side");
      side.appendChild(el("p", "pv-k", "Focusing with you"));
      var mates = el("ul", "pv-mates");
      [["Juno", "Exams, chapter 4"], ["Rook", "Mixing a song"]].forEach(function (m) {
        var li = el("li"); li.appendChild(avatar(m[0], HUE[m[0]])); var t = el("span"); t.appendChild(el("b", "", m[0])); t.appendChild(el("small", "", m[1])); li.appendChild(t); li.appendChild(el("i", "pv-live-dot")); mates.appendChild(li);
      });
      side.appendChild(mates);
      side.appendChild(el("p", "pv-chime", ans === "yes" ? "♪ A soft chime when the time is up" : "No sound when the time is up"));
      side.appendChild(el("p", "pv-fine", "Sped up for the demo: a minute goes by every second."));
      main.appendChild(clock); main.appendChild(side); s.appendChild(main);
      var mode = "focus", total = 1500, left = 1500, running = false, last = 0, raf = 0;
      function show() {
        var m = Math.floor(left / 60), sec = Math.floor(left % 60);
        time.textContent = (m < 10 ? "0" : "") + m + ":" + (sec < 10 ? "0" : "") + sec;
        fill.style.strokeDashoffset = (C * (left / total)).toFixed(1);
      }
      function swap() {
        var toBreak = mode === "focus";
        mode = toBreak ? "break" : "focus"; total = left = toBreak ? 300 : 1500;
        mf.className = toBreak ? "" : "on"; mb.className = toBreak ? "on" : ""; label.textContent = toBreak ? "Break" : "Focus";
        ring.classList.remove("pv-ding"); void ring.offsetWidth; ring.classList.add("pv-ding");
        if (ans === "yes") { var n = el("span", "pv-note", "♪"); ring.appendChild(n); later(n.remove.bind(n), 1700); }
      }
      function loop(now) {
        if (!token.alive || !s.isConnected || !running) return;
        left = Math.max(0, left - (now - last) / 1000 * 60); last = now;
        if (left <= 0) swap();
        show();
        raf = requestAnimationFrame(loop);
      }
      startBtn.addEventListener("click", function () {
        running = !running;
        startBtn.textContent = running ? "Pause" : "Start";
        ring.classList.toggle("running", running);
        cancelAnimationFrame(raf);
        if (running) { last = performance.now(); raf = requestAnimationFrame(loop); }
      });
      show();
      return { node: s, target: startBtn, label: "Start", side: "below" };
    }

    // Leaf Log: a card for each plant, the thirsty one first.
    function plants(s, ans) {
      var countLine = el("span", "pv-size", "3 plants · 1 thirsty");
      s.appendChild(head("Leaf Log", countLine));
      s.appendChild(el("p", "pv-remind" + (ans === "yes" ? " on" : ""), ans === "yes" ? "Reminders on · Basil is next, on Thursday" : "No reminders · check in when you like"));
      var grid = el("div", "pv-plants"), target = null;
      [["Fern", "fern", "Thirsty · dry for 2 days", 0.14, "thirsty"], ["Basil", "basil", "Okay · water tomorrow", 0.52, "okay"], ["Monstera", "monstera", "Happy · watered Monday", 0.9, "happy"]].forEach(function (p) {
        var c = el("article", "pv-plant " + p[4]);
        var art = el("span", "pv-plant-art"); art.innerHTML = PLANT[p[1]]; c.appendChild(art);
        c.appendChild(el("b", "", p[0]));
        var st = el("small", "", p[2]); c.appendChild(st);
        var gauge = el("i", "pv-gauge"), gi = el("i"); gi.style.setProperty("--w", String(p[3])); gauge.appendChild(gi); c.appendChild(gauge);
        var w = el("button", "pv-water"); w.type = "button"; w.innerHTML = SVG.drop + "<span>Water</span>";
        w.addEventListener("click", function () {
          if (w.disabled) return;
          w.disabled = true;
          gi.style.setProperty("--w", "1");
          c.className = "pv-plant happy watered";
          st.textContent = "Happy · watered just now";
          w.innerHTML = SVG.drop + "<span>Watered</span>";
          if (!still()) for (var d = 0; d < 4; d++) { var dr = el("i", "pv-dropl"); dr.style.left = (30 + d * 12) + "%"; dr.style.animationDelay = (d * 90) + "ms"; c.appendChild(dr); later(dr.remove.bind(dr), 1200); }
          var thirsty = grid.querySelectorAll(".pv-plant.thirsty").length;
          countLine.textContent = "3 plants · " + (thirsty ? thirsty + " thirsty" : "all happy");
        });
        c.appendChild(w); grid.appendChild(c);
        if (!target) target = w;
      });
      s.appendChild(grid);
      return { node: s, target: target, label: "Water it", side: "below" };
    }

    // ---- go --------------------------------------------------------------------------
    tab("friends");
    // the room was already talking before you came in
    chat("Maxwell", "Who's around tonight?");
    chat("Juno", "Me! Make something and show us.");
    later(function () { try { (picks.filter(function (b) { return !b.classList.contains("built"); })[0] || picks[0]).focus({ preventScroll: true }); } catch (e) { /* old engines */ } }, again ? 60 : 700);
    run();
    return { stop: stop };
  }

  // ---- open it --------------------------------------------------------------
  function open(opts) {
    opts = opts || {};
    if (document.getElementById("play")) return null;
    var root = el("div", "play");
    root.id = "play";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Vibe Studio, a playable demo");
    var session = null, built = [];
    function begin(again) {
      if (session) session.stop();
      session = start(root, opts, built, again, function () { begin(true); });
    }
    root.close = function () { if (session) session.stop(); if (root.parentNode) root.parentNode.removeChild(root); };
    document.body.appendChild(root);
    if (opts.from) {
      var r = opts.from.getBoundingClientRect();
      root.style.setProperty("--ox", (r.left + r.width / 2).toFixed(0) + "px");
      root.style.setProperty("--oy", (r.top + r.height / 2).toFixed(0) + "px");
    }
    // Opens on the next frame; a timer covers a tab that hands out no frames.
    requestAnimationFrame(function () { root.classList.add("open"); });
    setTimeout(function () { root.classList.add("open"); }, 140);
    begin(false);
    return root;
  }

  window.MefiPlay = { open: open };
})();
