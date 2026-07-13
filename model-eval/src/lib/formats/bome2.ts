import type { CanonicalV3 } from './canonical-v3';

const MAGIC = new TextEncoder().encode('BOME2\n');
const FIXED_HEADER_BYTES = 24;
const DIRECTORY_ENTRY_BYTES = 32;
const LITTLE_ENDIAN_FLAG = 1;
const GLOBAL_SECTION = 0xffff_ffff;

const SECTION = {
	positions: 1,
	loops: 2,
	triangles: 3,
	transforms: 4
} as const;

const COMPONENT_BYTES: Record<number, number> = { 1: 2, 2: 4, 3: 4 };
const NODE_KIND: Record<number, string> = {
	1: 'root',
	2: 'component_instance',
	3: 'group_instance',
	4: 'image',
	5: 'text'
};

export type Bome2Section = {
	index: number;
	kind: number;
	meshIndex: number;
	offset: number;
	byteLength: number;
	count: number;
	componentType: number;
	crc32: number;
};

export type Bome2Face = {
	id: number;
	source_persistent_id: number;
	outer_start: number;
	outer_count: number;
	holes: Array<[number, number]>;
	triangle_start: number;
	triangle_count: number;
	material: number;
	back_material: number;
	tag: number;
	surface_hint: number;
	area_m2: number;
};

export type Bome2MeshManifest = {
	id: number;
	definition: number;
	positions_section: number;
	loops_section: number;
	triangles_section: number;
	vertex_count: number;
	triangle_count: number;
	quantization: {
		component_type: 'uint16' | 'uint32';
		minimum_m: [number, number, number];
		maximum_m: [number, number, number];
		scale_m: [number, number, number];
		measured_max_error_m: number;
		error_budget_m: number;
	};
	faces: Bome2Face[];
};

export type Bome2Manifest = {
	format: { name: 'BOME2'; version: '2.0.0'; canonical_version: string; layout: string };
	source: { file_name: number; model_name: number; scope: number; exported_at: number };
	coordinate_system?: Record<string, unknown>;
	strings: string[];
	materials: Array<{
		id: number;
		name: number;
		display_name: number;
		color_rgba: [number, number, number, number];
		color_hex: number;
		opacity: number;
		texture: number;
	}>;
	tags: Array<{ id: number; name: number; visible: boolean }>;
	transforms: { section: number; count: number; component_type: 'float32' };
	meshes: Bome2MeshManifest[];
	definitions: Array<{ id: number; name: number; kind: number; mesh: number; nodes: number[] }>;
	nodes: Array<{
		id: number;
		name: number;
		kind: number;
		owner_definition: number;
		definition: number;
		transform: number;
		material: number;
		tag: number;
		visible: boolean;
		source_persistent_id: number;
	}>;
	root_node: number;
	statistics: Record<string, number>;
};

export type Bome2MeshRuntime = {
	manifest: Bome2MeshManifest;
	positions: Float32Array;
	loops: Uint32Array;
	triangles: Uint32Array;
};

export type Bome2RuntimeScene = {
	format: 'bome2_runtime_v2';
	manifest: Bome2Manifest;
	sections: Bome2Section[];
	transforms: Float32Array;
	meshes: Bome2MeshRuntime[];
};

export type Bome2ManifestResult = {
	manifest: Bome2Manifest;
	sections: Bome2Section[];
	headerBytes: number;
	dataOffset: number;
};

export function isBome2Buffer(buffer: ArrayBuffer) {
	if (buffer.byteLength < MAGIC.length + FIXED_HEADER_BYTES) return false;
	const bytes = new Uint8Array(buffer, 0, MAGIC.length);
	return MAGIC.every((value, index) => bytes[index] === value);
}

