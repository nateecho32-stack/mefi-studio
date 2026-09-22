import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { scrubOutbound, safeExcerpt } from "../scripts/redaction.cjs";
import { buildClassifyRequest } from "../scripts/decision-client.mjs";

const home = os.homedir();
const source = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("the home directory never survives a scrub, in either separator form", () => {
  assert.equal(scrubOutbound(`${home}\\Coding Projects\\Mefi`), "~\\Coding Projects\\Mefi");
  assert.equal(scrubOutbound(`${home.split("\\").join("/")}/Coding Projects/Mefi`), "~/Coding Projects/Mefi");
  assert.equal(scrubOutbound(`open ${home} then ${home}`), "open ~ then ~", "every occurrence, not just the first");
  assert.equal(scrubOutbound("C:\\Users\\someoneelse\\notes.txt"), "~\\notes.txt", "another account's home is a leak too");
  assert.equal(scrubOutbound("D:/Users/other/x"), "~/x", "any drive letter, not just C");
  assert.equal(scrubOutbound("/home/runner/work/repo"), "~/work/repo");
  assert.ok(!scrubOutbound(`Project: ${home}\\a`).includes(os.userInfo().username), "the account name is what we are hiding");
});

test("the path tail is kept so the assistant can still discuss the project", () => {
  const scrubbed = scrubOutbound(`${home}\\Coding Projects\\Mefi's Studio AI+\\main.cjs`);
  assert.ok(scrubbed.includes("Coding Projects"), "whole-path masking would make the facts useless");
  assert.ok(scrubbed.includes("main.cjs"));
  assert.ok(scrubbed.startsWith("~"));
});

test("credential shapes are replaced and ordinary prose is left alone", () => {
  assert.equal(scrubOutbound("key sk-abcdefghijklmnopqrstuvwx here"), "key [redacted credential] here");
  assert.equal(scrubOutbound("ghp_abcdefghijklmnopqrstuvwxyz12"), "[redacted credential]");
  assert.equal(scrubOutbound("AKIAABCDEFGHIJKLMNOP"), "[redacted credential]");
  assert.equal(scrubOutbound('api_key: "hunter2"'), "api_key: [redacted]");
  assert.equal(scrubOutbound("https://user:pw@example.com/x"), "https://[redacted]@example.com/x");
  assert.match(scrubOutbound("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"), /^\[redacted private key\]$/);
  // False positives degrade the assistant, so the patterns stay narrow.
  for (const kept of ["the token map is a design idea", "see secrets.md for notes", "a password manager entry", "sk-short", "tokens: 412"]) {
    assert.equal(scrubOutbound(kept), kept, `"${kept}" must survive untouched`);
  }
});

test("the gate rewrites but never truncates", () => {
  const long = "a".repeat(20000);
  assert.equal(scrubOutbound(long).length, 20000, "truncating here would cut the end off a user's own question");
  assert.equal(scrubOutbound(""), "");
  assert.equal(scrubOutbound(null), "");
  assert.equal(scrubOutbound(undefined), "");
});

test("safeExcerpt keeps its Analyzer contract: scrub, trim, then clip", () => {
  assert.equal(safeExcerpt("  sk-abcdefghijklmnopqrstuvwx  "), "[redacted credential]");
  assert.equal(safeExcerpt("abcdef", 3), "abc");
  assert.equal(safeExcerpt(null), "");
  // Analyzer excerpts reach a provider through assistantFetch, which masks the
  // home prefix; safeExcerpt itself stays length-stable for its own callers.
  assert.ok(safeExcerpt(`${home}\\a.txt`).includes("a.txt"));
});

test("the Jev request body is scrubbed while its headers keep the key", () => {
  const request = buildClassifyRequest({
    config: { protocol: "evaluation", apiKey: "sk-liveKEY0123456789abcdef", model: "jev-1.13", baseUrl: "https://example.invalid/v1", maxStateChars: 4000 },
    questions: [{ id: "q1", type: "choice", prompt: `Does ${home}\\app\\main.cjs match?`, options: ["yes", "no"] }],
    state: { note: `scanned ${home}\\app` },
  });
  const body = JSON.stringify(request.body);
  assert.ok(!body.includes(home), "the Jev path bypasses assistantFetch, so it needs its own gate");
  assert.ok(body.includes("~"), "the masked prefix should be what replaced it");
  assert.ok(JSON.stringify(request.headers).includes("sk-liveKEY0123456789abcdef"), "the auth header must not be scrubbed");
});

// ---- structural guards: catch the NEXT leak, not just today's ----------------

test("every provider-bound POST still sits behind a scrub", async () => {
  const main = await source("main.cjs");
  const jev = await source("scripts/decision-client.mjs");
  // Two, and only two, places in the app POST to a model provider. If a third
  // appears this count changes and whoever added it has to route it through
  // scrubOutbound and update this test on purpose.
  assert.equal((main.match(/method: "POST"/g) ?? []).length, 1, "a new provider POST in main.cjs must route through assistantFetch");
  assert.equal((jev.match(/method: "POST"/g) ?? []).length, 1, "a new provider POST in decision-client.mjs must route through scrubDeep");

  const fetchBody = main.slice(main.indexOf("async function assistantFetch("), main.indexOf("async function assistantFetch(") + 900);
  assert.match(fetchBody, /user = scrubOutbound\(user\)/, "assistantFetch is the single gate for the assistant transports");
  assert.match(jev, /body: scrubDeep\(request\.body\)/, "buildClassifyRequest is the single gate for the Jev transport");
});

test("safeExcerpt has exactly one definition", async () => {
  const analyzer = await source("scripts/analyzer.mjs");
  assert.ok(!/function safeExcerpt\s*\(/.test(analyzer), "analyzer.mjs must import it, not redefine it");
  assert.match(analyzer, /import \{ safeExcerpt \} from "\.\/redaction\.cjs";/);
});
