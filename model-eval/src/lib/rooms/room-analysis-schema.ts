/**
 * room-analysis-schema.ts
 *
 * Explicit schema versioning and compatibility enforcement for persisted
 * room-analysis data (RoomDebugResult).
 *
 * Internal transient objects (RoomCandidateResult, loop candidates, etc.)
 * are NOT wrapped here — only the final debug result that may be
 * serialized, exported, or transported across runtime boundaries.
 *
 * Current supported version: 1
 */

import type {
	RoomCandidateDiagnostics,
	EnvelopeValidationDiagnostics,
	RefinedCandidateValidationReason
} from './types';
import type { RoomCandidate } from './types';
import type { RoomCandidateTrace } from './room-provenance';

// ─── Schema identifier ────────────────────────────────────────────────────────

export const ROOM_ANALYSIS_SCHEMA = 'model-eval-room-analysis' as const;
export const ROOM_ANALYSIS_CURRENT_VERSION = 1 as const;

// ─── Compatibility reason types ───────────────────────────────────────────────

export type PersistedAnalysisCompatibilityReason =
	| 'invalid_json'
	| 'not_object'
	| 'missing_schema'
	| 'wrong_schema'
	| 'missing_version'
	| 'invalid_version'
	| 'unsupported_older_version'
	| 'unsupported_future_version'
	| 'invalid_payload'
	| 'contradictory_diagnostics';

// ─── Persisted container types ────────────────────────────────────────────────

/**
 * The payload shape stored inside PersistedRoomAnalysisV1.
 * Matches RoomDebugResult without the ephemeral durationMs field.
 */
export interface PersistedRoomAnalysisPayload {
	candidates: RoomCandidate[];
	traces: RoomCandidateTrace[];
	diagnostics?: RoomCandidateDiagnostics;
	dataQuality?: 'complete' | 'degraded';
	error?: string;
}

/** Versioned container written to any persistence boundary. */
export interface PersistedRoomAnalysisV1 {
	schema: typeof ROOM_ANALYSIS_SCHEMA;
	version: typeof ROOM_ANALYSIS_CURRENT_VERSION;
	generatedAt?: string;
	payload: PersistedRoomAnalysisPayload;
}

// ─── Parse result types ───────────────────────────────────────────────────────

