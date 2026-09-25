// One vocabulary for every task badge in the renderer. The board, Your work,
// Plans and Command all pass a scheduler stage (backlog.taskStates[].stage) or
// a raw task.status through label(), so one state reads the same everywhere.
// Loaded before every other renderer module; touches neither DOM nor store.
(() => {
  "use strict";
  const LABELS = {
    open: "Open", ready: "Ready", queued: "Ready",
    approval: "Awaiting approval",
    waiting: "Waiting",
    running: "Working", active: "Working",
    review: "Verifying", verifying: "Verifying", awaiting_verification: "Verifying",
    blocked: "Needs attention",
    grouped: "In a plan", absorbed: "In a plan",
    // An inbox request a board card already carries (backlog.summarizeBacklog).
    represented: "On the board",
    cooling: "Retry scheduled",
    planning: "Planning",
    done: "Done", completed: "Done", archived: "Archived",
    unknown: "Unknown",
  };
  // options.short drops the verification qualifier for narrow tags.
  function label(stage, task, options = {}) {
    const key = String(stage ?? task?.status ?? "open").toLowerCase();
    const finished = key === "done" || key === "completed" || key === "archived";
    if (finished && task?.status === "archived") return LABELS.archived;
    if (key === "done" || key === "completed") {
      if (options.short) return LABELS.done;
      const state = task?.verification?.state;
      if (state === "verified") return "Done · Verified";
      if (state === "manual") return "Done · Confirmed by you";
      return LABELS.done;
    }
    return LABELS[key] ?? key.replace(/_/g, " ");
  }
  window.MefiStage = Object.freeze({ label });
})();
