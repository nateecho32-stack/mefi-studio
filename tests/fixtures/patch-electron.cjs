"use strict";

// renderer/patch.js (MefiPatch.morph) in a real Chromium: node identity, focus,
// drafts, scroll, <details>, players and frames, script-owned attributes, unsafe
// markup and speed. Everything runs in one page; each case is a named check the
// node side reads back from report.json. No application code is loaded except
// patch.js itself, and nothing touches the network.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const root = process.env.MEFI_PATCH_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Patch fixture directory is required");
app.setName("Patch Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
let finished = false;
function finish(error, report) {
  if (finished) return; finished = true;
  if (error) console.error(error.stack || String(error));
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(error ? { failure: error.stack || String(error) } : report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", (error) => finish(error)); process.on("unhandledRejection", (error) => finish(error instanceof Error ? error : new Error(String(error))));

const CASES = `(async () => {
  const results = {};
  const host = document.getElementById('host');
  const mo = window.MefiPatch.morph;
  const t = async (name, fn) => { try { const detail = await fn(); results[name] = { ok: detail === true || detail?.ok === true, detail: detail === true ? '' : detail }; } catch (error) { results[name] = { ok: false, detail: String(error && error.stack || error) }; } };
  const set = (markup) => { host.innerHTML = markup; };
  const same = (a, b) => a === b;
  const raf = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  await t('text and attributes change in place', () => {
    set('<p class="a" title="x">one</p>');
    const p = host.firstChild;
    mo(host, '<p class="b" data-n="1">two</p>');
    return same(host.firstChild, p) && p.textContent === 'two' && p.className === 'b' && !p.hasAttribute('title') && p.getAttribute('data-n') === '1' || { html: host.innerHTML };
  });

  await t('unkeyed siblings keep their nodes when one is added at the end', () => {
    set('<p>1</p><p>2</p>');
    const [a, b] = host.children;
    mo(host, '<p>1</p><p>2</p><p>3</p>');
    return same(host.children[0], a) && same(host.children[1], b) && host.children.length === 3 && host.children[2].textContent === '3' || { html: host.innerHTML };
  });

  await t('a different tag is replaced', () => {
    set('<p>x</p>');
    mo(host, '<div>x</div>');
    return host.firstChild.tagName === 'DIV' && host.children.length === 1 || { html: host.innerHTML };
  });

  await t('keyed rows keep their nodes through a reorder, an insert and a removal', () => {
    set('<ul><li data-key="a">A</li><li data-key="b">B</li><li data-key="c">C</li></ul>');
    const ul = host.firstChild;
    const nodes = Object.fromEntries([...ul.children].map((li) => [li.dataset.key, li]));
    mo(host, '<ul><li data-key="c">C2</li><li data-key="a">A</li><li data-key="b">B</li></ul>');
    const reordered = [...ul.children].map((li) => li.dataset.key).join('') === 'cab' && same(ul.children[0], nodes.c) && same(ul.children[1], nodes.a) && same(ul.children[2], nodes.b) && nodes.c.textContent === 'C2';
    mo(host, '<ul><li data-key="x">X</li><li data-key="c">C2</li><li data-key="a">A</li></ul>');
    const changed = [...ul.children].map((li) => li.dataset.key).join('') === 'xca' && same(ul.children[1], nodes.c) && same(ul.children[2], nodes.a) && !nodes.b.isConnected;
    return (reordered && changed) || { reordered, changed, html: host.innerHTML };
  });

  await t('an id is a key too', () => {
    set('<div><span id="s1">a</span><span id="s2">b</span></div>');
    const [one, two] = host.firstChild.children;
    mo(host, '<div><span id="s2">b</span><span id="s1">a</span></div>');
    return same(host.firstChild.children[0], two) && same(host.firstChild.children[1], one) || { html: host.innerHTML };
  });

  await t('a focused field keeps focus and what was typed while the markup is unchanged, and follows the app when the app changes its mind', () => {
    set('<input data-key="box" value="">');
    const input = host.firstChild;
    input.focus(); input.value = 'hello world';
    mo(host, '<input data-key="box" value="">');
    const kept = same(host.firstChild, input) && document.activeElement === input && input.value === 'hello world';
    mo(host, '<input data-key="box" value="">'.replace('value=""', 'value="" class="grown"'));
    const stillKept = input.value === 'hello world' && input.className === 'grown';
    // The app clears the box (Send): its markup's value moved from "" to "cleared".
    mo(host, '<input data-key="box" value="cleared" class="grown">');
    const followed = input.value === 'cleared' && document.activeElement === input;
    return (kept && stillKept && followed) || { kept, stillKept, followed, value: input.value };
  });

  await t('a textarea draft survives a repaint and is replaced when the app changes the text', () => {
    set('<textarea data-key="t">start</textarea>');
    const area = host.firstChild;
    area.focus(); area.value = 'my draft, not sent';
    mo(host, '<textarea data-key="t">start</textarea>');
    const kept = same(host.firstChild, area) && area.value === 'my draft, not sent' && document.activeElement === area;
    mo(host, '<textarea data-key="t">start again</textarea>');
    const moved = area.value === 'start again';
    return (kept && moved) || { kept, moved, value: area.value };
  });

  await t('a checkbox and a select keep the person\\'s choice until the markup changes', () => {
    set('<label><input type="checkbox" data-key="c"></label><select data-key="s"><option value="a" selected>A</option><option value="b">B</option><option value="c">C</option></select>');
    const box = host.querySelector('input'), select = host.querySelector('select');
    box.checked = true; select.value = 'c';
    mo(host, '<label><input type="checkbox" data-key="c"></label><select data-key="s"><option value="a" selected>A</option><option value="b">B</option><option value="c">C</option></select>');
    const kept = box.checked === true && select.value === 'c' && same(host.querySelector('select'), select);
    mo(host, '<label><input type="checkbox" data-key="c" checked></label><select data-key="s"><option value="a">A</option><option value="b" selected>B</option><option value="c">C</option></select>');
    const followed = box.checked === true && select.value === 'b';
    mo(host, '<label><input type="checkbox" data-key="c"></label><select data-key="s"><option value="a">A</option><option value="b" selected>B</option><option value="c">C</option></select>');
    const unchecked = box.checked === false;
    return (kept && followed && unchecked) || { kept, followed, unchecked };
  });

  await t('scroll position survives a repaint of the list it is in', async () => {
    const rows = (n, mark) => Array.from({ length: n }, (_, i) => '<div data-key="r' + i + '" style="height:24px">row ' + i + mark + '</div>').join('');
    set('<div id="scroller" style="height:120px;overflow:auto">' + rows(60, '') + '</div>');
    const scroller = document.getElementById('scroller');
    scroller.scrollTop = 500; await raf();
    const before = scroller.scrollTop;
    mo(host, '<div id="scroller" style="height:120px;overflow:auto">' + rows(61, '!') + '</div>');
    await raf();
    return (same(document.getElementById('scroller'), scroller) && before > 400 && scroller.scrollTop === before) || { before, after: scroller.scrollTop };
  });

  await t('a details keeps the state the person put it in until the app changes its own opinion', () => {
    set('<details data-key="d"><summary>More</summary><p>text</p></details>');
    const d = host.firstChild;
    d.open = true;
    mo(host, '<details data-key="d"><summary>More</summary><p>new text</p></details>');
    const kept = same(host.firstChild, d) && d.open === true && d.querySelector('p').textContent === 'new text';
    d.open = false;
    mo(host, '<details data-key="d"><summary>More</summary><p>new text</p></details>');
    const stayedShut = d.open === false;
    mo(host, '<details data-key="d" open><summary>More</summary><p>new text</p></details>');
    const opened = d.open === true;
    d.open = false;
    mo(host, '<details data-key="d" open><summary>More</summary><p>new text</p></details>');
    const person = d.open === false;
    mo(host, '<details data-key="d"><summary>More</summary><p>new text</p></details>');
    const closedAgain = d.open === false && d.getAttribute('data-mp-open') === '0';
    return (kept && stayedShut && opened && person && closedAgain) || { kept, stayedShut, opened, person, closedAgain };
  });

  await t('a kept player is the same node, untouched inside, through a move and a repaint of its neighbours', () => {
    set('<div data-key="a">A</div><div data-key="player" data-keep><video></video><i>inside</i></div><div data-key="b">B</div>');
    const player = host.querySelector('[data-key="player"]');
    player.__mark = 7; player.querySelector('video').__mark = 8; player.querySelector('i').textContent = 'changed by the player itself';
    mo(host, '<div data-key="b">B2</div><div data-key="player" data-keep class="wide"><video></video><i>inside</i></div><div data-key="a">A2</div>');
    const order = [...host.children].map((n) => n.dataset.key).join('');
    return (order === 'bplayera' && same(host.querySelector('[data-key="player"]'), player) && player.__mark === 7 && player.querySelector('video').__mark === 8 && player.querySelector('i').textContent === 'changed by the player itself' && player.className === 'wide') || { order, inside: player.textContent };
  });

  await t('a moved frame is not reloaded and a moved field keeps its focus (Node.moveBefore)', async () => {
    const hasMove = typeof Element.prototype.moveBefore === 'function';
    set('<div data-key="x">x</div><iframe data-key="f" data-keep src="about:blank"></iframe><input data-key="i"><div data-key="y">y</div>');
    const frame = host.querySelector('iframe'), input = host.querySelector('input');
    await new Promise((resolve) => setTimeout(resolve, 60));
    frame.contentWindow.__alive = 1; input.focus();
    mo(host, '<div data-key="y">y</div><input data-key="i"><iframe data-key="f" data-keep src="about:blank"></iframe><div data-key="x">x</div>');
    await new Promise((resolve) => setTimeout(resolve, 60));
    const order = [...host.children].map((n) => n.dataset.key).join('');
    const frameKept = frame.contentWindow && frame.contentWindow.__alive === 1;
    const focusKept = document.activeElement === input;
    return (hasMove && order === 'yifx' && frameKept && focusKept) || { hasMove, order, frameKept, focusKept };
  });

  await t('attributes a script owns are left alone', () => {
    set('<div data-key="o" data-mp-own="class style" class="a">o</div>');
    const div = host.firstChild;
    div.classList.add('js-toggled'); div.style.setProperty('--x', '12px');
    mo(host, '<div data-key="o" data-mp-own="class style" class="b">o2</div>');
    return (same(host.firstChild, div) && div.classList.contains('js-toggled') && div.style.getPropertyValue('--x') === '12px' && div.textContent === 'o2') || { cls: div.className };
  });

  await t('inline handlers, javascript: links, srcdoc and scripts never reach a live node', () => {
    window.__ran = 0;
    set('<p data-key="p">safe</p>');
    mo(host, '<p data-key="p" onclick="window.__ran=1">safe</p><a href="javascript:window.__ran=2" data-key="a">link</a><script>window.__ran=3<\\/script><iframe srcdoc="<b>x</b>" data-key="f"></iframe><img src="x" onerror="window.__ran=4" data-key="i">');
    const p = host.querySelector('p'), a = host.querySelector('a'), f = host.querySelector('iframe'), i = host.querySelector('img');
    p.click(); a.click();
    return (!p.hasAttribute('onclick') && !a.hasAttribute('href') && !host.querySelector('script') && !f.hasAttribute('srcdoc') && !i.hasAttribute('onerror') && window.__ran === 0) || { html: host.innerHTML, ran: window.__ran };
  });

  await t('an element or a fragment is a source too', () => {
    set('<p>old</p>');
    const p = host.firstChild;
    const box = document.createElement('div');
    box.innerHTML = '<p>from an element</p><span>extra</span>';
    mo(host, box);
    const fragment = document.createDocumentFragment();
    const li = document.createElement('p'); li.textContent = 'from a fragment'; fragment.append(li);
    const first = same(host.firstChild, p) && p.textContent === 'from an element' && host.children.length === 2;
    mo(host, fragment);
    return (first && same(host.firstChild, p) && p.textContent === 'from a fragment' && host.children.length === 1) || { html: host.innerHTML };
  });

  await t('a thousand keyed rows repaint quickly and keep every node', () => {
    const rows = (mark) => Array.from({ length: 1000 }, (_, i) => '<div data-key="k' + i + '" class="row"><b>' + i + '</b><span>' + (i % 7 === 0 ? mark : 'same') + '</span><i></i></div>').join('');
    set('<div id="big">' + rows('a') + '</div>');
    const nodes = [...document.querySelectorAll('#big .row')];
    const started = performance.now();
    for (let n = 0; n < 20; n += 1) mo(host, '<div id="big">' + rows(n % 2 ? 'a' : 'b') + '</div>');
    const ms = performance.now() - started;
    const all = [...document.querySelectorAll('#big .row')];
    const identical = all.length === 1000 && all.every((node, i) => node === nodes[i]);
    return (identical && ms < 1500) || { identical, ms };
  });

  await t('the morph of nothing changes nothing', () => {
    set('<section data-key="s"><h2>t</h2><p>b</p></section>');
    const s = host.firstChild, h = s.firstChild;
    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(host, { attributes: true, childList: true, subtree: true, characterData: true });
    mo(host, '<section data-key="s"><h2>t</h2><p>b</p></section>');
    return new Promise((resolve) => setTimeout(() => { observer.disconnect(); resolve(same(host.firstChild, s) && same(s.firstChild, h) && mutations === 0 || { mutations }); }, 30));
  });

  return { results, moveBefore: typeof Element.prototype.moveBefore === 'function' };
})()`;

app.whenReady().then(async () => {
  fs.writeFileSync(path.join(root, "index.html"), '<!doctype html><meta charset="utf-8"><body><div id="host"></div><script src="patch.js"></script></body>');
  fs.copyFileSync(path.join(__dirname, "..", "..", "renderer", "patch.js"), path.join(root, "patch.js"));
  const window = new BrowserWindow({ show: false, width: 800, height: 600, frame: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const errors = [];
  window.webContents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  await window.loadFile(path.join(root, "index.html"));
  const outcome = await window.webContents.executeJavaScript(CASES, true);
  finish(null, { ...outcome, errors });
}).catch((error) => finish(error));
