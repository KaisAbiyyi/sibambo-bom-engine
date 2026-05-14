import type { LayerInfo } from "./types";

export interface LayerMeta {
  label: string;
  color: string;
  order: number;
}

export const LAYER_META: Record<string, LayerMeta> = {
  wall_x_pos: { label: "Dinding X+ (Timur)", color: "#D97706", order: 10 },
  wall_x_neg: { label: "Dinding X- (Barat)", color: "#F59E0B", order: 11 },
  wall_y_pos: { label: "Dinding Y+ (Utara)", color: "#60A5FA", order: 12 },
  wall_y_neg: { label: "Dinding Y- (Selatan)", color: "#93C5FD", order: 13 },
  cor_lantai: { label: "Cor Lantai", color: "#64748B", order: 20 },
  keramik_lantai: { label: "Keramik Lantai", color: "#14B8A6", order: 21 },
  floor: { label: "Lantai Lainnya", color: "#22C55E", order: 22 },
  piri_piri: { label: "Piri-Piri / Lambrisering", color: "#EAB308", order: 30 },
  ceiling: { label: "Plafon Umum", color: "#FACC15", order: 31 },
  atap_spandek: { label: "Atap Spandek", color: "#DC2626", order: 40 },
  perabung: { label: "Perabung / Bubungan", color: "#EF4444", order: 41 },
  listplank: { label: "Listplank", color: "#F87171", order: 42 },
  roof_slope: { label: "Atap Lainnya", color: "#B91C1C", order: 43 },
  door: { label: "Pintu", color: "#C2410C", order: 50 },
  window: { label: "Jendela", color: "#06B6D4", order: 51 },
  kolom: { label: "Kolom", color: "#2563EB", order: 60 },
  balok: { label: "Balok", color: "#3B82F6", order: 61 },
  structure: { label: "Struktur Lainnya", color: "#1D4ED8", order: 62 },
  cerucuk: { label: "Cerucuk", color: "#92400E", order: 70 },
  sloof: { label: "Balok Sloof", color: "#B45309", order: 71 },
  pondasi_batu: { label: "Pas. Batu Kali/Kosong", color: "#A16207", order: 72 },
  urugan: { label: "Urugan / Tanah / Pasir", color: "#854D0E", order: 73 },
  foundation: { label: "Pondasi Lainnya", color: "#713F12", order: 74 },
  furniture: { label: "Furniture / Perabot", color: "#8B5CF6", order: 80 },
  notasi_2d: { label: "Notasi 2D", color: "#64748B", order: 85 },
  other: { label: "Lainnya", color: "#94A3B8", order: 99 }
};

const LAYER_SECTIONS = [
  { minOrder: 0, maxOrder: 19, label: "Dinding" },
  { minOrder: 20, maxOrder: 29, label: "Lantai" },
  { minOrder: 30, maxOrder: 39, label: "Plafon" },
  { minOrder: 40, maxOrder: 49, label: "Atap" },
  { minOrder: 50, maxOrder: 59, label: "Pintu & Jendela" },
  { minOrder: 60, maxOrder: 69, label: "Struktur" },
  { minOrder: 70, maxOrder: 79, label: "Pondasi" },
  { minOrder: 80, maxOrder: 98, label: "Furniture & Lainnya" },
  { minOrder: 99, maxOrder: 999, label: "Lainnya" }
];

export function sectionLabel(order: number) {
  return LAYER_SECTIONS.find((item) => order >= item.minOrder && order <= item.maxOrder)?.label ?? "Lainnya";
}

export function layerInfoFromRegistry(
  registry: Record<string, { visible: boolean; count: number }>
): LayerInfo[] {
  return Object.entries(registry)
    .map(([key, value]) => {
      const meta = LAYER_META[key] ?? { label: key, color: "#94A3B8", order: 90 };
      return {
        key,
        label: meta.label,
        color: meta.color,
        order: meta.order,
        visible: value.visible,
        count: value.count,
        section: sectionLabel(meta.order)
      };
    })
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function detectVisGroup(name?: string) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/kulkas|dispenser|sofa|meja|kursi|lemari|tempat tidur|kasur|sree/.test(n)) return "furniture";
  if (/2d.?notasi|notasi.?2d|notasi.?pintu|notasi.?jendela/.test(n)) return "notasi_2d";
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

export function resolveVisGroup(surfaceType?: string, parentVisGroup?: string | null) {
  if (parentVisGroup) return parentVisGroup;
  if (surfaceType && LAYER_META[surfaceType]) return surfaceType;
  return "other";
}
