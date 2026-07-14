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
