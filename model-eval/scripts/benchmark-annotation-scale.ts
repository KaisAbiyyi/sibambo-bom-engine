import { createClassificationUnitIndex } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';

const path = Bun.argv[2];
if (!path) throw new Error('Usage: bun run benchmark:annotation-scale <model-eval-json>');

const cold = await runOnce(path);
const warm = [];
for (let index = 0; index < 5; index += 1) warm.push(await runOnce(path));
console.log(JSON.stringify({ path, cold, warm, warmMedianMs: median(warm.map((result) => result.fullProcessingMs)) }, null, 2));

async function runOnce(inputPath: string) {
	const started = performance.now();
	const text = await Bun.file(inputPath).text();
	const document = JSON.parse(text);
	const runtime = parseModelEvalJsonV1(document);
	const foundation = createGeometryFoundation(runtime);
	const index = createClassificationUnitIndex(foundation);
	index.processNext();
	const firstAnnotatableUnitMs = performance.now() - started;
	const units = index.processAll();
	return {
		firstAnnotatableUnitMs: Number(firstAnnotatableUnitMs.toFixed(3)),
		fullProcessingMs: Number((performance.now() - started).toFixed(3)),
		logicalObjectCount: foundation.buildLogicalObjectIndex().objects.length,
		unitCount: units.length,
		initialFaceRecordExpansion: 0,
		geometry: foundation.getDiagnostics(),
		annotation: index.counters
	};
}

function median(values: number[]) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(3));
}
