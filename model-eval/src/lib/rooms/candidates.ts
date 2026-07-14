function getCreateHash(): (algorithm: string) => { update(v: string): any; digest(enc: string): string } {
	if (typeof window === 'undefined') {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			return (require('crypto') as typeof import('crypto')).createHash;
		} catch { /* fall through */ }
	}
	return ((_algorithm: string) => new BrowserHasher()) as any;
}
class BrowserHasher {
	private _buf = '';
	update(v: string) { this._buf += v; return this; }
	digest(_enc: string): string { return simpleHashStr(this._buf); }
}
function simpleHashStr(str: string): string {
	let h1 = 2166136261;
	let h2 = 5381;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ char, 16777619) >>> 0;
		h2 = Math.imul(h2 ^ char, 33) >>> 0;
	}
	return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
const createHash = getCreateHash();
import type {
	RankedBoundaryLoopCandidate,
	RankedBoundaryLoopResult,
	LoopSurfaceAssignment,
	RankedLoopSurfaceAssignmentResult,
	VerticalEnvelopeCandidate,
	VerticalEnvelopeCandidateResult,
	RoomCandidate,
	RoomCandidateDiagnostics,
	RoomCandidateResult,
	RoomCandidateStatus,
	PlanCoord
} from './types';
import type { NormalizedBarrierGraph } from './helpers';


export function calculateRoomCandidateFingerprint(
	candidates: RoomCandidate[],
	diagnostics?: Partial<RoomCandidateDiagnostics>
): string {
	const hash = createHash('sha256');

	hash.update(`inspected:${diagnostics?.loopsInspected || 0}`);
	hash.update(`noiseSkipped:${diagnostics?.noiseLoopsSkipped || 0}`);
	hash.update(`primary:${diagnostics?.primaryRoomCandidates || 0}`);
	hash.update(`secondary:${diagnostics?.secondaryRoomCandidates || 0}`);
	hash.update(`ambiguous:${diagnostics?.ambiguousRoomCandidates || 0}`);
	hash.update(`noEnvelope:${diagnostics?.loopsWithoutValidEnvelopes || 0}`);
	hash.update(`rejectedArea:${diagnostics?.invalidAreaCandidatesRejected || 0}`);
	hash.update(`rejectedHeight:${diagnostics?.invalidHeightCandidatesRejected || 0}`);
	hash.update(`alternatives:${diagnostics?.alternativeEnvelopesPreserved || 0}`);

	for (const c of candidates) {
		const parts = [
			c.id,
			c.loopId,
			c.selectedEnvelopeId,
			c.status,
			c.planArea.toFixed(6),
			c.clearHeight.toFixed(6),
			c.estimatedVolume.toFixed(6),
			c.alternativeEnvelopeIds.slice().sort().join(','),
			c.logicalObjectIds.join(','),
			c.classificationUnitIds.join(','),
			c.materialIds.join(',')
		];
		hash.update(parts.join('|'));
	}

	return hash.digest('hex');
}

