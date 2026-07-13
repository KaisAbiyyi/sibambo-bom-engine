import type { Bome2Face, Bome2RuntimeScene } from '../formats/bome2';
import type { ModelEvalRuntimeScene } from '../formats/model-eval-json';

export type RuntimeScene = Bome2RuntimeScene | ModelEvalRuntimeScene;
export type Matrix4Array = readonly number[];
export type Vec3 = { x: number; y: number; z: number };
export type Bounds3 = { min: Vec3; max: Vec3; size: Vec3; center: Vec3 };

export const GEOMETRY_TOLERANCES = {
	positionM: 0.001,
	normalAngleDeg: 8,
	coplanarityM: 0.002,
	levelBandM: 0.15,
	orientationAngleDeg: 15,
	splitMaterialBoundaries: true
} as const;

export type InstanceGraphNode = {
	nodeId: string;
	definitionId: number;
	meshId: number | null;
	parentNodeId: string | null;
	childNodeIds: string[];
	localTransform: number[];
	worldTransform: number[];
	sourceNameId: number;
	sourceTagId: number;
	sourceIdentity: string | null;
	visible: boolean;
	instancePath: string;
	materialId: number;
};

export type InstanceGraph = { nodes: InstanceGraphNode[]; byNodeId: ReadonlyMap<string, InstanceGraphNode> };

export type OrientationDistribution = {
	upwardAreaM2: number;
	downwardAreaM2: number;
	verticalAreaM2: number;
	slopedAreaM2: number;
	dominantNormal: Vec3;
	consistency: number;
};

export type WorldGeometryRecord = {
	nodeId: string;
	meshId: number;
	worldTransform: number[];
	worldBounds: Bounds3;
	centroid: Vec3;
	worldAreaM2: number;
	triangleCount: number;
	horizontalAreaM2: number;
	verticalAreaM2: number;
	slopedAreaM2: number;
	horizontalAreaRatio: number;
	verticalAreaRatio: number;
	slopedAreaRatio: number;
	minElevation: number;
	maxElevation: number;
	elevationSpan: number;
	orientationDistribution: OrientationDistribution;
};

export type LogicalObjectRecord = {
	id: string;
	nodeId: string;
	definitionId: number;
	meshId: number;
	parentObjectId: string | null;
	childObjectIds: string[];
	instancePath: string;
	sourceName: string;
	sourceTag: string | null;
	sourceIdentity: string | null;
	primitiveRanges: Array<[number, number]>;
	faceOrPrimitiveIds: string[];
	worldBounds: Bounds3;
	centroid: Vec3;
	dimensions: Vec3;
	totalAreaM2: number;
	triangleCount: number;
	orientationDistribution: OrientationDistribution;
	materialIds: number[];
	surfaceClusterIds: string[];
};

export type SurfaceClusterRecord = {
	id: string;
	logicalObjectId: string;
	primitiveIds: string[];
	triangleRanges: Array<[number, number]>;
	connectedComponentIndex: number;
	worldBounds: Bounds3;
	centroid: Vec3;
	areaM2: number;
	dominantNormal: Vec3;
	horizontalAreaRatio: number;
	verticalAreaRatio: number;
	slopedAreaRatio: number;
	coplanarityError: number;
	boundaryEdgeCount: number;
	materialIds: number[];
};

export type GeometryEvidence = {
	logicalObjectId: string;
	worldBounds: Bounds3;
	dimensions: Vec3;
	totalAreaM2: number;
	triangleCount: number;
	orientation: OrientationDistribution & { horizontalAreaRatio: number; verticalAreaRatio: number; slopedAreaRatio: number };
	elevation: { min: number; max: number; span: number; relativeMin: number; relativeMax: number };
	hierarchy: { nodeId: string; definitionId: number; parentObjectId: string | null; instancePath: string; repeatedDefinitionCount: number };
	materialIds: number[];
	surfaceClusterIds: string[];
	context: { topEnvelopeCandidate: boolean; bottomEnvelopeCandidate: boolean; planPerimeterProximityCandidate: boolean };
};

