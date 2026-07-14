import type {
	HorizontalSurfaceEvidence,
	LoopSurfaceAssignment,
	PlanBounds,
	PlanCoord,
	RankedBoundaryLoopCandidate,
	RoomCandidate,
	VerticalEnvelopeCandidate
} from './types';

export type EvidenceGeometry = {
	polygon: PlanCoord[];
	bounds: PlanBounds;
	approximate: boolean;
};

export type RoomCandidateTrace = {
	candidate: Pick<RoomCandidate, 'id' | 'status' | 'planArea' | 'lowerElevation' | 'upperElevation' | 'clearHeight' | 'estimatedVolume' | 'score' | 'qualityFlags' | 'logicalObjectIds' | 'classificationUnitIds' | 'materialIds' | 'verticalEvidenceIds'>;
	loop: {
		id: string;
		status: string;
		score: number;
		qualityFlags: unknown;
		edgeIds: string[];
		verticalEvidenceIds: string[];
		logicalObjectIds: string[];
		classificationUnitIds: string[];
		materialIds: number[];
		geometry: EvidenceGeometry;
	};
	selectedEnvelope: ReturnType<typeof toEnvelopeTrace> | null;
	alternativeEnvelopes: ReturnType<typeof toEnvelopeTrace>[];
	lowerAssignment: ReturnType<typeof toAssignmentTrace> | null;
	upperAssignment: ReturnType<typeof toAssignmentTrace> | null;
	lowerEvidence: ReturnType<typeof toEvidenceTrace> | null;
	upperEvidence: ReturnType<typeof toEvidenceTrace> | null;
	verticalExtentProfile?: import('./types').LoopVerticalExtentProfile | null;
	rawEnvelopeScore?: number;
	rawEnvelopeStatus?: string;
	refinedEnvelopeScore?: number;
	refinedEnvelopeStatus?: string;
	refinedEnvelopeRank?: number;
	baseAlignment?: number;
	topAlignment?: number;
	barrierSpanCoverage?: number;
	refinementReasons?: string[];
};

type TraceInputs = {
	candidates: RoomCandidate[];
	loops: RankedBoundaryLoopCandidate[];
	envelopes: VerticalEnvelopeCandidate[];
	assignments: LoopSurfaceAssignment[];
	horizontalEvidence: HorizontalSurfaceEvidence[];
};

const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
const strings = (values: string[] | undefined) => [...new Set(values ?? [])].sort();
const numbers = (values: number[] | undefined) => [...new Set(values ?? [])].sort((a, b) => a - b);

function fallbackBounds(): PlanBounds {
	return { min: { x: 0, z: 0 }, max: { x: 0, z: 0 } };
}

export function getEvidenceGeometry(evidence: Pick<HorizontalSurfaceEvidence, 'planBounds'> & { polygon?: PlanCoord[]; planPolygon?: PlanCoord[] }): EvidenceGeometry {
	const polygon = evidence.polygon ?? evidence.planPolygon ?? [];
	return {
		polygon: polygon.length >= 3 ? polygon.map((point) => ({ ...point })) : [],
		bounds: { min: { ...evidence.planBounds.min }, max: { ...evidence.planBounds.max } },
		approximate: polygon.length < 3
	};
}

function getLoopGeometry(loop: RankedBoundaryLoopCandidate): EvidenceGeometry {
	const candidate = loop as RankedBoundaryLoopCandidate & { planPolygon?: PlanCoord[]; polygon?: PlanCoord[] };
	const polygon = candidate.planPolygon ?? candidate.polygon ?? [];
	return {
		polygon: polygon.length >= 3 ? polygon.map((point) => ({ ...point })) : [],
		bounds: { min: { ...(loop.planBounds ?? fallbackBounds()).min }, max: { ...(loop.planBounds ?? fallbackBounds()).max } },
		approximate: polygon.length < 3
	};
}

function toAssignmentTrace(assignment: LoopSurfaceAssignment) {
	return {
		id: assignment.id,
		horizontalEvidenceId: assignment.horizontalEvidenceId,
		elevation: assignment.elevation,
		role: assignment.role,
		status: (assignment as LoopSurfaceAssignment & { status?: string }).status ?? 'unranked',
		score: assignment.score,
		loopCoverageRatio: assignment.loopCoverageRatio,
		evidenceCoverageRatio: assignment.evidenceCoverageRatio,
		verticalDistance: assignment.verticalDistance,
		qualityFlags: { ...assignment.qualityFlags },
		logicalObjectIds: strings(assignment.logicalObjectIds ?? [assignment.logicalObjectId]),
		classificationUnitIds: strings(assignment.classificationUnitIds),
		materialIds: numbers(assignment.materialIds)
	};
}

function toEnvelopeTrace(envelope: VerticalEnvelopeCandidate) {
	const ref = envelope as any;
	return {
		id: envelope.id,
		status: envelope.status,
		score: envelope.score,
		lowerAssignmentId: envelope.lowerAssignmentId,
		upperAssignmentId: envelope.upperAssignmentId,
		lowerHorizontalEvidenceId: envelope.lowerHorizontalEvidenceId,
		upperHorizontalEvidenceId: envelope.upperHorizontalEvidenceId,
		lowerElevation: envelope.lowerElevation,
		upperElevation: envelope.upperElevation,
		clearHeight: envelope.clearHeight,
		estimatedVolume: envelope.estimatedVolume,
		qualityFlags: { ...envelope.qualityFlags },
		logicalObjectIds: strings(envelope.logicalObjectIds),
		classificationUnitIds: strings(envelope.classificationUnitIds),
		materialIds: numbers(envelope.materialIds),
		rawScore: ref.rawScore,
		rawStatus: ref.rawStatus,
		refinedScore: ref.refinedScore,
		refinedStatus: ref.refinedStatus,
		refinedRank: ref.refinedRank,
		baseAlignment: ref.baseAlignment,
		topAlignment: ref.topAlignment,
		barrierSpanCoverage: ref.barrierSpanCoverage,
		refinementReasons: ref.refinementReasons,
		verticalExtentProfile: ref.verticalExtentProfile
	};
}

