import type { Vec3 } from './geometry';

export type RoomListSource = {
	id: string;
	center: Vec3;
	footprint: Array<{ x: number; z: number }>;
	heightM: number;
	wallFaceIds: string[];
};

export type RoomListItem = RoomListSource & { displayName: string; ordinal: number };
export type RoomInteractionState = { hoveredRoomId: string | null; selectedRoomId: string | null };
export type RoomInteractionAction = { type: 'hover' | 'select'; roomId: string } | { type: 'leave' | 'clear-selection' };

export function createRoomList<T extends RoomListSource>(rooms: T[]): Array<T & { displayName: string; ordinal: number }> {
	return [...rooms]
		.sort((left, right) => left.center.y - right.center.y || left.center.x - right.center.x || left.center.z - right.center.z || left.id.localeCompare(right.id))
		.map((room, index) => ({ ...room, displayName: `Ruang ${index + 1}`, ordinal: index + 1 }));
}

export function reduceRoomInteraction(state: RoomInteractionState, action: RoomInteractionAction): RoomInteractionState {
	if (action.type === 'hover') return { ...state, hoveredRoomId: action.roomId };
	if (action.type === 'leave') return { ...state, hoveredRoomId: null };
	if (action.type === 'select') return { ...state, selectedRoomId: state.selectedRoomId === action.roomId ? null : action.roomId };
	return { ...state, selectedRoomId: null };
}

export function createRoomVisualization(room: RoomListSource) {
	const validHeight = Number.isFinite(room.heightM) && room.heightM > 0.2;
	return {
		roomId: room.id,
		footprint: room.footprint,
		volume: validHeight ? { baseY: room.center.y - room.heightM / 2, heightM: room.heightM, footprint: room.footprint } : null,
		boundaryEdgeIds: room.footprint.map((_, index) => `room:${room.id}:edge:${index}`),
		boundaryWallIds: [...room.wallFaceIds],
		warning: validHeight ? null : 'Room height is invalid or uncertain; volume overlay omitted.'
	};
}
