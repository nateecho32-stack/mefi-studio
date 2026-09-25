// Mefi's Studio AI+ — what one eyes:assistant push carries (main.cjs assistantEmit).
//
// A push is the whole assistant state (300–450 KB on a busy board), up to four
// times a second, and most of it — the chat, the log, the questions, the
// overseer — matches the push before. Once the page's bridge says it is
// listening (preload.cjs installBridge sends eyes:assistant-sync on its first
// onAssistant), each object-valued key whose JSON matches what this page last
// got rides as `same[key] = <rev it came in>` instead of its value, and the
// bridge puts its kept copy back, so every listener still sees a whole state.
// Keys are compared by content, not by length or last entry: questions and
// work rows change status in place, in the middle of their lists.
//
// Until the first sync a push carries every key; a sync, and the first push
// after a project switch, start over from whole keys.

function createAssistantPush({ start = Date.now() } = {}) {
  let rev = start;
  let listening = false;
  let projectId;
  const sent = new Map(); // key -> { json, rev }: what the page holds

  function payload(state, event) {
    rev += 1;
    if (!listening || !state || typeof state !== "object") return { state, event };
    if (state.projectId !== projectId) {
      sent.clear();
      projectId = state.projectId;
    }
    const slim = {};
    const same = {};
    for (const key of Object.keys(state)) {
      const value = state[key];
      if (!value || typeof value !== "object") {
        slim[key] = value;
        continue;
      }
      let json = null;
      try {
        json = JSON.stringify(value);
      } catch {}
      const last = sent.get(key);
      if (json !== null && last?.json === json) {
        same[key] = last.rev;
        continue;
      }
      slim[key] = value;
      if (json === null) sent.delete(key);
      else sent.set(key, { json, rev });
    }
    return { state: slim, event, rev, same };
  }

  // The page's bridge is listening and holds nothing yet: the next push
  // carries every key.
  function resync() {
    listening = true;
    sent.clear();
  }

  return { payload, resync };
}

module.exports = { createAssistantPush };
