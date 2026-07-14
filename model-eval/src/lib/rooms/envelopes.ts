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
	LoopSurfaceAssignment,
	RankedLoopSurfaceAssignment,
	RankedLoopSurfaceAssignmentResult,
	VerticalEnvelopeCandidate,
	VerticalEnvelopeDiagnostics,
	VerticalEnvelopeCandidateResult,
	VerticalEnvelopeQualityFlags,
	VerticalBarrierEvidence,
	StoreyBandEvidence,
	LoopVerticalExtentProfile,
	RefinedVerticalEnvelopeCandidate,
	VerticalEnvelopeRefinementDiagnostics,
	RefinedVerticalEnvelopeResult,
	VerticalEnvelopeStatus
} from './types';

function getLogicalIds(item?: { logicalObjectIds?: string[]; logicalObjectId?: string }): string[] {
	if (!item) return [];
	if (Array.isArray(item.logicalObjectIds)) return item.logicalObjectIds;
	if (typeof item.logicalObjectId === 'string' && item.logicalObjectId) return [item.logicalObjectId];
	return [];
}
function getClassIds(item?: { classificationUnitIds?: string[] }): string[] {
	if (!item || !Array.isArray(item.classificationUnitIds)) return [];
	return item.classificationUnitIds;
}
function getMatIds(item?: { materialIds?: number[] }): number[] {
	if (!item || !Array.isArray(item.materialIds)) return [];
	return item.materialIds;
}


export function calculateVerticalEnvelopeCandidateFingerprint(
	candidates: VerticalEnvelopeCandidate[]
): string {
	const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
	const hash = createHash('sha256');
	for (const cand of sorted) {
		hash.update(
			`${cand.id}:${cand.status}:${cand.rank}:${cand.score.toFixed(6)}:${cand.loopCandidateId}:${cand.lowerAssignmentId}:${cand.upperAssignmentId}:${cand.clearHeight.toFixed(6)}:${cand.estimatedVolume.toFixed(6)}|`
		);
	}
	return hash.digest('hex');
}

