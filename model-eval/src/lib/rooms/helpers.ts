import type {
	PlanCoord,
	PlanBounds,
	PlanSegment,
	StoreyBandEvidence,
	HorizontalSurfaceEvidence,
	VerticalBarrierEvidence,
	BoundaryOpeningEvidence,
	RoomEvidenceSnapshot,
	RoomEvidenceDiagnostics,
	BarrierGraph,
	BarrierGraphNode,
	BarrierGraphEdge
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
		diagnostics,
		barrierGraphs: input.barrierGraphs
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

export function calculateRoomEvidenceFingerprint(snapshot: RoomEvidenceSnapshot): string {
	const payload = {
		horizontal: snapshot.horizontalSurfaces.map(e => ({
			id: e.id,
			logicalObjectId: e.logicalObjectId,
			classificationUnitIds: [...e.classificationUnitIds].sort(),
			elevation: Number(e.elevation.toFixed(6)),
			planBounds: {
				min: { x: Number(e.planBounds.min.x.toFixed(6)), z: Number(e.planBounds.min.z.toFixed(6)) },
				max: { x: Number(e.planBounds.max.x.toFixed(6)), z: Number(e.planBounds.max.z.toFixed(6)) }
			},
			materialIds: e.materialIds ? [...e.materialIds].sort((a, b) => a - b) : [],
			quality: e.quality,
			isAmbiguous: e.isAmbiguous
		})),
		vertical: snapshot.verticalBarriers.map(e => ({
			id: e.id,
			logicalObjectId: e.logicalObjectId,
			classificationUnitIds: [...e.classificationUnitIds].sort(),
			elevationRange: { min: Number(e.elevationRange.min.toFixed(6)), max: Number(e.elevationRange.max.toFixed(6)) },
			segment: {
				start: { x: Number(e.segment.start.x.toFixed(6)), z: Number(e.segment.start.z.toFixed(6)) },
				end: { x: Number(e.segment.end.x.toFixed(6)), z: Number(e.segment.end.z.toFixed(6)) }
			},
			materialIds: e.materialIds ? [...e.materialIds].sort((a, b) => a - b) : [],
			quality: e.quality,
			isAmbiguous: e.isAmbiguous
		})),
		storeyBands: snapshot.storeyBands.map(e => ({
			id: e.id,
			logicalObjectId: e.logicalObjectId,
			classificationUnitIds: [...e.classificationUnitIds].sort(),
			elevationRange: { min: Number(e.elevationRange.min.toFixed(6)), max: Number(e.elevationRange.max.toFixed(6)) },
			planBounds: {
				min: { x: Number(e.planBounds.min.x.toFixed(6)), z: Number(e.planBounds.min.z.toFixed(6)) },
				max: { x: Number(e.planBounds.max.x.toFixed(6)), z: Number(e.planBounds.max.z.toFixed(6)) }
			},
			materialIds: e.materialIds ? [...e.materialIds].sort((a, b) => a - b) : [],
			quality: e.quality,
			isAmbiguous: e.isAmbiguous,
			score: e.score !== undefined ? Number(e.score.toFixed(6)) : undefined,
			status: e.status
		}))
	};

	const serialized = JSON.stringify(payload);

	// Safe require for environment check
	let sha256: (str: string) => string;
	if (typeof window === 'undefined') {
		try {
			const { createHash } = require('crypto');
			sha256 = (str: string) => createHash('sha256').update(str).digest('hex');
		} catch (e) {
			sha256 = simpleHash;
		}
	} else {
		sha256 = simpleHash;
	}

	return sha256(serialized);
}

function simpleHash(str: string): string {
	let h1 = 2166136261;
	let h2 = 5381;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ char, 16777619) >>> 0;
		h2 = Math.imul(h2 ^ char, 33) >>> 0;
	}
	return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function rankStoreyBandCandidates(
	bands: StoreyBandEvidence[],
	horizontalEvidence: HorizontalSurfaceEvidence[]
): StoreyBandEvidence[] {
	const horizMap = new Map<string, HorizontalSurfaceEvidence>();
	for (const h of horizontalEvidence) {
		for (const id of h.classificationUnitIds) {
			horizMap.set(id, h);
		}
	}

	const ratedBands = bands.map(band => {
		const members = band.classificationUnitIds
			.map(id => horizMap.get(id))
			.filter((h): h is HorizontalSurfaceEvidence => h !== undefined);

		const memberCount = members.length;
		const totalArea = members.reduce((sum, h) => sum + h.areaM2, 0);

		const dx = band.planBounds.max.x - band.planBounds.min.x;
		const dz = band.planBounds.max.z - band.planBounds.min.z;
		const projectedPlanArea = dx * dz;

		const upwardArea = members
			.filter(h => h.surfaceType === 'floor')
			.reduce((sum, h) => sum + h.areaM2, 0);

		const downwardArea = members
			.filter(h => h.surfaceType === 'ceiling')
			.reduce((sum, h) => sum + h.areaM2, 0);

		const compactness = projectedPlanArea > 0 ? Math.min(1.0, totalArea / projectedPlanArea) : 1.0;

		return {
			...band,
			totalArea,
			projectedPlanArea,
			memberCount,
			upwardArea,
			downwardArea,
			compactness
		};
	});

	const maxArea = Math.max(...ratedBands.map(b => b.totalArea), 0);
	const sumArea = ratedBands.reduce((sum, b) => sum + b.totalArea, 0);

	const finalBands = ratedBands.map(band => {
		const modelRelativeCoverage = sumArea > 0 ? band.totalArea / sumArea : 0.0;
		const relativeArea = maxArea > 0 ? band.totalArea / maxArea : 0.0;

		const ambFactor = band.isAmbiguous ? 0.8 : 1.0;
		const score = band.totalArea * relativeArea * band.compactness * ambFactor;

		let status: 'primary' | 'secondary' | 'noise' = 'noise';
		if (band.totalArea >= 15.0 && relativeArea >= 0.15) {
			status = 'primary';
		} else if (band.totalArea >= 5.0 && relativeArea >= 0.05) {
			status = 'secondary';
		}

		return {
			...band,
			modelRelativeCoverage,
			score,
			status
		};
	});

	return finalBands.sort((a, b) => {
		if (Math.abs(a.score - b.score) > 1e-7) {
			return b.score - a.score;
		}
		return a.id.localeCompare(b.id);
	});
}