export type LevelBand = { elevation: number; supportAreaM2: number; confidence: number; sampleCount: number };
export type ModelGeometryContext = { bounds: Bounds3; robustOccupiedBounds: Bounds3; height: number; levelBands: LevelBand[]; repeatedDefinitions: Array<{ definitionId: number; instances: number }> };

type FaceMetric = {
	faceIndex: number;
	face: Bome2Face;
	id: string;
	materialId: number;
	triangleRange: [number, number];
	bounds: Bounds3;
	centroid: Vec3;
	area: number;
	normal: Vec3;
	orientation: OrientationDistribution;
	edges: string[];
	points: Vec3[];
};

const AXIS_TO_THREE = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const AXIS_FROM_THREE = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const COS_HORIZONTAL = Math.cos((GEOMETRY_TOLERANCES.orientationAngleDeg * Math.PI) / 180);
const SIN_VERTICAL = Math.sin((GEOMETRY_TOLERANCES.orientationAngleDeg * Math.PI) / 180);
const COS_CLUSTER = Math.cos((GEOMETRY_TOLERANCES.normalAngleDeg * Math.PI) / 180);

/** Converts a SketchUp-space transform to Three-space. Geometry is mapped exactly once by this basis change. */
export function toThreeWorldMatrix(sketchUpMatrix: Matrix4Array): number[] {
	return multiplyMatrices(multiplyMatrices(AXIS_TO_THREE, sketchUpMatrix), AXIS_FROM_THREE);
}

export function buildInstanceGraph(scene: RuntimeScene): InstanceGraph {
	const nodes: InstanceGraphNode[] = [];
	const byNodeId = new Map<string, InstanceGraphNode>();
	const { manifest } = scene;
	const stringAt = (index: number) => (index >= 0 && index < manifest.strings.length ? manifest.strings[index] : '');
	const transformAt = (index: number) => Array.from(scene.transforms.subarray(index * 16, index * 16 + 16));
	const visit = (nodeIndex: number, parent: InstanceGraphNode | null, parentWorld: number[], inheritedMaterial: number, ancestry: number[]) => {
		if (ancestry.includes(nodeIndex)) throw new Error(`Geometry instance graph recursive node ${ancestry.concat(nodeIndex).join(' -> ')}.`);
		const source = manifest.nodes[nodeIndex];
		if (!source) throw new Error(`Geometry instance graph missing node ${nodeIndex}.`);
		const definition = manifest.definitions[source.definition];
		if (!definition) throw new Error(`Geometry instance graph missing definition ${source.definition}.`);
		const local = toThreeWorldMatrix(transformAt(source.transform));
		const world = multiplyMatrices(parentWorld, local);
		const sourceId = stringAt(source.id) || `node:${nodeIndex}`;
		const instancePath = parent ? `${parent.instancePath}/${sourceId}` : sourceId;
		const nodeId = instancePath;
		if (byNodeId.has(nodeId)) throw new Error(`Geometry instance graph duplicate path ${nodeId}.`);
		const record: InstanceGraphNode = {
			nodeId,
			definitionId: source.definition,
			meshId: definition.mesh >= 0 ? definition.mesh : null,
			parentNodeId: parent?.nodeId || null,
			childNodeIds: [],
			localTransform: local,
			worldTransform: world,
			sourceNameId: source.name,
			sourceTagId: source.tag,
			sourceIdentity: source.source_persistent_id >= 0 ? stringAt(source.source_persistent_id) : null,
			visible: source.visible !== false,
			instancePath,
			materialId: source.material >= 0 ? source.material : inheritedMaterial
		};
		nodes.push(record);
		byNodeId.set(nodeId, record);
		if (parent) parent.childNodeIds.push(nodeId);
		if (source.visible === false) return;
		for (const childIndex of definition.nodes) visit(childIndex, record, world, record.materialId, ancestry.concat(nodeIndex));
	};
	visit(manifest.root_node, null, IDENTITY, -1, []);
	return { nodes, byNodeId };
}

