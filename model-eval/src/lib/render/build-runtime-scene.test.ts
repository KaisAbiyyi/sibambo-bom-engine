import { describe, expect, test } from 'bun:test';
import type { Bome2RuntimeScene } from '../formats/bome2';
import { buildRuntimeGeometryGroups, runtimeComponentOverrides, runtimePartOverrides } from './build-runtime-scene';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translated = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

describe('BOME2 indexed instanced runtime scene', () => {
	test('shares indexed definition geometry across two mapped instance transforms', () => {
		const scene = fixture();
		const groups = buildRuntimeGeometryGroups(scene);
		expect(groups).toHaveLength(1);
		const group = groups[0];
		expect(group.key).toBe('floor');
		expect(group.geometry.getAttribute('position').count).toBe(3);
		expect(group.geometry.getIndex()?.count).toBe(3);
		expect(group.matrices).toHaveLength(2);
		expect(group.matrices[0].elements[12]).toBe(1);
		expect(group.matrices[1].elements[12]).toBe(2);
		const positions = Array.from(group.geometry.getAttribute('position').array as ArrayLike<number>);
		expect(positions).toEqual([0, 0, 0, 1, 0, 0, 0, 0, -1]);
	});

	test('uses adaptive classifier category instead of orientation-only surface hint', () => {
		const groups = buildRuntimeGeometryGroups(fixture(), new Map([['face:1', 'furniture']]));
		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe('furniture');
	});

	test('reduces expanded instance face ids to stable source-face majority classification', () => {
		const overrides = runtimePartOverrides([
			{ id: 'node:root/node:1:face:1', partKey: 'furniture' },
			{ id: 'node:root/node:2:face:1', partKey: 'furniture' },
			{ id: 'node:root/node:3:face:1', partKey: 'walls' }
		]);
		expect(overrides.get('face:1')).toBe('furniture');
	});

	test('splits reused definition instances into independently visible logical components', () => {
		const overrides = runtimeComponentOverrides([
			{ componentId: 'wall:a', partKey: 'walls', instancePath: 'node:root/node:1', sourceFaceIds: ['face:1'] },
			{ componentId: 'wall:b', partKey: 'walls', instancePath: 'node:root/node:2', sourceFaceIds: ['face:1'] }
		]);
		const groups = buildRuntimeGeometryGroups(fixture(), new Map(), overrides);
		expect(groups).toHaveLength(2);
		expect(groups.map((group) => group.componentId).sort()).toEqual(['wall:a', 'wall:b']);
		expect(groups.every((group) => group.matrices.length === 1)).toBe(true);
	});
});

function fixture(): Bome2RuntimeScene {
	const strings = [
		'definition:root', 'definition:panel', 'node:root', 'node:1', 'node:2',
		'Root', 'Panel', 'root', 'component_definition', 'mesh:panel', 'face:1', '1', 'floor',
		'material:1', 'Concrete', '#808080', 'tag:0', 'Untagged'
	];
	return {
		format: 'bome2_runtime_v2',
		sections: [],
		transforms: new Float32Array([...identity, ...translated(1), ...translated(2)]),
		manifest: {
			format: { name: 'BOME2', version: '2.0.0', canonical_version: '3.0.0', layout: 'section_directory_v1' },
			source: { file_name: -1, model_name: -1, scope: -1, exported_at: -1 },
			strings,
			materials: [{ id: 13, name: 14, display_name: 14, color_rgba: [128, 128, 128, 255], color_hex: 15, opacity: 1, texture: -1 }],
			tags: [{ id: 16, name: 17, visible: true }],
			transforms: { section: 0, count: 3, component_type: 'float32' },
			meshes: [
				{
					id: 9, definition: 1, positions_section: 1, loops_section: 2, triangles_section: 3,
					vertex_count: 3, triangle_count: 1,
					quantization: { component_type: 'uint16', minimum_m: [0, 0, 0], maximum_m: [1, 1, 0], scale_m: [1, 1, 0], measured_max_error_m: 0, error_budget_m: 0.001 },
					faces: [{ id: 10, source_persistent_id: 11, outer_start: 0, outer_count: 3, holes: [], triangle_start: 0, triangle_count: 3, material: 0, back_material: -1, tag: 0, surface_hint: 12, area_m2: 0.5 }]
				}
			],
			definitions: [
				{ id: 0, name: 5, kind: 7, mesh: -1, nodes: [1, 2] },
				{ id: 1, name: 6, kind: 8, mesh: 0, nodes: [] }
			],
			nodes: [
				{ id: 2, name: 5, kind: 1, owner_definition: -1, definition: 0, transform: 0, material: -1, tag: -1, visible: true, source_persistent_id: -1 },
				{ id: 3, name: 6, kind: 2, owner_definition: 0, definition: 1, transform: 1, material: -1, tag: 0, visible: true, source_persistent_id: -1 },
				{ id: 4, name: 6, kind: 2, owner_definition: 0, definition: 1, transform: 2, material: -1, tag: 0, visible: true, source_persistent_id: -1 }
			],
			root_node: 0,
			statistics: {}
		},
		meshes: [
			{
				manifest: undefined as never,
				positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
				loops: new Uint32Array([0, 1, 2]),
				triangles: new Uint32Array([0, 1, 2])
			}
		]
	};
}
