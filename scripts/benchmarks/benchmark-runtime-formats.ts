import { join } from 'node:path';
import { bome2ToCanonical, parseBome2Buffer } from '../../model-eval/src/lib/formats/bome2';
import { buildRuntimeGeometryGroups } from '../../model-eval/src/lib/render/build-runtime-scene';
import { parseBomModelJson, readBomModelData, type BomModelJson } from '../../model-eval/src/lib/model';

const ROOT = 'D:/projects/sibambo-bom-engine';
const slug = Bun.argv.find((argument) => argument.startsWith('--slug='))?.slice(7) || 'project-sboost-2';
const exported = join(ROOT, 'artifacts', slug, 'exported');
const metricsPath = join(ROOT, 'artifacts', slug, 'metrics', 'phase2-runtime-benchmark.json');
const paths = {
	bome1: join(exported, 'baseline-current_visual.bome.gz'),
	canonical: join(exported, `${slug}_canonical.json.gz`),
	bome2: join(exported, `${slug}_runtime.bome2.gz`),
	glb: join(exported, `${slug}.glb`)
};

type Memory = ReturnType<typeof process.memoryUsage>;

function snapshot() {
	if (typeof Bun.gc === 'function') Bun.gc(true);
	return process.memoryUsage();
}

function memoryDelta(before: Memory, after: Memory) {
	return {
		heap_bytes: after.heapUsed - before.heapUsed,
		rss_bytes: after.rss - before.rss,
		external_bytes: after.external - before.external
	};
}

function round(value: number) {
	return Math.round(value * 100) / 100;
}

async function gzipBytes(path: string) {
	const compressed = new Uint8Array(await Bun.file(path).arrayBuffer());
	const start = performance.now();
	const inflated = Bun.gunzipSync(compressed);
	return { compressed, inflated, decompressMs: performance.now() - start };
}

async function benchmarkBome2Runtime() {
	const before = snapshot();
	const file = await gzipBytes(paths.bome2);
	const decodeStart = performance.now();
	const buffer = file.inflated.buffer.slice(file.inflated.byteOffset, file.inflated.byteOffset + file.inflated.byteLength);
	const runtime = parseBome2Buffer(buffer);
	const decodeMs = performance.now() - decodeStart;
	const buildStart = performance.now();
	const groups = buildRuntimeGeometryGroups(runtime);
	const buildMs = performance.now() - buildStart;
	const after = process.memoryUsage();
	const result = {
		format: 'BOME2 runtime-only indexed/instanced',
		file_bytes: file.compressed.byteLength,
		decompressed_bytes: file.inflated.byteLength,
		decompress_ms: round(file.decompressMs),
		decode_validate_ms: round(decodeMs),
		runtime_group_build_ms: round(buildMs),
		total_ms: round(file.decompressMs + decodeMs + buildMs),
		memory_delta: memoryDelta(before, after),
		unique_meshes: runtime.meshes.length,
		unique_vertices: runtime.meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0),
		unique_triangles: runtime.meshes.reduce((sum, mesh) => sum + mesh.triangles.length / 3, 0),
		render_groups: groups.length,
		instance_matrices: groups.reduce((sum, group) => sum + group.matrices.length, 0),
		quantization_max_error_m: Math.max(...runtime.manifest.meshes.map((mesh) => mesh.quantization.measured_max_error_m), 0)
	};
	groups.forEach((group) => group.geometry.dispose());
	return result;
}

async function benchmarkBome2Compatibility() {
	const before = snapshot();
	const file = await gzipBytes(paths.bome2);
	const decodeStart = performance.now();
	const buffer = file.inflated.buffer.slice(file.inflated.byteOffset, file.inflated.byteOffset + file.inflated.byteLength);
	const runtime = parseBome2Buffer(buffer);
	const canonical = bome2ToCanonical(runtime) as BomModelJson;
	canonical.__bome2Runtime = runtime;
	const decodeMs = performance.now() - decodeStart;
	const parseStart = performance.now();
	const parsed = parseBomModelJson(canonical, `${slug}.bome2`);
	const parseMs = performance.now() - parseStart;
	const after = process.memoryUsage();
	return {
		format: 'BOME2 analysis compatibility expansion',
		decode_ms: round(decodeMs),
		model_parse_ms: round(parseMs),
		total_ms: round(file.decompressMs + decodeMs + parseMs),
		memory_delta: memoryDelta(before, after),
		faces: parsed.faceCount,
		vertices: parsed.vertexCount
	};
}

