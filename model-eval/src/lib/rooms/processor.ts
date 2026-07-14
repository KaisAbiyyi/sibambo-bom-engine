import type { ClassificationUnitRecord } from '../annotation';
import type { SurfaceClusterRecord } from '../geometry';
import type {
	RoomEvidenceSnapshot,
	HorizontalSurfaceEvidence,
	VerticalBarrierEvidence,
	StoreyBandEvidence
} from './types';
import {
	extractHorizontalSurfaceEvidence,
	extractVerticalBarrierEvidence,
	buildStoreyBands,
	createDeterministicSnapshot,
	rankStoreyBandCandidates,
	buildBarrierGraph
} from './helpers';

export interface RoomEvidenceProcessor {
	processOne(unit: ClassificationUnitRecord | SurfaceClusterRecord): void;
	processBatch(units: Array<ClassificationUnitRecord | SurfaceClusterRecord>): void;
	processAll(units: Array<ClassificationUnitRecord | SurfaceClusterRecord>): void;
	snapshot(): RoomEvidenceSnapshot;
	cancel(): void;
	reset(): void;
	diagnostics(): {
		unitsInspected: number;
		horizontalAccepted: number;
		verticalAccepted: number;
		rejected: number;
		duplicatesSkipped: number;
		batchesProcessed: number;
		cancelled: boolean;
	};
}

export function createRoomEvidenceProcessor(): RoomEvidenceProcessor {
	let horizontalSurfaces: HorizontalSurfaceEvidence[] = [];
	let verticalBarriers: VerticalBarrierEvidence[] = [];
	let storeyBands: StoreyBandEvidence[] = [];

	const processedUnitIds = new Set<string>();

	let unitsInspected = 0;
	let rejected = 0;
	let duplicatesSkipped = 0;
	let batchesProcessed = 0;
	let cancelled = false;

	const startTime = performance.now();

	function processOne(unit: ClassificationUnitRecord | SurfaceClusterRecord): void {
		if (cancelled) return;

		if (processedUnitIds.has(unit.id)) {
			duplicatesSkipped++;
			return;
		}
		processedUnitIds.add(unit.id);
		unitsInspected++;

		// Attempt to extract horizontal and vertical evidence
		const extractedH = extractHorizontalSurfaceEvidence([unit] as any);
		const extractedV = extractVerticalBarrierEvidence([unit] as any);

		let accepted = false;

		if (extractedH.length > 0) {
			horizontalSurfaces.push(...extractedH);
			accepted = true;
		}
		if (extractedV.length > 0) {
			verticalBarriers.push(...extractedV);
			accepted = true;
		}

		if (accepted) {
			if (extractedH.length > 0) {
				// Rebuild storey bands deterministically when horizontal evidence arrives
				storeyBands = buildStoreyBands(horizontalSurfaces);
			}
		} else {
			rejected++;
		}
	}

	function processBatch(units: Array<ClassificationUnitRecord | SurfaceClusterRecord>): void {
		if (cancelled) return;
		batchesProcessed++;
		for (const unit of units) {
			processOne(unit);
		}
	}

	function processAll(units: Array<ClassificationUnitRecord | SurfaceClusterRecord>): void {
		if (cancelled) return;
		processBatch(units);
	}

	function snapshot(): RoomEvidenceSnapshot {
		const rankedBands = rankStoreyBandCandidates(storeyBands, horizontalSurfaces);
		const candidates = rankedBands.filter(b => b.status === 'primary' || b.status === 'secondary');
		const barrierGraphs = candidates.map(c => buildBarrierGraph(verticalBarriers, c));

		return createDeterministicSnapshot({
			storeyBands: rankedBands,
			horizontalSurfaces,
			verticalBarriers,
			boundaryOpenings: [],
			diagnostics: {
				unitsInspected,
				duplicatesSkipped,
				batchesProcessed,
				cancelled,
				acceptedHorizontalCount: horizontalSurfaces.length,
				rejectedHorizontalCount: rejected // mapping rejected count
			},
			barrierGraphs
		}, startTime);
	}

	function cancel(): void {
		cancelled = true;
	}

	function reset(): void {
		horizontalSurfaces = [];
		verticalBarriers = [];
		storeyBands = [];
		processedUnitIds.clear();
		unitsInspected = 0;
		rejected = 0;
		duplicatesSkipped = 0;
		batchesProcessed = 0;
		cancelled = false;
	}

	function getDiagnostics() {
		return {
			unitsInspected,
			horizontalAccepted: horizontalSurfaces.length,
			verticalAccepted: verticalBarriers.length,
			rejected,
			duplicatesSkipped,
			batchesProcessed,
			cancelled
		};
	}

	return {
		processOne,
		processBatch,
		processAll,
		snapshot,
		cancel,
		reset,
		diagnostics: getDiagnostics
	};
}
