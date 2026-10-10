const { app } = require("electron");
const fs = require("original-fs").promises;
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const root = process.env.MEFI_UPDATE_ASAR_FIXTURE;
app.setPath("userData", path.join(root, "profile"));
app.whenReady().then(async () => {
  const updater = await import(pathToFileURL(process.env.MEFI_UPDATE_ASAR_MODULE).href);
  const content = path.join(root, "content");
  const payload = path.join(content, "resources", "app");
  await fs.mkdir(payload, { recursive: true });
  await fs.writeFile(path.join(payload, "main.cjs"), "// host");
  await fs.writeFile(path.join(payload, "preload.cjs"), "// bridge");
  // An opaque archive must never be parsed by Electron during an update.
  const bytes = Buffer.from("archive bytes, including an incomplete ASAR header");
  await fs.writeFile(path.join(content, "resources", "default_app.asar"), bytes);
  const zip = path.join(root, "portable.zip");
  await updater.zipDirectory(content, zip, { rootName: "Mefi Studio AI+" });
  const staged = await updater.stageUpdate({ zipPath: zip, stagingDir: path.join(root, "staging"), installRoot: path.join(root, "install") });
  assert.deepEqual(await fs.readFile(path.join(staged.sourceRoot, "resources", "default_app.asar")), bytes);
  // Restaging exercises removal of an existing .asar as a file too.
  await updater.stageUpdate({ zipPath: zip, stagingDir: path.join(root, "staging"), installRoot: path.join(root, "install") });
  console.log("ASAR portable staging passed");
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
