import type { GeometryFoundation, SurfaceClusterRecord, Vec3 } from '../geometry';

export { buildClassificationUnitHighlight } from './highlight';

export const TIER1_SURFACE_ROLES = ['wall', 'floor', 'ceiling', 'roof', 'unknown'] as const;
export type SurfaceRole = (typeof TIER1_SURFACE_ROLES)[number];

// Reserved for a later object-level classifier. It deliberately does not compete
// with SurfaceRole: a door can contain wall-like, glazing, and hardware surfaces.
export const OBJECT_CATEGORIES = ['door', 'window', 'opening', 'column', 'beam', 'stair', 'railing', 'furniture', 'fixture', 'other'] as const;
export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

export const TIER1_ANNOTATION_FORMAT = 'tier1_surface_ground_truth/1.0.0';
export const ANNOTATION_STATUSES = ['proposed', 'verified', 'ambiguous', 'excluded'] as const;
export const ANNOTATION_CONFIDENCES = ['high', 'medium', 'low'] as const;
export const SOURCE_LABEL_RELIABILITY = ['correct', 'incorrect', 'absent', 'ambiguous'] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];
export type AnnotationConfidence = (typeof ANNOTATION_CONFIDENCES)[number];
export type SourceLabelReliability = (typeof SOURCE_LABEL_RELIABILITY)[number];

export const CLASSIFICATION_UNIT_TOLERANCES = {
	adjacencyM: 0.004,
	elevationDiscontinuityM: 0.15,
	mergeNormalAngleDeg: 8,
	mergeCoplanarityM: 0.002,
	spatialIndexCellM: 0.5,
	splitMaterialBoundaries: true
} as const;

export type ClassificationUnitRecord = {
	id: string;
	modelId: string;
	logicalObjectId: string;
	surfaceClusterIds: string[];
	sourceNodeIds: string[];
	sourcePrimitiveIds: string[];
	sourceIdentityRefs: string[];
	instancePath: string;
	worldBounds: { min: Vec3; max: Vec3; size: Vec3; center: Vec3 };
	centroid: Vec3;
	areaM2: number;
	triangleCount: number;
	materialIds: number[];
	upwardHorizontalAreaRatio: number;
	downwardHorizontalAreaRatio: number;
	verticalAreaRatio: number;
	slopedAreaRatio: number;
	dominantNormal: Vec3;
	minElevation: number;
	maxElevation: number;
	relativeMinElevation: number;
	relativeMaxElevation: number;
	candidateLevelRelations: Array<{ elevation: number; deltaM: number; confidence: number }>;
	adjacencyUnitIds: string[];
	boundaryEdgeCount: number;
	sourceNames: string[];
	sourceTags: string[];
	groupingReasons: string[];
};

export type Tier1AnnotationRecord = {
	modelId: string;
	sourceExportHash: string;
	classificationUnitId: string;
	logicalObjectId: string;
	surfaceClusterIds: string[];
	expectedSurfaceRole: SurfaceRole;
	status: AnnotationStatus;
	annotationConfidence: AnnotationConfidence;
	evidenceNote: string;
	sourceLabelReliability: SourceLabelReliability;
	screenshotReferences: string[];
	annotatedAt: string;
	reviewer: string;
	split: 'train' | 'holdout';
};

export type Tier1AnnotationDocument = {
	format: typeof TIER1_ANNOTATION_FORMAT;
	modelId: string;
	sourceExportHash: string;
	split: 'train' | 'holdout';
	metadata: { rationale: string; generatedAt: string };
	annotations: Tier1AnnotationRecord[];
};

export type ClassificationUnitProgress = {
	processedLogicalObjects: number;
	totalLogicalObjects: number;
	unitsDiscovered: number;
	cancelled: boolean;
	elapsedMs: number;
	addedUnits?: ClassificationUnitRecord[];
};

export type ClassificationUnitCounters = {
	logicalObjectsProcessed: number;
	clusterCacheHits: number;
	clusterCacheMisses: number;
	compatibleClusterComparisons: number;
	unitAdjacencyComparisons: number;
	unitAdjacencyPairs: number;
	globalUnitPairScans: number;
};

/**
 * Incremental, per-logical-object unit builder. It never compares units from
 * unrelated logical objects, so processing order cannot change unit identity.
 */
