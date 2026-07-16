/**
 * semantics.ts
 *
 * Task 3B.5: Room semantic inference.
 * Infers space usage from physical evidence, geometric dimensions, topological
 * degree/connections, objects/fixtures, and vocabulary tags (including Indonesian and English).
 */

import type { DetectedRoom } from './detected-room';
import type { RoomTopologyGraph, RoomTopologyNode } from './topology';
import { getConnectedRooms, getExteriorConnections } from './topology';
import { sha256Hex } from './hash';

// ─── Semantic Contracts ───────────────────────────────────────────────────────

export type RoomFunction =
	| 'living'
	| 'bedroom'
	| 'bathroom'
	| 'kitchen'
	| 'dining'
	| 'corridor'
	| 'balcony'
	| 'staircase'
	| 'utility'
	| 'storage'
	| 'garage'
	| 'office'
	| 'unassigned';

export const ALL_ROOM_FUNCTIONS: RoomFunction[] = [
	'living',
	'bedroom',
	'bathroom',
	'kitchen',
	'dining',
	'corridor',
	'balcony',
	'staircase',
	'utility',
	'storage',
	'garage',
	'office',
	'unassigned'
];

export type RoomSemanticEvidence = {
	geometricScores: Record<string, number>;
	topologicalScores: Record<string, number>;
	objectScores: Record<string, number>;
	tagScores: Record<string, number>;
	classificationUnitScores: Record<string, number>;
	appliedRules: string[];
};

export type RoomFunctionCandidate = {
	function: RoomFunction;
	confidence: number;
	evidence: RoomSemanticEvidence;
};

export type RoomSemanticDiagnostic = {
	roomId: string;
	issue: 'ambiguous_classification' | 'no_evidence' | 'conflicting_evidence' | 'low_confidence';
	message: string;
};

export type RoomSemanticInference = {
	roomId: string;
	primaryFunction: RoomFunction;
	confidence: number;
	candidates: RoomFunctionCandidate[];
	diagnostics: RoomSemanticDiagnostic[];
};

export type RoomSemanticResult = {
	inferences: RoomSemanticInference[];
	diagnostics: RoomSemanticDiagnostic[];
	fingerprint: string;
};

export type SemanticObjectInput = {
	id?: string;
	name?: string;
	layer?: string;
	category?: string;
	roomId?: string;
	centroid?: { x: number; y: number; z: number };
	boundingBox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};

export type RoomSemanticInputOptions = {
	objects?: SemanticObjectInput[];
	roomTags?: Record<string, string[]>;
	unitsScaleToMeter?: number;
};

// ─── Keyword Vocabularies ─────────────────────────────────────────────────────

const VOCABULARY_OBJECTS: Record<RoomFunction, string[]> = {
	bathroom: ['plumbing', 'sanitary', 'shower', 'bath', 'toilet', 'wc', 'lavatory', 'wastafel', 'kloset', 'faucet', 'tub'],
	kitchen: ['kitchen', 'dapur', 'stove', 'oven', 'sink', 'cucian', 'appliance', 'counter', 'pantry', 'cooktop', 'fridge', 'kulkas'],
	bedroom: ['bed', 'wardrobe', 'kasur', 'lemari', 'nightstand', 'mattress'],
	living: ['sofa', 'tv', 'television', 'entertainment', 'couch', 'living', 'armchair'],
	dining: ['dining table', 'meja makan', 'dining'],
	office: ['desk', 'workstation', 'study table', 'meja kerja', 'computer'],
	garage: ['vehicle', 'car', 'mobil', 'motor', 'garage door', 'carport'],
	staircase: ['stair', 'stairs', 'tangga', 'steps', 'stairway', 'handrail', 'railing'],
	utility: ['laundry', 'washer', 'dryer', 'cuci', 'jemur', 'pump', 'pompa', 'panel', 'mep', 'water tank'],
	storage: ['shelf', 'shelves', 'rack', 'rak', 'gudang', 'box'],
	corridor: ['hallway runner'],
	balcony: ['railing exterior'],
	unassigned: []
};

const VOCABULARY_TAGS: Record<RoomFunction, string[]> = {
	bedroom: ['bedroom', 'kamar tidur', 'kt', 'tidur', 'master bedroom', 'kamar anak', 'kamar tamu'],
	bathroom: ['bathroom', 'kamar mandi', 'km', 'wc', 'toilet', 'restroom', 'lavatory', 'ensuite'],
	kitchen: ['kitchen', 'dapur', 'pantry', 'ruang masak'],
	living: ['living', 'ruang tamu', 'ruang keluarga', 'family room', 'lounge'],
	dining: ['dining', 'ruang makan', 'makan'],
	corridor: ['corridor', 'hallway', 'hall', 'lorong', 'selasar', 'passage', 'sirkulasi', 'circulation', 'foyer'],
	balcony: ['balcony', 'balkon', 'teras', 'terrace', 'veranda', 'patio'],
	staircase: ['staircase', 'stair', 'tangga', 'shaft tangga', 'stairwell'],
	utility: ['utility', 'laundry', 'ruang cuci', 'service', 'mep', 'ruang panel', 'ruang pompa'],
	storage: ['storage', 'store', 'gudang', 'closet', 'pantry store'],
	garage: ['garage', 'garasi', 'carport', 'parkir'],
	office: ['office', 'study', 'ruang kerja', 'kerja', 'library', 'perpustakaan'],
	unassigned: []
};

