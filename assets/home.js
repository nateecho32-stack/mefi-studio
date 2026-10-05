/* Mefi Studio — home page extras: the hero's drifting node sky, the hero
   screenshot easing flat as you scroll, and a larger view for screenshots.
   The page reads fine without any of it. */
(function () {
  "use strict";
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---- hero sky: nodes that drift and link up, like Command view ----------
  const canvas = document.querySelector(".hero-sky");
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    // The sky wears the page's theme: accent, bright accent, and the two companions.
    const CHANNELS = ["--accent-rgb", "--bright-rgb", "--accent-3-rgb", "--accent-2-rgb"];
    const FALLBACK = ["195,200,208", "238,241,245", "198,180,255", "168,197,255"];
    let colors = FALLBACK.slice();
    const readColors = () => {
      colors = CHANNELS.map((name, i) => {
        const c = window.MefiTheme && window.MefiTheme.channel(name);
        return c ? c.join(",") : FALLBACK[i];
      });
    };
    readColors();
    let w = 0, h = 0, nodes = [], frame = 0, onScreen = true;
    const make = () => {
      const count = Math.round(Math.min(70, Math.max(24, (w * h) / 26000)));
      nodes = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: i % 9 === 0 ? 3.2 : 1.2 + Math.random() * 1.4,
        c: i % 7 === 0 ? 2 + (i % 2) : i % 2,
        p: Math.random() * Math.PI * 2,
      }));
    };
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      make();
    };
    const draw = (t) => {
      ctx.clearRect(0, 0, w, h);
      const reach = Math.min(170, w / 7);
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < reach) {
            ctx.strokeStyle = `rgba(${colors[a.c]},${(1 - d / reach) * 0.22})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        const pulse = 0.65 + 0.35 * Math.sin(t / 900 + n.p);
        ctx.fillStyle = `rgba(${colors[n.c]},${0.55 * pulse + 0.2})`;
        ctx.shadowColor = `rgba(${colors[n.c]},0.8)`; ctx.shadowBlur = n.r > 3 ? 14 : 6;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    };
    const running = () => onScreen && !document.hidden && !motion.matches;
    const step = (t) => {
      frame = 0;
      if (!running()) return;
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
      }
      draw(t);
      frame = requestAnimationFrame(step);
    };
    const wake = () => { if (running() && !frame) frame = requestAnimationFrame(step); else if (!running()) draw(0); };
    size();
    draw(0);
    // Only animate while the hero is on screen and the tab is visible.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; wake(); }).observe(canvas);
    }
    document.addEventListener("visibilitychange", wake);
    motion.addEventListener?.("change", wake);
    // A new theme repaints the sky (a still sky needs an explicit redraw).
    document.addEventListener("mefi-theme", () => { readColors(); if (!running()) draw(0); });
    wake();
    let resizeTimer = 0;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { size(); draw(0); }, 150); });
  }

  // ---- hero screenshot eases flat as the page scrolls ---------------------
  // --tilt runs from 1 (tipped back, at the top of the page) to 0 (flat) over
  // the scroll that brings the screenshot up the screen, on a smooth curve.
  const shot = document.querySelector(".hero-shot");
  if (shot) {
    let end = 400, queued = false, last = -1;
    const measure = () => {
      const top = shot.getBoundingClientRect().top + window.scrollY;
      end = Math.max(160, top - window.innerHeight * 0.2);
    };
    const apply = () => {
      queued = false;
      const p = Math.min(1, Math.max(0, window.scrollY / end));
      const rest = 1 - p;
      const tilt = Math.round(rest * rest * (3 - 2 * rest) * 1000) / 1000;
      if (tilt !== last) { last = tilt; shot.style.setProperty("--tilt", String(tilt)); }
    };
    const queue = () => { if (!queued && !motion.matches) { queued = true; requestAnimationFrame(apply); } };
    const setMode = () => {
      if (motion.matches) { shot.classList.remove("tilt"); return; }
      measure(); apply(); shot.classList.add("tilt");
    };
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", () => { measure(); queue(); });
    motion.addEventListener?.("change", setMode);
    setMode();
  }

  // ---- screenshots open larger --------------------------------------------
  const box = document.querySelector("dialog.lightbox");
  if (box && typeof box.showModal === "function") {
    const big = box.querySelector("img");
    let opener = null;
    document.querySelectorAll("a.zoom").forEach((link) => {
      link.addEventListener("click", (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const img = link.querySelector("img");
        big.src = link.getAttribute("href");
        big.alt = img ? img.alt : "";
        opener = link;
        box.showModal();
      });
    });
    // Any click (the picture, the backdrop or Close) closes it; so does Escape.
    box.addEventListener("click", () => box.close());
    box.addEventListener("close", () => { big.removeAttribute("src"); if (opener) opener.focus(); });
  }

  // ---- 0.5 first look: a tab row that shows one screen at a time ----------
  // Without script every panel shows, one under the other.
  const look = document.querySelector("[data-look]");
  if (look) {
    const tabs = Array.from(look.querySelectorAll('[role="tab"]'));
    const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
    look.classList.add("js-look");
    const show = (index, focus) => {
      tabs.forEach((tab, i) => {
        const on = i === index;
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
        if (panels[i]) panels[i].hidden = !on;
      });
      if (focus) tabs[index].focus();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => show(i, false));
      tab.addEventListener("keydown", (event) => {
        const last = tabs.length - 1;
        const to = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[event.key];
        if (to === undefined) return;
        event.preventDefault();
        show(to, true);
      });
    });
    show(Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true")), false);
  }
})();