export function parseBome2Manifest(buffer: ArrayBuffer): Bome2ManifestResult {
	if (!isBome2Buffer(buffer)) throw new Error('BOME2 invalid: magic mismatch.');
	const view = new DataView(buffer);
	let offset = MAGIC.length;
	const headerBytes = view.getUint32(offset, true);
	offset += 4;
	const directoryBytes = view.getUint32(offset, true);
	offset += 4;
	const sectionCount = view.getUint32(offset, true);
	offset += 4;
	const manifestChecksum = view.getUint32(offset, true);
	offset += 4;
	const flags = view.getUint32(offset, true);
	offset += 8;
	if ((flags & LITTLE_ENDIAN_FLAG) !== LITTLE_ENDIAN_FLAG) throw new Error('BOME2 invalid: unsupported byte order.');
	if (directoryBytes !== sectionCount * DIRECTORY_ENTRY_BYTES) throw new Error('BOME2 invalid: directory byte count mismatch.');

	const manifestOffset = MAGIC.length + FIXED_HEADER_BYTES;
	const directoryOffset = manifestOffset + headerBytes;
	const dataOffset = directoryOffset + directoryBytes;
	if (dataOffset > buffer.byteLength) throw new Error('BOME2 invalid: header or directory outside file.');
	const manifestBytes = new Uint8Array(buffer, manifestOffset, headerBytes);
	const manifestText = new TextDecoder().decode(manifestBytes).trimEnd();
	const encodedManifest = new TextEncoder().encode(manifestText);
	if (crc32(encodedManifest) !== manifestChecksum) throw new Error('BOME2 invalid: manifest checksum mismatch.');

	let manifest: Bome2Manifest;
	try {
		manifest = JSON.parse(manifestText) as Bome2Manifest;
	} catch (error) {
		throw new Error(`BOME2 invalid: manifest JSON ${error instanceof Error ? error.message : String(error)}`);
	}
	if (manifest.format?.name !== 'BOME2' || manifest.format?.version !== '2.0.0') throw new Error('BOME2 invalid: format version mismatch.');
	if (!Array.isArray(manifest.strings) || new Set(manifest.strings).size !== manifest.strings.length) {
		throw new Error('BOME2 invalid: string table is missing or duplicated.');
	}

	const sections: Bome2Section[] = [];
	for (let index = 0; index < sectionCount; index += 1) {
		const base = directoryOffset + index * DIRECTORY_ENTRY_BYTES;
		const section: Bome2Section = {
			index,
			kind: view.getUint32(base, true),
			meshIndex: view.getUint32(base + 4, true),
			offset: view.getUint32(base + 8, true),
			byteLength: view.getUint32(base + 12, true),
			count: view.getUint32(base + 16, true),
			componentType: view.getUint32(base + 20, true),
			crc32: view.getUint32(base + 24, true)
		};
		const componentBytes = COMPONENT_BYTES[section.componentType];
		if (!componentBytes) throw new Error(`BOME2 invalid: section ${index} component type.`);
		if (section.byteLength !== section.count * componentBytes) throw new Error(`BOME2 invalid: section ${index} byte count mismatch.`);
		if (section.offset < dataOffset || section.offset + section.byteLength > buffer.byteLength) {
			throw new Error(`BOME2 invalid: section ${index} bounds outside file.`);
		}
		sections.push(section);
	}
	const byOffset = sections.slice().sort((left, right) => left.offset - right.offset);
	for (let index = 1; index < byOffset.length; index += 1) {
		if (byOffset[index - 1].offset + byOffset[index - 1].byteLength > byOffset[index].offset) {
			throw new Error('BOME2 invalid: overlapping sections.');
		}
	}
	validateStringReferences(manifest);
	return { manifest, sections, headerBytes, dataOffset };
}

