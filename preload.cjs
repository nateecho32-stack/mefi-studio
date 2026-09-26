// Mefi's Studio AI+ — preload bridge (CJS; Electron's safe preload format).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  mediaSceneSample: (rect) => ipcRenderer.invoke("media:scene-sample", rect),
  youtubeSearch: (query) => ipcRenderer.invoke("media:youtube-search", query),
  mediaClipboardLink: () => ipcRenderer.invoke("media:clipboard-link"),
  performanceControl: (payload) => ipcRenderer.invoke("performance:control", payload ?? {}),
  performanceSnapshot: () => ipcRenderer.invoke("performance:snapshot"),
  projectsList: () => ipcRenderer.invoke("projects:list"),
  projectsAdd: () => ipcRenderer.invoke("projects:add"),
  projectsAddPath: (folder) => ipcRenderer.invoke("projects:add-path", { path: folder }),
  projectsSelect: (id, options) => ipcRenderer.invoke("projects:select", options ? { id, saveProgress: options.saveProgress === true } : id),
  projectsRemove: (id) => ipcRenderer.invoke("projects:remove", id),
  onProjects: (callback) => ipcRenderer.on("projects:changed", (_event, data) => callback(data)),
  projectPreviewStatus: (payload) => ipcRenderer.invoke("project-preview:status", payload ?? {}),
  projectPreviewStart: (payload) => ipcRenderer.invoke("project-preview:start", payload ?? {}),
  projectPreviewOpen: (payload) => ipcRenderer.invoke("project-preview:open", payload ?? {}),
  projectPreviewStop: (payload) => ipcRenderer.invoke("project-preview:stop", payload ?? {}),
  onProjectPreview: (callback) => ipcRenderer.on("project-preview:changed", (_event, data) => callback(data)),
  // Launch screen: the project to open, and whether the agents may start.
  startupState: () => ipcRenderer.invoke("startup:state"),
  startupChoose: (id) => ipcRenderer.invoke("startup:choose", { id: typeof id === "string" ? id : null }),
  startupBegin: () => ipcRenderer.invoke("startup:begin"),
  readCatalog: () => ipcRenderer.invoke("catalog:read"),
  refreshCatalog: () => ipcRenderer.invoke("catalog:refresh"),
  launchStudio: () => ipcRenderer.invoke("studio:launch"),
  runSmoke: () => ipcRenderer.invoke("studio:smoke"),
  launchGame: () => ipcRenderer.invoke("studio:game"),
  stopStudio: () => ipcRenderer.invoke("studio:stop"),
  serverStylerStatus: () => ipcRenderer.invoke("styler:status"),
  serverStylerStart: () => ipcRenderer.invoke("styler:start"),
  serverStylerOpen: () => ipcRenderer.invoke("styler:open"),
  serverStylerFolder: () => ipcRenderer.invoke("styler:folder"),
  serverStylerStop: () => ipcRenderer.invoke("styler:stop"),
  getApiKey: (which) => ipcRenderer.invoke("settings:get-key", which),
  setApiKey: (key, which) => ipcRenderer.invoke("settings:set-key", key, which),
  getAiRouting: () => ipcRenderer.invoke("settings:get-ai-routing"),
  setAiRouting: (patch) => ipcRenderer.invoke("settings:set-ai-routing", patch),
  agentsState: (payload = {}) => ipcRenderer.invoke("agents:state", { projectId: payload.projectId, scope: payload.scope }),
  agentModels: (provider) => ipcRenderer.invoke("agents:models", { provider }),
  agentsSave: (payload) => ipcRenderer.invoke("agents:save", payload),
  agentsPreset: (payload) => ipcRenderer.invoke("agents:preset", payload),
  openrouterModels: (options = {}) => ipcRenderer.invoke("openrouter:models", { refresh: options?.refresh === true }),
  autoSetup: () => ipcRenderer.invoke("settings:auto-setup"),
  // The first launch of a fresh install runs auto setup by itself (main.cjs
  // firstLaunchAutoSetup) and announces the saved record here.
  onAutoSetup: (callback) => ipcRenderer.on("setup:auto-setup", (_event, data) => callback(data)),
  onSettingsChanged: (callback) => ipcRenderer.on("settings:changed", (_event, data) => callback(data)),
  // File.path left Electron in v32; a dropped file's path comes from webUtils.
  pathForFile: (file) => {
    try {
      return webUtils?.getPathForFile?.(file) || null;
    } catch {
      return null;
    }
  },
  // First run on OpenCode (renderer/onboarding.js): scan, apply, map.
  firstRunStatus: () => ipcRenderer.invoke("setup:first-run-status"),
  firstScan: (payload) => ipcRenderer.invoke("setup:first-scan", payload ?? {}),
  firstScanApply: (payload) => ipcRenderer.invoke("setup:first-scan-apply", payload ?? {}),
  firstMap: (payload) => ipcRenderer.invoke("setup:first-map", payload ?? {}),
  firstMapCancel: () => ipcRenderer.invoke("setup:first-map-cancel"),
  firstAssist: (payload) => ipcRenderer.invoke("setup:first-assist", payload ?? {}),
  onFirstMapProgress: (callback) => ipcRenderer.on("setup:first-map-progress", (_event, data) => callback(data)),
  jevStatus: () => ipcRenderer.invoke("jev:status"),
  jevProbe: () => ipcRenderer.invoke("jev:probe"),
  jevSetEnabled: (enabled) => ipcRenderer.invoke("jev:set-enabled", enabled),
  jevSetRoute: (route) => ipcRenderer.invoke("jev:set-route", route),
  cliStatus: () => ipcRenderer.invoke("studio:cli-status"),
  launchCli: (id) => ipcRenderer.invoke("studio:launch-cli", id),
  testZai: () => ipcRenderer.invoke("studio:test-zai"),
  speedProbe: (modelId) => ipcRenderer.invoke("speed:probe", { modelId }),
  speedMeasurements: () => ipcRenderer.invoke("speed:measurements-read"),
  modelPerformanceSnapshot: (payload) => ipcRenderer.invoke("model-performance:snapshot", payload ?? {}),
  modelPerformanceRate: (payload) => ipcRenderer.invoke("model-performance:rate", payload ?? {}),
  modelLabContext: (payload) => ipcRenderer.invoke("model-lab:context", payload ?? {}),
  usageTracker: () => ipcRenderer.invoke("usage:tracker", {}),
  usageForTask: (taskId) => ipcRenderer.invoke("usage:task", { taskId }),
  opencodeCredits: () => ipcRenderer.invoke("opencode:credits", {}),
  usageAccounts: (options = {}) => ipcRenderer.invoke("usage:accounts", { probe: options?.probe === true }),
  openExternal: (url) => ipcRenderer.invoke("shell:open", url),
  shellReveal: (filePath) => ipcRenderer.invoke("shell:reveal", filePath),
  shellCopy: (text) => ipcRenderer.invoke("shell:copy", text),
  eyesPickPng: () => ipcRenderer.invoke("eyes:pick-png"),
  eyesState: (sessionId) => ipcRenderer.invoke("eyes:state", { sessionId }),
  eyesLog: (lines) => ipcRenderer.invoke("eyes:log", { lines }),
  eyesPinsRead: () => ipcRenderer.invoke("eyes:pins-read"),
  eyesPinsWrite: (pins) => ipcRenderer.invoke("eyes:pins-write", pins),
  eyesWatch: (running) => ipcRenderer.invoke("eyes:watch", { running }),
  eyesRequestsRead: () => ipcRenderer.invoke("eyes:requests-read"),
  eyesRequestsAction: (payload) => ipcRenderer.invoke("eyes:requests-action", payload ?? {}),
  eyesCheckpointsRead: () => ipcRenderer.invoke("eyes:checkpoints-read"),
  eyesBriefingRead: () => ipcRenderer.invoke("eyes:briefing-read"),
  eyesCollisions: () => ipcRenderer.invoke("eyes:collisions"),
  assistantRun: (mode, sessionId, payload) => ipcRenderer.invoke("assistant:run", { mode, sessionId, payload }),
  assistantAutopilot: (prefs) => ipcRenderer.invoke("assistant:autopilot", prefs),
  assistantStatus: () => ipcRenderer.invoke("assistant:status"),
  backlogStatus: () => ipcRenderer.invoke("assistant:backlog"),
  backlogControl: (payload) => ipcRenderer.invoke("assistant:backlog-control", payload ?? {}),
  assistantState: () => ipcRenderer.invoke("assistant:state"),
  assistantMessage: (text, projectId, context) => ipcRenderer.invoke("assistant:message", { text, projectId, context }),
  musicRecommend: (payload) => ipcRenderer.invoke("music:recommend", payload ?? {}),
  assistantWorkOn: (target) => ipcRenderer.invoke("assistant:work-on", target ?? {}),
  assistantFocus: (target) => ipcRenderer.invoke("assistant:focus", target ?? null),
  assistantNodeContext: (payload) => ipcRenderer.invoke("assistant:node-context", payload ?? {}),
  assistantControl: (action) => ipcRenderer.invoke("assistant:control", { action }),
  assistantPrefs: (patch) => ipcRenderer.invoke("assistant:prefs", patch),
  assistantAnswer: (payload) => ipcRenderer.invoke("assistant:answer", payload ?? {}),
  assistantDoneLog: (payload) => ipcRenderer.invoke("assistant:done-log", payload ?? {}),
  assistantClearDoneLog: () => ipcRenderer.invoke("assistant:clear-done"),
  // Brain maps: the pipeline editor's store, parts catalog and gates.
  brainsCatalog: () => ipcRenderer.invoke("brains:catalog"),
  brainsState: () => ipcRenderer.invoke("brains:state"),
  brainsRead: (id) => ipcRenderer.invoke("brains:read", { id: typeof id === "string" ? id : null }),
  brainsSave: (map, options) => ipcRenderer.invoke("brains:save", { map, allowEmpty: options?.allowEmpty === true }),
  brainsDelete: (id) => ipcRenderer.invoke("brains:delete", { id }),
  brainsReset: (id) => ipcRenderer.invoke("brains:reset", { id }),
  brainsGatePlan: (id) => ipcRenderer.invoke("brains:gate-plan", { id: typeof id === "string" ? id : null }),
  brainsActivate: (id, options) => ipcRenderer.invoke("brains:activate", { id, applyGates: options?.applyGates !== false }),
  brainsActivity: () => ipcRenderer.invoke("brains:activity"),
  brainsValidate: (map) => ipcRenderer.invoke("brains:validate", { map }),
  brainsDraft: (text) => ipcRenderer.invoke("brains:draft", { text }),
  onBrains: (callback) => ipcRenderer.on("brains:changed", (_event, payload) => callback(payload)),
  onBrainsActive: (callback) => ipcRenderer.on("brains:active", (_event, payload) => callback(payload)),
  auditorRun: () => ipcRenderer.invoke("auditor:run"),
  checkpointAdd: (sessionId, note) => ipcRenderer.invoke("checkpoint:add", { sessionId, note }),
  analyzerRun: (kind, payload) => ipcRenderer.invoke("analyzer:run", { kind, ...payload }),
  analyzerPick: () => ipcRenderer.invoke("analyzer:pick"),
  analyzerAi: (kind, payload) => ipcRenderer.invoke("analyzer:ai", { kind, payload }),
  tasksList: () => ipcRenderer.invoke("tasks:list"),
  planningList: (payload) => ipcRenderer.invoke("planning:list", payload ?? {}),
  planningAction: (payload) => ipcRenderer.invoke("planning:action", payload ?? {}),
  planningAssist: (payload) => ipcRenderer.invoke("planning:assist", payload ?? {}),
  planningExplore: (payload) => ipcRenderer.invoke("planning:explore", payload ?? {}),
  tasksCreate: (task) => ipcRenderer.invoke("tasks:create", task),
  tasksDependencies: (payload) => ipcRenderer.invoke("tasks:dependencies", payload ?? {}),
  tasksHistory: (payload) => ipcRenderer.invoke("tasks:history", payload ?? {}),
  tasksHandoff: (payload) => ipcRenderer.invoke("tasks:handoff", payload ?? {}),
  tasksAttempts: (payload) => ipcRenderer.invoke("tasks:attempts", payload ?? {}),
  tasksRestore: (payload) => ipcRenderer.invoke("tasks:restore", payload ?? {}),
  tasksDelete: (payload) => ipcRenderer.invoke("tasks:delete", payload ?? {}),
  tasksAction: (payload) => ipcRenderer.invoke("tasks:action", payload ?? {}),
  tasksSave: (tasks) => ipcRenderer.invoke("tasks:save", tasks),
  ideasList: () => ipcRenderer.invoke("ideas:list"),
  ideasSave: (ideas) => ipcRenderer.invoke("ideas:save", ideas),
  ideasAction: (payload) => ipcRenderer.invoke("ideas:action", payload ?? {}),
  ideasScan: (ai) => ipcRenderer.invoke("ideas:scan", { ai }),
  referenceGather: (payload) => ipcRenderer.invoke("reference:gather", payload),
  prefsGet: () => ipcRenderer.invoke("prefs:get"),
  prefsSet: (prefs) => ipcRenderer.invoke("prefs:set", prefs),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  updateSet: (auto) => ipcRenderer.invoke("update:set", { auto }),
  updateApply: () => ipcRenderer.invoke("update:apply"),
  appRestart: (options) => ipcRenderer.invoke("app:restart", options ?? {}),
  releaseStatus: () => ipcRenderer.invoke("release:status"),
  releaseCheck: () => ipcRenderer.invoke("release:check"),
  releaseApply: () => ipcRenderer.invoke("release:apply"),
  // Void Engine Discord link (main.cjs "Discord community link"): every call
  // answers { ok, status } with the public status only; tokens never cross.
  communityStatus: () => ipcRenderer.invoke("community:status"),
  communityLink: () => ipcRenderer.invoke("community:link"),
  communityLinkCancel: () => ipcRenderer.invoke("community:link-cancel"),
  communityCheck: () => ipcRenderer.invoke("community:check"),
  communityUnlink: () => ipcRenderer.invoke("community:unlink"),
  communityPrompt: (action) => ipcRenderer.invoke("community:prompt", { action: typeof action === "string" ? action : null }),
  communityOpen: (target) => ipcRenderer.invoke("community:open", { target: typeof target === "string" ? target : null }),
  onCommunityEvent: (callback) => ipcRenderer.on("community:event", (_event, status) => callback(status)),
  // The Void Engine rooms hub (main.cjs "Rooms hub"): Listen together and the
  // now-playing share behind the bot's /nowplaying. Nothing connects until
  // hubConnect; tokens never cross this bridge.
  hubStatus: () => ipcRenderer.invoke("hub:status"),
  hubConnect: () => ipcRenderer.invoke("hub:connect"),
  hubDisconnect: () => ipcRenderer.invoke("hub:disconnect"),
  hubRooms: () => ipcRenderer.invoke("hub:rooms"),
  hubSubscribe: (roomId, on = true) => ipcRenderer.invoke("hub:subscribe", { roomId: typeof roomId === "string" ? roomId : null, on: on !== false }),
  hubListen: (payload) => ipcRenderer.invoke("hub:listen", payload && typeof payload === "object" ? {
    roomId: typeof payload.roomId === "string" ? payload.roomId : null, action: typeof payload.action === "string" ? payload.action : null,
    url: typeof payload.url === "string" ? payload.url : undefined, label: typeof payload.label === "string" ? payload.label : undefined,
    provider: typeof payload.provider === "string" ? payload.provider : undefined, positionMs: Number.isFinite(payload.positionMs) ? payload.positionMs : undefined,
  } : null),
  hubNowPlaying: (track) => ipcRenderer.invoke("hub:now-playing", { track: track && typeof track === "object" ? { label: String(track.label ?? ""), provider: String(track.provider ?? ""), ...(typeof track.url === "string" ? { url: track.url } : {}) } : null }),
  onHubEvent: (callback) => ipcRenderer.on("hub:event", (_event, payload) => callback(payload)),
  machineStatus: (kill) => ipcRenderer.invoke("machine:status", { kill: Boolean(kill) }),
  machineGet: () => ipcRenderer.invoke("machine:get"),
  machineSet: (prefs) => ipcRenderer.invoke("machine:set", prefs),
  machineKill: (pid) => ipcRenderer.invoke("machine:kill", { pid }),
  onAssistantStatus: (callback) => ipcRenderer.on("assistant:status", (_event, status) => callback(status)),
  onMachineStatus: (callback) => ipcRenderer.on("machine:status", (_event, status) => callback(status)),
  onTasks: (callback) => ipcRenderer.on("eyes:tasks", (_event, tasks) => callback(tasks)),
  onIdeas: (callback) => ipcRenderer.on("eyes:ideas", (_event, ideas) => callback(ideas)),
  onRequests: (callback) => ipcRenderer.on("eyes:requests", (_event, requests) => callback(requests)),
  onCheckpoints: (callback) => ipcRenderer.on("eyes:checkpoints", (_event, data) => callback(data)),
  onBriefing: (callback) => ipcRenderer.on("eyes:briefing", (_event, data) => callback(data)),
  onEyesActivity: (callback) => ipcRenderer.on("eyes:activity", (_event, data) => callback(data)),
  onEyesError: (callback) => ipcRenderer.on("eyes:error", (_event, message) => callback(message)),
  // The host batches log lines (logLine in main.cjs); listeners still get one line per call.
  onStudioLog: (callback) => ipcRenderer.on("studio:log", (_event, lines) => {
    for (const line of Array.isArray(lines) ? lines : [lines]) callback(line);
  }),
  onUpdateEvent: (callback) => ipcRenderer.on("update:event", (_event, payload) => callback(payload)),
  onReleaseEvent: (callback) => ipcRenderer.on("release:event", (_event, payload) => callback(payload)),
  onAssistant: (callback) => ipcRenderer.on("eyes:assistant", (_event, payload) => callback(payload)),
  // The Agent Brain and the companion (scripts/agent-brain-host.cjs).
  brainState: (payload) => ipcRenderer.invoke("brain:state", payload && typeof payload === "object" ? { taskIds: Array.isArray(payload.taskIds) ? payload.taskIds.slice(0, 200).map(String) : null } : {}),
  brainEvents: (query) => ipcRenderer.invoke("brain:events", query && typeof query === "object" ? {
    day: typeof query.day === "string" ? query.day : undefined, since: Number.isFinite(query.since) ? query.since : undefined,
    until: Number.isFinite(query.until) ? query.until : undefined, taskId: typeof query.taskId === "string" ? query.taskId : undefined,
    kinds: Array.isArray(query.kinds) ? query.kinds.map(String) : undefined, limit: Number.isFinite(query.limit) ? query.limit : undefined,
  } : {}),
  brainPlaybook: () => ipcRenderer.invoke("brain:playbook"),
  brainPlaybookAction: (payload) => ipcRenderer.invoke("brain:playbook-action", payload && typeof payload === "object" ? {
    action: String(payload.action ?? ""), id: String(payload.id ?? ""), ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    ...(Array.isArray(payload.steps) ? { steps: payload.steps } : {}),
  } : {}),
  brainMap: (rebuild) => ipcRenderer.invoke("brain:map", { rebuild: rebuild === true }),
  brainMapName: () => ipcRenderer.invoke("brain:map-name"),
  brainMapPlace: (payload) => ipcRenderer.invoke("brain:map-place", payload && typeof payload === "object" ? { kind: String(payload.kind ?? ""), id: String(payload.id ?? ""), systemId: typeof payload.systemId === "string" ? payload.systemId : null } : {}),
  brainSettings: () => ipcRenderer.invoke("brain:settings"),
  brainSettingsSave: (payload) => ipcRenderer.invoke("brain:settings-save", payload && typeof payload === "object" ? {
    ...(typeof payload.deskTool === "boolean" ? { deskTool: payload.deskTool } : {}),
    ...(typeof payload.nestedDelegation === "boolean" ? { nestedDelegation: payload.nestedDelegation } : {}),
    ...(typeof payload.headDrafts === "boolean" ? { headDrafts: payload.headDrafts } : {}),
    ...(payload.seats && typeof payload.seats === "object" ? { seats: Object.fromEntries(["lead", "desk", "companion", "scout", "overseer"].filter((seat) => payload.seats[seat]).map((seat) => [seat, {
      ...(typeof payload.seats[seat].model === "string" ? { model: payload.seats[seat].model } : {}),
      ...(typeof payload.seats[seat].effort === "string" ? { effort: payload.seats[seat].effort } : {}),
      ...(typeof payload.seats[seat].fast === "boolean" ? { fast: payload.seats[seat].fast } : {}),
      ...(typeof payload.seats[seat].provider === "string" ? { provider: payload.seats[seat].provider } : {}),
    }])) } : {}),
  } : {}),
  companionState: () => ipcRenderer.invoke("companion:state"),
  companionWelcome: () => ipcRenderer.invoke("companion:welcome"),
  companionSeen: (reason) => ipcRenderer.invoke("companion:seen", { reason: String(reason ?? "active").slice(0, 40) }),
  companionPrefs: (prefs) => ipcRenderer.invoke("companion:prefs", prefs && typeof prefs === "object" ? { ...(typeof prefs.look === "string" ? { look: prefs.look } : {}), ...(typeof prefs.scope === "string" ? { scope: prefs.scope } : {}), ...Object.fromEntries(["roaming", "pinned", "bubbles", "growth"].filter((key) => typeof prefs[key] === "boolean").map((key) => [key, prefs[key]])), ...(prefs.anchor && typeof prefs.anchor === "object" ? { anchor: { x: prefs.anchor.x, y: prefs.anchor.y } } : {}) } : {}),
  onBrainEvent: (callback) => ipcRenderer.on("brain:event", (_event, payload) => callback(payload)),
  onBrainUpdate: (callback) => ipcRenderer.on("brain:update", (_event, payload) => callback(payload)),
  onCompanionWelcome: (callback) => ipcRenderer.on("companion:welcome", (_event, payload) => callback(payload)),
};

