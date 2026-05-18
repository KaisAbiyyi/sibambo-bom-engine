export interface CameraPreset {
  theta: number;
  phi: number;
  rFactor: number;
  targetYBias: number;
}

export interface InspectionStep {
  id: string;
  label: string;
  shortLabel: string;
  order: number;
  system: string;
  role: string;
  objective: string;
  fieldNote: string;
  checklist: string[];
  risk: string;
  include: RegExp[];
  exclude: RegExp[];
  connected: string[];
  blockers: string[];
  color: string;
  camera: CameraPreset;
}

export const INSPECTION_ORDER = [
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

const steps: Omit<InspectionStep, "order">[] = [
  {
    id: "atap_spandek",
    label: "Atap Spandek",
    shortLabel: "Atap",
    system: "Roof Cover",
    role: "Weather protection",
    objective: "Menampilkan bidang penutup atap utama sebagai lapisan pertama inspeksi.",
    fieldNote: "Atap spandek berfungsi melindungi bangunan dari panas dan hujan.",
    checklist: [
      "Arah kemiringan terbaca",
      "Bidang atap tidak menutup fokus komponen lain saat inspeksi turun",
      "Sambungan ke perabung dapat dipahami"
    ],
    risk: "Pastikan atap tidak terbaca sebagai lantai atau plafon.",
    include: [/atap/, /spandek/, /\broof\b/],
    exclude: [/perabung/, /bubungan/, /plafon/, /ceiling/, /lantai/, /floor/, /pondasi/, /cerucuk/],
    connected: ["perabung", "balok_ring"],
    blockers: [],
    color: "#E86F2D",
    camera: { theta: 0.64, phi: 0.38, rFactor: 1.0, targetYBias: 0.26 }
  },
  {
    id: "perabung",
    label: "Perabung",
    shortLabel: "Ridge",
    system: "Roof Ridge",
    role: "Ridge cap",
    objective: "Menunjukkan penutup puncak pertemuan bidang atap.",
    fieldNote: "Perabung menutup celah pada garis puncak atap.",
    checklist: [
      "Posisi berada di puncak atap",
      "Terhubung dengan bidang atap spandek",
      "Tidak salah masuk sebagai komponen lantai/plafon"
    ],
    risk: "Perabung harus terpisah dari bidang atap spandek.",
    include: [/perabung/, /bubungan/, /\bridge\b/, /\bnok\b/],
    exclude: [/spandek/, /plafon/, /lantai/, /pondasi/],
    connected: ["atap_spandek"],
    blockers: [],
    color: "#D8A31A",
    camera: { theta: 0.58, phi: 0.3, rFactor: 0.78, targetYBias: 0.4 }
  },
  {
    id: "plafon",
    label: "Plafon",
    shortLabel: "Plafon",
    system: "Ceiling Layer",
    role: "Interior upper cover",
    objective: "Menampilkan lapisan plafon setelah sistem atap.",
    fieldNote: "Plafon menjadi batas visual ruang dalam di bawah atap.",
    checklist: [
      "Atap disembunyikan bila menghalangi plafon",
      "Plafon tidak diklasifikasikan sebagai lantai",
      "Kamera memperlihatkan sisi bawah/ruang dalam"
    ],
    risk: "Atap dan roof surface harus kalah prioritas dari plafon.",
    include: [/plafon/, /\bceiling\b/],
    exclude: [/atap/, /roof/, /lantai/, /floor/],
    connected: ["dinding_bata"],
    blockers: ["atap_spandek", "perabung"],
    color: "#B8975B",
    camera: { theta: 0.88, phi: 0.5, rFactor: 0.95, targetYBias: 0.08 }
  },
  {
    id: "pintu",
    label: "Pintu",
    shortLabel: "Pintu",
    system: "Opening",
    role: "Access",
    objective: "Menunjukkan elemen akses pada bidang dinding.",
    fieldNote: "Pintu menjadi bukaan utama untuk sirkulasi penghuni.",
    checklist: ["Dinding tetap menjadi konteks", "Pintu tampil aktif", "Tidak bercampur dengan jendela"],
    risk: "Nama pintu dan jendela harus saling mengecualikan.",
    include: [/pintu/, /\bdoor\b/, /^p\d{4}/],
    exclude: [/jendela/, /window/],
    connected: ["dinding_bata"],
    blockers: ["atap_spandek", "perabung"],
    color: "#A65F36",
    camera: { theta: 0.02, phi: 0.9, rFactor: 0.82, targetYBias: 0.02 }
  },
  {
    id: "jendela",
    label: "Jendela",
    shortLabel: "Jendela",
    system: "Opening",
    role: "Daylight and ventilation",
    objective: "Menunjukkan bukaan cahaya dan ventilasi pada dinding.",
    fieldNote: "Jendela memperjelas fungsi bukaan pada envelope bangunan.",
    checklist: ["Dinding menjadi konteks", "Jendela tampil aktif", "Tidak bercampur dengan pintu"],
    risk: "Bukaan jendela tidak boleh bercampur dengan pintu.",
    include: [/jendela/, /\bwindow\b/, /^j\d{4}/],
    exclude: [/pintu/, /door/],
    connected: ["dinding_bata"],
    blockers: ["atap_spandek", "perabung"],
    color: "#4E86A6",
    camera: { theta: 0.08, phi: 0.88, rFactor: 0.88, targetYBias: 0.04 }
  },
  {
    id: "dinding_bata",
    label: "Dinding Bata",
    shortLabel: "Dinding",
    system: "Wall Envelope",
    role: "Space enclosure",
    objective: "Menampilkan bidang pembentuk ruang dan pembatas bangunan.",
    fieldNote: "Dinding bata menjadi pengisi sekaligus pembentuk envelope bangunan.",
    checklist: [
      "Pintu dan jendela terbaca sebagai bukaan",
      "Kolom tidak salah masuk sebagai dinding",
      "Roof blockers dapat dimute/hide"
    ],
    risk: "Kolom dan balok tidak boleh diklasifikasikan sebagai dinding.",
    include: [/dinding/, /\bbata\b/, /\bwall\b/, /masonry/],
    exclude: [/pintu/, /jendela/, /kolom/, /balok/, /sloof/, /atap/, /lantai/],
    connected: ["pintu", "jendela", "kolom", "balok_ring"],
    blockers: ["atap_spandek", "perabung"],
    color: "#C88358",
    camera: { theta: 0.08, phi: 0.86, rFactor: 1.12, targetYBias: 0.04 }
  },
  {
    id: "balok_ring",
    label: "Balok Ring",
    shortLabel: "Ring",
    system: "Upper Structural Tie",
    role: "Upper load distribution",
    objective: "Menunjukkan balok pengikat atas dinding dan struktur.",
    fieldNote: "Balok ring mengikat bagian atas dinding dan membantu distribusi beban ke kolom.",
    checklist: ["Terhubung ke kolom", "Terbaca sebagai elemen balok atas", "Tidak salah masuk ke balok sloof"],
    risk: "Balok ring harus dipisah dari balok sloof.",
    include: [/balok ring/, /ring beam/, /ringbalk/, /ring balk/],
    exclude: [/sloof/, /kolom/, /pondasi/],
    connected: ["kolom", "dinding_bata", "atap_spandek"],
    blockers: ["atap_spandek", "perabung"],
    color: "#2563EB",
    camera: { theta: 1.0, phi: 0.56, rFactor: 1.0, targetYBias: 0.1 }
  },
  {
    id: "kolom",
    label: "Kolom",
    shortLabel: "Kolom",
    system: "Vertical Structure",
    role: "Vertical load transfer",
    objective: "Menunjukkan elemen vertikal penyalur beban.",
    fieldNote: "Kolom menyalurkan beban dari balok dan elemen atas menuju pondasi.",
    checklist: [
      "Kolom terlihat vertikal",
      "Terhubung ke balok ring dan balok sloof",
      "Dinding dimute jika menghalangi"
    ],
    risk: "Dinding besar dapat menutup kolom, jadi perlu dimute/hide.",
    include: [/\bkolom\b/, /\bcolumn\b/, /\bpillar\b/],
    exclude: [/balok/, /sloof/, /pondasi/],
    connected: ["balok_ring", "sloof", "pondasi_batu"],
    blockers: ["atap_spandek", "perabung", "dinding_bata", "pintu", "jendela"],
    color: "#2563EB",
    camera: { theta: 1.12, phi: 0.78, rFactor: 0.9, targetYBias: 0.02 }
  },
  {
    id: "keramik_lantai",
    label: "Keramik Lantai",
    shortLabel: "Keramik",
    system: "Floor Finish",
    role: "Surface finish",
    objective: "Menampilkan lapisan finishing permukaan lantai.",
    fieldNote: "Keramik lantai menjadi lapisan akhir yang terlihat pada bidang lantai.",
    checklist: ["Roof/atap tidak tampil sebagai floor", "Cor lantai menjadi konteks", "Kamera fokus ke bidang lantai"],
    risk: "Atap dan plafon harus tersembunyi saat inspeksi lantai.",
    include: [/keramik/, /\btile\b/, /floor finish/, /finishing lantai/],
    exclude: [/atap/, /roof/, /plafon/, /ceiling/],
    connected: ["cor_lantai"],
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring"],
    color: "#8B96A0",
    camera: { theta: 0.36, phi: 0.82, rFactor: 0.78, targetYBias: -0.22 }
  },
  {
    id: "cor_lantai",
    label: "Cor Lantai",
    shortLabel: "Cor",
    system: "Floor Base",
    role: "Concrete floor layer",
    objective: "Menampilkan lapisan dasar beton lantai.",
    fieldNote: "Cor lantai menjadi lapisan dasar sebelum finishing lantai.",
    checklist: [
      "Keramik menjadi konteks atau dimute",
      "Atap dan plafon tersembunyi jika menghalangi",
      "Bidang lantai terbaca jelas"
    ],
    risk: "Cor lantai tidak boleh mengambil material keramik.",
    include: [/cor lantai/, /\bslab\b/, /pelat lantai/, /concrete floor/, /lantai beton/],
    exclude: [/atap/, /roof/, /plafon/, /ceiling/, /keramik/],
    connected: ["keramik_lantai", "urugan"],
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring"],
    color: "#6F7C86",
    camera: { theta: 0.38, phi: 0.84, rFactor: 0.8, targetYBias: -0.28 }
  },
  {
    id: "urugan",
    label: "Urugan & Timbunan",
    shortLabel: "Urugan",
    system: "Ground Preparation",
    role: "Ground fill",
    objective: "Menampilkan lapisan pengisi dan perataan bawah lantai.",
    fieldNote: "Urugan dan timbunan membantu membentuk bidang stabil di bawah sistem lantai.",
    checklist: ["Floor layer menjadi konteks", "Pondasi tidak salah aktif", "Kamera turun ke substructure"],
    risk: "Urugan tidak boleh tertukar dengan pondasi atau sloof.",
    include: [/urugan/, /timbunan/, /\bfill\b/, /backfill/, /ground fill/],
    exclude: [/pondasi/, /cerucuk/, /sloof/],
    connected: ["cor_lantai", "pondasi_batu", "cerucuk"],
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring", "kolom"],
    color: "#9B6A38",
    camera: { theta: 0.16, phi: 1.0, rFactor: 0.88, targetYBias: -0.3 }
  },
  {
    id: "sloof",
    label: "Balok Sloof",
    shortLabel: "Sloof",
    system: "Lower Structural Tie",
    role: "Foundation tie beam",
    objective: "Menampilkan balok pengikat bawah yang menghubungkan pondasi.",
    fieldNote: "Balok sloof mengikat pondasi dan menjadi dasar elemen vertikal.",
    checklist: ["Terbaca sebagai balok bawah", "Terhubung ke kolom dan pondasi", "Tidak salah masuk sebagai balok ring"],
    risk: "Sloof harus kalah prioritas dari balok ring saat nama memuat ring beam.",
    include: [/balok sloof/, /\bsloof\b/, /tie beam/],
    exclude: [/balok ring/, /ring beam/],
    connected: ["kolom", "pondasi_batu"],
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring"],
    color: "#B45309",
    camera: { theta: 0.16, phi: 1.08, rFactor: 0.82, targetYBias: -0.34 }
  },
  {
    id: "pondasi_batu",
    label: "Pondasi Batu Kali",
    shortLabel: "Pondasi",
    system: "Foundation",
    role: "Load distribution to ground",
    objective: "Menampilkan massa pondasi bawah bangunan.",
    fieldNote: "Pondasi batu kali mendistribusikan beban ke tanah pendukung.",
    checklist: ["Sloof menjadi konteks", "Cerucuk menjadi konteks bawah", "Upper house tidak menghalangi"],
    risk: "Foundation umum tidak boleh mengambil cerucuk.",
    include: [/pondasi batu kali/, /batu kali/, /\bfoundation\b/, /stone foundation/, /batu kosong/],
    exclude: [/cerucuk/, /\bpile/, /sloof/],
    connected: ["sloof", "cerucuk", "urugan"],
    blockers: ["atap_spandek", "perabung", "plafon", "dinding_bata", "balok_ring", "kolom", "keramik_lantai", "cor_lantai"],
    color: "#7A4A24",
    camera: { theta: 0.2, phi: 1.16, rFactor: 0.86, targetYBias: -0.36 }
  },
  {
    id: "cerucuk",
    label: "Cerucuk",
    shortLabel: "Cerucuk",
    system: "Pile Support",
    role: "Ground support",
    objective: "Menampilkan elemen penopang vertikal di bawah sistem pondasi.",
    fieldNote: "Cerucuk membantu menstabilkan struktur bawah dan menyalurkan beban ke tanah.",
    checklist: [
      "Tidak ada duplicate cerucuk",
      "Upper building blockers hidden",
      "Tidak membuat lag berat",
      "Kamera low angle foundation-level"
    ],
    risk: "Jangan tampilkan proxy dan original cerucuk bersamaan.",
    include: [/cerucuk/, /timber pile/, /support pile/, /foundation support/, /\bpiles?\b/],
    exclude: [/pondasi batu kali/],
    connected: ["pondasi_batu", "urugan"],
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
    ],
    color: "#7A4A24",
    camera: { theta: 0.28, phi: 1.32, rFactor: 0.66, targetYBias: -0.5 }
  },
  {
    id: "hasil_final",
    label: "Hasil Final",
    shortLabel: "Final",
    system: "Complete Building",
    role: "Final recomposition",
    objective: "Mengembalikan semua lapisan menjadi satu rumah utuh.",
    fieldNote: "Semua komponen ditampilkan kembali sebagai sistem bangunan lengkap.",
    checklist: ["Semua major layer terlihat", "Proxy/temporary groups hidden", "Model original bersih", "Kamera pullback"],
    risk: "Final harus memakai geometri original bersih tanpa duplicate pile.",
    include: [],
    exclude: [],
    connected: [],
    blockers: [],
    color: "#15803D",
    camera: { theta: 0.7, phi: 0.58, rFactor: 1.48, targetYBias: 0.02 }
  }
];

export const INSPECTION_STEPS: InspectionStep[] = steps.map((step, index) => ({ ...step, order: index + 1 }));

export const INSPECTION_STEP_BY_ID = Object.fromEntries(INSPECTION_STEPS.map((step) => [step.id, step])) as Record<
  string,
  InspectionStep
>;

export function normalizeName(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectInspectionStepId(parts: Array<string | undefined | null>, parentId?: string | null) {
  if (parentId) return parentId;
  const text = normalizeName(parts.filter(Boolean).join(" "));
  if (!text) return null;

  for (const id of INSPECTION_ORDER) {
    if (id === "hasil_final") continue;
    const step = INSPECTION_STEP_BY_ID[id];
    if (step.exclude.some((pattern) => pattern.test(text))) continue;
    if (step.include.some((pattern) => pattern.test(text))) return step.id;
  }

  if (/wall x|wall y|surface wall|\bwall\b/.test(text)) return "dinding_bata";
  if (/\bfloor\b/.test(text)) return null;
  return null;
}