export class ClassificationUnitIndex {
	private readonly objects: ReturnType<GeometryFoundation['buildLogicalObjectIndex']>['objects'];
	private readonly unitsByObject = new Map<string, ClassificationUnitRecord[]>();
	private nextObjectIndex = 0;
	private unitCount = 0;
	private cancelled = false;
	private readonly startedAt = performance.now();
	readonly counters: ClassificationUnitCounters = {
		logicalObjectsProcessed: 0,
		clusterCacheHits: 0,
		clusterCacheMisses: 0,
		compatibleClusterComparisons: 0,
		unitAdjacencyComparisons: 0,
		unitAdjacencyPairs: 0,
		globalUnitPairScans: 0
	};

	constructor(readonly foundation: GeometryFoundation, readonly modelId = modelIdentifier(foundation)) {
		this.objects = foundation.buildLogicalObjectIndex().objects;
	}

	get progress(): ClassificationUnitProgress {
		return {
			processedLogicalObjects: this.nextObjectIndex,
			totalLogicalObjects: this.objects.length,
			unitsDiscovered: this.unitCount,
			cancelled: this.cancelled,
			elapsedMs: performance.now() - this.startedAt
		};
	}

	get units(): ClassificationUnitRecord[] {
		return [...this.unitsByObject.values()].flat().sort((left, right) => left.id.localeCompare(right.id));
	}

	get complete() { return this.nextObjectIndex >= this.objects.length; }

	cancel() { this.cancelled = true; }

	resume() { this.cancelled = false; }

	processNext() {
		if (this.cancelled || this.complete) return this.progress;
		const units = this.processObject(this.objects[this.nextObjectIndex].id);
		this.nextObjectIndex += 1;
		return { ...this.progress, addedUnits: units };
	}

	processObject(logicalObjectId: string) {
		const existing = this.unitsByObject.get(logicalObjectId);
		if (existing) return existing;
		const object = this.objects.find((candidate) => candidate.id === logicalObjectId);
		if (!object) throw new Error(`Logical object ${logicalObjectId} missing.`);
		const node = this.foundation.instanceGraph.byNodeId.get(object.nodeId);
		if (!node) throw new Error(`Logical object ${logicalObjectId} has no instance node.`);
		const beforeGeometry = this.foundation.getDiagnostics();
		const clusters = this.foundation.buildSurfaceClusters(object.id);
		const afterGeometry = this.foundation.getDiagnostics();
		this.counters.clusterCacheHits += afterGeometry.clusterCacheHits - beforeGeometry.clusterCacheHits;
		this.counters.clusterCacheMisses += afterGeometry.clusterCacheMisses - beforeGeometry.clusterCacheMisses;
		const units = groupCompatibleClusters(clusters, this.counters).map((group) => unitFromClusters(this.modelId, object, group, node, this.foundation.modelContext));
		finalizeObjectUnits(units, this.counters);
		this.unitsByObject.set(logicalObjectId, units);
		this.unitCount += units.length;
		this.counters.logicalObjectsProcessed += 1;
		return units;
	}

	processAll() {
		while (!this.complete && !this.cancelled) this.processNext();
		return this.units;
	}
}

export function createClassificationUnitIndex(foundation: GeometryFoundation, modelId = modelIdentifier(foundation)) {
	return new ClassificationUnitIndex(foundation, modelId);
}

export function buildClassificationUnits(foundation: GeometryFoundation, modelId = modelIdentifier(foundation)): { units: ClassificationUnitRecord[]; foundation: GeometryFoundation; counters: ClassificationUnitCounters } {
	const index = createClassificationUnitIndex(foundation, modelId);
	return { units: index.processAll(), foundation, counters: index.counters };
}

export type AnnotationOrientationFilter = 'all' | 'horizontal' | 'vertical' | 'sloped' | 'mixed';
export type AnnotationUnitSort = 'area-desc' | 'elevation-asc' | 'logical-object' | 'orientation-consistency' | 'source-name' | 'unit-id';
export type AnnotationUnitFilters = {
	logicalObjectId?: string;
	orientation?: AnnotationOrientationFilter;
	minimumAreaM2?: number;
	maximumAreaM2?: number;
	minimumElevationM?: number;
	maximumElevationM?: number;
	materialId?: number;
	sourcePresence?: 'all' | 'present' | 'absent';
	status?: 'all' | 'unreviewed' | AnnotationStatus;
	confidence?: 'all' | AnnotationConfidence;
};

