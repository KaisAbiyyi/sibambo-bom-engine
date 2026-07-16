import { buildInstanceGraph, type Matrix4Array, type RuntimeScene } from './geometry';
import type { RuntimeGeometryGroup } from './render/build-runtime-scene';

export type SourceGeometryNode = {
	id: string;
	sourceId: string;
	sourceName: string;
	sourceGroupName: string | null;
	parentId: string | null;
	childIds: string[];
	definitionId: number;
	meshId: number | null;
	localTransform: Matrix4Array;
	worldTransform: Matrix4Array;
	worldTransforms: Matrix4Array[];
	visible: boolean;
	originalSemanticMetadata: { tag: string | null };
};

export type RenderableMeshRecord = {
	id: string;
	sourceNodeId: string;
	parentNodeId: string | null;
	meshDefinitionId: number;
	vertices: Float32Array;
	faces: RuntimeScene['manifest']['meshes'][number]['faces'];
	triangles: Uint32Array;
	materialIds: number[];
	localTransform: Matrix4Array;
	worldTransform: Matrix4Array;
	visible: boolean;
	renderable: true;
	invalidGeometryReason: null;
	occurrences: Array<{ sourceNodeId: string; parentNodeId: string | null; instancePath: string; localTransform: Matrix4Array; worldTransform: Matrix4Array; materialId: number }>;
};

export type InvalidMeshRecord = {
	id: string;
	sourceNodeId: string;
	meshDefinitionId: number;
	renderable: false;
	invalidGeometryReason: string;
};

export type LogicalComponent = { id: string; type: string; sourceNodeIds: string[]; meshIds: string[] };

export type GeometryRegistry = {
	sourceNodes: Map<string, SourceGeometryNode>;
	renderableMeshes: Map<string, RenderableMeshRecord>;
	logicalComponents: Map<string, LogicalComponent>;
	unresolvedMeshes: Set<string>;
	invalidMeshes: Map<string, InvalidMeshRecord>;
};

export type GeometryIngestionDiagnostics = {
	totalSourceNodes: number;
	totalSourceMeshes: number;
	successfullyRenderedMeshes: number;
	invalidMeshes: number;
	unresolvedMeshes: number;
	missingValidMeshes: number;
	excludedMeshes: Array<{ id: string; reason: string }>;
};

