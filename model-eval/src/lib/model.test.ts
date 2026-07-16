import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { parseBomModelJson, readBomModelData, readBomModelFile, type BomEntity, type BomVertex } from './model';

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

function bomeGzipFile(header: Record<string, unknown>, positions: Int32Array, faces: Int32Array, name = 'compact-model.bome.gz', tail = new Uint8Array()) {
	const magic = new TextEncoder().encode('BOME1\n');
	const headerJson = JSON.stringify(header);
	const rawHeaderBytes = new TextEncoder().encode(headerJson);
	const padding = (4 - ((magic.length + 20 + rawHeaderBytes.length) % 4)) % 4;
	const headerBytes = new TextEncoder().encode(headerJson + ' '.repeat(padding));
	const bytes = new Uint8Array(magic.length + 20 + headerBytes.length + positions.byteLength + faces.byteLength + tail.byteLength);
	bytes.set(magic, 0);
	const view = new DataView(bytes.buffer);
	let offset = magic.length;
	view.setUint32(offset, headerBytes.length, true);
	offset += 4;
	view.setUint32(offset, positions.length, true);
	offset += 4;
	view.setUint32(offset, faces.length, true);
	offset += 4;
	view.setUint32(offset, positions.byteLength, true);
	offset += 4;
	view.setUint32(offset, faces.byteLength, true);
	offset += 4;
	bytes.set(headerBytes, offset);
	offset += headerBytes.length;
	bytes.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), offset);
	offset += positions.byteLength;
	bytes.set(new Uint8Array(faces.buffer, faces.byteOffset, faces.byteLength), offset);
	offset += faces.byteLength;
	bytes.set(tail, offset);
	return new File([gzipSync(bytes)], name, { type: 'application/gzip' });
}

