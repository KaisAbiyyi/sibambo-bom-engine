import { describe, expect, test } from 'bun:test';
import {
	getRoomCandidateBounds,
	resolveRoomCandidateId,
	resolveRoomCandidateSelection
} from './debug-selection';
import type { RoomCandidate } from './types';

const candidate = (id: string, polygon = [{ x: 2, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 9 }]) =>
	({ id, planPolygon: polygon, lowerElevation: 1.5, upperElevation: 4.5 }) as RoomCandidate;

describe('room debug selection helpers', () => {
	test('resolves candidate ID from overlay child through its parent', () => {
		const parent = { userData: { roomCandidateId: 'room:one' }, parent: null };
		const child = { userData: {}, parent };

		expect(resolveRoomCandidateId(child)).toBe('room:one');
	});

	test('selects first candidate deterministically without a valid prior selection', () => {
		const candidates = [candidate('room:first'), candidate('room:second')];

		expect(resolveRoomCandidateSelection(candidates, null)).toBe('room:first');
		expect(resolveRoomCandidateSelection(candidates, 'room:missing')).toBe('room:first');
	});

	test('preserves a valid selection after candidates reload', () => {
		const candidates = [candidate('room:first'), candidate('room:second')];

		expect(resolveRoomCandidateSelection(candidates, 'room:second')).toBe('room:second');
	});

	test('calculates 3D bounds from polygon and candidate elevations', () => {
		expect(getRoomCandidateBounds(candidate('room:one'))).toEqual({
			min: { x: 2, y: 1.5, z: 4 },
			max: { x: 6, y: 4.5, z: 9 }
		});
	});
});
