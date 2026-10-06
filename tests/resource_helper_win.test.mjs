// The real resource helper (scripts/resource-helper.cs), built with Windows'
// own C# compiler and driven over its pipes against a throwaway busy child:
// it lists the child, slows it (idle priority), pauses it (every thread
// suspended, its work stops), refuses a reused pid and Studio itself, puts
// everything back when its stdin closes, and a second helper adopts and puts
// back what a killed one left behind. Windows only; skipped elsewhere and when
// .NET Framework's csc.exe is missing.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "resource-helper.cs");
const CSC = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
const windows = process.platform === "win32";
const hasCsc = windows && (await access(CSC).then(() => true, () => false));
const skip = !windows ? "the resource helper is Windows only" : !hasCsc ? "csc.exe (.NET Framework 4) is not on this PC" : false;

function helperAt(exe, studioPid) {
  const child = spawn(exe, [String(studioPid)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: true });
  let buffer = "";
  const waiting = new Map();
  let ready;
  const started = new Promise((resolve, reject) => { ready = resolve; child.once("error", reject); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const reply = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (reply.ready) { ready(reply); continue; }
      waiting.get(reply.id)?.(reply);
      waiting.delete(reply.id);
    }
  });
  let next = 1;
  const ask = (op, arg = "") => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`no answer to ${op}`)), 20000);
    waiting.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
    child.stdin.write(`${id} ${op}${arg ? ` ${arg}` : ""}\n`);
  });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, ask, started, exited };
}

const row = (snap, pid) => snap.procs.find((entry) => entry[0] === pid);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("the real helper slows, pauses, refuses and puts back a throwaway process, and a new helper adopts what a killed one held", { skip, timeout: 120000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mefi-resource-helper-"));
  const exe = path.join(dir, "resource-helper-test.exe");
  // A busy child that prints a dot per slice of work: paused, the dots stop.
  const busy = spawn(process.execPath, ["-e", "let n=0; for(;;){ n++; if (n % 2e6 === 0) process.stdout.write('.'); }"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  let dots = 0;
  busy.stdout.on("data", (chunk) => { dots += String(chunk).length; });
  const helpers = [];
  try {
    await new Promise((resolve, reject) => execFile(CSC, ["/nologo", "/optimize+", "/target:exe", "/platform:anycpu", `/out:${exe}`, SOURCE], { windowsHide: true, timeout: 90000 }, (error, stdout) => (error ? reject(new Error(`${error.message}\n${stdout}`)) : resolve())));
    const first = helperAt(exe, process.pid);
    helpers.push(first);
    const hello = await first.started;
    assert.equal(hello.version, "1");
    assert.equal(hello.bits, 64);
    await sleep(300);

    let snap = await first.ask("snap");
    assert.equal(snap.ok, true);
    assert.ok(snap.procs.length > 20, "the whole process table");
    assert.ok(snap.mem[0] > 0 && snap.mem[1] > 0 && snap.mem[1] <= snap.mem[0]);
    const mine = row(snap, busy.pid);
    assert.ok(mine, "the busy child is listed");
    assert.equal(typeof mine[3], "string", "the creation time travels as a string (a FILETIME is past 2^53)");
    assert.equal(mine[2].toLowerCase(), "node.exe");
    assert.equal(mine[1], process.pid);
    const target = `${busy.pid}:${mine[3]}`;

    const slowed = await first.ask("slow", target);
    assert.equal(slowed.results[0].ok, true);
    snap = await first.ask("snap");
    assert.equal(row(snap, busy.pid)[9], 4, "idle priority");
    assert.equal(snap.ledger.find((entry) => entry.pid === busy.pid)?.slowed, true);

    const paused = await first.ask("pause", target);
    assert.equal(paused.results[0].ok, true);
    await sleep(200);
    const before = dots;
    await sleep(1000);
    assert.equal(dots, before, "a paused process does no work");
    snap = await first.ask("snap");
    assert.equal(row(snap, busy.pid)[11], 1, "every thread suspended");
    assert.equal((await first.ask("trim", target)).results[0].ok, true);

    assert.equal((await first.ask("pause", `${busy.pid}:123`)).results[0].error, "gone", "a creation time that does not match is another process");
    assert.equal((await first.ask("slow", `${process.pid}:${row(snap, process.pid)[3]}`)).results[0].error, "studio", "Studio's own pid is never touched");
    assert.equal((await first.ask("pause", "4:0")).results[0].error, "system");

    // Killed while holding: nothing is put back, the child stays frozen.
    first.child.kill();
    await first.exited;
    const stuck = dots;
    await sleep(800);
    assert.equal(dots, stuck, "a killed helper put nothing back");

    // A new helper adopts the journal's entry and puts it back.
    const second = helperAt(exe, process.pid);
    helpers.push(second);
    await second.started;
    const adopted = await second.ask("adopt", `${target}:ps:32:5`);
    assert.equal(adopted.results[0].ok, true);
    assert.equal(adopted.ledger[0].paused, true);
    assert.equal((await second.ask("restore", target)).results[0].ok, true);
    await sleep(800);
    assert.ok(dots > stuck, "it runs again");
    snap = await second.ask("snap");
    assert.equal(row(snap, busy.pid)[9], 8, "and at its old priority");
    assert.deepEqual(snap.ledger, []);

    // Its stdin closing (Studio quitting or crashing) puts everything back.
    await second.ask("pause", target);
    await second.ask("slow", target);
    const frozen = dots;
    await sleep(600);
    assert.equal(dots, frozen);
    second.child.stdin.end();
    assert.equal(await second.exited, 0);
    await sleep(800);
    assert.ok(dots > frozen, "running again after the helper's input closed");

    const third = helperAt(exe, process.pid);
    helpers.push(third);
    await third.started;
    snap = await third.ask("snap");
    assert.equal(row(snap, busy.pid)[9], 8, "priority back too");
    const ended = await third.ask("end", `${busy.pid}:${row(snap, busy.pid)[3]}`);
    assert.equal(ended.results[0].ok, true);
    await new Promise((resolve) => (busy.exitCode !== null ? resolve() : busy.once("exit", resolve)));
    assert.equal(busy.exitCode, 1, "ended by the helper");
    const bye = await third.ask("exit");
    assert.equal(bye.ok, true);
  } finally {
    for (const helper of helpers) { try { helper.child.kill(); } catch {} }
    try { busy.kill(); } catch {}
    await sleep(300);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
