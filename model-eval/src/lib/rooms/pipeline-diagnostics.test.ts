import { describe, expect, test } from 'bun:test';
import { assembleRoomCandidates, mergeRoomCandidateResults } from './candidates';
import { serializeRoomAnalysis, parsePersistedRoomAnalysisJson } from './room-analysis-schema';
import type { RankedBoundaryLoopCandidate, VerticalEnvelopeCandidate, LoopSurfaceAssignment } from './types';

describe('Pipeline Diagnostics', () => {
	const mockLoop: RankedBoundaryLoopCandidate = {
		id: 'loop1',
		storeyCandidateId: 's1',
		status: 'primary',
		score: 100,
		perimeterMetrics: { totalPerimeter: 10, validBarrierPerimeter: 10 },
		areaM2: 25,
		bounds: { minX: 0, maxX: 5, minZ: 0, maxZ: 5 },
		edgeIds: [],
		sourceIds: []
	};

	const mockAssignment: LoopSurfaceAssignment = {
		id: 'assign1',
		loopCandidateId: 'loop1',
		role: 'lower',
		elevation: 0,
		evidenceCoverageRatio: 1,
		loopCoverageRatio: 1,
		isApproximate: false,
		sourceIds: [],
		materialIds: []
	};

	const baseEnvelope = {
		id: 'env1',
		loopCandidateId: 'loop1',
		logicalObjectIds: [],
		classificationUnitIds: [],
		materialIds: [],
		score: 100,
		status: 'primary',
		qualityFlags: {},
		sourceEvidenceIds: ['ev1'],
		lowerAssignmentId: 'assign1',
		upperAssignmentId: 'assign2',
		verticalExtentProfile: { 
			robustBase: 0, robustTop: 3, robustSpan: 3, rawBase: 0, rawTop: 3,
			evidenceCount: 1, referencedEvidenceCount: 1, missingReferencedEvidenceIds: []
		},
		ineligibilityReasons: [],
		relativeBaseTolerance: 0.1,
		relativeTopTolerance: 0.1,
		rawScore: 100,
		rawStatus: 'primary',
		refinedScore: 100,
		refinedStatus: 'primary',
		refinedRank: 1,
		baseAlignment: 0,
		topAlignment: 3,
		barrierSpanCoverage: 1,
		clearHeight: 3,
		loopArea: 25
	} as any;

	function createEnv(id: string, overrides: any = {}): VerticalEnvelopeCandidate {
		return { ...baseEnvelope, id, ...overrides };
	}

	test('A. Clean pipeline', () => {
		const env = createEnv('clean1', { eligibleForRoomAssembly: true });
		const result = assembleRoomCandidates([mockLoop], [mockAssignment], [env]);

		expect(result.diagnostics.envelopeValidation.inspected).toBe(1);
		expect(result.diagnostics.envelopeValidation.valid).toBe(1);
		expect(result.diagnostics.envelopeValidation.quarantined).toBe(0);
		expect(result.diagnostics.hasQuarantinedEnvelopeInputs).toBe(false);
		expect(Object.keys(result.diagnostics.envelopeValidation.reasons).length).toBe(0);
		expect(result.candidates.length).toBe(1); // the candidate is returned
	});

	test('B. Valid ineligible candidate', () => {
		const env1 = createEnv('clean1', { eligibleForRoomAssembly: true });
		const env2 = createEnv('clean2', { eligibleForRoomAssembly: false });
		const result = assembleRoomCandidates([mockLoop], [mockAssignment], [env1, env2]);

		expect(result.diagnostics.envelopeValidation.valid).toBe(2);
		expect(result.diagnostics.envelopeValidation.eligible).toBe(1);
		expect(result.diagnostics.envelopeValidation.ineligible).toBe(1);
		expect(result.diagnostics.envelopeValidation.quarantined).toBe(0);
		expect(result.diagnostics.hasQuarantinedEnvelopeInputs).toBe(false);
	});

	test('C. Malformed candidate', () => {
		const env1 = createEnv('clean1', { eligibleForRoomAssembly: true });
		const env2 = createEnv('clean2'); // missing eligibility entirely
		const result = assembleRoomCandidates([mockLoop], [mockAssignment], [env1, env2]);

		expect(result.diagnostics.envelopeValidation.inspected).toBe(2);
		expect(result.diagnostics.envelopeValidation.valid).toBe(1);
		expect(result.diagnostics.envelopeValidation.quarantined).toBe(1);
		expect(result.diagnostics.envelopeValidation.reasons['missing_eligibility']).toBe(1);
		expect(result.diagnostics.hasQuarantinedEnvelopeInputs).toBe(true);
		expect(result.candidates.length).toBe(1); // env1 still processes successfully
	});

	test('D. Multiple malformed reasons', () => {
		const env1 = createEnv('clean1', { eligibleForRoomAssembly: 'not_boolean' });
		const env2 = createEnv('clean2'); // missing eligibility
		const result = assembleRoomCandidates([mockLoop], [mockAssignment], [env1, env2]);

		expect(result.diagnostics.envelopeValidation.quarantined).toBe(2);
		expect(result.diagnostics.envelopeValidation.reasons['missing_eligibility']).toBe(1);
		expect(result.diagnostics.envelopeValidation.reasons['invalid_eligibility_type']).toBe(1);
		expect(Object.keys(result.diagnostics.envelopeValidation.reasons).length).toBe(2);
	});

	test('E. Aggregation across groups or storeys', () => {
		const envA = createEnv('cleanA'); // missing eligibility -> 1 missing
		const resA = assembleRoomCandidates([mockLoop], [mockAssignment], [envA]);
		
		const envB = createEnv('cleanB', { eligibleForRoomAssembly: true, score: NaN }); // non_finite_score
		const resB = assembleRoomCandidates([mockLoop], [mockAssignment], [envB]);

		const merged = mergeRoomCandidateResults([resA, resB]);

		expect(merged.diagnostics.envelopeValidation.quarantined).toBe(2);
		expect(merged.diagnostics.envelopeValidation.reasons['missing_eligibility']).toBe(1);
		expect(merged.diagnostics.envelopeValidation.reasons['non_finite_score']).toBe(1);
		expect(merged.diagnostics.hasQuarantinedEnvelopeInputs).toBe(true);
	});

	test('F. Serialization round trip (versioned)', () => {
		const env1 = createEnv('clean1', { eligibleForRoomAssembly: true });
		const env2 = createEnv('clean2'); // missing eligibility
		const res = assembleRoomCandidates([mockLoop], [mockAssignment], [env1, env2]);

		// Use the versioned serializer — not a direct JSON.stringify + unsafe cast
		const json = serializeRoomAnalysis({ candidates: res.candidates, traces: [], diagnostics: res.diagnostics, dataQuality: 'degraded' });
		const parsed = parsePersistedRoomAnalysisJson(json);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error('Expected ok');
		const diag = parsed.value.payload.diagnostics;
		expect(diag?.envelopeValidation.quarantined).toBe(1);
		expect(diag?.envelopeValidation.reasons['missing_eligibility']).toBe(1);
		expect(diag?.hasQuarantinedEnvelopeInputs).toBe(true);
		expect(parsed.value.payload.dataQuality).toBe('degraded');
	});

	test('G. Geometry regression', () => {
		// Verify that diagnostics logic does not break standard room candidate formation
		const env = createEnv('clean1', { eligibleForRoomAssembly: true });
		const res1 = assembleRoomCandidates([mockLoop], [mockAssignment], [env]);
		expect(res1.candidates.length).toBe(1);
		expect(res1.candidates[0].id).toBeDefined();
		expect(res1.candidates[0].envelopeCandidateId).toBe('clean1');
	});

	test('H. No false quarantine', () => {
		// Valid, just explicitly ineligible
		const env = createEnv('clean1', { eligibleForRoomAssembly: false });
		const res = assembleRoomCandidates([mockLoop], [mockAssignment], [env]);

		expect(res.diagnostics.envelopeValidation.ineligible).toBe(1);
		expect(res.diagnostics.envelopeValidation.quarantined).toBe(0);
		expect(Object.keys(res.diagnostics.envelopeValidation.reasons).length).toBe(0);
		expect(res.diagnostics.hasQuarantinedEnvelopeInputs).toBe(false);
	});
});
