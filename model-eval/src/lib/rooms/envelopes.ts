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


function compareIds(a: string, b: string): number {
	return a < b ? -1 : (a > b ? 1 : 0);
}

function compareCandidateIds(
	a: { id: string; loopCandidateId: string; lowerAssignmentId: string; upperAssignmentId: string },
	b: { id: string; loopCandidateId: string; lowerAssignmentId: string; upperAssignmentId: string }
): number {
	if (a.loopCandidateId !== b.loopCandidateId) {
		return a.loopCandidateId < b.loopCandidateId ? -1 : 1;
	}
	if (a.lowerAssignmentId !== b.lowerAssignmentId) {
		return a.lowerAssignmentId < b.lowerAssignmentId ? -1 : 1;
	}
	if (a.upperAssignmentId !== b.upperAssignmentId) {
		return a.upperAssignmentId < b.upperAssignmentId ? -1 : 1;
	}
	return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}

function statusRank(status: string): number {
	return status === 'primary' ? 0 : (status === 'secondary' ? 1 : 2);
}

export function calculateVerticalEnvelopeCandidateFingerprint(
	candidates: VerticalEnvelopeCandidate[]
): string {
	const sorted = [...candidates].sort(compareCandidateIds);
	const hash = createHash('sha256');
	for (let i = 0; i < sorted.length; i++) {
		const cand = sorted[i];
		hash.update(cand.id);
		hash.update(':');
		hash.update(cand.status);
		hash.update(':');
		hash.update(cand.rank.toString());
		hash.update(':');
		hash.update(cand.score.toFixed(6));
		hash.update(':');
		hash.update(cand.loopCandidateId);
		hash.update(':');
		hash.update(cand.lowerAssignmentId);
		hash.update(':');
		hash.update(cand.upperAssignmentId);
		hash.update(':');
		hash.update(cand.clearHeight.toFixed(6));
		hash.update(':');
		hash.update(cand.estimatedVolume.toFixed(6));
		hash.update('|');
	}
	return hash.digest('hex');
}

function round6(x: number): number {
	return Math.round(x * 1e6) / 1e6;
}

function mergeUniqueStrings(a: string[], b: string[], c: string[]): string[] {
	if (a.length === 0 && b.length === 0 && c.length === 0) return [];
	if (a.length === 0 && b.length === 0) return c;
	if (a.length === 0 && c.length === 0) return b;
	if (b.length === 0 && c.length === 0) return a;
	const set = new Set<string>();
	for (let i = 0; i < a.length; i++) set.add(a[i]);
	for (let i = 0; i < b.length; i++) set.add(b[i]);
	for (let i = 0; i < c.length; i++) set.add(c[i]);
	const res = Array.from(set);
	res.sort();
	return res;
}
function mergeUniqueNumbers(a: number[], b: number[], c: number[]): number[] {
	if (a.length === 0 && b.length === 0 && c.length === 0) return [];
	if (a.length === 0 && b.length === 0) return c;
	if (a.length === 0 && c.length === 0) return b;
	if (b.length === 0 && c.length === 0) return a;
	const set = new Set<number>();
	for (let i = 0; i < a.length; i++) set.add(a[i]);
	for (let i = 0; i < b.length; i++) set.add(b[i]);
	for (let i = 0; i < c.length; i++) set.add(c[i]);
	const res = Array.from(set);
	res.sort((x, y) => x - y);
	return res;
}

class LazyEnvelopeCandidate implements VerticalEnvelopeCandidate {
	id: string;
	loopCandidateId: string;
	storeyCandidateId: string;
	lowerAssignmentId: string;
	upperAssignmentId: string;
	lowerHorizontalEvidenceId: string;
	upperHorizontalEvidenceId: string;
	lowerElevation: number;
	upperElevation: number;
	clearHeight: number;
	loopArea: number;
	estimatedVolume: number;
	score: number;
	status: VerticalEnvelopeStatus;
	rank: number;
	qualityFlags: VerticalEnvelopeQualityFlags;

	_logA: string[];
	_logB: string[];
	_logC: string[];
	_classA: string[];
	_classB: string[];
	_classC: string[];
	_matA: number[];
	_matB: number[];
	_matC: number[];

	_logicalObjectIds?: string[];
	_classificationUnitIds?: string[];
	_materialIds?: number[];

