import type {
	PlanCoord,
	PlanBounds,
	BarrierGraphNode,
	BarrierGraphEdge,
	BoundaryLoopCandidate,
	BoundaryLoopDiagnostics,
	BoundaryLoopResult
} from './types';
import type { NormalizedBarrierGraph } from './helpers';


interface HalfEdge {
	id: string;
	edge: BarrierGraphEdge;
	fromNodeId: string;
	toNodeId: string;
	fromCoord: PlanCoord;
	toCoord: PlanCoord;
	angle: number;
	twin?: HalfEdge;
	next?: HalfEdge;
	visited: boolean;
}

interface TraversalCycle {
	halfEdges: HalfEdge[];
	compIdx: number;
	signedArea: number;
}

function orientation(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
	const val = (bz - az) * (cx - bx) - (bx - ax) * (cz - bz);
	if (Math.abs(val) < 1e-10) return 0;
	return val > 0 ? 1 : 2;
}

function onSegment(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
	return bx <= Math.max(ax, cx) + 1e-10 && bx + 1e-10 >= Math.min(ax, cx) &&
		bz <= Math.max(az, cz) + 1e-10 && bz + 1e-10 >= Math.min(az, cz);
}

function segmentsIntersect(
	ax: number, az: number, bx: number, bz: number,
	cx: number, cz: number, dx: number, dz: number
): boolean {
	const o1 = orientation(ax, az, bx, bz, cx, cz);
	const o2 = orientation(ax, az, bx, bz, dx, dz);
	const o3 = orientation(cx, cz, dx, dz, ax, az);
	const o4 = orientation(cx, cz, dx, dz, bx, bz);

	if (o1 !== o2 && o3 !== o4) return true;

	if (o1 === 0 && onSegment(ax, az, cx, cz, bx, bz)) return true;
	if (o2 === 0 && onSegment(ax, az, dx, dz, bx, bz)) return true;
	if (o3 === 0 && onSegment(cx, cz, ax, az, dx, dz)) return true;
	if (o4 === 0 && onSegment(cx, cz, bx, bz, dx, dz)) return true;

	return false;
}

function isSelfIntersectingLoop(coords: PlanCoord[]): boolean {
	const k = coords.length;
	for (let i = 0; i < k; i++) {
		const p1 = coords[i];
		const p2 = coords[(i + 1) % k];
		for (let j = i + 1; j < k; j++) {
			if (j === i + 1 || (i === 0 && j === k - 1)) continue;
			const p3 = coords[j];
			const p4 = coords[(j + 1) % k];
			if (segmentsIntersect(p1.x, p1.z, p2.x, p2.z, p3.x, p3.z, p4.x, p4.z)) {
				return true;
			}
		}
	}
	return false;
}

function simpleHash(str: string): string {
	let h1 = 2166136261;
	let h2 = 5381;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ char, 16777619) >>> 0;
		h2 = Math.imul(h2 ^ char, 33) >>> 0;
	}
	return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function generateBoundaryLoopId(storeyCandidateId: string, nodeIds: string[]): string {
	return `loop:${storeyCandidateId}:${nodeIds.join('_')}`;
}

