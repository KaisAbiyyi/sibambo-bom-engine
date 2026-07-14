import { createHash } from 'crypto';
import type {
	RankedBoundaryLoopCandidate,
	HorizontalSurfaceEvidence,
	StoreyBandEvidence,
	BarrierGraph,
	PlanCoord,
	PlanBounds,
	LoopSurfaceAssignment,
	LoopSurfaceAssignmentDiagnostics,
	LoopSurfaceAssignmentResult,
	LoopSurfaceAssignmentRole
} from './types';

function computeBoundsOverlapArea(a: PlanBounds, b: PlanBounds): number {
	const minX = Math.max(a.min.x, b.min.x);
	const maxX = Math.min(a.max.x, b.max.x);
	const minZ = Math.max(a.min.z, b.min.z);
	const maxZ = Math.min(a.max.z, b.max.z);
	if (maxX <= minX || maxZ <= minZ) return 0;
	return (maxX - minX) * (maxZ - minZ);
}

function clipPolygonToAxisAlignedBox(poly: PlanCoord[], bounds: PlanBounds): PlanCoord[] {
	if (poly.length < 3) return [];
	let current = poly;

	// Left: x >= bounds.min.x
	let next: PlanCoord[] = [];
	for (let i = 0; i < current.length; i++) {
		const p1 = current[i];
		const p2 = current[(i + 1) % current.length];
		const p1Inside = p1.x >= bounds.min.x;
		const p2Inside = p2.x >= bounds.min.x;
		if (p1Inside) next.push(p1);
		if (p1Inside !== p2Inside) {
			const t = (bounds.min.x - p1.x) / (p2.x - p1.x);
			next.push({ x: bounds.min.x, z: p1.z + t * (p2.z - p1.z) });
		}
	}
	current = next;

	// Right: x <= bounds.max.x
	next = [];
	for (let i = 0; i < current.length; i++) {
		const p1 = current[i];
		const p2 = current[(i + 1) % current.length];
		const p1Inside = p1.x <= bounds.max.x;
		const p2Inside = p2.x <= bounds.max.x;
		if (p1Inside) next.push(p1);
		if (p1Inside !== p2Inside) {
			const t = (bounds.max.x - p1.x) / (p2.x - p1.x);
			next.push({ x: bounds.max.x, z: p1.z + t * (p2.z - p1.z) });
		}
	}
	current = next;

	// Bottom: z >= bounds.min.z
	next = [];
	for (let i = 0; i < current.length; i++) {
		const p1 = current[i];
		const p2 = current[(i + 1) % current.length];
		const p1Inside = p1.z >= bounds.min.z;
		const p2Inside = p2.z >= bounds.min.z;
		if (p1Inside) next.push(p1);
		if (p1Inside !== p2Inside) {
			const t = (bounds.min.z - p1.z) / (p2.z - p1.z);
			next.push({ x: p1.x + t * (p2.x - p1.x), z: bounds.min.z });
		}
	}
	current = next;

	// Top: z <= bounds.max.z
	next = [];
	for (let i = 0; i < current.length; i++) {
		const p1 = current[i];
		const p2 = current[(i + 1) % current.length];
		const p1Inside = p1.z <= bounds.max.z;
		const p2Inside = p2.z <= bounds.max.z;
		if (p1Inside) next.push(p1);
		if (p1Inside !== p2Inside) {
			const t = (bounds.max.z - p1.z) / (p2.z - p1.z);
			next.push({ x: p1.x + t * (p2.x - p1.x), z: bounds.max.z });
		}
	}
	return next;
}

function computePolygonArea(poly: PlanCoord[]): number {
	if (poly.length < 3) return 0;
	let sum = 0;
	for (let i = 0; i < poly.length; i++) {
		const p1 = poly[i];
		const p2 = poly[(i + 1) % poly.length];
		sum += (p1.x * p2.z - p2.x * p1.z);
	}
	return Math.abs(sum) / 2;
}

export function calculateLoopSurfaceAssignmentFingerprint(assignments: LoopSurfaceAssignment[]): string {
	const sorted = [...assignments].sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return a.id.localeCompare(b.id);
	});
	const hash = createHash('sha256');
	for (const a of sorted) {
		hash.update(a.id);
		hash.update(a.role);
		hash.update(a.score.toFixed(6));
		hash.update(a.loopCoverageRatio.toFixed(6));
		hash.update(a.evidenceCoverageRatio.toFixed(6));
	}
	return hash.digest('hex');
}

