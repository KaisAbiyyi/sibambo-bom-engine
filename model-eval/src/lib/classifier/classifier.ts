import { MODEL_SPECIFIC_OVERRIDES } from './model-overrides';
import {
	BUILDING_CATEGORIES,
	RULE_BANK_V1,
	RULE_BANK_VERSION,
	type BuildingCategory,
	type ClassificationRule
} from './rule-bank-v1';

export type ClassifierBounds = {
	min: { x: number; y: number; z: number };
	max: { x: number; y: number; z: number };
	size: { x: number; y: number; z: number };
	center: { x: number; y: number; z: number };
};

export type ClassifierFaceInput = {
	id: string;
	name: string;
	path: string;
	layer?: string;
	surface: string;
	areaM2: number;
	bounds: ClassifierBounds;
	center: { x: number; y: number; z: number };
	vertexCount: number;
	holeCount: number;
	color?: string;
	textureName?: string;
	legacyPartKey?: string;
};

export type ClassifierContext = {
	modelName: string;
	buildingBounds: ClassifierBounds;
	floorLevels: number[];
};

export type EvidenceSignal = {
	key: string;
	source: 'metadata' | 'label' | 'definition' | 'topology' | 'adjacency' | 'orientation' | 'elevation' | 'bounds' | 'enclosure' | 'host' | 'material' | 'repetition' | 'building' | 'legacy';
	detail: string;
	strength: number;
};

export type ClassificationCandidate = {
	category: Exclude<BuildingCategory, 'unknown'>;
	score: number;
	confidence: number;
	threshold: number;
	activatedRules: string[];
	supportingEvidence: EvidenceSignal[];
	rejectingEvidence: EvidenceSignal[];
	explanations: string[];
};

export type ClassificationTrace = {
	ruleBankVersion: string;
	category: BuildingCategory;
	confidence: number;
	candidates: ClassificationCandidate[];
	activatedRules: string[];
	supportingEvidence: EvidenceSignal[];
	rejectingEvidence: EvidenceSignal[];
	conflictResolution: string;
	explanation: string;
	unknownReason?: string;
	modelSpecificOverride?: string;
};

type EvidenceMap = Map<string, EvidenceSignal>;

export const CATEGORY_LABELS: Record<BuildingCategory, string> = {
	roof: 'Roof',
	floor: 'Floor / slab',
	ceiling: 'Ceiling',
	exterior_wall: 'Exterior wall',
	interior_wall: 'Interior wall',
	door: 'Door',
	window: 'Window / fenestration',
	column: 'Column',
	beam: 'Beam',
	stair: 'Stair',
	railing: 'Railing',
	furniture: 'Furniture',
	fixture: 'Fixture',
	opening: 'Opening',
	room_boundary: 'Room boundary',
	unknown: 'Unknown'
};

export function classifyBuildingFaces(faces: ClassifierFaceInput[], context: ClassifierContext): ClassificationTrace[] {
	const repetition = repetitionCounts(faces);
	const wallIndex = buildWallIndex(faces);
	const openingIndex = buildOpeningIndex(faces);
	return faces.map((face) => {
		const evidence = extractEvidence(face, context, repetition, wallIndex, openingIndex);
		const override = MODEL_SPECIFIC_OVERRIDES.find(
			(item) => item.modelPattern.test(context.modelName) && item.faceIdPattern.test(face.id)
		);
		if (override) {
			const signal: EvidenceSignal = { key: 'override.model_specific', source: 'metadata', detail: override.reason, strength: 1 };
			return {
				ruleBankVersion: RULE_BANK_VERSION,
				category: override.category,
				confidence: override.confidence,
				candidates: [],
				activatedRules: [],
				supportingEvidence: [signal],
				rejectingEvidence: [],
				conflictResolution: `model-specific override ${override.id}`,
				explanation: override.reason,
				modelSpecificOverride: override.id
			};
		}
		return evaluateRules(evidence);
	});
}

