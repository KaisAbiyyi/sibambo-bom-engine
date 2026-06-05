export type AnalysisMode =
  | "overview"
  | "assembly"
  | "load-path"
  | "section-scan"
  | "material-map"
  | "component-focus";

export interface CameraPreset {
  theta: number;
  phi: number;
  rFactor: number;
  targetYBias: number;
}

export interface ComponentDefinition {
  id: string;
  label: string;
  shortLabel: string;
  system: string;
  role: string;
  material: string;
  description: string;
  include: RegExp[];
  exclude: RegExp[];
  color: string;
  connected: string[];
  camera: CameraPreset;
}

export const MODE_LABELS: Record<AnalysisMode, string> = {
  overview: "Overview",
  assembly: "Assembly",
  "load-path": "Load Path",
  "section-scan": "Section Scan",
  "material-map": "Material Map",
  "component-focus": "Component Focus"
};

export const TIMELINE_IDS = [
  "atap_spandek",
  "perabung",
  "plafon",
  "pintu",
  "jendela",
  "dinding_bata",
  "balok_ring",
  "kolom",
  "keramik_lantai",
  "cor_lantai",
  "urugan",
  "sloof",
  "pondasi_batu",
  "cerucuk",
  "hasil_final"
];

export const LOAD_PATH_IDS = [
  "atap_spandek",
  "perabung",
  "balok_ring",
  "kolom",
  "sloof",
  "pondasi_batu",
  "cerucuk",
  "urugan"
];

