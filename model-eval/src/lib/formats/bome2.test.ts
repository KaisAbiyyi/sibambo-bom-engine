import { describe, expect, test } from 'bun:test';
import { canonicalV3ToLegacyBom } from './canonical-v3';
import { bome2ToCanonical, crc32, parseBome2Buffer, parseBome2Manifest } from './bome2';
import { parseBomModelJson, readBomModelData } from '../model';

const MAGIC = new TextEncoder().encode('BOME2\n');
const FIXED = 24;
const DIRECTORY_ENTRY = 32;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translated = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

function fixture() {
	const strings: string[] = [];
	const intern = (value: string) => {
		const found = strings.indexOf(value);
		if (found >= 0) return found;
		strings.push(value);
		return strings.length - 1;
	};
	const transforms = new Float32Array([...identity, ...translated(1), ...translated(2)]);
	const positions = new Uint16Array([
		0, 0, 0,
		65535, 0, 0,
		65535, 65535, 0,
		0, 65535, 0,
		16384, 16384, 0,
		16384, 49151, 0,
		49151, 49151, 0,
		49151, 16384, 0
	]);
	const loops = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]);
	const triangles = new Uint32Array([
		0, 1, 7, 0, 7, 4,
		1, 2, 6, 1, 6, 7,
		2, 3, 5, 2, 5, 6,
		3, 0, 4, 3, 4, 5
	]);
	const sections = [
		{ kind: 4, mesh: 0xffffffff, component: 3, count: transforms.length, bytes: new Uint8Array(transforms.buffer) },
		{ kind: 1, mesh: 0, component: 1, count: positions.length, bytes: new Uint8Array(positions.buffer) },
		{ kind: 2, mesh: 0, component: 2, count: loops.length, bytes: new Uint8Array(loops.buffer) },
		{ kind: 3, mesh: 0, component: 2, count: triangles.length, bytes: new Uint8Array(triangles.buffer) }
	];
	const rootDefinitionId = intern('definition:root');
	const componentDefinitionId = intern('definition:panel');
	const rootNodeId = intern('node:root');
	const firstNodeId = intern('node:panel:1');
	const secondNodeId = intern('node:panel:2');
	const manifest = {
		format: { name: 'BOME2', version: '2.0.0', canonical_version: '3.0.0', layout: 'section_directory_v1' },
		source: { file_name: intern('fixture.skp'), model_name: intern('Fixture'), scope: intern('model'), exported_at: intern('2026-07-13T00:00:00Z') },
		strings,
		materials: [
			{
				id: intern('material:brick'), name: intern('Brick'), display_name: intern('Brick'),
				color_rgba: [170, 85, 34, 255], color_hex: intern('#AA5522'), opacity: 1, texture: -1
			}
		],
		tags: [{ id: intern('tag:0'), name: intern('Untagged'), visible: true }],
		transforms: { section: 0, count: 3, component_type: 'float32' },
		meshes: [
			{
				id: intern('mesh:panel'), definition: 1, positions_section: 1, loops_section: 2, triangles_section: 3,
				vertex_count: 8, triangle_count: 8,
				quantization: {
					component_type: 'uint16', minimum_m: [0, 0, 0], maximum_m: [1, 1, 0],
					scale_m: [1 / 65535, 1 / 65535, 0], measured_max_error_m: 0.000011, error_budget_m: 0.001
				},
				faces: [
					{
						id: intern('face:1'), source_persistent_id: intern('1'), outer_start: 0, outer_count: 4,
						holes: [[4, 4]], triangle_start: 0, triangle_count: 24,
						material: 0, back_material: -1, tag: 0, surface_hint: intern('floor'), area_m2: 0.75
					}
				]
			}
		],
		definitions: [
			{ id: rootDefinitionId, name: intern('Root'), kind: intern('root'), mesh: -1, nodes: [1, 2] },
			{ id: componentDefinitionId, name: intern('Panel'), kind: intern('component_definition'), mesh: 0, nodes: [] }
		],
		nodes: [
			{ id: rootNodeId, name: intern('Root'), kind: 1, owner_definition: -1, definition: 0, transform: 0, material: -1, tag: -1, visible: true, source_persistent_id: -1 },
			{ id: firstNodeId, name: intern('Panel 1'), kind: 2, owner_definition: 0, definition: 1, transform: 1, material: -1, tag: 0, visible: true, source_persistent_id: intern('101') },
			{ id: secondNodeId, name: intern('Panel 2'), kind: 2, owner_definition: 0, definition: 1, transform: 2, material: -1, tag: 0, visible: true, source_persistent_id: intern('102') }
		],
		root_node: 0,
		statistics: { unique_meshes: 1, definitions: 2, nodes: 3, component_instances: 2, unique_vertices: 8, triangles: 8, sections: 4 }
	};
	return encode(manifest, sections);
}

