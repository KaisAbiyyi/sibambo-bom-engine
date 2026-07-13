import { createGeometryFoundation } from '../src/lib/geometry';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';

const path = Bun.argv[2];
if (!path) throw new Error('Usage: bun run inspect:geometry <path-to-model-eval-json> [--json]');
const document = JSON.parse(await Bun.file(path).text());
const runtime = parseModelEvalJsonV1(document);
const foundation = createGeometryFoundation(runtime);
const objects = foundation.buildLogicalObjectIndex().objects;
const clusters = objects.flatMap((object) => foundation.buildSurfaceClusters(object.id));
const summary = {
	format: runtime.format,
	meshCount: runtime.meshes.length,
	definitionCount: runtime.manifest.definitions.length,
	nodeCount: foundation.instanceGraph.nodes.length,
	logicalObjectCount: objects.length,
	surfaceClusterCount: clusters.length,
	triangleCount: runtime.manifest.meshes.reduce((sum, mesh) => sum + mesh.triangle_count, 0),
	modelBounds: foundation.modelContext.bounds,
	candidateLevelBands: foundation.modelContext.levelBands,
	repeatedDefinitions: foundation.modelContext.repeatedDefinitions,
	retainedGeometry: foundation.retainedGeometryBytes(),
	logicalObjects: objects.map((object) => {
		foundation.buildSurfaceClusters(object.id);
		const evidence = foundation.extractGeometryEvidence(object.id);
		return {
			logicalObjectId: object.id,
			nodeId: object.nodeId,
			definitionId: object.definitionId,
			sourceName: object.sourceName,
			sourceTag: object.sourceTag,
			instancePath: object.instancePath,
			dimensions: object.dimensions,
			areaM2: object.totalAreaM2,
			triangleCount: object.triangleCount,
			worldBounds: object.worldBounds,
			orientation: evidence.orientation,
			elevation: evidence.elevation,
			clusterCount: object.surfaceClusterIds.length,
			materialIds: object.materialIds
		};
	})
};

console.log(JSON.stringify(summary, null, Bun.argv.includes('--json') ? 0 : 2));
