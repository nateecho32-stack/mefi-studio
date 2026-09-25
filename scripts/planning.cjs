"use strict";

// Decision planning stays separate from executable board work. Only the host
// converts an explicitly approved specification, after saving its board tasks.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { taskRow } = require("./work-admission.cjs");

const FORMAT_VERSION = 1;
const QUESTION_TYPES = ["discussion", "research", "prototype", "prerequisite"];
// Who a line of the interview came from. A human "answer" states a requirement;
// everything the assistant writes stays a proposal until the human resolves the
// question. Kinds are scoped by author so a model reply can never be filed as
// something the human said. Notes saved before kinds existed read as "note".
const NOTE_KINDS = Object.freeze({ user: ["note", "answer"], assistant: ["question", "interpretation", "advice", "conflict"] });
// `plans` caps the plans in play; archived plans stay on file up to `stored`.
const LIMITS = Object.freeze({ plans: 300, stored: 1000, title: 180, destination: 16000, outOfScope: 12000, unknowns: 80, questions: 80, question: 4000, resolution: 16000, evidence: 16000, spec: 60000, tasks: 40, prompt: 16000, acceptance: 4000, notes: 200, note: 16000 });
const lockKey = Symbol.for("mefi-studio.planning-store-locks");
const locks = globalThis[lockKey] ??= new Map();
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (message) => { throw new Error(message); };

function string(value, name, max, { optional = false } = {}) {
  if (value == null && optional) return "";
  if (typeof value !== "string") fail(`${name} must be text.`);
  if (value.length > max) fail(`${name} must be ${max} characters or fewer.`);
  if (/\u0000/.test(value)) fail(`${name} contains an unsupported character.`);
  const result = value.trim();
  if (!optional && !result) fail(`${name} is required.`);
  return result;
}

function identifier(value, name = "ID") {
  const result = string(value, name, 160);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) fail(`${name} contains unsupported characters.`);
  return result;
}

function array(value, name, max) {
  if (!Array.isArray(value) || value.length > max) fail(`${name} must contain at most ${max} entries.`);
  return value;
}

function dependencies(value) {
  const result = array(value ?? [], "Prerequisites", LIMITS.questions).map((id) => identifier(id, "Prerequisite ID"));
  if (new Set(result).size !== result.length) fail("A prerequisite can only be listed once.");
  return result;
}

function assertDag(rows, label) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== rows.length) fail(`${label} IDs must be unique.`);
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(`${label} prerequisites contain a cycle.`);
    if (visited.has(id)) return;
    const row = byId.get(id);
    if (!row) fail(`${label} prerequisite ${id} is missing.`);
    visiting.add(id);
    for (const dependency of row.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}

function acceptanceCriteria(value) {
  const values = typeof value === "string" ? [value] : value;
  const result = array(values, "Acceptance criteria", 30).map((item) => string(item, "Acceptance criterion", LIMITS.acceptance));
  if (!result.length) fail("Each implementation task needs acceptance criteria.");
  return result;
}

function normalizeTasks(value) {
  const result = array(value, "Implementation tasks", LIMITS.tasks).map((task) => {
    if (!object(task)) fail("Each implementation task must be an object.");
    return { id: identifier(task.id, "Draft task ID"), title: string(task.title, "Task title", LIMITS.title), prompt: string(task.prompt, "Task brief", LIMITS.prompt), acceptance: acceptanceCriteria(task.acceptance), dependsOn: dependencies(task.dependsOn) };
  });
  if (!result.length) fail("A specification needs at least one implementation task.");
  assertDag(result, "Implementation task");
  return result;
}

function settled(plan) {
  string(plan.destination, "Destination", LIMITS.destination);
  if (plan.unknowns.length) fail("Turn each unknown into a question or explicitly set it aside before drafting the specification.");
  if (plan.questions.some((question) => question.status !== "resolved")) fail("Resolve every planning question before drafting or approving the specification.");
}

