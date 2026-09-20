import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { tailLog } from "../scripts/eyes.mjs";

const originalOpen = fs.open;
const CAP = 512 * 1024;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mefi-log-tail-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, "opencode.log");
}

function instrumentOpen(t, implementation) {
  t.mock.method(fs, "open", implementation);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

test("log tail keeps line endings, Unicode and existing line-count behavior", async (t) => {
  const logPath = await fixture(t);
  await fs.writeFile(logPath, "");
  assert.equal(await tailLog({ logPath }), "");
  const text = "first\r\nsecond 🐈\r\nthird café\r\n";
  await fs.writeFile(logPath, text);
  assert.equal(await tailLog({ logPath }), text);
  assert.equal(await tailLog({ logPath, lines: 2 }), "third café\r\n");
  assert.equal(await tailLog({ logPath, lines: 0 }), text);
  await fs.writeFile(logPath, "first\nlast");
  assert.equal(await tailLog({ logPath, lines: 1 }), "last");
});

test("missing logs, including missing parents, produce an empty tail", async (t) => {
  const logPath = await fixture(t);
  assert.equal(await tailLog({ logPath }), "");
  assert.equal(await tailLog({ logPath: path.join(logPath, "missing.log") }), "");
  await fs.writeFile(logPath, "a file cannot contain a child log");
  assert.equal(await tailLog({ logPath: path.join(logPath, "child.log") }), "");
});

test("large logs read only the final 512 KiB, handling short reads and closing the descriptor", async (t) => {
  const logPath = await fixture(t);
  const suffix = "\nsecond\nfinal";
  await fs.writeFile(logPath, Buffer.alloc(4 * 1024 * 1024, 0x78));
  await fs.appendFile(logPath, suffix);
  const size = 4 * 1024 * 1024 + Buffer.byteLength(suffix);
  let consumed = 0, calls = 0, closed = 0;
  instrumentOpen(t, async (filename, flags) => {
    assert.equal(filename, logPath);
    assert.equal(flags, "r");
    const handle = await originalOpen(filename, flags);
    return {
      stat: () => handle.stat(),
      async read(buffer, offset, length, position) {
        assert.equal(buffer.length, CAP);
        assert.equal(position, size - CAP + consumed);
        assert.ok(position + length <= size);
        const result = await handle.read(buffer, offset, Math.min(length, 17_003), position);
        consumed += result.bytesRead;
        calls += 1;
        return result;
      },
      async close() { closed += 1; await handle.close(); },
    };
  });
  assert.equal(await tailLog({ logPath, lines: 2 }), "second\nfinal");
  assert.equal(consumed, CAP);
  assert.ok(calls > 1);
  assert.equal(closed, 1);
});

test("the clipped byte window does not introduce a broken UTF-8 prefix", async (t) => {
  const logPath = await fixture(t);
  // The final window starts at the second byte of this four-byte character.
  const rest = "x".repeat(CAP - 3);
  await fs.writeFile(logPath, `prefix🐈${rest}`);
  assert.equal(await tailLog({ logPath }), rest);
});

test("rotation reads a consistent opened file and the next refresh sees its replacement", async (t) => {
  const logPath = await fixture(t);
  await fs.writeFile(logPath, "old log\nold end");
  let rotated = false, closed = 0;
  instrumentOpen(t, async (filename, flags) => {
    const handle = await originalOpen(filename, flags);
    return {
      async stat() {
        if (!rotated) {
          rotated = true;
          await fs.rename(logPath, `${logPath}.old`);
          await fs.writeFile(logPath, "new log\nnew end");
        }
        return handle.stat();
      },
      read: (...args) => handle.read(...args),
      async close() { closed += 1; await handle.close(); },
    };
  });
  assert.equal(await tailLog({ logPath, lines: 1 }), "old end");
  assert.equal(await tailLog({ logPath, lines: 1 }), "new end");
  assert.equal(closed, 2);
});

test("truncation below the captured offset retries once against the new file size", async (t) => {
  const logPath = await fixture(t);
  await fs.writeFile(logPath, Buffer.alloc(CAP * 2, 0x78));
  let truncated = false, consumed = 0, closed = 0;
  instrumentOpen(t, async (filename, flags) => {
    const handle = await originalOpen(filename, flags);
    return {
      stat: () => handle.stat(),
      async read(...args) {
        if (!truncated) {
          truncated = true;
          await fs.writeFile(logPath, "fresh log\nfresh end");
        }
        const result = await handle.read(...args);
        consumed += result.bytesRead;
        return result;
      },
      async close() { closed += 1; await handle.close(); },
    };
  });
  assert.equal(await tailLog({ logPath, lines: 1 }), "fresh end");
  assert.equal(consumed, Buffer.byteLength("fresh log\nfresh end"));
  assert.equal(closed, 1);
});

test("truncation after a partial read returns only initialized bytes and closes", async (t) => {
  const logPath = await fixture(t);
  await fs.writeFile(logPath, "captured bytes\nmore bytes");
  let reads = 0, closed = 0;
  instrumentOpen(t, async (filename, flags) => {
    const handle = await originalOpen(filename, flags);
    return {
      stat: () => handle.stat(),
      async read(buffer, offset, length, position) {
        if (reads++) await fs.truncate(logPath, 0);
        return handle.read(buffer, offset, Math.min(length, 8), position);
      },
      async close() { closed += 1; await handle.close(); },
    };
  });
  assert.equal(await tailLog({ logPath }), "captured");
  assert.equal(reads, 2);
  assert.equal(closed, 1);
});

test("persistent EOF cannot cause an unbounded truncation retry", async (t) => {
  let reads = 0, closed = 0;
  instrumentOpen(t, async () => ({
    stat: async () => ({ size: CAP * 2 }),
    read: async () => { reads += 1; return { bytesRead: 0 }; },
    close: async () => { closed += 1; },
  }));
  assert.equal(await tailLog({ logPath: "virtual.log" }), "");
  assert.equal(reads, 2);
  assert.equal(closed, 1);
});

test("stat and read failures propagate while always closing the opened descriptor", async (t) => {
  for (const failure of ["stat", "read"]) {
    await t.test(failure, async (t) => {
      const error = Object.assign(new Error("fixture I/O failure"), { code: "EIO" });
      let closed = 0;
      instrumentOpen(t, async () => ({
        async stat() { if (failure === "stat") throw error; return { size: 20 }; },
        async read() { throw error; },
        async close() { closed += 1; },
      }));
      await assert.rejects(tailLog({ logPath: "virtual.log" }), (caught) => caught === error);
      assert.equal(closed, 1);
    });
  }
});

test("unexpected open errors remain visible to the caller", async (t) => {
  const error = Object.assign(new Error("fixture permission failure"), { code: "EACCES" });
  instrumentOpen(t, async () => { throw error; });
  await assert.rejects(tailLog({ logPath: "virtual.log" }), (caught) => caught === error);
});
