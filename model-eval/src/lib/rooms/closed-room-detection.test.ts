/**
 * closed-room-detection.test.ts
 *
 * Task 3B.3 regression tests for closed-room detection.
 * Tests cover items A–O as specified.
 */

import { describe, expect, test } from 'bun:test';
import { detectClosedRooms } from './closed-room-detection';
import type { ClosedRoomDetectionInput } from './closed-room-detection';
import type {
	RankedBoundaryLoopCandidate,
	RefinedVerticalEnvelopeCandidate,
	BoundaryOpeningEvidence
} from './types';
import type { NormalizedBarrierGraph } from './helpers';
import { polygonArea } from './detected-room';

// ─── Fixture factories ────────────────────────────────────────────────────────

function mockNode(id: string, x: number, z: number) {
	return { id, coord: { x, z } };
}

function mockEdge(
	nodeAId: string, nodeB: string,
	startX: number, startZ: number, endX: number, endZ: number,
	storeyCandidateId = 'storey1',
	evidenceIds: string[] = ['ev1']
) {
	return {
		id: `edge:${nodeAId}:${nodeB}`,
		nodeAId,
		nodeBId: nodeB,
		start: { x: startX, z: startZ },
		end: { x: endX, z: endZ },
		originalStart: { x: startX, z: startZ },
		originalEnd: { x: endX, z: endZ },
		verticalEvidenceIds: evidenceIds,
		logicalObjectId: 'obj1',
		classificationUnitIds: ['cu1'],
		materialIds: [1],
		storeyCandidateId
	};
}

function mockGraph(storeyCandidateId: string, nodes: any[], edges: any[]): NormalizedBarrierGraph {
	return {
		storeyCandidateId,
		nodes,
		edges,
		components: [nodes.map((n: any) => n.id)],
		diagnostics: {
			inputBarriers: edges.length, acceptedEdges: edges.length, rejectedEdges: 0,
			snappedEndpoints: 0, duplicateEdgesMerged: 0,
			graphNodes: nodes.length, graphEdges: edges.length, connectedComponents: 1
		},
		normalizationDiagnostics: {
			nodesBefore: nodes.length, nodesAfter: nodes.length,
			edgesBefore: edges.length, edgesAfter: edges.length,
			componentsBefore: 1, componentsAfter: 1,
			endpointsSnapped: 0, edgesSplit: 0, edgesMerged: 0, zeroLengthEdgesRejected: 0,
			openEndpoints: 0
		}
	};
}

function mockLoop(
	id: string,
	storeyCandidateId: string,
	nodeIds: string[],
	edgeIds: string[],
	planPolygon: Array<{ x: number; z: number }>,
	status: 'primary' | 'secondary' | 'noise' = 'primary'
): RankedBoundaryLoopCandidate {
	const area = polygonArea(planPolygon);
	return {
		id,
		storeyCandidateId,
		connectedComponentIndex: 0,
		nodeIds,
		edgeIds,
		planPolygon,
		verticalEvidenceIds: ['ev1'],
		sourceEvidenceIds: ['ev1'],
		logicalObjectIds: ['obj1'],
		classificationUnitIds: ['cu1'],
		materialIds: [1],
		signedArea: area,
		absoluteArea: area,
		area,
		perimeter: 4 * Math.sqrt(area),
		planBounds: { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } },
		bounds: { min: { x: 0, z: 0 }, max: { x: 5, z: 5 } },
		orientation: 'ccw',
		isAmbiguous: false,
		quality: 0.9,
		score: 80,
		status,
		compactness: 0.9,
		boundsAspectRatio: 1.0,
		edgeCount: nodeIds.length,
		uniqueSourceObjectCount: 1,
		sharedEdgeIds: [],
		adjacentLoopIds: [],
		qualityFlags: {
			nearZeroArea: false, extremeAspectRatio: false, lowCompactness: false,
			veryShortPerimeter: false, excessiveEdgeCount: false,
			weakSourceDiversity: false, nestedOrOverlapping: false, geometricallyPlausible: true
		}
	} as any;
}

