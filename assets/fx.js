/* Mefi Studio website — shared motion and polish (pairs with fx.css).
   Ambient glows, the scroll progress bar, the card spotlight and the theme
   picker in the header. Nothing here is needed to read or use a page. */
(function () {
  "use strict";
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  // ---- ambient glows ------------------------------------------------------
  function ambient() {
    var box = el("div", "ambient", "<i class=\"b1\"></i><i class=\"b2\"></i><i class=\"b3\"></i>");
    box.setAttribute("aria-hidden", "true");
    document.body.insertBefore(box, document.body.firstChild);
  }

  // ---- scroll progress ----------------------------------------------------
  function progress() {
    var bar = el("div", "scroll-progress");
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    var queued = false;
    function update() {
      queued = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.setProperty("--sp", p.toFixed(4));
      bar.classList.toggle("on", window.scrollY > 40 && max > 240);
    }
    window.addEventListener("scroll", function () { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  // ---- cards light up under the cursor ------------------------------------
  var SPOT = ".card, .item, .step, .frame, .faq details, .release-card";
  function spotlight() {
    if (!fine.matches || motion.matches) return;
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

  // ---- theme picker -------------------------------------------------------
  // buildSwatches() is shared with the Home page's "Make it yours" section.
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
      b.addEventListener("click", function () { T.set(id); });
      list.appendChild(b);
      buttons.push(b);
    });
    function sync() { buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.themeId === T.current())); }); }
    T.onChange(sync);
    return list;
  }

  var PALETTE = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-1-.8-1.4-.8-2.3 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3Z\"/><path d=\"M7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01\"/></svg>";

  function themeMenu() {
    var T = window.MefiTheme, host = document.querySelector(".head-actions");
    if (!T || !host) return;
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
    pop.appendChild(el("p", "", "These are Studio's own themes. Your pick is remembered on this device."));
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

  window.MefiFx = { buildSwatches: buildSwatches, el: el };

  document.addEventListener("DOMContentLoaded", function () {
    ambient();
    progress();
    spotlight();
    themeMenu();
  });
})();
