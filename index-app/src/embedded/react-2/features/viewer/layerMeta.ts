import type { LayerInfo } from "./types";

export interface LayerMeta {
  label: string;
  color: string;
  order: number;
}

export const LAYER_META: Record<string, LayerMeta> = {
  wall_x_pos: { label: "Dinding X+ (Timur)", color: "#B8945A", order: 10 },
  wall_x_neg: { label: "Dinding X- (Barat)", color: "#A98254", order: 11 },
  wall_y_pos: { label: "Dinding Y+ (Utara)", color: "#B79C6F", order: 12 },
  wall_y_neg: { label: "Dinding Y- (Selatan)", color: "#9E835B", order: 13 },
  cor_lantai: { label: "Cor Lantai", color: "#8F979C", order: 20 },
  keramik_lantai: { label: "Keramik Lantai", color: "#A9A49B", order: 21 },
  floor: { label: "Lantai Lainnya", color: "#8A8378", order: 22 },
  piri_piri: { label: "Piri-Piri / Lambrisering", color: "#A97543", order: 30 },
  ceiling: { label: "Plafon Umum", color: "#9B9285", order: 31 },
  atap_spandek: { label: "Atap Spandek", color: "#7E4F43", order: 40 },
  perabung: { label: "Perabung / Bubungan", color: "#C8A96A", order: 41 },
  listplank: { label: "Listplank", color: "#8C7650", order: 42 },
  roof_slope: { label: "Atap Lainnya", color: "#705249", order: 43 },
  door: { label: "Pintu", color: "#9C6B44", order: 50 },
  window: { label: "Jendela", color: "#B8B3A8", order: 51 },
  kolom: { label: "Kolom", color: "#B6A27D", order: 60 },
  balok: { label: "Balok", color: "#C8A96A", order: 61 },
  structure: { label: "Struktur Lainnya", color: "#9B8B6D", order: 62 },
  cerucuk: { label: "Cerucuk", color: "#B8874A", order: 70 },
  sloof: { label: "Balok Sloof", color: "#9F7D50", order: 71 },
  pondasi_batu: { label: "Pas. Batu Kali/Kosong", color: "#8E7A63", order: 72 },
  urugan: { label: "Urugan / Tanah / Pasir", color: "#76553A", order: 73 },
  foundation: { label: "Pondasi Lainnya", color: "#6E604F", order: 74 },
  furniture: { label: "Furniture / Perabot", color: "#6D7278", order: 80 },
  notasi_2d: { label: "Notasi 2D", color: "#65717D", order: 85 },
  other: { label: "Lainnya", color: "#9AA6B2", order: 99 }
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
  const roofLike = /atap|roof|spandek|bubungan|perabung|listplank|top roof|upper roof/.test(n);
  const floorLike = /cor lantai|keramik lantai|lantai keramik|floor finish|slab floor|pelat lantai|base floor|floor assembly|ubin|parket/.test(n);
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
  if (/cerucuk|timber pile|support pile|foundation support|piles?/.test(n)) return "cerucuk";
  if (/batu kali|batu kosong/.test(n)) return "pondasi_batu";
  if (/penggali|urugan|urug|tanah timbun|tanah urug/.test(n)) return "urugan";
  if (/pondasi/.test(n)) return "foundation";
  if (roofLike && !/cor lantai|keramik lantai|lantai keramik/.test(n)) return "atap_spandek";
  if (/cor lantai/.test(n)) return "cor_lantai";
  if (/keramik lantai|lantai keramik|ubin|parket/.test(n)) return "keramik_lantai";
  if (floorLike) return "floor";
  return null;
}

export function resolveVisGroup(surfaceType?: string, parentVisGroup?: string | null) {
  if (parentVisGroup) return parentVisGroup;
  if (surfaceType && LAYER_META[surfaceType]) return surfaceType;
  return "other";
}
