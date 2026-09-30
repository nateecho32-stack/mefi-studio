// The rules behind project_read, project_list and project_search
// (scripts/project-ignore.cjs): which paths a model may name, which names are
// private, what is noise, .gitignore as git reads it, and the glob a search is
// narrowed with. Pure checks; the folder walk is tests/project_search.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ignore = require("../scripts/project-ignore.cjs");

test("a path is judged the same on every platform: drive, network, absolute, .., devices and streams are refused", () => {
  const refused = ["C:\\Windows\\win.ini", "C:/Windows/win.ini", "c:foo", "\\\\server\\share\\x", "//server/share/x", "\\\\?\\C:\\x", "/etc/passwd", "\\etc\\passwd", "file.txt:stream", "src/a.js:$DATA", "http://x/y",
    "../outside", "..\\outside", "src/../../outside", "src\\..\\..\\outside", "a/b/../../..", "..",
    "CON", "con.txt", "src/NUL", "src/aux.js", "COM1", "lpt9.log", "src/prn",
    "src/a?.js", "src/*.js", 'src/"q".js', "src/<x>", "src/a|b", "trailing.", "src/dot./x", "space /x", "a\u0000b", "a\nb", "a\u001bb", "x".repeat(501)];
  for (const value of refused) assert.ok(ignore.cleanPath(value).error, `refused: ${JSON.stringify(value).slice(0, 40)}`);
  assert.equal(ignore.cleanPath("../x").error, "This path leaves the project.");
  assert.match(ignore.cleanPath("C:\\x").error, /not an absolute, drive or network path/);
  assert.equal(ignore.cleanPath("con").error, ignore.NOT_ALLOWED);
  assert.equal(ignore.cleanPath(7).error, "The path must be text.");
  // Ordinary paths, either slash, dots and doubled slashes folded away.
  for (const [value, relative] of [["src/app.js", "src/app.js"], ["src\\app.js", "src/app.js"], ["./src//app.js", "src/app.js"], ["src/", "src"], [".", ""], ["", ""], [undefined, ""], [null, ""], ["a/b/c.d", "a/b/c.d"], ["consul/x", "consul/x"], ["console.log", "console.log"], ["my.dots.in.name.txt", "my.dots.in.name.txt"]]) {
    const clean = ignore.cleanPath(value);
    assert.equal(clean.error, undefined, String(value)); assert.equal(clean.relative, relative, String(value));
    assert.deepEqual(clean.parts, relative ? relative.split("/") : []);
  }
  assert.ok(ignore.cleanPath(Array(42).fill("a").join("/")).error, "a path 42 folders deep is refused");
});

test("private paths: hidden, Studio's own data, keys, stores and files whose names say they hold secrets", () => {
  const denied = [".env", ".env.local", "src/.env", ".git/config", ".mefi/worktrees/run1/src/a.js", ".claude/settings.json", ".github/workflows/ci.yml", "a/.hidden/b",
    "data/curated.json", "src/data/users.json", "Data/x", "dist/app.js", "packages/x/dist/index.js", "node_modules/x/index.js", "DIST/a",
    "server.pem", "certs/site.key", "app.db", "store.sqlite", "store.sqlite3", "keys/id_rsa", "id_ed25519", "id_ecdsa.pub", "cert.p12", "cert.pfx", "release.jks", "app.keystore", "vault.kdbx", "state.tfstate", "prod.tfvars", "client.ovpn", "creds.gpg", "site.htpasswd",
    "credentials.json", "aws-credentials.json", "settings.json", "app/settings.json", "auth.json", "kubeconfig", "prod.kubeconfig", "wallet.dat",
    "service-account.json", "serviceAccountKey.json", "firebase-adminsdk-x.json", "client_secret_123.json",
    "secrets.yaml", "config/secrets.yml", "secret.json", "db-password.txt", "passwd", "password", "credentials", "secrets/x.txt", "credentials/a", "token.json", "api-key.txt", "api_key.env", "access-token.json", "private_key.txt", "my.secrets.toml"];
  for (const path of denied) assert.equal(ignore.denied(path), true, path);
  const allowed = ["README.md", "src/app.js", "src/token.ts", "src/lexer/token.js", "src/password.py", "src/secret.go", "src/credentials.ts", "docs/secrets.md", "docs/passwords.md", "design/tokens.json", "src/tokens/colors.css", "src/keyboard.js", "monkey.txt", "src/dataset.js", "database.md", "config.js", "package.json", "package-lock.json", "tests/settings.test.mjs", "src/settings.ts", "src/auth.js", "src/authentication/index.js", "src/api-key-input.tsx", "Makefile", "LICENSE", "assets/logo.png", "src/id.js", "id_rsa_notes.md"];
  for (const path of allowed) assert.equal(ignore.denied(path), false, path);
  // Both slash styles and any depth.
  assert.equal(ignore.denied("src\\data\\x.json"), true);
  assert.equal(ignore.denied("src\\ok\\x.js"), false);
});

