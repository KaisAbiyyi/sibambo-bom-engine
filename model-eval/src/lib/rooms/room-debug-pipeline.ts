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
import { buildVerticalEnvelopeCandidates, refineVerticalEnvelopeCandidates } from './envelopes';
import { assembleRoomCandidates } from './candidates';
import { buildRoomCandidateTraces, type RoomCandidateTrace } from './room-provenance';
import { detectClosedRooms, type ClosedRoomDetectionInput } from './closed-room-detection';
import type { RoomCandidate, RoomCandidateDiagnostics } from './types';
import type { DetectedRoom, DetectedRoomResult } from './detected-room';
import { buildRoomTopology, type RoomTopologyResult, type RoomTopologyGraph } from './topology';
import { inferRoomSemantics, type RoomSemanticResult, type RoomSemanticInference, type SemanticObjectInput } from './semantics';

export type RoomIntelligenceDiagnostics = {
	roomDetection?: any;
	topology?: any;
	semantics?: any;
};

export type RoomIntelligenceResult = {
	detectedRooms: DetectedRoom[];
	topology: RoomTopologyGraph;
	semantics: RoomSemanticInference[];
	diagnostics: RoomIntelligenceDiagnostics;
};

export type RoomDebugResult = {
	candidates: RoomCandidate[];
	traces: RoomCandidateTrace[];
	diagnostics?: RoomCandidateDiagnostics;
	dataQuality?: 'complete' | 'degraded';
	durationMs: number;
	error?: string;
	/** Task 3B.3: Closed rooms detected from validated loop and envelope evidence */
	detectedRooms?: DetectedRoomResult;
	/** Task 3B.4: Topology graph of detected rooms */
	topology?: RoomTopologyResult;
	/** Task 3B.5: Semantic classification of detected rooms */
	semantics?: RoomSemanticResult;
	/** Combined RoomIntelligenceResult contract */
	intelligence?: RoomIntelligenceResult;
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
		const refinementResult = refineVerticalEnvelopeCandidates(
			envelopes.candidates,
			allRankedCandidates,
			snapshot.verticalBarriers,
			snapshot.storeyBands
		);
		const roomsResult = assembleRoomCandidates(
			allRankedCandidates,
			rankedSurfaces.assignments,
			refinementResult.candidates,
			allNormalizedGraphs
		);
		const traces = buildRoomCandidateTraces({
			candidates: roomsResult.candidates,
			loops: allRankedCandidates,
			envelopes: refinementResult.candidates,
			assignments: rankedSurfaces.assignments,
			horizontalEvidence: snapshot.horizontalSurfaces
		});

		const dataQuality = roomsResult.diagnostics.hasQuarantinedEnvelopeInputs ? 'degraded' : 'complete';

		// Task 3B.3 — Detect closed rooms from validated evidence
		const modelDiagonalM = (() => {
			let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
			for (const g of allNormalizedGraphs) {
				for (const n of g.nodes) {
					if (n.coord.x < minX) minX = n.coord.x;
					if (n.coord.x > maxX) maxX = n.coord.x;
					if (n.coord.z < minZ) minZ = n.coord.z;
					if (n.coord.z > maxZ) maxZ = n.coord.z;
				}
			}
			const dx = maxX - minX, dz = maxZ - minZ;
			return Number.isFinite(dx + dz) ? Math.sqrt(dx * dx + dz * dz) : 50;
		})();

		const detectionInput: ClosedRoomDetectionInput = {
			loops: allRankedCandidates,
			envelopes: refinementResult.candidates,
			graphs: allNormalizedGraphs,
			openings: snapshot.boundaryOpenings ?? [],
			modelDiagonalM
		};
		const detectedRooms = detectClosedRooms(detectionInput);

		// Task 3B.4 & 3B.5 — Topology and Semantics
		const topology = buildRoomTopology(detectedRooms, snapshot.boundaryOpenings ?? [], modelDiagonalM);
		const semanticObjects: SemanticObjectInput[] = objects.map((obj) => {
			const unit = units.find((u) => u.logicalObjectId === obj.id);
			const unitTags = unit ? unit.sourceTags.join(' ') : '';
			const unitNames = unit ? unit.sourceNames.join(' ') : '';
			return {
				id: obj.id,
				name: `${obj.sourceName || ''} ${obj.sourceTag || ''} ${unitNames} ${unitTags}`.trim(),
				category: obj.sourceTag || (unit ? unit.sourceTags[0] : undefined) || undefined,
				centroid: obj.centroid,
				boundingBox: obj.worldBounds
			};
		});
		const semantics = inferRoomSemantics(detectedRooms.rooms, topology.graph, { objects: semanticObjects });
		const intelligence: RoomIntelligenceResult = {
			detectedRooms: detectedRooms.rooms,
			topology: topology.graph,
			semantics: semantics.inferences,
			diagnostics: {
				roomDetection: detectedRooms.diagnostics,
				topology: topology.graph.diagnostics,
				semantics: semantics.diagnostics
			}
		};

		return {
			candidates: roomsResult.candidates,
			traces,
			diagnostics: roomsResult.diagnostics,
			dataQuality,
			durationMs: performance.now() - t0,
			detectedRooms,
			topology,
			semantics,
			intelligence
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
