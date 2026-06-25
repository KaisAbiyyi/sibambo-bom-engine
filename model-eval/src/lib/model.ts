export type SurfaceKey =
	| 'wall_x_pos'
	| 'wall_x_neg'
	| 'wall_y_pos'
	| 'wall_y_neg'
	| 'floor'
	| 'ceiling'
	| 'roof_slope'
	| 'door'
	| 'window'
	| 'structure'
	| 'furniture'
	| 'other';

export type PartKey =
	| 'roof'
	| 'walls'
	| 'floor'
	| 'ceiling'
	| 'doors'
	| 'windows'
	| 'openings'
	| 'structure'
	| 'foundation'
	| 'earthwork'
	| 'furniture'
	| 'other';

export type AnalysisKind = 'lighting' | 'ac' | 'ottv' | 'thermal' | 'people' | 'wind';

export type RoomFunctionKey = 'retail' | 'gudang' | 'kantor' | 'pantry' | 'koridor' | 'servis';
export type MaterialKey =
	| 'brick_plaster'
	| 'concrete'
	| 'clear_glass'
	| 'tinted_glass'
	| 'spandek_no_insulation'
	| 'spandek_insulated';
export type LampPresetKey = 'led_panel' | 'led_bulb' | 'linear_led';
export type WindDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type Point3 = {
	x: number;
	y: number;
	z: number;
};

export type BomVector = {
	x: number;
	y: number;
	z: number;
};

export type BomVertex = {
	position: BomVector;
};

export type BomMaterial = {
	name?: string;
	display_name?: string;
	color?: {
		hex?: string;
	};
	texture?: {
		filename?: string;
		source_path?: string;
	};
	reflectance?: number;
};

export type BomEntity = {
	id?: string;
	name?: string;
	definition_name?: string;
	type?: string;
	children?: BomEntity[];
	vertices?: BomVertex[];
	holes?: BomVector[][];
	material_front?: BomMaterial | null;
	mat_color?: string | null;
	surface_type?: string;
	area_m2?: number;
	layer?: string;
	face_count?: number;
	category?: string;
	center?: BomVector;
	size?: {
		w?: number;
		h?: number;
		d?: number;
		x?: number;
		y?: number;
		z?: number;
	};
};

export type BomModelJson = {
	schema_version?: string;
	export_level?: string;
	exported_at?: string;
	entities?: BomEntity[];
	mesh?: CompactMesh;
	materials?: Record<string, BomMaterial> | BomMaterial[];
	metadata?: Record<string, unknown>;
	geometry_format?: string;
};

export type CompactMeshMaterial = {
	name?: string;
	display_name?: string;
	color?: {
		hex?: string;
	};
	texture?: {
		filename?: string;
		source_path?: string;
	};
};

export type CompactMesh = {
	version?: number;
	position_scale?: number;
	area_scale?: number;
	normal_scale?: number;
	face_stride?: number;
	binary_layout?: string;
	position_count?: number;
	face_int_count?: number;
	surfaces?: string[];
	layers?: string[];
	materials?: CompactMeshMaterial[];
	positions?: ArrayLike<number>;
	faces?: ArrayLike<number>;
};

export type FaceRecord = {
	id: string;
	name: string;
	path: string;
	layer?: string;
	surface: SurfaceKey;
	partKey: PartKey;
	areaM2: number;
	vertices: Point3[];
	holes: Point3[][];
	color?: string;
	textureName?: string;
	center: Point3;
	bounds: Bounds3;
};

export type Bounds3 = {
	min: Point3;
	max: Point3;
	size: Point3;
	center: Point3;
};

export type SurfaceStat = {
	key: SurfaceKey;
	label: string;
	count: number;
	areaM2: number;
	confidence: number;
};

export type PartStat = {
	key: PartKey;
	label: string;
	count: number;
	areaM2: number;
	color: string;
};

export type SpaceZone = {
	id: string;
	name: string;
	areaM2: number;
	detectedAreaM2: number;
	volumeM3: number;
	heightM: number;
	detectedHeightM: number;
	functionKey: RoomFunctionKey;
	confidence: number;
	source: 'detected_floor' | 'estimated_footprint';
	shape: 'rectangle' | 'l_shape' | 'estimated';
	center: Point3;
};

export type ComponentDetection = {
	doors: number;
	windows: number;
	roofElements: number;
	wallElements: number;
	furniture: number;
	structural: number;
};

export type ParsedBuildingModel = {
	sourceName: string;
	schemaVersion: string;
	exportLevel: string;
	exportedAt: string;
	entitiesTotal: number;
	faceCount: number;
	vertexCount: number;
	faces: FaceRecord[];
	spaces: SpaceZone[];
	bounds: Bounds3;
	surfaceStats: SurfaceStat[];
	partStats: PartStat[];
	components: ComponentDetection;
	materials: Array<{ name: string; color: string; reflectance?: number | string }>;
	confidence: number;
	warnings: string[];
};

const BOME_MAGIC = 'BOME1\n';
const BOME_PREFIX_BYTES = new TextEncoder().encode(BOME_MAGIC);
const BOME_BINARY_LAYOUT = 'positions_then_faces_v2_int_counts';

export async function readBomModelFile(file: File, maxDecompressedBytes: number) {
	const buffer = await readModelArrayBuffer(file, maxDecompressedBytes);
	return new TextDecoder().decode(buffer);
}

export async function readBomModelData(file: File, maxDecompressedBytes: number) {
	const buffer = await readModelArrayBuffer(file, maxDecompressedBytes);
	return isBomeBuffer(buffer) ? parseBomeBuffer(buffer) : (JSON.parse(new TextDecoder().decode(buffer)) as BomModelJson);
}

async function readModelArrayBuffer(file: File, maxDecompressedBytes: number) {
	const gzip = file.name.toLowerCase().endsWith('.gz') || file.type === 'application/gzip';
	const stream = gzip ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream();
	const buffer = await new Response(stream).arrayBuffer();
	if (buffer.byteLength > maxDecompressedBytes) {
		throw new Error(`Isi model terlalu besar setelah ekstraksi. Maksimum ${Math.round(maxDecompressedBytes / 1024 / 1024)} MB.`);
	}
	return buffer;
}

function isBomeBuffer(buffer: ArrayBuffer) {
	if (buffer.byteLength < BOME_PREFIX_BYTES.length + 20) return false;
	const bytes = new Uint8Array(buffer, 0, BOME_PREFIX_BYTES.length);
	return BOME_PREFIX_BYTES.every((value, index) => bytes[index] === value);
}

function parseBomeBuffer(buffer: ArrayBuffer): BomModelJson {
	if (!isBomeBuffer(buffer)) throw new Error('File BOME tidak valid.');
	const view = new DataView(buffer);
	let offset = BOME_PREFIX_BYTES.length;
	const headerBytes = view.getUint32(offset, true);
	offset += 4;
	const positionCount = view.getUint32(offset, true);
	offset += 4;
	const faceIntCount = view.getUint32(offset, true);
	offset += 4;
	const positionBytes = view.getUint32(offset, true);
	offset += 4;
	const faceBytes = view.getUint32(offset, true);
	offset += 4;
	const expectedByteLength = offset + headerBytes + positionBytes + faceBytes;
	if (expectedByteLength !== buffer.byteLength) {
		throw new Error('File BOME terpotong atau header tidak valid.');
	}
	const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, headerBytes))) as BomModelJson;
	offset += headerBytes;
	const positions =
		offset % 4 === 0 ? new Int32Array(buffer, offset, positionBytes / Int32Array.BYTES_PER_ELEMENT) : new Int32Array(buffer.slice(offset, offset + positionBytes));
	offset += positionBytes;
	const faces =
		offset % 4 === 0 ? new Int32Array(buffer, offset, faceBytes / Int32Array.BYTES_PER_ELEMENT) : new Int32Array(buffer.slice(offset, offset + faceBytes));
	if (positions.length !== positionCount || faces.length !== faceIntCount) {
		throw new Error('Ukuran array BOME tidak cocok dengan header.');
	}
	if (!header.mesh) throw new Error('Header BOME tidak punya mesh metadata.');
	if (header.mesh.binary_layout !== BOME_BINARY_LAYOUT) {
		throw new Error('File BOME dibuat oleh exporter lama. Export ulang model dengan plugin BOM Engine terbaru.');
	}
	header.geometry_format = 'compact_mesh_v1';
	header.mesh.positions = positions;
	header.mesh.faces = faces;
	return header;
}

export type ProjectInputs = {
	roomFunction: RoomFunctionKey;
	peopleCount: number;
	operationHours: number;
	setPointC: number;
	orientationDeg: number;
	dominantWind: WindDirection;
	wallMaterial: 'brick_plaster' | 'concrete';
	glassMaterial: 'clear_glass' | 'tinted_glass';
	roofMaterial: 'spandek_no_insulation' | 'spandek_insulated';
	lampPreset: LampPresetKey;
	glassRatio: number;
	roomHeightM: number;
};

export type TouchedInputs = Partial<Record<keyof ProjectInputs, boolean>>;

export type ReadinessItem = {
	kind: AnalysisKind;
	label: string;
	status: 'ready' | 'estimate' | 'blocked';
	missing: string[];
	confidence: number;
};

export type AnalysisRow = {
	label: string;
	value: string;
	unit?: string;
	note?: string;
	status?: 'good' | 'warn' | 'bad';
};

export type ResultTable = {
	title: string;
	rows: AnalysisRow[];
};