export function parseBome2Buffer(buffer: ArrayBuffer): Bome2RuntimeScene {
	const decoded = parseBome2Manifest(buffer);
	for (const section of decoded.sections) {
		const content = new Uint8Array(buffer, section.offset, section.byteLength);
		if (crc32(content) !== section.crc32) throw new Error(`BOME2 invalid: section ${section.index} checksum mismatch.`);
	}
	const transformSection = sectionAt(decoded.sections, decoded.manifest.transforms.section, SECTION.transforms, GLOBAL_SECTION);
	if (transformSection.componentType !== 3 || transformSection.count !== decoded.manifest.transforms.count * 16) {
		throw new Error('BOME2 invalid: transform section mismatch.');
	}
	const transforms = new Float32Array(buffer.slice(transformSection.offset, transformSection.offset + transformSection.byteLength));

	const meshes = decoded.manifest.meshes.map((mesh, meshIndex) => {
		const positionsSection = sectionAt(decoded.sections, mesh.positions_section, SECTION.positions, meshIndex);
		const loopsSection = sectionAt(decoded.sections, mesh.loops_section, SECTION.loops, meshIndex);
		const trianglesSection = sectionAt(decoded.sections, mesh.triangles_section, SECTION.triangles, meshIndex);
		if (positionsSection.count !== mesh.vertex_count * 3) throw new Error(`BOME2 invalid: mesh ${meshIndex} vertex count mismatch.`);
		if (mesh.quantization.measured_max_error_m > mesh.quantization.error_budget_m || mesh.quantization.error_budget_m > 0.001) {
			throw new Error(`BOME2 invalid: mesh ${meshIndex} quantization error budget.`);
		}
		const quantized = unsignedArray(buffer, positionsSection);
		const positions = new Float32Array(mesh.vertex_count * 3);
		for (let index = 0; index < quantized.length; index += 1) {
			const axis = index % 3;
			positions[index] = mesh.quantization.minimum_m[axis] + quantized[index] * mesh.quantization.scale_m[axis];
		}
		const loops = uint32Array(buffer, loopsSection);
		const triangles = uint32Array(buffer, trianglesSection);
		if (triangles.length % 3 !== 0 || triangles.length / 3 !== mesh.triangle_count) throw new Error(`BOME2 invalid: mesh ${meshIndex} triangle count.`);
		for (const index of loops) if (index >= mesh.vertex_count) throw new Error(`BOME2 invalid: mesh ${meshIndex} loop index outside vertex buffer.`);
		for (const index of triangles) if (index >= mesh.vertex_count) throw new Error(`BOME2 invalid: mesh ${meshIndex} triangle index outside vertex buffer.`);
		validateFaces(mesh, loops.length, triangles.length);
		return { manifest: mesh, positions, loops, triangles };
	});
	validateGraphReferences(decoded.manifest);
	return { format: 'bome2_runtime_v2', manifest: decoded.manifest, sections: decoded.sections, transforms, meshes };
}

export function bome2ToCanonical(scene: Bome2RuntimeScene): CanonicalV3 {
	const { manifest } = scene;
	const stringAt = (index: number) => (index >= 0 ? manifest.strings[index] : undefined);
	const materialId = (index: number) => (index >= 0 ? stringAt(manifest.materials[index].id) || null : null);
	const tagId = (index: number) => (index >= 0 ? stringAt(manifest.tags[index].id) || null : null);
	const definitions = manifest.definitions.map((definition) => ({
		id: stringAt(definition.id)!,
		kind: stringAt(definition.kind) || 'component_definition',
		name: stringAt(definition.name) || '',
		mesh_id: definition.mesh >= 0 ? stringAt(manifest.meshes[definition.mesh].id)! : null,
		node_ids: definition.nodes.map((nodeIndex) => stringAt(manifest.nodes[nodeIndex].id)!)
	}));
	const transforms = Array.from({ length: manifest.transforms.count }, (_, index) =>
		Array.from(scene.transforms.subarray(index * 16, index * 16 + 16))
	);
	const meshes = scene.meshes.map((runtime, meshIndex) => {
		const source = runtime.manifest;
		return {
			id: stringAt(source.id)!,
			definition_id: definitions[source.definition].id,
			positions_m: Array.from(runtime.positions),
			faces: source.faces.map((face) => ({
				id: stringAt(face.id)!,
				source_identity: { persistent_id: stringAt(face.source_persistent_id) },
				outer: Array.from(runtime.loops.subarray(face.outer_start, face.outer_start + face.outer_count)),
				holes: face.holes.map(([start, count]) => Array.from(runtime.loops.subarray(start, start + count))),
				triangles: Array.from(runtime.triangles.subarray(face.triangle_start, face.triangle_start + face.triangle_count)),
				front_material_id: materialId(face.material),
				back_material_id: materialId(face.back_material),
				tag_id: tagId(face.tag),
				normal: faceNormal(runtime.positions, runtime.loops, face.outer_start, face.outer_count),
				area_m2: face.area_m2,
				surface_hint: stringAt(face.surface_hint) || 'unknown'
			}))
		};
	});
	return {
		format: {
			name: 'BOM Engine Canonical',
			version: manifest.format.canonical_version || '3.0.0',
			schema: 'https://sibambo.dev/schemas/bom-engine/3.0.0/schema.json'
		},
		source: { exported_at: stringAt(manifest.source.exported_at) },
		metadata: { runtime_format: 'BOME2' },
		tags: manifest.tags.map((tag) => ({ id: stringAt(tag.id)!, name: stringAt(tag.name) || '', visible: tag.visible })),
		materials: manifest.materials.map((material) => ({
			id: stringAt(material.id)!,
			name: stringAt(material.name) || '',
			display_name: stringAt(material.display_name),
			color: { hex: stringAt(material.color_hex) || '#94a3b8' },
			opacity: material.opacity,
			texture: material.texture >= 0 ? { filename: stringAt(material.texture) || '' } : undefined
		})),
		transforms,
		meshes,
		definitions,
		nodes: manifest.nodes.map((node) => ({
			id: stringAt(node.id)!,
			kind: NODE_KIND[node.kind] || 'group_instance',
			name: stringAt(node.name) || '',
			owner_definition_id: node.owner_definition >= 0 ? definitions[node.owner_definition].id : null,
			definition_id: definitions[node.definition].id,
			transform_id: node.transform,
			material_override_id: materialId(node.material),
			tag_id: tagId(node.tag),
			visible: node.visible
		}))
	} as CanonicalV3;
}

