// The shared project menu stays available from the left edge of every view.
// Hover never takes focus; explicit activation and Escape also work by keyboard.
(function () {
  "use strict";
  const root = document.getElementById("workspace-sidebar");
  const panel = document.getElementById("workspace-sidebar-panel");
  const toggle = document.getElementById("workspace-sidebar-toggle");
  const dismiss = document.getElementById("workspace-sidebar-close");
  if (!root || !panel || !toggle || !dismiss) return;

  const hovering = new Set();
  // How the panel was opened: a hover peek closes when the pointer leaves, a
  // click, a key or a caller keeps it until it is dismissed on purpose.
  let openedBy = null;
  let closeTimer = null;
  let suppressFocusOpen = false;
  const isOpen = () => root.dataset.open === "true";
  const blocked = () => Boolean(window.MefiNav?.state?.transient);
  const cancelClose = () => { clearTimeout(closeTimer); closeTimer = null; };
  function syncBlocked() {
    toggle.disabled = blocked();
    toggle.hidden = blocked();
    root.dataset.blocked = String(blocked());
  }
  function focusToggle() {
    syncBlocked();
    if (blocked()) return;
    // With the navigation rail on, its M+ is the panel's door and this edge
    // strip is not on screen, so focus would fall silently to <body>.
    const brand = document.documentElement?.dataset?.shell === "rail" ? document.getElementById("app-rail-brand") : null;
    if (brand) {
      brand.focus({ preventScroll: true });
      return;
    }
    suppressFocusOpen = true;
    toggle.focus({ preventScroll: true });
    suppressFocusOpen = false;
  }
  function open({ focus = false, by = "sticky" } = {}) {
    syncBlocked();
    if (blocked()) return false;
    cancelClose();
    if (!(by === "hover" && isOpen() && openedBy === "sticky")) openedBy = by;
    window.MefiNav?.paintCurrent?.();
    root.dataset.open = "true";
    panel.inert = false;
    panel.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    if (focus) {
      const target = [...panel.querySelectorAll("[data-nav], button, summary, input, select, a[href]")]
        .find((element) => element !== dismiss && !element.disabled && !element.closest("[hidden], [inert]") && element.getClientRects().length);
      (target ?? dismiss).focus({ preventScroll: true });
    }
    return true;
  }
  function close({ restoreFocus = false } = {}) {
    const wasOpen = isOpen();
    cancelClose();
    hovering.clear();
    openedBy = null;
    root.dataset.open = "false";
    panel.inert = true;
    panel.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) focusToggle();
    return wasOpen;
  }
  function scheduleClose({ pointerExit = false } = {}) {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      const focused = panel.contains(document.activeElement);
      if (!hovering.size && (pointerExit || !focused)) close({ restoreFocus: focused });
    }, 120);
  }
  for (const zone of [toggle, panel]) {
    zone.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      hovering.add(zone);
      open({ by: "hover" });
    });
    zone.addEventListener("pointerleave", () => {
      hovering.delete(zone);
      if (openedBy === "hover") scheduleClose({ pointerExit: true });
    });
  }
  toggle.addEventListener("focus", () => { if (!suppressFocusOpen) open({ by: "hover" }); });
  toggle.addEventListener("click", () => open({ focus: true }));
  dismiss.addEventListener("click", () => close({ restoreFocus: true }));
  root.addEventListener("focusin", cancelClose);
  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget)) scheduleClose();
  });
  // The rail's M+ is the panel's door: its own click toggles the panel, so a
  // press on it must not close first (the click would then re-open it).
  document.addEventListener("pointerdown", (event) => {
    if (isOpen() && !root.contains(event.target) && !event.target?.closest?.("#app-rail-brand")) close();
  });
  window.addEventListener("mefi:nav", (event) => {
    syncBlocked();
    if (event.detail?.action === "open") {
      hovering.clear();
      close();
    }
  });
  window.addEventListener("mefi:project-changed", () => close({ restoreFocus: panel.contains(document.activeElement) }));
  window.addEventListener("blur", () => close({ restoreFocus: panel.contains(document.activeElement) }));
  window.MefiSidebar = { open, close, isOpen, focusToggle };
  close();
  syncBlocked();
})();