export function createGeometryFoundation(scene: RuntimeScene) {
	return new GeometryFoundation(scene);
}

export class GeometryFoundation {
	readonly instanceGraph: InstanceGraph;
	private readonly worldCache = new Map<string, WorldGeometryRecord>();
	private readonly logicalCache = new Map<string, LogicalObjectRecord>();
	private readonly clusterCache = new Map<string, SurfaceClusterRecord[]>();
	private objectIndexBuilt = false;
	private contextCache: ModelGeometryContext | null = null;

	constructor(readonly scene: RuntimeScene) {
		this.instanceGraph = buildInstanceGraph(scene);
	}

	getWorldGeometry(nodeId: string): WorldGeometryRecord {
		const cached = this.worldCache.get(nodeId);
		if (cached) return cached;
		const node = this.requireMeshNode(nodeId);
		const record = this.measure(node, this.faceIndexes(node.meshId!));
		this.worldCache.set(nodeId, record);
		return record;
	}

	buildLogicalObjectIndex() {
		if (this.objectIndexBuilt) return { objects: [...this.logicalCache.values()].sort(byId) };
		for (const node of this.instanceGraph.nodes) {
			if (!node.visible || node.meshId === null) continue;
			const indexes = this.faceIndexes(node.meshId);
			const loose = node.parentNodeId === null && this.definitionKind(node.definitionId) === 'root';
			const components = loose ? this.connectedFaceComponents(node, indexes) : [indexes];
			components.forEach((component, index) => this.addLogicalObject(node, component, loose ? index : null));
		}
		const objects = [...this.logicalCache.values()].sort(byId);
		const byNode = new Map<string, LogicalObjectRecord[]>();
		objects.forEach((object) => byNode.set(object.nodeId, [...(byNode.get(object.nodeId) || []), object]));
		for (const object of objects) {
			let parentNodeId = this.instanceGraph.byNodeId.get(object.nodeId)?.parentNodeId || null;
			while (parentNodeId) {
				const parent = byNode.get(parentNodeId)?.[0];
				if (parent) { object.parentObjectId = parent.id; parent.childObjectIds.push(object.id); break; }
				parentNodeId = this.instanceGraph.byNodeId.get(parentNodeId)?.parentNodeId || null;
			}
		}
		this.objectIndexBuilt = true;
		return { objects };
	}

	buildSurfaceClusters(logicalObjectId: string): SurfaceClusterRecord[] {
		const cached = this.clusterCache.get(logicalObjectId);
		if (cached) return cached;
		const object = this.requireObject(logicalObjectId);
		const node = this.requireMeshNode(object.nodeId);
		const metrics = object.faceOrPrimitiveIds.map((id) => this.faceMetric(node, Number(id.split(':').at(-1)))).filter(Boolean) as FaceMetric[];
		const parent = metrics.map((_, index) => index);
		const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
		const union = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
		for (let left = 0; left < metrics.length; left += 1) for (let right = left + 1; right < metrics.length; right += 1) {
			if (!shareEdge(metrics[left], metrics[right])) continue;
			if (GEOMETRY_TOLERANCES.splitMaterialBoundaries && metrics[left].materialId !== metrics[right].materialId) continue;
			if (dot(metrics[left].normal, metrics[right].normal) < COS_CLUSTER) continue;
			if (coplanarity(metrics[left], metrics[right]) > GEOMETRY_TOLERANCES.coplanarityM) continue;
			union(left, right);
		}
		const groups = new Map<number, FaceMetric[]>();
		metrics.forEach((metric, index) => groups.set(find(index), [...(groups.get(find(index)) || []), metric]));
		const clusters = [...groups.values()].sort((a, b) => a[0].id.localeCompare(b[0].id)).map((faces, index) => this.clusterRecord(object, faces, index));
		object.surfaceClusterIds = clusters.map((cluster) => cluster.id);
		this.clusterCache.set(logicalObjectId, clusters);
		return clusters;
	}

