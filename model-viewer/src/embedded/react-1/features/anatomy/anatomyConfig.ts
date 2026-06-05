const WALL_KEYS = ["wall_x_pos", "wall_x_neg", "wall_y_pos", "wall_y_neg"];
const ROOF_KEYS = ["perabung", "atap_spandek", "roof_slope", "listplank"];
const OPENING_KEYS = ["door", "window"];
const FLOOR_KEYS = ["keramik_lantai", "cor_lantai", "floor", "ceiling", "piri_piri"];
const SUPERSTRUCTURE_KEYS = [...ROOF_KEYS, ...WALL_KEYS, ...OPENING_KEYS, "balok", "kolom", "ceiling", "piri_piri"];

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
  category: string;
  color: string;
  title: string;
  subtitle: string;
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
    id: "perabung",
    category: "ATAP",
    color: "#EF4444",
    title: "Perabung",
    subtitle: "Bubungan / Ridge Cap",
    desc: "Penutup puncak pertemuan dua bidang atap yang menyegel celah agar air hujan tidak masuk ke dalam bangunan.",
    specStatic: [["Posisi", "Puncak atap"], ["Material", "Metal profil"]],
    cam: { theta: 0.5, phi: 0.22, rFactor: 0.8, targetYBias: 0.4 },
    show: ["perabung"],
    context: ["atap_spandek", "roof_slope", "listplank"],
    explode: 0.18
  },
  {
    id: "atap_spandek",
    category: "ATAP",
    color: "#DC2626",
    title: "Atap Spandek",
    subtitle: "Lembaran baja bergelombang",
    desc: "Material atap baja ringan bergelombang yang ringan, kuat, dan tahan karat.",
    specStatic: [["Material", "BJLS / Zincalume"], ["Kemiringan", ">= 15 derajat"]],
    cam: { theta: 0.7, phi: 0.5, rFactor: 1.1, targetYBias: 0.22 },
    show: ["atap_spandek", "roof_slope"],
    context: ["perabung", "listplank", ...WALL_KEYS, "balok"],
    explode: 0.16
  },
  {
    id: "ceiling",
    category: "PLAFON",
    color: "#EAB308",
    title: "Plafon & Piri-Piri",
    subtitle: "Lambrisering kayu",
    desc: "Bilah kayu tipis yang disusun berderet, menciptakan efek visual berirama dan hangat.",
    specStatic: [["Material", "Bilah kayu / tripleks"], ["Tinggi", "+/- 2.8 m"]],
    cam: { theta: 0.85, phi: 0.33, rFactor: 1.05, targetYBias: 0.18 },
    show: ["ceiling", "piri_piri"],
    context: [...WALL_KEYS, "kolom", "keramik_lantai"],
    suppressKeys: ROOF_KEYS,
    explode: 0.12
  },
  {
    id: "door",
    category: "BUKAAN",
    color: "#C2410C",
    title: "Pintu",
    subtitle: "Pintu panel kayu 3D",
    desc: "Pintu panel kayu solid dengan konstruksi 3D dan kusen kayu yang dipasang ke dinding.",
    specStatic: [["Material", "Kayu kamper / meranti"], ["Ukuran", "80 x 240 cm"]],
    cam: { theta: 0.05, phi: 0.86, rFactor: 0.82, targetYBias: 0.02 },
    show: ["door"],
    context: [...WALL_KEYS, "kolom", "window"],
    explode: 0.08
  },
  {
    id: "window",
    category: "BUKAAN",
    color: "#06B6D4",
    title: "Jendela",
    subtitle: "Jendela aluminium",
    desc: "Bukaan untuk sirkulasi udara alami dan pencahayaan ke dalam ruangan.",
    specStatic: [["Material", "Aluminium + kaca"], ["Kaca", "5 mm"]],
    cam: { theta: 0.12, phi: 0.88, rFactor: 0.9, targetYBias: 0.05 },
    show: ["window"],
    context: [...WALL_KEYS, "kolom", "door"],
    explode: 0.08
  },
  {
    id: "wall",
    category: "DINDING",
    color: "#D97706",
    title: "Dinding Bata",
    subtitle: "Bata + plester + cat",
    desc: "Penutup vertikal yang membentuk ruang, privasi, dan isolasi termal.",
    specStatic: [["Mortar", "1 PC : 4 PP"], ["Plester", "2.5 cm"]],
    cam: { theta: 0, phi: 0.87, rFactor: 1.22, targetYBias: 0.05 },
    show: [...WALL_KEYS],
    context: ["kolom", "keramik_lantai", "window", "door"],
    explode: 0.08
  },
  {
    id: "balok",
    category: "STRUKTUR",
    color: "#3B82F6",
    title: "Balok Ring",
    subtitle: "Ring beam 20 x 30 cm",
    desc: "Balok beton bertulang yang mengikat puncak seluruh kolom dan dinding.",
    specStatic: [["Dimensi", "20 x 30 cm"], ["Beton", "K-225"]],
    cam: { theta: 1, phi: 0.52, rFactor: 1.08, targetYBias: 0.12 },
    show: ["balok"],
    context: ["kolom", "keramik_lantai", "cor_lantai"],
    explode: 0.1
  },
  {
    id: "kolom",
    category: "STRUKTUR",
    color: "#2563EB",
    title: "Kolom",
    subtitle: "Kolom struktural K1",
    desc: "Elemen vertikal utama yang menerima dan menyalurkan beban dari balok dan pelat ke pondasi.",
    specStatic: [["Dimensi", "20 x 20 cm"], ["Beton", "K-225"]],
    cam: { theta: 1.35, phi: 0.86, rFactor: 0.98, targetYBias: 0.02 },
    show: ["kolom"],
    context: ["balok", "keramik_lantai", "cor_lantai", "sloof"],
    explode: 0.08
  },
  {
    id: "keramik_lantai",
    category: "LANTAI",
    color: "#14B8A6",
    title: "Keramik Lantai",
    subtitle: "Finishing lantai",
    desc: "Lapisan finishing yang dipasang di atas beton menggunakan mortar perekat.",
    specStatic: [["Ukuran", "40 x 40 cm"], ["Nat", "3 mm"]],
    cam: { theta: 0.05, phi: 0.62, rFactor: 0.95, targetYBias: -0.18 },
    show: ["keramik_lantai"],
    context: ["cor_lantai", "kolom"],
    suppressKeys: ROOF_KEYS,
    explode: 0.08
  },
  {
    id: "cor_lantai",
    category: "LANTAI",
    color: "#64748B",
    title: "Cor Lantai",
    subtitle: "Pelat beton lantai dasar",
    desc: "Pelat beton cor sebagai dasar struktural lantai.",
    specStatic: [["Tebal", "10-12 cm"], ["Beton", "K-225"]],
    cam: { theta: 0.05, phi: 0.72, rFactor: 0.88, targetYBias: -0.23 },
    show: ["cor_lantai"],
    context: ["urugan", "kolom"],
    suppressKeys: [...ROOF_KEYS, ...WALL_KEYS, ...OPENING_KEYS, "keramik_lantai"],
    explode: 0.08
  },
  {
    id: "urugan",
    category: "PONDASI",
    color: "#854D0E",
    title: "Urugan & Timbunan",
    subtitle: "Pasir urug dan tanah timbun",
    desc: "Lapisan urugan mengisi ruang antara sloof dan pelat lantai membentuk bidang stabil.",
    specStatic: [["Material", "Pasir + tanah pilihan"], ["Pemadatan", "Per lapis 20 cm"]],
    cam: { theta: 0.07, phi: 1.05, rFactor: 0.88, targetYBias: -0.3 },
    show: ["urugan"],
    context: ["sloof", "pondasi_batu"],
    suppressKeys: [...SUPERSTRUCTURE_KEYS, ...FLOOR_KEYS],
    explode: 0.1
  },
  {
    id: "sloof",
    category: "PONDASI",
    color: "#B45309",
    title: "Balok Sloof",
    subtitle: "Ground beam",
    desc: "Balok beton bertulang yang menghubungkan seluruh kepala pondasi menjadi satu kesatuan.",
    specStatic: [["Dimensi", "20 x 30 cm"], ["Beton", "K-225"]],
    cam: { theta: 0.07, phi: 1.18, rFactor: 0.88, targetYBias: -0.36 },
    show: ["sloof"],
    context: ["pondasi_batu", "cerucuk"],
    suppressKeys: [...SUPERSTRUCTURE_KEYS, ...FLOOR_KEYS, "urugan"],
    explode: 0.12
  },
  {
    id: "pondasi_batu",
    category: "PONDASI",
    color: "#A16207",
    title: "Pondasi Batu Kali",
    subtitle: "Pasangan batu kali",
    desc: "Pondasi trapesium dari batu kali bermortir yang meneruskan beban ke tanah dasar.",
    specStatic: [["Material", "Batu kali + mortar"], ["Bentuk", "Trapesium"]],
    cam: { theta: 0.07, phi: 1.28, rFactor: 0.82, targetYBias: -0.42 },
    show: ["pondasi_batu"],
    context: ["cerucuk", "sloof"],
    suppressKeys: [...SUPERSTRUCTURE_KEYS, ...FLOOR_KEYS, "urugan"],
    explode: 0.14
  },
  {
    id: "cerucuk",
    category: "PONDASI",
    color: "#92400E",
    title: "Cerucuk",
    subtitle: "Tiang pancang kayu",
    desc: "Tiang kayu keras yang dipancangkan vertikal jauh ke dalam tanah lunak.",
    specStatic: [["Material", "Kayu keras lokal"], ["Dimensi", "Diameter 8-12 cm"]],
    cam: { theta: 0.06, phi: 1.38, rFactor: 0.72, targetYBias: -0.48 },
    show: ["cerucuk"],
    context: [],
    suppressKeys: [...SUPERSTRUCTURE_KEYS, ...FLOOR_KEYS, "urugan", "sloof", "pondasi_batu"],
    explode: 0.14
  },
  {
    id: "complete-system",
    category: "SISTEM",
    color: "#0F766E",
    title: "Hasil Akhir Rumah",
    subtitle: "Rekomposisi seluruh lapisan konstruksi",
    desc: "Setelah setiap lapisan struktur diperlihatkan, model dikembalikan menjadi satu sistem bangunan utuh.",
    specStatic: [
      ["Status", "Semua lapisan utama terlihat"],
      ["Mode", "Model lengkap"]
    ],
    cam: { theta: 0.68, phi: 0.56, rFactor: 1.58, targetYBias: 0.04 },
    show: MAJOR_STORY_LAYER_KEYS,
    context: [],
    explode: 0,
    focusMode: "complete"
  }
];