function sectionAt(sections: Bome2Section[], index: number, kind: number, meshIndex: number) {
	const section = sections[index];
	if (!section || section.kind !== kind || section.meshIndex !== meshIndex) throw new Error(`BOME2 invalid: section reference ${index}.`);
	return section;
}

function unsignedArray(buffer: ArrayBuffer, section: Bome2Section): Uint16Array | Uint32Array {
	const bytes = buffer.slice(section.offset, section.offset + section.byteLength);
	if (section.componentType === 1) return new Uint16Array(bytes);
	if (section.componentType === 2) return new Uint32Array(bytes);
	throw new Error(`BOME2 invalid: section ${section.index} is not unsigned integer data.`);
}

function uint32Array(buffer: ArrayBuffer, section: Bome2Section) {
	if (section.componentType !== 2) throw new Error(`BOME2 invalid: section ${section.index} must use uint32.`);
	return new Uint32Array(buffer.slice(section.offset, section.offset + section.byteLength));
}

function validateFaces(mesh: Bome2MeshManifest, loopCount: number, triangleCount: number) {
	for (const face of mesh.faces) {
		const ranges = [[face.outer_start, face.outer_count], ...face.holes];
		for (const [start, count] of ranges) {
			if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 3 || start + count > loopCount) {
				throw new Error('BOME2 invalid: face loop range.');
			}
		}
		if (face.triangle_start < 0 || face.triangle_count < 0 || face.triangle_count % 3 !== 0 || face.triangle_start + face.triangle_count > triangleCount) {
			throw new Error('BOME2 invalid: face triangle range.');
		}
	}
}