export function classificationUnitFingerprint(units: readonly ClassificationUnitRecord[]) {
	return JSON.stringify(units.map((unit) => ({
		id: unit.id,
		logicalObjectId: unit.logicalObjectId,
		surfaceClusterIds: [...unit.surfaceClusterIds].sort(),
		sourcePrimitiveIds: [...unit.sourcePrimitiveIds].sort(),
		materialIds: [...unit.materialIds].sort((left, right) => left - right),
		bounds: [unit.worldBounds.min.x, unit.worldBounds.min.y, unit.worldBounds.min.z, unit.worldBounds.max.x, unit.worldBounds.max.y, unit.worldBounds.max.z].map((value) => Number(value.toFixed(6)))
	})).sort((left, right) => left.id.localeCompare(right.id)));
}

export function buildAnnotationReviewQueue(units: readonly ClassificationUnitRecord[], records: ReadonlyMap<string, Tier1AnnotationRecord>, filters: AnnotationUnitFilters = {}, sort: AnnotationUnitSort = 'unit-id') {
	const filtered = units.filter((unit) => annotationUnitMatches(unit, records.get(unit.id), filters));
	return filtered.sort(annotationUnitComparator(sort));
}

function annotationUnitMatches(unit: ClassificationUnitRecord, record: Tier1AnnotationRecord | undefined, filters: AnnotationUnitFilters) {
	if (filters.logicalObjectId && filters.logicalObjectId !== 'all' && unit.logicalObjectId !== filters.logicalObjectId) return false;
	if (filters.orientation && filters.orientation !== 'all' && annotationOrientation(unit) !== filters.orientation) return false;
	if (filters.minimumAreaM2 !== undefined && unit.areaM2 < filters.minimumAreaM2) return false;
	if (filters.maximumAreaM2 !== undefined && unit.areaM2 > filters.maximumAreaM2) return false;
	if (filters.minimumElevationM !== undefined && unit.minElevation < filters.minimumElevationM) return false;
	if (filters.maximumElevationM !== undefined && unit.maxElevation > filters.maximumElevationM) return false;
	if (filters.materialId !== undefined && !unit.materialIds.includes(filters.materialId)) return false;
	const sourcePresent = unit.sourceNames.length > 0 || unit.sourceTags.length > 0;
	if (filters.sourcePresence === 'present' && !sourcePresent) return false;
	if (filters.sourcePresence === 'absent' && sourcePresent) return false;
	if (filters.status === 'unreviewed' && record) return false;
	if (filters.status && filters.status !== 'all' && filters.status !== 'unreviewed' && record?.status !== filters.status) return false;
	if (filters.confidence && filters.confidence !== 'all' && record?.annotationConfidence !== filters.confidence) return false;
	return true;
}

function annotationOrientation(unit: ClassificationUnitRecord): AnnotationOrientationFilter {
	if (unit.upwardHorizontalAreaRatio + unit.downwardHorizontalAreaRatio >= 0.75) return 'horizontal';
	if (unit.verticalAreaRatio >= 0.75) return 'vertical';
	if (unit.slopedAreaRatio >= 0.75) return 'sloped';
	return 'mixed';
}

function annotationUnitComparator(sort: AnnotationUnitSort) {
	return (left: ClassificationUnitRecord, right: ClassificationUnitRecord) => {
		if (sort === 'area-desc') return right.areaM2 - left.areaM2 || left.id.localeCompare(right.id);
		if (sort === 'elevation-asc') return left.minElevation - right.minElevation || left.id.localeCompare(right.id);
		if (sort === 'logical-object') return left.logicalObjectId.localeCompare(right.logicalObjectId) || left.id.localeCompare(right.id);
		if (sort === 'orientation-consistency') return Math.abs(1 - Math.max(left.upwardHorizontalAreaRatio, left.downwardHorizontalAreaRatio, left.verticalAreaRatio, left.slopedAreaRatio)) - Math.abs(1 - Math.max(right.upwardHorizontalAreaRatio, right.downwardHorizontalAreaRatio, right.verticalAreaRatio, right.slopedAreaRatio)) || left.id.localeCompare(right.id);
		if (sort === 'source-name') return left.sourceNames.join('|').localeCompare(right.sourceNames.join('|')) || left.id.localeCompare(right.id);
		return left.id.localeCompare(right.id);
	};
}