export function calculateBoundaryLoopFingerprint(input: BoundaryLoopResult | BoundaryLoopCandidate[]): string {
	const candidates = Array.isArray(input) ? input : input.candidates;
	const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));

	const payload = sorted.map(c => ({
		id: c.id,
		storeyCandidateId: c.storeyCandidateId,
		connectedComponentIndex: c.connectedComponentIndex,
		nodeIds: [...c.nodeIds],
		edgeIds: [...c.edgeIds],
		verticalEvidenceIds: [...c.verticalEvidenceIds].sort(),
		logicalObjectIds: [...c.logicalObjectIds].sort(),
		classificationUnitIds: [...c.classificationUnitIds].sort(),
		materialIds: [...c.materialIds].sort((a, b) => a - b),
		signedArea: Number(c.signedArea.toFixed(6)),
		absoluteArea: Number(c.absoluteArea.toFixed(6)),
		perimeter: Number(c.perimeter.toFixed(6)),
		planBounds: {
			min: { x: Number(c.planBounds.min.x.toFixed(6)), z: Number(c.planBounds.min.z.toFixed(6)) },
			max: { x: Number(c.planBounds.max.x.toFixed(6)), z: Number(c.planBounds.max.z.toFixed(6)) }
		},
		orientation: c.orientation,
		isAmbiguous: c.isAmbiguous,
		quality: c.quality
	}));

	const serialized = JSON.stringify(payload);

	let sha256: (str: string) => string;
	if (typeof window === 'undefined') {
		try {
			const { createHash } = require('crypto');
			sha256 = (str: string) => createHash('sha256').update(str).digest('hex');
		} catch (e) {
			sha256 = simpleHash;
		}
	} else {
		sha256 = simpleHash;
	}

	return sha256(serialized);
}