export type OverlayMarker = {
	type: 'point' | 'arrow' | 'zone';
	label: string;
	position: Point3;
	direction?: Point3;
	value?: number;
	color: string;
};

export type AnalysisResult = {
	kind: AnalysisKind;
	title: string;
	summary: string;
	confidence: number;
	tables: ResultTable[];
	recommendations: string[];
	beforeAfter: Array<{ metric: string; before: string; after: string }>;
	markers: OverlayMarker[];
};

export const SURFACE_META: Record<SurfaceKey, { label: string; color: string; group: string }> = {
	wall_x_pos: { label: 'Dinding X+', color: '#557b72', group: 'Dinding' },
	wall_x_neg: { label: 'Dinding X-', color: '#638e82', group: 'Dinding' },
	wall_y_pos: { label: 'Dinding Y+', color: '#4f748e', group: 'Dinding' },
	wall_y_neg: { label: 'Dinding Y-', color: '#678fa8', group: 'Dinding' },
	floor: { label: 'Lantai', color: '#c6a96b', group: 'Lantai' },
	ceiling: { label: 'Plafon', color: '#d7cfaa', group: 'Interior' },
	roof_slope: { label: 'Atap miring', color: '#ab5f4f', group: 'Atap' },
	door: { label: 'Pintu', color: '#9b6b3d', group: 'Bukaan' },
	window: { label: 'Jendela', color: '#5ca6c9', group: 'Bukaan' },
	structure: { label: 'Struktur', color: '#8b5a54', group: 'Struktur' },
	furniture: { label: 'Furnitur', color: '#75685e', group: 'Interior' },
	other: { label: 'Lainnya', color: '#8a8172', group: 'Lainnya' }
};

export const PART_META: Record<PartKey, { label: string; color: string; order: number }> = {
	roof: { label: 'Atap', color: '#ab5f4f', order: 10 },
	walls: { label: 'Dinding', color: '#557b72', order: 20 },
	floor: { label: 'Lantai', color: '#c6a96b', order: 30 },
	ceiling: { label: 'Plafon', color: '#d7cfaa', order: 40 },
	doors: { label: 'Pintu', color: '#9b6b3d', order: 50 },
	windows: { label: 'Jendela', color: '#5ca6c9', order: 55 },
	openings: { label: 'Bukaan', color: '#5ca6c9', order: 57 },
	structure: { label: 'Struktur', color: '#8b5a54', order: 60 },
	foundation: { label: 'Fondasi', color: '#7d6a4e', order: 70 },
	earthwork: { label: 'Pekerjaan Tanah', color: '#8b7355', order: 75 },
	furniture: { label: 'Furnitur', color: '#75685e', order: 80 },
	other: { label: 'Lainnya', color: '#8a8172', order: 90 }
};

export const ANALYSIS_META: Record<AnalysisKind, { label: string; shortLabel: string }> = {
	lighting: { label: 'Pencahayaan', shortLabel: 'Lux' },
	ac: { label: 'Kebutuhan AC', shortLabel: 'AC' },
	ottv: { label: 'OTTV Fasad', shortLabel: 'OTTV' },
	thermal: { label: 'Kenyamanan Termal', shortLabel: 'Termal' },
	people: { label: 'Flow Manusia', shortLabel: 'Flow' },
	wind: { label: 'Flow Angin', shortLabel: 'Angin' }
};

export const ROOM_FUNCTIONS: Record<
	RoomFunctionKey,
	{ label: string; lux: number; coolingWm2: number; peopleDensityM2: number; description: string }
> = {
	retail: {
		label: 'Retail',
		lux: 500,
		coolingWm2: 150,
		peopleDensityM2: 4,
		description: 'Aktivitas padat, butuh cahaya terang dan beban AC tinggi.'
	},
	gudang: {
		label: 'Gudang',
		lux: 200,
		coolingWm2: 85,
		peopleDensityM2: 18,
		description: 'Aktivitas rendah, target lux dan beban orang lebih kecil.'
	},
	kantor: {
		label: 'Kantor',
		lux: 350,
		coolingWm2: 125,
		peopleDensityM2: 8,
		description: 'Kerja visual sedang, okupansi stabil.'
	},
	pantry: {
		label: 'Pantry',
		lux: 300,
		coolingWm2: 115,
		peopleDensityM2: 10,
		description: 'Aktivitas singkat, ada panas peralatan ringan.'
	},
	koridor: {
		label: 'Koridor',
		lux: 150,
		coolingWm2: 70,
		peopleDensityM2: 14,
		description: 'Area sirkulasi, bukan ruang kerja utama.'
	},
	servis: {
		label: 'Servis',
		lux: 250,
		coolingWm2: 95,
		peopleDensityM2: 12,
		description: 'Ruang pendukung, target sedang.'
	}
};

export const WALL_PRESETS: Record<ProjectInputs['wallMaterial'], { label: string; uValue: number; absorptance: number }> = {
	brick_plaster: { label: 'Bata + plester', uValue: 2.3, absorptance: 0.55 },
	concrete: { label: 'Beton', uValue: 3.1, absorptance: 0.68 }
};

export const GLASS_PRESETS: Record<ProjectInputs['glassMaterial'], { label: string; uValue: number; shgc: number }> = {
	clear_glass: { label: 'Kaca bening', uValue: 5.8, shgc: 0.78 },
	tinted_glass: { label: 'Kaca tinted', uValue: 5.6, shgc: 0.48 }
};

export const ROOF_PRESETS: Record<ProjectInputs['roofMaterial'], { label: string; uValue: number; absorptance: number }> = {
	spandek_no_insulation: { label: 'Atap spandek tanpa insulasi', uValue: 4.8, absorptance: 0.72 },
	spandek_insulated: { label: 'Atap spandek dengan insulasi', uValue: 1.8, absorptance: 0.48 }
};

export const LAMP_PRESETS: Record<LampPresetKey, { label: string; lumens: number; watt: number; cu: number; llf: number }> = {
	led_panel: { label: 'LED panel 40 W', lumens: 4000, watt: 40, cu: 0.62, llf: 0.8 },
	led_bulb: { label: 'LED bulb 12 W', lumens: 1200, watt: 12, cu: 0.5, llf: 0.75 },
	linear_led: { label: 'Linear LED 36 W', lumens: 3600, watt: 36, cu: 0.58, llf: 0.8 }
};

export const DEFAULT_INPUTS: ProjectInputs = {
	roomFunction: 'retail',
	peopleCount: 18,
	operationHours: 10,
	setPointC: 24,
	orientationDeg: 0,
	dominantWind: 'E',
	wallMaterial: 'brick_plaster',
	glassMaterial: 'clear_glass',
	roofMaterial: 'spandek_no_insulation',
	lampPreset: 'led_panel',
	glassRatio: 18,
	roomHeightM: 3.2
};

const SURFACE_KEYS = new Set(Object.keys(SURFACE_META));
const PARSE_LIMITS = {
	maxEntities: 750000,
	maxDepth: 80,
	maxTotalVertices: 3000000,
	maxCoordinateAbs: 100000
};
const DIRECTION_ANGLE: Record<WindDirection, number> = {
	N: 0,
	NE: 45,
	E: 90,
	SE: 135,
	S: 180,
	SW: 225,
	W: 270,
	NW: 315
};

function emptyBounds(): Bounds3 {
	return {
		min: { x: Infinity, y: Infinity, z: Infinity },
		max: { x: -Infinity, y: -Infinity, z: -Infinity },
		size: { x: 0, y: 0, z: 0 },
		center: { x: 0, y: 0, z: 0 }
	};
}

function finalizeBounds(bounds: Bounds3): Bounds3 {
	if (!Number.isFinite(bounds.min.x)) {
		return {
			min: { x: -4, y: 0, z: -4 },
			max: { x: 4, y: 4, z: 4 },
			size: { x: 8, y: 4, z: 8 },
			center: { x: 0, y: 2, z: 0 }
		};
	}
	const size = {
		x: bounds.max.x - bounds.min.x,
		y: bounds.max.y - bounds.min.y,
		z: bounds.max.z - bounds.min.z
	};
	const center = {
		x: bounds.min.x + size.x / 2,
		y: bounds.min.y + size.y / 2,
		z: bounds.min.z + size.z / 2
	};
	return { min: bounds.min, max: bounds.max, size, center };
}

function expandBounds(bounds: Bounds3, point: Point3) {
	bounds.min.x = Math.min(bounds.min.x, point.x);
	bounds.min.y = Math.min(bounds.min.y, point.y);
	bounds.min.z = Math.min(bounds.min.z, point.z);
	bounds.max.x = Math.max(bounds.max.x, point.x);
	bounds.max.y = Math.max(bounds.max.y, point.y);
	bounds.max.z = Math.max(bounds.max.z, point.z);
}

function averagePoint(points: Point3[]): Point3 {
	const sum = points.reduce(
		(acc, point) => {
			acc.x += point.x;
			acc.y += point.y;
			acc.z += point.z;
			return acc;
		},
		{ x: 0, y: 0, z: 0 }
	);
	const count = Math.max(points.length, 1);
	return { x: sum.x / count, y: sum.y / count, z: sum.z / count };
}

function finiteCoordinate(value: unknown) {
	const numberValue = Number(value);
	if (!Number.isFinite(numberValue) || Math.abs(numberValue) > PARSE_LIMITS.maxCoordinateAbs) {
		throw new Error('JSON berisi koordinat model tidak valid.');
	}
	return numberValue;
}

