import { describe, test, expect } from 'bun:test';
import { assembleRoomCandidates, calculateRoomCandidateFingerprint } from './candidates';
import type {
	RankedBoundaryLoopCandidate,
	VerticalEnvelopeCandidate,
	RoomCandidate
} from './types';

function createMockLoop(
	id: string,
	status: 'primary' | 'secondary' | 'noise' = 'primary',
	score = 90,
	area = 20.0,
	perimeter = 18.0
): RankedBoundaryLoopCandidate {
	return {
		id,
		storeyCandidateId: 'storey:test',
		connectedComponentIndex: 0,
		nodeIds: ['n1', 'n2', 'n3', 'n4'],
		edgeIds: ['e1', 'e2', 'e3', 'e4'],
		verticalEvidenceIds: ['v1'],
		sourceEvidenceIds: ['source:loop'],
		logicalObjectIds: ['obj-loop'],
		classificationUnitIds: ['unit-loop'],
		materialIds: [100],
		signedArea: area,
		absoluteArea: area,
		area,
		perimeter,
		planBounds: { min: { x: 0, z: 0 }, max: { x: 5, z: 4 } },
		bounds: { min: { x: 0, z: 0 }, max: { x: 5, z: 4 } },
		compactness: 0.8,
		boundsAspectRatio: 1.25,
		edgeCount: 4,
		uniqueSourceObjectCount: 1,
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
		score,
		status
	};
}

function createMockEnvelope(
	id: string,
	loopCandidateId: string,
	status: 'primary' | 'secondary' | 'noise' = 'primary',
	score = 90,
	clearHeight = 3.0,
	loopArea = 20.0
): VerticalEnvelopeCandidate {
	return {
		id,
		loopCandidateId,
		storeyCandidateId: 'storey:test',
		lowerAssignmentId: 'assign:lower',
		upperAssignmentId: 'assign:upper',
		lowerHorizontalEvidenceId: 'horiz:lower',
		upperHorizontalEvidenceId: 'horiz:upper',
		logicalObjectIds: ['obj-env'],
		classificationUnitIds: ['unit-env'],
		materialIds: [200],
		lowerElevation: 0,
		upperElevation: clearHeight,
		clearHeight,
		loopArea,
		estimatedVolume: loopArea * clearHeight,
		score,
		status,
		rank: 1,
		qualityFlags: {

			missingLower: false,
			missingUpper: false,
			nonPositiveHeight: false,
			unusuallyLowHeight: false,
			unusuallyHighHeight: false,
			approximateOverlap: false,
			multipleEnvelopeCandidates: false,
			weakLowerSupport: false,
			weakUpperCover: false,
			geometricallyPlausible: true
		}
	};
}