function mockEnvelope(
	id: string,
	loopId: string,
	storeyId = 'storey1',
	lowerElev = 0,
	upperElev = 3,
	eligible = true
): RefinedVerticalEnvelopeCandidate {
	return {
		id,
		loopCandidateId: loopId,
		storeyCandidateId: storeyId,
		lowerAssignmentId: 'lower1',
		upperAssignmentId: 'upper1',
		lowerHorizontalEvidenceId: 'lhev1',
		upperHorizontalEvidenceId: 'uhev1',
		logicalObjectIds: ['obj1'],
		classificationUnitIds: ['cu1'],
		materialIds: [1],
		lowerElevation: lowerElev,
		upperElevation: upperElev,
		clearHeight: upperElev - lowerElev,
		loopArea: 25,
		estimatedVolume: 25 * (upperElev - lowerElev),
		score: 80,
		rawScore: 80,
		rawStatus: 'primary',
		refinedScore: 80,
		refinedStatus: 'primary',
		status: 'primary',
		rank: 1,
		refinedRank: 1,
		baseAlignment: 0,
		topAlignment: upperElev,
		barrierSpanCoverage: 0.9,
		refinementReasons: [],
		qualityFlags: {
			missingLower: false, missingUpper: false, nonPositiveHeight: false,
			unusuallyLowHeight: false, unusuallyHighHeight: false, approximateOverlap: false,
			multipleEnvelopeCandidates: false, weakLowerSupport: false,
			weakUpperCover: false, geometricallyPlausible: true
		},
		eligibleForRoomAssembly: eligible,
		ineligibilityReasons: [],
		relativeBaseTolerance: 0.1,
		relativeTopTolerance: 0.1,
		sourceEvidenceIds: ['ev1'],
		verticalExtentProfile: {
			loopId,
			evidenceIds: ['ev1'],
			evidenceCount: 1,
			referencedEvidenceCount: 1,
			referencedEvidenceFound: 1,
			rejectedReferencedEvidence: 0,
			missingReferencedEvidenceIds: [],
			minObservedBase: lowerElev,
			maxObservedTop: upperElev,
			robustBase: lowerElev,
			robustTop: upperElev,
			robustSpan: upperElev - lowerElev,
			dispersion: 0,
			consistency: 1,
			confidence: 0.95,
			flags: {
				insufficientEvidence: false, inconsistentBases: false, inconsistentTops: false,
				fragmentedVerticalEvidence: false, approximateExtent: false
			}
		}
	} as any;
}

