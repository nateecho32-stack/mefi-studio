// A scripted stand-in for `codex app-server`, for tests/codex_harness.test.mjs.
// It reads newline-delimited JSON-RPC on stdin, appends every message it
// receives (requests, notifications, answers to its own requests) to the
// record file, and answers each request method with the scenario's steps.
// Like the real server it exits when its stdin closes, unless the scenario
// says `stayAlive`.
//
//   node fake-codex-app-server.mjs <scenario.json> <record.jsonl>
//
// scenario: { start?: [steps], on: { "<method>": [steps] }, stayAlive?: true }
// steps, run in order on one queue (so notifications keep their order):
//   { respond: result }              answer the request being handled
//   { error: { code, message } }     refuse it
//   { notify: method, params }       a notification
//   { request: method, params }      a server request; waits for the answer
//   { raw: "text" }                  bytes as given (noise, CRLF, half lines)
//   { chunks: ["…"], delay: ms }     bytes in pieces, `delay` apart
//   { stderr: "text" }               on stderr
//   { delay: ms }                    a pause
//   { exit: code }                   exit at once
import { appendFileSync, readFileSync } from "node:fs";

const [scenarioPath, recordPath] = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
const record = (message) => appendFileSync(recordPath, `${JSON.stringify(message)}\n`);
const write = (text) => new Promise((resolve) => process.stdout.write(text, resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let serverId = 0;
const answers = new Map();
let chain = Promise.resolve();
const enqueue = (job) => { chain = chain.then(job).catch((error) => process.stderr.write(`fake server: ${error.message}\n`)); return chain; };

async function run(steps, request = null) {
  for (const step of steps ?? []) {
    if ("respond" in step) await write(`${JSON.stringify({ id: request.id, result: step.respond })}\n`);
    else if ("error" in step) await write(`${JSON.stringify({ id: request.id, error: step.error })}\n`);
    else if ("notify" in step) await write(`${JSON.stringify({ method: step.notify, params: step.params ?? {} })}\n`);
    else if ("request" in step) {
      const id = `srv-${++serverId}`;
      const answered = new Promise((resolve) => answers.set(id, resolve));
      await write(`${JSON.stringify({ id, method: step.request, params: step.params ?? {} })}\n`);
      await answered;
    } else if ("raw" in step) await write(step.raw);
    else if ("chunks" in step) {
      for (const chunk of step.chunks) { await write(chunk); await sleep(step.delay ?? 10); }
    } else if ("stderr" in step) await new Promise((resolve) => process.stderr.write(step.stderr, resolve));
    else if ("delay" in step) await sleep(step.delay);
    else if ("exit" in step) process.exit(step.exit);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    record(message);
    if (message.id !== undefined && !message.method) { answers.get(message.id)?.(message); continue; }
    if (message.id !== undefined) enqueue(() => run(scenario.on?.[message.method], message));
  }
});
process.stdin.on("end", () => {
  if (scenario.stayAlive) return;
  // Nobody is left to answer a server request: let the queue run out.
  for (const [, resolve] of answers) resolve(null);
  enqueue(() => process.exit(0));
});
if (scenario.stayAlive) setInterval(() => {}, 1000);
enqueue(() => run(scenario.start));