	constructor(
		id: string,
		loopCandidateId: string,
		storeyCandidateId: string,
		lowerAssignmentId: string,
		upperAssignmentId: string,
		lowerHorizontalEvidenceId: string,
		upperHorizontalEvidenceId: string,
		lowerElevation: number,
		upperElevation: number,
		clearHeight: number,
		loopArea: number,
		estimatedVolume: number,
		score: number,
		status: VerticalEnvelopeStatus,
		rank: number,
		qualityFlags: VerticalEnvelopeQualityFlags,
		logA: string[], logB: string[], logC: string[],
		classA: string[], classB: string[], classC: string[],
		matA: number[], matB: number[], matC: number[]
	) {
		this.id = id;
		this.loopCandidateId = loopCandidateId;
		this.storeyCandidateId = storeyCandidateId;
		this.lowerAssignmentId = lowerAssignmentId;
		this.upperAssignmentId = upperAssignmentId;
		this.lowerHorizontalEvidenceId = lowerHorizontalEvidenceId;
		this.upperHorizontalEvidenceId = upperHorizontalEvidenceId;
		this.lowerElevation = lowerElevation;
		this.upperElevation = upperElevation;
		this.clearHeight = clearHeight;
		this.loopArea = loopArea;
		this.estimatedVolume = estimatedVolume;
		this.score = score;
		this.status = status;
		this.rank = rank;
		this.qualityFlags = qualityFlags;
		this._logA = logA;
		this._logB = logB;
		this._logC = logC;
		this._classA = classA;
		this._classB = classB;
		this._classC = classC;
		this._matA = matA;
		this._matB = matB;
		this._matC = matC;
	}

	get logicalObjectIds(): string[] {
		if (!this._logicalObjectIds) {
			this._logicalObjectIds = mergeUniqueStrings(this._logA, this._logB, this._logC);
		}
		return this._logicalObjectIds;
	}

	get classificationUnitIds(): string[] {
		if (!this._classificationUnitIds) {
			this._classificationUnitIds = mergeUniqueStrings(this._classA, this._classB, this._classC);
		}
		return this._classificationUnitIds;
	}

	get materialIds(): number[] {
		if (!this._materialIds) {
			this._materialIds = mergeUniqueNumbers(this._matA, this._matB, this._matC);
		}
		return this._materialIds;
	}

	toJSON() {
		return {
			...this,
			logicalObjectIds: this.logicalObjectIds,
			classificationUnitIds: this.classificationUnitIds,
			materialIds: this.materialIds
		};
	}

	toRefined(
		rawScore: number,
		rawStatus: VerticalEnvelopeStatus,
		refinedScore: number,
		refinedStatus: VerticalEnvelopeStatus,
		refinedRank: number,
		baseAlignment: number,
		topAlignment: number,
		barrierSpanCoverage: number,
		refinementReasons: string[] | undefined,
		verticalExtentProfile: LoopVerticalExtentProfile,
		eligibleForRoomAssembly: boolean,
		ineligibilityReasons: string[] | undefined,
		relativeBaseTolerance: number,
		relativeTopTolerance: number
	): RefinedVerticalEnvelopeCandidate {
		const cand = new LazyRefinedEnvelopeCandidate(
			this.id,
			this.loopCandidateId,
			this.storeyCandidateId,
			this.lowerAssignmentId,
			this.upperAssignmentId,
			this.lowerHorizontalEvidenceId,
			this.upperHorizontalEvidenceId,
			this.lowerElevation,
			this.upperElevation,
			this.clearHeight,
			this.loopArea,
			this.estimatedVolume,
			refinedScore,
			refinedStatus,
			refinedRank,
			this.qualityFlags,
			this._logA, this._logB, this._logC,
			this._classA, this._classB, this._classC,
			this._matA, this._matB, this._matC
		);
		cand.rawScore = rawScore;
		cand.rawStatus = rawStatus;
		cand.refinedScore = refinedScore;
		cand.refinedStatus = refinedStatus;
		cand.refinedRank = refinedRank;
		cand.baseAlignment = baseAlignment;
		cand.topAlignment = topAlignment;
		cand.barrierSpanCoverage = barrierSpanCoverage;
		if (refinementReasons) cand._refinementReasons = refinementReasons;
		cand.verticalExtentProfile = verticalExtentProfile;
		cand.eligibleForRoomAssembly = eligibleForRoomAssembly;
		if (ineligibilityReasons) cand._ineligibilityReasons = ineligibilityReasons;
		cand.relativeBaseTolerance = relativeBaseTolerance;
		cand.relativeTopTolerance = relativeTopTolerance;
		return cand;
	}
}

