/**
 * topology.ts
 *
 * Task 3B.4: Spatial topology and room adjacency graph.
 * Converts DetectedRoom outputs into a stable spatial topology graph describing
 * adjacency, connectivity, openings, exterior boundaries, and vertical connections.
 */

import type { PlanCoord, BoundaryOpeningEvidence } from './types';
import type { DetectedRoom, DetectedRoomResult, Point3D, RoomBoundarySegment } from './detected-room';
import { quantizeCoord } from './helpers';
import { sha256Hex } from './hash';

// ─── Topology Contracts ───────────────────────────────────────────────────────

export type RoomConnectionEvidence = {
	sourceOpeningIds: string[];
	sourceBoundaryIds: string[];
	logicalObjectIds: string[];
	overlapLength?: number;
	segment?: { start: PlanCoord; end: PlanCoord };
};

export type RoomConnection = {
	id: string;
	fromRoomId: string;
	toRoomId: string;
	storeyId: string;
	type: 'door' | 'opening' | 'open_passage' | 'vertical_connection' | 'unknown';
	openingId?: string;
	sourceEvidenceIds: string[];
	width?: number;
	sillElevation?: number;
	headElevation?: number;
	traversable: boolean;
	confidence: number;
	evidence: RoomConnectionEvidence;
};

export type SharedRoomBoundary = {
	id: string;
	roomAId: string;
	roomBId: string;
	storeyId: string;
	length: number;
	segment: RoomBoundarySegment;
	sourceBoundaryIds: string[];
	confidence: number;
};

export type ExteriorRoomConnection = {
	id: string;
	roomId: string;
	storeyId: string;
	type: 'door' | 'window' | 'opening' | 'unknown';
	openingId?: string;
	sourceEvidenceIds: string[];
	width?: number;
	sillElevation?: number;
	headElevation?: number;
	traversable: boolean;
	confidence: number;
	boundarySegment?: RoomBoundarySegment;
};

export type RoomTopologyDiagnostics = {
	openingsWithoutSupportingWalls: number;
	openingsAssociatedWithMoreThanTwoRooms: number;
	adjacentRoomsWithoutSideAssignment: number;
	duplicateRoomConnections: number;
	isolatedRooms: number;
	roomsWithoutAccess: number;
	overlappingRoomPolygons: number;
	crossStoreyAdjacencyAttempts: number;
	unresolvedExteriorFacingBoundaries: number;
};

export type RoomTopologyNode = {
	roomId: string;
	storeyId: string;
	centroid: Point3D;
	floorArea: number;
	boundaryRoomIds: string[];
	connectionIds: string[];
	exteriorConnectionIds: string[];
};

export type RoomTopologyGraph = {
	rooms: RoomTopologyNode[];
	connections: RoomConnection[];
	sharedBoundaries: SharedRoomBoundary[];
	exteriorConnections: ExteriorRoomConnection[];
	diagnostics: RoomTopologyDiagnostics;
};

export type RoomTopologyResult = {
	graph: RoomTopologyGraph;
	fingerprint: string;
};

// ─── Deterministic ID Generation ──────────────────────────────────────────────

export function generateSharedRoomBoundaryId(
	roomAId: string,
	roomBId: string,
	start: PlanCoord,
	end: PlanCoord
): string {
	const [r1, r2] = [roomAId, roomBId].sort();
	const [p1, p2] = [
		`${quantizeCoord(start.x).toFixed(3)},${quantizeCoord(start.z).toFixed(3)}`,
		`${quantizeCoord(end.x).toFixed(3)},${quantizeCoord(end.z).toFixed(3)}`
	].sort();
	const hash = sha256Hex(`shared:${r1}:${r2}:${p1}:${p2}`).substring(0, 10);
	return `shared-boundary:${r1}:${r2}:${hash}`;
}

export function generateRoomConnectionId(
	fromRoomId: string,
	toRoomId: string,
	openingId: string | undefined,
	type: string
): string {
	const [r1, r2] = [fromRoomId, toRoomId].sort();
	const hash = sha256Hex(`conn:${r1}:${r2}:${openingId ?? 'none'}:${type}`).substring(0, 10);
	return `room-connection:${r1}:${r2}:${hash}`;
}