	extractGeometryEvidence(logicalObjectId: string): GeometryEvidence {
		const object = this.requireObject(logicalObjectId);
		const context = this.modelContext;
		const bounds = context.bounds;
		const range = Math.max(bounds.size.y, Number.EPSILON);
		const repeated = context.repeatedDefinitions.find((item) => item.definitionId === object.definitionId)?.instances || 1;
		return {
			logicalObjectId,
			worldBounds: object.worldBounds,
			dimensions: object.dimensions,
			totalAreaM2: object.totalAreaM2,
			triangleCount: object.triangleCount,
			orientation: { ...object.orientationDistribution, horizontalAreaRatio: ratio(object.orientationDistribution.upwardAreaM2 + object.orientationDistribution.downwardAreaM2, object.totalAreaM2), verticalAreaRatio: ratio(object.orientationDistribution.verticalAreaM2, object.totalAreaM2), slopedAreaRatio: ratio(object.orientationDistribution.slopedAreaM2, object.totalAreaM2) },
			elevation: { min: object.worldBounds.min.y, max: object.worldBounds.max.y, span: object.worldBounds.size.y, relativeMin: (object.worldBounds.min.y - bounds.min.y) / range, relativeMax: (object.worldBounds.max.y - bounds.min.y) / range },
			hierarchy: { nodeId: object.nodeId, definitionId: object.definitionId, parentObjectId: object.parentObjectId, instancePath: object.instancePath, repeatedDefinitionCount: repeated },
			materialIds: object.materialIds,
			surfaceClusterIds: object.surfaceClusterIds.slice(),
			context: { topEnvelopeCandidate: object.worldBounds.max.y >= bounds.max.y - GEOMETRY_TOLERANCES.levelBandM, bottomEnvelopeCandidate: object.worldBounds.min.y <= bounds.min.y + GEOMETRY_TOLERANCES.levelBandM, planPerimeterProximityCandidate: nearPlanPerimeter(object.worldBounds, bounds) }
		};
	}

	get modelContext(): ModelGeometryContext {
		if (this.contextCache) return this.contextCache;
		const records = this.instanceGraph.nodes.filter((node) => node.visible && node.meshId !== null).map((node) => this.getWorldGeometry(node.nodeId));
		const bounds = combineBounds(records.map((record) => record.worldBounds));
		const levels = this.levelBands(records, bounds);
		const counts = new Map<number, number>();
		this.instanceGraph.nodes.filter((node) => node.meshId !== null).forEach((node) => counts.set(node.definitionId, (counts.get(node.definitionId) || 0) + 1));
		return this.contextCache = { bounds, robustOccupiedBounds: bounds, height: bounds.size.y, levelBands: levels, repeatedDefinitions: [...counts.entries()].filter(([, instances]) => instances > 1).map(([definitionId, instances]) => ({ definitionId, instances })).sort((a, b) => a.definitionId - b.definitionId) };
	}

	retainedGeometryBytes() {
		const definitionLocalBytes = this.scene.meshes.reduce((sum, mesh) => sum + mesh.positions.byteLength + mesh.loops.byteLength + mesh.triangles.byteLength, 0);
		return { definitionLocalBytes, instanceMatrixBytes: this.instanceGraph.nodes.length * 16 * Float32Array.BYTES_PER_ELEMENT, worldRecordCount: this.worldCache.size, logicalObjectCount: this.logicalCache.size, clusterCount: [...this.clusterCache.values()].reduce((sum, value) => sum + value.length, 0) };
	}

