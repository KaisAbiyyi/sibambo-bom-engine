import {
	createGeometryFoundation,
	type Bounds3,
	type LogicalObjectRecord,
	type RuntimeScene,
	type SurfaceClusterRecord,
	type Vec3
} from './geometry';
import { buildGeometryRegistry, diagnoseRenderCoverage, type GeometryIngestionDiagnostics } from './geometry-registry';
import { reconstructLogicalWalls, type LogicalWallDiagnostics, type WallSurfaceCandidate } from './logical-walls';
import { buildRuntimeGeometryGroups } from './render/build-runtime-scene';

export type SmboostFixtureId = 'smboost-model-1' | 'smboost-model-2';
export type OpeningKind = 'door' | 'window' | 'unresolved_opening' | 'rejected';

export const SMBOOST_FIXTURE_EXPECTATIONS = {
	'smboost-model-1': { rooms: 7, doors: 4, windows: 8 },
	'smboost-model-2': { rooms: 6, doors: 4, windows: 9 }
} as const;

export type RuntimeComponentBinding = {
	instancePath: string;
	sourceFaceIds: string[];
};

export type OpeningScores = {
	door: number;
	window: number;
	wallAssociation: number;
	floorContact: number;
	name: number;
	geometry: number;
	hierarchy: number;
};

export type OpeningComponent = {
	id: string;
	kind: OpeningKind;
	displayName: string;
	sourceName: string;
	hierarchyPath: string[];
	childMeshIds: string[];
	leafMeshIds: string[];
	frameMeshIds: string[];
	glassMeshIds: string[];
	trimMeshIds: string[];
	sourceFaceIds: string[];
	bounds: Bounds3;
	centroid: Vec3;
	dimensions: Vec3;
	faceCount: number;
	areaM2: number;
	dominantNormal: Vec3;
	nearestWallId: string | null;
	nearestWallDistanceM: number | null;
	nearestFloorId: string | null;
	floorGapM: number | null;
	wallOverlapRatio: number;
	scores: OpeningScores;
	classificationRule: string;
	rejectionReasons: string[];
	mergedFrom: string[];
	duplicateOf: string | null;
	bindings: RuntimeComponentBinding[];
};

export type InspectableWallComponent = {
	id: string;
	kind: 'wall';
	displayName: string;
	sourceName: string;
	hierarchyPath: string[];
	childMeshIds: string[];
	sourceFaceIds: string[];
	bounds: Bounds3;
	centroid: Vec3;
	dimensions: Vec3;
	faceCount: number;
	areaM2: number;
	dominantNormal: Vec3;
	classificationRule: string;
	rejectionReasons: string[];
	bindings: RuntimeComponentBinding[];
	exteriorFaceIds: string[];
	interiorFaceIds: string[];
	sideFaceIds: string[];
	roomIds: string[];
	openingIds: string[];
	centerPlane: { normal: Vec3; constant: number };
	length: number;
	height: number;
	thickness?: number;
	grossArea: number;
	openingArea: number;
	netArea: number;
	orientation: string;
	groupingEvidence: { surfaceGroupIds: string[]; paired: boolean; storey: number; planeDistanceM?: number };
};

export type SharedRoomBoundary = {
	otherCandidateId: string;
	gapM: number;
	overlapM: number;
	separatingWallIds: string[];
};

export type RoomMergeCandidate = {
	id: string;
	parentGroupId: string;
	floorFaceIds: string[];
	ceilingFaceIds: string[];
	wallFaceIds: string[];
	footprint: Array<{ x: number; z: number }>;
	areaM2: number;
	floorElevationM: number;
	ceilingElevationM: number;
	heightM: number;
	boundaryCoverage: number;
	sharedBoundaries: SharedRoomBoundary[];
	warnings: string[];
	sourceName?: string;
	hierarchyPath?: string[];
	childMeshIds?: string[];
	centroid?: Vec3;
	bounds?: Bounds3;
	mergeHistory?: string[];
	volumeM3?: number;
	state?: 'valid' | 'incomplete boundary' | 'open geometry';
	bindings?: RuntimeComponentBinding[];
	topologyEvaluated?: boolean;
};

export type SmboostAnalysisResult = {
	fixtureId: SmboostFixtureId;
	roomCandidates: RoomMergeCandidate[];
	rooms: Array<Required<Pick<RoomMergeCandidate, 'id' | 'floorFaceIds' | 'ceilingFaceIds' | 'wallFaceIds' | 'footprint' | 'areaM2' | 'heightM' | 'volumeM3' | 'boundaryCoverage' | 'mergeHistory' | 'warnings' | 'state'>> & { center: Vec3 }>;
	wallComponents: InspectableWallComponent[];
	openingCandidates: OpeningComponent[];
	openings: OpeningComponent[];
	duplicates: OpeningComponent[];
	validation: {
		expectedRoomCount: number;
		detectedRoomCount: number;
		expectedDoorCount: number;
		detectedDoorCount: number;
		expectedWindowCount: number;
		detectedWindowCount: number;
		unresolvedOpeningCount: number;
		duplicateOpeningCount: number;
		wallCount: number;
		individuallyAddressableWallCount: number;
		countsMatchExpected: boolean;
		warnings: string[];
		downstreamReady: boolean;
	};
	diagnostics: {
		geometryIngestion: GeometryIngestionDiagnostics;
		openings: {
			doorLogicalComponents: number;
			windowLogicalComponents: number;
			doorFrameMeshes: number;
			windowFrameMeshes: number;
			unresolvedOpeningMeshes: number;
			orphanedFrames: number;
			logicalComponentsWithMissingSourceMeshes: number;
		};
		walls: LogicalWallDiagnostics;
		rooms: {
			rawRoomCandidates: number;
			mergedRooms: number;
			finalRoomCount: number;
			footprintAreaM2: number;
			volumeM3: number;
			boundaryWallCount: number;
			roomsWithoutCeiling: number;
			roomsWithIncompleteBoundary: number;
		};
	};
};

export type OpeningEvidenceInput = {
	sourceName: string;
	hierarchyText: string;
	widthM: number;
	heightM: number;
	depthM: number;
	floorGapM: number;
	wallDistanceM: number;
	wallOverlapRatio: number;
	transparentAreaRatio: number;
};

export type HierarchyOpeningNode = {
	id: string;
	parentId: string | null;
	sourceName: string;
	meshId: string | null;
};

