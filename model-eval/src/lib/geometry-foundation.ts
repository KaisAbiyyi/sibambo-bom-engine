export type GeometryPoint = { x: number; y: number; z: number };

export type GeometryFaceInput = {
	id: string;
	vertices: GeometryPoint[];
	areaM2: number;
	surfaceHint?: string;
	name?: string;
};

export type GeometryOrientation = 'horizontal' | 'vertical' | 'sloped';
export type GeometryRole = 'wall' | 'floor' | 'ceiling' | 'other';
export type RoomDetectionState =
	| 'valid'
	| 'incomplete boundary'
	| 'open geometry'
	| 'insufficient surfaces'
	| 'invalid scale';

export type GeometryBounds = {
	min: GeometryPoint;
	max: GeometryPoint;
	size: GeometryPoint;
	center: GeometryPoint;
};

export type GeometryFaceAnalysis = GeometryFaceInput & {
	normal: GeometryPoint;
	orientation: GeometryOrientation;
	centroid: GeometryPoint;
	bounds: GeometryBounds;
	role: GeometryRole;
};

export type GeometryRoom = {
	id: string;
	floorFaceId: string;
	ceilingFaceId: string;
	footprint: Array<{ x: number; z: number }>;
	areaM2: number;
	heightM: number;
	volumeM3: number;
	boundaryCoverage: number;
	center: GeometryPoint;
};

export type GeometryFoundationResult = {
	faces: GeometryFaceAnalysis[];
	rooms: GeometryRoom[];
	roomDetection: {
		state: RoomDetectionState;
		reason: string;
	};
	bounds: GeometryBounds;
	geometryScaleM: number;
};

export type FoundationPartKey =
	| 'roof'
	| 'walls'
	| 'floor'
	| 'ceiling'
	| 'doors'
	| 'windows'
	| 'openings'
	| 'structure'
	| 'foundation'
	| 'furniture'
	| 'other';

export type FinalPartAssignment = {
	id: string;
	partKey: Exclude<FoundationPartKey, 'other'> | null;
	areaM2: number;
};

