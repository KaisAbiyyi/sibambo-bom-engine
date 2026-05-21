import { LAYER_META, macroForLayer } from "../data/layerMeta";
import type { LayerKey, MacroGroupKey } from "../types/model";

const LAYER_KEYS = new Set(Object.keys(LAYER_META));

export function detectLayerKeyFromName(name?: string | null): LayerKey | null {
  if (!name) return null;
  const n = name.toLowerCase();

  if (/kulkas|dispenser|sofa|meja|kursi|lemari|tempat tidur|kasur|sree/.test(n)) return "furniture";
  if (/2d.?notasi|notasi.?pintu|notasi.?jendela/.test(n)) return "notasi_2d";
  if (/perabung|bubungan/.test(n)) return "perabung";
  if (/listplank/.test(n)) return "listplank";
  if (/atap|spandek|tritisan|alumunium foil/.test(n)) return "atap_spandek";
  if (/piri|lambrisering|list profil|list kayu/.test(n)) return "piri_piri";
  if (/plafon/.test(n)) return "ceiling";
  if (/^J\d{4}/.test(name) || /jendela|window/.test(n)) return "window";
  if (/^P\d{4}/.test(name) || /pintu|door/.test(n)) return "door";
  if (/kolom|column/.test(n)) return "kolom";
  if (/sloof/.test(n)) return "sloof";
  if (/balok|beam/.test(n)) return "balok";
  if (/cerucuk/.test(n)) return "cerucuk";
  if (/batu kali|batu kosong/.test(n)) return "pondasi_batu";
  if (/penggali|urugan|urug|tanah timbun|tanah urug/.test(n)) return "urugan";
  if (/pondasi/.test(n)) return "foundation";
  if (/cor lantai/.test(n)) return "cor_lantai";
  if (/keramik lantai|lantai keramik|ubin|parket/.test(n)) return "keramik_lantai";
  return null;
}

export function resolveLayerKey(surfaceType?: string, parentLayer?: LayerKey | null): LayerKey {
  if (parentLayer) return parentLayer;
  if (surfaceType && LAYER_KEYS.has(surfaceType)) return surfaceType as LayerKey;
  return "other";
}

export function detectLayerGroup(layerKey: LayerKey): MacroGroupKey {
  return macroForLayer(layerKey);
}