export function assignHorizontalEvidenceToLoops(
	loops: RankedBoundaryLoopCandidate[],
	horizontalEvidences: HorizontalSurfaceEvidence[],
	storeyContexts?: StoreyBandEvidence[] | { [storeyId: string]: { min: number; max: number } } | { min: number; max: number },
	graph?: { nodes: { id: string; coord: PlanCoord }[] } | BarrierGraph
): LoopSurfaceAssignmentResult {
	const diagnostics: LoopSurfaceAssignmentDiagnostics = {
		loopsInspected: 0,
		noiseLoopsSkipped: 0,
		horizontalEvidenceInspected: horizontalEvidences.length,
		planOverlapTests: 0,
		assignmentsAccepted: 0,
		lowerSupportCandidates: 0,
		upperCoverCandidates: 0,
		ambiguousAssignments: 0,
		loopsWithNoAssignment: 0,
		approximateOverlapAssignments: 0,
		rejectedNonFiniteGeometry: 0
	};

	const assignments: LoopSurfaceAssignment[] = [];

	for (const loop of loops) {
		if (loop.status === 'noise') {
			diagnostics.noiseLoopsSkipped++;
			continue;
		}

		if (
			!Number.isFinite(loop.planBounds.min.x) ||
			!Number.isFinite(loop.planBounds.min.z) ||
			!Number.isFinite(loop.planBounds.max.x) ||
			!Number.isFinite(loop.planBounds.max.z) ||
			!Number.isFinite(loop.area)
		) {
			diagnostics.rejectedNonFiniteGeometry++;
			continue;
		}

		diagnostics.loopsInspected++;

		// Build loop polygon if graph is provided
		let loopPolygon: PlanCoord[] | undefined;
		if (graph && graph.nodes && loop.nodeIds) {
			const coords: PlanCoord[] = [];
			let allFinite = true;
			for (const nid of loop.nodeIds) {
				const node = graph.nodes.find(n => n.id === nid);
				if (!node || !Number.isFinite(node.coord.x) || !Number.isFinite(node.coord.z)) {
					allFinite = false;
					break;
				}
				coords.push(node.coord);
			}
			if (allFinite && coords.length >= 3) {
				loopPolygon = coords;
			} else if (!allFinite) {
				diagnostics.rejectedNonFiniteGeometry++;
			}
		}

		// Resolve storey range
		let storeyRange = { min: 0, max: 3 };
		if (storeyContexts) {
			if (Array.isArray(storeyContexts)) {
				const band = storeyContexts.find(b => b.id === loop.storeyCandidateId);
				if (band && Number.isFinite(band.elevationRange.min) && Number.isFinite(band.elevationRange.max)) {
					storeyRange = { min: band.elevationRange.min, max: band.elevationRange.max };
				}
			} else if ('min' in storeyContexts && typeof storeyContexts.min === 'number' && 'max' in storeyContexts && typeof storeyContexts.max === 'number') {
				if (Number.isFinite(storeyContexts.min) && Number.isFinite(storeyContexts.max)) {
					storeyRange = { min: storeyContexts.min, max: storeyContexts.max };
				}
			} else {
				const map = storeyContexts as { [storeyId: string]: { min: number; max: number } };
				if (map[loop.storeyCandidateId] && Number.isFinite(map[loop.storeyCandidateId].min) && Number.isFinite(map[loop.storeyCandidateId].max)) {
					storeyRange = { min: map[loop.storeyCandidateId].min, max: map[loop.storeyCandidateId].max };
				}
			}
		}

		const storeyThickness = storeyRange.max - storeyRange.min;
		const lowerSupportTop = storeyThickness <= 0.5 ? storeyRange.max + 0.35 : storeyRange.min + 0.45;

		const loopAssignments: LoopSurfaceAssignment[] = [];

		for (const ev of horizontalEvidences) {
			if (
				!Number.isFinite(ev.elevation) ||
				!Number.isFinite(ev.areaM2) ||
				!Number.isFinite(ev.planBounds.min.x) ||
				!Number.isFinite(ev.planBounds.min.z) ||
				!Number.isFinite(ev.planBounds.max.x) ||
				!Number.isFinite(ev.planBounds.max.z)
			) {
				diagnostics.rejectedNonFiniteGeometry++;
				continue;
			}

			diagnostics.planOverlapTests++;

			const overlapBoundsArea = computeBoundsOverlapArea(loop.planBounds, ev.planBounds);
			if (overlapBoundsArea <= 1e-6) {
				continue;
			}

			const isApproximate = !(ev as any).polygon && !(ev as any).planPolygon;
			let effectiveOverlap = overlapBoundsArea;

			if (loopPolygon && isApproximate) {
				const clipped = clipPolygonToAxisAlignedBox(loopPolygon, ev.planBounds);
				effectiveOverlap = computePolygonArea(clipped);
			} else if (!isApproximate && (ev as any).polygon) {
				if (loopPolygon) {
					const clipped = clipPolygonToAxisAlignedBox(loopPolygon, ev.planBounds);
					effectiveOverlap = computePolygonArea(clipped);
				}
			}

			if (effectiveOverlap <= 1e-6) {
				continue;
			}

			const overlapProxy = Number(effectiveOverlap.toFixed(6));
			const overlapArea = overlapProxy;

			const loopAreaSafe = loop.area > 1e-6 ? loop.area : 1;
			const evAreaSafe = ev.areaM2 > 1e-6 ? ev.areaM2 : 1;
			const loopCoverageRatio = Number(Math.min(1, Math.max(0, overlapArea / loopAreaSafe)).toFixed(6));
			const evidenceCoverageRatio = Number(Math.min(1, Math.max(0, overlapArea / evAreaSafe)).toFixed(6));

			const dBottom = ev.elevation - storeyRange.min;
			const orientation: 'up' | 'down' | 'horizontal' | 'unknown' =
				(ev as any).orientation || (ev.surfaceType === 'floor' ? 'up' : ev.surfaceType === 'ceiling' ? 'down' : 'horizontal');

			let role: LoopSurfaceAssignmentRole = 'ambiguous';
			let elevationMismatch = false;
			let orientationConflict = false;
			let ambiguousRole = false;

			if (ev.elevation <= lowerSupportTop && ev.elevation >= storeyRange.min - 0.6) {
				if (orientation === 'up' || orientation === 'horizontal' || orientation === 'unknown') {
					role = 'lower-support';
					if (dBottom < -0.3 || dBottom > 0.35) elevationMismatch = true;
				} else {
					role = 'ambiguous';
					orientationConflict = true;
					ambiguousRole = true;
					if (dBottom < -0.3 || dBottom > 0.35) elevationMismatch = true;
				}
			} else if (ev.elevation > lowerSupportTop && ev.elevation <= storeyRange.min + 4.5) {
				if (orientation === 'down' || orientation === 'horizontal' || orientation === 'unknown') {
					role = 'upper-cover';
					if (dBottom > 3.8) elevationMismatch = true;
				} else {
					role = 'ambiguous';
					orientationConflict = true;
					ambiguousRole = true;
				}
			} else if (ev.elevation > storeyRange.min + 0.45 && ev.elevation < storeyRange.max - 0.45) {
				role = 'intersecting';
			} else {
				role = 'ambiguous';
				elevationMismatch = true;
				ambiguousRole = true;
			}

			let verticalDistance = 0;
			if (ev.elevation < storeyRange.min) verticalDistance = storeyRange.min - ev.elevation;
			else if (ev.elevation > storeyRange.max) verticalDistance = ev.elevation - storeyRange.max;
			else verticalDistance = Math.min(ev.elevation - storeyRange.min, storeyRange.max - ev.elevation);
			verticalDistance = Number(verticalDistance.toFixed(6));

			const idHash = createHash('sha256').update(loop.id).update(ev.id).digest('hex').slice(0, 16);
			const assignmentId = `assign:surface:${idHash}`;

			let score = (loopCoverageRatio * 0.6 + evidenceCoverageRatio * 0.4) * (role === 'lower-support' || role === 'upper-cover' ? 100 : role === 'intersecting' ? 50 : 20);
			if (!elevationMismatch) score += 10;
			if (!orientationConflict) score += 10;
			if (isApproximate) score *= 0.95;
			score = Number(Math.max(0, score).toFixed(6));

			loopAssignments.push({
				id: assignmentId,
				loopCandidateId: loop.id,
				storeyCandidateId: loop.storeyCandidateId,
				horizontalEvidenceId: ev.id,
				logicalObjectId: ev.logicalObjectId,
				classificationUnitIds: [...ev.classificationUnitIds],
				materialIds: [...(ev.materialIds || [])],
				orientation,
				elevation: ev.elevation,
				loopArea: loop.area,
				overlapArea,
				overlapProxy: isApproximate ? overlapProxy : undefined,
				loopCoverageRatio,
				evidenceCoverageRatio,
				verticalDistance,
				role,
				score,
				qualityFlags: {
					approximateOverlap: isApproximate,
					weakPlanOverlap: loopCoverageRatio < 0.2 && evidenceCoverageRatio < 0.2,
					strongPlanOverlap: loopCoverageRatio >= 0.7 || evidenceCoverageRatio >= 0.7,
					elevationMismatch,
					orientationConflict,
					multipleLowerCandidates: false,
					multipleUpperCandidates: false,
					noHorizontalSupport: false,
					ambiguousRole
				}
			});
		}

		const lowerCount = loopAssignments.filter(a => a.role === 'lower-support').length;
		const upperCount = loopAssignments.filter(a => a.role === 'upper-cover').length;

		for (const a of loopAssignments) {
			if (lowerCount > 1) a.qualityFlags.multipleLowerCandidates = true;
			if (upperCount > 1) a.qualityFlags.multipleUpperCandidates = true;
			if (lowerCount === 0) a.qualityFlags.noHorizontalSupport = true;
		}

		loopAssignments.sort((a, b) => {
			if (a.score !== b.score) return b.score - a.score;
			return a.id.localeCompare(b.id);
		});

		if (loopAssignments.length === 0) {
			diagnostics.loopsWithNoAssignment++;
		} else {
			for (const a of loopAssignments) {
				diagnostics.assignmentsAccepted++;
				if (a.role === 'lower-support') diagnostics.lowerSupportCandidates++;
				else if (a.role === 'upper-cover') diagnostics.upperCoverCandidates++;
				else if (a.role === 'ambiguous') diagnostics.ambiguousAssignments++;
				if (a.qualityFlags.approximateOverlap) diagnostics.approximateOverlapAssignments++;
			}
		}

		assignments.push(...loopAssignments);
	}

	const fingerprint = calculateLoopSurfaceAssignmentFingerprint(assignments);

	return {
		assignments,
		diagnostics: {
			...diagnostics,
			fingerprint
		}
	};
}
