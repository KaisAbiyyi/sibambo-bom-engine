import type { Bome2Face, Bome2Manifest, Bome2MeshManifest, Bome2RuntimeScene } from './bome2';

export const MODEL_EVAL_JSON_IDENTIFIER = 'model_eval_json_v1';

export type ModelEvalRuntimeScene = Omit<Bome2RuntimeScene, 'format'> & {
	format: 'model_eval_json_v1';
};

type CompactMesh = {
	id: number;
	definition: number;
	vertex_count: number;
	triangle_count: number;
	quantization: Bome2MeshManifest['quantization'];
	positions: number[];
	loops: number[];
	triangles: number[];
	faces: unknown[];
};

type CompactDocument = {
	format: { name: string; version: string; identifier: string; schema?: string };
	units: string;
	coordinate_system: Record<string, unknown>;
	source: number[];
	strings: string[];
	materials: Array<[number, number, number, number]>;
	tags: Array<[number, number, boolean]>;
	transforms: number[];
	meshes: CompactMesh[];
	definitions: Array<[number, number, number, number, number[]]>;
	nodes: Array<[number, number, number, number, number, number, number, boolean, number]>;
	root_node: number;
	statistics: Record<string, number>;
};

export function isModelEvalJsonV1(value: unknown): value is CompactDocument {
	return isRecord(value) && isRecord(value.format) && value.format.identifier === MODEL_EVAL_JSON_IDENTIFIER;
}