export function buildVerticalEnvelopeCandidates(
	loops: RankedBoundaryLoopCandidate[],
	rankedAssignmentsInput: LoopSurfaceAssignment[] | RankedLoopSurfaceAssignmentResult
): VerticalEnvelopeCandidateResult {
	const rawAssignments = Array.isArray(rankedAssignmentsInput)
		? rankedAssignmentsInput
		: rankedAssignmentsInput.assignments;

	const assignments: RankedLoopSurfaceAssignment[] = rawAssignments.map((a) => {
		if ('status' in a && (a as any).status) {
			return a as RankedLoopSurfaceAssignment;
		}
		return {
			...a,
			status: 'primary',
			rank: 1,
			normalizedOverlapScore: a.score || 1,
			normalizedElevationScore: 1,
			orientationConsistencyScore: 1,
			ambiguityFlags: {
				isApproximate: Boolean(a.qualityFlags?.approximateOverlap),
				isAmbiguousRole: Boolean(a.qualityFlags?.ambiguousRole),
				isElevationMismatch: Boolean(a.qualityFlags?.elevationMismatch),
				isOrientationConflict: Boolean(a.qualityFlags?.orientationConflict)
			},
			rejectionReasons: []
		};
	});



	const candidates: VerticalEnvelopeCandidate[] = [];
	let loopsInspected = 0;
	let loopsWithSingleEnvelope = 0;
	let loopsWithMultipleEnvelopes = 0;
	let loopsMissingLowerSupport = 0;
	let loopsMissingUpperCover = 0;
	let rejectedNonPositiveHeights = 0;

	for (const loop of loops) {
		if (loop.status !== 'primary' && loop.status !== 'secondary') {
			continue;
		}
		loopsInspected++;

		const lowerList = assignments.filter(
			(a) => a.loopCandidateId === loop.id && a.role === 'lower-support'
		);
		const upperList = assignments.filter(
			(a) => a.loopCandidateId === loop.id && a.role === 'upper-cover'
		);

		if (lowerList.length === 0) {
			loopsMissingLowerSupport++;
		}
		if (upperList.length === 0) {
			loopsMissingUpperCover++;
		}

		const loopCandidates: VerticalEnvelopeCandidate[] = [];

		if (lowerList.length === 0 && upperList.length > 0) {
			for (const upper of upperList) {
				const logicalIds = Array.from(
					new Set([...getLogicalIds(loop), ...getLogicalIds(upper)])
				).sort();
				const classificationIds = Array.from(
					new Set([...getClassIds(loop), ...getClassIds(upper)])
				).sort();
				const matIds = Array.from(
					new Set([...getMatIds(loop), ...getMatIds(upper)])
				).sort((a, b) => a - b);


				const cand: VerticalEnvelopeCandidate = {
					id: `env:${loop.id}|no-lower|${upper.id}`,
					loopCandidateId: loop.id,
					storeyCandidateId: loop.storeyCandidateId,
					lowerAssignmentId: '',
					upperAssignmentId: upper.id,
					lowerHorizontalEvidenceId: '',
					upperHorizontalEvidenceId: upper.horizontalEvidenceId,
					logicalObjectIds: logicalIds,
					classificationUnitIds: classificationIds,
					materialIds: matIds,
					lowerElevation: 0,
					upperElevation: Number(upper.elevation.toFixed(6)),
					clearHeight: 0,
					loopArea: Number(loop.area.toFixed(6)),
					estimatedVolume: 0,
					score: 0,
					status: 'noise',
					rank: 1,
					qualityFlags: {
						missingLower: true,
						missingUpper: false,
						nonPositiveHeight: true,
						unusuallyLowHeight: false,
						unusuallyHighHeight: false,
						approximateOverlap: false,
						multipleEnvelopeCandidates: false,
						weakLowerSupport: true,
						weakUpperCover: upper.status !== 'primary' || upper.score < 60,
						geometricallyPlausible: false
					}
				};
				loopCandidates.push(cand);
			}
		} else if (lowerList.length > 0 && upperList.length === 0) {
			for (const lower of lowerList) {
				const logicalIds = Array.from(
					new Set([...getLogicalIds(loop), ...getLogicalIds(lower)])
				).sort();
				const classificationIds = Array.from(
					new Set([...getClassIds(loop), ...getClassIds(lower)])
				).sort();
				const matIds = Array.from(
					new Set([...getMatIds(loop), ...getMatIds(lower)])
				).sort((a, b) => a - b);


				const cand: VerticalEnvelopeCandidate = {
					id: `env:${loop.id}|${lower.id}|no-upper`,
					loopCandidateId: loop.id,
					storeyCandidateId: loop.storeyCandidateId,
					lowerAssignmentId: lower.id,
					upperAssignmentId: '',
					lowerHorizontalEvidenceId: lower.horizontalEvidenceId,
					upperHorizontalEvidenceId: '',
					logicalObjectIds: logicalIds,
					classificationUnitIds: classificationIds,
					materialIds: matIds,
					lowerElevation: Number(lower.elevation.toFixed(6)),
					upperElevation: Number(lower.elevation.toFixed(6)),
					clearHeight: 0,
					loopArea: Number(loop.area.toFixed(6)),
					estimatedVolume: 0,
					score: 0,
					status: 'noise',
					rank: 1,
					qualityFlags: {
						missingLower: false,
						missingUpper: true,
						nonPositiveHeight: true,
						unusuallyLowHeight: false,
						unusuallyHighHeight: false,
						approximateOverlap: false,
						multipleEnvelopeCandidates: false,
						weakLowerSupport: lower.status !== 'primary' || lower.score < 60,
						weakUpperCover: true,
						geometricallyPlausible: false
					}
				};
				loopCandidates.push(cand);
			}
		} else if (lowerList.length === 0 && upperList.length === 0) {
			const cand: VerticalEnvelopeCandidate = {
				id: `env:${loop.id}|no-lower|no-upper`,
				loopCandidateId: loop.id,
				storeyCandidateId: loop.storeyCandidateId,
				lowerAssignmentId: '',
				upperAssignmentId: '',
				lowerHorizontalEvidenceId: '',
				upperHorizontalEvidenceId: '',
				logicalObjectIds: getLogicalIds(loop).sort(),
				classificationUnitIds: getClassIds(loop).sort(),
				materialIds: getMatIds(loop).sort((a, b) => a - b),

				lowerElevation: 0,
				upperElevation: 0,
				clearHeight: 0,
				loopArea: Number(loop.area.toFixed(6)),
				estimatedVolume: 0,
				score: 0,
				status: 'noise',
				rank: 1,
				qualityFlags: {
					missingLower: true,
					missingUpper: true,
					nonPositiveHeight: true,
					unusuallyLowHeight: false,
					unusuallyHighHeight: false,
					approximateOverlap: false,
					multipleEnvelopeCandidates: false,
					weakLowerSupport: true,
					weakUpperCover: true,
					geometricallyPlausible: false
				}
			};
			loopCandidates.push(cand);
		} else {
			for (const lower of lowerList) {
				for (const upper of upperList) {
					const diff = upper.elevation - lower.elevation;
					const clearHeight = Number(Math.max(0, diff).toFixed(6));
					const nonPositiveHeight = diff <= 0;

					if (nonPositiveHeight) {
						rejectedNonPositiveHeights++;
					}

					const logicalIds = Array.from(
						new Set([...getLogicalIds(loop), ...getLogicalIds(lower), ...getLogicalIds(upper)])
					).sort();
					const classificationIds = Array.from(
						new Set([
							...getClassIds(loop),
							...getClassIds(lower),
							...getClassIds(upper)
						])
					).sort();
					const matIds = Array.from(
						new Set([...getMatIds(loop), ...getMatIds(lower), ...getMatIds(upper)])
					).sort((a, b) => a - b);


					const unusuallyLowHeight = !nonPositiveHeight && clearHeight < 2.0;
					const unusuallyHighHeight = !nonPositiveHeight && clearHeight > 6.0;

					const lowerApprox = Boolean(
						(lower as any).ambiguityFlags?.isApproximate ||
							(lower as any).qualityFlags?.approximateOverlap
					);
					const upperApprox = Boolean(
						(upper as any).ambiguityFlags?.isApproximate ||
							(upper as any).qualityFlags?.approximateOverlap
					);
					const approximateOverlap = lowerApprox || upperApprox;

					const weakLowerSupport =
						lower.status !== 'primary' || lower.score < 60 || lower.evidenceCoverageRatio < 0.5;
					const weakUpperCover =
						upper.status !== 'primary' || upper.score < 60 || upper.evidenceCoverageRatio < 0.5;

					const geometricallyPlausible =
						!nonPositiveHeight &&
						clearHeight >= 1.8 &&
						clearHeight <= 6.0 &&
						!approximateOverlap &&
						!weakLowerSupport &&
						!weakUpperCover &&
						lower.status === 'primary' &&
						upper.status === 'primary';

					let baseScore = (lower.score + upper.score) / 2;
					if (lower.status === 'secondary' || upper.status === 'secondary') {
						baseScore *= 0.85;
					}
					if (lower.status === 'noise' || upper.status === 'noise') {
						baseScore *= 0.3;
					}
					if (approximateOverlap) {
						baseScore *= 0.95;
					}
					if (unusuallyLowHeight || unusuallyHighHeight) {
						baseScore *= 0.85;
					}
					if (
						(lower as any).ambiguityFlags?.isOrientationConflict ||
						(upper as any).ambiguityFlags?.isOrientationConflict
					) {
						baseScore *= 0.8;
					}

					const score = nonPositiveHeight
						? 0
						: Number(Math.max(0, Math.min(100, baseScore)).toFixed(6));

					const cand: VerticalEnvelopeCandidate = {
						id: `env:${loop.id}|${lower.id}|${upper.id}`,
						loopCandidateId: loop.id,
						storeyCandidateId: loop.storeyCandidateId,
						lowerAssignmentId: lower.id,
						upperAssignmentId: upper.id,
						lowerHorizontalEvidenceId: lower.horizontalEvidenceId,
						upperHorizontalEvidenceId: upper.horizontalEvidenceId,
						logicalObjectIds: logicalIds,
						classificationUnitIds: classificationIds,
						materialIds: matIds,
						lowerElevation: Number(lower.elevation.toFixed(6)),
						upperElevation: Number(upper.elevation.toFixed(6)),
						clearHeight,
						loopArea: Number(loop.area.toFixed(6)),
						estimatedVolume: Number((loop.area * clearHeight).toFixed(6)),
						score,
						status: 'noise',
						rank: 1,
						qualityFlags: {
							missingLower: false,
							missingUpper: false,
							nonPositiveHeight,
							unusuallyLowHeight,
							unusuallyHighHeight,
							approximateOverlap,
							multipleEnvelopeCandidates: false,
							weakLowerSupport,
							weakUpperCover,
							geometricallyPlausible
						}
					};
					loopCandidates.push(cand);
				}
			}
		}

		// Rank and assign status within loopCandidates
		const validCandidates = loopCandidates.filter(
			(c) =>
				!c.qualityFlags.missingLower &&
				!c.qualityFlags.missingUpper &&
				!c.qualityFlags.nonPositiveHeight &&
				c.score > 0
		);

		if (validCandidates.length > 0) {
			validCandidates.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				if (a.clearHeight !== b.clearHeight) return a.clearHeight - b.clearHeight;
				return a.id.localeCompare(b.id);
			});

			const topCandidate = validCandidates[0];
			for (const cand of loopCandidates) {
				if (
					cand.qualityFlags.missingLower ||
					cand.qualityFlags.missingUpper ||
					cand.qualityFlags.nonPositiveHeight ||
					cand.score <= 0
				) {
					cand.status = 'noise';
					continue;
				}

				const lowerAssign = assignments.find((a) => a.id === cand.lowerAssignmentId);
				const upperAssign = assignments.find((a) => a.id === cand.upperAssignmentId);
				const eitherNoise =
					lowerAssign?.status === 'noise' || upperAssign?.status === 'noise';

				if (eitherNoise || cand.score < 30 || cand.score < topCandidate.score * 0.5) {
					cand.status = 'noise';
				} else if (
					topCandidate.score >= 50 &&
					(cand.score >= topCandidate.score - 2.0 || Math.abs(cand.score - topCandidate.score) <= 1e-4) &&
					!cand.qualityFlags.weakLowerSupport &&
					!cand.qualityFlags.weakUpperCover &&
					cand.score >= 60
				) {
					cand.status = 'primary';
				} else if (cand.score >= 30) {
					cand.status = 'secondary';
				} else {
					cand.status = 'noise';
				}
			}
		} else {
			for (const cand of loopCandidates) {
				cand.status = 'noise';
			}
		}

		// Sort all loopCandidates: primary -> secondary -> noise, then by score desc, then id asc
		loopCandidates.sort((a, b) => {
			const statusOrder = { primary: 0, secondary: 1, noise: 2 };
			if (statusOrder[a.status] !== statusOrder[b.status]) {
				return statusOrder[a.status] - statusOrder[b.status];
			}
			if (b.score !== a.score) return b.score - a.score;
			return a.id.localeCompare(b.id);
		});

		const plausibleCount = loopCandidates.filter(
			(c) => c.status === 'primary' || c.status === 'secondary'
		).length;
		const isMultiple = plausibleCount > 1;

		for (let i = 0; i < loopCandidates.length; i++) {
			loopCandidates[i].rank = i + 1;
			loopCandidates[i].qualityFlags.multipleEnvelopeCandidates = isMultiple;
		}

		if (plausibleCount === 1) {
			loopsWithSingleEnvelope++;
		} else if (plausibleCount > 1) {
			loopsWithMultipleEnvelopes++;
		}

		candidates.push(...loopCandidates);
	}

	const primaryEnvelopeCandidates = candidates.filter((c) => c.status === 'primary').length;
	const secondaryEnvelopeCandidates = candidates.filter((c) => c.status === 'secondary').length;
	const noiseEnvelopeCandidates = candidates.filter((c) => c.status === 'noise').length;

	const diagnostics: VerticalEnvelopeDiagnostics = {
		loopsInspected,
		primaryEnvelopeCandidates,
		secondaryEnvelopeCandidates,
		noiseEnvelopeCandidates,
		loopsWithSingleEnvelope,
		loopsWithMultipleEnvelopes,
		loopsMissingLowerSupport,
		loopsMissingUpperCover,
		rejectedNonPositiveHeights,
		fingerprint: calculateVerticalEnvelopeCandidateFingerprint(candidates)
	};

	return {
		candidates,
		diagnostics
	};
}

