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
import { GEOMETRY_TOLERANCES, type SurfaceClusterRecord } from '../geometry';
import type { ClassificationUnitRecord } from '../annotation';

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

const COS_HORIZONTAL = Math.cos((GEOMETRY_TOLERANCES.orientationAngleDeg * Math.PI) / 180);

export function extractHorizontalSurfaceEvidence(
	records: Array<ClassificationUnitRecord | SurfaceClusterRecord>,
	diagnostics?: { acceptedHorizontalCount: number; rejectedHorizontalCount: number }
): HorizontalSurfaceEvidence[] {
	const results: HorizontalSurfaceEvidence[] = [];

	for (const record of records) {
		const area = record.areaM2;
		const normal = record.dominantNormal;
		const bounds = record.worldBounds;
		const centroid = record.centroid;

		const isFinite =
			Number.isFinite(area) &&
			Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z) &&
			Number.isFinite(bounds.min.x) && Number.isFinite(bounds.min.y) && Number.isFinite(bounds.min.z) &&
			Number.isFinite(bounds.max.x) && Number.isFinite(bounds.max.y) && Number.isFinite(bounds.max.z) &&
			Number.isFinite(centroid.x) && Number.isFinite(centroid.y) && Number.isFinite(centroid.z);

		const hasArea = area > 0;
		const validBounds = bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;

		if (!isFinite || !hasArea || !validBounds) {
			if (diagnostics) diagnostics.rejectedHorizontalCount++;
			continue;
		}

		const verticalCos = Math.abs(normal.y);
		if (verticalCos >= COS_HORIZONTAL) {
			const surfaceType: 'floor' | 'ceiling' = normal.y >= 0 ? 'floor' : 'ceiling';
			const planBounds: PlanBounds = {
				min: { x: bounds.min.x, z: bounds.min.z },
				max: { x: bounds.max.x, z: bounds.max.z }
			};

			const sourceIds = [record.id];
			const id = generateHorizontalSurfaceId(
				record.logicalObjectId,
				sourceIds,
				centroid.y,
				planBounds,
				surfaceType
			);

			results.push({
				id,
				logicalObjectId: record.logicalObjectId,
				classificationUnitIds: sourceIds,
				elevation: centroid.y,
				planBounds,
				materialIds: record.materialIds,
				surfaceType,
				areaM2: area,
				quality: 1.0,
				isAmbiguous: false
			});

			if (diagnostics) diagnostics.acceptedHorizontalCount++;
		} else {
			if (diagnostics) diagnostics.rejectedHorizontalCount++;
		}
	}

	return results.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildStoreyBands(
	evidence: HorizontalSurfaceEvidence[]
): StoreyBandEvidence[] {
	if (evidence.length === 0) return [];

	const sorted = [...evidence].sort((a, b) => {
		if (a.elevation !== b.elevation) {
			return a.elevation - b.elevation;
		}
		return a.id.localeCompare(b.id);
	});

	const groups: HorizontalSurfaceEvidence[][] = [];
	let currentGroup: HorizontalSurfaceEvidence[] = [];

	for (const item of sorted) {
		if (currentGroup.length === 0) {
			currentGroup.push(item);
		} else {
			const baseElevation = currentGroup[0].elevation;
			if (Math.abs(item.elevation - baseElevation) <= GEOMETRY_TOLERANCES.levelBandM) {
				currentGroup.push(item);
			} else {
				groups.push(currentGroup);
				currentGroup = [item];
			}
		}
	}
	if (currentGroup.length > 0) {
		groups.push(currentGroup);
	}

	const storeyBands: StoreyBandEvidence[] = [];

	for (const group of groups) {
		const minEl = Math.min(...group.map(e => e.elevation));
		const maxEl = Math.max(...group.map(e => e.elevation));

		const minX = Math.min(...group.map(e => e.planBounds.min.x));
		const minZ = Math.min(...group.map(e => e.planBounds.min.z));
		const maxX = Math.max(...group.map(e => e.planBounds.max.x));
		const maxZ = Math.max(...group.map(e => e.planBounds.max.z));
		const planBounds: PlanBounds = {
			min: { x: minX, z: minZ },
			max: { x: maxX, z: maxZ }
		};

		const totalArea = group.reduce((sum, e) => sum + e.areaM2, 0);
		const weightedSum = group.reduce((sum, e) => sum + e.elevation * e.areaM2, 0);
		const representativeElevation = totalArea > 0 ? weightedSum / totalArea : group[0].elevation;

		const classificationUnitIds = [...new Set(group.flatMap(e => e.classificationUnitIds))].sort();
		const logicalObjectId = [...new Set(group.map(e => e.logicalObjectId))].sort().join('|');

		const materialIdsSet = new Set<number>();
		for (const e of group) {
			if (e.materialIds) {
				for (const matId of e.materialIds) {
					materialIdsSet.add(matId);
				}
			}
		}
		const materialIds = materialIdsSet.size > 0 ? [...materialIdsSet].sort((a, b) => a - b) : undefined;

		const hasUpward = group.some(e => e.surfaceType === 'floor');
		const hasDownward = group.some(e => e.surfaceType === 'ceiling');
		const isAmbiguous = hasUpward && hasDownward;

		const id = generateStoreyBandId(logicalObjectId, classificationUnitIds, minEl, maxEl);

		storeyBands.push({
			id,
			logicalObjectId,
			classificationUnitIds,
			elevationRange: { min: minEl, max: maxEl },
			planBounds,
			materialIds,
			quality: 1.0,
			isAmbiguous
		});
	}

	return storeyBands.sort((a, b) => a.id.localeCompare(b.id));
}