export function classifyOpeningCandidate(evidence: OpeningEvidenceInput): {
	kind: OpeningKind;
	scores: OpeningScores;
	rule: string;
	rejectionReasons: string[];
} {
	const text = normalize(`${evidence.sourceName} ${evidence.hierarchyText}`);
	const doorName = /\b(p\d{4,}|pintu|door)\b/.test(text);
	const windowName = /\b(j\d{4,}|jendela|window)\b/.test(text);
	const frameEvidence = /kusen|frame|daun|leaf|panel/.test(text);
	const glassEvidence = /kaca|glass|glaz/.test(text) || evidence.transparentAreaRatio >= 0.25;
	const furniture = /lemari|cabinet|furniture|furnitur|kitchen|wardrobe/.test(text);
	const wallAssociation = clamp01(1 - evidence.wallDistanceM / 0.35) * clamp01(evidence.wallOverlapRatio / 0.6);
	const floorContact = clamp01(1 - evidence.floorGapM / 0.2);
	const doorGeometry = evidence.widthM >= 0.55 && evidence.widthM <= 2.4 && evidence.heightM >= 1.75 && evidence.heightM <= 3.2 && evidence.depthM <= 0.6 ? 1 : 0;
	const windowGeometry = evidence.widthM >= 0.3 && evidence.widthM <= 5 && evidence.heightM >= 0.3 && evidence.heightM <= 2.8 && evidence.floorGapM >= 0.3 ? 1 : 0;
	const scores: OpeningScores = {
		door: clamp01(Number(doorName) * 0.45 + wallAssociation * 0.2 + floorContact * 0.15 + doorGeometry * 0.15 + Number(frameEvidence) * 0.05),
		window: clamp01(Number(windowName) * 0.4 + wallAssociation * 0.2 + Number(evidence.floorGapM >= 0.3) * 0.12 + windowGeometry * 0.13 + Number(glassEvidence) * 0.1 + Number(frameEvidence) * 0.05),
		wallAssociation,
		floorContact,
		name: doorName || windowName ? 1 : 0,
		geometry: Math.max(doorGeometry, windowGeometry),
		hierarchy: frameEvidence || glassEvidence ? 1 : 0
	};
	const rejectionReasons: string[] = [];
	if (wallAssociation < 0.25) rejectionReasons.push('no-wall-association');
	if (furniture) rejectionReasons.push('furniture-hierarchy');
	if (furniture || wallAssociation < 0.25) return { kind: 'rejected', scores, rule: 'reject:context', rejectionReasons };
	if (scores.door >= 0.72 && scores.door >= scores.window + 0.08) return { kind: 'door', scores, rule: 'door:wall-floor-name', rejectionReasons };
	if (scores.window >= 0.68 && scores.window >= scores.door + 0.05) return { kind: 'window', scores, rule: 'window:wall-sill-frame', rejectionReasons };
	return { kind: 'unresolved_opening', scores, rule: 'opening:ambiguous', rejectionReasons: [...rejectionReasons, 'ambiguous-door-window-evidence'] };
}

export function groupOpeningAssemblies(nodes: HierarchyOpeningNode[]) {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const children = new Map<string, HierarchyOpeningNode[]>();
	for (const node of nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) || []), node]);
	const strong = (name: string) => /\b(?:p\d{4,}|j\d{4,}|pintu|door|jendela|window)\b/i.test(name.replace(/[_-]+/g, ' '));
	const roots = nodes.filter((node) => strong(node.sourceName) && !ancestor(node, byId, (item) => strong(item.sourceName)));
	return roots.map((root) => {
		const descendants: HierarchyOpeningNode[] = [];
		const visit = (id: string) => {
			for (const child of children.get(id) || []) { descendants.push(child); visit(child.id); }
		};
		visit(root.id);
		return {
			id: root.id,
			sourceName: root.sourceName,
			hierarchyNodeIds: [root.id, ...descendants.map((item) => item.id)],
			childMeshIds: [...new Set(descendants.map((item) => item.meshId).filter((id): id is string => Boolean(id)))].sort(),
			leafMeshIds: roleMeshIds(descendants, /daun|leaf|panel/i),
			frameMeshIds: roleMeshIds(descendants, /kusen|frame|mullion|sash/i),
			glassMeshIds: roleMeshIds(descendants, /kaca|glass|glaz/i),
			trimMeshIds: roleMeshIds(descendants, /trim|list|sill|threshold|handle|pegangan/i)
		};
	});
}

export function deduplicateOpeningComponents(components: OpeningComponent[]) {
	const accepted: OpeningComponent[] = [];
	const duplicates: OpeningComponent[] = [];
	for (const component of [...components].sort((left, right) => right.scores.name - left.scores.name || right.areaM2 - left.areaM2 || left.id.localeCompare(right.id))) {
		const primary = accepted.find((candidate) => candidate.kind === component.kind && openingDuplicate(candidate, component));
		if (!primary) { accepted.push(component); continue; }
		component.duplicateOf = primary.id;
		primary.mergedFrom = [...new Set([...primary.mergedFrom, component.id, ...component.mergedFrom])].sort();
		primary.childMeshIds = [...new Set([...primary.childMeshIds, ...component.childMeshIds])].sort();
		primary.leafMeshIds = unique([...primary.leafMeshIds, ...component.leafMeshIds]);
		primary.frameMeshIds = unique([...primary.frameMeshIds, ...component.frameMeshIds]);
		primary.glassMeshIds = unique([...primary.glassMeshIds, ...component.glassMeshIds]);
		primary.trimMeshIds = unique([...primary.trimMeshIds, ...component.trimMeshIds]);
		primary.sourceFaceIds = [...new Set([...primary.sourceFaceIds, ...component.sourceFaceIds])].sort();
		primary.bindings = [...primary.bindings, ...component.bindings];
		duplicates.push(component);
	}
	return { components: accepted.sort((left, right) => left.id.localeCompare(right.id)), duplicates: duplicates.sort((left, right) => left.id.localeCompare(right.id)) };
}

export function mergeRoomCandidates(candidates: RoomMergeCandidate[]) {
	const parent = candidates.map((_, index) => index);
	const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
	const union = (left: number, right: number) => { left = find(left); right = find(right); if (left !== right) parent[right] = left; };
	for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) {
		const a = candidates[left]; const b = candidates[right];
		if (a.parentGroupId !== b.parentGroupId || Math.abs(a.floorElevationM - b.floorElevationM) > 0.15 || Math.abs(a.heightM - b.heightM) > 0.35) continue;
		const declared = a.sharedBoundaries.find((boundary) => boundary.otherCandidateId === b.id) || b.sharedBoundaries.find((boundary) => boundary.otherCandidateId === a.id);
		const adjacent = declared ? declared.gapM <= 0.12 && declared.overlapM >= 0.2 : (!a.topologyEvaluated && !b.topologyEvaluated && footprintAdjacency(a.footprint, b.footprint));
		if (!adjacent || (declared?.separatingWallIds.length || 0) > 0) continue;
		union(left, right);
	}
	const groups = new Map<number, RoomMergeCandidate[]>();
	candidates.forEach((candidate, index) => groups.set(find(index), [...(groups.get(find(index)) || []), candidate]));
	return [...groups.values()].map(mergeRoomGroup).sort((left, right) => left.floorElevationM - right.floorElevationM || left.id.localeCompare(right.id));
}

