import type { BomEntity, BomMaterial, BomModelJson, BomVector } from '../model';

type CanonicalMaterial = BomMaterial & {
	id: string;
	opacity?: number;
};

type CanonicalFace = {
	id: string;
	source_identity?: { persistent_id?: string };
	outer: number[];
	holes: number[][];
	front_material_id?: string | null;
	back_material_id?: string | null;
	tag_id?: string | null;
	normal?: number[];
	area_m2?: number;
	surface_hint?: string;
};

type CanonicalMesh = {
	id: string;
	definition_id: string;
	positions_m: number[];
	faces: CanonicalFace[];
};

type CanonicalDefinition = {
	id: string;
	kind: string;
	name: string;
	mesh_id?: string | null;
	node_ids: string[];
};

type CanonicalNode = {
	id: string;
	kind: string;
	name: string;
	owner_definition_id?: string | null;
	definition_id?: string | null;
	transform_id: number;
	material_override_id?: string | null;
	tag_id?: string | null;
	visible?: boolean;
};

export type CanonicalV3 = {
	format: {
		name: string;
		version: string;
		schema: string;
	};
	source?: {
		exported_at?: string;
	};
	metadata?: Record<string, unknown>;
	tags: Array<{ id: string; name: string; visible?: boolean }>;
	materials: CanonicalMaterial[];
	transforms: number[][];
	meshes: CanonicalMesh[];
	definitions: CanonicalDefinition[];
	nodes: CanonicalNode[];
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function isCanonicalV3(value: unknown): value is CanonicalV3 {
	if (!isRecord(value) || !isRecord(value.format)) return false;
	return value.format.name === 'BOM Engine Canonical' && typeof value.format.version === 'string' && value.format.version.startsWith('3.');
}

export function validateCanonicalV3(value: unknown): string[] {
	const errors: string[] = [];
	if (!isCanonicalV3(value)) return ['format must identify BOM Engine Canonical version 3.x'];
	for (const field of ['tags', 'materials', 'transforms', 'meshes', 'definitions', 'nodes'] as const) {
		if (!Array.isArray(value[field])) errors.push(`${field} must be an array`);
	}
	if (errors.length) return errors;

	const definitions = new Map<string, CanonicalDefinition>();
	const meshes = new Map<string, CanonicalMesh>();
	const nodes = new Map<string, CanonicalNode>();
	const materials = new Set(value.materials.map((material) => material.id));
	const tags = new Set(value.tags.map((tag) => tag.id));

	indexUnique(value.definitions, definitions, 'definition', errors);
	indexUnique(value.meshes, meshes, 'mesh', errors);
	indexUnique(value.nodes, nodes, 'node', errors);

	value.transforms.forEach((matrix, index) => {
		if (!Array.isArray(matrix) || matrix.length !== 16 || matrix.some((entry) => !Number.isFinite(entry))) {
			errors.push(`transform ${index} must contain 16 finite numbers`);
		}
	});

	value.meshes.forEach((mesh) => {
		if (!definitions.has(mesh.definition_id)) errors.push(`mesh ${mesh.id} references missing definition ${mesh.definition_id}`);
		if (!Array.isArray(mesh.positions_m) || mesh.positions_m.length % 3 !== 0 || mesh.positions_m.some((entry) => !Number.isFinite(entry))) {
			errors.push(`mesh ${mesh.id} positions_m must be finite XYZ triples`);
			return;
		}
		const vertexCount = mesh.positions_m.length / 3;
		mesh.faces?.forEach((face) => {
			if (!validLoop(face.outer, vertexCount)) errors.push(`face ${face.id} has invalid outer indices`);
			for (const hole of face.holes || []) {
				if (!validLoop(hole, vertexCount)) errors.push(`face ${face.id} has invalid hole indices`);
			}
			if (face.front_material_id && !materials.has(face.front_material_id)) {
				errors.push(`face ${face.id} references missing material ${face.front_material_id}`);
			}
			if (face.back_material_id && !materials.has(face.back_material_id)) {
				errors.push(`face ${face.id} references missing material ${face.back_material_id}`);
			}
			if (face.tag_id && !tags.has(face.tag_id)) errors.push(`face ${face.id} references missing tag ${face.tag_id}`);
		});
	});

	value.definitions.forEach((definition) => {
		if (definition.mesh_id && !meshes.has(definition.mesh_id)) {
			errors.push(`definition ${definition.id} references missing mesh ${definition.mesh_id}`);
		}
		for (const nodeId of definition.node_ids || []) {
			if (!nodes.has(nodeId)) errors.push(`definition ${definition.id} references missing node ${nodeId}`);
		}
	});

	value.nodes.forEach((node) => {
		if (!Number.isInteger(node.transform_id) || node.transform_id < 0 || node.transform_id >= value.transforms.length) {
			errors.push(`node ${node.id} references missing transform ${node.transform_id}`);
		}
		if (node.definition_id && !definitions.has(node.definition_id)) {
			errors.push(`node ${node.id} references missing definition ${node.definition_id}`);
		}
		if (node.owner_definition_id && !definitions.has(node.owner_definition_id)) {
			errors.push(`node ${node.id} references missing owner definition ${node.owner_definition_id}`);
		}
		if (node.material_override_id && !materials.has(node.material_override_id)) {
			errors.push(`node ${node.id} references missing material ${node.material_override_id}`);
		}
		if (node.tag_id && !tags.has(node.tag_id)) errors.push(`node ${node.id} references missing tag ${node.tag_id}`);
	});

	validateDefinitionCycles(definitions, nodes, errors);

	const rootNodes = value.nodes.filter((node) => node.kind === 'root');
	if (rootNodes.length !== 1) errors.push(`nodes must contain exactly one root; found ${rootNodes.length}`);
	return errors;
}

function validateDefinitionCycles(
	definitions: Map<string, CanonicalDefinition>,
	nodes: Map<string, CanonicalNode>,
	errors: string[]
) {
	const state = new Map<string, 'visiting' | 'visited'>();
	const visit = (definitionId: string, path: string[]) => {
		if (state.get(definitionId) === 'visited') return;
		if (state.get(definitionId) === 'visiting') {
			const cycleStart = path.indexOf(definitionId);
			const cycle = path.slice(cycleStart).concat(definitionId);
			errors.push(`recursive definition cycle: ${cycle.join(' -> ')}`);
			return;
		}
		const definition = definitions.get(definitionId);
		if (!definition) return;
		state.set(definitionId, 'visiting');
		for (const nodeId of definition.node_ids || []) {
			const childId = nodes.get(nodeId)?.definition_id;
			if (childId && definitions.has(childId)) visit(childId, path.concat(definitionId));
		}
		state.set(definitionId, 'visited');
	};
	for (const definitionId of definitions.keys()) visit(definitionId, []);
}

export function canonicalV3ToLegacyBom(value: unknown): BomModelJson {
	const errors = validateCanonicalV3(value);
	if (errors.length) throw new Error(`Canonical JSON v3 tidak valid: ${errors.join('; ')}`);
	const data = value as CanonicalV3;
	const definitions = new Map(data.definitions.map((definition) => [definition.id, definition]));
	const meshes = new Map(data.meshes.map((mesh) => [mesh.id, mesh]));
	const nodes = new Map(data.nodes.map((node) => [node.id, node]));
	const materials = new Map(data.materials.map((material) => [material.id, material]));
	const tags = new Map(data.tags.map((tag) => [tag.id, tag]));
	const rootNode = data.nodes.find((node) => node.kind === 'root')!;

	const instantiateDefinition = (
		definitionId: string,
		worldMatrix: number[],
		path: string,
		inheritedMaterialId: string | null,
		ancestry: string[]
	): BomEntity[] => {
		if (ancestry.includes(definitionId)) throw new Error(`Canonical JSON v3 has recursive definition cycle: ${ancestry.concat(definitionId).join(' -> ')}`);
		if (ancestry.length > 80) throw new Error('Canonical JSON v3 hierarchy exceeds 80 levels');
		const definition = definitions.get(definitionId)!;
		const children: BomEntity[] = [];
		if (definition.mesh_id) {
			const mesh = meshes.get(definition.mesh_id)!;
			for (const face of mesh.faces) {
				const outer = face.outer.map((index) => transformPosition(positionAt(mesh.positions_m, index), worldMatrix));
				const holes = (face.holes || []).map((loop) => loop.map((index) => transformPosition(positionAt(mesh.positions_m, index), worldMatrix)));
				const materialId = face.front_material_id || inheritedMaterialId;
				const material = materialId ? materials.get(materialId) : undefined;
				children.push({
					id: `${path}:${face.id}`,
					name: face.id,
					type: 'Face',
					vertices: outer.map((position) => ({ position })),
					holes,
					material_front: material,
					mat_color: material?.color?.hex,
					surface_type: classifyWorldSurface(outer),
					area_m2: polygonArea(outer) - holes.reduce((sum, loop) => sum + polygonArea(loop), 0),
					layer: face.tag_id ? tags.get(face.tag_id)?.name : undefined
				});
			}
		}

		for (const nodeId of definition.node_ids || []) {
			const node = nodes.get(nodeId)!;
			if (node.visible === false || !node.definition_id) continue;
			const localMatrix = data.transforms[node.transform_id] || IDENTITY;
			const childMatrix = multiplyMatrices(worldMatrix, localMatrix);
			const childPath = `${path}/${node.id}`;
			const materialOverride = node.material_override_id || inheritedMaterialId;
			children.push({
				id: childPath,
				name: node.name,
				definition_name: definitions.get(node.definition_id)?.name,
				type: node.kind === 'component_instance' ? 'ComponentInstance' : 'Group',
				layer: node.tag_id ? tags.get(node.tag_id)?.name : undefined,
				children: instantiateDefinition(node.definition_id, childMatrix, childPath, materialOverride, ancestry.concat(definitionId))
			});
		}
		return children;
	};

	const rootMatrix = data.transforms[rootNode.transform_id] || IDENTITY;
	const rootDefinition = definitions.get(rootNode.definition_id!)!;
	return {
		schema_version: data.format.version,
		export_level: 'full',
		exported_at: data.source?.exported_at,
		geometry_format: 'canonical_v3_compatibility_graph',
		metadata: data.metadata,
		materials: data.materials,
		entities: [
			{
				id: rootNode.id,
				name: rootNode.name || rootDefinition.name,
				type: 'Group',
				children: instantiateDefinition(rootDefinition.id, rootMatrix, rootNode.id, rootNode.material_override_id || null, [])
			}
		]
	};
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function indexUnique<T extends { id: string }>(items: T[], target: Map<string, T>, label: string, errors: string[]) {
	for (const item of items) {
		if (!isRecord(item) || typeof item.id !== 'string' || !item.id) {
			errors.push(`${label} must have a non-empty string id`);
			continue;
		}
		if (target.has(item.id)) errors.push(`duplicate ${label} id ${item.id}`);
		else target.set(item.id, item);
	}
}

function validLoop(loop: unknown, vertexCount: number) {
	return Array.isArray(loop) && loop.length >= 3 && loop.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount);
}

function positionAt(positions: number[], index: number): BomVector {
	return { x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] };
}