export function analyzeGeometryFoundation(input: GeometryFaceInput[]): GeometryFoundationResult {
	const faces = input.map(measureFace);
	const bounds = combineBounds(faces.map((face) => face.bounds));
	const geometryScaleM = Math.hypot(bounds.size.x, bounds.size.y, bounds.size.z);
	const tolerance = scaleTolerance(geometryScaleM);

	for (const face of faces) {
		const hint = normalize(`${face.surfaceHint || ''} ${face.name || ''}`);
		const opening = /door|window|opening|pintu|jendela|bukaan|glass|kaca|glazing|translucent/.test(hint);
		const nonEnvelope = /roof|atap|foundation|fondasi|pondasi|structure|struktur|column|kolom|beam|balok|furniture|furnitur/.test(hint);
		const planSpan = Math.max(face.bounds.size.x, face.bounds.size.z);
		if (
			face.orientation === 'vertical' &&
			!opening &&
			!nonEnvelope &&
			face.bounds.size.y >= Math.max(1.5, geometryScaleM * 0.015) &&
			planSpan >= Math.max(0.4, tolerance * 4) &&
			face.areaM2 >= 0.35
		) {
			face.role = 'wall';
		}
	}

	const walls = faces.filter((face) => face.role === 'wall');
	for (const face of faces) {
		if (face.orientation !== 'horizontal' || face.areaM2 <= 0 || face.role === 'wall') continue;
		const relatedWalls = walls.filter((wall) => planBoundaryAdjacency(face.bounds, wall.bounds, tolerance));
		const atWallBase = relatedWalls.some((wall) => Math.abs(wall.bounds.min.y - face.centroid.y) <= tolerance);
		const atWallTop = relatedWalls.some((wall) => Math.abs(wall.bounds.max.y - face.centroid.y) <= tolerance);
		const hint = normalize(face.surfaceHint || '');
		const semanticText = normalize(face.name || '');
		if (/roof|atap|foundation|fondasi|pondasi|structure|struktur|furniture|furnitur/.test(semanticText)) continue;

		if (atWallBase && !atWallTop) face.role = 'floor';
		else if (atWallTop && !atWallBase) face.role = 'ceiling';
		else if (atWallBase && atWallTop && face.normal.y >= 0.7) face.role = 'floor';
		else if (atWallBase && atWallTop && face.normal.y <= -0.7) face.role = 'ceiling';
		else if (/ceiling|plafon|gypsum|langit/.test(semanticText)) face.role = 'ceiling';
		else if (/floor|lantai|keramik|ubin|tile|parket/.test(semanticText)) face.role = 'floor';
		else if (face.normal.y >= 0.7) face.role = 'floor';
		else if (face.normal.y <= -0.7) face.role = 'ceiling';
		else if (hint.includes('ceiling')) face.role = 'ceiling';
		else if (hint.includes('floor')) face.role = 'floor';
	}

	if (!Number.isFinite(geometryScaleM) || geometryScaleM < 0.1 || geometryScaleM > 10_000) {
		return result(faces, [], bounds, geometryScaleM, 'invalid scale', 'Geometry scale outside supported metre range.');
	}

	const floors = deduplicateHorizontalFaces(
		faces.filter((face) => face.role === 'floor' && face.areaM2 >= 1 && Math.min(face.bounds.size.x, face.bounds.size.z) >= 1),
		tolerance
	);
	if (!floors.length || !walls.length) {
		return result(
			faces,
			[],
			bounds,
			geometryScaleM,
			'insufficient surfaces',
			!floors.length ? 'No usable floor boundary was detected.' : 'No meaningful wall boundary was detected.'
		);
	}

	const rooms: GeometryRoom[] = [];
	let bestCoverage = 0;
	let missingCeiling = false;
	for (const floor of floors) {
		const boundaryWalls = walls.filter(
			(wall) =>
				wall.bounds.min.y <= floor.centroid.y + tolerance &&
				wall.bounds.max.y >= floor.centroid.y + 1.5 &&
				planBoundaryAdjacency(floor.bounds, wall.bounds, tolerance)
		);
		const coverage = rectangularBoundaryCoverage(floor.bounds, boundaryWalls, tolerance);
		bestCoverage = Math.max(bestCoverage, coverage);
		if (coverage < 0.9) continue;

		const ceiling = faces
			.filter((face) => face.role === 'ceiling')
			.map((face) => ({
				face,
				height: face.centroid.y - floor.centroid.y,
				overlap: planOverlapArea(face.bounds, floor.bounds) / Math.max(planArea(floor.bounds), 0.001)
			}))
			.filter((candidate) => candidate.height >= 1.8 && candidate.height <= 8 && candidate.overlap >= 0.6)
			.sort((left, right) => right.overlap - left.overlap || left.height - right.height)[0];
		if (!ceiling) {
			missingCeiling = true;
			continue;
		}

		const areaM2 = polygonAreaXZ(floor.vertices) || floor.areaM2;
		if (areaM2 <= 0 || ceiling.height <= 0) continue;
		rooms.push({
			id: stableRoomId(floor, rooms.length),
			floorFaceId: floor.id,
			ceilingFaceId: ceiling.face.id,
			footprint: floor.vertices.map((point) => ({ x: point.x, z: point.z })),
			areaM2,
			heightM: ceiling.height,
			volumeM3: areaM2 * ceiling.height,
			boundaryCoverage: coverage,
			center: { x: floor.centroid.x, y: floor.centroid.y + ceiling.height / 2, z: floor.centroid.z }
		});
	}

	if (rooms.length) return result(faces, rooms, bounds, geometryScaleM, 'valid', `${rooms.length} enclosed room boundary detected.`);
	if (missingCeiling || bestCoverage >= 0.82) {
		return result(faces, [], bounds, geometryScaleM, 'incomplete boundary', missingCeiling ? 'Wall boundary found but matching ceiling boundary is incomplete.' : 'Room boundary is nearly enclosed but below closure tolerance.');
	}
	return result(faces, [], bounds, geometryScaleM, 'open geometry', `Wall boundary coverage ${Math.round(bestCoverage * 100)}% is below closure tolerance.`);
}