function unitFromClusters(modelId: string, object: ReturnType<GeometryFoundation['buildLogicalObjectIndex']>['objects'][number], clusters: SurfaceClusterRecord[], node: GeometryFoundation['instanceGraph']['nodes'][number], context: GeometryFoundation['modelContext']): ClassificationUnitRecord {
	const sortedClusters = [...clusters].sort((left, right) => left.id.localeCompare(right.id));
	const areaM2 = sortedClusters.reduce((sum, cluster) => sum + cluster.areaM2, 0);
	const centroid = weightedCentroid(sortedClusters, areaM2);
	const orientation = combinedOrientation(sortedClusters, areaM2);
	const normal = weightedNormal(sortedClusters, areaM2);
	const bounds = combineClusterBounds(sortedClusters);
	const range = Math.max(context.height, Number.EPSILON);
	const primitiveIds = sortedClusters.flatMap((cluster) => cluster.primitiveIds).sort();
	const unit: ClassificationUnitRecord = {
		id: `unit:${sortedClusters.map((cluster) => cluster.id).join('+')}`,
		modelId,
		logicalObjectId: object.id,
		surfaceClusterIds: sortedClusters.map((cluster) => cluster.id),
		sourceNodeIds: [node.nodeId],
		sourcePrimitiveIds: primitiveIds,
		sourceIdentityRefs: object.sourceIdentity ? [object.sourceIdentity] : [],
		instancePath: object.instancePath,
		worldBounds: bounds,
		centroid,
		areaM2,
		triangleCount: sortedClusters.reduce((sum, cluster) => sum + cluster.triangleRanges.reduce((triangleSum, [, count]) => triangleSum + count / 3, 0), 0),
		materialIds: [...new Set(sortedClusters.flatMap((cluster) => cluster.materialIds))].sort((left, right) => left - right),
		upwardHorizontalAreaRatio: orientation.up,
		downwardHorizontalAreaRatio: orientation.down,
		verticalAreaRatio: orientation.vertical,
		slopedAreaRatio: orientation.sloped,
		dominantNormal: normal,
		minElevation: bounds.min.y,
		maxElevation: bounds.max.y,
		relativeMinElevation: (bounds.min.y - context.bounds.min.y) / range,
		relativeMaxElevation: (bounds.max.y - context.bounds.min.y) / range,
		candidateLevelRelations: context.levelBands.map((level) => ({ elevation: level.elevation, deltaM: Math.abs(centroid.y - level.elevation), confidence: level.confidence })).sort((a, b) => a.deltaM - b.deltaM || a.elevation - b.elevation),
		adjacencyUnitIds: [],
		boundaryEdgeCount: sortedClusters.reduce((sum, cluster) => sum + cluster.boundaryEdgeCount, 0),
		sourceNames: object.sourceName ? [object.sourceName] : [],
		sourceTags: object.sourceTag ? [object.sourceTag] : [],
		groupingReasons: [sortedClusters.length > 1 || sortedClusters[0].primitiveIds.length > 1 ? 'grouped because coplanar and connected' : 'seeded from one coherent surface cluster']
	};
	return unit;
}

function groupCompatibleClusters(clusters: SurfaceClusterRecord[], counters?: ClassificationUnitCounters) {
	const ordered = [...clusters].sort((left, right) => left.id.localeCompare(right.id));
	const parent = ordered.map((_, index) => index);
	const find = (index: number): number => parent[index] === index ? index : parent[index] = find(parent[index]);
	const union = (left: number, right: number) => { const leftRoot = find(left); const rightRoot = find(right); if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot; };
	const cells = new Map<number, number[]>();
	ordered.forEach((cluster, right) => {
		for (const key of neighboringClusterCellHashes(cluster.centroid)) for (const left of cells.get(key) || []) {
			if (counters) counters.compatibleClusterComparisons += 1;
			if (clustersCompatible(ordered[left], cluster)) union(left, right);
		}
		const key = clusterCellHash(cluster.centroid);
		const bucket = cells.get(key);
		if (bucket) bucket.push(right);
		else cells.set(key, [right]);
	});
	const groups = new Map<number, SurfaceClusterRecord[]>();
	ordered.forEach((cluster, index) => {
		const root = find(index);
		const group = groups.get(root);
		if (group) group.push(cluster);
		else groups.set(root, [cluster]);
	});
	return [...groups.values()].sort((left, right) => left.map((cluster) => cluster.id).sort()[0].localeCompare(right.map((cluster) => cluster.id).sort()[0]));
}

function finalizeObjectUnits(units: ClassificationUnitRecord[], counters: ClassificationUnitCounters) {
	if (!units.length) return;
	const adjacency = sweepUnitAdjacency(units, counters);
	for (const unit of units) {
		const peers = adjacency.get(unit.id) || [];
		unit.adjacencyUnitIds = peers.map((peer) => peer.id).sort();
		unit.groupingReasons.push(...splitReasonsFromAdjacency(unit, peers, units.length));
	}
}

