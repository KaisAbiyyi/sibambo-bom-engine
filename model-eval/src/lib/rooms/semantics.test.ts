import { describe, expect, test } from 'bun:test';
import { inferRoomSemantics, ALL_ROOM_FUNCTIONS } from './semantics';
import type { DetectedRoom } from './detected-room';
import type { RoomTopologyGraph } from './topology';

function makeTestRoom(id: string, width: number, length: number, extra: Partial<DetectedRoom> = {}): DetectedRoom {
	const boundary2D = [
		{ x: 0, z: 0 },
		{ x: width, z: 0 },
		{ x: width, z: length },
		{ x: 0, z: length }
	];
	const area = width * length;
	const perimeter = 2 * (width + length);
	return {
		id,
		storeyId: 'storey-1',
		boundary2D,
		holes2D: [],
		floorElevation: 0,
		ceilingElevation: 3,
		height: 3,
		floorArea: area,
		perimeter,
		estimatedVolume: area * 3,
		centroid: { x: width / 2, y: 1.5, z: length / 2 },
		boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: width, y: 3, z: length } },
		planBounds: { min: { x: 0, z: 0 }, max: { x: width, z: length } },
		sourceEnvelopeIds: ['env-1'],
		sourceBoundaryIds: ['bound-1'],
		confidence: { score: 0.9, level: 'high', penalties: [] },
		status: 'valid',
		evidence: {
			sourceLoopId: 'loop-1',
			sourceEnvelopeIds: ['env-1'],
			sourceBoundaryEdgeIds: ['edge-1'],
			boundarySegments: [],
			hasOpeningBridges: false,
			inferredSegmentCount: 0,
			directSegmentCount: 1,
			directBoundaryFraction: 1
		},
		diagnostics: [],
		...extra
	};
}

function makeGraph(rooms: DetectedRoom[], connections: any[] = []): RoomTopologyGraph {
	return {
		rooms: rooms.map((r) => ({
			roomId: r.id,
			storeyId: r.storeyId,
			centroid: r.centroid,
			floorArea: r.floorArea,
			boundaryRoomIds: [],
			connectionIds: connections.filter((c) => c.fromRoomId === r.id || c.toRoomId === r.id).map((c) => c.id),
			exteriorConnectionIds: []
		})),
		connections,
		sharedBoundaries: [],
		exteriorConnections: [],
		diagnostics: {
			openingsWithoutSupportingWalls: 0,
			openingsAssociatedWithMoreThanTwoRooms: 0,
			adjacentRoomsWithoutSideAssignment: 0,
			duplicateRoomConnections: 0,
			isolatedRooms: 0,
			roomsWithoutAccess: 0,
			overlappingRoomPolygons: 0,
			crossStoreyAdjacencyAttempts: 0,
			unresolvedExteriorFacingBoundaries: 0
		}
	};
}

