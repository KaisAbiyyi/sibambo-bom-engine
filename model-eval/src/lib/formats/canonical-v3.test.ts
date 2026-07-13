import { describe, expect, test } from 'bun:test';
import { parseBomModelJson, readBomModelData } from '../model';
import { canonicalV3ToLegacyBom, isCanonicalV3, validateCanonicalV3 } from './canonical-v3';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translated = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

function fixture() {
	return {
		format: {
			name: 'BOM Engine Canonical',
			version: '3.0.0',
			schema: 'https://sibambo.dev/schemas/bom-engine/3.0.0/schema.json',
			generator: { name: 'test', version: 'test' }
		},
		source: { exported_at: '2026-07-13T00:00:00Z', scope: 'model' },
		units: { geometry_length_unit: 'meter', area_unit: 'square_meter' },
		coordinate_system: { handedness: 'right', up_axis: '+Z', threejs_mapping: '{x,y,z}->{x,z,-y}' },
		metadata: {},
		tags: [{ id: 'tag:0', name: 'Untagged', visible: true }],
		materials: [{ id: 'material:1', name: 'Brick', color: { hex: '#AA5522' }, opacity: 1 }],
		transforms: [identity, translated(1), translated(2)],
		meshes: [
			{
				id: 'mesh:component',
				definition_id: 'definition:component',
				coordinate_space: 'definition_local',
				positions_m: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.25, 0.25, 0, 0.25, 0.75, 0, 0.75, 0.75, 0, 0.75, 0.25, 0],
				faces: [
					{
						id: 'face:1',
						source_identity: { persistent_id: '1', entity_type: 'Sketchup::Face' },
						outer: [0, 1, 2, 3],
						holes: [[4, 5, 6, 7]],
						triangles: [0, 1, 7, 0, 7, 4, 1, 2, 6, 1, 6, 7, 2, 3, 5, 2, 5, 6, 3, 0, 4, 3, 4, 5],
						front_material_id: 'material:1',
						back_material_id: null,
						tag_id: 'tag:0',
						normal: [0, 0, 1],
						area_m2: 0.75,
						area_space: 'definition_local',
						surface_hint: 'floor'
					}
				],
				edges: []
			}
		],
		definitions: [
			{ id: 'definition:root', kind: 'root', name: 'Root', mesh_id: null, node_ids: ['node:1', 'node:2'] },
			{ id: 'definition:component', kind: 'component_definition', name: 'Panel', mesh_id: 'mesh:component', node_ids: [] }
		],
		nodes: [
			{ id: 'node:root', kind: 'root', name: 'Root', definition_id: 'definition:root', transform_id: 0 },
			{ id: 'node:1', kind: 'component_instance', name: 'Panel A', owner_definition_id: 'definition:root', definition_id: 'definition:component', transform_id: 1 },
			{ id: 'node:2', kind: 'component_instance', name: 'Panel B', owner_definition_id: 'definition:root', definition_id: 'definition:component', transform_id: 2 }
		],
		scenes: [],
		spaces: [],
		relationships: { openings: [], room_boundaries: [], adjacency: [] },
		analysis: {},
		statistics: {}
	};
}

describe('canonical JSON v3 compatibility adapter', () => {
	test('recognizes and validates a canonical v3 graph', () => {
		const data = fixture();
		expect(isCanonicalV3(data)).toBe(true);
		expect(validateCanonicalV3(data)).toEqual([]);
	});

	test('expands shared definition references while preserving holes and transforms', () => {
		const migrated = canonicalV3ToLegacyBom(fixture());
		expect(migrated.schema_version).toBe('3.0.0');
		expect(migrated.entities).toHaveLength(1);
		const root = migrated.entities?.[0];
		expect(root?.children).toHaveLength(2);
		const firstFace = root?.children?.[0].children?.[0];
		const secondFace = root?.children?.[1].children?.[0];
		expect(firstFace?.holes).toHaveLength(1);
		expect(firstFace?.vertices?.[0].position.x).toBe(1);
		expect(secondFace?.vertices?.[0].position.x).toBe(2);
		expect(firstFace?.mat_color).toBe('#AA5522');
		expect(firstFace?.area_m2).toBeCloseTo(0.75, 6);
	});

	test('rejects dangling references instead of silently dropping geometry', () => {
		const data = fixture();
		data.nodes[1].definition_id = 'definition:missing';
		const errors = validateCanonicalV3(data);
		expect(errors.some((error) => error.includes('definition:missing'))).toBe(true);
		expect(() => canonicalV3ToLegacyBom(data)).toThrow('Canonical JSON v3 tidak valid');
	});

	test('rejects recursive definition cycles during validation', () => {
		const data = fixture();
		data.definitions[1].node_ids = ['node:cycle'];
		data.nodes.push({
			id: 'node:cycle',
			kind: 'component_instance',
			name: 'Recursive Panel',
			owner_definition_id: 'definition:component',
			definition_id: 'definition:component',
			transform_id: 0
		});
		const errors = validateCanonicalV3(data);
		expect(errors.some((error) => error.includes('recursive definition cycle'))).toBe(true);
	});

	test('loads canonical v3 through the public model parser compatibility path', () => {
		const parsed = parseBomModelJson(fixture() as never, 'canonical-v3.json');
		expect(parsed.schemaVersion).toBe('3.0.0');
		expect(parsed.faceCount).toBe(2);
		expect(parsed.faces.every((face) => face.holes.length === 1)).toBe(true);
		expect(parsed.bounds.min.x).toBe(1);
		expect(parsed.bounds.max.x).toBe(3);
	});

	test('loads readable canonical v3 .json through public file input', async () => {
		const file = new File([JSON.stringify(fixture())], 'fixture_canonical.json', { type: 'application/json' });
		const data = await readBomModelData(file, 1024 * 1024);
		const parsed = parseBomModelJson(data, file.name);
		expect(parsed.schemaVersion).toBe('3.0.0');
		expect(parsed.faceCount).toBe(2);
	});
});
