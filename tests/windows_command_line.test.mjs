import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import windowsCommandLine from "../scripts/windows-command-line.cjs";

const {
  quoteWindowsCmdArg,
  quoteWindowsCmdPath,
  buildWindowsCmdArgs,
  resolveComSpec,
  requiresWindowsCmdWrapper,
} = windowsCommandLine;

// The two consumers of a quoted token, modelled so the tests can assert the
// property that matters — the target program receives the original string —
// instead of pinning one particular spelling of the escape.

// Stage 1: cmd.exe. A caret outside a quoted region escapes the next character
// and is removed; a real quote toggles the region. cmd has no notion of the
// argv layer's \" , which is exactly why escaping the quotes themselves leaves
// cmd with no region to enter.
function cmdStrip(token) {
  let out = "";
  let inQuotes = false;
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (char === "^" && !inQuotes && i + 1 < token.length) {
      out += token[i + 1];
      i += 1;
      continue;
    }
    if (char === '"') inQuotes = !inQuotes;
    out += char;
  }
  return out;
}

// Stage 2: the MSVCRT argv parser. A run of 2n backslashes before a quote is n
// backslashes and a region toggle; 2n+1 is n backslashes and a literal quote.
// Quote mode toggles within a token, so "a"^%"b c" is one argument.
function msvcrtParse(line) {
  const args = [];
  let current = "";
  let started = false;
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === "\\") {
      let slashes = 0;
      while (line[i] === "\\") {
        slashes += 1;
        i += 1;
      }
      if (line[i] === '"') {
        current += "\\".repeat(Math.floor(slashes / 2));
        started = true;
        if (slashes % 2 === 0) inQuotes = !inQuotes;
        else current += '"';
        i += 1;
      } else {
        current += "\\".repeat(slashes);
        started = true;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      started = true;
      i += 1;
      continue;
    }
    if (!inQuotes && (char === " " || char === "\t")) {
      if (started) args.push(current);
      current = "";
      started = false;
      i += 1;
      continue;
    }
    current += char;
    started = true;
    i += 1;
  }
  if (started) args.push(current);
  return args;
}

const roundTrip = (value) => msvcrtParse(cmdStrip(quoteWindowsCmdArg(value)));

const HOSTILE = [
  "plain",
  "with space",
  String.raw`C:\Program Files\node\node.exe`,
  "",
  'a"&calc',
  'say "hi" & whoami',
  "a&b",
  "a|b",
  "a>b",
  "a<b",
  "a^b",
  "a(b)c",
  "a!b",
  "50% off",
  "%OS%",
  "100%OS%x",
  "trailing\\",
  "trailing\\\\",
  String.raw`quote\"inside`,
  String.raw`C:\dir\"; & del /q *`,
  '";calc;"',
  "mixed %OS% & \"quoted\" ^ (stuff)",
];

test("every argument survives cmd and MSVCRT unchanged", () => {
  for (const value of HOSTILE) {
    assert.deepEqual(roundTrip(value), value === "" ? [""] : [value], `round trip for ${JSON.stringify(value)}`);
  }
});

test("ordinary values are not quoted, paths with spaces are, empty is inert", () => {
  assert.equal(quoteWindowsCmdArg("plain"), "plain");
  assert.equal(quoteWindowsCmdArg("--model"), "--model");
  assert.equal(quoteWindowsCmdArg("with space"), '"with space"');
  assert.equal(quoteWindowsCmdArg(""), '^"^"');
});

test("a quote-then-operator breakout leaves no live operator", () => {
  // The naive helper this replaces produced `"a^"&calc"`, where the embedded
  // quote closed the region and `&calc` ran. Nothing may reach cmd unescaped.
  const token = quoteWindowsCmdArg('a"&calc');
  assert.ok(!/(^|[^^])&/.test(token), `unescaped & in ${token}`);
  assert.deepEqual(roundTrip('a"&calc'), ['a"&calc']);
});