export function generateBarrierNodeId(x: number, z: number): string {
	return `node:${formatQuantized(x)}_${formatQuantized(z)}`;
}

export function generateBarrierEdgeId(nodeAId: string, nodeBId: string): string {
	const [n1, n2] = [nodeAId, nodeBId].sort();
	return `edge:${n1}__${n2}`;
}

export function buildBarrierGraph(
	verticalEvidence: VerticalBarrierEvidence[],
	storeyCandidate: StoreyBandEvidence
): BarrierGraph {
	const storeyId = storeyCandidate.id;
	const cMin = storeyCandidate.elevationRange.min;
	const cMax = storeyCandidate.elevationRange.max;

	const tolY = 0.2;
	const filteredBarriers = verticalEvidence.filter(b => {
		return b.elevationRange.min <= cMax + tolY && b.elevationRange.max >= cMin - tolY;
	});

	const inputBarriers = filteredBarriers.length;
	let acceptedEdgesCount = 0;
	let rejectedEdgesCount = 0;
	let snappedEndpointsCount = 0;
	let duplicateEdgesMerged = 0;

	const barrierPoints: Array<{ barrierIdx: number; isEnd: boolean }> = [];
	const points: PlanCoord[] = [];
	for (let i = 0; i < filteredBarriers.length; i++) {
		const b = filteredBarriers[i];
		barrierPoints.push({ barrierIdx: i, isEnd: false });
		points.push(b.segment.start);
		barrierPoints.push({ barrierIdx: i, isEnd: true });
		points.push(b.segment.end);
	}

	const n = points.length;
	const indices = Array.from({ length: n }, (_, i) => i);
	indices.sort((a, b) => {
		const pa = points[a];
		const pb = points[b];
		if (pa.x !== pb.x) return pa.x - pb.x;
		return pa.z - pb.z;
	});

	const sortedPoints = indices.map(idx => points[idx]);
	const sortedBarrierRefs = indices.map(idx => barrierPoints[idx]);

	const parent = Array.from({ length: n }, (_, i) => i);
	function find(i: number): number {
		let root = i;
		while (parent[root] !== root) root = parent[root];
		let curr = i;
		while (curr !== root) {
			const nxt = parent[curr];
			parent[curr] = root;
			curr = nxt;
		}
		return root;
	}

	function union(i: number, j: number) {
		const rootI = find(i);
		const rootJ = find(j);
		if (rootI !== rootJ) {
			if (rootI < rootJ) {
				parent[rootJ] = rootI;
			} else {
				parent[rootI] = rootJ;
			}
		}
	}

	const tol = GEOMETRY_TOLERANCES.positionM;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			if (sortedPoints[j].x - sortedPoints[i].x > tol) {
				break;
			}
			if (Math.hypot(sortedPoints[i].x - sortedPoints[j].x, sortedPoints[i].z - sortedPoints[j].z) <= tol) {
				union(i, j);
			}
		}
	}

	const groups = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const root = find(i);
		if (!groups.has(root)) groups.set(root, []);
		groups.get(root)!.push(i);
	}

	const snappedCoords = new Map<number, PlanCoord>();
	for (const [root, idxs] of groups.entries()) {
		let sumX = 0;
		let sumZ = 0;
		for (const idx of idxs) {
			sumX += sortedPoints[idx].x;
			sumZ += sortedPoints[idx].z;
		}
		const snapped = {
			x: quantizeCoord(sumX / idxs.length),
			z: quantizeCoord(sumZ / idxs.length)
		};
		for (const idx of idxs) {
			snappedCoords.set(idx, snapped);
		}
		if (idxs.length > 1) {
			snappedEndpointsCount += idxs.length;
		}
	}

	const barrierSegments = Array.from({ length: filteredBarriers.length }, () => ({
		start: null as PlanCoord | null,
		end: null as PlanCoord | null
	}));

	for (let i = 0; i < n; i++) {
		const ref = sortedBarrierRefs[i];
		const coord = snappedCoords.get(i)!;
		if (ref.isEnd) {
			barrierSegments[ref.barrierIdx].end = coord;
		} else {
			barrierSegments[ref.barrierIdx].start = coord;
		}
	}

	const nodeMap = new Map<string, BarrierGraphNode>();
	const edgeMap = new Map<string, BarrierGraphEdge>();

	for (let i = 0; i < filteredBarriers.length; i++) {
		const b = filteredBarriers[i];
		const snapped = barrierSegments[i];
		const start = snapped.start!;
		const end = snapped.end!;

		const isFinite =
			Number.isFinite(start.x) && Number.isFinite(start.z) &&
			Number.isFinite(end.x) && Number.isFinite(end.z);

		if (!isFinite) {
			rejectedEdgesCount++;
			continue;
		}

		const nodeAId = generateBarrierNodeId(start.x, start.z);
		const nodeBId = generateBarrierNodeId(end.x, end.z);

		if (nodeAId === nodeBId) {
			rejectedEdgesCount++;
			continue;
		}

		acceptedEdgesCount++;

		if (!nodeMap.has(nodeAId)) {
			nodeMap.set(nodeAId, { id: nodeAId, coord: start });
		}
		if (!nodeMap.has(nodeBId)) {
			nodeMap.set(nodeBId, { id: nodeBId, coord: end });
		}

		const edgeId = generateBarrierEdgeId(nodeAId, nodeBId);
		const [firstNodeId, secondNodeId] = [nodeAId, nodeBId].sort();
		const pStart = firstNodeId === nodeAId ? start : end;
		const pEnd = firstNodeId === nodeAId ? end : start;

		const existing = edgeMap.get(edgeId);
		if (existing) {
			duplicateEdgesMerged++;
			existing.verticalEvidenceIds = [...new Set([...existing.verticalEvidenceIds, b.id])].sort();
			existing.classificationUnitIds = [...new Set([...existing.classificationUnitIds, ...b.classificationUnitIds])].sort();

			const logObjs = [...new Set([...existing.logicalObjectId.split('|'), b.logicalObjectId])].sort();
			existing.logicalObjectId = logObjs.join('|');

			if (b.materialIds) {
				const mats = new Set([...existing.materialIds, ...b.materialIds]);
				existing.materialIds = [...mats].sort((x, y) => x - y);
			}
		} else {
			edgeMap.set(edgeId, {
				id: edgeId,
				nodeAId: firstNodeId,
				nodeBId: secondNodeId,
				start: pStart,
				end: pEnd,
				originalStart: b.segment.start,
				originalEnd: b.segment.end,
				verticalEvidenceIds: [b.id],
				logicalObjectId: b.logicalObjectId,
				classificationUnitIds: [...b.classificationUnitIds].sort(),
				materialIds: b.materialIds ? [...b.materialIds].sort((x, y) => x - y) : [],
				storeyCandidateId: storeyId
			});
		}
	}

	const nodeIds = [...nodeMap.keys()].sort();
	const nodeParent = new Map<string, string>();
	for (const id of nodeIds) {
		nodeParent.set(id, id);
	}

	function findNode(id: string): string {
		let root = id;
		while (nodeParent.get(root) !== root) root = nodeParent.get(root)!;
		let curr = id;
		while (curr !== root) {
			const nxt = nodeParent.get(curr)!;
			nodeParent.set(curr, root);
			curr = nxt;
		}
		return root;
	}

	function unionNodes(id1: string, id2: string) {
		const root1 = findNode(id1);
		const root2 = findNode(id2);
		if (root1 !== root2) {
			if (root1 < root2) {
				nodeParent.set(root2, root1);
			} else {
				nodeParent.set(root1, root2);
			}
		}
	}

	for (const edge of edgeMap.values()) {
		unionNodes(edge.nodeAId, edge.nodeBId);
	}

	const compGroups = new Map<string, string[]>();
	for (const id of nodeIds) {
		const root = findNode(id);
		if (!compGroups.has(root)) compGroups.set(root, []);
		compGroups.get(root)!.push(id);
	}

	const components: string[][] = [];
	for (const list of compGroups.values()) {
		list.sort();
		components.push(list);
	}
	components.sort((a, b) => a[0].localeCompare(b[0]));

	const nodes = [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
	const edges = [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id));

	return {
		storeyCandidateId: storeyId,
		nodes,
		edges,
		components,
		diagnostics: {
			inputBarriers,
			acceptedEdges: acceptedEdgesCount,
			rejectedEdges: rejectedEdgesCount,
			snappedEndpoints: snappedEndpointsCount,
			duplicateEdgesMerged,
			graphNodes: nodes.length,
			graphEdges: edges.length,
			connectedComponents: components.length
		}
	};
}

