import { describe, expect, test } from 'bun:test';
import {
	parsePersistedRoomAnalysis,
	parsePersistedRoomAnalysisJson,
	serializeRoomAnalysis,
	compatibilityMessage,
	ROOM_ANALYSIS_SCHEMA,
	ROOM_ANALYSIS_CURRENT_VERSION,
	type PersistedRoomAnalysisPayload,
	type PersistedAnalysisCompatibilityReason
} from './room-analysis-schema';
import type { RoomCandidate, RoomCandidateDiagnostics } from './types';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeCleanDiagnostics(overrides: Partial<RoomCandidateDiagnostics> = {}): RoomCandidateDiagnostics {
	return {
		loopsInspected: 1,
		noiseLoopsSkipped: 0,
		primaryRoomCandidates: 1,
		secondaryRoomCandidates: 0,
		ambiguousRoomCandidates: 0,
		loopsWithoutValidEnvelopes: 0,
		invalidAreaCandidatesRejected: 0,
		invalidHeightCandidatesRejected: 0,
		alternativeEnvelopesPreserved: 0,
		totalCandidateArea: 25,
		totalEstimatedVolume: 75,
		envelopeValidation: {
			inspected: 1,
			valid: 1,
			eligible: 1,
			ineligible: 0,
			quarantined: 0,
			reasons: {}
		},
		hasQuarantinedEnvelopeInputs: false,
		fingerprint: '1:abc12345',
		...overrides
	};
}

function makeCleanPayload(overrides: Partial<PersistedRoomAnalysisPayload> = {}): PersistedRoomAnalysisPayload {
	return {
		candidates: [],
		traces: [],
		diagnostics: makeCleanDiagnostics(),
		dataQuality: 'complete',
		...overrides
	};
}

