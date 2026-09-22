// Where a saved credential may come from besides the encrypted settings
// field: the environment. The names are the ones the headless `--set-*-key`
// commands already read, so a service host that cannot keep an OS keystore
// (a container, a session without a desktop) exports the same variables and
// the key is read at call time instead of being written anywhere.
const ENV_KEYS = Object.freeze({
  apiKeyEncrypted: ["MEFI_STUDIO_KEY"],
  zaiApiKeyEncrypted: ["MEFI_STUDIO_ZAI_KEY"],
  customApiKeyEncrypted: ["MEFI_STUDIO_CUSTOM_KEY"],
  gatewayApiKeyEncrypted: ["MEFI_STUDIO_GATEWAY_KEY", "AI_GATEWAY_API_KEY"],
  jevApiKeyEncrypted: ["MEFI_STUDIO_JEV_KEY", "TYPESAFE_API_KEY"],
  zenApiKeyEncrypted: ["MEFI_STUDIO_ZEN_KEY", "OPENCODE_ZEN_API_KEY"],
  openrouterApiKeyEncrypted: ["MEFI_STUDIO_OPENROUTER_KEY", "OPENROUTER_API_KEY"],
  githubTokenEncrypted: ["MEFI_STUDIO_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
});

// The first non-empty variable for a settings field, or null.
function envKey(field, env = process.env) {
  for (const name of ENV_KEYS[field] ?? []) {
    const value = String(env[name] ?? "").trim();
    if (value) return value;
  }
  return null;
}

// Whether a field can produce a key right now: from the environment, or from
// the saved ciphertext when the OS keystore that wrote it is available.
function hasKey(settings, field, { env = process.env, encryptionAvailable } = {}) {
  if (envKey(field, env)) return true;
  return Boolean(settings?.[field]) && encryptionAvailable === true;
}

module.exports = { ENV_KEYS, envKey, hasKey };