export function generateExteriorConnectionId(
	roomId: string,
	openingId: string | undefined,
	type: string
): string {
	const hash = sha256Hex(`ext:${roomId}:${openingId ?? 'none'}:${type}`).substring(0, 10);
	return `ext-connection:${roomId}:${hash}`;
}

export function calculateRoomTopologyFingerprint(graph: RoomTopologyGraph): string {
	const input = [...graph.rooms].sort((a, b) => a.roomId.localeCompare(b.roomId)).map((r) => `${r.roomId}|${r.boundaryRoomIds.join(',')}|${r.connectionIds.join(',')}`).join('') + [...graph.connections].sort((a, b) => a.id.localeCompare(b.id)).map((c) => `${c.id}|${c.fromRoomId}|${c.toRoomId}|${c.type}`).join('');
	return `${graph.rooms.length}:${graph.connections.length}:${sha256Hex(input).substring(0, 12)}`;
}

// ─── Geometry & Segment Overlap Helpers ────────────────────────────────────────

function pointPolygonOverlapArea(polyA: PlanCoord[], polyB: PlanCoord[]): boolean {
	// Simple bounding box intersection + sampling test for 2D overlap between polygons
	let insideCount = 0;
	for (const p of polyA) {
		if (pointInPolygonPlan(p, polyB)) insideCount++;
	}
	for (const p of polyB) {
		if (pointInPolygonPlan(p, polyA)) insideCount++;
	}
	return insideCount >= 2;
}

function pointInPolygonPlan(pt: PlanCoord, poly: PlanCoord[]): boolean {
	const n = poly.length;
	let inside = false;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = poly[i].x, zi = poly[i].z;
		const xj = poly[j].x, zj = poly[j].z;
		const intersects =
			zi > pt.z !== zj > pt.z &&
			pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi) + xi;
		if (intersects) inside = !inside;
	}
	return inside;
}

function computeCollinearOverlap(
	segA: { start: PlanCoord; end: PlanCoord },
	segB: { start: PlanCoord; end: PlanCoord },
	tol: number
): { overlapLen: number; start: PlanCoord; end: PlanCoord } | null {
	const dxA = segA.end.x - segA.start.x;
	const dzA = segA.end.z - segA.start.z;
	const lenA = Math.hypot(dxA, dzA);
	if (lenA < 1e-5) return null;

	const ux = dxA / lenA;
	const uz = dzA / lenA;

	const dxB = segB.end.x - segB.start.x;
	const dzB = segB.end.z - segB.start.z;
	const lenB = Math.hypot(dxB, dzB);
	if (lenB < 1e-5) return null;

	const uxB = dxB / lenB;
	const uzB = dzB / lenB;

	// Check parallelism (cross product near 0)
	const cross = Math.abs(ux * uzB - uz * uxB);
	if (cross > 0.15) return null;

	// Check perpendicular distance of segB endpoints to line of segA
	const distP = (p: PlanCoord) =>
		Math.abs(dzA * (p.x - segA.start.x) - dxA * (p.z - segA.start.z)) / lenA;
	const d1 = distP(segB.start);
	const d2 = distP(segB.end);
	if (Math.max(d1, d2) > Math.max(0.6, tol * 5)) return null;

	// Project onto axis of segA
	const proj = (p: PlanCoord) => (p.x - segA.start.x) * ux + (p.z - segA.start.z) * uz;
	const pB1 = proj(segB.start);
	const pB2 = proj(segB.end);

	const minB = Math.min(pB1, pB2);
	const maxB = Math.max(pB1, pB2);

	const oMin = Math.max(0, minB);
	const oMax = Math.min(lenA, maxB);

	const overlapLen = oMax - oMin;
	if (overlapLen <= tol) return null;

	const start = { x: segA.start.x + oMin * ux, z: segA.start.z + oMin * uz };
	const end = { x: segA.start.x + oMax * ux, z: segA.start.z + oMax * uz };
	return { overlapLen, start, end };
}

// ─── Builder Implementation ────────────────────────────────────────────────────

