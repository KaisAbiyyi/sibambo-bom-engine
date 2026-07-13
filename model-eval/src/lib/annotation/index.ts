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

export function buildClassificationUnits(foundation: GeometryFoundation, modelId = modelIdentifier(foundation)): { units: ClassificationUnitRecord[]; foundation: GeometryFoundation } {
	const context = foundation.modelContext;
	const unlinked: ClassificationUnitRecord[] = [];
	for (const object of foundation.buildLogicalObjectIndex().objects) {
		const node = foundation.instanceGraph.byNodeId.get(object.nodeId)!;
		for (const clusters of groupCompatibleClusters(foundation.buildSurfaceClusters(object.id))) {
			unlinked.push(unitFromClusters(modelId, object, clusters, node, context));
		}
	}
	const units = unlinked.sort((left, right) => left.id.localeCompare(right.id));
	for (const unit of units) {
		const peers = units.filter((candidate) => candidate.id !== unit.id && candidate.logicalObjectId === unit.logicalObjectId);
		unit.adjacencyUnitIds = peers.filter((candidate) => unitsTouch(unit, candidate)).map((candidate) => candidate.id).sort();
		unit.groupingReasons.push(...splitReasons(unit, peers));
	}
	return { units, foundation };
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

function groupCompatibleClusters(clusters: SurfaceClusterRecord[]) {
	const ordered = [...clusters].sort((left, right) => left.id.localeCompare(right.id));
	const parent = ordered.map((_, index) => index);
	const find = (index: number): number => parent[index] === index ? index : parent[index] = find(parent[index]);
	const union = (left: number, right: number) => { const leftRoot = find(left); const rightRoot = find(right); if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot; };
	const cells = new Map<string, number[]>();
	ordered.forEach((cluster, right) => {
		for (const key of neighboringClusterCells(cluster.centroid)) for (const left of cells.get(key) || []) if (clustersCompatible(ordered[left], cluster)) union(left, right);
		const key = clusterCell(cluster.centroid); cells.set(key, [...(cells.get(key) || []), right]);
	});
	const groups = new Map<number, SurfaceClusterRecord[]>();
	ordered.forEach((cluster, index) => groups.set(find(index), [...(groups.get(find(index)) || []), cluster]));
	return [...groups.values()].sort((left, right) => left.map((cluster) => cluster.id).sort()[0].localeCompare(right.map((cluster) => cluster.id).sort()[0]));
}

function clusterCell(point: Vec3) {
	const cell = CLASSIFICATION_UNIT_TOLERANCES.spatialIndexCellM;
	return `${Math.floor(point.x / cell)},${Math.floor(point.y / cell)},${Math.floor(point.z / cell)}`;
}

function neighboringClusterCells(point: Vec3) {
	const cell = CLASSIFICATION_UNIT_TOLERANCES.spatialIndexCellM;
	const origin = [Math.floor(point.x / cell), Math.floor(point.y / cell), Math.floor(point.z / cell)];
	const keys: string[] = [];
	for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) keys.push(`${origin[0] + x},${origin[1] + y},${origin[2] + z}`);
	return keys;
}

function clustersCompatible(left: SurfaceClusterRecord, right: SurfaceClusterRecord) {
	if (boundsDistance(left.worldBounds, right.worldBounds) > CLASSIFICATION_UNIT_TOLERANCES.adjacencyM) return false;
	const normalDot = left.dominantNormal.x * right.dominantNormal.x + left.dominantNormal.y * right.dominantNormal.y + left.dominantNormal.z * right.dominantNormal.z;
	if (normalDot < Math.cos(CLASSIFICATION_UNIT_TOLERANCES.mergeNormalAngleDeg * Math.PI / 180)) return false;
	if (CLASSIFICATION_UNIT_TOLERANCES.splitMaterialBoundaries && left.materialIds.join('|') !== right.materialIds.join('|')) return false;
	return Math.abs(left.centroid.y - right.centroid.y) <= CLASSIFICATION_UNIT_TOLERANCES.elevationDiscontinuityM;
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

function splitReasons(unit: ClassificationUnitRecord, peers: ClassificationUnitRecord[]) {
	if (!peers.length) return ['split because source ownership: no compatible cluster shares this logical object'];
	const reasons = new Set<string>();
	for (const peer of peers) {
		if (!unitsTouch(unit, peer)) { reasons.add('split because disconnected'); continue; }
		const dot = unit.dominantNormal.x * peer.dominantNormal.x + unit.dominantNormal.y * peer.dominantNormal.y + unit.dominantNormal.z * peer.dominantNormal.z;
		if (dot < Math.cos(CLASSIFICATION_UNIT_TOLERANCES.mergeNormalAngleDeg * Math.PI / 180)) reasons.add('split because normal angle');
		else if (CLASSIFICATION_UNIT_TOLERANCES.splitMaterialBoundaries && unit.materialIds.join('|') !== peer.materialIds.join('|')) reasons.add('split because material boundary');
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
	const distance = boundsDistance(left.worldBounds, right.worldBounds);
	return distance <= CLASSIFICATION_UNIT_TOLERANCES.adjacencyM;
}

function boundsDistance(left: ClassificationUnitRecord['worldBounds'], right: ClassificationUnitRecord['worldBounds']) {
	const axis = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0 - b1, b0 - a1, 0);
	return Math.hypot(axis(left.min.x, left.max.x, right.min.x, right.max.x), axis(left.min.y, left.max.y, right.min.y, right.max.y), axis(left.min.z, left.max.z, right.min.z, right.max.z));
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
