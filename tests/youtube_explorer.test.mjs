import test from "node:test";
import assert from "node:assert/strict";
import explorer from "../scripts/youtube-explorer.cjs";

const video = (id = "M7lc1UVf-VE") => ({ videoRenderer: { videoId: id, title: { runs: [{ text: "Quiet <music>" }] }, ownerText: { runs: [{ text: "A channel" }] }, lengthText: { simpleText: "3:12" } } });
const data = { contents: [video(), video(), video("bad"), video("DRFHklnN-SM")] };
test("YouTube explorer reads public data without executing scripts, bounds results and deduplicates", () => {
  const json = JSON.stringify(data);
  const plain = explorer.searchResults(`<script>var ytInitialData = ${json};</script>`);
  const escaped = explorer.searchResults(`<script>var ytInitialData = '${Array.from(json).map(c => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")}';</script>`);
  assert.deepEqual(escaped, plain); assert.equal(plain.length, 2);
  assert.equal(plain[0].title, "Quiet <music>"); assert.equal(plain[0].url, "https://www.youtube.com/watch?v=M7lc1UVf-VE");
  assert.deepEqual(explorer.searchResults("<script>throw Error('never execute')</script>"), []);
});
test("YouTube search accepts only the trusted renderer, encodes queries and handles failures", async () => {
  const mainFrame = {}, webContents = { mainFrame }, win = { isDestroyed: () => false, webContents };
  const event = { sender: webContents, senderFrame: mainFrame }; let called = 0;
  const search = explorer.createYouTubeExplorer(() => win, async url => { called++; assert.equal(url, "https://www.youtube.com/results?search_query=music%20%26%20quiet"); return new Response(`<script>var ytInitialData = ${JSON.stringify(data)};</script>`); });
  assert.equal((await search({ ...event, senderFrame: {} }, "music & quiet")).ok, false);
  assert.equal((await search(event, "a".repeat(161))).ok, false); assert.equal(called, 0);
  assert.equal((await search(event, "music & quiet")).results.length, 2); assert.equal(called, 1);
  const failed = explorer.createYouTubeExplorer(() => win, async () => { throw Error("network details"); });
  const result = await failed(event, "music"); assert.equal(result.ok, false); assert.doesNotMatch(result.error, /network details/);
});
