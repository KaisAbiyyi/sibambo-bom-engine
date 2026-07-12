import { validateCanonicalV3, type CanonicalV3 } from '../../model-eval/src/lib/formats/canonical-v3';

type CanonicalFaceWithTriangles = CanonicalV3['meshes'][number]['faces'][number] & { triangles: number[] };

const AXIS_TO_THREE = [
	1, 0, 0, 0,
	0, 0, -1, 0,
	0, 1, 0, 0,
	0, 0, 0, 1
];
const AXIS_FROM_THREE = [
	1, 0, 0, 0,
	0, 0, 1, 0,
	0, -1, 0, 0,
	0, 0, 0, 1
];

export function convertCanonicalToGlb(data: CanonicalV3) {
	const errors = validateCanonicalV3(data);
	if (errors.length) throw new Error(`Canonical JSON v3 invalid: ${errors.join('; ')}`);
	const binary = new BinaryBuilder();
	const materials = data.materials.map((material) => gltfMaterial(material));
	const materialIndex = new Map(data.materials.map((material, index) => [material.id, index]));
	const meshIndex = new Map<string, number>();
	const gltfMeshes = data.meshes.map((mesh, index) => {
		meshIndex.set(mesh.id, index);
		const mapped = new Float32Array(mesh.positions_m.length);
		for (let offset = 0; offset < mesh.positions_m.length; offset += 3) {
			mapped[offset] = mesh.positions_m[offset];
			mapped[offset + 1] = mesh.positions_m[offset + 2];
			mapped[offset + 2] = mesh.positions_m[offset + 1] === 0 ? 0 : -mesh.positions_m[offset + 1];
		}
		const positionView = binary.add(new Uint8Array(mapped.buffer), 34962);
		const bounds = positionBounds(mapped);
		const positionAccessor = binary.addAccessor({
			bufferView: positionView,
			componentType: 5126,
			count: mapped.length / 3,
			type: 'VEC3',
			min: bounds.min,
			max: bounds.max
		});
		const groups = new Map<number, number[]>();
		for (const face of mesh.faces as CanonicalFaceWithTriangles[]) {
			const material = face.front_material_id ? (materialIndex.get(face.front_material_id) ?? -1) : -1;
			const indices = groups.get(material) || [];
			indices.push(...face.triangles);
			groups.set(material, indices);
		}
		const primitives = [...groups.entries()].map(([material, indices]) => {
			const typed = new Uint32Array(indices);
			const indexView = binary.add(new Uint8Array(typed.buffer), 34963);
			const accessor = binary.addAccessor({ bufferView: indexView, componentType: 5125, count: typed.length, type: 'SCALAR' });
			return {
				attributes: { POSITION: positionAccessor },
				indices: accessor,
				...(material >= 0 ? { material } : {}),
				mode: 4
			};
		});
		return { name: mesh.id, primitives, extras: { canonical_mesh_id: mesh.id, definition_id: mesh.definition_id } };
	});

	const definitions = new Map(data.definitions.map((definition) => [definition.id, definition]));
	const nodes = new Map(data.nodes.map((node) => [node.id, node]));
	const meshes = new Map(data.meshes.map((mesh) => [mesh.id, mesh]));
	const gltfNodes: Array<Record<string, unknown>> = [];
	const instantiateDefinition = (definitionId: string, name: string, matrix: number[], ancestry: string[]): number => {
		if (ancestry.includes(definitionId)) throw new Error(`Recursive definition cycle: ${ancestry.concat(definitionId).join(' -> ')}`);
		const definition = definitions.get(definitionId)!;
		const childIndices = definition.node_ids.map((nodeId) => {
			const node = nodes.get(nodeId)!;
			const local = convertMatrix(data.transforms[node.transform_id]);
			return instantiateDefinition(node.definition_id!, node.name, local, ancestry.concat(definitionId));
		});
		const mesh = definition.mesh_id ? meshes.get(definition.mesh_id) : undefined;
		const gltfNode: Record<string, unknown> = {
			name,
			matrix,
			...(mesh ? { mesh: meshIndex.get(mesh.id) } : {}),
			...(childIndices.length ? { children: childIndices } : {}),
			extras: { canonical_definition_id: definitionId }
		};
		const index = gltfNodes.length;
		gltfNodes.push(gltfNode);
		return index;
	};
	const root = data.nodes.find((node) => node.kind === 'root')!;
	const rootIndex = instantiateDefinition(root.definition_id!, root.name, convertMatrix(data.transforms[root.transform_id]), []);
	const json = {
		asset: { version: '2.0', generator: 'BOM Engine canonical-to-GLB converter' },
		scene: 0,
		scenes: [{ name: 'BOM Engine', nodes: [rootIndex] }],
		nodes: gltfNodes,
		meshes: gltfMeshes,
		materials,
		buffers: [{ byteLength: binary.byteLength }],
		bufferViews: binary.bufferViews,
		accessors: binary.accessors,
		extras: {
			canonical_format_version: data.format.version,
			retained_semantics: ['mesh_definition_reuse', 'node_hierarchy', 'materials', 'source_definition_ids'],
			omitted_semantics: ['polygon_loops', 'room_analysis', 'full_source_identity', 'attribute_dictionaries']
		}
	};
	return packGlb(json, binary.finish());
}

