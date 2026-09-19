import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readBudget, spendBudget } from "../scripts/experience.mjs";

async function scratch(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-budget-writes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("simultaneous Jev and policy spends preserve every charge across path aliases", async (t) => {
  const dir = await scratch(t);
  const file = path.join(dir, "budget.json");
  const aliases = [file, path.relative(process.cwd(), file)];
  const results = await Promise.all(Array.from({ length: 40 }, (_, index) =>
    spendBudget(aliases[index % aliases.length], {
      purpose: index % 2 ? "jev-shadow-intake" : "policy-lab",
      modelCalls: 1, tokens: index + 1, providerCost: 0.25, now: index + 1,
    })
  ));
  const budget = await readBudget(file);
  assert.deepEqual(budget.spent, { modelCalls: 40, tokens: 820, providerCost: 10 });
  assert.deepEqual(budget.entries.map(({ at }) => at), Array.from({ length: 40 }, (_, index) => index + 1));
  assert.deepEqual(results.map(({ spent }) => spent.modelCalls), Array.from({ length: 40 }, (_, index) => index + 1));
  assert.deepEqual(await readdir(dir), ["budget.json"], "successful writes leave no staging files");
});

test("a failed write rejects its caller and later spending recovers on the same file", async (t) => {
  const dir = await scratch(t);
  const blockedParent = path.join(dir, "ledger");
  const file = path.join(blockedParent, "budget.json");
  await writeFile(blockedParent, "not a directory");
  const failed = await Promise.allSettled([
    spendBudget(file, { purpose: "failed-probe", modelCalls: 1 }),
    spendBudget(file, { purpose: "failed-intake", modelCalls: 1 }),
  ]);
  assert.ok(failed.every(({ status }) => status === "rejected"));
  await rm(blockedParent);
  await mkdir(blockedParent);
  const recovered = await spendBudget(file, { purpose: "recovered", modelCalls: 2, tokens: 7 });
  assert.deepEqual(recovered.spent, { modelCalls: 2, tokens: 7, providerCost: 0 });
  assert.deepEqual((await readBudget(file)).entries.map(({ purpose }) => purpose), ["recovered"]);
});

test("a live module reload shares the in-flight budget writer queue", async (t) => {
  const dir = await scratch(t);
  const file = path.join(dir, "budget.json");
  const reloaded = await import("../scripts/experience.mjs?budget-reload-test");
  await Promise.all(Array.from({ length: 16 }, (_, index) =>
    (index % 2 ? spendBudget : reloaded.spendBudget)(file, { modelCalls: 1, tokens: 2 })
  ));
  assert.deepEqual((await readBudget(file)).spent, { modelCalls: 16, tokens: 32, providerCost: 0 });
});

test("failed destination replacement cleans staging files without blocking another ledger", async (t) => {
  const dir = await scratch(t);
  const blockedFile = path.join(dir, "blocked.json");
  const healthyFile = path.join(dir, "healthy.json");
  await mkdir(blockedFile);
  const [failed, healthy] = await Promise.allSettled([
    spendBudget(blockedFile, { modelCalls: 1 }),
    spendBudget(healthyFile, { modelCalls: 3 }),
  ]);
  assert.equal(failed.status, "rejected");
  assert.equal(healthy.status, "fulfilled");
  assert.equal(healthy.value.spent.modelCalls, 3);
  assert.deepEqual((await readdir(dir)).sort(), ["blocked.json", "healthy.json"]);
});

test("concurrent writes retain the entry cap without losing lifetime totals", async (t) => {
  const dir = await scratch(t);
  const file = path.join(dir, "budget.json");
  await writeFile(file, JSON.stringify({ schema: 1, spent: { modelCalls: 199, tokens: 0, providerCost: 0 },
    entries: Array.from({ length: 199 }, (_, index) => ({ at: index + 1, modelCalls: 1 })) }));
  await Promise.all(Array.from({ length: 4 }, (_, index) => spendBudget(file, { modelCalls: 1, now: 200 + index })));
  const budget = await readBudget(file);
  assert.equal(budget.spent.modelCalls, 203);
  assert.equal(budget.entries.length, 200);
  assert.equal(budget.entries[0].at, 4);
  assert.equal(budget.entries.at(-1).at, 203);
});
