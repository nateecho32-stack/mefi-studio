// What a Shop style pack may hold (relay/src/shop.mjs), checked before the
// relay keeps one and again before Studio publishes one.
//
// A pack is data only: four colours as #rrggbb (and a second accent if it
// likes), and at most a node style, a material and a font, each from
// Studio's own lists. No CSS, no links, no images and no markup can ride in
// one: a key this schema does not name is refused, never quietly dropped, so
// a pack holds exactly what the Shop shows. Colours are kept lower-case. A
// pack must also read well: its text against the background and against
// the surface at WCAG's 4.5 to 1, and its accent against the background at
// 3 to 1.
//
// Studio's pack editor keeps a mirror of this check, so it can say what is
// wrong before anything is published; tests/fixtures/shop-pack-cases.json
// feeds both the same cases.
//
//   checkPack(data) -> { ok: true, pack } | { ok: false, error: 'bad-pack' | 'too-big' | 'low-contrast' }

import { utf8Length } from './util.mjs';

export const PACK_VERSION = 1;

export const PACK_LIMITS = Object.freeze({
  bytes: 2048, // the pack as JSON
  textContrast: 4.5, // text against the background, and against the surface
  accentContrast: 3, // the accent against the background
  nameMin: 2,
  nameMax: 40,
  blurbMax: 160,
});

/** The palette: four colours every pack names, and accent2, which it may. */
export const PALETTE_KEYS = Object.freeze(['accent', 'background', 'surface', 'text']);
export const PALETTE_OPTIONAL = Object.freeze(['accent2']);
/** Studio's node styles (renderer/node-styles.js), materials (MefiAppearance's presets) and fonts. */
export const NODE_STYLES = Object.freeze(['orbs', 'glass', 'minimal', 'halo', 'crystal', 'singularity', 'prism', 'sigil']);
export const MATERIALS = Object.freeze(['focus', 'studio', 'atmosphere']);
export const FONTS = Object.freeze(['studio', 'display', 'serif', 'mono']);

const PACK_KEYS = Object.freeze(['v', 'palette', 'nodeStyle', 'material', 'font']);
const CHOICES = Object.freeze({ nodeStyle: NODE_STYLES, material: MATERIALS, font: FONTS });
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** WCAG relative luminance of a #rrggbb colour, 0 (black) to 1 (white). */
export function luminance(hex) {
  const channel = (at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two #rrggbb colours, 1 to 21. */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * checkPack(data) -> { ok: true, pack } with the colours lower-cased and the
 * keys in schema order, or { ok: false, error }: "too-big" over 2 KB as JSON,
 * "bad-pack" for anything the schema does not allow, "low-contrast" when it
 * would not read well.
 */
export function checkPack(data) {
  const bad = { ok: false, error: 'bad-pack' };
  if (!isPlainObject(data)) return bad;
  let json;
  try {
    json = JSON.stringify(data);
  } catch {
    return bad;
  }
  if (typeof json !== 'string') return bad;
  if (utf8Length(json) > PACK_LIMITS.bytes) return { ok: false, error: 'too-big' };
  // Checked as JSON reads it back: plain data only, and no key that JSON would leave out.
  const plain = JSON.parse(json);
  if (!isPlainObject(plain) || !Object.keys(plain).every((key) => PACK_KEYS.includes(key))) return bad;
  if (plain.v !== PACK_VERSION || !isPlainObject(plain.palette)) return bad;
  if (!Object.keys(plain.palette).every((key) => PALETTE_KEYS.includes(key) || PALETTE_OPTIONAL.includes(key))) return bad;
  const palette = {};
  for (const key of [...PALETTE_KEYS, ...PALETTE_OPTIONAL]) {
    const colour = plain.palette[key];
    if (colour === undefined && PALETTE_OPTIONAL.includes(key)) continue;
    if (typeof colour !== 'string' || !COLOUR.test(colour)) return bad;
    palette[key] = colour.toLowerCase();
  }
  const pack = { v: PACK_VERSION, palette };
  for (const [key, allowed] of Object.entries(CHOICES)) {
    if (!Object.hasOwn(plain, key)) continue;
    if (!allowed.includes(plain[key])) return bad;
    pack[key] = plain[key];
  }
  const readable =
    contrastRatio(palette.text, palette.background) >= PACK_LIMITS.textContrast &&
    contrastRatio(palette.text, palette.surface) >= PACK_LIMITS.textContrast &&
    contrastRatio(palette.accent, palette.background) >= PACK_LIMITS.accentContrast;
  return readable ? { ok: true, pack } : { ok: false, error: 'low-contrast' };
}
