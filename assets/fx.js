/* Mefi Studio website — the shared motion layer (pairs with fx.css).
   Light behind the page, the header and scroll bar, headlines that rise word
   by word, reveals, count-ups, parallax and scroll scenes, the magnetic and
   tilting bits, the cursor's light on cards and the theme picker, whose
   switch spreads out from the click. Nothing here is needed to read or use a
   page, and prefers-reduced-motion keeps it still. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  var root = document.documentElement;
  var still = function () { return reduce.matches; };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // ---- light behind the page ------------------------------------------------
  function ambient() {
    if (document.querySelector(".ambient")) return;
    var box = el("div", "ambient", "<i class=\"b1\"></i><i class=\"b2\"></i><i class=\"b3\"></i>");
    box.setAttribute("aria-hidden", "true");
    document.body.insertBefore(box, document.body.firstChild);
  }

  // ---- the header's scrolled state and the progress bar ---------------------
  function scrollState() {
    var bar = el("div", "scroll-progress");
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    var queued = false;
    function update() {
      queued = false;
      var y = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.setProperty("--sp", (max > 0 ? clamp(y / max, 0, 1) : 0).toFixed(4));
      bar.classList.toggle("on", y > 40 && max > 240);
      root.classList.toggle("is-scrolled", y > 8);
    }
    window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  // ---- headlines that rise word by word --------------------------------------
  // Text nodes become <span class="w"><span class="wi">word</span></span>; an
  // element marked .grad, .nosplit or [data-nosplit] rises as one piece so its
  // gradient stays whole. The words stay plain text for screen readers.
  function unit(content, counter) {
    var w = document.createElement("span"); w.className = "w";
    var wi = document.createElement("span"); wi.className = "wi"; wi.style.setProperty("--wi", String(counter.n++));
    wi.appendChild(content); w.appendChild(wi);
    return w;
  }
  function splitWords(node, counter) {
    Array.prototype.slice.call(node.childNodes).forEach(function (k) {
      if (k.nodeType === 3) {
        var frag = document.createDocumentFragment();
        k.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(part));
          else frag.appendChild(unit(document.createTextNode(part), counter));
        });
        node.replaceChild(frag, k);
      } else if (k.nodeType === 1 && k.tagName !== "BR") {
        if (k.classList.contains("grad") || k.classList.contains("nosplit") || k.hasAttribute("data-nosplit")) {
          var holder = document.createElement("span");
          node.replaceChild(holder, k);
          node.replaceChild(unit(k, counter), holder);
        } else splitWords(k, counter);
      }
    });
  }
  function split(scope) {
    (scope || document).querySelectorAll("[data-split]").forEach(function (h) {
      if (h.classList.contains("split-done")) return;
      if (!still()) splitWords(h, { n: 0 });
      if (h.dataset.splitDelay) h.style.setProperty("--wd", h.dataset.splitDelay + "ms");
      h.classList.add("split-done");
    });
  }

  // ---- count-ups --------------------------------------------------------------
  function count(node) {
    var target = parseFloat(node.dataset.count);
    if (!isFinite(target)) return;
    if (still()) { node.textContent = Math.round(target).toLocaleString(); return; }
    var dur = parseFloat(node.dataset.countMs) || 1700, t0 = performance.now();
    function frame(t) {
      var k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 4);
      node.textContent = Math.round(target * e).toLocaleString();
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---- reveals ---------------------------------------------------------------
  var revealIO = null;
  function shown(t) {
    t.classList.add("in");
    if (t.hasAttribute("data-count")) count(t);
  }
  function reveal(scope) {
    var targets = (scope || document).querySelectorAll("[data-reveal], [data-split], [data-draw], [data-count]");
    if (still() || !("IntersectionObserver" in window)) { targets.forEach(shown); return; }
    root.classList.add("js-reveal");
    (scope || document).querySelectorAll("[data-stagger]").forEach(function (group) {
      var step = parseInt(group.dataset.stagger, 10) || 90, i = 0;
      Array.prototype.forEach.call(group.children, function (child) {
        if (child.hasAttribute("data-reveal")) child.style.setProperty("--rd", (i++ * step) + "ms");
      });
    });
    if (!revealIO) {
      revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { shown(e.target); revealIO.unobserve(e.target); } });
      }, { rootMargin: "0px 0px -9% 0px", threshold: 0 });
    }
    targets.forEach(function (t) { if (!t.classList.contains("in")) revealIO.observe(t); });
  }

  // ---- things that only animate while on screen -----------------------------
  function play() {
    var items = document.querySelectorAll("[data-play]");
    if (!items.length) return;
    if (!("IntersectionObserver" in window)) { items.forEach(function (n) { n.classList.add("playing"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        e.target.classList.toggle("playing", e.isIntersecting);
        e.target.dispatchEvent(new CustomEvent(e.isIntersecting ? "playing" : "paused"));
      });
    }, { rootMargin: "10% 0px 10% 0px" });
    items.forEach(function (n) { io.observe(n); });
  }

  // ---- parallax and scroll scenes ------------------------------------------------
  // [data-parallax="0.12"] gets --py (px) from its distance to the middle of
  // the screen. [data-scene] gets --p from 0 (its top meets the bottom of the
  // screen) to 1 (its bottom leaves the top); [data-scene="pin"], a tall box
  // around a sticky stage, gets --p from 0 to 1 while the stage is pinned.
  // Both send a "scene" event with { p }.
  function scenes() {
    var items = [];
    document.querySelectorAll("[data-parallax]").forEach(function (n) { items.push({ el: n, parallax: true, f: parseFloat(n.dataset.parallax) || 0.1, on: false }); });
    document.querySelectorAll("[data-scene]").forEach(function (n) { items.push({ el: n, pin: n.dataset.scene === "pin", on: false, p: -1 }); });
    if (!items.length) return;
    var queued = false;
    function kick() { if (!queued) { queued = true; requestAnimationFrame(tick); } }
    function tick() {
      queued = false;
      var vh = window.innerHeight;
      items.forEach(function (it) {
        if (!it.on) return;
        var r = it.el.getBoundingClientRect();
        if (it.parallax) {
          if (still()) return;
          it.el.style.setProperty("--py", (-(r.top + r.height / 2 - vh / 2) * it.f).toFixed(1) + "px");
          return;
        }
        var p = it.pin ? -r.top / Math.max(1, r.height - vh) : (vh - r.top) / (vh + r.height);
        p = clamp(p, 0, 1);
        if (Math.abs(p - it.p) > 0.0004) {
          it.p = p;
          it.el.style.setProperty("--p", p.toFixed(4));
          it.el.dispatchEvent(new CustomEvent("scene", { detail: { p: p } }));
        }
      });
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { items.forEach(function (it) { if (it.el === e.target) it.on = e.isIntersecting; }); });
        kick();
      }, { rootMargin: "25% 0px 25% 0px" });
      items.forEach(function (it) { io.observe(it.el); });
    } else items.forEach(function (it) { it.on = true; });
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    kick();
  }

  // ---- the cursor: card light, magnetic buttons, tilting surfaces -------------
  var SPOT = ".card, .item, .step, .faq details, .release-card, .lane, [data-spot]";
  function spotlight() {
    if (!fine.matches || still()) return;
    var queued = false, last = null;
    function run() {
      queued = false;
      var target = last && last.target && last.target.closest ? last.target.closest(SPOT) : null;
      if (!target) return;
      var box = target.getBoundingClientRect();
      target.style.setProperty("--mx", (last.clientX - box.left).toFixed(1) + "px");
      target.style.setProperty("--my", (last.clientY - box.top).toFixed(1) + "px");
      if (!target.classList.contains("spot")) target.classList.add("spot");
    }
    document.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      last = e;
      if (!queued) { queued = true; requestAnimationFrame(run); }
    }, { passive: true });
  }
  function magnetic() {
    if (!fine.matches || still()) return;
    document.querySelectorAll("[data-magnetic]").forEach(function (b) {
      var k = parseFloat(b.dataset.magnetic) || 0.22;
      b.addEventListener("pointermove", function (e) {
        var r = b.getBoundingClientRect();
        var x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
        b.style.transform = "translate(" + (x * k).toFixed(1) + "px," + (y * k * 1.3).toFixed(1) + "px)";
      });
      b.addEventListener("pointerleave", function () { b.style.transform = ""; });
    });
  }
  function tilt() {
    if (!fine.matches || still()) return;
    document.querySelectorAll("[data-tilt]").forEach(function (card) {
      var max = parseFloat(card.dataset.tilt) || 6;
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
        card.classList.add("tilting");
        card.style.transform = "perspective(1400px) rotateX(" + (-py * max).toFixed(2) + "deg) rotateY(" + (px * max).toFixed(2) + "deg)";
        card.style.setProperty("--gx", ((px + 0.5) * 100).toFixed(1) + "%");
        card.style.setProperty("--gy", ((py + 0.5) * 100).toFixed(1) + "%");
      });
      card.addEventListener("pointerleave", function () { card.classList.remove("tilting"); card.style.transform = ""; });
    });
  }

  // ---- the theme switch -------------------------------------------------------
  // With View Transitions the new look spreads out in a circle from the click
  // (or from the middle of the button pressed with a key).
  function setTheme(id, ev) {
    var T = window.MefiTheme;
    if (!T || !T.themes[id] || T.current() === id) return;
    if (typeof document.startViewTransition !== "function" || still() || document.hidden) { T.set(id); return; }
    var x = window.innerWidth / 2, y = window.innerHeight / 2;
    if (ev && (ev.clientX || ev.clientY)) { x = ev.clientX; y = ev.clientY; }
    else if (ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect) { var b = ev.currentTarget.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top + b.height / 2; }
    var r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.style.setProperty("--vx", x.toFixed(0) + "px");
    root.style.setProperty("--vy", y.toFixed(0) + "px");
    root.style.setProperty("--vr", Math.ceil(r + 8) + "px");
    root.classList.add("theme-vt");
    try {
      var vt = document.startViewTransition(function () { T.set(id); });
      vt.finished.finally(function () { root.classList.remove("theme-vt"); });
    } catch (e) { root.classList.remove("theme-vt"); T.set(id); }
  }

  // buildSwatches() is shared with the Home page's theme section.
  function buildSwatches(names) {
    var T = window.MefiTheme;
    var list = el("div", "swatches");
    var buttons = [];
    (names || T.order).forEach(function (id) {
      var t = T.themes[id], c = T.swatch(id);
      var b = el("button", "swatch");
      b.type = "button";
      b.dataset.themeId = id;
      b.setAttribute("aria-pressed", String(T.current() === id));
      b.innerHTML = "<i style=\"--s-bg:" + c.bg + ";--s-accent:" + c.accent + ";--s-bright:" + c.bright + ";--s-2:" + c.a2 + "\"></i><span>" + t.name + "</span>";
      b.addEventListener("click", function (e) { setTheme(id, e); });
      list.appendChild(b);
      buttons.push(b);
    });
    function sync() { buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.themeId === T.current())); }); }
    T.onChange(sync);
    return list;
  }

  var PALETTE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-1-.8-1.4-.8-2.3 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3Z\"/><path d=\"M7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01\"/></svg><i class=\"theme-dot\" aria-hidden=\"true\"></i>";

  function themeMenu() {
    var T = window.MefiTheme, host = document.querySelector(".head-actions");
    if (!T || !host || host.querySelector(".theme-wrap")) return;
    var wrap = el("div", "theme-wrap");
    var btn = el("button", "theme-btn", PALETTE);
    btn.type = "button";
    btn.title = "Colour theme";
    btn.setAttribute("aria-label", "Change the colour theme");
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    var pop = el("div", "theme-pop");
    pop.hidden = true;
    pop.setAttribute("role", "group");
    pop.setAttribute("aria-label", "Colour theme");
    var plain = T.order.filter(function (id) { return !T.themes[id].collection; });
    var duo = T.order.filter(function (id) { return T.themes[id].collection === "void"; });
    pop.appendChild(el("h2", "", "Colour theme"));
    pop.appendChild(buildSwatches(plain));
    pop.appendChild(el("h3", "", "The Void collection"));
    pop.appendChild(buildSwatches(duo));
    pop.appendChild(el("p", "", "Studio's own twelve themes, all free. The site wears your pick too, and remembers it on this device."));
    wrap.appendChild(btn);
    wrap.appendChild(pop);
    host.insertBefore(wrap, host.firstChild);

    function open(on) {
      pop.hidden = !on;
      btn.setAttribute("aria-expanded", String(on));
      if (on) { var pick = pop.querySelector("[aria-pressed=\"true\"]") || pop.querySelector("button"); if (pick) pick.focus({ preventScroll: true }); }
    }
    btn.addEventListener("click", function () { open(pop.hidden); });
    document.addEventListener("click", function (e) { if (!pop.hidden && !wrap.contains(e.target)) open(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pop.hidden) { open(false); btn.focus(); } });
  }

  window.MefiFx = { buildSwatches: buildSwatches, el: el, setTheme: setTheme, count: count, split: split, reveal: reveal, still: still };

  document.addEventListener("DOMContentLoaded", function () {
    ambient();
    scrollState();
    split();
    reveal();
    play();
    scenes();
    spotlight();
    magnetic();
    tilt();
    themeMenu();
  });
})();
