import { createClassificationUnitIndex, classificationUnitFingerprint } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';

const path = Bun.argv[2];
if (!path) throw new Error('Usage: bun run scripts/profile-four-runs.ts <model-eval-json>');

console.log(`=== STARTING 4-RUN PROFILE BENCHMARK FOR: ${path} ===`);

interface RunResult {
	fileReadMs: number;
	jsonParseMs: number;
	runtimeConstructionMs: number;
	instanceGraphMs: number;
	logicalObjectIndexingMs: number;
	indexInitializationMs: number;
	clusteringMs: number;
	groupingAdjacencyMs: number;
	fingerprintMs: number;
	serializationMs: number;
	totalMs: number;
	unitCount: number;
	fingerprint: string;
	vertexTransforms: number;
	edgeKeyConstructions: number;
}

const results: RunResult[] = [];

for (let run = 0; run < 4; run++) {
	console.log(`\n--- RUN ${run === 0 ? '0 (COLD)' : run} ---`);

	// Measure file read only for cold run, or re-read to measure filesystem warm state
	const t0 = performance.now();
	const text = await Bun.file(path).text();
	const t1 = performance.now();
	const fileReadMs = t1 - t0;

	const t_parse_0 = performance.now();
	const document = JSON.parse(text);
	const t_parse_1 = performance.now();
	const jsonParseMs = t_parse_1 - t_parse_0;

	const t_runtime_0 = performance.now();
	const runtime = parseModelEvalJsonV1(document);
	const t_runtime_1 = performance.now();
	const runtimeConstructionMs = t_runtime_1 - t_runtime_0;

	const t_geom_0 = performance.now();
	const foundation = createGeometryFoundation(runtime);
	const t_geom_1 = performance.now();
	const instanceGraphMs = t_geom_1 - t_geom_0;

	const t_index_obj_0 = performance.now();
	const indexingResult = foundation.buildLogicalObjectIndex();
	const t_index_obj_1 = performance.now();
	const logicalObjectIndexingMs = t_index_obj_1 - t_index_obj_0;

	const t_init_0 = performance.now();
	const index = createClassificationUnitIndex(foundation);
	const t_init_1 = performance.now();
	const indexInitializationMs = t_init_1 - t_init_0;

	// Intercept processObject to measure clustering separately
	let totalClusteringMs = 0;
	const originalProcessObject = index.processObject;
	index.processObject = function(logicalObjectId: string) {
		const tClust0 = performance.now();
		const clusters = this.foundation.buildSurfaceClusters(logicalObjectId);
		const tClust1 = performance.now();
		totalClusteringMs += (tClust1 - tClust0);
		return originalProcessObject.call(this, logicalObjectId);
	};

	const t_proc_0 = performance.now();
	const units = index.processAll();
	const t_proc_1 = performance.now();
	const processTotalMs = t_proc_1 - t_proc_0;
	const clusteringMs = totalClusteringMs;
	const groupingAdjacencyMs = processTotalMs - totalClusteringMs;

	const t_fp_0 = performance.now();
	const fingerprint = classificationUnitFingerprint(units);
	const t_fp_1 = performance.now();
	const fingerprintMs = t_fp_1 - t_fp_0;

	const t_ser_0 = performance.now();
	const serializedSample = JSON.stringify(units.slice(0, 1000));
	const t_ser_1 = performance.now();
	const serializationMs = (t_ser_1 - t_ser_0) * (units.length / 1000);

	const totalMs = fileReadMs + jsonParseMs + runtimeConstructionMs + instanceGraphMs + logicalObjectIndexingMs + indexInitializationMs + processTotalMs + fingerprintMs + serializationMs;

	const geoDiag = foundation.getDiagnostics();

	const runResult: RunResult = {
		fileReadMs,
		jsonParseMs,
		runtimeConstructionMs,
		instanceGraphMs,
		logicalObjectIndexingMs,
		indexInitializationMs,
		clusteringMs,
		groupingAdjacencyMs,
		fingerprintMs,
		serializationMs,
		totalMs,
		unitCount: units.length,
		fingerprint,
		vertexTransforms: geoDiag.vertexTransforms || 0,
		edgeKeyConstructions: geoDiag.edgeKeyConstructions || 0
	};

	results.push(runResult);

	console.log(`File read: ${fileReadMs.toFixed(3)} ms`);
	console.log(`JSON.parse: ${jsonParseMs.toFixed(3)} ms`);
	console.log(`Compact runtime construction: ${runtimeConstructionMs.toFixed(3)} ms`);
	console.log(`Instance graph readiness: ${instanceGraphMs.toFixed(3)} ms`);
	console.log(`Logical-object indexing: ${logicalObjectIndexingMs.toFixed(3)} ms`);
	console.log(`Index initialization: ${indexInitializationMs.toFixed(3)} ms`);
	console.log(`Process objects (Clustering + Grouping + Adjacency): ${processTotalMs.toFixed(3)} ms`);
	console.log(`  - Clustering: ${clusteringMs.toFixed(3)} ms`);
	console.log(`  - Grouping & Adjacency: ${groupingAdjacencyMs.toFixed(3)} ms`);
	console.log(`Semantic fingerprinting: ${fingerprintMs.toFixed(3)} ms`);
	console.log(`Report serialization (estimated): ${serializationMs.toFixed(3)} ms`);
	console.log(`Total processing: ${totalMs.toFixed(3)} ms`);
	console.log(`Units: ${units.length}`);
	console.log(`Fingerprint: ${fingerprint}`);
}

// Compute median of warm runs (indices 1, 2, 3)
const warmRuns = results.slice(1);
const median = (key: keyof RunResult) => {
	const values = warmRuns.map(r => r[key] as number);
	values.sort((a, b) => a - b);
	return values[1];
};

console.log(`\n=== BENCHMARK MEDIAN OF 3 WARM RUNS ===`);
console.log(`File read: ${median('fileReadMs').toFixed(3)} ms`);
console.log(`JSON.parse: ${median('jsonParseMs').toFixed(3)} ms`);
console.log(`Compact runtime construction: ${median('runtimeConstructionMs').toFixed(3)} ms`);
console.log(`Instance graph readiness: ${median('instanceGraphMs').toFixed(3)} ms`);
console.log(`Logical-object indexing: ${median('logicalObjectIndexingMs').toFixed(3)} ms`);
console.log(`Index initialization: ${median('indexInitializationMs').toFixed(3)} ms`);
console.log(`Clustering: ${median('clusteringMs').toFixed(3)} ms`);
console.log(`Grouping & Adjacency: ${median('groupingAdjacencyMs').toFixed(3)} ms`);
console.log(`Semantic fingerprinting: ${median('fingerprintMs').toFixed(3)} ms`);
console.log(`Report serialization (estimated): ${median('serializationMs').toFixed(3)} ms`);
console.log(`Total processing (warm median): ${median('totalMs').toFixed(3)} ms`);
console.log(`Required processing total (without fingerprint/serialization): ${(
	median('fileReadMs') + median('jsonParseMs') + median('runtimeConstructionMs') +
	median('instanceGraphMs') + median('logicalObjectIndexingMs') + median('indexInitializationMs') +
	median('clusteringMs') + median('groupingAdjacencyMs')
).toFixed(3)} ms`);