function evaluateRules(evidence: EvidenceMap): ClassificationTrace {
	const byCategory = new Map<Exclude<BuildingCategory, 'unknown'>, ClassificationCandidate>();
	for (const rule of RULE_BANK_V1) {
		if (!ruleEligible(rule, evidence)) continue;
		const positive = rule.positive.map((item) => evidence.get(item.key)).filter((item): item is EvidenceSignal => Boolean(item));
		const negative = (rule.negative || []).map((item) => evidence.get(item.key)).filter((item): item is EvidenceSignal => Boolean(item));
		const positiveScore = rule.positive.reduce((sum, item) => sum + (evidence.get(item.key)?.strength || 0) * item.weight, 0);
		const negativeScore = (rule.negative || []).reduce((sum, item) => sum + (evidence.get(item.key)?.strength || 0) * item.weight, 0);
		const score = clamp((rule.baseScore || 0) + positiveScore - negativeScore, 0, 1);
		if (score <= 0) continue;
		const existing = byCategory.get(rule.target);
		if (!existing || score > existing.score) {
			byCategory.set(rule.target, {
				category: rule.target,
				score,
				confidence: score,
				threshold: rule.confidenceThreshold,
				activatedRules: [rule.id],
				supportingEvidence: uniqueSignals(positive),
				rejectingEvidence: uniqueSignals(negative),
				explanations: [rule.explanation]
			});
		} else {
			existing.activatedRules.push(rule.id);
			existing.supportingEvidence = uniqueSignals(existing.supportingEvidence.concat(positive));
			existing.rejectingEvidence = uniqueSignals(existing.rejectingEvidence.concat(negative));
			existing.explanations.push(rule.explanation);
		}
	}
	const candidates = [...byCategory.values()].sort((left, right) => right.score - left.score || left.category.localeCompare(right.category));
	const top = candidates[0];
	const second = candidates[1];
	if (!top || top.score < top.threshold) {
		const score = top?.score || 0;
		const threshold = top?.threshold || 0.55;
		const reason = `Evidence below confidence threshold (${round(score)} < ${round(threshold)}).`;
		return unknownTrace(candidates, reason, `below threshold; fallback unknown`);
	}
	const margin = top.score - (second?.score || 0);
	const explicitConflict = Boolean(evidence.get('label.conflict'));
	if (second && (margin < 0.08 || (explicitConflict && margin < 0.18))) {
		const reason = `Top candidates ${top.category} and ${second.category} are ambiguous (margin ${round(margin)}).`;
		return unknownTrace(candidates, reason, `ambiguous: ${top.category} vs ${second.category}; margin ${round(margin)}`);
	}
	const conflictResolution = second
		? `selected ${top.category}; score ${round(top.score)} exceeds ${second.category} by ${round(margin)}`
		: `selected ${top.category}; only candidate above evidence requirements`;
	return {
		ruleBankVersion: RULE_BANK_VERSION,
		category: top.category,
		confidence: round(top.confidence),
		candidates,
		activatedRules: top.activatedRules,
		supportingEvidence: top.supportingEvidence,
		rejectingEvidence: top.rejectingEvidence,
		conflictResolution,
		explanation: `${top.explanations[0]} ${conflictResolution}`
	};
}

function unknownTrace(candidates: ClassificationCandidate[], reason: string, conflictResolution: string): ClassificationTrace {
	const top = candidates[0];
	return {
		ruleBankVersion: RULE_BANK_VERSION,
		category: 'unknown',
		confidence: round(clamp(1 - (top?.score || 0) * 0.6, 0.25, 0.9)),
		candidates,
		activatedRules: top?.activatedRules || [],
		supportingEvidence: top?.supportingEvidence || [],
		rejectingEvidence: top?.rejectingEvidence || [],
		conflictResolution,
		explanation: reason,
		unknownReason: reason
	};
}