function toWorld(vertex: BomVertex): Point3 {
	return {
		x: finiteCoordinate(vertex.position.x),
		y: finiteCoordinate(vertex.position.z),
		z: -finiteCoordinate(vertex.position.y)
	};
}

function vectorToWorld(position: BomVector): Point3 {
	return {
		x: finiteCoordinate(position.x),
		y: finiteCoordinate(position.z),
		z: -finiteCoordinate(position.y)
	};
}

function normalizeSurface(surface?: string | null, name = ''): SurfaceKey {
	if (surface && SURFACE_KEYS.has(surface)) return surface as SurfaceKey;
	const lower = name.toLowerCase();
	if (/^j\d|jendela|window/.test(lower)) return 'window';
	if (/^p\d|pintu|door/.test(lower)) return 'door';
	if (/kolom|balok|sloof|cerucuk|pondasi|struktur|structure/.test(lower)) return 'structure';
	if (/kulkas|dispenser|sofa|meja|kursi|lemari|furniture|sree|heather|sang|laura|mark|stacy|chris|susan|manusia|orang|scale_figure|scale figure/.test(lower)) return 'furniture';
	if (/atap|perabung|spandek|listplank/.test(lower)) return 'roof_slope';
	if (/urug|tanah/.test(lower)) return 'other';
	return 'other';
}

function isHorizontalFace(bounds: Bounds3) {
	return bounds.size.y <= 0.08 && bounds.size.x >= 0.4 && bounds.size.z >= 0.4;
}

function isWallLikeFace(bounds: Bounds3, surface: SurfaceKey) {
	const verticalSpan = bounds.size.y;
	const longPlanSpan = Math.max(bounds.size.x, bounds.size.z);
	const shortPlanSpan = Math.min(bounds.size.x, bounds.size.z);
	const thinPlane = shortPlanSpan <= 0.42 || shortPlanSpan / Math.max(longPlanSpan, 0.001) <= 0.08;
	if (surface.startsWith('wall')) return verticalSpan >= 0.35 && longPlanSpan >= 0.15;
	return thinPlane && verticalSpan >= 1.6 && longPlanSpan >= 0.8;
}

function hasWallMaterialSignal(lower: string) {
	return /color_000|color_001|color_002|color_003|siding|cladding|weatherboard|lap|plaster|concrete|cement|cream/.test(lower);
}

function hasOpeningMaterialSignal(lower: string) {
	return /glass|kaca|translucent|window|jendela|door|pintu|kusen|wood|cherry|color_007|color_008|#1e1e1e|#333333/.test(lower);
}

function hasFrameMaterialSignal(lower: string) {
	return /kusen|frame|wood|cherry|aluminium|aluminum|metal|color_007|color_008|material11|#1e1e1e|#333333|#98562a|#537689/.test(lower);
}

function hasFloorMaterialSignal(lower: string) {
	return /lantai|floor|keramik|ubin|tile|parket|sand|ground|grass|paver|paving|brick/.test(lower);
}

function hasCeilingMaterialSignal(lower: string) {
	return /plafon|ceiling|gypsum|langit/.test(lower);
}

function detectPartKey(path: string, surface: SurfaceKey, bounds: Bounds3, textureName = '', color = ''): PartKey {
	const lower = `${path} ${textureName} ${color}`.toLowerCase();
	if (/kulkas|dispenser|sofa|meja|kursi|lemari|furniture|sree|heather|sang|laura|mark|stacy|chris|susan|manusia|orang|scale_figure|scale figure/.test(lower) || surface === 'furniture') return 'furniture';
	if (/piri - piri|piri-piri|listplank/.test(lower)) return 'ceiling';
	if (/atap|roof|perabung|spandek/.test(lower)) return 'roof';
	if (/pondasi|penggali|batu kali|batu kosong|cerucuk|sloof/.test(lower)) return 'foundation';
	if (/urug|tanah timbun|tanah/.test(lower)) return 'earthwork';
	if (/p1008|^p\d|pintu|door|p1008.*pemotong/.test(lower) || surface === 'door') return 'doors';
	if (/j0006|^j\d|jendela|window|kusen|glass|kaca|translucent|j0006.*pemotong|pemotong/.test(lower) || surface === 'window') return 'windows';
	if (/kolom|balok|struktur|structure|beton/.test(lower) || surface === 'structure') return 'structure';
	if (/cor lantai|keramik lantai/.test(lower) && surface.startsWith('wall')) return 'structure';
	if (/bata|plester|dinding|wall/.test(lower) && (surface === 'floor' || surface === 'ceiling')) return 'walls';
	if (surface.startsWith('wall') && hasWallMaterialSignal(lower)) return 'walls';
	if (isWallLikeFace(bounds, surface)) return 'walls';
	if (surface === 'floor' || (isHorizontalFace(bounds) && hasFloorMaterialSignal(lower))) return 'floor';
	if (surface === 'ceiling' || (isHorizontalFace(bounds) && hasCeilingMaterialSignal(lower))) return 'ceiling';
	if (surface === 'roof_slope') return 'roof';
	return 'other';
}

function estimateFloorLevels(faces: FaceRecord[]) {
	const buckets = new Map<number, { y: number; areaM2: number }>();
	const addBucket = (y: number, weight: number) => {
		const bucket = Math.round(y / 0.25);
		const current = buckets.get(bucket) || { y, areaM2: 0 };
		current.y = (current.y * current.areaM2 + y * weight) / Math.max(current.areaM2 + weight, 0.001);
		current.areaM2 += weight;
		buckets.set(bucket, current);
	};
	faces.forEach((face) => {
		if (face.partKey === 'foundation' || face.partKey === 'roof' || face.partKey === 'earthwork') {
			return;
		}

		const lower = `${face.path} ${face.textureName || ''} ${face.color || ''}`.toLowerCase();
		if (isHorizontalFace(face.bounds) && (face.partKey === 'floor' || face.surface === 'floor') && !hasCeilingMaterialSignal(lower) && face.areaM2 >= 0.05) {
			addBucket(face.bounds.center.y, face.areaM2);
		}
		if (
			face.surface.startsWith('wall') &&
			face.bounds.size.y >= 1.2 &&
			face.areaM2 >= 0.03 &&
			!hasOpeningMaterialSignal(lower) &&
			!hasFrameMaterialSignal(lower)
		) {
			addBucket(face.bounds.min.y, Math.min(face.areaM2, 3));
		}
	});
	return [...buckets.values()]
		.sort((a, b) => b.areaM2 - a.areaM2)
		.slice(0, 18)
		.map((bucket) => bucket.y)
		.sort((a, b) => a - b);
}

function nearestFloorDelta(face: FaceRecord, floorLevels: number[], modelBounds: Bounds3) {
	const levels = floorLevels.length ? floorLevels : [modelBounds.min.y];
	const candidates = levels.map((level) => face.bounds.min.y - level).filter((delta) => delta >= -0.35);
	return candidates.length ? Math.min(...candidates.map((delta) => Math.abs(delta))) : Infinity;
}

function touchesFloorLevel(face: FaceRecord, floorLevels: number[], modelBounds: Bounds3) {
	return nearestFloorDelta(face, floorLevels, modelBounds) <= 0.65;
}

function isOpeningOrFrameCandidate(face: FaceRecord) {
	if (
		face.partKey === 'furniture' ||
		face.partKey === 'foundation' ||
		face.partKey === 'structure' ||
		face.partKey === 'roof' ||
		face.partKey === 'earthwork' ||
		face.partKey === 'ceiling'
	) {
		return false;
	}
	const lower = `${face.path} ${face.textureName || ''} ${face.color || ''}`.toLowerCase();
	const vertical = face.surface.startsWith('wall') && face.bounds.size.y >= 0.18;
	const smallPlan = Math.max(face.bounds.size.x, face.bounds.size.z) <= 1.6 || Math.min(face.bounds.size.x, face.bounds.size.z) <= 0.08;
	return vertical && smallPlan && (face.partKey === 'doors' || face.partKey === 'windows' || hasOpeningMaterialSignal(lower) || hasFrameMaterialSignal(lower));
}

function planeDistance(a: FaceRecord, b: FaceRecord) {
	const aXPlane = a.bounds.size.x <= a.bounds.size.z;
	const bXPlane = b.bounds.size.x <= b.bounds.size.z;
	if (aXPlane !== bXPlane) return Infinity;
	return aXPlane ? Math.abs(a.center.x - b.center.x) : Math.abs(a.center.z - b.center.z);
}

function openingDistance(a: FaceRecord, b: FaceRecord) {
	const plane = planeDistance(a, b);
	if (plane > 0.35) return Infinity;
	const aAxis = a.bounds.size.x <= a.bounds.size.z ? 'z' : 'x';
	const horizontal = aAxis === 'z' ? Math.abs(a.center.z - b.center.z) : Math.abs(a.center.x - b.center.x);
	const verticalGap = Math.max(0, Math.max(a.bounds.min.y, b.bounds.min.y) - Math.min(a.bounds.max.y, b.bounds.max.y));
	return plane * 2 + horizontal + verticalGap;
}

