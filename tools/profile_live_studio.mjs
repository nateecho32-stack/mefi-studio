// Bounded capture from an already-running Studio. Connects only to a local
// Node inspector and validates the app PID and page before touching a profiler.
// Reports contain timings and static view IDs, never task or conversation text.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const pid = Number(option("--pid", 0));
const seconds = Number(option("--seconds", 60));
const port = Number(option("--port", 9229));
const output = path.resolve(option("--output", path.join(root, "tools/logs/live-performance.json")));
const statusOnly = args.includes("--status");
if (!Number.isInteger(pid) || pid < 1 || !Number.isFinite(seconds) || seconds < 5 || seconds > 300 || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Usage: node tools/profile_live_studio.mjs --pid PID [--status] [--seconds 5..300] [--port 9229] [--cpu] [--output report.json]");
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
if (targets.length !== 1) throw new Error("Expected one local inspector target");
const address = new URL(targets[0].webSocketDebuggerUrl);
if (address.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)) throw new Error("Inspector must be loopback only");
const socket = new WebSocket(address);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data), request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
socket.addEventListener("close", () => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Inspector disconnected")); }
  pending.clear();
});
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + (result.exceptionDetails.exception?.description || "Evaluation failed"));
  return result.result.value;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let viewId, captureStartedAt, ownsCapture = false, ownsDebugger = false, cpuActive = false;
const report = { startedAt: new Date().toISOString(), observations: [], coverage: "Observed live workload. CPU samples add overhead; hidden windows have no visible frame cadence. No task text or screenshots collected." };
const view = () => `process.mainModule.require('electron').webContents.fromId(${viewId})`;
const renderer = async expression => {
  const wrapped = `(async()=>{try{return await (${expression});}catch(error){return {__profileError:String(error.stack || error)};}})()`;
  const result = await evaluate(`${view()}.executeJavaScript(${JSON.stringify(wrapped)})`);
  if (result?.__profileError) throw new Error(result.__profileError);
  return result;
};
const debuggerCommand = (method, params = {}) => evaluate(`${view()}.debugger.sendCommand(${JSON.stringify(method)},${JSON.stringify(params)})`);
try {
  const identity = await evaluate("({pid:process.pid,electron:process.versions.electron,windows:process.mainModule.require('electron').BrowserWindow.getAllWindows().map(w=>({id:w.webContents.id,url:w.webContents.getURL()}))})");
  if (identity.pid !== pid || !identity.electron) throw new Error("Inspector is not the requested Electron process");
  const expected = path.join(root, "renderer/booklet.html").toLowerCase();
  const candidates = identity.windows.filter(w => { try { return fileURLToPath(w.url).toLowerCase() === expected; } catch { return false; } });
  if (candidates.length !== 1) throw new Error("Expected one Studio booklet in this checkout");
  viewId = candidates[0].id;
  report.electron = identity.electron;
  report.source = await renderer("({scrollReadBatching:[...document.scripts].some(script=>script.textContent.includes('update.removeTab = region.addedTab')),commandCanvasTransferred:typeof OffscreenCanvas==='function' && window.MefiIdle?.canvasContext?.(document.getElementById('idle-layer'))?.canvas instanceof OffscreenCanvas})");
  const initial = await renderer("(async()=>{const snapshot=window.MefiProfiler?.snapshot();if(!snapshot)return null;const host=await window.mefiStudio?.performanceSnapshot?.();return {...snapshot,host:host?.ok ? host : snapshot.host};})()");
  if (!initial) throw new Error("Studio profiler is unavailable");
  report.initial = await renderer("({hidden:document.hidden,boot:window.MefiBoot?.state()?.phase,nav:window.MefiNav?.current?.(),recording:window.MefiProfiler.snapshot().renderer.recording})");
  if (statusOnly) {
    report.activity = await evaluate(`(()=>{const e=process.mainModule.require('electron'),w=e.BrowserWindow.fromWebContents(${view()});return {focused:w.isFocused(),visible:w.isVisible(),minimized:w.isMinimized(),systemIdleSeconds:e.powerMonitor.getSystemIdleTime()};})()`);
    report.updater = await renderer("(async()=>{const result=await window.mefiStudio?.updateStatus?.();const s=result?.status ?? result;return s ? {phase:s.phase,auto:s.auto,watching:s.watching,kind:s.kind} : null;})()");
  } else {
    // Never reset or stop a capture the owner already started.
    if (!initial.renderer.recording && !initial.host?.recording) {
      if (!await renderer("window.MefiProfiler.start()")) throw new Error("Could not start Studio capture");
      ownsCapture = true;
      captureStartedAt = (await renderer("window.MefiProfiler.snapshot()")).renderer.startedAt;
    }
    if (args.includes("--cpu")) {
      ownsDebugger = await evaluate(`(()=>{const d=${view()}.debugger;if(d.isAttached())return false;d.attach('1.3');return true;})()`);
      if (ownsDebugger) {
        await debuggerCommand("Profiler.enable");
        await debuggerCommand("Profiler.setSamplingInterval", { interval: 1000 });
        await debuggerCommand("Profiler.start"); cpuActive = true;
      } else report.cpuSkipped = "Renderer debugger already in use";
    }
    const captureIdentity = (await renderer("window.MefiProfiler.snapshot()")).renderer.startedAt;
    const started = Date.now();
    while (Date.now() - started < seconds * 1000) {
      const observation = await renderer(`(()=>{const p=window.MefiProfiler.snapshot();return {at:Date.now(),captureStartedAt:p.renderer.startedAt,recording:p.renderer.recording,hidden:document.hidden,boot:window.MefiBoot?.state()?.phase,nav:window.MefiNav?.current?.() ?? null,sheet:document.body.dataset.sheet || null,command:!!window.MefiIdle?.isActive?.(),workspace:!!window.MefiWorkspace?.isActive?.(),vibe:!!window.MefiVibe?.isActive?.(),frameStats:p.renderer.frameStats,frameCount:p.renderer.frameCount,hitches:p.renderer.hitchCount,longTasks:p.renderer.longTaskCount,topScopes:p.renderer.spans.slice(0,8),hostSample:p.host?.samples?.at(-1)};})()`);
      if (observation.captureStartedAt !== captureIdentity || (ownsCapture || initial.renderer.recording) && !observation.recording) throw new Error("Capture ended, was replaced, or the renderer reloaded");
      report.observations.push(observation);
      await pause(Math.min(5000, Math.max(0, seconds * 1000 - (Date.now() - started))));
    }
    if (cpuActive) {
      report.cpu = (await debuggerCommand("Profiler.stop")).profile; cpuActive = false;
    }
    report.capture = await renderer("window.MefiProfiler.snapshot()");
  }
} catch (error) {
  report.error = error.message; process.exitCode = 1;
} finally {
  if (cpuActive) { try { await debuggerCommand("Profiler.stop"); } catch {} }
  if (ownsDebugger) { try { await evaluate(`${view()}.debugger.detach()`); } catch {} }
  if (ownsCapture) {
    try { await renderer(`window.MefiProfiler.snapshot().renderer.startedAt === ${JSON.stringify(captureStartedAt)} ? window.MefiProfiler.stop() : false`); }
    catch (error) { report.cleanupError = error.message; }
  }
  socket.close();
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, error: report.error, source: report.source, initial: report.initial, activity: report.activity, updater: report.updater, observations: report.observations.length, renderer: report.capture?.renderer?.frameStats, scopes: report.capture?.renderer?.spans?.slice(0,8), host: report.capture?.host?.spans?.slice(0,8) }, null, 2));
}