function ruleEligible(rule: ClassificationRule, evidence: EvidenceMap) {
	if (rule.requiredAll?.some((key) => !evidence.has(key))) return false;
	if (rule.requiredAny?.length && !rule.requiredAny.some((key) => evidence.has(key))) return false;
	return true;
}

function extractEvidence(
	face: ClassifierFaceInput,
	context: ClassifierContext,
	repetition: Map<string, number>,
	wallIndex: Map<string, ClassifierFaceInput[]>,
	openingIndex: Map<string, ClassifierFaceInput[]>
) {
	const evidence: EvidenceMap = new Map();
	const add = (key: string, source: EvidenceSignal['source'], detail: string, strength = 1) => {
		const existing = evidence.get(key);
		if (!existing || strength > existing.strength) evidence.set(key, { key, source, detail, strength: clamp(strength, 0, 1) });
	};
	const text = normalize(`${face.name} ${face.path} ${face.layer || ''}`);
	const materialText = normalize(`${face.textureName || ''}`);
	const labelPatterns: Array<[string, RegExp]> = [
		['roof', /\b(atap|roof|genteng|spandek|perabung|reng|rafter)\b/],
		['floor', /\b(lantai|floor|slab|pelat lantai|ubin|parket)\b/],
		['ceiling', /\b(plafon|ceiling|langit)\b/],
		['exterior_wall', /\b(dinding luar|exterior wall|external wall|facade|fasad)\b/],
		['interior_wall', /\b(dinding dalam|interior wall|partition|sekat)\b/],
		['door', /\b(pintu|door|entrance|gerbang)\b/],
		['window', /\b(jendela|window|fenestration|glazing|kaca)\b/],
		['column', /\b(kolom|column|pillar|tiang)\b/],
		['beam', /\b(balok|beam|sloof|girder)\b/],
		['stair', /\b(tangga|stair|stairs|step|anak tangga)\b/],
		['railing', /\b(railing|pagar|handrail|balustrade)\b/],
		['furniture', /\b(furniture|meja|kursi|sofa|lemari|ranjang|bed|table|chair|cabinet)\b/],
		['fixture', /\b(fixture|wastafel|sink|toilet|wc|lampu|sanitary|urinal|bathtub|ac unit)\b/],
		['opening', /\b(opening|bukaan|void|lubang)\b/],
		['room_boundary', /\b(room boundary|space boundary|batas ruang|zona boundary)\b/]
	];
	const matchedLabels: string[] = [];
	for (const [category, pattern] of labelPatterns) {
		if (pattern.test(text)) {
			add(`label.${category}`, 'label', `Normalized metadata contains ${category} token.`);
			matchedLabels.push(category);
		}
	}
	if (/\b(dinding|wall)\b/.test(text)) add('label.wall', 'label', 'Metadata contains generic wall token.');
	if (matchedLabels.length > 1) add('label.conflict', 'label', `Conflicting explicit labels: ${matchedLabels.join(', ')}.`);

	const surface = face.surface.toLowerCase();
	if (surface.includes('roof')) add('surface.roof', 'orientation', `Surface hint is ${surface}.`);
	if (surface === 'floor') add('surface.floor', 'orientation', 'Surface hint is floor.');
	if (surface === 'ceiling') add('surface.ceiling', 'orientation', 'Surface hint is ceiling.');
	if (surface.startsWith('wall')) add('surface.wall', 'orientation', `Surface hint is ${surface}.`);

	const { size } = face.bounds;
	const planLong = Math.max(size.x, size.z);
	const planThin = Math.min(size.x, size.z);
	const horizontal = ['floor', 'ceiling'].includes(surface) || (size.y <= Math.max(size.x, size.z) * 0.08 && planLong > 0.2);
	const vertical = surface.startsWith('wall') || size.y >= Math.max(planThin * 1.8, 0.4);
	if (horizontal) add('orientation.horizontal', 'orientation', 'Bounding box is predominantly horizontal.');
	if (vertical) add('orientation.vertical', 'orientation', 'Surface/bounds are predominantly vertical.');
	if (face.areaM2 >= 8) add('geometry.large', 'bounds', `Area ${round(face.areaM2)} m2 is building-scale.`, clamp(face.areaM2 / 40, 0.55, 1));
	if (face.areaM2 <= 4 && Math.max(size.x, size.y, size.z) <= 3) add('geometry.small', 'bounds', 'Area and bounds are compact.');
	const width = Math.max(size.x, size.z);
	if (vertical && width >= 0.25 && width <= 4.5 && size.y >= 0.4 && size.y <= 3.5 && face.areaM2 <= 14) {
		add('geometry.opening_sized', 'bounds', `Vertical bounds ${round(width)}m x ${round(size.y)}m fit opening proportions.`);
	}
	if (size.y >= 2 && planThin <= 0.8 && size.y / Math.max(planLong, 0.1) >= 1.2) add('shape.tall_slender', 'bounds', 'Tall slender bounds fit column proportions.');
	if (planLong >= 3 && size.y <= 0.8 && planThin <= 0.8) add('shape.long_horizontal', 'bounds', 'Long shallow bounds fit beam proportions.');
	if (planLong >= 2.5 && planThin <= 0.2 && size.y >= 0.5 && size.y <= 2.5) add('shape.thin_linear', 'bounds', 'Thin linear bounds fit railing proportions.');
	if (vertical && planLong <= 0.22 && size.y >= 0.4 && size.y <= 3.5 && face.areaM2 <= 1) add('shape.thin_frame', 'bounds', 'Thin vertical bounds fit an opening frame member.');
	if (size.y >= 1 && planLong >= 2 && Math.max(planThin, 0) >= 1) add('shape.stepped_volume', 'bounds', 'Bounds span a walkable stepped volume.');
	if (horizontal && face.areaM2 >= 4 && width >= 1.5) add('geometry.room_sized', 'enclosure', 'Horizontal polygon is large enough for a room boundary.');
	if (face.vertexCount >= 4) add('topology.enclosed_polygon', 'topology', `Closed polygon has ${face.vertexCount} vertices.`, 0.8);
	if (face.holeCount > 0) add('topology.hole', 'topology', `Face contains ${face.holeCount} inner loop(s).`);

	const floors = context.floorLevels.length ? context.floorLevels : [context.buildingBounds.min.y];
	const nearestFloor = floors.reduce((best, level) => (Math.abs(face.bounds.min.y - level) < Math.abs(face.bounds.min.y - best) ? level : best), floors[0]);
	const floorDelta = face.bounds.min.y - nearestFloor;
	if (Math.abs(floorDelta) <= 0.25) add('elevation.touches_floor', 'elevation', `Lower bound is ${round(Math.abs(floorDelta))}m from a floor level.`);
	if (floorDelta > 0.35) add('elevation.above_floor', 'elevation', `Lower bound is ${round(floorDelta)}m above floor.`);
	if (floors.some((level) => Math.abs(face.center.y - level) <= 0.25)) add('elevation.floor_level', 'elevation', 'Face center aligns with a detected floor level.');
	const below = floors.filter((level) => level < face.center.y - 0.5).sort((a, b) => b - a)[0];
	if (below !== undefined && face.center.y - below >= 2 && face.center.y - below <= 4.5) add('elevation.ceiling_height', 'elevation', 'Face is at typical ceiling height above lower floor.');
	const buildingHeight = Math.max(context.buildingBounds.size.y, 0.1);
	if (face.center.y >= context.buildingBounds.min.y + buildingHeight * 0.72) add('elevation.top', 'building', 'Face is in top 28% of building elevation.');

	const perimeterTolerance = Math.max(0.3, Math.max(context.buildingBounds.size.x, context.buildingBounds.size.z) * 0.04);
	const perimeter =
		Math.abs(face.bounds.min.x - context.buildingBounds.min.x) <= perimeterTolerance ||
		Math.abs(face.bounds.max.x - context.buildingBounds.max.x) <= perimeterTolerance ||
		Math.abs(face.bounds.min.z - context.buildingBounds.min.z) <= perimeterTolerance ||
		Math.abs(face.bounds.max.z - context.buildingBounds.max.z) <= perimeterTolerance;
	if (perimeter) add('context.perimeter', 'building', 'Face lies on building plan perimeter.');
	else add('context.interior', 'building', 'Face lies inside building plan perimeter.');

	const definitionKey = repetitionKey(face.path);
	const repeatCount = repetition.get(definitionKey) || 1;
	if (repeatCount >= 3) add('reuse.repeated', 'repetition', `Definition/path segment repeats ${repeatCount} times.`, clamp(repeatCount / 8, 0.6, 1));
	if (hasWallHost(face, wallIndex)) add('context.wall_host', 'host', 'Bounds overlap or touch a large wall host.');
	if (hasOpeningAnchor(face, openingIndex)) add('context.opening_cluster', 'adjacency', 'Face is adjacent to a glass/window opening anchor.');

	if (/\b(glass|kaca|transparent|glazing)\b/.test(materialText)) add('material.glass', 'material', `Material/texture '${face.textureName}' indicates glass.`);
	if (/\b(wood|kayu|timber)\b/.test(materialText)) add('material.wood', 'material', `Material/texture '${face.textureName}' indicates wood.`);
	if (/\b(concrete|beton|steel|baja|structural)\b/.test(materialText) || surface === 'structure') add('material.structural', 'material', 'Material or surface indicates structural construction.');
	if (/\b(brick|bata|masonry|plaster|stucco)\b/.test(materialText)) add('material.masonry', 'material', 'Material indicates masonry wall construction.');
	if (/\b(metal|steel|baja|aluminium|aluminum)\b/.test(materialText)) add('material.metal', 'material', 'Material indicates metal.');
	if (/\b(spandek|roof|genteng|shingle|tile)\b/.test(`${materialText} ${text}`)) add('material.roofing', 'material', 'Material/name indicates roof covering.');
	if (/\b(floor|lantai|tile|keramik|ubin|parket|paver)\b/.test(materialText)) add('material.flooring', 'material', 'Material indicates floor finish.');
	if (/\b(ceiling|plafon|gypsum|langit)\b/.test(materialText)) add('material.ceiling', 'material', 'Material indicates ceiling finish.');
	if (/\b(ceramic|porcelain|sanitary|chrome)\b/.test(materialText)) add('material.fixture', 'material', 'Material indicates sanitary/MEP fixture.');

	if (face.legacyPartKey) add(`legacy.${legacyKey(face.legacyPartKey)}`, 'legacy', `Legacy classifier suggested ${face.legacyPartKey}.`, 0.65);
	return evidence;
}