export function identifySmboostFixture(scene: RuntimeScene): SmboostFixtureId | null {
	const strings = scene.manifest.strings;
	const source = normalize(`${strings[scene.manifest.source.file_name] || ''} ${strings[scene.manifest.source.model_name] || ''}`);
	if (/project sboost 2|smboost model 2/.test(source)) return 'smboost-model-2';
	if (/project sboost(?: !| 1|$)|smboost model 1/.test(source)) return 'smboost-model-1';
	return null;
}

export function analyzeSmboostRuntime(scene: RuntimeScene): SmboostAnalysisResult {
	const fixtureId = identifySmboostFixture(scene);
	if (!fixtureId) throw new Error('Runtime scene is not a recognized SMBOOST fixture.');
	const geometry = createGeometryFoundation(scene);
	const objects = geometry.buildLogicalObjectIndex().objects;
	const byNode = new Map(geometry.instanceGraph.nodes.map((node) => [node.nodeId, node]));
	const strings = scene.manifest.strings;
	const hierarchyNames = (nodeId: string) => {
		const names: string[] = [];
		let current = byNode.get(nodeId);
		while (current) {
			const definition = scene.manifest.definitions[current.definitionId];
			const name = strings[current.sourceNameId] || strings[definition?.name] || '';
			if (name && names[0] !== name) names.unshift(name);
			current = current.parentNodeId ? byNode.get(current.parentNodeId) : undefined;
		}
		return names;
	};
	const wallBuild = buildWalls(geometry, objects, hierarchyNames);
	const walls = wallBuild.walls;
	const roomCandidates = buildRooms(scene, geometry, objects, walls, hierarchyNames);
	const openingCandidates = buildOpenings(scene, geometry, objects, walls, roomCandidates, hierarchyNames);
	markAuxiliaryExteriorFloorCandidates(roomCandidates, openingCandidates);
	const mergedRooms = mergeRoomCandidates(roomCandidates.filter((candidate) => candidate.state !== 'open geometry'));
	const rooms = mergedRooms.map((room) => ({
		id: room.id,
		floorFaceIds: room.floorFaceIds,
		ceilingFaceIds: room.ceilingFaceIds,
		wallFaceIds: room.wallFaceIds,
		footprint: room.footprint,
		areaM2: room.areaM2,
		heightM: room.heightM,
		volumeM3: room.volumeM3 || room.areaM2 * room.heightM,
		boundaryCoverage: room.boundaryCoverage,
		mergeHistory: room.mergeHistory || [room.id],
		warnings: room.warnings,
		state: room.state || (room.wallFaceIds.length ? 'valid' : 'incomplete boundary'),
		center: room.centroid || footprintCenter(room.footprint, room.floorElevationM + room.heightM / 2)
	}));
	const deduplicated = deduplicateOpeningComponents(openingCandidates.filter((item) => item.kind !== 'rejected'));
	const openings = deduplicated.components;
	for (const wall of walls) {
		wall.openingIds = openings.filter((opening) => opening.nearestWallId === wall.id).map((opening) => opening.id).sort();
		wall.openingArea = openings.filter((opening) => opening.nearestWallId === wall.id).reduce((sum, opening) => sum + openingArea(opening), 0);
		wall.netArea = Math.max(0, wall.grossArea - wall.openingArea);
		wall.areaM2 = wall.netArea;
		wall.roomIds = rooms.filter((room) => room.wallFaceIds.includes(wall.id)).map((room) => room.id).sort();
	}
	const expected = SMBOOST_FIXTURE_EXPECTATIONS[fixtureId];
	const counts = {
		rooms: rooms.filter((room) => room.state === 'valid').length,
		doors: openings.filter((item) => item.kind === 'door').length,
		windows: openings.filter((item) => item.kind === 'window').length,
		unresolved: openings.filter((item) => item.kind === 'unresolved_opening').length
	};
	const countsMatchExpected = counts.rooms === expected.rooms && counts.doors === expected.doors && counts.windows === expected.windows;
	const warnings: string[] = [];
	if (counts.rooms !== expected.rooms) warnings.push(`Room count ${counts.rooms}; expected ${expected.rooms}.`);
	if (counts.doors !== expected.doors) warnings.push(`Door count ${counts.doors}; expected ${expected.doors}.`);
	if (counts.windows !== expected.windows) warnings.push(`Window count ${counts.windows}; expected ${expected.windows}.`);
	if (counts.unresolved) warnings.push(`${counts.unresolved} opening remains unresolved.`);
	if (deduplicated.duplicates.length) warnings.push(`${deduplicated.duplicates.length} duplicate opening merged.`);
	if (!walls.length) warnings.push('No individually addressable wall component detected.');
	const registry = buildGeometryRegistry(scene);
	const renderGroups = buildRuntimeGeometryGroups(scene);
	for (const group of renderGroups) if (group.key !== 'other') registry.unresolvedMeshes.delete(`mesh:${group.sourceMeshIndex}`);
	const geometryIngestion = diagnoseRenderCoverage(registry, renderGroups);
	geometryIngestion.unresolvedMeshes = registry.unresolvedMeshes.size;
	return {
		fixtureId,
		roomCandidates,
		rooms,
		wallComponents: walls,
		openingCandidates,
		openings,
		duplicates: deduplicated.duplicates,
		validation: {
			expectedRoomCount: expected.rooms,
			detectedRoomCount: counts.rooms,
			expectedDoorCount: expected.doors,
			detectedDoorCount: counts.doors,
			expectedWindowCount: expected.windows,
			detectedWindowCount: counts.windows,
			unresolvedOpeningCount: counts.unresolved,
			duplicateOpeningCount: deduplicated.duplicates.length,
			wallCount: walls.length,
			individuallyAddressableWallCount: walls.length,
			countsMatchExpected,
			warnings,
			downstreamReady: countsMatchExpected && counts.unresolved === 0 && walls.length > 0 && rooms.every((room) => room.areaM2 > 0 && room.volumeM3 > 0)
		},
		diagnostics: {
			geometryIngestion,
			openings: {
				doorLogicalComponents: openings.filter((opening) => opening.kind === 'door').length,
				windowLogicalComponents: openings.filter((opening) => opening.kind === 'window').length,
				doorFrameMeshes: unique(openings.filter((opening) => opening.kind === 'door').flatMap((opening) => opening.frameMeshIds)).length,
				windowFrameMeshes: unique(openings.filter((opening) => opening.kind === 'window').flatMap((opening) => opening.frameMeshIds)).length,
				unresolvedOpeningMeshes: unique(openings.filter((opening) => opening.kind === 'unresolved_opening').flatMap((opening) => opening.childMeshIds)).length,
				orphanedFrames: 0,
				logicalComponentsWithMissingSourceMeshes: openings.filter((opening) => opening.childMeshIds.length === 0).length
			},
			walls: { ...wallBuild.diagnostics, wallsWithAssociatedOpenings: walls.filter((wall) => wall.openingIds.length > 0).length },
			rooms: {
				rawRoomCandidates: roomCandidates.length,
				mergedRooms: mergedRooms.length,
				finalRoomCount: rooms.length,
				footprintAreaM2: rooms.reduce((sum, room) => sum + room.areaM2, 0),
				volumeM3: rooms.reduce((sum, room) => sum + room.volumeM3, 0),
				boundaryWallCount: unique(rooms.flatMap((room) => room.wallFaceIds)).length,
				roomsWithoutCeiling: rooms.filter((room) => room.ceilingFaceIds.length === 0).length,
				roomsWithIncompleteBoundary: rooms.filter((room) => room.state !== 'valid').length
			}
		}
	};
}

