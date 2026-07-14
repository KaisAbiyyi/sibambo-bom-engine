import { describe, expect, test } from 'bun:test';
import {
	buildRoomCandidateTraces,
	getEvidenceGeometry,
	serializeRoomCandidateTrace,
	sortAlternativeEnvelopes
} from './room-provenance';
import type {
	HorizontalSurfaceEvidence,
	LoopSurfaceAssignment,
	RankedBoundaryLoopCandidate,
	RoomCandidate,
	VerticalEnvelopeCandidate
} from './types';

const loop = {
	id: 'loop:one',
	status: 'primary',
	score: 91,
	qualityFlags: { geometricallyPlausible: true },
	edgeIds: ['edge:b', 'edge:a'],
	verticalEvidenceIds: ['vertical:one'],
	logicalObjectIds: ['object:loop'],
	classificationUnitIds: ['unit:loop'],
	materialIds: [4],
	planBounds: { min: { x: 0, z: 0 }, max: { x: 4, z: 3 } },
	planPolygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }]
} as unknown as RankedBoundaryLoopCandidate;

const assignment = (id: string, role: 'lower-support' | 'upper-cover', evidenceId: string) => ({
	id,
	loopCandidateId: 'loop:one',
	horizontalEvidenceId: evidenceId,
	elevation: role === 'lower-support' ? 1 : 3,
	role,
	status: 'primary',
	score: 75,
	loopCoverageRatio: 0.8,
	evidenceCoverageRatio: 0.7,
	verticalDistance: 0.1,
	qualityFlags: { strongPlanOverlap: true },
	logicalObjectIds: ['object:surface'],
	classificationUnitIds: ['unit:surface'],
	materialIds: [5]
} as unknown as LoopSurfaceAssignment);

const envelope = (id: string, score: number) => ({
	id,
	loopCandidateId: 'loop:one',
	lowerAssignmentId: 'assignment:lower',
	upperAssignmentId: 'assignment:upper',
	lowerHorizontalEvidenceId: 'evidence:lower',
	upperHorizontalEvidenceId: 'evidence:upper',
	status: 'primary',
	score,
	qualityFlags: { geometricallyPlausible: true }
} as VerticalEnvelopeCandidate);

const candidate = {
	id: 'room:one',
	status: 'primary',
	loopId: 'loop:one',
	selectedEnvelopeId: 'env:selected',
	alternativeEnvelopeIds: ['env:low', 'env:tie'],
	lowerElevation: 1,
	upperElevation: 3,
	lowerHorizontalEvidenceId: 'evidence:lower',
	upperHorizontalEvidenceId: 'evidence:upper',
	planArea: 12,
	clearHeight: 2,
	estimatedVolume: 24
} as RoomCandidate;

const evidence = (id: string, elevation: number) => ({
	id,
	elevation,
	planBounds: { min: { x: 0, z: 0 }, max: { x: 4, z: 3 } }
} as HorizontalSurfaceEvidence);

describe('room candidate provenance helpers', () => {
	test('builds deterministic, non-mutating traces with sorted alternatives', () => {
		const envelopes = [envelope('env:tie', 80), envelope('env:selected', 100), envelope('env:low', 70)];
		const before = JSON.stringify({ candidate, loop, envelopes });
		const traces = buildRoomCandidateTraces({
			candidates: [candidate], loops: [loop], envelopes,
			assignments: [assignment('assignment:upper', 'upper-cover', 'evidence:upper'), assignment('assignment:lower', 'lower-support', 'evidence:lower')],
			horizontalEvidence: [evidence('evidence:lower', 1), evidence('evidence:upper', 3)]
		});

		expect(traces).toHaveLength(1);
		expect(traces[0].alternativeEnvelopes.map((item) => item.id)).toEqual(['env:tie', 'env:low']);
		expect(traces[0].loop.edgeIds).toEqual(['edge:a', 'edge:b']);
		expect(traces[0].lowerAssignment?.id).toBe('assignment:lower');
		expect(traces[0].upperAssignment?.id).toBe('assignment:upper');
		expect(JSON.stringify({ candidate, loop, envelopes })).toBe(before);
	});

	test('sorts alternatives by score descending then ID', () => {
		expect(sortAlternativeEnvelopes([envelope('env:b', 10), envelope('env:a', 10), envelope('env:c', 20)]).map((item) => item.id)).toEqual(['env:c', 'env:a', 'env:b']);
	});

	test('keeps missing lower and upper assignments explicit', () => {
		const traces = buildRoomCandidateTraces({ candidates: [candidate], loops: [loop], envelopes: [envelope('env:selected', 100)], assignments: [], horizontalEvidence: [] });
		expect(traces[0].lowerAssignment).toBeNull();
		expect(traces[0].upperAssignment).toBeNull();
	});

	test('marks exact evidence polygons and bounds-only evidence as approximate', () => {
		expect(getEvidenceGeometry({ ...evidence('exact', 1), polygon: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }] } as HorizontalSurfaceEvidence).approximate).toBe(false);
		expect(getEvidenceGeometry(evidence('bounds', 1)).approximate).toBe(true);
	});

	test('serializes plain trace JSON without functions or cyclic references', () => {
		const trace = buildRoomCandidateTraces({ candidates: [candidate], loops: [loop], envelopes: [envelope('env:selected', 100)], assignments: [], horizontalEvidence: [] })[0];
		const parsed = JSON.parse(serializeRoomCandidateTrace({ ...trace, ignored: () => 'nope' }));
		expect(parsed.candidate.id).toBe('room:one');
		expect(parsed.ignored).toBeUndefined();
	});
});