	private addLogicalObject(node: InstanceGraphNode, faceIndexes: number[], componentIndex: number | null) {
		const metric = this.measure(node, faceIndexes);
		const mesh = this.scene.manifest.meshes[node.meshId!];
		const id = componentIndex === null ? `logical:${node.nodeId}` : `logical:${node.nodeId}:component:${componentIndex}`;
		const stringAt = (index: number) => this.scene.manifest.strings[index] || '';
		const object: LogicalObjectRecord = {
			id, nodeId: node.nodeId, definitionId: node.definitionId, meshId: node.meshId!, parentObjectId: null, childObjectIds: [], instancePath: node.instancePath,
			sourceName: stringAt(node.sourceNameId), sourceTag: node.sourceTagId >= 0 ? stringAt(this.scene.manifest.tags[node.sourceTagId]?.name ?? -1) : null, sourceIdentity: node.sourceIdentity,
			primitiveRanges: faceIndexes.map((index) => [mesh.faces[index].triangle_start, mesh.faces[index].triangle_count]), faceOrPrimitiveIds: faceIndexes.map((index) => `${stringAt(mesh.faces[index].id)}:${index}`),
			worldBounds: metric.worldBounds, centroid: metric.centroid, dimensions: metric.worldBounds.size, totalAreaM2: metric.worldAreaM2, triangleCount: metric.triangleCount, orientationDistribution: metric.orientationDistribution,
			materialIds: [...new Set(faceIndexes.map((index) => node.materialId >= 0 ? node.materialId : mesh.faces[index].material).filter((value) => value >= 0))].sort((a, b) => a - b), surfaceClusterIds: []
		};
		this.logicalCache.set(id, object);
	}

	private connectedFaceComponents(node: InstanceGraphNode, indexes: number[]) {
		const metrics = indexes.map((index) => this.faceMetric(node, index));
		const seen = new Set<number>(); const output: number[][] = [];
		for (let index = 0; index < metrics.length; index += 1) {
			if (seen.has(index)) continue;
			const queue = [index]; seen.add(index); const component: number[] = [];
			while (queue.length) { const current = queue.shift()!; component.push(indexes[current]); for (let next = 0; next < metrics.length; next += 1) if (!seen.has(next) && shareEdge(metrics[current], metrics[next])) { seen.add(next); queue.push(next); } }
			output.push(component.sort((a, b) => a - b));
		}
		return output.sort((a, b) => a[0] - b[0]);
	}

