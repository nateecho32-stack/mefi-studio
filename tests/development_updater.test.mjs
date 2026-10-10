import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { checkForDevelopment, DEVELOPMENT_ARTIFACT, normalizeChannel, unpackDevelopment } from "../scripts/development-updater.mjs";
import { checkForRelease, releaseAssetName, validateBuildAssets, downloadAsset, zipDirectory, sha256File, stageUpdate } from "../scripts/release-updater.mjs";

const repo = "owner/repo";
const commit = "a".repeat(40);
function run(overrides = {}) { return { id: 12, run_number: 100, run_attempt: 1, status: "completed", conclusion: "success", event: "push", head_branch: "main", path: ".github/workflows/ci.yml", head_sha: commit, repository: { full_name: repo }, head_repository: { full_name: repo }, ...overrides }; }
function artifact(overrides = {}) { return { id: 90, name: DEVELOPMENT_ARTIFACT, expired: false, expires_at: "2099-01-01T00:00:00Z", digest: `sha256:${"b".repeat(64)}`, size_in_bytes: 100, archive_download_url: `https://api.github.com/repos/${repo}/actions/artifacts/90/zip`, workflow_run: { id: 12, head_sha: commit }, ...overrides }; }
const json = body => ({ ok: true, status: 200, json: async () => body });
function fetcher({ runs = [run()], artifacts = [artifact()], base = "0.4.5" } = {}) {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return json(url.includes("/artifacts?") ? { artifacts } : url.includes("/contents/") ? { content: Buffer.from(JSON.stringify({version:base})).toString("base64") } : { workflow_runs: runs }); };
  return { fetchImpl, calls };
}
const check = (options = {}) => checkForDevelopment({ repo, currentVersion: "0.4.4", token: "fixture-token", ...fetcher(), ...options });

test("channels default safely and an empty workflow never fabricates a development build", async () => {
  for (const value of [undefined, null, "beta", "main", true]) assert.equal(normalizeChannel(value), "stable");
  assert.equal(normalizeChannel("development"), "development");
  const response = await check(fetcher({ artifacts: [] }));
  assert.equal(response.ok, true); assert.equal(response.latest, null); assert.equal(response.update, null); assert.match(response.unavailable, /No supported development artifact/);
});
test("only a successful main push through the expected workflow and repository is eligible", async () => {
  for (const invalid of [{ status: "in_progress" }, { conclusion: "failure" }, { event: "pull_request" }, { head_branch: "review" }, { head_repository: { full_name: "fork/repo" } }, { repository: { full_name: "other/repo" } }, { path: ".github/workflows/other.yml" }]) {
    const f = fetcher({ runs: [run(invalid)] });
    assert.equal((await check(f)).latest, null); assert.equal(f.calls.length, 1);
  }
});
test("expired, mismatched and digestless artifacts are refused", async () => {
  for (const invalid of [{ expired: true }, { expires_at: "2000-01-01" }, { name: "different" }, { digest: null }, { workflow_run: {id:12, head_sha:"c".repeat(40)} }]) assert.equal((await check(fetcher({artifacts:[artifact(invalid)]}))).latest, null);
});
test("version ordering, reruns, stable opt-in and immutable commit provenance", async () => {
  const f = fetcher(); const first = await check(f);
  assert.equal(first.update.version, "0.4.5-dev.100.1"); assert.equal(first.latest.commit, commit); assert.ok(f.calls.some(url => url.endsWith(`?ref=${commit}`)));
  assert.equal((await check({currentVersion:"0.4.5-dev.99.9"})).update.version, first.update.version);
  assert.equal((await check({currentVersion:"0.4.5-dev.100.1"})).update, null);
  assert.equal((await check({currentVersion:"0.4.5-dev.101.1"})).update, null);
  assert.equal((await check({currentVersion:"0.4.6"})).update, null);
  assert.equal((await check({currentVersion:"0.4.5"})).update.version, first.update.version);
  assert.equal((await check({...fetcher({runs:[run({run_attempt:2})]}),currentVersion:"0.4.5-dev.100.1"})).update.version,"0.4.5-dev.100.2");
});
test("access failures and missing existing credentials are truthful", async () => {
  const missing = await check({token:null}); assert.equal(missing.ok,false); assert.equal(missing.needsToken,true);
  const denied = await check({fetchImpl:async()=>({ok:false,status:403})}); assert.equal(denied.ok,false); assert.equal(denied.needsToken,true);
  assert.equal((await check({fetchImpl:async()=>{throw new Error("offline");}})).ok,false);
});

