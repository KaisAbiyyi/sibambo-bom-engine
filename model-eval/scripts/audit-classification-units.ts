import { createClassificationUnitIndex } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';

type Options = { mode: 'summary' | 'full'; logicalObjectId?: string; sample?: number; jsonPath?: string; timeoutMs?: number; profile: boolean; path: string };

const options = parseOptions(Bun.argv.slice(2));
const startedAt = performance.now();
const stage = new Map<string, number>();
const mark = (name: string, from: number) => { stage.set(name, performance.now() - from); };
const timedOut = (name: string) => options.timeoutMs !== undefined && performance.now() - startedAt > options.timeoutMs ? name : null;

let started = performance.now();
const sourceText = await Bun.file(options.path).text();
mark('compactJsonReadMs', started);
started = performance.now();
const document = JSON.parse(sourceText);
mark('compactJsonParseMs', started);
started = performance.now();
const runtime = parseModelEvalJsonV1(document);
mark('compactRuntimeConstructionMs', started);
started = performance.now();
const foundation = createGeometryFoundation(runtime);
mark('instanceGraphConstructionMs', started);
started = performance.now();
const objects = foundation.buildLogicalObjectIndex().objects;
mark('logicalObjectIndexMs', started);

const base = {
	path: options.path,
	mode: options.mode,
	inputBytes: sourceText.length,
	format: runtime.format,
	meshCount: runtime.meshes.length,
	definitionCount: runtime.manifest.definitions.length,
	manifestNodeCount: runtime.manifest.nodes.length,
	instanceGraphNodeCount: foundation.instanceGraph.nodes.length,
	logicalObjectCount: objects.length,
	sourcePrimitiveCount: runtime.manifest.meshes.reduce((sum, mesh) => sum + mesh.faces.length, 0),
	triangleCount: runtime.manifest.meshes.reduce((sum, mesh) => sum + mesh.triangle_count, 0),
	materialCount: runtime.manifest.materials.length
};

let stoppedAt: string | null = timedOut('logical-object-index');
let result: Record<string, unknown> = { ...base };
if (!stoppedAt && options.mode === 'full') {
	const index = createClassificationUnitIndex(foundation);
	const targetObjects = options.logicalObjectId ? objects.filter((object) => object.id === options.logicalObjectId) : objects;
	if (options.logicalObjectId && !targetObjects.length) throw new Error(`Logical object not found: ${options.logicalObjectId}`);
	let clusterMs = 0;
	let groupingMs = 0;
	let maximumClusterCount = 0;
	let maximumPrimitiveCount = 0;
	let surfaceClusterCount = 0;
	const perObject: Array<{ id: string; clusterMs: number; groupingMs: number; clusterCount: number; primitiveCount: number }> = [];
	for (const object of targetObjects) {
		if (stoppedAt = timedOut('surface-cluster-construction')) break;
		started = performance.now();
		const clusters = foundation.buildSurfaceClusters(object.id);
		const thisClusterMs = performance.now() - started;
		clusterMs += thisClusterMs;
		surfaceClusterCount += clusters.length;
		maximumClusterCount = Math.max(maximumClusterCount, clusters.length);
		maximumPrimitiveCount = Math.max(maximumPrimitiveCount, object.faceOrPrimitiveIds.length);
		if (stoppedAt = timedOut('classification-unit-grouping')) break;
		started = performance.now();
		index.processObject(object.id);
		const thisGroupingMs = performance.now() - started;
		groupingMs += thisGroupingMs;
		if (options.profile) perObject.push({ id: object.id, clusterMs: thisClusterMs, groupingMs: thisGroupingMs, clusterCount: clusters.length, primitiveCount: object.faceOrPrimitiveIds.length });
	}
	const units = index.units;
	const sample = options.sample ? deterministicSample(units, options.sample) : undefined;
	result = {
		...base,
		classificationUnitCount: units.length,
		surfaceClusterCount,
		maximumClusterCount,
		maximumPrimitiveCount,
		stageMs: { ...Object.fromEntries(stage), surfaceClusterConstructionMs: Number(clusterMs.toFixed(3)), classificationUnitGroupingMs: Number(groupingMs.toFixed(3)), adjacencyConstructionMs: Number(groupingMs.toFixed(3)), deterministicIdGenerationMs: 0, auditReportSerializationMs: 0 },
		stoppedAt,
		profile: options.profile ? { geometry: foundation.getDiagnostics(), annotation: index.counters, retainedGeometry: foundation.retainedGeometryBytes(), slowestLogicalObjects: perObject.sort((left, right) => right.clusterMs + right.groupingMs - left.clusterMs - left.groupingMs).slice(0, 20) } : undefined,
		sample
	};
} else if (options.mode === 'summary') {
	result = { ...base, stageMs: Object.fromEntries(stage), stoppedAt };
}

started = performance.now();
const output = JSON.stringify(result, null, options.jsonPath ? 2 : 2);
const serializationMs = performance.now() - started;
const resultStages = result.stageMs as Record<string, number> | undefined;
if (resultStages) resultStages.auditReportSerializationMs = Number(serializationMs.toFixed(3));
const finalOutput = JSON.stringify(result, null, options.jsonPath ? 2 : 2);
if (options.jsonPath) await Bun.write(options.jsonPath, finalOutput);
console.log(finalOutput);

function parseOptions(args: string[]): Options {
	let mode: Options['mode'] = 'summary'; let logicalObjectId: string | undefined; let sample: number | undefined; let jsonPath: string | undefined; let timeoutMs: number | undefined; let profile = false; let path: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--summary') mode = 'summary';
		else if (arg === '--full') mode = 'full';
		else if (arg === '--logical-object') { logicalObjectId = args[++index]; mode = 'full'; }
		else if (arg === '--sample') sample = Number(args[++index]);
		else if (arg === '--json') jsonPath = args[++index];
		else if (arg === '--timeout-ms') timeoutMs = Number(args[++index]);
		else if (arg === '--profile') profile = true;
		else if (!arg.startsWith('--') && !path) path = arg;
		else throw new Error(`Unknown audit argument: ${arg}`);
	}
	if (!path) throw new Error('Usage: bun run audit:classification-units -- <model-eval-json> [--summary|--full] [--logical-object <id>] [--sample <count>] [--json <path>] [--timeout-ms <value>] [--profile]');
	if (sample !== undefined && (!Number.isInteger(sample) || sample < 1)) throw new Error('--sample must be a positive integer.');
	if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 1)) throw new Error('--timeout-ms must be positive.');
	return { mode, logicalObjectId, sample, jsonPath, timeoutMs, profile, path };
}

function deterministicSample<T>(values: readonly T[], count: number) {
	if (values.length <= count) return [...values];
	const step = values.length / count;
	return Array.from({ length: count }, (_, index) => values[Math.floor(index * step)]);
}