	private clusterRecord(object: LogicalObjectRecord, faces: FaceMetric[], connectedComponentIndex: number): SurfaceClusterRecord {
		const area = faces.reduce((sum, face) => sum + face.area, 0);
		const weighted = faces.reduce((sum, face) => add(sum, multiply(face.centroid, face.area)), zero());
		const normalSum = faces.reduce((sum, face) => add(sum, multiply(face.normal, face.area)), zero());
		const orientation = faces.reduce((sum, face) => addOrientation(sum, face.orientation), emptyOrientation());
		const edgeCounts = new Map<string, number>();
		faces.forEach((face) => face.edges.forEach((edge) => edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1)));
		const reference = faces[0];
		return {
			id: `cluster:${object.id}:${connectedComponentIndex}`,
			logicalObjectId: object.id,
			primitiveIds: faces.map((face) => face.id).sort(),
			triangleRanges: faces.map((face) => face.triangleRange),
			connectedComponentIndex,
			worldBounds: combineBounds(faces.map((face) => face.bounds)),
			centroid: area ? multiply(weighted, 1 / area) : reference.centroid,
			areaM2: area,
			dominantNormal: normalize(normalSum),
			horizontalAreaRatio: ratio(orientation.upwardAreaM2 + orientation.downwardAreaM2, area),
			verticalAreaRatio: ratio(orientation.verticalAreaM2, area),
			slopedAreaRatio: ratio(orientation.slopedAreaM2, area),
			coplanarityError: Math.max(...faces.flatMap((face) => face.points.map((point) => Math.abs(dot(reference.normal, subtract(point, reference.points[0])))))),
			boundaryEdgeCount: [...edgeCounts.values()].filter((count) => count === 1).length,
			materialIds: [...new Set(faces.map((face) => face.materialId).filter((id) => id >= 0))].sort((a, b) => a - b)
		};
	}

	private measure(node: InstanceGraphNode, faceIndexes: number[]): WorldGeometryRecord {
		const metrics = faceIndexes.map((index) => this.faceMetric(node, index));
		const bounds = combineBounds(metrics.map((metric) => metric.bounds));
		const area = metrics.reduce((sum, metric) => sum + metric.area, 0);
		const weighted = metrics.reduce((sum, metric) => add(sum, multiply(metric.centroid, metric.area)), zero());
		const normalSum = metrics.reduce((sum, metric) => add(sum, multiply(metric.normal, metric.area)), zero());
		const orientation = metrics.reduce((result, metric) => addOrientation(result, metric.orientation), emptyOrientation());
		orientation.dominantNormal = normalize(normalSum);
		orientation.consistency = ratio(length(normalSum), area);
		return { nodeId: node.nodeId, meshId: node.meshId!, worldTransform: node.worldTransform.slice(), worldBounds: bounds, centroid: area ? multiply(weighted, 1 / area) : bounds.center, worldAreaM2: area, triangleCount: metrics.reduce((sum, metric) => sum + metric.triangleRange[1] / 3, 0), horizontalAreaM2: orientation.upwardAreaM2 + orientation.downwardAreaM2, verticalAreaM2: orientation.verticalAreaM2, slopedAreaM2: orientation.slopedAreaM2, horizontalAreaRatio: ratio(orientation.upwardAreaM2 + orientation.downwardAreaM2, area), verticalAreaRatio: ratio(orientation.verticalAreaM2, area), slopedAreaRatio: ratio(orientation.slopedAreaM2, area), minElevation: bounds.min.y, maxElevation: bounds.max.y, elevationSpan: bounds.size.y, orientationDistribution: orientation };
	}

	private faceMetric(node: InstanceGraphNode, faceIndex: number): FaceMetric {
		const runtime = this.scene.meshes[node.meshId!]; const mesh = runtime.manifest; const face = mesh.faces[faceIndex];
		if (!face) throw new Error(`Geometry face ${faceIndex} missing.`);
		const points: Vec3[] = [];
		for (let offset = face.outer_start; offset < face.outer_start + face.outer_count; offset += 1) points.push(transformPoint(node.worldTransform, localThreePoint(runtime.positions, runtime.loops[offset])));
		const bounds = boundsFromPoints(points);
		let area = 0; let weighted = zero(); let normalSum = zero(); let orientation = emptyOrientation();
		for (let offset = face.triangle_start; offset < face.triangle_start + face.triangle_count; offset += 3) {
			const a = transformPoint(node.worldTransform, localThreePoint(runtime.positions, runtime.triangles[offset]));
			const b = transformPoint(node.worldTransform, localThreePoint(runtime.positions, runtime.triangles[offset + 1]));
			const c = transformPoint(node.worldTransform, localThreePoint(runtime.positions, runtime.triangles[offset + 2]));
			const cross = crossProduct(subtract(b, a), subtract(c, a)); const triangleArea = length(cross) / 2; if (!triangleArea) continue;
			const normal = multiply(cross, 1 / (triangleArea * 2)); const center = multiply(add(add(a, b), c), 1 / 3);
			area += triangleArea; weighted = add(weighted, multiply(center, triangleArea)); normalSum = add(normalSum, multiply(normal, triangleArea)); orientation = addOrientation(orientation, orientationFor(normal, triangleArea));
		}
		orientation.dominantNormal = normalize(normalSum); orientation.consistency = ratio(length(normalSum), area);
		return { faceIndex, face, id: `${this.scene.manifest.strings[face.id] || `face:${faceIndex}`}:${faceIndex}`, materialId: node.materialId >= 0 ? node.materialId : face.material, triangleRange: [face.triangle_start, face.triangle_count], bounds, centroid: area ? multiply(weighted, 1 / area) : bounds.center, area, normal: normalize(normalSum), orientation, edges: edgeKeys(points), points };
	}

	private faceIndexes(meshId: number) { return this.scene.manifest.meshes[meshId].faces.map((_, index) => index); }
	private requireMeshNode(nodeId: string) { const node = this.instanceGraph.byNodeId.get(nodeId); if (!node || node.meshId === null) throw new Error(`Geometry node ${nodeId} has no mesh.`); return node; }
	private requireObject(id: string) { this.buildLogicalObjectIndex(); const object = this.logicalCache.get(id); if (!object) throw new Error(`Logical object ${id} missing.`); return object; }
	private definitionKind(id: number) { return this.scene.manifest.strings[this.scene.manifest.definitions[id]?.kind] || ''; }
	private levelBands(records: WorldGeometryRecord[], bounds: Bounds3): LevelBand[] {
		const samples: Array<{ elevation: number; area: number }> = [];
		for (const record of records) {
			if (record.horizontalAreaRatio < 0.8 || record.horizontalAreaM2 <= 0) continue;
			samples.push({ elevation: record.centroid.y, area: record.horizontalAreaM2 });
		}
		const bands: Array<{ weighted: number; area: number; count: number }> = [];
		for (const sample of samples.sort((a, b) => a.elevation - b.elevation)) {
			const band = bands.find((item) => Math.abs(sample.elevation - item.weighted / item.area) <= GEOMETRY_TOLERANCES.levelBandM);
			if (band) { band.weighted += sample.elevation * sample.area; band.area += sample.area; band.count += 1; } else bands.push({ weighted: sample.elevation * sample.area, area: sample.area, count: 1 });
		}
		const minimumSupport = Math.max(1.0, bounds.size.x * bounds.size.z * 0.06);
		return bands.filter((band) => band.area >= minimumSupport).map((band) => ({ elevation: band.weighted / band.area, supportAreaM2: band.area, confidence: Math.min(1, band.area / Math.max(minimumSupport * 3, Number.EPSILON)), sampleCount: band.count }));
	}
}

