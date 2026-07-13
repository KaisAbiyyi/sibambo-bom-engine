import { basename, join } from 'node:path';
import { ShapeUtils, Vector2 } from 'three';
import {
	parseBomModelJson,
	readBomModelData,
	type BomModelJson,
	type FaceRecord,
	type ParsedBuildingModel
} from '../../model-eval/src/lib/model';

const ROOT = 'D:/projects/sibambo-bom-engine';
const UI_MAX_FILE_BYTES = 80 * 1024 * 1024;
const UI_MAX_DECOMPRESSED_BYTES = 120 * 1024 * 1024;
const slugs = ['house2', 'presentation20', 'project-sboost', 'project-sboost-2', 'test'];

type MemorySnapshot = ReturnType<typeof process.memoryUsage>;

type LoadMetric = {
	status: 'ok' | 'rejected' | 'failed';
	format: 'legacy-json-v2.1' | 'bome-v1-gzip';
	path: string;
	file_bytes: number;
	decompressed_bytes: number | null;
	reason?: string;
	decode_and_container_parse_ms?: number;
	model_parse_ms?: number;
	triangulation_ms?: number;
	total_pipeline_ms?: number;
	heap_delta_bytes?: number;
	rss_delta_bytes?: number;
	heap_before_bytes?: number;
	heap_after_bytes?: number;
	rss_before_bytes?: number;
	rss_after_bytes?: number;
	external_before_bytes?: number;
	external_after_bytes?: number;
	entities?: number;
	faces?: number;
	vertices?: number;
	triangles?: number;
	materials?: number;
	classification?: {
		parts: ParsedBuildingModel['partStats'];
		surfaces: ParsedBuildingModel['surfaceStats'];
	};
	warnings?: string[];
};

function round(value: number, digits = 2) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function delta(after: MemorySnapshot, before: MemorySnapshot, key: keyof MemorySnapshot) {
	return Number(after[key]) - Number(before[key]);
}

function forceGc() {
	if (typeof Bun.gc === 'function') Bun.gc(true);
}

function materialCount(data: BomModelJson) {
	if (data.mesh?.materials) return data.mesh.materials.length;
	if (!data.materials) return 0;
	return Array.isArray(data.materials) ? data.materials.length : Object.keys(data.materials).length;
}

function faceNormal(vertices: FaceRecord['vertices']) {
	let x = 0;
	let y = 0;
	let z = 0;
	for (let index = 0; index < vertices.length; index += 1) {
		const current = vertices[index];
		const next = vertices[(index + 1) % vertices.length];
		x += (current.y - next.y) * (current.z + next.z);
		y += (current.z - next.z) * (current.x + next.x);
		z += (current.x - next.x) * (current.y + next.y);
	}
	return { x, y, z };
}

function triangleCount(face: FaceRecord) {
	if (face.vertices.length < 3) return 0;
	if (face.vertices.length === 3 && face.holes.length === 0) return 1;
	const normal = faceNormal(face.vertices);
	const axis =
		Math.abs(normal.x) >= Math.abs(normal.y) && Math.abs(normal.x) >= Math.abs(normal.z)
			? 'x'
			: Math.abs(normal.y) >= Math.abs(normal.z)
				? 'y'
				: 'z';
	const project = (point: FaceRecord['vertices'][number]) =>
		axis === 'x' ? new Vector2(point.z, point.y) : axis === 'y' ? new Vector2(point.x, point.z) : new Vector2(point.x, point.y);
	return ShapeUtils.triangulateShape(face.vertices.map(project), face.holes.map((loop) => loop.map(project))).length;
}

function countTriangles(faces: FaceRecord[]) {
	let total = 0;
	for (const face of faces) total += triangleCount(face);
	return total;
}

async function decompressedSize(path: string) {
	const file = Bun.file(path);
	if (!path.toLowerCase().endsWith('.gz')) return file.size;
	const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
	return (await new Response(stream).arrayBuffer()).byteLength;
}