function repetitionCounts(faces: ClassifierFaceInput[]) {
	const counts = new Map<string, number>();
	for (const face of faces) {
		const key = repetitionKey(face.path);
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return counts;
}

function repetitionKey(path: string) {
	const parts = path.split('>').map((part) => normalize(part)).filter(Boolean);
	return parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1] || 'root';
}

const WALL_GRID_SIZE = 2;

function buildWallIndex(faces: ClassifierFaceInput[]) {
	const index = new Map<string, ClassifierFaceInput[]>();
	for (const face of faces) {
		if (!face.surface.toLowerCase().startsWith('wall') || face.areaM2 < 8) continue;
		const minX = Math.floor(face.bounds.min.x / WALL_GRID_SIZE);
		const maxX = Math.floor(face.bounds.max.x / WALL_GRID_SIZE);
		const minZ = Math.floor(face.bounds.min.z / WALL_GRID_SIZE);
		const maxZ = Math.floor(face.bounds.max.z / WALL_GRID_SIZE);
		for (let x = minX; x <= maxX; x += 1) {
			for (let z = minZ; z <= maxZ; z += 1) {
				const key = `${x}:${z}`;
				const rows = index.get(key) || [];
				rows.push(face);
				index.set(key, rows);
			}
		}
	}
	return index;
}