class LazyRefinedEnvelopeCandidate extends LazyEnvelopeCandidate implements RefinedVerticalEnvelopeCandidate {
	rawScore!: number;
	rawStatus!: VerticalEnvelopeStatus;
	refinedScore!: number;
	refinedStatus!: VerticalEnvelopeStatus;
	refinedRank!: number;
	baseAlignment!: number;
	topAlignment!: number;
	barrierSpanCoverage!: number;
	verticalExtentProfile!: LoopVerticalExtentProfile;
	eligibleForRoomAssembly!: boolean;
	relativeBaseTolerance!: number;
	relativeTopTolerance!: number;

	_refinementReasons?: string[];
	get refinementReasons(): string[] {
		if (!this._refinementReasons) {
			const reasons: string[] = [];
			const isInsuff = !this.verticalExtentProfile || this.verticalExtentProfile.flags.insufficientEvidence;
			if (isInsuff) {
				reasons.push('insufficient-evidence');
			} else if (this.rawScore <= 0 || this.qualityFlags?.nonPositiveHeight) {
				reasons.push('zero-score-or-non-positive-height');
			} else {
				const profile = this.verticalExtentProfile;
				const baseDiff = Math.abs(this.lowerElevation - profile.robustBase);
				const topDiff = Math.abs(this.upperElevation - profile.robustTop);
				const baseAligned = baseDiff <= this.relativeBaseTolerance;
				const topAligned = topDiff <= this.relativeTopTolerance;

				if (baseAligned) {
					reasons.push('base-aligned');
				} else {
					reasons.push(`base-displaced-${baseDiff.toFixed(3)}m`);
				}

				if (topAligned) {
					reasons.push('top-aligned');
				} else {
					reasons.push(`top-displaced-${topDiff.toFixed(3)}m`);
				}

				const clearHeightRatio = this.clearHeight / profile.robustSpan;
				if (clearHeightRatio < 0.8) {
					reasons.push(`insufficient-span-coverage-${(clearHeightRatio * 100).toFixed(0)}%`);
				} else {
					reasons.push('substantial-span-coverage');
				}

				if (this.qualityFlags?.weakUpperCover) reasons.push('weak-upper-support');
				if (this.qualityFlags?.weakLowerSupport) reasons.push('weak-lower-support');
				if (this.qualityFlags?.approximateOverlap) reasons.push('approximate-overlap');
			}
			this._refinementReasons = reasons;
		}
		return this._refinementReasons;
	}
	set refinementReasons(val: string[]) {
		this._refinementReasons = val;
	}

	_ineligibilityReasons?: string[];
	get ineligibilityReasons(): string[] {
		if (!this._ineligibilityReasons) {
			const reasons: string[] = [];
			const isInsuff = !this.verticalExtentProfile || this.verticalExtentProfile.flags.insufficientEvidence;
			if (isInsuff) {
				reasons.push('insufficient-evidence');
			} else {
				if (this.qualityFlags?.missingLower) reasons.push('missing-lower-support');
				if (this.qualityFlags?.missingUpper) reasons.push('missing-upper-cover');
				if (this.qualityFlags?.nonPositiveHeight) reasons.push('non-positive-height');
				if (this.refinedScore < 30) reasons.push('refined-score-below-threshold');
				else if (this.refinedScore <= 0) reasons.push('refined-score-zero');
			}
			this._ineligibilityReasons = reasons;
		}
		return this._ineligibilityReasons;
	}
	set ineligibilityReasons(val: string[]) {
		this._ineligibilityReasons = val;
	}

	override toJSON() {
		return {
			...super.toJSON(),
			refinementReasons: this.refinementReasons,
			ineligibilityReasons: this.ineligibilityReasons
		};
	}
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

	const assignmentById = new Map<string, RankedLoopSurfaceAssignment>();
	const assignmentsByLoopLower = new Map<string, Array<{
		assign: RankedLoopSurfaceAssignment;
		logIds: string[];
		classIds: string[];
		matIds: number[];
	}>>();
	const assignmentsByLoopUpper = new Map<string, Array<{
		assign: RankedLoopSurfaceAssignment;
		logIds: string[];
		classIds: string[];
		matIds: number[];
	}>>();

