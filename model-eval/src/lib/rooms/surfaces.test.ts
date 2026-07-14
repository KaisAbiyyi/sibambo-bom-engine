import { describe, test, expect } from 'bun:test';
import { assignHorizontalEvidenceToLoops, calculateLoopSurfaceAssignmentFingerprint, rankLoopSurfaceAssignments, calculateRankedLoopSurfaceAssignmentFingerprint } from './surfaces';
import type { RankedBoundaryLoopCandidate, HorizontalSurfaceEvidence, StoreyBandEvidence, LoopSurfaceAssignment } from './types';

describe('assignHorizontalEvidenceToLoops synthetic tests', () => {
	function createLoop(id: string, status: 'primary' | 'secondary' | 'noise' = 'primary', storeyCandidateId = 'storey-1', bounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 5 } }): RankedBoundaryLoopCandidate {
		const area = (bounds.max.x - bounds.min.x) * (bounds.max.z - bounds.min.z);
		return {
			id,
			storeyCandidateId,
			connectedComponentIndex: 0,
			nodeIds: ['n1', 'n2', 'n3', 'n4'],
			edgeIds: ['e1', 'e2', 'e3', 'e4'],
			verticalEvidenceIds: ['v1'],
			sourceEvidenceIds: ['v1'],
			logicalObjectIds: ['obj-1'],
			classificationUnitIds: ['unit-1'],
			materialIds: [100],
			signedArea: area,
			absoluteArea: area,
			area,
			perimeter: 2 * (bounds.max.x - bounds.min.x + bounds.max.z - bounds.min.z),
			planBounds: bounds,
			bounds,
			orientation: 'ccw',
			isAmbiguous: false,
			quality: 1.0,
			score: 10,
			status,
			compactness: 0.8,
			boundsAspectRatio: 1.25,
			edgeCount: 4,
			uniqueSourceObjectCount: 1,
			sharedEdgeIds: [],
			adjacentLoopIds: [],
			qualityFlags: {
				nearZeroArea: false,
				extremeAspectRatio: false,
				lowCompactness: false,
				veryShortPerimeter: false,
				excessiveEdgeCount: false,
				weakSourceDiversity: false,
				nestedOrOverlapping: false,
				geometricallyPlausible: true
			}
		};
	}

	function createHoriz(id: string, surfaceType: 'floor' | 'ceiling', elevation: number, bounds = { min: { x: 0, z: 0 }, max: { x: 4, z: 5 } }, materialIds = [200]): HorizontalSurfaceEvidence {
		const areaM2 = (bounds.max.x - bounds.min.x) * (bounds.max.z - bounds.min.z);
		return {
			id,
			logicalObjectId: `obj-${id}`,
			classificationUnitIds: [`unit-${id}`],
			elevation,
			planBounds: bounds,
			materialIds,
			surfaceType,
			areaM2,
			quality: 1.0,
			isAmbiguous: false
		};
	}

	const storey1: StoreyBandEvidence = {
		id: 'storey-1',
		logicalObjectId: 'obj-storey-1',
		classificationUnitIds: ['unit-storey-1'],
		elevationRange: { min: 0.0, max: 2.8 },
		planBounds: { min: { x: 0, z: 0 }, max: { x: 10, z: 10 } },
		quality: 1.0,
		isAmbiguous: false,
		status: 'primary'
	};

	test('1. horizontal evidence covering a rectangle becomes a lower-support candidate', () => {
		const loop = createLoop('loop-1');
		const horiz = createHoriz('horiz-1', 'floor', 0.0);
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(1);
		const a = res.assignments[0];
		expect(a.role).toBe('lower-support');
		expect(a.loopCoverageRatio).toBe(1.0);
		expect(a.evidenceCoverageRatio).toBe(1.0);
		expect(a.qualityFlags.strongPlanOverlap).toBe(true);
		expect(a.qualityFlags.elevationMismatch).toBe(false);
		expect(a.qualityFlags.orientationConflict).toBe(false);
	});

	test('2. downward evidence above a loop becomes an upper-cover candidate', () => {
		const loop = createLoop('loop-1');
		const horiz = createHoriz('horiz-ceil', 'ceiling', 2.8);
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(1);
		const a = res.assignments[0];
		expect(a.role).toBe('upper-cover');
		expect(a.orientation).toBe('down');
		expect(a.qualityFlags.elevationMismatch).toBe(false);
	});

	test('3. evidence with no plan overlap is rejected', () => {
		const loop = createLoop('loop-1', 'primary', 'storey-1', { min: { x: 0, z: 0 }, max: { x: 4, z: 5 } });
		const horiz = createHoriz('horiz-far', 'floor', 0.0, { min: { x: 10, z: 10 }, max: { x: 14, z: 15 } });
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(0);
		expect(res.diagnostics.planOverlapTests).toBe(1);
		expect(res.diagnostics.loopsWithNoAssignment).toBe(1);
	});

	test('4. partial overlap produces the correct coverage ratio', () => {
		const loop = createLoop('loop-1', 'primary', 'storey-1', { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } }); // area 16
		const horiz = createHoriz('horiz-half', 'floor', 0.0, { min: { x: 0, z: 0 }, max: { x: 2, z: 4 } }); // area 8
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(1);
		const a = res.assignments[0];
		expect(a.overlapArea).toBe(8);
		expect(a.loopCoverageRatio).toBe(0.5);
		expect(a.evidenceCoverageRatio).toBe(1.0);
	});

	test('5. bounds-only overlap is marked approximate', () => {
		const loop = createLoop('loop-1');
		const horiz = createHoriz('horiz-approx', 'floor', 0.0);
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(1);
		expect(res.assignments[0].qualityFlags.approximateOverlap).toBe(true);
		expect(res.diagnostics.approximateOverlapAssignments).toBe(1);
	});

	test('6. elevation mismatch is flagged', () => {
		const loop = createLoop('loop-1');
		const horiz = createHoriz('horiz-bad-elev', 'floor', -2.0); // way below 0.0
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(1);
		expect(res.assignments[0].qualityFlags.elevationMismatch).toBe(true);
	});

	test('7. orientation conflict is flagged', () => {
		const loop = createLoop('loop-1');
		// Ceiling (facing down) right at the floor level (0.0)
		const horiz = createHoriz('horiz-conflict', 'ceiling', 0.0);
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(1);
		expect(res.assignments[0].qualityFlags.orientationConflict).toBe(true);
	});

	test('8. multiple plausible lower surfaces are preserved', () => {
		const loop = createLoop('loop-1', 'primary', 'storey-1', { min: { x: 0, z: 0 }, max: { x: 4, z: 4 } });
		const h1 = createHoriz('horiz-1', 'floor', 0.0, { min: { x: 0, z: 0 }, max: { x: 2, z: 4 } });
		const h2 = createHoriz('horiz-2', 'floor', 0.0, { min: { x: 2, z: 0 }, max: { x: 4, z: 4 } });
		const res = assignHorizontalEvidenceToLoops([loop], [h1, h2], [storey1]);

		expect(res.assignments.length).toBe(2);
		expect(res.diagnostics.lowerSupportCandidates).toBe(2);
		expect(res.assignments[0].role).toBe('lower-support');
		expect(res.assignments[1].role).toBe('lower-support');
		expect(res.assignments[0].qualityFlags.multipleLowerCandidates).toBe(true);
		expect(res.assignments[1].qualityFlags.multipleLowerCandidates).toBe(true);
	});

	test('9. noise loops are skipped', () => {
		const loop = createLoop('loop-noise', 'noise');
		const horiz = createHoriz('horiz-1', 'floor', 0.0);
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(0);
		expect(res.diagnostics.noiseLoopsSkipped).toBe(1);
		expect(res.diagnostics.loopsInspected).toBe(0);
	});

	test('10. source ownership and material IDs are preserved', () => {
		const loop = createLoop('loop-1');
		const horiz = createHoriz('horiz-owner', 'floor', 0.0, { min: { x: 0, z: 0 }, max: { x: 4, z: 5 } }, [555, 777]);
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		expect(res.assignments.length).toBe(1);
		const a = res.assignments[0];
		expect(a.logicalObjectId).toBe('obj-horiz-owner');
		expect(a.classificationUnitIds).toEqual(['unit-horiz-owner']);
		expect(a.materialIds).toEqual([555, 777]);
	});

	test('11. shuffled input produces identical output', () => {
		const loop = createLoop('loop-1');
		const h1 = createHoriz('h1', 'floor', 0.0);
		const h2 = createHoriz('h2', 'ceiling', 2.8);
		const h3 = createHoriz('h3', 'floor', 1.4); // intersecting

		const res1 = assignHorizontalEvidenceToLoops([loop], [h1, h2, h3], [storey1]);
		const res2 = assignHorizontalEvidenceToLoops([loop], [h3, h1, h2], [storey1]);

		expect(res1.assignments).toEqual(res2.assignments);
		expect(res1.diagnostics.fingerprint).toBe(res2.diagnostics.fingerprint);
	});

	test('12. repeated execution produces identical IDs and fingerprint', () => {
		const loop = createLoop('loop-1');
		const h1 = createHoriz('h1', 'floor', 0.0);
		const h2 = createHoriz('h2', 'ceiling', 2.8);

		const res1 = assignHorizontalEvidenceToLoops([loop], [h1, h2], [storey1]);
		const res2 = assignHorizontalEvidenceToLoops([loop], [h1, h2], [storey1]);

		expect(res1.assignments.map(a => a.id)).toEqual(res2.assignments.map(a => a.id));
		expect(res1.diagnostics.fingerprint).toBe(res2.diagnostics.fingerprint!);
		expect(calculateLoopSurfaceAssignmentFingerprint(res1.assignments)).toBe(res1.diagnostics.fingerprint!);
	});

	test('13. no final room object is created', () => {
		const loop = createLoop('loop-1');
		const horiz = createHoriz('horiz-1', 'floor', 0.0);
		const res = assignHorizontalEvidenceToLoops([loop], [horiz], [storey1]);

		// Result should only contain assignments and diagnostics, no room definitions
		expect(res).toHaveProperty('assignments');
		expect(res).toHaveProperty('diagnostics');
		expect(res).not.toHaveProperty('rooms');
		expect((res as any).rooms).toBeUndefined();
	});

	test('14. no assignment is fabricated when horizontal evidence is absent', () => {
		const loop = createLoop('loop-1');
		const res = assignHorizontalEvidenceToLoops([loop], [], [storey1]);

		expect(res.assignments.length).toBe(0);
		expect(res.diagnostics.loopsWithNoAssignment).toBe(1);
		expect(res.diagnostics.assignmentsAccepted).toBe(0);
	});
});

