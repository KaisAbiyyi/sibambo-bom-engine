import type { LayerKey, MacroGroupKey } from "../types/model";

export type LayerMeta = {
  key: LayerKey;
  label: string;
  color: string;
  group: MacroGroupKey;
  order: number;
};

export const MACRO_LABELS: Record<MacroGroupKey, string> = {
  roof: "Roof system",
  openings: "Openings",
  walls: "Wall envelope",
  structure: "Structural frame",
  floor: "Floor layers",
  foundation: "Foundation",
  other: "Other"
};

export const MACRO_GROUPS: Record<MacroGroupKey, LayerKey[]> = {
  roof: ["perabung", "atap_spandek", "listplank", "roof_slope"],
  openings: ["door", "window"],
  walls: ["wall_x_pos", "wall_x_neg", "wall_y_pos", "wall_y_neg"],
  structure: ["kolom", "balok", "structure"],
  floor: ["keramik_lantai", "cor_lantai", "floor"],
  foundation: ["urugan", "sloof", "pondasi_batu", "cerucuk", "foundation"],
  other: ["piri_piri", "ceiling", "furniture", "notasi_2d", "other"]
};

export const LAYER_META: Record<LayerKey, LayerMeta> = {
  perabung: { key: "perabung", label: "Perabung", color: "#bd7556", group: "roof", order: 10 },
  atap_spandek: { key: "atap_spandek", label: "Atap spandek", color: "#a6543f", group: "roof", order: 11 },
  listplank: { key: "listplank", label: "Listplank", color: "#965947", group: "roof", order: 12 },
  roof_slope: { key: "roof_slope", label: "Roof slope", color: "#a6543f", group: "roof", order: 13 },
  door: { key: "door", label: "Door", color: "#9b6b3d", group: "openings", order: 20 },
  window: { key: "window", label: "Window", color: "#466a83", group: "openings", order: 21 },
  wall_x_pos: { key: "wall_x_pos", label: "Wall X+", color: "#506d68", group: "walls", order: 30 },
  wall_x_neg: { key: "wall_x_neg", label: "Wall X-", color: "#5d7974", group: "walls", order: 31 },
  wall_y_pos: { key: "wall_y_pos", label: "Wall Y+", color: "#466a83", group: "walls", order: 32 },
  wall_y_neg: { key: "wall_y_neg", label: "Wall Y-", color: "#587d93", group: "walls", order: 33 },
  kolom: { key: "kolom", label: "Kolom", color: "#884b45", group: "structure", order: 40 },
  balok: { key: "balok", label: "Balok", color: "#9f5a4c", group: "structure", order: 41 },
  structure: { key: "structure", label: "Structure", color: "#80554d", group: "structure", order: 42 },
  keramik_lantai: { key: "keramik_lantai", label: "Keramik lantai", color: "#d1bc86", group: "floor", order: 50 },
  cor_lantai: { key: "cor_lantai", label: "Cor lantai", color: "#b99a62", group: "floor", order: 51 },
  floor: { key: "floor", label: "Floor", color: "#c8a86a", group: "floor", order: 52 },
  urugan: { key: "urugan", label: "Urugan", color: "#80684f", group: "foundation", order: 60 },
  sloof: { key: "sloof", label: "Sloof", color: "#9d7441", group: "foundation", order: 61 },
  pondasi_batu: { key: "pondasi_batu", label: "Pondasi batu", color: "#7d6a4e", group: "foundation", order: 62 },
  cerucuk: { key: "cerucuk", label: "Cerucuk", color: "#6c5134", group: "foundation", order: 63 },
  foundation: { key: "foundation", label: "Foundation", color: "#695846", group: "foundation", order: 64 },
  piri_piri: { key: "piri_piri", label: "Piri-piri", color: "#8d8052", group: "other", order: 70 },
  ceiling: { key: "ceiling", label: "Ceiling", color: "#b9a96e", group: "other", order: 71 },
  furniture: { key: "furniture", label: "Furniture", color: "#817061", group: "other", order: 72 },
  notasi_2d: { key: "notasi_2d", label: "Notasi 2D", color: "#7d7668", group: "other", order: 73 },
  other: { key: "other", label: "Other", color: "#8a8172", group: "other", order: 99 }
};

export function macroForLayer(layerKey: LayerKey): MacroGroupKey {
  return LAYER_META[layerKey]?.group ?? "other";
}