export type PersistedAnalysisParseResult =
	| { ok: true; value: PersistedRoomAnalysisV1 }
	| { ok: false; reason: PersistedAnalysisCompatibilityReason; issues: string[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonNegativeFiniteInteger(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v >= 0 && Number.isInteger(v);
}

// ─── Cross-field invariant validation ────────────────────────────────────────

function validateEnvelopeValidationDiagnostics(ev: unknown): { ok: true } | { ok: false; issues: string[] } {
	if (!isObject(ev)) return { ok: false, issues: ['envelopeValidation is not an object'] };

	const issues: string[] = [];

	for (const field of ['inspected', 'valid', 'eligible', 'ineligible', 'quarantined']) {
		if (!isNonNegativeFiniteInteger((ev as any)[field])) {
			issues.push(`envelopeValidation.${field} must be a non-negative finite integer`);
		}
	}

	if (issues.length > 0) return { ok: false, issues };

	const { inspected, valid, eligible, ineligible, quarantined } = ev as any;

	// Invariant: inspected = valid + quarantined
	if (inspected !== valid + quarantined) {
		issues.push(`envelopeValidation invariant failed: inspected(${inspected}) !== valid(${valid}) + quarantined(${quarantined})`);
	}

	// Invariant: valid = eligible + ineligible
	if (valid !== eligible + ineligible) {
		issues.push(`envelopeValidation invariant failed: valid(${valid}) !== eligible(${eligible}) + ineligible(${ineligible})`);
	}

	// Validate reasons map
	const reasons = (ev as any).reasons;
	if (!isObject(reasons)) {
		issues.push('envelopeValidation.reasons must be an object');
	} else {
		const validReasons: RefinedCandidateValidationReason[] = [
			'missing_eligibility', 'invalid_eligibility_type', 'missing_source_evidence',
			'invalid_source_evidence_shape', 'non_finite_score', 'invalid_status',
			'invalid_tolerance', 'invalid_candidate_shape', 'prototype_pollution'
		];

		let reasonTotal = 0;
		for (const [key, val] of Object.entries(reasons)) {
			if (!validReasons.includes(key as RefinedCandidateValidationReason)) {
				issues.push(`Unknown validation reason key: "${key}"`);
			}
			if (!isNonNegativeFiniteInteger(val)) {
				issues.push(`envelopeValidation.reasons.${key} must be a non-negative finite integer`);
			} else {
				reasonTotal += (val as number);
			}
		}

		// Invariant: sum(reasons) === quarantined
		if (issues.length === 0 && reasonTotal !== quarantined) {
			issues.push(`envelopeValidation invariant failed: sum(reasons)(${reasonTotal}) !== quarantined(${quarantined})`);
		}

		// Invariant: quarantined === 0 implies no positive reason counts
		if (quarantined === 0 && reasonTotal > 0) {
			issues.push('envelopeValidation has reason counts but quarantined is 0');
		}
	}

	return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function validateDiagnostics(diag: unknown): { ok: true } | { ok: false; issues: string[] } {
	if (!isObject(diag)) return { ok: false, issues: ['diagnostics must be an object'] };

	const numericFields = [
		'loopsInspected', 'noiseLoopsSkipped', 'primaryRoomCandidates', 'secondaryRoomCandidates',
		'ambiguousRoomCandidates', 'loopsWithoutValidEnvelopes', 'invalidAreaCandidatesRejected',
		'invalidHeightCandidatesRejected', 'alternativeEnvelopesPreserved'
	];

	const issues: string[] = [];
	for (const field of numericFields) {
		if (!isNonNegativeFiniteInteger((diag as any)[field])) {
			issues.push(`diagnostics.${field} must be a non-negative finite integer`);
		}
	}

	for (const field of ['totalCandidateArea', 'totalEstimatedVolume']) {
		const v = (diag as any)[field];
		if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
			issues.push(`diagnostics.${field} must be a non-negative finite number`);
		}
	}

	if (typeof (diag as any).hasQuarantinedEnvelopeInputs !== 'boolean') {
		issues.push('diagnostics.hasQuarantinedEnvelopeInputs must be a boolean');
	}

	if (typeof (diag as any).fingerprint !== 'string') {
		issues.push('diagnostics.fingerprint must be a string');
	}

	// Validate nested envelopeValidation
	const evResult = validateEnvelopeValidationDiagnostics((diag as any).envelopeValidation);
	if (!evResult.ok) issues.push(...evResult.issues);

	return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function validatePayloadCrossFieldInvariants(payload: PersistedRoomAnalysisPayload): { ok: true } | { ok: false; issues: string[] } {
	const issues: string[] = [];
	const { diagnostics, dataQuality } = payload;

	if (diagnostics) {
		const quarantined = diagnostics.envelopeValidation?.quarantined ?? 0;
		const hasFlag = diagnostics.hasQuarantinedEnvelopeInputs;

		// Invariant: quarantined > 0 && hasQuarantinedEnvelopeInputs === false is contradictory
		if (quarantined > 0 && hasFlag === false) {
			issues.push(`Contradictory: quarantined=${quarantined} but hasQuarantinedEnvelopeInputs=false`);
		}

		// Invariant: quarantined > 0 && dataQuality === 'complete' is contradictory
		if (quarantined > 0 && dataQuality === 'complete') {
			issues.push(`Contradictory: quarantined=${quarantined} but dataQuality='complete'`);
		}
	}

	return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

function validatePayload(raw: unknown): { ok: true; value: PersistedRoomAnalysisPayload } | { ok: false; issues: string[] } {
	if (!isObject(raw)) return { ok: false, issues: ['payload is not an object'] };

	const issues: string[] = [];

	if (!Array.isArray((raw as any).candidates)) {
		issues.push('payload.candidates must be an array');
	}
	if (!Array.isArray((raw as any).traces)) {
		issues.push('payload.traces must be an array');
	}

	// dataQuality if present
	const dq = (raw as any).dataQuality;
	if (dq !== undefined && dq !== 'complete' && dq !== 'degraded') {
		issues.push(`payload.dataQuality must be 'complete' or 'degraded', got: ${String(dq)}`);
	}

	// diagnostics if present — full validation
	if ((raw as any).diagnostics !== undefined) {
		const diagResult = validateDiagnostics((raw as any).diagnostics);
		if (!diagResult.ok) issues.push(...diagResult.issues);
	}

	if (issues.length > 0) return { ok: false, issues };

	const payload = raw as unknown as PersistedRoomAnalysisPayload;

	// Cross-field invariants
	const crossResult = validatePayloadCrossFieldInvariants(payload);
	if (!crossResult.ok) return { ok: false, issues: crossResult.issues };

	return { ok: true, value: payload };
}

// ─── Public parser ────────────────────────────────────────────────────────────

/**
 * Parse an unknown value as a versioned room-analysis document.
 * Validates schema identifier and version before touching payload contents.
 * Does not infer eligibility, does not apply migrations.
 */
export function parsePersistedRoomAnalysis(value: unknown): PersistedAnalysisParseResult {
	if (!isObject(value)) {
		return { ok: false, reason: 'not_object', issues: ['Input is not an object'] };
	}

	// 1. Schema identifier
	if (!('schema' in value)) {
		return { ok: false, reason: 'missing_schema', issues: ['Missing schema field'] };
	}
	if (value.schema !== ROOM_ANALYSIS_SCHEMA) {
		return { ok: false, reason: 'wrong_schema', issues: [`Wrong schema identifier: "${String(value.schema)}", expected "${ROOM_ANALYSIS_SCHEMA}"`] };
	}

	// 2. Version — must be an integer
	if (!('version' in value)) {
		return { ok: false, reason: 'missing_version', issues: ['Missing version field'] };
	}
	const version = value.version;
	if (
		typeof version !== 'number' ||
		!Number.isFinite(version) ||
		!Number.isInteger(version)
	) {
		return { ok: false, reason: 'invalid_version', issues: [`Invalid version type: ${String(version)}`] };
	}

	if (version < ROOM_ANALYSIS_CURRENT_VERSION) {
		return {
			ok: false,
			reason: 'unsupported_older_version',
			issues: [`Unsupported older schema version: ${version}. Re-run the analysis with the current application version.`]
		};
	}

	if (version > ROOM_ANALYSIS_CURRENT_VERSION) {
		return {
			ok: false,
			reason: 'unsupported_future_version',
			issues: [`Unsupported future schema version: ${version}. Update the application to load this file.`]
		};
	}

	// 3. Payload validation (version 1 only)
	if (!('payload' in value)) {
		return { ok: false, reason: 'invalid_payload', issues: ['Missing payload field'] };
	}

	const payloadResult = validatePayload(value.payload);
	if (!payloadResult.ok) {
		return { ok: false, reason: 'invalid_payload', issues: payloadResult.issues };
	}

	return {
		ok: true,
		value: {
			schema: ROOM_ANALYSIS_SCHEMA,
			version: ROOM_ANALYSIS_CURRENT_VERSION,
			generatedAt: typeof (value as any).generatedAt === 'string' ? (value as any).generatedAt : undefined,
			payload: payloadResult.value
		}
	};
}

/**
 * Parse JSON text as a versioned room-analysis document.
 * Captures invalid JSON as a stable result.
 */
export function parsePersistedRoomAnalysisJson(json: string): PersistedAnalysisParseResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, reason: 'invalid_json', issues: ['Input is not valid JSON'] };
	}
	return parsePersistedRoomAnalysis(parsed);
}

/**
 * Serialize a RoomDebugResult-compatible payload to a versioned JSON string.
 * Always writes the current schema identifier and version.
 * Never serializes unsafe casts — wraps payload in the versioned container.
 */
export function serializeRoomAnalysis(payload: PersistedRoomAnalysisPayload): string {
	const doc: PersistedRoomAnalysisV1 = {
		schema: ROOM_ANALYSIS_SCHEMA,
		version: ROOM_ANALYSIS_CURRENT_VERSION,
		generatedAt: new Date().toISOString(),
		payload
	};
	return JSON.stringify(doc);
}

/**
 * Human-readable compatibility message for display in the UI.
 * Does not expose raw stack traces or payloads.
 */
export function compatibilityMessage(reason: PersistedAnalysisCompatibilityReason): string {
	switch (reason) {
		case 'invalid_json':
			return 'This file is not valid JSON.';
		case 'not_object':
			return 'This file does not contain a valid analysis document.';
		case 'missing_schema':
			return 'This file is missing a schema identifier. It may be legacy data. Re-run the analysis.';
		case 'wrong_schema':
			return 'This file is not a room-analysis document. Check that you uploaded the correct file.';
		case 'missing_version':
			return 'This analysis file has no schema version. Re-run the analysis with the current application version.';
		case 'invalid_version':
			return 'This analysis file has an unrecognized schema version. Re-run the analysis.';
		case 'unsupported_older_version':
			return 'This analysis file uses an unsupported older schema version. Re-run the analysis with the current application version.';
		case 'unsupported_future_version':
			return 'This analysis file uses an unsupported newer schema version. Update the application to load this file.';
		case 'invalid_payload':
			return 'This analysis file contains invalid or corrupted payload data. Re-run the analysis.';
		case 'contradictory_diagnostics':
			return 'This analysis file contains contradictory diagnostic data. Re-run the analysis.';
	}
}