export function calculateBarrierGraphFingerprint(graph: BarrierGraph): string {
	const payload = {
		storeyCandidateId: graph.storeyCandidateId,
		nodes: graph.nodes.map((n: BarrierGraphNode) => ({
			id: n.id,
			coord: { x: Number(n.coord.x.toFixed(6)), z: Number(n.coord.z.toFixed(6)) }
		})),
		edges: graph.edges.map((e: BarrierGraphEdge) => ({
			id: e.id,
			nodeAId: e.nodeAId,
			nodeBId: e.nodeBId,
			start: { x: Number(e.start.x.toFixed(6)), z: Number(e.start.z.toFixed(6)) },
			end: { x: Number(e.end.x.toFixed(6)), z: Number(e.end.z.toFixed(6)) },
			originalStart: { x: Number(e.originalStart.x.toFixed(6)), z: Number(e.originalStart.z.toFixed(6)) },
			originalEnd: { x: Number(e.originalEnd.x.toFixed(6)), z: Number(e.originalEnd.z.toFixed(6)) },
			verticalEvidenceIds: [...e.verticalEvidenceIds].sort(),
			logicalObjectId: e.logicalObjectId,
			classificationUnitIds: [...e.classificationUnitIds].sort(),
			materialIds: [...e.materialIds].sort((x, y) => x - y)
		})),
		components: graph.components
	};

	const serialized = JSON.stringify(payload);

	let sha256: (str: string) => string;
	if (typeof window === 'undefined') {
		try {
			const { createHash } = require('crypto');
			sha256 = (str: string) => createHash('sha256').update(str).digest('hex');
		} catch (e) {
			sha256 = simpleHash;
		}
	} else {
		sha256 = simpleHash;
	}

	return sha256(serialized);
}

// ---------------------------------------------------------------------------
// normalizeBarrierGraph — topology normalization
// ---------------------------------------------------------------------------