export function buildRoomTopology(
	detectedRoomsResult: DetectedRoomResult,
	openings: BoundaryOpeningEvidence[] = [],
	modelDiagonalM: number = 50
): RoomTopologyResult {
	const validRooms = detectedRoomsResult.rooms.filter((r) => r.status === 'valid' || r.status === 'ambiguous');
	const tol = Math.max(modelDiagonalM * 1e-4, 0.05);

	const sharedBoundaries: SharedRoomBoundary[] = [];
	const connections: RoomConnection[] = [];
	const exteriorConnections: ExteriorRoomConnection[] = [];
	const diagnostics: RoomTopologyDiagnostics = {
		openingsWithoutSupportingWalls: 0,
		openingsAssociatedWithMoreThanTwoRooms: 0,
		adjacentRoomsWithoutSideAssignment: 0,
		duplicateRoomConnections: 0,
		isolatedRooms: 0,
		roomsWithoutAccess: 0,
		overlappingRoomPolygons: 0,
		crossStoreyAdjacencyAttempts: 0,
		unresolvedExteriorFacingBoundaries: 0
	};

	// 1. Detect Shared Room Boundaries and Overlapping/Cross-Storey cases
	for (let i = 0; i < validRooms.length; i++) {
		for (let j = i + 1; j < validRooms.length; j++) {
			const rA = validRooms[i];
			const rB = validRooms[j];

			// Quick bounds check
			if (
				rA.planBounds.max.x < rB.planBounds.min.x - tol ||
				rA.planBounds.min.x > rB.planBounds.max.x + tol ||
				rA.planBounds.max.z < rB.planBounds.min.z - tol ||
				rA.planBounds.min.z > rB.planBounds.max.z + tol
			) {
				continue;
			}

			// Cross-storey check
			if (rA.storeyId !== rB.storeyId) {
				if (pointPolygonOverlapArea(rA.boundary2D, rB.boundary2D)) {
					diagnostics.crossStoreyAdjacencyAttempts++;
				}
				continue;
			}

			// Overlapping polygons check on same storey
			if (pointPolygonOverlapArea(rA.boundary2D, rB.boundary2D)) {
				diagnostics.overlappingRoomPolygons++;
				continue;
			}

			// Compare segment by segment for shared boundary
			let totalSharedLength = 0;
			let bestStart: PlanCoord | null = null;
			let bestEnd: PlanCoord | null = null;
			const sourceBoundaryIds = new Set<string>([rA.id, rB.id]);
			let bestConfidence = 1.0;
			let isConnectedByBridge = false;
			let bridgeOpeningId: string | undefined = undefined;

			for (const segA of rA.evidence.boundarySegments) {
				for (const segB of rB.evidence.boundarySegments) {
					// Check if both segments derived from opening bridge or shared evidence
					const sharedEv = segA.sourceEvidenceIds.filter((id) => segB.sourceEvidenceIds.includes(id));
					const overlap = computeCollinearOverlap(segA, segB, tol);

					if (overlap) {
						// Ensure they are not separated by a wide gap (> tol) without shared evidence
						const distP = (p: PlanCoord) => {
							const dx = segA.end.x - segA.start.x, dz = segA.end.z - segA.start.z;
							const l = Math.hypot(dx, dz);
							return l > 1e-5 ? Math.abs(dz * (p.x - segA.start.x) - dx * (p.z - segA.start.z)) / l : 0;
						};
						const d1 = distP(segB.start), d2 = distP(segB.end);
						const maxD = Math.max(d1, d2);
						if (maxD > tol && sharedEv.length === 0 && segA.logicalObjectId !== segB.logicalObjectId) {
							// Separated by gap (e.g. corridor) without shared barrier evidence
							continue;
						}

						totalSharedLength += overlap.overlapLen;
						if (!bestStart || !bestEnd || overlap.overlapLen > Math.hypot(bestEnd.x - bestStart.x, bestEnd.z - bestStart.z)) {
							bestStart = overlap.start;
							bestEnd = overlap.end;
						}
						for (const id of segA.sourceEvidenceIds) sourceBoundaryIds.add(id);
						for (const id of segB.sourceEvidenceIds) sourceBoundaryIds.add(id);
						sourceBoundaryIds.add(segA.id);
						sourceBoundaryIds.add(segB.id);
						bestConfidence = Math.min(bestConfidence, segA.confidence, segB.confidence);

						if (segA.openingEvidenceId && segA.openingEvidenceId === segB.openingEvidenceId) {
							isConnectedByBridge = true;
							bridgeOpeningId = segA.openingEvidenceId;
						}
					}
				}
			}

			if (totalSharedLength > tol && bestStart && bestEnd) {
				const sharedId = generateSharedRoomBoundaryId(rA.id, rB.id, bestStart, bestEnd);
				const segment: RoomBoundarySegment = {
					id: sharedId,
					kind: 'wall',
					start: bestStart,
					end: bestEnd,
					sourceEvidenceIds: Array.from(sourceBoundaryIds),
					confidence: bestConfidence
				};
				sharedBoundaries.push({
					id: sharedId,
					roomAId: rA.id,
					roomBId: rB.id,
					storeyId: rA.storeyId,
					length: totalSharedLength,
					segment,
					sourceBoundaryIds: Array.from(sourceBoundaryIds),
					confidence: bestConfidence
				});

				// If connected by opening bridge directly during loop building
				if (isConnectedByBridge) {
					const connId = generateRoomConnectionId(rA.id, rB.id, bridgeOpeningId, 'opening');
					if (!connections.some((c) => c.id === connId)) {
						connections.push({
							id: connId,
							fromRoomId: rA.id,
							toRoomId: rB.id,
							storeyId: rA.storeyId,
							type: 'opening',
							openingId: bridgeOpeningId,
							sourceEvidenceIds: bridgeOpeningId ? [bridgeOpeningId] : [],
							traversable: true,
							confidence: bestConfidence,
							evidence: {
								sourceOpeningIds: bridgeOpeningId ? [bridgeOpeningId] : [],
								sourceBoundaryIds: [sharedId],
								logicalObjectIds: []
							}
						});
					}
				}
			}
		}
	}

	// 2. Associate Openings with Rooms
	for (const op of openings) {
		const matchingRooms = validRooms.filter((r) => {
			// Check if room touches or contains opening segment
			return r.evidence.boundarySegments.some((seg) => {
				if (seg.openingEvidenceId === op.id || seg.sourceEvidenceIds.includes(op.id)) return true;
				const overlap = computeCollinearOverlap(seg, op.segment, tol);
				return overlap !== null;
			});
		});

		if (matchingRooms.length === 0) {
			diagnostics.openingsWithoutSupportingWalls++;
		} else if (matchingRooms.length === 1) {
			const rA = matchingRooms[0];
			const extType = op.openingType;
			const extId = generateExteriorConnectionId(rA.id, op.id, extType);
			if (!exteriorConnections.some((e) => e.id === extId)) {
				exteriorConnections.push({
					id: extId,
					roomId: rA.id,
					storeyId: rA.storeyId,
					type: extType,
					openingId: op.id,
					sourceEvidenceIds: [op.id, ...op.classificationUnitIds],
					width: op.width,
					sillElevation: op.elevationRange.min,
					headElevation: op.elevationRange.max,
					traversable: extType === 'door' || extType === 'opening',
					confidence: op.quality
				});
			}
		} else {
			if (matchingRooms.length > 2) {
				diagnostics.openingsAssociatedWithMoreThanTwoRooms++;
			}
			const rA = matchingRooms[0];
			const rB = matchingRooms[1];

			// Check alignment with shared wall or between rooms
			const shared = sharedBoundaries.find(
				(b) => (b.roomAId === rA.id && b.roomBId === rB.id) || (b.roomAId === rB.id && b.roomBId === rA.id)
			);
			const isAligned = shared
				? computeCollinearOverlap(shared.segment, op.segment, 0.6) !== null
				: true;

			if (!isAligned && op.openingType === 'door') {
				// Door not aligned with shared wall -> do not fabricate connection
				continue;
			}

			const connType = op.openingType === 'door' ? 'door' : op.openingType === 'window' ? 'window' : 'opening';
			if (connType === 'window') {
				// Window between room and exterior/interior is not traversable
				const extId = generateExteriorConnectionId(rA.id, op.id, 'window');
				if (!exteriorConnections.some((e) => e.id === extId)) {
					exteriorConnections.push({
						id: extId,
						roomId: rA.id,
						storeyId: rA.storeyId,
						type: 'window',
						openingId: op.id,
						sourceEvidenceIds: [op.id, ...op.classificationUnitIds],
						width: op.width,
						sillElevation: op.elevationRange.min,
						headElevation: op.elevationRange.max,
						traversable: false,
						confidence: op.quality
					});
				}
				continue;
			}

			const connId = generateRoomConnectionId(rA.id, rB.id, op.id, connType);
			const existingConn = connections.find((c) => {
				if (c.id === connId) return true;
				const isSamePair = (c.fromRoomId === rA.id && c.toRoomId === rB.id) || (c.fromRoomId === rB.id && c.toRoomId === rA.id);
				if (!isSamePair || c.type !== connType) return false;
				if (c.openingId === op.id) return true;
				if (c.evidence.segment && computeCollinearOverlap(c.evidence.segment, op.segment, 0.8) !== null) return true;
				return false;
			});
			if (existingConn) {
				diagnostics.duplicateRoomConnections++;
				if (!existingConn.sourceEvidenceIds.includes(op.id)) existingConn.sourceEvidenceIds.push(op.id);
				if (!existingConn.evidence.sourceOpeningIds.includes(op.id)) existingConn.evidence.sourceOpeningIds.push(op.id);
			} else {
				connections.push({
					id: connId,
					fromRoomId: rA.id,
					toRoomId: rB.id,
					storeyId: rA.storeyId,
					type: connType,
					openingId: op.id,
					sourceEvidenceIds: [op.id, ...op.classificationUnitIds],
					width: op.width,
					sillElevation: op.elevationRange.min,
					headElevation: op.elevationRange.max,
					traversable: true,
					confidence: op.quality,
					evidence: {
						sourceOpeningIds: [op.id],
						sourceBoundaryIds: shared ? [shared.id] : [],
						logicalObjectIds: [op.logicalObjectId],
						segment: op.segment
					}
				});
			}
		}
	}

	// 3. Vertical connections across adjacent storeys
	for (let i = 0; i < validRooms.length; i++) {
		for (let j = i + 1; j < validRooms.length; j++) {
			const rLow = validRooms[i];
			const rHigh = validRooms[j];
			if (rLow.storeyId === rHigh.storeyId) continue;

			// Check elevation adjacency
			const elDiff = Math.abs(rLow.ceilingElevation - rHigh.floorElevation);
			const elDiffRev = Math.abs(rHigh.ceilingElevation - rLow.floorElevation);
			if (elDiff > 2.0 && elDiffRev > 2.0) continue;

			// Check 2D plan overlap
			if (!pointPolygonOverlapArea(rLow.boundary2D, rHigh.boundary2D)) continue;

			// Require explicit vertical circulation evidence in classification or logical object name
			const hasVerticalEv = (r: DetectedRoom) => {
				const str = `${r.id} ${r.sourceEnvelopeIds.join(' ')} ${r.sourceBoundaryIds.join(' ')}`.toLowerCase();
				return str.includes('stair') || str.includes('tangga') || str.includes('ramp') || str.includes('lift') || str.includes('elevator');
			};

			if (hasVerticalEv(rLow) || hasVerticalEv(rHigh)) {
				const connId = generateRoomConnectionId(rLow.id, rHigh.id, undefined, 'vertical_connection');
				if (!connections.some((c) => c.id === connId)) {
					connections.push({
						id: connId,
						fromRoomId: rLow.id,
						toRoomId: rHigh.id,
						storeyId: rLow.storeyId,
						type: 'vertical_connection',
						sourceEvidenceIds: [],
						traversable: true,
						confidence: 0.8,
						evidence: {
							sourceOpeningIds: [],
							sourceBoundaryIds: [],
							logicalObjectIds: []
						}
					});
				}
			}
		}
	}

	// 4. Unshared Boundaries & Unresolved Exterior diagnostics
	for (const r of validRooms) {
		for (const seg of r.evidence.boundarySegments) {
			const isShared = sharedBoundaries.some(
				(b) => (b.roomAId === r.id || b.roomBId === r.id) && computeCollinearOverlap(b.segment, seg, tol) !== null
			);
			if (!isShared && seg.kind === 'inferred') {
				diagnostics.unresolvedExteriorFacingBoundaries++;
			}
		}
	}

	// 5. Assemble Nodes
	const rooms: RoomTopologyNode[] = validRooms.map((r) => {
		const boundaryRoomIds = sharedBoundaries
			.filter((b) => b.roomAId === r.id || b.roomBId === r.id)
			.map((b) => (b.roomAId === r.id ? b.roomBId : b.roomAId))
			.sort();

		const connectionIds = connections
			.filter((c) => c.fromRoomId === r.id || c.toRoomId === r.id)
			.map((c) => c.id)
			.sort();

		const exteriorConnectionIds = exteriorConnections
			.filter((e) => e.roomId === r.id)
			.map((e) => e.id)
			.sort();

		if (boundaryRoomIds.length === 0) {
			diagnostics.isolatedRooms++;
		}

		return {
			roomId: r.id,
			storeyId: r.storeyId,
			centroid: r.centroid,
			floorArea: r.floorArea,
			boundaryRoomIds: Array.from(new Set(boundaryRoomIds)),
			connectionIds: Array.from(new Set(connectionIds)),
			exteriorConnectionIds: Array.from(new Set(exteriorConnectionIds))
		};
	});

	const graph: RoomTopologyGraph = {
		rooms,
		connections,
		sharedBoundaries,
		exteriorConnections,
		diagnostics
	};

	diagnostics.roomsWithoutAccess = findRoomsWithoutAccess(graph).length;

	return {
		graph,
		fingerprint: calculateRoomTopologyFingerprint(graph)
	};
}

