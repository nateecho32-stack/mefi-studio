// The shared renderer DOM stand-in has to be trustworthy before nineteen
// suites lean on it, so its selector matcher and its template reader are
// checked here rather than discovered wrong inside somebody else's failure.
import test from "node:test";
import assert from "node:assert/strict";

import { Element, createDom, templateIds, templateHasId } from "./fixtures/renderer-dom.mjs";

const tree = () => {
  const root = new Element("div", "root");
  const list = new Element("ul");
  list.className = "feed-queue pin-list";
  const first = new Element("li");
  first.className = "feed-row active";
  first.setAttribute("data-task-id", "t1");
  const second = new Element("li");
  second.className = "feed-row";
  second.setAttribute("data-task-id", "t2");
  second.hidden = true;
  list.append(first, second);
  root.append(list);
  return { root, list, first, second };
};

test("the matcher covers the selector shapes the renderer suites use", () => {
  const { root, list, first, second } = tree();
  assert.equal(root.querySelectorAll("*").length, 3, "* reaches every descendant");
  assert.deepEqual(root.querySelectorAll("li").map((el) => el.dataset.taskId), ["t1", "t2"]);
  assert.deepEqual(root.querySelectorAll(".feed-row.active").map((el) => el.dataset.taskId), ["t1"]);
  assert.deepEqual(root.querySelectorAll("[data-task-id]").map((el) => el.dataset.taskId), ["t1", "t2"]);
  assert.deepEqual(root.querySelectorAll('[data-task-id="t2"]').map((el) => el.dataset.taskId), ["t2"]);
  assert.deepEqual(root.querySelectorAll("[hidden]"), [second], "a boolean property answers an attribute selector");
  assert.deepEqual(root.querySelectorAll("ul li.active"), [first], "a descendant chain walks real ancestors");
  assert.deepEqual(root.querySelectorAll("li.active, li[data-task-id='t2']").length, 2, "comma lists union their branches");
  assert.equal(root.querySelector("#root"), null, "querySelectorAll never returns the element it was called on");
  assert.equal(list.querySelectorAll("section li").length, 0, "a chain whose ancestor step cannot match finds nothing");
  assert.equal(list.querySelectorAll("div li").length, 2, "like the real DOM, a descendant chain may match an ancestor above the element searched");
});

test("a node knows its own place: closest, contains and matches", () => {
  const { root, list, first } = tree();
  assert.equal(first.closest("ul"), list);
  assert.equal(first.closest("#root"), root);
  assert.equal(first.closest(".missing"), null);
  assert.ok(root.contains(first));
  assert.ok(!first.contains(root));
  assert.ok(first.matches(".feed-row"));
  assert.ok(!first.matches(".feed-row.gone"));
});

test("attributes, dataset and classList stay in step with each other", () => {
  const node = new Element("button");
  node.setAttribute("data-rail-view", "work");
  assert.equal(node.dataset.railView, "work", "a data- attribute lands in dataset camelCased");
  assert.equal(node.getAttribute("data-rail-view"), "work");
  node.setAttribute("class", "rail-tab primary");
  assert.ok(node.classList.contains("rail-tab"));
  assert.equal(node.className, "rail-tab primary");
  node.classList.toggle("primary", false);
  assert.equal(node.getAttribute("class"), "rail-tab");
  node.setAttribute("hidden", "");
  assert.equal(node.hidden, true);
  node.removeAttribute("hidden");
  assert.equal(node.getAttribute("hidden"), null);
});

test("structure changes keep parentNode honest", () => {
  const { root, list, first, second } = tree();
  assert.equal(first.parentNode, list);
  const third = new Element("li");
  list.insertBefore(third, second);
  assert.deepEqual(list.children, [first, third, second]);
  assert.equal(third.parentNode, list);
  third.remove();
  assert.deepEqual(list.children, [first, second]);
  assert.equal(third.parentNode, null);
  root.textContent = "wiped";
  assert.deepEqual(root.children, []);
  assert.equal(list.parentNode, null, "clearing a parent lets go of its children");
});

test("listeners fire through trigger and click", async () => {
  const node = new Element("button");
  const seen = [];
  node.addEventListener("click", (event) => seen.push(event.target === node));
  await node.click();
  assert.deepEqual(seen, [true]);
  await node.trigger("click", { shiftKey: true });
  assert.equal(seen.length, 2);
});

test("createDom mints ids on demand and searches the whole tree", () => {
  const { document, get } = createDom({ ids: ["idle-feed"] });
  assert.ok(document.getElementById("idle-feed"), "a seeded id exists up front");
  assert.equal(document.getElementById("never-asked-for"), null, "an unseeded id stays absent until get() mints it");
  const rail = get("cmd-rail");
  const tab = new Element("button");
  tab.setAttribute("data-rail-view", "node");
  rail.append(tab);
  assert.deepEqual(document.querySelectorAll('[data-rail-view="node"]'), [tab]);
});

test("template ids come from the real template, not a copied list", () => {
  const all = templateIds();
  assert.ok(all.length > 200, `the template should carry hundreds of ids, saw ${all.length}`);
  assert.ok(all.includes("idle-feed"), "a Command id is present");
  assert.ok(all.includes("workspace-layer"), "a Workspace id is present");
  assert.equal(new Set(all).size, all.length, "ids are returned unique");
  const command = templateIds(/^cmd-/);
  assert.ok(command.includes("cmd-rail") && command.every((id) => id.startsWith("cmd-")), "a pattern filters the list");
  assert.ok(templateHasId("idle-hud"));
  assert.ok(!templateHasId("a-surface-that-never-shipped"));
});

test("seeding from the template follows the markup instead of a hardcoded set", () => {
  const { document } = createDom({ fromTemplate: /^cmd-rail/ });
  assert.ok(document.getElementById("cmd-rail"), "the rail seeds itself from the template");
  assert.ok(document.getElementById("cmd-rail-body"));
});
