import type { Bounds3, Vec3 } from './geometry';

export type WallSurfaceCandidate = {
	id: string;
	sourceNodeId: string;
	meshId: string;
	faceIds: string[];
	parentHierarchyId: string;
	connectedComponentId: string;
	materialIds: number[];
	normal: Vec3;
	centroid: Vec3;
	bounds: Bounds3;
	areaM2: number;
	storey: number;
	semanticRole: 'wall' | 'opening-frame' | 'opening-glass' | 'decorative';
};

export type WallOpeningReference = { id: string; bounds: Bounds3; areaM2: number };

export type LogicalWall = {
	id: string;
	displayName: string;
	sourceNodeIds: string[];
	meshIds: string[];
	faceIds: string[];
	exteriorFaceIds: string[];
	interiorFaceIds: string[];
	sideFaceIds: string[];
	roomIds: string[];
	openingIds: string[];
	centerPlane: { normal: Vec3; constant: number };
	bounds: Bounds3;
	length: number;
	height: number;
	thickness?: number;
	grossArea: number;
	openingArea: number;
	netArea: number;
	orientation: string;
	groupingEvidence: {
		surfaceGroupIds: string[];
		paired: boolean;
		storey: number;
		planeDistanceM?: number;
	};
};

type SurfaceGroup = {
	id: string;
	members: WallSurfaceCandidate[];
	normal: Vec3;
	centroid: Vec3;
	bounds: Bounds3;
	areaM2: number;
	storey: number;
	parentHierarchyId: string;
};

export type LogicalWallDiagnostics = {
	rawWallFaceCount: number;
	wallSurfaceGroupCount: number;
	pairedWallGroupCount: number;
	finalLogicalWallCount: number;
	unpairedWallSurfaceCount: number;
	wallsWithAssociatedOpenings: number;
};

const ANGLE_DOT = Math.cos(10 * Math.PI / 180);
const COPLANAR_M = 0.025;
const CONNECT_GAP_M = 0.08;
const MIN_THICKNESS_M = 0.03;
const MAX_THICKNESS_M = 0.6;

export function reconstructLogicalWalls(candidates: WallSurfaceCandidate[], openings: WallOpeningReference[] = []) {
	const eligible = candidates.filter((candidate) => candidate.semanticRole === 'wall');
	const groups = groupCoplanarSurfaces(eligible);
	const used = new Set<number>();
	const walls: LogicalWall[] = [];
	let pairCount = 0;

	for (let index = 0; index < groups.length; index += 1) {
		if (used.has(index)) continue;
		const group = groups[index];
		let best: { index: number; distance: number; overlap: number } | null = null;
		for (let otherIndex = index + 1; otherIndex < groups.length; otherIndex += 1) {
			if (used.has(otherIndex)) continue;
			const other = groups[otherIndex];
			if (group.storey !== other.storey || dot(group.normal, other.normal) > -ANGLE_DOT) continue;
			const distance = Math.abs(dot(subtract(other.centroid, group.centroid), group.normal));
			if (distance < MIN_THICKNESS_M || distance > MAX_THICKNESS_M) continue;
			const overlap = projectedOverlapRatio(group, other);
			if (overlap < 0.45) continue;
			if (!best || overlap > best.overlap || (overlap === best.overlap && distance < best.distance)) best = { index: otherIndex, distance, overlap };
		}
		used.add(index);
		const paired = best ? groups[best.index] : null;
		if (paired && best) { used.add(best.index); pairCount += 1; }
		walls.push(makeWall(walls.length, group, paired, best?.distance, openings));
	}
	attachWallSideFaces(walls, candidates.filter((candidate) => candidate.semanticRole === 'decorative'));

	const diagnostics: LogicalWallDiagnostics = {
		rawWallFaceCount: eligible.reduce((sum, candidate) => sum + candidate.faceIds.length, 0),
		wallSurfaceGroupCount: groups.length,
		pairedWallGroupCount: pairCount,
		finalLogicalWallCount: walls.length,
		unpairedWallSurfaceCount: groups.length - pairCount * 2,
		wallsWithAssociatedOpenings: walls.filter((wall) => wall.openingIds.length > 0).length
	};
	return { walls, diagnostics };
}