export function refineVerticalEnvelopeCandidates(
	envelopes: VerticalEnvelopeCandidate[],
	loops: RankedBoundaryLoopCandidate[],
	verticalBarrierEvidence: VerticalBarrierEvidence[],
	storeyBands: StoreyBandEvidence[]
): RefinedVerticalEnvelopeResult {
	const profiles: LoopVerticalExtentProfile[] = [];
	const refinedCandidates: RefinedVerticalEnvelopeCandidate[] = [];

	let loopsInspected = 0;
	let loopsWithUsableProfiles = 0;
	let loopsWithInsufficientEvidence = 0;
	let loopsWithoutEligibleEnvelopes = 0;
	let rawPrimaryCount = 0;
	let rawSecondaryCount = 0;
	let rawNoiseCount = 0;
	let refinedPrimaryCount = 0;
	let refinedSecondaryCount = 0;
	let refinedNoiseCount = 0;
	let envelopesPromoted = 0;
	let envelopesDemoted = 0;

	// Keep track of old vs new selection per loop to report changes
	const oldSelectedMap = new Map<string, string>();
	const newSelectedMap = new Map<string, string>();
	const oldHeightMap = new Map<string, number>();
	const newHeightMap = new Map<string, number>();
	const oldWeakUpperMap = new Map<string, boolean>();
	const newWeakUpperMap = new Map<string, boolean>();
	const oldLowHeightMap = new Map<string, boolean>();
	const newLowHeightMap = new Map<string, boolean>();

	const profileMap = new Map<string, LoopVerticalExtentProfile>();

	function getLength(seg: any): number {
		const dx = seg.end.x - seg.start.x;
		const dz = seg.end.z - seg.start.z;
		return Math.sqrt(dx * dx + dz * dz);
	}

	function getWeightedMedian(values: number[], weights: number[]): number {
		if (values.length === 0) return 0;
		if (values.length === 1) return values[0];
		const pairs = values.map((v, i) => ({ value: v, weight: weights[i] }));
		pairs.sort((a, b) => a.value - b.value);
		const totalWeight = pairs.reduce((sum, p) => sum + p.weight, 0);
		if (totalWeight <= 0) {
			const mid = Math.floor(pairs.length / 2);
			return pairs.length % 2 === 0 ? (pairs[mid - 1].value + pairs[mid].value) / 2 : pairs[mid].value;
		}
		let cumulativeWeight = 0;
		for (let i = 0; i < pairs.length; i++) {
			cumulativeWeight += pairs[i].weight;
			if (cumulativeWeight >= totalWeight / 2) {
				return pairs[i].value;
			}
		}
		return pairs[pairs.length - 1].value;
	}

	for (const loop of loops) {
		if (loop.status === 'noise') continue;
		loopsInspected++;

		const storeyBand = storeyBands.find((s) => s.id === loop.storeyCandidateId);
		const storeyFloor = storeyBand ? storeyBand.elevationRange.min : 0.0;

		const referencedEvidenceCount = loop.verticalEvidenceIds.length;
		const missingReferencedEvidenceIds: string[] = [];
		const barriers: VerticalBarrierEvidence[] = [];

		for (const id of loop.verticalEvidenceIds) {
			const v = verticalBarrierEvidence.find(ev => ev.id === id);
			if (v) {
				barriers.push(v);
			} else {
				missingReferencedEvidenceIds.push(id);
			}
		}

		const referencedEvidenceFound = barriers.length;
		const rejectedReferencedEvidence = missingReferencedEvidenceIds.length;

		const bases: number[] = [];
		const tops: number[] = [];
		const weights: number[] = [];
		const evidenceIds: string[] = [];

		let minObservedBase = Infinity;
		let maxObservedTop = -Infinity;

		for (const ve of barriers) {
			const b = ve.elevationRange.min;
			const t = ve.elevationRange.max;
			if (b < minObservedBase) minObservedBase = b;
			if (t > maxObservedTop) maxObservedTop = t;

			const baseVal = Math.max(b, storeyFloor);
			const topVal = Math.max(baseVal, t);
			const heightInStorey = topVal - baseVal;
			const len = getLength(ve.segment);
			const wt = len * heightInStorey * (ve.quality || 1.0);

			if (wt > 1e-4 && heightInStorey > 0.01) {
				bases.push(baseVal);
				tops.push(topVal);
				weights.push(wt);
				evidenceIds.push(ve.id);
			}
		}

		let robustBase = 0;
		let robustTop = 0;
		let robustSpan = 0;
		let dispersion = 0;
		let consistency = 1.0;
		let confidence = 1.0;
		let insufficientEvidence = false;

		if (bases.length === 0) {
			insufficientEvidence = true;
			loopsWithInsufficientEvidence++;
		} else {
			robustBase = getWeightedMedian(bases, weights);
			robustTop = getWeightedMedian(tops, weights);
			robustSpan = robustTop - robustBase;

			if (robustSpan <= 0.1) {
				insufficientEvidence = true;
				loopsWithInsufficientEvidence++;
			} else {
				loopsWithUsableProfiles++;

				// Mean Absolute Deviation
				const madBase = getWeightedMedian(
					bases.map((b) => Math.abs(b - robustBase)),
					weights
				);
				const madTop = getWeightedMedian(
					tops.map((t) => Math.abs(t - robustTop)),
					weights
				);
				dispersion = madBase + madTop;
				consistency = 1.0 - Math.min(1.0, dispersion / Math.max(1.0, robustSpan));

				const baseRange = Math.max(...bases) - Math.min(...bases);
				const topRange = Math.max(...tops) - Math.min(...tops);

				const inconsistentBases = baseRange > 0.3;
				const inconsistentTops = topRange > 0.3;

				const totalBarrierLength = barriers.reduce(
					(sum, ve) => sum + getLength(ve.segment),
					0
				);
				const fragmentedVerticalEvidence = totalBarrierLength < 0.5 * loop.perimeter;
				const approximateExtent = dispersion > 0.15 * robustSpan || loop.isAmbiguous;

				confidence = 1.0;
				if (inconsistentBases) confidence -= 0.15;
				if (inconsistentTops) confidence -= 0.15;
				if (fragmentedVerticalEvidence) confidence -= 0.2;
				if (approximateExtent) confidence -= 0.1;
				confidence = Math.max(0.0, confidence);

				const profile: LoopVerticalExtentProfile = {
					loopId: loop.id,
					evidenceIds,
					evidenceCount: evidenceIds.length,
					referencedEvidenceCount,
					referencedEvidenceFound,
					rejectedReferencedEvidence,
					missingReferencedEvidenceIds,
					minObservedBase: minObservedBase === Infinity ? 0 : minObservedBase,
					maxObservedTop: maxObservedTop === -Infinity ? 0 : maxObservedTop,
					robustBase,
					robustTop,
					robustSpan,
					dispersion,
					consistency,
					confidence,
					flags: {
						insufficientEvidence,
						inconsistentBases,
						inconsistentTops,
						fragmentedVerticalEvidence,
						approximateExtent
					}
				};

				profiles.push(profile);
				profileMap.set(loop.id, profile);
			}
		}

		if (insufficientEvidence) {
			const profile: LoopVerticalExtentProfile = {
				loopId: loop.id,
				evidenceIds: [],
				evidenceCount: 0,
				referencedEvidenceCount,
				referencedEvidenceFound,
				rejectedReferencedEvidence,
				missingReferencedEvidenceIds,
				minObservedBase: minObservedBase === Infinity ? 0 : minObservedBase,
				maxObservedTop: maxObservedTop === -Infinity ? 0 : maxObservedTop,
				robustBase: 0,
				robustTop: 0,
				robustSpan: 0,
				dispersion: 0,
				consistency: 0,
				confidence: 0,
				flags: {
					insufficientEvidence: true,
					inconsistentBases: false,
					inconsistentTops: false,
					fragmentedVerticalEvidence: false,
					approximateExtent: false
				}
			};
			profiles.push(profile);
			profileMap.set(loop.id, profile);
		}
	}

	// Group candidates by loop
	const envelopesByLoop = new Map<string, VerticalEnvelopeCandidate[]>();
	for (const env of envelopes) {
		const list = envelopesByLoop.get(env.loopCandidateId) || [];
		list.push(env);
		envelopesByLoop.set(env.loopCandidateId, list);
	}

	for (const [loopId, list] of envelopesByLoop.entries()) {
		// Old selection sorting
		const rawValid = list.filter((c) => c.status === 'primary' || c.status === 'secondary');
		rawValid.sort((a, b) => {
			const statusOrder = { primary: 0, secondary: 1, noise: 2 };
			if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
			if (b.score !== a.score) return b.score - a.score;
			return a.id.localeCompare(b.id);
		});
		if (rawValid.length > 0) {
			oldSelectedMap.set(loopId, rawValid[0].id);
			oldHeightMap.set(loopId, rawValid[0].clearHeight);
			oldWeakUpperMap.set(loopId, Boolean(rawValid[0].qualityFlags?.weakUpperCover));
			oldLowHeightMap.set(loopId, rawValid[0].clearHeight < 1.0);
		}
	}

	// Refined scoring and status assignment
	for (const [loopId, list] of envelopesByLoop.entries()) {
		const profile = profileMap.get(loopId);
		const loopCandidates: RefinedVerticalEnvelopeCandidate[] = [];

		for (const env of list) {
			let refinedScore = env.score;
			let baseAlignment = 0;
			let topAlignment = 0;
			let barrierSpanCoverage = 0;
			const refinementReasons: string[] = [];

			if (env.status === 'primary') rawPrimaryCount++;
			else if (env.status === 'secondary') rawSecondaryCount++;
			else if (env.status === 'noise') rawNoiseCount++;

			if (!profile || profile.flags.insufficientEvidence) {
				refinementReasons.push('insufficient-evidence');
				const refinedCand: RefinedVerticalEnvelopeCandidate = {
					...env,
					rawScore: env.score,
					rawStatus: env.status,
					refinedScore: env.score,
					refinedStatus: env.status,
					refinedRank: env.rank,
					baseAlignment,
					topAlignment,
					barrierSpanCoverage,
					refinementReasons,
					verticalExtentProfile: profile || {
						loopId,
						evidenceIds: [],
						evidenceCount: 0,
						referencedEvidenceCount: 0,
						referencedEvidenceFound: 0,
						rejectedReferencedEvidence: 0,
						missingReferencedEvidenceIds: [],
						minObservedBase: 0,
						maxObservedTop: 0,
						robustBase: 0,
						robustTop: 0,
						robustSpan: 0,
						dispersion: 0,
						consistency: 0,
						confidence: 0,
						flags: {
							insufficientEvidence: true,
							inconsistentBases: false,
							inconsistentTops: false,
							fragmentedVerticalEvidence: false,
							approximateExtent: false
						}
					},
					eligibleForRoomAssembly: false,
					ineligibilityReasons: ['insufficient-evidence'],
					relativeBaseTolerance: 0.15,
					relativeTopTolerance: 0.30
				};
				loopCandidates.push(refinedCand);
			} else {
				const baseDiff = Math.abs(env.lowerElevation - profile.robustBase);
				const topDiff = Math.abs(env.upperElevation - profile.robustTop);
				baseAlignment = baseDiff;
				topAlignment = topDiff;

				const relativeBaseTolerance = Math.min(0.15, Math.max(0.05, 0.05 * profile.robustSpan));
				const relativeTopTolerance = Math.min(0.30, Math.max(0.05, 0.10 * profile.robustSpan));

				const baseAligned = baseDiff <= relativeBaseTolerance;
				const topAligned = topDiff <= relativeTopTolerance;

				const coveredMin = Math.max(env.lowerElevation, profile.robustBase);
				const coveredMax = Math.min(env.upperElevation, profile.robustTop);
				const coveredSpan = Math.max(0, coveredMax - coveredMin);
				barrierSpanCoverage = profile.robustSpan > 0 ? coveredSpan / profile.robustSpan : 0.0;

				let penalty = 0.0;

				if (baseAligned) {
					refinementReasons.push('base-aligned');
				} else {
					const basePenalty = Math.min(30, (baseDiff - relativeBaseTolerance) * 30);
					penalty += basePenalty;
					refinementReasons.push(`base-displaced-${baseDiff.toFixed(3)}m`);
				}

				if (topAligned) {
					refinementReasons.push('top-aligned');
				} else {
					const topPenalty = Math.min(30, (topDiff - relativeTopTolerance) * 30);
					penalty += topPenalty;
					refinementReasons.push(`top-displaced-${topDiff.toFixed(3)}m`);
				}

				const clearHeightRatio = env.clearHeight / profile.robustSpan;
				if (clearHeightRatio < 0.8) {
					const deficitPenalty = (0.8 - clearHeightRatio) * 60;
					penalty += deficitPenalty;
					refinementReasons.push(`insufficient-span-coverage-${(clearHeightRatio * 100).toFixed(0)}%`);
				} else {
					refinementReasons.push('substantial-span-coverage');
				}

				if (env.qualityFlags?.weakUpperCover) {
					penalty += 15.0;
					refinementReasons.push('weak-upper-support');
				}
				if (env.qualityFlags?.weakLowerSupport) {
					penalty += 15.0;
					refinementReasons.push('weak-lower-support');
				}
				if (env.qualityFlags?.approximateOverlap) {
					penalty += 5.0;
					refinementReasons.push('approximate-overlap');
				}

				refinedScore = Math.max(0, Math.min(100, env.score - penalty));
				refinedScore = Number(refinedScore.toFixed(6));

				const refinedCand: RefinedVerticalEnvelopeCandidate = {
					...env,
					score: refinedScore,
					rawScore: env.score,
					rawStatus: env.status,
					refinedScore,
					refinedStatus: 'noise',
					refinedRank: 1,
					baseAlignment,
					topAlignment,
					barrierSpanCoverage,
					refinementReasons,
					verticalExtentProfile: profile,
					eligibleForRoomAssembly: false,
					ineligibilityReasons: [],
					relativeBaseTolerance,
					relativeTopTolerance
				};
				loopCandidates.push(refinedCand);
			}
		}

		let eligibleCountInLoop = 0;
		for (const cand of loopCandidates) {
			const ineligibilityReasons: string[] = [];
			if (cand.qualityFlags.missingLower) ineligibilityReasons.push('missing-lower-support');
			if (cand.qualityFlags.missingUpper) ineligibilityReasons.push('missing-upper-cover');
			if (cand.qualityFlags.nonPositiveHeight) ineligibilityReasons.push('non-positive-height');
			if (cand.refinedScore < 30) ineligibilityReasons.push('refined-score-below-threshold');
			else if (cand.refinedScore <= 0) ineligibilityReasons.push('refined-score-zero');
			
			if (ineligibilityReasons.length === 0) {
				cand.eligibleForRoomAssembly = true;
				eligibleCountInLoop++;
			} else {
				cand.eligibleForRoomAssembly = false;
				cand.ineligibilityReasons = ineligibilityReasons;
			}
		}

		if (eligibleCountInLoop === 0) {
			loopsWithoutEligibleEnvelopes++;
		}

		// Rank within loop
		const validCandidates = loopCandidates.filter(c => c.eligibleForRoomAssembly);

		if (validCandidates.length > 0) {
			validCandidates.sort((a, b) => {
				if (Math.abs(b.refinedScore - a.refinedScore) >= 1e-6) return b.refinedScore - a.refinedScore;
				return a.id.localeCompare(b.id);
			});

			const topCandidate = validCandidates[0];
			for (const cand of loopCandidates) {
				if (!cand.eligibleForRoomAssembly) {
					cand.refinedStatus = 'noise';
					cand.status = 'noise';
					continue;
				}

				const eitherNoise = cand.rawStatus === 'noise';
				if (eitherNoise || cand.refinedScore < 30 || cand.refinedScore < topCandidate.refinedScore * 0.5) {
					cand.refinedStatus = 'noise';
				} else if (
					topCandidate.refinedScore >= 50 &&
					(cand.refinedScore >= topCandidate.refinedScore - 2.0 || Math.abs(cand.refinedScore - topCandidate.refinedScore) <= 1e-4) &&
					!cand.qualityFlags.weakLowerSupport &&
					!cand.qualityFlags.weakUpperCover &&
					cand.refinedScore >= 60
				) {
					cand.refinedStatus = 'primary';
				} else if (cand.refinedScore >= 30) {
					cand.refinedStatus = 'secondary';
				} else {
					cand.refinedStatus = 'noise';
				}

				if (cand === topCandidate && cand.rawStatus !== 'noise') {
					if (cand.refinedScore < 30) {
						cand.refinedStatus = 'secondary';
					}
				}

				cand.status = cand.refinedStatus;
			}
		} else {
			for (const cand of loopCandidates) {
				cand.refinedStatus = 'noise';
				cand.status = 'noise';
			}
		}

		// Sort all candidates: primary -> secondary -> noise, score desc, id
		loopCandidates.sort((a, b) => {
			const statusOrder = { primary: 0, secondary: 1, noise: 2 };
			if (statusOrder[a.refinedStatus] !== statusOrder[b.refinedStatus]) {
				return statusOrder[a.refinedStatus] - statusOrder[b.refinedStatus];
			}
			if (Math.abs(b.refinedScore - a.refinedScore) >= 1e-6) return b.refinedScore - a.refinedScore;
			return a.id.localeCompare(b.id);
		});

		const plausibleCount = loopCandidates.filter(
			(c) => c.refinedStatus === 'primary' || c.refinedStatus === 'secondary'
		).length;
		const isMultiple = plausibleCount > 1;

		for (let i = 0; i < loopCandidates.length; i++) {
			loopCandidates[i].refinedRank = i + 1;
			loopCandidates[i].rank = i + 1;
			loopCandidates[i].qualityFlags.multipleEnvelopeCandidates = isMultiple;

			const statusOrder = { primary: 0, secondary: 1, noise: 2 };
			const rawOrder = statusOrder[loopCandidates[i].rawStatus];
			const refOrder = statusOrder[loopCandidates[i].refinedStatus];
			if (refOrder < rawOrder) envelopesPromoted++;
			if (refOrder > rawOrder) envelopesDemoted++;

			if (loopCandidates[i].refinedStatus === 'primary') refinedPrimaryCount++;
			else if (loopCandidates[i].refinedStatus === 'secondary') refinedSecondaryCount++;
			else if (loopCandidates[i].refinedStatus === 'noise') refinedNoiseCount++;
		}

		if (plausibleCount > 0) {
			const selected = loopCandidates[0];
			newSelectedMap.set(loopId, selected.id);
			newHeightMap.set(loopId, selected.clearHeight);
			newWeakUpperMap.set(loopId, Boolean(selected.qualityFlags?.weakUpperCover));
			newLowHeightMap.set(loopId, selected.clearHeight < 1.0);
		}

		refinedCandidates.push(...loopCandidates);
	}

	let selectedEnvelopeChangedCount = 0;
	let selectedLowHeightBefore = 0;
	let selectedLowHeightAfter = 0;
	let weakUpperSelectionsBefore = 0;
	let weakUpperSelectionsAfter = 0;
	let barrierAlignedSelections = 0;

	for (const loopId of oldSelectedMap.keys()) {
		const oldSel = oldSelectedMap.get(loopId);
		const newSel = newSelectedMap.get(loopId);
		if (oldSel !== newSel) {
			selectedEnvelopeChangedCount++;
		}
		if (oldLowHeightMap.get(loopId)) selectedLowHeightBefore++;
		if (newLowHeightMap.get(loopId)) selectedLowHeightAfter++;
		if (oldWeakUpperMap.get(loopId)) weakUpperSelectionsBefore++;
		if (newWeakUpperMap.get(loopId)) weakUpperSelectionsAfter++;

		const selectedEnv = refinedCandidates.find((c) => c.id === newSel);
		if (selectedEnv && selectedEnv.verticalExtentProfile) {
			const profile = selectedEnv.verticalExtentProfile;
			if (!profile.flags.insufficientEvidence) {
				const baseDiff = Math.abs(selectedEnv.lowerElevation - profile.robustBase);
				const topDiff = Math.abs(selectedEnv.upperElevation - profile.robustTop);
				const alignTol = Math.max(0.05, 0.1 * profile.robustSpan);
				if (baseDiff <= alignTol && topDiff <= alignTol) {
					barrierAlignedSelections++;
				}
			}
		}
	}

	const refinementFingerprint = calculateRefinedVerticalEnvelopeCandidateFingerprint(refinedCandidates);

	const eligibleEnvelopeCount = refinedCandidates.filter(c => c.eligibleForRoomAssembly).length;
	const ineligibleFallbackCount = refinedCandidates.filter(c => !c.eligibleForRoomAssembly && (c.rawStatus === 'primary' || c.rawStatus === 'secondary')).length;

	const diagnostics: VerticalEnvelopeRefinementDiagnostics = {
		loopsInspected,
		loopsWithUsableProfiles,
		loopsWithInsufficientEvidence,
		loopsWithoutEligibleEnvelopes,
		rawPrimaryCount,
		rawSecondaryCount,
		rawNoiseCount,
		refinedPrimaryCount,
		refinedSecondaryCount,
		refinedNoiseCount,
		eligibleEnvelopeCount,
		ineligibleFallbackCount,
		envelopesPromoted,
		envelopesDemoted,
		selectedEnvelopeChangedCount,
		selectedLowHeightBefore,
		selectedLowHeightAfter,
		weakUpperSelectionsBefore,
		weakUpperSelectionsAfter,
		barrierAlignedSelections,
		refinementFingerprint
	};

	return {
		candidates: refinedCandidates,
		profiles,
		diagnostics
	};
}

export function calculateRefinedVerticalEnvelopeCandidateFingerprint(
	candidates: RefinedVerticalEnvelopeCandidate[]
): string {
	const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
	const hash = createHash('sha256');
	for (const cand of sorted) {
		hash.update(
			`${cand.id}:${cand.status}:${cand.rank}:${cand.score.toFixed(6)}:${cand.refinedScore.toFixed(6)}:${cand.refinedStatus}:${cand.refinedRank}:${cand.baseAlignment.toFixed(6)}:${cand.topAlignment.toFixed(6)}:${cand.barrierSpanCoverage.toFixed(6)}|`
		);
	}
	return hash.digest('hex');
}