function transformPosition(point: BomVector, matrix: number[]): BomVector {
	return {
		x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12],
		y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13],
		z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14]
	};
}

function multiplyMatrices(left: number[], right: number[]) {
	const result = new Array<number>(16).fill(0);
	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			for (let index = 0; index < 4; index += 1) {
				result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
			}
		}
	}
	return result;
}

function newellNormal(points: BomVector[]) {
	const normal = { x: 0, y: 0, z: 0 };
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		normal.x += (current.y - next.y) * (current.z + next.z);
		normal.y += (current.z - next.z) * (current.x + next.x);
		normal.z += (current.x - next.x) * (current.y + next.y);
	}
	const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
	return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
}

function classifyWorldSurface(points: BomVector[]) {
	const normal = newellNormal(points);
	if (Math.abs(normal.z) > 0.9659) return normal.z > 0 ? 'floor' : 'ceiling';
	if (Math.abs(normal.z) > 0.25) return 'roof_slope';
	if (Math.abs(normal.x) >= Math.abs(normal.y)) return normal.x > 0 ? 'wall_x_pos' : 'wall_x_neg';
	return normal.y > 0 ? 'wall_y_pos' : 'wall_y_neg';
}

function polygonArea(points: BomVector[]) {
	if (points.length < 3) return 0;
	const normal = { x: 0, y: 0, z: 0 };
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		normal.x += (current.y - next.y) * (current.z + next.z);
		normal.y += (current.z - next.z) * (current.x + next.x);
		normal.z += (current.x - next.x) * (current.y + next.y);
	}
	return Math.hypot(normal.x, normal.y, normal.z) * 0.5;
}
