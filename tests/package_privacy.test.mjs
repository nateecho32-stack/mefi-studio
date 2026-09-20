import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

test("portable builds ship only public catalogs and release builds cannot inherit either local data store", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-package-privacy-"));
  const write = async (name, value) => {
    const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/package-portable.mjs"), ...args], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  try {
    await write("package.json", JSON.stringify({ name: "mefi-studio", productName: "Mefi's Studio AI+", version: "0.1.0", main: "main.cjs" }));
    for (const file of ["main.cjs", "preload.cjs", "README.md", "GETTING_STARTED.md", "renderer/booklet.html", "renderer/booklet.template.html", "assets/icon.ico", "node_modules/electron/dist/electron.exe"]) await write(file, "fixture");
    await write("scripts/placeholder", "");
    await copyFile(new URL("../scripts/package-portable.mjs", import.meta.url), path.join(root, "scripts/package-portable.mjs"));
    for (const file of ["auditor.mjs", "paths.cjs"]) await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(root, "scripts", file));
    await write("data/models.json", '{"models":[]}'); await write("data/curated.json", "{}");
    await write("data/settings.json", '{"secret":"SOURCE-PRIVATE"}');
    await write("data/projects/a/planning.json", "PRIVATE-PLAN");
    await write("data/cache/private.json", "PRIVATE-CACHE");
    run();
    const payload = "dist/Mefi Studio AI+/resources/app";
    assert.deepEqual((await readdir(path.join(root, payload, "data"))).sort(), ["curated.json", "models.json"]);
    await write(`${payload}/data/settings.json`, "PORTABLE-PRIVATE");
    run();
    assert.equal(await readFile(path.join(root, payload, "data/settings.json"), "utf8"), "PORTABLE-PRIVATE");
    run("--release");
    run("--release");
    const releases = await readdir(path.join(root, "dist/releases"));
    assert.equal(releases.length, 2, "each distribution gets a fresh folder, even after an earlier one has been run");
    for (const release of releases) {
      const data = path.join(root, "dist/releases", release, "Mefi Studio AI+/resources/app/data");
      assert.deepEqual((await readdir(data)).sort(), ["curated.json", "models.json"]);
      assert.equal(await readFile(path.join(data, "../GETTING_STARTED.md"), "utf8"), "fixture", "the download includes the walkthrough linked by its README");
      const auditor = await import(pathToFileURL(path.join(data, "../scripts/auditor.mjs")).href);
      const result = await auditor.audit();
      assert.equal(result.errors, 0);
      assert.deepEqual(auditor.auditRequests(result), [], "a released app must not invent a repair task for omitted source tests");
      assert.ok(result.findings.some((finding) => finding.area === "tests" && finding.level === "info"));
    }
    for (const location of [root, path.join(root, payload)]) {
      const auditor = await import(pathToFileURL(path.join(location, "scripts/auditor.mjs")).href);
      const result = await auditor.audit();
      assert.ok(result.findings.some((finding) => finding.area === "tests" && finding.level === "warn"), "missing source tests remain actionable in a checkout and its linked development payload");
      assert.ok(auditor.auditRequests(result).some((request) => request.title === "Audit: tests"));
    }
    assert.equal(await readFile(path.join(root, "data/settings.json"), "utf8"), '{"secret":"SOURCE-PRIVATE"}');
    assert.equal(await readFile(path.join(root, payload, "data/settings.json"), "utf8"), "PORTABLE-PRIVATE");
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