describe('parseBomModelJson room detection', () => {
	test('builds validation from connected floor, wall, and ceiling boundaries', () => {
		const shell = roomShellEntities(10);
		const parsed = parseBomModelJson({ entities: shell }, 'elevated-room-shell.json');
		expect(parsed.roomDetection.state).toBe('valid');
		expect(parsed.spaces).toHaveLength(1);
		expect(parsed.spaces[0].areaM2).toBeCloseTo(20, 4);
		expect(parsed.spaces[0].volumeM3).toBeCloseTo(60, 4);
		expect(parsed.validation.wallCount).toBe(4);
		expect(parsed.validation.floorCount).toBe(1);
		expect(parsed.validation.ceilingCount).toBe(1);
		expect(parsed.validation.downstreamAnalysisAllowed).toBe(true);
	});

	test('blocks downstream analysis and returns explicit room failure reason', () => {
		const parsed = parseBomModelJson({ entities: [face('Orphan floor', [[0, 0], [4, 0], [4, 4], [0, 4]], 16, 0, 'floor')] }, 'open-floor.json');
		expect(parsed.spaces).toEqual([]);
		expect(parsed.validation.detectedRoomCount).toBe(0);
		expect(parsed.roomDetection.state).toBe('insufficient surfaces');
		expect(parsed.roomDetection.reason.length).toBeGreaterThan(0);
		expect(parsed.validation.downstreamAnalysisAllowed).toBe(false);
		expect(parsed.validation.warnings.some((warning) => warning.includes(parsed.roomDetection.reason))).toBe(true);
	});

	test('uses stable unique face IDs and a disjoint Lainnya partition', () => {
		const wallA = roomShellEntities(0)[2];
		const wallB = roomShellEntities(0)[3];
		wallA.id = 'duplicate-source-id';
		wallB.id = 'duplicate-source-id';
		const unknown = face3d('Unknown panel', [[8, 8, 0], [8.2, 8, 0], [8.2, 8.2, 0.2]], 0.04, 'other');
		const parsed = parseBomModelJson({ entities: [wallA, wallB, unknown] }, 'partition.json');
		expect(new Set(parsed.faces.map((item) => item.id)).size).toBe(parsed.faces.length);
		const wallIds = new Set(parsed.faces.filter((item) => item.partKey === 'walls').map((item) => item.id));
		const otherIds = parsed.faces.filter((item) => item.partKey === 'other').map((item) => item.id);
		expect(otherIds.every((id) => !wallIds.has(id))).toBe(true);
		expect(parsed.partStats.every((stat) => stat.count > 0)).toBe(true);
	});

	test('reads compressed .json.gz model files', async () => {
		const json = JSON.stringify({
			entities: [
				face('Compressed floor', [
					[0, 0],
					[2, 0],
					[2, 2],
					[0, 2]
				], 4)
			]
		});
		const file = new File([gzipSync(json)], 'compressed-model.json.gz', { type: 'application/gzip' });
		const text = await readBomModelFile(file, 1024 * 1024);
		const parsed = parseBomModelJson(JSON.parse(text), file.name);
		expect(parsed.faceCount).toBe(1);
		expect(parsed.faces[0].areaM2).toBe(4);
	});

	test('preserves face holes for correct renderer triangulation', () => {
		const source = face(
			'Floor with void',
			[
				[0, 0],
				[5, 0],
				[5, 5],
				[0, 5]
			],
			21
		);
		source.holes = [
			[
				{ x: 2, y: -2, z: 0.3 },
				{ x: 3, y: -2, z: 0.3 },
				{ x: 3, y: -3, z: 0.3 },
				{ x: 2, y: -3, z: 0.3 }
			]
		];
		const parsed = parseBomModelJson({ entities: [source] }, 'face-with-hole.json');
		expect(parsed.faces[0].holes).toHaveLength(1);
		expect(parsed.faces[0].holes[0]).toHaveLength(4);
	});

	test('preserves exported material color for faithful rendering', () => {
		const source = face(
			'Painted wall',
			[
				[0, 0],
				[4, 0],
				[4, 3],
				[0, 3]
			],
			12,
			0.3,
			'wall_x_pos'
		);
		source.mat_color = '#c08040';
		const parsed = parseBomModelJson({ entities: [source] }, 'painted-face.json');
		expect(parsed.faces[0].color).toBe('#c08040');
	});

	test('preserves exported texture name for patterned material rendering', () => {
		const source = face('Roof shingles', [[0, 0], [4, 0], [4, 3], [0, 3]], 12, 3.4, 'roof_slope');
		source.material_front = {
			name: 'Roofing Shingles',
			color: { hex: '#514e4a' },
			texture: { filename: 'Roofing_Shingles_GAF_Estates.jpg' }
		};
		const parsed = parseBomModelJson({ entities: [source] }, 'textured-face.json');
		expect(parsed.faces[0].textureName).toBe('Roofing_Shingles_GAF_Estates.jpg');
	});

	test('classifies tall fragmented facade faces as walls', () => {
		const source = face3d(
			'High facade triangle',
			[
				[0, 0, 0],
				[8, 0, 0],
				[8, 0, 14],
				[0, 0, 14]
			],
			112,
			'wall_y_pos'
		);
		const parsed = parseBomModelJson({ entities: [source] }, 'high-wall.json');
		expect(parsed.faces[0].partKey).toBe('walls');
	});

	test('classifies vertical glass wall faces above floor as windows', () => {
		const source = face3d(
			'Glass panel',
			[
				[0, 0, 1],
				[2, 0, 1],
				[2, 0, 3],
				[0, 0, 3]
			],
			6,
			'wall_y_neg'
		);
		source.material_front = {
			name: 'Translucent Glass',
			color: { hex: '#7d8ab7' },
			texture: { filename: 'Translucent_Glass_Sky_Reflection_.jpg' }
		};
		const floor = face3d(
			'Floor reference',
			[
				[-1, -1, 0],
				[3, -1, 0],
				[3, 1, 0],
				[-1, 1, 0]
			],
			8,
			'floor'
		);
		const parsed = parseBomModelJson({ entities: [floor, source] }, 'glass-opening.json');
		expect(parsed.faces.find((item) => item.name === 'Glass panel')?.partKey).toBe('windows');
	});

	test('classifies vertical glass faces touching floor as doors', () => {
		const source = face3d(
			'Sliding glass door',
			[
				[0, 0, 0],
				[2, 0, 0],
				[2, 0, 2.4],
				[0, 0, 2.4]
			],
			4.8,
			'wall_y_neg'
		);
		source.material_front = {
			name: 'Translucent Glass Door',
			color: { hex: '#7d8ab7' },
			texture: { filename: 'Translucent_Glass_Sky_Reflection_.jpg' }
		};
		const parsed = parseBomModelJson({ entities: [source] }, 'glass-door.json');
		expect(parsed.faces[0].partKey).toBe('doors');
	});

	test('keeps elevated main-floor doors as doors instead of windows', () => {
		const lowerSite = face3d(
			'Lower site plane',
			[
				[-2, -2, 0],
				[4, -2, 0],
				[4, 2, 0],
				[-2, 2, 0]
			],
			24,
			'floor'
		);
		lowerSite.material_front = {
			name: 'Ground',
			color: { hex: '#c49f6c' }
		};
		const mainFloor = face3d(
			'Main elevated floor',
			[
				[-1, -1, 1.8],
				[3, -1, 1.8],
				[3, 1, 1.8],
				[-1, 1, 1.8]
			],
			8,
			'floor'
		);
		const door = face3d(
			'Glass entry door',
			[
				[0, 0, 1.8],
				[1, 0, 1.8],
				[1, 0, 4.1],
				[0, 0, 4.1]
			],
			2.3,
			'wall_y_neg'
		);
		door.material_front = {
			name: 'Translucent Glass Door',
			color: { hex: '#7d8ab7' }
		};
		const parsed = parseBomModelJson({ entities: [lowerSite, mainFloor, door] }, 'elevated-door.json');
		expect(parsed.faces.find((item) => item.name === 'Glass entry door')?.partKey).toBe('doors');
	});

	test('assigns nearby unnamed frames to their window cluster', () => {
		const glass = face3d(
			'Window glass',
			[
				[0, 0, 1],
				[1.2, 0, 1],
				[1.2, 0, 2.2],
				[0, 0, 2.2]
			],
			1.44,
			'wall_y_neg'
		);
		glass.material_front = {
			name: 'Translucent Glass',
			color: { hex: '#7d8ab7' }
		};
		const frame = face3d(
			'Unnamed thin frame',
			[
				[1.25, 0, 0.9],
				[1.3, 0, 0.9],
				[1.3, 0, 2.3],
				[1.25, 0, 2.3]
			],
			0.07,
			'wall_y_neg'
		);
		frame.material_front = {
			name: 'Wood_Cherry_Original.jpg',
			color: { hex: '#98562a' }
		};
		const parsed = parseBomModelJson({ entities: [glass, frame] }, 'window-frame.json');
		expect(parsed.faces.find((item) => item.name === 'Unnamed thin frame')?.partKey).toBe('windows');
	});

	test('corrects swapped floor and ceiling from material names', () => {
		const floorSource = face3d(
			'Horizontal tile face',
			[
				[0, 0, 0],
				[3, 0, 0],
				[3, 3, 0],
				[0, 3, 0]
			],
			9,
			'ceiling'
		);
		floorSource.material_front = {
			name: 'Floor Tile',
			color: { hex: '#b6a28f' }
		};
		const ceilingSource = face3d(
			'Horizontal gypsum face',
			[
				[0, 0, 2.8],
				[3, 0, 2.8],
				[3, 3, 2.8],
				[0, 3, 2.8]
			],
			9,
			'floor'
		);
		ceilingSource.material_front = {
			name: 'Gypsum Ceiling',
			color: { hex: '#f2f0e8' }
		};
		const parsed = parseBomModelJson({ entities: [floorSource, ceilingSource] }, 'swapped-horizontal.json');
		expect(parsed.faces.find((item) => item.name === 'Horizontal tile face')?.partKey).toBe('floor');
		expect(parsed.faces.find((item) => item.name === 'Horizontal gypsum face')?.partKey).toBe('ceiling');
	});

	test('uses detected floor levels to classify unlabelled elevated ceilings', () => {
		const mainFloor = face3d(
			'Elevated main floor',
			[
				[0, 0, 1.8],
				[4, 0, 1.8],
				[4, 4, 1.8],
				[0, 4, 1.8]
			],
			16,
			'floor'
		);
		const ceiling = face3d(
			'Unlabelled ceiling plane',
			[
				[0, 0, 4.6],
				[4, 0, 4.6],
				[4, 4, 4.6],
				[0, 4, 4.6]
			],
			16,
			'floor'
		);
		const parsed = parseBomModelJson({ entities: [mainFloor, ceiling] }, 'elevated-ceiling.json');
		expect(parsed.faces.find((item) => item.name === 'Elevated main floor')?.partKey).toBe('floor');
		expect(parsed.faces.find((item) => item.name === 'Unlabelled ceiling plane')?.partKey).toBe('ceiling');
	});

	test('classifies short exterior siding fragments as walls', () => {
		const source = face3d(
			'Siding strip',
			[
				[0, 0, 2],
				[3, 0, 2],
				[3, 0, 2.18],
				[0, 0, 2.18]
			],
			0.54,
			'wall_y_pos'
		);
		source.material_front = {
			name: '[Color_000]',
			color: { hex: '#ffffff' }
		};
		const parsed = parseBomModelJson({ entities: [source] }, 'siding-strip.json');
		expect(parsed.faces[0].partKey).toBe('walls');
	});

	test('reads compact mesh v1 without nested per-vertex objects', () => {
		const parsed = parseBomModelJson(
			{
				schema_version: '2.1',
				export_level: 'standard',
				geometry_format: 'compact_mesh_v1',
				mesh: {
					version: 1,
					position_scale: 0.001,
					area_scale: 0.0001,
					normal_scale: 0.0001,
					face_stride: 9,
					surfaces: ['floor'],
					layers: ['Layer0'],
					materials: [{ color: { hex: '#eeeeee' }, texture: { filename: 'Cladding_Siding_White.jpg' } }],
					positions: [0, 0, 300, 2000, 0, 300, 2000, -2000, 300, 0, -2000, 300],
					faces: [0, 4, 0, 0, 0, 40000, 0, 0, 10000]
				}
			},
			'compact-mesh.json'
		);
		expect(parsed.faceCount).toBe(1);
		expect(parsed.vertexCount).toBe(4);
		expect(parsed.faces[0].areaM2).toBe(4);
		expect(parsed.faces[0].color).toBe('#eeeeee');
		expect(parsed.faces[0].textureName).toBe('Cladding_Siding_White.jpg');
		expect(parsed.faces[0].vertices[2]).toEqual({ x: 2, y: 0.3, z: 2 });
	});

	test('rejects compact mesh face rows outside position buffer', () => {
		expect(() =>
			parseBomModelJson(
				{
					schema_version: '2.1',
					export_level: 'standard',
					geometry_format: 'compact_mesh_v1',
					mesh: {
						version: 1,
						position_scale: 0.001,
						area_scale: 0.0001,
						normal_scale: 0.0001,
						face_stride: 9,
						surfaces: ['floor'],
						layers: ['Layer0'],
						materials: [],
						positions: [0, 0, 0, 1000, 0, 0, 0, 1000, 0],
						faces: [2, 3, 0, -1, 0, 5000, 0, 0, 10000]
					}
				},
				'corrupt-compact-mesh.json'
			)
		).toThrow(/Compact mesh korup/);
	});

	test('reads compressed binary .bome.gz model files', async () => {
		const header = {
			schema_version: '2.1',
			export_level: 'standard',
			geometry_format: 'binary_mesh_v1',
			mesh: {
				version: 1,
				position_scale: 0.001,
				area_scale: 0.0001,
				normal_scale: 0.0001,
				face_stride: 9,
				binary_layout: 'positions_then_faces_v2_int_counts',
				surfaces: ['roof_slope'],
				layers: ['Layer0'],
				materials: [{ color: { hex: '#555555' }, texture: { filename: 'Roofing_Shingles_GAF_Estates.jpg' } }],
				position_count: 9,
				face_int_count: 9
			}
		};
		const positions = new Int32Array([0, 0, 3000, 2000, 0, 3500, 0, -2000, 3500]);
		const faces = new Int32Array([0, 3, 0, 0, 0, 20000, 0, 7071, 7071]);
		const file = bomeGzipFile(header, positions, faces);
		const data = await readBomModelData(file, 1024 * 1024);
		const parsed = parseBomModelJson(data, file.name);
		expect(parsed.faceCount).toBe(1);
		expect(parsed.vertexCount).toBe(3);
		expect(parsed.faces[0].partKey).toBe('roof');
		expect(parsed.faces[0].textureName).toBe('Roofing_Shingles_GAF_Estates.jpg');
	});

	test('rejects stale binary .bome.gz files without layout marker', async () => {
		const header = {
			schema_version: '2.1',
			export_level: 'standard',
			geometry_format: 'binary_mesh_v1',
			mesh: {
				version: 1,
				position_scale: 0.001,
				area_scale: 0.0001,
				normal_scale: 0.0001,
				face_stride: 9,
				surfaces: ['floor'],
				layers: ['Layer0'],
				materials: [],
				position_count: 9,
				face_int_count: 9
			}
		};
		const file = bomeGzipFile(header, new Int32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]), new Int32Array([0, 3, 0, -1, 0, 5000, 0, 0, 10000]), 'stale-model.bome.gz');
		await expect(readBomModelData(file, 1024 * 1024)).rejects.toThrow(/exporter lama/);
	});

	test('rejects binary .bome.gz files with trailing bytes from bad byte counts', async () => {
		const header = {
			schema_version: '2.1',
			export_level: 'standard',
			geometry_format: 'binary_mesh_v1',
			mesh: {
				version: 1,
				position_scale: 0.001,
				area_scale: 0.0001,
				normal_scale: 0.0001,
				face_stride: 9,
				binary_layout: 'positions_then_faces_v2_int_counts',
				surfaces: ['floor'],
				layers: ['Layer0'],
				materials: [],
				position_count: 9,
				face_int_count: 9
			}
		};
		const file = bomeGzipFile(
			header,
			new Int32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]),
			new Int32Array([0, 3, 0, -1, 0, 5000, 0, 0, 10000]),
			'bad-byte-counts.bome.gz',
			new Uint8Array([1, 2, 3, 4])
		);
		await expect(readBomModelData(file, 1024 * 1024)).rejects.toThrow(/header tidak valid/);
	});

	test('rejects binary .bome.gz face rows outside position buffer', async () => {
		const header = {
			schema_version: '2.1',
			export_level: 'standard',
			geometry_format: 'binary_mesh_v1',
			mesh: {
				version: 1,
				position_scale: 0.001,
				area_scale: 0.0001,
				normal_scale: 0.0001,
				face_stride: 9,
				binary_layout: 'positions_then_faces_v2_int_counts',
				surfaces: ['floor'],
				layers: ['Layer0'],
				materials: [],
				position_count: 9,
				face_int_count: 9
			}
		};
		const file = bomeGzipFile(header, new Int32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]), new Int32Array([2, 3, 0, -1, 0, 5000, 0, 0, 10000]), 'corrupt-model.bome.gz');
		const data = await readBomModelData(file, 1024 * 1024);
		expect(() => parseBomModelJson(data, file.name)).toThrow(/Compact mesh korup/);
	});

	test('accepts high-vertex faces so dense SketchUp polygons still render', () => {
		const points = Array.from({ length: 300 }, (_, index) => {
			const angle = (Math.PI * 2 * index) / 300;
			return [Math.cos(angle) * 3, Math.sin(angle) * 3] as [number, number];
		});
		const parsed = parseBomModelJson({ entities: [face('Dense floor', points, 28)] }, 'dense-face.json');
		expect(parsed.faceCount).toBe(1);
		expect(parsed.vertexCount).toBe(300);
		expect(parsed.faces[0].vertices).toHaveLength(300);
	});

	test('rejects rectangular and L-shaped floor evidence without wall boundaries', () => {
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

		expect(parsed.spaces).toEqual([]);
		expect(parsed.roomDetection.state).toBe('insufficient surfaces');
		expect(parsed.roomDetection.reason).toContain('wall');
	});

	test('does not fabricate room height from walls when ceiling boundary is missing', () => {
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
		expect(parsed.spaces).toEqual([]);
		expect(parsed.roomDetection.state).toBe('incomplete boundary');
		expect(parsed.roomDetection.reason).toContain('ceiling');
	});
});

function roomShellEntities(elevation: number): BomEntity[] {
	return [
		face3d('Floor boundary', [[0, 0, elevation], [0, 4, elevation], [5, 4, elevation], [5, 0, elevation]], 20, 'floor'),
		face3d('Upper horizontal boundary', [[5, 0, elevation + 3], [5, 4, elevation + 3], [0, 4, elevation + 3], [0, 0, elevation + 3]], 20, 'floor'),
		face3d('West wall', [[0, 0, elevation], [0, 0, elevation + 3], [0, 4, elevation + 3], [0, 4, elevation]], 12, 'wall_x_neg'),
		face3d('East wall', [[5, 4, elevation], [5, 4, elevation + 3], [5, 0, elevation + 3], [5, 0, elevation]], 12, 'wall_x_pos'),
		face3d('North wall', [[0, 0, elevation], [5, 0, elevation], [5, 0, elevation + 3], [0, 0, elevation + 3]], 15, 'wall_y_pos'),
		face3d('South wall', [[5, 4, elevation], [0, 4, elevation], [0, 4, elevation + 3], [5, 4, elevation + 3]], 15, 'wall_y_neg')
	];
}