test("noise a walk skips: dependencies and coverage anywhere, build output at the top only; binary types by extension", () => {
  for (const name of ["node_modules", "__pycache__", "bower_components", "coverage", "Coverage"]) for (const depth of [0, 1, 5]) assert.equal(ignore.skipsFolder(name, depth), true, `${name} at ${depth}`);
  for (const name of ["build", "out", "target", "vendor", "venv", "env", "tmp", "temp", "logs", "cache", "Build"]) {
    assert.equal(ignore.skipsFolder(name, 0), true, `${name} at the top`);
    assert.equal(ignore.skipsFolder(name, 1), false, `${name} lower down is a source folder`);
  }
  for (const name of ["src", "lib", "docs", "builds", "output", "caches"]) assert.equal(ignore.skipsFolder(name, 0), false, name);
  for (const name of ["logo.png", "a.JPG", "clip.mp4", "font.woff2", "x.zip", "lib.dll", "a.exe", "doc.pdf", "model.glb", "x.class", "app.wasm", "sheet.xlsx", "a.b.c.tar"]) assert.equal(ignore.binaryName(name), true, name);
  for (const name of ["app.js", "README.md", "style.css", "page.html", "icon.svg", "data.json", "Makefile", ".png", "png", "notes.txt", "yarn.lock", "a.map"]) assert.equal(ignore.binaryName(name), false, name);
});

// [ .gitignore text, [path, isDir, ignored] ... ]
const IGNORE_CASES = [
  ["*.log\n", [["a.log", false, true], ["x/y/a.log", false, true], ["a.logs", false, false], ["log", false, false], ["a.log", true, true]]],
  ["build/\n", [["build", true, true], ["build", false, false], ["src/build", true, true], ["src/build", false, false], ["builds", true, false]]],
  ["/dist\n", [["dist", true, true], ["dist", false, true], ["src/dist", true, false]]],
  ["/only-top.txt\n", [["only-top.txt", false, true], ["sub/only-top.txt", false, false]]],
  ["docs/*.tmp\n", [["docs/a.tmp", false, true], ["docs/x/a.tmp", false, false], ["a/docs/a.tmp", false, false]]],
  ["docs/**/*.tmp\n", [["docs/a.tmp", false, true], ["docs/x/y/a.tmp", false, true], ["docs/a.txt", false, false]]],
  ["**/cache\n", [["cache", true, true], ["a/b/cache", true, true], ["cachex", true, false]]],
  ["src/gen/**\n", [["src/gen/x.js", false, true], ["src/gen/a/b.js", false, true], ["src/gen", true, false], ["src/other/x.js", false, false]]],
  ["a/**/b\n", [["a/b", false, true], ["a/x/b", false, true], ["a/x/y/b", false, true], ["a/x/c", false, false]]],
  ["*.js\n!keep.js\n", [["a.js", false, true], ["keep.js", false, false], ["sub/keep.js", false, false]]],
  ["!keep.js\n*.js\n", [["keep.js", false, true]]],
  ["# comment\n\n   \n*.tmp\n\\#hash\n\\!bang\n", [["a.tmp", false, true], ["#hash", false, true], ["!bang", false, true], ["comment", false, false]]],
  ["trailing.txt   \nspaced\\ \n", [["trailing.txt", false, true], ["spaced ", false, true]]],
  ["file?.txt\n", [["file1.txt", false, true], ["file12.txt", false, false], ["file.txt", false, false]]],
  ["[abc].txt\n[!abc].md\n[a-c]x\n", [["a.txt", false, true], ["d.txt", false, false], ["d.md", false, true], ["a.md", false, false], ["bx", false, true], ["dx", false, false]]],
  ["a**b\n", [["axxb", false, true], ["a/b", false, false]]],
  ["*\n!*/\n!*.md\n", [["a.js", false, true], ["src", true, false], ["README.md", false, false]]],
  ["node_modules\n", [["node_modules", true, true], ["a/node_modules", true, true], ["node_modules.txt", false, false]]],
  ["/*.env\n", [["prod.env", false, true], ["a/prod.env", false, false]]],
  ["Foo.TXT\n", [["Foo.TXT", false, true], ["foo.txt", false, false]]],
  ["[unclosed\n", [["[unclosed", false, true], ["u", false, false]]],
  ["a\\*b\n", [["a*b", false, true], ["axb", false, false]]],
];
test(".gitignore as git reads it: names, anchors, folders only, ** and [sets], ! to bring a name back, later lines win", () => {
  for (const [text, rows] of IGNORE_CASES) {
    const sets = [{ base: "", rules: ignore.parseIgnore(text) }];
    for (const [path, isDir, expected] of rows) assert.equal(ignore.ignoredBy(sets, path, isDir), expected, `${JSON.stringify(text)}: ${path}${isDir ? "/" : ""}`);
  }
});

