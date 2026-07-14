import type { RoomCandidate } from './types';

type OverlayObject = {
	userData?: { roomCandidateId?: unknown };
	parent?: OverlayObject | null;
};

export function resolveRoomCandidateId(object: OverlayObject | null | undefined) {
	let current = object;
	while (current) {
		const id = current.userData?.roomCandidateId;
		if (typeof id === 'string') return id;
		current = current.parent;
	}
	return null;
}

export function resolveRoomCandidateSelection(candidates: RoomCandidate[], selectedId: string | null) {
	if (selectedId && candidates.some((candidate) => candidate.id === selectedId)) return selectedId;
	return candidates[0]?.id ?? null;
}

export function getRoomCandidateBounds(candidate: RoomCandidate) {
	const points = candidate.planPolygon;
	const xs = points.map((point) => point.x);
	const zs = points.map((point) => point.z);
	return {
		min: { x: Math.min(...xs), y: candidate.lowerElevation, z: Math.min(...zs) },
		max: { x: Math.max(...xs), y: candidate.upperElevation, z: Math.max(...zs) }
	};
}