describe('rankLoopSurfaceAssignments synthetic tests', () => {
	function createMockAssignment(overrides: Partial<LoopSurfaceAssignment>): LoopSurfaceAssignment {
		return {
			id: overrides.id || 'assign-1',
			loopCandidateId: overrides.loopCandidateId || 'loop-1',
			storeyCandidateId: overrides.storeyCandidateId || 'storey-1',
			horizontalEvidenceId: overrides.horizontalEvidenceId || 'ev-1',
			logicalObjectId: overrides.logicalObjectId || 'obj-1',
			classificationUnitIds: overrides.classificationUnitIds || ['unit-1'],
			materialIds: overrides.materialIds || [100],
			orientation: overrides.orientation || 'up',
			elevation: overrides.elevation ?? 0.0,
			loopArea: overrides.loopArea ?? 20.0,
			overlapArea: overrides.overlapArea ?? 20.0,
			loopCoverageRatio: overrides.loopCoverageRatio ?? 1.0,
			evidenceCoverageRatio: overrides.evidenceCoverageRatio ?? 1.0,
			verticalDistance: overrides.verticalDistance ?? 0.0,
			role: overrides.role || 'lower-support',
			score: overrides.score ?? 80.0,
			qualityFlags: {
				approximateOverlap: overrides.qualityFlags?.approximateOverlap ?? false,
				weakPlanOverlap: overrides.qualityFlags?.weakPlanOverlap ?? false,
				strongPlanOverlap: overrides.qualityFlags?.strongPlanOverlap ?? true,
				elevationMismatch: overrides.qualityFlags?.elevationMismatch ?? false,
				orientationConflict: overrides.qualityFlags?.orientationConflict ?? false,
				multipleLowerCandidates: overrides.qualityFlags?.multipleLowerCandidates ?? false,
				multipleUpperCandidates: overrides.qualityFlags?.multipleUpperCandidates ?? false,
				noHorizontalSupport: overrides.qualityFlags?.noHorizontalSupport ?? false,
				ambiguousRole: overrides.qualityFlags?.ambiguousRole ?? false
			}
		};
	}

	function createMockLoop(id: string, status: 'primary' | 'secondary' | 'noise' = 'primary'): RankedBoundaryLoopCandidate {
		return {
			id,
			storeyCandidateId: 'storey-1',
			connectedComponentIndex: 0,
			nodeIds: ['n1', 'n2', 'n3', 'n4'],
			edgeIds: ['e1', 'e2', 'e3', 'e4'],
			verticalEvidenceIds: ['v1'],
			sourceEvidenceIds: ['v1'],
			logicalObjectIds: ['obj-1'],
			classificationUnitIds: ['unit-1'],
			materialIds: [100],
			signedArea: 20,
			absoluteArea: 20,
			planBounds: { min: { x: 0, z: 0 }, max: { x: 4, z: 5 } },
			edgeCount: 4,
			uniqueSourceObjectCount: 1,
			area: 20,
			perimeter: 18,
			compactness: 0.8,
			boundsAspectRatio: 1.25,
			orientation: 'ccw',
			isAmbiguous: false,
			quality: 1.0,
			qualityFlags: {
				nearZeroArea: false,
				extremeAspectRatio: false,
				lowCompactness: false,
				veryShortPerimeter: false,
				excessiveEdgeCount: false,
				weakSourceDiversity: false,
				nestedOrOverlapping: false,
				geometricallyPlausible: true
			},
			sharedEdgeIds: [],
			adjacentLoopIds: [],
			score: 90,
			status
		};
	}

	test('1. high-overlap lower support ranks above tiny-overlap support', () => {
		const loop = createMockLoop('loop-1');
		const a1 = createMockAssignment({ id: 'high-cov', loopCoverageRatio: 0.95, evidenceCoverageRatio: 0.95 });
		const a2 = createMockAssignment({ id: 'tiny-cov', loopCoverageRatio: 0.1, evidenceCoverageRatio: 0.1 });

		const res = rankLoopSurfaceAssignments([a2, a1], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.primaryLowerAssignments[0].id).toBe('high-cov');
		expect(sel.secondaryLowerAssignments[0].id).toBe('tiny-cov');
		expect(sel.primaryLowerAssignments[0].rank).toBe(1);
		expect(sel.secondaryLowerAssignments[0].rank).toBe(2);
	});

	test('2. close elevation ranks above distant elevation', () => {
		const loop = createMockLoop('loop-1');
		const aClose = createMockAssignment({ id: 'close-ev', verticalDistance: 0.05 });
		const aDist = createMockAssignment({ id: 'dist-ev', verticalDistance: 0.45 });

		const res = rankLoopSurfaceAssignments([aDist, aClose], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.primaryLowerAssignments[0].id).toBe('close-ev');
		expect(sel.secondaryLowerAssignments[0].id).toBe('dist-ev');
	});

	test('3. orientation conflict cannot become primary', () => {
		const loop = createMockLoop('loop-1');
		const aConflict = createMockAssignment({
			id: 'cand-conflict',
			loopCoverageRatio: 1.0,
			evidenceCoverageRatio: 1.0,
			qualityFlags: { orientationConflict: true } as any
		});

		const res = rankLoopSurfaceAssignments([aConflict], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.primaryLowerAssignments.length).toBe(0);
		expect(sel.secondaryLowerAssignments.length).toBe(1);
		expect(sel.secondaryLowerAssignments[0].id).toBe('cand-conflict');
		expect(sel.noLowerSupport).toBe(true);
	});

	test('4. elevation mismatch cannot become primary', () => {
		const loop = createMockLoop('loop-1');
		const aMismatch = createMockAssignment({
			id: 'cand-mismatch',
			loopCoverageRatio: 1.0,
			evidenceCoverageRatio: 1.0,
			qualityFlags: { elevationMismatch: true } as any
		});

		const res = rankLoopSurfaceAssignments([aMismatch], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.primaryLowerAssignments.length).toBe(0);
		expect(sel.secondaryLowerAssignments[0].id).toBe('cand-mismatch');
		expect(sel.noLowerSupport).toBe(true);
	});

	test('5. approximate overlap remains eligible but receives lower confidence', () => {
		const loop = createMockLoop('loop-1');
		const aApprox = createMockAssignment({
			id: 'cand-approx',
			loopCoverageRatio: 1.0,
			evidenceCoverageRatio: 1.0,
			qualityFlags: { approximateOverlap: true } as any
		});

		const res = rankLoopSurfaceAssignments([aApprox], [loop]);
		const cand = res.assignments.find(a => a.id === 'cand-approx')!;
		expect(cand.status).toBe('primary');
		expect(cand.ambiguityFlags.isApproximate).toBe(true);
		// Score should be slightly reduced by approximate penalty (0.95)
		expect(cand.score).toBeLessThan(100);
	});

	test('6. exact or stronger overlap ranks above approximate weak overlap', () => {
		const loop = createMockLoop('loop-1');
		const exactStrong = createMockAssignment({
			id: 'exact-strong',
			loopCoverageRatio: 0.9,
			evidenceCoverageRatio: 0.9,
			qualityFlags: { approximateOverlap: false } as any
		});
		const approxWeak = createMockAssignment({
			id: 'approx-weak',
			loopCoverageRatio: 0.85,
			evidenceCoverageRatio: 0.85,
			qualityFlags: { approximateOverlap: true } as any
		});

		const res = rankLoopSurfaceAssignments([approxWeak, exactStrong], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.primaryLowerAssignments[0].id).toBe('exact-strong');
		expect(sel.secondaryLowerAssignments[0].id).toBe('approx-weak');
	});

	test('7. tied candidates remain preserved deterministically', () => {
		const loop = createMockLoop('loop-1');
		const tieB = createMockAssignment({ id: 'tie-b', loopCoverageRatio: 0.9, evidenceCoverageRatio: 0.9, verticalDistance: 0.1 });
		const tieA = createMockAssignment({ id: 'tie-a', loopCoverageRatio: 0.9, evidenceCoverageRatio: 0.9, verticalDistance: 0.1 });

		const res = rankLoopSurfaceAssignments([tieB, tieA], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.primaryLowerAssignments.length).toBe(2);
		expect(sel.primaryLowerAssignments[0].id).toBe('tie-a');
		expect(sel.primaryLowerAssignments[1].id).toBe('tie-b');
	});

	test('8. lower and upper roles are ranked independently', () => {
		const loop = createMockLoop('loop-1');
		const lower = createMockAssignment({ id: 'cand-lower', role: 'lower-support', loopCoverageRatio: 0.9, evidenceCoverageRatio: 0.9 });
		const upper = createMockAssignment({ id: 'cand-upper', role: 'upper-cover', loopCoverageRatio: 0.8, evidenceCoverageRatio: 0.8, orientation: 'down' });

		const res = rankLoopSurfaceAssignments([upper, lower], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.primaryLowerAssignments.length).toBe(1);
		expect(sel.primaryLowerAssignments[0].id).toBe('cand-lower');
		expect(sel.primaryUpperAssignments.length).toBe(1);
		expect(sel.primaryUpperAssignments[0].id).toBe('cand-upper');
	});

	test('9. noise assignments remain present in diagnostics', () => {
		const loop = createMockLoop('loop-1');
		const aNoise = createMockAssignment({ id: 'cand-noise', loopCoverageRatio: 0.01, evidenceCoverageRatio: 0.01 });

		const res = rankLoopSurfaceAssignments([aNoise], [loop]);
		const cand = res.assignments.find(a => a.id === 'cand-noise')!;
		expect(cand.status).toBe('noise');
		expect(res.diagnostics.noiseAssignments).toBe(1);
		expect(res.diagnostics.negligibleOverlapAssignments).toBe(1);
	});

	test('10. shuffled input produces identical ranking', () => {
		const loop = createMockLoop('loop-1');
		const a1 = createMockAssignment({ id: 'cand-1', loopCoverageRatio: 0.9 });
		const a2 = createMockAssignment({ id: 'cand-2', loopCoverageRatio: 0.8 });
		const a3 = createMockAssignment({ id: 'cand-3', loopCoverageRatio: 0.7 });

		const resOrder1 = rankLoopSurfaceAssignments([a1, a2, a3], [loop]);
		const resOrder2 = rankLoopSurfaceAssignments([a3, a1, a2], [loop]);

		expect(resOrder1.assignments.map(a => `${a.id}:${a.rank}:${a.status}`))
			.toEqual(resOrder2.assignments.map(a => `${a.id}:${a.rank}:${a.status}`));
		expect(resOrder1.diagnostics.rankedFingerprint).toBe(resOrder2.diagnostics.rankedFingerprint);
	});

	test('11. repeated execution produces identical IDs and fingerprint', () => {
		const loop = createMockLoop('loop-1');
		const a1 = createMockAssignment({ id: 'cand-1', loopCoverageRatio: 0.9 });
		const a2 = createMockAssignment({ id: 'cand-2', role: 'upper-cover', loopCoverageRatio: 0.85, orientation: 'down' });

		const res1 = rankLoopSurfaceAssignments([a1, a2], [loop]);
		const res2 = rankLoopSurfaceAssignments([a1, a2], [loop]);

		expect(res1.diagnostics.rankedFingerprint).toBe(res2.diagnostics.rankedFingerprint);
		expect(calculateRankedLoopSurfaceAssignmentFingerprint(res1.assignments)).toBe(res1.diagnostics.rankedFingerprint);
	});

	test('12. source ownership and material IDs remain unchanged', () => {
		const loop = createMockLoop('loop-1');
		const orig = createMockAssignment({
			id: 'cand-orig',
			logicalObjectId: 'obj-42',
			classificationUnitIds: ['unit-7', 'unit-8'],
			materialIds: [5, 10]
		});

		const res = rankLoopSurfaceAssignments([orig], [loop]);
		const cand = res.assignments[0];
		expect(cand.logicalObjectId).toBe('obj-42');
		expect(cand.classificationUnitIds).toEqual(['unit-7', 'unit-8']);
		expect(cand.materialIds).toEqual([5, 10]);
	});

	test('13. no final room object is created', () => {
		const loop = createMockLoop('loop-1');
		const cand = createMockAssignment({ id: 'cand-1' });

		const res = rankLoopSurfaceAssignments([cand], [loop]);
		expect(res).toHaveProperty('assignments');
		expect(res).toHaveProperty('selectionsByLoop');
		expect(res).toHaveProperty('diagnostics');
		expect(res).not.toHaveProperty('rooms');
		expect((res as any).rooms).toBeUndefined();
	});

	test('14. a loop without valid support is marked noLowerSupport', () => {
		const loop = createMockLoop('loop-1');
		const invalid = createMockAssignment({
			id: 'cand-invalid',
			loopCoverageRatio: 0.01,
			evidenceCoverageRatio: 0.01
		});

		const res = rankLoopSurfaceAssignments([invalid], [loop]);
		const sel = res.selectionsByLoop.get('loop-1')!;
		expect(sel.noLowerSupport).toBe(true);
		expect(res.diagnostics.loopsWithNoLowerSupport).toBe(1);
	});
});
