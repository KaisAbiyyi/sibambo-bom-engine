/**
 * room-debug-pipeline.ts
 *
 * Browser-safe wrapper for the full room-candidate pipeline.
 * Intended for use with ?roomDebug=1 query flag only.
 * Does not modify any algorithm; calls them in the same sequence
 * as audit-room-evidence.ts.
 */

import type { RuntimeScene } from '../geometry';
import { createGeometryFoundation } from '../geometry';
import { createClassificationUnitIndex } from '../annotation';
import { createRoomEvidenceProcessor } from './processor';
import { normalizeBarrierGraph } from './helpers';
import { findBoundaryLoopCandidates, rankBoundaryLoopCandidates } from './loops';
import { assignHorizontalEvidenceToLoops, rankLoopSurfaceAssignments } from './surfaces';
import { buildVerticalEnvelopeCandidates } from './envelopes';
import { assembleRoomCandidates } from './candidates';
import { buildRoomCandidateTraces, type RoomCandidateTrace } from './room-provenance';
import type { RoomCandidate } from './types';

export type RoomDebugResult = {
	candidates: RoomCandidate[];
	traces: RoomCandidateTrace[];
	durationMs: number;
	error?: string;
};

export async function runRoomDebugPipeline(scene: RuntimeScene): Promise<RoomDebugResult> {
	const t0 = performance.now();
	try {
		// 1. Geometry foundation + classification units
		const foundation = createGeometryFoundation(scene);
		const index = createClassificationUnitIndex(foundation);
		const objects = foundation.buildLogicalObjectIndex().objects;
		for (const obj of objects) {
			index.processObject(obj.id);
		}
		const units = index.units;

		// 2. Room evidence processor
		const processor = createRoomEvidenceProcessor();
		processor.processAll(units);
		const snapshot = processor.snapshot();

		// 3. Barrier graphs → loops → ranked loops per storey band
		const allNormalizedGraphs: ReturnType<typeof normalizeBarrierGraph>[] = [];
		const allRankedCandidates: ReturnType<typeof rankBoundaryLoopCandidates>['candidates'] = [];

		const candidateBands = snapshot.storeyBands.filter(
			(b) => b.status === 'primary' || b.status === 'secondary'
		);

		for (const band of candidateBands) {
			const rawGraph = snapshot.barrierGraphs?.find((g) => g.storeyCandidateId === band.id);
			if (!rawGraph) continue;

			const normG = normalizeBarrierGraph(rawGraph);
			allNormalizedGraphs.push(normG);

			const loopRes = findBoundaryLoopCandidates(normG);
			const rankedRes = rankBoundaryLoopCandidates(loopRes.candidates, normG, loopRes.diagnostics);
			allRankedCandidates.push(
				...rankedRes.candidates.filter(
					(c) => c.status === 'primary' || c.status === 'secondary'
				)
			);
		}

		// 4. Surface assignments → envelope candidates → room candidates
		const surfaceAssignments = assignHorizontalEvidenceToLoops(
			allRankedCandidates,
			snapshot.horizontalSurfaces,
			snapshot.storeyBands
		);
		const rankedSurfaces = rankLoopSurfaceAssignments(
			surfaceAssignments.assignments,
			allRankedCandidates
		);
		const envelopes = buildVerticalEnvelopeCandidates(
			allRankedCandidates,
			rankedSurfaces.assignments
		);
		const roomsResult = assembleRoomCandidates(
			allRankedCandidates,
			rankedSurfaces.assignments,
			envelopes.candidates,
			allNormalizedGraphs
		);
		const traces = buildRoomCandidateTraces({
			candidates: roomsResult.candidates,
			loops: allRankedCandidates,
			envelopes: envelopes.candidates,
			assignments: rankedSurfaces.assignments,
			horizontalEvidence: snapshot.horizontalSurfaces
		});

		return {
			candidates: roomsResult.candidates,
			traces,
			durationMs: performance.now() - t0
		};
	} catch (err) {
		return {
			candidates: [],
			traces: [],
			durationMs: performance.now() - t0,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
