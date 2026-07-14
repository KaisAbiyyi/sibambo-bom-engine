import { describe, expect, test } from 'bun:test';
import { refineVerticalEnvelopeCandidates, buildVerticalEnvelopeCandidates } from './envelopes';
import { assembleRoomCandidates } from './candidates';
import type { RankedBoundaryLoopCandidate, LoopSurfaceAssignment, StoreyBandEvidence, VerticalBarrierEvidence } from './types';

describe('Downstream Refinement Integration Tests', () => {
	function createMockLoop(id: string): RankedBoundaryLoopCandidate {
		return {
			id,
			nodeIds: ['n1', 'n2', 'n3'],
			edgeIds: ['e1', 'e2', 'e3'],
			verticalEvidenceIds: ['barrierA', 'barrierB', 'barrierC', 'barrierD', 'barrierE'],
			area: 10,
			perimeter: 12,
			bounds: { min: { x: 0, z: 0 }, max: { x: 3, z: 3 } },
			materialIds: [100],
			status: 'primary',
			score: 90
		} as unknown as RankedBoundaryLoopCandidate;
	}

	function createMockAssignment(id: string, loopId: string, role: 'lower-support' | 'upper-cover', minZ: number, score = 90): LoopSurfaceAssignment {
		return {
			id,
			loopCandidateId: loopId,
			role,
			horizontalSurfaceId: 'surf1',
			elevation: minZ,
			loopCoverageRatio: 1.0,
			evidenceCoverageRatio: 1.0,
			sourceObjectIds: ['obj-assign'],
			materialIds: [200],
			qualityFlags: {
				approximateOverlap: false,
				elevationMismatch: false
			},
			status: 'primary',
			score
		} as unknown as LoopSurfaceAssignment;
	}

	function createMockBarrier(id: string, maxZ: number): VerticalBarrierEvidence {
		return {
			id,
			logicalObjectId: 'obj-barrier',
			classificationUnitIds: [],
			elevationRange: { min: 0, max: maxZ },
			segment: { start: { x: 0, z: 0 }, end: { x: 1, z: 0 } },
			materialIds: [300],
			thickness: 0.15,
			isExterior: false,
			quality: 1.0,
			isAmbiguous: false
		};
	}

	function createMockStorey(): StoreyBandEvidence {
		return {
			id: 'storey1',
			logicalObjectId: 'obj-storey',
			classificationUnitIds: [],
			elevationRange: { min: 0, max: 0.5 },
			planBounds: { min: { x: 0, z: 0 }, max: { x: 10, z: 10 } },
			materialIds: [400],
			quality: 1.0,
			isAmbiguous: false,
			status: 'primary',
			score: 90
		};
	}

	test('A. Low-score rejection propagation', () => {
		const loop = createMockLoop('loopA');
		const lower = createMockAssignment('lowerA', 'loopA', 'lower-support', 0.0, 20); // Low score
		const upper = createMockAssignment('upperA', 'loopA', 'upper-cover', 3.0, 20); // Low score
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		rawEnvs[0].score = 20; // Ensure low raw score

		const barrier = createMockBarrier('barrierA', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const cand = refinedResult.candidates[0];

		// Refinement rejects it
		expect(cand.refinedScore).toBeLessThan(30);
		expect(cand.eligibleForRoomAssembly).toBe(false);
		expect(cand.status).toBe('noise');

		// Downstream room assembly should not produce a room candidate
		const rooms = assembleRoomCandidates([loop], [], refinedResult.candidates, []);
		expect(rooms.candidates.length).toBe(0);
	});

	test('B. Salvaged-noise rejection', () => {
		const loop = createMockLoop('loopB');
		const lower = createMockAssignment('lowerB', 'loopB', 'lower-support', 0.0);
		const upper = createMockAssignment('upperB', 'loopB', 'upper-cover', 0.5); // Short span
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		rawEnvs[0].status = 'noise'; // Simulating salvaged noise
		
		const barrier = createMockBarrier('barrierB', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		
		const cand = refinedResult.candidates[0];

		// Because it was noise, it remains noise and is excluded downstream
		expect(cand.status).toBe('noise');

		// Downstream room assembly should ignore it completely
		const rooms = assembleRoomCandidates([loop], [], refinedResult.candidates, []);
		expect(rooms.candidates.length).toBe(0);
	});

	test('C. Valid-envelope preservation', () => {
		const loop = createMockLoop('loopC');
		const lower = createMockAssignment('lowerC', 'loopC', 'lower-support', 0.0, 90);
		const upper = createMockAssignment('upperC', 'loopC', 'upper-cover', 3.0, 90);
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const barrier = createMockBarrier('barrierC', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		
		const cand = refinedResult.candidates[0];
		expect(cand.refinedScore).toBeGreaterThanOrEqual(30);
		expect(cand.eligibleForRoomAssembly).toBe(true);
		expect(cand.status).not.toBe('noise');

		// Tolerances should be valid (e.g. 0.15 base and 0.3 top for 3.0m span)
		expect(cand.relativeBaseTolerance).toBeGreaterThan(0);
		expect(cand.relativeTopTolerance).toBeGreaterThan(0);

		const rooms = assembleRoomCandidates([loop], [], refinedResult.candidates, []);
		if (rooms.candidates.length === 0) {
			console.log('Test C failed. Diagnostics:', rooms.diagnostics);
			console.log('loop.id:', loop.id);
			console.log('refinedResult.candidates:', JSON.stringify(refinedResult.candidates, null, 2));
		}
		expect(rooms.candidates.length).toBe(1);
		
		// The active envelope logic should be the same
		expect(rooms.candidates[0].clearHeight).toBeCloseTo(3.0, 5);
	});

	test('D. Scale invariance', () => {
		// Test at 10x scale
		const scale = 10.0;
		const loop = createMockLoop('loopD');
		loop.area *= scale * scale;
		loop.perimeter *= scale;
		
		const lower = createMockAssignment('lowerD', 'loopD', 'lower-support', 0.0);
		const upper = createMockAssignment('upperD', 'loopD', 'upper-cover', 3.0 * scale);
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const barrier = createMockBarrier('barrierD', 3.0 * scale);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const cand = refinedResult.candidates[0];
		
		// Base alignment is max(0.05, 0.05 * span). Capped at 0.15
		// For 30m span, 0.05 * 30 = 1.5, capped at 0.15.
		expect(cand.relativeBaseTolerance).toBe(0.15);
		
		// Top alignment is max(0.05, 0.10 * span). Capped at 0.30
		// For 30m span, 0.10 * 30 = 3.0, capped at 0.30.
		expect(cand.relativeTopTolerance).toBe(0.30);
		
		// Scaled candidate remains eligible
		expect(cand.eligibleForRoomAssembly).toBe(true);
	});

	test('E. Evidence contract propagation', () => {
		const loop = createMockLoop('loopE');
		const lower = createMockAssignment('lowerE', 'loopE', 'lower-support', 0.0);
		const upper = createMockAssignment('upperE', 'loopE', 'upper-cover', 3.0);
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const barrier = createMockBarrier('barrierE', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const cand = refinedResult.candidates[0];

		// Check the exact source-evidence fields
		expect(cand.verticalExtentProfile).toBeDefined();
		expect(cand.verticalExtentProfile.evidenceCount).toBeGreaterThanOrEqual(0);
		expect(cand.verticalExtentProfile.referencedEvidenceCount).toBeDefined();
		expect(cand.verticalExtentProfile.referencedEvidenceFound).toBeDefined();
		expect(cand.verticalExtentProfile.rejectedReferencedEvidence).toBeDefined();
		expect(cand.verticalExtentProfile.missingReferencedEvidenceIds).toBeDefined();
		
		expect(cand.ineligibilityReasons).toBeInstanceOf(Array);
		expect(typeof cand.eligibleForRoomAssembly).toBe('boolean');
	});

	test('F. Missing eligibility rejected', () => {
		const loop = createMockLoop('loopF');
		const lower = createMockAssignment('lowerF', 'loopF', 'lower-support', 0.0);
		const upper = createMockAssignment('upperF', 'loopF', 'upper-cover', 3.0);
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const barrier = createMockBarrier('barrierF', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const cand = refinedResult.candidates[0] as any;
		
		// Remove eligibility explicitly
		delete cand.eligibleForRoomAssembly;
		
		const rooms = assembleRoomCandidates([loop], [], [cand], []);
		expect(rooms.candidates.length).toBe(0);
	});

	test('G. Status cannot override eligibility (false eligibility, primary status)', () => {
		const loop = createMockLoop('loopG');
		const lower = createMockAssignment('lowerG', 'loopG', 'lower-support', 0.0);
		const upper = createMockAssignment('upperG', 'loopG', 'upper-cover', 3.0);
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const barrier = createMockBarrier('barrierG', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const cand = refinedResult.candidates[0];
		
		cand.status = 'primary';
		cand.eligibleForRoomAssembly = false;
		
		const rooms = assembleRoomCandidates([loop], [], [cand], []);
		expect(rooms.candidates.length).toBe(0);
	});

	test('H. Eligibility cannot override invalid status (true eligibility, noise status)', () => {
		const loop = createMockLoop('loopH');
		const lower = createMockAssignment('lowerH', 'loopH', 'lower-support', 0.0);
		const upper = createMockAssignment('upperH', 'loopH', 'upper-cover', 3.0);
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const barrier = createMockBarrier('barrierH', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		const cand = refinedResult.candidates[0];
		
		cand.status = 'noise';
		cand.eligibleForRoomAssembly = true;
		
		const rooms = assembleRoomCandidates([loop], [], [cand], []);
		expect(rooms.candidates.length).toBe(0);
	});

	test('I. Serialization preservation', () => {
		const loop = createMockLoop('loopI');
		const lower = createMockAssignment('lowerI', 'loopI', 'lower-support', 0.0);
		const upper = createMockAssignment('upperI', 'loopI', 'upper-cover', 3.0);
		
		const rawEnvs = buildVerticalEnvelopeCandidates([loop], [lower, upper]).candidates;
		const barrier = createMockBarrier('barrierI', 3.0);
		const storey = createMockStorey();

		const refinedResult = refineVerticalEnvelopeCandidates(rawEnvs, [loop], [barrier], [storey]);
		
		const validCand = refinedResult.candidates[0];
		validCand.eligibleForRoomAssembly = true;
		
		const invalidCand = { ...validCand, id: 'invalid', eligibleForRoomAssembly: false };
		const missingCand = { ...validCand, id: 'missing' } as any;
		delete missingCand.eligibleForRoomAssembly;

		// Serialize and deserialize
		const json = JSON.stringify([validCand, invalidCand, missingCand]);
		const parsed = JSON.parse(json);

		expect(parsed[0].eligibleForRoomAssembly).toBe(true);
		expect(parsed[1].eligibleForRoomAssembly).toBe(false);
		expect(parsed[2].eligibleForRoomAssembly).toBeUndefined();
	});
});
