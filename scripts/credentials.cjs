// Where a saved credential may come from besides the encrypted settings
// field: the environment. A service host that cannot keep an OS keystore (a
// container, a session without a desktop) exports a variable and the key is
// read at call time instead of being written anywhere.
//
// Two tiers, because the two kinds of name mean different things:
//
//   own    - Studio's own MEFI_STUDIO_* name. Nothing else sets it, so
//            exporting one is an explicit "use this key" and it outranks the
//            saved settings field. These are the same names the headless
//            `--set-*-key` commands read, so an operator learns one variable
//            per credential.
//   shared - the name another tool already uses for the same credential
//            (gh exports GH_TOKEN, an OpenRouter CLI exports
//            OPENROUTER_API_KEY). A desktop install often has these exported
//            for an unrelated CLI, so they must never displace the key the
//            owner saved in Settings: they are read only when no saved key
//            can be read. That keeps an existing install's behaviour exactly
//            what it was before this module existed.
const OWN_KEYS = Object.freeze({
  apiKeyEncrypted: "MEFI_STUDIO_KEY",
  zaiApiKeyEncrypted: "MEFI_STUDIO_ZAI_KEY",
  customApiKeyEncrypted: "MEFI_STUDIO_CUSTOM_KEY",
  gatewayApiKeyEncrypted: "MEFI_STUDIO_GATEWAY_KEY",
  jevApiKeyEncrypted: "MEFI_STUDIO_JEV_KEY",
  zenApiKeyEncrypted: "MEFI_STUDIO_ZEN_KEY",
  openrouterApiKeyEncrypted: "MEFI_STUDIO_OPENROUTER_KEY",
  githubTokenEncrypted: "MEFI_STUDIO_GITHUB_TOKEN",
});

const SHARED_KEYS = Object.freeze({
  apiKeyEncrypted: Object.freeze([]),
  zaiApiKeyEncrypted: Object.freeze([]),
  customApiKeyEncrypted: Object.freeze([]),
  gatewayApiKeyEncrypted: Object.freeze(["AI_GATEWAY_API_KEY"]),
  jevApiKeyEncrypted: Object.freeze(["TYPESAFE_API_KEY"]),
  zenApiKeyEncrypted: Object.freeze(["OPENCODE_ZEN_API_KEY"]),
  openrouterApiKeyEncrypted: Object.freeze(["OPENROUTER_API_KEY"]),
  githubTokenEncrypted: Object.freeze(["GH_TOKEN", "GITHUB_TOKEN"]),
});

// Every variable a field answers to, Studio's own first. The order documents
// the set; it is not the precedence against a saved key, which hasKey() and
// the host's decryptKey() decide per tier.
const ENV_KEYS = Object.freeze(Object.fromEntries(
  Object.keys(OWN_KEYS).map((field) => [field, Object.freeze([OWN_KEYS[field], ...SHARED_KEYS[field]])]),
));

// The first non-empty of a list of variables, or null.
function firstOf(names, env) {
  for (const name of names) {
    const value = String(env[name] ?? "").trim();
    if (value) return value;
  }
  return null;
}

// Studio's own variable for a field: outranks the saved settings field.
function ownKey(field, env = process.env) {
  const name = OWN_KEYS[field];
  return name ? firstOf([name], env) : null;
}

// Another tool's variable for the same credential: a fallback behind the
// saved settings field, never ahead of it.
function sharedKey(field, env = process.env) {
  return firstOf(SHARED_KEYS[field] ?? [], env);
}

// Any variable at all for a field, Studio's own preferred. Callers that only
// need "is a key reachable without the keystore" use this; callers that must
// respect a saved key use the two tiers directly.
function envKey(field, env = process.env) {
  return ownKey(field, env) ?? sharedKey(field, env);
}

// Which source would answer for a field right now: "env", "settings", or null
// when nothing can produce a key. Status only - no caller learns the key from
// this.
function keySource(settings, field, { env = process.env, encryptionAvailable } = {}) {
  if (ownKey(field, env)) return "env";
  // The saved ciphertext is only readable through the keystore that wrote it.
  if (settings?.[field] && encryptionAvailable === true) return "settings";
  return sharedKey(field, env) ? "env" : null;
}

// Whether a field can produce a key right now, from either source.
function hasKey(settings, field, options = {}) {
  return keySource(settings, field, options) !== null;
}

module.exports = { ENV_KEYS, OWN_KEYS, SHARED_KEYS, envKey, ownKey, sharedKey, keySource, hasKey };
