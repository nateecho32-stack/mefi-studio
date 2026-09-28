// Friends › Your PCs › Share between my PCs, and Share with friends. The vault
// is one private GitHub repository sealed with a key only the owner's paired
// PCs hold (main.cjs "Your PCs vault", scripts/pc-vault.cjs). This file lays
// out what main answers: making or pairing the vault, each PC's line, what a
// shelf offers with what Studio found in it, what the other PCs shared, the
// library of kept items, and keys and setup behind the exact typed
// confirmation. A friend share is one scrubbed item in a file the owner saves
// where they like; an opened one is reviewed before it can be kept. Text only:
// nothing here is set as HTML, and key values never reach this page.
// renderer/pc-sync.js mounts both sections in the Your PCs card.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const bridge = () => window.mefiStudio;
  const FRIEND_SHELVES = [["brains", "Agent brains"], ["recipes", "Playbook recipes"], ["presets", "Agent team setups"], ["insights", "How models did"], ["claude-memory", "Claude Code memory notes"], ["settings", "Studio preferences"]];
  const KEY_NAMES = { opencode: "OpenCode Go", zai: "z.ai", zen: "OpenCode Zen", openrouter: "OpenRouter", gateway: "AI gateway", jev: "Jev", custom: "Custom endpoint key", github: "GitHub token", customEndpoint: "Custom endpoint address", lmStudioEndpoint: "LM Studio address" };
  const when = (at) => (Number.isFinite(at) ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
  function button(label, id, onClick, cls = "ghost pc-sync-run") {
    const el = node("button", cls, label);
    el.type = "button";
    if (id) el.id = id;
    el.addEventListener("click", () => { void onClick(); });
    return el;
  }
  const heading = (text) => node("h5", "pc-vault-heading", text);
  // One finding per line, the stopping ones first as main sent them.
  function reasonList(reasons) {
    const list = node("ul", "pc-vault-reasons");
    for (const reason of reasons ?? []) list.append(node("li", reason.startsWith("Stopped") ? "pc-vault-stop" : "muted", reason));
    list.hidden = !list.children.length;
    return list;
  }
  function preview(text) {
    const box = node("details", "pc-vault-preview");
    box.append(node("summary", "", "What leaves"), node("pre", "", text || ""));
    return box;
  }

  function section() {
    const api = bridge();
    const box = node("details", "pc-vault");
    box.id = "pc-vault";
    const status = node("p", "muted pc-vault-status", "Keeps what you choose in step across your PCs.");
    status.id = "pc-vault-status";
    status.setAttribute("role", "status");
    box.append(node("summary", "", "Share between my PCs"), status);
    if (typeof api?.vaultStatus !== "function") {
      status.textContent = "Sharing between your PCs works in the desktop app.";
      box.dataset.state = "unavailable";
      return box;
    }
    let busy = false, loaded = false, offered = [];
    let keysPhrase = "", syncKeysButton = () => {};
    const intro = node("p", "muted", "Your PCs share through one private GitHub repository. Everything in it is sealed with a key only your paired PCs hold, so GitHub cannot read it. Nothing goes until you choose it, and Studio checks each item for keys, passwords and instructions aimed at an agent on the way out and again on the way in.");

    // Not paired yet: make the vault here, or pair with a code from a PC that has it.
    const setup = node("div", "pc-vault-setup");
    const code = node("input", "pc-vault-code");
    code.id = "pc-vault-code";
    code.type = "text";
    code.autocomplete = "off";
    code.spellcheck = false;
    code.placeholder = "XXXX-XXXX-…";
    code.setAttribute("aria-label", "Pairing code from your other PC");
    setup.append(
      node("p", "muted", "On your first PC, make the vault. On each other PC, type the pairing code the first one shows."),
      button("Make my private vault", "pc-vault-create", () => run("Making your private vault on GitHub…", async () => {
        const made = await api.vaultCreate();
        if (!made?.ok) { status.textContent = made?.error || "The vault could not be made."; return; }
        await refresh();
        showCode(made.pairingCode);
        status.textContent = `Your vault is ready at ${made.repo}. Type the code below on your other PCs.`;
      })),
      node("label", "pc-vault-label", "Pairing code from your other PC"), code,
      button("Pair this PC", "pc-vault-pair", () => run("Pairing this PC…", async () => {
        const paired = await api.vaultPair(code.value);
        code.value = "";
        status.textContent = paired?.ok ? `Paired with ${paired.repo}.` : paired?.error || "This PC could not be paired.";
        if (paired?.ok) await refresh();
      })),
    );

    // The pairing code is the vault's key: shown only on request, never saved here.
    const codeBox = node("div", "pc-vault-codebox");
    codeBox.id = "pc-vault-codebox";
    codeBox.hidden = true;
    const codeText = node("code", "pc-vault-code-text");
    codeText.id = "pc-vault-code-text";
    codeBox.append(node("p", "pc-vault-danger", "This code opens your vault. Type it on your other PC yourself; do not send it in a chat, an email or a screenshot."), codeText,
      button("Hide the code", "pc-vault-code-hide", async () => { codeText.textContent = ""; codeBox.hidden = true; }));
    const showCode = (value) => { codeText.textContent = value || ""; codeBox.hidden = !value; };

    // Paired: the PCs, the shelves, the library, keys.
    const linked = node("div", "pc-vault-linked");
    linked.hidden = true;
    const pcs = node("ul", "pc-sync-list pc-vault-pcs");
    pcs.id = "pc-vault-pcs";
    const shelf = node("select", "pc-vault-shelf");
    shelf.id = "pc-vault-shelf";
    shelf.setAttribute("aria-label", "What to share");
    const offer = node("ul", "pc-vault-items");
    offer.id = "pc-vault-offer";
    const send = button("Send to my PCs", "pc-vault-send", () => publish());
    send.hidden = true;
    const received = node("ul", "pc-vault-items");
    received.id = "pc-vault-received";
    const library = node("ul", "pc-vault-items");
    library.id = "pc-vault-library";
    const offerRow = node("div", "pc-sync-actions"), footer = node("div", "pc-sync-actions");
    linked.append(
      heading("Your PCs"), pcs,
      heading("Share from this PC"),
      offerRow,
      offer, send,
      heading("From my other PCs"),
      button("See what they shared", "pc-vault-read", () => read()),
      received,
      heading("Kept in my library"),
      node("p", "muted", "Model results and decisions you keep here count as another PC's experience when Studio picks models and suggests what to do. Remove one to stop that."),
      library,
      keysSection(),
      footer,
    );
    offerRow.append(shelf, button("Choose what to share", "pc-vault-offer-open", () => showOffer()));
    footer.append(
      button("Show pairing code", "pc-vault-show-code", () => run("Getting the pairing code…", async () => {
        const got = await api.vaultCode();
        if (got?.ok) { showCode(got.pairingCode); status.textContent = "The pairing code is below."; } else status.textContent = got?.error || "The code could not be read.";
      })),
      button("Unpair this PC", "pc-vault-unpair", () => run(null, async () => {
        const done = await api.vaultUnpair();
        if (done?.ok) { showCode(""); await refresh(); status.textContent = "This PC no longer holds the vault. Your other PCs still do."; }
      })),
    );
    box.append(intro, setup, codeBox, linked);

    async function run(label, work) {
      if (busy) return;
      busy = true;
      box.setAttribute("aria-busy", "true");
      for (const el of box.querySelectorAll("button")) el.disabled = true;
      if (label) status.textContent = label;
      try { await work(); } catch (error) { status.textContent = `That did not work: ${error?.message || error}`; }
      busy = false;
      box.removeAttribute("aria-busy");
      for (const el of box.querySelectorAll("button")) el.disabled = false;
      syncKeysButton();
    }
    function paint(result) {
      if (!result?.ok) { status.textContent = result?.error || "The vault could not be read."; return; }
      box.dataset.state = result.linked ? "linked" : "unlinked";
      setup.hidden = Boolean(result.linked);
      linked.hidden = !result.linked;
      if (!result.linked) {
        status.textContent = !result.encryption ? "This PC cannot keep a vault key safely (the OS keystore is unavailable)."
          : result.account ? `Signed in to GitHub as ${result.account}. Make the vault here, or pair with a code.` : "Sign in to GitHub first (Set up this PC above), then make the vault or pair.";
        return;
      }
      status.textContent = `Paired with ${result.repo}${result.offline ? " (offline: showing the last copy)" : ""}.${result.keyMatches === false ? " This PC's key does not match the vault; pair again." : ""}`;
      pcs.replaceChildren(...(result.pcs ?? []).map((pc) => {
        const waiting = (pc.projects ?? []).filter((item) => item.risk || item.behind).map((item) => `${item.repo}: ${[item.risk ? `${item.risk} not on GitHub` : "", item.behind ? `${item.behind} to pull` : ""].filter(Boolean).join(", ")}`);
        return node("li", "", `${pc.self ? "This PC" : pc.name} · ${when(pc.at) || "not seen yet"}${waiting.length ? ` · ${waiting.join("; ")}` : " · in step"}`);
      }));
      if (!pcs.children.length) pcs.append(node("li", "muted", "No PC has checked in yet. Each PC checks in after its next sync."));
      const chosen = shelf.value;
      shelf.replaceChildren(...(result.shelves ?? []).map((row) => { const option = node("option", "", row.label); option.value = row.id; return option; }));
      if (chosen) shelf.value = chosen;
    }
    async function refresh() { paint(await api.vaultStatus()); await paintLibrary(); }

    // Share from this PC: every item with what Studio found; stopped ones cannot be ticked.
    async function showOffer() {
      await run("Looking at what this PC has…", async () => {
        const result = await api.vaultOffer(shelf.value);
        if (!result?.ok) { status.textContent = result?.error || "That shelf could not be read."; return; }
        offered = result.items;
        offer.replaceChildren(...offered.map((item) => {
          const row = node("li", "pc-vault-item");
          const label = node("label", "pc-vault-pick");
          const tick = node("input");
          tick.type = "checkbox";
          tick.value = item.id;
          tick.disabled = !item.ok;
          tick.checked = false;
          label.append(tick, node("span", "", item.title));
          row.dataset.id = item.id;
          row.append(label, reasonList(item.reasons), preview(item.preview));
          return row;
        }));
        send.hidden = !offered.some((item) => item.ok);
        status.textContent = offered.length ? `${offered.length} item(s) on this shelf. Tick what to send; anything Studio stopped stays here.` : result.project === null && ["brains", "recipes", "claude-memory", "work"].includes(shelf.value) ? "This shelf needs a project that is on GitHub." : "Nothing on this shelf yet.";
      });
    }
    async function publish() {
      const ids = [...offer.querySelectorAll("input[type=checkbox]")].filter((tick) => tick.checked && !tick.disabled).map((tick) => tick.value);
      if (!ids.length) { status.textContent = "Tick at least one item to send."; return; }
      await run(`Sending ${ids.length} item(s) to your vault…`, async () => {
        const result = await api.vaultPublish(shelf.value, ids);
        const stopped = result?.stopped?.length ? ` Studio stopped ${result.stopped.length}: ${result.stopped.map((item) => item.reasons.join(" ")).join(" ")}` : "";
        status.textContent = result?.ok ? `Sent ${result.sent.length} item(s).${stopped}` : `${result?.error || "Nothing was sent."}${stopped}`;
      });
    }
    // From my other PCs: what can be used here, and what was quarantined.
    async function read() {
      await run("Reading your vault…", async () => {
        const result = await api.vaultRead(shelf.value);
        if (!result?.ok) { status.textContent = result?.error || "The vault could not be read."; return; }
        received.replaceChildren(
          ...result.items.map((item) => {
            const row = node("li", "pc-vault-item");
            row.dataset.id = item.id;
            row.append(node("span", "", `${item.title} · from ${item.from} · ${when(item.at)}`));
            if (item.usable) row.append(button("Use on this PC", null, () => run(`Using ${item.title}…`, async () => {
              const used = await api.vaultUse(shelf.value, item.id, item.from);
              status.textContent = used?.ok ? `${item.title} is here now${used.step === "learn" ? " and counts in Studio's learning" : ""}.` : used?.error || "It could not be used.";
              if (used?.ok) await paintLibrary();
            }), "ghost mini"));
            else row.append(node("span", "muted", item.reason));
            row.append(preview(item.preview));
            return row;
          }),
          ...result.quarantined.map((item) => {
            const row = node("li", "pc-vault-item pc-vault-quarantined");
            row.append(node("span", "", `Kept out: ${item.id}${item.from ? ` from ${item.from}` : ""}`), reasonList(item.reasons));
            return row;
          }),
        );
        status.textContent = result.items.length || result.quarantined.length ? `${result.items.length} item(s) from your other PCs${result.quarantined.length ? `, ${result.quarantined.length} kept out` : ""}.` : "Your other PCs have not shared anything on this shelf.";
      });
    }
    async function paintLibrary() {
      const result = await api.vaultLibrary();
      if (!result?.ok) return;
      library.replaceChildren(...result.items.map((item) => {
        const row = node("li", "pc-vault-item");
        row.dataset.id = item.id;
        row.append(node("span", "", `${item.title} · ${item.source === "file" ? "from a share file" : `from ${item.from}`}${item.learns ? " · counts in learning" : ""}`));
        if (item.source === "file") row.append(button("Use", null, () => run(`Using ${item.title}…`, async () => {
          const used = await api.vaultLibraryUse(item.shelf, item.id, item.from);
          status.textContent = used?.ok ? `${item.title} is here now.` : used?.error || "It could not be used.";
        }), "ghost mini"));
        row.append(button("Remove", null, () => run(null, async () => { await api.vaultForget(item.shelf, item.id, item.from); await paintLibrary(); status.textContent = `${item.title} is out of your library.`; }), "ghost mini"));
        return row;
      }));
      if (!library.children.length) library.append(node("li", "muted", "Nothing kept yet."));
    }

    // Keys and setup: the strict part.
    function keysSection() {
      const keys = node("details", "pc-vault-keys");
      keys.id = "pc-vault-keys";
      const warning = node("p", "pc-vault-danger", "YOU ARE SHARING KEYS AND SETUP INFORMATION. THEY CAN BE STOLEN. Anyone who gets them can spend your money and use your accounts.");
      const detail = node("p", "muted", "They go sealed to your private vault, and only PCs with your pairing code can open them. On the other PC they are saved straight into Windows' protected storage and never shown. Take them out of the vault once your PCs have them, and replace a key at its provider if you think it leaked.");
      const list = node("div", "pc-vault-keylist");
      list.id = "pc-vault-keys-list";
      const phraseLabel = node("label", "pc-vault-label");
      const phrase = node("input", "pc-vault-confirm");
      phrase.id = "pc-vault-keys-confirm";
      phrase.type = "text";
      phrase.autocomplete = "off";
      phrase.spellcheck = false;
      const share = button("Share these keys", "pc-vault-keys-share", () => run("Sharing keys and setup…", async () => {
        const names = [...list.querySelectorAll("input[type=checkbox]:checked")].map((tick) => tick.value);
        const result = await api.vaultKeys("share", { names, confirmation: phrase.value });
        phrase.value = "";
        status.textContent = result?.canceled ? "Nothing was shared." : result?.ok ? `Shared ${result.shared.map((name) => KEY_NAMES[name] ?? name).join(", ")}.` : result?.error || "Nothing was shared.";
      }));
      const incoming = node("div", "pc-vault-keylist");
      incoming.id = "pc-vault-keys-incoming";
      const use = button("Use these on this PC", "pc-vault-keys-use", () => run("Saving the keys on this PC…", async () => {
        const names = [...incoming.querySelectorAll("input[type=checkbox]:checked")].map((tick) => tick.value);
        const result = await api.vaultKeys("use", { names });
        status.textContent = result?.canceled ? "Nothing was saved." : result?.ok ? `Saved ${result.used.length} on this PC.` : result?.error || "Nothing was saved.";
      }));
      use.hidden = true;
      const ticks = (host, names, checked) => host.replaceChildren(...names.map((name) => {
        const label = node("label", "pc-vault-pick");
        const tick = node("input");
        tick.type = "checkbox";
        tick.value = name;
        tick.checked = checked(name);
        tick.addEventListener("change", () => syncKeysButton());
        label.append(tick, node("span", "", KEY_NAMES[name] ?? name));
        return label;
      }));
      syncKeysButton = () => {
        const any = list.querySelector("input[type=checkbox]:checked");
        share.disabled = busy || !any || !keysPhrase || phrase.value !== keysPhrase;
      };
      phrase.addEventListener("input", () => syncKeysButton());
      keys.append(node("summary", "pc-vault-danger-summary", "Keys and setup"), warning, detail, list, phraseLabel, phrase, share,
        button("Check for shared keys", "pc-vault-keys-check", () => run("Checking the vault for shared keys…", async () => {
          const result = await api.vaultKeys("list");
          if (!result?.ok) { status.textContent = result?.error || "The vault could not be read."; return; }
          const names = [...result.keys, ...result.setup];
          ticks(incoming, names, (name) => !result.here.includes(name));
          use.hidden = !names.length;
          status.textContent = names.length ? `${names.length} shared from ${result.from} on ${when(result.at)}. Ticked ones are not saved here yet.` : "No keys are shared in the vault.";
        })),
        incoming, use,
        button("Remove shared keys from the vault", "pc-vault-keys-clear", () => run("Taking the keys out of the vault…", async () => {
          const result = await api.vaultKeys("clear");
          status.textContent = result?.ok ? "The shared keys are out of the vault. Copies already saved on your PCs stay." : result?.error || "The keys could not be removed.";
        })),
      );
      keys.addEventListener("toggle", () => {
        if (!keys.open) return;
        void run(null, async () => {
          const result = await api.vaultKeys("offer");
          if (!result?.ok) return;
          keysPhrase = result.confirmation;
          phraseLabel.textContent = `To share, type exactly: ${keysPhrase}`;
          ticks(list, [...result.keys, ...result.setup], () => false);
          if (!list.children.length) list.append(node("p", "muted", "No keys or addresses are saved on this PC."));
        });
      });
      syncKeysButton();
      return keys;
    }

    box.addEventListener("toggle", () => { if (box.open && !loaded) { loaded = true; void run("Reading your vault…", refresh); } });
    return box;
  }

  // Share with friends: one scrubbed item in a file, or a file to review.
  function shareSection() {
    const api = bridge();
    const box = node("details", "pc-vault pc-share");
    box.id = "pc-share";
    const status = node("p", "muted pc-vault-status", "Show friends what works for you without showing them your PC.");
    status.id = "pc-share-status";
    status.setAttribute("role", "status");
    box.append(node("summary", "", "Share with friends"), status);
    if (typeof api?.sharePreview !== "function") {
      status.textContent = "Share files work in the desktop app.";
      return box;
    }
    const shelf = node("select", "pc-vault-shelf");
    shelf.id = "pc-share-shelf";
    shelf.setAttribute("aria-label", "What kind of item");
    for (const [id, label] of FRIEND_SHELVES) { const option = node("option", "", label); option.value = id; shelf.append(option); }
    shelf.value = FRIEND_SHELVES[0][0];
    const item = node("select", "pc-vault-shelf");
    item.id = "pc-share-item";
    item.setAttribute("aria-label", "Which item");
    item.hidden = true;
    const out = node("div", "pc-share-out");
    out.id = "pc-share-out";
    const opened = node("div", "pc-share-in");
    opened.id = "pc-share-in";
    let busy = false;
    async function run(label, work) {
      if (busy) return;
      busy = true;
      for (const el of box.querySelectorAll("button")) el.disabled = true;
      if (label) status.textContent = label;
      try { await work(); } catch (error) { status.textContent = `That did not work: ${error?.message || error}`; }
      busy = false;
      for (const el of box.querySelectorAll("button")) el.disabled = false;
    }
    const pickRow = node("div", "pc-sync-actions");
    pickRow.append(shelf, button("Choose an item", "pc-share-list", () => run("Looking at this PC's items…", async () => {
      const result = await api.vaultOffer(shelf.value);
      const items = result?.ok ? result.items : [];
      item.replaceChildren(...items.map((row) => { const option = node("option", "", row.title); option.value = row.id; return option; }));
      item.hidden = !items.length;
      out.replaceChildren();
      status.textContent = items.length ? "Pick one, then preview exactly what your friend gets." : result?.error || "Nothing of that kind on this PC yet.";
    })), item, button("Preview", "pc-share-preview", () => run("Preparing the preview…", async () => {
      if (!item.value) return;
      const result = await api.sharePreview(shelf.value, item.value);
      if (!result?.ok && !result?.reasons) { status.textContent = result?.error || "It could not be prepared."; return; }
      const save = button("Save share file", "pc-share-save", () => run("Saving…", async () => {
        const saved = await api.shareExport(shelf.value, item.value);
        status.textContent = saved?.canceled ? "Not saved." : saved?.ok ? `Saved ${saved.file}. Send it to your friend however you like.` : saved?.error || "It could not be saved.";
      }));
      save.hidden = !result.ok;
      out.replaceChildren(node("p", "", `Your friend gets: ${result.title}`), reasonList(result.reasons), node("pre", "pc-share-text", result.preview), save);
      status.textContent = result.ok ? "Paths, user and PC names, emails, addresses and keys are removed. This is everything in the file." : "Studio stopped this one. Remove what it found first.";
    })));
    const openRow = node("div", "pc-sync-actions");
    openRow.append(button("Open a share file", "pc-share-open", () => run("Checking the file…", async () => {
      const result = await api.shareOpen();
      if (result?.canceled) { status.textContent = "No file chosen."; return; }
      if (!result?.ok) {
        opened.replaceChildren(...(result?.quarantined ? [node("p", "pc-vault-danger", `Kept out: ${result.title || "this file"}`), reasonList(result.reasons)] : []));
        status.textContent = result?.quarantined ? "Studio kept this file out: it could harm your setup. Nothing was saved." : result?.error || "That file could not be read.";
        return;
      }
      const keep = button("Keep in my library", "pc-share-keep", () => run(null, async () => {
        const kept = await api.shareKeep(result.token);
        status.textContent = kept?.ok ? `${result.title} is in your library under Share between my PCs. Use it from there.` : kept?.error || "It could not be kept.";
        if (kept?.ok) opened.replaceChildren();
      }));
      opened.replaceChildren(node("p", "", `${result.title}`), reasonList(result.reasons), node("pre", "pc-share-text", result.preview), ...(result.usable ? [] : [node("p", "muted", result.reason)]), keep);
      status.textContent = "Studio found nothing risky in it. Read it before keeping it.";
    })));
    box.append(node("p", "muted", "A share file holds one item: a brain, a recipe, a team setup, model results, a memory note or your preferences. Studio removes paths, user and PC names, emails, addresses and keys, and refuses anything with a secret in it. Nothing is posted; you choose where the file goes."),
      pickRow, out, openRow, opened);
    return box;
  }

  window.MefiPcVault = { section, shareSection };
})();
