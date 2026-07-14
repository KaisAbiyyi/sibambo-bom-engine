import { createClassificationUnitIndex, classificationUnitFingerprint } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';
import { createHash } from 'crypto';

const path = Bun.argv[2];
if (!path) throw new Error('Usage: bun run profile-stages.ts <model-eval-json>');

console.log(`=== DIAGNOSTIC PASS FOR: ${path} ===`);

const t0 = performance.now();
const text = await Bun.file(path).text();
const t1 = performance.now();
console.log(`File read: ${(t1 - t0).toFixed(3)} ms`);

const document = JSON.parse(text);
const t2 = performance.now();
console.log(`JSON.parse: ${(t2 - t1).toFixed(3)} ms`);

const runtime = parseModelEvalJsonV1(document);
const t3 = performance.now();
console.log(`Compact runtime construction: ${(t3 - t2).toFixed(3)} ms`);

const foundation = createGeometryFoundation(runtime);
const t4 = performance.now();
console.log(`Instance graph readiness: ${(t4 - t3).toFixed(3)} ms`);

// Trigger logical object indexing
const indexingResult = foundation.buildLogicalObjectIndex();
const t5 = performance.now();
console.log(`Logical-object indexing: ${(t5 - t4).toFixed(3)} ms`);

const index = createClassificationUnitIndex(foundation);
const t6 = performance.now();
console.log(`Index initialization: ${(t6 - t5).toFixed(3)} ms`);

// Measure clustering, grouping, adjacency during index.processAll()
// We will intercept/profile the objects processing
const objects = indexingResult.objects;
let totalClusteringMs = 0;
let totalGroupingMs = 0;
let totalAdjacencyMs = 0;

const originalProcessObject = index.processObject;
index.processObject = function(logicalObjectId: string) {
	const object = this.objects.find((candidate) => candidate.id === logicalObjectId);
	if (!object) throw new Error(`Logical object ${logicalObjectId} missing.`);
	const node = this.foundation.instanceGraph.byNodeId.get(object.nodeId);
	if (!node) throw new Error(`Logical object ${logicalObjectId} has no instance node.`);

	const tClust0 = performance.now();
	const clusters = this.foundation.buildSurfaceClusters(object.id);
	const tClust1 = performance.now();
	totalClusteringMs += (tClust1 - tClust0);

	// Import groupCompatibleClusters dynamically to call it or profile
	// Wait, we can just measure the rest of the original processObject
	const beforeGeometry = this.foundation.getDiagnostics();
	const tGroup0 = performance.now();
	// Since groupCompatibleClusters is not exported directly, we let the original run and measure
	return originalProcessObject.call(this, logicalObjectId);
};

const units = index.processAll();
const t7 = performance.now();
console.log(`Process objects (Clustering + Grouping + Adjacency): ${(t7 - t6).toFixed(3)} ms`);
console.log(`  - Of which Clustering: ${totalClusteringMs.toFixed(3)} ms`);
console.log(`  - Of which Grouping & Adjacency: ${(t7 - t6 - totalClusteringMs).toFixed(3)} ms`);

const fingerprint = classificationUnitFingerprint(units);
const t8 = performance.now();
console.log(`Semantic fingerprinting: ${(t8 - t7).toFixed(3)} ms`);

const t8_start = performance.now();
const serializedSample = JSON.stringify(units.slice(0, 1000));
const t8_end = performance.now();
const estimatedSerializationMs = (t8_end - t8_start) * (units.length / 1000);
console.log(`Report serialization: ${estimatedSerializationMs.toFixed(3)} ms (estimated from 1000 units sample)`);
console.log(`Total time: ${(t8_end - t0).toFixed(3)} ms`);

// Diagnostics & Counts
const geoDiag = foundation.getDiagnostics();
console.log('\n=== DIAGNOSTICS & OPERATION COUNTS ===');
console.log(`Logical objects processed: ${index.counters.logicalObjectsProcessed}`);
console.log(`Clusters processed: ${geoDiag.clusterCacheMisses}`);
console.log(`Units produced: ${units.length}`);
console.log(`Transformed vertex operations: ${geoDiag.vertexTransforms || 0}`);
console.log(`Edge-key constructions: ${geoDiag.edgeKeyConstructions || 0}`);
console.log(`World cache hits: ${geoDiag.worldCacheHits}`);
console.log(`World cache misses: ${geoDiag.worldCacheMisses}`);
console.log(`FaceMetric cache hits: ${geoDiag.faceMetricCacheHits}`);
console.log(`FaceMetric cache misses: ${geoDiag.faceMetricCacheMisses}`);
console.log(`Shared edge candidate comparisons: ${geoDiag.sharedEdgeCandidateComparisons}`);
console.log(`Shared edge pairs: ${geoDiag.sharedEdgePairs}`);
console.log(`Compatible cluster comparisons: ${index.counters.compatibleClusterComparisons}`);
console.log(`Unit adjacency comparisons: ${index.counters.unitAdjacencyComparisons}`);
console.log(`Unit adjacency pairs: ${index.counters.unitAdjacencyPairs}`);