// The interview's own gate: the human has read back what the plan now says the
// feature is. Any later change to the destination, unknowns or decisions clears
// it, so a specification is never drafted from an understanding nobody reviewed.
// Deliberately absent from approved()/validatePlan(): plans saved before this
// gate existed stay readable, and only new mutations have to pass it.
function reviewed(plan) {
  if (!Number.isFinite(plan.reviewedAt)) fail("Review what this plan now says the feature is, and confirm it, before drafting or approving a specification.");
}

function approved(plan) {
  settled(plan);
  if (!plan.spec || plan.spec.stale || !Number.isFinite(plan.spec.approvedAt)) fail("Review and approve the current specification before creating implementation tasks.");
  normalizeTasks(plan.spec.tasks);
}

function time(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} is invalid.`);
}

function validatePlan(plan, projectId, { history = true } = {}) {
  if (!object(plan) || plan.projectId !== projectId) fail("Planning data belongs to a different project.");
  identifier(plan.id, "Plan ID");
  string(plan.title, "Plan title", LIMITS.title);
  string(plan.destination, "Destination", LIMITS.destination);
  string(plan.outOfScope, "Out of scope", LIMITS.outOfScope, { optional: true });
  if (!Number.isSafeInteger(plan.version) || plan.version < 1) fail("Plan version is invalid.");
  time(plan.createdAt, "Plan creation time"); time(plan.updatedAt, "Plan update time");
  if (plan.reviewedAt != null) time(plan.reviewedAt, "Understanding review time");
  if (plan.archivedAt != null) time(plan.archivedAt, "Archive time");
  if (plan.archivedAt != null && plan.status === "converting") fail("A plan still creating its tasks cannot be archived.");
  if (!["planning", "ready", "converting", "converted"].includes(plan.status)) fail("Plan status is invalid.");
  const unknowns = array(plan.unknowns, "Unknowns", LIMITS.unknowns);
  for (const unknown of unknowns) { identifier(unknown?.id, "Unknown ID"); string(unknown?.text, "Unknown", LIMITS.question); }
  if (new Set(unknowns.map((entry) => entry.id)).size !== unknowns.length) fail("Unknown IDs must be unique.");
  const questions = array(plan.questions, "Planning questions", LIMITS.questions);
  for (const question of questions) {
    identifier(question?.id, "Question ID"); string(question?.question, "Question", LIMITS.question);
    if (!QUESTION_TYPES.includes(question.type) || !["open", "resolved"].includes(question.status)) fail("Question type or status is invalid.");
    dependencies(question.dependsOn);
    string(question.resolution, "Resolution", LIMITS.resolution, { optional: question.status === "open" });
    string(question.evidence, "Evidence", LIMITS.evidence, { optional: true });
    if (question.status === "resolved" && question.resolvedBy !== "user") fail("Planning decisions require explicit human confirmation.");
    if (question.status === "resolved") time(question.resolvedAt, "Decision time");
    if (question.status === "open" && (question.resolution || question.resolvedBy || question.resolvedAt != null)) fail("An open question cannot retain an active resolution.");
    for (const note of array(question.notes, "Question notes", LIMITS.notes)) {
      identifier(note?.id, "Note ID"); time(note?.at, "Note time");
      if (!["user", "assistant"].includes(note.author)) fail("Note author is invalid.");
      if (note.kind != null && !NOTE_KINDS[note.author].includes(note.kind)) fail("Note kind does not belong to its author.");
      string(note.text, "Note", LIMITS.note);
    }
  }
  assertDag(questions, "Question");
  const byId = new Map(questions.map((question) => [question.id, question]));
  for (const question of questions) if (question.status === "resolved" && question.dependsOn.some((id) => byId.get(id).status !== "resolved")) fail("A resolved question has an unresolved prerequisite.");
  if (plan.spec !== null) {
    if (!object(plan.spec)) fail("Specification is invalid.");
    identifier(plan.spec.id, "Specification ID"); string(plan.spec.text, "Specification", LIMITS.spec);
    normalizeTasks(plan.spec.tasks);
    if (plan.spec.tasks.some((task) => !Array.isArray(task.acceptance) || !Array.isArray(task.dependsOn))) fail("Saved implementation tasks require explicit acceptance and prerequisite lists.");
    time(plan.spec.createdAt, "Specification time");
    if (typeof plan.spec.stale !== "boolean") fail("Specification freshness is invalid.");
    if (plan.spec.approvedAt != null) { time(plan.spec.approvedAt, "Approval time"); approved(plan); }
  }
  const taskIds = dependencies(plan.taskIds);
  if (plan.status === "ready") approved(plan);
  if (["converting", "converted"].includes(plan.status)) {
    approved(plan);
    if (!taskIds.length || JSON.stringify(taskIds) !== JSON.stringify(implementationIds(plan))) fail("Converted task IDs do not match the approved specification.");
  } else if (taskIds.length) fail("Only converting or converted plans can have implementation task IDs.");
  if (plan.spec?.approvedAt != null && plan.status === "planning") fail("An approved specification must be ready for implementation.");
  if (history) {
    if (!Array.isArray(plan.history) || !plan.history.length) fail("Planning history is missing.");
    let revision = 0;
    for (const entry of plan.history) {
      if (!object(entry) || entry.version !== revision + 1 || entry.version > plan.version) fail("Planning history revisions are invalid.");
      time(entry.at, "History time"); string(entry.action, "History action", 100);
      if (!object(entry.snapshot) || entry.snapshot.id !== plan.id || entry.snapshot.version !== entry.version) fail("Planning history snapshot is invalid.");
      validatePlan(entry.snapshot, projectId, { history: false });
      revision = entry.version;
    }
    if (revision !== plan.version) fail("Planning history does not cover the latest version.");
    if (JSON.stringify(plan.history.at(-1).snapshot) !== JSON.stringify(snapshot(plan))) fail("The current plan does not match its saved history.");
  }
  return plan;
}

function snapshot(plan) {
  const { history, ...body } = plan;
  return copy(body);
}

function record(plan, action, now, details = {}) {
  plan.history.push({ version: plan.version, at: now, action, ...copy(details), snapshot: snapshot(plan) });
}

function invalidate(plan) {
  plan.status = "planning";
  delete plan.reviewedAt;
  if (plan.spec) { plan.spec.stale = true; delete plan.spec.approvedAt; }
}

function reopenQuestions(plan, initialIds) {
  const affected = new Set(initialIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const question of plan.questions) if (!affected.has(question.id) && question.dependsOn.some((id) => affected.has(id))) { affected.add(question.id); expanded = true; }
  }
  for (const question of plan.questions) if (affected.has(question.id)) {
    question.status = "open"; question.resolution = ""; question.evidence = ""; question.resolvedBy = null; delete question.resolvedAt;
  }
  return [...affected];
}

// Read downstream by builders: a suggestion must never look like a requirement.
const NOTE_LABELS = Object.freeze({
  answer: "You answered", note: "You noted", question: "Mefi asked",
  interpretation: "Mefi read that back (unconfirmed)", advice: "Mefi suggested", conflict: "Mefi flagged a conflict",
});
const noteLabel = (note) => NOTE_LABELS[note.kind] || (note.author === "user" ? NOTE_LABELS.note : NOTE_LABELS.advice);

function implementationIds(plan) {
  return plan.spec.tasks.map((task) => `task_planning_${createHash("sha256").update(`${plan.id}\n${plan.spec.id}\n${task.id}`).digest("hex").slice(0, 24)}`);
}

// On failure neither the supplied array nor its plans change. Actor comes from
// the trusted caller, never from a renderer or model-controlled payload.
function applyPlanningAction(plans, payload, { project, now = Date.now(), actor = "user" } = {}) {
  try {
    if (!object(project) || !project.id) fail("A project is required for planning.");
    if (!object(payload) || typeof payload.action !== "string") fail("Choose a planning action.");
    if (!["user", "assistant", "host"].includes(actor)) fail("Planning actor is invalid.");
    const action = payload.action;
    if (actor === "assistant" && !["add-unknown", "add-question", "add-note", "draft-spec"].includes(action)) fail("The assistant can propose planning content; only you can confirm decisions and approve work.");
    if (["begin-conversion", "mark-converted"].includes(action) && actor !== "host") fail("Only the host can record implementation task creation.");
    if (["resolve", "approve-spec", "confirm-understanding"].includes(action) && actor !== "user") fail("This decision needs explicit human confirmation.");
    time(now, "Mutation time");
    if (!Array.isArray(plans)) fail("Planning data is invalid.");
    if (action === "create") {
      if (plans.filter((plan) => plan.archivedAt == null).length >= LIMITS.plans) fail(`This project already has ${LIMITS.plans} plans in play. Archive one you no longer need.`);
      if (plans.length >= LIMITS.stored) fail(`This project already keeps ${LIMITS.stored} plans, including archived ones.`);
      const plan = { id: `plan_${randomUUID()}`, projectId: project.id, title: string(payload.title, "Plan title", LIMITS.title), destination: string(payload.destination, "Destination", LIMITS.destination), outOfScope: string(payload.outOfScope, "Out of scope", LIMITS.outOfScope, { optional: true }), unknowns: [], questions: [], spec: null, status: "planning", version: 1, history: [], createdAt: now, updatedAt: now, taskIds: [] };
      record(plan, action, now); validatePlan(plan, project.id); plans.push(plan);
      return { ok: true, plan: copy(plan), plans: copy(plans) };
    }
    const index = plans.findIndex((plan) => plan.id === payload.planId && plan.projectId === project.id);
    if (index < 0) fail("Plan not found in this project.");
    const previous = plans[index];
    if (!Number.isSafeInteger(payload.version) || payload.version !== previous.version) fail("This plan changed. Refresh it before saving your changes.");
    // Archiving sets a plan aside without deleting it. An archived plan is
    // read-only until restored; one mid-way through creating tasks has to
    // finish first, so no approved work is left half-admitted.
    const shelving = action === "archive" || action === "restore";
    if (shelving) {
      if (actor !== "user") fail("Only you can archive or restore a plan.");
      if (action === "archive" && previous.archivedAt != null) fail("This plan is already archived.");
      if (action === "archive" && previous.status === "converting") fail("Finish creating this plan's tasks before archiving it.");
      if (action === "restore" && previous.archivedAt == null) fail("This plan is not archived.");
      if (action === "restore" && previous.status !== "converted" && plans.filter((plan) => plan.archivedAt == null).length >= LIMITS.plans) fail(`This project already has ${LIMITS.plans} plans in play. Archive one before restoring this plan.`);
    } else if (previous.archivedAt != null) fail("This plan is archived. Restore it before changing it.");
    if (previous.status === "converted" && !shelving) {
      if (action === "mark-converted" && JSON.stringify(payload.taskIds) === JSON.stringify(previous.taskIds)) return { ok: true, plan: copy(previous), plans: copy(plans), duplicate: true };
      fail("This plan has already created implementation tasks. Start another plan for new scope.");
    }
    if (previous.status === "converting" && !["begin-conversion", "mark-converted"].includes(action)) fail("Task creation has started. Retry creating tasks to finish this plan before starting new scope.");
    const plan = copy(previous), details = {};
    const question = () => plan.questions.find((item) => item.id === payload.questionId) || fail("Planning question not found.");
    switch (action) {
      case "update": {
        const title = own(payload, "title") ? string(payload.title, "Plan title", LIMITS.title) : plan.title;
        const destination = own(payload, "destination") ? string(payload.destination, "Destination", LIMITS.destination) : plan.destination;
        const outOfScope = own(payload, "outOfScope") ? string(payload.outOfScope, "Out of scope", LIMITS.outOfScope, { optional: true }) : plan.outOfScope;
        if (title === plan.title && destination === plan.destination && outOfScope === plan.outOfScope) return { ok: true, plan: copy(previous), plans: copy(plans) };
        // A rename changes no decision: the confirmed reading and an approved
        // specification stand. Only a changed scope reopens and withdraws them.
        const scoped = destination !== plan.destination || outOfScope !== plan.outOfScope;
        if (scoped) details.reopened = reopenQuestions(plan, plan.questions.map((item) => item.id));
        Object.assign(plan, { title, destination, outOfScope });
        if (scoped) invalidate(plan);
        break;
      }
      case "add-unknown": {
        if (plan.unknowns.length >= LIMITS.unknowns) fail(`A plan can have at most ${LIMITS.unknowns} unknowns.`);
        plan.unknowns.push({ id: `unknown_${randomUUID()}`, text: string(payload.text, "Unknown", LIMITS.question) }); invalidate(plan); break;
      }
      case "remove-unknown": {
        const unknownIndex = plan.unknowns.findIndex((item) => item.id === payload.unknownId);
        if (unknownIndex < 0) fail("Unknown not found.");
        details.reason = string(payload.reason, "Reason for setting this unknown aside", LIMITS.question);
        details.unknown = plan.unknowns.splice(unknownIndex, 1)[0]; invalidate(plan); break;
      }
      case "add-question": {
        if (plan.questions.length >= LIMITS.questions) fail(`A plan can have at most ${LIMITS.questions} questions.`);
        if (!QUESTION_TYPES.includes(payload.type)) fail("Choose discussion, research, prototype, or prerequisite.");
        const item = { id: `question_${randomUUID()}`, question: string(payload.question, "Question", LIMITS.question), type: payload.type, dependsOn: dependencies(payload.dependsOn), status: "open", resolution: "", evidence: "", resolvedBy: null, notes: [] };
        plan.questions.push(item); assertDag(plan.questions, "Question");
        if (payload.unknownId != null) {
          const unknownIndex = plan.unknowns.findIndex((unknown) => unknown.id === payload.unknownId);
          if (unknownIndex < 0) fail("The unknown has changed or was already turned into a question.");
          details.unknown = plan.unknowns.splice(unknownIndex, 1)[0]; details.questionId = item.id;
        }
        invalidate(plan); break;
      }
      case "edit-question": {
        const item = question();
        const next = { question: own(payload, "question") ? string(payload.question, "Question", LIMITS.question) : item.question, type: own(payload, "type") ? payload.type : item.type, dependsOn: own(payload, "dependsOn") ? dependencies(payload.dependsOn) : item.dependsOn };
        if (!QUESTION_TYPES.includes(next.type)) fail("Choose discussion, research, prototype, or prerequisite.");
        if (JSON.stringify(next) === JSON.stringify({ question: item.question, type: item.type, dependsOn: item.dependsOn })) return { ok: true, plan: copy(previous), plans: copy(plans) };
        Object.assign(item, next); assertDag(plan.questions, "Question"); details.reopened = reopenQuestions(plan, [item.id]); invalidate(plan); break;
      }
      case "resolve": {
        const item = question();
        if (item.status !== "open") fail("Reopen the question before changing its decision.");
        const blocked = item.dependsOn.filter((id) => plan.questions.find((candidate) => candidate.id === id)?.status !== "resolved");
        if (blocked.length) fail("Resolve this question's prerequisites first.");
        item.resolution = string(payload.resolution, "Decision", LIMITS.resolution);
        item.evidence = string(payload.evidence, "Evidence", LIMITS.evidence, { optional: true });
        item.status = "resolved"; item.resolvedBy = "user"; item.resolvedAt = now; invalidate(plan); break;
      }
      case "reopen": {
        const item = question();
        if (item.status !== "resolved") fail("This question is still open; there is no decision to reopen.");
        details.reopened = reopenQuestions(plan, [item.id]); invalidate(plan); break;
      }
      case "add-note": {
        const item = question();
        if (actor === "host") fail("Question notes must identify a user or assistant author.");
        if (item.notes.length >= LIMITS.notes) fail(`A question can have at most ${LIMITS.notes} notes.`);
        const kind = payload.kind ?? (actor === "user" ? "note" : "advice");
        if (!NOTE_KINDS[actor].includes(kind)) fail("A note can only carry a kind belonging to its own author.");
        item.notes.push({ id: `note_${randomUUID()}`, at: now, author: actor, kind, text: string(payload.text, "Note", LIMITS.note) }); break;
      }
      case "confirm-understanding": {
        settled(plan);
        plan.reviewedAt = now; break;
      }
      case "draft-spec": {
        settled(plan); reviewed(plan);
        const text = string(payload.text, "Specification", LIMITS.spec), tasks = normalizeTasks(payload.tasks);
        // Saving the current wording again is not a revision: it keeps the
        // draft, its task IDs and any approval you already gave it.
        if (plan.spec && !plan.spec.stale && plan.spec.text === text && JSON.stringify(plan.spec.tasks) === JSON.stringify(tasks)) return { ok: true, plan: copy(previous), plans: copy(plans) };
        plan.spec = { id: `spec_${randomUUID()}`, text, tasks, stale: false, createdAt: now };
        plan.status = "planning"; break;
      }
      case "approve-spec": {
        settled(plan); reviewed(plan);
        if (!plan.spec || plan.spec.stale) fail("Draft a specification from the current decisions before approving it.");
        plan.spec.approvedAt = now; plan.status = "ready"; break;
      }
      case "begin-conversion": {
        approved(plan);
        if (plan.status === "converting") return { ok: true, plan: copy(previous), plans: copy(plans), duplicate: true };
        if (plan.status !== "ready") fail("Approve the specification before creating implementation tasks.");
        plan.status = "converting"; plan.taskIds = implementationIds(plan); plan.conversionStartedAt = now; break;
      }
      case "mark-converted": {
        approved(plan);
        if (plan.status !== "converting") fail("Begin implementation task creation before marking the plan converted.");
        const taskIds = dependencies(payload.taskIds);
        if (JSON.stringify(taskIds) !== JSON.stringify(implementationIds(plan))) fail("Implementation task IDs must match this approved specification.");
        plan.status = "converted"; plan.taskIds = taskIds; plan.convertedAt = now; break;
      }
      case "archive": plan.archivedAt = now; break;
      case "restore": delete plan.archivedAt; break;
      default: fail("Unknown planning action.");
    }
    plan.version += 1; plan.updatedAt = now; record(plan, action, now, details); validatePlan(plan, project.id); plans[index] = plan;
    return { ok: true, plan: copy(plan), plans: copy(plans) };
  } catch (error) { return { ok: false, error: error.message, plans: copy(plans) }; }
}

function buildImplementationTasks(plan, { project, now = Date.now() } = {}) {
  if (!object(project) || plan?.projectId !== project.id) fail("Plan belongs to a different project.");
  validatePlan(plan, project.id); approved(plan); time(now, "Task creation time");
  const ids = implementationIds(plan), idMap = new Map(plan.spec.tasks.map((task, index) => [task.id, ids[index]]));
  const decisions = plan.questions.map((question, index) => `${index + 1}. ${question.question}\nType: ${question.type}\nDecision confirmed by you: ${question.resolution}${question.evidence ? `\nEvidence: ${question.evidence}` : ""}${question.notes.length ? `\nInterview record (context, not additional decisions):\n${question.notes.map((note) => `${noteLabel(note)}: ${note.text}`).join("\n")}` : ""}`).join("\n\n");
  const breakdown = plan.spec.tasks.map((task) => `${task.id}: ${task.title}\n${task.prompt}\nAcceptance criteria:\n${task.acceptance.map((criterion) => `- ${criterion}`).join("\n")}${task.dependsOn.length ? `\nPrerequisites: ${task.dependsOn.join(", ")}` : ""}`).join("\n\n");
  // The admission module's card skeleton. The owner approved this plan, so its
  // tasks are the owner's work and rank with it (origin), whatever their source.
  return plan.spec.tasks.map((task, index) => taskRow({
    id: ids[index], title: task.title, projectId: project.id, projectPath: project.path, projectName: project.name,
    prompt: `YOUR TASK: ${task.title}\n${task.prompt}\n\nAcceptance criteria for this task\n${task.acceptance.map((criterion) => `- ${criterion}`).join("\n")}\n\nImplement this task within the approved scope, use prerequisite outputs, and verify its acceptance criteria. Preserve the other tasks for their assigned work.\n\nImplementation task from approved plan: ${plan.title}\nPlanning ID: ${plan.id}\n\nDestination\n${plan.destination}\n\nOut of scope\n${plan.outOfScope || "None recorded."}\n\nConfirmed planning decisions\n${decisions || "No additional decisions were needed."}\n\nApproved specification\n${plan.spec.text}\n\nImplementation breakdown (context for this task)\n${breakdown}`,
    acceptance: copy(task.acceptance), dependsOn: task.dependsOn.map((id) => idMap.get(id)), source: "planning", planningId: plan.id, planningSpecId: plan.spec.id, planningTaskId: task.id,
    createdAt: now,
  }, { now, log: `Created from approved plan: ${plan.title}`, origin: { kind: "planning", by: "owner" } }));
}

function createPlanningStore({ filePath, project, now = Date.now } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) fail("A planning file path is required.");
  if (!object(project) || !project.id) fail("A project is required for planning.");
  const capturedProject = copy(project), file = path.resolve(filePath);
  const key = process.platform === "win32" ? file.toLowerCase() : file;
  function serialized(run) {
    const result = (locks.get(key) ?? Promise.resolve()).then(run);
    const settled = result.then(() => {}, () => {});
    locks.set(key, settled);
    settled.then(() => { if (locks.get(key) === settled) locks.delete(key); });
    return result;
  }
  function validate(plans) {
    array(plans, "Project plans", LIMITS.stored);
    if (new Set(plans.map((plan) => plan?.id)).size !== plans.length) fail("Plan IDs must be unique.");
    for (const plan of plans) validatePlan(plan, capturedProject.id);
  }
  async function load() {
    let state;
    try { state = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw new Error("Could not read planning data; the existing file was preserved.", { cause: error }); }
    try {
      if (!object(state) || state.version !== FORMAT_VERSION || state.projectId !== capturedProject.id) fail("Planning format or project is invalid.");
      validate(state.plans); return state.plans;
    } catch (error) { throw new Error(`Invalid planning data; the existing file was preserved. ${error.message}`, { cause: error }); }
  }
  async function save(plans) {
    validate(plans);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify({ version: FORMAT_VERSION, projectId: capturedProject.id, plans })}\n`); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  const transaction = (callback) => serialized(async () => {
    if (typeof callback !== "function") fail("A planning transaction callback is required.");
    const current = await load(), plans = copy(current), before = JSON.stringify(current);
    const result = await callback(plans);
    if (result?.ok !== false && JSON.stringify(plans) !== before) await save(plans);
    return copy(result);
  });
  return {
    list: () => serialized(load),
    transaction,
    mutate: async (payload, { actor = "user" } = {}) => {
      try { return await transaction((plans) => applyPlanningAction(plans, payload, { project: capturedProject, now: now(), actor })); }
      catch (error) { return { ok: false, error: error.message, plans: [] }; }
    },
  };
}

module.exports = { FORMAT_VERSION, QUESTION_TYPES, NOTE_KINDS, NOTE_LABELS, LIMITS, applyPlanningAction, buildImplementationTasks, createPlanningStore };
