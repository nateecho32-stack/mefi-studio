// Mefi's Studio AI+ — preload bridge (CJS; Electron's safe preload format).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const api = {
  mediaSceneSample: (rect) => ipcRenderer.invoke("media:scene-sample", rect),
  youtubeSearch: (query) => ipcRenderer.invoke("media:youtube-search", query),
  mediaClipboardLink: () => ipcRenderer.invoke("media:clipboard-link"),
  mediaBrowserOpen: (url = "") => ipcRenderer.invoke("media-browser:open", url),
  mediaBrowserCommand: (payload) => ipcRenderer.invoke("media-browser:command", payload),
  onMediaBrowserState: (callback) => ipcRenderer.on("media-browser:state", (_event, state) => callback(state)),
  onMediaBrowserFocus: (callback) => ipcRenderer.on("media-browser:focus-address", () => callback()),
  performanceControl: (payload) => ipcRenderer.invoke("performance:control", payload ?? {}),
  performanceSnapshot: () => ipcRenderer.invoke("performance:snapshot"),
  projectsList: () => ipcRenderer.invoke("projects:list"),
  projectsAdd: () => ipcRenderer.invoke("projects:add"),
  projectsAddPath: (folder) => ipcRenderer.invoke("projects:add-path", { path: folder }),
  // Vibe's New app: an empty folder with git, opened as the project (main.cjs projects:create).
  projectsCreate: (payload) => ipcRenderer.invoke("projects:create", payload ?? {}),
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
  cliSetupStatus: () => ipcRenderer.invoke("setup:cli-status"),
  cliSetupAction: (payload) => ipcRenderer.invoke("setup:cli-action", payload),
  cliSetupCheck: (id) => ipcRenderer.invoke("setup:cli-check", id),
  cliSetupUse: (id) => ipcRenderer.invoke("setup:cli-use", id),
  // A guided setup window closed and PATH was re-read (main.cjs guidedCliSetup).
  onCliSetupClosed: (callback) => ipcRenderer.on("setup:cli-closed", (_event, data) => callback(data)),
  // Several Claude Code / Codex logins (main.cjs "Several logins per coding
  // CLI"): logins are named by id and a label only; main makes the folders.
  cliAccounts: () => ipcRenderer.invoke("accounts:list"),
  cliAccountAdd: (payload) => ipcRenderer.invoke("accounts:add", { provider: String(payload?.provider ?? ""), label: String(payload?.label ?? "").slice(0, 40) }),
  cliAccountLogin: (id) => ipcRenderer.invoke("accounts:login", { id: String(id ?? "") }),
  cliAccountCheck: (id) => ipcRenderer.invoke("accounts:check", { id: String(id ?? "") }),
  cliAccountRemove: (id) => ipcRenderer.invoke("accounts:remove", { id: String(id ?? "") }),
  onCliAccounts: (callback) => ipcRenderer.on("accounts:changed", (_event, data) => callback(data)),
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
  // Trace: Studio's logs as channels (main.cjs trace:channels / trace:read).
  traceChannels: () => ipcRenderer.invoke("trace:channels"),
  traceRead: (payload) => ipcRenderer.invoke("trace:read", payload ?? {}),
  // Configuration's interface scale (main.cjs ui:zoom).
  uiZoom: (payload) => ipcRenderer.invoke("ui:zoom", payload ?? {}),
  uiZoomGet: () => ipcRenderer.invoke("ui:zoom-get"),
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
  // Vibe's Build it: one card, or the owner's card split into steps (main.cjs vibeBuild).
  vibeBuild: (payload) => ipcRenderer.invoke("vibe:build", payload ?? {}),
  // Each step of a named sizing or exploration while Vibe waits (renderer/vibe-flow.js).
  onVibeProgress: (callback) => ipcRenderer.on("vibe:progress", (_event, payload) => callback(payload)),
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
  // Settings › Community › Connection details: no argument reads them; the
  // link app id and hub address (both public) save them.
  communitySetup: (values) => ipcRenderer.invoke("community:setup", values && typeof values === "object"
    ? { clientId: typeof values.clientId === "string" ? values.clientId.slice(0, 40) : "", hubUrl: typeof values.hubUrl === "string" ? values.hubUrl.slice(0, 300) : "" }
    : null),
  onCommunityEvent: (callback) => ipcRenderer.on("community:event", (_event, status) => callback(status)),
  // The Void Engine rooms hub (main.cjs "Rooms hub"): Listen together and the
  // now-playing share behind the bot's /nowplaying. Nothing connects until
  // hubConnect; tokens never cross this bridge.
  hubStatus: () => ipcRenderer.invoke("hub:status"),
  hubConnect: () => ipcRenderer.invoke("hub:connect"),
  hubDisconnect: () => ipcRenderer.invoke("hub:disconnect"),
  hubRooms: () => ipcRenderer.invoke("hub:rooms"),
  // `holder` is who holds the room ("rooms" or "together"): each lets go of
  // its own hold only.
  hubSubscribe: (roomId, on = true, holder = null) => ipcRenderer.invoke("hub:subscribe", { roomId: typeof roomId === "string" ? roomId : null, on: on !== false, holder: typeof holder === "string" ? holder : null }),
  hubListen: (payload) => ipcRenderer.invoke("hub:listen", payload && typeof payload === "object" ? {
    roomId: typeof payload.roomId === "string" ? payload.roomId : null, action: typeof payload.action === "string" ? payload.action : null,
    url: typeof payload.url === "string" ? payload.url : undefined, label: typeof payload.label === "string" ? payload.label : undefined,
    provider: typeof payload.provider === "string" ? payload.provider : undefined, positionMs: Number.isFinite(payload.positionMs) ? payload.positionMs : undefined,
  } : null),
  hubNowPlaying: (track) => ipcRenderer.invoke("hub:now-playing", { track: track && typeof track === "object" ? { label: String(track.label ?? ""), provider: String(track.provider ?? ""), ...(typeof track.url === "string" ? { url: track.url } : {}) } : null }),
  onHubEvent: (callback) => ipcRenderer.on("hub:event", (_event, payload) => callback(payload)),
  // Friends › Rooms (main.cjs HUB_ROOM_METHODS): a method name and plain
  // arguments (strings, numbers, booleans, one flat object); main allows only
  // the listed methods and the hub client checks every argument.
  hubRoom: (method, ...args) => ipcRenderer.invoke("hub:room", {
    method: typeof method === "string" ? method : "",
    args: args.slice(0, 3).map((value) => (value == null || ["string", "number", "boolean"].includes(typeof value) ? value
      : typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, item]) => ["string", "number", "boolean"].includes(typeof item)).slice(0, 8)) : null)),
  }),
  // Companion friends (main.cjs "Companion friends"): what friends' companions
  // may see, the friends out now and playdates. Only named fields cross.
  hubFriends: (profile) => ipcRenderer.invoke("hub:friends", { ...(typeof profile?.name === "string" ? { name: profile.name.slice(0, 40) } : {}) }),
  hubSharingSet: (change) => ipcRenderer.invoke("hub:sharing-set", change && typeof change === "object" ? {
    ...(typeof change.everyone === "string" ? { everyone: change.everyone } : {}),
    ...(change.hold === null || typeof change.hold === "string" ? { hold: change.hold } : {}),
    ...(change.rule && typeof change.rule === "object" ? { rule: { scope: String(change.rule.scope ?? ""), target: change.rule.target == null ? null : String(change.rule.target), level: change.rule.level == null ? null : String(change.rule.level), label: String(change.rule.label ?? "").slice(0, 80) } } : {}),
    ...(change.duration === "session" || change.duration === "always" ? { duration: change.duration } : {}),
    ...(typeof change.dismiss === "string" ? { dismiss: change.dismiss } : {}),
    ...(typeof change.name === "string" ? { name: change.name.slice(0, 40) } : {}),
  } : {}),
  hubPlaydate: (target) => ipcRenderer.invoke("hub:playdate", target && typeof target === "object" ? { practice: target.practice === true, music: target.music === true, roomId: typeof target.roomId === "string" ? target.roomId : null, userId: typeof target.userId === "string" ? target.userId : null } : {}),
  // Friends › Your PCs (main.cjs "Multi-PC sync"): the open project against
  // its default branch on GitHub. Main picks the folder; the renderer can only
  // ask for a rebase onto GitHub's commits. onSyncEvent carries every answer,
  // including the background look behind the Friends badge.
  syncStatus: () => ipcRenderer.invoke("sync:status"),
  syncRun: (options) => ipcRenderer.invoke("sync:run", { rebase: options?.rebase === true }),
  // "Keep this PC up to date": no argument reads it, true or false sets it.
  syncFollow: (on) => ipcRenderer.invoke("sync:follow", typeof on === "boolean" ? { on } : {}),
  // Cowork claims: the open project's room for live file claims (a room id,
  // or null to stop), and what is claimed there.
  coworkStatus: () => ipcRenderer.invoke("cowork:status"),
  coworkLink: (roomId) => ipcRenderer.invoke("cowork:link", { roomId: roomId === null ? null : typeof roomId === "string" ? roomId.slice(0, 64) : "" }),
  onSyncEvent: (callback) => ipcRenderer.on("sync:event", (_event, result) => callback(result)),
  // Friends › Your PCs › Set up this PC (scripts/pc-setup.cjs): the renderer
  // names an action or a repository from the account's own list, never a
  // command, a URL or a folder.
  pcSetupStatus: () => ipcRenderer.invoke("pc-setup:status"),
  pcSetupAction: (action) => ipcRenderer.invoke("pc-setup:action", { action: typeof action === "string" ? action : "" }),
  pcSetupRepos: () => ipcRenderer.invoke("pc-setup:repos"),
  pcSetupClone: (repo) => ipcRenderer.invoke("pc-setup:clone", { repo: typeof repo === "string" ? repo : "" }),
  // Friends › Your PCs › Share between my PCs (main.cjs "Your PCs vault"):
  // shelves and item ids by name, a pairing code the owner typed, and for
  // keys only names and the typed confirmation. Key values never come back.
  vaultStatus: () => ipcRenderer.invoke("vault:status"),
  vaultCreate: () => ipcRenderer.invoke("vault:create"),
  vaultPair: (code) => ipcRenderer.invoke("vault:pair", { code: typeof code === "string" ? code.slice(0, 120) : "" }),
  vaultCode: () => ipcRenderer.invoke("vault:code"),
  vaultUnpair: () => ipcRenderer.invoke("vault:unpair"),
  vaultOffer: (shelf) => ipcRenderer.invoke("vault:offer", { shelf: typeof shelf === "string" ? shelf : "" }),
  vaultPublish: (shelf, ids) => ipcRenderer.invoke("vault:publish", { shelf: typeof shelf === "string" ? shelf : "", ids: Array.isArray(ids) ? ids.filter((id) => typeof id === "string").slice(0, 500) : [] }),
  vaultRead: (shelf) => ipcRenderer.invoke("vault:read", { shelf: typeof shelf === "string" ? shelf : "" }),
  vaultUse: (shelf, id, from) => ipcRenderer.invoke("vault:use", { shelf: String(shelf ?? ""), id: String(id ?? ""), from: String(from ?? "") }),
  vaultLibrary: () => ipcRenderer.invoke("vault:library"),
  vaultLibraryUse: (shelf, id, from) => ipcRenderer.invoke("vault:library-use", { shelf: String(shelf ?? ""), id: String(id ?? ""), from: from == null ? null : String(from) }),
  vaultForget: (shelf, id, from) => ipcRenderer.invoke("vault:forget", { shelf: String(shelf ?? ""), id: String(id ?? ""), from: from == null ? null : String(from) }),
  vaultKeys: (action, options) => ipcRenderer.invoke("vault:keys", {
    action: typeof action === "string" ? action : "",
    names: Array.isArray(options?.names) ? options.names.filter((name) => typeof name === "string").slice(0, 20) : [],
    ...(typeof options?.confirmation === "string" ? { confirmation: options.confirmation.slice(0, 80) } : {}),
  }),
  sharePreview: (shelf, id) => ipcRenderer.invoke("share:preview", { shelf: String(shelf ?? ""), id: String(id ?? "") }),
  shareExport: (shelf, id) => ipcRenderer.invoke("share:export", { shelf: String(shelf ?? ""), id: String(id ?? "") }),
  shareOpen: () => ipcRenderer.invoke("share:open"),
  shareKeep: (token) => ipcRenderer.invoke("share:keep", { token: typeof token === "string" ? token : "" }),
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
    ...(typeof payload.deskResolves === "boolean" ? { deskResolves: payload.deskResolves } : {}),
    ...(payload.seats && typeof payload.seats === "object" ? { seats: Object.fromEntries(["lead", "desk", "companion", "scout", "overseer"].filter((seat) => payload.seats[seat]).map((seat) => [seat, {
      ...(typeof payload.seats[seat].model === "string" ? { model: payload.seats[seat].model } : {}),
      ...(typeof payload.seats[seat].effort === "string" ? { effort: payload.seats[seat].effort } : {}),
      ...(typeof payload.seats[seat].fast === "boolean" ? { fast: payload.seats[seat].fast } : {}),
      ...(typeof payload.seats[seat].provider === "string" ? { provider: payload.seats[seat].provider } : {}),
    }])) } : {}),
  } : {}),
  learningState: () => ipcRenderer.invoke("learning:state"),
  learningSet: (payload) => ipcRenderer.invoke("learning:set", payload),
  learningForget: (payload) => ipcRenderer.invoke("learning:forget", payload),
  autonomyState: () => ipcRenderer.invoke("autonomy:state"),
  autonomySet: (payload) => ipcRenderer.invoke("autonomy:set", payload ?? {}),
  autonomyUndo: (payload) => ipcRenderer.invoke("autonomy:undo", payload ?? {}),
  autonomyTodo: (payload) => ipcRenderer.invoke("autonomy:todo", payload ?? {}),
  companionState: () => ipcRenderer.invoke("companion:state"),
  companionWelcome: () => ipcRenderer.invoke("companion:welcome"),
  companionClear: () => ipcRenderer.invoke("companion:clear"),
  companionSeen: (reason) => ipcRenderer.invoke("companion:seen", { reason: String(reason ?? "active").slice(0, 40) }),
  companionPrefs: (prefs) => ipcRenderer.invoke("companion:prefs", prefs && typeof prefs === "object" ? { ...(typeof prefs.look === "string" ? { look: prefs.look } : {}), ...(typeof prefs.scope === "string" ? { scope: prefs.scope } : {}), ...(typeof prefs.personality === "string" ? { personality: prefs.personality } : {}), ...Object.fromEntries(["roaming", "pinned", "bubbles", "growth", "expressions", "antics"].filter((key) => typeof prefs[key] === "boolean").map((key) => [key, prefs[key]])), ...(prefs.anchor && typeof prefs.anchor === "object" ? { anchor: { x: prefs.anchor.x, y: prefs.anchor.y } } : {}) } : {}),
  companionBond: (event) => ipcRenderer.invoke("companion:bond", { event: event === "pet" || event === "playdate" ? event : null }),
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