export function extractVerticalBarrierEvidence(
	records: Array<ClassificationUnitRecord | SurfaceClusterRecord>,
	diagnostics?: { acceptedVerticalCount: number; rejectedVerticalCount: number }
): VerticalBarrierEvidence[] {
	const results: VerticalBarrierEvidence[] = [];

	const SIN_VERTICAL = Math.sin((GEOMETRY_TOLERANCES.orientationAngleDeg * Math.PI) / 180);

	for (const record of records) {
		const area = record.areaM2;
		const normal = record.dominantNormal;
		const bounds = record.worldBounds;
		const centroid = record.centroid;

		const isFinite =
			Number.isFinite(area) &&
			Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z) &&
			Number.isFinite(bounds.min.x) && Number.isFinite(bounds.min.y) && Number.isFinite(bounds.min.z) &&
			Number.isFinite(bounds.max.x) && Number.isFinite(bounds.max.y) && Number.isFinite(bounds.max.z) &&
			Number.isFinite(centroid.x) && Number.isFinite(centroid.y) && Number.isFinite(centroid.z);

		const hasArea = area > 0;
		const validBounds = bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;
		const height = bounds.max.y - bounds.min.y;
		const hasHeight = height > 0;

		if (!isFinite || !hasArea || !validBounds || !hasHeight) {
			if (diagnostics) diagnostics.rejectedVerticalCount++;
			continue;
		}

		const verticalCos = Math.abs(normal.y);
		if (verticalCos <= SIN_VERTICAL) {
			let start: PlanCoord;
			let end: PlanCoord;

			if (Math.abs(normal.x) >= Math.abs(normal.z)) {
				start = { x: centroid.x, z: bounds.min.z };
				end = { x: centroid.x, z: bounds.max.z };
			} else {
				start = { x: bounds.min.x, z: centroid.z };
				end = { x: bounds.max.x, z: centroid.z };
			}

			const dx = end.x - start.x;
			const dz = end.z - start.z;
			const len = Math.hypot(dx, dz);
			if (len <= 0) {
				if (diagnostics) diagnostics.rejectedVerticalCount++;
				continue;
			}

			const [pStart, pEnd] = normalizeSegment(start, end);
			const segment: PlanSegment = { start: pStart, end: pEnd };

			const sourceIds = [record.id];
			const id = generateVerticalBarrierId(
				record.logicalObjectId,
				sourceIds,
				bounds.min.y,
				bounds.max.y,
				segment
			);

			const thickness = Math.abs(normal.x) >= Math.abs(normal.z) ? bounds.size.x : bounds.size.z;

			results.push({
				id,
				logicalObjectId: record.logicalObjectId,
				classificationUnitIds: sourceIds,
				elevationRange: { min: bounds.min.y, max: bounds.max.y },
				segment,
				materialIds: record.materialIds,
				thickness,
				isExterior: false,
				quality: 1.0,
				isAmbiguous: false
			});

			if (diagnostics) diagnostics.acceptedVerticalCount++;
		} else {
			if (diagnostics) diagnostics.rejectedVerticalCount++;
		}
	}

	return results.sort((a, b) => a.id.localeCompare(b.id));
}