test("a .gitignore in a folder speaks for that folder, deeper files override shallower ones, and case folds only where asked", () => {
  const top = ignore.parseIgnore("*.log\n/gen\n"), inner = ignore.parseIgnore("!important.log\n/local\n*.out\n");
  const sets = [{ base: "", rules: top }, { base: "pkg", rules: inner }];
  const at = (path, isDir = false) => ignore.ignoredBy(sets, path, isDir);
  assert.equal(at("a.log"), true); assert.equal(at("pkg/a.log"), true);
  assert.equal(at("pkg/important.log"), false, "the deeper file brings it back");
  assert.equal(at("important.log"), true, "but only inside its folder");
  assert.equal(at("pkg/local", true), true); assert.equal(at("local", true), false, "a slash anchors to the file's own folder");
  assert.equal(at("pkg/x/a.out"), true); assert.equal(at("a.out"), false); assert.equal(at("gen", true), true); assert.equal(at("pkg/gen", true), false);
  assert.equal(at("pkgs/local", true), false, "a folder that merely starts the same is not inside it");
  // Info/exclude is a set at the top, spoken first, so a .gitignore overrides it.
  const withExclude = [{ base: "", rules: ignore.parseIgnore("*.bak\n") }, { base: "", rules: ignore.parseIgnore("!keep.bak\n") }];
  assert.equal(ignore.ignoredBy(withExclude, "a.bak", false), true); assert.equal(ignore.ignoredBy(withExclude, "keep.bak", false), false);
  // Case: exact on a case-sensitive disk, folded on Windows.
  const rules = [{ base: "Pkg", rules: ignore.parseIgnore("*.TMP\n") }];
  assert.equal(ignore.ignoredBy(rules, "Pkg/a.tmp", false, false), false);
  assert.equal(ignore.ignoredBy(rules, "pkg/A.TMP", false, true), true);
  assert.equal(ignore.ignoredBy(rules, "PKG/a.tmp", false, true), true);
});

test("a hostile or huge .gitignore costs time, never a hang", () => {
  const t0 = performance.now();
  // Thousands of stars against a long name: a regular expression built from this would run for years.
  const evil = ["*a".repeat(30) + "*b", "*".repeat(300), "a*".repeat(100), "[a-z]*".repeat(40) + "!"].join("\n");
  const sets = [{ base: "", rules: ignore.parseIgnore(evil) }];
  for (const name of ["a".repeat(400), "aab".repeat(100), "x".repeat(400)]) ignore.ignoredBy(sets, `d/${name}`, false);
  // A line of 100,000 spaces, 50,000 rules, a 4 MB text.
  const many = ignore.parseIgnore(`a${" ".repeat(100000)}b\n${"x\n".repeat(50000)}`);
  assert.ok(many.length <= 2000, "at most 2,000 rules are read");
  ignore.parseIgnore("y\n".repeat(2_000_000));
  assert.ok(performance.now() - t0 < 4000, `took ${Math.round(performance.now() - t0)} ms`);
});

