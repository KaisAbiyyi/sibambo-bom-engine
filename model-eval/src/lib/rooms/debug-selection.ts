import type { PlanCoord, RoomCandidate } from './types';

export type RoomDebugVisibility = {
	primary: boolean;
	secondary: boolean;
	plan: boolean;
	prism: boolean;
	labels: boolean;
};

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

export function getVisibleRoomCandidates(candidates: RoomCandidate[], visibility: RoomDebugVisibility) {
	return candidates.filter((candidate) => {
		if (candidate.status === 'primary') return visibility.primary;
		if (candidate.status === 'secondary') return visibility.secondary;
		return true;
	});
}

export function getPrismSideVertexCount(polygon: PlanCoord[]) {
	return polygon.length * 6;
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
