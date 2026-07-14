import type {
	PlanCoord,
	PlanBounds,
	PlanSegment,
	StoreyBandEvidence,
	HorizontalSurfaceEvidence,
	VerticalBarrierEvidence,
	BoundaryOpeningEvidence,
	RoomEvidenceSnapshot,
	RoomEvidenceDiagnostics
} from './types';

// Centralized quantization step (1mm)
export const QUANTIZATION_STEP = 0.001;

export function quantizeCoord(value: number, step: number = QUANTIZATION_STEP): number {
	// Prevent negative zero (-0)
	const rounded = Math.round(value / step) * step;
	return rounded === 0 ? 0 : rounded;
}

export function formatQuantized(value: number): string {
	return Math.round(quantizeCoord(value) * 1000).toString();
}

export function normalizeSegment(start: PlanCoord, end: PlanCoord): [PlanCoord, PlanCoord] {
	const qStart = { x: quantizeCoord(start.x), z: quantizeCoord(start.z) };
	const qEnd = { x: quantizeCoord(end.x), z: quantizeCoord(end.z) };

	// Deterministic sorting of segment endpoints
	if (qStart.x < qEnd.x || (qStart.x === qEnd.x && qStart.z < qEnd.z)) {
		return [qStart, qEnd];
	}
	return [qEnd, qStart];
}

export function normalizeBounds(min: PlanCoord, max: PlanCoord): [PlanCoord, PlanCoord] {
	const qMinX = quantizeCoord(Math.min(min.x, max.x));
	const qMinZ = quantizeCoord(Math.min(min.z, max.z));
	const qMaxX = quantizeCoord(Math.max(min.x, max.x));
	const qMaxZ = quantizeCoord(Math.max(min.z, max.z));
	return [{ x: qMinX, z: qMinZ }, { x: qMaxX, z: qMaxZ }];
}

function formatSourceIds(ids: string[]): string {
	// Sort to ensure input-order independence
	return [...ids].sort().join('|');
}

export function generateStoreyBandId(
	logicalObjectId: string,
	classificationUnitIds: string[],
	minEl: number,
	maxEl: number
): string {
	const minStr = formatQuantized(minEl);
	const maxStr = formatQuantized(maxEl);
	const srcStr = formatSourceIds(classificationUnitIds);
	return `storey:${logicalObjectId}:${srcStr}:${minStr}:${maxStr}`;
}

export function generateHorizontalSurfaceId(
	logicalObjectId: string,
	classificationUnitIds: string[],
	elevation: number,
	planBounds: PlanBounds,
	surfaceType: 'floor' | 'ceiling'
): string {
	const elStr = formatQuantized(elevation);
	const [bMin, bMax] = normalizeBounds(planBounds.min, planBounds.max);
	const boundsStr = `${formatQuantized(bMin.x)},${formatQuantized(bMin.z)}_${formatQuantized(bMax.x)},${formatQuantized(bMax.z)}`;
	const srcStr = formatSourceIds(classificationUnitIds);
	return `horizontal:${surfaceType}:${logicalObjectId}:${srcStr}:${elStr}:${boundsStr}`;
}

export function generateVerticalBarrierId(
	logicalObjectId: string,
	classificationUnitIds: string[],
	minEl: number,
	maxEl: number,
	segment: PlanSegment
): string {
	const minStr = formatQuantized(minEl);
	const maxStr = formatQuantized(maxEl);
	const [pStart, pEnd] = normalizeSegment(segment.start, segment.end);
	const segmentStr = `${formatQuantized(pStart.x)},${formatQuantized(pStart.z)}_${formatQuantized(pEnd.x)},${formatQuantized(pEnd.z)}`;
	const srcStr = formatSourceIds(classificationUnitIds);
	return `vertical:${logicalObjectId}:${srcStr}:${minStr}:${maxStr}:${segmentStr}`;
}

export function generateBoundaryOpeningId(
	logicalObjectId: string,
	classificationUnitIds: string[],
	minEl: number,
	maxEl: number,
	segment: PlanSegment,
	openingType: 'door' | 'window' | 'opening'
): string {
	const minStr = formatQuantized(minEl);
	const maxStr = formatQuantized(maxEl);
	const [pStart, pEnd] = normalizeSegment(segment.start, segment.end);
	const segmentStr = `${formatQuantized(pStart.x)},${formatQuantized(pStart.z)}_${formatQuantized(pEnd.x)},${formatQuantized(pEnd.z)}`;
	const srcStr = formatSourceIds(classificationUnitIds);
	return `opening:${openingType}:${logicalObjectId}:${srcStr}:${minStr}:${maxStr}:${segmentStr}`;
}

export function createDeterministicSnapshot(
	input: Omit<RoomEvidenceSnapshot, 'diagnostics'> & { diagnostics?: Partial<RoomEvidenceDiagnostics> },
	startTime: number = performance.now()
): RoomEvidenceSnapshot {
	// Deterministic sorting of all lists by ID
	const storeyBands = [...input.storeyBands].sort((a, b) => a.id.localeCompare(b.id));
	const horizontalSurfaces = [...input.horizontalSurfaces].sort((a, b) => a.id.localeCompare(b.id));
	const verticalBarriers = [...input.verticalBarriers].sort((a, b) => a.id.localeCompare(b.id));
	const boundaryOpenings = [...input.boundaryOpenings].sort((a, b) => a.id.localeCompare(b.id));

	// Count duplicates
	const seenIds = new Set<string>();
	let duplicatedIdsCount = 0;

	const checkDuplicate = (id: string) => {
		if (seenIds.has(id)) {
			duplicatedIdsCount++;
		} else {
			seenIds.add(id);
		}
	};

	storeyBands.forEach(e => checkDuplicate(e.id));
	horizontalSurfaces.forEach(e => checkDuplicate(e.id));
	verticalBarriers.forEach(e => checkDuplicate(e.id));
	boundaryOpenings.forEach(e => checkDuplicate(e.id));

	const executionTimeMs = performance.now() - startTime;

	const diagnostics: RoomEvidenceDiagnostics = {
		totalStoreyBands: storeyBands.length,
		totalHorizontalSurfaces: horizontalSurfaces.length,
		totalVerticalBarriers: verticalBarriers.length,
		totalBoundaryOpenings: boundaryOpenings.length,
		duplicatedIdsCount,
		executionTimeMs,
		...input.diagnostics
	};

	return {
		storeyBands,
		horizontalSurfaces,
		verticalBarriers,
		boundaryOpenings,
		diagnostics
	};
}