export interface BarrierGraphNormalizationDiagnostics {
	nodesBefore: number;
	nodesAfter: number;
	edgesBefore: number;
	edgesAfter: number;
	componentsBefore: number;
	componentsAfter: number;
	endpointsSnapped: number;
	intersectionsFound: number;
	tJunctionsFound: number;
	edgesSplit: number;
	collinearOverlapsMerged: number;
	duplicateSubsegmentsRemoved: number;
	zeroLengthRejected: number;
	degree1Nodes: number;
	degree2Nodes: number;
	degree3PlusNodes: number;
}

export interface NormalizedBarrierGraph extends BarrierGraph {
	normalizationDiagnostics: BarrierGraphNormalizationDiagnostics;
}

const TOL = GEOMETRY_TOLERANCES.positionM; // 0.001 m
const TOL2 = TOL * TOL;

function coord2Key(x: number, z: number): string {
	return `${quantizeCoord(x)}_${quantizeCoord(z)}`;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx, dz = az - bz;
	return dx * dx + dz * dz;
}

function planLength2(sx: number, sz: number, ex: number, ez: number): number {
	return dist2(sx, sz, ex, ez);
}

// Project point P onto segment AB. Returns t in [0,1] (clamped) and squared distance.
function projectPointOnSegment(
	px: number, pz: number,
	ax: number, az: number,
	bx: number, bz: number
): { t: number; dx: number; dz: number; distSq: number } {
	const abx = bx - ax, abz = bz - az;
	const len2 = abx * abx + abz * abz;
	if (len2 < 1e-24) {
		return { t: 0, dx: px - ax, dz: pz - az, distSq: dist2(px, pz, ax, az) };
	}
	const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2));
	const cx = ax + t * abx, cz = az + t * abz;
	const ddx = px - cx, ddz = pz - cz;
	return { t, dx: ddx, dz: ddz, distSq: ddx * ddx + ddz * ddz };
}

// Returns t in [0,1] on segment AB where segment CD intersects, or null.
// Uses strict crossing (both segments must properly cross, not just touch endpoints).
function segmentCrossing(
	ax: number, az: number, bx: number, bz: number,
	cx: number, cz: number, dx: number, dz: number
): { tAB: number; tCD: number } | null {
	const dabx = bx - ax, dabz = bz - az;
	const dcx = dx - cx, dcz = dz - cz;
	const denom = dabx * dcz - dabz * dcx;
	if (Math.abs(denom) < 1e-14) return null; // parallel/collinear
	const ex = cx - ax, ez = cz - az;
	const tAB = (ex * dcz - ez * dcx) / denom;
	const tCD = (ex * dabz - ez * dabx) / denom;
	const eps = TOL / Math.max(1, Math.sqrt(dabx * dabx + dabz * dabz));
	const epsCD = TOL / Math.max(1, Math.sqrt(dcx * dcx + dcz * dcz));
	if (tAB < eps || tAB > 1 - eps) return null; // not interior to AB
	if (tCD < epsCD || tCD > 1 - epsCD) return null; // not interior to CD
	return { tAB, tCD };
}

// Are two segments collinear (same infinite line) within tolerance?
function areCollinear(
	ax: number, az: number, bx: number, bz: number,
	cx: number, cz: number, dx: number, dz: number
): boolean {
	const dx1 = bx - ax, dz1 = bz - az;
	const len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1);
	if (len1 < 1e-12) return false;
	// direction perpendicular to AB: (-dz1, dx1) / len1
	// project C and D onto this perp and check distance
	const perpX = -dz1 / len1, perpZ = dx1 / len1;
	const distC = Math.abs((cx - ax) * perpX + (cz - az) * perpZ);
	const distD = Math.abs((dx - ax) * perpX + (dz - az) * perpZ);
	return distC <= TOL && distD <= TOL;
}

// For collinear segments AB and CD, compute their overlap on AB's line.
// Returns the overlap as t values on AB's parameterization, or null if no overlap/touch.
function collinearOverlap(
	ax: number, az: number, bx: number, bz: number,
	cx: number, cz: number, dx: number, dz: number,
	allowGapTol: boolean
): { tStart: number; tEnd: number } | null {
	const dabx = bx - ax, dabz = bz - az;
	const len2 = dabx * dabx + dabz * dabz;
	if (len2 < 1e-24) return null;
	// Project C and D onto AB
	const tC = ((cx - ax) * dabx + (cz - az) * dabz) / len2;
	const tD = ((dx - ax) * dabx + (dz - az) * dabz) / len2;
	const tMin = Math.min(tC, tD);
	const tMax = Math.max(tC, tD);
	const gapTol = allowGapTol ? TOL / Math.sqrt(len2) : 0;
	// Overlap with [0,1] extended by gap tolerance
	const oStart = Math.max(0, tMin);
	const oEnd = Math.min(1, tMax);
	if (oEnd + gapTol < oStart) return null; // gap too large
	return { tStart: Math.max(0, oStart), tEnd: Math.min(1, oEnd) };
}

type RawSeg = {
	sx: number; sz: number;
	ex: number; ez: number;
	verticalEvidenceIds: string[];
	logicalObjectId: string;
	classificationUnitIds: string[];
	materialIds: number[];
	storeyCandidateId: string;
};

function mergeOwnership(a: RawSeg, b: RawSeg): Pick<RawSeg, 'verticalEvidenceIds' | 'logicalObjectId' | 'classificationUnitIds' | 'materialIds'> {
	const ids = [...new Set([...a.verticalEvidenceIds, ...b.verticalEvidenceIds])].sort();
	const units = [...new Set([...a.classificationUnitIds, ...b.classificationUnitIds])].sort();
	const mats = [...new Set([...a.materialIds, ...b.materialIds])].sort((x, y) => x - y);
	const logObjs = [...new Set([...a.logicalObjectId.split('|'), ...b.logicalObjectId.split('|')])].sort();
	return {
		verticalEvidenceIds: ids,
		logicalObjectId: logObjs.join('|'),
		classificationUnitIds: units,
		materialIds: mats
	};
}