describe('Task 3B.5 — Room Semantic Inference', () => {
	test('A. Room with bedroom dimensions (3x3m), degree 1, bed objects -> primary: bedroom, high confidence', () => {
		const room = makeTestRoom('room-bed', 3, 3); // 9 m²
		const graph = makeGraph([room], [
			{ id: 'c1', fromRoomId: 'room-bed', toRoomId: 'room-corr', type: 'door', traversable: true }
		]);
		const objects = [{ roomId: 'room-bed', name: 'King Bed', category: 'Furniture' }];

		const result = inferRoomSemantics([room], graph, { objects });
		expect(result.inferences.length).toBe(1);
		expect(result.inferences[0].primaryFunction).toBe('bedroom');
		expect(result.inferences[0].confidence).toBeGreaterThan(0.5);
	});

	test('B. Small room (2x2 = 4m²), no windows, plumbing objects -> primary: bathroom', () => {
		const room = makeTestRoom('room-bath', 2, 2); // 4 m²
		const graph = makeGraph([room], []);
		const objects = [{ roomId: 'room-bath', name: 'WC Toilet Sanitary', category: 'Plumbing' }];

		const result = inferRoomSemantics([room], graph, { objects });
		expect(result.inferences[0].primaryFunction).toBe('bathroom');
		expect(result.inferences[0].confidence).toBeGreaterThan(0.5);
	});

	test('C. Long narrow room (2x10 = 20m²), aspect ratio 5, degree 4 -> primary: corridor', () => {
		const room = makeTestRoom('room-corr', 2, 10);
		const graph = makeGraph([room], [
			{ id: 'c1', fromRoomId: 'room-corr', toRoomId: 'r1', type: 'door', traversable: true },
			{ id: 'c2', fromRoomId: 'room-corr', toRoomId: 'r2', type: 'door', traversable: true },
			{ id: 'c3', fromRoomId: 'room-corr', toRoomId: 'r3', type: 'door', traversable: true },
			{ id: 'c4', fromRoomId: 'room-corr', toRoomId: 'r4', type: 'door', traversable: true }
		]);

		const result = inferRoomSemantics([room], graph);
		expect(result.inferences[0].primaryFunction).toBe('corridor');
	});

	test('D. Large room (35m²), degree 3, sofa and dining objects -> candidates include living and dining', () => {
		const room = makeTestRoom('room-liv-din', 5, 7); // 35 m²
		const graph = makeGraph([room], [
			{ id: 'c1', fromRoomId: 'room-liv-din', toRoomId: 'r1', type: 'opening', traversable: true },
			{ id: 'c2', fromRoomId: 'room-liv-din', toRoomId: 'r2', type: 'opening', traversable: true },
			{ id: 'c3', fromRoomId: 'room-liv-din', toRoomId: 'r3', type: 'opening', traversable: true }
		]);
		const objects = [
			{ roomId: 'room-liv-din', name: 'L-Shape Sofa TV Lounge' },
			{ roomId: 'room-liv-din', name: '6-Seat Dining Table' }
		];

		const result = inferRoomSemantics([room], graph, { objects });
		const candNames = result.inferences[0].candidates.map((c) => c.function);
		expect(candNames).toContain('living');
		expect(candNames).toContain('dining');
		const topScore = result.inferences[0].candidates[0].confidence;
		expect(topScore).toBeGreaterThan(0.4);
	});

	test('E. Room with Indonesian tag "Kamar Tidur Utama" -> primary: bedroom via tag match', () => {
		const room = makeTestRoom('room-kt', 4, 4);
		const result = inferRoomSemantics([room], undefined, {
			roomTags: { 'room-kt': ['Kamar Tidur Utama'] }
		});
		expect(result.inferences[0].primaryFunction).toBe('bedroom');
		expect(result.inferences[0].candidates[0].evidence.tagScores.bedroom).toBeGreaterThanOrEqual(0.8);
	});

	test('F. Room with no objects or tags, dimensions 3x4m (12m²) -> inferred from geometry + topology alone', () => {
		const room = makeTestRoom('room-geom', 3, 4);
		const graph = makeGraph([room], [
			{ id: 'c1', fromRoomId: 'room-geom', toRoomId: 'corr', type: 'door', traversable: true }
		]);
		const result = inferRoomSemantics([room], graph);
		expect(result.inferences[0].confidence).toBeGreaterThan(0.2);
		expect(result.inferences[0].primaryFunction).not.toBe('unassigned');
	});

	test('G. Room with conflicting objects (bed + kitchen stove) -> conflicting_evidence diagnostic generated', () => {
		const room = makeTestRoom('room-conflict', 4, 4);
		const objects = [
			{ roomId: 'room-conflict', name: 'Master King Bed' },
			{ roomId: 'room-conflict', name: 'Kitchen Stove Oven' }
		];
		const result = inferRoomSemantics([room], undefined, { objects });
		const diag = result.inferences[0].diagnostics.find((d) => d.issue === 'conflicting_evidence');
		expect(diag).toBeDefined();
		expect(diag?.message).toContain('Conflicting object evidence');
	});

	test('H. Tiny space (1.2x1.2 = 1.44m²), degree 1, no objects -> utility/storage', () => {
		const room = makeTestRoom('room-tiny', 1.2, 1.2);
		const graph = makeGraph([room], [
			{ id: 'c1', fromRoomId: 'room-tiny', toRoomId: 'corr', type: 'door', traversable: true }
		]);
		const result = inferRoomSemantics([room], graph);
		expect(['utility', 'storage', 'bathroom']).toContain(result.inferences[0].primaryFunction);
	});

	test('I. Room with vertical_connection topology -> staircase', () => {
		const room = makeTestRoom('room-stair', 2, 4);
		const graph = makeGraph([room], [
			{ id: 'v1', fromRoomId: 'room-stair', toRoomId: 'upper-hall', type: 'vertical_connection', traversable: true }
		]);
		const result = inferRoomSemantics([room], graph);
		expect(result.inferences[0].primaryFunction).toBe('staircase');
	});

	test('J. Completely isolated space with no features or zero scores -> no_evidence diagnostic, fallback to unassigned', () => {
		const room = makeTestRoom('room-zero', 0, 0); // 0 m² area, no objects, no tags, no graph
		const result = inferRoomSemantics([room], undefined);
		expect(result.inferences[0].primaryFunction).toBe('unassigned');
		expect(result.inferences[0].diagnostics.some((d) => d.issue === 'no_evidence')).toBe(true);
	});

	test('K. Scale invariance: scoring consistent when units change (millimeter models scaled down via unitsScaleToMeter)', () => {
		const roomM = makeTestRoom('room-m', 3, 3);
		const roomMM = makeTestRoom('room-mm', 3000, 3000); // in millimeters

		const resM = inferRoomSemantics([roomM], undefined, { unitsScaleToMeter: 1.0 });
		const resMM = inferRoomSemantics([roomMM], undefined, { unitsScaleToMeter: 0.001 });

		expect(resM.inferences[0].primaryFunction).toBe(resMM.inferences[0].primaryFunction);
		expect(resM.inferences[0].confidence).toBeCloseTo(resMM.inferences[0].confidence, 4);
	});

	test('L. Determinism: identical input yields exact same score hierarchy and candidate ordering every time', () => {
		const room = makeTestRoom('room-det', 4, 5);
		const objects = [{ roomId: 'room-det', name: 'Sofa Living Table' }];
		const res1 = inferRoomSemantics([room], undefined, { objects });
		const res2 = inferRoomSemantics([room], undefined, { objects });

		expect(res1.fingerprint).toBe(res2.fingerprint);
		expect(res1.inferences[0].candidates).toEqual(res2.inferences[0].candidates);
	});
});
