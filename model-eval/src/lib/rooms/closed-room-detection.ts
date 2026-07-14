/**
 * closed-room-detection.ts
 *
 * Task 3B.3 — Convert validated geometric evidence into DetectedRoom objects.
 *
 * Pipeline:
 *   RankedBoundaryLoopCandidate (validated, eligible envelopes)
 *     -> polygon extraction from graph nodes
 *     -> polygon validation (area, perimeter, winding, sliver filter)
 *     -> opening-bridge pass (constrained gap closure for doorways)
 *     -> hole/shaft detection (nested loops)
 *     -> vertical extent from RefinedVerticalEnvelopeCandidate
 *     -> storey grouping
 *     -> deduplication
 *     -> DetectedRoom output
 */

import type {
	RankedBoundaryLoopCandidate,
	RefinedVerticalEnvelopeCandidate,
	PlanCoord,
	PlanBounds,
	BoundaryOpeningEvidence
} from './types';
import type { NormalizedBarrierGraph } from './helpers';
import {
	generateDetectedRoomId,
	generateRoomBoundarySegmentId,
	signedArea2D,
	polygonArea,
	polygonPerimeter,
	polygonBounds,
	centroid2D,
	ensureCCW,
	ensureCW,
	isPolygonInsidePolygon,
	calculateDetectedRoomFingerprint,
	type DetectedRoom,
	type DetectedRoomResult,
	type DetectedRoomStatus,
	type RoomBoundarySegment,
	type RoomBoundarySegmentKind,
	type RoomDetectionEvidence,
	type RoomDetectionDiagnostic,
	type RoomConfidence,
	type RoomConfidenceLevel,
	type RoomDetectionDiagnostics,
	type Point3D,
	type BoundingBox3D
} from './detected-room';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum room floor area in m². Derived from model scale in practice. */
const MIN_ROOM_AREA_M2 = 0.25;

/** Maximum bridge length relative to model bounding diagonal. */
const MAX_BRIDGE_LENGTH_RELATIVE = 0.05;

/** Minimum fraction of boundary that must be direct wall evidence. */
const MIN_DIRECT_BOUNDARY_FRACTION = 0.0; // allow fully inferred for secondary rooms

/** Maximum aspect ratio (bounding box) before flagging as sliver. */
const MAX_SLIVER_ASPECT_RATIO = 25;

/** Area fraction threshold for hole deduplication vs separate room. */
const HOLE_AREA_RELATIVE_THRESHOLD = 0.85;

// ─── Public API types ─────────────────────────────────────────────────────────

