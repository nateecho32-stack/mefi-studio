"""Verify Model Lab with real local IPC in a disposable Electron workspace.

python tools/verify_model_lab.py [--output tools/logs/model-lab-ui]

Reuses the Workspace harness's isolated source copy, settings, projects, profile,
network guard and screenshots. Synthetic observations are written through the
real ledger module; snapshot, human rating and context use the app's real IPC.
No provider calls, worker processes or live data stores are available.
"""
import argparse
from pathlib import Path

import verify_workspace as workspace

ROOT = Path(__file__).resolve().parents[1]

VERIFY_METHOD = r'''
  async verify() {
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden", "isolated workspace loads");
    assert.equal(report.cliChecks, 0, 'startup defers CLI discovery until Settings is used');
    await this.run("window.MefiNav.go('studio');");
    await this.until("!document.getElementById('ai-provider').disabled && document.querySelectorAll('#speed-model option').length > 2", "Settings initializes model controls on first use");
    assert.equal(report.cliChecks, 1);
    await this.run("window.MefiNav.go('booklet');");
    await this.until("document.querySelectorAll('#cards .card').length > 0", "catalog renders");
    await this.run("const input=document.getElementById('search');input.value=document.querySelector('#cards .card').dataset.id;input.dispatchEvent(new Event('input',{bubbles:true}));");
    await this.run("await new Promise(requestAnimationFrame);const card=document.querySelector('#cards .card');card.querySelector('details').open=true;document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);if(card!==document.querySelector('#cards .card')||!card.querySelector('details').open)throw new Error('Unchanged search replaced the expanded card');");
    await this.run("window.MefiNav.go('studio');");
    assert.equal(report.cliChecks, 1, 'reopening Settings retains its initialization');
    this.check('Settings defers discovery; repeated catalog searches retain expanded model details');
    await this.run("window.MefiNav.go('graph');");
    await this.until("!document.getElementById('tab-graph').hidden && document.getElementById('model-lab-ranking-list').textContent.includes('no measured calls')", "empty Model Lab is honest about missing measurements");
    const empty = await this.run("return window.mefiStudio.modelPerformanceSnapshot();");
    assert.equal(empty.ok, true);
    assert.equal(empty.calls, 0);
    assert.equal(empty.usage.costUsd.known, null);
    await this.capture('01-empty-model-lab');
    this.check('Model Lab opens inside Studio with no invented ranks, quality or price');

    const at = Date.now();
    const samples = [
      {id:'fixture-fast-one',model:'fixture-fast',elapsedMs:600,tokenUsage:{inputTokens:40,outputTokens:80,totalTokens:120},at:at-5000},
      {id:'fixture-careful-one',model:'fixture-careful',elapsedMs:1600,costUsd:.002,tokenUsage:{inputTokens:60,outputTokens:100,totalTokens:160},at:at-4000},
      {id:'fixture-careful-error',model:'fixture-careful',status:'error',errorKind:'validation',elapsedMs:30,at:at-3000},
      {id:'fixture-writer',model:'fixture-writer',taskType:'writing',elapsedMs:1100,costUsd:0,at:at-2000},
      {id:'fixture-fast-rated',model:'fixture-fast',elapsedMs:800,tokenUsage:{inputTokens:50,outputTokens:90,totalTokens:140},at:at-1000},
    ];
    for(const sample of samples) await fixtureLedger.record({provider:'fixture-subscription',taskType:'coding',status:'ok',source:'demo',requestedEffort:'low',appliedEffort:'low',...sample});
    await fixtureLedger.rate({observationId:'fixture-careful-one',authority:'human',score:5});
    await fixtureLedger.rate({observationId:'fixture-fast-one',authority:'model',judgeProvider:'fixture',judgeModel:'fixture-judge',score:2});
    await this.click('#model-lab-refresh');
    await this.until("document.querySelectorAll('#model-lab-ranking-list tbody tr').length===3 && !document.getElementById('model-lab-refresh').disabled", "seeded measured models appear");
    const measured = await this.run("return window.mefiStudio.modelPerformanceSnapshot();");
    assert.equal(measured.calls, 5);
    const fast = measured.models.find(row=>row.model==='fixture-fast');
    assert.equal(fast.costUsd.mean, null);
    assert.equal(fast.quality.human.mean, null);
    assert.equal(fast.quality.model.mean, 2);
    assert.equal(measured.usage.costUsd.unknownRecords, 3);
    const fastText = await this.run("return [...document.querySelectorAll('#model-lab-ranking-list tbody tr')].find(row=>row.textContent.includes('fixture-fast')).textContent;");
    assert(fastText.includes('Unknown'), 'unknown cost is explicit in the table');
    assert(fastText.includes('Not rated'), 'model judgment cannot become a human rating');
    await this.capture('02-measured-rankings');
    this.check('Measured speed, errors and quality render with unknown billing and separate model judgments');

    await this.run("const filter=document.getElementById('model-lab-task-type');filter.value='writing';filter.dispatchEvent(new Event('change',{bubbles:true}));");
    await this.until("document.querySelectorAll('#model-lab-ranking-list tbody tr').length===1 && document.getElementById('model-lab-ranking-list').textContent.includes('fixture-writer')", "task filter scopes measured evidence");
    await this.run("const filter=document.getElementById('model-lab-task-type');filter.value='';filter.dispatchEvent(new Event('change',{bubbles:true}));");
    await this.until("document.querySelectorAll('#model-lab-ranking-list tbody tr').length===3 && !document.getElementById('model-lab-refresh').disabled", "all task evidence restored");
    await this.click('#model-lab-ratings summary');
    await this.run("const form=document.querySelector('#model-lab-recent form');if(!form.textContent.includes('fixture-fast'))throw new Error('Unexpected first fixture observation');const select=form.querySelector('select');select.value='4';select.dispatchEvent(new Event('change',{bubbles:true}));form.querySelector('input').value='Reviewed fixture output';");
    await this.click('#model-lab-recent form button');
    await this.until("(async()=>{const state=await window.mefiStudio.modelPerformanceSnapshot();return state.recent.find(row=>row.id==='fixture-fast-rated')?.ratings.human[0]?.score===4;})()", "human rating persists through actual IPC");
    assert.deepEqual(report.ratingRequests.at(-1), {observationId:'fixture-fast-rated',authority:'human',score:4,note:'Reviewed fixture output'});
    const fromDisk = await fixtureLedger.read();
    assert.equal(fromDisk.ratings.find(row=>row.observationId==='fixture-fast-rated'&&row.authority==='human').score,4);
    const invalidRating = await this.run("return window.mefiStudio.modelPerformanceRate({observationId:'fixture-fast-rated',authority:'model',judgeModel:'forged',score:5});");
    assert.equal(invalidRating.ok,false,'renderer cannot forge model authority');
    await this.capture('03-human-rating');
    this.check('Task filtering and human rating use real local IPC; renderer cannot submit a model judgment');

    const loaded = new Promise(resolve=>this.webContents.once('did-finish-load',resolve));
    this.webContents.reload(); await loaded;
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden", "workspace returns after reload");
    await this.run("window.MefiNav.go('graph');");
    await this.until("document.querySelector('#model-lab-recent form select')?.value==='4'", "saved rating restored after renderer reload");
    const reopened = await require('./scripts/model-performance.cjs').createModelPerformanceStore({filePath:fixtureLedgerPath}).snapshot();
    assert.equal(reopened.calls,5);
    assert.equal(reopened.recent.find(row=>row.id==='fixture-fast-rated').ratings.human[0].score,4);
    this.check('Reloading Studio restores the saved human score from the persistent ledger');

    await this.click('#model-lab-tab-usage');
    await this.until("!document.getElementById('model-lab-usage').hidden", "usage tab opens");
    const usageText = await this.run("return document.getElementById('model-lab-usage-totals').textContent;");
    assert(usageText.includes('did not report this'),'unknown provider usage must be distinguished from zero');
    await this.capture('04-usage-coverage');
    this.check('Usage shows measured totals together with missing-report coverage');

    const longBrief = 'Preserve the original acceptance checks. '.repeat(800) + 'OriginalBriefSentinel';
    await this.run(`const result=await window.mefiStudio.tasksList();const task=result.tasks.find(row=>row.id==='fixture_open');task.prompt=${JSON.stringify(longBrief)};task.handoff={remaining:['Finish the importer','Verify keyboard navigation']};task.refs=[{kind:'file',detail:'src/'+'LongUnbrokenContextReference'.repeat(15)+'.js'}];const saved=await window.mefiStudio.tasksSave(result.tasks);if(!saved?.ok)throw new Error(saved?.error||'Could not save fixture context');const dependencies=await window.mefiStudio.tasksDependencies({taskId:task.id,projectId:result.projectId,dependsOn:['fixture_done']});if(!dependencies?.ok)throw new Error(dependencies?.error||'Could not save fixture prerequisite');`);
    await this.click('#model-lab-tab-context');
    await this.until("[...document.getElementById('model-lab-context-task').options].some(option=>option.value==='fixture_open')", "saved tasks populate context chooser");
    await this.run("document.getElementById('model-lab-context-task').value='fixture_open';const budget=document.getElementById('model-lab-context-budget');budget.value='1000';budget.dispatchEvent(new Event('change',{bubbles:true}));");
    await this.until("!document.getElementById('model-lab-context-refresh').disabled && document.getElementById('model-lab-context-sections').textContent.includes('Finish the importer')", "bounded context retains the unresolved handoff");
    const preview = await this.run("return window.mefiStudio.modelLabContext({taskId:'fixture_open',budgetTokens:1000});");
    assert.equal(preview.ok,true);
    assert.equal(preview.mode,'context-preview');
    assert(preview.estimatedTokens<=1000);
    assert.equal(preview.truncated,true);
    const savedBrief = await this.run("return (await window.mefiStudio.tasksList()).tasks.find(row=>row.id==='fixture_open').prompt;");
    assert.equal(savedBrief,longBrief,'preview must not shorten the saved source');
    await this.capture('05-context-preview');
    report.context={estimatedTokens:preview.estimatedTokens,budgetTokens:preview.budgetTokens,truncated:preview.truncated,sections:preview.sections.map(({kind,included,truncated})=>({kind,included,truncated}))};
    this.check('Context preview respects its budget and preserves full saved requirements and handoff');

    this.setContentSize(900,900); await sleep(200);
    const layout = await this.run("const lab=document.getElementById('model-lab'),head=lab.querySelector('.lab-head').getBoundingClientRect(),controls=document.querySelector('.lab-context-controls').getBoundingClientRect();return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,lab:lab.getBoundingClientRect().toJSON(),head:head.toJSON(),controls:controls.toJSON(),wideSources:[...document.querySelectorAll('#model-lab-context-sections pre')].filter(el=>el.scrollWidth>el.clientWidth+1).length};");
    assert(layout.scroll<=layout.width+2,'900px view must not overflow the page horizontally');
    assert(layout.lab.x>=-2 && layout.lab.right<=layout.width+2,'Model Lab fits narrow page');
    assert(layout.controls.x>=-2 && layout.controls.right<=layout.width+2,'context controls fit narrow page');
    assert.equal(layout.wideSources,0,'long references wrap in readable context cards');
    report.narrow=layout;
    await this.capture('06-context-narrow');
    await this.click('#model-lab-tab-rankings');
    await this.capture('07-rankings-narrow');
    await this.click('#model-lab-tab-compare');
    assert.equal(await this.run("return document.querySelectorAll('#model-lab-compare button').length;"),0,'planned comparisons do not offer a false run action');
    this.check('900px layout remains usable and opening Compare starts no model jobs');
    assert.equal(report.networkAttempts.length,0,'read-only Model Lab flow cannot attempt paid/network calls');
    assert.equal(report.workerAttempts.length,0,'Model Lab flow cannot launch a worker process');
    const serious=report.consoleErrors.filter(line=>!/ERR_FILE_NOT_FOUND/.test(line));
    assert.equal(serious.length,0,`renderer errors: ${serious.join('; ')}`);
  }
}
'''