function attachWallSideFaces(walls: LogicalWall[], candidates: WallSurfaceCandidate[]) {
	for (const candidate of candidates) {
		const wall = walls
			.filter((item) => item.groupingEvidence.storey === candidate.storey && item.sourceNodeIds.includes(candidate.sourceNodeId))
			.map((item) => ({ item, gap: boundsGap(item.bounds, candidate.bounds) }))
			.filter((entry) => entry.gap <= CONNECT_GAP_M)
			.sort((left, right) => left.gap - right.gap || left.item.id.localeCompare(right.item.id))[0]?.item;
		if (!wall) continue;
		wall.sideFaceIds = unique([...wall.sideFaceIds, ...candidate.faceIds]);
		wall.faceIds = unique([...wall.faceIds, ...candidate.faceIds]);
		wall.sourceNodeIds = unique([...wall.sourceNodeIds, candidate.sourceNodeId]);
		wall.meshIds = unique([...wall.meshIds, candidate.meshId]);
	}
}

function groupCoplanarSurfaces(candidates: WallSurfaceCandidate[]) {
	const parent = candidates.map((_, index) => index);
	const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
	const union = (left: number, right: number) => { left = find(left); right = find(right); if (left !== right) parent[right] = left; };
	for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) {
		const a = candidates[left]; const b = candidates[right];
		if (a.storey !== b.storey || a.parentHierarchyId !== b.parentHierarchyId || dot(a.normal, b.normal) < ANGLE_DOT) continue;
		if (Math.abs(dot(subtract(b.centroid, a.centroid), a.normal)) > COPLANAR_M) continue;
		if (!boundsTouchOnWall(a.bounds, b.bounds, a.normal)) continue;
		union(left, right);
	}
	const grouped = new Map<number, WallSurfaceCandidate[]>();
	candidates.forEach((candidate, index) => grouped.set(find(index), [...(grouped.get(find(index)) || []), candidate]));
	return [...grouped.values()].map((members, index): SurfaceGroup => {
		const areaM2 = members.reduce((sum, member) => sum + member.areaM2, 0);
		const bounds = combineBounds(members.map((member) => member.bounds));
		return {
			id: `surface-group:${index}:${stableHash(members.map((member) => member.id).sort().join('|'))}`,
			members,
			normal: normalize(members.reduce((sum, member) => add(sum, scale(member.normal, member.areaM2)), { x: 0, y: 0, z: 0 })),
			centroid: areaM2 ? scale(members.reduce((sum, member) => add(sum, scale(member.centroid, member.areaM2)), { x: 0, y: 0, z: 0 }), 1 / areaM2) : bounds.center,
			bounds,
			areaM2,
			storey: members[0].storey,
			parentHierarchyId: members[0].parentHierarchyId
		};
	}).sort((a, b) => a.storey - b.storey || a.id.localeCompare(b.id));
}

function makeWall(index: number, front: SurfaceGroup, back: SurfaceGroup | null, thickness: number | undefined, openings: WallOpeningReference[]): LogicalWall {
	const groups = back ? [front, back] : [front];
	const members = groups.flatMap((group) => group.members);
	const bounds = combineBounds(groups.map((group) => group.bounds));
	const normal = normalize(front.normal);
	const center = back ? scale(add(front.centroid, back.centroid), 0.5) : front.centroid;
	const relevantOpenings = openings.filter((opening) => wallOpeningOverlap(bounds, normal, center, opening.bounds));
	const grossArea = groups.length === 2 ? Math.max(front.areaM2, back!.areaM2) : front.areaM2;
	const openingArea = Math.min(grossArea, relevantOpenings.reduce((sum, opening) => sum + opening.areaM2, 0));
	const horizontalLength = Math.abs(normal.x) >= Math.abs(normal.z) ? bounds.size.z : bounds.size.x;
	return {
		id: `component:wall:${stableHash(groups.map((group) => group.id).sort().join('|'))}`,
		displayName: `Wall ${String(index + 1).padStart(2, '0')}`,
		sourceNodeIds: unique(members.map((member) => member.sourceNodeId)),
		meshIds: unique(members.map((member) => member.meshId)),
		faceIds: unique(members.flatMap((member) => member.faceIds)),
		exteriorFaceIds: unique(front.members.flatMap((member) => member.faceIds)),
		interiorFaceIds: unique(back?.members.flatMap((member) => member.faceIds) || []),
		sideFaceIds: [],
		roomIds: [],
		openingIds: relevantOpenings.map((opening) => opening.id).sort(),
		centerPlane: { normal, constant: -dot(normal, center) },
		bounds,
		length: horizontalLength,
		height: bounds.size.y,
		thickness,
		grossArea,
		openingArea,
		netArea: Math.max(0, grossArea - openingArea),
		orientation: Math.abs(normal.x) >= Math.abs(normal.z) ? (normal.x >= 0 ? 'east-west' : 'west-east') : (normal.z >= 0 ? 'north-south' : 'south-north'),
		groupingEvidence: { surfaceGroupIds: groups.map((group) => group.id), paired: Boolean(back), storey: front.storey, planeDistanceM: thickness }
	};
}

