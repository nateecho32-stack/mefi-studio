/* Mefi's Studio AI+ — landing page extras: the hero's drifting node tree,
   reveal-on-scroll and a screenshot lightbox. The page reads fine without it. */
(function () {
  "use strict";
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("js");

  // ---- hero sky: nodes that drift and link up, like Command view ----------
  const canvas = document.querySelector(".hero-sky");
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    const colors = ["113,203,183", "167,243,218", "124,108,255", "54,209,255"];
    let w = 0, h = 0, dpr = 1, nodes = [], frame = 0, visible = true;
    const make = () => {
      const count = Math.round(Math.min(70, Math.max(26, (w * h) / 26000)));
      nodes = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: i % 9 === 0 ? 3.2 : 1.2 + Math.random() * 1.4,
        c: colors[i % 7 === 0 ? 2 + (i % 2) : i % 2],
        p: Math.random() * Math.PI * 2,
      }));
    };
    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
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
          const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
          if (d < reach) {
            ctx.strokeStyle = `rgba(${a.c},${(1 - d / reach) * 0.22})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        const pulse = 0.65 + 0.35 * Math.sin(t / 900 + n.p);
        ctx.fillStyle = `rgba(${n.c},${0.55 * pulse + 0.2})`;
        ctx.shadowColor = `rgba(${n.c},0.8)`; ctx.shadowBlur = n.r > 3 ? 14 : 6;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    };
    const step = (t) => {
      frame = 0;
      if (!visible) return;
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
      }
      draw(t);
      frame = requestAnimationFrame(step);
    };
    size();
    if (still) draw(0);
    else {
      frame = requestAnimationFrame(step);
      // Only animate while the hero is on screen or the tab is visible.
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting && !document.hidden;
        if (visible && !frame) frame = requestAnimationFrame(step);
      }).observe(canvas);
      document.addEventListener("visibilitychange", () => {
        visible = !document.hidden;
        if (visible && !frame) frame = requestAnimationFrame(step);
      });
    }
    let resizeTimer = 0;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { size(); if (still) draw(0); }, 150); });
  }

  // ---- hero screenshot settles flat once you start scrolling -------------
  const shot = document.querySelector(".hero-shot");
  if (shot) {
    const settle = () => { if (window.scrollY > 40) { shot.classList.add("settled"); window.removeEventListener("scroll", settle); } };
    window.addEventListener("scroll", settle, { passive: true });
    settle();
  }

  // ---- reveal on scroll ---------------------------------------------------
  const targets = document.querySelectorAll(".section-intro, .steps4 li, .split > *, .frame-wide, .grid3 .card, .fcard, .duo .frame, .themes li, .trust, .final-inner");
  if (!still && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    targets.forEach((el, i) => { el.classList.add("reveal"); el.style.transitionDelay = `${(i % 3) * 70}ms`; io.observe(el); });
  }

  // ---- lightbox -----------------------------------------------------------
  const box = document.querySelector(".lightbox");
  if (box && typeof box.showModal === "function") {
    const big = box.querySelector("img");
    document.querySelectorAll(".frame img, .fcard img, .themes img").forEach((img) => {
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", `Enlarge: ${img.alt || "screenshot"}`);
      const open = () => { big.src = img.currentSrc || img.src; big.alt = img.alt; box.showModal(); };
      img.addEventListener("click", open);
      img.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    box.addEventListener("click", (e) => { if (e.target === box || e.target.classList.contains("lightbox-close")) box.close(); });
  }
})();
