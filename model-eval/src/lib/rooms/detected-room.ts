/**
 * detected-room.ts
 *
 * DetectedRoom type contract and ID generation for Task 3B.3.
 * Represents a validated enclosed architectural space derived from
 * the barrier graph, loop candidates, and refined vertical envelopes.
 */

import type { PlanCoord, PlanBounds } from './types';
import { quantizeCoord } from './helpers';
import { sha256Hex } from './hash';

// ─── Coordinate types ─────────────────────────────────────────────────────────

export interface Point3D {
	x: number;
	y: number; // vertical (elevation)
	z: number;
}

export interface BoundingBox3D {
	min: Point3D;
	max: Point3D;
}

// ─── Evidence and diagnostic types ────────────────────────────────────────────

export type RoomBoundarySegmentKind =
	| 'wall'          // direct wall evidence
	| 'inferred'      // derived from loop/graph topology without direct wall
	| 'opening_bridge'; // constrained bridge across recognized opening

export interface RoomBoundarySegment {
	id: string;
	kind: RoomBoundarySegmentKind;
	start: PlanCoord;
	end: PlanCoord;
	/** wall/barrier evidence IDs driving this segment */
	sourceEvidenceIds: string[];
	logicalObjectId?: string;
	/** for opening_bridge: the opening evidence ID */
	openingEvidenceId?: string;
	confidence: number;
}

export interface RoomDetectionEvidence {
	sourceLoopId: string;
	sourceEnvelopeIds: string[];
	sourceBoundaryEdgeIds: string[];
	boundarySegments: RoomBoundarySegment[];
	hasOpeningBridges: boolean;
	inferredSegmentCount: number;
	directSegmentCount: number;
	/** fraction of boundary that is direct wall evidence */
	directBoundaryFraction: number;
}

export type RoomDetectionDiagnosticCode =
	| 'missing_ceiling'
	| 'missing_floor'
	| 'ambiguous_storey'
	| 'low_boundary_coverage'
	| 'opening_bridge_used'
	| 'snapped_endpoints'
	| 'duplicate_evidence_merged'
	| 'concave_polygon'
	| 'hole_subtracted'
	| 'exterior_face_excluded';

export interface RoomDetectionDiagnostic {
	code: RoomDetectionDiagnosticCode;
	message: string;
}

// ─── Confidence ───────────────────────────────────────────────────────────────

export type RoomConfidenceLevel = 'high' | 'medium' | 'low';

export interface RoomConfidence {
	score: number; // 0–1
	level: RoomConfidenceLevel;
	/** Factors that reduced confidence */
	penalties: string[];
}

// ─── Main DetectedRoom contract ───────────────────────────────────────────────

export type DetectedRoomStatus = 'valid' | 'ambiguous' | 'rejected';

export interface DetectedRoom {
	id: string;
	storeyId: string;

	/** Outer boundary in plan (XZ) coordinates. CCW winding = interior. */
	boundary2D: PlanCoord[];
	/** Interior holes (shafts, columns). CW winding = interior of hole. */
	holes2D: PlanCoord[][];

	floorElevation: number;
	ceilingElevation: number;
	height: number;

	/** Net floor area excluding holes (m²) */
	floorArea: number;
	/** Outer boundary perimeter (m) */
	perimeter: number;
	estimatedVolume: number;

	centroid: Point3D;
	boundingBox: BoundingBox3D;
	planBounds: PlanBounds;

	sourceEnvelopeIds: string[];
	sourceBoundaryIds: string[];

	confidence: RoomConfidence;
	status: DetectedRoomStatus;

	evidence: RoomDetectionEvidence;
	diagnostics: RoomDetectionDiagnostic[];
}

// ─── Detection result ─────────────────────────────────────────────────────────

export interface RoomDetectionDiagnostics {
	loopsInspected: number;
	closedCyclesFound: number;
	roomsAccepted: number;
	roomsAmbiguous: number;
	roomsRejected: number;
	sliverRoomsRejected: number;
	exteriorFacesExcluded: number;
	holesSubtracted: number;
	openingBridgesApplied: number;
	deduplicatedRooms: number;
	openEndpointsUnresolved: number;
}

export interface DetectedRoomResult {
	rooms: DetectedRoom[];
	diagnostics: RoomDetectionDiagnostics;
	fingerprint: string;
}

// ─── ID generation ────────────────────────────────────────────────────────────

/**
 * Deterministic room ID from storey + boundary vertex coordinates.
 * Uses quantized coordinates so small floating-point noise is stable.
 */
