import { describe, test, expect } from 'bun:test';
import { assignHorizontalEvidenceToLoops, calculateLoopSurfaceAssignmentFingerprint } from './surfaces';
import type { RankedBoundaryLoopCandidate, HorizontalSurfaceEvidence, StoreyBandEvidence } from './types';

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