export function findBoundaryLoopCandidates(graph: NormalizedBarrierGraph): BoundaryLoopResult {
	const nodeMap = new Map<string, BarrierGraphNode>();
	for (const n of graph.nodes) {
		nodeMap.set(n.id, n);
	}

	const nodeToCompIdx = new Map<string, number>();
	if (graph.components && graph.components.length > 0) {
		for (let i = 0; i < graph.components.length; i++) {
			for (const nId of graph.components[i]) {
				nodeToCompIdx.set(nId, i);
			}
		}
	} else {
		for (const n of graph.nodes) {
			nodeToCompIdx.set(n.id, 0);
		}
	}

	const outHalfEdges = new Map<string, HalfEdge[]>();
	const allHalfEdges: HalfEdge[] = [];
	let halfEdgesCreated = 0;

	for (const edge of graph.edges) {
		const nodeA = nodeMap.get(edge.nodeAId);
		const nodeB = nodeMap.get(edge.nodeBId);
		if (!nodeA || !nodeB) continue;
		if (edge.nodeAId === edge.nodeBId) continue;
		const dx = nodeB.coord.x - nodeA.coord.x;
		const dz = nodeB.coord.z - nodeA.coord.z;
		if (Math.hypot(dx, dz) < 1e-9) continue;

		const angleAB = Math.atan2(dz, dx);
		const angleBA = Math.atan2(-dz, -dx);

		const hAB: HalfEdge = {
			id: `${edge.id}:AB`,
			edge,
			fromNodeId: edge.nodeAId,
			toNodeId: edge.nodeBId,
			fromCoord: nodeA.coord,
			toCoord: nodeB.coord,
			angle: angleAB,
			visited: false
		};

		const hBA: HalfEdge = {
			id: `${edge.id}:BA`,
			edge,
			fromNodeId: edge.nodeBId,
			toNodeId: edge.nodeAId,
			fromCoord: nodeB.coord,
			toCoord: nodeA.coord,
			angle: angleBA,
			visited: false
		};

		hAB.twin = hBA;
		hBA.twin = hAB;

		if (!outHalfEdges.has(edge.nodeAId)) outHalfEdges.set(edge.nodeAId, []);
		if (!outHalfEdges.has(edge.nodeBId)) outHalfEdges.set(edge.nodeBId, []);

		outHalfEdges.get(edge.nodeAId)!.push(hAB);
		outHalfEdges.get(edge.nodeBId)!.push(hBA);

		allHalfEdges.push(hAB, hBA);
		halfEdgesCreated += 2;
	}

	for (const [, out] of outHalfEdges.entries()) {
		out.sort((a, b) => {
			if (Math.abs(a.angle - b.angle) > 1e-9) {
				return a.angle - b.angle;
			}
			const lenSqA = (a.toCoord.x - a.fromCoord.x) ** 2 + (a.toCoord.z - a.fromCoord.z) ** 2;
			const lenSqB = (b.toCoord.x - b.fromCoord.x) ** 2 + (b.toCoord.z - b.fromCoord.z) ** 2;
			if (Math.abs(lenSqA - lenSqB) > 1e-12) {
				return lenSqA - lenSqB;
			}
			if (a.toNodeId !== b.toNodeId) {
				return a.toNodeId.localeCompare(b.toNodeId);
			}
			return a.edge.id.localeCompare(b.edge.id);
		});

		const m = out.length;
		for (let i = 0; i < m; i++) {
			const h = out[i];
			const inTwin = h.twin!;
			const nextIdx = (i - 1 + m) % m;
			inTwin.next = out[nextIdx];
		}
	}

	const closedTraversals: TraversalCycle[] = [];
	let traversalsAttempted = 0;

	for (const h of allHalfEdges) {
		if (h.visited) continue;
		traversalsAttempted++;

		const cycle: HalfEdge[] = [];
		let curr = h;
		while (!curr.visited) {
			curr.visited = true;
			cycle.push(curr);
			if (!curr.next) break;
			curr = curr.next;
		}

		if (curr === h) {
			const compIdx = nodeToCompIdx.get(h.fromNodeId) ?? 0;
			let sum = 0;
			const len = cycle.length;
			for (let i = 0; i < len; i++) {
				const p1 = cycle[i].fromCoord;
				const p2 = cycle[(i + 1) % len].fromCoord;
				sum += p1.x * p2.z - p2.x * p1.z;
			}
			const signedArea = sum / 2;
			closedTraversals.push({ halfEdges: cycle, compIdx, signedArea });
		}
	}

	const outerFaceSet = new Set<TraversalCycle>();
	const compTraversals = new Map<number, TraversalCycle[]>();

	for (const t of closedTraversals) {
		if (!compTraversals.has(t.compIdx)) compTraversals.set(t.compIdx, []);
		compTraversals.get(t.compIdx)!.push(t);
	}

	let outerFacesExcluded = 0;
	for (const [, list] of compTraversals.entries()) {
		let minArea = Infinity;
		let outerT: TraversalCycle | null = null;
		for (const t of list) {
			if (t.signedArea < -1e-6 && t.signedArea < minArea) {
				minArea = t.signedArea;
				outerT = t;
			}
		}
		if (outerT) {
			outerFaceSet.add(outerT);
			outerFacesExcluded++;
		}
	}

	const seenCanonicalKeys = new Set<string>();
	let duplicateLoopsRemoved = 0;
	let zeroAreaLoopsRejected = 0;
	let selfIntersectingLoopsRejected = 0;
	const candidates: BoundaryLoopCandidate[] = [];

	for (const t of closedTraversals) {
		if (outerFaceSet.has(t)) continue;

		const nodeIds = t.halfEdges.map(he => he.fromNodeId);
		const edgeIds = t.halfEdges.map(he => he.edge.id);
		const k = nodeIds.length;

		const rotations: string[] = [];
		for (let i = 0; i < k; i++) {
			rotations.push([...nodeIds.slice(i), ...nodeIds.slice(0, i)].join('|'));
		}
		const revNodeIds = [...nodeIds].reverse();
		for (let i = 0; i < k; i++) {
			rotations.push([...revNodeIds.slice(i), ...revNodeIds.slice(0, i)].join('|'));
		}
		rotations.sort();
		const canonicalKey = rotations[0];

		if (seenCanonicalKeys.has(canonicalKey)) {
			duplicateLoopsRemoved++;
			continue;
		}
		seenCanonicalKeys.add(canonicalKey);

		const uniqueNodes = new Set(nodeIds).size;
		const uniqueEdges = new Set(edgeIds).size;

		if (uniqueNodes < 3 || uniqueEdges < 3 || !Number.isFinite(t.signedArea) || Math.abs(t.signedArea) < 1e-4) {
			zeroAreaLoopsRejected++;
			continue;
		}

		if (uniqueNodes !== k || uniqueEdges !== k || isSelfIntersectingLoop(t.halfEdges.map(he => he.fromCoord))) {
			selfIntersectingLoopsRejected++;
			continue;
		}

		if (t.signedArea < 0) {
			selfIntersectingLoopsRejected++;
			continue;
		}

		let minNodeIdx = 0;
		let minNodeId = nodeIds[0];
		for (let i = 1; i < k; i++) {
			if (nodeIds[i].localeCompare(minNodeId) < 0) {
				minNodeId = nodeIds[i];
				minNodeIdx = i;
			}
		}

		const orderedNodeIds = [...nodeIds.slice(minNodeIdx), ...nodeIds.slice(0, minNodeIdx)];
		const orderedEdgeIds = [...edgeIds.slice(minNodeIdx), ...edgeIds.slice(0, minNodeIdx)];

		const verticalEvidenceSet = new Set<string>();
		const logicalObjectSet = new Set<string>();
		const classificationUnitSet = new Set<string>();
		const materialSet = new Set<number>();
		let perimeter = 0;
		let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

		for (const eId of orderedEdgeIds) {
			const he = t.halfEdges.find(h => h.edge.id === eId)!;
			const e = he.edge;
			for (const veId of e.verticalEvidenceIds) verticalEvidenceSet.add(veId);
			logicalObjectSet.add(e.logicalObjectId);
			for (const cuId of e.classificationUnitIds) classificationUnitSet.add(cuId);
			for (const mId of e.materialIds) materialSet.add(mId);

			const dx = e.end.x - e.start.x;
			const dz = e.end.z - e.start.z;
			perimeter += Math.hypot(dx, dz);
		}

		for (const nId of orderedNodeIds) {
			const c = nodeMap.get(nId)!.coord;
			if (c.x < minX) minX = c.x;
			if (c.z < minZ) minZ = c.z;
			if (c.x > maxX) maxX = c.x;
			if (c.z > maxZ) maxZ = c.z;
		}

		const sortedVerticalEvidenceIds = [...verticalEvidenceSet].sort();
		const sortedLogicalObjectIds = [...logicalObjectSet].sort();
		const sortedClassificationUnitIds = [...classificationUnitSet].sort();
		const sortedMaterialIds = [...materialSet].sort((a, b) => a - b);

		const planBounds = {
			min: { x: Number(minX.toFixed(6)), z: Number(minZ.toFixed(6)) },
			max: { x: Number(maxX.toFixed(6)), z: Number(maxZ.toFixed(6)) }
		};

		const candidateId = generateBoundaryLoopId(graph.storeyCandidateId, orderedNodeIds);

		candidates.push({
			id: candidateId,
			storeyCandidateId: graph.storeyCandidateId,
			connectedComponentIndex: t.compIdx,
			nodeIds: orderedNodeIds,
			edgeIds: orderedEdgeIds,
			verticalEvidenceIds: sortedVerticalEvidenceIds,
			sourceEvidenceIds: sortedVerticalEvidenceIds,
			logicalObjectIds: sortedLogicalObjectIds,
			classificationUnitIds: sortedClassificationUnitIds,
			materialIds: sortedMaterialIds,
			signedArea: Number(t.signedArea.toFixed(6)),
			absoluteArea: Number(Math.abs(t.signedArea).toFixed(6)),
			area: Number(Math.abs(t.signedArea).toFixed(6)),
			perimeter: Number(perimeter.toFixed(6)),
			planBounds,
			bounds: planBounds,
			orientation: 'ccw',
			isAmbiguous: false,
			quality: 1
		});
	}

	candidates.sort((a, b) => a.id.localeCompare(b.id));

	const componentsInspected = graph.components ? graph.components.length : (nodeToCompIdx.size > 0 ? Math.max(...nodeToCompIdx.values()) + 1 : 0);

	const diagnostics: BoundaryLoopDiagnostics = {
		componentsInspected,
		halfEdgesCreated,
		traversalsAttempted,
		closedTraversalsFound: closedTraversals.length,
		outerFacesExcluded,
		duplicateLoopsRemoved,
		zeroAreaLoopsRejected,
		selfIntersectingLoopsRejected,
		acceptedCandidates: candidates.length
	};

	return {
		candidates,
		diagnostics
	};
}
