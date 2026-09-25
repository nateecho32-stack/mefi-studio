import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/nav.js", import.meta.url), "utf8");

test("deferred update retries refresh state without repeating unchanged toast notices", () => {
  const toasts = [];
  const env = vm.createContext({
    window: { MefiToast: (message) => toasts.push(message) },
    UPDATES_PLACE: "Settings › Updates", openUpdates: () => ({}), plural: (count, word) => `${count} ${word}`,
  });
  const start = source.indexOf("  const updateToastSignatures =");
  const end = source.indexOf("  function onUpdateEvent(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), env);
  const update = (phase, extra = {}) => env.updateToast({ phase, kind: "restart", files: ["main.cjs"], ...extra });
  for (let retry = 0; retry < 4; retry += 1) {
    update("detected"); update("validating"); update("building");
    update("waiting", { reason: "waiting for a pause" });
    update("restarting"); update("pending", { reason: "1 worker saving" });
  }
  assert.equal(toasts.length, 3, "one detected, waiting and pending notice for the whole deferred update");
  update("pending", { reason: "Project switch is saving progress" });
  assert.equal(toasts.length, 4, "a changed reason is still announced");
  update("restarted");
  update("detected");
  assert.equal(toasts.length, 6, "the next update can announce the same files again");
});