/** Exact sweep-and-prune broad phase; all returned pairs still use unitsTouch. */
function sweepUnitAdjacency(units: ClassificationUnitRecord[], counters: ClassificationUnitCounters) {
	const neighbors = new Map(units.map((unit) => [unit.id, [] as ClassificationUnitRecord[]]));
	const ordered = [...units].sort((left, right) => left.worldBounds.min.x - right.worldBounds.min.x || left.id.localeCompare(right.id));
	const active: ClassificationUnitRecord[] = [];
	for (const unit of ordered) {
		const lower = unit.worldBounds.min.x - CLASSIFICATION_UNIT_TOLERANCES.adjacencyM;
		let write = 0;
		for (const candidate of active) if (candidate.worldBounds.max.x >= lower) active[write++] = candidate;
		active.length = write;
		for (const candidate of active) {
			counters.unitAdjacencyComparisons += 1;
			if (!unitsTouch(unit, candidate)) continue;
			neighbors.get(unit.id)!.push(candidate);
			neighbors.get(candidate.id)!.push(unit);
			counters.unitAdjacencyPairs += 1;
		}
		active.push(unit);
	}
	return neighbors;
}

function clusterCellHash(point: Vec3) {
	const cell = CLASSIFICATION_UNIT_TOLERANCES.spatialIndexCellM;
	const cx = Math.floor(point.x / cell);
	const cy = Math.floor(point.y / cell);
	const cz = Math.floor(point.z / cell);
	return ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) >>> 0;
}

function neighboringClusterCellHashes(point: Vec3) {
	const cell = CLASSIFICATION_UNIT_TOLERANCES.spatialIndexCellM;
	const cx = Math.floor(point.x / cell);
	const cy = Math.floor(point.y / cell);
	const cz = Math.floor(point.z / cell);
	const hashes: number[] = [];
	for (let x = -1; x <= 1; x += 1) {
		for (let y = -1; y <= 1; y += 1) {
			for (let z = -1; z <= 1; z += 1) {
				const nx = cx + x;
				const ny = cy + y;
				const nz = cz + z;
				hashes.push(((nx * 73856093) ^ (ny * 19349663) ^ (nz * 83492791)) >>> 0);
			}
		}
	}
	return hashes;
}

const ADJACENCY_TOL2 = CLASSIFICATION_UNIT_TOLERANCES.adjacencyM * CLASSIFICATION_UNIT_TOLERANCES.adjacencyM;

function arraysEqual(a: number[], b: number[]) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function clustersCompatible(left: SurfaceClusterRecord, right: SurfaceClusterRecord) {
	const tol = 0.004;
	const b1 = left.worldBounds;
	const b2 = right.worldBounds;
	if (b1.min.x - b2.max.x > tol || b2.min.x - b1.max.x > tol) return false;
	if (b1.min.y - b2.max.y > tol || b2.min.y - b1.max.y > tol) return false;
	if (b1.min.z - b2.max.z > tol || b2.min.z - b1.max.z > tol) return false;

	if (Math.abs(left.centroid.y - right.centroid.y) > 0.15) return false;

	const normalDot = left.dominantNormal.x * right.dominantNormal.x + left.dominantNormal.y * right.dominantNormal.y + left.dominantNormal.z * right.dominantNormal.z;
	if (normalDot < 0.990268) return false; // Math.cos(8 * Math.PI / 180) is approx 0.990268

	if (CLASSIFICATION_UNIT_TOLERANCES.splitMaterialBoundaries && !arraysEqual(left.materialIds, right.materialIds)) return false;

	if (boundsDistanceSquared(b1, b2) > 0.000016) return false;
	return true;
}

function weightedCentroid(clusters: SurfaceClusterRecord[], area: number): Vec3 {
	if (!area) return clusters[0].centroid;
	const weighted = clusters.reduce((sum, cluster) => ({ x: sum.x + cluster.centroid.x * cluster.areaM2, y: sum.y + cluster.centroid.y * cluster.areaM2, z: sum.z + cluster.centroid.z * cluster.areaM2 }), { x: 0, y: 0, z: 0 } as Vec3);
	return { x: weighted.x / area, y: weighted.y / area, z: weighted.z / area };
}