function boundsTouchOnWall(a: Bounds3, b: Bounds3, normal: Vec3) {
	const vertical = intervalGap(a.min.y, a.max.y, b.min.y, b.max.y) <= CONNECT_GAP_M;
	const horizontal = Math.abs(normal.x) >= Math.abs(normal.z)
		? intervalGap(a.min.z, a.max.z, b.min.z, b.max.z) <= CONNECT_GAP_M
		: intervalGap(a.min.x, a.max.x, b.min.x, b.max.x) <= CONNECT_GAP_M;
	return vertical && horizontal;
}

function projectedOverlapRatio(a: SurfaceGroup, b: SurfaceGroup) {
	const horizontalA: [number, number] = Math.abs(a.normal.x) >= Math.abs(a.normal.z) ? [a.bounds.min.z, a.bounds.max.z] : [a.bounds.min.x, a.bounds.max.x];
	const horizontalB: [number, number] = Math.abs(a.normal.x) >= Math.abs(a.normal.z) ? [b.bounds.min.z, b.bounds.max.z] : [b.bounds.min.x, b.bounds.max.x];
	const widthOverlap = intervalOverlap(horizontalA[0], horizontalA[1], horizontalB[0], horizontalB[1]);
	const heightOverlap = intervalOverlap(a.bounds.min.y, a.bounds.max.y, b.bounds.min.y, b.bounds.max.y);
	const reference = Math.max(0.001, Math.min((horizontalA[1] - horizontalA[0]) * a.bounds.size.y, (horizontalB[1] - horizontalB[0]) * b.bounds.size.y));
	return widthOverlap * heightOverlap / reference;
}

function wallOpeningOverlap(wall: Bounds3, normal: Vec3, center: Vec3, opening: Bounds3) {
	const distance = Math.abs(dot(subtract(opening.center, center), normal));
	const halfThickness = (Math.abs(normal.x) * wall.size.x + Math.abs(normal.z) * wall.size.z) / 2;
	if (distance > Math.max(0.35, halfThickness + 0.2)) return false;
	const horizontal = Math.abs(normal.x) >= Math.abs(normal.z)
		? intervalOverlap(wall.min.z, wall.max.z, opening.min.z, opening.max.z)
		: intervalOverlap(wall.min.x, wall.max.x, opening.min.x, opening.max.x);
	return horizontal > 0.05 && intervalOverlap(wall.min.y, wall.max.y, opening.min.y, opening.max.y) > 0.05;
}

function combineBounds(items: Bounds3[]): Bounds3 {
	const min = { x: Infinity, y: Infinity, z: Infinity }; const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	for (const bounds of items) { min.x = Math.min(min.x, bounds.min.x); min.y = Math.min(min.y, bounds.min.y); min.z = Math.min(min.z, bounds.min.z); max.x = Math.max(max.x, bounds.max.x); max.y = Math.max(max.y, bounds.max.y); max.z = Math.max(max.z, bounds.max.z); }
	const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
	return { min, max, size, center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 } };
}
function intervalGap(a0: number, a1: number, b0: number, b1: number) { return Math.max(0, Math.max(a0, b0) - Math.min(a1, b1)); }
function boundsGap(a: Bounds3, b: Bounds3) { return Math.hypot(intervalGap(a.min.x, a.max.x, b.min.x, b.max.x), intervalGap(a.min.y, a.max.y, b.min.y, b.max.y), intervalGap(a.min.z, a.max.z, b.min.z, b.max.z)); }
function intervalOverlap(a0: number, a1: number, b0: number, b1: number) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }
function unique(values: string[]) { return [...new Set(values)].sort(); }
function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(a: Vec3, value: number): Vec3 { return { x: a.x * value, y: a.y * value, z: a.z * value }; }
function dot(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normalize(a: Vec3): Vec3 { const length = Math.hypot(a.x, a.y, a.z) || 1; return scale(a, 1 / length); }
function stableHash(value: string) { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(36); }
