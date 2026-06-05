import { describe, expect, test } from 'bun:test';
import { parseBomModelJson, type BomEntity, type BomVertex } from './model';

function vertex(x: number, z: number, y = 0.3): BomVertex {
	return {
		position: {
			x,
			y: -z,
			z: y
		}
	};
}

function face(name: string, points: Array<[number, number]>, areaM2: number, y = 0.3, surface = 'floor'): BomEntity {
	return {
		type: 'Face',
		name,
		surface_type: surface,
		area_m2: areaM2,
		vertices: points.map(([x, z]) => vertex(x, z, y))
	};
}

function face3d(name: string, points: Array<[number, number, number]>, areaM2: number, surface?: string): BomEntity {
	return {
		type: 'Face',
		name,
		surface_type: surface,
		area_m2: areaM2,
		vertices: points.map(([x, z, y]) => vertex(x, z, y))
	};
}

describe('parseBomModelJson room detection', () => {
	test('detects rectangular and L-shaped rooms while excluding roof and foundation floors', () => {
		const parsed = parseBomModelJson(
			{
				entities: [
					{
						type: 'Group',
						name: 'Keramik Lantai',
						children: [
							face('Ruang kotak', [
								[0, 0],
								[4, 0],
								[4, 3],
								[0, 3]
							], 12),
							face('Ruang L', [
								[5, 0],
								[9, 0],
								[9, 2],
								[7, 2],
								[7, 5],
								[5, 5]
							], 14)
						]
					},
					{
						type: 'Group',
						name: 'Plafon',
						children: [
							face('Plafon ruang kotak', [
								[0, 0],
								[4, 0],
								[4, 3],
								[0, 3]
							], 12, 3.3, 'ceiling'),
							face('Plafon ruang L', [
								[5, 0],
								[9, 0],
								[9, 2],
								[7, 2],
								[7, 5],
								[5, 5]
							], 14, 3.3, 'ceiling')
						]
					},
					{
						type: 'Group',
						name: 'Atap Spandek',
						children: [
							face('Atap bukan ruang', [
								[0, 0],
								[6, 0],
								[6, 6],
								[0, 6]
							], 36, 5.2)
						]
					},
					{
						type: 'Group',
						name: 'Pondasi Batu Kali',
						children: [
							face('Fondasi bukan ruang', [
								[0, 0],
								[6, 0],
								[6, 6],
								[0, 6]
							], 36, -0.4)
						]
					}
				]
			},
			'synthetic-room-shapes.json'
		);

		expect(parsed.spaces).toHaveLength(2);
		expect(parsed.spaces.map((space) => space.shape).sort()).toEqual(['l_shape', 'rectangle']);
		expect(parsed.spaces.every((space) => Math.abs(space.detectedHeightM - 3) < 0.01)).toBe(true);
		expect(parsed.spaces.every((space) => !/atap|pondasi/i.test(space.name))).toBe(true);
	});

	test('uses geometry-detected wall height before roof or whole-model height', () => {
		const parsed = parseBomModelJson(
			{
				entities: [
					{
						type: 'Group',
						name: 'Room shell',
						children: [
							face('floor plane', [
								[0, 0],
								[4, 0],
								[4, 3],
								[0, 3]
							], 12, 0.3, 'floor'),
							face3d('north panel', [
								[0, 0, 0.3],
								[4, 0, 0.3],
								[4, 0, 3.5],
								[0, 0, 3.5]
							], 12.8),
							face3d('south panel', [
								[0, 3, 0.3],
								[4, 3, 0.3],
								[4, 3, 3.5],
								[0, 3, 3.5]
							], 12.8),
							face3d('west panel', [
								[0, 0, 0.3],
								[0, 3, 0.3],
								[0, 3, 3.5],
								[0, 0, 3.5]
							], 9.6),
							face3d('east panel', [
								[4, 0, 0.3],
								[4, 3, 0.3],
								[4, 3, 3.5],
								[4, 0, 3.5]
							], 9.6),
							face('high roof plane', [
								[0, 0],
								[4, 0],
								[4, 3],
								[0, 3]
							], 12, 6.2, 'roof_slope')
						]
					}
				]
			},
			'neutral-wall-geometry.json'
		);

		expect(parsed.partStats.find((part) => part.key === 'walls')?.count).toBe(4);
		expect(parsed.spaces).toHaveLength(1);
		expect(parsed.spaces[0].detectedHeightM).toBeCloseTo(3.2, 1);
		expect(parsed.spaces[0].detectedHeightM).toBeLessThan(5);
	});
});