// This parser builds typed render buffers directly. It never invokes a
// Canonical-v3 adapter or materializes legacy BomEntity / FaceRecord objects.
export function parseModelEvalJsonV1(value: unknown): ModelEvalRuntimeScene {
	if (!isModelEvalJsonV1(value) || value.format.name !== 'BOM Engine Model-Eval JSON' || value.format.version !== '1.0.0') {
		throw new Error('Model-Eval JSON invalid: format identifier or version.');
	}
	const document = value as CompactDocument;
	if (document.units !== 'm') throw new Error('Model-Eval JSON invalid: units must be meters.');
	if (!Array.isArray(document.strings) || document.strings.some((item) => typeof item !== 'string') || new Set(document.strings).size !== document.strings.length) {
		throw new Error('Model-Eval JSON invalid: string table.');
	}
	if (!Array.isArray(document.transforms) || document.transforms.length % 16 !== 0 || document.transforms.some((item) => !Number.isFinite(item))) {
		throw new Error('Model-Eval JSON invalid: transform table.');
	}
	const strings = document.strings;
	const stringAt = (index: number) => {
		if (!Number.isInteger(index) || index < -1 || index >= strings.length) throw new Error('Model-Eval JSON invalid: string reference.');
		return index;
	};
	const source = tuple(document.source, 4, 'source');
	source.forEach((index) => stringAt(number(index, 'source string reference')));
	const materials = (document.materials || []).map((row, index) => {
		const [id, name, colorHex, opacity] = tuple(row, 4, `material ${index}`) as [number, number, number, number];
		[id, name, colorHex].forEach(stringAt);
		if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error(`Model-Eval JSON invalid: material ${index} opacity.`);
		return { id, name, display_name: name, color_rgba: hexToRgba(strings[colorHex]), color_hex: colorHex, opacity, texture: -1 };
	});
	const tags = (document.tags || []).map((row, index) => {
		const [id, name, visible] = tuple(row, 3, `tag ${index}`) as [number, number, boolean];
		[id, name].forEach(stringAt);
		if (typeof visible !== 'boolean') throw new Error(`Model-Eval JSON invalid: tag ${index} visibility.`);
		return { id, name, visible };
	});
	const definitions = (document.definitions || []).map((row, index) => {
		const [id, name, kind, mesh, nodes] = tuple(row, 5, `definition ${index}`) as [number, number, number, number, number[]];
		[id, name, kind].forEach(stringAt);
		if (!Number.isInteger(mesh) || mesh < -1 || mesh >= document.meshes.length || !Array.isArray(nodes)) throw new Error(`Model-Eval JSON invalid: definition ${index} reference.`);
		return { id, name, kind, mesh, nodes };
	});
	const nodes = (document.nodes || []).map((row, index) => {
		const [id, name, kind, definition, transform, material, tag, visible, sourcePersistentId] = tuple(row, 9, `node ${index}`) as [number, number, number, number, number, number, number, boolean, number];
		[id, name, sourcePersistentId].forEach(stringAt);
		if (!Number.isInteger(kind) || !Number.isInteger(definition) || definition < 0 || definition >= definitions.length || !Number.isInteger(transform) || transform < 0 || transform >= document.transforms.length / 16 || !Number.isInteger(material) || material < -1 || material >= materials.length || !Number.isInteger(tag) || tag < -1 || tag >= tags.length || typeof visible !== 'boolean') {
			throw new Error(`Model-Eval JSON invalid: node ${index} reference.`);
		}
		return { id, name, kind, owner_definition: -1, definition, transform, material, tag, visible, source_persistent_id: sourcePersistentId };
	});
	definitions.forEach((definition, index) => definition.nodes.forEach((node) => {
		if (!Number.isInteger(node) || node < 0 || node >= nodes.length) throw new Error(`Model-Eval JSON invalid: definition ${index} node reference.`);
	}));
	if (!Number.isInteger(document.root_node) || document.root_node < 0 || document.root_node >= nodes.length || nodes[document.root_node].kind !== 1) {
		throw new Error('Model-Eval JSON invalid: root node.');
	}

	const meshes = (document.meshes || []).map((mesh, meshIndex) => decodeMesh(mesh, meshIndex, definitions.length, materials.length, tags.length, stringAt));
	definitions.forEach((definition, index) => {
		if (definition.mesh >= meshes.length) throw new Error(`Model-Eval JSON invalid: definition ${index} mesh reference.`);
	});
	const manifest = {
		format: { name: 'BOME2', version: '2.0.0', canonical_version: '3.0.0', layout: 'model_eval_json_v1' },
		source: { file_name: source[0], model_name: source[1], scope: source[2], exported_at: source[3] },
		coordinate_system: document.coordinate_system,
		strings,
		materials,
		tags,
		transforms: { section: -1, count: document.transforms.length / 16, component_type: 'float32' as const },
		meshes: meshes.map((mesh) => mesh.manifest),
		definitions,
		nodes,
		root_node: document.root_node,
		statistics: document.statistics || {}
	} as Bome2Manifest;
	return { format: 'model_eval_json_v1', manifest, sections: [], transforms: new Float32Array(document.transforms), meshes };
}

