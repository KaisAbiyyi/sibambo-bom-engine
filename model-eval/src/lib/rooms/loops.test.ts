import { describe, expect, test } from 'bun:test';
import { findBoundaryLoopCandidates, generateBoundaryLoopId, calculateBoundaryLoopFingerprint } from './loops';
import { normalizeBarrierGraph } from './helpers';
import type { NormalizedBarrierGraph, BarrierGraph, BarrierGraphEdge, PlanCoord } from './types';

function makeGraph(
	nodes: Array<{ id: string; x: number; z: number }>,
	edges: Array<{ id?: string; a: string; b: string; veIds?: string[]; objId?: string; cuIds?: string[]; mats?: number[] }>,
	storeyId = 'storey:1'
): NormalizedBarrierGraph {
	const nodeMap = new Map(nodes.map(n => [n.id, { id: n.id, coord: { x: n.x, z: n.z } }]));
	const rawEdges: BarrierGraphEdge[] = edges.map((e, idx) => {
		const na = nodeMap.get(e.a)!;
		const nb = nodeMap.get(e.b)!;
		return {
			id: e.id || `edge:${idx + 1}`,
			nodeAId: e.a,
			nodeBId: e.b,
			start: na.coord,
			end: nb.coord,
			originalStart: na.coord,
			originalEnd: nb.coord,
			verticalEvidenceIds: e.veIds || [`ve:${idx + 1}`],
			logicalObjectId: e.objId || 'logObj:1',
			classificationUnitIds: e.cuIds || ['cu:1'],
			materialIds: e.mats || [100],
			storeyCandidateId: storeyId
		};
	});

	const rawGraph: BarrierGraph = {
		storeyCandidateId: storeyId,
		nodes: nodes.map(n => ({ id: n.id, coord: { x: n.x, z: n.z } })),
		edges: rawEdges,
		components: [],
		diagnostics: {
			inputBarriers: rawEdges.length,
			acceptedEdges: rawEdges.length,
			rejectedEdges: 0,
			snappedEndpoints: 0,
			duplicateEdgesMerged: 0,
			graphNodes: nodes.length,
			graphEdges: rawEdges.length,
			connectedComponents: 0
		}
	};

	return normalizeBarrierGraph(rawGraph);
}