	for (const a of assignments) {
		assignmentById.set(a.id, a);
		if (a.role === 'lower-support') {
			let list = assignmentsByLoopLower.get(a.loopCandidateId);
			if (!list) { list = []; assignmentsByLoopLower.set(a.loopCandidateId, list); }
			list.push({
				assign: a,
				logIds: Array.from(new Set(getLogicalIds(a))).sort(),
				classIds: Array.from(new Set(getClassIds(a))).sort(),
				matIds: Array.from(new Set(getMatIds(a))).sort((x, y) => x - y)
			});
		} else if (a.role === 'upper-cover') {
			let list = assignmentsByLoopUpper.get(a.loopCandidateId);
			if (!list) { list = []; assignmentsByLoopUpper.set(a.loopCandidateId, list); }
			list.push({
				assign: a,
				logIds: Array.from(new Set(getLogicalIds(a))).sort(),
				classIds: Array.from(new Set(getClassIds(a))).sort(),
				matIds: Array.from(new Set(getMatIds(a))).sort((x, y) => x - y)
			});
		}
	}



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

		const lowerList = assignmentsByLoopLower.get(loop.id) || [];
		const upperList = assignmentsByLoopUpper.get(loop.id) || [];

		if (lowerList.length === 0) {
			loopsMissingLowerSupport++;
		}
		if (upperList.length === 0) {
			loopsMissingUpperCover++;
		}

		const loopCandidates: VerticalEnvelopeCandidate[] = [];
		const loopLogIds = Array.from(new Set(getLogicalIds(loop))).sort();
		const loopClassIds = Array.from(new Set(getClassIds(loop))).sort();
		const loopMatIds = Array.from(new Set(getMatIds(loop))).sort((a, b) => a - b);

