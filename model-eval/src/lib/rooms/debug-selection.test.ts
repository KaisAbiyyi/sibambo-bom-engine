import { describe, expect, test } from 'bun:test';
import {
	getRoomCandidateBounds,
	getPrismSideVertexCount,
	getVisibleRoomCandidates,
	resolveRoomCandidateId,
	resolveRoomCandidateSelection,
	type RoomDebugVisibility
} from './debug-selection';
import type { RoomCandidate } from './types';

const candidate = (id: string, polygon = [{ x: 2, z: 4 }, { x: 6, z: 4 }, { x: 6, z: 9 }]) =>
	({ id, status: 'primary', planPolygon: polygon, lowerElevation: 1.5, upperElevation: 4.5 }) as RoomCandidate;

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

	test('filters candidates by primary and secondary visibility without mutation', () => {
		const candidates = [candidate('room:primary') as RoomCandidate, { ...candidate('room:secondary'), status: 'secondary' } as RoomCandidate];
		const before = JSON.stringify(candidates);
		const visibility: RoomDebugVisibility = { primary: false, secondary: true, plan: true, prism: true, labels: true };

		expect(getVisibleRoomCandidates(candidates, visibility).map((item) => item.id)).toEqual(['room:secondary']);
		expect(JSON.stringify(candidates)).toBe(before);
	});

	test('selects first visible candidate after selected candidate becomes hidden', () => {
		const candidates = [candidate('room:primary'), { ...candidate('room:secondary'), status: 'secondary' } as RoomCandidate];
		const visibility: RoomDebugVisibility = { primary: false, secondary: true, plan: true, prism: true, labels: true };

		expect(resolveRoomCandidateSelection(getVisibleRoomCandidates(candidates, visibility), 'room:primary')).toBe('room:secondary');
	});

	test('clears selection when all candidates are hidden and restores candidates when re-enabled', () => {
		const candidates = [candidate('room:primary'), { ...candidate('room:secondary'), status: 'secondary' } as RoomCandidate];
		const hidden: RoomDebugVisibility = { primary: false, secondary: false, plan: true, prism: true, labels: true };
		const restored: RoomDebugVisibility = { ...hidden, primary: true, secondary: true };

		expect(resolveRoomCandidateSelection(getVisibleRoomCandidates(candidates, hidden), 'room:primary')).toBeNull();
		expect(getVisibleRoomCandidates(candidates, restored).map((item) => item.id)).toEqual(['room:primary', 'room:secondary']);
	});

	test('creates two triangles for every polygon prism side', () => {
		expect(getPrismSideVertexCount(candidate('room:one').planPolygon)).toBe(18);
	});
});
