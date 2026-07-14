import { describe, expect, test } from 'bun:test';
import {
	buildRoomTopology,
	getAdjacentRooms,
	getConnectedRooms,
	getExteriorConnections,
	getSharedBoundary,
	getRoomDegree,
	isRoomReachable,
	findConnectedComponents,
	findRoomsWithoutAccess
} from './topology';
import type { DetectedRoom, DetectedRoomResult } from './detected-room';
import type { BoundaryOpeningEvidence } from './types';

function makeRoom(id: string, storeyId: string, boundary2D: { x: number; z: number }[], extra: Partial<DetectedRoom> = {}): DetectedRoom {
	return {
		id,
		storeyId,
		boundary2D,
		holes2D: [],
		floorElevation: 0,
		ceilingElevation: 3,
		height: 3,
		floorArea: 16,
		perimeter: 16,
		estimatedVolume: 48,
		centroid: { x: 2, y: 1.5, z: 2 },
		boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 3, z: 4 } },
		planBounds: { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } },
		sourceEnvelopeIds: ['env-1'],
		sourceBoundaryIds: ['bound-1'],
		confidence: { score: 0.9, level: 'high', penalties: [] },
		status: 'valid',
		evidence: {
			sourceLoopId: 'loop-1',
			sourceEnvelopeIds: ['env-1'],
			sourceBoundaryEdgeIds: ['edge-1'],
			boundarySegments: [
				{
					id: `seg-${id}-1`,
					kind: 'wall',
					start: boundary2D[0],
					end: boundary2D[1],
					sourceEvidenceIds: ['wall-ev-1'],
					confidence: 0.9
				}
			],
			hasOpeningBridges: false,
			inferredSegmentCount: 0,
			directSegmentCount: 1,
			directBoundaryFraction: 1
		},
		diagnostics: [],
		...extra
	};
}