function refineOpeningClusters(faces: FaceRecord[], floorLevels: number[], modelBounds: Bounds3) {
	const candidates = faces.filter(isOpeningOrFrameCandidate);
	const anchors = candidates.filter((face) => face.partKey === 'doors' || face.partKey === 'windows');
	candidates.forEach((face) => {
		const tallDoorLike = face.bounds.size.y >= 1.45 && face.bounds.size.y <= 3.4 && touchesFloorLevel(face, floorLevels, modelBounds);
		if (tallDoorLike) {
			face.partKey = 'doors';
			return;
		}
		let nearestPartKey: PartKey | null = null;
		let nearestDistance = Infinity;
		anchors.forEach((anchor) => {
			const distance = openingDistance(face, anchor);
			if (distance < nearestDistance) {
				nearestPartKey = anchor.partKey;
				nearestDistance = distance;
			}
		});
		if (nearestPartKey && nearestDistance <= 1.2) {
			face.partKey = nearestPartKey;
		} else if (face.partKey === 'other') {
			face.partKey = 'windows';
		}
	});
}

function refinePartKey(face: FaceRecord, modelBounds: Bounds3, floorLevels: number[]): PartKey {
	if (
		face.partKey === 'foundation' ||
		face.partKey === 'roof' ||
		face.partKey === 'structure' ||
		face.partKey === 'furniture' ||
		face.partKey === 'earthwork' ||
		face.partKey === 'doors' ||
		face.partKey === 'windows' ||
		face.partKey === 'ceiling' ||
		face.partKey === 'other'
	) {
		return face.partKey;
	}

	const lower = `${face.path} ${face.textureName || ''} ${face.color || ''}`.toLowerCase();
	const touchesFloor = touchesFloorLevel(face, floorLevels, modelBounds);
	const vertical = face.bounds.size.y >= 0.35 && face.surface.startsWith('wall');
	const openingSized = face.bounds.size.y <= 4.5 && Math.max(face.bounds.size.x, face.bounds.size.z) <= 12;
	const doorSized = face.bounds.size.y >= 1.55 && face.bounds.size.y <= 3.8;

	if (face.partKey === 'openings') {
		return touchesFloor && doorSized ? 'doors' : 'windows';
	}
	if ((vertical && openingSized && hasOpeningMaterialSignal(lower)) && touchesFloor && doorSized) {
		return 'doors';
	}
	if (vertical && openingSized && hasOpeningMaterialSignal(lower)) {
		return 'windows';
	}

	if ((face.surface === 'floor' || face.surface === 'ceiling') && isHorizontalFace(face.bounds)) {
		if (face.surface === 'ceiling' && hasFloorMaterialSignal(lower)) return 'structure';
		if (hasCeilingMaterialSignal(lower)) return 'ceiling';
		if (hasFloorMaterialSignal(lower)) return 'floor';
		const levels = floorLevels.length ? floorLevels : [modelBounds.min.y];
		const nearestLevelDistance = Math.min(...levels.map((level) => Math.abs(face.bounds.center.y - level)));
		if (nearestLevelDistance <= 0.35) return 'floor';
		const below = levels.filter((level) => level <= face.bounds.center.y + 0.2).pop();
		const heightAboveFloor = below === undefined ? Infinity : face.bounds.center.y - below;
		if (heightAboveFloor >= 2 && heightAboveFloor <= 4.2) return 'ceiling';
	}

	return face.partKey;
}

function detectNameKind(name: string): keyof ComponentDetection | null {
	const lower = name.toLowerCase();
	if (/^p\d|pintu|door/.test(lower)) return 'doors';
	if (/^j\d|jendela|window/.test(lower)) return 'windows';
	if (/atap|perabung|spandek|listplank/.test(lower)) return 'roofElements';
	if (/bata|plester|dinding|wall/.test(lower)) return 'wallElements';
	if (/kulkas|dispenser|sofa|meja|kursi|lemari|furniture|sree|heather|sang|laura|mark|stacy|chris|susan|manusia|orang|scale_figure|scale figure/.test(lower)) return 'furniture';
	if (/kolom|balok|sloof|cerucuk|pondasi|struktur|structure/.test(lower)) return 'structural';
	return null;
}

function suggestFunction(name: string, areaM2: number): RoomFunctionKey {
	const lower = name.toLowerCase();
	if (/gudang|storage/.test(lower)) return 'gudang';
	if (/koridor|selasar|hall/.test(lower)) return 'koridor';
	if (/pantry|dapur|kitchen/.test(lower)) return 'pantry';
	if (/toilet|wc|servis|service/.test(lower)) return 'servis';
	if (/kantor|office/.test(lower)) return 'kantor';
	if (areaM2 > 35) return 'retail';
	if (areaM2 < 8) return 'servis';
	return 'kantor';
}

function distance2d(a: Point3, b: Point3) {
	return Math.hypot(a.x - b.x, a.z - b.z);
}

function planBoundsArea(bounds: Bounds3) {
	return Math.max(bounds.size.x * bounds.size.z, 0);
}

function planOverlapArea(a: Bounds3, b: Bounds3) {
	const x = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
	const z = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
	return x * z;
}

type RoomCandidate = {
	face: FaceRecord;
	areaM2: number;
	bboxAreaM2: number;
	fillRatio: number;
	shape: 'rectangle' | 'l_shape';
	score: number;
	confidence: number;
};

function roomPathPenalty(path: string) {
	const lower = path.toLowerCase();
	if (
		/atap|roof|perabung|spandek|listplank|piri|pondasi|penggali|batu kali|batu kosong|urug|tanah|cerucuk|sloof|balok|kolom|kusen|jendela|pintu|group pemotong|kulkas|dispenser|sofa|meja|kursi|lemari|furniture|notasi/.test(
			lower
		)
	) {
		return true;
	}
	return false;
}

function roomPathScore(path: string) {
	const lower = path.toLowerCase();
	if (/keramik lantai|lantai keramik|ubin|parket/.test(lower)) return 0.26;
	if (/cor lantai/.test(lower)) return 0.18;
	if (/lantai|floor/.test(lower)) return 0.1;
	return 0;
}

