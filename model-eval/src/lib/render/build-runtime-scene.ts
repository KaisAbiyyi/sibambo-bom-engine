import { Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import type { Bome2RuntimeScene } from '../formats/bome2';
import type { ModelEvalRuntimeScene } from '../formats/model-eval-json';
import type { PartKey } from '../model';

export type RuntimeGeometryGroup = {
	key: PartKey;
	componentId?: string;
	baseColor?: string;
	textureName?: string;
	geometry: BufferGeometry;
	matrices: Matrix4[];
	occurrencePaths: string[];
	sourceMeshIndex: number;
	definitionIndex: number;
	faceCount: number;
	baseY: number;
	topY: number;
};

type Occurrence = { matrix: Matrix4; materialOverride: number; instancePath: string };
export type RuntimeComponentOverride = { componentId: string; partKey: PartKey };

const AXIS_TO_THREE = new Matrix4().set(
	1, 0, 0, 0,
	0, 0, 1, 0,
	0, -1, 0, 0,
	0, 0, 0, 1
);
const AXIS_FROM_THREE = AXIS_TO_THREE.clone().invert();

export function buildRuntimeGeometryGroups(
	scene: Bome2RuntimeScene | ModelEvalRuntimeScene,
	partOverrides: ReadonlyMap<string, PartKey> = new Map(),
	componentOverrides: ReadonlyMap<string, RuntimeComponentOverride> = new Map()
): RuntimeGeometryGroup[] {
	const { manifest } = scene;
	const occurrences = new Map<number, Occurrence[]>();
	const rootNode = manifest.nodes[manifest.root_node];
	if (!rootNode) throw new Error('BOME2 runtime has no root node.');

	const transformAt = (index: number) => new Matrix4().fromArray(Array.from(scene.transforms.subarray(index * 16, index * 16 + 16)));
	const visitDefinition = (definitionIndex: number, worldSketchUp: Matrix4, inheritedMaterial: number, ancestry: number[], instancePath: string) => {
		if (ancestry.includes(definitionIndex)) throw new Error(`BOME2 runtime recursive definition cycle: ${ancestry.concat(definitionIndex).join(' -> ')}`);
		const definition = manifest.definitions[definitionIndex];
		if (!definition) throw new Error(`BOME2 runtime missing definition ${definitionIndex}.`);
		if (definition.mesh >= 0) {
			const worldThree = AXIS_TO_THREE.clone().multiply(worldSketchUp).multiply(AXIS_FROM_THREE);
			const list = occurrences.get(definition.mesh) || [];
			list.push({ matrix: worldThree, materialOverride: inheritedMaterial, instancePath });
			occurrences.set(definition.mesh, list);
		}
		for (const nodeIndex of definition.nodes) {
			const node = manifest.nodes[nodeIndex];
			if (!node || node.visible === false) continue;
			const local = transformAt(node.transform);
			const sourceId = stringAt(manifest.strings, node.id) || `node:${nodeIndex}`;
			visitDefinition(
				node.definition,
				worldSketchUp.clone().multiply(local),
				node.material >= 0 ? node.material : inheritedMaterial,
				ancestry.concat(definitionIndex),
				`${instancePath}/${sourceId}`
			);
		}
	};
	visitDefinition(rootNode.definition, transformAt(rootNode.transform), rootNode.material, [], stringAt(manifest.strings, rootNode.id) || `node:${manifest.root_node}`);

	const groups: RuntimeGeometryGroup[] = [];
	for (const [meshIndex, meshOccurrences] of occurrences) {
		const runtimeMesh = scene.meshes[meshIndex];
		const mesh = manifest.meshes[meshIndex];
		if (!runtimeMesh || !mesh || meshOccurrences.length === 0) continue;
		const mappedPositions = mapPositions(runtimeMesh.positions);
		const positionAttribute = new Float32BufferAttribute(mappedPositions, 3);
		const grouped = new Map<string, { key: PartKey; componentId?: string; material: number; indices: number[]; matrices: Matrix4[]; occurrencePaths: string[]; faceIndices: Set<number> }>();

		for (const occurrence of meshOccurrences) {
			for (const [faceIndex, face] of mesh.faces.entries()) {
				const faceId = stringAt(manifest.strings, face.id);
				const component = faceId ? componentOverrides.get(`${occurrence.instancePath}|${faceId}`) : undefined;
				const key = component?.partKey || (faceId && partOverrides.get(faceId)) || partFromSurface(stringAt(manifest.strings, face.surface_hint));
				const material = occurrence.materialOverride >= 0 ? occurrence.materialOverride : face.material;
				const groupId = `${key}:${material}:${component?.componentId || ''}`;
				let group = grouped.get(groupId);
				if (!group) {
					group = { key, componentId: component?.componentId, material, indices: [], matrices: [], occurrencePaths: [], faceIndices: new Set() };
					grouped.set(groupId, group);
				}
				if (group.matrices.length === 0 || group.matrices[group.matrices.length - 1] !== occurrence.matrix) {
					group.matrices.push(occurrence.matrix);
					group.occurrencePaths.push(occurrence.instancePath);
				}
				if (!group.faceIndices.has(faceIndex)) {
					group.indices.push(...runtimeMesh.triangles.subarray(face.triangle_start, face.triangle_start + face.triangle_count));
					group.faceIndices.add(faceIndex);
				}
			}
		}

		for (const group of grouped.values()) {
			const geometry = new BufferGeometry();
			geometry.setAttribute('position', positionAttribute);
			geometry.setIndex(group.indices);
			geometry.computeVertexNormals();
			geometry.computeBoundingBox();
			geometry.computeBoundingSphere();
			const bounds = instancedBounds(geometry.boundingBox, group.matrices);
			const material = group.material >= 0 ? manifest.materials[group.material] : undefined;
			groups.push({
				key: group.key,
				componentId: group.componentId,
				baseColor: material ? stringAt(manifest.strings, material.color_hex) : undefined,
				textureName: material && material.texture >= 0 ? stringAt(manifest.strings, material.texture) : undefined,
				geometry,
				matrices: group.matrices,
				occurrencePaths: group.occurrencePaths,
				sourceMeshIndex: meshIndex,
				definitionIndex: mesh.definition,
				faceCount: group.faceIndices.size,
				baseY: bounds.min.y,
				topY: bounds.max.y
			});
		}
	}
	return groups;
}

export function runtimeComponentOverrides(bindings: Array<{ componentId: string; partKey: PartKey; instancePath: string; sourceFaceIds: string[] }>) {
	const overrides = new Map<string, RuntimeComponentOverride>();
	for (const binding of bindings) for (const faceId of binding.sourceFaceIds) overrides.set(`${binding.instancePath}|${faceId}`, { componentId: binding.componentId, partKey: binding.partKey });
	return overrides;
}

export function runtimePartOverrides(faces: Array<{ id: string; partKey: PartKey; sourceFaceIds?: string[] }>) {
	const counts = new Map<string, Map<PartKey, number>>();
	for (const face of faces) {
		const marker = face.id.lastIndexOf(':face:');
		const sourceIds = face.sourceFaceIds?.length
			? face.sourceFaceIds
			: marker >= 0
				? [face.id.slice(marker + 1)]
				: [];
		for (const sourceFaceId of sourceIds) {
			const candidates = counts.get(sourceFaceId) || new Map<PartKey, number>();
			candidates.set(face.partKey, (candidates.get(face.partKey) || 0) + 1);
			counts.set(sourceFaceId, candidates);
		}
	}
	return new Map(
		[...counts].map(([faceId, candidates]) => [
			faceId,
			[...candidates].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0]
		])
	);
}