function buildOpeningIndex(faces: ClassifierFaceInput[]) {
	const index = new Map<string, ClassifierFaceInput[]>();
	for (const face of faces) {
		const text = normalize(`${face.name} ${face.path} ${face.textureName || ''}`);
		if (!/\b(window|jendela|glass|kaca|glazing|fenestration|translucent)\b/.test(text) && face.legacyPartKey !== 'windows') continue;
		const cellX = Math.floor(face.center.x / WALL_GRID_SIZE);
		const cellZ = Math.floor(face.center.z / WALL_GRID_SIZE);
		const key = `${cellX}:${cellZ}`;
		const rows = index.get(key) || [];
		rows.push(face);
		index.set(key, rows);
	}
	return index;
}

function hasWallHost(face: ClassifierFaceInput, index: Map<string, ClassifierFaceInput[]>) {
	const cellX = Math.floor(face.center.x / WALL_GRID_SIZE);
	const cellZ = Math.floor(face.center.z / WALL_GRID_SIZE);
	const candidates = new Set<ClassifierFaceInput>();
	for (let x = cellX - 1; x <= cellX + 1; x += 1) {
		for (let z = cellZ - 1; z <= cellZ + 1; z += 1) {
			for (const wall of index.get(`${x}:${z}`) || []) candidates.add(wall);
		}
	}
	for (const wall of candidates) {
		if (wall.id === face.id) continue;
		const yOverlap = overlap(face.bounds.min.y, face.bounds.max.y, wall.bounds.min.y, wall.bounds.max.y);
		const xClose = intervalDistance(face.bounds.min.x, face.bounds.max.x, wall.bounds.min.x, wall.bounds.max.x) <= 0.3;
		const zClose = intervalDistance(face.bounds.min.z, face.bounds.max.z, wall.bounds.min.z, wall.bounds.max.z) <= 0.3;
		if (yOverlap >= 0.2 && xClose && zClose) return true;
	}
	return false;
}

