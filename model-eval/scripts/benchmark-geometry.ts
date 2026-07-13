import { createGeometryFoundation } from '../src/lib/geometry';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';

const path = Bun.argv[2];
const iterations = Number(Bun.argv[3] || 20);
if (!path) throw new Error('Usage: bun run benchmark:geometry <path-to-model-eval-json> [iterations]');
if (!Number.isInteger(iterations) || iterations < 20) throw new Error('Benchmark requires at least 20 iterations.');
const text = await Bun.file(path).text();
const parseTimes: number[] = []; const runtimeTimes: number[] = []; const graphTimes: number[] = []; const objectTimes: number[] = []; const evidenceTimes: number[] = []; const clusterTimes: number[] = [];
let retained: ReturnType<ReturnType<typeof createGeometryFoundation>['retainedGeometryBytes']> | undefined;
let initialFaceRecords = -1;
for (let run = 0; run < iterations; run += 1) {
	let start = performance.now(); const document = JSON.parse(text); parseTimes.push(performance.now() - start);
	start = performance.now(); const runtime = parseModelEvalJsonV1(document); runtimeTimes.push(performance.now() - start);
	start = performance.now(); const foundation = createGeometryFoundation(runtime); graphTimes.push(performance.now() - start);
	start = performance.now(); const objects = foundation.buildLogicalObjectIndex().objects; objectTimes.push(performance.now() - start);
	start = performance.now(); objects.forEach((object) => foundation.extractGeometryEvidence(object.id)); evidenceTimes.push(performance.now() - start);
	start = performance.now(); objects.forEach((object) => foundation.buildSurfaceClusters(object.id)); clusterTimes.push(performance.now() - start);
	retained = foundation.retainedGeometryBytes();
	initialFaceRecords = 0;
}
const result = {
	path, iterations,
	medianMs: { jsonParse: median(parseTimes), compactRuntime: median(runtimeTimes), instanceGraph: median(graphTimes), logicalObjectIndex: median(objectTimes), geometryEvidence: median(evidenceTimes), surfaceClustering: median(clusterTimes) },
	initialFaceRecordExpansion: initialFaceRecords,
	retainedGeometry: retained
};
console.log(JSON.stringify(result, null, 2));

function median(values: number[]) { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(3)); }