function mapPositions(source: Float32Array) {
	const mapped = new Float32Array(source.length);
	for (let index = 0; index < source.length; index += 3) {
		mapped[index] = source[index];
		mapped[index + 1] = source[index + 2];
		mapped[index + 2] = source[index + 1] === 0 ? 0 : -source[index + 1];
	}
	return mapped;
}

function instancedBounds(local: Box3 | null, matrices: Matrix4[]) {
	if (!local || local.isEmpty()) return new Box3(new Vector3(), new Vector3());
	const result = new Box3();
	for (const matrix of matrices) result.union(local.clone().applyMatrix4(matrix));
	return result;
}

function stringAt(strings: string[], index: number) {
	return index >= 0 && index < strings.length ? strings[index] : undefined;
}

function partFromSurface(surface?: string): PartKey {
	const value = (surface || '').toLowerCase();
	if (value === 'floor') return 'floor';
	if (value === 'ceiling') return 'ceiling';
	if (value.includes('roof')) return 'roof';
	if (value.startsWith('wall')) return 'walls';
	if (value === 'door') return 'doors';
	if (value === 'window') return 'windows';
	if (value === 'opening') return 'openings';
	if (value === 'structure') return 'structure';
	if (value === 'furniture') return 'furniture';
	return 'other';
}