function makeV1Doc(payload: PersistedRoomAnalysisPayload, extra: Record<string, unknown> = {}) {
	return {
		schema: ROOM_ANALYSIS_SCHEMA,
		version: ROOM_ANALYSIS_CURRENT_VERSION,
		generatedAt: '2026-01-01T00:00:00.000Z',
		payload,
		...extra
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Room Analysis Schema Versioning', () => {

	// ─── A. Current-version round trip ────────────────────────────────────

	test('A. Clean current-version round trip', () => {
		const payload = makeCleanPayload();
		const json = serializeRoomAnalysis(payload);
		const result = parsePersistedRoomAnalysisJson(json);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected ok');

		expect(result.value.schema).toBe(ROOM_ANALYSIS_SCHEMA);
		expect(result.value.version).toBe(ROOM_ANALYSIS_CURRENT_VERSION);
		expect(result.value.payload.candidates).toEqual([]);
		expect(result.value.payload.dataQuality).toBe('complete');
		expect(result.value.payload.diagnostics?.envelopeValidation.inspected).toBe(1);
		expect(result.value.payload.diagnostics?.envelopeValidation.valid).toBe(1);
		expect(result.value.payload.diagnostics?.envelopeValidation.quarantined).toBe(0);
	});

	// ─── B. Degraded current-version round trip ───────────────────────────

	test('B. Degraded current-version round trip', () => {
		const payload = makeCleanPayload({
			dataQuality: 'degraded',
			diagnostics: makeCleanDiagnostics({
				envelopeValidation: {
					inspected: 3,
					valid: 2,
					eligible: 1,
					ineligible: 1,
					quarantined: 1,
					reasons: { missing_eligibility: 1 }
				},
				hasQuarantinedEnvelopeInputs: true
			})
		});

		const json = serializeRoomAnalysis(payload);
		const result = parsePersistedRoomAnalysisJson(json);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('Expected ok');

		const ev = result.value.payload.diagnostics!.envelopeValidation;
		expect(ev.inspected).toBe(3);
		expect(ev.quarantined).toBe(1);
		expect(ev.reasons.missing_eligibility).toBe(1);
		expect(result.value.payload.dataQuality).toBe('degraded');
		expect(result.value.payload.diagnostics!.hasQuarantinedEnvelopeInputs).toBe(true);
	});

	// ─── C. Missing schema ────────────────────────────────────────────────

	test('C. Missing schema field', () => {
		const doc = { version: 1, payload: makeCleanPayload() };
		const result = parsePersistedRoomAnalysis(doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('missing_schema');
	});

	// ─── D. Wrong schema ──────────────────────────────────────────────────

	test('D. Wrong schema identifier', () => {
		const doc = { schema: 'some-other-document', version: 1, payload: makeCleanPayload() };
		const result = parsePersistedRoomAnalysis(doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('wrong_schema');
	});

	// ─── E. Missing version ───────────────────────────────────────────────

	test('E. Missing version field', () => {
		const doc = { schema: ROOM_ANALYSIS_SCHEMA, payload: makeCleanPayload() };
		const result = parsePersistedRoomAnalysis(doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('missing_version');
	});

	// ─── F. Invalid version types ─────────────────────────────────────────

	test('F. Invalid version — string', () => {
		const result = parsePersistedRoomAnalysis({ schema: ROOM_ANALYSIS_SCHEMA, version: '1', payload: makeCleanPayload() });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_version');
	});

	test('F. Invalid version — null', () => {
		const result = parsePersistedRoomAnalysis({ schema: ROOM_ANALYSIS_SCHEMA, version: null, payload: makeCleanPayload() });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_version');
	});

	test('F. Invalid version — fractional number', () => {
		const result = parsePersistedRoomAnalysis({ schema: ROOM_ANALYSIS_SCHEMA, version: 1.5, payload: makeCleanPayload() });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_version');
	});

	test('F. Invalid version — NaN', () => {
		const result = parsePersistedRoomAnalysis({ schema: ROOM_ANALYSIS_SCHEMA, version: NaN, payload: makeCleanPayload() });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_version');
	});

	test('F. Invalid version — Infinity', () => {
		const result = parsePersistedRoomAnalysis({ schema: ROOM_ANALYSIS_SCHEMA, version: Infinity, payload: makeCleanPayload() });
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_version');
	});

	// ─── G. Unsupported older version ─────────────────────────────────────

	test('G. Unsupported older version 0', () => {
		const doc = { schema: ROOM_ANALYSIS_SCHEMA, version: 0, payload: makeCleanPayload() };
		const result = parsePersistedRoomAnalysis(doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('unsupported_older_version');
		// Confirm payload is not processed as version 1
		expect(result.issues.length).toBeGreaterThan(0);
	});

	// ─── H. Unsupported future version ────────────────────────────────────

	test('H. Unsupported future version 2', () => {
		const doc = { schema: ROOM_ANALYSIS_SCHEMA, version: 2, payload: makeCleanPayload() };
		const result = parsePersistedRoomAnalysis(doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('unsupported_future_version');
	});

	// ─── I. Invalid JSON ──────────────────────────────────────────────────

	test('I. Invalid JSON text', () => {
		const result = parsePersistedRoomAnalysisJson('{ this is not: json }');

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('invalid_json');
	});

	test('I. Truncated JSON text', () => {
		const result = parsePersistedRoomAnalysisJson('{"schema": "model-eval-room-analysis"');

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('invalid_json');
	});

	// ─── J. Invalid nested diagnostic values ──────────────────────────────

	test('J. Invalid nested diagnostics — non-integer counter', () => {
		const doc = makeV1Doc(makeCleanPayload({
			diagnostics: {
				...makeCleanDiagnostics(),
				loopsInspected: 1.5 as any // fractional, should fail
			}
		}));
		const result = parsePersistedRoomAnalysis(doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('invalid_payload');
		expect(result.issues.some(i => i.includes('loopsInspected'))).toBe(true);
	});

	test('J. Invalid nested diagnostics — negative counter', () => {
		const doc = makeV1Doc(makeCleanPayload({
			diagnostics: {
				...makeCleanDiagnostics(),
				primaryRoomCandidates: -1 as any
			}
		}));
		const result = parsePersistedRoomAnalysis(doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('invalid_payload');
	});

	// ─── K. Contradictory diagnostics ─────────────────────────────────────

	test('K. inspected !== valid + quarantined', () => {
		const doc = makeV1Doc(makeCleanPayload({
			diagnostics: makeCleanDiagnostics({
				envelopeValidation: {
					inspected: 5,   // should be valid+quarantined = 1+0 = 1
					valid: 1,
					eligible: 1,
					ineligible: 0,
					quarantined: 0,
					reasons: {}
				}
			})
		}));
		const result = parsePersistedRoomAnalysis(doc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_payload');
		expect(result.issues.some(i => i.includes('inspected'))).toBe(true);
	});

	test('K. valid !== eligible + ineligible', () => {
		const doc = makeV1Doc(makeCleanPayload({
			diagnostics: makeCleanDiagnostics({
				envelopeValidation: {
					inspected: 1,
					valid: 1,
					eligible: 1,
					ineligible: 5,  // valid should be eligible+ineligible = 1+5 = 6
					quarantined: 0,
					reasons: {}
				}
			})
		}));
		const result = parsePersistedRoomAnalysis(doc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_payload');
	});

	test('K. sum(reasons) !== quarantined', () => {
		const doc = makeV1Doc(makeCleanPayload({
			diagnostics: makeCleanDiagnostics({
				envelopeValidation: {
					inspected: 2,
					valid: 1,
					eligible: 1,
					ineligible: 0,
					quarantined: 1,
					reasons: { missing_eligibility: 3 }  // sum = 3, quarantined = 1
				}
			})
		}));
		const result = parsePersistedRoomAnalysis(doc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.reason).toBe('invalid_payload');
	});

	test('K. dataQuality contradicts quarantine count', () => {
		const doc = makeV1Doc(makeCleanPayload({
			dataQuality: 'complete',
			diagnostics: makeCleanDiagnostics({
				envelopeValidation: {
					inspected: 2,
					valid: 1,
					eligible: 1,
					ineligible: 0,
					quarantined: 1,
					reasons: { missing_eligibility: 1 }
				},
				hasQuarantinedEnvelopeInputs: true
			})
		}));
		const result = parsePersistedRoomAnalysis(doc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		// contradictory_diagnostics or invalid_payload
		expect(['invalid_payload', 'contradictory_diagnostics']).toContain(result.reason);
	});

	test('K. hasQuarantinedEnvelopeInputs=false contradicts quarantined>0', () => {
		const doc = makeV1Doc(makeCleanPayload({
			dataQuality: 'degraded',
			diagnostics: makeCleanDiagnostics({
				envelopeValidation: {
					inspected: 2,
					valid: 1,
					eligible: 1,
					ineligible: 0,
					quarantined: 1,
					reasons: { missing_eligibility: 1 }
				},
				hasQuarantinedEnvelopeInputs: false  // contradicts quarantined=1
			})
		}));
		const result = parsePersistedRoomAnalysis(doc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(['invalid_payload', 'contradictory_diagnostics']).toContain(result.reason);
	});

	// ─── L. Legacy candidate must not be upgraded ─────────────────────────

	test('L. Unversioned data (missing schema) is rejected — no implicit upgrade', () => {
		// Raw RoomDebugResult without schema wrapper — simulates legacy data
		const legacyDoc = {
			candidates: [{ id: 'r1', loopCandidateId: 'l1' }],
			traces: [],
			diagnostics: makeCleanDiagnostics()
		};
		const result = parsePersistedRoomAnalysis(legacyDoc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('missing_schema');
		// No eligibility field synthesized
		expect((result as any).value).toBeUndefined();
	});

	test('L. Version 0 data is not processed as version 1', () => {
		const v0Doc = {
			schema: ROOM_ANALYSIS_SCHEMA,
			version: 0,
			payload: {
				candidates: [{ id: 'r1' }],
				traces: []
			}
		};
		const result = parsePersistedRoomAnalysis(v0Doc);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('Expected failure');
		expect(result.reason).toBe('unsupported_older_version');
		expect(result.issues.some(i => i.includes('Re-run'))).toBe(true);
	});

	// ─── M. Geometry regression ───────────────────────────────────────────

	test('M. Geometry regression — room IDs and data survive round trip', () => {
		const candidate: RoomCandidate = {
			id: 'room:loop1:env1',
			loopCandidateId: 'loop1',
			envelopeCandidateId: 'env1',
			alternativeEnvelopeIds: [],
			storeyCandidateId: 'storey1',
			planPolygon: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 0, z: 5 }],
			baseElevation: 0,
			topElevation: 3,
			clearHeight: 3,
			planAreaM2: 25,
			estimatedVolumeM3: 75,
			perimeter: 20,
			logicalObjectIds: ['obj1'],
			classificationUnitIds: ['cu1'],
			materialIds: [1],
			score: 100,
			status: 'primary',
			qualityFlags: {}
		};

		const payload = makeCleanPayload({ candidates: [candidate] });
		const json = serializeRoomAnalysis(payload);
		const parsed = parsePersistedRoomAnalysisJson(json);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error('Expected ok');

		const recovered = parsed.value.payload.candidates[0] as RoomCandidate;
		expect(recovered.id).toBe('room:loop1:env1');
		expect(recovered.planAreaM2).toBe(25);
		expect(recovered.clearHeight).toBe(3);
		expect(recovered.planPolygon).toHaveLength(4);
		expect(recovered.planPolygon![0]).toEqual({ x: 0, z: 0 });
	});

	// ─── Compatibility messages ────────────────────────────────────────────

	test('Compatibility messages are non-empty for all reasons', () => {
		const reasons: PersistedAnalysisCompatibilityReason[] = [
			'invalid_json', 'not_object', 'missing_schema', 'wrong_schema',
			'missing_version', 'invalid_version', 'unsupported_older_version',
			'unsupported_future_version', 'invalid_payload', 'contradictory_diagnostics'
		];
		for (const reason of reasons) {
			const msg = compatibilityMessage(reason);
			expect(typeof msg).toBe('string');
			expect(msg.length).toBeGreaterThan(0);
		}
	});

	// ─── Not-object input ─────────────────────────────────────────────────

	test('Non-object inputs rejected with not_object', () => {
		for (const input of [null, undefined, 42, 'string', [], true]) {
			const result = parsePersistedRoomAnalysis(input);
			expect(result.ok).toBe(false);
			if (result.ok) throw new Error(`Expected failure for: ${JSON.stringify(input)}`);
			expect(result.reason).toBe('not_object');
		}
	});

	// ─── Unknown reason keys rejected ─────────────────────────────────────

	test('Unknown validation reason keys in reasons map are rejected', () => {
		const doc = makeV1Doc(makeCleanPayload({
			diagnostics: makeCleanDiagnostics({
				envelopeValidation: {
					inspected: 2,
					valid: 1,
					eligible: 1,
					ineligible: 0,
					quarantined: 1,
					reasons: { some_new_unknown_reason: 1 } as any
				}
			})
		}));
		const result = parsePersistedRoomAnalysis(doc);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error();
		expect(result.issues.some(i => i.includes('Unknown validation reason key'))).toBe(true);
	});

	// ─── generatedAt preserved ─────────────────────────────────────────────

	test('generatedAt is preserved after round trip', () => {
		const payload = makeCleanPayload();
		const json = serializeRoomAnalysis(payload);
		const parsed = parsePersistedRoomAnalysisJson(json);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error();
		expect(typeof parsed.value.generatedAt).toBe('string');
		expect(parsed.value.generatedAt!.length).toBeGreaterThan(0);
	});
});
