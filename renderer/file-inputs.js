// Import explicitly chosen text/code files into an editable, unsent draft.
// File APIs keep this independent of Electron paths and arbitrary host reads.
(() => {
  "use strict";
  const bindings = new WeakMap();
  const extensions = /\.(?:txt|md|mdx|rst|adoc|csv|tsv|json|jsonc|ya?ml|toml|xml|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|lua|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|vue|svelte|sh|ps1|sql)$/i;
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files") || event.dataTransfer?.files?.length;
  function bind(input, { scope = () => "", blocked = () => false, limit = 16000 } = {}) {
    if (!input || bindings.has(input)) return;
    const bar = document.createElement("div"); bar.className = "file-input-tools";
    const pick = document.createElement("button"); pick.type = "button"; pick.className = "ghost mini"; pick.textContent = "Add files";
    const picker = document.createElement("input"); picker.type = "file"; picker.multiple = true; picker.hidden = true;
    const status = document.createElement("span"); status.setAttribute("role", "status"); status.textContent = "Drop text or code files into the box";
    bar.append(pick, picker, status); input.insertAdjacentElement("afterend", bar);
    const state = { reading: false }; bindings.set(input, state);
    const unavailable = () => input.disabled || input.readOnly || blocked();
    async function add(files, selectedScope = scope()) {
      if (unavailable() || state.reading) return;
      const selected = Array.from(files || []);
      if (!selected.length) return;
      if (selected.length > 8) { status.textContent = "Choose up to 8 files at a time."; return; }
      state.reading = true; pick.disabled = true; status.textContent = "Reading files…";
      const blocks = [], errors = [];
      const cap = Math.min(limit, input.maxLength > 0 ? input.maxLength : limit);
      let used = input.value.length;
      try {
        for (const file of selected) {
          const name = String(file.name || "file").replace(/[\r\n]/g, " ");
          if (!extensions.test(name)) { errors.push(`${name}: choose a text or code file (PDFs, images and folders aren't supported here).`); continue; }
          if (file.size > 128 * 1024) { errors.push(`${name}: exceeds 128 KB.`); continue; }
          try {
            const buffer = await file.slice(0, 128 * 1024 + 1).arrayBuffer();
            if (buffer.byteLength > 128 * 1024) throw new Error("exceeds 128 KB");
            const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
            if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new Error("contains binary data");
            const block = `\n\n--- Attached file: ${name} ---\n${text}\n--- End attached file ---`;
            if (used + block.length > cap) throw new Error(`won't fit in this draft (${cap.toLocaleString()} characters); use a smaller excerpt`);
            used += block.length; blocks.push(block);
          } catch (error) { errors.push(`${name}: ${error.message}.`); }
        }
        if (scope() !== selectedScope || !input.isConnected || unavailable()) { status.textContent = "The draft changed. Add the files again in the intended box."; return; }
        const addition = blocks.join("");
        if (input.value.length + addition.length > cap) { status.textContent = "The draft grew while reading. Add a smaller excerpt."; return; }
        if (addition) { input.value += addition; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); }
        status.textContent = [blocks.length ? `${blocks.length} file${blocks.length === 1 ? "" : "s"} added to the draft. Review before sending.` : "No files added.", ...errors].join(" ");
      } finally { state.reading = false; pick.disabled = false; picker.value = ""; }
    }
    let pickerScope;
    pick.addEventListener("click", () => { if (!unavailable()) { pickerScope = scope(); picker.click(); } });
    picker.addEventListener("change", () => { void add(picker.files, pickerScope); });
    input.addEventListener("dragover", (event) => { if (hasFiles(event)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = unavailable() ? "none" : "copy"; input.classList.add("file-drop-active"); } });
    input.addEventListener("dragleave", () => input.classList.remove("file-drop-active"));
    input.addEventListener("drop", (event) => { if (hasFiles(event)) { event.preventDefault(); event.stopPropagation(); input.classList.remove("file-drop-active"); void add(event.dataTransfer.files); } });
  }
  // A file dropped outside supported surfaces must never navigate away.
  for (const name of ["dragover", "drop"]) document.addEventListener(name, (event) => { if (hasFiles(event)) event.preventDefault(); });
  window.MefiFileInputs = { bind, isReading: (input) => bindings.get(input)?.reading === true };
})();
