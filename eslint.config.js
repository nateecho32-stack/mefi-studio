// Check-only lint: undefined identifiers are errors, unused ones are warnings.
// No style rules; formatting is left to .editorconfig and the author.
// Run with `npm run lint` (fetches eslint 9 through npx; nothing is added to
// package.json, the app has no runtime dependencies and keeps it that way).
// CI runs the same command. Renderer files are classic scripts that share
// `window.Mefi*` namespaces, so they get browser globals; Node files get the
// Node globals; tests get both, because they eval renderer slices in sandboxes.

const shared = {
  console: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
  queueMicrotask: "readonly", structuredClone: "readonly", globalThis: "readonly", crypto: "readonly", performance: "readonly",
  URL: "readonly", URLSearchParams: "readonly", fetch: "readonly", Request: "readonly", Response: "readonly", Headers: "readonly",
  FormData: "readonly", Blob: "readonly", File: "readonly", AbortController: "readonly", AbortSignal: "readonly",
  TextEncoder: "readonly", TextDecoder: "readonly", WebSocket: "readonly", Intl: "readonly", atob: "readonly", btoa: "readonly",
  MessageChannel: "readonly", MessagePort: "readonly", BroadcastChannel: "readonly", Event: "readonly", EventTarget: "readonly",
  CustomEvent: "readonly", ErrorEvent: "readonly", PromiseRejectionEvent: "readonly", navigator: "readonly",
};

const node = {
  ...shared,
  process: "readonly", Buffer: "readonly", require: "readonly", module: "writable", exports: "writable",
  __dirname: "readonly", __filename: "readonly", setImmediate: "readonly", clearImmediate: "readonly",
};

const browser = {
  ...shared,
  window: "readonly", document: "readonly", location: "readonly", history: "readonly", screen: "readonly", self: "readonly",
  localStorage: "readonly", sessionStorage: "readonly", indexedDB: "readonly", matchMedia: "readonly", getComputedStyle: "readonly",
  getSelection: "readonly", devicePixelRatio: "readonly", innerWidth: "readonly", innerHeight: "readonly", scrollTo: "readonly",
  requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly", requestIdleCallback: "readonly", cancelIdleCallback: "readonly",
  alert: "readonly", confirm: "readonly", prompt: "readonly", open: "readonly", close: "readonly", print: "readonly",
  Image: "readonly", Audio: "readonly", AudioContext: "readonly", webkitAudioContext: "readonly", MediaStream: "readonly",
  MediaRecorder: "readonly", AnalyserNode: "readonly", GainNode: "readonly", OscillatorNode: "readonly", BiquadFilterNode: "readonly",
  MutationObserver: "readonly", ResizeObserver: "readonly", IntersectionObserver: "readonly", PerformanceObserver: "readonly",
  KeyboardEvent: "readonly", MouseEvent: "readonly", PointerEvent: "readonly", WheelEvent: "readonly", DragEvent: "readonly",
  FocusEvent: "readonly", InputEvent: "readonly", TouchEvent: "readonly", ClipboardEvent: "readonly", DataTransfer: "readonly",
  HTMLElement: "readonly", HTMLCanvasElement: "readonly", HTMLInputElement: "readonly", HTMLSelectElement: "readonly",
  HTMLTextAreaElement: "readonly", HTMLButtonElement: "readonly", HTMLMediaElement: "readonly", HTMLDialogElement: "readonly",
  HTMLDetailsElement: "readonly", HTMLImageElement: "readonly", HTMLTemplateElement: "readonly", SVGElement: "readonly",
  Element: "readonly", Node: "readonly", NodeList: "readonly", NodeFilter: "readonly", Text: "readonly", Comment: "readonly",
  DocumentFragment: "readonly", ShadowRoot: "readonly", Range: "readonly", Selection: "readonly", DOMParser: "readonly",
  DOMRect: "readonly", Path2D: "readonly", OffscreenCanvas: "readonly", ImageData: "readonly", FileReader: "readonly",
  Worker: "readonly", XMLHttpRequest: "readonly", Notification: "readonly", speechSynthesis: "readonly",
  SpeechSynthesisUtterance: "readonly", CSS: "readonly",
};

const rules = {
  "no-undef": "error",
  "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
};

export default [
  {
    ignores: [
      "node_modules/**", "dist/**", "renderer/booklet.html", "tools/logs/**", ".local-migration/**", "website/**",
      "data/**", ".claude/**", ".codex-remote-attachments/**",
    ],
  },
  { files: ["**/*.mjs"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: node }, rules },
  { files: ["**/*.cjs"], languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: node }, rules },
  { files: ["renderer/**/*.js"], languageOptions: { ecmaVersion: 2024, sourceType: "script", globals: browser }, rules },
  { files: ["tests/**/*.mjs", "tests/**/*.cjs"], languageOptions: { globals: { ...node, ...browser } } },
  // The Electron fixtures ship page-side code as strings evaluated inside a
  // BrowserWindow, where the renderer's own functions exist; no-undef cannot see that.
  { files: ["tests/fixtures/*-electron.cjs"], rules: { "no-undef": "off" } },
];