function hasOpeningAnchor(face: ClassifierFaceInput, index: Map<string, ClassifierFaceInput[]>) {
	const cellX = Math.floor(face.center.x / WALL_GRID_SIZE);
	const cellZ = Math.floor(face.center.z / WALL_GRID_SIZE);
	for (let x = cellX - 1; x <= cellX + 1; x += 1) {
		for (let z = cellZ - 1; z <= cellZ + 1; z += 1) {
			for (const anchor of index.get(`${x}:${z}`) || []) {
				if (anchor.id === face.id) continue;
				const yGap = intervalDistance(face.bounds.min.y, face.bounds.max.y, anchor.bounds.min.y, anchor.bounds.max.y);
				const xGap = intervalDistance(face.bounds.min.x, face.bounds.max.x, anchor.bounds.min.x, anchor.bounds.max.x);
				const zGap = intervalDistance(face.bounds.min.z, face.bounds.max.z, anchor.bounds.min.z, anchor.bounds.max.z);
				if (yGap <= 0.35 && Math.hypot(xGap, zGap) <= 1.2) return true;
			}
		}
	}
	return false;
}

function overlap(minA: number, maxA: number, minB: number, maxB: number) {
	return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function intervalDistance(minA: number, maxA: number, minB: number, maxB: number) {
	if (maxA < minB) return minB - maxA;
	if (maxB < minA) return minA - maxB;
	return 0;
}

function normalize(value: string) {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[_/\\|:;,.()[\]{}-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function legacyKey(value: string) {
	if (value === 'doors') return 'door';
	if (value === 'windows') return 'window';
	if (value === 'walls') return 'wall';
	return value;
}

function uniqueSignals(signals: EvidenceSignal[]) {
	return [...new Map(signals.map((signal) => [signal.key, signal])).values()];
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

function round(value: number) {
	return Math.round(value * 1000) / 1000;
}

export { BUILDING_CATEGORIES, RULE_BANK_VERSION, type BuildingCategory };