test("a search's glob: a name at any depth, or a path from the project's folder; ! excludes; {a,b} lists", () => {
  const test = (glob, path, fold = false) => { const filter = ignore.globFilter(glob, { fold }); assert.equal(filter.error, undefined, JSON.stringify(glob)); return filter.test(path); };
  assert.equal(test("*.ts", "a.ts"), true); assert.equal(test("*.ts", "src/deep/a.ts"), true); assert.equal(test("*.ts", "a.tsx"), false);
  assert.equal(test("src/**/*.ts", "src/a.ts"), true); assert.equal(test("src/**/*.ts", "src/x/y/a.ts"), true); assert.equal(test("src/**/*.ts", "lib/a.ts"), false); assert.equal(test("src/**/*.ts", "x/src/a.ts"), false);
  assert.equal(test("src/*.ts", "src/a.ts"), true); assert.equal(test("src/*.ts", "src/x/a.ts"), false);
  assert.equal(test("*.{ts,tsx}", "a.tsx"), true); assert.equal(test("*.{ts,tsx}", "a.js"), false);
  assert.equal(test("{src,lib}/**/*.{js,mjs}", "lib/x/a.mjs"), true); assert.equal(test("{src,lib}/**/*.{js,mjs}", "docs/a.js"), false);
  assert.equal(test("README.md", "README.md"), true); assert.equal(test("README.md", "docs/README.md"), true, "a bare name is matched at any depth");
  assert.equal(test("/README.md", "docs/README.md"), false, "a leading slash anchors it");
  assert.equal(test("docs/", "docs"), true);
  assert.equal(test("**", "a/b/c.txt"), true); assert.equal(test("*", "a.txt"), true);
  assert.equal(test("test_?.py", "test_1.py"), true); assert.equal(test("test_?.py", "test_12.py"), false);
  assert.equal(test("[ab]*.js", "b1.js"), true); assert.equal(test("[!ab]*.js", "b1.js"), false);
  assert.equal(test("src\\**\\*.ts", "src/a/b.ts"), true, "backslashes are folded, as in a path");
  assert.equal(test(["*.js", "!*.test.js"], "a.js"), true); assert.equal(test(["*.js", "!*.test.js"], "a.test.js"), false); assert.equal(test(["*.js", "!*.test.js"], "a.css"), false);
  assert.equal(test("!*.min.js", "a.js"), true, "only exclusions keep everything else");
  assert.equal(test("!*.min.js", "a.min.js"), false);
  assert.equal(test("*.MD", "notes.md", true), true); assert.equal(test("*.MD", "notes.md", false), false);
  assert.equal(ignore.globFilter(undefined).empty, true); assert.equal(ignore.globFilter("").test("anything"), true);
  assert.equal(ignore.globFilter([]).empty, true);
});

test("a glob that is too big or not text is refused with a sentence, and cannot be made to stall", () => {
  for (const bad of ["x".repeat(201), 5, {}, ["ok", 5], Array(9).fill("*.js"), "a\u0000b", "   ", "/", "{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}", "{1,2,3,4}{1,2,3,4}{1,2,3}"]) {
    const filter = ignore.globFilter(bad);
    assert.equal(typeof filter.error, "string", JSON.stringify(bad).slice(0, 40)); assert.equal(filter.test, undefined);
  }
  assert.match(ignore.globFilter("{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}").error, /too many/);
  // Thirty-two alternatives are fine, and the polynomial-looking glob is quick on a long path.
  assert.equal(ignore.globFilter("{a,b}{c,d}{e,f}{g,h}{i,j}").error, undefined);
  const t0 = performance.now();
  const evil = ignore.globFilter(`${"*a".repeat(12)}*b`);
  for (const path of ["a".repeat(300), `${"a/".repeat(30)}a`, "x".repeat(300)]) evil.test(path);
  assert.ok(performance.now() - t0 < 500, `took ${Math.round(performance.now() - t0)} ms`);
  assert.deepEqual(ignore.expandBraces("a{b,c{d,e}}f"), ["abf", "acdf", "acef"]);
  assert.deepEqual(ignore.expandBraces("no braces"), ["no braces"]);
  assert.deepEqual(ignore.expandBraces("{unclosed"), ["{unclosed"]);
});