function buildWalls(
	geometry: ReturnType<typeof createGeometryFoundation>,
	objects: LogicalObjectRecord[],
	hierarchyNames: (nodeId: string) => string[]
): { walls: InspectableWallComponent[]; diagnostics: LogicalWallDiagnostics } {
	const candidates: WallSurfaceCandidate[] = [];
	const candidateContext = new Map<string, { object: LogicalObjectRecord; cluster: SurfaceClusterRecord; hierarchy: string[]; sourceFaceIds: string[] }>();
	const levelBase = geometry.modelContext.bounds.min.y;
	for (const object of objects) {
		const hierarchy = hierarchyNames(object.nodeId);
		const text = normalize(`${hierarchy.join(' ')} ${object.sourceTag || ''}`);
		if (/pintu|door|jendela|window|kaca|glass|atap|roof|furniture|furnitur|lemari|cabinet/.test(text)) continue;
		const clusters = geometry.buildSurfaceClusters(object.id);
		const wallClusters = clusters.filter((cluster) => cluster.verticalAreaRatio >= 0.9 && cluster.worldBounds.size.y >= 1.5 && Math.max(cluster.worldBounds.size.x, cluster.worldBounds.size.z) >= 0.4 && cluster.areaM2 >= 0.35);
		if (!wallClusters.length) continue;
		const parentHierarchyId = geometry.instanceGraph.byNodeId.get(object.nodeId)?.parentNodeId || object.nodeId;
		const addCandidate = (cluster: SurfaceClusterRecord, semanticRole: WallSurfaceCandidate['semanticRole']) => {
			const sourceFaceIds = sourceIds(cluster);
			const candidate: WallSurfaceCandidate = {
				id: cluster.id,
				sourceNodeId: object.nodeId,
				meshId: `mesh:${object.meshId}`,
				faceIds: sourceFaceIds,
				parentHierarchyId,
				connectedComponentId: `${object.id}:${cluster.connectedComponentIndex}`,
				materialIds: cluster.materialIds,
				normal: cluster.dominantNormal,
				centroid: cluster.centroid,
				bounds: cluster.worldBounds,
				areaM2: cluster.areaM2,
				storey: Math.max(0, Math.floor((cluster.worldBounds.min.y - levelBase + 0.35) / 2.5)),
				semanticRole
			};
			candidates.push(candidate);
			candidateContext.set(candidate.id, { object, cluster, hierarchy, sourceFaceIds });
		};
		for (const cluster of wallClusters) addCandidate(cluster, 'wall');
		const largestWallArea = Math.max(...wallClusters.map((cluster) => cluster.areaM2));
		for (const cluster of clusters) {
			if (wallClusters.includes(cluster) || cluster.areaM2 <= 0 || cluster.areaM2 > largestWallArea * 0.25) continue;
			if (!wallClusters.some((wall) => boundsGap3(wall.worldBounds, cluster.worldBounds) <= 0.08)) continue;
			addCandidate(cluster, 'decorative');
		}
	}
	const reconstructed = reconstructLogicalWalls(candidates);
	const walls = reconstructed.walls.map((wall): InspectableWallComponent => {
		const members = candidates.filter((candidate) => wall.faceIds.some((faceId) => candidate.faceIds.includes(faceId))).map((candidate) => candidateContext.get(candidate.id)!).filter(Boolean);
		const sourceName = members.map((member) => member.object.sourceName).find(Boolean) || wall.displayName;
		return {
			id: wall.id,
			kind: 'wall',
			displayName: wall.displayName,
			sourceName,
			hierarchyPath: members[0]?.hierarchy || [],
			childMeshIds: wall.meshIds,
			sourceFaceIds: wall.faceIds,
			bounds: wall.bounds,
			centroid: wall.bounds.center,
			dimensions: wall.bounds.size,
			faceCount: wall.faceIds.length,
			areaM2: wall.netArea,
			dominantNormal: wall.centerPlane.normal,
			classificationRule: wall.groupingEvidence.paired ? 'wall:paired-opposite-surfaces' : 'wall:coplanar-surface-group',
			rejectionReasons: [],
			bindings: uniqueBindings(members.map((member) => ({ instancePath: member.object.instancePath, sourceFaceIds: member.sourceFaceIds }))),
			exteriorFaceIds: wall.exteriorFaceIds,
			interiorFaceIds: wall.interiorFaceIds,
			sideFaceIds: wall.sideFaceIds,
			roomIds: wall.roomIds,
			openingIds: wall.openingIds,
			centerPlane: wall.centerPlane,
			length: wall.length,
			height: wall.height,
			thickness: wall.thickness,
			grossArea: wall.grossArea,
			openingArea: wall.openingArea,
			netArea: wall.netArea,
			orientation: wall.orientation,
			groupingEvidence: wall.groupingEvidence
		};
	});
	return { walls: walls.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id)), diagnostics: reconstructed.diagnostics };
}