function uniquePlanPoints(points: Point3[]) {
	const seen = new Set<string>();
	const unique: Point3[] = [];
	for (const point of points) {
		const key = `${round(point.x, 2)}:${round(point.z, 2)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(point);
	}
	return unique;
}

function axisAlignedPlan(points: Point3[]) {
	if (points.length < 4) return false;
	let validEdges = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		const dx = Math.abs(next.x - current.x);
		const dz = Math.abs(next.z - current.z);
		const length = Math.hypot(dx, dz);
		if (length < 0.05) continue;
		const offAxis = Math.min(dx, dz) / Math.max(dx, dz, 0.001);
		if (offAxis > 0.08) return false;
		validEdges += 1;
	}
	return validEdges >= 4;
}

function faceShapeCandidate(face: FaceRecord): RoomCandidate | null {
	if (face.partKey !== 'floor' || face.areaM2 < 3) return null;
	if (roomPathPenalty(face.path)) return null;

	const width = face.bounds.size.x;
	const depth = face.bounds.size.z;
	const heightVariance = face.bounds.size.y;
	const bboxAreaM2 = width * depth;
	if (heightVariance > 0.08 || width < 1.2 || depth < 1.2 || bboxAreaM2 < 4) return null;

	const fillRatio = clamp(face.areaM2 / Math.max(bboxAreaM2, 0.001), 0, 1.2);
	const uniquePoints = uniquePlanPoints(face.vertices);
	const orthogonal = axisAlignedPlan(uniquePoints);
	const rectangle = fillRatio >= 0.9 && (orthogonal || uniquePoints.length <= 6);
	const lShape = fillRatio >= 0.48 && fillRatio < 0.9 && uniquePoints.length >= 6 && orthogonal;
	if (!rectangle && !lShape) return null;

	const shape = rectangle ? 'rectangle' : 'l_shape';
	const slenderness = Math.min(width, depth) / Math.max(width, depth);
	if (slenderness < 0.22 && shape === 'rectangle') return null;

	const score =
		0.38 +
		roomPathScore(face.path) +
		(shape === 'rectangle' ? 0.18 : 0.13) +
		Math.min(face.areaM2 / 80, 0.14) +
		Math.min(fillRatio, 1) * 0.1;

	return {
		face,
		areaM2: face.areaM2,
		bboxAreaM2,
		fillRatio,
		shape,
		score,
		confidence: clamp(score, 0.45, 0.92)
	};
}

function sameRoomCandidate(a: RoomCandidate, b: RoomCandidate) {
	const centerDistance = distance2d(a.face.center, b.face.center);
	const sizeA = a.face.bounds.size;
	const sizeB = b.face.bounds.size;
	const closeCenter = centerDistance < Math.max(0.45, Math.min(sizeA.x, sizeA.z, sizeB.x, sizeB.z) * 0.08);
	const closeArea = Math.abs(a.areaM2 - b.areaM2) / Math.max(a.areaM2, b.areaM2, 1) < 0.08;
	const closeWidth = Math.abs(sizeA.x - sizeB.x) / Math.max(sizeA.x, sizeB.x, 1) < 0.08;
	const closeDepth = Math.abs(sizeA.z - sizeB.z) / Math.max(sizeA.z, sizeB.z, 1) < 0.08;
	return closeCenter && closeArea && closeWidth && closeDepth;
}

function calculatedRoomCandidates(faces: FaceRecord[]) {
	const candidates = faces.map(faceShapeCandidate).filter((candidate): candidate is RoomCandidate => Boolean(candidate));
	const groups: RoomCandidate[][] = [];

	for (const candidate of candidates.sort((a, b) => b.score - a.score || b.areaM2 - a.areaM2)) {
		const group = groups.find((items) => items.some((item) => sameRoomCandidate(item, candidate)));
		if (group) group.push(candidate);
		else groups.push([candidate]);
	}

	return groups
		.map((group) => group.sort((a, b) => b.score - a.score || b.areaM2 - a.areaM2)[0])
		.sort((a, b) => b.areaM2 - a.areaM2);
}

function estimateRoomHeight(candidate: RoomCandidate, faces: FaceRecord[], fallbackHeight: number) {
	const floorY = candidate.face.bounds.center.y;
	const roomPlanArea = Math.max(planBoundsArea(candidate.face.bounds), candidate.areaM2, 1);
	const wallHeights = faces
		.filter((face) => face.partKey === 'walls' && face.bounds.size.y >= 1.8 && face.bounds.size.y <= 6.8)
		.filter((face) => {
			const baseDelta = Math.abs(face.bounds.min.y - floorY);
			const penetratesFloorPlane = face.bounds.min.y <= floorY + 0.45 && face.bounds.max.y >= floorY + 1.8;
			if (baseDelta > 0.9 && !penetratesFloorPlane) return false;
			return roomWallAdjacency(candidate.face.bounds, face.bounds) > 0.12;
		})
		.map((face) => {
			const heightFromFloor = face.bounds.max.y - floorY;
			const height = heightFromFloor > 1.8 && heightFromFloor <= 6.8 ? heightFromFloor : face.bounds.size.y;
			return clamp(height, 1.8, 6.8);
		})
		.sort((a, b) => a - b);

	if (wallHeights.length >= 2) return clamp(wallHeights[Math.floor(wallHeights.length / 2)], 2.1, 6.5);
	if (wallHeights.length === 1) return clamp(wallHeights[0], 2.1, 6.5);

	const horizontalCovers = faces
		.filter((face) => {
			if (face === candidate.face) return false;
			if (!['ceiling', 'floor', 'roof_slope'].includes(face.surface) && !['ceiling', 'roof'].includes(face.partKey)) return false;
			const height = face.bounds.center.y - floorY;
			if (height < 2.0 || height > 6.5) return false;
			const overlapRatio = planOverlapArea(candidate.face.bounds, face.bounds) / roomPlanArea;
			return overlapRatio >= 0.58;
		})
		.map((face) => ({
			height: face.bounds.center.y - floorY,
			score:
				(face.surface === 'ceiling' ? 0.35 : 0) +
				(face.partKey === 'ceiling' ? 0.25 : 0) +
				(face.partKey === 'roof' ? 0.08 : 0) +
				planOverlapArea(candidate.face.bounds, face.bounds) / roomPlanArea -
				Math.max(face.bounds.center.y - floorY - 3, 0) * 0.05
		}))
		.sort((a, b) => b.score - a.score || a.height - b.height);

	if (horizontalCovers[0]) return clamp(horizontalCovers[0].height, 2.1, 6.5);
	return clamp(fallbackHeight, 2.4, 4.5);
}

function axisOverlapRatio(minA: number, maxA: number, minB: number, maxB: number) {
	const overlap = Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
	const span = Math.max(Math.min(maxA - minA, maxB - minB), 0.001);
	return overlap / span;
}

function roomWallAdjacency(room: Bounds3, wall: Bounds3) {
	const tolerance = Math.max(Math.min(room.size.x, room.size.z) * 0.08, 0.45);
	const xEdgeDistance = Math.min(Math.abs(wall.center.x - room.min.x), Math.abs(wall.center.x - room.max.x));
	const zEdgeDistance = Math.min(Math.abs(wall.center.z - room.min.z), Math.abs(wall.center.z - room.max.z));
	const zOverlap = axisOverlapRatio(room.min.z, room.max.z, wall.min.z, wall.max.z);
	const xOverlap = axisOverlapRatio(room.min.x, room.max.x, wall.min.x, wall.max.x);

	const alongZWall = wall.size.z >= wall.size.x && xEdgeDistance <= tolerance ? zOverlap : 0;
	const alongXWall = wall.size.x >= wall.size.z && zEdgeDistance <= tolerance ? xOverlap : 0;
	const crossingOverlap = planOverlapArea(room, wall) / Math.max(planBoundsArea(wall), 0.001);
	return Math.max(alongZWall, alongXWall, crossingOverlap * 0.35);
}

function makeSpaces(faces: FaceRecord[], bounds: Bounds3, defaultHeight: number): SpaceZone[] {
	const floorFaces = calculatedRoomCandidates(faces);
	const zones: SpaceZone[] = [];

	for (const candidate of floorFaces) {
		const face = candidate.face;
		const cleanArea = Math.max(candidate.areaM2, 1);
		const height = estimateRoomHeight(candidate, faces, defaultHeight);
		const shapeLabel = candidate.shape === 'l_shape' ? 'L' : 'kotak';
		const name = `Ruang ${zones.length + 1} (${shapeLabel})`;
		zones.push({
			id: `zone-${zones.length + 1}`,
			name,
			areaM2: round(cleanArea, 1),
			detectedAreaM2: round(cleanArea, 1),
			volumeM3: round(cleanArea * height, 1),
			heightM: height,
			detectedHeightM: height,
			functionKey: suggestFunction(face.path || name, cleanArea),
			confidence: candidate.confidence,
			source: 'detected_floor',
			shape: candidate.shape,
			center: face.center
		});
		if (zones.length >= 12) break;
	}

	if (zones.length) return zones;

	const footprint = Math.max(bounds.size.x * bounds.size.z, 1);
	const height = clamp(defaultHeight, 2.4, 4.5);
	return [
		{
			id: 'zone-1',
			name: 'Zona utama',
			areaM2: round(footprint, 1),
			detectedAreaM2: round(footprint, 1),
			volumeM3: round(footprint * height, 1),
			heightM: height,
			detectedHeightM: height,
			functionKey: 'retail',
			confidence: 0.35,
			source: 'estimated_footprint',
			shape: 'estimated',
			center: bounds.center
		}
	];
}

function materialRows(materials: BomModelJson['materials']) {
	if (!materials) return [];
	const rows = Array.isArray(materials) ? materials : Object.values(materials);
	return rows.slice(0, 24).map((material) => ({
		name: material.name || 'Material',
		color: material.color?.hex || '#94a3b8',
		reflectance: material.reflectance ?? '-'
	}));
}

export function parseBomModelJson(data: BomModelJson, sourceName: string, defaultHeight = DEFAULT_INPUTS.roomHeightM): ParsedBuildingModel {
	const compactMesh = data.geometry_format === 'compact_mesh_v1' ? data.mesh : null;
	if (!compactMesh && !Array.isArray(data.entities)) {
		throw new Error('JSON model harus punya array entities atau compact mesh.');
	}

	const bounds = emptyBounds();
	const faces: FaceRecord[] = [];
	const surfaceAccumulator = new Map<SurfaceKey, { count: number; areaM2: number }>();
	const partAccumulator = new Map<PartKey, { count: number; areaM2: number }>();
	const components: ComponentDetection = {
		doors: 0,
		windows: 0,
		roofElements: 0,
		wallElements: 0,
		furniture: 0,
		structural: 0
	};
	const componentSeen = new Set<string>();
	let entitiesTotal = 0;
	let vertexCount = 0;

	function recordComponent(entity: BomEntity, path: string) {
		const name = entity.name || entity.definition_name;
		if (!name) return;
		const kind = detectNameKind(name);
		if (!kind) return;
		const key = `${kind}:${entity.id || path}`;
		if (componentSeen.has(key)) return;
		componentSeen.add(key);
		components[kind] += 1;
	}

	function appendFace(record: {
		id: string;
		name: string;
		path: string;
		layer?: string;
		surface: SurfaceKey;
		areaM2: number;
		vertices: Point3[];
		holes?: Point3[][];
		color?: string;
		textureName?: string;
	}) {
		const holes = record.holes || [];
		const faceBounds = emptyBounds();
		record.vertices.forEach((point) => {
			expandBounds(bounds, point);
			expandBounds(faceBounds, point);
		});
		holes.forEach((loop) =>
			loop.forEach((point) => {
				expandBounds(bounds, point);
				expandBounds(faceBounds, point);
			})
		);
				const finalizedFaceBounds = finalizeBounds(faceBounds);
		const center = averagePoint(record.vertices);
		let partKey = detectPartKey(record.path, record.surface, finalizedFaceBounds, record.textureName, record.color);
		// Root-level faces at z=0 (ground level in SketchUp, which maps to y=0 in Three.js world coordinates) with no parent architecture context -> other
		if (/^face$/i.test(record.path.trim()) && Math.abs(finalizedFaceBounds.center.y) < 0.05 && record.surface === 'floor') {
			partKey = 'other';
		}
		const current = surfaceAccumulator.get(record.surface) || { count: 0, areaM2: 0 };
		current.count += 1;
		current.areaM2 += record.areaM2;
		surfaceAccumulator.set(record.surface, current);
		const partCurrent = partAccumulator.get(partKey) || { count: 0, areaM2: 0 };
		partCurrent.count += 1;
		partCurrent.areaM2 += record.areaM2;
		partAccumulator.set(partKey, partCurrent);
		vertexCount += record.vertices.length;
		faces.push({
			id: record.id,
			name: record.name,
			path: record.path,
			layer: record.layer,
			surface: record.surface,
			partKey,
			areaM2: record.areaM2,
			vertices: record.vertices,
			holes,
			color: record.color,
			textureName: record.textureName,
			center,
			bounds: finalizedFaceBounds
		});
	}

	function walkCompactMesh(mesh: CompactMesh) {
		const positions = mesh.positions || [];
		const meshFaces = mesh.faces || [];
		const stride = mesh.face_stride || 9;
		if (!positions.length || !meshFaces.length || stride < 9) {
			throw new Error('Compact mesh tidak valid.');
		}
		if (positions.length % 3 !== 0 || meshFaces.length % stride !== 0) {
			throw new Error('Compact mesh korup: ukuran buffer posisi atau face table tidak cocok. Export ulang model dengan plugin terbaru.');
		}
		const positionScale = mesh.position_scale || 0.001;
		const areaScale = mesh.area_scale || 0.0001;
		const totalPositionVertices = positions.length / 3;
		const faceRows = meshFaces.length / stride;
		entitiesTotal = faceRows;
		if (entitiesTotal > PARSE_LIMITS.maxEntities) {
			throw new Error(`Terlalu banyak face. Maksimum ${format(PARSE_LIMITS.maxEntities)} face.`);
		}

		for (let row = 0; row < faceRows; row += 1) {
			const base = row * stride;
			const vertexStart = meshFaces[base];
			const vertexLength = meshFaces[base + 1];
			const surfaceIndex = meshFaces[base + 2];
			const materialIndex = meshFaces[base + 3];
			const layerIndex = meshFaces[base + 4];
			const compactRowError = (message: string) =>
				new Error(`Compact mesh korup di face ${row + 1}: ${message}. Export ulang model dengan plugin terbaru.`);
			if (!Number.isInteger(vertexStart) || !Number.isInteger(vertexLength)) {
				throw compactRowError('vertex_start atau vertex_count bukan integer');
			}
			if (vertexLength < 3) {
				throw compactRowError('vertex_count kurang dari 3');
			}
			if (vertexStart < 0 || vertexStart + vertexLength > totalPositionVertices) {
				throw compactRowError('face menunjuk vertex di luar position buffer');
			}
			if (!Number.isInteger(surfaceIndex) || surfaceIndex < 0 || (mesh.surfaces && surfaceIndex >= mesh.surfaces.length)) {
				throw compactRowError('surface index di luar dictionary');
			}
			if (!Number.isInteger(materialIndex) || materialIndex < -1 || (materialIndex >= 0 && mesh.materials && materialIndex >= mesh.materials.length)) {
				throw compactRowError('material index di luar dictionary');
			}
			if (!Number.isInteger(layerIndex) || layerIndex < -1 || (layerIndex >= 0 && mesh.layers && layerIndex >= mesh.layers.length)) {
				throw compactRowError('layer index di luar dictionary');
			}
			if (vertexCount + vertexLength > PARSE_LIMITS.maxTotalVertices) {
				throw new Error(`Terlalu banyak vertex. Maksimum ${format(PARSE_LIMITS.maxTotalVertices)} vertex.`);
			}
			const vertices: Point3[] = [];
			for (let offset = 0; offset < vertexLength; offset += 1) {
				const positionIndex = (vertexStart + offset) * 3;
				vertices.push(
					vectorToWorld({
						x: (positions[positionIndex] || 0) * positionScale,
						y: (positions[positionIndex + 1] || 0) * positionScale,
						z: (positions[positionIndex + 2] || 0) * positionScale
					})
				);
			}
			const surface = normalizeSurface(mesh.surfaces?.[surfaceIndex], '');
			const material = materialIndex >= 0 ? mesh.materials?.[materialIndex] : undefined;
			const layer = layerIndex >= 0 ? mesh.layers?.[layerIndex] : undefined;
			const areaM2 = (meshFaces[base + 5] || 0) * areaScale;
			const textureName = material?.texture?.filename || material?.texture?.source_path || material?.name || undefined;
			appendFace({
				id: `compact-face-${row + 1}`,
				name: `${surface}-${row + 1}`,
				path: layer ? `${layer} > ${surface}` : surface,
				layer,
				surface,
				areaM2,
				vertices,
				holes: [],
				color: material?.color?.hex,
				textureName
			});
		}
	}

	function walk(entity: BomEntity, pathParts: string[], depth = 0, parentHasKind = false) {
		if (depth > PARSE_LIMITS.maxDepth) {
			throw new Error(`Struktur JSON terlalu dalam. Maksimum ${PARSE_LIMITS.maxDepth} level.`);
		}
		entitiesTotal += 1;
		if (entitiesTotal > PARSE_LIMITS.maxEntities) {
			throw new Error(`Terlalu banyak entity. Maksimum ${format(PARSE_LIMITS.maxEntities)} entity.`);
		}
		const name = entity.name || entity.definition_name || entity.type || 'Entity';
		const path = pathParts.concat(name).join(' > ');
		
		let currentHasKind = parentHasKind;
		const compName = entity.name || entity.definition_name;
		if (compName) {
			const kind = detectNameKind(compName);
			if (kind) {
				if (!parentHasKind) {
					recordComponent(entity, path);
					currentHasKind = true;
				}
			}
		}

		if (entity.type === 'Face' && entity.vertices && entity.vertices.length >= 3) {
			if (vertexCount + entity.vertices.length > PARSE_LIMITS.maxTotalVertices) {
				throw new Error(`Terlalu banyak vertex. Maksimum ${format(PARSE_LIMITS.maxTotalVertices)} vertex.`);
			}
			const vertices = entity.vertices.map(toWorld);
			const holes = (entity.holes || []).map((loop) => loop.map(vectorToWorld));
			const surface = normalizeSurface(entity.surface_type, path);
			const areaM2 = Number(entity.area_m2) || 0;
			const color = entity.mat_color || entity.material_front?.color?.hex || undefined;
			const textureName = entity.material_front?.texture?.filename || entity.material_front?.texture?.source_path || entity.material_front?.name || undefined;
			appendFace({
				id: entity.id || `face-${faces.length + 1}`,
				name,
				path,
				layer: entity.layer,
				surface,
				areaM2,
				vertices,
				holes,
				color,
				textureName
			});
		}

		entity.children?.forEach((child) => walk(child, pathParts.concat(name), depth + 1, currentHasKind));
	}

	if (compactMesh) {
		walkCompactMesh(compactMesh);
	} else {
		data.entities?.forEach((entity) => walk(entity, [], 0, false));
	}

	if (!faces.length) {
		throw new Error('Tidak ada Face renderable di JSON.');
	}

	const finalBounds = finalizeBounds(bounds);
	const floorLevels = estimateFloorLevels(faces);
	faces.forEach((face) => {
		face.partKey = refinePartKey(face, finalBounds, floorLevels);
	});
	refineOpeningClusters(faces, floorLevels, finalBounds);
	const surfaceStats = [...surfaceAccumulator.entries()]
		.map(([key, value]) => ({
			key,
			label: SURFACE_META[key].label,
			count: value.count,
			areaM2: round(value.areaM2, 1),
			confidence: key === 'other' ? 0.45 : 0.82
		}))
		.sort((a, b) => b.areaM2 - a.areaM2);
	const refinedPartAccumulator = new Map<PartKey, { count: number; areaM2: number }>();
	faces.forEach((face) => {
		const current = refinedPartAccumulator.get(face.partKey) || { count: 0, areaM2: 0 };
		current.count += 1;
		current.areaM2 += face.areaM2;
		refinedPartAccumulator.set(face.partKey, current);
	});
	const partStats = [...refinedPartAccumulator.entries()]
		.filter(([key, value]) => key !== 'other' && value.areaM2 > 0)
		.map(([key, value]) => ({
			key,
			label: PART_META[key].label,
			count: value.count,
			areaM2: round(value.areaM2, 1),
			color: PART_META[key].color
		}))
		.sort((a, b) => PART_META[a.key].order - PART_META[b.key].order);
	const spaces = makeSpaces(faces, finalBounds, defaultHeight);
	const warnings: string[] = [];
	if (!components.windows) warnings.push('Jendela tidak terdeteksi eksplisit. OTTV memakai rasio kaca input.');
	if (!components.doors) warnings.push('Pintu tidak terdeteksi eksplisit. Flow manusia memakai estimasi zona.');
	if (spaces.some((space) => space.source === 'estimated_footprint')) warnings.push('Ruang tidak eksplisit di JSON. Sistem memakai footprint estimasi.');
	if (spaces.some((space) => space.source === 'detected_floor')) {
		warnings.push('Area ruang terdeteksi berasal dari polygon lantai yang lolos filter ruang, bukan total seluruh surface horizontal SketchUp.');
	}

	const confidenceParts = [
		faces.length > 0 ? 0.9 : 0.2,
		surfaceStats.length >= 4 ? 0.85 : 0.55,
		spaces[0]?.source === 'detected_floor' ? 0.65 : 0.35,
		components.doors || components.windows ? 0.6 : 0.45
	];

	return {
		sourceName,
		schemaVersion: data.schema_version || '-',
		exportLevel: data.export_level || '-',
		exportedAt: data.exported_at || '-',
		entitiesTotal,
		faceCount: faces.length,
		vertexCount,
		faces,
		spaces,
		bounds: finalBounds,
		surfaceStats,
		partStats,
		components,
		materials: materialRows(data.materials),
		confidence: average(confidenceParts),
		warnings
	};
}

export function getTotalArea(spaces: SpaceZone[]) {
	return spaces.reduce((sum, space) => sum + boundedNumber(space.areaM2), 0);
}

export function getTotalVolume(spaces: SpaceZone[]) {
	return spaces.reduce((sum, space) => sum + boundedNumber(space.volumeM3), 0);
}

export function getReadiness(model: ParsedBuildingModel | null, inputs: ProjectInputs, touched: TouchedInputs): ReadinessItem[] {
	if (!model) {
		return (Object.keys(ANALYSIS_META) as AnalysisKind[]).map((kind) => ({
			kind,
			label: ANALYSIS_META[kind].label,
			status: 'blocked',
			missing: ['Upload JSON'],
			confidence: 0
		}));
	}

	const hasSpaces = model.spaces.length > 0;
	const hasEnvelope = model.surfaceStats.some((stat) => stat.key.startsWith('wall')) && model.surfaceStats.some((stat) => stat.key === 'roof_slope');
	const invalidPeople = !Number.isFinite(inputs.peopleCount) || inputs.peopleCount <= 0;
	const invalidGlass = !Number.isFinite(inputs.glassRatio) || inputs.glassRatio < 0 || inputs.glassRatio > 90;
	const required: Record<AnalysisKind, Array<keyof ProjectInputs>> = {
		lighting: ['roomFunction', 'lampPreset'],
		ac: ['roomFunction', 'peopleCount', 'operationHours', 'setPointC'],
		ottv: ['orientationDeg', 'wallMaterial', 'glassMaterial', 'glassRatio'],
		thermal: ['roomFunction', 'wallMaterial', 'roofMaterial'],
		people: ['roomFunction'],
		wind: ['dominantWind', 'orientationDeg']
	};

	return (Object.keys(ANALYSIS_META) as AnalysisKind[]).map((kind) => {
		const missing: string[] = [];
		const defaults: string[] = [];
		for (const key of required[kind]) {
			if (!touched[key]) defaults.push(inputLabel(key));
		}
		if (!hasSpaces && ['lighting', 'ac', 'people'].includes(kind)) missing.push('Area ruang');
		if (!hasEnvelope && ['ottv', 'thermal', 'wind'].includes(kind)) missing.push('Dinding/atap');
		if (invalidPeople && kind === 'ac') missing.push('Jumlah orang valid');
		if (invalidGlass && kind === 'ottv') missing.push('Rasio kaca 0-90%');

		const status = missing.length ? 'blocked' : defaults.length ? 'estimate' : 'ready';
		const confidence = clamp(model.confidence - missing.length * 0.16 - defaults.length * 0.04, 0.15, 0.95);
		return {
			kind,
			label: ANALYSIS_META[kind].label,
			status,
			missing: missing.length ? missing : defaults.map((item) => `${item} pakai preset`),
			confidence
		};
	});
}

export function runAnalysis(kind: AnalysisKind, model: ParsedBuildingModel, inputs: ProjectInputs, spaces: SpaceZone[]): AnalysisResult {
	switch (kind) {
		case 'lighting':
			return lightingAnalysis(model, inputs, spaces);
		case 'ac':
			return acAnalysis(model, inputs, spaces);
		case 'ottv':
			return ottvAnalysis(model, inputs, spaces);
		case 'thermal':
			return thermalAnalysis(model, inputs, spaces);
		case 'people':
			return peopleAnalysis(model, inputs, spaces);
		case 'wind':
			return windAnalysis(model, inputs, spaces);
	}
}

function lightingAnalysis(model: ParsedBuildingModel, inputs: ProjectInputs, spaces: SpaceZone[]): AnalysisResult {
	const lamp = LAMP_PRESETS[inputs.lampPreset];
	const rows = spaces.map((space) => {
		const fn = ROOM_FUNCTIONS[space.functionKey || inputs.roomFunction];
		const lumens = (space.areaM2 * fn.lux) / Math.max(lamp.cu * lamp.llf, 0.1);
		const lamps = Math.ceil(lumens / lamp.lumens);
		const watt = lamps * lamp.watt;
		return {
			label: space.name,
			value: `${format(lamps)} unit`,
			unit: `${format(watt)} W`,
			note: `${fn.label}, target ${format(fn.lux)} lux`
		};
	});
	const totalLamps = rows.reduce((sum, row) => sum + Number.parseFloat(row.value), 0);
	return {
		kind: 'lighting',
		title: 'Estimasi pencahayaan',
		summary: `${format(totalLamps)} lampu ${lamp.label} untuk ${format(getTotalArea(spaces), 1)} m2 area terdeteksi.`,
		confidence: clamp(model.confidence + 0.04, 0.2, 0.92),
		tables: [{ title: 'Lampu per zona', rows }],
		recommendations: [
			'Validasi fungsi ruang sebelum final.',
			'Tambahkan layout plafon untuk penempatan lampu lebih presisi.',
			'Gunakan lampu CRI tinggi untuk area kerja atau retail.'
		],
		beforeAfter: [
			{ metric: 'Kontrol input', before: 'Lux manual', after: 'Target lux dari fungsi ruang' },
			{ metric: 'Output', before: 'Tidak ada titik lampu', after: `${format(totalLamps)} titik lampu estimasi` }
		],
		markers: spaces.slice(0, 18).map((space) => ({
			type: 'point',
			label: space.name,
			position: { x: space.center.x, y: space.center.y + Math.min(space.heightM, 3), z: space.center.z },
			value: ROOM_FUNCTIONS[space.functionKey].lux,
			color: '#facc15'
		}))
	};
}

function acAnalysis(model: ParsedBuildingModel, inputs: ProjectInputs, spaces: SpaceZone[]): AnalysisResult {
	const peopleLoadW = inputs.peopleCount * 120;
	const rows = spaces.map((space) => {
		const fn = ROOM_FUNCTIONS[space.functionKey || inputs.roomFunction];
		const areaShare = space.areaM2 / Math.max(getTotalArea(spaces), 1);
		const sensibleW = space.areaM2 * fn.coolingWm2 + peopleLoadW * areaShare;
		const btu = sensibleW * 3.412;
		const pk = btu / 9000;
		return {
			label: space.name,
			value: `${format(btu, 0)} BTU/h`,
			unit: `${format(pk, 1)} PK`,
			note: `${fn.label}, set point ${inputs.setPointC} C`,
			status: pk > 2 ? 'warn' : 'good'
		} satisfies AnalysisRow;
	});
	const totalBtu = rows.reduce((sum, row) => sum + Number.parseFloat(row.value.replace(/,/g, '')), 0);
	return {
		kind: 'ac',
		title: 'Estimasi kebutuhan AC',
		summary: `Total ${format(totalBtu, 0)} BTU/h untuk ${format(inputs.peopleCount)} orang dan ${format(inputs.operationHours)} jam operasi.`,
		confidence: clamp(model.confidence - 0.03, 0.2, 0.88),
		tables: [{ title: 'Kapasitas AC per zona', rows }],
		recommendations: [
			'Pecah zona AC jika satu ruang melebihi 2 PK.',
			'Turunkan beban panas atap untuk menurunkan kapasitas AC.',
			'Gunakan occupancy aktual untuk hasil lebih presisi.'
		],
		beforeAfter: [
			{ metric: 'Beban atap', before: ROOF_PRESETS[inputs.roofMaterial].label, after: ROOF_PRESETS.spandek_insulated.label },
			{ metric: 'Set point', before: `${inputs.setPointC} C`, after: `${Math.max(inputs.setPointC, 25)} C + kipas sirkulasi` }
		],
		markers: spaces.slice(0, 12).map((space) => ({
			type: 'zone',
			label: space.name,
			position: { x: space.center.x, y: space.center.y + 0.12, z: space.center.z },
			value: space.areaM2,
			color: '#38bdf8'
		}))
	};
}

function ottvAnalysis(model: ParsedBuildingModel, inputs: ProjectInputs, spaces: SpaceZone[]): AnalysisResult {
	const wallArea = model.surfaceStats.filter((stat) => stat.key.startsWith('wall')).reduce((sum, stat) => sum + stat.areaM2, 0);
	const glassArea = wallArea * (inputs.glassRatio / 100);
	const opaqueArea = Math.max(wallArea - glassArea, 0);
	const wall = WALL_PRESETS[inputs.wallMaterial];
	const glass = GLASS_PRESETS[inputs.glassMaterial];
	const orientationFactor = orientationSolarFactor(inputs.orientationDeg);
	const tdEq = 12;
	const deltaT = 5;
	const solar = 194 * orientationFactor;
	const ottv = (opaqueArea * wall.uValue * wall.absorptance * tdEq + glassArea * glass.uValue * deltaT + glassArea * glass.shgc * solar) / Math.max(wallArea, 1);
	const status: AnalysisRow['status'] = ottv <= 35 ? 'good' : ottv <= 45 ? 'warn' : 'bad';
	return {
		kind: 'ottv',
		title: 'Estimasi OTTV fasad',
		summary: `OTTV estimasi ${format(ottv, 1)} W/m2. Target awal: di bawah 35 W/m2.`,
		confidence: clamp(model.confidence - (model.components.windows ? 0.06 : 0.18), 0.18, 0.82),
		tables: [
			{
				title: 'Input envelope',
				rows: [
					{ label: 'Area dinding', value: format(wallArea, 1), unit: 'm2' },
					{ label: 'Estimasi kaca', value: format(glassArea, 1), unit: 'm2', note: `${inputs.glassRatio}% dari dinding` },
					{ label: 'Material dinding', value: wall.label, unit: `U ${wall.uValue}` },
					{ label: 'Material kaca', value: glass.label, unit: `SHGC ${glass.shgc}` },
					{ label: 'OTTV', value: format(ottv, 1), unit: 'W/m2', status }
				]
			}
		],
		recommendations: [
			'Turunkan rasio kaca atau pakai kaca tinted jika OTTV tinggi.',
			'Tambah shading di fasad barat/timur.',
			'Validasi orientasi bangunan dari gambar situasi.'
		],
		beforeAfter: [
			{ metric: 'Kaca', before: GLASS_PRESETS[inputs.glassMaterial].label, after: GLASS_PRESETS.tinted_glass.label },
			{ metric: 'Rasio kaca', before: `${inputs.glassRatio}%`, after: `${Math.max(inputs.glassRatio - 8, 8)}%` }
		],
		markers: [
			{
				type: 'arrow',
				label: 'Orientasi',
				position: model.bounds.center,
				direction: angleToVector(inputs.orientationDeg),
				value: ottv,
				color: status === 'good' ? '#22c55e' : status === 'warn' ? '#f59e0b' : '#ef4444'
			}
		]
	};
}

function thermalAnalysis(model: ParsedBuildingModel, inputs: ProjectInputs, spaces: SpaceZone[]): AnalysisResult {
	const roofArea = statArea(model, 'roof_slope');
	const wallArea = model.surfaceStats.filter((stat) => stat.key.startsWith('wall')).reduce((sum, stat) => sum + stat.areaM2, 0);
	const roof = ROOF_PRESETS[inputs.roofMaterial];
	const wall = WALL_PRESETS[inputs.wallMaterial];
	const score = clamp((roofArea * roof.uValue * roof.absorptance + wallArea * wall.uValue * wall.absorptance) / Math.max(getTotalArea(spaces), 1), 0, 100);
	const comfort = 100 - clamp(score * 2.4, 0, 92);
	return {
		kind: 'thermal',
		title: 'Kenyamanan termal',
		summary: `Skor kenyamanan awal ${format(comfort, 0)}/100. Beban utama dari atap dan dinding luar.`,
		confidence: clamp(model.confidence - 0.04, 0.2, 0.86),
		tables: [
			{
				title: 'Beban envelope',
				rows: [
					{ label: 'Atap', value: format(roofArea, 1), unit: 'm2', note: roof.label },
					{ label: 'Dinding', value: format(wallArea, 1), unit: 'm2', note: wall.label },
					{ label: 'Skor nyaman', value: format(comfort, 0), unit: '/100', status: comfort > 70 ? 'good' : comfort > 50 ? 'warn' : 'bad' }
				]
			}
		],
		recommendations: [
			'Prioritas: insulasi atap atau radiant barrier.',
			'Gunakan warna fasad lebih terang untuk menurunkan absorptance.',
			'Tambah ventilasi silang di zona dengan occupancy tinggi.'
		],
		beforeAfter: [
			{ metric: 'Atap', before: ROOF_PRESETS[inputs.roofMaterial].label, after: ROOF_PRESETS.spandek_insulated.label },
			{ metric: 'Skor nyaman', before: `${format(comfort, 0)}/100`, after: `${format(Math.min(comfort + 18, 96), 0)}/100` }
		],
		markers: spaces.slice(0, 12).map((space) => ({
			type: 'zone',
			label: space.name,
			position: { x: space.center.x, y: space.center.y + 0.1, z: space.center.z },
			value: comfort,
			color: comfort > 70 ? '#22c55e' : comfort > 50 ? '#f59e0b' : '#ef4444'
		}))
	};
}

function peopleAnalysis(model: ParsedBuildingModel, inputs: ProjectInputs, spaces: SpaceZone[]): AnalysisResult {
	const rows = spaces.map((space) => {
		const fn = ROOM_FUNCTIONS[space.functionKey || inputs.roomFunction];
		const capacity = Math.max(Math.floor(space.areaM2 / fn.peopleDensityM2), 1);
		const flowScore = clamp((model.components.doors * 18 + capacity * 3) / Math.max(inputs.peopleCount, 1), 0, 100);
		return {
			label: space.name,
			value: `${format(capacity)} orang`,
			unit: `${format(flowScore, 0)}/100`,
			note: fn.label,
			status: flowScore > 70 ? 'good' : flowScore > 45 ? 'warn' : 'bad'
		} satisfies AnalysisRow;
	});
	const capacityTotal = rows.reduce((sum, row) => sum + Number.parseFloat(row.value), 0);
	return {
		kind: 'people',
		title: 'Flow manusia',
		summary: `Kapasitas estimasi ${format(capacityTotal)} orang. Pintu terdeteksi: ${format(model.components.doors)}.`,
		confidence: clamp(model.confidence - (model.components.doors ? 0.02 : 0.16), 0.18, 0.86),
		tables: [{ title: 'Kapasitas dan sirkulasi', rows }],
		recommendations: [
			'Validasi pintu keluar utama pada model.',
			'Pisahkan jalur servis dan pengunjung jika fungsi retail.',
			'Tambah bukaan keluar jika flow score rendah.'
		],
		beforeAfter: [
			{ metric: 'Jalur keluar', before: `${model.components.doors} pintu`, after: `${model.components.doors + 1} pintu prioritas` },
			{ metric: 'Input fungsi', before: 'Preset global', after: 'Fungsi per zona' }
		],
		markers: spaces.slice(0, 10).map((space, index) => ({
			type: 'arrow',
			label: space.name,
			position: { x: space.center.x - 0.8, y: space.center.y + 0.35, z: space.center.z - 0.8 },
			direction: { x: index % 2 ? 1 : -1, y: 0, z: 0.45 },
			value: space.areaM2,
			color: '#22c55e'
		}))
	};
}

function windAnalysis(model: ParsedBuildingModel, inputs: ProjectInputs, spaces: SpaceZone[]): AnalysisResult {
	const direction = DIRECTION_ANGLE[inputs.dominantWind];
	const alignment = Math.abs(Math.cos(((direction - inputs.orientationDeg) * Math.PI) / 180));
	const openingFactor = clamp((model.components.windows + model.components.doors) / 8, 0.1, 1);
	const score = clamp((0.35 + alignment * 0.4 + openingFactor * 0.25) * 100, 0, 100);
	return {
		kind: 'wind',
		title: 'Flow angin',
		summary: `Skor ventilasi silang ${format(score, 0)}/100 dari arah angin ${inputs.dominantWind}.`,
		confidence: clamp(model.confidence - (model.components.windows ? 0.05 : 0.17), 0.18, 0.86),
		tables: [
			{
				title: 'Ventilasi',
				rows: [
					{ label: 'Arah angin', value: inputs.dominantWind, unit: `${direction} deg` },
					{ label: 'Bukaan terdeteksi', value: format(model.components.windows + model.components.doors), unit: 'item' },
					{ label: 'Skor flow', value: format(score, 0), unit: '/100', status: score > 70 ? 'good' : score > 45 ? 'warn' : 'bad' }
				]
			}
		],
		recommendations: [
			'Tambah bukaan berhadapan untuk ventilasi silang.',
			'Jangan blokir jalur angin dengan furnitur tinggi.',
			'Validasi arah angin dominan dari data lokasi.'
		],
		beforeAfter: [
			{ metric: 'Bukaan', before: `${model.components.windows + model.components.doors} item`, after: `${model.components.windows + model.components.doors + 2} item berhadapan` },
			{ metric: 'Skor flow', before: `${format(score, 0)}/100`, after: `${format(Math.min(score + 16, 96), 0)}/100` }
		],
		markers: [
			{
				type: 'arrow',
				label: 'Arah angin',
				position: {
					x: model.bounds.center.x - angleToVector(direction).x * model.bounds.size.x * 0.35,
					y: model.bounds.center.y,
					z: model.bounds.center.z - angleToVector(direction).z * model.bounds.size.z * 0.35
				},
				direction: angleToVector(direction),
				value: score,
				color: '#38bdf8'
			}
		]
	};
}

function inputLabel(key: keyof ProjectInputs) {
	const labels: Record<keyof ProjectInputs, string> = {
		roomFunction: 'Fungsi ruang',
		peopleCount: 'Jumlah orang',
		operationHours: 'Jam operasional',
		setPointC: 'Set point suhu',
		orientationDeg: 'Orientasi',
		dominantWind: 'Arah angin',
		wallMaterial: 'Material dinding',
		glassMaterial: 'Material kaca',
		roofMaterial: 'Material atap',
		lampPreset: 'Preset lampu',
		glassRatio: 'Rasio kaca',
		roomHeightM: 'Tinggi ruang'
	};
	return labels[key];
}

function statArea(model: ParsedBuildingModel, key: SurfaceKey) {
	return model.surfaceStats.find((stat) => stat.key === key)?.areaM2 || 0;
}

function orientationSolarFactor(deg: number) {
	const eastWest = Math.abs(Math.sin((deg * Math.PI) / 180));
	return 0.72 + eastWest * 0.42;
}

function angleToVector(deg: number): Point3 {
	const rad = (deg * Math.PI) / 180;
	return {
		x: Math.sin(rad),
		y: 0,
		z: Math.cos(rad)
	};
}

function average(values: number[]) {
	return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function boundedNumber(value: number) {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 2) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

export function format(value: number, digits = 0) {
	return new Intl.NumberFormat('id-ID', {
		maximumFractionDigits: digits,
		minimumFractionDigits: digits
	}).format(value);
}
