import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseModelEvalJsonV1 } from './formats/model-eval-json';
import {
	analyzeSmboostRuntime,
	classifyOpeningCandidate,
	deduplicateOpeningComponents,
	groupOpeningAssemblies,
	mergeRoomCandidates,
	type OpeningComponent,
	type RoomMergeCandidate
} from './smboost-analysis';

function room(id: string, minX: number, maxX: number, partition = false): RoomMergeCandidate {
	return {
		id,
		parentGroupId: 'level:0',
		floorFaceIds: [`face:${id}`],
		ceilingFaceIds: ['ceiling:0'],
		wallFaceIds: partition ? [`partition:${id}`] : [],
		footprint: [
			{ x: minX, z: 0 },
			{ x: maxX, z: 0 },
			{ x: maxX, z: 4 },
			{ x: minX, z: 4 }
		],
		areaM2: (maxX - minX) * 4,
		floorElevationM: 0,
		ceilingElevationM: 3,
		heightM: 3,
		boundaryCoverage: 1,
		sharedBoundaries: [],
		warnings: []
	};
}

function opening(id: string, centroidX = 0): OpeningComponent {
	return {
		id,
		kind: 'door',
		displayName: 'Pintu 90x240',
		sourceName: 'P1002 - Pintu 90x240',
		hierarchyPath: ['Model Root', 'P1002 - Pintu 90x240', 'Daun Pintu'],
		childMeshIds: [`mesh:${id}`],
		leafMeshIds: [`mesh:${id}`],
		frameMeshIds: [],
		glassMeshIds: [],
		trimMeshIds: [],
		sourceFaceIds: [`face:${id}`],
		bounds: {
			min: { x: centroidX - 0.45, y: 0, z: -0.05 },
			max: { x: centroidX + 0.45, y: 2.4, z: 0.05 },
			size: { x: 0.9, y: 2.4, z: 0.1 },
			center: { x: centroidX, y: 1.2, z: 0 }
		},
		centroid: { x: centroidX, y: 1.2, z: 0 },
		dimensions: { x: 0.9, y: 2.4, z: 0.1 },
		faceCount: 8,
		areaM2: 4.5,
		dominantNormal: { x: 0, y: 0, z: 1 },
		nearestWallId: 'wall:1',
		nearestWallDistanceM: 0.03,
		nearestFloorId: 'floor:1',
		floorGapM: 0,
		wallOverlapRatio: 0.95,
		scores: { door: 0.95, window: 0.1, wallAssociation: 0.95, floorContact: 1, name: 1, geometry: 0.9, hierarchy: 1 },
		classificationRule: 'door:wall-floor-name',
		rejectionReasons: [],
		mergedFrom: [],
		duplicateOf: null,
		bindings: []
	};
}

describe('SMBOOST room candidate merge', () => {
	test('merges coplanar touching floor fragments when no partition wall exists', () => {
		const merged = mergeRoomCandidates([room('a', 0, 2), room('b', 2.04, 4)]);
		expect(merged).toHaveLength(1);
		expect(merged[0].areaM2).toBeCloseTo(15.84, 4);
		expect(merged[0].mergeHistory).toEqual(expect.arrayContaining(['a', 'b']));
	});

	test('does not merge adjacent candidates separated by a real partition wall', () => {
		const left = room('a', 0, 2);
		const right = room('b', 2, 4);
		left.sharedBoundaries = [{ otherCandidateId: 'b', gapM: 0, overlapM: 4, separatingWallIds: ['wall:partition'] }];
		expect(mergeRoomCandidates([left, right])).toHaveLength(2);
	});

	test('merged room keeps boundary structure and positive metrics', () => {
		const [merged] = mergeRoomCandidates([room('a', 0, 2), room('b', 2, 4)]);
		expect(merged.floorFaceIds).toHaveLength(2);
		expect(merged.ceilingFaceIds.length).toBeGreaterThan(0);
		expect(merged.footprint.length).toBeGreaterThanOrEqual(4);
		expect(merged.heightM).toBeGreaterThan(0);
		expect(merged.volumeM3).toBeGreaterThan(0);
	});
});