		if (lowerList.length === 0 && upperList.length > 0) {
			for (const upperEntry of upperList) {
				const upper = upperEntry.assign;
				const cand = new LazyEnvelopeCandidate(
					`env:${loop.id}|no-lower|${upper.id}`,
					loop.id,
					loop.storeyCandidateId,
					'',
					upper.id,
					'',
					upper.horizontalEvidenceId,
					0,
					round6(upper.elevation),
					0,
					round6(loop.area),
					0,
					0,
					'noise',
					1,
					{
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
					},
					loopLogIds, [], upperEntry.logIds,
					loopClassIds, [], upperEntry.classIds,
					loopMatIds, [], upperEntry.matIds
				);
				loopCandidates.push(cand);
			}
		} else if (lowerList.length > 0 && upperList.length === 0) {
			for (const lowerEntry of lowerList) {
				const lower = lowerEntry.assign;
				const cand = new LazyEnvelopeCandidate(
					`env:${loop.id}|${lower.id}|no-upper`,
					loop.id,
					loop.storeyCandidateId,
					lower.id,
					'',
					lower.horizontalEvidenceId,
					'',
					round6(lower.elevation),
					round6(lower.elevation),
					0,
					round6(loop.area),
					0,
					0,
					'noise',
					1,
					{
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
					},
					loopLogIds, lowerEntry.logIds, [],
					loopClassIds, lowerEntry.classIds, [],
					loopMatIds, lowerEntry.matIds, []
				);
				loopCandidates.push(cand);
			}
		} else if (lowerList.length === 0 && upperList.length === 0) {
			const cand = new LazyEnvelopeCandidate(
				`env:${loop.id}|no-lower|no-upper`,
				loop.id,
				loop.storeyCandidateId,
				'',
				'',
				'',
				'',
				0,
				0,
				0,
				round6(loop.area),
				0,
				0,
				'noise',
				1,
				{
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
				},
				loopLogIds, [], [],
				loopClassIds, [], [],
				loopMatIds, [], []
			);
			loopCandidates.push(cand);
		} else {
			for (const lowerEntry of lowerList) {
				const lower = lowerEntry.assign;
				for (const upperEntry of upperList) {
					const upper = upperEntry.assign;
					const diff = upper.elevation - lower.elevation;
					const clearHeight = round6(Math.max(0, diff));
					const nonPositiveHeight = diff <= 0;

					if (nonPositiveHeight) {
						rejectedNonPositiveHeights++;
					}

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
						: round6(Math.max(0, Math.min(100, baseScore)));

					const cand = new LazyEnvelopeCandidate(
						`env:${loop.id}|${lower.id}|${upper.id}`,
						loop.id,
						loop.storeyCandidateId,
						lower.id,
						upper.id,
						lower.horizontalEvidenceId,
						upper.horizontalEvidenceId,
						round6(lower.elevation),
						round6(upper.elevation),
						clearHeight,
						round6(loop.area),
						round6(loop.area * clearHeight),
						score,
						'noise',
						1,
						{
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
						},
						loopLogIds, lowerEntry.logIds, upperEntry.logIds,
						loopClassIds, lowerEntry.classIds, upperEntry.classIds,
						loopMatIds, lowerEntry.matIds, upperEntry.matIds
					);
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
				return compareCandidateIds(a, b);
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

				const lowerAssign = assignmentById.get(cand.lowerAssignmentId);
				const upperAssign = assignmentById.get(cand.upperAssignmentId);
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
			const sd = statusRank(a.status) - statusRank(b.status);
			if (sd !== 0) return sd;
			if (b.score !== a.score) return b.score - a.score;
			return compareCandidateIds(a, b);
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
	const storeyBandById = new Map<string, StoreyBandEvidence>();
	for (const s of storeyBands) {
		storeyBandById.set(s.id, s);
	}
	const barrierEvidenceById = new Map<string, VerticalBarrierEvidence>();
	for (const ev of verticalBarrierEvidence) {
		barrierEvidenceById.set(ev.id, ev);
	}

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

		const storeyBand = storeyBandById.get(loop.storeyCandidateId);
		const storeyFloor = storeyBand ? storeyBand.elevationRange.min : 0.0;

		const referencedEvidenceCount = loop.verticalEvidenceIds.length;
		const missingReferencedEvidenceIds: string[] = [];
		const barriers: VerticalBarrierEvidence[] = [];

		for (const id of loop.verticalEvidenceIds) {
			const v = barrierEvidenceById.get(id);
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
			const sd = statusRank(a.status) - statusRank(b.status);
			if (sd !== 0) return sd;
			if (b.score !== a.score) return b.score - a.score;
			return compareCandidateIds(a, b);
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
		let eligibleCountInLoop = 0;

		for (const env of list) {
			let refinedScore = env.score;
			let baseAlignment = 0;
			let topAlignment = 0;
			let barrierSpanCoverage = 0;

			if (env.status === 'primary') rawPrimaryCount++;
			else if (env.status === 'secondary') rawSecondaryCount++;
			else if (env.status === 'noise') rawNoiseCount++;

			if (!profile || profile.flags.insufficientEvidence || env.score <= 0 || env.qualityFlags.nonPositiveHeight) {
				const isInsuff = !profile || profile.flags.insufficientEvidence;
				const baseAlignment = profile ? Math.abs(env.lowerElevation - profile.robustBase) : 0;
				const topAlignment = profile ? Math.abs(env.upperElevation - profile.robustTop) : 0;
				const prof = profile || {
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
				};

				if (env instanceof LazyEnvelopeCandidate) {
					loopCandidates.push(env.toRefined(
						env.score, env.status, isInsuff ? env.score : 0, isInsuff ? env.status : 'noise', env.rank,
						baseAlignment, topAlignment, 0, undefined, prof, false, undefined, 0.15, 0.30
					));
				} else {
					const refinementReasons = isInsuff ? ['insufficient-evidence'] : ['zero-score-or-non-positive-height'];
					const ineligibilityReasons: string[] = [];
					if (isInsuff) {
						ineligibilityReasons.push('insufficient-evidence');
					} else {
						if (env.qualityFlags?.missingLower) ineligibilityReasons.push('missing-lower-support');
						if (env.qualityFlags?.missingUpper) ineligibilityReasons.push('missing-upper-cover');
						if (env.qualityFlags?.nonPositiveHeight) ineligibilityReasons.push('non-positive-height');
						if (env.score < 30) ineligibilityReasons.push('refined-score-below-threshold');
						else if (env.score <= 0) ineligibilityReasons.push('refined-score-zero');
					}
					loopCandidates.push({
						...env, rawScore: env.score, rawStatus: env.status, refinedScore: isInsuff ? env.score : 0,
						refinedStatus: isInsuff ? env.status : 'noise', refinedRank: env.rank, baseAlignment, topAlignment,
						barrierSpanCoverage: 0, refinementReasons, verticalExtentProfile: prof, eligibleForRoomAssembly: false,
						ineligibilityReasons, relativeBaseTolerance: 0.15, relativeTopTolerance: 0.30
					});
				}
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
				if (!baseAligned) {
					penalty += Math.min(30, (baseDiff - relativeBaseTolerance) * 30);
				}
				if (!topAligned) {
					penalty += Math.min(30, (topDiff - relativeTopTolerance) * 30);
				}
				const clearHeightRatio = env.clearHeight / profile.robustSpan;
				if (clearHeightRatio < 0.8) {
					penalty += (0.8 - clearHeightRatio) * 60;
				}
				if (env.qualityFlags?.weakUpperCover) penalty += 15.0;
				if (env.qualityFlags?.weakLowerSupport) penalty += 15.0;
				if (env.qualityFlags?.approximateOverlap) penalty += 5.0;

				refinedScore = Math.max(0, Math.min(100, env.score - penalty));
				refinedScore = round6(refinedScore);

				const isEligible = !env.qualityFlags.missingLower && !env.qualityFlags.missingUpper && !env.qualityFlags.nonPositiveHeight && refinedScore >= 30;
				if (isEligible) eligibleCountInLoop++;

				if (env instanceof LazyEnvelopeCandidate) {
					loopCandidates.push(env.toRefined(
						env.score, env.status, refinedScore, 'noise', 1,
						baseAlignment, topAlignment, barrierSpanCoverage, undefined, profile,
						isEligible, undefined, relativeBaseTolerance, relativeTopTolerance
					));
				} else {
					const refinementReasons: string[] = [];
					if (baseAligned) refinementReasons.push('base-aligned');
					else refinementReasons.push(`base-displaced-${baseDiff.toFixed(3)}m`);
					if (topAligned) refinementReasons.push('top-aligned');
					else refinementReasons.push(`top-displaced-${topDiff.toFixed(3)}m`);
					if (clearHeightRatio < 0.8) refinementReasons.push(`insufficient-span-coverage-${(clearHeightRatio * 100).toFixed(0)}%`);
					else refinementReasons.push('substantial-span-coverage');
					if (env.qualityFlags?.weakUpperCover) refinementReasons.push('weak-upper-support');
					if (env.qualityFlags?.weakLowerSupport) refinementReasons.push('weak-lower-support');
					if (env.qualityFlags?.approximateOverlap) refinementReasons.push('approximate-overlap');

					const ineligibilityReasons: string[] = [];
					if (env.qualityFlags.missingLower) ineligibilityReasons.push('missing-lower-support');
					if (env.qualityFlags.missingUpper) ineligibilityReasons.push('missing-upper-cover');
					if (env.qualityFlags.nonPositiveHeight) ineligibilityReasons.push('non-positive-height');
					if (refinedScore < 30) ineligibilityReasons.push('refined-score-below-threshold');
					else if (refinedScore <= 0) ineligibilityReasons.push('refined-score-zero');

					loopCandidates.push({
						...env, score: refinedScore, rawScore: env.score, rawStatus: env.status,
						refinedScore, refinedStatus: 'noise', refinedRank: 1, baseAlignment, topAlignment,
						barrierSpanCoverage, refinementReasons, verticalExtentProfile: profile,
						eligibleForRoomAssembly: isEligible, ineligibilityReasons, relativeBaseTolerance, relativeTopTolerance
					});
				}
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
				return compareCandidateIds(a, b);
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
			const sd = statusRank(a.refinedStatus) - statusRank(b.refinedStatus);
			if (sd !== 0) return sd;
			if (Math.abs(b.refinedScore - a.refinedScore) >= 1e-6) return b.refinedScore - a.refinedScore;
			return compareCandidateIds(a, b);
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

	const refinedCandidateById = new Map<string, RefinedVerticalEnvelopeCandidate>();
	for (const c of refinedCandidates) {
		refinedCandidateById.set(c.id, c);
	}

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

		const selectedEnv = newSel ? refinedCandidateById.get(newSel) : undefined;
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
	const sorted = [...candidates].sort(compareCandidateIds);
	const hash = createHash('sha256');
	for (let i = 0; i < sorted.length; i++) {
		const cand = sorted[i];
		hash.update(cand.id);
		hash.update(':');
		hash.update(cand.status);
		hash.update(':');
		hash.update(cand.rank.toString());
		hash.update(':');
		hash.update(cand.score.toFixed(6));
		hash.update(':');
		hash.update(cand.refinedScore.toFixed(6));
		hash.update(':');
		hash.update(cand.refinedStatus);
		hash.update(':');
		hash.update(cand.refinedRank.toString());
		hash.update(':');
		hash.update(cand.baseAlignment.toFixed(6));
		hash.update(':');
		hash.update(cand.topAlignment.toFixed(6));
		hash.update(':');
		hash.update(cand.barrierSpanCoverage.toFixed(6));
		hash.update('|');
	}
	return hash.digest('hex');
}