function buildRooms(
	scene: RuntimeScene,
	geometry: ReturnType<typeof createGeometryFoundation>,
	objects: LogicalObjectRecord[],
	walls: InspectableWallComponent[],
	hierarchyNames: (nodeId: string) => string[]
) {
	const floors: Array<RoomMergeCandidate & { boundarySegments: PlanSegment[] }> = [];
	const ceilings = collectHorizontalClusters(geometry, objects).filter((item) => item.cluster.dominantNormal.y < -0.7);
	for (const object of objects) {
		const hierarchy = hierarchyNames(object.nodeId);
		if (!/\bkeramik lantai\b/i.test(`${object.sourceName} ${object.sourceTag || ''} ${hierarchy.join(' ')}`)) continue;
		const top = geometry.buildSurfaceClusters(object.id)
			.filter((cluster) => cluster.horizontalAreaRatio >= 0.9 && cluster.dominantNormal.y > 0.7 && cluster.areaM2 >= 1)
			.sort((left, right) => right.centroid.y - left.centroid.y || right.areaM2 - left.areaM2)[0];
		if (!top) continue;
		const polygons = clusterPolygons(scene, geometry, object, top);
		const footprint = largestPolygon(polygons) || rectangleFootprint(top.worldBounds);
		const floorElevation = top.centroid.y;
		const ceiling = ceilings
			.map((item) => ({ ...item, height: item.cluster.centroid.y - floorElevation, overlap: boundsOverlapXZ(item.cluster.worldBounds, top.worldBounds) / Math.max(top.areaM2, 0.001) }))
			.filter((item) => item.height >= 1.8 && item.height <= 5 && item.overlap >= 0.35)
			.sort((left, right) => left.height - right.height || right.overlap - left.overlap)[0];
		const parentGroupId = geometry.instanceGraph.byNodeId.get(object.nodeId)?.parentNodeId || object.nodeId;
		const boundarySegments = polygonBoundarySegments(polygons);
		const levelWalls = walls.filter((wall) => wall.bounds.min.y <= floorElevation + 0.2 && wall.bounds.max.y >= floorElevation + 1.5);
		const wallFaceIds = levelWalls.filter((wall) => nearFootprintBoundary(footprint, wall.bounds, 0.22)).map((wall) => wall.id);
		const boundaryCoverage = planBoundaryCoverage(boundarySegments, levelWalls, 0.22);
		const sourceFaceIds = sourceIds(top);
		floors.push({
			id: `candidate:room:${stableHash(`${parentGroupId}:${top.id}`)}`,
			parentGroupId,
			floorFaceIds: sourceFaceIds,
			ceilingFaceIds: ceiling ? sourceIds(ceiling.cluster) : [],
			wallFaceIds,
			footprint,
			areaM2: top.areaM2,
			floorElevationM: floorElevation,
			ceilingElevationM: ceiling?.cluster.centroid.y || floorElevation,
			heightM: ceiling?.height || 0,
			boundaryCoverage,
			sharedBoundaries: [],
			warnings: ceiling ? [] : ['Matching ceiling boundary missing.'],
			sourceName: object.sourceName,
			hierarchyPath: hierarchy,
			childMeshIds: [`mesh:${object.meshId}`],
			centroid: { ...top.centroid, y: floorElevation + (ceiling?.height || 0) / 2 },
			bounds: top.worldBounds,
			bindings: [{ instancePath: object.instancePath, sourceFaceIds }],
			boundarySegments,
			topologyEvaluated: true,
			state: ceiling && boundaryCoverage >= 0.82 ? 'valid' : 'incomplete boundary'
		});
	}
	for (let left = 0; left < floors.length; left += 1) for (let right = left + 1; right < floors.length; right += 1) {
		const a = floors[left]; const b = floors[right];
		if (a.parentGroupId !== b.parentGroupId || Math.abs(a.floorElevationM - b.floorElevationM) > 0.15) continue;
		const shared = sharedPlanBoundary(a.boundarySegments, b.boundarySegments, 0.12);
		if (!shared) continue;
		const separating = walls.filter((wall) => wall.bounds.min.y <= a.floorElevationM + 0.2 && wall.bounds.max.y >= a.floorElevationM + 1.5 && wallCoversSegment(wall.bounds, shared, 0.18)).map((wall) => wall.id);
		a.sharedBoundaries.push({ otherCandidateId: b.id, gapM: shared.gapM, overlapM: shared.overlapM, separatingWallIds: separating });
		b.sharedBoundaries.push({ otherCandidateId: a.id, gapM: shared.gapM, overlapM: shared.overlapM, separatingWallIds: separating });
	}
	return floors.map(({ boundarySegments: _segments, ...candidate }) => candidate);
}

function markAuxiliaryExteriorFloorCandidates(candidates: RoomMergeCandidate[], openings: OpeningComponent[]) {
	const doors = openings.filter((opening) => opening.kind === 'door');
	const levelGroups = groupByLevel(candidates, 0.15);
	const exteriorFingerprints: RoomMergeCandidate[] = [];
	for (const level of levelGroups) {
		const areas = level.map((candidate) => candidate.areaM2).sort((left, right) => left - right);
		const median = areas[Math.floor(areas.length / 2)] || 0;
		for (const candidate of level) {
			const smallOutlier = candidate.areaM2 < Math.min(6, median * 0.4);
			const separatedFromLarger = candidate.sharedBoundaries.some((boundary) => boundary.separatingWallIds.length > 0 && (candidates.find((item) => item.id === boundary.otherCandidateId)?.areaM2 || 0) >= candidate.areaM2 * 3);
			const entranceDoor = doors.some((door) => Math.abs(door.bounds.min.y - candidate.floorElevationM) <= 0.25 && pointInFootprint(door.centroid, candidate.footprint, 0.35));
			if (!smallOutlier || !separatedFromLarger || !entranceDoor) continue;
			candidate.state = 'open geometry';
			candidate.warnings.push('Auxiliary exterior landing excluded: small outlier footprint lies outside entrance door.');
			exteriorFingerprints.push(candidate);
		}
	}
	for (const candidate of candidates) {
		if (candidate.state === 'open geometry') continue;
		const match = exteriorFingerprints.some((source) => Math.abs(source.areaM2 - candidate.areaM2) / Math.max(source.areaM2, candidate.areaM2) <= 0.05 && planFootprintOverlap(source.footprint, candidate.footprint) >= 0.9);
		if (!match) continue;
		candidate.state = 'open geometry';
		candidate.warnings.push('Auxiliary exterior landing excluded: repeated footprint matches entrance-level landing.');
	}
}

