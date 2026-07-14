import { describe, test, expect } from 'bun:test';
import {
	buildVerticalEnvelopeCandidates,
	calculateVerticalEnvelopeCandidateFingerprint
} from './envelopes';
import type {
	RankedBoundaryLoopCandidate,
	LoopSurfaceAssignment,
	RankedLoopSurfaceAssignment
} from './types';

function createMockLoop(
	id: string,
	status: 'primary' | 'secondary' | 'noise' = 'primary',
	area = 20.0
): RankedBoundaryLoopCandidate {
	return {
		id,
		storeyCandidateId: 'storey:test',
		connectedComponentIndex: 0,
		nodeIds: ['n1', 'n2', 'n3', 'n4'],
		edgeIds: ['e1', 'e2', 'e3', 'e4'],
		verticalEvidenceIds: ['v1', 'v2', 'v3', 'v4'],
		sourceEvidenceIds: ['v1', 'v2', 'v3', 'v4'],
		logicalObjectIds: ['obj-loop'],
		classificationUnitIds: ['unit-loop'],
		materialIds: [100],
		signedArea: area,
		absoluteArea: area,
		area,
		perimeter: 18,
		compactness: 0.8,
		boundsAspectRatio: 1.25,
		edgeCount: 4,
		uniqueSourceObjectCount: 1,
		planBounds: { min: { x: 0, z: 0 }, max: { x: 5, z: 4 } },
		bounds: { min: { x: 0, z: 0 }, max: { x: 5, z: 4 } },
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

function createMockAssignment(
	id: string,
	loopCandidateId: string,
	role: 'lower-support' | 'upper-cover',
	elevation: number,
	status: 'primary' | 'secondary' | 'noise' = 'primary',
	score = 90,
	evidenceCoverageRatio = 1.0,
	logicalObjectIds = ['obj-assign']
): RankedLoopSurfaceAssignment {
	return {
		id,
		loopCandidateId,
		storeyCandidateId: 'storey:test',
		role,
		horizontalEvidenceId: `horiz:${id}`,
		sourceEvidenceIds: [`source:${id}`],
		logicalObjectId: logicalObjectIds[0] || 'obj-assign',
		logicalObjectIds,
		classificationUnitIds: ['unit-assign'],
		materialIds: [200],
		elevation,
		loopArea: 20.0,
		evidenceCoverageRatio,
		loopCoverageRatio: evidenceCoverageRatio,
		overlapArea: 20.0 * evidenceCoverageRatio,
		verticalDistance: 0,
		orientation: role === 'lower-support' ? 'up' : 'down',
		ambiguityFlags: {
			isApproximate: false,
			isAmbiguousRole: false,
			isElevationMismatch: false,
			isOrientationConflict: false
		},
		rejectionReasons: [],

		qualityFlags: {
			approximateOverlap: false,
			weakPlanOverlap: false,
			strongPlanOverlap: true,
			elevationMismatch: false,
			orientationConflict: false,
			multipleLowerCandidates: false,
			multipleUpperCandidates: false,
			noHorizontalSupport: false,
			ambiguousRole: false
		},
		score,
		status,
		rank: 1,
		normalizedOverlapScore: score,
		normalizedElevationScore: score,
		orientationConsistencyScore: score
	};
}


describe('buildVerticalEnvelopeCandidates synthetic tests', () => {
	test('1. valid lower and upper assignments create one envelope', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0);

		const result = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		expect(result.candidates.length).toBe(1);
		const cand = result.candidates[0];
		expect(cand.status).toBe('primary');
		expect(cand.clearHeight).toBe(3.0);
		expect(cand.qualityFlags.geometricallyPlausible).toBe(true);
		expect(cand.qualityFlags.missingLower).toBe(false);
		expect(cand.qualityFlags.missingUpper).toBe(false);
	});

	test('2. upper below lower is rejected', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 3.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 0.0);

		const result = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		expect(result.candidates.length).toBe(1);
		const cand = result.candidates[0];
		expect(cand.status).toBe('noise');
		expect(cand.qualityFlags.nonPositiveHeight).toBe(true);
		expect(result.diagnostics.rejectedNonPositiveHeights).toBe(1);
	});

	test('3. zero height is rejected', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 2.5);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 2.5);

		const result = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		expect(result.candidates.length).toBe(1);
		const cand = result.candidates[0];
		expect(cand.status).toBe('noise');
		expect(cand.qualityFlags.nonPositiveHeight).toBe(true);
		expect(result.diagnostics.rejectedNonPositiveHeights).toBe(1);
	});

	test('4. stronger pair ranks above weaker pair', () => {
		const loop = createMockLoop('loop1');
		const lowerStrong = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0, 'primary', 95);
		const upperStrong = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0, 'primary', 95);
		const lowerWeak = createMockAssignment('lower2', 'loop1', 'lower-support', 0.0, 'secondary', 40, 0.4);

		const result = buildVerticalEnvelopeCandidates(
			[loop],
			[lowerStrong, upperStrong, lowerWeak]
		);
		expect(result.candidates.length).toBe(2);
		const [top, bottom] = result.candidates;
		expect(top.id).toContain('lower1');
		expect(top.rank).toBe(1);
		expect(bottom.rank).toBe(2);
		expect(top.score).toBeGreaterThan(bottom.score);
	});

	test('5. tied pairs remain deterministic', () => {
		const loop = createMockLoop('loop1');
		const lowerA = createMockAssignment('lowerA', 'loop1', 'lower-support', 0.0, 'primary', 90);
		const lowerB = createMockAssignment('lowerB', 'loop1', 'lower-support', 0.0, 'primary', 90);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0, 'primary', 90);

		const result1 = buildVerticalEnvelopeCandidates([loop], [lowerA, lowerB, upper]);
		const result2 = buildVerticalEnvelopeCandidates([loop], [lowerB, lowerA, upper]);
		expect(result1.candidates[0].id).toBe(result2.candidates[0].id);
		expect(result1.candidates[1].id).toBe(result2.candidates[1].id);
	});

	test('6. missing lower is reported', () => {
		const loop = createMockLoop('loop1');
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0);

		const result = buildVerticalEnvelopeCandidates([loop], [upper]);
		expect(result.diagnostics.loopsMissingLowerSupport).toBe(1);
		expect(result.candidates[0].qualityFlags.missingLower).toBe(true);
		expect(result.candidates[0].status).toBe('noise');
	});

	test('7. missing upper is reported', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);

		const result = buildVerticalEnvelopeCandidates([loop], [lower]);
		expect(result.diagnostics.loopsMissingUpperCover).toBe(1);
		expect(result.candidates[0].qualityFlags.missingUpper).toBe(true);
		expect(result.candidates[0].status).toBe('noise');
	});

	test('8. multiple candidates set ambiguity', () => {
		const loop = createMockLoop('loop1');
		const lower1 = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0, 'primary', 90);
		const lower2 = createMockAssignment('lower2', 'loop1', 'lower-support', 0.1, 'primary', 89);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0, 'primary', 90);

		const result = buildVerticalEnvelopeCandidates([loop], [lower1, lower2, upper]);
		expect(result.diagnostics.loopsWithMultipleEnvelopes).toBe(1);
		for (const cand of result.candidates) {
			expect(cand.qualityFlags.multipleEnvelopeCandidates).toBe(true);
		}
	});

	test('9. estimated volume equals loop area × clear height', () => {
		const loop = createMockLoop('loop1', 'primary', 25.5);
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.2);

		const result = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		const cand = result.candidates[0];
		expect(cand.clearHeight).toBe(3.2);
		expect(cand.loopArea).toBe(25.5);
		expect(cand.estimatedVolume).toBe(Number((25.5 * 3.2).toFixed(6)));
	});

	test('10. shuffled input produces identical output', () => {
		const loop = createMockLoop('loop1');
		const lower1 = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const lower2 = createMockAssignment('lower2', 'loop1', 'lower-support', 0.2);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0);

		const res1 = buildVerticalEnvelopeCandidates([loop], [lower1, upper, lower2]);
		const res2 = buildVerticalEnvelopeCandidates([loop], [upper, lower2, lower1]);
		expect(res1.candidates).toEqual(res2.candidates);
		expect(res1.diagnostics.fingerprint).toBe(res2.diagnostics.fingerprint);
	});

	test('11. repeated execution produces identical IDs/fingerprint', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0);

		const res1 = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		const res2 = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		expect(res1.candidates[0].id).toBe(res2.candidates[0].id);
		expect(res1.diagnostics.fingerprint).toBe(res2.diagnostics.fingerprint);
	});

	test('12. source ownership remains preserved', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0, 'primary', 90, 1.0, ['obj-lower']);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0, 'primary', 90, 1.0, ['obj-upper']);

		const result = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		const cand = result.candidates[0];
		expect(cand.logicalObjectIds).toContain('obj-loop');
		expect(cand.logicalObjectIds).toContain('obj-lower');
		expect(cand.logicalObjectIds).toContain('obj-upper');
		expect(cand.materialIds).toContain(100);
		expect(cand.materialIds).toContain(200);
	});

	test('13. noise assignments cannot create primary envelopes', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0, 'noise', 20);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0, 'primary', 90);

		const result = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		expect(result.candidates[0].status).not.toBe('primary');
	});

	test('14. no final Room object is created', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0);

		const result = buildVerticalEnvelopeCandidates([loop], [lower, upper]);
		expect(result).toHaveProperty('candidates');
		expect(result).toHaveProperty('diagnostics');
		const cand = result.candidates[0];
		expect(cand).not.toHaveProperty('roomLabel');
		expect(cand).not.toHaveProperty('roomName');
		expect(cand).not.toHaveProperty('openings');
		expect(cand).not.toHaveProperty('isFinalRoom');
	});
});