export function finalizePartAssignments(items: FinalPartAssignment[]) {
	const ids = new Set<string>();
	const assignments = new Map<FoundationPartKey, string[]>();
	const accumulator = new Map<FoundationPartKey, { count: number; areaM2: number }>();
	for (const item of items) {
		if (ids.has(item.id)) throw new Error(`Duplicate component ID: ${item.id}`);
		ids.add(item.id);
		const key: FoundationPartKey = item.partKey || 'other';
		assignments.set(key, [...(assignments.get(key) || []), item.id]);
		const current = accumulator.get(key) || { count: 0, areaM2: 0 };
		current.count += 1;
		current.areaM2 += Math.max(Number.isFinite(item.areaM2) ? item.areaM2 : 0, 0);
		accumulator.set(key, current);
	}
	return {
		assignments,
		stats: [...accumulator.entries()].map(([key, value]) => ({ key, ...value }))
	};
}

function measureFace(face: GeometryFaceInput): GeometryFaceAnalysis {
	const bounds = boundsFromPoints(face.vertices);
	const normal = polygonNormal(face.vertices);
	const absY = Math.abs(normal.y);
	const orientation: GeometryOrientation = absY >= Math.cos(Math.PI / 12) || bounds.size.y <= 0.01
		? 'horizontal'
		: absY <= Math.sin(Math.PI / 12)
			? 'vertical'
			: 'sloped';
	return {
		...face,
		normal,
		orientation,
		centroid: average(face.vertices),
		bounds,
		role: 'other'
	};
}

function polygonNormal(points: GeometryPoint[]): GeometryPoint {
	let x = 0;
	let y = 0;
	let z = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		x += (current.y - next.y) * (current.z + next.z);
		y += (current.z - next.z) * (current.x + next.x);
		z += (current.x - next.x) * (current.y + next.y);
	}
	const length = Math.hypot(x, y, z);
	return length > 1e-12 ? { x: x / length, y: y / length, z: z / length } : { x: 0, y: 0, z: 0 };
}

function boundsFromPoints(points: GeometryPoint[]): GeometryBounds {
	if (!points.length) return emptyBounds();
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	for (const point of points) {
		min.x = Math.min(min.x, point.x); min.y = Math.min(min.y, point.y); min.z = Math.min(min.z, point.z);
		max.x = Math.max(max.x, point.x); max.y = Math.max(max.y, point.y); max.z = Math.max(max.z, point.z);
	}
	return finishBounds(min, max);
}

function combineBounds(bounds: GeometryBounds[]): GeometryBounds {
	if (!bounds.length) return emptyBounds();
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	for (const value of bounds) {
		min.x = Math.min(min.x, value.min.x); min.y = Math.min(min.y, value.min.y); min.z = Math.min(min.z, value.min.z);
		max.x = Math.max(max.x, value.max.x); max.y = Math.max(max.y, value.max.y); max.z = Math.max(max.z, value.max.z);
	}
	return finishBounds(min, max);
}

function finishBounds(min: GeometryPoint, max: GeometryPoint): GeometryBounds {
	const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
	return { min, max, size, center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 } };
}

