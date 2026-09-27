// Mefi's Studio AI+ — motion for menus (window.MefiMotion).
//
// Menus here repaint by rebuilding their rows (replaceChildren). That keeps
// their state honest and their code short, but a rebuilt row replays its
// entrance on every push and a row that leaves takes the rest down with a
// jump. These helpers keep the rebuild and fix the pixels:
//
//   keep(root, paint)        rows with the same data-key before and after a
//                            paint stay still (data-kept stops their entrance)
//                            and glide to where they now sit; new rows rise,
//                            cascading; rows that left fade
//                            out from where they were.
//   swap(box, paint, {dir, axis})  a view change: the old view leaves toward where
//                            you came from while the new one arrives from the
//                            side you went (1 deeper, -1 back, 0 across).
//   enter(node, {dir})       one element arrives the same way (a title).
//   glide(mark, target)      a selection mark follows the current item.
//   tally(node, value)       a number counts to its new value.
//
// With motion off (html[data-motion=off], reduced motion) or without layout
// (the tests' fake DOM) each helper just paints; nothing here decides what a
// menu shows. A ghost (.motion-ghost) is held still by vibe.css, which the
// booklet bundles for every page.
(function () {
  "use strict";
  const root = () => document.documentElement;
  function off() {
    const nav = window.MefiNav?.noMotion;
    if (typeof nav === "function") return nav();
    return root()?.dataset?.motion === "off";
  }
  const live = (node) => Boolean(node) && typeof node.animate === "function" && typeof node.getBoundingClientRect === "function" && node.isConnected !== false && !off();
  // Durations and curves come from the motion tokens (styles.css section 1).
  let tokens = null;
  function motion() {
    if (tokens) return tokens;
    let style = null;
    try { style = getComputedStyle(root()); } catch { /* the defaults below */ }
    const read = (name, fallback) => style?.getPropertyValue?.(name)?.trim() || fallback;
    const time = (name, fallback) => {
      const value = read(name, "");
      const number = parseFloat(value);
      if (!Number.isFinite(number)) return fallback;
      return /ms$/.test(value) ? number : /s$/.test(value) ? number * 1000 : number;
    };
    tokens = {
      fast: time("--motion-fast", 140), base: time("--motion-base", 200), slow: time("--motion-slow", 280), spring: time("--motion-spring", 480),
      out: read("--ease-out", "cubic-bezier(.22, .61, .36, 1)"), in: read("--ease-in", "cubic-bezier(.4, 0, 1, 1)"),
      emphasized: read("--ease-emphasized", "cubic-bezier(.2, 0, 0, 1)"), springy: read("--ease-spring", "cubic-bezier(.2, 0, 0, 1)"),
    };
    return tokens;
  }
  const shown = (node) => { const box = node.getBoundingClientRect(); return box.width > 0 || box.height > 0; };
  const setVar = (node, name, value) => { try { node.style.setProperty(name, value); } catch { /* a node without style */ } };
  const later = (fn, ms) => setTimeout(fn, ms);

  // Keyed nodes under a root, in document order. A key seen twice gets #2.
  function keyed(host, selector) {
    const out = new Map();
    const counts = new Map();
    for (const node of host.querySelectorAll?.(selector) ?? []) {
      const base = node.dataset?.key;
      if (!base) continue;
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      out.set(count ? `${base}#${count + 1}` : base, node);
    }
    return out;
  }
  // A leaving element is laid over its old place and fades there. The host
  // must be a containing block (position other than static); a host that is
  // not gets no ghosts, and its rows simply go.
  // Whether a host holds absolute children, read once per host.
  const blocks = new WeakMap();
  function holds(host) {
    if (!blocks.has(host)) { let position = "static"; try { position = getComputedStyle(host).position; } catch { /* static */ } blocks.set(host, position !== "static"); }
    return blocks.get(host);
  }
  function ghost(node, was, host, { lift = -2, duration } = {}) {
    if (!holds(host)) return;
    const copy = node.isConnected ? node.cloneNode(true) : node;
    copy.removeAttribute?.("id");
    copy.removeAttribute?.("hidden");
    for (const inner of copy.querySelectorAll?.("[id]") ?? []) inner.removeAttribute("id");
    copy.setAttribute?.("aria-hidden", "true");
    copy.inert = true;
    copy.classList?.add?.("motion-ghost");
    delete copy.dataset.key;
    const box = host.getBoundingClientRect();
    Object.assign(copy.style, {
      position: "absolute", margin: "0", zIndex: "3", pointerEvents: "none", animation: "none", boxSizing: "border-box",
      top: `${was.top - box.top - (host.clientTop || 0) + (host.scrollTop || 0)}px`,
      left: `${was.left - box.left - (host.clientLeft || 0) + (host.scrollLeft || 0)}px`,
      width: `${was.width}px`, height: `${was.height}px`,
    });
    host.append(copy);
    const time = duration ?? motion().base * 0.8;
    const run = copy.animate([{ opacity: 1, translate: "0 0", scale: 1 }, { opacity: 0, translate: `0 ${lift}px`, scale: 0.97 }], { duration: time, easing: motion().in, fill: "forwards" });
    const done = () => copy.remove();
    run.onfinish = done;
    run.oncancel = done;
    later(done, time + 400);
  }

  /**
   * Repaint `host` with `paint()` and keep its [data-key] nodes steady:
   * { selector = "[data-key]", ghosts = true, cascade = true, ghostHost = host, step = 26 }.
   */
  function keep(host, paint, options = {}) {
    if (!live(host)) { paint(); return; }
    const selector = options.selector ?? "[data-key]";
    const cascade = options.cascade !== false;
    // A host that is off screen (a panel opening) has nothing to glide from:
    // it paints, numbers its rows for their cascade and reads no layout.
    const before = host.closest?.("[hidden]") ? new Map() : keyed(host, selector);
    const rects = new Map();
    for (const [key, node] of before) { const box = node.getBoundingClientRect(); if (box.width || box.height) rects.set(key, box); }
    paint();
    const after = keyed(host, selector);
    const moved = new Map();
    let fresh = 0;
    for (const [key, node] of after) {
      const was = rects.get(key);
      if (!was) {
        delete node.dataset.kept;
        setVar(node, "--i", String(cascade ? Math.min(fresh, 12) : 0));
        setVar(node, "--motion-step", `${options.step ?? 26}ms`);
        fresh += 1;
        continue;
      }
      node.dataset.kept = "";
      const now = node.getBoundingClientRect();
      if (!now.width && !now.height) continue;
      const dx = was.left - now.left, dy = was.top - now.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved.set(node, [dx, dy]);
    }
    // A keyed node inside another that moves travels with it: it only
    // animates its own share of the move.
    for (const [node, [dx, dy]] of moved) {
      let parent = node.parentElement;
      let ox = 0, oy = 0;
      while (parent && parent !== host) {
        const outer = moved.get(parent);
        if (outer) { ox = outer[0]; oy = outer[1]; break; }
        parent = parent.parentElement;
      }
      const x = dx - ox, y = dy - oy;
      if (Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5) continue;
      node.animate([{ translate: `${x}px ${y}px` }, { translate: "0 0" }], { duration: motion().spring * 0.75, easing: motion().springy });
    }
    if (options.ghosts === false) return;
    const ghostHost = options.ghostHost ?? host;
    for (const [key, node] of before) {
      const was = rects.get(key);
      if (!was) continue;
      const now = after.get(key);
      if (now && shown(now)) continue;
      ghost(node, was, ghostHost);
    }
  }

  /** Swap a view in `box`: dir 1 goes deeper, -1 comes back, 0 goes across. */
  function swap(box, paint, { dir = 0, axis = "x" } = {}) {
    const shift = (px) => (axis === "y" ? `0 ${px}px` : `${px}px 0`);
    const host = box?.parentElement;
    if (!live(box) || !host || box.closest?.("[hidden]") || !shown(box)) { paint(); return; }
    const time = motion();
    if (holds(host) && box.childNodes.length) {
      // The old view leaves as it was, scrolled where it was, over the new one.
      // It fades through: out fast, and the new view only starts as it goes,
      // so the two never sit on top of each other half-read.
      const was = box.getBoundingClientRect();
      const outer = host.getBoundingClientRect();
      const copy = box.cloneNode(false);
      copy.removeAttribute("id");
      copy.setAttribute("aria-hidden", "true");
      copy.inert = true;
      copy.classList.add("motion-ghost");
      // Scrolled where it was without writing scrollTop (a write forces a
      // layout): the copy sits higher by the scroll and clips it away.
      const scroll = box.scrollTop;
      copy.append(...box.childNodes);
      Object.assign(copy.style, { position: "absolute", margin: "0", zIndex: "3", pointerEvents: "none", overflow: "hidden", top: `${was.top - outer.top - (host.clientTop || 0) - scroll}px`, left: `${was.left - outer.left - (host.clientLeft || 0)}px`, width: `${was.width}px`, height: `${was.height + scroll}px`, clipPath: scroll ? `inset(${scroll}px 0 0 0)` : "" });
      host.append(copy);
      const run = copy.animate([{ opacity: 1, translate: "0 0" }, { opacity: 0, translate: dir ? shift(-dir * (axis === "y" ? 16 : 28)) : "0 -6px" }], { duration: time.fast * 0.75, easing: time.in, fill: "forwards" });
      const done = () => copy.remove();
      run.onfinish = done;
      run.oncancel = done;
      later(done, time.base + 400);
    }
    const scrolled = box.scrollTop;
    paint();
    if (scrolled) box.scrollTop = 0;
    box.animate([{ opacity: 0, translate: dir ? shift(dir * (axis === "y" ? 22 : 36)) : "0 10px" }, { opacity: 1, offset: 0.45 }, { opacity: 1, translate: "0 0" }], { duration: time.slow + 40, delay: time.fast * 0.55, easing: time.emphasized, fill: "backwards" });
  }
  function enter(node, { dir = 0, delay = 0 } = {}) {
    if (!live(node)) return;
    node.animate([{ opacity: 0, translate: dir ? `${dir * 12}px 0` : "0 4px" }, { opacity: 1, translate: "0 0" }], { duration: motion().slow, delay, easing: motion().emphasized, fill: "backwards" });
  }

  /**
   * Put a selection mark over `target` (both inside the same positioned
   * parent): it springs there through --glide-x/-y/-w/-h. The first time it
   * appears in place rather than flying in from the corner.
   */
  function glide(mark, target) {
    if (!mark) return;
    if (!target || !shown(target)) { if (mark.dataset) mark.dataset.on = "false"; return; }
    const arriving = mark.dataset?.on !== "true";
    if (arriving) mark.style.transition = "none";
    setVar(mark, "--glide-x", `${target.offsetLeft}px`);
    setVar(mark, "--glide-y", `${target.offsetTop}px`);
    setVar(mark, "--glide-w", `${target.offsetWidth}px`);
    setVar(mark, "--glide-h", `${target.offsetHeight}px`);
    if (arriving) {
      void mark.offsetWidth;
      mark.style.transition = "";
    }
    mark.dataset.on = "true";
  }

  /** Count a number up or down to `value` (text only; a label wraps it). */
  function tally(node, value, { format = (number) => String(Math.round(number)) } = {}) {
    if (!node) return;
    const to = Number(value) || 0;
    const from = Number(node.dataset?.value);
    if (node.dataset) node.dataset.value = String(to);
    if (!Number.isFinite(from) || from === to || !live(node) || typeof requestAnimationFrame !== "function") { node.textContent = format(to); return; }
    const start = performance.now();
    const time = motion().slow + 120;
    const step = (at) => {
      if (node.dataset.value !== String(to)) return;
      const t = Math.min(1, (at - start) / time);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  window.MefiMotion = { keep, swap, enter, glide, tally, off };
})();
