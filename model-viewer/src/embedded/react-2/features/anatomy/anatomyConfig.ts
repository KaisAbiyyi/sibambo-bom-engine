const WALL_KEYS = ["wall_x_pos", "wall_x_neg", "wall_y_pos", "wall_y_neg"];
const ROOF_KEYS = ["perabung", "atap_spandek", "roof_slope", "listplank"];
const OPENING_KEYS = ["door", "window"];
const FLOOR_KEYS = ["keramik_lantai", "cor_lantai"];
const FRAME_KEYS = ["balok", "kolom", "structure"];
const FOUNDATION_KEYS = ["urugan", "sloof", "pondasi_batu", "foundation"];
const SUPERSTRUCTURE_KEYS = [...ROOF_KEYS, ...WALL_KEYS, ...OPENING_KEYS, ...FRAME_KEYS, "ceiling", "piri_piri"];

export const STORY_HIDDEN_LAYER_KEYS = ["notasi_2d", "furniture"];

export const MAJOR_STORY_LAYER_KEYS = [
  "perabung",
  "atap_spandek",
  "roof_slope",
  "listplank",
  "ceiling",
  "piri_piri",
  "door",
  "window",
  ...WALL_KEYS,
  "balok",
  "kolom",
  "keramik_lantai",
  "cor_lantai",
  "urugan",
  "sloof",
  "pondasi_batu",
  "cerucuk",
  "foundation",
  "floor",
  "structure",
  "other"
];

export interface AnatomySection {
  id: string;
  navLabel: string;
  category: string;
  color: string;
  title: string;
  desc: string;
  specStatic: Array<[string, string]>;
  cam: { theta: number; phi: number; rFactor: number; targetYBias: number };
  show: string[];
  context: string[];
  suppressKeys?: string[];
  explode?: number;
  focusMode?: "layer" | "complete";
}

export const SECTION_CONFIG: AnatomySection[] = [
  {
    id: "roof-system",
    navLabel: "Roof",
    category: "Roof System",
    color: "#8C7650",
    title: "Roof System",
    desc: "Layered roof assembly caps the structure with ridge, sheet, slope, and fascia elements.",
    specStatic: [["Material", "Metal roofing"], ["Role", "Weather cover"], ["Focus", "Upper envelope"]],
    cam: { theta: 0.62, phi: 0.42, rFactor: 1.06, targetYBias: 0.24 },
    show: ROOF_KEYS,
    context: [...WALL_KEYS, "balok"],
    explode: 0.08
  },
  {
    id: "wall-envelope",
    navLabel: "Wall",
    category: "Wall Envelope",
    color: "#B8945A",
    title: "Wall Envelope",
    desc: "Wall planes, doors, and windows form the enclosure while keeping the frame legible.",
    specStatic: [["Material", "Masonry + openings"], ["Role", "Spatial enclosure"], ["Focus", "Envelope continuity"]],
    cam: { theta: 0.12, phi: 0.84, rFactor: 1.18, targetYBias: 0.04 },
    show: [...WALL_KEYS, ...OPENING_KEYS],
    context: ["kolom", "balok", "keramik_lantai"],
    suppressKeys: ROOF_KEYS,
    explode: 0.06
  },
  {
    id: "floor-assembly",
    navLabel: "Floor",
    category: "Floor Assembly",
    color: "#9B9285",
    title: "Floor Assembly",
    desc: "Floor finish and concrete layers define the occupied plane over the prepared substructure.",
    specStatic: [["Material", "Ceramic + concrete"], ["Role", "Occupancy plane"], ["Focus", "Layer buildup"]],
    cam: { theta: 0.38, phi: 0.84, rFactor: 0.82, targetYBias: -0.28 },
    show: FLOOR_KEYS,
    context: ["kolom", "sloof", "urugan"],
    suppressKeys: [...ROOF_KEYS, ...WALL_KEYS, ...OPENING_KEYS, "floor", "ceiling", "piri_piri"],
    explode: 0.08
  },
  {
    id: "structural-frame",
    navLabel: "Frame",
    category: "Structural Frame",
    color: "#C8A96A",
    title: "Balok Ring",
    desc: "Ring beam and column system ties the wall structure and distributes load through the frame.",
    specStatic: [["Material", "Beton"], ["Role", "Load transfer"], ["Focus", "Upper structural tie"]],
    cam: { theta: 1.08, phi: 0.62, rFactor: 1.02, targetYBias: 0.08 },
    show: FRAME_KEYS,
    context: ["keramik_lantai", "cor_lantai", "sloof"],
    suppressKeys: ROOF_KEYS,
    explode: 0.1
  },
  {
    id: "foundation-system",
    navLabel: "Foundation",
    category: "Foundation System",
    color: "#A98254",
    title: "Foundation System",
    desc: "Broad substructure layers collect building load before it reaches the supporting ground.",
    specStatic: [["Layer", "Substructure"], ["Role", "Base support"], ["Focus", "Foundation network"]],
    cam: { theta: 0.18, phi: 1.16, rFactor: 0.92, targetYBias: -0.36 },
    show: FOUNDATION_KEYS,
    context: ["cerucuk", "kolom"],
    suppressKeys: [...ROOF_KEYS, ...WALL_KEYS, ...OPENING_KEYS, ...FLOOR_KEYS],
    explode: 0.1
  },
  {
    id: "cerucuk",
    navLabel: "Cerucuk",
    category: "Foundation System",
    color: "#B8874A",
    title: "Cerucuk Foundation Support",
    desc: "Vertical pile elements stabilize the lower structural system and transfer load into the supporting ground layer.",
    specStatic: [["Layer", "Substructure"], ["Role", "Ground support"], ["Focus", "Load transfer"]],
    cam: { theta: 0.28, phi: 1.32, rFactor: 0.66, targetYBias: -0.5 },
    show: ["cerucuk"],
    context: [],
    suppressKeys: [
      ...ROOF_KEYS,
      ...WALL_KEYS,
      ...OPENING_KEYS,
      ...FLOOR_KEYS,
      ...FRAME_KEYS,
      ...FOUNDATION_KEYS
    ],
    explode: 0.06
  },
  {
    id: "complete-system",
    navLabel: "Final",
    category: "Final Complete House",
    color: "#C8A96A",
    title: "Hasil Akhir Rumah",
    desc: "All major architectural layers resolve into one complete structural house model.",
    specStatic: [
      ["Layer", "Complete model"],
      ["Role", "System overview"],
      ["Focus", "Full building"]
    ],
    cam: { theta: 0.68, phi: 0.56, rFactor: 1.5, targetYBias: 0.03 },
    show: MAJOR_STORY_LAYER_KEYS,
    context: [],
    explode: 0,
    focusMode: "complete"
  }
];