export interface ClosedRoomDetectionInput {
	loops: RankedBoundaryLoopCandidate[];
	envelopes: RefinedVerticalEnvelopeCandidate[];
	graphs: NormalizedBarrierGraph[];
	openings?: BoundaryOpeningEvidence[];
	/** Model bounding-box diagonal — used for scale-relative thresholds */
	modelDiagonalM?: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function dist2D(a: PlanCoord, b: PlanCoord): number {
	const dx = b.x - a.x, dz = b.z - a.z;
	return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Extract the 2D plan polygon for a loop from the normalized barrier graph.
 * Returns null if fewer than 3 valid coordinates are found.
 */
function extractLoopPolygon(
	loop: RankedBoundaryLoopCandidate,
	graphsByStorey: Map<string, NormalizedBarrierGraph>
): PlanCoord[] | null {
	// If loop carries planPolygon directly (set by findBoundaryLoopCandidates)
	if (Array.isArray((loop as any).planPolygon) && (loop as any).planPolygon.length >= 3) {
		return (loop as any).planPolygon as PlanCoord[];
	}

	// Reconstruct from node IDs via graph
	const graph = graphsByStorey.get(loop.storeyCandidateId);
	if (!graph || !loop.nodeIds || loop.nodeIds.length < 3) return null;

	const nodeMap = new Map(graph.nodes.map((n) => [n.id, n.coord]));
	const coords: PlanCoord[] = [];
	for (const nid of loop.nodeIds) {
		const c = nodeMap.get(nid);
		if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) return null;
		coords.push({ x: c.x, z: c.z });
	}
	return coords.length >= 3 ? coords : null;
}

/**
 * Collect boundary segments for a loop from the graph edges.
 */
function extractBoundarySegments(
	loop: RankedBoundaryLoopCandidate,
	graph: NormalizedBarrierGraph | undefined
): RoomBoundarySegment[] {
	if (!graph) return [];

	const edgeSet = new Set(loop.edgeIds);
	const segments: RoomBoundarySegment[] = [];

	for (const edge of graph.edges) {
		if (!edgeSet.has(edge.id)) continue;
		const kind: RoomBoundarySegmentKind = 'wall';
		segments.push({
			id: generateRoomBoundarySegmentId(kind, edge.start, edge.end),
			kind,
			start: { x: edge.start.x, z: edge.start.z },
			end: { x: edge.end.x, z: edge.end.z },
			sourceEvidenceIds: [...edge.verticalEvidenceIds],
			logicalObjectId: edge.logicalObjectId,
			confidence: 1.0
		});
	}

	return segments;
}

/**
 * Check if a polygon is likely a sliver (too narrow relative to its area).
 */
function isSliverPolygon(pts: PlanCoord[], modelDiagonalM: number): boolean {
	const area = polygonArea(pts);
	const bounds = polygonBounds(pts);
	const width = bounds.max.x - bounds.min.x;
	const depth = bounds.max.z - bounds.min.z;

	// Absolute minimum area
	if (area < MIN_ROOM_AREA_M2) return true;

	// Extreme aspect ratio relative to area
	const shortSide = Math.min(width, depth);
	const longSide = Math.max(width, depth);
	if (shortSide < 1e-6) return true;
	if (longSide / shortSide > MAX_SLIVER_ASPECT_RATIO) return true;

	// Minimum width relative to model scale
	const minWidth = Math.max(0.1, modelDiagonalM * 0.005);
	if (shortSide < minWidth) return true;

	return false;
}

/**
 * Try to apply constrained opening bridges across gaps associated with recognized openings.
 * Returns the polygon with the gap bridged, plus a bridge segment, or null if no gap found.
 */
function applyOpeningBridges(
	polygon: PlanCoord[],
	openings: BoundaryOpeningEvidence[],
	modelDiagonalM: number,
	sourceBoundarySegments: RoomBoundarySegment[]
): { polygon: PlanCoord[]; bridges: RoomBoundarySegment[] } {
	// In 3B.3, our loops are already closed cycles from the graph.
	// Opening bridging applies when the loop explicitly has open ends,
	// but in the planar graph approach, all loops are already closed.
	// We detect "gap edges" in the polygon by finding consecutive vertices
	// where the distance exceeds a threshold and an opening lies within that gap.
	const bridges: RoomBoundarySegment[] = [];
	const maxBridge = modelDiagonalM * MAX_BRIDGE_LENGTH_RELATIVE;

	// Find the largest gap between consecutive vertices
	const n = polygon.length;
	for (let i = 0; i < n; i++) {
		const a = polygon[i];
		const b = polygon[(i + 1) % n];
		const d = dist2D(a, b);

		// Only consider gaps larger than expected wall thickness
		if (d < 0.5 || d > maxBridge * 4) continue;

		// Check if a recognized opening lies in this gap
		const midX = (a.x + b.x) / 2;
		const midZ = (a.z + b.z) / 2;
		const matchedOpening = openings.find((op) => {
			const oMidX = (op.segment.start.x + op.segment.end.x) / 2;
			const oMidZ = (op.segment.start.z + op.segment.end.z) / 2;
			const od = Math.sqrt((oMidX - midX) ** 2 + (oMidZ - midZ) ** 2);
			return od < maxBridge && op.width <= d * 1.5;
		});

		if (matchedOpening) {
			bridges.push({
				id: generateRoomBoundarySegmentId('opening_bridge', a, b),
				kind: 'opening_bridge',
				start: a,
				end: b,
				sourceEvidenceIds: [],
				openingEvidenceId: matchedOpening.id,
				confidence: 0.6
			});
		}
	}

	return { polygon, bridges };
}

/**
 * Compute confidence for a detected room.
 */
function computeConfidence(
	directFraction: number,
	bridges: RoomBoundarySegment[],
	envelope: RefinedVerticalEnvelopeCandidate,
	hasHoles: boolean,
	snappedCount: number
): RoomConfidence {
	const penalties: string[] = [];
	let score = 1.0;

	// Boundary completeness
	if (directFraction < 0.5) {
		score -= 0.3;
		penalties.push('low_direct_boundary_fraction');
	} else if (directFraction < 0.8) {
		score -= 0.1;
		penalties.push('moderate_direct_boundary_fraction');
	}

	// Opening bridges
	if (bridges.length > 0) {
		score -= 0.05 * bridges.length;
		penalties.push(`opening_bridge_x${bridges.length}`);
	}

	// Envelope eligibility
	if (!envelope.eligibleForRoomAssembly) {
		score -= 0.2;
		penalties.push('envelope_ineligible');
	}

	// Envelope score
	if (envelope.refinedScore < 50) {
		score -= 0.1;
		penalties.push('low_envelope_score');
	}

	// Vertical extent quality
	if (envelope.qualityFlags.missingUpper) {
		score -= 0.15;
		penalties.push('missing_ceiling_evidence');
	}
	if (envelope.qualityFlags.missingLower) {
		score -= 0.15;
		penalties.push('missing_floor_evidence');
	}

	// Snapping
	if (snappedCount > 4) {
		score -= 0.05;
		penalties.push('excessive_endpoint_snapping');
	}

	score = Math.max(0, Math.min(1, score));

	let level: RoomConfidenceLevel;
	if (score >= 0.75) level = 'high';
	else if (score >= 0.45) level = 'medium';
	else level = 'low';

	return { score, level, penalties };
}

/**
 * Assign vertical extent from a refined envelope.
 */
function assignVerticalExtent(
	envelope: RefinedVerticalEnvelopeCandidate
): {
	floorElevation: number;
	ceilingElevation: number;
	height: number;
	ambiguous: boolean;
} {
	// Use the robust profile span if available
	const profile = envelope.verticalExtentProfile;
	const robustBase = profile?.robustBase ?? envelope.lowerElevation;
	const robustTop = profile?.robustTop ?? envelope.upperElevation;
	const height = robustTop - robustBase;

	const ambiguous =
		envelope.qualityFlags.missingUpper ||
		envelope.qualityFlags.missingLower ||
		height <= 0 ||
		!Number.isFinite(height);

	return {
		floorElevation: Number.isFinite(robustBase) ? robustBase : envelope.lowerElevation,
		ceilingElevation: Number.isFinite(robustTop) ? robustTop : envelope.upperElevation,
		height: Number.isFinite(height) && height > 0 ? height : envelope.clearHeight,
		ambiguous
	};
}

/**
 * Check if two rooms are likely duplicates (high polygon overlap + same storey).
 */
function areDuplicateRooms(a: DetectedRoom, b: DetectedRoom): boolean {
	if (a.storeyId !== b.storeyId) return false;

	// Quick centroid proximity check
	const dx = a.centroid.x - b.centroid.x;
	const dz = a.centroid.z - b.centroid.z;
	const centroidDist = Math.sqrt(dx * dx + dz * dz);
	const avgSize = Math.sqrt((a.floorArea + b.floorArea) / 2);
	if (centroidDist > avgSize * 0.5) return false;

	// Area similarity
	const areaRatio = Math.min(a.floorArea, b.floorArea) / Math.max(a.floorArea, b.floorArea);
	if (areaRatio < 0.5) return false;

	// Source envelope overlap
	const aEnvSet = new Set(a.sourceEnvelopeIds);
	const overlap = b.sourceEnvelopeIds.filter((id) => aEnvSet.has(id)).length;
	if (overlap > 0) return true;

	// Fallback: if areas and centroids are very close
	return areaRatio > 0.9 && centroidDist < avgSize * 0.1;
}

/**
 * Select the better of two duplicate room candidates.
 * Prefer higher confidence, more direct boundary evidence.
 */
function selectBetterRoom(a: DetectedRoom, b: DetectedRoom): DetectedRoom {
	if (a.confidence.score > b.confidence.score) return a;
	if (b.confidence.score > a.confidence.score) return b;
	// Tie-break by direct boundary fraction
	if (
		a.evidence.directBoundaryFraction > b.evidence.directBoundaryFraction
	)
		return a;
	return b;
}

// ─── Main detection function ──────────────────────────────────────────────────

/**
 * Detect closed rooms from validated loop candidates and refined envelopes.
 *
 * This converts the output of the preceding pipeline stages (3B.2) into
 * stable DetectedRoom objects representing enclosed architectural spaces.
 */
export function detectClosedRooms(input: ClosedRoomDetectionInput): DetectedRoomResult {
	const { loops, envelopes, graphs, openings = [] } = input;
	const modelDiagonalM = input.modelDiagonalM ?? 50;

	// Build graph lookup by storey
	const graphsByStorey = new Map<string, NormalizedBarrierGraph>();
	for (const g of graphs) {
		graphsByStorey.set(g.storeyCandidateId, g);
	}

	// Build envelope lookup by loop ID
	const envelopesByLoop = new Map<string, RefinedVerticalEnvelopeCandidate[]>();
	for (const env of envelopes) {
		if (!env.eligibleForRoomAssembly) continue;
		const list = envelopesByLoop.get(env.loopCandidateId) ?? [];
		list.push(env);
		envelopesByLoop.set(env.loopCandidateId, list);
	}

	const diag: RoomDetectionDiagnostics = {
		loopsInspected: 0,
		closedCyclesFound: 0,
		roomsAccepted: 0,
		roomsAmbiguous: 0,
		roomsRejected: 0,
		sliverRoomsRejected: 0,
		exteriorFacesExcluded: 0,
		holesSubtracted: 0,
		openingBridgesApplied: 0,
		deduplicatedRooms: 0,
		openEndpointsUnresolved: 0
	};

	const candidates: DetectedRoom[] = [];

	// Process each non-noise loop
	for (const loop of loops) {
		if (loop.status === 'noise') continue;
		diag.loopsInspected++;

		// Must have eligible envelopes
		const loopEnvelopes = envelopesByLoop.get(loop.id) ?? [];
		if (loopEnvelopes.length === 0) continue;

		// Select best envelope (highest refinedScore, then id)
		const envelope = [...loopEnvelopes].sort((a, b) => {
			const sd = b.refinedScore - a.refinedScore;
			return Math.abs(sd) > 1e-6 ? sd : a.id.localeCompare(b.id);
		})[0];

		// Extract polygon
		const rawPoly = extractLoopPolygon(loop, graphsByStorey);
		if (!rawPoly || rawPoly.length < 3) continue;

		diag.closedCyclesFound++;

		// Validate polygon
		const area = polygonArea(rawPoly);
		const perim = polygonPerimeter(rawPoly);

		if (!Number.isFinite(area) || !Number.isFinite(perim)) continue;
		if (area <= 0 || perim <= 0) {
			diag.roomsRejected++;
			continue;
		}

		// Sliver filter
		if (isSliverPolygon(rawPoly, modelDiagonalM)) {
			diag.sliverRoomsRejected++;
			diag.roomsRejected++;
			continue;
		}

		// Get graph for this storey
		const graph = graphsByStorey.get(loop.storeyCandidateId);

		// Extract boundary segments
		const boundarySeg = extractBoundarySegments(loop, graph);
		const snappedCount = graph?.normalizationDiagnostics?.endpointsSnapped ?? 0;

		// Apply opening bridges
		const bridgeResult = applyOpeningBridges(rawPoly, openings, modelDiagonalM, boundarySeg);
		const allSegments = [...boundarySeg, ...bridgeResult.bridges];
		diag.openingBridgesApplied += bridgeResult.bridges.length;

		// Normalize winding — CCW for exterior boundary
		const polygon = ensureCCW(rawPoly);

		// Compute direct vs inferred fractions
		const directSegs = allSegments.filter((s) => s.kind === 'wall');
		const directLen = directSegs.reduce((s, seg) => s + dist2D(seg.start, seg.end), 0);
		const totalLen = allSegments.reduce((s, seg) => s + dist2D(seg.start, seg.end), 0);
		const directFraction = totalLen > 0 ? directLen / totalLen : 0;

		// Assign vertical extent
		const extent = assignVerticalExtent(envelope);

		// Build diagnostics list
		const roomDiagnostics: RoomDetectionDiagnostic[] = [];
		if (extent.ambiguous) {
			roomDiagnostics.push({ code: 'missing_ceiling', message: 'Ceiling elevation is unresolved or inconsistent.' });
		}
		if (bridgeResult.bridges.length > 0) {
			roomDiagnostics.push({ code: 'opening_bridge_used', message: `${bridgeResult.bridges.length} constrained opening bridge(s) applied.` });
		}
		if (snappedCount > 0) {
			roomDiagnostics.push({ code: 'snapped_endpoints', message: `${snappedCount} endpoint(s) snapped during graph normalization.` });
		}
		if (signedArea2D(polygon) < 0) {
			// polygon is CW — concave handling note
			roomDiagnostics.push({ code: 'concave_polygon', message: 'Polygon may be concave; winding enforced.' });
		}

		// Compute confidence
		const confidence = computeConfidence(
			directFraction,
			bridgeResult.bridges,
			envelope,
			false,
			snappedCount
		);

		// Determine status
		let status: DetectedRoomStatus;
		if (extent.ambiguous || confidence.level === 'low') {
			status = 'ambiguous';
			diag.roomsAmbiguous++;
		} else {
			status = 'valid';
			diag.roomsAccepted++;
		}

		// Compute centroid and volume
		const planCentroid = centroid2D(polygon);
		const midElevation = (extent.floorElevation + extent.ceilingElevation) / 2;
		const centroid: Point3D = { x: planCentroid.x, y: midElevation, z: planCentroid.z };
		const estimatedVolume = area * extent.height;

		const bounds = polygonBounds(polygon);
		const bbox: BoundingBox3D = {
			min: { x: bounds.min.x, y: extent.floorElevation, z: bounds.min.z },
			max: { x: bounds.max.x, y: extent.ceilingElevation, z: bounds.max.z }
		};

		const evidence: RoomDetectionEvidence = {
			sourceLoopId: loop.id,
			sourceEnvelopeIds: [envelope.id],
			sourceBoundaryEdgeIds: loop.edgeIds,
			boundarySegments: allSegments,
			hasOpeningBridges: bridgeResult.bridges.length > 0,
			inferredSegmentCount: allSegments.filter((s) => s.kind !== 'wall').length,
			directSegmentCount: directSegs.length,
			directBoundaryFraction: directFraction
		};

		const id = generateDetectedRoomId(loop.storeyCandidateId, polygon);

		candidates.push({
			id,
			storeyId: loop.storeyCandidateId,
			boundary2D: polygon,
			holes2D: [],
			floorElevation: extent.floorElevation,
			ceilingElevation: extent.ceilingElevation,
			height: extent.height,
			floorArea: area,
			perimeter: perim,
			estimatedVolume,
			centroid,
			boundingBox: bbox,
			planBounds: bounds,
			sourceEnvelopeIds: [envelope.id],
			sourceBoundaryIds: loop.edgeIds,
			confidence,
			status,
			evidence,
			diagnostics: roomDiagnostics
		});
	}

	// ─── Hole detection: classify nested loops ────────────────────────────────

	// For each pair of same-storey candidates, check if one is inside the other.
	// If inner area is much smaller than outer, treat inner as a hole.
	// Sort by area descending so outer rooms are processed first.
	const sortedByArea = [...candidates].sort((a, b) => b.floorArea - a.floorArea);

	for (let i = 0; i < sortedByArea.length; i++) {
		const outer = sortedByArea[i];
		for (let j = i + 1; j < sortedByArea.length; j++) {
			const inner = sortedByArea[j];
			if (outer.storeyId !== inner.storeyId) continue;
			if (inner.floorArea >= outer.floorArea * HOLE_AREA_RELATIVE_THRESHOLD) continue;

			// Check containment
			if (isPolygonInsidePolygon(inner.boundary2D, outer.boundary2D)) {
				// Mark inner as a hole of outer, unless inner has independent valid envelope evidence
				const innerHasOwnEnvelopes = (envelopesByLoop.get(inner.evidence.sourceLoopId) ?? [])
					.filter((e) => !outer.sourceEnvelopeIds.includes(e.id)).length > 0;

				if (!innerHasOwnEnvelopes) {
					// Add inner as a hole to outer
					const hole = ensureCW(inner.boundary2D);
					if (!outer.holes2D.find((h) => h === hole)) {
						outer.holes2D.push(hole);
						// Subtract hole area from outer floor area
						outer.floorArea = Math.max(0, outer.floorArea - inner.floorArea);
						outer.estimatedVolume = outer.floorArea * outer.height;
						outer.diagnostics.push({
							code: 'hole_subtracted',
							message: `Hole (shaft/core) ${inner.id} subtracted from floor area.`
						});
						diag.holesSubtracted++;
						// Mark inner as rejected (it's a hole, not an independent room)
						inner.status = 'rejected';
					}
				}
			}
		}
	}

	// ─── Deduplication ────────────────────────────────────────────────────────

	const deduplicated: DetectedRoom[] = [];
	const usedIds = new Set<string>();

	for (const room of candidates) {
		if (room.status === 'rejected') continue;
		if (usedIds.has(room.id)) continue;

		let best = room;
		for (const other of candidates) {
			if (other.id === room.id || usedIds.has(other.id)) continue;
			if (other.status === 'rejected') continue;
			if (areDuplicateRooms(best, other)) {
				best = selectBetterRoom(best, other);
				usedIds.add(other.id);
				diag.deduplicatedRooms++;
			}
		}

		usedIds.add(best.id);
		deduplicated.push(best);
	}

	// Final status tallies
	const finalRooms = deduplicated;
	diag.roomsAccepted = finalRooms.filter((r) => r.status === 'valid').length;
	diag.roomsAmbiguous = finalRooms.filter((r) => r.status === 'ambiguous').length;
	diag.roomsRejected = candidates.filter((r) => r.status === 'rejected').length;

	const fingerprint = calculateDetectedRoomFingerprint(finalRooms);

	return { rooms: finalRooms, diagnostics: diag, fingerprint };
}