function emptyBounds(): GeometryBounds {
	return finishBounds({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
}

function average(points: GeometryPoint[]): GeometryPoint {
	if (!points.length) return { x: 0, y: 0, z: 0 };
	const sum = points.reduce((value, point) => ({ x: value.x + point.x, y: value.y + point.y, z: value.z + point.z }), { x: 0, y: 0, z: 0 });
	return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

function planBoundaryAdjacency(surface: GeometryBounds, wall: GeometryBounds, tolerance: number) {
	const xEdge = Math.min(Math.abs(wall.center.x - surface.min.x), Math.abs(wall.center.x - surface.max.x));
	const zEdge = Math.min(Math.abs(wall.center.z - surface.min.z), Math.abs(wall.center.z - surface.max.z));
	const xOverlap = intervalOverlap(surface.min.x, surface.max.x, wall.min.x, wall.max.x);
	const zOverlap = intervalOverlap(surface.min.z, surface.max.z, wall.min.z, wall.max.z);
	return (xEdge <= tolerance && zOverlap >= Math.min(surface.size.z, wall.size.z) * 0.1) ||
		(zEdge <= tolerance && xOverlap >= Math.min(surface.size.x, wall.size.x) * 0.1);
}

function rectangularBoundaryCoverage(surface: GeometryBounds, walls: GeometryFaceAnalysis[], tolerance: number) {
	const sides = [
		{ axis: 'z' as const, plane: surface.min.x, min: surface.min.z, max: surface.max.z },
		{ axis: 'z' as const, plane: surface.max.x, min: surface.min.z, max: surface.max.z },
		{ axis: 'x' as const, plane: surface.min.z, min: surface.min.x, max: surface.max.x },
		{ axis: 'x' as const, plane: surface.max.z, min: surface.min.x, max: surface.max.x }
	];
	let covered = 0;
	let perimeter = 0;
	for (const side of sides) {
		perimeter += side.max - side.min;
		const intervals: Array<[number, number]> = [];
		for (const wall of walls) {
			const wallPlane = side.axis === 'z' ? wall.centroid.x : wall.centroid.z;
			if (Math.abs(wallPlane - side.plane) > tolerance) continue;
			const min = side.axis === 'z' ? wall.bounds.min.z : wall.bounds.min.x;
			const max = side.axis === 'z' ? wall.bounds.max.z : wall.bounds.max.x;
			const start = Math.max(min, side.min);
			const end = Math.min(max, side.max);
			if (end > start) intervals.push([start, end]);
		}
		covered += unionLength(intervals);
	}
	return perimeter > 0 ? Math.min(covered / perimeter, 1) : 0;
}

function unionLength(intervals: Array<[number, number]>) {
	if (!intervals.length) return 0;
	const sorted = intervals.sort((left, right) => left[0] - right[0]);
	let total = 0;
	let [start, end] = sorted[0];
	for (const [nextStart, nextEnd] of sorted.slice(1)) {
		if (nextStart <= end) end = Math.max(end, nextEnd);
		else { total += end - start; start = nextStart; end = nextEnd; }
	}
	return total + end - start;
}

function deduplicateHorizontalFaces(faces: GeometryFaceAnalysis[], tolerance: number) {
	const result: GeometryFaceAnalysis[] = [];
	for (const face of [...faces].sort((left, right) => right.areaM2 - left.areaM2 || left.id.localeCompare(right.id))) {
		if (result.some((existing) =>
			Math.abs(existing.centroid.y - face.centroid.y) <= tolerance &&
			Math.abs(existing.areaM2 - face.areaM2) / Math.max(existing.areaM2, face.areaM2, 0.001) <= 0.15 &&
			planOverlapArea(existing.bounds, face.bounds) / Math.max(Math.min(planArea(existing.bounds), planArea(face.bounds)), 0.001) >= 0.92
		)) continue;
		result.push(face);
	}
	return result;
}

function polygonAreaXZ(points: GeometryPoint[]) {
	let area = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		area += current.x * next.z - next.x * current.z;
	}
	return Math.abs(area) / 2;
}

function planArea(bounds: GeometryBounds) {
	return Math.max(bounds.size.x * bounds.size.z, 0);
}

function planOverlapArea(left: GeometryBounds, right: GeometryBounds) {
	return intervalOverlap(left.min.x, left.max.x, right.min.x, right.max.x) * intervalOverlap(left.min.z, left.max.z, right.min.z, right.max.z);
}

function intervalOverlap(minA: number, maxA: number, minB: number, maxB: number) {
	return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function scaleTolerance(scale: number) {
	return Math.min(Math.max(scale * 0.004, 0.08), 0.45);
}

function stableRoomId(floor: GeometryFaceAnalysis, index: number) {
	const point = floor.bounds.min;
	return `room:${Math.round(point.x * 1000)}:${Math.round(floor.centroid.y * 1000)}:${Math.round(point.z * 1000)}:${index + 1}`;
}

function normalize(value: string) {
	return value.toLowerCase().replace(/[_-]+/g, ' ');
}

function result(
	faces: GeometryFaceAnalysis[],
	rooms: GeometryRoom[],
	bounds: GeometryBounds,
	geometryScaleM: number,
	state: RoomDetectionState,
	reason: string
): GeometryFoundationResult {
	return { faces, rooms, roomDetection: { state, reason }, bounds, geometryScaleM };
}