export function buildGeometryRegistry(scene: RuntimeScene): GeometryRegistry {
	const graph = buildInstanceGraph(scene);
	const strings = scene.manifest.strings;
	const sourceNodes = new Map<string, SourceGeometryNode>();
	const renderableMeshes = new Map<string, RenderableMeshRecord>();
	const invalidMeshes = new Map<string, InvalidMeshRecord>();

	for (const [nodeIndex, source] of scene.manifest.nodes.entries()) {
		const definition = scene.manifest.definitions[source.definition];
		const sourceName = stringAt(strings, source.name) || stringAt(strings, definition?.name) || `node:${nodeIndex}`;
		const occurrences = graph.nodes.filter((node) => node.sourceNameId === source.name && node.definitionId === source.definition);
		const first = occurrences[0];
		sourceNodes.set(`node:${nodeIndex}`, {
			id: `node:${nodeIndex}`,
			sourceId: source.source_persistent_id >= 0 ? stringAt(strings, source.source_persistent_id) : stringAt(strings, source.id) || `node:${nodeIndex}`,
			sourceName,
			sourceGroupName: source.owner_definition >= 0 ? stringAt(strings, scene.manifest.definitions[source.owner_definition]?.name) || null : null,
			parentId: null,
			childIds: definition?.nodes.map((index) => `node:${index}`) || [],
			definitionId: source.definition,
			meshId: definition?.mesh >= 0 ? definition.mesh : null,
			localTransform: first?.localTransform || [],
			worldTransform: first?.worldTransform || [],
			worldTransforms: occurrences.map((node) => node.worldTransform),
			visible: source.visible !== false,
			originalSemanticMetadata: { tag: source.tag >= 0 ? stringAt(strings, scene.manifest.tags[source.tag]?.name) || null : null }
		});
	}

	for (const [meshId, mesh] of scene.manifest.meshes.entries()) {
		const occurrences = graph.nodes.filter((node) => node.visible && node.meshId === meshId);
		if (!occurrences.length) continue;
		const runtimeMesh = scene.meshes[meshId];
		const reason = validateMesh(runtimeMesh, mesh);
		const id = `mesh:${meshId}`;
		if (reason) {
			invalidMeshes.set(id, { id, sourceNodeId: occurrences[0].nodeId, meshDefinitionId: meshId, renderable: false, invalidGeometryReason: reason });
			continue;
		}
		const first = occurrences[0];
		renderableMeshes.set(id, {
			id,
			sourceNodeId: first.nodeId,
			parentNodeId: first.parentNodeId,
			meshDefinitionId: meshId,
			vertices: runtimeMesh.positions,
			faces: mesh.faces,
			triangles: runtimeMesh.triangles,
			materialIds: [...new Set(occurrences.flatMap((node) => mesh.faces.map((face) => node.materialId >= 0 ? node.materialId : face.material)).filter((materialId) => materialId >= 0))],
			localTransform: first.localTransform,
			worldTransform: first.worldTransform,
			visible: true,
			renderable: true,
			invalidGeometryReason: null,
			occurrences: occurrences.map((node) => ({ sourceNodeId: node.nodeId, parentNodeId: node.parentNodeId, instancePath: node.instancePath, localTransform: node.localTransform, worldTransform: node.worldTransform, materialId: node.materialId }))
		});
	}

	return {
		sourceNodes,
		renderableMeshes,
		logicalComponents: new Map(),
		unresolvedMeshes: new Set(renderableMeshes.keys()),
		invalidMeshes
	};
}

export function diagnoseRenderCoverage(registry: GeometryRegistry, groups: RuntimeGeometryGroup[]): GeometryIngestionDiagnostics {
	const renderedMeshIds = new Set(groups.map((group) => `mesh:${group.sourceMeshIndex}`));
	const missing = [...registry.renderableMeshes.keys()].filter((id) => !renderedMeshIds.has(id));
	return {
		totalSourceNodes: registry.sourceNodes.size,
		totalSourceMeshes: registry.renderableMeshes.size + registry.invalidMeshes.size,
		successfullyRenderedMeshes: registry.renderableMeshes.size - missing.length,
		invalidMeshes: registry.invalidMeshes.size,
		unresolvedMeshes: registry.unresolvedMeshes.size,
		missingValidMeshes: missing.length,
		excludedMeshes: [
			...[...registry.invalidMeshes.values()].map((record) => ({ id: record.id, reason: record.invalidGeometryReason })),
			...missing.map((id) => ({ id, reason: 'valid mesh missing from renderable scene groups' }))
		]
	};
}

function validateMesh(runtimeMesh: RuntimeScene['meshes'][number] | undefined, mesh: RuntimeScene['manifest']['meshes'][number] | undefined) {
	if (!runtimeMesh || !mesh) return 'mesh payload or manifest entry missing';
	if (runtimeMesh.positions.length < 9 || runtimeMesh.positions.length % 3 !== 0) return 'position buffer is empty or malformed';
	if (runtimeMesh.triangles.length < 3 || runtimeMesh.triangles.length % 3 !== 0) return 'index buffer is empty or malformed';
	const vertexCount = runtimeMesh.positions.length / 3;
	for (const index of runtimeMesh.triangles) if (index >= vertexCount) return `triangle index ${index} exceeds vertex count ${vertexCount}`;
	return null;
}

function stringAt(strings: string[], index: number | undefined) {
	return index !== undefined && index >= 0 && index < strings.length ? strings[index] : '';
}
