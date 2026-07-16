import { describe, expect, test } from 'bun:test';
import { createRoomList, createRoomVisualization, reduceRoomInteraction } from './room-interaction';

const rooms = [
	{ id: 'b', center: { x: 5, y: 1.5, z: 0 }, footprint: [{ x: 4, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2 }, { x: 4, z: 2 }], heightM: 3, wallFaceIds: ['w2'] },
	{ id: 'a', center: { x: 1, y: 1.5, z: 0 }, footprint: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }], heightM: 3, wallFaceIds: ['w1'] }
];

describe('room list and interaction', () => {
	test('numbers rooms deterministically', () => {
		const list = createRoomList(rooms);
		expect(list.map((item) => [item.id, item.displayName])).toEqual([['a', 'Ruang 1'], ['b', 'Ruang 2']]);
	});

	test('hover leaves selection intact and does not request camera movement', () => {
		let state = reduceRoomInteraction({ hoveredRoomId: null, selectedRoomId: null }, { type: 'hover', roomId: 'a' });
		expect(state).toEqual({ hoveredRoomId: 'a', selectedRoomId: null });
		state = reduceRoomInteraction(state, { type: 'select', roomId: 'a' });
		state = reduceRoomInteraction(state, { type: 'leave' });
		expect(state).toEqual({ hoveredRoomId: null, selectedRoomId: 'a' });
		expect('cameraRequest' in state).toBe(false);
	});

	test('creates volume only when room height is valid', () => {
		expect(createRoomVisualization(rooms[0]).volume).not.toBeNull();
		const invalid = createRoomVisualization({ ...rooms[0], heightM: 0 });
		expect(invalid.volume).toBeNull();
		expect(invalid.warning).toContain('height');
	});
});