class BinaryBuilder {
	private chunks: Uint8Array[] = [];
	private offset = 0;
	bufferViews: Array<Record<string, number>> = [];
	accessors: Array<Record<string, unknown>> = [];

	get byteLength() {
		return this.offset;
	}

	add(bytes: Uint8Array, target: number) {
		const padding = (4 - (this.offset % 4)) % 4;
		if (padding) {
			this.chunks.push(new Uint8Array(padding));
			this.offset += padding;
		}
		const index = this.bufferViews.length;
		this.bufferViews.push({ buffer: 0, byteOffset: this.offset, byteLength: bytes.byteLength, target });
		this.chunks.push(bytes.slice());
		this.offset += bytes.byteLength;
		return index;
	}

	addAccessor(accessor: Record<string, unknown>) {
		const index = this.accessors.length;
		this.accessors.push(accessor);
		return index;
	}

	finish() {
		const padding = (4 - (this.offset % 4)) % 4;
		if (padding) {
			this.chunks.push(new Uint8Array(padding));
			this.offset += padding;
		}
		const result = new Uint8Array(this.offset);
		let cursor = 0;
		for (const chunk of this.chunks) {
			result.set(chunk, cursor);
			cursor += chunk.byteLength;
		}
		return result;
	}
}

function gltfMaterial(material: CanonicalV3['materials'][number]) {
	const hex = material.color?.hex || '#94a3b8';
	const rgb = hexToRgb(hex);
	const opacity = material.opacity ?? 1;
	return {
		name: material.name,
		pbrMetallicRoughness: { baseColorFactor: [...rgb, opacity], metallicFactor: 0, roughnessFactor: 0.85 },
		doubleSided: true,
		...(opacity < 1 ? { alphaMode: 'BLEND' } : {}),
		extras: { canonical_material_id: material.id }
	};
}

function hexToRgb(hex: string) {
	const value = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
	return [Number.parseInt(value.slice(0, 2), 16) / 255, Number.parseInt(value.slice(2, 4), 16) / 255, Number.parseInt(value.slice(4, 6), 16) / 255];
}

function positionBounds(positions: Float32Array) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let index = 0; index < positions.length; index += 3) {
		for (let axis = 0; axis < 3; axis += 1) {
			min[axis] = Math.min(min[axis], positions[index + axis]);
			max[axis] = Math.max(max[axis], positions[index + axis]);
		}
	}
	return { min, max };
}

function convertMatrix(source: number[]) {
	return multiplyMatrices(multiplyMatrices(AXIS_TO_THREE, source), AXIS_FROM_THREE);
}

function multiplyMatrices(left: number[], right: number[]) {
	const output = new Array<number>(16).fill(0);
	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			for (let index = 0; index < 4; index += 1) output[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
		}
	}
	return output;
}

function packGlb(json: Record<string, unknown>, binary: Uint8Array) {
	const encodedJson = new TextEncoder().encode(JSON.stringify(json));
	const jsonPadding = (4 - (encodedJson.byteLength % 4)) % 4;
	const jsonChunk = new Uint8Array(encodedJson.byteLength + jsonPadding);
	jsonChunk.set(encodedJson);
	jsonChunk.fill(0x20, encodedJson.byteLength);
	const totalLength = 12 + 8 + jsonChunk.byteLength + 8 + binary.byteLength;
	const result = new Uint8Array(totalLength);
	const view = new DataView(result.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, totalLength, true);
	view.setUint32(12, jsonChunk.byteLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	result.set(jsonChunk, 20);
	const binaryHeader = 20 + jsonChunk.byteLength;
	view.setUint32(binaryHeader, binary.byteLength, true);
	view.setUint32(binaryHeader + 4, 0x004e4942, true);
	result.set(binary, binaryHeader + 8);
	return result;
}

async function readCanonical(path: string) {
	const file = Bun.file(path);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const content = path.toLowerCase().endsWith('.gz') ? Bun.gunzipSync(bytes) : bytes;
	return JSON.parse(new TextDecoder().decode(content)) as CanonicalV3;
}

if (import.meta.main) {
	const input = Bun.argv.find((argument) => argument.startsWith('--input='))?.slice(8);
	if (!input) throw new Error('Usage: bun scripts/converters/bom-v3-to-glb.ts --input=<canonical.json.gz> [--output=<model.glb>]');
	const requestedOutput = Bun.argv.find((argument) => argument.startsWith('--output='))?.slice(9);
	const baseName = input.replace(/\.json(?:\.gz)?$/i, '');
	const output = requestedOutput || `${baseName}.glb`;
	const started = performance.now();
	const data = await readCanonical(input);
	const glb = convertCanonicalToGlb(data);
	await Bun.write(output, glb);
	console.log(JSON.stringify({ input, output, bytes: glb.byteLength, elapsed_ms: Math.round((performance.now() - started) * 100) / 100 }, null, 2));
}