async function benchmarkCanonical() {
	const before = snapshot();
	const file = await gzipBytes(paths.canonical);
	const decodeStart = performance.now();
	const data = JSON.parse(new TextDecoder().decode(file.inflated)) as BomModelJson;
	const decodeMs = performance.now() - decodeStart;
	const parseStart = performance.now();
	const parsed = parseBomModelJson(data, `${slug}.json`);
	const parseMs = performance.now() - parseStart;
	const after = process.memoryUsage();
	return {
		format: 'Canonical JSON v3 compatibility analysis',
		file_bytes: file.compressed.byteLength,
		decompressed_bytes: file.inflated.byteLength,
		decompress_ms: round(file.decompressMs),
		json_parse_ms: round(decodeMs),
		model_parse_ms: round(parseMs),
		total_ms: round(file.decompressMs + decodeMs + parseMs),
		memory_delta: memoryDelta(before, after),
		faces: parsed.faceCount,
		vertices: parsed.vertexCount
	};
}

async function benchmarkBome1() {
	const before = snapshot();
	const bytes = await Bun.file(paths.bome1).arrayBuffer();
	const file = new File([bytes], 'baseline-current_visual.bome.gz', { type: 'application/gzip' });
	const decodeStart = performance.now();
	const data = await readBomModelData(file, 128 * 1024 * 1024);
	const decodeMs = performance.now() - decodeStart;
	const parseStart = performance.now();
	const parsed = parseBomModelJson(data, file.name);
	const parseMs = performance.now() - parseStart;
	const after = process.memoryUsage();
	return {
		format: 'BOME1 flattened baseline',
		file_bytes: file.size,
		decode_ms: round(decodeMs),
		model_parse_ms: round(parseMs),
		total_ms: round(decodeMs + parseMs),
		memory_delta: memoryDelta(before, after),
		faces: parsed.faceCount,
		vertices: parsed.vertexCount
	};
}

async function benchmarkGlb() {
	if (!(await Bun.file(paths.glb).exists())) {
		return {
			status: 'not_generated',
			format: 'GLB 2 derived visual runtime',
			reason: 'GLB is optional and was benchmarked on project-sboost-2 as the representative corpus model.'
		};
	}
	const before = snapshot();
	const readStart = performance.now();
	const buffer = await Bun.file(paths.glb).arrayBuffer();
	const readMs = performance.now() - readStart;
	const parseStart = performance.now();
	const view = new DataView(buffer);
	if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
		throw new Error('GLB header invalid.');
	}
	const jsonBytes = view.getUint32(12, true);
	if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB JSON chunk missing.');
	const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonBytes)).trimEnd());
	const parseMs = performance.now() - parseStart;
	const after = process.memoryUsage();
	const indexAccessors = json.meshes.flatMap((mesh: { primitives: Array<{ indices: number }> }) => mesh.primitives.map((primitive) => json.accessors[primitive.indices]));
	return {
		status: 'ok',
		format: 'GLB 2 derived visual runtime',
		file_bytes: buffer.byteLength,
		read_ms: round(readMs),
		container_json_parse_ms: round(parseMs),
		total_ms: round(readMs + parseMs),
		memory_delta: memoryDelta(before, after),
		unique_meshes: json.meshes.length,
		nodes: json.nodes.length,
		draw_primitives: indexAccessors.length,
		unique_triangles: indexAccessors.reduce((sum: number, accessor: { count: number }) => sum + accessor.count / 3, 0),
		retained_semantics: json.extras?.retained_semantics || [],
		omitted_semantics: json.extras?.omitted_semantics || []
	};
}

const result = {
	workflow_version: '2.0.0',
	measured_at: new Date().toISOString(),
	model: slug,
	runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
	formats: {
		bome1: await benchmarkBome1(),
		canonical_v3: await benchmarkCanonical(),
		bome2_runtime: await benchmarkBome2Runtime(),
		bome2_analysis_compatibility: await benchmarkBome2Compatibility(),
		glb: await benchmarkGlb()
	}
};

await Bun.write(metricsPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