function multiplyMatrices(left: Matrix4Array, right: Matrix4Array) { const result = new Array<number>(16).fill(0); for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) for (let index = 0; index < 4; index += 1) result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index]; return result; }
function transformPoint(matrix: Matrix4Array, point: Vec3): Vec3 { return { x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12], y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13], z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14] }; }
function localThreePoint(positions: Float32Array, index: number): Vec3 { const base = index * 3; return { x: positions[base], y: positions[base + 2], z: -positions[base + 1] }; }
function zero(): Vec3 { return { x: 0, y: 0, z: 0 }; }
function add(left: Vec3, right: Vec3): Vec3 { return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z }; }
function subtract(left: Vec3, right: Vec3): Vec3 { return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z }; }
function multiply(value: Vec3, scalar: number): Vec3 { return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar }; }
function crossProduct(left: Vec3, right: Vec3): Vec3 { return { x: left.y * right.z - left.z * right.y, y: left.z * right.x - left.x * right.z, z: left.x * right.y - left.y * right.x }; }
function dot(left: Vec3, right: Vec3) { return left.x * right.x + left.y * right.y + left.z * right.z; }
function length(value: Vec3) { return Math.hypot(value.x, value.y, value.z); }
function normalize(value: Vec3): Vec3 { const magnitude = length(value); return magnitude ? multiply(value, 1 / magnitude) : { x: 0, y: 1, z: 0 }; }
function ratio(value: number, total: number) { return total ? value / total : 0; }
function emptyOrientation(): OrientationDistribution { return { upwardAreaM2: 0, downwardAreaM2: 0, verticalAreaM2: 0, slopedAreaM2: 0, dominantNormal: { x: 0, y: 1, z: 0 }, consistency: 0 }; }
function addOrientation(left: OrientationDistribution, right: OrientationDistribution): OrientationDistribution { return { upwardAreaM2: left.upwardAreaM2 + right.upwardAreaM2, downwardAreaM2: left.downwardAreaM2 + right.downwardAreaM2, verticalAreaM2: left.verticalAreaM2 + right.verticalAreaM2, slopedAreaM2: left.slopedAreaM2 + right.slopedAreaM2, dominantNormal: left.dominantNormal, consistency: left.consistency }; }
function orientationFor(normal: Vec3, area: number): OrientationDistribution { const result = emptyOrientation(); const vertical = Math.abs(normal.y); if (vertical >= COS_HORIZONTAL) { if (normal.y >= 0) result.upwardAreaM2 = area; else result.downwardAreaM2 = area; } else if (vertical <= SIN_VERTICAL) result.verticalAreaM2 = area; else result.slopedAreaM2 = area; return result; }
function boundsFromPoints(points: Vec3[]): Bounds3 { const min = { x: Infinity, y: Infinity, z: Infinity }; const max = { x: -Infinity, y: -Infinity, z: -Infinity }; points.forEach((point) => { min.x = Math.min(min.x, point.x); min.y = Math.min(min.y, point.y); min.z = Math.min(min.z, point.z); max.x = Math.max(max.x, point.x); max.y = Math.max(max.y, point.y); max.z = Math.max(max.z, point.z); }); if (!points.length) return emptyBounds(); return finalizeBounds(min, max); }
function combineBounds(bounds: Bounds3[]): Bounds3 { if (!bounds.length) return emptyBounds(); const min = { x: Infinity, y: Infinity, z: Infinity }; const max = { x: -Infinity, y: -Infinity, z: -Infinity }; bounds.forEach((bound) => { min.x = Math.min(min.x, bound.min.x); min.y = Math.min(min.y, bound.min.y); min.z = Math.min(min.z, bound.min.z); max.x = Math.max(max.x, bound.max.x); max.y = Math.max(max.y, bound.max.y); max.z = Math.max(max.z, bound.max.z); }); return finalizeBounds(min, max); }
function emptyBounds(): Bounds3 { return finalizeBounds({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }); }
function finalizeBounds(min: Vec3, max: Vec3): Bounds3 { const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }; return { min, max, size, center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 } }; }
function edgeKeys(points: Vec3[]) { return points.map((point, index) => edgeKey(point, points[(index + 1) % points.length])); }
function edgeKey(left: Vec3, right: Vec3) { const a = pointKey(left); const b = pointKey(right); return a < b ? `${a}|${b}` : `${b}|${a}`; }
function pointKey(point: Vec3) { const tolerance = GEOMETRY_TOLERANCES.positionM; return `${Math.round(point.x / tolerance)},${Math.round(point.y / tolerance)},${Math.round(point.z / tolerance)}`; }
function shareEdge(left: FaceMetric, right: FaceMetric) {
	for (let leftIndex = 0; leftIndex < left.points.length; leftIndex += 1) for (let rightIndex = 0; rightIndex < right.points.length; rightIndex += 1) {
		const leftNext = left.points[(leftIndex + 1) % left.points.length]; const rightNext = right.points[(rightIndex + 1) % right.points.length];
		if ((near(left.points[leftIndex], right.points[rightIndex]) && near(leftNext, rightNext)) || (near(left.points[leftIndex], rightNext) && near(leftNext, right.points[rightIndex]))) return true;
	}
	return false;
}
function near(left: Vec3, right: Vec3) { return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z) <= GEOMETRY_TOLERANCES.positionM; }
function coplanarity(left: FaceMetric, right: FaceMetric) { const normal = left.normal; return Math.max(...right.points.map((point) => Math.abs(dot(normal, subtract(point, left.points[0]))))); }
function nearPlanPerimeter(inner: Bounds3, outer: Bounds3) { const tolerance = GEOMETRY_TOLERANCES.positionM * 2; return Math.abs(inner.min.x - outer.min.x) <= tolerance || Math.abs(inner.max.x - outer.max.x) <= tolerance || Math.abs(inner.min.z - outer.min.z) <= tolerance || Math.abs(inner.max.z - outer.max.z) <= tolerance; }
function byId(left: { id: string }, right: { id: string }) { return left.id.localeCompare(right.id); }
