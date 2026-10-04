// A keyed DOM patcher, so a push from the host never rebuilds what the person is
// using. Rebuilding a region with innerHTML throws away the focused field and
// its draft, the scroll position, an open <details>, and every <video> and
// <iframe> in it (a playing video restarts). MefiPatch.morph(host, source) makes
// `host`'s children match `source` by changing only what differs:
//
//   * an element with data-key (or an id) keeps its node wherever it moves to;
//     one without is matched by tag and position;
//   * attributes, text and children are updated in place, so a node keeps its
//     focus, its scroll and its listeners;
//   * a control keeps what the person typed or chose: its live value, checked or
//     selected state only changes when the markup's own value changed since the
//     last patch (the app changed its mind, for instance clearing a box after
//     Send); a <details> keeps its own open state until the markup's open moves;
//   * an element with data-keep (a player, a preview frame) is never touched
//     inside, and moves with Node.moveBefore where the browser has it, which
//     keeps its state, else with insertBefore;
//   * attributes a script owns stay: list them in data-mp-own="class style" on
//     the live element (a class a script toggles, an inline style it sets);
//   * inline handlers (on*), srcdoc, javascript: URLs and <script> in the source
//     are dropped, never copied to a live node.
//
// `source` is an HTML string (trusted, made by the app), an Element (its children
// are the target) or a DocumentFragment. No dependencies; the only global is
// window.MefiPatch. Verified in a real renderer by tests/patch_render.test.mjs.
(function () {
  "use strict";
  const KEEP = "data-keep";
  const KEY = "data-key";
  const OWN = "data-mp-own";
  const UNSAFE_ATTR = /^(?:on|srcdoc$)/i;
  const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction"]);
  const UNSAFE_URL = /^\s*(?:javascript|vbscript):/i;

  const keyOf = (node) => (node.nodeType === 1 ? node.getAttribute(KEY) ?? (node.id || null) : null);
  const sameKind = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
  const unsafe = (attr) => UNSAFE_ATTR.test(attr.name) || (URL_ATTRS.has(attr.name.toLowerCase()) && UNSAFE_URL.test(attr.value));

  // Where a node goes without being reloaded: moveBefore keeps an iframe, a video and the focus.
  function place(parent, node, before) {
    if (node.parentNode === parent && node.nextSibling === before) return;
    if (typeof parent.moveBefore === "function" && node.parentNode === parent && parent.isConnected) {
      try { parent.moveBefore(node, before); return; } catch { /* a move the browser refuses is an insert */ }
    }
    parent.insertBefore(node, before);
  }

  // A copy of a source node that is safe to put on the page.
  function adopt(node) {
    const owned = document.importNode(node, true);
    if (owned.nodeType === 1) scrub(owned);
    return owned;
  }
  function scrub(element) {
    for (const attr of [...element.attributes]) if (unsafe(attr)) element.removeAttribute(attr.name);
    for (const script of [...element.querySelectorAll("script")]) script.remove();
    for (const node of element.querySelectorAll("*")) for (const attr of [...node.attributes]) if (unsafe(attr)) node.removeAttribute(attr.name);
  }

  function patchAttributes(live, fresh) {
    const owned = new Set((live.getAttribute(OWN) || "").split(/\s+/).filter(Boolean));
    const wanted = new Set();
    for (const attr of fresh.attributes) {
      if (unsafe(attr) || attr.name === OWN) continue;
      wanted.add(attr.name);
      // A <details> is opened and closed by the person.
      if (live.tagName === "DETAILS" && attr.name === "open") continue;
      if (owned.has(attr.name)) continue;
      if (live.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value);
    }
    if (fresh.hasAttribute(OWN) && live.getAttribute(OWN) !== fresh.getAttribute(OWN)) live.setAttribute(OWN, fresh.getAttribute(OWN));
    for (const attr of [...live.attributes]) {
      if (wanted.has(attr.name) || attr.name === OWN || owned.has(attr.name) || attr.name.startsWith("data-mp-")) continue;
      if (live.tagName === "DETAILS" && attr.name === "open") continue;
      live.removeAttribute(attr.name);
    }
  }

  // A <details> is opened and closed by the person; the markup only moves it when the app's own
  // opinion changed (its markup went from closed to open, or back), remembered in data-mp-open.
  function patchDetails(live, fresh) {
    const opinion = fresh.hasAttribute("open");
    const before = live.getAttribute("data-mp-open");
    if (before === null) live.setAttribute("data-mp-open", opinion ? "1" : "0");
    else if ((before === "1") !== opinion) { live.open = opinion; live.setAttribute("data-mp-open", opinion ? "1" : "0"); }
  }

  // A control's live state follows the markup only when the markup's own opinion moved.
  function patchControl(live, fresh, was) {
    if (live.tagName === "TEXTAREA") {
      const next = fresh.textContent;
      if (was.text !== next) { live.defaultValue = next; live.value = next; }
      return;
    }
    if (live.tagName === "INPUT") {
      const next = fresh.getAttribute("value");
      // A file input's value is the browser's alone; a checkbox's value is not what it shows.
      if (was.value !== next && !/^(?:checkbox|radio|file|button|submit|reset|image)$/.test(live.type)) live.value = next ?? "";
      if (was.checked !== fresh.hasAttribute("checked")) live.checked = fresh.hasAttribute("checked");
      return;
    }
    if (live.tagName === "OPTION" && was.selected !== fresh.hasAttribute("selected")) live.selected = fresh.hasAttribute("selected");
  }

  const opinion = (node) => (node.tagName === "TEXTAREA" ? { text: node.defaultValue } : { value: node.getAttribute("value"), checked: node.hasAttribute("checked"), selected: node.hasAttribute("selected") });

  function patchNode(live, fresh) {
    if (live.nodeType === 3 || live.nodeType === 8) {
      if (live.data !== fresh.data) live.data = fresh.data;
      return;
    }
    const was = opinion(live);
    patchAttributes(live, fresh);
    if (live.tagName === "DETAILS") patchDetails(live, fresh);
    if (live.tagName === "TEXTAREA" || live.tagName === "INPUT") { patchControl(live, fresh, was); return; }
    if (live.tagName === "OPTION") { patchControl(live, fresh, was); patchChildren(live, fresh); return; }
    // A player or a preview frame (keyed, so it is known to be the same one) is not patched inside.
    if (live.hasAttribute(KEEP) && fresh.hasAttribute(KEEP) && keyOf(live) !== null && keyOf(live) === keyOf(fresh)) return;
    patchChildren(live, fresh);
  }

  function patchChildren(liveParent, freshParent) {
    // A script is never copied over, whether it is a child here or inside something that is.
    const fresh = [...freshParent.childNodes].filter((node) => !(node.nodeType === 1 && node.tagName === "SCRIPT"));
    const old = [...liveParent.childNodes];
    const keyed = new Map();
    const unkeyed = [];
    for (const node of old) {
      const key = keyOf(node);
      if (key === null) unkeyed.push(node);
      else if (!keyed.has(key)) keyed.set(key, node);
    }
    const order = [];
    const used = new Set();
    let next = 0;
    for (const source of fresh) {
      const key = keyOf(source);
      let match = null;
      if (key !== null) {
        const candidate = keyed.get(key);
        if (candidate && !used.has(candidate) && sameKind(candidate, source)) match = candidate;
      } else if (next < unkeyed.length && sameKind(unkeyed[next], source)) {
        match = unkeyed[next];
        next += 1;
      }
      if (match) patchNode(match, source);
      const node = match ?? adopt(source);
      used.add(node);
      order.push(node);
    }
    for (const node of old) if (!used.has(node)) liveParent.removeChild(node);
    let before = liveParent.firstChild;
    for (const node of order) {
      if (node === before) { before = before.nextSibling; continue; }
      place(liveParent, node, before);
    }
  }

  function fragmentOf(source) {
    if (typeof source !== "string") return source;
    const template = document.createElement("template");
    template.innerHTML = source;
    return template.content;
  }

  // Make host's children match source. Returns host.
  function morph(host, source) {
    patchChildren(host, fragmentOf(source));
    return host;
  }

  window.MefiPatch = { morph };
})();
