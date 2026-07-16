import { describe, expect, test } from 'bun:test';
import { reconstructLogicalWalls, type WallSurfaceCandidate } from './logical-walls';

const surface = (id: string, x: number, normalX: number, z0 = 0, z1 = 4, storey = 0, role: WallSurfaceCandidate['semanticRole'] = 'wall'): WallSurfaceCandidate => ({
	id,
	sourceNodeId: `node:${id}`,
	meshId: `mesh:${id}`,
	faceIds: [`face:${id}`],
	parentHierarchyId: 'building',
	connectedComponentId: `cc:${id}`,
	materialIds: [1],
	normal: { x: normalX, y: 0, z: 0 },
	centroid: { x, y: storey * 3 + 1.5, z: (z0 + z1) / 2 },
	bounds: {
		min: { x, y: storey * 3, z: z0 },
		max: { x, y: storey * 3 + 3, z: z1 },
		size: { x: 0, y: 3, z: z1 - z0 },
		center: { x, y: storey * 3 + 1.5, z: (z0 + z1) / 2 }
	},
	areaM2: (z1 - z0) * 3,
	storey,
	semanticRole: role
});

describe('logical wall reconstruction', () => {
	test('pairs opposite surfaces into one physical wall', () => {
		const result = reconstructLogicalWalls([surface('front', 0, 1), surface('back', 0.15, -1)]);
		expect(result.walls).toHaveLength(1);
		expect(result.walls[0].faceIds).toEqual(['face:back', 'face:front']);
		expect(result.walls[0].thickness).toBeCloseTo(0.15, 3);
		expect(result.diagnostics.pairedWallGroupCount).toBe(1);
	});

	test('merges connected coplanar segments before pairing', () => {
		const result = reconstructLogicalWalls([surface('a', 0, 1, 0, 2), surface('b', 0, 1, 2, 4)]);
		expect(result.diagnostics.wallSurfaceGroupCount).toBe(1);
		expect(result.walls).toHaveLength(1);
	});

	test('keeps perpendicular surfaces and storeys separate', () => {
		const perpendicular = { ...surface('perp', 0, 1), normal: { x: 0, y: 0, z: 1 }, bounds: { ...surface('perp', 0, 1).bounds, min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 3, z: 0 }, size: { x: 4, y: 3, z: 0 }, center: { x: 2, y: 1.5, z: 0 } } };
		const result = reconstructLogicalWalls([surface('x', 0, 1), perpendicular, surface('upper', 0, 1, 0, 4, 1)]);
		expect(result.walls).toHaveLength(3);
	});

	test('excludes opening frame surfaces and links opening area to correct wall', () => {
		const result = reconstructLogicalWalls(
			[surface('wall', 0, 1), surface('frame', 0.02, -1, 1, 2, 0, 'opening-frame')],
			[{ id: 'door:1', bounds: { min: { x: -0.1, y: 0, z: 1 }, max: { x: 0.2, y: 2.2, z: 2 }, size: { x: 0.3, y: 2.2, z: 1 }, center: { x: 0.05, y: 1.1, z: 1.5 } }, areaM2: 2.2 }]
		);
		expect(result.walls).toHaveLength(1);
		expect(result.walls[0].openingIds).toEqual(['door:1']);
		expect(result.walls[0].openingArea).toBeCloseTo(2.2);
		expect(result.walls[0].netArea).toBeCloseTo(result.walls[0].grossArea - 2.2);
		expect(result.walls[0].faceIds).not.toContain('face:frame');
	});

	test('attaches non-opening cap faces from the same wall source as side faces', () => {
		const wall = surface('wall', 0, 1);
		const cap = {
			...surface('cap', 0, 1, 0, 4, 0, 'decorative'),
			sourceNodeId: wall.sourceNodeId,
			normal: { x: 0, y: 1, z: 0 },
			bounds: { min: { x: 0, y: 3, z: 0 }, max: { x: 0.15, y: 3, z: 4 }, size: { x: 0.15, y: 0, z: 4 }, center: { x: 0.075, y: 3, z: 2 } },
			faceIds: ['face:cap'],
			areaM2: 0.6
		};
		const result = reconstructLogicalWalls([wall, cap]);
		expect(result.walls[0].sideFaceIds).toEqual(['face:cap']);
		expect(result.walls[0].faceIds).toContain('face:cap');
	});
});