export const COMPONENTS: ComponentDefinition[] = [
  {
    id: "cerucuk",
    label: "Cerucuk",
    shortLabel: "Cerucuk",
    system: "Pile Support",
    role: "Ground support / load transfer",
    material: "Ground / timber pile",
    description: "Elemen penopang vertikal di bawah pondasi untuk membantu stabilisasi dan transfer beban ke tanah.",
    include: [/cerucuk/, /timber pile/, /support pile/, /foundation support/, /\bpiles?\b/],
    exclude: [/pondasi batu kali/],
    color: "#A66B32",
    connected: ["pondasi_batu", "urugan"],
    camera: { theta: 0.28, phi: 1.32, rFactor: 0.66, targetYBias: -0.5 }
  },
  {
    id: "pondasi_batu",
    label: "Pondasi Batu Kali",
    shortLabel: "Pondasi",
    system: "Foundation",
    role: "Load distribution to ground",
    material: "Stone foundation",
    description: "Pondasi yang menyalurkan beban bangunan ke tanah pendukung.",
    include: [/pondasi batu kali/, /batu kali/, /stone foundation/, /\bfoundation\b/, /batu kosong/],
    exclude: [/cerucuk/, /\bpile/, /sloof/],
    color: "#92400E",
    connected: ["sloof", "cerucuk", "urugan"],
    camera: { theta: 0.2, phi: 1.16, rFactor: 0.9, targetYBias: -0.36 }
  },
  {
    id: "sloof",
    label: "Balok Sloof",
    shortLabel: "Sloof",
    system: "Lower Structural Tie",
    role: "Foundation tie beam",
    material: "Concrete",
    description: "Balok bawah yang mengikat pondasi dan menjadi tumpuan elemen vertikal.",
    include: [/balok sloof/, /\bsloof\b/, /tie beam/],
    exclude: [/balok ring/, /ring beam/],
    color: "#B45309",
    connected: ["kolom", "pondasi_batu"],
    camera: { theta: 0.16, phi: 1.08, rFactor: 0.86, targetYBias: -0.34 }
  },
  {
    id: "urugan",
    label: "Urugan & Timbunan",
    shortLabel: "Urugan",
    system: "Ground Preparation",
    role: "Ground leveling/support",
    material: "Ground fill",
    description: "Lapisan tanah pengisi dan perataan untuk mendukung sistem lantai dan pondasi.",
    include: [/urugan/, /timbunan/, /\bfill\b/, /backfill/, /ground fill/, /tanah urug/, /tanah timbun/, /pasir urug/],
    exclude: [/pondasi/, /cerucuk/, /sloof/],
    color: "#8B5A2B",
    connected: ["cor_lantai", "pondasi_batu", "cerucuk"],
    camera: { theta: 0.16, phi: 1.0, rFactor: 0.92, targetYBias: -0.3 }
  },
  {
    id: "cor_lantai",
    label: "Cor Lantai",
    shortLabel: "Cor Lantai",
    system: "Floor Assembly",
    role: "Floor base / slab",
    material: "Concrete floor",
    description: "Lapisan beton dasar lantai sebagai bidang struktur bawah finishing.",
    include: [/cor lantai/, /\bslab\b/, /pelat lantai/, /concrete floor/, /lantai beton/],
    exclude: [/atap/, /roof/, /plafon/, /ceiling/, /keramik/],
    color: "#7A8792",
    connected: ["keramik_lantai", "urugan"],
    camera: { theta: 0.38, phi: 0.84, rFactor: 0.82, targetYBias: -0.28 }
  },
  {
    id: "keramik_lantai",
    label: "Keramik Lantai",
    shortLabel: "Keramik",
    system: "Floor Finish",
    role: "Floor surface finish",
    material: "Floor tile",
    description: "Lapisan finishing permukaan lantai.",
    include: [/keramik/, /\btile\b/, /floor finish/, /finishing lantai/, /lantai keramik/, /\bubin\b/],
    exclude: [/atap/, /plafon/, /roof/, /ceiling/],
    color: "#98A2AA",
    connected: ["cor_lantai"],
    camera: { theta: 0.36, phi: 0.82, rFactor: 0.8, targetYBias: -0.22 }
  },
  {
    id: "kolom",
    label: "Kolom",
    shortLabel: "Kolom",
    system: "Vertical Structure",
    role: "Vertical load transfer",
    material: "Concrete",
    description: "Elemen struktur vertikal yang menyalurkan beban dari balok dan elemen atas menuju pondasi.",
    include: [/\bkolom\b/, /\bcolumn\b/, /\bpillar\b/],
    exclude: [/balok/, /sloof/, /pondasi/],
    color: "#2563EB",
    connected: ["balok_ring", "sloof", "pondasi_batu"],
    camera: { theta: 1.12, phi: 0.78, rFactor: 0.94, targetYBias: 0.02 }
  },
  {
    id: "balok_ring",
    label: "Balok Ring",
    shortLabel: "Ring Beam",
    system: "Upper Structural Frame",
    role: "Upper structural tie",
    material: "Concrete",
    description: "Balok pengikat bagian atas dinding yang membantu mendistribusikan beban ke kolom.",
    include: [/balok ring/, /ring beam/, /ringbalk/, /ring balk/, /\bbalok\b/],
    exclude: [/sloof/, /kolom/, /pondasi/],
    color: "#1D4ED8",
    connected: ["kolom", "dinding_bata", "atap_spandek"],
    camera: { theta: 1.0, phi: 0.56, rFactor: 1.02, targetYBias: 0.1 }
  },
  {
    id: "dinding_bata",
    label: "Dinding Bata",
    shortLabel: "Dinding",
    system: "Wall Envelope",
    role: "Building enclosure",
    material: "Masonry",
    description: "Elemen pembatas ruang dan bidang pengisi struktur.",
    include: [/dinding/, /\bbata\b/, /\bwall\b/, /masonry/],
    exclude: [/pintu/, /jendela/, /kolom/, /balok/, /sloof/, /atap/, /lantai/],
    color: "#D38B5D",
    connected: ["kolom", "balok_ring", "sloof", "pintu", "jendela"],
    camera: { theta: 0.08, phi: 0.86, rFactor: 1.14, targetYBias: 0.04 }
  },
  {
    id: "pintu",
    label: "Pintu",
    shortLabel: "Pintu",
    system: "Opening System",
    role: "Access",
    material: "Door assembly",
    description: "Elemen akses utama pada bidang dinding.",
    include: [/pintu/, /\bdoor\b/, /^p\d{4}/],
    exclude: [/jendela/, /window/],
    color: "#A65F36",
    connected: ["dinding_bata"],
    camera: { theta: 0.02, phi: 0.9, rFactor: 0.82, targetYBias: 0.02 }
  },
  {
    id: "jendela",
    label: "Jendela",
    shortLabel: "Jendela",
    system: "Opening System",
    role: "Ventilation / daylight opening",
    material: "Window assembly",
    description: "Bukaan dinding untuk cahaya dan sirkulasi udara.",
    include: [/jendela/, /\bwindow\b/, /^j\d{4}/],
    exclude: [/pintu/, /door/],
    color: "#5D8AA8",
    connected: ["dinding_bata"],
    camera: { theta: 0.08, phi: 0.88, rFactor: 0.9, targetYBias: 0.04 }
  },
  {
    id: "plafon",
    label: "Plafon",
    shortLabel: "Plafon",
    system: "Ceiling System",
    role: "Interior ceiling cover",
    material: "Ceiling finish",
    description: "Lapisan penutup bagian atas ruang dalam.",
    include: [/plafon/, /\bceiling\b/],
    exclude: [/atap/, /roof/, /lantai/, /floor/],
    color: "#A08B63",
    connected: ["atap_spandek"],
    camera: { theta: 0.8, phi: 0.44, rFactor: 1.0, targetYBias: 0.12 }
  },
  {
    id: "atap_spandek",
    label: "Atap Spandek",
    shortLabel: "Atap",
    system: "Roof System",
    role: "Weather protection",
    material: "Metal roofing",
    description: "Penutup atap metal yang melindungi bangunan dari cuaca.",
    include: [/atap/, /spandek/, /\broof\b/],
    exclude: [/plafon/, /ceiling/, /perabung/, /bubungan/, /ridge/],
    color: "#B05A43",
    connected: ["perabung", "balok_ring"],
    camera: { theta: 0.62, phi: 0.42, rFactor: 1.04, targetYBias: 0.24 }
  },
  {
    id: "perabung",
    label: "Perabung",
    shortLabel: "Perabung",
    system: "Roof System",
    role: "Ridge cap / roof peak closure",
    material: "Metal ridge",
    description: "Elemen puncak atap yang menutup sambungan atas bidang atap.",
    include: [/perabung/, /bubungan/, /\bridge\b/, /\bnok\b/],
    exclude: [/spandek/, /plafon/, /lantai/, /pondasi/],
    color: "#C28C3A",
    connected: ["atap_spandek"],
    camera: { theta: 0.56, phi: 0.32, rFactor: 0.82, targetYBias: 0.38 }
  },
  {
    id: "hasil_final",
    label: "Hasil Final",
    shortLabel: "Final",
    system: "Complete Building",
    role: "Full assembled structure",
    material: "All systems",
    description: "Seluruh komponen dikembalikan menjadi satu sistem bangunan utuh.",
    include: [],
    exclude: [],
    color: "#0F766E",
    connected: [],
    camera: { theta: 0.7, phi: 0.58, rFactor: 1.48, targetYBias: 0.02 }
  }
];

export const COMPONENT_BY_ID = Object.fromEntries(COMPONENTS.map((item) => [item.id, item])) as Record<
  string,
  ComponentDefinition
>;

export function componentForScanDepth(depth: number) {
  if (depth <= 15) return "atap_spandek";
  if (depth <= 25) return "plafon";
  if (depth <= 40) return "dinding_bata";
  if (depth <= 55) return "kolom";
  if (depth <= 68) return "cor_lantai";
  if (depth <= 80) return "sloof";
  if (depth <= 92) return "pondasi_batu";
  return "cerucuk";
}

export function normalizeName(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectComponentId(parts: Array<string | undefined | null>, parentId?: string | null) {
  if (parentId) return parentId;
  const text = normalizeName(parts.filter(Boolean).join(" "));
  if (!text) return null;

  for (const component of COMPONENTS) {
    if (component.id === "hasil_final") continue;
    if (component.exclude.some((pattern) => pattern.test(text))) continue;
    if (component.include.some((pattern) => pattern.test(text))) return component.id;
  }

  if (/wall x|wall y|surface wall|\bwall\b/.test(text)) return "dinding_bata";
  if (/\bfloor\b/.test(text)) return null;
  return null;
}
