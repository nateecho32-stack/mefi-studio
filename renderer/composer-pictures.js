// Pictures on a message (Home's composer; renderer/workspace.js binds it, and any
// other message box can). An Attach picture button, and a picture pasted or dropped
// into the box, are kept by the host (assistant:image: PNG, JPEG, WebP or GIF by its
// bytes, up to 5 MB, four to a message) and shown as thumbnails with a remove button.
//
// The box says what will happen to them. A model that can read images is sent the
// picture; one that can not is told so in the reply; a task's brief names the file.
// Nothing leaves this PC until the message is sent, and the host keeps a picture
// nobody sent only until it tidies up. The host can switch pictures off
// (MEFI_STUDIO_NO_IMAGE_ATTACH=1); the row is then not shown at all.
(() => {
  "use strict";
  const LIMITS = { bytes: 5 * 1024 * 1024, count: 4 };
  const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const bindings = new WeakMap();

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const megabytes = (bytes) => `${(bytes / 1048576).toFixed(bytes % 1048576 === 0 ? 0 : 1)} MB`;
  const sizeText = (bytes) => (bytes >= 1048576 ? megabytes(bytes) : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const api = () => window.mefiStudio;
  const isImage = (file) => String(file?.type || "").startsWith("image/");

  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("That picture could not be read."));
      reader.onload = () => { const text = String(reader.result ?? ""); resolve(text.slice(text.indexOf(",") + 1)); };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Bind a message box. `options`:
   *   scope()    a value that changes when the box's project does (its pictures are dropped then)
   *   blocked()  true while the box can not take input (a send is in flight)
   *   mode()     "chat" or "task": what the message becomes, for what the note under the pictures says
   * Returns { take, clear, refresh, isBusy, count, addFiles }.
   */
  function bind(input, options = {}) {
    if (!input) return null;
    if (bindings.has(input)) return bindings.get(input);
    const state = { images: [], busy: 0, vision: null, off: false, message: "", scope: options.scope?.(), previews: new Map() };
    const blocked = () => input.disabled || input.readOnly || options.blocked?.() === true;

    const row = el("div", "composer-attach");
    const attach = el("button", "ghost mini composer-attach-button", "Attach picture");
    attach.type = "button";
    attach.title = "Add a PNG, JPEG, WebP or GIF, up to 5 MB, up to 4 to a message. You can also paste or drop one into the box.";
    const chooser = el("input");
    chooser.type = "file"; chooser.multiple = true; chooser.hidden = true;
    chooser.setAttribute("accept", TYPES.join(","));
    const thumbs = el("div", "composer-thumbs");
    const note = el("p", "composer-attach-note");
    note.setAttribute("role", "status");
    row.append(attach, chooser, thumbs, note);
    if (typeof input.insertAdjacentElement === "function") input.insertAdjacentElement("afterend", row);
    else if (input.parentNode?.insertBefore) input.parentNode.insertBefore(row, input.nextSibling ?? null);

    const noteText = () => {
      if (state.message) return state.message;
      if (!state.images.length) return "";
      if (options.mode?.() === "task") return "Saved with the project. The task's brief names the file so a builder can open it.";
      // A box whose words carry no picture (the 0.5 session box as a Note) keeps them for its next Ask or Change.
      if (options.mode?.() === "words") return "A note is words only: these pictures wait here and go with an Ask or a Change.";
      const vision = state.vision;
      if (vision?.sees === true) return `Sent to ${vision.model || "this model"}, which can read images. A picture is not redacted the way text is, so check it first.`;
      if (vision?.sees === false) return `${vision.model ? `${vision.model} can't` : "This model can't"} see images. The picture is saved with your message, and the reply will say so.`;
      return "";
    };
    let drawn = "";
    function render() {
      const locked = blocked();
      const said = noteText();
      const signature = JSON.stringify([state.images.map((image) => [image.id, image.name, image.bytes, Boolean(image.thumb), state.previews.has(image.id)]), state.busy, locked, said, state.off]);
      if (signature === drawn) return;
      drawn = signature;
      thumbs.replaceChildren();
      for (const image of state.images) {
        const chip = el("span", "composer-thumb");
        chip.dataset.imageId = image.id;
        const preview = image.thumb || state.previews.get(image.id);
        if (preview) { const img = el("img"); img.setAttribute("src", preview); img.setAttribute("alt", ""); chip.append(img); }
        else chip.append(el("span", "composer-thumb-kind", (image.mime || "").replace("image/", "").toUpperCase() || "IMG"));
        chip.append(el("span", "composer-thumb-name", `${image.name} · ${sizeText(image.bytes)}`));
        const remove = el("button", "composer-thumb-remove", "×");
        remove.type = "button"; remove.setAttribute("aria-label", `Remove ${image.name}`); remove.title = "Remove this picture";
        remove.disabled = locked;
        remove.addEventListener("click", () => removeImage(image.id));
        chip.append(remove);
        thumbs.append(chip);
      }
      if (state.busy) thumbs.append(el("span", "composer-thumb composer-thumb-busy", "Adding…"));
      note.textContent = said;
      note.hidden = !said;
      attach.disabled = locked || state.off || state.images.length + state.busy >= LIMITS.count;
      row.hidden = state.off;
    }
    async function addFiles(files) {
      if (blocked() || state.off) return;
      const wanted = Array.from(files || []);
      if (!wanted.length || !api()?.assistantImage) return;
      const scope = options.scope?.();
      state.message = "";
      for (const file of wanted) {
        if (state.images.length + state.busy >= LIMITS.count) { state.message = `A message can carry up to ${LIMITS.count} pictures.`; break; }
        if (!TYPES.includes(String(file.type || "").toLowerCase())) { state.message = "Pictures can be PNG, JPEG, WebP or GIF."; continue; }
        if (file.size > LIMITS.bytes) { state.message = `${file.name || "That picture"} is ${megabytes(file.size)}; the limit is ${megabytes(LIMITS.bytes)}.`; continue; }
        state.busy += 1; render();
        try {
          const result = await api().assistantImage({ name: file.name || "picture", mime: file.type, data: await readBase64(file) });
          if (options.scope?.() !== scope) continue;
          if (!result?.ok) {
            if (result?.off) state.off = true;
            state.message = result?.error || "The picture could not be added.";
            continue;
          }
          state.vision = result.vision ?? state.vision;
          const image = { id: result.id, name: result.name || file.name || "picture", mime: result.mime || file.type, bytes: result.bytes || file.size, thumb: result.thumb || null };
          if (!image.thumb && typeof URL !== "undefined" && URL.createObjectURL) { try { state.previews.set(image.id, URL.createObjectURL(file)); } catch { /* an icon will do */ } }
          state.images.push(image);
        } catch (error) { state.message = error?.message || "The picture could not be added."; }
        finally { state.busy -= 1; render(); }
      }
      render();
    }
    function forget(id) {
      const url = state.previews.get(id);
      if (url && typeof URL !== "undefined" && URL.revokeObjectURL) { try { URL.revokeObjectURL(url); } catch { /* nothing to free */ } }
      state.previews.delete(id);
    }
    function removeImage(id) {
      // While a message is on its way its pictures stay: the host is reading them.
      if (blocked()) return;
      state.images = state.images.filter((image) => image.id !== id);
      forget(id);
      state.message = "";
      // The host keeps nothing for a picture nobody sent; a failure to say so is not the person's concern.
      Promise.resolve(api()?.assistantImageRemove?.({ id })).catch(() => {});
      render();
      input.focus?.();
    }
    attach.addEventListener("click", () => { if (!blocked()) chooser.click(); });
    chooser.addEventListener("change", () => { const files = Array.from(chooser.files || []); chooser.value = ""; void addFiles(files); });
    input.addEventListener("paste", (event) => {
      const files = Array.from(event.clipboardData?.files || []).filter(isImage);
      if (!files.length || state.off) return;
      // Text copied together with a picture (a web page, a spreadsheet range) is text first: it pastes as it always did.
      if (String(event.clipboardData?.getData?.("text/plain") ?? "").length) return;
      event.preventDefault();
      void addFiles(files);
    });
    // Capture phase, so a dropped picture is this box's before the text-file reader looks at the drop.
    input.addEventListener("drop", (event) => {
      const files = Array.from(event.dataTransfer?.files || []).filter(isImage);
      if (!files.length || state.off) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
      input.classList?.remove("file-drop-active");
      const rest = Array.from(event.dataTransfer.files).filter((file) => !files.includes(file));
      void addFiles(files);
      if (rest.length) window.MefiFileInputs?.addFiles?.(input, rest);
    }, true);
    input.addEventListener("dragover", (event) => {
      // While dragging, a browser shows the kinds but not the files.
      const kinds = Array.from(event.dataTransfer?.items || []).some((item) => String(item?.type || "").startsWith("image/"));
      if (state.off || (!kinds && !Array.from(event.dataTransfer?.files || []).some(isImage))) return;
      event.preventDefault(); event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = blocked() ? "none" : "copy";
    }, true);

    // Ask the host once whether pictures are on at all, so a PC that switched them off never shows the button.
    Promise.resolve(api()?.assistantImage?.({ probe: true })).then((result) => { if (result?.off) { state.off = true; render(); } }).catch(() => {});

    render();
    const controller = {
      /** The ids of the pictures to send with the message. */
      take: () => state.images.map((image) => image.id),
      /** After a message went: the pictures now belong to it. */
      clear: () => { for (const image of state.images) forget(image.id); state.images = []; state.message = ""; state.vision = null; render(); },
      /** After the box's project or purpose changed (or a send began or ended). */
      refresh: () => { const now = options.scope?.(); if (now !== state.scope) { state.scope = now; controller.clear(); } render(); },
      isBusy: () => state.busy > 0,
      count: () => state.images.length,
      addFiles,
    };
    bindings.set(input, controller);
    return controller;
  }

  window.MefiComposerPictures = { bind, get: (input) => bindings.get(input) ?? null, LIMITS, TYPES };
})();