describe('assembleRoomCandidates synthetic tests', () => {
	test('1. primary loop plus primary envelope creates one candidate', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env]);

		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].id).toBe('room:loop-1:env-1');
		expect(result.candidates[0].status).toBe('primary');
		expect(result.diagnostics.primaryRoomCandidates).toBe(1);
	});

	test('2. noise loop creates no candidate', () => {
		const loop = createMockLoop('loop-noise', 'noise', 20, 25, 20);
		const env = createMockEnvelope('env-1', 'loop-noise', 'primary', 90, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env]);

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics.noiseLoopsSkipped).toBe(1);
	});

	test('3. noise envelope creates no candidate', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env = createMockEnvelope('env-noise', 'loop-1', 'noise', 20, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env]);

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics.loopsWithoutValidEnvelopes).toBe(1);
	});

	test('4. best primary envelope is selected deterministically', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env1 = createMockEnvelope('env-A', 'loop-1', 'primary', 70, 3.0, 25);
		const env2 = createMockEnvelope('env-B', 'loop-1', 'primary', 95, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env1, env2]);

		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].selectedEnvelopeId).toBe('env-B');
		expect(result.candidates[0].status).toBe('primary');
	});

	test('5. tied primary envelopes mark ambiguity', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env1 = createMockEnvelope('env-A', 'loop-1', 'primary', 90, 3.0, 25);
		const env2 = createMockEnvelope('env-B', 'loop-1', 'primary', 90, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env1, env2]);

		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].status).toBe('ambiguous');
		expect(result.candidates[0].qualityFlags.isAmbiguousEnvelope).toBeTrue();
		expect(result.diagnostics.ambiguousRoomCandidates).toBe(1);
	});

	test('6. alternatives are preserved', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env1 = createMockEnvelope('env-A', 'loop-1', 'primary', 95, 3.0, 25);
		const env2 = createMockEnvelope('env-B', 'loop-1', 'primary', 80, 3.0, 25);
		const env3 = createMockEnvelope('env-C', 'loop-1', 'secondary', 70, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env1, env2, env3]);

		expect(result.candidates[0].selectedEnvelopeId).toBe('env-A');
		expect(result.candidates[0].alternativeEnvelopeIds).toEqual(['env-B', 'env-C']);
		expect(result.candidates[0].qualityFlags.hasAlternativeEnvelopes).toBeTrue();
		expect(result.diagnostics.alternativeEnvelopesPreserved).toBe(2);
	});

	test('7. secondary fallback creates a secondary candidate', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const envSec = createMockEnvelope('env-sec', 'loop-1', 'secondary', 80, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [envSec]);

		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].selectedEnvelopeId).toBe('env-sec');
		expect(result.candidates[0].status).toBe('secondary');
		expect(result.candidates[0].qualityFlags.isSecondaryFallback).toBeTrue();
		expect(result.diagnostics.secondaryRoomCandidates).toBe(1);
	});

	test('8. missing valid envelope creates no candidate', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const result = assembleRoomCandidates([loop], [], []);

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics.loopsWithoutValidEnvelopes).toBe(1);
	});

	test('9. non-positive area is rejected', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 0, 0);
		const env = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 3.0, 0);
		const result = assembleRoomCandidates([loop], [], [env]);

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics.invalidAreaCandidatesRejected).toBe(1);
	});

	test('10. non-positive height is rejected', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 0, 25);
		const result = assembleRoomCandidates([loop], [], [env]);

		expect(result.candidates).toHaveLength(0);
		expect(result.diagnostics.invalidHeightCandidatesRejected).toBe(1);
	});

	test('11. area, height, and volume are preserved', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 24.5, 20);
		const env = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 2.8, 24.5);
		const result = assembleRoomCandidates([loop], [], [env]);

		const candidate = result.candidates[0];
		expect(candidate.planArea).toBe(24.5);
		expect(candidate.clearHeight).toBe(2.8);
		expect(candidate.estimatedVolume).toBe(Number((24.5 * 2.8).toFixed(6)));
	});

	test('12. source ownership and materials remain preserved', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env]);

		const candidate = result.candidates[0];
		expect(candidate.logicalObjectIds).toContain('obj-loop');
		expect(candidate.logicalObjectIds).toContain('obj-env');
		expect(candidate.classificationUnitIds).toContain('unit-loop');
		expect(candidate.classificationUnitIds).toContain('unit-env');
		expect(candidate.materialIds).toEqual([100, 200]);
	});

	test('13. shuffled input produces identical output', () => {
		const l1 = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const l2 = createMockLoop('loop-2', 'primary', 85, 30, 22);
		const e1 = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 3.0, 25);
		const e2 = createMockEnvelope('env-2', 'loop-2', 'primary', 85, 3.0, 30);

		const resA = assembleRoomCandidates([l1, l2], [], [e1, e2]);
		const resB = assembleRoomCandidates([l2, l1], [], [e2, e1]);

		expect(resA.candidates).toEqual(resB.candidates);
		expect(resA.diagnostics.fingerprint).toBe(resB.diagnostics.fingerprint);
	});

	test('14. repeated execution produces identical IDs and fingerprint', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 3.0, 25);

		const res1 = assembleRoomCandidates([loop], [], [env]);
		const res2 = assembleRoomCandidates([loop], [], [env]);

		expect(res1.candidates[0].id).toBe(res2.candidates[0].id);
		expect(res1.diagnostics.fingerprint).toBe(res2.diagnostics.fingerprint);
	});

	test('15. no semantic room label or purpose is created', () => {
		const loop = createMockLoop('loop-1', 'primary', 90, 25, 20);
		const env = createMockEnvelope('env-1', 'loop-1', 'primary', 90, 3.0, 25);
		const result = assembleRoomCandidates([loop], [], [env]);

		const candidate = result.candidates[0] as any;
		expect(candidate.roomName).toBeUndefined();
		expect(candidate.name).toBeUndefined();
		expect(candidate.purpose).toBeUndefined();
		expect(candidate.function).toBeUndefined();
		expect(candidate.label).toBeUndefined();
		expect(candidate.roomType).toBeUndefined();
		expect(candidate.semanticType).toBeUndefined();
		expect(candidate.id).toMatch(/^room:/);
	});
});
