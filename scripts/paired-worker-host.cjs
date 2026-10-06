"use strict";
// Lazy desktop adapter. Opening Your PCs reads state only. Every listener,
// pairing grant and worker start the owner asks for requires an explicit
// native confirmation. A coordinator or worker the owner started comes back by
// itself after Studio restarts, updates or crashes (settings.pairedCoordinator
// and settings.pairedWorker `autoStart`, turned on by that confirmed Start and
// off by Stop or the switch); resume() is that start, with no dialog.
const fs=require("node:fs/promises"),path=require("node:path"),os=require("node:os");
const {createHash}=require("node:crypto");
const {createCoordinator,text}=require("./paired-coordinator.cjs");
const {endpoint,startServer,client}=require("./paired-transport.cjs");
const {createWorker,gitCheckRunner}=require("./paired-worker.cjs");
const {appVersion}=require("./link-compat.cjs");
function createPairedHost({directory,project,readSettings,updateSettings,confirm,chooseTLS,seal,unseal,encryptionAvailable,node=process.execPath,app=null,onBehind=null}={}){
  let coordinatorPromise=null,coordinatorLoaded=null,server=null,worker=null,busy=false;
  const resumeErrors={coordinator:null,worker:null};
  const coordinator=()=>coordinatorPromise??=createCoordinator({directory:path.join(directory,"coordinator")}).then(value=>(coordinatorLoaded=value));
  const settings=async()=>((await readSettings()).pairedWorker??{});
  const coordinatorSettings=async()=>((await readSettings()).pairedCoordinator??{});
  const guard=async work=>{if(busy)throw new Error("Finish the current paired-worker action first.");busy=true;try{return await work();}finally{busy=false;}};
  const allowedProject=async()=>{const current=await project();if(!current?.root||!current.repo||!/^[a-f0-9]{40}$/.test(current.commit??""))throw new Error("Open a Studio project with a GitHub repository and saved commit first.");const pkg=JSON.parse(await fs.readFile(path.join(current.root,"package.json"),"utf8"));if(pkg.name!=="mefi-studio")throw new Error("The first paired-worker profile supports Studio repository checks.");return current;};
  const view=async(options={})=>{const saved=await settings(),own=await coordinatorSettings();return {ok:true,app:appVersion(app),coordinator:{running:Boolean(server),url:server?.url??null,autoStart:own.autoStart===true,resumeError:resumeErrors.coordinator,...await (await coordinator()).status(options)},worker:{paired:Boolean(saved.credentials),url:saved.url??null,repo:saved.repo??null,autoStart:saved.autoStart===true&&Boolean(saved.credentials),resumeError:resumeErrors.worker,...(worker?.status()??{running:false,error:null,uncertain:[]})},encryptionAvailable:encryptionAvailable()};};
  // The saved listener: port, loopback or HTTPS, the advertised address and
  // the paths of the TLS files chosen at the first Start (read again each time).
  const openServer=async({port,mode,url,tls:files})=>{
    let tls=null;if(mode==="https"){if(!files?.cert||!files?.key)throw new Error("Choose the TLS certificate and key again: press Start coordinator.");for(const name of [files.cert,files.key])if((await fs.stat(name)).size>65536)throw new Error("Choose a small PEM certificate and key.");tls={cert:await fs.readFile(files.cert),key:await fs.readFile(files.key)};}
    return startServer({coordinator:await coordinator(),host:mode==="https"?"0.0.0.0":"127.0.0.1",port,tls,advertisedUrl:url||null,app});
  };
  const openWorker=async saved=>{
    const credentials=JSON.parse(unseal(saved.credentials));const local=path.join(directory,"worker");
    const made=await createWorker({directory:local,url:saved.url,...credentials,app,onBehind,run:gitCheckRunner({roots:{[saved.repo]:saved.root},workspace:path.join(local,"checkouts"),node})});made.start();return made;
  };
  const autoStart=(key,on)=>updateSettings(s=>{if(s[key])s[key]={...s[key],autoStart:on};});
  return {
    status:view,
    isRunning:()=>Boolean(server||worker?.status().running),
    // A check is assigned or running here or on a worker this PC coordinates.
    inFlight:()=>worker?.status().busy===true||(Boolean(server)&&(coordinatorLoaded?.activeJobs()??0)>0),
    startCoordinator:options=>guard(async()=>{
      if(server)return view();const port=Number(options?.port??42240),mode=options?.mode==="https"?"https":"loopback";
      if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Choose a port between 1 and 65535.");
      const advertisedUrl=String(options?.url??"").trim()||null;if(advertisedUrl)endpoint(advertisedUrl);
      if(mode==="https"&&(!advertisedUrl||!advertisedUrl.startsWith("https://")))throw new Error("Enter the trusted HTTPS address other PCs will use.");
      if(!await confirm("Start the coordinator?",`${mode==="https"?"This starts a TLS listener on this PC. Use a trusted certificate and only networks you intend to serve. Firewall, router and tunnel setup are separate owner steps.":"This listens on this PC's loopback address only. Another PC needs the HTTPS option or an existing HTTPS reverse proxy. No firewall or router setting is changed."}\nIt starts again by itself when Studio restarts or updates. Stop coordinator turns that off.`))return {ok:true,cancelled:true};
      let files=null;if(mode==="https"){files=await chooseTLS();if(!files)return {ok:true,cancelled:true};}
      server=await openServer({port,mode,url:advertisedUrl,tls:files});resumeErrors.coordinator=null;
      await updateSettings(s=>{s.pairedCoordinator={autoStart:true,port,mode,url:advertisedUrl,tls:files?{cert:files.cert,key:files.key}:null};});return view();
    }),
    stopCoordinator:()=>guard(async()=>{if(server){await server.close();server=null;}await autoStart("pairedCoordinator",false);return view();}),
    invite:()=>guard(async()=>{if(!server)throw new Error("Start the coordinator first.");if(!await confirm("Pair another PC?","This one-use code grants that PC access to repository check assignments. It expires in five minutes. Share it only with the PC you intend to pair."))return {ok:true,cancelled:true};const invitation=await (await coordinator()).invite();return {ok:true,code:JSON.stringify({url:server.url,...invitation}),expiresAt:invitation.expiresAt};}),
    pairWorker:code=>guard(async()=>{
      if(worker?.status().running)throw new Error("Stop this worker before changing its pairing.");if(!encryptionAvailable())throw new Error("Encrypted local storage is required for pairing.");
      if(typeof code!=="string"||code.length>2048)throw new Error("Paste the coordinator's pairing code.");let invitation;try{invitation=JSON.parse(code);}catch{throw new Error("Paste the coordinator's complete pairing code.");}const url=endpoint(invitation?.url);
      const current=await allowedProject();if(!await confirm("Pair this PC as a worker?",`Coordinator: ${url}\nRepository: ${current.repo}\nWhen you start this worker, it may run Studio repository checks in isolated exact-commit checkouts. Its access credential is kept encrypted on this PC. No provider account or permission is shared.`))return {ok:true,cancelled:true};
      const paired=await client({url,app})("pair",{inviteId:invitation.inviteId,secret:invitation.secret,name:os.hostname(),repos:[current.repo],profiles:["studio-check"]});
      if(!/^[0-9a-f-]{36}$/.test(paired.workerId??"")||!/^[A-Za-z0-9_-]{40,80}$/.test(paired.token??""))throw new Error("Coordinator pairing response is malformed.");
      const credentials=seal(JSON.stringify({workerId:paired.workerId,token:paired.token}));await updateSettings(s=>{s.pairedWorker={url,repo:current.repo,root:current.root,credentials};});return view();
    }),
    startWorker:()=>guard(async()=>{
      if(worker?.status().running)return view();const saved=await settings();if(!saved.credentials||!encryptionAvailable())throw new Error("Pair this PC first using encrypted local storage.");
      if(!await confirm("Start repository checks on this PC?",`Only ${saved.repo} and the Studio check profile are enabled. Each job uses a fresh checkout at the coordinator's exact commit. Existing work is kept. It reconnects by itself after a lost connection, and starts again by itself when Studio restarts or updates. Stop worker turns that off.`))return {ok:true,cancelled:true};
      worker=await openWorker(saved);resumeErrors.worker=null;await autoStart("pairedWorker",true);return view();
    }),
    stopWorker:()=>guard(async()=>{await worker?.stop();await autoStart("pairedWorker",false);return view();}),
    forgetWorker:()=>guard(async()=>{if(!await confirm("Forget this worker pairing?","Stop this worker and remove its encrypted local access credential. Its journals and isolated checkouts remain available."))return {ok:true,cancelled:true};await worker?.stop();worker=null;await updateSettings(s=>{delete s.pairedWorker;});return view();}),
    // The "Start by itself" switches. Turning one on is a standing grant, so it
    // asks first; turning one off never does. Neither starts or stops anything now.
    setAutoStart:(role,on)=>guard(async()=>{
      const key=role==="coordinator"?"pairedCoordinator":role==="worker"?"pairedWorker":null;if(!key)throw new Error("Choose the coordinator or the worker.");
      const saved=(await readSettings())[key];
      if(on===true){
        if(key==="pairedWorker"&&!saved?.credentials)throw new Error("Pair this PC first.");if(key==="pairedCoordinator"&&!saved?.port)throw new Error("Start the coordinator once first.");
        if(!await confirm(key==="pairedWorker"?"Start this worker by itself?":"Start the coordinator by itself?",`Whenever Studio starts, including after an update or a crash, it ${key==="pairedWorker"?`starts repository checks for ${saved.repo} and reconnects to ${saved.url}`:"starts the coordinator with the settings it used last"} without asking.`))return {ok:true,cancelled:true};
      }
      await autoStart(key,on===true);return view();
    }),
    // At launch: bring back what the owner left running. Nothing is asked; a
    // failure is kept for Your PCs to show and the rest still starts.
    resume:()=>guard(async()=>{
      const all=await readSettings(),own=all.pairedCoordinator,saved=all.pairedWorker;const started=[];
      if(own?.autoStart===true&&!server){try{server=await openServer(own);resumeErrors.coordinator=null;started.push("coordinator");}catch(error){resumeErrors.coordinator=text(error?.message??error,300);}}
      if(saved?.autoStart===true&&saved.credentials&&!worker?.status().running){
        if(!encryptionAvailable())resumeErrors.worker="Encrypted local storage is unavailable, so the worker waits for a manual Start.";
        else{try{worker=await openWorker(saved);resumeErrors.worker=null;started.push("worker");}catch(error){resumeErrors.worker=text(error?.message??error,300);}}
      }
      return {...await view(),started};
    }),
    // After sleep or a network change: the worker polls at once.
    wake:()=>worker?.wake()===true,
    enqueue:()=>guard(async()=>{const current=await allowedProject();if(!await confirm("Queue this exact commit for a paired worker?",`${current.repo}\n${current.commit}\nThe worker runs six Studio repository check steps. It does not edit this checkout or call a provider.`))return {ok:true,cancelled:true};const spec={repo:current.repo,commit:current.commit,profile:"studio-check"},key=createHash("sha256").update(JSON.stringify(spec)).digest("hex");return {ok:true,job:await (await coordinator()).enqueue({key,spec})};}),
    revoke:workerId=>guard(async()=>{if(!await confirm("Revoke this worker?","Its credential will stop working. An in-flight assignment remains uncertain until stopped and reconciled; it is never automatically assigned again."))return {ok:true,cancelled:true};await (await coordinator()).revoke(workerId);return view();}),
    history:async(jobId,options)=>(await coordinator()).history(jobId,options),
    confirmStopped:jobId=>guard(async()=>{if(!worker)throw new Error("Start this worker to reconcile its journal first.");if(!await confirm("Has the previous check process stopped?","Only confirm after stopping or verifying the previous check processes on this PC. This records the assignment as interrupted; it never restarts the check automatically."))return {ok:true,cancelled:true};await worker.confirmStopped(jobId);return view();}),
    // Closing for a restart, an update or a quit keeps `autoStart` as it is,
    // so the next launch brings back what was running.
    async close(){await worker?.stop();if(server){await server.close();server=null;}},
  };
}
module.exports={createPairedHost};