describe('SMBOOST opening pipeline', () => {
	test('classifies wall-associated floor-contact opening as door', () => {
		expect(classifyOpeningCandidate({
			sourceName: 'P1002 Pintu Kayu 90x240', hierarchyText: 'Kusen Daun Pintu',
			widthM: 0.9, heightM: 2.4, depthM: 0.1, floorGapM: 0.01,
			wallDistanceM: 0.04, wallOverlapRatio: 0.9, transparentAreaRatio: 0
		}).kind).toBe('door');
	});

	test('classifies elevated wall opening with glass/frame evidence as window', () => {
		expect(classifyOpeningCandidate({
			sourceName: 'J0003 Jendela Aluminium', hierarchyText: 'Kusen Kaca Daun Jendela',
			widthM: 1.5, heightM: 0.6, depthM: 0.1, floorGapM: 1.05,
			wallDistanceM: 0.03, wallOverlapRatio: 0.92, transparentAreaRatio: 0.55
		}).kind).toBe('window');
	});

	test('groups frame, panel, glass, and leaf descendants into one logical assembly', () => {
		const groups = groupOpeningAssemblies([
			{ id: 'root', parentId: null, sourceName: 'J0003 Jendela', meshId: null },
			{ id: 'frame', parentId: 'root', sourceName: 'Kusen', meshId: 'mesh:frame' },
			{ id: 'glass', parentId: 'root', sourceName: 'Kaca', meshId: 'mesh:glass' },
			{ id: 'leaf', parentId: 'root', sourceName: 'Daun Jendela', meshId: 'mesh:leaf' }
		]);
		 expect(groups).toHaveLength(1);
		expect(groups[0].childMeshIds).toEqual(['mesh:frame', 'mesh:glass', 'mesh:leaf']);
		expect(groups[0].frameMeshIds).toEqual(['mesh:frame']);
		expect(groups[0].glassMeshIds).toEqual(['mesh:glass']);
		expect(groups[0].leafMeshIds).toEqual(['mesh:leaf']);
		expect(groups[0].trimMeshIds).toEqual([]);
	});

	test('logical opening retains every child mesh and assigns a wall', () => {
		const raw = JSON.parse(readFileSync(resolve(import.meta.dir, '../../../skps/model-eval-exports/PROJECT SBOOST 1_model-eval.json'), 'utf8'));
		const result = analyzeSmboostRuntime(parseModelEvalJsonV1(raw));
		for (const item of result.openings) {
			expect(item.nearestWallId).not.toBeNull();
			expect(new Set([...item.leafMeshIds, ...item.frameMeshIds, ...item.glassMeshIds, ...item.trimMeshIds]).size).toBeLessThanOrEqual(item.childMeshIds.length);
		}
		expect(result.openings.some((item) => item.frameMeshIds.length > 0)).toBe(true);
		expect(result.openings.some((item) => item.glassMeshIds.length > 0)).toBe(true);
	});

	test('deduplicates coincident logical openings and records mergedFrom', () => {
		const primary = opening('a');
		const duplicate = opening('b', 0.01);
		const result = deduplicateOpeningComponents([primary, duplicate]);
		expect(result.components).toHaveLength(1);
		expect(result.duplicates).toHaveLength(1);
		expect(result.components[0].mergedFrom).toContain('b');
	});

	test('rejects door-like furniture without wall association', () => {
		const result = classifyOpeningCandidate({
			sourceName: 'Pintu Lemari', hierarchyText: 'Kitchen Cabinet Furniture',
			widthM: 0.8, heightM: 2.1, depthM: 0.6, floorGapM: 0,
			wallDistanceM: 1.2, wallOverlapRatio: 0, transparentAreaRatio: 0
		});
		expect(result.kind).not.toBe('door');
		expect(result.rejectionReasons).toContain('no-wall-association');
	});

	test('keeps ambiguous wall opening unresolved', () => {
		const result = classifyOpeningCandidate({
			sourceName: 'Panel 01', hierarchyText: 'Component',
			widthM: 1.1, heightM: 1.5, depthM: 0.12, floorGapM: 0.45,
			wallDistanceM: 0.05, wallOverlapRatio: 0.8, transparentAreaRatio: 0.1
		});
		expect(result.kind).toBe('unresolved_opening');
	});
});

describe('SMBOOST authoritative fixture counts', () => {
	const fixtures = [
		['smboost-model-1', '../../../skps/model-eval-exports/PROJECT SBOOST 1_model-eval.json', 7, 4, 8],
		['smboost-model-2', '../../../skps/model-eval-exports/PROJECT SBOOST 2_model-eval.json', 6, 4, 9]
	] as const;

	for (const [fixtureId, relativePath, rooms, doors, windows] of fixtures) {
		test(`${fixtureId} matches room/door/window ground truth`, () => {
			const raw = JSON.parse(readFileSync(resolve(import.meta.dir, relativePath), 'utf8'));
			const result = analyzeSmboostRuntime(parseModelEvalJsonV1(raw));
			expect(result.fixtureId).toBe(fixtureId);
			expect(result.rooms).toHaveLength(rooms);
			expect(result.openings.filter((item) => item.kind === 'door')).toHaveLength(doors);
			expect(result.openings.filter((item) => item.kind === 'window')).toHaveLength(windows);
			expect(result.validation.countsMatchExpected).toBe(true);
			expect(result.validation.downstreamReady).toBe(true);
			expect(result.diagnostics.geometryIngestion.missingValidMeshes).toBe(0);
			expect(result.diagnostics.walls.finalLogicalWallCount).toBe(result.wallComponents.length);
		});
	}
});