function toEvidenceTrace(evidence: HorizontalSurfaceEvidence) {
	return {
		id: evidence.id,
		elevation: evidence.elevation,
		surfaceType: evidence.surfaceType,
		geometry: getEvidenceGeometry(evidence as HorizontalSurfaceEvidence & { polygon?: PlanCoord[]; planPolygon?: PlanCoord[] }),
		logicalObjectIds: strings([evidence.logicalObjectId]),
		classificationUnitIds: strings(evidence.classificationUnitIds),
		materialIds: numbers(evidence.materialIds)
	};
}

export function sortAlternativeEnvelopes(envelopes: VerticalEnvelopeCandidate[]) {
	return [...envelopes].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function buildRoomCandidateTraces(input: TraceInputs): RoomCandidateTrace[] {
	const loops = byId(input.loops);
	const envelopes = byId(input.envelopes);
	const assignments = byId(input.assignments);
	const evidence = byId(input.horizontalEvidence);

	return [...input.candidates]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((candidate) => {
			const loopId = candidate.loopCandidateId || candidate.loopId;
			const loop = loops.get(loopId);
			const selectedEnvelope = envelopes.get(candidate.selectedEnvelopeId);
			const sEnvRef = selectedEnvelope as any;
			const lowerAssignment = selectedEnvelope?.lowerAssignmentId ? assignments.get(selectedEnvelope.lowerAssignmentId) : undefined;
			const upperAssignment = selectedEnvelope?.upperAssignmentId ? assignments.get(selectedEnvelope.upperAssignmentId) : undefined;
			return {
				candidate: {
					id: candidate.id, status: candidate.status, planArea: candidate.planArea,
					lowerElevation: candidate.lowerElevation, upperElevation: candidate.upperElevation,
					clearHeight: candidate.clearHeight, estimatedVolume: candidate.estimatedVolume,
					score: candidate.score, qualityFlags: { ...candidate.qualityFlags },
					logicalObjectIds: strings(candidate.logicalObjectIds),
					classificationUnitIds: strings(candidate.classificationUnitIds), materialIds: numbers(candidate.materialIds),
					verticalEvidenceIds: strings(candidate.verticalEvidenceIds)
				},
				loop: {
					id: loopId,
					status: loop?.status ?? 'missing', score: loop?.score ?? 0,
					qualityFlags: loop ? { ...loop.qualityFlags } : {}, edgeIds: strings(loop?.edgeIds ?? candidate.orderedBoundaryEdgeIds),
					verticalEvidenceIds: strings(loop?.verticalEvidenceIds ?? candidate.verticalEvidenceIds),
					logicalObjectIds: strings(loop?.logicalObjectIds ?? candidate.logicalObjectIds),
					classificationUnitIds: strings(loop?.classificationUnitIds ?? candidate.classificationUnitIds),
					materialIds: numbers(loop?.materialIds ?? candidate.materialIds), geometry: loop ? getLoopGeometry(loop) : (() => {
						const polygon = candidate.planPolygon ?? [];
						const bounds = candidate.planBounds ?? fallbackBounds();
						return { polygon: polygon.map((point) => ({ ...point })), bounds: { min: { ...bounds.min }, max: { ...bounds.max } }, approximate: polygon.length < 3 };
					})()
				},
				selectedEnvelope: selectedEnvelope ? toEnvelopeTrace(selectedEnvelope) : null,
				alternativeEnvelopes: sortAlternativeEnvelopes(candidate.alternativeEnvelopeIds.map((id) => envelopes.get(id)).filter((item): item is VerticalEnvelopeCandidate => Boolean(item))).map(toEnvelopeTrace),
				lowerAssignment: lowerAssignment ? toAssignmentTrace(lowerAssignment) : null,
				upperAssignment: upperAssignment ? toAssignmentTrace(upperAssignment) : null,
				lowerEvidence: candidate.lowerHorizontalEvidenceId && evidence.get(candidate.lowerHorizontalEvidenceId) ? toEvidenceTrace(evidence.get(candidate.lowerHorizontalEvidenceId)!) : null,
				upperEvidence: candidate.upperHorizontalEvidenceId && evidence.get(candidate.upperHorizontalEvidenceId) ? toEvidenceTrace(evidence.get(candidate.upperHorizontalEvidenceId)!) : null,
				verticalExtentProfile: sEnvRef?.verticalExtentProfile || null,
				rawEnvelopeScore: sEnvRef?.rawScore,
				rawEnvelopeStatus: sEnvRef?.rawStatus,
				refinedEnvelopeScore: sEnvRef?.refinedScore,
				refinedEnvelopeStatus: sEnvRef?.refinedStatus,
				refinedEnvelopeRank: sEnvRef?.refinedRank,
				baseAlignment: sEnvRef?.baseAlignment,
				topAlignment: sEnvRef?.topAlignment,
				barrierSpanCoverage: sEnvRef?.barrierSpanCoverage,
				refinementReasons: sEnvRef?.refinementReasons
			};
		});
}

export function serializeRoomCandidateTrace(trace: unknown) {
	const seen = new WeakSet<object>();
	return JSON.stringify(trace, (_key, value) => {
		if (typeof value === 'function' || typeof value === 'undefined') return undefined;
		if (value && typeof value === 'object') {
			if (seen.has(value)) return '[Circular]';
			seen.add(value);
		}
		return value;
	}, 2);
}
