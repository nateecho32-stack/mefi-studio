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

// ---- The mini player's Browse: more like a video, and page after page ({ related } and { more }).
// Every answer below is built by hand in YouTube's own shapes: no network, no clock.
const ORIGIN = "https://www.youtube.com";
const CURRENT = "dQw4w9WgXcQ";
const id = (n) => `v${String(n).padStart(10, "0")}`;
const token = (name) => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: name } } } });
const compact = (videoId, title, channel, time) => ({ compactVideoRenderer: { videoId, title: { simpleText: title }, longBylineText: { runs: [{ text: channel }] }, lengthText: { simpleText: time } } });
// The newer card YouTube uses for related videos: its length hides deep inside the picture's overlays.
const lockup = (videoId, title, channel, time) => ({ lockupViewModel: { contentId: videoId, contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
  contentImage: { thumbnailViewModel: { overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: time } }] } }] } },
  metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: channel } }] }] } } } } } });
const pageOf = (data, version = "2.20260101.00.00") => `<html>"INNERTUBE_CLIENT_VERSION":"${version}"<script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
const trusted = () => { const mainFrame = {}, webContents = { mainFrame }, win = { isDestroyed: () => false, webContents }; return { win, event: { sender: webContents, senderFrame: mainFrame } }; };
// An explorer over a fake fetch that answers from a queue and records every call.
function explorerWith(...answers) {
  const { win, event } = trusted(), calls = [];
  const search = explorer.createYouTubeExplorer(() => win, async (url, options) => {
    calls.push({ url, options });
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    return answer instanceof Response ? answer : typeof answer === "function" ? answer(url, options) : new Response(answer);
  });
  return { ask: (request, sender = event) => search(sender, request), calls, event, win };
}

test("Related: a watch page's side column lists more like the video, not the video itself, its comments or its own thread's paging", async () => {
  const watch = { contents: { twoColumnWatchNextResults: {
    results: { results: { contents: [token("COMMENTS-TOKEN-1234"), { videoRenderer: { videoId: "comment0001", title: { simpleText: "A comment that looks like a video" } } }] } },
    secondaryResults: { secondaryResults: { results: [
      lockup(id(1), "Related one", "Channel One", "4:05"), compact(id(2), "Related two", "Channel Two", "10:00"),
      lockup(CURRENT, "The video itself", "Nobody", "3:33"), lockup(id(3), "", "No title, so nothing to show", "1:00"), token("RELATED-TOKEN-5678")] } } } } };
  const { ask, calls } = explorerWith(pageOf(watch));
  const answer = await ask({ related: CURRENT });
  assert.deepEqual(calls.map((call) => call.url), [`${ORIGIN}/watch?v=${CURRENT}`]);
  assert.equal(calls[0].options.redirect, "error", "a redirect is an error, not something to follow");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.results.map((item) => [item.id, item.title, item.channel, item.duration, item.url]), [
    [id(1), "Related one", "Channel One", "4:05", `${ORIGIN}/watch?v=${id(1)}`],
    [id(2), "Related two", "Channel Two", "10:00", `${ORIGIN}/watch?v=${id(2)}`],
  ], "both card shapes, in order, without the video that is playing, the comment or the untitled card");
  assert.equal(answer.more, "RELATED-TOKEN-5678", "the token for the next page is the side column's, not the comments'");
});

test("Related asks only for a real video id, and a page with no side column falls back to the whole page", async () => {
  const { ask, calls } = explorerWith(pageOf({ contents: [compact(id(4), "Fallback", "A channel", "2:00")] }));
  for (const bad of ["not-an-id", "a".repeat(12), "short", "", 5, null, ["dQw4w9WgXcQ"]]) {
    const answer = await ask({ related: bad });
    assert.equal(answer.ok, false, JSON.stringify(bad)); assert.equal(calls.length, 0, "nothing is fetched for it");
  }
  assert.equal((await ask({ related: "not-an-id" })).error, "That is not a YouTube video.");
  const answer = await ask({ related: CURRENT });
  assert.deepEqual(answer.results.map((item) => item.id), [id(4)]);
  const empty = explorerWith(pageOf({ contents: {} }));
  assert.deepEqual(await empty.ask({ related: CURRENT }), { ok: false, error: "YouTube did not return videos. Try another search, or paste a video link." });
});

test("More: a search page's token pages on through YouTube's own search service, and each page hands out the next token", async () => {
  const first = { contents: [...[1, 2, 3].map((n) => compact(id(n), `Result ${n}`, "A", "1:00")), token("SEARCH-TOKEN-A")] };
  const second = { onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [compact(id(3), "Result 3", "A", "1:00"), compact(id(4), "Result 4", "B", "2:00"), token("SEARCH-TOKEN-B")] } }] };
  const third = { onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [compact(id(5), "Result 5", "C", "3:00"), token("SEARCH-TOKEN-C")] } }] };
  const empty = { onResponseReceivedCommands: [] };
  const { ask, calls } = explorerWith(pageOf(first, "2.20261231.01.00"), JSON.stringify(second), JSON.stringify(third), JSON.stringify(empty));
  const start = await ask("music");
  assert.equal(calls[0].url, `${ORIGIN}/results?search_query=music`);
  assert.equal(start.more, "SEARCH-TOKEN-A");
  const page2 = await ask({ more: start.more });
  assert.deepEqual(page2.results.map((item) => item.id), [id(3), id(4)], "the service's answer is read like a page");
  assert.equal(page2.more, "SEARCH-TOKEN-B");
  const request = calls[1];
  assert.equal(request.url, `${ORIGIN}/youtubei/v1/search?prettyPrint=false`, "a search's token goes back to the search endpoint");
  assert.equal(request.options.method, "POST"); assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), { context: { client: { clientName: "WEB", clientVersion: "2.20261231.01.00", hl: "en", gl: "US" } }, continuation: "SEARCH-TOKEN-A" }, "with the client version the page announced");
  assert.equal(request.url.includes("SEARCH-TOKEN"), false, "the token travels in the body, not the address");
  const page3 = await ask({ more: page2.more });
  assert.deepEqual([page3.results.map((item) => item.id), page3.more], [[id(5)], "SEARCH-TOKEN-C"]);
  assert.deepEqual(await ask({ more: page3.more }), { ok: false, error: "That is everything YouTube offered here." }, "a token whose page is empty says so");
  assert.equal(calls.length, 4);
});

test("More on a related list uses the watch service and a default client version when the page named none; a page shows at most forty", async () => {
  const many = { contents: { twoColumnWatchNextResults: { secondaryResults: { secondaryResults: { results: [...Array.from({ length: 45 }, (_, n) => compact(id(n + 100), `Video ${n}`, "A", "1:00")), token("RELATED-TOKEN-LATE")] } } } } };
  const next = { onResponseReceivedEndpoints: [{ appendContinuationItemsAction: { continuationItems: [compact(id(200), "More", "A", "1:00")] } }] };
  const { ask, calls } = explorerWith(`<script>var ytInitialData = ${JSON.stringify(many)};</script>`, JSON.stringify(next));
  const start = await ask({ related: CURRENT });
  assert.equal(start.results.length, 40, "forty videos to a page");
  assert.equal(start.more, "RELATED-TOKEN-LATE", "and the next page's token is still found beyond them");
  await ask({ more: start.more });
  assert.equal(calls[1].url, `${ORIGIN}/youtubei/v1/next?prettyPrint=false`);
  assert.equal(JSON.parse(calls[1].options.body).context.client.clientVersion, "2.20250101.00.00");
});

test("Only tokens this explorer handed out are accepted, and a token cannot choose where it is sent", async () => {
  const listing = (name) => pageOf({ contents: [compact(id(7), "Seven", "A", "1:00"), token(name)] });
  const { ask, calls } = explorerWith(listing("REAL-TOKEN-0001"));
  const start = await ask("music");
  assert.equal(start.more, "REAL-TOKEN-0001");
  for (const forged of ["never-issued-token-123", "REAL-TOKEN-0002", "real-token-0001", "", "../../etc/passwd", "a".repeat(5000)]) {
    assert.deepEqual(await ask({ more: forged }), { ok: false, error: "That list has no more videos." }, forged.slice(0, 20));
  }
  for (const odd of [123, ["REAL-TOKEN-0001"], { token: "REAL-TOKEN-0001" }, null, true]) {
    const answer = await ask({ more: odd }); assert.equal(answer.ok, false); assert.equal(answer.error, "Enter a search up to 160 characters.", "a token that is not text is not a token");
  }
  assert.equal(calls.length, 1, "no forged request reached YouTube");
  const other = explorerWith(listing("REAL-TOKEN-0001"));
  assert.equal((await other.ask({ more: "REAL-TOKEN-0001" })).ok, false, "another explorer never issued it");
  await ask({ more: "REAL-TOKEN-0001", endpoint: "player", version: "9.9", url: "https://evil.test/", continuation: "x" });
  assert.equal(calls[1].url, `${ORIGIN}/youtubei/v1/search?prettyPrint=false`, "the endpoint is the one recorded when the token was issued");
  assert.equal(JSON.parse(calls[1].options.body).continuation, "REAL-TOKEN-0001");
  // The page's own text is not trusted either: a token that is not the plain shape is never handed out.
  for (const shape of ["short", "has spaces in it", "../../etc/passwd", "semi;colon;token", "x".repeat(5000)]) {
    const odd = explorerWith(pageOf({ contents: [compact(id(8), "Eight", "A", "1:00"), token(shape)] }));
    assert.equal((await odd.ask("music")).more, null, shape.slice(0, 20));
    assert.equal((await odd.ask({ more: shape })).ok, false);
  }
});

test("The list of tokens handed out is bounded: the oldest is forgotten once twenty-four newer ones exist", async () => {
  let count = 0;
  const { ask, calls } = explorerWith((url) => new Response(pageOf({ contents: [compact(id(9), "Nine", "A", "1:00"), token(`TOKEN-NUMBER-${String(++count).padStart(3, "0")}`)] })));
  const issued = [];
  for (let index = 0; index < 25; index++) issued.push((await ask(`query ${index}`)).more);
  assert.equal(new Set(issued).size, 25);
  const before = calls.length;
  assert.deepEqual(await ask({ more: issued[0] }), { ok: false, error: "That list has no more videos." }, "the first of twenty-five is gone");
  assert.equal(calls.length, before, "and asking with it sends nothing");
  await ask({ more: issued[1] }); await ask({ more: issued[24] });
  assert.equal(calls.length, before + 2, "the second and the newest are still good: each one went to YouTube");
});

test("A newer request replaces the one in flight: the older is aborted and says so, and a late answer to it is dropped", async () => {
  const gates = [];
  const { ask, calls } = explorerWith((url, options) => new Promise((resolve, reject) => {
    gates.push({ url, options, resolve });
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const replaced = { ok: false, error: "A newer search replaced this one." };
  const older = ask("older"), newer = ask({ related: CURRENT });
  assert.equal(gates[0].options.signal.aborted, true, "the older request is aborted as the newer one starts");
  assert.deepEqual(await older, replaced);
  gates[1].resolve(new Response(pageOf({ contents: [compact(id(11), "Answer", "A", "1:00")] })));
  const answer = await newer; assert.equal(answer.ok, true); assert.deepEqual(answer.results.map((item) => item.id), [id(11)]);
  assert.equal(gates[1].options.signal.aborted, false, "the newer one is left alone");
  assert.equal(calls.length, 2);
  // A request that does not honour the abort and answers late is still dropped, whatever it found.
  const late = []; const stubborn = explorerWith((url) => new Promise((resolve) => late.push({ url, resolve })));
  const slow = stubborn.ask("slow"), quick = stubborn.ask("quick");
  late[1].resolve(new Response(pageOf({ contents: [compact(id(12), "Quick", "A", "1:00")] }))); assert.equal((await quick).ok, true);
  late[0].resolve(new Response(pageOf({ contents: [compact(id(13), "Slow", "A", "1:00")] })));
  assert.deepEqual(await slow, replaced, "its page is good, but it was asked before the newer one");
  // Paging is replaced like any other request: a search typed while a page is loading wins.
  const paging = []; const pager = explorerWith((url) => new Promise((resolve) => paging.push({ url, resolve })));
  const started = pager.ask("start");
  paging[0].resolve(new Response(pageOf({ contents: [compact(id(14), "Start", "A", "1:00"), token("PAGING-TOKEN-1")] })));
  const listed = await started;
  const nextPage = pager.ask({ more: listed.more }), fresh = pager.ask("fresh");
  paging[2].resolve(new Response(pageOf({ contents: [compact(id(15), "Fresh", "A", "1:00")] })));
  assert.equal((await fresh).ok, true);
  paging[1].resolve(new Response(JSON.stringify({ onResponseReceivedCommands: [{ appendContinuationItemsAction: { continuationItems: [compact(id(16), "Late page", "A", "1:00")] } }] })));
  assert.deepEqual(await nextPage, replaced, "a page that arrives after a newer search is not shown");
  // Nothing is left running: the next request is answered as usual.
  const after = pager.ask("after"); paging[3].resolve(new Response(pageOf({ contents: [compact(id(17), "After", "A", "1:00")] })));
  assert.equal((await after).ok, true);
});

test("A failed, oversize or unavailable answer is one plain message, whatever went wrong inside", async () => {
  const unavailable = { ok: false, error: "YouTube is unavailable right now. Try again, or paste a video link." };
  const cases = { "a server error": new Response("", { status: 503 }), "an oversize page": new Response(new Uint8Array(4_000_001)), "a refused redirect": () => { throw new TypeError("redirect mode is set to error"); }, "a page that is not JSON": new Response("<html>no data</html>") };
  for (const [name, answer] of Object.entries(cases)) {
    const one = explorerWith(answer);
    const result = await one.ask("music");
    assert.deepEqual(result, name === "a page that is not JSON" ? { ok: false, error: "YouTube did not return videos. Try another search, or paste a video link." } : unavailable, name);
  }
  const { ask } = explorerWith(pageOf({ contents: [compact(id(16), "Sixteen", "A", "1:00"), token("PAGE-TOKEN-XYZ")] }), () => new Response("{not json"));
  const start = await ask("music");
  assert.deepEqual(await ask({ more: start.more }), unavailable, "a paging answer that is not JSON is unavailable, not a crash");
});

test("Related and more are answered only to Studio's own window and frame", async () => {
  const { ask, calls, event } = explorerWith(pageOf({ contents: [compact(id(17), "Seventeen", "A", "1:00"), token("TRUSTED-TOKEN-1")] }));
  const start = await ask("music");
  const unavailable = { ok: false, error: "Search is unavailable here." };
  for (const request of [{ related: CURRENT }, { more: start.more }, "music"]) {
    assert.deepEqual(await ask(request, { sender: event.sender, senderFrame: {} }), unavailable, "a frame that is not the main frame");
    assert.deepEqual(await ask(request, { sender: {}, senderFrame: event.senderFrame }), unavailable, "a sender that is not the window");
  }
  const gone = explorer.createYouTubeExplorer(() => null, async () => { throw new Error("must not be called"); });
  assert.deepEqual(await gone(event, { related: CURRENT }), unavailable);
  assert.equal(calls.length, 1);
});