export function assembleRoomCandidates(
	loopsInput: RankedBoundaryLoopCandidate[] | RankedBoundaryLoopResult,
	assignmentsInput: LoopSurfaceAssignment[] | RankedLoopSurfaceAssignmentResult,
	envelopesInput: VerticalEnvelopeCandidate[] | VerticalEnvelopeCandidateResult,
	graphsInput?: NormalizedBarrierGraph | NormalizedBarrierGraph[]
): RoomCandidateResult {
	const loops: RankedBoundaryLoopCandidate[] = Array.isArray(loopsInput)
		? loopsInput
		: loopsInput?.candidates || [];

	const envelopes: VerticalEnvelopeCandidate[] = Array.isArray(envelopesInput)
		? envelopesInput
		: envelopesInput?.candidates || [];

	const graphs: NormalizedBarrierGraph[] = graphsInput
		? Array.isArray(graphsInput)
			? graphsInput
			: [graphsInput]
		: [];

	const diagnostics: RoomCandidateDiagnostics = {
		loopsInspected: 0,
		noiseLoopsSkipped: 0,
		primaryRoomCandidates: 0,
		secondaryRoomCandidates: 0,
		ambiguousRoomCandidates: 0,
		loopsWithoutValidEnvelopes: 0,
		invalidAreaCandidatesRejected: 0,
		invalidHeightCandidatesRejected: 0,
		alternativeEnvelopesPreserved: 0,
		totalCandidateArea: 0,
		totalEstimatedVolume: 0,
		fingerprint: ''
	};

	const sortedLoops = [...loops].sort((a, b) => a.id.localeCompare(b.id));
	const candidates: RoomCandidate[] = [];

	for (const loop of sortedLoops) {
		diagnostics.loopsInspected++;

		if (loop.status === 'noise' || (loop as any).status === 'noise') {
			diagnostics.noiseLoopsSkipped++;
			continue;
		}

		// Find all non-noise envelopes for this loop.
		// Respect the newer refinement contract if present.
		const loopEnvelopes = envelopes.filter((e) => {
			if (e.loopCandidateId !== loop.id) return false;
			if (e.status === 'noise') return false;
			if ((e as any).eligibleForRoomAssembly !== true) return false;
			return true;
		});

		if (loopEnvelopes.length === 0) {
			diagnostics.loopsWithoutValidEnvelopes++;
			continue;
		}

		// Separate primary and secondary envelopes
		const primaryEnvelopes = loopEnvelopes.filter((e) => e.status === 'primary');
		const secondaryEnvelopes = loopEnvelopes.filter((e) => e.status === 'secondary');

		// Sort each group by score desc, then ID asc
		const sortEnvelopes = (list: VerticalEnvelopeCandidate[]) => {
			list.sort((a, b) => {
				if (Math.abs(a.score - b.score) >= 1e-6) {
					return b.score - a.score;
				}
				return a.id.localeCompare(b.id);
			});
		};

		sortEnvelopes(primaryEnvelopes);
		sortEnvelopes(secondaryEnvelopes);

		let selectedEnv: VerticalEnvelopeCandidate | undefined;
		let status: RoomCandidateStatus = 'primary';
		let alternativeEnvelopeIds: string[] = [];

		if (primaryEnvelopes.length > 0) {
			selectedEnv = primaryEnvelopes[0];
			const isTied =
				primaryEnvelopes.length > 1 &&
				Math.abs(primaryEnvelopes[0].score - primaryEnvelopes[1].score) < 1e-6;

			if (isTied) {
				status = 'ambiguous';
			} else {
				status = 'primary';
			}

			// All remaining non-noise envelopes are alternatives
			const remainingPrimary = primaryEnvelopes.slice(1);
			alternativeEnvelopeIds = [...remainingPrimary, ...secondaryEnvelopes].map((e) => e.id);
		} else if (secondaryEnvelopes.length > 0) {
			selectedEnv = secondaryEnvelopes[0];
			status = 'secondary';
			alternativeEnvelopeIds = secondaryEnvelopes.slice(1).map((e) => e.id);
		} else {
			diagnostics.loopsWithoutValidEnvelopes++;
			continue;
		}

		const planArea = Number(
			(loop.area || loop.absoluteArea || selectedEnv.loopArea || 0).toFixed(6)
		);
		if (!Number.isFinite(planArea) || planArea <= 0) {
			diagnostics.invalidAreaCandidatesRejected++;
			continue;
		}

		const clearHeight = Number(selectedEnv.clearHeight.toFixed(6));
		if (!Number.isFinite(clearHeight) || clearHeight <= 0) {
			diagnostics.invalidHeightCandidatesRejected++;
			continue;
		}

		const perimeter = Number((loop.perimeter || 0).toFixed(6));
		const estimatedVolume = Number(
			(selectedEnv.estimatedVolume || planArea * clearHeight).toFixed(6)
		);

		if (alternativeEnvelopeIds.length > 0) {
			diagnostics.alternativeEnvelopesPreserved += alternativeEnvelopeIds.length;
		}

		// Build planPolygon if possible
		let planPolygon: PlanCoord[] = [];
		if (Array.isArray((loop as any).planPolygon) && (loop as any).planPolygon.length >= 3) {
			planPolygon = (loop as any).planPolygon.slice();
		} else if (Array.isArray((loop as any).polygon) && (loop as any).polygon.length >= 3) {
			planPolygon = (loop as any).polygon.slice();
		} else if (graphs.length > 0 && loop.nodeIds && loop.nodeIds.length >= 3) {
			const coords: PlanCoord[] = [];
			let allFound = true;
			for (const nid of loop.nodeIds) {
				let foundNode: any = null;
				for (const g of graphs) {
					if (g && g.nodes) {
						foundNode = g.nodes.find((n: any) => n.id === nid);
						if (foundNode) break;
					}
				}
				if (
					foundNode &&
					Number.isFinite(foundNode.coord.x) &&
					Number.isFinite(foundNode.coord.z)
				) {
					coords.push(foundNode.coord);
				} else {
					allFound = false;
					break;
				}
			}
			if (allFound && coords.length >= 3) {
				planPolygon = coords;
			}
		}

		const logicalIdsSet = new Set<string>([
			...(selectedEnv.logicalObjectIds || []),
			...(loop.logicalObjectIds || [])
		].filter(Boolean));
		const logicalObjectIds = Array.from(logicalIdsSet).sort();

		const classIdsSet = new Set<string>([
			...(selectedEnv.classificationUnitIds || []),
			...(loop.classificationUnitIds || [])
		].filter(Boolean));
		const classificationUnitIds = Array.from(classIdsSet).sort();

		const matIdsSet = new Set<number>([
			...(selectedEnv.materialIds || []),
			...(loop.materialIds || [])
		].filter((m) => Number.isFinite(m)));
		const materialIds = Array.from(matIdsSet).sort((a, b) => a - b);

		const score = Number(((loop.score + selectedEnv.score) / 2).toFixed(4));
		const id = `room:${loop.id}:${selectedEnv.id}`;

		const candidate: RoomCandidate = {
			id,
			loopId: loop.id,
			loopCandidateId: loop.id,
			storeyCandidateId: loop.storeyCandidateId || selectedEnv.storeyCandidateId || 'storey:unknown',
			selectedEnvelopeId: selectedEnv.id,
			envelopeCandidateId: selectedEnv.id,
			alternativeEnvelopeIds,
			orderedBoundaryNodeIds: (loop.nodeIds || []).slice(),
			orderedBoundaryEdgeIds: (loop.edgeIds || []).slice(),
			planPolygon,
			planBounds: loop.planBounds || loop.bounds || { min: { x: 0, z: 0 }, max: { x: 0, z: 0 } },
			planArea,
			perimeter,
			lowerElevation: selectedEnv.lowerElevation,
			upperElevation: selectedEnv.upperElevation,
			clearHeight,
			estimatedVolume,
			lowerHorizontalEvidenceId: selectedEnv.lowerHorizontalEvidenceId || '',
			upperHorizontalEvidenceId: selectedEnv.upperHorizontalEvidenceId || '',
			verticalEvidenceIds: (loop.verticalEvidenceIds || []).slice().sort(),
			logicalObjectIds,
			classificationUnitIds,
			materialIds,
			score,
			status,
			qualityFlags: {
				isAmbiguousEnvelope: status === 'ambiguous',
				hasAlternativeEnvelopes: alternativeEnvelopeIds.length > 0,
				isSecondaryFallback: status === 'secondary',
				weakLowerSupport: Boolean(selectedEnv.qualityFlags?.weakLowerSupport),
				weakUpperCover: Boolean(selectedEnv.qualityFlags?.weakUpperCover),
				geometricallyPlausible: planArea > 0 && clearHeight > 0
			}
		};

		if (status === 'primary') diagnostics.primaryRoomCandidates++;
		else if (status === 'secondary') diagnostics.secondaryRoomCandidates++;
		else if (status === 'ambiguous') diagnostics.ambiguousRoomCandidates++;

		diagnostics.totalCandidateArea += planArea;
		diagnostics.totalEstimatedVolume += estimatedVolume;

		candidates.push(candidate);
	}

	candidates.sort((a, b) => a.id.localeCompare(b.id));

	diagnostics.totalCandidateArea = Number(diagnostics.totalCandidateArea.toFixed(6));
	diagnostics.totalEstimatedVolume = Number(diagnostics.totalEstimatedVolume.toFixed(6));
	diagnostics.fingerprint = calculateRoomCandidateFingerprint(candidates, diagnostics);

	return {
		candidates,
		diagnostics
	};
}
