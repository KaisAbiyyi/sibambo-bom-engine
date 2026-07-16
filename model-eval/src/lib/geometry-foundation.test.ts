import { describe, expect, test } from 'bun:test';
import {
	analyzeGeometryFoundation,
	finalizePartAssignments,
	type GeometryFaceInput
} from './geometry-foundation';

describe('iteration 1 geometry foundation', () => {
	test('classifies an upward horizontal surface as floor', () => {
		const result = analyzeGeometryFoundation([
			horizontal('floor', 5, false, 'floor')
		]);
		expect(result.faces[0].role).toBe('floor');
		expect(result.faces[0].orientation).toBe('horizontal');
		expect(result.faces[0].normal.y).toBeGreaterThan(0.9);
	});

	test('classifies the upper room boundary as ceiling', () => {
		const result = analyzeGeometryFoundation(roomShell(0));
		expect(result.faces.find((face) => face.id === 'ceiling')?.role).toBe('ceiling');
	});

	test('classifies a meaningful vertical room boundary as wall', () => {
		const result = analyzeGeometryFoundation(roomShell(0));
		expect(result.faces.find((face) => face.id === 'wall-north')?.role).toBe('wall');
		expect(result.faces.find((face) => face.id === 'wall-north')?.orientation).toBe('vertical');
	});

	test('detects valid room after whole model is elevated', () => {
		const result = analyzeGeometryFoundation(roomShell(12));
		expect(result.roomDetection.state).toBe('valid');
		expect(result.rooms).toHaveLength(1);
		expect(result.rooms[0].areaM2).toBeCloseTo(20, 4);
		expect(result.rooms[0].heightM).toBeCloseTo(3, 4);
		expect(result.rooms[0].volumeM3).toBeCloseTo(60, 4);
		expect(result.faces.find((face) => face.id === 'floor')?.role).toBe('floor');
		expect(result.faces.find((face) => face.id === 'ceiling')?.role).toBe('ceiling');
	});

	test('returns explicit reason instead of silent zero room values', () => {
		const result = analyzeGeometryFoundation([horizontal('orphan-floor', 0, false, 'floor')]);
		expect(result.rooms).toEqual([]);
		expect(result.roomDetection.state).toBe('insufficient surfaces');
		expect(result.roomDetection.reason.length).toBeGreaterThan(0);
	});

	test('reports open geometry when one room boundary wall is missing', () => {
		const result = analyzeGeometryFoundation(roomShell(0).filter((face) => face.id !== 'wall-east'));
		expect(result.rooms).toEqual([]);
		expect(result.roomDetection.state).toBe('open geometry');
		expect(result.roomDetection.reason).toContain('boundary');
	});
});

describe('final category partition', () => {
	test('keeps a wall out of Lainnya and omits zero-count categories', () => {
		const partition = finalizePartAssignments([
			{ id: 'component-wall', partKey: 'walls', areaM2: 12 },
			{ id: 'component-unknown', partKey: null, areaM2: 1 }
		]);
		expect(partition.assignments.get('walls')).toEqual(['component-wall']);
		expect(partition.assignments.get('other')).toEqual(['component-unknown']);
		expect(partition.assignments.get('other')).not.toContain('component-wall');
		expect(partition.stats.some((stat) => stat.key === 'ceiling')).toBe(false);
	});

	test('rejects duplicate component IDs so final category membership is stable', () => {
		expect(() => finalizePartAssignments([
			{ id: 'same-id', partKey: 'walls', areaM2: 1 },
			{ id: 'same-id', partKey: null, areaM2: 1 }
		])).toThrow(/duplicate/i);
	});
});

function roomShell(elevation: number): GeometryFaceInput[] {
	return [
		horizontal('floor', elevation, false, 'floor'),
		horizontal('ceiling', elevation + 3, true, 'floor'),
		verticalX('wall-west', 0, elevation, 0, 4, 'wall_x_neg'),
		verticalX('wall-east', 5, elevation, 0, 4, 'wall_x_pos'),
		verticalZ('wall-north', 0, elevation, 0, 5, 'wall_y_pos'),
		verticalZ('wall-south', 4, elevation, 0, 5, 'wall_y_neg')
	];
}

function horizontal(id: string, y: number, downward: boolean, surfaceHint: string): GeometryFaceInput {
	const vertices = [
		{ x: 0, y, z: 0 },
		{ x: 0, y, z: 4 },
		{ x: 5, y, z: 4 },
		{ x: 5, y, z: 0 }
	];
	return { id, vertices: downward ? [...vertices].reverse() : vertices, areaM2: 20, surfaceHint };
}

function verticalX(id: string, x: number, y: number, minZ: number, maxZ: number, surfaceHint: string): GeometryFaceInput {
	return {
		id,
		vertices: [
			{ x, y, z: minZ },
			{ x, y: y + 3, z: minZ },
			{ x, y: y + 3, z: maxZ },
			{ x, y, z: maxZ }
		],
		areaM2: 12,
		surfaceHint
	};
}

function verticalZ(id: string, z: number, y: number, minX: number, maxX: number, surfaceHint: string): GeometryFaceInput {
	return {
		id,
		vertices: [
			{ x: minX, y, z },
			{ x: maxX, y, z },
			{ x: maxX, y: y + 3, z },
			{ x: minX, y: y + 3, z }
		],
		areaM2: 15,
		surfaceHint
	};
}
