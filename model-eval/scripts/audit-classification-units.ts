import { buildClassificationUnits } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';

const paths = Bun.argv.slice(2);
if (paths.length < 1) throw new Error('Usage: bun scripts/audit-classification-units.ts <model-eval-json> [...]');

const reports = [];
for (const path of paths) {
	const runtime = parseModelEvalJsonV1(JSON.parse(await Bun.file(path).text()));
	const foundation = createGeometryFoundation(runtime);
	const objects = foundation.buildLogicalObjectIndex().objects;
	const clustersByObject = [];
	for (const object of objects) {
		clustersByObject.push(foundation.buildSurfaceClusters(object.id));
	}
	const surfaceClusters = clustersByObject.flat();
	const { units } = buildClassificationUnits(foundation);
	const orientation = { upward: 0, downward: 0, vertical: 0, sloped: 0 };
	for (const unit of units) {
		orientation.upward += unit.areaM2 * unit.upwardHorizontalAreaRatio;
		orientation.downward += unit.areaM2 * unit.downwardHorizontalAreaRatio;
		orientation.vertical += unit.areaM2 * unit.verticalAreaRatio;
		orientation.sloped += unit.areaM2 * unit.slopedAreaRatio;
	}
	const clustersPerObject = clustersByObject.map((clusters) => clusters.length);
	const mixedRoleObjects = objects.filter((object) => {
		const clusters = foundation.buildSurfaceClusters(object.id);
		return new Set(clusters.map((cluster) => cluster.verticalAreaRatio > 0.75 ? 'vertical' : cluster.slopedAreaRatio > 0.75 ? 'sloped' : cluster.dominantNormal.y >= 0 ? 'up' : 'down')).size > 1;
	}).length;
	reports.push({
		path, modelId: runtime.manifest.strings[runtime.manifest.source.model_name] || runtime.manifest.strings[runtime.manifest.source.file_name] || path,
		logicalObjectCount: objects.length, surfaceClusterCount: surfaceClusters.length, classificationUnitCount: units.length,
		clustersPerLogicalObject: { min: clustersPerObject.length ? Math.min(...clustersPerObject) : 0, max: clustersPerObject.length ? Math.max(...clustersPerObject) : 0, median: median(clustersPerObject) },
		areaDistributionM2: distribution(units.map((unit) => unit.areaM2)), orientationAreaM2: orientation,
		logicalObjectsWithMultipleArchitecturalOrientations: mixedRoleObjects,
		fragmentedUnitsUnder0_01M2: units.filter((unit) => unit.areaM2 < 0.01).length,
		unitsWithMultipleClusters: units.filter((unit) => unit.surfaceClusterIds.length > 1).length
	});
}
console.log(JSON.stringify(reports, null, 2));

function distribution(values: number[]) { return { min: values.length ? Math.min(...values) : 0, median: median(values), max: values.length ? Math.max(...values) : 0, total: values.reduce((sum, value) => sum + value, 0) }; }
function median(values: number[]) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