const ALL_FUNCTIONS_LIST: RoomFunction[] = [
	'living',
	'bedroom',
	'bathroom',
	'kitchen',
	'dining',
	'corridor',
	'balcony',
	'staircase',
	'utility',
	'storage',
	'garage',
	'office'
];

// ─── Helper Functions ─────────────────────────────────────────────────────────

function pointInPolygon2D(pt: { x: number; z: number }, poly: { x: number; z: number }[]): boolean {
	const n = poly.length;
	let inside = false;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = poly[i].x, zi = poly[i].z;
		const xj = poly[j].x, zj = poly[j].z;
		const intersects =
			zi > pt.z !== zj > pt.z &&
			pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi) + xi;
		if (intersects) inside = !inside;
	}
	return inside;
}

export function calculateRoomSemanticsFingerprint(inferences: RoomSemanticInference[]): string {
	const input = [...inferences].sort((a, b) => a.roomId.localeCompare(b.roomId)).map((inf) => `${inf.roomId}:${inf.primaryFunction}:${inf.confidence.toFixed(4)}`).join('');
	return `${inferences.length}:${sha256Hex(input).substring(0, 12)}`;
}

// ─── Core Inference Engine ────────────────────────────────────────────────────

export function inferRoomSemantics(
	rooms: DetectedRoom[],
	graph?: RoomTopologyGraph,
	options: RoomSemanticInputOptions = {}
): RoomSemanticResult {
	const scale = options.unitsScaleToMeter ?? 1.0;
	const objects = options.objects ?? [];
	const roomTagsMap = options.roomTags ?? {};

	const inferences: RoomSemanticInference[] = [];
	const diagnostics: RoomSemanticDiagnostic[] = [];

	const sortedRooms = [...rooms].sort((a, b) => a.id.localeCompare(b.id));

	for (const room of sortedRooms) {
		const geomScores: Record<RoomFunction, number> = {
			living: 0, bedroom: 0, bathroom: 0, kitchen: 0, dining: 0,
			corridor: 0, balcony: 0, staircase: 0, utility: 0, storage: 0,
			garage: 0, office: 0, unassigned: 0
		};
		const topScores: Record<RoomFunction, number> = {
			living: 0, bedroom: 0, bathroom: 0, kitchen: 0, dining: 0,
			corridor: 0, balcony: 0, staircase: 0, utility: 0, storage: 0,
			garage: 0, office: 0, unassigned: 0
		};
		const objScores: Record<RoomFunction, number> = {
			living: 0, bedroom: 0, bathroom: 0, kitchen: 0, dining: 0,
			corridor: 0, balcony: 0, staircase: 0, utility: 0, storage: 0,
			garage: 0, office: 0, unassigned: 0
		};
		const tagScores: Record<RoomFunction, number> = {
			living: 0, bedroom: 0, bathroom: 0, kitchen: 0, dining: 0,
			corridor: 0, balcony: 0, staircase: 0, utility: 0, storage: 0,
			garage: 0, office: 0, unassigned: 0
		};
		const cuScores: Record<RoomFunction, number> = {
			living: 0, bedroom: 0, bathroom: 0, kitchen: 0, dining: 0,
			corridor: 0, balcony: 0, staircase: 0, utility: 0, storage: 0,
			garage: 0, office: 0, unassigned: 0
		};
		const appliedRules: string[] = [];

		// 1. Geometric Rules (w_g = 0.20)
		const area = room.floorArea * (scale * scale);
		const perimeter = room.perimeter * scale;
		const dx = (room.planBounds.max.x - room.planBounds.min.x) * scale;
		const dz = (room.planBounds.max.z - room.planBounds.min.z) * scale;
		const maxSpan = Math.max(dx, dz, 0.01);
		const minSpan = Math.max(Math.min(dx, dz), 0.01);
		const aspectRatio = maxSpan / minSpan;
		const perimeterToArea = area > 0 ? perimeter / area : 0;

		if (area >= 0.1) {
			if (area < 3.5) {
				geomScores.utility += 0.6;
				geomScores.storage += 0.5;
				geomScores.bathroom += 0.4;
				appliedRules.push('geom:area_<3.5m2');
			} else if (area <= 6.0) {
				geomScores.bathroom += 0.7;
				geomScores.utility += 0.4;
				appliedRules.push('geom:area_3.5-6m2');
			} else if (area <= 12.0) {
				geomScores.bedroom += 0.5;
				geomScores.office += 0.4;
				appliedRules.push('geom:area_6-12m2');
			} else if (area <= 25.0) {
				geomScores.living += 0.5;
				geomScores.bedroom += 0.6;
				geomScores.dining += 0.4;
				appliedRules.push('geom:area_12-25m2');
			} else {
				geomScores.living += 0.7;
				geomScores.dining += 0.5;
				appliedRules.push('geom:area_>25m2');
			}

			if (aspectRatio > 3.0) {
				geomScores.corridor += 0.7;
				geomScores.balcony += 0.5;
				appliedRules.push('geom:aspect_ratio_>3');
			} else if (aspectRatio < 1.5) {
				geomScores.bedroom += 0.3;
				geomScores.living += 0.3;
				appliedRules.push('geom:aspect_ratio_<1.5');
			}

			if (perimeterToArea > 1.8) {
				geomScores.corridor += 0.6;
				geomScores.staircase += 0.4;
				appliedRules.push('geom:perimeter_to_area_high');
			} else if (perimeterToArea < 1.0 && area >= 6.0) {
				geomScores.bedroom += 0.3;
				geomScores.living += 0.3;
				appliedRules.push('geom:perimeter_to_area_low');
			}
		}

		// Cap geometric scores at 1.0
		for (const f of ALL_FUNCTIONS_LIST) geomScores[f] = Math.min(1.0, geomScores[f]);

		// 2. Topological Rules (w_t = 0.20)
		if (graph) {
			const connected = getConnectedRooms(graph, room.id);
			const degree = connected.length;
			const extConns = getExteriorConnections(graph, room.id);
			const hasExtDoor = extConns.some((c) => c.type === 'door' || (c.traversable && c.type !== 'window'));
			const hasVertConn = graph.connections.some((c) => (c.fromRoomId === room.id || c.toRoomId === room.id) && c.type === 'vertical_connection');

			if (degree === 1) {
				topScores.bedroom += 0.5;
				topScores.bathroom += 0.6;
				topScores.storage += 0.6;
				appliedRules.push('top:degree_1_dead_end');
			} else if (degree >= 3) {
				topScores.corridor += 0.7;
				topScores.living += 0.5;
				appliedRules.push('top:degree_>=3_hub');
			}

			if (hasExtDoor) {
				topScores.balcony += 0.6;
				topScores.garage += 0.5;
				topScores.living += 0.3;
				appliedRules.push('top:exterior_door');
			} else if (extConns.length === 0) {
				topScores.corridor += 0.4;
				topScores.bathroom += 0.3;
				topScores.utility += 0.4;
				appliedRules.push('top:internal_no_exterior');
			}

			if (hasVertConn) {
				topScores.staircase += 0.8;
				appliedRules.push('top:vertical_connection');
			}
		}
		for (const f of ALL_FUNCTIONS_LIST) topScores[f] = Math.min(1.0, topScores[f]);

		// 3. Object / Fixture Rules (w_o = 0.35)
		const roomObjects = objects.filter((obj) => {
			if (obj.roomId && obj.roomId === room.id) return true;
			if (obj.centroid) {
				const pt = { x: obj.centroid.x * scale, z: obj.centroid.z * scale };
				if (pointInPolygon2D(pt, room.boundary2D)) return true;
			}
			return false;
		});

		for (const obj of roomObjects) {
			const text = `${obj.name ?? ''} ${obj.layer ?? ''} ${obj.category ?? ''}`.toLowerCase();
			for (const f of ALL_FUNCTIONS_LIST) {
				for (const kw of VOCABULARY_OBJECTS[f]) {
					const regex = new RegExp(`\\b${kw}\\b`, 'i');
					if (regex.test(text)) {
						if (f === 'bathroom') objScores.bathroom += 0.9;
						else if (f === 'kitchen') objScores.kitchen += 0.9;
						else if (f === 'bedroom') objScores.bedroom += 0.9;
						else if (f === 'living') objScores.living += 0.8;
						else if (f === 'dining') objScores.dining += 0.8;
						else if (f === 'office') objScores.office += 0.8;
						else if (f === 'garage') objScores.garage += 0.9;
						else if (f === 'staircase') objScores.staircase += 0.9;
						else objScores[f] += 0.7;
						appliedRules.push(`obj:matched_${f}_${kw}`);
						break;
					}
				}
			}
		}
		for (const f of ALL_FUNCTIONS_LIST) objScores[f] = Math.min(1.0, objScores[f]);

		// 4. Tag / Classification Unit Rules (w_u = 0.25)
		const tagTexts: string[] = [
			room.id,
			room.storeyId,
			...room.sourceEnvelopeIds,
			...room.sourceBoundaryIds,
			...(roomTagsMap[room.id] ?? []),
			...roomObjects.map((o) => `${o.name ?? ''} ${o.layer ?? ''}`)
		];
		const fullTagText = tagTexts.join(' ').toLowerCase();

		for (const f of ALL_FUNCTIONS_LIST) {
			for (const kw of VOCABULARY_TAGS[f]) {
				const regex = new RegExp(`\\b${kw}\\b`, 'i');
				if (regex.test(fullTagText)) {
					tagScores[f] += 0.85;
					cuScores[f] += 0.85;
					appliedRules.push(`tag:matched_${f}_${kw}`);
					break;
				}
			}
		}
		for (const f of ALL_FUNCTIONS_LIST) {
			tagScores[f] = Math.min(1.0, tagScores[f]);
			cuScores[f] = Math.min(1.0, cuScores[f]);
		}

		// 5. Combined Score Calculation & Sorting
		const w_g = 0.20;
		const w_t = 0.20;
		const w_o = 0.35;
		const w_u = 0.25;

		const candidates: RoomFunctionCandidate[] = ALL_FUNCTIONS_LIST.map((fn) => {
			const score = w_g * geomScores[fn] + w_t * topScores[fn] + w_o * objScores[fn] + w_u * tagScores[fn];
			const evidence: RoomSemanticEvidence = {
				geometricScores: { [fn]: Number(geomScores[fn].toFixed(3)) },
				topologicalScores: { [fn]: Number(topScores[fn].toFixed(3)) },
				objectScores: { [fn]: Number(objScores[fn].toFixed(3)) },
				tagScores: { [fn]: Number(tagScores[fn].toFixed(3)) },
				classificationUnitScores: { [fn]: Number(cuScores[fn].toFixed(3)) },
				appliedRules: Array.from(new Set(appliedRules))
			};
			return {
				function: fn,
				confidence: Number(score.toFixed(4)),
				evidence
			};
		}).sort((a, b) => {
			if (Math.abs(b.confidence - a.confidence) > 1e-6) {
				return b.confidence - a.confidence;
			}
			return a.function.localeCompare(b.function);
		});

		const top = candidates[0];
		const second = candidates[1];

		let primaryFunction: RoomFunction = top.confidence >= 0.20 ? top.function : 'unassigned';
		const roomDiagnostics: RoomSemanticDiagnostic[] = [];

		// Check diagnostics
		const totalEvidenceScore = ALL_FUNCTIONS_LIST.reduce(
			(acc, fn) => acc + geomScores[fn] + topScores[fn] + objScores[fn] + tagScores[fn],
			0
		);

		if (totalEvidenceScore === 0) {
			roomDiagnostics.push({
				roomId: room.id,
				issue: 'no_evidence',
				message: `No geometric, topological, object, or tag evidence found for room ${room.id}.`
			});
			primaryFunction = 'unassigned';
		} else if (top.confidence < 0.20) {
			roomDiagnostics.push({
				roomId: room.id,
				issue: 'low_confidence',
				message: `Highest confidence score (${top.confidence.toFixed(2)}) is below 0.20 threshold.`
			});
			primaryFunction = 'unassigned';
		} else {
			if (second && Math.abs(top.confidence - second.confidence) < 0.08 && top.confidence > 0.30 && second.confidence > 0.30) {
				roomDiagnostics.push({
					roomId: room.id,
					issue: 'ambiguous_classification',
					message: `Ambiguous between ${top.function} (${top.confidence}) and ${second.function} (${second.confidence}).`
				});
			}

			// Check conflicting evidence (two distinct high-score object items from incompatible functions)
			const strongObjFunctions = ALL_FUNCTIONS_LIST.filter((fn) => objScores[fn] >= 0.8);
			if (strongObjFunctions.length >= 2) {
				// e.g. bedroom and kitchen objects both present
				roomDiagnostics.push({
					roomId: room.id,
					issue: 'conflicting_evidence',
					message: `Conflicting object evidence for ${strongObjFunctions.join(' and ')} inside room ${room.id}.`
				});
			}
		}

		inferences.push({
			roomId: room.id,
			primaryFunction,
			confidence: primaryFunction === 'unassigned' ? 0 : top.confidence,
			candidates,
			diagnostics: roomDiagnostics
		});

		diagnostics.push(...roomDiagnostics);
	}

	return {
		inferences,
		diagnostics,
		fingerprint: calculateRoomSemanticsFingerprint(inferences)
	};
}
