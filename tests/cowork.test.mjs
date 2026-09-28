// Guard tests for scripts/cowork.cjs, live file claims between PCs: claim
// paths follow the hub's rules, overlap is the hub's, only other PCs' live
// exclusive claims hold a pick, and a job's files become claim paths only
// inside the project.
//
// Run: node --test tests/cowork.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cowork = require("../scripts/cowork.cjs");
const ME = "123456789012345678", FRIEND = "223456789012345678";
const lease = (fields = {}) => cowork.lease({ leaseId: "lease_1", memberId: ME, machineId: "pc-desk", runId: "run_1", paths: ["src/app.js"], exclusive: true, fence: 1, at: 1, expiresAt: 10_000, title: "Fix login", ...fields });

test("claim paths are repo-relative POSIX, an exact file or dir/**, as the hub keeps them", () => {
  for (const [raw, kept] of [["src/app.js", "src/app.js"], ["src\\app.js", "src/app.js"], ["./src//app.js", "src/app.js"], ["src/**", "src/**"], ["docs/./a.md", "docs/a.md"]]) assert.equal(cowork.claimPath(raw), kept, raw);
  for (const refused of ["", "/etc/passwd", "C:/Users/x/app.js", "c:\\x", "../outside.js", "src/../x", "src/", "**", " src/a.js", "src/a.js ", "src/*.js", "src/a?.js", "src/**/x.js", "a\u0000b", 5, null, "x".repeat(201)]) assert.equal(cowork.claimPath(refused), null, JSON.stringify(refused));
});

test("overlap folds case, compares whole segments, and dir/** covers the folder", () => {
  assert.equal(cowork.overlaps("src/App.js", "SRC/app.js"), true);
  assert.equal(cowork.overlaps("src/a", "src/ab"), false, "whole segments");
  assert.equal(cowork.overlaps("src/**", "src/x/y.js"), true);
  assert.equal(cowork.overlaps("src/x/y.js", "src/**"), true);
  assert.equal(cowork.overlaps("src/**", "src"), true, "a file named like the folder");
  assert.equal(cowork.overlaps("src/**", "lib/x.js"), false);
  assert.equal(cowork.overlaps("src/a.js", "src/a.js/b"), false);
});

test("a lease keeps the protocol's shape or is dropped", () => {
  assert.deepEqual({ ...lease() }, { leaseId: "lease_1", memberId: ME, machineId: "pc-desk", runId: "run_1", title: "Fix login", branch: null, paths: ["src/app.js"], exclusive: true, fence: 1, at: 1, expiresAt: 10_000 });
  for (const broken of [{ leaseId: "bad id!" }, { memberId: "42" }, { machineId: "has space" }, { expiresAt: "soon" }]) assert.equal(lease(broken), null, JSON.stringify(broken));
  assert.deepEqual(lease({ paths: ["ok.js", "../no.js", "/abs"] }).paths, ["ok.js"], "bad paths are left out");
});

test("only other PCs' live exclusive claims hold a pick", () => {
  const self = { memberId: ME, machineId: "pc-desk" };
  const leases = [
    lease({ leaseId: "mine" }),
    lease({ leaseId: "laptop", machineId: "pc-laptop", paths: ["src/app.js", "docs/**"], title: "Refactor" }),
    lease({ leaseId: "friend", memberId: FRIEND, machineId: "pc-desk", paths: ["lib/util.js"] }),
    lease({ leaseId: "shared", memberId: FRIEND, machineId: "x", exclusive: false, paths: ["README.md"] }),
    lease({ leaseId: "stale", memberId: FRIEND, machineId: "x", expiresAt: 500, paths: ["old.js"] }),
    lease({ leaseId: "presence", memberId: FRIEND, machineId: "x", paths: [] }),
  ];
  const held = cowork.heldElsewhere(leases, self, 1000);
  assert.deepEqual(held.map((job) => [job.leaseId, job.files]), [["laptop", ["src/app.js", "docs"]], ["friend", ["lib/util.js"]]]);
  assert.equal(held[0].title, "Refactor (on another PC)");
  assert.ok(held.every((job) => !job.finished), "they read as in-flight jobs to claimWork");
});

test("a job's files become claim paths only inside the project", () => {
  const root = path.resolve("C:/work/app");
  assert.deepEqual(cowork.claimPathsFor(root, ["src/app.js", path.join(root, "lib", "u.js"), path.resolve("C:/elsewhere/x.js"), "../up.js", "src/app.js", 7, ""]), ["src/app.js", "lib/u.js"]);
  assert.equal(cowork.claimPathsFor(root, Array.from({ length: 80 }, (_, index) => `f${index}.js`)).length, 50, "at most 50, the hub's cap");
});

test("a conflict says who holds what, and settings keep only good rooms and this PC's id", () => {
  assert.equal(cowork.conflictNote([{ title: "Fix login", overlapping: ["src/app.js", "src/auth.js"] }]), 'Another PC is working on the same files: "Fix login" (src/app.js, src/auth.js). This waits until it lets go.');
  assert.match(cowork.conflictNote([]), /waits until it lets go/);
  assert.deepEqual(JSON.parse(JSON.stringify(cowork.normalizeSettings({ rooms: { "Owner/App": "room_1", "not a repo": "room_2", "owner/x": "bad id!" }, machineId: "pc-1" }))), { rooms: { "owner/app": "room_1" }, machineId: "pc-1" });
  assert.equal(cowork.normalizeSettings({ machineId: "no spaces allowed" }).machineId, null);
});