// ─── Reusable Graph Queries ───────────────────────────────────────────────────

export function getAdjacentRooms(graph: RoomTopologyGraph, roomId: string): string[] {
	const node = graph.rooms.find((r) => r.roomId === roomId);
	return node ? node.boundaryRoomIds : [];
}

export function getConnectedRooms(graph: RoomTopologyGraph, roomId: string): string[] {
	const node = graph.rooms.find((r) => r.roomId === roomId);
	if (!node) return [];
	const connected = new Set<string>();
	for (const conn of graph.connections) {
		if (!conn.traversable) continue;
		if (conn.fromRoomId === roomId) connected.add(conn.toRoomId);
		else if (conn.toRoomId === roomId) connected.add(conn.fromRoomId);
	}
	return Array.from(connected).sort();
}

export function getExteriorConnections(graph: RoomTopologyGraph, roomId: string): ExteriorRoomConnection[] {
	return graph.exteriorConnections.filter((c) => c.roomId === roomId);
}

export function getSharedBoundary(graph: RoomTopologyGraph, roomAId: string, roomBId: string): SharedRoomBoundary | undefined {
	return graph.sharedBoundaries.find(
		(b) => (b.roomAId === roomAId && b.roomBId === roomBId) || (b.roomAId === roomBId && b.roomBId === roomAId)
	);
}