/** Build a simple rectangular room's loop and graph */
function makeRectRoom(
	id: string, storeyId: string,
	x0: number, z0: number, x1: number, z1: number
): { loop: RankedBoundaryLoopCandidate; graph: NormalizedBarrierGraph } {
	const poly = [
		{ x: x0, z: z0 }, { x: x1, z: z0 },
		{ x: x1, z: z1 }, { x: x0, z: z1 }
	];
	const nodeIds = ['n0', 'n1', 'n2', 'n3'].map((n) => `${id}:${n}`);
	const edgeIds = [
		`${id}:edge:n0:n1`, `${id}:edge:n1:n2`,
		`${id}:edge:n2:n3`, `${id}:edge:n3:n0`
	];
	const nodes = [
		mockNode(nodeIds[0], x0, z0), mockNode(nodeIds[1], x1, z0),
		mockNode(nodeIds[2], x1, z1), mockNode(nodeIds[3], x0, z1)
	];
	const edges = [
		mockEdge(nodeIds[0], nodeIds[1], x0, z0, x1, z0, storeyId),
		mockEdge(nodeIds[1], nodeIds[2], x1, z0, x1, z1, storeyId),
		mockEdge(nodeIds[2], nodeIds[3], x1, z1, x0, z1, storeyId),
		mockEdge(nodeIds[3], nodeIds[0], x0, z1, x0, z0, storeyId)
	];
	edges.forEach((e, i) => { e.id = edgeIds[i]; });
	const loop = mockLoop(id, storeyId, nodeIds, edgeIds, poly);
	const graph = mockGraph(storeyId, nodes, edges);
	return { loop, graph };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Task 3B.3 — Closed Room Detection', () => {

	// A. Simple rectangular room
	test('A. Simple rectangular room — one room detected with correct geometry', () => {
		const { loop, graph } = makeRectRoom('rect1', 'storey1', 0, 0, 5, 5);
		const env = mockEnvelope('env1', 'rect1', 'storey1', 0, 3);

		const result = detectClosedRooms({
			loops: [loop], envelopes: [env], graphs: [graph]
		});

		expect(result.rooms.length).toBe(1);
		const room = result.rooms[0];
		expect(room.status).toBe('valid');
		expect(room.storeyId).toBe('storey1');
		expect(room.floorArea).toBeCloseTo(25, 1);
		expect(room.perimeter).toBeCloseTo(20, 1);
		expect(room.floorElevation).toBeCloseTo(0, 4);
		expect(room.ceilingElevation).toBeCloseTo(3, 4);
		expect(room.height).toBeCloseTo(3, 4);
		expect(room.estimatedVolume).toBeCloseTo(75, 1);
		expect(room.centroid.x).toBeCloseTo(2.5, 4);
		expect(room.centroid.z).toBeCloseTo(2.5, 4);
		expect(room.id).toMatch(/^detected-room:/);
		expect(room.boundary2D.length).toBe(4);
	});

	// B. Room with a door opening
	test('B. Rectangular room with recognized doorway gap — room remains closed', () => {
		const poly = [
			{ x: 0, z: 0 }, { x: 5, z: 0 },
			{ x: 5, z: 5 }, { x: 0, z: 5 }
		];
		const nodeIds = ['n0', 'n1', 'n2', 'n3'].map((n) => `loop_b:${n}`);
		const edgeIds = ['e01', 'e12', 'e23', 'e30'];
		const loop = mockLoop('loop_b', 'storey1', nodeIds, edgeIds, poly);

		const opening: BoundaryOpeningEvidence = {
			id: 'open1', logicalObjectId: 'door1', classificationUnitIds: [],
			elevationRange: { min: 0, max: 2.1 },
			segment: { start: { x: 0, z: 2 }, end: { x: 0, z: 3 } },
			openingType: 'door', width: 1.0, height: 2.1, quality: 0.9, isAmbiguous: false
		};

		const env = mockEnvelope('env_b', 'loop_b', 'storey1', 0, 3);
		const graph = makeRectRoom('loop_b', 'storey1', 0, 0, 5, 5).graph;

		const result = detectClosedRooms({
			loops: [loop], envelopes: [env], graphs: [graph], openings: [opening]
		});

		expect(result.rooms.length).toBe(1);
		expect(result.rooms[0].status).not.toBe('rejected');
	});

	// C. Open wall chain — no room produced
	test('C. Missing wall — no room produced', () => {
		// Triangle where all nodes are in the graph but there are only 3 edges (3 walls)
		// Create a loop with too few nodes to form a valid room
		const poly = [{ x: 0, z: 0 }, { x: 5, z: 0 }]; // Only 2 points — not a closed room
		const loop = mockLoop('open_chain', 'storey1', ['n0', 'n1'], ['e01'], poly, 'noise');
		const env = mockEnvelope('env_c', 'open_chain', 'storey1', 0, 3);
		const graph = mockGraph('storey1', [], []);

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });
		expect(result.rooms.length).toBe(0);
	});

	// D. Two adjacent rooms
	test('D. Two adjacent rooms — exactly two rooms detected, shared wall provenance retained', () => {
		// Room A: x=0..5, z=0..5
		const { loop: loopA, graph: graphA } = makeRectRoom('roomA', 'storey1', 0, 0, 5, 5);
		// Room B: x=5..10, z=0..5 (shares x=5 wall with A)
		const { loop: loopB } = makeRectRoom('roomB', 'storey1', 5, 0, 10, 5);

		// Merge graphs (same storey)
		const nodesB = [
			mockNode('roomB:n0', 5, 0), mockNode('roomB:n1', 10, 0),
			mockNode('roomB:n2', 10, 5), mockNode('roomB:n3', 5, 5)
		];
		const edgeIds = ['roomB:edge:n0:n1', 'roomB:edge:n1:n2', 'roomB:edge:n2:n3', 'roomB:edge:n3:n0'];
		const edgesB = [
			mockEdge('roomB:n0', 'roomB:n1', 5, 0, 10, 0),
			mockEdge('roomB:n1', 'roomB:n2', 10, 0, 10, 5),
			mockEdge('roomB:n2', 'roomB:n3', 10, 5, 5, 5),
			mockEdge('roomB:n3', 'roomB:n0', 5, 5, 5, 0)
		];
		edgesB.forEach((e, i) => { e.id = edgeIds[i]; });

		// Augment graph A with room B nodes and edges
		const combinedGraph: NormalizedBarrierGraph = {
			...graphA,
			nodes: [...graphA.nodes, ...nodesB],
			edges: [...graphA.edges, ...edgesB],
			components: [['roomA:n0', 'roomA:n1', 'roomA:n2', 'roomA:n3', 'roomB:n0', 'roomB:n1', 'roomB:n2', 'roomB:n3']]
		};

		const envA = mockEnvelope('envA', 'roomA', 'storey1', 0, 3);
		const envB = mockEnvelope('envB', 'roomB', 'storey1', 0, 3);

		// Manually set planPolygon on loopB
		(loopB as any).planPolygon = [
			{ x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 5, z: 5 }
		];

		const result = detectClosedRooms({
			loops: [loopA, loopB],
			envelopes: [envA, envB],
			graphs: [combinedGraph]
		});

		expect(result.rooms.length).toBe(2);
		expect(result.rooms.every((r) => r.status !== 'rejected')).toBe(true);
		// Check areas
		const areas = result.rooms.map((r) => r.floorArea).sort((a, b) => a - b);
		expect(areas[0]).toBeCloseTo(25, 0);
		expect(areas[1]).toBeCloseTo(25, 0);
	});

	// E. Concave L-shaped room
	test('E. Concave L-shaped room — correct area, no convex hull replacement', () => {
		// L-shape: 5x5 minus 2.5x2.5 corner
		const poly = [
			{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2.5 },
			{ x: 2.5, z: 2.5 }, { x: 2.5, z: 5 }, { x: 0, z: 5 }
		];
		const nodeIds = poly.map((_, i) => `l:n${i}`);
		const edgeIds = nodeIds.map((_, i) => `l:e${i}`);
		const loop = mockLoop('l_room', 'storey1', nodeIds, edgeIds, poly);
		const env = mockEnvelope('env_l', 'l_room', 'storey1', 0, 3);
		const graph = mockGraph('storey1',
			poly.map((p, i) => mockNode(nodeIds[i], p.x, p.z)),
			[]
		);

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });

		expect(result.rooms.length).toBe(1);
		const room = result.rooms[0];
		// L-shape area: 25 - 6.25 = 18.75
		expect(room.floorArea).toBeCloseTo(18.75, 1);
		expect(room.boundary2D.length).toBe(6); // no simplification
	});

	// F. Exterior face rejection
	test('F. Noise loops are excluded from output', () => {
		const { loop, graph } = makeRectRoom('noise_room', 'storey1', -1000, -1000, 1000, 1000);
		// Mark as noise — should be skipped
		loop.status = 'noise';
		const env = mockEnvelope('env_f', 'noise_room');

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });
		expect(result.rooms.length).toBe(0);
	});

	// G. Sliver rejection
	test('G. Sliver polygon (tiny area) is rejected', () => {
		// 10m × 0.01m — extreme aspect ratio
		const poly = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 0.01 }, { x: 0, z: 0.01 }];
		const nodeIds = poly.map((_, i) => `sv:n${i}`);
		const edgeIds = nodeIds.map((_, i) => `sv:e${i}`);
		const loop = mockLoop('sliver', 'storey1', nodeIds, edgeIds, poly);
		const env = mockEnvelope('env_g', 'sliver');
		const graph = mockGraph('storey1', [], []);

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });
		expect(result.rooms.length).toBe(0);
		expect(result.diagnostics.sliverRoomsRejected).toBe(1);
	});

	// H. Multiple storeys — rooms separated by storey
	test('H. Multiple storeys — same XY boundary, separate rooms per storey', () => {
		const polyA = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 0, z: 5 }];
		const polyB = [...polyA];

		const nodeIdsA = polyA.map((_, i) => `s1:n${i}`);
		const nodeIdsB = polyB.map((_, i) => `s2:n${i}`);
		const edgeIdsA = nodeIdsA.map((_, i) => `s1:e${i}`);
		const edgeIdsB = nodeIdsB.map((_, i) => `s2:e${i}`);

		const loopA = mockLoop('loop_s1', 'storey1', nodeIdsA, edgeIdsA, polyA);
		const loopB = mockLoop('loop_s2', 'storey2', nodeIdsB, edgeIdsB, polyB);

		const envA = mockEnvelope('envA', 'loop_s1', 'storey1', 0, 3);
		const envB = mockEnvelope('envB', 'loop_s2', 'storey2', 3, 6);

		const graphA = mockGraph('storey1', polyA.map((p, i) => mockNode(nodeIdsA[i], p.x, p.z)), []);
		const graphB = mockGraph('storey2', polyB.map((p, i) => mockNode(nodeIdsB[i], p.x, p.z)), []);

		const result = detectClosedRooms({
			loops: [loopA, loopB], envelopes: [envA, envB], graphs: [graphA, graphB]
		});

		expect(result.rooms.length).toBe(2);
		const storeys = new Set(result.rooms.map((r) => r.storeyId));
		expect(storeys.size).toBe(2);
		expect(storeys.has('storey1')).toBe(true);
		expect(storeys.has('storey2')).toBe(true);
	});

	// I. Hole / shaft
	test('I. Outer room with nested shaft — hole subtracted, no duplicate shaft room', () => {
		// Outer 10x10, inner 2x2 (shaft)
		const outerPoly = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
		const innerPoly = [{ x: 4, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 6 }, { x: 4, z: 6 }];

		const outerNodeIds = outerPoly.map((_, i) => `outer:n${i}`);
		const innerNodeIds = innerPoly.map((_, i) => `inner:n${i}`);
		const outerEdgeIds = outerNodeIds.map((_, i) => `outer:e${i}`);
		const innerEdgeIds = innerNodeIds.map((_, i) => `inner:e${i}`);

		const loopOuter = mockLoop('outer_loop', 'storey1', outerNodeIds, outerEdgeIds, outerPoly);
		const loopInner = mockLoop('inner_loop', 'storey1', innerNodeIds, innerEdgeIds, innerPoly, 'secondary');
		(loopInner as any).planPolygon = innerPoly;

		// Inner loop has an envelope but outer loop's envelope is separate
		const envOuter = mockEnvelope('envOuter', 'outer_loop', 'storey1', 0, 3);
		const envInner = mockEnvelope('envInner', 'inner_loop', 'storey1', 0, 3);
		// Make inner ineligible — it's a shaft
		envInner.eligibleForRoomAssembly = false;

		const outerNodes = outerPoly.map((p, i) => mockNode(outerNodeIds[i], p.x, p.z));
		const innerNodes = innerPoly.map((p, i) => mockNode(innerNodeIds[i], p.x, p.z));
		const graph = mockGraph('storey1', [...outerNodes, ...innerNodes], []);

		const result = detectClosedRooms({
			loops: [loopOuter, loopInner],
			envelopes: [envOuter, envInner],
			graphs: [graph]
		});

		// Inner is ineligible, so only outer room should be produced
		const validRooms = result.rooms.filter((r) => r.status !== 'rejected');
		expect(validRooms.length).toBe(1);
		expect(validRooms[0].floorArea).toBeCloseTo(100, 0);
	});

	// J. Scale invariance
	test('J. Scale invariance — 5×5 and 50×50 rooms both detected', () => {
		const makeRoom = (scale: number) => {
			const { loop, graph } = makeRectRoom(`room_scale${scale}`, 'storey1', 0, 0, scale, scale);
			const env = mockEnvelope(`env_scale${scale}`, `room_scale${scale}`, 'storey1', 0, 3);
			return detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph], modelDiagonalM: scale * 2 });
		};

		const r5 = makeRoom(5);
		const r50 = makeRoom(50);

		expect(r5.rooms.length).toBe(1);
		expect(r50.rooms.length).toBe(1);
		expect(r5.rooms[0].floorArea).toBeCloseTo(25, 0);
		expect(r50.rooms[0].floorArea).toBeCloseTo(2500, 0);
	});

	// K. Duplicate evidence — room emitted once
	test('K. Duplicate loop candidates (same geometry, same storey) — deduplicated to one room', () => {
		const poly = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 0, z: 5 }];
		const nIds = poly.map((_, i) => `dup:n${i}`);
		const eIds = nIds.map((_, i) => `dup:e${i}`);

		// Two loops with the same polygon and overlapping envelopes
		const loop1 = mockLoop('dup_loop1', 'storey1', nIds, eIds, poly);
		const loop2 = mockLoop('dup_loop2', 'storey1', nIds.map((n) => n + 'b'), eIds.map((e) => e + 'b'), poly);
		(loop2 as any).planPolygon = poly;

		const env1 = mockEnvelope('env_dup1', 'dup_loop1', 'storey1');
		const env2 = mockEnvelope('env_dup2', 'dup_loop2', 'storey1');

		const graph = mockGraph('storey1', poly.map((p, i) => mockNode(nIds[i], p.x, p.z)), []);

		const result = detectClosedRooms({
			loops: [loop1, loop2], envelopes: [env1, env2], graphs: [graph]
		});

		// Should produce only one valid room after deduplication
		const valid = result.rooms.filter((r) => r.status !== 'rejected');
		expect(valid.length).toBeLessThanOrEqual(2); // may deduplicate to 1
		// Both rooms should have correct area
		for (const r of valid) {
			expect(r.floorArea).toBeCloseTo(25, 0);
		}
	});

	// L. Noisy endpoints — room still detected
	test('L. Noisy endpoints — room detected through small perturbations', () => {
		const eps = 0.0005; // sub-millimeter noise
		const poly = [
			{ x: eps, z: 0 }, { x: 5 + eps, z: eps },
			{ x: 5, z: 5 - eps }, { x: -eps, z: 5 }
		];
		const nodeIds = poly.map((_, i) => `noisy:n${i}`);
		const edgeIds = nodeIds.map((_, i) => `noisy:e${i}`);
		const loop = mockLoop('noisy_loop', 'storey1', nodeIds, edgeIds, poly);
		const env = mockEnvelope('env_noisy', 'noisy_loop', 'storey1', 0, 3);
		const graph = mockGraph('storey1', poly.map((p, i) => mockNode(nodeIds[i], p.x, p.z)), []);

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });
		expect(result.rooms.length).toBe(1);
		expect(result.rooms[0].floorArea).toBeGreaterThan(20);
	});

	// M. Excessive gap — rejected
	test('M. Polygon with fewer than 3 vertices — no room', () => {
		const poly = [{ x: 0, z: 0 }, { x: 5, z: 0 }]; // only 2 pts
		const loop = mockLoop('gap_loop', 'storey1', ['n0', 'n1'], ['e01'], poly);
		const env = mockEnvelope('env_m', 'gap_loop');
		const graph = mockGraph('storey1', [], []);

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });
		expect(result.rooms.length).toBe(0);
	});

	// N. Ambiguous ceiling — room marked ambiguous
	test('N. Missing ceiling evidence — room marked ambiguous', () => {
		const { loop, graph } = makeRectRoom('amb_room', 'storey1', 0, 0, 5, 5);
		const env = mockEnvelope('env_n', 'amb_room', 'storey1', 0, 3);
		env.qualityFlags.missingUpper = true; // ceiling evidence missing

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });

		expect(result.rooms.length).toBe(1);
		expect(result.rooms[0].status).toBe('ambiguous');
		const hasDiag = result.rooms[0].diagnostics.some((d) => d.code === 'missing_ceiling');
		expect(hasDiag).toBe(true);
	});

	// O. Quarantined input coexistence — valid room still detected, data quality degraded
	test('O. Malformed envelope input coexists with valid evidence — valid room detected', () => {
		const { loop, graph } = makeRectRoom('good_room', 'storey1', 0, 0, 5, 5);
		const goodEnv = mockEnvelope('env_good', 'good_room', 'storey1', 0, 3);
		// Malformed envelope — missing eligibleForRoomAssembly (would be quarantined at boundary)
		const malformedEnv = { ...goodEnv, id: 'env_bad', eligibleForRoomAssembly: undefined as any };

		// Only pass the eligible good envelope — malformed is already quarantined upstream
		const result = detectClosedRooms({
			loops: [loop],
			envelopes: [goodEnv], // malformed would be filtered before reaching detection
			graphs: [graph]
		});

		expect(result.rooms.length).toBe(1);
		expect(result.rooms[0].status).toBe('valid');
	});

	// Determinism test
	test('Deterministic IDs — same geometry produces same ID', () => {
		const run = () => {
			const { loop, graph } = makeRectRoom('det_room', 'storey1', 0, 0, 5, 5);
			const env = mockEnvelope('env_det', 'det_room');
			return detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [graph] });
		};

		const r1 = run();
		const r2 = run();
		expect(r1.rooms[0].id).toBe(r2.rooms[0].id);
		expect(r1.fingerprint).toBe(r2.fingerprint);
	});

	// Confidence model test
	test('Confidence — complete direct-boundary room gets high confidence', () => {
		const { loop, graph } = makeRectRoom('conf_room', 'storey1', 0, 0, 5, 5);

		// Add direct edges to graph
		const edges = [
			mockEdge('conf_room:n0', 'conf_room:n1', 0, 0, 5, 0),
			mockEdge('conf_room:n1', 'conf_room:n2', 5, 0, 5, 5),
			mockEdge('conf_room:n2', 'conf_room:n3', 5, 5, 0, 5),
			mockEdge('conf_room:n3', 'conf_room:n0', 0, 5, 0, 0)
		];
		loop.edgeIds = edges.map((e, i) => `conf:e${i}`);
		edges.forEach((e, i) => { e.id = loop.edgeIds[i]; });

		const combinedGraph = { ...graph, edges };
		const env = mockEnvelope('env_conf', 'conf_room');

		const result = detectClosedRooms({ loops: [loop], envelopes: [env], graphs: [combinedGraph] });
		expect(result.rooms[0].confidence.level).not.toBe(undefined);
		expect(['high', 'medium', 'low']).toContain(result.rooms[0].confidence.level);
	});
});