// The context bridge deep-copies every value that crosses into the page, so
// one ipcRenderer listener per on* subscriber copied each push once per
// subscriber (eyes:tasks, the whole board, has seven or more). installBridge
// runs in the page's own world: each on* channel gets one preload listener on
// first use and hands the same copy to every subscriber in order, and a
// subscriber that throws is reported without starving the ones after it.
// Subscribers share that copy, so none may edit it in place.
//
// eyes:assistant also leaves out the state keys this page already holds
// (scripts/assistant-push.cjs): `same` names each with the rev it came in,
// and the kept copy goes back in, so subscribers still see a whole state. A
// kept copy from another rev (a push the page never got) stands in once
// while the host is asked for whole keys again; with nothing kept at all the
// push is dropped, and the next one is whole.
function installBridge(api, host) {
  const channels = new Map();
  const kept = new Map(); // eyes:assistant state key -> { rev, value }
  const deliver = (subscribers, value) => {
    for (const subscriber of subscribers.slice()) {
      try {
        subscriber(value);
      } catch (error) {
        globalThis.reportError(error);
      }
    }
  };
  const mergeAssistant = (payload) => {
    if (!payload?.state || typeof payload.state !== "object") return payload;
    const { rev, same, ...push } = payload;
    if (!same) kept.clear();
    const state = { ...payload.state };
    let resync = false;
    let complete = true;
    for (const [key, sentIn] of Object.entries(same ?? {})) {
      const copy = kept.get(key);
      if (!copy) {
        complete = false;
        continue;
      }
      if (copy.rev !== sentIn) resync = true;
      state[key] = copy.value;
    }
    for (const [key, value] of Object.entries(payload.state)) kept.set(key, { rev, value });
    if (resync || !complete) host.assistantSync();
    return complete ? { ...push, state } : null;
  };
  const bridge = { ...api };
  for (const name of Object.keys(api)) {
    if (!/^on[A-Z]/.test(name)) continue;
    bridge[name] = (callback) => {
      if (typeof callback !== "function") return;
      let subscribers = channels.get(name);
      if (!subscribers) {
        subscribers = [];
        channels.set(name, subscribers);
        if (name === "onAssistant") {
          api.onAssistant((payload) => {
            const merged = mergeAssistant(payload);
            if (merged) deliver(subscribers, merged);
          });
          host.assistantSync();
        } else {
          api[name]((value) => deliver(subscribers, value));
        }
      }
      subscribers.push(callback);
    };
  }
  Object.defineProperty(globalThis, "mefiStudio", { value: Object.freeze(bridge), enumerable: true });
}

contextBridge.executeInMainWorld({
  func: installBridge,
  args: [api, { assistantSync: () => ipcRenderer.send("eyes:assistant-sync") }],
});
