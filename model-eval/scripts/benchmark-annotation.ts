import { buildClassificationUnitHighlight, buildClassificationUnits, createGroundTruthDocument, validateGroundTruthDocument } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';

const path = Bun.argv[2];
const iterations = Number(Bun.argv[3] || 20);
if (!path) throw new Error('Usage: bun run benchmark:annotation <model-eval-json> [iterations]');
if (!Number.isInteger(iterations) || iterations < 20) throw new Error('Benchmark requires at least 20 iterations.');
const text = await Bun.file(path).text();
const construction: number[] = []; const highlight: number[] = []; const exportTimes: number[] = []; const importTimes: number[] = [];
for (let run = 0; run < iterations; run += 1) {
	const runtime = parseModelEvalJsonV1(JSON.parse(text)); const foundation = createGeometryFoundation(runtime);
	let start = performance.now(); const units = buildClassificationUnits(foundation).units; construction.push(performance.now() - start);
	const unit = units[0]; start = performance.now(); const geometry = unit ? buildClassificationUnitHighlight(runtime, unit) : null; geometry?.dispose(); highlight.push(performance.now() - start);
	const document = createGroundTruthDocument({ modelId: unit?.modelId || 'empty', sourceExportHash: 'benchmark', split: 'train', annotations: [] });
	start = performance.now(); const serialized = JSON.stringify(document); exportTimes.push(performance.now() - start);
	start = performance.now(); validateGroundTruthDocument(JSON.parse(serialized), { sourceExportHash: 'benchmark', units }); importTimes.push(performance.now() - start);
}
console.log(JSON.stringify({ path, iterations, medianMs: { classificationUnitConstruction: median(construction), selectedUnitHighlight: median(highlight), annotationExport: median(exportTimes), annotationImport: median(importTimes) } }, null, 2));
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return Number((sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2).toFixed(3)); }
