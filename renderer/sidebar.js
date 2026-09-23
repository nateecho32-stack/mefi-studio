// The shared project menu stays available from the left edge of every view.
// Hover never takes focus; explicit activation and Escape also work by keyboard.
(function () {
  "use strict";
  const root = document.getElementById("workspace-sidebar");
  const panel = document.getElementById("workspace-sidebar-panel");
  const toggle = document.getElementById("workspace-sidebar-toggle");
  const dismiss = document.getElementById("workspace-sidebar-close");
  const railBrand = document.getElementById("app-rail-brand");
  if (!root || !panel || !toggle || !dismiss) return;

  const hovering = new Set();
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
  function open({ focus = false } = {}) {
    syncBlocked();
    if (blocked()) return false;
    cancelClose();
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
      open();
    });
    zone.addEventListener("pointerleave", () => {
      hovering.delete(zone);
      scheduleClose({ pointerExit: true });
    });
  }
  // The rail's M+ is a separate DOM sibling of the panel. Crossing to it
  // should not dismiss the panel before a deliberate click can toggle it.
  railBrand?.addEventListener("pointerenter", (event) => {
    if (!isOpen() || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    hovering.add(railBrand);
    cancelClose();
  });
  railBrand?.addEventListener("pointerleave", () => {
    hovering.delete(railBrand);
    if (isOpen()) scheduleClose({ pointerExit: true });
  });
  railBrand?.addEventListener("focusout", (event) => {
    if (isOpen() && !root.contains(event.relatedTarget)) scheduleClose();
  });
  toggle.addEventListener("focus", () => { if (!suppressFocusOpen) open(); });
  toggle.addEventListener("click", () => open({ focus: true }));
  dismiss.addEventListener("click", () => close({ restoreFocus: true }));
  root.addEventListener("focusin", cancelClose);
  root.addEventListener("focusout", (event) => {
    if (railBrand?.contains(event.relatedTarget)) { cancelClose(); return; }
    if (!root.contains(event.relatedTarget)) scheduleClose();
  });
  document.addEventListener("pointerdown", (event) => {
    // M+ owns its click toggle. Closing here first would make that click reopen
    // an already open panel, so treat the rail door as part of the menu.
    if (!isOpen()) return;
    if (railBrand?.contains(event.target)) { cancelClose(); return; }
    if (!root.contains(event.target)) close();
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
