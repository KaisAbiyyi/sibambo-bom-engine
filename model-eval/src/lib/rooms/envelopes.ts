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
	VerticalEnvelopeQualityFlags
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