test("no operator is ever live outside a real quoted region", () => {
  for (const value of HOSTILE) {
    const token = quoteWindowsCmdArg(value);
    let inQuotes = false;
    for (let i = 0; i < token.length; i += 1) {
      const char = token[i];
      // A caret only escapes outside a quoted region; inside one it is a
      // literal, which is the whole reason the naive helper was a sink.
      if (char === "^" && !inQuotes) {
        i += 1;
        continue;
      }
      if (char === "\\") {
        let slashes = 0;
        while (token[i] === "\\") {
          slashes += 1;
          i += 1;
        }
        if (token[i] === '"' && slashes % 2 === 0) inQuotes = !inQuotes;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      assert.ok(
        inQuotes || !"&|<>".includes(char),
        `live ${char} outside quotes in ${token} (from ${JSON.stringify(value)})`,
      );
    }
  }
});

test("percent is always caret-escaped so no variable can expand", () => {
  // A real quoted region does not stop %VAR% expanding, so every % must sit
  // outside the quotes with a caret in front of it.
  for (const value of ["50% off", "%OS%", "100%OS%x", "a&b %PATH%"]) {
    const token = quoteWindowsCmdArg(value);
    assert.ok(!/(^|[^^])%/.test(token), `bare % in ${token}`);
  }
  assert.deepEqual(roundTrip("100%OS%x"), ["100%OS%x"]);
});

test("backslash runs before a quote and at the end are preserved", () => {
  assert.deepEqual(roundTrip("trailing\\"), ["trailing\\"]);
  assert.deepEqual(roundTrip(String.raw`a\\"b`), [String.raw`a\\"b`]);
  assert.deepEqual(roundTrip("C:\\dir\\"), ["C:\\dir\\"]);
});

test("the command path is conventionally quoted, never caret-escaped", () => {
  // cmd resolves this token itself, so it needs real delimiters; a caret-escaped
  // quote would be a literal character in the filename it looks for.
  assert.equal(quoteWindowsCmdPath("cmd.exe"), "cmd.exe");
  assert.equal(
    quoteWindowsCmdPath(String.raw`C:\Program Files\node\node.exe`),
    String.raw`"C:\Program Files\node\node.exe"`,
  );
  assert.ok(!quoteWindowsCmdPath(String.raw`C:\a b\x.exe`).includes("^"));
});

test("an executable path with a quote or expansion character is refused", () => {
  for (const bad of ['C:\\a"b\\x.exe', "C:\\%OS%\\x.exe", "C:\\a!b\\x.exe", "C:\\a\r\\x.exe"]) {
    assert.throws(() => quoteWindowsCmdPath(bad), { code: "ERR_CMD_PATH" }, bad);
  }
});

test("buildWindowsCmdArgs emits the verbatim form with one outer quote pair", () => {
  const args = buildWindowsCmdArgs("opencode", ["run", "--auto"]);
  assert.equal(args.length, 4);
  assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(args[3], '"opencode run --auto"');
});

test("buildWindowsCmdArgs quotes the command but escapes the arguments", () => {
  const args = buildWindowsCmdArgs(String.raw`C:\Program Files\cli\run.exe`, ["a&b"]);
  const line = args[3].slice(1, -1);
  assert.ok(line.startsWith(String.raw`"C:\Program Files\cli\run.exe"`), line);
  assert.ok(line.endsWith('"a&b"'), line);
});

test("buildWindowsCmdArgs rejects line breaks and NUL outright", () => {
  assert.throws(() => buildWindowsCmdArgs("cli", ["a\nb"]), { code: "ERR_CMD_ARG" });
  assert.throws(() => buildWindowsCmdArgs("cli", ["a\rb"]), { code: "ERR_CMD_ARG" });
  assert.throws(() => buildWindowsCmdArgs("cli", ["a\0b"]), { code: "ERR_CMD_ARG" });
  assert.throws(() => buildWindowsCmdArgs("cl\ni", []), { code: "ERR_CMD_ARG" });
});

test("a quoted argument is refused unless the command is an absolute .exe", () => {
  // Through a .cmd shim the argv layer's \" is a real quote to cmd when %* is
  // expanded, so the value cannot be delivered intact; fail instead of mangling.
  assert.throws(() => buildWindowsCmdArgs("claude", ['say "hi"']), { code: "ERR_CMD_ARG" });
  assert.throws(() => buildWindowsCmdArgs(String.raw`C:\shims\claude.cmd`, ['a"b']), {
    code: "ERR_CMD_ARG",
  });
  assert.doesNotThrow(() => buildWindowsCmdArgs(String.raw`C:\tools\claude.exe`, ['a"b']));
});

test("requiresWindowsCmdWrapper is false off Windows and true for shims", () => {
  assert.equal(requiresWindowsCmdWrapper("anything", "linux"), false);
  assert.equal(requiresWindowsCmdWrapper(String.raw`C:\tools\cli.exe`, "darwin"), false);
  assert.equal(requiresWindowsCmdWrapper("opencode", "win32"), true);
  assert.equal(requiresWindowsCmdWrapper(String.raw`C:\shims\claude.cmd`, "win32"), true);
  assert.equal(requiresWindowsCmdWrapper(String.raw`tools\cli.exe`, "win32"), true);
  assert.equal(requiresWindowsCmdWrapper(String.raw`C:\tools\cli.exe`, "win32"), false);
  assert.equal(requiresWindowsCmdWrapper(String.raw`C:\tools\CLI.EXE`, "win32"), false);
});

// The tests above reason about cmd and MSVCRT through models. This one asks the
// real shell on the real platform, because the claim that matters most — that a
// value survives a .cmd shim expanding %*, where cmd has already stripped every
// caret — cannot be checked any other way.
test("a real cmd.exe delivers every argument intact, shim included", { skip: process.platform !== "win32" ? "Windows only" : false }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-wcl-"));
  try {
    const echo = path.join(dir, "echo-argv.mjs");
    writeFileSync(echo, "console.log(JSON.stringify(process.argv.slice(2)));\n");
    // Shaped like an npm wrapper: the %* forward is where caret-escaped values
    // are destroyed, so a shim is the honest test subject.
    const shim = path.join(dir, "shim.cmd");
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${echo}" %*\r\n`);

    const run = (command, args) => {
      const result = spawnSync(
        resolveComSpec(),
        buildWindowsCmdArgs(command, args),
        { windowsVerbatimArguments: true, encoding: "utf8" },
      );
      assert.equal(result.status, 0, `cmd exited ${result.status}: ${result.stderr}`);
      return JSON.parse(result.stdout);
    };

    const values = HOSTILE.filter((value) => !value.includes('"') && value.length > 0);
    assert.deepEqual(run(process.execPath, [echo, ...values]), values, "direct absolute .exe");
    assert.deepEqual(run(shim, values), values, "through a .cmd shim's %*");

    // A quote-bearing value reaches a direct executable unharmed...
    const quoted = HOSTILE.filter((value) => value.includes('"'));
    assert.deepEqual(run(process.execPath, [echo, ...quoted]), quoted, "quoted values, direct .exe");
    // ...and is refused rather than mangled when the target could be a batch.
    for (const value of quoted) {
      assert.throws(() => buildWindowsCmdArgs(shim, [value]), { code: "ERR_CMD_ARG" }, value);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveComSpec prefers ComSpec and falls back to cmd.exe", () => {
  assert.equal(resolveComSpec({ ComSpec: String.raw`C:\Windows\System32\cmd.exe` }), String.raw`C:\Windows\System32\cmd.exe`);
  assert.equal(resolveComSpec({}), "cmd.exe");
  assert.equal(resolveComSpec({ ComSpec: "" }), "cmd.exe");
});