describe('findBoundaryLoopCandidates synthetic tests', () => {
	test('1. closed rectangle produces one bounded candidate', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 4, z: 0 },
			{ id: 'n3', x: 4, z: 3 },
			{ id: 'n4', x: 0, z: 3 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' },
			{ id: 'e4', a: 'n4', b: 'n1' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(1);
		expect(result.diagnostics.acceptedCandidates).toBe(1);
		expect(result.diagnostics.outerFacesExcluded).toBe(1);
		expect(result.candidates[0].area).toBe(12);
		expect(result.candidates[0].orientation).toBe('ccw');
	});

	test('2. open rectangle produces zero candidates', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 4, z: 0 },
			{ id: 'n3', x: 4, z: 3 },
			{ id: 'n4', x: 0, z: 3 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(0);
		expect(result.diagnostics.acceptedCandidates).toBe(0);
	});

	test('3. two disconnected rectangles produce two candidates', () => {
		const graph = makeGraph([
			{ id: 'r1_n1', x: 0, z: 0 },
			{ id: 'r1_n2', x: 4, z: 0 },
			{ id: 'r1_n3', x: 4, z: 3 },
			{ id: 'r1_n4', x: 0, z: 3 },
			{ id: 'r2_n1', x: 10, z: 10 },
			{ id: 'r2_n2', x: 14, z: 10 },
			{ id: 'r2_n3', x: 14, z: 13 },
			{ id: 'r2_n4', x: 10, z: 13 }
		], [
			{ id: 'r1_e1', a: 'r1_n1', b: 'r1_n2' },
			{ id: 'r1_e2', a: 'r1_n2', b: 'r1_n3' },
			{ id: 'r1_e3', a: 'r1_n3', b: 'r1_n4' },
			{ id: 'r1_e4', a: 'r1_n4', b: 'r1_n1' },
			{ id: 'r2_e1', a: 'r2_n1', b: 'r2_n2' },
			{ id: 'r2_e2', a: 'r2_n2', b: 'r2_n3' },
			{ id: 'r2_e3', a: 'r2_n3', b: 'r2_n4' },
			{ id: 'r2_e4', a: 'r2_n4', b: 'r2_n1' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(2);
		expect(result.diagnostics.outerFacesExcluded).toBe(2);
		expect(result.candidates[0].area).toBe(12);
		expect(result.candidates[1].area).toBe(12);
		const compIndices = result.candidates.map(c => c.connectedComponentIndex).sort();
		expect(compIndices).toEqual([0, 1]);
	});

	test('4. two adjacent rectangles sharing one edge produce two bounded candidates', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n5', x: 8, z: 0 },
			{ id: 'n4', x: 0, z: 3 },
			{ id: 'n6', x: 8, z: 3 },
			{ id: 'n_div_s', x: 4, z: -0.1 },
			{ id: 'n_div_e', x: 4, z: 3.1 }
		], [
			{ id: 'e_bot', a: 'n1', b: 'n5' },
			{ id: 'e_top', a: 'n4', b: 'n6' },
			{ id: 'e_div', a: 'n_div_s', b: 'n_div_e' },
			{ id: 'e_left', a: 'n4', b: 'n1' },
			{ id: 'e_right', a: 'n5', b: 'n6' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(2);
		expect(result.diagnostics.outerFacesExcluded).toBe(1);
		expect(result.candidates[0].area).toBe(12);
		expect(result.candidates[1].area).toBe(12);
	});


	test('5. a T-junction without a closed boundary produces zero candidates', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 10, z: 0 },
			{ id: 'n3', x: 5, z: 0 },
			{ id: 'n4', x: 5, z: 5 }
		], [
			{ id: 'e1', a: 'n1', b: 'n3' },
			{ id: 'e2', a: 'n3', b: 'n2' },
			{ id: 'e3', a: 'n3', b: 'n4' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(0);
	});

	test('6. crossing segments without an enclosed face produce zero candidates', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 10, z: 10 },
			{ id: 'n3', x: 0, z: 10 },
			{ id: 'n4', x: 10, z: 0 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n3', b: 'n4' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(0);
	});

	test('7. outer face is excluded', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 5, z: 0 },
			{ id: 'n3', x: 5, z: 5 },
			{ id: 'n4', x: 0, z: 5 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' },
			{ id: 'e4', a: 'n4', b: 'n1' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.diagnostics.outerFacesExcluded).toBe(1);
		for (const c of result.candidates) {
			expect(c.orientation).toBe('ccw');
			expect(c.signedArea).toBeGreaterThan(0);
		}
	});

	test('8. reversed edge directions produce identical candidates', () => {
		const nodes = [
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 4, z: 0 },
			{ id: 'n3', x: 4, z: 3 },
			{ id: 'n4', x: 0, z: 3 }
		];
		const graph1 = makeGraph(nodes, [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' },
			{ id: 'e4', a: 'n4', b: 'n1' }
		]);
		const graph2 = makeGraph(nodes, [
			{ id: 'e1', a: 'n2', b: 'n1' },
			{ id: 'e2', a: 'n3', b: 'n2' },
			{ id: 'e3', a: 'n4', b: 'n3' },
			{ id: 'e4', a: 'n1', b: 'n4' }
		]);

		const res1 = findBoundaryLoopCandidates(graph1);
		const res2 = findBoundaryLoopCandidates(graph2);
		expect(res1.candidates).toEqual(res2.candidates);
	});

	test('9. shuffled node and edge order produces identical candidates', () => {
		const nodes = [
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 4, z: 0 },
			{ id: 'n3', x: 4, z: 3 },
			{ id: 'n4', x: 0, z: 3 }
		];
		const edges = [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' },
			{ id: 'e4', a: 'n4', b: 'n1' }
		];

		const graph1 = makeGraph(nodes, edges);
		const graph2 = makeGraph([nodes[2], nodes[0], nodes[3], nodes[1]], [edges[3], edges[1], edges[0], edges[2]]);

		const res1 = findBoundaryLoopCandidates(graph1);
		const res2 = findBoundaryLoopCandidates(graph2);
		expect(res1.candidates).toEqual(res2.candidates);
	});

	test('10. repeated execution produces identical IDs and ordering', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 4, z: 0 },
			{ id: 'n3', x: 4, z: 3 },
			{ id: 'n4', x: 0, z: 3 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' },
			{ id: 'e4', a: 'n4', b: 'n1' }
		]);

		const resBase = findBoundaryLoopCandidates(graph);
		for (let i = 0; i < 5; i++) {
			const resLoop = findBoundaryLoopCandidates(graph);
			expect(resLoop.candidates).toEqual(resBase.candidates);
			expect(resLoop.diagnostics).toEqual(resBase.diagnostics);
		}
	});

	test('11. source ownership and materials are preserved', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 4, z: 0 },
			{ id: 'n3', x: 4, z: 3 },
			{ id: 'n4', x: 0, z: 3 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2', veIds: ['ve:B', 've:A'], objId: 'obj:2', cuIds: ['cu:2'], mats: [20] },
			{ id: 'e2', a: 'n2', b: 'n3', veIds: ['ve:C'], objId: 'obj:1', cuIds: ['cu:1'], mats: [10, 30] },
			{ id: 'e3', a: 'n3', b: 'n4', veIds: ['ve:D'], objId: 'obj:3', cuIds: ['cu:3'], mats: [10] },
			{ id: 'e4', a: 'n4', b: 'n1', veIds: ['ve:E'], objId: 'obj:1', cuIds: ['cu:4'], mats: [40] }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(1);
		const cand = result.candidates[0];
		expect(cand.verticalEvidenceIds).toEqual(['ve:A', 've:B', 've:C', 've:D', 've:E']);
		expect(cand.sourceEvidenceIds).toEqual(['ve:A', 've:B', 've:C', 've:D', 've:E']);
		expect(cand.logicalObjectIds).toEqual(['obj:1', 'obj:2', 'obj:3']);
		expect(cand.classificationUnitIds).toEqual(['cu:1', 'cu:2', 'cu:3', 'cu:4']);
		expect(cand.materialIds).toEqual([10, 20, 30, 40]);
	});

	test('12. no edge is fabricated across a gap', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 4, z: 0 },
			{ id: 'n3', x: 4, z: 3 },
			{ id: 'n4', x: 0, z: 3 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e4', a: 'n4', b: 'n1' }
			// gap between n3 and n4 (e3 missing)
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(0);
	});

	test('13. zero-area loops are rejected', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 5, z: 0 },
			{ id: 'n3', x: 5, z: 0.00001 },
			{ id: 'n4', x: 0, z: 0.00001 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' },
			{ id: 'e4', a: 'n4', b: 'n1' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(0);
		expect(result.diagnostics.zeroAreaLoopsRejected).toBeGreaterThan(0);
	});

	test('14. candidate area, perimeter, and bounds are correct', () => {
		const graph = makeGraph([
			{ id: 'n1', x: 0, z: 0 },
			{ id: 'n2', x: 6, z: 0 },
			{ id: 'n3', x: 6, z: 4 },
			{ id: 'n4', x: 0, z: 4 }
		], [
			{ id: 'e1', a: 'n1', b: 'n2' },
			{ id: 'e2', a: 'n2', b: 'n3' },
			{ id: 'e3', a: 'n3', b: 'n4' },
			{ id: 'e4', a: 'n4', b: 'n1' }
		]);

		const result = findBoundaryLoopCandidates(graph);
		expect(result.candidates.length).toBe(1);
		const cand = result.candidates[0];
		expect(cand.area).toBe(24);
		expect(cand.absoluteArea).toBe(24);
		expect(cand.signedArea).toBe(24);
		expect(cand.perimeter).toBe(20);
		expect(cand.planBounds).toEqual({
			min: { x: 0, z: 0 },
			max: { x: 6, z: 4 }
		});
	});
});
