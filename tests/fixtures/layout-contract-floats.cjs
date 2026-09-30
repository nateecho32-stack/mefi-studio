"use strict";

// What floats, in layout v2 with the sample regions up (called by
// layout-contract-v2.cjs): the toasts, the media window, the companion's orb
// and panel, a select's list, and Command's graph. Each is put where it is most
// likely to stray, by a real pointer where a person would use one, and must end
// up inside MefiNav.usable(), which is clear of the list, the tab strip, the
// inspector and the status bar.
const assert = require("node:assert/strict");

const WINDOWS = [[[1440, 900, 1], "build"], [[1100, 720, 1], "vibe"], [[600, 560, 1.5], "build"]];

module.exports = async function floats({ contents, run, resize, setup, home, report, sleep, SAMPLE, fmt, label }) {
  const done = [];
  const rectOf = (selector) => run(`const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const box = node.getBoundingClientRect(); return [box.left, box.top, box.right, box.bottom];`);
  // music.js keeps a media window of its own, so the page holds two #media-window; the fixture's is the last.
  const mediaRect = (selector) => run(`const root = [...document.querySelectorAll("#media-window")].at(-1); const node = ${JSON.stringify(selector)} ? root?.querySelector(${JSON.stringify(selector)}) : root; if (!node) return null; const box = node.getBoundingClientRect(); return [box.left, box.top, box.right, box.bottom];`);
  const area = async () => { const free = await run("return window.MefiNav.usable();"); return [free.left, free.top, free.right, free.bottom]; };
  const inside = (box, free, margin, what) => {
    assert.ok(box, `${what} is on screen`);
    assert.ok(box[0] >= free[0] + margin[0] - 0.51 && box[1] >= free[1] + margin[1] - 0.51 && box[2] <= free[2] - margin[2] + 0.51 && box[3] <= free[3] - margin[3] + 0.51,
      `${what} ${fmt(box.map(Math.round))} leaves the free area ${fmt(free.map(Math.round))} (margins ${fmt(margin)})`);
  };

  for (const [size, mode] of WINDOWS) {
    const zoom = size[2], tag = `${label(size)}/${mode}`;
    await resize(size); await setup({ mode, rail: "closed" }); await home();
    await run(`for (const [name, value] of Object.entries(${JSON.stringify(SAMPLE)})) window.MefiNav.layout.set(name, value);`);
    await run("window.__placeRegions(); await new Promise((resolve) => setTimeout(resolve, 300));");
    const [width, height] = await run("return [innerWidth, innerHeight];");
    const dip = (x, y) => ({ x: Math.round(x * zoom), y: Math.round(y * zoom) });
    const drag = async (from, to) => {
      const start = dip(from[0], from[1]), end = dip(to[0], to[1]);
      contents.sendInputEvent({ type: "mouseMove", ...start });
      contents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...start });
      for (const step of [0.25, 0.5, 0.75, 1]) contents.sendInputEvent({ type: "mouseMove", x: Math.round(start.x + (end.x - start.x) * step), y: Math.round(start.y + (end.y - start.y) * step), buttons: 1 });
      await sleep(60);
      contents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...end });
      await sleep(120);
    };
    const corners = [[1, 1], [width - 1, 1], [1, height - 1], [width - 1, height - 1]];
    const free = await area();
    assert.ok(free[0] >= 64 - 0.5 && free[1] >= 36 - 0.5, `${tag}: the free area starts past the rail and the strip: ${fmt(free)}`);

    // A toast is anchored at the bottom left of the free area. (Home's composer owns the bottom of a short window, and the stack rides above it
    // whatever is at the top; that offset is the stylesheet's own and is measured with the views, so this one is taken on a page.)
    await run("await window.MefiNav.go('tasks');"); await sleep(400);
    await run("window.__fxToast = window.MefiToast('A toast has to stay in the free area', 'info', { duration: 120000 });");
    await sleep(500);
    const toast = await run("const nodes = [...document.querySelectorAll('#toast-host .toast.show')]; const box = nodes.at(-1)?.getBoundingClientRect(); return box ? [box.left, box.top, box.right, box.bottom] : null;");
    inside(toast, free, [0, 0, 0, 0], `${tag}: the toast`);
    assert.ok(toast[0] >= free[0] + 20 && toast[3] <= free[3] - 20, `${tag}: and keeps its own margin from the list and the status bar: ${fmt(toast)}`);
    await run("window.__fxToast?.dismiss?.(); await window.MefiNav.go('workspace');"); await sleep(400);

    // The media window: floating, then dragged to every corner and pushed past them.
    await run(`
      window.__fxMedia ||= window.MefiMediaWindow.create({ content: Object.assign(document.createElement("div"), { id: "fx-media-content" }), onPlacement() {}, onClose() {}, onSettings() {} });
      window.__fxMedia.show({ shape: "video", label: "Layout fixture" });
    `);
    await sleep(300);
    let media = await mediaRect("");
    inside(media, free, [16, 16, 16, 16], `${tag}: the media window at rest`);
    const handle = async () => { const box = await mediaRect("#media-window-move"); return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]; };
    for (const corner of corners) {
      await drag(await handle(), corner);
      media = await mediaRect("");
      inside(media, free, [16, 16, 16, 16], `${tag}: the media window dragged to ${fmt(corner)}`);
    }
    // A resize past the regions is held too: the south-east grip out to the far corner.
    const grip = await mediaRect("#media-window-resize-se");
    await drag([(grip[0] + grip[2]) / 2, (grip[1] + grip[3]) / 2], [width - 1, height - 1]);
    inside(await mediaRect(""), free, [16, 16, 16, 16], `${tag}: the media window resized to the far corner`);
    await run("window.__fxMedia.hide();");

    if (mode === "build") {
      // The companion's orb rests in the menu; a drag takes it anywhere the pointer goes, and v2 keeps it in the free area.
      // At rest it sits in the menu's foot, and the menu opens under the pointer and moves it: the pointer goes to it first, and takes it where it is then.
      const grab = async () => {
        let orb = await rectOf("#companion-orb");
        const at = dip((orb[0] + orb[2]) / 2, (orb[1] + orb[3]) / 2);
        contents.sendInputEvent({ type: "mouseMove", ...at }); await sleep(600);
        orb = await rectOf("#companion-orb");
        return [(orb[0] + orb[2]) / 2, (orb[1] + orb[3]) / 2];
      };
      for (const corner of corners) {
        await drag(await grab(), corner);
        inside(await rectOf("#companion-orb"), free, [8, 8, 10, 10], `${tag}: the orb dragged to ${fmt(corner)}`);
      }
      // Its panel opens beside it and stays inside as well.
      await run("window.MefiCompanion.open();"); await sleep(500);
      const panel = await rectOf("#companion-panel");
      inside(panel, free, [0, 0, 0, 0], `${tag}: the companion's panel`);
      await run("window.MefiCompanion.close();");
    }

    // A select's list opens under its button, or above it when there is no room.
    await run(`
      const host = document.createElement("div"); host.id = "fx-select-host";
      const free = window.MefiNav.usable();
      Object.assign(host.style, { position: "fixed", right: (innerWidth - free.right + 24) + "px", bottom: (innerHeight - free.bottom + 6) + "px", zIndex: 160 });
      const select = document.createElement("select"); select.id = "fx-select"; select.setAttribute("aria-label", "Fixture choice");
      for (let index = 0; index < 40; index += 1) select.add(new Option("Option number " + index, String(index)));
      host.append(select); document.body.append(host); window.MefiSelect.enhance(select);
      document.getElementById("fx-select-choice").click();
    `);
    await sleep(300);
    const popup = await rectOf(".studio-choice-popup");
    inside(popup, free, [0, 0, 12, 12], `${tag}: a select's list`);
    await run("window.MefiSelect.close(); document.getElementById('fx-select-host').remove();");

    // Command's graph is fitted to the free area, not the window.
    await run("await window.MefiNav.go('command');"); await sleep(700);
    const graph = await run("const area = window.MefiIdle.graphViewport(); return [area.x, area.y, area.x + area.w, area.y + area.h];");
    inside(graph, await area(), [0, 0, 0, 0], `${tag}: Command's graph area`);
    await run("await window.MefiNav.go('workspace'); window.__fxToast?.dismiss?.();");
    done.push(tag);
  }
  return done;
};