function combinedOrientation(clusters: SurfaceClusterRecord[], area: number) {
	if (!area) return { up: 0, down: 0, vertical: 0, sloped: 0 };
	const totals = clusters.reduce((result, cluster) => {
		const horizontal = Math.max(0, 1 - cluster.verticalAreaRatio - cluster.slopedAreaRatio);
		if (cluster.dominantNormal.y >= 0) result.up += cluster.areaM2 * horizontal;
		else result.down += cluster.areaM2 * horizontal;
		result.vertical += cluster.areaM2 * cluster.verticalAreaRatio;
		result.sloped += cluster.areaM2 * cluster.slopedAreaRatio;
		return result;
	}, { up: 0, down: 0, vertical: 0, sloped: 0 });
	return { up: totals.up / area, down: totals.down / area, vertical: totals.vertical / area, sloped: totals.sloped / area };
}

function weightedNormal(clusters: SurfaceClusterRecord[], _area: number): Vec3 {
	const sum = clusters.reduce((result, cluster) => ({ x: result.x + cluster.dominantNormal.x * cluster.areaM2, y: result.y + cluster.dominantNormal.y * cluster.areaM2, z: result.z + cluster.dominantNormal.z * cluster.areaM2 }), { x: 0, y: 0, z: 0 } as Vec3);
	const magnitude = Math.hypot(sum.x, sum.y, sum.z);
	return magnitude ? { x: sum.x / magnitude, y: sum.y / magnitude, z: sum.z / magnitude } : clusters[0].dominantNormal;
}

function combineClusterBounds(clusters: SurfaceClusterRecord[]) {
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	for (const cluster of clusters) {
		min.x = Math.min(min.x, cluster.worldBounds.min.x); min.y = Math.min(min.y, cluster.worldBounds.min.y); min.z = Math.min(min.z, cluster.worldBounds.min.z);
		max.x = Math.max(max.x, cluster.worldBounds.max.x); max.y = Math.max(max.y, cluster.worldBounds.max.y); max.z = Math.max(max.z, cluster.worldBounds.max.z);
	}
	const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
	return { min, max, size, center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 } };
}

function splitReasonsFromAdjacency(unit: ClassificationUnitRecord, touchingPeers: ClassificationUnitRecord[], objectUnitCount: number) {
	if (objectUnitCount <= 1) return ['split because source ownership: no compatible cluster shares this logical object'];
	const reasons = new Set<string>();
	if (touchingPeers.length < objectUnitCount - 1) reasons.add('split because disconnected');
	for (const peer of touchingPeers) {
		const dot = unit.dominantNormal.x * peer.dominantNormal.x + unit.dominantNormal.y * peer.dominantNormal.y + unit.dominantNormal.z * peer.dominantNormal.z;
		if (dot < Math.cos(CLASSIFICATION_UNIT_TOLERANCES.mergeNormalAngleDeg * Math.PI / 180)) reasons.add('split because normal angle');
		else if (CLASSIFICATION_UNIT_TOLERANCES.splitMaterialBoundaries && !arraysEqual(unit.materialIds, peer.materialIds)) reasons.add('split because material boundary');
		else if (Math.abs(unit.centroid.y - peer.centroid.y) > CLASSIFICATION_UNIT_TOLERANCES.elevationDiscontinuityM) reasons.add('split because elevation discontinuity');
	}
	return reasons.size ? [...reasons].sort() : ['adjacent compatible cluster retained separately for annotation granularity'];
}

function clusterOrientation(cluster: SurfaceClusterRecord) {
	const horizontal = Math.max(0, 1 - cluster.verticalAreaRatio - cluster.slopedAreaRatio);
	return cluster.dominantNormal.y >= 0
		? { up: horizontal, down: 0 }
		: { up: 0, down: horizontal };
}

function unitsTouch(left: ClassificationUnitRecord, right: ClassificationUnitRecord) {
	if (left.logicalObjectId !== right.logicalObjectId) return false;
	return boundsDistanceSquared(left.worldBounds, right.worldBounds) <= ADJACENCY_TOL2;
}

function boundsDistanceSquared(left: { min: Vec3; max: Vec3 }, right: { min: Vec3; max: Vec3 }) {
	const dx = Math.max(left.min.x - right.max.x, right.min.x - left.max.x, 0);
	const dy = Math.max(left.min.y - right.max.y, right.min.y - left.max.y, 0);
	const dz = Math.max(left.min.z - right.max.z, right.min.z - left.max.z, 0);
	return dx * dx + dy * dy + dz * dz;
}

function modelIdentifier(foundation: GeometryFoundation) {
	const strings = foundation.scene.manifest.strings;
	return strings[foundation.scene.manifest.source.model_name] || strings[foundation.scene.manifest.source.file_name] || 'model';
}