function buildOpenings(
	scene: RuntimeScene,
	geometry: ReturnType<typeof createGeometryFoundation>,
	objects: LogicalObjectRecord[],
	walls: InspectableWallComponent[],
	floors: RoomMergeCandidate[],
	hierarchyNames: (nodeId: string) => string[]
) {
	const strings = scene.manifest.strings;
	const nodes: HierarchyOpeningNode[] = geometry.instanceGraph.nodes.map((node) => ({
		id: node.nodeId,
		parentId: node.parentNodeId,
		sourceName: strings[node.sourceNameId] || strings[scene.manifest.definitions[node.definitionId]?.name] || '',
		meshId: node.meshId === null ? null : `mesh:${node.meshId}`
	}));
	const groups = groupOpeningAssemblies(nodes);
	const objectsByNode = new Map<string, LogicalObjectRecord[]>();
	objects.forEach((object) => objectsByNode.set(object.nodeId, [...(objectsByNode.get(object.nodeId) || []), object]));
	return groups.map((group): OpeningComponent => {
		const descendants = group.hierarchyNodeIds.flatMap((id) => objectsByNode.get(id) || []);
		const bounds = combineBounds(descendants.map((object) => object.worldBounds));
		const hierarchyPath = hierarchyNames(group.id);
		const areaM2 = descendants.reduce((sum, object) => sum + object.totalAreaM2, 0);
		const faceCount = descendants.reduce((sum, object) => sum + object.faceOrPrimitiveIds.length, 0);
		const sourceFaceIds = [...new Set(descendants.flatMap((object) => object.faceOrPrimitiveIds.map((id) => id.replace(/:\d+$/, ''))))].sort();
		const bindings = descendants.map((object) => ({ instancePath: object.instancePath, sourceFaceIds: object.faceOrPrimitiveIds.map((id) => id.replace(/:\d+$/, '')) }));
		const nearestWall = walls.map((wall) => ({ wall, distance: boundsDistanceXZ(bounds, wall.bounds) })).sort((left, right) => left.distance - right.distance)[0];
		const nearestFloor = floors.map((floor) => ({ floor, gap: Math.abs(bounds.min.y - floor.floorElevationM) })).sort((left, right) => left.gap - right.gap)[0];
		const widthM = Math.max(bounds.size.x, bounds.size.z);
		const depthM = Math.min(bounds.size.x, bounds.size.z);
		const evidence = classifyOpeningCandidate({
			sourceName: group.sourceName,
			hierarchyText: descendants.map((object) => object.sourceName).join(' '),
			widthM,
			heightM: bounds.size.y,
			depthM,
			floorGapM: nearestFloor?.gap ?? Infinity,
			wallDistanceM: nearestWall?.distance ?? Infinity,
			wallOverlapRatio: nearestWall && nearestWall.distance <= 0.25 ? 1 : 0,
			transparentAreaRatio: descendants.some((object) => /kaca|glass/i.test(object.sourceName)) ? 0.5 : 0
		});
		const rootNode = geometry.instanceGraph.byNodeId.get(group.id);
		const id = `component:opening:${rootNode?.sourceIdentity || stableHash(group.id)}`;
		const assemblyMeshes = descendants.map((object) => ({ id: `mesh:${object.meshId}:${stableHash(object.id)}`, name: object.sourceName }));
		return {
			id,
			kind: evidence.kind,
			displayName: group.sourceName,
			sourceName: group.sourceName,
			hierarchyPath,
			childMeshIds: unique(assemblyMeshes.map((mesh) => mesh.id)),
			leafMeshIds: roleObjectMeshIds(assemblyMeshes, /daun|leaf|panel/i),
			frameMeshIds: roleObjectMeshIds(assemblyMeshes, /kusen|frame|mullion|sash/i),
			glassMeshIds: roleObjectMeshIds(assemblyMeshes, /kaca|glass|glaz/i),
			trimMeshIds: roleObjectMeshIds(assemblyMeshes, /trim|list|sill|threshold|handle|pegangan/i),
			sourceFaceIds,
			bounds,
			centroid: bounds.center,
			dimensions: bounds.size,
			faceCount,
			areaM2,
			dominantNormal: dominantNormal(descendants),
			nearestWallId: nearestWall?.wall.id || null,
			nearestWallDistanceM: nearestWall?.distance ?? null,
			nearestFloorId: nearestFloor?.floor.id || null,
			floorGapM: nearestFloor?.gap ?? null,
			wallOverlapRatio: nearestWall && nearestWall.distance <= 0.25 ? 1 : 0,
			scores: evidence.scores,
			classificationRule: evidence.rule,
			rejectionReasons: evidence.rejectionReasons,
			mergedFrom: [],
			duplicateOf: null,
			bindings
		};
	});
}

function mergeRoomGroup(group: RoomMergeCandidate[]): RoomMergeCandidate {
	const sorted = [...group].sort((left, right) => left.id.localeCompare(right.id));
	const ids = sorted.flatMap((item) => item.mergeHistory || [item.id]);
	const areaM2 = sorted.reduce((sum, item) => sum + item.areaM2, 0);
	const heightM = weightedAverage(sorted.map((item) => [item.heightM, item.areaM2]));
	const footprint = mergeFootprints(sorted.map((item) => item.footprint));
	const floorElevationM = weightedAverage(sorted.map((item) => [item.floorElevationM, item.areaM2]));
	return {
		...sorted[0],
		id: `room:${stableHash(ids.sort().join('|'))}`,
		floorFaceIds: unique(sorted.flatMap((item) => item.floorFaceIds)),
		ceilingFaceIds: unique(sorted.flatMap((item) => item.ceilingFaceIds)),
		wallFaceIds: unique(sorted.flatMap((item) => item.wallFaceIds)),
		footprint,
		areaM2,
		floorElevationM,
		ceilingElevationM: floorElevationM + heightM,
		heightM,
		boundaryCoverage: Math.min(...sorted.map((item) => item.boundaryCoverage)),
		warnings: unique(sorted.flatMap((item) => item.warnings)),
		mergeHistory: ids,
		volumeM3: areaM2 * heightM,
		state: heightM > 0 && sorted.some((item) => item.wallFaceIds.length > 0) ? 'valid' : 'incomplete boundary',
		centroid: footprintCenter(footprint, floorElevationM + heightM / 2),
		bindings: sorted.flatMap((item) => item.bindings || [])
	};
}

type PlanSegment = { axis: 'x' | 'z'; plane: number; min: number; max: number };

function polygonBoundarySegments(polygons: Array<Array<{ x: number; z: number }>>) {
	const counts = new Map<string, { count: number; segment: PlanSegment }>();
	for (const polygon of polygons) for (let index = 0; index < polygon.length; index += 1) {
		const a = polygon[index]; const b = polygon[(index + 1) % polygon.length];
		let segment: PlanSegment | null = null;
		if (Math.abs(a.x - b.x) <= 0.02) segment = { axis: 'z', plane: (a.x + b.x) / 2, min: Math.min(a.z, b.z), max: Math.max(a.z, b.z) };
		else if (Math.abs(a.z - b.z) <= 0.02) segment = { axis: 'x', plane: (a.z + b.z) / 2, min: Math.min(a.x, b.x), max: Math.max(a.x, b.x) };
		if (!segment || segment.max - segment.min < 0.05) continue;
		const key = `${segment.axis}:${roundTo(segment.plane, 0.01)}:${roundTo(segment.min, 0.01)}:${roundTo(segment.max, 0.01)}`;
		const current = counts.get(key);
		counts.set(key, { count: (current?.count || 0) + 1, segment });
	}
	return [...counts.values()].filter((item) => item.count % 2 === 1).map((item) => item.segment);
}

function sharedPlanBoundary(left: PlanSegment[], right: PlanSegment[], tolerance: number) {
	let best: { axis: 'x' | 'z'; plane: number; min: number; max: number; gapM: number; overlapM: number } | null = null;
	for (const a of left) for (const b of right) {
		if (a.axis !== b.axis) continue;
		const gapM = Math.abs(a.plane - b.plane);
		const min = Math.max(a.min, b.min); const max = Math.min(a.max, b.max); const overlapM = max - min;
		if (gapM > tolerance || overlapM < 0.2) continue;
		if (!best || overlapM > best.overlapM) best = { axis: a.axis, plane: (a.plane + b.plane) / 2, min, max, gapM, overlapM };
	}
	return best;
}