export function normalizeBarrierGraph(graph: BarrierGraph): NormalizedBarrierGraph {
	const nodesBefore = graph.nodes.length;
	const edgesBefore = graph.edges.length;
	const componentsBefore = graph.components.length;

	let endpointsSnapped = 0;
	let intersectionsFound = 0;
	let tJunctionsFound = 0;
	let edgesSplit = 0;
	let collinearOverlapsMerged = 0;
	let duplicateSubsegmentsRemoved = 0;
	let zeroLengthRejected = 0;

	// -------------------------------------------------------------------------
	// Step 1: Convert edges to raw working segments
	// -------------------------------------------------------------------------
	let segs: RawSeg[] = graph.edges.map(e => ({
		sx: e.start.x, sz: e.start.z,
		ex: e.end.x, ez: e.end.z,
		verticalEvidenceIds: [...e.verticalEvidenceIds],
		logicalObjectId: e.logicalObjectId,
		classificationUnitIds: [...e.classificationUnitIds],
		materialIds: [...e.materialIds],
		storeyCandidateId: e.storeyCandidateId
	}));

	// -------------------------------------------------------------------------
	// Step 2: Collect all endpoints, snap nearby ones together (union-find on coords)
	// -------------------------------------------------------------------------
	// All endpoints (2 per segment)
	const allPts: Array<{ x: number; z: number }> = [];
	for (const s of segs) {
		allPts.push({ x: s.sx, z: s.sz });
		allPts.push({ x: s.ex, z: s.ez });
	}

	// Sort by x then z for sweep
	const sortedIdx = Array.from({ length: allPts.length }, (_, i) => i);
	sortedIdx.sort((a, b) => {
		if (allPts[a].x !== allPts[b].x) return allPts[a].x - allPts[b].x;
		return allPts[a].z - allPts[b].z;
	});

	const uf = Array.from({ length: allPts.length }, (_, i) => i);
	function find(i: number): number {
		while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; }
		return i;
	}
	function union(i: number, j: number): void {
		const ri = find(i), rj = find(j);
		if (ri !== rj) uf[ri < rj ? rj : ri] = ri < rj ? ri : rj;
	}

	for (let ii = 0; ii < sortedIdx.length; ii++) {
		const ai = sortedIdx[ii];
		const pa = allPts[ai];
		for (let jj = ii + 1; jj < sortedIdx.length; jj++) {
			const bj = sortedIdx[jj];
			const pb = allPts[bj];
			if (pb.x - pa.x > TOL) break;
			if (dist2(pa.x, pa.z, pb.x, pb.z) <= TOL2) {
				union(ai, bj);
				endpointsSnapped++;
			}
		}
	}

	// Compute snapped coordinate for each group (use smallest sorted index's coords)
	const groupCoord = new Map<number, { x: number; z: number }>();
	for (let i = 0; i < allPts.length; i++) {
		const root = find(i);
		if (!groupCoord.has(root)) {
			groupCoord.set(root, { x: quantizeCoord(allPts[root].x), z: quantizeCoord(allPts[root].z) });
		}
	}

	// Apply snapping to all segments
	for (let si = 0; si < segs.length; si++) {
		const base = si * 2;
		const sc = groupCoord.get(find(base))!;
		const ec = groupCoord.get(find(base + 1))!;
		segs[si].sx = sc.x; segs[si].sz = sc.z;
		segs[si].ex = ec.x; segs[si].ez = ec.z;
	}

	// -------------------------------------------------------------------------
	// Step 3: Find all crossings and T-junctions, collect split points per segment
	// -------------------------------------------------------------------------
	// For each segment i, a sorted list of t values where it should be split
	const splitTs: Map<number, number[]> = new Map();
	// Intersection and T-junction node coordinates — collinear merge must not cross these
	const splitNodeKeys = new Set<string>();
	function addSplit(segIdx: number, t: number, nodeKey?: string): void {
		if (!splitTs.has(segIdx)) splitTs.set(segIdx, []);
		splitTs.get(segIdx)!.push(t);
		if (nodeKey) splitNodeKeys.add(nodeKey);
	}

	const n = segs.length;
	for (let i = 0; i < n; i++) {
		const si = segs[i];
		if (planLength2(si.sx, si.sz, si.ex, si.ez) < TOL2 * 4) continue;
		for (let j = i + 1; j < n; j++) {
			const sj = segs[j];
			if (planLength2(sj.sx, sj.sz, sj.ex, sj.ez) < TOL2 * 4) continue;

			// Check collinearity first - collinear segments handled in step 4
			if (areCollinear(si.sx, si.sz, si.ex, si.ez, sj.sx, sj.sz, sj.ex, sj.ez)) continue;

			// Check proper crossing
			const cross = segmentCrossing(si.sx, si.sz, si.ex, si.ez, sj.sx, sj.sz, sj.ex, sj.ez);
			if (cross !== null) {
				intersectionsFound++;
				const dabx = si.ex - si.sx, dabz = si.ez - si.sz;
				const ixX = quantizeCoord(si.sx + cross.tAB * dabx);
				const ixZ = quantizeCoord(si.sz + cross.tAB * dabz);
				const ixKey = coord2Key(ixX, ixZ);
				addSplit(i, cross.tAB, ixKey);
				addSplit(j, cross.tCD, ixKey);
				edgesSplit += 2;
				continue;
			}

			// Check T-junctions: endpoint of j lies interior to i
			const siAbx = si.ex - si.sx, siAbz = si.ez - si.sz;
			const siLen2 = siAbx * siAbx + siAbz * siAbz;
			if (siLen2 >= TOL2 * 4) {
				for (const [px, pz] of [[sj.sx, sj.sz], [sj.ex, sj.ez]]) {
					const proj = projectPointOnSegment(px, pz, si.sx, si.sz, si.ex, si.ez);
					if (proj.distSq <= TOL2 && proj.t > TOL / Math.sqrt(siLen2) && proj.t < 1 - TOL / Math.sqrt(siLen2)) {
						tJunctionsFound++;
						const tjKey = coord2Key(quantizeCoord(px), quantizeCoord(pz));
						addSplit(i, proj.t, tjKey);
						edgesSplit++;
					}
				}
			}

			// Check T-junctions: endpoint of i lies interior to j
			const sjAbx = sj.ex - sj.sx, sjAbz = sj.ez - sj.sz;
			const sjLen2 = sjAbx * sjAbx + sjAbz * sjAbz;
			if (sjLen2 >= TOL2 * 4) {
				for (const [px, pz] of [[si.sx, si.sz], [si.ex, si.ez]]) {
					const proj = projectPointOnSegment(px, pz, sj.sx, sj.sz, sj.ex, sj.ez);
					if (proj.distSq <= TOL2 && proj.t > TOL / Math.sqrt(sjLen2) && proj.t < 1 - TOL / Math.sqrt(sjLen2)) {
						tJunctionsFound++;
						const tjKey = coord2Key(quantizeCoord(px), quantizeCoord(pz));
						addSplit(j, proj.t, tjKey);
						edgesSplit++;
					}
				}
			}
		}
	}

	// -------------------------------------------------------------------------
	// Step 4: Apply splits — produce sub-segments
	// -------------------------------------------------------------------------
	const splitSegs: RawSeg[] = [];
	for (let i = 0; i < n; i++) {
		const s = segs[i];
		const len2 = planLength2(s.sx, s.sz, s.ex, s.ez);
		if (!splitTs.has(i) || len2 < TOL2 * 4) {
			if (len2 >= TOL2 * 4) splitSegs.push(s);
			else zeroLengthRejected++;
			continue;
		}
		const ts = [...new Set(splitTs.get(i)!)].sort((a, b) => a - b);
		// Add 0 and 1 boundaries
		const allT = [0, ...ts.filter(t => t > 1e-9 && t < 1 - 1e-9), 1];
		const abx = s.ex - s.sx, abz = s.ez - s.sz;
		for (let k = 0; k < allT.length - 1; k++) {
			const t0 = allT[k], t1 = allT[k + 1];
			const sx = quantizeCoord(s.sx + t0 * abx), sz = quantizeCoord(s.sz + t0 * abz);
			const ex = quantizeCoord(s.sx + t1 * abx), ez = quantizeCoord(s.sz + t1 * abz);
			if (planLength2(sx, sz, ex, ez) < TOL2 * 4) { zeroLengthRejected++; continue; }
			splitSegs.push({
				sx, sz, ex, ez,
				verticalEvidenceIds: [...s.verticalEvidenceIds],
				logicalObjectId: s.logicalObjectId,
				classificationUnitIds: [...s.classificationUnitIds],
				materialIds: [...s.materialIds],
				storeyCandidateId: s.storeyCandidateId
			});
		}
	}

	// -------------------------------------------------------------------------
	// Step 5: Collinear overlap/touching merge
	// -------------------------------------------------------------------------
	// Group segments by their line (direction + offset bucket)
	// For each collinear group, merge overlapping/touching sub-segments
	function segLineKey(sx: number, sz: number, ex: number, ez: number): string {
		const dx = ex - sx, dz = ez - sz;
		const len = Math.sqrt(dx * dx + dz * dz);
		if (len < 1e-12) return `zero`;
		// Normalize direction, force canonical direction
		let nx = dx / len, nz = dz / len;
		if (nx < -1e-9 || (Math.abs(nx) < 1e-9 && nz < 0)) { nx = -nx; nz = -nz; }
		// Quantize direction to 3 decimal places
		const qnx = Math.round(nx * 1000) / 1000;
		const qnz = Math.round(nz * 1000) / 1000;
		// Distance from origin to line (perp offset)
		const perpDist = Math.round((-nz * sx + nx * sz) * 1000) / 1000;
		return `${qnx}_${qnz}_${perpDist}`;
	}

	const lineGroups = new Map<string, number[]>();
	for (let i = 0; i < splitSegs.length; i++) {
		const s = splitSegs[i];
		const key = segLineKey(s.sx, s.sz, s.ex, s.ez);
		if (!lineGroups.has(key)) lineGroups.set(key, []);
		lineGroups.get(key)!.push(i);
	}

	const mergedSegs: RawSeg[] = [];
	const processedSplitIdx = new Set<number>();

	for (const [, group] of lineGroups.entries()) {
		if (group.length === 1) {
			mergedSegs.push(splitSegs[group[0]]);
			processedSplitIdx.add(group[0]);
			continue;
		}

		// For each segment in the group, try to merge with collinear neighbours
		// Use a union-find to group overlapping/touching segments
		const guf = Array.from({ length: group.length }, (_, i) => i);
		function gfind(i: number): number {
			while (guf[i] !== i) { guf[i] = guf[guf[i]]; i = guf[i]; }
			return i;
		}
		function gunion(i: number, j: number): void {
			const ri = gfind(i), rj = gfind(j);
			if (ri !== rj) guf[ri < rj ? rj : ri] = ri < rj ? ri : rj;
		}

		// Pairwise check for overlap/touch within group
		for (let gi = 0; gi < group.length; gi++) {
			const si = splitSegs[group[gi]];
			for (let gj = gi + 1; gj < group.length; gj++) {
				const sj = splitSegs[group[gj]];
				if (!areCollinear(si.sx, si.sz, si.ex, si.ez, sj.sx, sj.sz, sj.ex, sj.ez)) continue;
				const ov = collinearOverlap(si.sx, si.sz, si.ex, si.ez, sj.sx, sj.sz, sj.ex, sj.ez, true);
				if (ov !== null) gunion(gi, gj);
			}
		}

		// Gather merge groups
		const mergeMap = new Map<number, number[]>();
		for (let gi = 0; gi < group.length; gi++) {
			const root = gfind(gi);
			if (!mergeMap.has(root)) mergeMap.set(root, []);
			mergeMap.get(root)!.push(gi);
		}

		for (const [, gIndices] of mergeMap.entries()) {
			if (gIndices.length === 1) {
				mergedSegs.push(splitSegs[group[gIndices[0]]]);
			} else {
				// Merge all segments in this collinear cluster into one or more non-overlapping segments
				// Project all endpoints onto the first segment's line
				const ref = splitSegs[group[gIndices[0]]];
				const abx = ref.ex - ref.sx, abz = ref.ez - ref.sz;
				const len2 = abx * abx + abz * abz;

				const intervals: Array<{ t0: number; t1: number; seg: RawSeg }> = [];
				for (const gi of gIndices) {
					const s = splitSegs[group[gi]];
					// Project s's endpoints onto ref's line (unbounded)
					const tS = len2 > 0 ? ((s.sx - ref.sx) * abx + (s.sz - ref.sz) * abz) / len2 : 0;
					const tE = len2 > 0 ? ((s.ex - ref.sx) * abx + (s.ez - ref.sz) * abz) / len2 : 0;
					intervals.push({ t0: Math.min(tS, tE), t1: Math.max(tS, tE), seg: s });
				}
				// Sort intervals by t0
				intervals.sort((a, b) => a.t0 - b.t0);

				// Merge overlapping/touching intervals — but do NOT merge across intersection/T-junction nodes
				let merged = ownershipFrom(intervals[0]);
				for (let m = 1; m < intervals.length; m++) {
					const iv = intervals[m];
					const gapTol = TOL / Math.sqrt(Math.max(len2, 1e-24));
					// Compute world coord at the boundary between merged and next interval
					const boundX = quantizeCoord(ref.sx + merged.t1 * abx);
					const boundZ = quantizeCoord(ref.sz + merged.t1 * abz);
					const boundKey = coord2Key(boundX, boundZ);
					const isSplitNode = splitNodeKeys.has(boundKey);
					if (!isSplitNode && iv.t0 <= merged.t1 + gapTol) {
						// Merge — overlapping or touching without split barrier
						if (iv.t1 > merged.t1) merged.t1 = iv.t1;
						const mergedAsRaw = { sx: 0, sz: 0, ex: 0, ez: 0, ...merged } as RawSeg;
						const mo = mergeOwnership(mergedAsRaw, iv.seg);
						merged.verticalEvidenceIds = mo.verticalEvidenceIds;
						merged.logicalObjectId = mo.logicalObjectId;
						merged.classificationUnitIds = mo.classificationUnitIds;
						merged.materialIds = mo.materialIds;
						collinearOverlapsMerged++;
					} else {
						// Flush current, start new
						const mSeg = intervalToSeg(merged, ref, abx, abz);
						if (mSeg) mergedSegs.push(mSeg);
						merged = ownershipFrom(iv);
					}
				}
				const last = intervalToSeg(merged, ref, abx, abz);
				if (last) mergedSegs.push(last);
			}
			for (const gi of gIndices) processedSplitIdx.add(group[gi]);
		}
	}

	type MergeState = { t0: number; t1: number; verticalEvidenceIds: string[]; logicalObjectId: string; classificationUnitIds: string[]; materialIds: number[]; storeyCandidateId: string };
	function ownershipFrom(iv: { t0: number; t1: number; seg: RawSeg }): MergeState {
		return {
			t0: iv.t0, t1: iv.t1,
			verticalEvidenceIds: [...iv.seg.verticalEvidenceIds],
			logicalObjectId: iv.seg.logicalObjectId,
			classificationUnitIds: [...iv.seg.classificationUnitIds],
			materialIds: [...iv.seg.materialIds],
			storeyCandidateId: iv.seg.storeyCandidateId
		};
	}
	function intervalToSeg(iv: MergeState, ref: RawSeg, abx: number, abz: number): RawSeg | null {
		const sx = quantizeCoord(ref.sx + iv.t0 * abx), sz = quantizeCoord(ref.sz + iv.t0 * abz);
		const ex = quantizeCoord(ref.sx + iv.t1 * abx), ez = quantizeCoord(ref.sz + iv.t1 * abz);
		if (planLength2(sx, sz, ex, ez) < TOL2 * 4) { zeroLengthRejected++; return null; }
		return {
			sx, sz, ex, ez,
			verticalEvidenceIds: iv.verticalEvidenceIds,
			logicalObjectId: iv.logicalObjectId,
			classificationUnitIds: iv.classificationUnitIds,
			materialIds: iv.materialIds,
			storeyCandidateId: iv.storeyCandidateId
		};
	}

	// -------------------------------------------------------------------------
	// Step 6: Deduplicate (same canonical endpoint pair)
	// -------------------------------------------------------------------------
	const edgeKeyMap = new Map<string, RawSeg>();
	for (const s of mergedSegs) {
		// canonical direction: smaller node key first
		const kA = coord2Key(s.sx, s.sz), kB = coord2Key(s.ex, s.ez);
		const edgeKey = kA < kB ? `${kA}__${kB}` : `${kB}__${kA}`;
		const existing = edgeKeyMap.get(edgeKey);
		if (existing) {
			duplicateSubsegmentsRemoved++;
			const mo = mergeOwnership(existing, s);
			existing.verticalEvidenceIds = mo.verticalEvidenceIds;
			existing.logicalObjectId = mo.logicalObjectId;
			existing.classificationUnitIds = mo.classificationUnitIds;
			existing.materialIds = mo.materialIds;
		} else {
			edgeKeyMap.set(edgeKey, s);
		}
	}

	const finalSegs = [...edgeKeyMap.values()];

	// -------------------------------------------------------------------------
	// Step 7: Rebuild nodes, edges, and components
	// -------------------------------------------------------------------------
	const nodeMap = new Map<string, BarrierGraphNode>();
	const finalEdges: BarrierGraphEdge[] = [];

	for (const s of finalSegs) {
		const kA = coord2Key(s.sx, s.sz), kB = coord2Key(s.ex, s.ez);
		const nodeAId = generateBarrierNodeId(s.sx, s.sz);
		const nodeBId = generateBarrierNodeId(s.ex, s.ez);
		if (!nodeMap.has(kA)) nodeMap.set(kA, { id: nodeAId, coord: { x: s.sx, z: s.sz } });
		if (!nodeMap.has(kB)) nodeMap.set(kB, { id: nodeBId, coord: { x: s.ex, z: s.ez } });

		const [firstNodeId, secondNodeId] = [nodeAId, nodeBId].sort();
		const edgeId = generateBarrierEdgeId(nodeAId, nodeBId);
		const pStart = firstNodeId === nodeAId ? { x: s.sx, z: s.sz } : { x: s.ex, z: s.ez };
		const pEnd = firstNodeId === nodeAId ? { x: s.ex, z: s.ez } : { x: s.sx, z: s.sz };

		finalEdges.push({
			id: edgeId,
			nodeAId: firstNodeId,
			nodeBId: secondNodeId,
			start: pStart,
			end: pEnd,
			originalStart: pStart,
			originalEnd: pEnd,
			verticalEvidenceIds: [...s.verticalEvidenceIds].sort(),
			logicalObjectId: s.logicalObjectId,
			classificationUnitIds: [...s.classificationUnitIds].sort(),
			materialIds: [...s.materialIds].sort((a, b) => a - b),
			storeyCandidateId: s.storeyCandidateId
		});
	}

	// Build a reverse map from node id → coord-key for component union-find
	const nodeIdToCoordKey = new Map<string, string>();
	for (const [coordKey, node] of nodeMap.entries()) {
		nodeIdToCoordKey.set(node.id, coordKey);
	}

	const nodeIds = [...nodeMap.keys()].sort();
	const nodeParent = new Map<string, string>(nodeIds.map(id => [id, id]));

	function findNode(id: string): string {
		let root = id;
		while (nodeParent.get(root) !== root) root = nodeParent.get(root)!;
		let curr = id;
		while (curr !== root) { const nxt = nodeParent.get(curr)!; nodeParent.set(curr, root); curr = nxt; }
		return root;
	}
	function unionNodes(id1: string, id2: string): void {
		const r1 = findNode(id1), r2 = findNode(id2);
		if (r1 !== r2) nodeParent.set(r1 < r2 ? r2 : r1, r1 < r2 ? r1 : r2);
	}

	// Union using coord-keys resolved from node IDs
	for (const edge of finalEdges) {
		const ckA = nodeIdToCoordKey.get(edge.nodeAId);
		const ckB = nodeIdToCoordKey.get(edge.nodeBId);
		if (ckA && ckB) unionNodes(ckA, ckB);
	}

	const compGroups = new Map<string, string[]>();
	for (const id of nodeIds) {
		const root = findNode(id);
		if (!compGroups.has(root)) compGroups.set(root, []);
		// Store node IDs (not coord-keys) in components for external consumers
		compGroups.get(root)!.push(nodeMap.get(id)!.id);
	}

	const components: string[][] = [];
	for (const list of compGroups.values()) { list.sort(); components.push(list); }
	components.sort((a, b) => a[0].localeCompare(b[0]));

	// Compute degree
	const degree = new Map<string, number>();
	for (const edge of finalEdges) {
		degree.set(edge.nodeAId, (degree.get(edge.nodeAId) ?? 0) + 1);
		degree.set(edge.nodeBId, (degree.get(edge.nodeBId) ?? 0) + 1);
	}

	let degree1Nodes = 0, degree2Nodes = 0, degree3PlusNodes = 0;
	for (const [, deg] of degree.entries()) {
		if (deg === 1) degree1Nodes++;
		else if (deg === 2) degree2Nodes++;
		else degree3PlusNodes++;
	}

	const nodes = [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
	const sortedEdges = [...finalEdges].sort((a, b) => a.id.localeCompare(b.id));

	const normDiag: BarrierGraphNormalizationDiagnostics = {
		nodesBefore,
		nodesAfter: nodes.length,
		edgesBefore,
		edgesAfter: sortedEdges.length,
		componentsBefore,
		componentsAfter: components.length,
		endpointsSnapped,
		intersectionsFound,
		tJunctionsFound,
		edgesSplit,
		collinearOverlapsMerged,
		duplicateSubsegmentsRemoved,
		zeroLengthRejected,
		degree1Nodes,
		degree2Nodes,
		degree3PlusNodes
	};

	return {
		storeyCandidateId: graph.storeyCandidateId,
		nodes,
		edges: sortedEdges,
		components,
		diagnostics: {
			...graph.diagnostics,
			graphNodes: nodes.length,
			graphEdges: sortedEdges.length,
			connectedComponents: components.length
		},
		normalizationDiagnostics: normDiag
	};
}