function validateGraphReferences(manifest: Bome2Manifest) {
	if (manifest.nodes.filter((node) => node.kind === 1).length !== 1 || manifest.root_node < 0 || manifest.root_node >= manifest.nodes.length || manifest.nodes[manifest.root_node].kind !== 1) {
		throw new Error('BOME2 invalid: exactly one root node required.');
	}
	for (const [meshIndex, mesh] of manifest.meshes.entries()) {
		if (mesh.definition < 0 || mesh.definition >= manifest.definitions.length) throw new Error(`BOME2 invalid: mesh ${meshIndex} definition reference.`);
		for (const face of mesh.faces) {
			if (face.material < -1 || face.material >= manifest.materials.length || face.back_material < -1 || face.back_material >= manifest.materials.length) {
				throw new Error(`BOME2 invalid: mesh ${meshIndex} material reference.`);
			}
			if (face.tag < -1 || face.tag >= manifest.tags.length) throw new Error(`BOME2 invalid: mesh ${meshIndex} tag reference.`);
		}
	}
	for (const [definitionIndex, definition] of manifest.definitions.entries()) {
		if (definition.mesh < -1 || definition.mesh >= manifest.meshes.length) throw new Error(`BOME2 invalid: definition ${definitionIndex} mesh reference.`);
		for (const nodeIndex of definition.nodes) if (nodeIndex < 0 || nodeIndex >= manifest.nodes.length) throw new Error(`BOME2 invalid: definition ${definitionIndex} node reference.`);
	}
	for (const [nodeIndex, node] of manifest.nodes.entries()) {
		if (node.definition < 0 || node.definition >= manifest.definitions.length) throw new Error(`BOME2 invalid: node ${nodeIndex} definition reference.`);
		if (node.transform < 0 || node.transform >= manifest.transforms.count) throw new Error(`BOME2 invalid: node ${nodeIndex} transform reference.`);
		if (node.owner_definition < -1 || node.owner_definition >= manifest.definitions.length) throw new Error(`BOME2 invalid: node ${nodeIndex} owner definition reference.`);
		if (node.material < -1 || node.material >= manifest.materials.length) throw new Error(`BOME2 invalid: node ${nodeIndex} material reference.`);
		if (node.tag < -1 || node.tag >= manifest.tags.length) throw new Error(`BOME2 invalid: node ${nodeIndex} tag reference.`);
	}
	const state = new Map<number, 'visiting' | 'visited'>();
	const visit = (definitionIndex: number, ancestry: number[]) => {
		if (state.get(definitionIndex) === 'visited') return;
		if (state.get(definitionIndex) === 'visiting') throw new Error(`BOME2 invalid: recursive definition cycle ${ancestry.concat(definitionIndex).join(' -> ')}.`);
		state.set(definitionIndex, 'visiting');
		for (const nodeIndex of manifest.definitions[definitionIndex].nodes) visit(manifest.nodes[nodeIndex].definition, ancestry.concat(definitionIndex));
		state.set(definitionIndex, 'visited');
	};
	for (let definitionIndex = 0; definitionIndex < manifest.definitions.length; definitionIndex += 1) visit(definitionIndex, []);
}

function validateStringReferences(manifest: Bome2Manifest) {
	const references: number[] = [];
	const add = (...values: number[]) => references.push(...values.filter((value) => value >= 0));
	add(manifest.source.file_name, manifest.source.model_name, manifest.source.scope, manifest.source.exported_at);
	for (const material of manifest.materials || []) add(material.id, material.name, material.display_name, material.color_hex, material.texture);
	for (const tag of manifest.tags || []) add(tag.id, tag.name);
	for (const mesh of manifest.meshes || []) {
		add(mesh.id);
		for (const face of mesh.faces || []) add(face.id, face.source_persistent_id, face.surface_hint);
	}
	for (const definition of manifest.definitions || []) add(definition.id, definition.name, definition.kind);
	for (const node of manifest.nodes || []) add(node.id, node.name, node.source_persistent_id);
	if (references.some((index) => !Number.isInteger(index) || index >= manifest.strings.length)) throw new Error('BOME2 invalid: string table reference.');
}

function faceNormal(positions: Float32Array, loops: Uint32Array, start: number, count: number): number[] {
	let x = 0;
	let y = 0;
	let z = 0;
	for (let index = 0; index < count; index += 1) {
		const current = loops[start + index] * 3;
		const next = loops[start + ((index + 1) % count)] * 3;
		x += (positions[current + 1] - positions[next + 1]) * (positions[current + 2] + positions[next + 2]);
		y += (positions[current + 2] - positions[next + 2]) * (positions[current] + positions[next]);
		z += (positions[current] - positions[next]) * (positions[current + 1] + positions[next + 1]);
	}
	const length = Math.hypot(x, y, z) || 1;
	return [x / length, y / length, z / length];
}

export function crc32(bytes: Uint8Array) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
	return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
	CRC32_TABLE[index] = value >>> 0;
}
