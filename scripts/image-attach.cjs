// Pictures attached to a message: what is accepted, how a picture is checked,
// which models can look at one, and the shape each provider wants it in.
//
// A picture is accepted only when its BYTES say it is a PNG, JPEG, WebP or GIF
// (the name and the declared type are only advice), it is at most 5 MB and
// 25 megapixels, and a message carries at most four. The megapixel bound is for
// the machine, not the provider: a small file can decode into gigabytes, and the
// thumbnail is decoded in the main process.
//
// Whether a model can look at a picture is read from the model catalog
// (data/models.json: capabilities.modalities.input holds "image") and from
// nothing else. A model the catalog does not know can not see, so a picture is
// never sent to a model that may refuse it. agent-profiles.cjs reports the
// answer as capabilities().vision.
//
// The request shapes are the provider's own: OpenAI-compatible chat completions
// take `image_url` parts with a data URL, the OpenAI Responses API takes
// `input_image` parts, and Anthropic's Messages API takes `image` blocks with a
// base64 source. A coding CLI never gets a picture in its request: it gets one
// plain line naming the file and where it is (attachedLine).
//
// Pure module: no Electron, no filesystem, no network, no clock reads. The host
// (main.cjs "Picture attachments", scripts/image-store.cjs) reads and writes
// the files.

"use strict";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_MESSAGE = 4;
const MAX_PIXELS = 25_000_000;
const TYPES = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" });
const ID = /^img_[a-f0-9]{24}$/;
const NAME_MAX = 80;

const sayMegabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`;

/** The type the first bytes say, or null. Nothing else is read for the answer. */
function sniff(bytes) {
  const b = bytes;
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const be32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const le16 = (b, at) => b[at] | (b[at + 1] << 8);
const le24 = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

/** Width and height read from the file's own header, or null when the header does not hold them. */
function dimensions(bytes, mime) {
  const b = bytes;
  if (mime === "image/png") {
    if (b.length < 24 || !(b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52)) return null;
    return { width: be32(b, 16), height: be32(b, 20) };
  }
  if (mime === "image/gif") return b.length >= 10 ? { width: le16(b, 6), height: le16(b, 8) } : null;
  if (mime === "image/webp") {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === "VP8 " && b.length >= 30) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (kind === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X" && b.length >= 30) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
    return null;
  }
  if (mime === "image/jpeg") {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) { at += 1; continue; }
      const marker = b[at + 1];
      if (marker === 0xff) { at += 1; continue; }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0x00) { at += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: (b[at + 7] << 8) | b[at + 8], height: (b[at + 5] << 8) | b[at + 6] };
      const length = (b[at + 2] << 8) | b[at + 3];
      if (length < 2) return null;
      at += 2 + length;
    }
    return null;
  }
  return null;
}

/** A name to show: no folders, no control characters, at most 80 characters, and something even when nothing usable was given. */
function cleanName(name, ext = "png") {
  const base = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").split(/[\\/]/).pop().replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return base && base !== "." && base !== ".." ? base : `picture.${ext}`;
}

/**
 * The verdict on one file: { ok, mime, ext, width, height, bytes, name } or
 * { ok: false, error } in the owner's words. The bytes decide the type; a
 * declared type that is not one of the four is refused, one that is merely wrong
 * is corrected to what the bytes say.
 */
function inspect({ name, mime, bytes }) {
  const length = bytes?.length ?? 0;
  if (!length) return { ok: false, error: "That file is empty." };
  if (length > MAX_BYTES) return { ok: false, error: `That picture is ${sayMegabytes(length)}; the limit is ${sayMegabytes(MAX_BYTES)}.` };
  const declared = String(mime ?? "").toLowerCase().trim();
  if (declared && !TYPES[declared]) return { ok: false, error: "Pictures can be PNG, JPEG, WebP or GIF." };
  const real = sniff(bytes);
  if (!real) return { ok: false, error: "That file is not a PNG, JPEG, WebP or GIF picture, whatever its name says." };
  const size = dimensions(bytes, real);
  if (!size || !(size.width > 0) || !(size.height > 0)) return { ok: false, error: "That does not look like a complete picture." };
  if (size.width * size.height > MAX_PIXELS) return { ok: false, error: `That picture is ${size.width} by ${size.height} pixels; pictures up to ${MAX_PIXELS / 1_000_000} megapixels are accepted.` };
  return { ok: true, mime: real, ext: TYPES[real], width: size.width, height: size.height, bytes: length, name: cleanName(name, TYPES[real]) };
}

/**
 * What a renderer sent as a picture's contents, as bytes: a base64 string (a
 * data: URL is fine), a Uint8Array or an ArrayBuffer. The size is checked before
 * anything is decoded, so an enormous string never becomes an enormous buffer.
 */
function decode(data) {
  if (typeof data === "string") {
    const body = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
    if (body.length > Math.ceil((MAX_BYTES * 4) / 3) + 16) return { ok: false, error: `That picture is over the limit of ${sayMegabytes(MAX_BYTES)}.` };
    if (!/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(body)) return { ok: false, error: "The picture could not be read." };
    return { ok: true, bytes: Buffer.from(body, "base64") };
  }
  const view = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!view) return { ok: false, error: "The picture could not be read." };
  if (view.length > MAX_BYTES) return { ok: false, error: `That picture is ${sayMegabytes(view.length)}; the limit is ${sayMegabytes(MAX_BYTES)}.` };
  return { ok: true, bytes: Buffer.from(view.buffer, view.byteOffset, view.byteLength) };
}

const isId = (value) => typeof value === "string" && ID.test(value);

/**
 * The ids a message names, checked: only real ids, no repeats, at most four.
 * { ok, ids } or { ok: false, error }. Nothing here is a path.
 */
function checkIds(value) {
  if (value === undefined || value === null) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, error: "The pictures were not sent in a form Studio can read." };
  const ids = [...new Set(value.map((item) => (typeof item === "string" ? item : item?.id)))];
  if (ids.length > MAX_PER_MESSAGE) return { ok: false, error: `A message can carry up to ${MAX_PER_MESSAGE} pictures.` };
  if (ids.some((id) => !isId(id))) return { ok: false, error: "One of the pictures is not one Studio saved." };
  return { ok: true, ids };
}

// ---- what each provider wants -------------------------------------------------------------------

const dataUrl = (image) => `data:${image.mime};base64,${image.base64}`;

/** OpenAI-compatible chat completions: the text, then one image_url part per picture. */
const openAiContent = (text, images) => [{ type: "text", text }, ...images.map((image) => ({ type: "image_url", image_url: { url: dataUrl(image) } }))];
/** Anthropic's Messages API: the pictures first, each an image block with a base64 source, then the text. */
const anthropicContent = (text, images) => [...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } })), { type: "text", text }];

/** Which wire an endpoint speaks, for the pictures: "anthropic" for a /messages endpoint, "openai" for chat completions and for the Responses API (see responsesParts). */
function formatFor(endpoint) {
  return /\/messages\/?$/i.test(String(endpoint ?? "")) ? "anthropic" : "openai";
}

/**
 * The same request with the pictures in its last user message, in the provider's
 * own format. A new object; the request it was given is not changed. Text that
 * is already parts stays, and the pictures join them.
 */
function attachBody(body, images, format = "openai") {
  if (!images?.length || !Array.isArray(body?.messages)) return body;
  const at = body.messages.findLastIndex((message) => message?.role === "user");
  if (at < 0) return body;
  const message = body.messages[at];
  const text = typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n") : "";
  const content = format === "anthropic" ? anthropicContent(text, images) : openAiContent(text, images);
  return { ...body, messages: body.messages.map((item, index) => (index === at ? { ...item, content } : item)) };
}

/** Chat-completions parts as the Responses API's input parts (text to input_text, image_url to input_image); anything else passes as it is. */
function responsesParts(content) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part?.type === "text") return { type: "input_text", text: part.text };
    if (part?.type === "image_url") return { type: "input_image", image_url: typeof part.image_url === "string" ? part.image_url : part.image_url?.url };
    return part;
  });
}

// ---- words ----------------------------------------------------------------------------------------

/** The line a coding CLI is given in place of the picture. */
const attachedLine = (image) => `The owner attached ${image.name} at ${image.path}`;
const attachedLines = (images) => images.map(attachedLine).join("\n");

/** The one sentence a reply carries when the model could not look at what was attached. */
function unseenNote({ model = "", count = 1, noModel = false } = {}) {
  const it = count === 1 ? "It is" : "They are";
  const those = count === 1 ? "the picture" : `the ${count} pictures`;
  if (noModel) return `No AI that can look at pictures answered, so I read your message without ${those}. ${it} saved with your message.`;
  return `${model ? `${model} can't see images` : "This model can't see images"}, so I answered without looking at ${those} you attached. ${it} saved with your message.`;
}

// ---- which models can see ---------------------------------------------------------------------------

const VENDOR_PREFIX = /^(?:openai|anthropic|google|x-ai|opencode-go|opencode|zen|z-ai|moonshotai|deepseek|qwen)\//;
const modelKey = (model) => String(model ?? "").toLowerCase().trim().replace(VENDOR_PREFIX, "");
const takesImages = (entry) => Array.isArray(entry?.capabilities?.modalities?.input) && entry.capabilities.modalities.input.includes("image");

/**
 * The catalog as an index of who takes images, one table per provider Studio
 * routes to and one across all of them. A model appears only if the catalog
 * lists it; `true` only if the catalog says it takes image input.
 */
function visionIndex(document) {
  const tables = { zen: new Map(), claude: new Map(), zai: new Map(), opencode: new Map(), any: new Map() };
  const put = (table, entry) => {
    const id = modelKey(entry?.id);
    if (!id) return;
    table.set(id, table.get(id) === true || takesImages(entry));
    tables.any.set(id, tables.any.get(id) === true || takesImages(entry));
  };
  for (const entry of Array.isArray(document?.models) ? document.models : []) put(tables.opencode, entry);
  for (const [provider, list] of Object.entries(document?.providerModels && typeof document.providerModels === "object" ? document.providerModels : {})) {
    if (tables[provider] && provider !== "any" && Array.isArray(list)) for (const entry of list) put(tables[provider], entry);
  }
  return tables;
}

/**
 * Whether a route's model can look at a picture. A route the catalog names
 * answers from its own table; a route Studio only borrows models for (OpenRouter,
 * a custom endpoint, LM Studio) answers from any table that knows the id; a
 * model nobody knows can not see. A coding CLI is never asked.
 */
function sees(index, provider, model) {
  if (!index) return false;
  const id = modelKey(model);
  if (!id) return false;
  const own = { zen: index.zen, opencode: index.opencode, zai: index.zai, claude: index.claude }[provider];
  if (own) return own.get(id) === true;
  if (["openrouter", "custom", "lmstudio", "auto", ""].includes(String(provider ?? ""))) return index.any.get(id) === true;
  return false;
}

module.exports = {
  MAX_BYTES, MAX_PER_MESSAGE, MAX_PIXELS, TYPES,
  sniff, dimensions, cleanName, inspect, decode, isId, checkIds,
  openAiContent, anthropicContent, formatFor, attachBody, responsesParts,
  attachedLine, attachedLines, unseenNote,
  modelKey, visionIndex, sees,
};
