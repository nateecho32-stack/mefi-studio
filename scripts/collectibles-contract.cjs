// The desktop collectible boundary. Named actions only, bounded data-only
// requests, and no entitlement, ownership or rolled-rarity assertions from UI.
const ID = /^[A-Za-z0-9_:-]{1,80}$/;
const RARITIES = ["none", "common", "uncommon", "rare", "epic", "legendary"];
const FIELDS = Object.freeze({
  list: [], market: ["cursor"], catalog: ["cursor"], inventory: ["cursor"], open: ["crateId", "requestId", "price", "communityOptIn", "poolVersion"],
  create: ["kind", "name", "blurb", "visual", "rarityWeights", "price", "listed", "inCrates"],
  updateCreation: ["definitionId", "listed"], buyCreation: ["definitionId", "price", "requestId"],
  care: ["instanceId", "action"], updateInstance: ["instanceId", "name", "size"],
  transfer: ["instanceId", "userId"], listItem: ["instanceId", "price"],
  buy: ["listingId", "price"], cancelListing: ["listingId"],
  order: ["kind", "definitionId", "minRarity", "maxRarity", "maxPrice", "mode"],
  cancelOrder: ["orderId"], stickers: ["roomId"], share: ["instanceId", "roomId", "shared"], claim: ["instanceId", "roomId"],
});
const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
function request(action, payload = {}) {
  // "list" is the collection read; UI's listing action uses "listItem".
  if (!Object.hasOwn(FIELDS, action) || !plain(payload)) return null;
  if (action === "updateCreation" && Object.keys(payload).some((key) => !FIELDS[action].includes(key))) return null;
  let size;
  try { size = JSON.stringify(payload).length; } catch { return null; }
  if (size > 8192) return null;
  const body = {};
  for (const key of FIELDS[action]) {
    const value = payload[key];
    if (value === undefined) continue;
    if (key === "visual") {
      if (!plain(value)) return null;
      body.visual = Object.fromEntries(["body", "primary", "secondary", "motif", "glyph"].filter((k) => typeof value[k] === "string").map((k) => [k, value[k].slice(0, 32)]));
    } else if (key === "rarityWeights") {
      if (!plain(value) || Object.keys(value).some((k) => !RARITIES.includes(k) || !Number.isInteger(value[k]) || value[k] < 0 || value[k] > 10000)) return null;
      body.rarityWeights = { ...value };
    } else if (/Id$/.test(key)) {
      if (typeof value !== "string" || !ID.test(value)) return null;
      body[key] = value;
    } else if (["price", "maxPrice"].includes(key)) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 1e6) return null;
      body[key] = value;
    } else if (["listed", "shared", "communityOptIn", "inCrates"].includes(key)) {
      if (typeof value !== "boolean") return null;
      body[key] = value;
    } else if (typeof value === "string" && value.length <= (key === "blurb" ? 160 : 128)) body[key] = value;
    else return null;
  }
  const base = "/v1/collectibles";
  const take = (key) => { const value = body[key]; delete body[key]; return value; };
  const sub = (key, path, suffix = "") => { const value = take(key); return value ? `${base}/${path}/${encodeURIComponent(value)}${suffix}` : null; };
  let method = "POST", path;
  switch (action) {
    case "list": method = "GET"; path = base; break;
    case "market": method = "GET"; path = `${base}/market${body.cursor ? `?cursor=${encodeURIComponent(body.cursor)}` : ""}`; break;
    case "catalog": case "inventory": method = "GET"; path = `${base}/${action}${body.cursor ? `?cursor=${encodeURIComponent(body.cursor)}` : ""}`; break;
    case "open": path = `${base}/open`; break;
    case "create": path = `${base}/create`; break;
    case "updateCreation": method = "PUT"; path = sub("definitionId", "creations"); break;
    case "buyCreation": path = sub("definitionId", "creations", "/buy"); break;
    case "care": path = sub("instanceId", "instances", "/care"); break;
    case "updateInstance": method = "PUT"; path = sub("instanceId", "instances"); break;
    case "transfer": path = sub("instanceId", "instances", "/transfer"); break;
    case "listItem": path = `${base}/listings`; break;
    case "buy": path = sub("listingId", "listings", "/buy"); break;
    case "cancelListing": method = "DELETE"; path = sub("listingId", "listings"); break;
    case "order": path = `${base}/orders`; break;
    case "cancelOrder": method = "DELETE"; path = sub("orderId", "orders"); break;
    case "stickers": { method = "GET"; const roomId = take("roomId"); path = roomId ? `/v1/rooms/${encodeURIComponent(roomId)}/stickers` : null; break; }
    case "share": path = sub("instanceId", "instances", "/share"); break;
    case "claim": path = sub("instanceId", "instances", "/claim"); break;
  }
  return path ? { method, path, ...(method === "GET" || method === "DELETE" ? {} : { body }) } : null;
}
function visual(value) {
  if (!plain(value) || !["dragon", "cloud", "phoenix", "wisp"].includes(value.body)
    || !/^#[\da-f]{6}$/i.test(value.primary) || !/^#[\da-f]{6}$/i.test(value.secondary)
    || !["plain", "stars", "sparkles", "stripes"].includes(value.motif)) return null;
  return { body: value.body, primary: value.primary, secondary: value.secondary, motif: value.motif,
    ...(["idea", "rest", "celebrate", "code", "happy", "plan", "curious", "love", "sleep"].includes(value.asset) ? { asset: value.asset } : {}),
    ...(typeof value.glyph === "string" && ["heart", "star", "moon", "spark", "leaf", "wave"].includes(value.glyph) ? { glyph: value.glyph } : {}) };
}
function sticker(value) {
  const look = visual(value?.visual);
  if (!plain(value) || !ID.test(value.id) || !/^\d{17,20}$/.test(value.ownerId) || !look || !RARITIES.includes(value.rarity) || typeof value.name !== "string") return null;
  return { id: value.id, name: value.name.slice(0, 40), rarity: value.rarity, ownerId: value.ownerId, visual: look };
}
module.exports = { request, visual, sticker, RARITIES };