function wallCoversSegment(bounds: Bounds3, segment: { axis: 'x' | 'z'; plane: number; min: number; max: number; overlapM: number }, tolerance: number) {
	const plane = segment.axis === 'z' ? bounds.center.x : bounds.center.z;
	const min = segment.axis === 'z' ? bounds.min.z : bounds.min.x;
	const max = segment.axis === 'z' ? bounds.max.z : bounds.max.x;
	const overlap = intervalOverlap(min, max, segment.min, segment.max);
	return Math.abs(plane - segment.plane) <= tolerance && overlap >= Math.min(segment.overlapM * 0.55, 0.6);
}

function planBoundaryCoverage(segments: PlanSegment[], walls: InspectableWallComponent[], tolerance: number) {
	let perimeter = 0;
	let covered = 0;
	for (const segment of segments) {
		perimeter += segment.max - segment.min;
		const intervals: Array<[number, number]> = [];
		for (const wall of walls) {
			const plane = segment.axis === 'z' ? wall.bounds.center.x : wall.bounds.center.z;
			if (Math.abs(plane - segment.plane) > tolerance) continue;
			const min = segment.axis === 'z' ? wall.bounds.min.z : wall.bounds.min.x;
			const max = segment.axis === 'z' ? wall.bounds.max.z : wall.bounds.max.x;
			const start = Math.max(min, segment.min); const end = Math.min(max, segment.max);
			if (end > start) intervals.push([start, end]);
		}
		covered += unionIntervalLength(intervals);
	}
	return perimeter ? Math.min(covered / perimeter, 1) : 0;
}

function unionIntervalLength(intervals: Array<[number, number]>) {
	if (!intervals.length) return 0;
	const sorted = [...intervals].sort((left, right) => left[0] - right[0]);
	let total = 0; let [start, end] = sorted[0];
	for (const [nextStart, nextEnd] of sorted.slice(1)) {
		if (nextStart <= end) end = Math.max(end, nextEnd);
		else { total += end - start; start = nextStart; end = nextEnd; }
	}
	return total + end - start;
}

function clusterPolygons(scene: RuntimeScene, geometry: ReturnType<typeof createGeometryFoundation>, object: LogicalObjectRecord, cluster: SurfaceClusterRecord) {
	const node = geometry.instanceGraph.byNodeId.get(object.nodeId);
	const runtime = scene.meshes[object.meshId];
	const mesh = scene.manifest.meshes[object.meshId];
	if (!node || !runtime || !mesh) return [];
	return cluster.primitiveIds.map((id) => Number(id.match(/:(\d+)$/)?.[1])).filter(Number.isInteger).map((faceIndex) => {
		const face = mesh.faces[faceIndex];
		const points: Array<{ x: number; z: number }> = [];
		for (let offset = face.outer_start; offset < face.outer_start + face.outer_count; offset += 1) {
			const vertex = runtime.loops[offset] * 3;
			const point = transformPoint(node.worldTransform, { x: runtime.positions[vertex], y: runtime.positions[vertex + 2], z: -runtime.positions[vertex + 1] });
			points.push({ x: point.x, z: point.z });
		}
		return points;
	}).filter((polygon) => polygon.length >= 3);
}

function collectHorizontalClusters(geometry: ReturnType<typeof createGeometryFoundation>, objects: LogicalObjectRecord[]) {
	return objects.flatMap((object) => geometry.buildSurfaceClusters(object.id).filter((cluster) => cluster.horizontalAreaRatio >= 0.9 && cluster.areaM2 >= 1).map((cluster) => ({ object, cluster })));
}

function sourceIds(cluster: SurfaceClusterRecord) { return unique(cluster.primitiveIds.map((id) => id.replace(/:\d+$/, ''))); }
function roleMeshIds(nodes: HierarchyOpeningNode[], pattern: RegExp) { return unique(nodes.filter((node) => pattern.test(node.sourceName)).map((node) => node.meshId).filter((id): id is string => Boolean(id))).sort(); }
function roleObjectMeshIds(meshes: Array<{ id: string; name: string }>, pattern: RegExp) { return unique(meshes.filter((mesh) => pattern.test(mesh.name)).map((mesh) => mesh.id)).sort(); }
function uniqueBindings(bindings: RuntimeComponentBinding[]) {
	const grouped = new Map<string, string[]>();
	for (const binding of bindings) grouped.set(binding.instancePath, unique([...(grouped.get(binding.instancePath) || []), ...binding.sourceFaceIds]).sort());
	return [...grouped].map(([instancePath, sourceFaceIds]) => ({ instancePath, sourceFaceIds }));
}
function openingArea(opening: OpeningComponent) { return Math.max(opening.dimensions.x, opening.dimensions.z) * opening.dimensions.y; }
function normalize(value: string) { return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function clamp01(value: number) { return Math.min(Math.max(value, 0), 1); }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function weightedAverage(values: Array<[number, number]>) { const weight = values.reduce((sum, item) => sum + item[1], 0); return weight ? values.reduce((sum, item) => sum + item[0] * item[1], 0) / weight : 0; }
function roundTo(value: number, step: number) { return Math.round(value / step) * step; }
function intervalOverlap(minA: number, maxA: number, minB: number, maxB: number) { return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB)); }
function boundsOverlapXZ(left: Bounds3, right: Bounds3) { return intervalOverlap(left.min.x, left.max.x, right.min.x, right.max.x) * intervalOverlap(left.min.z, left.max.z, right.min.z, right.max.z); }