export function createGroundTruthDocument(input: Omit<Tier1AnnotationDocument, 'format' | 'metadata' | 'annotations'> & { annotations: Array<Omit<Tier1AnnotationRecord, 'modelId' | 'sourceExportHash'>>; metadata?: Partial<Tier1AnnotationDocument['metadata']> }): Tier1AnnotationDocument {
	return {
		format: TIER1_ANNOTATION_FORMAT,
		modelId: input.modelId,
		sourceExportHash: input.sourceExportHash,
		split: input.split,
		metadata: { rationale: input.metadata?.rationale || 'Manual Tier-1 annotation; verified records only are eligible for metrics.', generatedAt: input.metadata?.generatedAt || new Date().toISOString() },
		annotations: input.annotations.map((annotation) => ({ ...annotation, modelId: input.modelId, sourceExportHash: input.sourceExportHash, split: input.split, surfaceClusterIds: annotation.surfaceClusterIds.slice().sort(), screenshotReferences: annotation.screenshotReferences.slice() }))
	};
}

export function validateGroundTruthDocument(value: unknown, context: { sourceExportHash: string; units: ClassificationUnitRecord[] }) {
	const errors: string[] = [];
	if (!isDocument(value)) return { valid: false, errors: ['Annotation document shape invalid.'] };
	if (value.format !== TIER1_ANNOTATION_FORMAT) errors.push('Annotation format invalid.');
	if (value.sourceExportHash !== context.sourceExportHash) errors.push('Source export hash mismatch.');
	const units = new Map(context.units.map((unit) => [unit.id, unit]));
	const seen = new Set<string>();
	for (const record of value.annotations) {
		if (!TIER1_SURFACE_ROLES.includes(record.expectedSurfaceRole)) errors.push(`Invalid surface role: ${record.expectedSurfaceRole}`);
		if (!ANNOTATION_STATUSES.includes(record.status)) errors.push(`Invalid status: ${record.status}`);
		if (!ANNOTATION_CONFIDENCES.includes(record.annotationConfidence)) errors.push(`Invalid annotation confidence: ${record.annotationConfidence}`);
		if (!SOURCE_LABEL_RELIABILITY.includes(record.sourceLabelReliability)) errors.push(`Invalid source label reliability: ${record.sourceLabelReliability}`);
		if (seen.has(record.classificationUnitId)) errors.push(`Duplicate classification unit: ${record.classificationUnitId}`);
		seen.add(record.classificationUnitId);
		const unit = units.get(record.classificationUnitId);
		if (!unit) { errors.push(`Unknown classification unit: ${record.classificationUnitId}`); continue; }
		if (record.logicalObjectId !== unit.logicalObjectId) errors.push(`Logical object mismatch: ${record.classificationUnitId}`);
		if (record.surfaceClusterIds.join('|') !== unit.surfaceClusterIds.join('|')) errors.push(`Surface cluster mismatch: ${record.classificationUnitId}`);
	}
	return { valid: errors.length === 0, errors };
}

function isDocument(value: unknown): value is Tier1AnnotationDocument {
	return Boolean(value) && typeof value === 'object' && Array.isArray((value as Tier1AnnotationDocument).annotations) && typeof (value as Tier1AnnotationDocument).modelId === 'string' && typeof (value as Tier1AnnotationDocument).sourceExportHash === 'string';
}

export type Tier1BaselineResult = { verifiedCount: number; support: Record<SurfaceRole, number>; confusionMatrix: Record<SurfaceRole, Record<SurfaceRole, number>>; precision: Partial<Record<SurfaceRole, number>>; recall: Partial<Record<SurfaceRole, number>>; f1: Partial<Record<SurfaceRole, number>>; macroF1: number | null; balancedAccuracy: number | null; unknownPredictionRate: number; ambiguousMixedPredictionRate: number };

export type LegacySurfacePrediction = { surfaceRole: SurfaceRole; areaM2: number };
export type LegacySurfaceAggregation = { predictions: Map<string, SurfaceRole>; ambiguousUnitIds: string[] };

/**
 * Measurement-only adapter. It consumes existing primitive predictions without
 * invoking or modifying classifier rules, then votes by predicted surface area.
 */
