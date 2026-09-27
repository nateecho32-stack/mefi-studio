import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pet from "../scripts/companion-pet.cjs";

// The companion panel (renderer/companion-ui.js) names each personality and
// says what it does; scripts/companion-pet.cjs owns the list. A personality
// added or reworded on one side only would offer the owner a choice the host
// refuses, or describe it wrongly.

const source = await readFile(new URL("../renderer/companion-ui.js", import.meta.url), "utf8");

test("the panel offers exactly the host's personalities, in its words", () => {
  const block = source.slice(source.indexOf("const PERSONALITIES = ["), source.indexOf("];", source.indexOf("const PERSONALITIES = [")));
  const rows = [...block.matchAll(/\["(\w+)", "([^"]+)", "([^"]+)"\]/g)].map(([, id, label, says]) => ({ id, label, says }));
  assert.deepEqual(rows.map((row) => row.id), [...pet.PERSONALITIES]);
  for (const row of rows) assert.deepEqual({ label: row.label, says: row.says }, { ...pet.PERSONALITY_INFO[row.id] }, row.id);
});
