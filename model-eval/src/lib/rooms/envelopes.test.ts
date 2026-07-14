import { describe, test, expect } from 'bun:test';
import {
	buildVerticalEnvelopeCandidates,
	calculateVerticalEnvelopeCandidateFingerprint,
	refineVerticalEnvelopeCandidates
} from './envelopes';
import type {
	RankedBoundaryLoopCandidate,
	LoopSurfaceAssignment,
	RankedLoopSurfaceAssignment,
	VerticalBarrierEvidence,
	StoreyBandEvidence
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

describe('refineVerticalEnvelopeCandidates tests', () => {
	function createMockBarrier(
		id: string,
		minZ: number,
		maxZ: number,
		len = 1.0,
		quality = 1.0
	): VerticalBarrierEvidence {
		return {
			id,
			logicalObjectId: 'obj-barrier',
			classificationUnitIds: ['unit-barrier'],
			elevationRange: { min: minZ, max: maxZ },
			segment: { start: { x: 0, z: 0 }, end: { x: len, z: 0 } },
			materialIds: [300],
			thickness: 0.15,
			isExterior: false,
			quality,
			isAmbiguous: false
		};
	}

	function createMockStorey(id: string, minZ: number, maxZ: number): StoreyBandEvidence {
		return {
			id,
			logicalObjectId: 'obj-storey',
			classificationUnitIds: ['unit-storey'],
			elevationRange: { min: minZ, max: maxZ },
			planBounds: { min: { x: 0, z: 0 }, max: { x: 10, z: 10 } },
			materialIds: [400],
			quality: 1.0,
			isAmbiguous: false,
			status: 'primary',
			score: 90
		};
	}

	test('1. fallback to raw when no barriers are present', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0);
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const storey = createMockStorey('storey:test', 0.0, 0.5);

		const result = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [], [storey]);
		expect(result.diagnostics.loopsWithInsufficientEvidence).toBe(1);
		expect(result.candidates[0].refinedScore).toBe(rawEnvs[0].score);
		expect(result.candidates[0].refinementReasons).toContain('insufficient-evidence');
	});

	test('2. barrier span coverage penalty applies for short envelopes', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 0.8);
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const storey = createMockStorey('storey:test', 0.0, 0.5);
		const barrier = createMockBarrier('v1', 0.0, 3.0); // Robust span = 3.0m

		const result = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const candidate = result.candidates[0];
		expect(candidate.barrierSpanCoverage).toBeCloseTo(0.8 / 3.0, 3);
		expect(candidate.refinementReasons.some((r) => r.startsWith('insufficient-span-coverage'))).toBe(true);
		expect(candidate.refinedScore).toBeLessThan(rawEnvs[0].score);
	});

	test('3. alignment bonuses/penalties apply correctly', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.5); // displaced base
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 2.4); // displaced top
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const storey = createMockStorey('storey:test', 0.0, 0.5);
		const barrier = createMockBarrier('v1', 0.0, 3.0); // Robust span = 3.0m

		const result = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const candidate = result.candidates[0];
		expect(candidate.baseAlignment).toBeCloseTo(0.5, 5);
		expect(candidate.topAlignment).toBeCloseTo(0.6, 5);
		expect(candidate.refinementReasons.some((r) => r.startsWith('base-displaced'))).toBe(true);
		expect(candidate.refinementReasons.some((r) => r.startsWith('top-displaced'))).toBe(true);
	});

	test('4. weak upper support penalty applies', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper = createMockAssignment('upper1', 'loop1', 'upper-cover', 3.0, 'primary', 90, 1.0);
		upper.evidenceCoverageRatio = 0.4; // Triggers weakUpperCover = true
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const storey = createMockStorey('storey:test', 0.0, 0.5);
		const barrier = createMockBarrier('v1', 0.0, 3.0);

		const result = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		expect(result.candidates[0].refinementReasons).toContain('weak-upper-support');
		expect(result.candidates[0].refinedScore).toBeLessThan(rawEnvs[0].score);
	});

	test('5. barrier-aligned outranks short envelope', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		// Set upperShort score very high and upperTall score low so raw short envelope outranks tall one.
		const upperShort = createMockAssignment('upperShort', 'loop1', 'upper-cover', 0.8, 'primary', 120);
		const upperTall = createMockAssignment('upperTall', 'loop1', 'upper-cover', 3.0, 'primary', 60);

		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upperShort, upperTall]).candidates;

		const storey = createMockStorey('storey:test', 0.0, 0.5);
		const barrier = createMockBarrier('v1', 0.0, 3.0); // robust span = 3.0

		const result = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		
		const best = result.candidates.find(c => c.refinedRank === 1);
		expect(best).toBeDefined();
		expect(best!.clearHeight).toBe(3.0);
	});

	test('6. shuffled inputs produce identical results', () => {
		const loop = createMockLoop('loop1');
		const lower = createMockAssignment('lower1', 'loop1', 'lower-support', 0.0);
		const upper1 = createMockAssignment('upper1', 'loop1', 'upper-cover', 0.8);
		const upper2 = createMockAssignment('upper2', 'loop1', 'upper-cover', 3.0);
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper1, upper2]).candidates;
		const storey = createMockStorey('storey:test', 0.0, 0.5);
		const barrier1 = createMockBarrier('v1', 0.0, 3.0);
		const barrier2 = createMockBarrier('v2', 0.0, 3.0);

		const res1 = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier1, barrier2], [storey]);
		const res2 = refineVerticalEnvelopeCandidates([rawEnvs[1], rawEnvs[0]], [loop], [barrier2, barrier1], [storey]);

		expect(res1.diagnostics.refinementFingerprint).toBe(res2.diagnostics.refinementFingerprint);
	});
});
