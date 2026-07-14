import { describe, test, expect } from 'bun:test';
import { parseRefinedVerticalEnvelopeCandidate, type CandidateParseResult } from './runtime-validation';
import type { RefinedVerticalEnvelopeCandidate } from './types';

function createValidCandidate(): RefinedVerticalEnvelopeCandidate {
	return {
		id: 'env:test:1',
		loopCandidateId: 'loop:test:1',
		storeyCandidateId: 'storey:test:1',
		lowerAssignmentId: 'assign:lower',
		upperAssignmentId: 'assign:upper',
		lowerHorizontalEvidenceId: 'horiz:lower',
		upperHorizontalEvidenceId: 'horiz:upper',
		logicalObjectIds: ['obj-1'],
		classificationUnitIds: ['unit-1'],
		materialIds: [100],
		lowerElevation: 0,
		upperElevation: 3.0,
		clearHeight: 3.0,
		loopArea: 20.0,
		estimatedVolume: 60.0,
		score: 90,
		status: 'primary',
		rawStatus: 'primary',
		refinedStatus: 'primary',
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
		},
		barrierSpanCoverage: 1.0,
		refinementReasons: [],
		verticalExtentProfile: {
			evidenceCount: 1,
			referencedEvidenceCount: 1,
			referencedEvidenceFound: 1,
			rejectedReferencedEvidence: 0,
			missingReferencedEvidenceIds: []
		} as any,
		eligibleForRoomAssembly: true,
		ineligibilityReasons: [],
		relativeBaseTolerance: 0.15,
		relativeTopTolerance: 0.30
	} as unknown as RefinedVerticalEnvelopeCandidate;
}

describe('Runtime Candidate Validation', () => {
	test('A. Valid eligible candidate', () => {
		const valid = createValidCandidate();
		// Serialize and parse to cross runtime boundary
		const json = JSON.stringify(valid);
		const unknownVal = JSON.parse(json);

		const result = parseRefinedVerticalEnvelopeCandidate(unknownVal);
		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.value.eligibleForRoomAssembly).toBeTrue();
			expect(result.value.id).toBe('env:test:1');
			expect(result.value.score).toBe(90);
		}
	});

	test('B. Valid ineligible candidate', () => {
		const ineligible = createValidCandidate();
		ineligible.eligibleForRoomAssembly = false;
		
		const json = JSON.stringify(ineligible);
		const unknownVal = JSON.parse(json);

		const result = parseRefinedVerticalEnvelopeCandidate(unknownVal);
		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.value.eligibleForRoomAssembly).toBeFalse();
		}
	});

	test('C. Missing eligibility', () => {
		const missing = createValidCandidate() as any;
		delete missing.eligibleForRoomAssembly;

		const json = JSON.stringify(missing);
		const unknownVal = JSON.parse(json);

		const result = parseRefinedVerticalEnvelopeCandidate(unknownVal);
		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe('missing_eligibility');
		}
	});

	test('D. Invalid eligibility types', () => {
		const types = [null, 'true', 1, 0, {}, []];
		
		for (const val of types) {
			const invalid = createValidCandidate() as any;
			invalid.eligibleForRoomAssembly = val;
			
			// Don't stringify undefined since it gets deleted in JSON
			const unknownVal = JSON.parse(JSON.stringify(invalid));
			
			const result = parseRefinedVerticalEnvelopeCandidate(unknownVal);
			expect(result.ok).toBeFalse();
			if (!result.ok) {
				expect(result.reason).toBe('invalid_eligibility_type');
			}
		}
	});

	test('E. Missing evidence', () => {
		const missingEv = createValidCandidate() as any;
		delete missingEv.logicalObjectIds;

		const unknownVal = JSON.parse(JSON.stringify(missingEv));
		const result = parseRefinedVerticalEnvelopeCandidate(unknownVal);
		
		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe('missing_source_evidence');
		}
	});

	test('F. Non-finite numeric data', () => {
		// Test direct validator call because JSON stringify transforms NaN/Infinity to null
		const invalid = createValidCandidate();
		invalid.score = NaN;

		let result = parseRefinedVerticalEnvelopeCandidate(invalid);
		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe('non_finite_score');
		}
		
		invalid.score = 90;
		invalid.clearHeight = Infinity;
		result = parseRefinedVerticalEnvelopeCandidate(invalid);
		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe('invalid_tolerance');
		}
	});

	test('G. Prototype-derived eligibility', () => {
		// Construct object where own property does not have eligibility
		const proto = { eligibleForRoomAssembly: true };
		const obj = Object.create(proto);
		Object.assign(obj, createValidCandidate());
		delete obj.eligibleForRoomAssembly;

		expect(obj.eligibleForRoomAssembly).toBeTrue(); // Prove prototype works

		const result = parseRefinedVerticalEnvelopeCandidate(obj);
		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe('prototype_pollution');
		}
	});

	test('H. Valid round trip', () => {
		const valid = createValidCandidate();
		const unknownVal = JSON.parse(JSON.stringify(valid));
		
		const result = parseRefinedVerticalEnvelopeCandidate(unknownVal);
		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.value).toEqual(valid);
		}
	});

	test('I. Mixed candidate collection processing (via room assembly filter)', () => {
		const valid = createValidCandidate();
		
		const validIneligible = createValidCandidate();
		validIneligible.eligibleForRoomAssembly = false;
		
		const missingEv = createValidCandidate() as any;
		delete missingEv.classificationUnitIds;

		const arr = JSON.parse(JSON.stringify([valid, validIneligible, missingEv]));
		
		let okCount = 0;
		let notOkCount = 0;
		
		for (const cand of arr) {
			const res = parseRefinedVerticalEnvelopeCandidate(cand);
			if (res.ok) {
				okCount++;
			} else {
				notOkCount++;
			}
		}
		
		expect(okCount).toBe(2);
		expect(notOkCount).toBe(1);
	});
});