function ancestor(node: HierarchyOpeningNode, byId: Map<string, HierarchyOpeningNode>, predicate: (node: HierarchyOpeningNode) => boolean) {
	let parent = node.parentId ? byId.get(node.parentId) : undefined;
	while (parent) { if (predicate(parent)) return true; parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
	return false;
}

function footprintBounds(points: Array<{ x: number; z: number }>) {
	const xs = points.map((point) => point.x); const zs = points.map((point) => point.z);
	return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function groupByLevel(candidates: RoomMergeCandidate[], tolerance: number) {
	const groups: RoomMergeCandidate[][] = [];
	for (const candidate of [...candidates].sort((left, right) => left.floorElevationM - right.floorElevationM)) {
		const group = groups.find((items) => Math.abs(items[0].floorElevationM - candidate.floorElevationM) <= tolerance);
		if (group) group.push(candidate); else groups.push([candidate]);
	}
	return groups;
}

function pointInFootprint(point: Vec3, footprint: Array<{ x: number; z: number }>, tolerance: number) {
	const bounds = footprintBounds(footprint);
	return point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance && point.z >= bounds.minZ - tolerance && point.z <= bounds.maxZ + tolerance;
}

function planFootprintOverlap(left: Array<{ x: number; z: number }>, right: Array<{ x: number; z: number }>) {
	const a = footprintBounds(left); const b = footprintBounds(right);
	const overlap = intervalOverlap(a.minX, a.maxX, b.minX, b.maxX) * intervalOverlap(a.minZ, a.maxZ, b.minZ, b.maxZ);
	const minimum = Math.min((a.maxX - a.minX) * (a.maxZ - a.minZ), (b.maxX - b.minX) * (b.maxZ - b.minZ));
	return minimum ? overlap / minimum : 0;
}

function footprintAdjacency(left: Array<{ x: number; z: number }>, right: Array<{ x: number; z: number }>) {
	const a = footprintBounds(left); const b = footprintBounds(right);
	const gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
	const gapZ = Math.max(0, Math.max(a.minZ, b.minZ) - Math.min(a.maxZ, b.maxZ));
	const overlapX = intervalOverlap(a.minX, a.maxX, b.minX, b.maxX);
	const overlapZ = intervalOverlap(a.minZ, a.maxZ, b.minZ, b.maxZ);
	return (gapX <= 0.08 && overlapZ >= 0.2) || (gapZ <= 0.08 && overlapX >= 0.2);
}

function mergeFootprints(footprints: Array<Array<{ x: number; z: number }>>) {
	const points = unique(footprints.flat().map((point) => `${roundTo(point.x, 0.001)},${roundTo(point.z, 0.001)}`)).map((value) => {
		const [x, z] = value.split(',').map(Number); return { x, z };
	});
	if (footprints.length === 1) return footprints[0];
	return convexHull(points);
}

function convexHull(points: Array<{ x: number; z: number }>) {
	if (points.length <= 3) return points;
	const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
	const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
	const lower: typeof points = []; const upper: typeof points = [];
	for (const point of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop(); lower.push(point); }
	for (const point of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop(); upper.push(point); }
	return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function largestPolygon(polygons: Array<Array<{ x: number; z: number }>>) { return [...polygons].sort((left, right) => polygonArea(right) - polygonArea(left))[0]; }
function polygonArea(points: Array<{ x: number; z: number }>) { let area = 0; for (let index = 0; index < points.length; index += 1) { const a = points[index]; const b = points[(index + 1) % points.length]; area += a.x * b.z - b.x * a.z; } return Math.abs(area) / 2; }
function rectangleFootprint(bounds: Bounds3) { return [{ x: bounds.min.x, z: bounds.min.z }, { x: bounds.max.x, z: bounds.min.z }, { x: bounds.max.x, z: bounds.max.z }, { x: bounds.min.x, z: bounds.max.z }]; }
function footprintCenter(points: Array<{ x: number; z: number }>, y: number): Vec3 { const bounds = footprintBounds(points); return { x: (bounds.minX + bounds.maxX) / 2, y, z: (bounds.minZ + bounds.maxZ) / 2 }; }

function nearFootprintBoundary(footprint: Array<{ x: number; z: number }>, wall: Bounds3, tolerance: number) {
	const bounds = footprintBounds(footprint);
	const xPlane = Math.min(Math.abs(wall.center.x - bounds.minX), Math.abs(wall.center.x - bounds.maxX));
	const zPlane = Math.min(Math.abs(wall.center.z - bounds.minZ), Math.abs(wall.center.z - bounds.maxZ));
	return (xPlane <= tolerance && intervalOverlap(bounds.minZ, bounds.maxZ, wall.min.z, wall.max.z) >= 0.2) || (zPlane <= tolerance && intervalOverlap(bounds.minX, bounds.maxX, wall.min.x, wall.max.x) >= 0.2);
}

function combineBounds(bounds: Bounds3[]): Bounds3 {
	if (!bounds.length) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 } };
	const min = { x: Math.min(...bounds.map((item) => item.min.x)), y: Math.min(...bounds.map((item) => item.min.y)), z: Math.min(...bounds.map((item) => item.min.z)) };
	const max = { x: Math.max(...bounds.map((item) => item.max.x)), y: Math.max(...bounds.map((item) => item.max.y)), z: Math.max(...bounds.map((item) => item.max.z)) };
	const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
	return { min, max, size, center: { x: min.x + size.x / 2, y: min.y + size.y / 2, z: min.z + size.z / 2 } };
}

function boundsDistanceXZ(left: Bounds3, right: Bounds3) {
	const dx = Math.max(0, Math.max(left.min.x, right.min.x) - Math.min(left.max.x, right.max.x));
	const dz = Math.max(0, Math.max(left.min.z, right.min.z) - Math.min(left.max.z, right.max.z));
	return Math.hypot(dx, dz);
}

function boundsGap3(left: Bounds3, right: Bounds3) {
	const dx = Math.max(0, Math.max(left.min.x, right.min.x) - Math.min(left.max.x, right.max.x));
	const dy = Math.max(0, Math.max(left.min.y, right.min.y) - Math.min(left.max.y, right.max.y));
	const dz = Math.max(0, Math.max(left.min.z, right.min.z) - Math.min(left.max.z, right.max.z));
	return Math.hypot(dx, dy, dz);
}

function openingDuplicate(left: OpeningComponent, right: OpeningComponent) {
	const overlap = boundsOverlapXZ(left.bounds, right.bounds) / Math.max(Math.min(left.bounds.size.x * left.bounds.size.z, right.bounds.size.x * right.bounds.size.z), 0.001);
	const centerDistance = Math.hypot(left.centroid.x - right.centroid.x, left.centroid.y - right.centroid.y, left.centroid.z - right.centroid.z);
	const sizeDelta = Math.max(Math.abs(left.dimensions.x - right.dimensions.x), Math.abs(left.dimensions.y - right.dimensions.y), Math.abs(left.dimensions.z - right.dimensions.z));
	return overlap >= 0.8 && centerDistance <= 0.12 && sizeDelta <= 0.12;
}

function dominantNormal(objects: LogicalObjectRecord[]): Vec3 {
	let value = { x: 0, y: 0, z: 0 };
	for (const object of objects) {
		value.x += object.orientationDistribution.dominantNormal.x * object.totalAreaM2;
		value.y += object.orientationDistribution.dominantNormal.y * object.totalAreaM2;
		value.z += object.orientationDistribution.dominantNormal.z * object.totalAreaM2;
	}
	const length = Math.hypot(value.x, value.y, value.z);
	return length ? { x: value.x / length, y: value.y / length, z: value.z / length } : { x: 0, y: 1, z: 0 };
}

function transformPoint(matrix: readonly number[], point: Vec3): Vec3 {
	return { x: matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12], y: matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13], z: matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14] };
}

function stableHash(value: string) {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
	return (hash >>> 0).toString(36);
}