describe('BOME2 runtime codec', () => {
	test('decodes manifest progressively before touching corrupt geometry', () => {
		const buffer = fixture();
		const manifest = parseBome2Manifest(buffer);
		expect(manifest.manifest.meshes).toHaveLength(1);
		expect(manifest.sections).toHaveLength(4);
		const corrupted = buffer.slice(0);
		new Uint8Array(corrupted)[corrupted.byteLength - 1] ^= 0xff;
		expect(() => parseBome2Manifest(corrupted)).not.toThrow();
		expect(() => parseBome2Buffer(corrupted)).toThrow('checksum mismatch');
	});

	test('decodes indexed holes, triangles, transforms, and shared instances', () => {
		const runtime = parseBome2Buffer(fixture());
		expect(runtime.meshes).toHaveLength(1);
		expect(runtime.meshes[0].positions).toHaveLength(24);
		expect(runtime.meshes[0].triangles).toHaveLength(24);
		expect(runtime.manifest.nodes.filter((node) => node.kind === 2)).toHaveLength(2);
		expect(runtime.meshes[0].manifest.quantization.measured_max_error_m).toBeLessThanOrEqual(0.001);

		const canonical = bome2ToCanonical(runtime);
		expect(canonical.meshes[0].faces[0].holes).toEqual([[4, 5, 6, 7]]);
		const legacy = canonicalV3ToLegacyBom(canonical);
		expect(legacy.entities?.[0].children).toHaveLength(2);
		expect(legacy.entities?.[0].children?.[0].children?.[0].vertices?.[0].position.x).toBe(1);
		expect(legacy.entities?.[0].children?.[1].children?.[0].vertices?.[0].position.x).toBe(2);
	});

	test('rejects corrupt directory bounds and counts before allocation', () => {
		const source = fixture();
		const decoded = parseBome2Manifest(source);
		const directoryOffset = MAGIC.length + FIXED + decoded.headerBytes;
		const badOffset = source.slice(0);
		new DataView(badOffset).setUint32(directoryOffset + 8, badOffset.byteLength + 64, true);
		expect(() => parseBome2Manifest(badOffset)).toThrow('bounds outside file');

		const badCount = source.slice(0);
		new DataView(badCount).setUint32(directoryOffset + 16, 999999, true);
		expect(() => parseBome2Manifest(badCount)).toThrow('byte count mismatch');
	});

	test('loads through public file dispatch while retaining runtime scene', async () => {
		const file = new File([fixture()], 'fixture.bome2', { type: 'application/octet-stream' });
		const data = await readBomModelData(file, 1024 * 1024);
		const parsed = parseBomModelJson(data, file.name);
		expect(parsed.faceCount).toBe(2);
		expect(parsed.runtimeScene?.format).toBe('bome2_runtime_v2');
		expect(parsed.runtimeScene?.meshes).toHaveLength(1);
		expect(parsed.runtimeScene?.manifest.nodes.filter((node) => node.kind === 2)).toHaveLength(2);
	});
});

function encode(manifest: Record<string, unknown>, sections: Array<{ kind: number; mesh: number; component: number; count: number; bytes: Uint8Array }>) {
	const manifestJson = JSON.stringify(manifest);
	const encoded = new TextEncoder().encode(manifestJson);
	const padding = (4 - ((MAGIC.length + FIXED + encoded.length) % 4)) % 4;
	const header = new Uint8Array(encoded.length + padding);
	header.set(encoded);
	header.fill(0x20, encoded.length);
	const directoryBytes = sections.length * DIRECTORY_ENTRY;
	let cursor = MAGIC.length + FIXED + header.length + directoryBytes;
	const offsets: number[] = [];
	for (const section of sections) {
		cursor += (4 - (cursor % 4)) % 4;
		offsets.push(cursor);
		cursor += section.bytes.length;
	}
	const output = new ArrayBuffer(cursor);
	const bytes = new Uint8Array(output);
	bytes.set(MAGIC);
	const view = new DataView(output);
	let fixedOffset = MAGIC.length;
	for (const value of [header.length, directoryBytes, sections.length, crc32(encoded), 1, 0]) {
		view.setUint32(fixedOffset, value, true);
		fixedOffset += 4;
	}
	bytes.set(header, MAGIC.length + FIXED);
	const directoryOffset = MAGIC.length + FIXED + header.length;
	sections.forEach((section, index) => {
		const base = directoryOffset + index * DIRECTORY_ENTRY;
		for (const [field, value] of [section.kind, section.mesh, offsets[index], section.bytes.length, section.count, section.component, crc32(section.bytes), 0].entries()) {
			view.setUint32(base + field * 4, value, true);
		}
		bytes.set(section.bytes, offsets[index]);
	});
	return output;
}