test("unusable package metadata falls back to an older eligible build without hiding access failures", async () => {
  const newerCommit="c".repeat(40);
  const olderContent={content:Buffer.from(JSON.stringify({version:"0.4.5"})).toString("base64")};
  const fetchWithNewest = newest => async url => {
    if(url.includes("/contents/"))return url.endsWith(newerCommit)?newest:json(olderContent);
    if(url.includes("/artifacts?"))return json({artifacts:url.includes("/runs/13/")?[artifact({id:91,workflow_run:{id:13,head_sha:newerCommit}})]:[artifact()]});
    return json({workflow_runs:[run({id:13,run_number:101,head_sha:newerCommit}),run()]});
  };
  for(const newest of [json({}),json({content:Buffer.from("broken JSON").toString("base64")}),json({content:Buffer.from("null").toString("base64")}),{ok:false,status:404}]){
    const result=await check({fetchImpl:fetchWithNewest(newest)});
    assert.equal(result.ok,true);assert.equal(result.update.version,"0.4.5-dev.100.1");assert.equal(result.latest.commit,commit);
  }
  for(const status of [401,403,500]){
    const result=await check({fetchImpl:fetchWithNewest({ok:false,status})});
    assert.equal(result.ok,false);assert.equal(result.needsToken,status!==500);
  }
});
function stable(tag = "v0.4.4", extra = {}) {
  return { tag_name:tag, published_at:"2026-01-01", assets:[{name:releaseAssetName(tag),url:`https://api.github.com/repos/${repo}/releases/assets/1`,size:10,digest:`sha256:${"a".repeat(64)}`}], ...extra };
}
test("stable rejects prereleases, drafts, wrong platforms and unsigned metadata", async () => {
  for (const release of [stable("v0.5.0-beta.1"),stable("v0.5.0",{prerelease:true}),stable("v0.5.0",{draft:true}),stable("v0.5.0",{published_at:null}),stable("v0.5.0",{assets:[{name:"linux.zip"}]}),stable("v0.5.0",{assets:[{name:releaseAssetName("v0.5.0"),url:`https://api.github.com/repos/${repo}/releases/assets/1`,size:10}]})]) assert.equal((await checkForRelease({repo,currentVersion:"0.4.0",fetchImpl:async()=>json(release)})).ok,false);
});
test("returning to stable offers the published lower version only for a prerelease install", async () => {
  const opts = {repo,fetchImpl:async()=>json(stable()),allowStableReturn:true};
  assert.equal((await checkForRelease({...opts,currentVersion:"0.5.0-dev.100.1"})).update.version,"0.4.4");
  assert.equal((await checkForRelease({...opts,currentVersion:"0.5.0"})).update,null);
});
test("asset metadata cannot redirect credentials to another host or repository", () => {
  const build = {asset:{size:10,digest:`sha256:${"a".repeat(64)}`,url:`https://api.github.com/repos/${repo}/releases/assets/1`}};
  validateBuildAssets(build,repo);
  for (const url of ["https://evil.invalid/payload",`https://api.github.com/repos/fork/repo/releases/assets/1`,`http://api.github.com/repos/${repo}/releases/assets/1`,`https://token@api.github.com/repos/${repo}/releases/assets/1`,`https://api.github.com/repos/${repo}/contents/main.cjs`,`https://api.github.com/repos/${repo}/releases/assets/1?token=secret`]) assert.throws(()=>validateBuildAssets({asset:{...build.asset,url}},repo));
});
test("interrupted and truncated downloads remove partial bytes and retry cleanly", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(),"mefi-interrupted-")); t.after(()=>rm(directory,{recursive:true,force:true}));
  const asset = {name:"build.zip",url:"https://api.github.com/fixture",size:10};
  const response = body => ({ok:true,headers:{get:()=>null},body});
  await assert.rejects(downloadAsset({asset,directory,fetchImpl:async()=>response(Readable.from([Buffer.from("short")]))}),/size/);
  await assert.rejects(stat(path.join(directory,"build.zip")),/ENOENT/);
  const stream = new Readable({read(){this.destroy(new Error("interrupted"));}});
  await assert.rejects(downloadAsset({asset,directory,fetchImpl:async()=>response(stream)}),/interrupted/);
  const result = await downloadAsset({asset,directory,fetchImpl:async()=>response(Readable.from([Buffer.alloc(10)]))}); assert.equal(result.bytes,10);
});
test("an Actions artifact downloads with the GitHub Accept, a release asset with octet-stream", async t => {
  // GitHub answers the artifact zip endpoint's octet-stream Accept with 415.
  const directory = await mkdtemp(path.join(os.tmpdir(),"mefi-accept-")); t.after(()=>rm(directory,{recursive:true,force:true}));
  const seen = [];
  const fetchImpl = async (url, {headers}) => { seen.push(headers.Accept); return {ok:true,headers:{get:()=>null},body:Readable.from([Buffer.alloc(4)])}; };
  await downloadAsset({asset:{name:"a.zip",url:artifact().archive_download_url,size:4},directory,token:"fixture-token",fetchImpl});
  await downloadAsset({asset:{name:"b.zip",url:`https://api.github.com/repos/${repo}/releases/assets/1`,size:4},directory,fetchImpl});
  assert.deepEqual(seen,["application/vnd.github+json","application/octet-stream"]);
});
test("real nested development archive verifies both hashes, provenance and staged app identity", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(),"mefi-dev-archive-")); t.after(()=>rm(root,{recursive:true,force:true}));
  const version="0.4.5-dev.100.1", payload=path.join(root,"payload"), bundle=path.join(root,"bundle");
  await mkdir(path.join(payload,"resources","app","renderer"),{recursive:true}); await mkdir(bundle);
  await writeFile(path.join(payload,"Mefi Studio AI+.exe"),"fixture");
  // A development build is an Electron build: its runtime sits beside the program.
  await writeFile(path.join(payload,"icudtl.dat"),"fixture");
  for (const file of ["main.cjs","preload.cjs","renderer/booklet.html"]) await writeFile(path.join(payload,"resources","app",file),"fixture");
  await writeFile(path.join(payload,"resources","app","package.json"),JSON.stringify({name:"mefi-studio",productName:"Mefi's Studio AI+",main:"main.cjs",version}));
  const inner=path.join(bundle,releaseAssetName(version)); await zipDirectory(payload,inner,{rootName:"Mefi Studio AI+"});
  await writeFile(`${inner}.sha256`,`${await sha256File(inner)}  ${path.basename(inner)}`);
  await writeFile(path.join(bundle,"development-build.json"),JSON.stringify({channel:"development",version,commit,runId:12}));
  const outer=path.join(root,"outer.zip"); await zipDirectory(bundle,outer,{rootName:""}); const sha256=await sha256File(outer);
  const latest={version,commit,runId:12,asset:{digest:`sha256:${sha256}`}};
  const zip=await unpackDevelopment({path:outer,sha256},latest,path.join(root,"unpacked"));
  // The payload folder stands in for the install: it holds resources/app/main.cjs.
  assert.equal((await stageUpdate({zipPath:zip,stagingDir:path.join(root,"staging"),installRoot:payload,expectedVersion:version})).payloadRoot.endsWith(path.join("resources","app")),true);
  await assert.rejects(stageUpdate({zipPath:zip,stagingDir:path.join(root,"wrong"),installRoot:payload,expectedVersion:"9.0.0"}),/identity or version/);
  await assert.rejects(unpackDevelopment({path:outer,sha256:"a".repeat(64)},latest,path.join(root,"bad")),/GitHub SHA/);
  await assert.rejects(unpackDevelopment({path:outer,sha256},{...latest,commit:"c".repeat(40)},path.join(root,"bad-provenance")),/provenance/);
  assert.ok((await readFile(zip)).length>0);
});
