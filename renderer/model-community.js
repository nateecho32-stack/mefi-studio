// Models › Community: what the Void Engine community reports about a model
// (the public feed, docs/model-community.md) and Studio's own probe runs on it.
// Feed text is untrusted: everything here renders with textContent, links open
// only through the host's http(s)-only shell:open, and nothing is fetched from
// a feed URL. Probes run only when the owner presses Run probes.
(function () {
  "use strict";
  const state = { initialized: false, targets: [], kinds: [], selected: "", read: 0, running: null, progress: null, maxTokens: 1500 };
  const $ = (id) => document.getElementById(`model-lab-${id}`);
  const api = () => window.mefiStudio;
  const rows = (value) => Array.isArray(value) ? value : [];
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const plain = (error, fallback) => window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : error?.message || fallback;
  const when = (value) => {
    const date = new Date(value ?? NaN);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "an unknown time";
  };
  const KIND_NAMES = { planning: "Planning", structuring: "Structuring", coding: "Coding", debugging: "Debugging", writing: "Writing", commits: "Commits", tests: "Tests", setup: "Setup", review: "Review" };
  const kindName = (kind) => KIND_NAMES[kind] || kind;
  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function empty(target, title, detail) {
    const box = element("div", "lab-empty");
    box.append(element("h3", "", title), element("p", "", detail));
    target.replaceChildren(box);
  }
  // A feed link opens outside Studio through the host, which refuses anything
  // but http(s); the feed was already held to https on the way in.
  function linkButton(label, url) {
    const button = element("button", "mc-link", label);
    button.type = "button";
    button.title = url;
    button.addEventListener("click", () => { api()?.openExternal?.(url); });
    return button;
  }
  const selectedTarget = () => state.targets.find((target) => `${target.provider}::${target.model}` === state.selected) || null;

  function section(title, note = "") {
    const box = element("section", "mc-section");
    box.append(element("h5", "", title));
    if (note) box.append(element("p", "mc-meta", note));
    return box;
  }
  function list(items, render) {
    const ul = element("ul", "mc-list");
    for (const item of items) { const li = element("li", "mc-item"); render(li, item); ul.append(li); }
    return ul;
  }

  function renderCommunity(view) {
    const body = $("community-body");
    const status = view.hasFeed
      ? `Community feed from ${when(view.fetchedAt)} · ${view.modelCount} ${view.modelCount === 1 ? "model" : "models"}${view.lastError ? ` · the last refresh failed: ${view.lastError}` : ""}`
      : view.lastError ? `The community feed could not be read: ${view.lastError}` : view.missing ? "No community feed is published yet." : "No community feed has been read on this PC yet.";
    $("community-status").textContent = status;
    const match = view.match;
    if (!view.hasFeed) { empty(body, "No community feed", "Studio works the same without one. Once the Void Engine Bot publishes reviews, they appear here after a refresh."); return; }
    if (!match?.row) { empty(body, "No community reports for this model yet", "Members review models in the Void Engine forum; this model has no post there, or none has been published."); return; }
    const row = match.row;
    const parts = [];
    const head = element("div", "mc-summary");
    const overall = row.ratings?.overall;
    head.append(element("strong", "", row.name || row.id), element("span", "mc-meta", overall ? `Server rating ${overall.mean} / 5 · ${overall.n} ratings` : "No server rating yet"));
    if (match.matchedBy === "alias") head.append(element("span", "mc-meta", `Listed as ${row.key}`));
    parts.push(head);
    const byTask = Object.entries(row.ratings?.byTask || {});
    if (byTask.length) {
      const chips = element("div", "mc-chips");
      for (const [kind, rating] of byTask) chips.append(element("span", "mc-chip", `${kindName(kind)} ${rating.mean} · n ${rating.n}${rating.withEvidence ? ` · ${rating.withEvidence} with evidence` : ""}`));
      const box = section("Ratings by task");
      box.append(chips);
      parts.push(box);
    }
    if (rows(row.documented).length) {
      const box = section("From the release notes", "The provider's own statements, not measurements.");
      box.append(list(row.documented, (li, entry) => {
        li.append(element("span", "", entry.claim), element("span", "mc-meta", `${kindName(entry.taskKind)}${entry.specific ? " · specific" : ""}`));
        if (entry.source?.url) li.append(linkButton(entry.source.title || "Source", entry.source.url));
      }));
      parts.push(box);
    }
    const observed = rows(row.claims).filter((claim) => claim.tier === "observed");
    for (const [polarity, title] of [["strength", "Observed strengths"], ["weakness", "Observed weaknesses"]]) {
      const items = observed.filter((claim) => claim.polarity === polarity);
      if (!items.length) continue;
      const box = section(title, "Members describing what they ran and what happened.");
      box.append(list(items, (li, claim) => li.append(element("span", "", claim.text), element("span", "mc-meta", `${kindName(claim.taskKind)} · ${claim.reporters} ${claim.reporters === 1 ? "reporter" : "reporters"}${claim.withEvidence ? ` · ${claim.withEvidence} with evidence` : ""}`))));
      parts.push(box);
    }
    const opinions = rows(row.claims).filter((claim) => claim.tier === "opinion");
    if (opinions.length) {
      const fold = element("details", "mc-section mc-opinions");
      fold.append(element("summary", "", `Opinions (${opinions.length}) · shown, never used to pick models`));
      fold.append(list(opinions, (li, claim) => li.append(element("span", "", claim.text), element("span", "mc-meta", `${kindName(claim.taskKind)} · ${claim.polarity} · ${claim.reporters} ${claim.reporters === 1 ? "member" : "members"}`))));
      parts.push(fold);
    }
    if (rows(row.tips).length) {
      const box = section("Tips");
      box.append(list(row.tips, (li, tip) => li.append(element("span", "", tip.text), element("span", "mc-meta", `${kindName(tip.taskKind)} · ${tip.votes} ${tip.votes === 1 ? "vote" : "votes"}`))));
      parts.push(box);
    }
    const foot = element("div", "mc-foot");
    if (row.forumThread) foot.append(linkButton("Discuss on Discord", row.forumThread));
    foot.append(element("p", "mc-meta", "Model picks use only specific release-note claims, strengths or weaknesses two or more members reported, and task ratings with three or more evidence notes, and only as a small nudge."));
    parts.push(foot);
    body.replaceChildren(...parts);
  }

  function checkList(checks) {
    return list(rows(checks), (li, check) => {
      li.classList.add(check.ok ? "mc-pass" : "mc-fail");
      li.append(element("span", "mc-verdict", check.ok ? "Pass" : "Fail"), element("span", "", check.name), element("span", "mc-meta", check.detail || ""));
    });
  }
  function renderProbes(view) {
    const body = $("probes-body");
    const target = selectedTarget();
    const running = state.running;
    const mine = running && target && running.provider === target.provider && running.model === target.model;
    $("probes-run").disabled = !target || Boolean(running);
    $("probes-cancel").hidden = !running;
    if (!target) { empty(body, "No model to probe", "Probes run on models enabled on this PC: save a provider key or sign in to a CLI under Settings."); return; }
    const runs = view?.runs || {};
    const table = element("div", "mc-probes");
    for (const { kind, title } of state.kinds) {
      const card = element("div", "mc-probe");
      const latest = rows(runs[kind])[0];
      const live = mine && state.progress?.kind === kind && state.progress.state === "running";
      const headline = live ? "Running…" : !latest ? "Not run yet" : latest.error ? `No answer: ${latest.error}` : `${latest.passed ? "Passed" : "Did not pass"} · ${Math.round((latest.score ?? 0) * 100)}% of checks`;
      const top = element("div", "mc-probe-head");
      top.append(element("strong", "", `${kindName(kind)}`), element("span", `mc-meta${latest && !latest.error ? latest.passed ? " mc-pass" : " mc-fail" : ""}`, headline));
      card.append(top, element("span", "mc-meta", title));
      if (latest) {
        const scored = rows(runs[kind]).filter((run) => finite(run.score));
        const mean = scored.length ? Math.round((scored.reduce((sum, run) => sum + run.score, 0) / scored.length) * 100) : null;
        card.append(element("span", "mc-meta", `Last run ${when(latest.at)}${finite(latest.elapsedMs) ? ` · ${Math.round(latest.elapsedMs / 100) / 10} s` : ""}${scored.length > 1 ? ` · ${scored.length} runs, ${mean}% on average` : ""}`));
        if (rows(latest.checks).length) {
          const fold = element("details", "mc-checks");
          fold.append(element("summary", "", `Checks (${latest.checks.filter((check) => check.ok).length} of ${latest.checks.length})`), checkList(latest.checks));
          card.append(fold);
        }
      }
      table.append(card);
    }
    body.replaceChildren(table, element("p", "mc-meta", `Each probe is one small fixed task, up to ${state.maxTokens.toLocaleString("en-US")} output tokens, billed like any call on this model and listed under Usage. Results are Studio's own measurements, weaker than verified task results; the last 5 runs per probe are kept.`));
  }

  async function load({ refresh = false } = {}) {
    const token = ++state.read;
    const target = selectedTarget();
    $("community-refresh").disabled = true;
    $("community-status").textContent = refresh ? "Checking the community feed…" : "Reading the community feed…";
    const who = target ? { provider: target.provider, model: target.model } : {};
    try {
      if (!api()?.modelFeed) throw new Error("The community feed is available in the Studio desktop app.");
      const [community, probes] = await Promise.all([refresh ? api().modelFeedRefresh(who) : api().modelFeed(who), api().modelProbes?.(who)]);
      if (token !== state.read) return;
      if (!community || community.ok === false) throw new Error(community?.error || "The community feed could not be read.");
      renderCommunity(community);
      if (probes?.ok) { state.running = probes.running || null; renderProbes(probes); }
    } catch (error) {
      if (token !== state.read) return;
      $("community-status").textContent = plain(error, "The community feed could not be read.");
      $("community-body").replaceChildren();
    } finally {
      if (token === state.read) $("community-refresh").disabled = false;
    }
  }

  async function loadTargets() {
    const result = await api()?.modelProbes?.({});
    if (!result?.ok) throw new Error(result?.error || "Models could not be listed.");
    state.targets = rows(result.targets);
    state.kinds = rows(result.kinds);
    state.maxTokens = finite(result.maxTokens) ? result.maxTokens : state.maxTokens;
    state.running = result.running || null;
    const select = $("community-model");
    const first = element("option", "", state.targets.length ? "Choose a model…" : "No models enabled on this PC");
    first.value = "";
    select.replaceChildren(first);
    for (const target of state.targets) {
      const option = element("option", "", target.label || `${target.provider} · ${target.model}`);
      option.value = `${target.provider}::${target.model}`;
      select.append(option);
    }
    if (!state.targets.some((target) => `${target.provider}::${target.model}` === state.selected)) state.selected = state.targets[0] ? `${state.targets[0].provider}::${state.targets[0].model}` : "";
    select.value = state.selected;
  }

  async function run() {
    const target = selectedTarget();
    if (!target || state.running) return;
    $("probes-run").disabled = true;
    $("probes-status").textContent = `Starting probes on ${target.model}…`;
    state.running = { provider: target.provider, model: target.model };
    $("probes-cancel").hidden = false;
    try {
      const result = await api().modelProbeRun({ provider: target.provider, model: target.model });
      if (!result?.ok) throw new Error(result?.error || "The probes could not run.");
      $("probes-status").textContent = result.cancelled ? "Probes stopped. Finished results are kept." : `Probes finished on ${target.model}.`;
    } catch (error) {
      $("probes-status").textContent = plain(error, "The probes could not run.");
    } finally {
      state.running = null; state.progress = null;
      $("probes-cancel").hidden = true;
      await load();
    }
  }

  async function cancel() {
    $("probes-cancel").disabled = true;
    try {
      const result = await api()?.modelProbeCancel?.();
      $("probes-status").textContent = result?.message || "Stopping after the current probe…";
    } finally { $("probes-cancel").disabled = false; }
  }

  function onProgress(event) {
    if (!event || typeof event !== "object") return;
    state.progress = event;
    const total = finite(event.total) ? event.total : state.kinds.length;
    if (event.state === "running") $("probes-status").textContent = `Running ${kindName(event.kind)} (${(event.index ?? 0) + 1} of ${total}) on ${event.model}…`;
    else if (event.state === "scored") $("probes-status").textContent = `${kindName(event.kind)} ${event.result?.error ? "got no answer" : event.result?.passed ? "passed" : "did not pass"} (${(event.index ?? 0) + 1} of ${total}).`;
    if (event.state === "scored" || event.state === "running") api()?.modelProbes?.({ provider: event.provider, model: event.model }).then((view) => {
      const target = selectedTarget();
      if (view?.ok && target && target.provider === event.provider && target.model === event.model) renderProbes(view);
    }).catch(() => {});
  }

  function init() {
    if (state.initialized || !$("community")) return;
    state.initialized = true;
    $("community-model").addEventListener("change", () => { state.selected = $("community-model").value; load(); });
    $("community-refresh").addEventListener("click", () => load({ refresh: true }));
    $("probes-run").addEventListener("click", run);
    $("probes-cancel").addEventListener("click", cancel);
    api()?.onModelProbeProgress?.(onProgress);
  }

  async function open() {
    init();
    if (!state.initialized) return;
    try { await loadTargets(); }
    catch (error) { $("probes-status").textContent = plain(error, "Models could not be listed."); }
    await load();
  }
  window.MefiModelCommunity = { open, refresh: () => load({ refresh: true }) };
})();