def bootstrap():
    prefix = workspace.BOOTSTRAP.split("  async verify() {", 1)[0]
    suffix = workspace.BOOTSTRAP.split("global.__MefiVerifiedWindow", 1)[1]
    prefix = prefix.replace("const started = performance.now();", """const started = performance.now();
const fixtureLedgerPath = path.join(config.appRoot, 'data', 'model-performance.json');
const fixtureLedger = require('./scripts/model-performance.cjs').createModelPerformanceStore({filePath:fixtureLedgerPath});""")
    prefix = prefix.replace("let failNextMessage = false;", """Object.assign(report, {ratingRequests: [], cliChecks: 0});
childProcess.spawn = (...args) => { report.workerAttempts.push(String(args[0])); throw new Error('Process launching is disabled by the isolated Model Lab fixture'); };
let failNextMessage = false;""")
    marker = '  if (channel === "assistant:message" && failNextMessage) {'
    prefix = prefix.replace(marker, """  if (channel === 'model-performance:rate') report.ratingRequests.push({...args[0]});
  if (channel === 'machine:status') return {ok:true,status:{updatedAt:Date.now(),running:[],strays:[],leases:{exclusive:false},lines:'fixture machine idle'}};
  if (channel === 'studio:cli-status') { report.cliChecks++; return []; }
""" + marker)
    return prefix + VERIFY_METHOD + "\nglobal.__MefiVerifiedWindow" + suffix


def verify(source, output):
    original = workspace.BOOTSTRAP
    try:
        workspace.BOOTSTRAP = bootstrap()
        return workspace.verify(source, output)
    finally:
        workspace.BOOTSTRAP = original


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=ROOT / "tools/logs/model-lab-ui")
    args = parser.parse_args()
    result = verify(args.source.resolve(), args.output.resolve())
    print(f"Model Lab verified: {len(result['checks'])} checks, {len(result['screenshots'])} screenshots in {args.output.resolve()}")
