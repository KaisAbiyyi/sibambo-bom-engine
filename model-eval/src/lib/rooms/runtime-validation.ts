import type { RefinedVerticalEnvelopeCandidate, RefinedCandidateValidationReason } from './types';

export type CandidateParseResult =
	| { ok: true; value: RefinedVerticalEnvelopeCandidate }
	| { ok: false; reason: RefinedCandidateValidationReason; issues: string[] };

function isObject(val: unknown): val is Record<string, unknown> {
	return typeof val === 'object' && val !== null;
}

export function parseRefinedVerticalEnvelopeCandidate(value: unknown): CandidateParseResult {
	if (!isObject(value) || Array.isArray(value)) {
		return { ok: false, reason: 'invalid_candidate_shape', issues: ['Candidate is not an object'] };
	}

	// 1. Eligibility Check (must fail closed)
	if (!Object.prototype.hasOwnProperty.call(value, 'eligibleForRoomAssembly')) {
		if ('eligibleForRoomAssembly' in value) {
			return { ok: false, reason: 'prototype_pollution', issues: ['eligibleForRoomAssembly is inherited from prototype'] };
		}
		return { ok: false, reason: 'missing_eligibility', issues: ['eligibleForRoomAssembly is missing'] };
	}
	
	if (typeof value.eligibleForRoomAssembly !== 'boolean') {
		return { ok: false, reason: 'invalid_eligibility_type', issues: ['eligibleForRoomAssembly must be a boolean'] };
	}

	// 2. Identity and Base Shape
	if (typeof value.id !== 'string' || typeof value.loopCandidateId !== 'string') {
		return { ok: false, reason: 'invalid_candidate_shape', issues: ['Missing or invalid identity fields'] };
	}

	// 3. Status
	if (value.status !== 'primary' && value.status !== 'secondary' && value.status !== 'noise') {
		return { ok: false, reason: 'invalid_status', issues: [`Invalid status: ${String(value.status)}`] };
	}

	// 4. Score
	if (typeof value.score !== 'number' || !Number.isFinite(value.score)) {
		return { ok: false, reason: 'non_finite_score', issues: ['Score must be a finite number'] };
	}

	// 5. Source Evidence arrays
	const requiredArrays = ['logicalObjectIds', 'classificationUnitIds', 'materialIds'];
	for (const key of requiredArrays) {
		if (!Array.isArray(value[key])) {
			return { ok: false, reason: 'missing_source_evidence', issues: [`Missing array: ${key}`] };
		}
	}

	// 6. Source Evidence identifiers
	if (typeof value.lowerAssignmentId !== 'string' || typeof value.upperAssignmentId !== 'string') {
		return { ok: false, reason: 'missing_source_evidence', issues: ['Missing lower/upper assignment references'] };
	}

	// 7. Tolerances and numeric parameters
	const numericParams = ['clearHeight', 'loopArea', 'estimatedVolume', 'relativeBaseTolerance', 'relativeTopTolerance'];
	for (const key of numericParams) {
		const val = value[key];
		if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val))) {
			return { ok: false, reason: 'invalid_tolerance', issues: [`${key} must be a finite number`] };
		}
	}

	// 8. nested evidence objects: verticalExtentProfile
	if (!isObject(value.verticalExtentProfile)) {
		return { ok: false, reason: 'invalid_source_evidence_shape', issues: ['Missing verticalExtentProfile'] };
	}
	
	const vep = value.verticalExtentProfile;
	if (typeof vep.evidenceCount !== 'number' || typeof vep.referencedEvidenceCount !== 'number' || !Array.isArray(vep.missingReferencedEvidenceIds)) {
		return { ok: false, reason: 'invalid_source_evidence_shape', issues: ['Invalid verticalExtentProfile shape'] };
	}

	return { ok: true, value: value as unknown as RefinedVerticalEnvelopeCandidate };
}