export function getRoomDegree(graph: RoomTopologyGraph, roomId: string): number {
	const connected = getConnectedRooms(graph, roomId);
	const extTraversable = graph.exteriorConnections.filter((c) => c.roomId === roomId && c.traversable).length;
	return connected.length + extTraversable;
}

export function isRoomReachable(graph: RoomTopologyGraph, fromRoomId: string, toRoomId: string): boolean {
	if (fromRoomId === toRoomId) return true;
	const visited = new Set<string>([fromRoomId]);
	const queue = [fromRoomId];
	while (queue.length > 0) {
		const curr = queue.shift()!;
		const neighbors = getConnectedRooms(graph, curr);
		for (const next of neighbors) {
			if (next === toRoomId) return true;
			if (!visited.has(next)) {
				visited.add(next);
				queue.push(next);
			}
		}
	}
	return false;
}

export function findConnectedComponents(graph: RoomTopologyGraph): string[][] {
	const visited = new Set<string>();
	const components: string[][] = [];
	const sortedRooms = [...graph.rooms].map((r) => r.roomId).sort();
	for (const roomId of sortedRooms) {
		if (visited.has(roomId)) continue;
		const comp: string[] = [];
		const queue = [roomId];
		visited.add(roomId);
		while (queue.length > 0) {
			const curr = queue.shift()!;
			comp.push(curr);
			const neighbors = getConnectedRooms(graph, curr);
			for (const next of neighbors) {
				if (!visited.has(next)) {
					visited.add(next);
					queue.push(next);
				}
			}
		}
		comp.sort();
		components.push(comp);
	}
	return components;
}

export function findRoomsWithoutAccess(graph: RoomTopologyGraph): string[] {
	return graph.rooms
		.filter((r) => getRoomDegree(graph, r.roomId) === 0)
		.map((r) => r.roomId)
		.sort();
}
