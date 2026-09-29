// Compact card grids shared by Tasks and Ideas. CSS supplies 4px rows;
// each card reserves its measured height plus the 12px space below it.
(function () {
  "use strict";
  const ROW = 4, GAP = 12;

  function create({ lists, visible = () => true }) {
    let observer = null, frame = 0, watching = false;
    const animations = new Set();
    function layout() {
      frame = 0;
      if (!watching || !visible() || typeof getComputedStyle !== "function") return;
      const glide = !window.MefiMotion?.off?.() && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      const placed = [], spans = [];
      for (const list of lists().filter(Boolean)) {
        if (!list.getBoundingClientRect().width) continue;
        const on = getComputedStyle(list).gridAutoRows === `${ROW}px`;
        for (const item of list.children) {
          const before = item.getBoundingClientRect();
          if (glide && on && item.style.gridRowEnd) placed.push({ item, before });
          // Sheet entrance transforms must not shrink the reserved space.
          // offsetHeight measures the card's layout size before transforms.
          const height = Number.isFinite(item.offsetHeight) ? item.offsetHeight : before.height;
          spans.push([item, on ? `span ${Math.max(1, Math.ceil((height + GAP) / ROW))}` : ""]);
        }
      }
      let changed = false;
      for (const [item, value] of spans) if (item.style.gridRowEnd !== value) { item.style.gridRowEnd = value; changed = true; }
      if (!changed) return;
      for (const { item, before } of placed) {
        if (typeof item.animate !== "function") continue;
        const after = item.getBoundingClientRect();
        const dx = before.left - after.left, dy = before.top - after.top;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
        const animation = item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
        if (animation) {
          animations.add(animation);
          animation.onfinish = animation.oncancel = () => animations.delete(animation);
        }
      }
    }
    function schedule() {
      if (watching && !frame && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(layout);
    }
    function refresh({ immediate = false } = {}) {
      watching = visible();
      observer?.disconnect();
      if (!watching) { stop(); return; }
      if (typeof ResizeObserver === "function") {
        observer ??= new ResizeObserver(schedule);
        for (const list of lists().filter(Boolean)) {
          observer.observe(list);
          for (const item of list.children) observer.observe(item);
        }
      }
      if (immediate) {
        if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
        layout();
      } else schedule();
    }
    function stop() {
      watching = false;
      observer?.disconnect();
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      frame = 0;
      for (const animation of animations) animation.cancel();
      animations.clear();
    }
    return { refresh, stop };
  }

  window.MefiCardLayout = { create };
})();