export function generateDetectedRoomId(storeyId: string, boundary2D: PlanCoord[]): string {
	const sorted = [...boundary2D]
		.map((p) => `${quantizeCoord(p.x).toFixed(3)},${quantizeCoord(p.z).toFixed(3)}`)
		.sort();
	const hash = sha256Hex(`room:${storeyId}:${sorted.join('|')}`).substring(0, 12);
	return `detected-room:${storeyId}:${hash}`;
}

/**
 * Deterministic ID for a boundary segment.
 */
export function generateRoomBoundarySegmentId(
	kind: RoomBoundarySegmentKind,
	start: PlanCoord,
	end: PlanCoord
): string {
	const [a, b] = [
		`${quantizeCoord(start.x).toFixed(3)},${quantizeCoord(start.z).toFixed(3)}`,
		`${quantizeCoord(end.x).toFixed(3)},${quantizeCoord(end.z).toFixed(3)}`
	].sort();
	const hash = sha256Hex(`seg:${kind}:${a}:${b}`).substring(0, 8);
	return `seg:${kind}:${hash}`;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * 2D signed area of polygon (XZ plane). Positive = CCW.
 */
export function signedArea2D(pts: PlanCoord[]): number {
	const n = pts.length;
	if (n < 3) return 0;
	let area = 0;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		area += pts[j].x * pts[i].z;
		area -= pts[i].x * pts[j].z;
	}
	return area / 2;
}

/** Absolute area of a polygon (XZ plane) */
export function polygonArea(pts: PlanCoord[]): number {
	return Math.abs(signedArea2D(pts));
}

/** Perimeter of polygon */
export function polygonPerimeter(pts: PlanCoord[]): number {
	const n = pts.length;
	if (n < 2) return 0;
	let p = 0;
	for (let i = 0; i < n; i++) {
		const a = pts[i], b = pts[(i + 1) % n];
		const dx = b.x - a.x, dz = b.z - a.z;
		p += Math.sqrt(dx * dx + dz * dz);
	}
	return p;
}

/** 2D centroid (XZ) */
export function centroid2D(pts: PlanCoord[]): PlanCoord {
	if (pts.length === 0) return { x: 0, z: 0 };
	const sa = signedArea2D(pts);
	if (Math.abs(sa) < 1e-10) {
		const sx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
		const sz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
		return { x: sx, z: sz };
	}
	let cx = 0, cz = 0;
	const n = pts.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const cross = pts[j].x * pts[i].z - pts[i].x * pts[j].z;
		cx += (pts[j].x + pts[i].x) * cross;
		cz += (pts[j].z + pts[i].z) * cross;
	}
	const f = 1 / (6 * sa);
	return { x: cx * f, z: cz * f };
}

/** Axis-aligned bounding box of polygon */
export function polygonBounds(pts: PlanCoord[]): PlanBounds {
	if (pts.length === 0) return { min: { x: 0, z: 0 }, max: { x: 0, z: 0 } };
	let minX = pts[0].x, maxX = pts[0].x, minZ = pts[0].z, maxZ = pts[0].z;
	for (const p of pts) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.z < minZ) minZ = p.z;
		if (p.z > maxZ) maxZ = p.z;
	}
	return { min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } };
}

/** Point-in-polygon test (ray casting). Returns true if inside. */
export function pointInPolygon(pt: PlanCoord, poly: PlanCoord[]): boolean {
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

/** Check if polygon A is mostly inside polygon B (centroid test + area ratio) */
export function isPolygonInsidePolygon(inner: PlanCoord[], outer: PlanCoord[]): boolean {
	const c = centroid2D(inner);
	return pointInPolygon(c, outer);
}

/**
 * Ensure polygon has CCW winding (positive signed area).
 */
export function ensureCCW(pts: PlanCoord[]): PlanCoord[] {
	const sa = signedArea2D(pts);
	if (sa < 0) return [...pts].reverse();
	return [...pts];
}

/**
 * Ensure polygon has CW winding (negative signed area) — for holes.
 */
export function ensureCW(pts: PlanCoord[]): PlanCoord[] {
	const sa = signedArea2D(pts);
	if (sa > 0) return [...pts].reverse();
	return [...pts];
}

/**
 * Compute fingerprint for a DetectedRoomResult.
 */
export function calculateDetectedRoomFingerprint(rooms: DetectedRoom[]): string {
	if (rooms.length === 0) return '0:empty';
	const input = [...rooms].sort((a, b) => a.id.localeCompare(b.id)).map((r) => `${r.id}|${r.floorArea.toFixed(4)}|${r.status}`).join('');
	return `${rooms.length}:${sha256Hex(input).substring(0, 12)}`;
}
