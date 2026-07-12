import { describe, expect, test } from 'bun:test';
import { classifyBuildingFaces, type BuildingCategory, type ClassifierFaceInput } from './classifier';
import { RULE_BANK_VERSION } from './rule-bank-v1';

const buildingBounds = bounds(0, 0, 0, 20, 8, 20);

describe('adaptive building classifier v1', () => {
	test.each([
		['roof', face('Atap spandek', 'roof_slope', bounds(0, 7, 0, 10, 8, 10), { areaM2: 80 })],
		['floor', face('Pelat lantai utama', 'floor', bounds(0, 0, 0, 10, 0.05, 10), { areaM2: 100 })],
		['ceiling', face('Plafon ruang', 'ceiling', bounds(0, 3, 0, 10, 3.05, 10), { areaM2: 100 })],
		['exterior_wall', face('Dinding luar facade', 'wall_x_pos', bounds(0, 0, 0, 0.15, 4, 10), { areaM2: 40 })],
		['interior_wall', face('Sekat interior', 'wall_y_pos', bounds(8, 0, 4, 8.12, 3, 10), { areaM2: 18 })],
		['door', face('Pintu entrance', 'wall_x_pos', bounds(0, 0, 2, 0.08, 2.2, 3), { areaM2: 2.2 })],
		['window', face('Jendela kaca', 'wall_x_pos', bounds(0, 1, 4, 0.08, 2.5, 6), { areaM2: 3, textureName: 'clear glass' })],
		['column', face('Kolom beton', 'structure', bounds(5, 0, 5, 5.35, 5, 5.35), { areaM2: 7 })],
		['beam', face('Balok struktur', 'structure', bounds(2, 3, 5, 10, 3.4, 5.4), { areaM2: 8 })],
		['stair', face('Tangga utama step', 'other', bounds(2, 0, 2, 6, 3, 5), { areaM2: 12 })],
		['railing', face('Railing pagar', 'other', bounds(2, 1, 2, 8, 2.1, 2.08), { areaM2: 3 })],
		['furniture', face('Meja office furniture', 'other', bounds(5, 0, 5, 7, 1, 6), { areaM2: 3 })],
		['fixture', face('Wastafel sanitary fixture', 'other', bounds(6, 0.7, 6, 7, 1.2, 6.7), { areaM2: 1 })],
		['opening', face('Bukaan opening void', 'other', bounds(0, 1, 8, 0.05, 2.5, 10), { areaM2: 3 })],
		['room_boundary', face('Batas ruang room boundary', 'floor', bounds(2, 0, 2, 8, 0.02, 8), { areaM2: 36 })]
	] as Array<[Exclude<BuildingCategory, 'unknown'>, ClassifierFaceInput]>)('classifies %s with versioned explanation trace', (category, input) => {
		const [trace] = classifyBuildingFaces([input], context());
		expect(trace.category).toBe(category);
		expect(trace.confidence).toBeGreaterThanOrEqual(0.55);
		expect(trace.ruleBankVersion).toBe(RULE_BANK_VERSION);
		expect(trace.activatedRules.length).toBeGreaterThan(0);
		expect(trace.candidates[0].category).toBe(category);
		expect(trace.supportingEvidence.length).toBeGreaterThan(0);
	});

	test('uses geometry, glass material, elevation, repetition, and wall-host context for an unlabelled window', () => {
		const wall = face('Entity', 'wall_x_pos', bounds(0, 0, 0, 0.15, 4, 12), { areaM2: 48 });
		const windows = Array.from({ length: 4 }, (_, index) =>
			face('Panel', 'wall_x_pos', bounds(0, 1.1, 1 + index * 2, 0.08, 2.4, 2.2 + index * 2), {
				id: `window-${index}`,
				areaM2: 1.56,
				textureName: 'transparent glass',
				path: `Model > Reused Panel > Face ${index}`
			})
		);
		const traces = classifyBuildingFaces([wall, ...windows], context());
		for (const trace of traces.slice(1)) {
			expect(trace.category).toBe('window');
			expect(trace.supportingEvidence.map((item) => item.key)).toContain('context.wall_host');
			expect(trace.supportingEvidence.map((item) => item.key)).toContain('reuse.repeated');
			expect(trace.explanation.toLowerCase()).toContain('window');
		}
	});

	test('keeps weak and conflicting evidence unknown with alternatives and explicit reason', () => {
		const ambiguous = face('Panel door window', 'other', bounds(9, 4, 9, 10, 4.1, 10), { areaM2: 1 });
		const [trace] = classifyBuildingFaces([ambiguous], context());
		expect(trace.category).toBe('unknown');
		expect(trace.unknownReason).toBeTruthy();
		expect(trace.candidates.length).toBeGreaterThanOrEqual(2);
		expect(trace.conflictResolution).toContain('ambiguous');
	});

	test('does not force a featureless face into a category', () => {
		const [trace] = classifyBuildingFaces([face('Entity', 'other', bounds(9, 4, 9, 9.2, 4.2, 9.2), { areaM2: 0.04 })], context());
		expect(trace.category).toBe('unknown');
		expect(trace.confidence).toBeGreaterThan(0);
		expect(trace.unknownReason).toContain('threshold');
	});
});

function context() {
	return { modelName: 'general-fixture.skp', buildingBounds, floorLevels: [0, 3] };
}

function face(name: string, surface: string, faceBounds: ClassifierFaceInput['bounds'], options: Partial<ClassifierFaceInput> = {}): ClassifierFaceInput {
	return {
		id: options.id || name,
		name,
		path: options.path || `Model > ${name}`,
		layer: options.layer,
		surface,
		areaM2: options.areaM2 || 1,
		bounds: faceBounds,
		center: faceBounds.center,
		vertexCount: options.vertexCount || 4,
		holeCount: options.holeCount || 0,
		color: options.color,
		textureName: options.textureName,
		legacyPartKey: options.legacyPartKey
	};
}

function bounds(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
		size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
		center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
	};
}