export function aggregateLegacySurfacePredictions(units: ClassificationUnitRecord[], primitivePredictions: ReadonlyMap<string, LegacySurfacePrediction>): LegacySurfaceAggregation {
	const predictions = new Map<string, SurfaceRole>();
	const ambiguousUnitIds: string[] = [];
	for (const unit of units) {
		const votes = Object.fromEntries(TIER1_SURFACE_ROLES.map((role) => [role, 0])) as Record<SurfaceRole, number>;
		for (const primitiveId of unit.sourcePrimitiveIds) {
			const prediction = primitivePredictions.get(primitiveId);
			if (prediction) votes[prediction.surfaceRole] += Math.max(0, prediction.areaM2);
		}
		const ranked = TIER1_SURFACE_ROLES.map((role) => ({ role, areaM2: votes[role] })).sort((left, right) => right.areaM2 - left.areaM2 || left.role.localeCompare(right.role));
		const total = ranked.reduce((sum, item) => sum + item.areaM2, 0);
		const mixed = total === 0 || ranked[0].areaM2 / total < 0.6 || (ranked[0].areaM2 > 0 && ranked[0].areaM2 === ranked[1].areaM2);
		predictions.set(unit.id, mixed ? 'unknown' : ranked[0].role);
		if (mixed) ambiguousUnitIds.push(unit.id);
	}
	return { predictions, ambiguousUnitIds: ambiguousUnitIds.sort() };
}

export function evaluateTier1Baseline(document: Tier1AnnotationDocument, units: ClassificationUnitRecord[], predictions: ReadonlyMap<string, SurfaceRole>, ambiguousUnitIds: readonly string[] = []): Tier1BaselineResult {
	const unitIds = new Set(units.map((unit) => unit.id));
	const roles = TIER1_SURFACE_ROLES;
	const support = Object.fromEntries(roles.map((role) => [role, 0])) as Record<SurfaceRole, number>;
	const confusionMatrix = Object.fromEntries(roles.map((actual) => [actual, Object.fromEntries(roles.map((predicted) => [predicted, 0]))])) as Record<SurfaceRole, Record<SurfaceRole, number>>;
	const verified = document.annotations.filter((annotation) => annotation.status === 'verified' && unitIds.has(annotation.classificationUnitId));
	for (const annotation of verified) {
		const prediction = predictions.get(annotation.classificationUnitId) || 'unknown';
		support[annotation.expectedSurfaceRole] += 1;
		confusionMatrix[annotation.expectedSurfaceRole][prediction] += 1;
	}
	const precision: Partial<Record<SurfaceRole, number>> = {};
	const recall: Partial<Record<SurfaceRole, number>> = {};
	const f1: Partial<Record<SurfaceRole, number>> = {};
	for (const role of roles) {
		if (!support[role]) continue;
		const tp = confusionMatrix[role][role];
		const fp = roles.reduce((sum, actual) => sum + (actual === role ? 0 : confusionMatrix[actual][role]), 0);
		precision[role] = tp / Math.max(tp + fp, 1);
		recall[role] = tp / support[role];
		f1[role] = (2 * precision[role]! * recall[role]!) / Math.max(precision[role]! + recall[role]!, Number.EPSILON);
	}
	const evaluated = Object.values(f1);
	const unknownCount = Object.values(confusionMatrix).reduce((sum, row) => sum + row.unknown, 0);
	return { verifiedCount: verified.length, support, confusionMatrix, precision, recall, f1, macroF1: evaluated.length ? average(evaluated) : null, balancedAccuracy: Object.values(recall).length ? average(Object.values(recall)) : null, unknownPredictionRate: unknownCount / Math.max(verified.length, 1), ambiguousMixedPredictionRate: ambiguousUnitIds.length / Math.max(verified.length, 1) };
}

export function validateSplitDatasets(train: Tier1AnnotationDocument, holdout: Tier1AnnotationDocument) {
	const errors: string[] = [];
	if (train.split !== 'train' || holdout.split !== 'holdout') errors.push('Dataset split metadata invalid.');
	const trainIds = new Set(train.annotations.map((annotation) => annotation.classificationUnitId));
	for (const id of holdout.annotations.map((annotation) => annotation.classificationUnitId)) if (trainIds.has(id)) errors.push(`Unit leakage: ${id}`);
	if (train.modelId === holdout.modelId) errors.push(`Model family leakage: ${train.modelId}.`);
	return { valid: errors.length === 0, errors, verifiedSupport: countVerified(train.annotations.concat(holdout.annotations)) };
}

function countVerified(annotations: Tier1AnnotationRecord[]) {
	return Object.fromEntries(TIER1_SURFACE_ROLES.map((role) => [role, annotations.filter((annotation) => annotation.status === 'verified' && annotation.expectedSurfaceRole === role).length])) as Record<SurfaceRole, number>;
}

function average(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
