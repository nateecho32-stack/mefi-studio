// Correct argument quoting for the `cmd.exe /d /s /c "<line>"` spawn pattern.
//
// Ported from BetterC0de (MIT), apps/backend/src/security/windowsCommandLine.ts.
// See THIRD_PARTY_NOTICES.md. The algorithm below is theirs; the reasoning in
// this header is condensed from their comments because it is the part that is
// easy to get wrong by hand.
//
// Why the pattern exists: since the Node fix for CVE-2024-27980, spawning a
// `.cmd`/`.bat` without a shell throws EINVAL, so every CLI launched through
// an npm-style shim goes through cmd.exe. Node's own `shell: true` re-escapes
// inner quotes as \" , which cmd does not understand, so the line has to be
// built by hand — which makes the escaping the caller's problem.
//
// The naive form, `"` + value.replace(/([()%!^"<>&|])/g, "^$1") + `"`, is a
// command-injection sink: `^` is a literal inside a cmd quoted region, not an
// escape, so a value containing a quote CLOSES the region and everything after
// it parses unquoted, where & | > separate commands.
//
// What this does instead, in two layers:
//
//  1. argv layer (MSVCRT rules) — produce the token the TARGET PROGRAM parses
//     back into one argument: wrap in ", escape an embedded " as \", and double
//     any backslash run that precedes a quote or ends the token.
//
//  2. cmd layer — make that token inert to cmd, in one of two ways:
//
//     - No `"` in the value (paths, flags, most prompts): the argv quotes stay
//       REAL quotes. Inside a genuine quoted region every operator is inert,
//       and the quotes survive a `.cmd` shim's `%*` — which matters, because a
//       shim re-parses its arguments after cmd has already stripped carets, so
//       a caret-escaped `a^&b` arrives at the batch as `a&b` and runs `b`.
//       Only `%` cannot live inside the quotes, since `%VAR%` expands even
//       there, so each `%` is emitted BETWEEN quoted regions as `^%`. MSVCRT
//       quote-toggling glues `"50"^%" off"` back into one argument, `50% off`.
//
//     - A `"` in the value: caret-escape every metacharacter in the argv token,
//       the quotes layer 1 added included. With the quotes themselves escaped
//       there are no quoted regions left from cmd's point of view, so the whole
//       token is inert literal text; cmd strips the carets and hands the
//       program the layer-1 token, which MSVCRT parses correctly.
//
// Why `^%` is enough: `%VAR%` expansion runs before caret removal, so a caret
// cannot protect a `%` directly — but each candidate name cmd then scans
// (`OS^` in `^%OS^%`) ends in `^`, which no defined variable matches, so the
// text is kept verbatim and the carets are removed afterwards.
//
// Limits no quoting can lift:
//  - Newlines. cmd reads the /c line up to the first CR or LF and discards the
//    rest, so a value containing one is TRUNCATED. buildWindowsCmdArgs rejects
//    them rather than silently cutting the line.
//  - Length. The whole line must stay under 8191 characters. Quoting inflates
//    values, so a caller assembling many paths has to budget the QUOTED length
//    and chunk or refuse; that cannot be solved here.
//  - A value holding both a `"` and an operator cannot survive a `.cmd` shim's
//    `%*` at all, so buildWindowsCmdArgs refuses quoted arguments unless the
//    command is an absolute `.exe`, which cannot resolve to a batch shim.
//
// Integration note for this repository: buildWindowsCmdArgs returns the line
// already wrapped in its own outer quote pair, which is only correct when the
// spawn passes `windowsVerbatimArguments: true`. Studio's call sites currently
// hand `["/d", "/s", "/c", command]` to scripts/platform.cjs WITHOUT that flag
// and let Node do the outer escaping, and platform.cjs re-routes that same
// args[3] to `/bin/sh -c` off Windows. Wiring this module in therefore means
// changing the spawn options and the POSIX translation together; the three
// quoting functions are independently useful before that happens.

const path = require("node:path");