async function benchmarkLoad(path: string, format: LoadMetric['format'], enforceUiFileLimit: boolean): Promise<LoadMetric> {
	const file = Bun.file(path);
	const base: LoadMetric = {
		status: 'failed',
		format,
		path,
		file_bytes: file.size,
		decompressed_bytes: null
	};
	if (enforceUiFileLimit && file.size > UI_MAX_FILE_BYTES) {
		return {
			...base,
			status: 'rejected',
			reason: `model-eval UI limit ${UI_MAX_FILE_BYTES} bytes; input ${file.size} bytes`
		};
	}

	try {
		base.decompressed_bytes = await decompressedSize(path);
		if (base.decompressed_bytes > UI_MAX_DECOMPRESSED_BYTES) {
			return {
				...base,
				status: 'rejected',
				reason: `model-eval decompressed limit ${UI_MAX_DECOMPRESSED_BYTES} bytes; input ${base.decompressed_bytes} bytes`
			};
		}
		forceGc();
		const memoryBefore = process.memoryUsage();
		const pipelineStarted = performance.now();
		const decodeStarted = performance.now();
		const data = await readBomModelData(file as unknown as File, UI_MAX_DECOMPRESSED_BYTES);
		const decodedAt = performance.now();
		const parsed = parseBomModelJson(data, basename(path));
		const parsedAt = performance.now();
		const triangles = countTriangles(parsed.faces);
		const triangulatedAt = performance.now();
		const memoryAfter = process.memoryUsage();

		return {
			...base,
			status: 'ok',
			decode_and_container_parse_ms: round(decodedAt - decodeStarted),
			model_parse_ms: round(parsedAt - decodedAt),
			triangulation_ms: round(triangulatedAt - parsedAt),
			total_pipeline_ms: round(triangulatedAt - pipelineStarted),
			heap_delta_bytes: delta(memoryAfter, memoryBefore, 'heapUsed'),
			rss_delta_bytes: delta(memoryAfter, memoryBefore, 'rss'),
			heap_before_bytes: memoryBefore.heapUsed,
			heap_after_bytes: memoryAfter.heapUsed,
			rss_before_bytes: memoryBefore.rss,
			rss_after_bytes: memoryAfter.rss,
			external_before_bytes: memoryBefore.external,
			external_after_bytes: memoryAfter.external,
			entities: parsed.entitiesTotal,
			faces: parsed.faceCount,
			vertices: parsed.vertexCount,
			triangles,
			materials: materialCount(data),
			classification: {
				parts: parsed.partStats,
				surfaces: parsed.surfaceStats
			},
			warnings: parsed.warnings
		};
	} catch (error) {
		return {
			...base,
			status: 'failed',
			reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
		};
	}
}

const requestedSlug = Bun.argv.find((argument) => argument.startsWith('--slug='))?.slice('--slug='.length);
const targetSlugs = requestedSlug ? slugs.filter((slug) => slug === requestedSlug) : slugs;
if (requestedSlug && targetSlugs.length === 0) throw new Error(`Unknown slug: ${requestedSlug}`);

for (const slug of targetSlugs) {
	const artifactRoot = join(ROOT, 'artifacts', slug);
	const sketchupMetric = await Bun.file(join(artifactRoot, 'metrics', 'baseline-sketchup.json')).json();
	const fullPath = join(artifactRoot, 'exported', 'baseline-current_full.json');
	const visualPath = join(artifactRoot, 'exported', 'baseline-current_visual.bome.gz');
	// Visual runs first so its memory snapshot is not contaminated by a large full JSON parse.
	const visual = await benchmarkLoad(visualPath, 'bome-v1-gzip', true);
	const full = await benchmarkLoad(fullPath, 'legacy-json-v2.1', true);
	const output = {
		workflow_version: '1.0.0',
		measured_at: new Date().toISOString(),
		model: slug,
		runtime: {
			bun: Bun.version,
			platform: process.platform,
			arch: process.arch,
			ui_max_file_bytes: UI_MAX_FILE_BYTES,
			ui_max_decompressed_bytes: UI_MAX_DECOMPRESSED_BYTES
		},
		source: {
			skp_path: sketchupMetric.model.source_path,
			skp_bytes: sketchupMetric.model.source_bytes,
			units: sketchupMetric.model.units,
			bounds_m: sketchupMetric.model.bounds,
			groups_expanded: sketchupMetric.model.entity_counts_expanded.group,
			component_definitions: sketchupMetric.model.definition_count,
			component_instances_expanded: sketchupMetric.model.entity_counts_expanded.component_instance,
			materials: sketchupMetric.model.material_count,
			tags: sketchupMetric.model.tag_count,
			scenes: sketchupMetric.model.scene_count
		},
		loads: { full, visual }
	};
	await Bun.write(join(artifactRoot, 'metrics', 'baseline-model-eval.json'), `${JSON.stringify(output, null, 2)}\n`);
	console.log(`${slug}: full=${full.status}, visual=${visual.status}, visual_faces=${visual.faces ?? '-'}, visual_ms=${visual.total_pipeline_ms ?? '-'}`);
	forceGc();
}
