import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
const source = await readFile(new URL("../renderer/social-content.js", import.meta.url), "utf8");
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.text = ""; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  click() { if (!this.disabled) return this.listeners.click?.(); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelector(tag) { return this.children.find(child => child.tagName === tag) || this.children.map(child => child.querySelector(tag)).find(Boolean); }
}
function setup(off = false) {
  const calls = [], confirmations = [], window = { confirm: text => { confirmations.push(text); return true; }, mefiStudio: { openExternal: url => calls.push(url) } };
  vm.runInNewContext(source, { URL, window, document: { createElement: tag => new Element(tag) }, localStorage: { getItem: () => off ? "off" : null } });
  const all = root => [root, ...root.children.flatMap(all)];
  return { api: window.MefiSocialContent, calls, confirmations, all };
}
test("private addresses, disguised credentials and secret-bearing links are rejected before display and posting", () => {
  const { api } = setup();
  for (const value of ["http://example.com", "https://127.1/", "https://0x7f000001/", "https://2130706433/", "https://[::1]/", "https://box.local./", "https://localhost/", "https://user:pass@example.com/", "https://example.com:8443/", "https://example.com/?%74oken=secret", "https://example.com/#access_token=private", "https://example.com/\u202etxt", "https://good.com\\@evil.com"]) {
    assert.equal(api.inspect(value).ok, false, value);
    assert.equal(api.checkPost(`try ${value}`).ok, false, value);
    assert.ok(!api.content(`try ${value}`).textContent.includes(value), value);
  }
  assert.equal(api.inspect("https://docs.github.com/en").ok, true);
  assert.equal(api.inspect("https://youtube.com.evil.com/watch?v=jNQXAC9IVRw").embed, null);
});
test("rendering a link creates no image, frame or navigation; loading a player is explicit and bounded", () => {
  const { api, all, calls, confirmations } = setup();
  const root = api.content('<img onerror="evil()"> https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.equal(all(root).some(el => ["iframe", "img", "script", "a"].includes(el.tagName)), false);
  assert.equal(calls.length, 0); assert.ok(root.textContent.includes('<img onerror="evil()">'));
  all(root).find(el => el.textContent === "Load YouTube player").click();
  const frame = root.querySelector("iframe"); assert.equal(frame.src, "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw");
  assert.equal(frame.attrs.referrerpolicy, "no-referrer"); assert.ok(!frame.attrs.sandbox.includes("allow-popups"));
  all(root).find(el => el.textContent === "Close player").click(); assert.equal(root.querySelector("iframe"), undefined);
  all(root).find(el => el.textContent === "Open link…").click(); assert.equal(confirmations.length, 1); assert.match(confirmations[0], /IP address/); assert.equal(calls.length, 1);
  assert.ok(all(api.content(Array(30).fill("https://docs.github.com").join(" "))).filter(el => el.className === "rooms-link-card").length <= 4);
});
test("the content kill switch disables cards while keeping secret-link redaction", () => {
  const { api, all } = setup(true), root = api.content("https://example.com/?token=secret https://docs.github.com");
  assert.equal(all(root).filter(el => el.tagName === "button").length, 0);
  assert.equal(root.textContent.includes("token=secret"), false); assert.equal(root.textContent.includes("https://docs.github.com"), true);
});

test("encoded fragment credentials are blocked even beside malformed escapes, while normal anchors remain usable", () => {
  const urls = ["https://docs.github.com/#%74%6f%6b%65%6e=private-token", "https://docs.github.com/#/callback?%63ode%3dprivate-code", "https://docs.github.com/#bad%ZZ?%61uth=private-auth", "https://docs.github.com/#sessionid=private-session"];
  for (const off of [false, true]) {
    const { api, all, calls } = setup(off);
    for (const url of urls) {
      assert.equal(api.inspect(url).ok, false, url);
      assert.equal(api.checkPost(`Shared ${url}`).ok, false, url);
      const displayed = api.content(`Shared ${url}`);
      assert.equal(displayed.textContent.includes("private-"), false, url);
      assert.equal(all(displayed).some(el => ["button", "iframe", "img"].includes(el.tagName)), false);
    }
    assert.equal(calls.length, 0);
    assert.equal(api.inspect("https://docs.github.com/en#%61ccessibility").ok, true);
  }
});