function decodeMesh(mesh: CompactMesh, meshIndex: number, definitionCount: number, materialCount: number, tagCount: number, stringAt: (index: number) => number) {
	if (!isRecord(mesh) || !Number.isInteger(mesh.id) || !Number.isInteger(mesh.definition) || mesh.definition < 0 || mesh.definition >= definitionCount || !Number.isInteger(mesh.vertex_count) || mesh.vertex_count < 0 || !Number.isInteger(mesh.triangle_count) || mesh.triangle_count < 0) {
		throw new Error(`Model-Eval JSON invalid: mesh ${meshIndex} header.`);
	}
	stringAt(mesh.id);
	const quantization = mesh.quantization;
	if (!isRecord(quantization) || (quantization.component_type !== 'uint16' && quantization.component_type !== 'uint32') || !triple(quantization.minimum_m) || !triple(quantization.maximum_m) || !triple(quantization.scale_m) || !Number.isFinite(quantization.measured_max_error_m) || !Number.isFinite(quantization.error_budget_m) || quantization.measured_max_error_m > 0.001 || quantization.error_budget_m > 0.001) {
		throw new Error(`Model-Eval JSON invalid: mesh ${meshIndex} quantization.`);
	}
	if (!Array.isArray(mesh.positions) || mesh.positions.length !== mesh.vertex_count * 3 || !Array.isArray(mesh.loops) || !Array.isArray(mesh.triangles) || mesh.triangles.length !== mesh.triangle_count * 3) {
		throw new Error(`Model-Eval JSON invalid: mesh ${meshIndex} array length.`);
	}
	const positions = new Float32Array(mesh.positions.length);
	mesh.positions.forEach((value, index) => {
		if (!Number.isInteger(value) || value < 0) throw new Error(`Model-Eval JSON invalid: mesh ${meshIndex} position.`);
		positions[index] = quantization.minimum_m[index % 3] + value * quantization.scale_m[index % 3];
	});
	const loops = uint32(mesh.loops, mesh.vertex_count, `mesh ${meshIndex} loop`);
	const triangles = uint32(mesh.triangles, mesh.vertex_count, `mesh ${meshIndex} triangle`);
	const faces = (mesh.faces || []).map((row, faceIndex) => {
		const [id, sourcePersistentId, outerStart, outerCount, holes, triangleStart, triangleCount, material, backMaterial, tag, surfaceHint, area] = tuple(row, 12, `mesh ${meshIndex} face ${faceIndex}`) as [number, number, number, number, Array<[number, number]>, number, number, number, number, number, number, number];
		[id, sourcePersistentId, surfaceHint].forEach(stringAt);
		if (!Number.isInteger(outerStart) || !Number.isInteger(outerCount) || outerStart < 0 || outerCount < 3 || outerStart + outerCount > loops.length || !Array.isArray(holes) || !Number.isInteger(triangleStart) || !Number.isInteger(triangleCount) || triangleStart < 0 || triangleCount < 0 || triangleCount % 3 !== 0 || triangleStart + triangleCount > triangles.length || !Number.isInteger(material) || material < -1 || material >= materialCount || !Number.isInteger(backMaterial) || backMaterial < -1 || backMaterial >= materialCount || !Number.isInteger(tag) || tag < -1 || tag >= tagCount || !Number.isFinite(area)) {
			throw new Error(`Model-Eval JSON invalid: mesh ${meshIndex} face ${faceIndex} reference.`);
		}
		const normalizedHoles = holes.map((range) => {
			const [start, count] = tuple(range, 2, `mesh ${meshIndex} face ${faceIndex} hole`) as [number, number];
			if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 3 || start + count > loops.length) throw new Error(`Model-Eval JSON invalid: mesh ${meshIndex} face ${faceIndex} hole range.`);
			return [start, count] as [number, number];
		});
		return { id, source_persistent_id: sourcePersistentId, outer_start: outerStart, outer_count: outerCount, holes: normalizedHoles, triangle_start: triangleStart, triangle_count: triangleCount, material, back_material: backMaterial, tag, surface_hint: surfaceHint, area_m2: area } satisfies Bome2Face;
	});
	return { manifest: { id: mesh.id, definition: mesh.definition, positions_section: -1, loops_section: -1, triangles_section: -1, vertex_count: mesh.vertex_count, triangle_count: mesh.triangle_count, quantization: quantization as Bome2MeshManifest['quantization'], faces }, positions, loops, triangles };
}

function tuple(value: unknown, length: number, label: string): unknown[] {
	if (!Array.isArray(value) || value.length !== length) throw new Error(`Model-Eval JSON invalid: ${label} row.`);
	return value;
}

function number(value: unknown, label: string) {
	if (!Number.isInteger(value)) throw new Error(`Model-Eval JSON invalid: ${label}.`);
	return value as number;
}

function uint32(values: number[], vertexCount: number, label: string) {
	const result = new Uint32Array(values.length);
	values.forEach((value, index) => {
		if (!Number.isInteger(value) || value < 0 || value >= vertexCount) throw new Error(`Model-Eval JSON invalid: ${label} index.`);
		result[index] = value;
	});
	return result;
}

function triple(value: unknown): value is [number, number, number] {
	return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function hexToRgba(value: string | undefined): [number, number, number, number] {
	const hex = /^#?([0-9a-f]{6})$/i.exec(value || '')?.[1] || '94a3b8';
	return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16), 255];
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
