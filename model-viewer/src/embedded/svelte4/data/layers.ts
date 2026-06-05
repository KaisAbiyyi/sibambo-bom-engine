export type MacroKey = "roof" | "openings" | "walls" | "structure" | "floor" | "foundation" | "other";

export type LayerMeta = {
  label: string;
  macro: MacroKey;
  color: string;
  order: number;
};

export const MACRO_LABELS: Record<MacroKey, string> = {
  roof: "Roof shell",
  openings: "Openings",
  walls: "Wall envelope",
  structure: "Structural frame",
  floor: "Floor datum",
  foundation: "Ground works",
  other: "Annotations"
};

export const MACRO_COLORS: Record<MacroKey, string> = {
  roof: "#d58a54",
  openings: "#5f9fba",
  walls: "#55a18f",
  structure: "#be6654",
  floor: "#d5ad5b",
  foundation: "#8f7558",
  other: "#879098"
};

export const MACRO_OFFSETS: Record<MacroKey, [number, number, number]> = {
  roof: [0.4, 6.4, -2.2],
  openings: [-4.8, 1.2, 2.8],
  walls: [3.4, 0.6, -2.4],
  structure: [0.2, 0.2, 0.5],
  floor: [-1.6, -3.1, 1.8],
  foundation: [0.7, -6.3, -2.4],
  other: [2.5, 2.4, 2.0]
};

export const LAYER_META: Record<string, LayerMeta> = {
  perabung: { label: "Perabung", macro: "roof", color: "#de9c6b", order: 10 },
  atap_spandek: { label: "Atap spandek", macro: "roof", color: "#c97942", order: 11 },
  listplank: { label: "Listplank", macro: "roof", color: "#a86443", order: 12 },
  roof_slope: { label: "Roof slope", macro: "roof", color: "#bd744b", order: 13 },
  door: { label: "Door", macro: "openings", color: "#b98b5b", order: 20 },
  window: { label: "Window", macro: "openings", color: "#6bb5c8", order: 21 },
  wall_x_pos: { label: "Wall X+", macro: "walls", color: "#62b39d", order: 30 },
  wall_x_neg: { label: "Wall X-", macro: "walls", color: "#4f9b8c", order: 31 },
  wall_y_pos: { label: "Wall Y+", macro: "walls", color: "#548ba0", order: 32 },
  wall_y_neg: { label: "Wall Y-", macro: "walls", color: "#466f82", order: 33 },
  kolom: { label: "Kolom", macro: "structure", color: "#c05d4d", order: 40 },
  balok: { label: "Balok", macro: "structure", color: "#a94f48", order: 41 },
  structure: { label: "Structure", macro: "structure", color: "#a45e55", order: 42 },
  keramik_lantai: { label: "Keramik lantai", macro: "floor", color: "#d8ba67", order: 50 },
  cor_lantai: { label: "Cor lantai", macro: "floor", color: "#b99352", order: 51 },
  floor: { label: "Floor", macro: "floor", color: "#cba65b", order: 52 },
  urugan: { label: "Urugan", macro: "foundation", color: "#9b7d5c", order: 60 },
  sloof: { label: "Sloof", macro: "foundation", color: "#b17b4a", order: 61 },
  pondasi_batu: { label: "Pondasi batu", macro: "foundation", color: "#82705b", order: 62 },
  cerucuk: { label: "Cerucuk", macro: "foundation", color: "#6c543c", order: 63 },
  foundation: { label: "Foundation", macro: "foundation", color: "#715f4d", order: 64 },
  piri_piri: { label: "Piri-piri", macro: "other", color: "#8f8a66", order: 70 },
  ceiling: { label: "Ceiling", macro: "other", color: "#b7aa75", order: 71 },
  furniture: { label: "Furniture", macro: "other", color: "#8b7768", order: 72 },
  notasi_2d: { label: "Notasi 2D", macro: "other", color: "#8d918b", order: 73 },
  other: { label: "Other", macro: "other", color: "#89929b", order: 99 }
};

export function layerMeta(key: string): LayerMeta {
  return LAYER_META[key] ?? LAYER_META.other;
}

export function detectLayerKeyFromName(name?: string | null): string | null {
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
