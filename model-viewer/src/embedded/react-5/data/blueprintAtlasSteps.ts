export interface CameraPreset {
  theta: number;
  phi: number;
  rFactor: number;
  targetYBias: number;
}

export interface AtlasStep {
  id: string;
  number: number;
  label: string;
  shortLabel: string;
  system: string;
  role: string;
  description: string;
  connected: string[];
  include: RegExp[];
  exclude: RegExp[];
  color: string;
  callout: { x: number; y: number };
  leader: { x1: number; y1: number; x2: number; y2: number };
  camera: CameraPreset;
  explodeGroup: string;
  explodeOffset: { x: number; y: number; z: number };
  blockers: string[];
}

export const ATLAS_ORDER = [
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
] as const;

const atlasSteps: Omit<AtlasStep, "number">[] = [
  {
    id: "atap_spandek",
    label: "Atap Spandek",
    shortLabel: "Atap",
    system: "Roof Cover",
    role: "Weather protection",
    description: "Bidang penutup atap metal yang melindungi bangunan dari panas dan hujan.",
    connected: ["perabung", "balok_ring"],
    include: [/atap/, /spandek/, /\broof\b/],
    exclude: [/perabung/, /bubungan/, /plafon/, /ceiling/, /lantai/, /floor/, /pondasi/, /cerucuk/],
    color: "#63A4FF",
    callout: { x: 38, y: 24 },
    leader: { x1: 38, y1: 26, x2: 46, y2: 34 },
    camera: { theta: 0.64, phi: 0.38, rFactor: 1.0, targetYBias: 0.26 },
    explodeGroup: "roof",
    explodeOffset: { x: 0, y: 0.35, z: 0 },
    blockers: []
  },
  {
    id: "perabung",
    label: "Perabung",
    shortLabel: "Ridge",
    system: "Roof Ridge",
    role: "Ridge cap",
    description: "Elemen penutup puncak atap pada pertemuan bidang atap.",
    connected: ["atap_spandek"],
    include: [/perabung/, /bubungan/, /\bridge\b/, /\bnok\b/],
    exclude: [/spandek/, /plafon/, /lantai/, /pondasi/],
    color: "#D6A84F",
    callout: { x: 46, y: 14 },
    leader: { x1: 50, y1: 20, x2: 52, y2: 31 },
    camera: { theta: 0.58, phi: 0.3, rFactor: 0.78, targetYBias: 0.4 },
    explodeGroup: "ridge",
    explodeOffset: { x: 0, y: 0.48, z: 0 },
    blockers: []
  },
  {
    id: "plafon",
    label: "Plafon",
    shortLabel: "Plafon",
    system: "Ceiling Layer",
    role: "Interior upper cover",
    description: "Lapisan penutup bagian atas ruang dalam di bawah sistem atap.",
    connected: ["atap_spandek", "dinding_bata"],
    include: [/plafon/, /\bceiling\b/],
    exclude: [/atap/, /roof/, /lantai/, /floor/],
    color: "#B7E4C7",
    callout: { x: 77, y: 23 },
    leader: { x1: 76, y1: 26, x2: 59, y2: 40 },
    camera: { theta: 0.88, phi: 0.5, rFactor: 0.95, targetYBias: 0.08 },
    explodeGroup: "ceiling",
    explodeOffset: { x: 0, y: 0.18, z: 0 },
    blockers: ["atap_spandek", "perabung"]
  },
  {
    id: "pintu",
    label: "Pintu",
    shortLabel: "Pintu",
    system: "Opening",
    role: "Access",
    description: "Elemen akses utama pada bidang dinding.",
    connected: ["dinding_bata"],
    include: [/pintu/, /\bdoor\b/, /^p\d{4}/],
    exclude: [/jendela/, /window/],
    color: "#D95C4B",
    callout: { x: 82, y: 39 },
    leader: { x1: 81, y1: 41, x2: 62, y2: 53 },
    camera: { theta: 0.02, phi: 0.9, rFactor: 0.82, targetYBias: 0.02 },
    explodeGroup: "openings",
    explodeOffset: { x: 0, y: 0.02, z: 0.12 },
    blockers: ["atap_spandek", "perabung"]
  },
  {
    id: "jendela",
    label: "Jendela",
    shortLabel: "Jendela",
    system: "Opening",
    role: "Daylight and ventilation",
    description: "Bukaan pada dinding untuk pencahayaan dan sirkulasi udara.",
    connected: ["dinding_bata"],
    include: [/jendela/, /\bwindow\b/, /^j\d{4}/],
    exclude: [/pintu/, /door/],
    color: "#D95C4B",
    callout: { x: 81, y: 55 },
    leader: { x1: 80, y1: 55, x2: 63, y2: 52 },
    camera: { theta: 0.08, phi: 0.88, rFactor: 0.88, targetYBias: 0.04 },
    explodeGroup: "openings",
    explodeOffset: { x: 0.12, y: 0.02, z: 0.12 },
    blockers: ["atap_spandek", "perabung"]
  },
  {
    id: "dinding_bata",
    label: "Dinding Bata",
    shortLabel: "Dinding",
    system: "Wall Envelope",
    role: "Space enclosure",
    description: "Elemen pembentuk ruang dan pembatas bangunan.",
    connected: ["pintu", "jendela", "kolom", "balok_ring"],
    include: [/dinding/, /\bbata\b/, /\bwall\b/, /masonry/],
    exclude: [/pintu/, /jendela/, /kolom/, /balok/, /sloof/, /atap/, /lantai/],
    color: "#EAF4FF",
    callout: { x: 13, y: 45 },
    leader: { x1: 28, y1: 45, x2: 43, y2: 50 },
    camera: { theta: 0.08, phi: 0.86, rFactor: 1.12, targetYBias: 0.04 },
    explodeGroup: "wall",
    explodeOffset: { x: -0.08, y: 0, z: 0.08 },
    blockers: ["atap_spandek", "perabung"]
  },
  {
    id: "balok_ring",
    label: "Balok Ring",
    shortLabel: "Ring",
    system: "Upper Structural Tie",
    role: "Upper load distribution",
    description: "Balok pengikat atas yang membantu distribusi beban ke kolom.",
    connected: ["kolom", "dinding_bata", "atap_spandek"],
    include: [/balok ring/, /ring beam/, /ringbalk/, /ring balk/],
    exclude: [/sloof/, /kolom/, /pondasi/],
    color: "#7CB7FF",
    callout: { x: 12, y: 34 },
    leader: { x1: 28, y1: 35, x2: 45, y2: 43 },
    camera: { theta: 1.0, phi: 0.56, rFactor: 1.0, targetYBias: 0.1 },
    explodeGroup: "frame",
    explodeOffset: { x: 0, y: 0.1, z: 0 },
    blockers: ["atap_spandek", "perabung"]
  },
  {
    id: "kolom",
    label: "Kolom",
    shortLabel: "Kolom",
    system: "Vertical Structure",
    role: "Vertical load transfer",
    description: "Elemen struktur vertikal yang menyalurkan beban dari balok dan elemen atas menuju pondasi.",
    connected: ["balok_ring", "sloof", "pondasi_batu"],
    include: [/\bkolom\b/, /\bcolumn\b/, /\bpillar\b/],
    exclude: [/balok/, /sloof/, /pondasi/],
    color: "#7CB7FF",
    callout: { x: 78, y: 66 },
    leader: { x1: 78, y1: 65, x2: 58, y2: 57 },
    camera: { theta: 1.12, phi: 0.78, rFactor: 0.9, targetYBias: 0.02 },
    explodeGroup: "frame",
    explodeOffset: { x: 0.03, y: 0.04, z: 0 },
    blockers: ["atap_spandek", "perabung", "dinding_bata", "pintu", "jendela"]
  },
  {
    id: "keramik_lantai",
    label: "Keramik Lantai",
    shortLabel: "Keramik",
    system: "Floor Finish",
    role: "Surface finish",
    description: "Lapisan finishing permukaan lantai.",
    connected: ["cor_lantai"],
    include: [/keramik/, /\btile\b/, /floor finish/, /finishing lantai/],
    exclude: [/atap/, /roof/, /plafon/, /ceiling/],
    color: "#F5EEDC",
    callout: { x: 74, y: 77 },
    leader: { x1: 73, y1: 75, x2: 57, y2: 62 },
    camera: { theta: 0.36, phi: 0.82, rFactor: 0.78, targetYBias: -0.22 },
    explodeGroup: "floor",
    explodeOffset: { x: 0, y: -0.08, z: 0 },
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring"]
  },
  {
    id: "cor_lantai",
    label: "Cor Lantai",
    shortLabel: "Cor",
    system: "Floor Base",
    role: "Concrete floor layer",
    description: "Lapisan dasar beton lantai sebelum finishing.",
    connected: ["keramik_lantai", "urugan"],
    include: [/cor lantai/, /\bslab\b/, /pelat lantai/, /concrete floor/, /lantai beton/],
    exclude: [/atap/, /roof/, /plafon/, /ceiling/, /keramik/],
    color: "#DDEEFF",
    callout: { x: 58, y: 84 },
    leader: { x1: 58, y1: 81, x2: 52, y2: 65 },
    camera: { theta: 0.38, phi: 0.84, rFactor: 0.8, targetYBias: -0.28 },
    explodeGroup: "floor",
    explodeOffset: { x: 0, y: -0.15, z: 0 },
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring"]
  },
  {
    id: "urugan",
    label: "Urugan & Timbunan",
    shortLabel: "Urugan",
    system: "Ground Preparation",
    role: "Ground fill",
    description: "Lapisan pengisi dan perataan bawah lantai.",
    connected: ["cor_lantai", "pondasi_batu"],
    include: [/urugan/, /timbunan/, /\bfill\b/, /backfill/, /ground fill/],
    exclude: [/pondasi/, /cerucuk/, /sloof/],
    color: "#B27A4B",
    callout: { x: 46, y: 89 },
    leader: { x1: 46, y1: 84, x2: 50, y2: 70 },
    camera: { theta: 0.16, phi: 1.0, rFactor: 0.88, targetYBias: -0.3 },
    explodeGroup: "ground",
    explodeOffset: { x: 0, y: -0.25, z: 0 },
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring", "kolom"]
  },
  {
    id: "sloof",
    label: "Balok Sloof",
    shortLabel: "Sloof",
    system: "Lower Structural Tie",
    role: "Foundation tie beam",
    description: "Balok bawah yang mengikat pondasi dan menjadi dasar elemen vertikal.",
    connected: ["kolom", "pondasi_batu"],
    include: [/balok sloof/, /\bsloof\b/, /tie beam/],
    exclude: [/balok ring/, /ring beam/],
    color: "#7CB7FF",
    callout: { x: 31, y: 84 },
    leader: { x1: 35, y1: 80, x2: 47, y2: 66 },
    camera: { theta: 0.16, phi: 1.08, rFactor: 0.82, targetYBias: -0.34 },
    explodeGroup: "foundation",
    explodeOffset: { x: 0, y: -0.32, z: 0 },
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring"]
  },
  {
    id: "pondasi_batu",
    label: "Pondasi Batu Kali",
    shortLabel: "Pondasi",
    system: "Foundation",
    role: "Load distribution to ground",
    description: "Elemen pondasi yang mendistribusikan beban bangunan ke tanah pendukung.",
    connected: ["sloof", "cerucuk", "urugan"],
    include: [/pondasi batu kali/, /batu kali/, /\bfoundation\b/, /stone foundation/],
    exclude: [/cerucuk/, /\bpile/, /sloof/],
    color: "#B27A4B",
    callout: { x: 16, y: 78 },
    leader: { x1: 28, y1: 76, x2: 45, y2: 69 },
    camera: { theta: 0.2, phi: 1.16, rFactor: 0.86, targetYBias: -0.36 },
    explodeGroup: "foundation",
    explodeOffset: { x: 0, y: -0.42, z: 0 },
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring", "kolom", "keramik_lantai", "cor_lantai"]
  },
  {
    id: "cerucuk",
    label: "Cerucuk",
    shortLabel: "Cerucuk",
    system: "Pile Support",
    role: "Ground support",
    description: "Elemen penopang vertikal di bawah pondasi untuk stabilisasi dan transfer beban ke tanah.",
    connected: ["pondasi_batu", "urugan"],
    include: [/cerucuk/, /timber pile/, /support pile/, /foundation support/, /\bpiles?\b/],
    exclude: [/pondasi batu kali/],
    color: "#8B5E34",
    callout: { x: 13, y: 88 },
    leader: { x1: 27, y1: 84, x2: 44, y2: 73 },
    camera: { theta: 0.28, phi: 1.32, rFactor: 0.66, targetYBias: -0.5 },
    explodeGroup: "piles",
    explodeOffset: { x: 0, y: -0.52, z: 0 },
    blockers: [
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
      "sloof"
    ]
  },
  {
    id: "hasil_final",
    label: "Hasil Final",
    shortLabel: "Final",
    system: "Complete Building",
    role: "Final recomposition",
    description: "Seluruh komponen dikembalikan sebagai satu sistem bangunan utuh.",
    connected: [],
    include: [],
    exclude: [],
    color: "#67B26F",
    callout: { x: 87, y: 86 },
    leader: { x1: 82, y1: 78, x2: 61, y2: 63 },
    camera: { theta: 0.7, phi: 0.58, rFactor: 1.48, targetYBias: 0.02 },
    explodeGroup: "final",
    explodeOffset: { x: 0, y: 0, z: 0 },
    blockers: []
  }
];

export const ATLAS_STEPS: AtlasStep[] = atlasSteps.map((step, index) => ({ ...step, number: index + 1 }));

export const ATLAS_STEP_BY_ID = Object.fromEntries(ATLAS_STEPS.map((step) => [step.id, step])) as Record<
  string,
  AtlasStep
>;

export function normalizeName(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectAtlasStepId(parts: Array<string | undefined | null>, parentId?: string | null) {
  if (parentId) return parentId;
  const text = normalizeName(parts.filter(Boolean).join(" "));
  if (!text) return null;

  for (const id of ATLAS_ORDER) {
    if (id === "hasil_final") continue;
    const step = ATLAS_STEP_BY_ID[id];
    if (step.exclude.some((pattern) => pattern.test(text))) continue;
    if (step.include.some((pattern) => pattern.test(text))) return step.id;
  }

  if (/wall x|wall y|surface wall|\bwall\b/.test(text)) return "dinding_bata";
  if (/\bfloor\b/.test(text)) return null;
  return null;
}