// cmd.exe metacharacters that must be caret-escaped outside a quoted region.
const CMD_METACHARACTERS = /([()%!^"<>&|])/g;

// Characters that force quoting of an argv token: whitespace and `"` for
// MSVCRT, plus every cmd operator and expansion character — a bare `a&b` is one
// MSVCRT token, but a `.cmd` shim's `%*` would run it as two commands.
const ARGV_NEEDS_QUOTING = /[\s"&|<>^()%!]/;

// Characters that require a `%`-free segment to sit inside real quotes.
const SEGMENT_NEEDS_QUOTING = /[\s&|<>^()!]/;

function invalid(message, code) {
  return Object.assign(new Error(message), { code });
}

// MSVCRT argv quoting — what the target program's own parser expects. Double
// every backslash run that immediately precedes a quote, then escape the quote;
// also double a trailing backslash run so it does not escape the closing quote.
function quoteForArgv(value) {
  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

// Make the token literal to cmd. Quotes are escaped too, so cmd never enters a
// quoted region and every metacharacter stays inert.
function escapeForCmd(token) {
  return token.replace(CMD_METACHARACTERS, "^$1");
}

// Real-quote form for a value without `"`: every `%` is emitted as `^%` outside
// the quoted regions, everything else stays inside them.
function quoteSegmentsAroundPercent(value) {
  return value
    .split("%")
    .map((segment) => {
      if (segment.length === 0) return "";
      if (!SEGMENT_NEEDS_QUOTING.test(segment)) return segment;
      return quoteForArgv(segment);
    })
    .join("^%");
}

// Quote one argument for a verbatim `cmd.exe /d /s /c "..."` line. The result
// is safe to join with spaces inside the outer quote pair.
function quoteWindowsCmdArg(value) {
  // Empty argument: `""` at the argv layer, both quotes caret-escaped so cmd
  // does not open a quoted region.
  if (value.length === 0) return '^"^"';
  if (!ARGV_NEEDS_QUOTING.test(value)) return value;
  if (value.includes('"')) return escapeForCmd(quoteForArgv(value));
  return quoteSegmentsAroundPercent(value);
}

// Quote the COMMAND token — the executable path cmd itself has to resolve.
//
// Deliberately different from quoteWindowsCmdArg. Arguments are consumed by the
// target program, so they can be caret-escaped into inert literal text. The
// command name is consumed by CMD, which must see real quote delimiters to
// treat a path containing spaces as one token; a caret-escaped ^" is a literal
// quote character, so cmd would look for a file whose name begins with `"`.
// Real quoting is safe here precisely because a Windows path cannot contain a
// quote. An embedded quote is rejected rather than escaped, because there is no
// correct escape in this position and mangling an executable path silently is
// worse than a clear failure.
function quoteWindowsCmdPath(command) {
  if (/["\r\n\0%!]/.test(command)) {
    throw invalid(
      "Executable path must not contain a quote, control, or expansion character.",
      "ERR_CMD_PATH",
    );
  }
  return /[\s()%!^<>&|]/.test(command) ? `"${command}"` : command;
}

// Build the full ["/d", "/s", "/c", "\"<line>\""] vector for a verbatim cmd
// spawn. Centralized so call sites cannot reassemble the line with different
// escaping — the command/argument asymmetry above is easy to get wrong by hand.
function buildWindowsCmdArgs(command, args = []) {
  for (const value of [command, ...args]) {
    if (/[\r\n\0]/.test(value)) {
      throw invalid(
        "Windows command arguments must not contain CR, LF, or NUL.",
        "ERR_CMD_ARG",
      );
    }
  }
  const directExecutable = /\.exe$/i.test(command) && path.win32.isAbsolute(command);
  if (!directExecutable && args.some((value) => value.includes('"'))) {
    throw invalid(
      "Quoted arguments require an absolute executable rather than a batch shim.",
      "ERR_CMD_ARG",
    );
  }
  const line = [quoteWindowsCmdPath(command), ...args.map(quoteWindowsCmdArg)].join(" ");
  return ["/d", "/s", "/c", `"${line}"`];
}

// Absolute ComSpec, falling back to cmd.exe on PATH.
function resolveComSpec(env = process.env) {
  const comSpec = env.ComSpec;
  return comSpec && comSpec.length > 0 ? comSpec : "cmd.exe";
}

// Whether this binary has to be launched through cmd.exe. A direct absolute
// .exe never does; .cmd/.bat shims and bare names always do.
function requiresWindowsCmdWrapper(binaryPath, platform = process.platform) {
  if (platform !== "win32") return false;
  return !(/\.exe$/i.test(binaryPath) && path.win32.isAbsolute(binaryPath));
}

module.exports = {
  quoteWindowsCmdArg,
  quoteWindowsCmdPath,
  buildWindowsCmdArgs,
  resolveComSpec,
  requiresWindowsCmdWrapper,
};