describe('Task 3B.4 — Spatial Topology and Room Adjacency', () => {
	test('A. Two rooms sharing a solid wall: adjacent, not connected', () => {
		// Room 1: [0,0] to [4,4], East wall is along X=4 from Z=0 to Z=4
		// Room 2: [4,0] to [8,4], West wall is along X=4 from Z=0 to Z=4
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.planBounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-east', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-common'], confidence: 0.9 }
		];

		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }]);
		roomB.planBounds = { min: { x: 4, z: 0 }, max: { x: 8, z: 4 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b-west', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-common'], confidence: 0.9 }
		];

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' });
		expect(result.graph.sharedBoundaries.length).toBe(1);
		expect(result.graph.sharedBoundaries[0].length).toBeCloseTo(4.0, 2);
		expect(result.graph.connections.length).toBe(0);
		expect(getAdjacentRooms(result.graph, 'room-a')).toEqual(['room-b']);
		expect(getConnectedRooms(result.graph, 'room-a')).toEqual([]);
	});

	test('B. Two rooms connected by a door: adjacent, connected, deterministic door connection', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-east', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-common'], confidence: 0.9 }
		];
		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }]);
		roomB.planBounds = { min: { x: 4, z: 0 }, max: { x: 8, z: 4 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b-west', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-common'], confidence: 0.9 }
		];

		const door: BoundaryOpeningEvidence = {
			id: 'door-1',
			logicalObjectId: 'door-obj-1',
			classificationUnitIds: ['cu-door'],
			elevationRange: { min: 0, max: 2.1 },
			segment: { start: { x: 4, z: 1.5 }, end: { x: 4, z: 2.5 } },
			openingType: 'door',
			width: 1.0,
			height: 2.1,
			quality: 0.95,
			isAmbiguous: false
		};

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' }, [door]);
		expect(result.graph.sharedBoundaries.length).toBe(1);
		expect(result.graph.connections.length).toBe(1);
		const conn = result.graph.connections[0];
		expect(conn.fromRoomId).toBe('room-a');
		expect(conn.toRoomId).toBe('room-b');
		expect(conn.type).toBe('door');
		expect(conn.traversable).toBe(true);
		expect(getConnectedRooms(result.graph, 'room-a')).toEqual(['room-b']);
	});

	test('C. Exterior doorway: one room-to-exterior connection, no fake second room', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-south', kind: 'wall', start: { x: 0, z: 0 }, end: { x: 4, z: 0 }, sourceEvidenceIds: ['wall-south'], confidence: 0.9 }
		];

		const extDoor: BoundaryOpeningEvidence = {
			id: 'ext-door-1',
			logicalObjectId: 'door-obj-ext',
			classificationUnitIds: ['cu-ext-door'],
			elevationRange: { min: 0, max: 2.1 },
			segment: { start: { x: 1.5, z: 0 }, end: { x: 2.5, z: 0 } },
			openingType: 'door',
			width: 1.0,
			height: 2.1,
			quality: 0.95,
			isAmbiguous: false
		};

		const result = buildRoomTopology({ rooms: [roomA], diagnostics: {} as any, fingerprint: 'fp' }, [extDoor]);
		expect(result.graph.connections.length).toBe(0);
		expect(result.graph.exteriorConnections.length).toBe(1);
		expect(result.graph.exteriorConnections[0].roomId).toBe('room-a');
		expect(result.graph.exteriorConnections[0].traversable).toBe(true);
		expect(getRoomDegree(result.graph, 'room-a')).toBe(1);
	});

	test('D. Window between room and exterior: exterior opening recorded, not traversable', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-north', kind: 'wall', start: { x: 0, z: 4 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-north'], confidence: 0.9 }
		];

		const windowOp: BoundaryOpeningEvidence = {
			id: 'win-1',
			logicalObjectId: 'win-obj-1',
			classificationUnitIds: ['cu-win'],
			elevationRange: { min: 0.9, max: 2.1 },
			segment: { start: { x: 1, z: 4 }, end: { x: 3, z: 4 } },
			openingType: 'window',
			width: 2.0,
			height: 1.2,
			quality: 0.9,
			isAmbiguous: false
		};

		const result = buildRoomTopology({ rooms: [roomA], diagnostics: {} as any, fingerprint: 'fp' }, [windowOp]);
		expect(result.graph.exteriorConnections.length).toBe(1);
		expect(result.graph.exteriorConnections[0].type).toBe('window');
		expect(result.graph.exteriorConnections[0].traversable).toBe(false);
		expect(getRoomDegree(result.graph, 'room-a')).toBe(0);
	});

	test('E. Corner-only contact: no adjacency', () => {
		// Room 1: [0,0] to [4,4]
		// Room 2: [4,4] to [8,8] (touching only at point [4,4])
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.planBounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-north', kind: 'wall', start: { x: 0, z: 4 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-north'], confidence: 0.9 },
			{ id: 'seg-a-east', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-east'], confidence: 0.9 }
		];

		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 4 }, { x: 8, z: 4 }, { x: 8, z: 8 }, { x: 4, z: 8 }]);
		roomB.planBounds = { min: { x: 4, z: 4 }, max: { x: 8, z: 8 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b-south', kind: 'wall', start: { x: 4, z: 4 }, end: { x: 8, z: 4 }, sourceEvidenceIds: ['wall-north'], confidence: 0.9 },
			{ id: 'seg-b-west', kind: 'wall', start: { x: 4, z: 4 }, end: { x: 4, z: 8 }, sourceEvidenceIds: ['wall-east'], confidence: 0.9 }
		];

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' });
		expect(result.graph.sharedBoundaries.length).toBe(0);
		expect(getAdjacentRooms(result.graph, 'room-a')).toEqual([]);
	});

	test('F. Partial shared wall: correct overlap length', () => {
		// Room A: X from 0 to 4, Z from 0 to 6 along East wall (X=4)
		// Room B: X from 4 to 8, Z from 2 to 8 along West wall (X=4)
		// Overlap along X=4 should be from Z=2 to Z=6 (length 4.0)
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 6 }, { x: 0, z: 6 }]);
		roomA.planBounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 6 } };
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-east', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 6 }, sourceEvidenceIds: ['wall-partial'], confidence: 0.9 }
		];

		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 2 }, { x: 8, z: 2 }, { x: 8, z: 8 }, { x: 4, z: 8 }]);
		roomB.planBounds = { min: { x: 4, z: 2 }, max: { x: 8, z: 8 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b-west', kind: 'wall', start: { x: 4, z: 2 }, end: { x: 4, z: 8 }, sourceEvidenceIds: ['wall-partial'], confidence: 0.9 }
		];

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' });
		expect(result.graph.sharedBoundaries.length).toBe(1);
		expect(result.graph.sharedBoundaries[0].length).toBeCloseTo(4.0, 2);
	});

	test('G. Reversed boundary direction: same topology result', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.planBounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };
		// start -> end vs end -> start
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-east', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-rev'], confidence: 0.9 }
		];

		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }]);
		roomB.planBounds = { min: { x: 4, z: 0 }, max: { x: 8, z: 4 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b-west', kind: 'wall', start: { x: 4, z: 4 }, end: { x: 4, z: 0 }, sourceEvidenceIds: ['wall-rev'], confidence: 0.9 }
		];

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' });
		expect(result.graph.sharedBoundaries.length).toBe(1);
		expect(result.graph.sharedBoundaries[0].length).toBeCloseTo(4.0, 2);
	});

	test('H. Two storeys with matching XY geometry: no cross-storey adjacency', () => {
		const room1 = makeRoom('room-1', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		room1.planBounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };
		room1.floorElevation = 0; room1.ceilingElevation = 3;

		const room2 = makeRoom('room-2', 'storey-2', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		room2.planBounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };
		room2.floorElevation = 3.2; room2.ceilingElevation = 6.2;

		const result = buildRoomTopology({ rooms: [room1, room2], diagnostics: {} as any, fingerprint: 'fp' });
		expect(result.graph.sharedBoundaries.length).toBe(0);
		expect(result.graph.diagnostics.crossStoreyAdjacencyAttempts).toBe(1);
	});

	test('I. Isolated enclosed room: appears as isolated or inaccessible diagnostic', () => {
		const roomIso = makeRoom('room-iso', 'storey-1', [{ x: 100, z: 100 }, { x: 104, z: 100 }, { x: 104, z: 104 }, { x: 100, z: 104 }]);
		roomIso.planBounds = { min: { x: 100, z: 100 }, max: { x: 104, z: 104 } };
		roomIso.evidence.boundarySegments = [];

		const result = buildRoomTopology({ rooms: [roomIso], diagnostics: {} as any, fingerprint: 'fp' });
		expect(result.graph.diagnostics.isolatedRooms).toBe(1);
		expect(result.graph.diagnostics.roomsWithoutAccess).toBe(1);
		expect(findRoomsWithoutAccess(result.graph)).toEqual(['room-iso']);
	});

	test('J. Duplicate opening evidence: one deduplicated connection', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-east', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-dup'], confidence: 0.9 }
		];
		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }]);
		roomB.planBounds = { min: { x: 4, z: 0 }, max: { x: 8, z: 4 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b-west', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-dup'], confidence: 0.9 }
		];

		const door1: BoundaryOpeningEvidence = {
			id: 'door-1',
			logicalObjectId: 'door-obj-1',
			classificationUnitIds: ['cu-1'],
			elevationRange: { min: 0, max: 2.1 },
			segment: { start: { x: 4, z: 1.5 }, end: { x: 4, z: 2.5 } },
			openingType: 'door',
			width: 1.0,
			height: 2.1,
			quality: 0.95,
			isAmbiguous: false
		};

		const door2: BoundaryOpeningEvidence = {
			...door1,
			id: 'door-2',
			logicalObjectId: 'door-obj-2'
		};

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' }, [door1, door2]);
		expect(result.graph.connections.length).toBe(1);
		expect(result.graph.diagnostics.duplicateRoomConnections).toBe(1);
		expect(result.graph.connections[0].sourceEvidenceIds).toContain('door-1');
		expect(result.graph.connections[0].sourceEvidenceIds).toContain('door-2');
	});

	test('K. Door not aligned with shared wall: no fabricated room connection', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a-east', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-common'], confidence: 0.9 }
		];
		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }]);
		roomB.planBounds = { min: { x: 4, z: 0 }, max: { x: 8, z: 4 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b-west', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['wall-common'], confidence: 0.9 }
		];

		// Door located far away, perpendicular, at Z=10
		const strayDoor: BoundaryOpeningEvidence = {
			id: 'door-stray',
			logicalObjectId: 'door-obj-stray',
			classificationUnitIds: ['cu-stray'],
			elevationRange: { min: 0, max: 2.1 },
			segment: { start: { x: 3, z: 10 }, end: { x: 5, z: 10 } },
			openingType: 'door',
			width: 2.0,
			height: 2.1,
			quality: 0.9,
			isAmbiguous: false
		};

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' }, [strayDoor]);
		expect(result.graph.connections.length).toBe(0);
	});

	test('L. Multiple connected rooms: graph traversal and connected components are correct', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.evidence.boundarySegments = [{ id: 'seg-a', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['w1'], confidence: 0.9 }];

		const roomB = makeRoom('room-b', 'storey-1', [{ x: 4, z: 0 }, { x: 8, z: 0 }, { x: 8, z: 4 }, { x: 4, z: 4 }]);
		roomB.planBounds = { min: { x: 4, z: 0 }, max: { x: 8, z: 4 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b1', kind: 'wall', start: { x: 4, z: 0 }, end: { x: 4, z: 4 }, sourceEvidenceIds: ['w1'], confidence: 0.9 },
			{ id: 'seg-b2', kind: 'wall', start: { x: 8, z: 0 }, end: { x: 8, z: 4 }, sourceEvidenceIds: ['w2'], confidence: 0.9 }
		];

		const roomC = makeRoom('room-c', 'storey-1', [{ x: 8, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 4 }, { x: 8, z: 4 }]);
		roomC.planBounds = { min: { x: 8, z: 0 }, max: { x: 12, z: 4 } };
		roomC.evidence.boundarySegments = [{ id: 'seg-c', kind: 'wall', start: { x: 8, z: 0 }, end: { x: 8, z: 4 }, sourceEvidenceIds: ['w2'], confidence: 0.9 }];

		const doorAB: BoundaryOpeningEvidence = {
			id: 'door-ab',
			logicalObjectId: 'door-obj-ab',
			classificationUnitIds: ['cu-ab'],
			elevationRange: { min: 0, max: 2.1 },
			segment: { start: { x: 4, z: 1.5 }, end: { x: 4, z: 2.5 } },
			openingType: 'door',
			width: 1.0,
			height: 2.1,
			quality: 0.95,
			isAmbiguous: false
		};
		const doorBC: BoundaryOpeningEvidence = {
			id: 'door-bc',
			logicalObjectId: 'door-obj-bc',
			classificationUnitIds: ['cu-bc'],
			elevationRange: { min: 0, max: 2.1 },
			segment: { start: { x: 8, z: 1.5 }, end: { x: 8, z: 2.5 } },
			openingType: 'door',
			width: 1.0,
			height: 2.1,
			quality: 0.95,
			isAmbiguous: false
		};

		const result = buildRoomTopology({ rooms: [roomA, roomB, roomC], diagnostics: {} as any, fingerprint: 'fp' }, [doorAB, doorBC]);
		expect(isRoomReachable(result.graph, 'room-a', 'room-c')).toBe(true);
		const comps = findConnectedComponents(result.graph);
		expect(comps.length).toBe(1);
		expect(comps[0]).toEqual(['room-a', 'room-b', 'room-c']);
	});

	test('M. Interior shaft boundary: not automatically classified as exterior', () => {
		const roomA = makeRoom('room-a', 'storey-1', [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
		roomA.evidence.boundarySegments = [
			{ id: 'seg-inferred', kind: 'inferred', start: { x: 2, z: 2 }, end: { x: 3, z: 2 }, sourceEvidenceIds: ['shaft-ev'], confidence: 0.8 }
		];

		const result = buildRoomTopology({ rooms: [roomA], diagnostics: {} as any, fingerprint: 'fp' });
		expect(result.graph.exteriorConnections.length).toBe(0);
		expect(result.graph.diagnostics.unresolvedExteriorFacingBoundaries).toBe(1);
	});

	test('N. Scale invariance: equivalent topology at different model scales', () => {
		// 10x larger rooms
		const roomA = makeRoom('room-a-10x', 'storey-1', [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 0, z: 40 }]);
		roomA.planBounds = { min: { x: 0, z: 0 }, max: { x: 40, z: 40 } };
		roomA.evidence.boundarySegments = [
			{ id: 'seg-a', kind: 'wall', start: { x: 40, z: 0 }, end: { x: 40, z: 40 }, sourceEvidenceIds: ['w1'], confidence: 0.9 }
		];

		const roomB = makeRoom('room-b-10x', 'storey-1', [{ x: 40, z: 0 }, { x: 80, z: 0 }, { x: 80, z: 40 }, { x: 40, z: 40 }]);
		roomB.planBounds = { min: { x: 40, z: 0 }, max: { x: 80, z: 40 } };
		roomB.evidence.boundarySegments = [
			{ id: 'seg-b', kind: 'wall', start: { x: 40, z: 0 }, end: { x: 40, z: 40 }, sourceEvidenceIds: ['w1'], confidence: 0.9 }
		];

		const result = buildRoomTopology({ rooms: [roomA, roomB], diagnostics: {} as any, fingerprint: 'fp' }, [], 500);
		expect(result.graph.sharedBoundaries.length).toBe(1);
		expect(result.graph.sharedBoundaries[0].length).toBeCloseTo(40.0, 1);
	});
});
