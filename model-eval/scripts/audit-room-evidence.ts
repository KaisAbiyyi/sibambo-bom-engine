import { createClassificationUnitIndex } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';
import { createRoomEvidenceProcessor } from '../src/lib/rooms/processor';
import { calculateRoomEvidenceFingerprint, calculateBarrierGraphFingerprint, normalizeBarrierGraph } from '../src/lib/rooms/helpers';
import { findBoundaryLoopCandidates, calculateBoundaryLoopFingerprint, rankBoundaryLoopCandidates } from '../src/lib/rooms/loops';
import { assignHorizontalEvidenceToLoops, calculateLoopSurfaceAssignmentFingerprint, rankLoopSurfaceAssignments, calculateRankedLoopSurfaceAssignmentFingerprint } from '../src/lib/rooms/surfaces';
import { buildVerticalEnvelopeCandidates, calculateVerticalEnvelopeCandidateFingerprint } from '../src/lib/rooms/envelopes';
import { assembleRoomCandidates, calculateRoomCandidateFingerprint } from '../src/lib/rooms/candidates';
import type { BoundaryLoopDiagnostics, LoopSurfaceAssignment, RankedBoundaryLoopCandidate, RankedLoopSurfaceAssignment, LoopSurfaceRoleSelection, RankedLoopSurfaceAssignmentDiagnostics, RankedLoopSurfaceAssignmentResult, VerticalEnvelopeCandidateResult, RoomCandidateResult, RoomCandidate } from '../src/lib/rooms/types';
import { createHash } from 'crypto';
import { resolve } from 'path';


function computeValueStats(valuesInput: number[]) {
	if (valuesInput.length === 0) {
		return { min: 0, median: 0, max: 0 };
	}
	const sorted = [...valuesInput].sort((a, b) => a - b);
	const min = Number(sorted[0].toFixed(6));
	const max = Number(sorted[sorted.length - 1].toFixed(6));
	const mid = Math.floor(sorted.length / 2);
	const median = Number((sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]).toFixed(6));
	return { min, median, max };
}

function computeEnvelopeStats(result: VerticalEnvelopeCandidateResult, loopsOfStatus: RankedBoundaryLoopCandidate[]) {
	const loopIds = new Set(loopsOfStatus.map(l => l.id));
	const subsetCandidates = result.candidates.filter(c => loopIds.has(c.loopCandidateId));
	
	const loopsInspected = loopsOfStatus.length;
	const primaryEnvelopeCount = subsetCandidates.filter(c => c.status === 'primary').length;
	const secondaryEnvelopeCount = subsetCandidates.filter(c => c.status === 'secondary').length;
	const noiseEnvelopeCount = subsetCandidates.filter(c => c.status === 'noise').length;

	let loopsWithSingleEnvelope = 0;
	let loopsWithMultipleEnvelopes = 0;
	let loopsMissingLowerSupport = 0;
	let loopsMissingUpperCover = 0;

	for (const loop of loopsOfStatus) {
		const loopCands = subsetCandidates.filter(c => c.loopCandidateId === loop.id);
		const plausibleCount = loopCands.filter(c => c.status === 'primary' || c.status === 'secondary').length;
		if (plausibleCount === 1) loopsWithSingleEnvelope++;
		if (plausibleCount > 1) loopsWithMultipleEnvelopes++;
		if (loopCands.some(c => c.qualityFlags.missingLower)) loopsMissingLowerSupport++;
		if (loopCands.some(c => c.qualityFlags.missingUpper)) loopsMissingUpperCover++;
	}

	const rejectedNonPositiveHeights = subsetCandidates.filter(c => c.qualityFlags.nonPositiveHeight).length;
	const plausibleCands = subsetCandidates.filter(c => c.status === 'primary' || c.status === 'secondary');
	const heightStats = computeValueStats(plausibleCands.map(c => c.clearHeight));
	const volumeStats = computeValueStats(plausibleCands.map(c => c.estimatedVolume));
	const fingerprint = calculateVerticalEnvelopeCandidateFingerprint(subsetCandidates);

	const topCandidates = subsetCandidates
		.slice()
		.sort((a, b) => {
			const statusOrder = { primary: 0, secondary: 1, noise: 2 };
			if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
			if (b.score !== a.score) return b.score - a.score;
			return a.id.localeCompare(b.id);
		})
		.slice(0, 5)
		.map(c => ({
			id: c.id,
			loopCandidateId: c.loopCandidateId,
			status: c.status,
			score: Number(c.score.toFixed(6)),
			clearHeight: Number(c.clearHeight.toFixed(6)),
			estimatedVolume: Number(c.estimatedVolume.toFixed(6)),
			qualityFlags: c.qualityFlags
		}));

	return {
		loopsInspected,
		primaryEnvelopeCount,
		secondaryEnvelopeCount,
		noiseEnvelopeCount,
		loopsWithSingleEnvelope,
		loopsWithMultipleEnvelopes,
		loopsMissingLowerSupport,
		loopsMissingUpperCover,
		rejectedNonPositiveHeights,
		heightStats,
		volumeStats,
		fingerprint,
		topCandidates
	};
}

function computeRoomStats(result: RoomCandidateResult, candidatesOfStatus: RoomCandidate[]) {
	const candidateCount = candidatesOfStatus.length;
	const areaStats = computeValueStats(candidatesOfStatus.map(c => c.planArea));
	const heightStats = computeValueStats(candidatesOfStatus.map(c => c.clearHeight));
	const volumeStats = computeValueStats(candidatesOfStatus.map(c => c.estimatedVolume));
	const fingerprint = calculateRoomCandidateFingerprint(candidatesOfStatus);

	const topCandidates = candidatesOfStatus
		.slice()
		.sort((a, b) => {
			const statusOrder = { primary: 0, secondary: 1, ambiguous: 2 };
			if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
			if (b.score !== a.score) return b.score - a.score;
			return a.id.localeCompare(b.id);
		})
		.slice(0, 5)
		.map(c => ({
			id: c.id,
			loopId: c.loopId,
			envelopeId: c.selectedEnvelopeId,
			status: c.status,
			score: Number(c.score.toFixed(6)),
			planArea: Number(c.planArea.toFixed(6)),
			clearHeight: Number(c.clearHeight.toFixed(6)),
			estimatedVolume: Number(c.estimatedVolume.toFixed(6)),
			qualityFlags: c.qualityFlags
		}));

	return {
		candidateCount,
		areaStats,
		heightStats,
		volumeStats,
		fingerprint,
		topCandidates
	};
}

function computeAreaStats(candidates: Array<{ area: number }>) {

	if (candidates.length === 0) {
		return { min: 0, median: 0, max: 0 };
	}
	const areas = candidates.map(c => c.area).sort((a, b) => a - b);
	const min = Number(areas[0].toFixed(6));
	const max = Number(areas[areas.length - 1].toFixed(6));
	const mid = Math.floor(areas.length / 2);
	const median = Number((areas.length % 2 === 0 ? (areas[mid - 1] + areas[mid]) / 2 : areas[mid]).toFixed(6));
	return { min, median, max };
}

function computeAssignmentStats(assignments: LoopSurfaceAssignment[], loopsOfStatus: RankedBoundaryLoopCandidate[]) {
	const loopIds = new Set(loopsOfStatus.map(l => l.id));
	const subsetAssignments = assignments.filter(a => loopIds.has(a.loopCandidateId));
	const loopsWithLowerSupport = loopsOfStatus.filter(l => subsetAssignments.some(a => a.loopCandidateId === l.id && a.role === 'lower-support')).length;
	const loopsWithUpperCover = loopsOfStatus.filter(l => subsetAssignments.some(a => a.loopCandidateId === l.id && a.role === 'upper-cover')).length;
	const loopsWithNoAssignment = loopsOfStatus.filter(l => !subsetAssignments.some(a => a.loopCandidateId === l.id)).length;
	const acceptedAssignmentCount = subsetAssignments.length;
	const approximateAssignmentCount = subsetAssignments.filter(a => a.qualityFlags.approximateOverlap).length;

	let coverageStats = { min: 0, median: 0, max: 0 };
	if (subsetAssignments.length > 0) {
		const ratios = subsetAssignments.map(a => a.loopCoverageRatio).sort((a, b) => a - b);
		const min = Number(ratios[0].toFixed(6));
		const max = Number(ratios[ratios.length - 1].toFixed(6));
		const mid = Math.floor(ratios.length / 2);
		const median = Number((ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid]).toFixed(6));
		coverageStats = { min, median, max };
	}

	const fingerprint = calculateLoopSurfaceAssignmentFingerprint(subsetAssignments);

	return {
		loopCountInspected: loopsOfStatus.length,
		loopsWithLowerSupport,
		loopsWithUpperCover,
		loopsWithNoAssignment,
		acceptedAssignmentCount,
		approximateAssignmentCount,
		coverageStats,
		fingerprint
	};
}

function computeRankedSurfaceStats(rankedResult: RankedLoopSurfaceAssignmentResult, loopsOfStatus: RankedBoundaryLoopCandidate[]) {
	const loopIds = new Set(loopsOfStatus.map(l => l.id));
	const subsetSelections = rankedResult.loopSelections.filter(sel => loopIds.has(sel.loopId));

	let rawAssignmentCount = 0;
	let primaryLowerCount = 0;
	let primaryUpperCount = 0;
	let secondaryAssignmentCount = 0;
	let noiseAssignmentCount = 0;
	let loopsWithBothRoles = 0;
	let loopsMissingLowerSupport = 0;
	let loopsMissingUpperCover = 0;
	let ambiguousVerticalEnvelopes = 0;

	for (const sel of subsetSelections) {
		const selRawCount = sel.primaryLowerAssignments.length + sel.secondaryLowerAssignments.length + sel.primaryUpperAssignments.length + sel.secondaryUpperAssignments.length + sel.noiseAssignments.length + (sel.otherAssignments?.length || 0);
		rawAssignmentCount += selRawCount;
		primaryLowerCount += sel.primaryLowerAssignments.length;
		primaryUpperCount += sel.primaryUpperAssignments.length;
		secondaryAssignmentCount += sel.secondaryLowerAssignments.length + sel.secondaryUpperAssignments.length + (sel.otherAssignments?.length || 0);
		noiseAssignmentCount += sel.noiseAssignments.length;

		if (!sel.noLowerSupport && !sel.noUpperCover) loopsWithBothRoles++;
		if (sel.noLowerSupport) loopsMissingLowerSupport++;
		if (sel.noUpperCover) loopsMissingUpperCover++;
		if (sel.ambiguousVerticalEnvelope) ambiguousVerticalEnvelopes++;
	}

	const subsetAssignments = rankedResult.assignments.filter(a => loopIds.has(a.loopCandidateId));
	const primaryCandidates = subsetAssignments.filter(a => a.status === 'primary').sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return a.id.localeCompare(b.id);
	});

	const topSelectedAssignments = primaryCandidates.slice(0, 5).map(c => ({
		loopId: c.loopCandidateId,
		role: c.role,
		score: Number(c.score.toFixed(6)),
		loopCoverage: Number(c.loopCoverageRatio.toFixed(6)),
		evidenceCoverage: Number(c.evidenceCoverageRatio.toFixed(6)),
		verticalDistance: Number(c.verticalDistance.toFixed(6)),
		flags: c.ambiguityFlags
	}));

	const rankedFingerprint = calculateRankedLoopSurfaceAssignmentFingerprint(subsetAssignments);

	return {
		loopCountInspected: loopsOfStatus.length,
		rawAssignmentCount,
		primaryLowerCount,
		primaryUpperCount,
		secondaryAssignmentCount,
		noiseAssignmentCount,
		loopsWithBothRoles,
		loopsMissingLowerSupport,
		loopsMissingUpperCover,
		ambiguousVerticalEnvelopes,
		topSelectedAssignments,
		rankedFingerprint
	};
}

function parseOptions(args: string[]) {
	let path: string | undefined;
	let isJson = false;
	let house2 = false;
	let summary = false;
	let snapshot = false;
	let storeys = false;
	let barriers = false;
	let graphs = false;
	let loops = false;
	let surfaces = false;
	let envelopes = false;
	let rooms = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--json') isJson = true;
		else if (arg === '--house2') house2 = true;
		else if (arg === '--summary') summary = true;
		else if (arg === '--snapshot') snapshot = true;
		else if (arg === '--storeys') storeys = true;
		else if (arg === '--barriers') barriers = true;
		else if (arg === '--graphs') graphs = true;
		else if (arg === '--loops') loops = true;
		else if (arg === '--surfaces') surfaces = true;
		else if (arg === '--envelopes') envelopes = true;
		else if (arg === '--rooms') rooms = true;
		else if (!arg.startsWith('--') && !path) path = arg;
	}

	if (house2 && !path) {
		path = resolve(import.meta.dirname, '../../skps/model-eval-exports/house2_model-eval.json');
	}

	return { path, isJson, house2, summary, snapshot, storeys, barriers, graphs, loops, surfaces, envelopes, rooms };
}

const options = parseOptions(Bun.argv.slice(2));

if (!options.path) {
	console.error('Usage: bun run audit-room-evidence.ts <absolute-model-json-path> [--json] [--house2] [--summary|--snapshot|--storeys|--barriers|--graphs|--loops|--surfaces|--envelopes|--rooms]');
	process.exit(1);

}

const path = options.path;
const isJson = options.isJson;

try {
	// 1. Read file and calculate SHA-256
	const file = Bun.file(path);
	if (!(await file.exists())) {
		console.error(`Error: File not found at ${path}`);
		process.exit(1);
	}

	const tStart = performance.now();
	const text = await file.text();
	const sha256 = createHash('sha256').update(text).digest('hex');
	const doc = JSON.parse(text);
	const parseTime = performance.now() - tStart;

	// 2. Runtime construction
	const t1 = performance.now();
	const runtime = parseModelEvalJsonV1(doc);
	const runtimeConstructionTime = performance.now() - t1;

	// 3. Geometry foundation and classification units
	const t2 = performance.now();
	const foundation = createGeometryFoundation(runtime);
	const index = createClassificationUnitIndex(foundation);
	const objects = foundation.buildLogicalObjectIndex().objects;
	for (const object of objects) {
		index.processObject(object.id);
	}
	const units = index.units;
	const geometryFoundationTime = performance.now() - t2;

	// 4. First evidence time
	const processor = createRoomEvidenceProcessor();
	const t3 = performance.now();
	if (units.length > 0) {
		processor.processOne(units[0]);
	}
	const firstEvidenceTime = performance.now() - t3;

	// 5. Full processing time
	processor.reset();
	const t4 = performance.now();
	processor.processAll(units);
	const fullEvidenceProcessingTime = performance.now() - t4;

	// 6. Snapshot and Fingerprint
	const snapshot = processor.snapshot();
	const fingerprint = calculateRoomEvidenceFingerprint(snapshot);

	// FaceRecord expansion check
	const geomDiagnostics = foundation.getDiagnostics();
	const initialFaceRecordExpansion = 0; // Compact runtime does not expand faces

	const rawStoreyBandCount = snapshot.storeyBands.length;
	const primaryCandidates = snapshot.storeyBands.filter(b => b.status === 'primary');
	const secondaryCandidates = snapshot.storeyBands.filter(b => b.status === 'secondary');
	const noiseCandidates = snapshot.storeyBands.filter(b => b.status === 'noise');

	const allNormalizedGraphs: any[] = [];
	const getGraphInfo = (candId: string) => {
		const g = snapshot.barrierGraphs?.find(x => x.storeyCandidateId === candId);
		if (!g) return null;
		const normG = normalizeBarrierGraph(g);
		allNormalizedGraphs.push(normG);
		const nd = normG.normalizationDiagnostics;

		const loopRes = findBoundaryLoopCandidates(normG);
		const rankedRes = rankBoundaryLoopCandidates(loopRes.candidates, normG, loopRes.diagnostics);
		return {
			// Raw graph
			nodeCount: g.nodes.length,
			edgeCount: g.edges.length,
			connectedComponentCount: g.components.length,
			rejectedEdgeCount: g.diagnostics.rejectedEdges,
			duplicateMerges: g.diagnostics.duplicateEdgesMerged,
			fingerprint: calculateBarrierGraphFingerprint(g),
			// Normalized graph
			norm: {
				nodesAfter: nd.nodesAfter,
				edgesAfter: nd.edgesAfter,
				componentsAfter: nd.componentsAfter,
				endpointsSnapped: nd.endpointsSnapped,
				intersectionsFound: nd.intersectionsFound,
				tJunctionsFound: nd.tJunctionsFound,
				edgesSplit: nd.edgesSplit,
				collinearOverlapsMerged: nd.collinearOverlapsMerged,
				duplicateSubsegmentsRemoved: nd.duplicateSubsegmentsRemoved,
				zeroLengthRejected: nd.zeroLengthRejected,
				degree1Nodes: nd.degree1Nodes,
				degree2Nodes: nd.degree2Nodes,
				degree3PlusNodes: nd.degree3PlusNodes,
				normFingerprint: calculateBarrierGraphFingerprint(normG)
			},
			// Boundary loops
			loops: {
				candidateCount: loopRes.candidates.length,
				fingerprint: calculateBoundaryLoopFingerprint(loopRes.candidates),
				diagnostics: loopRes.diagnostics,
				candidates: loopRes.candidates.map(c => ({
					id: c.id,
					connectedComponentIndex: c.connectedComponentIndex,
					nodeCount: c.nodeIds.length,
					edgeCount: c.edgeIds.length,
					signedArea: c.signedArea,
					area: c.area,
					perimeter: c.perimeter,
					orientation: c.orientation,
					isAmbiguous: c.isAmbiguous,
					quality: c.quality
				})),
				ranked: {
					rawLoopCount: rankedRes.diagnostics.rawLoopCount,
					primaryLoopCount: rankedRes.diagnostics.primaryLoopCount,
					secondaryLoopCount: rankedRes.diagnostics.secondaryLoopCount,
					noiseLoopCount: rankedRes.diagnostics.noiseLoopCount,
					rankedFingerprint: rankedRes.diagnostics.rankedFingerprint,
					areaStats: {
						primary: computeAreaStats(rankedRes.candidates.filter(c => c.status === 'primary')),
						secondary: computeAreaStats(rankedRes.candidates.filter(c => c.status === 'secondary')),
						noise: computeAreaStats(rankedRes.candidates.filter(c => c.status === 'noise')),
						all: computeAreaStats(rankedRes.candidates)
					},
					topCandidates: rankedRes.candidates.slice(0, 5).map(c => ({
						id: c.id,
						score: Number(c.score.toFixed(6)),
						status: c.status,
						area: Number(c.area.toFixed(6)),
						perimeter: Number(c.perimeter.toFixed(6)),
						compactness: Number(c.compactness.toFixed(6)),
						boundsAspectRatio: Number(c.boundsAspectRatio.toFixed(6)),
						edgeCount: c.edgeCount,
						uniqueSourceObjectCount: c.uniqueSourceObjectCount,
						qualityFlags: c.qualityFlags
					})),
					candidates: rankedRes.candidates.map(c => ({
						...c,
						score: Number(c.score.toFixed(6)),
						area: Number(c.area.toFixed(6)),
						perimeter: Number(c.perimeter.toFixed(6)),
						compactness: Number(c.compactness.toFixed(6)),
						boundsAspectRatio: Number(c.boundsAspectRatio.toFixed(6))
					}))
				}
			}
		};
	};

	const primaryCandidatesDetails = primaryCandidates.map(b => ({
		id: b.id,
		elevationRange: b.elevationRange,
		score: Number((b.score ?? 0).toFixed(6)),
		totalArea: Number((b.totalArea ?? 0).toFixed(3)),
		modelRelativeCoverage: Number((b.modelRelativeCoverage ?? 0).toFixed(6)),
		isAmbiguous: b.isAmbiguous,
		graph: getGraphInfo(b.id)
	}));

	const secondaryCandidatesDetails = secondaryCandidates.map(b => ({
		id: b.id,
		elevationRange: b.elevationRange,
		score: Number((b.score ?? 0).toFixed(6)),
		totalArea: Number((b.totalArea ?? 0).toFixed(3)),
		modelRelativeCoverage: Number((b.modelRelativeCoverage ?? 0).toFixed(6)),
		isAmbiguous: b.isAmbiguous,
		graph: getGraphInfo(b.id)
	}));

	let totalLoopCandidates = 0;
	const aggregateLoopDiagnostics: BoundaryLoopDiagnostics = {
		componentsInspected: 0,
		halfEdgesCreated: 0,
		traversalsAttempted: 0,
		closedTraversalsFound: 0,
		outerFacesExcluded: 0,
		duplicateLoopsRemoved: 0,
		zeroAreaLoopsRejected: 0,
		selfIntersectingLoopsRejected: 0,
		acceptedCandidates: 0
	};

	let totalRawLoops = 0, totalPrimaryLoops = 0, totalSecondaryLoops = 0, totalNoiseLoops = 0;
	const allRankedCandidateList: any[] = [];

	for (const cand of [...primaryCandidatesDetails, ...secondaryCandidatesDetails]) {
		if (cand.graph && cand.graph.loops) {
			const l = cand.graph.loops;
			totalLoopCandidates += l.candidateCount;
			aggregateLoopDiagnostics.componentsInspected += l.diagnostics.componentsInspected;
			aggregateLoopDiagnostics.halfEdgesCreated += l.diagnostics.halfEdgesCreated;
			aggregateLoopDiagnostics.traversalsAttempted += l.diagnostics.traversalsAttempted;
			aggregateLoopDiagnostics.closedTraversalsFound += l.diagnostics.closedTraversalsFound;
			aggregateLoopDiagnostics.outerFacesExcluded += l.diagnostics.outerFacesExcluded;
			aggregateLoopDiagnostics.duplicateLoopsRemoved += l.diagnostics.duplicateLoopsRemoved;
			aggregateLoopDiagnostics.zeroAreaLoopsRejected += l.diagnostics.zeroAreaLoopsRejected;
			aggregateLoopDiagnostics.selfIntersectingLoopsRejected += l.diagnostics.selfIntersectingLoopsRejected;
			aggregateLoopDiagnostics.acceptedCandidates += l.diagnostics.acceptedCandidates;
			if ((l as any).ranked) {
				const r = (l as any).ranked;
				totalRawLoops += r.rawLoopCount;
				totalPrimaryLoops += r.primaryLoopCount;
				totalSecondaryLoops += r.secondaryLoopCount;
				totalNoiseLoops += r.noiseLoopCount;
				allRankedCandidateList.push(...r.candidates);
			}
		}
	}

	allRankedCandidateList.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return a.id.localeCompare(b.id);
	});

	const hashAll = createHash('sha256');
	for (const cand of allRankedCandidateList) {
		hashAll.update(cand.id);
		hashAll.update(cand.status);
		hashAll.update(cand.score.toFixed(6));
		hashAll.update(cand.compactness.toFixed(6));
		hashAll.update(cand.boundsAspectRatio.toFixed(6));
		hashAll.update(cand.area.toFixed(6));
		hashAll.update(cand.perimeter.toFixed(6));
	}
	const aggregateRankedFingerprint = hashAll.digest('hex');

	const surfaceAssignmentsResult = assignHorizontalEvidenceToLoops(allRankedCandidateList, snapshot.horizontalSurfaces, snapshot.storeyBands);
	const primaryAssignmentStats = computeAssignmentStats(surfaceAssignmentsResult.assignments, allRankedCandidateList.filter(c => c.status === 'primary'));
	const secondaryAssignmentStats = computeAssignmentStats(surfaceAssignmentsResult.assignments, allRankedCandidateList.filter(c => c.status === 'secondary'));
	const aggregateAssignmentStats = computeAssignmentStats(surfaceAssignmentsResult.assignments, allRankedCandidateList);

	const rankedSurfaceAssignmentsResult = rankLoopSurfaceAssignments(surfaceAssignmentsResult.assignments, allRankedCandidateList);
	const primaryRankedSurfaceStats = computeRankedSurfaceStats(rankedSurfaceAssignmentsResult, allRankedCandidateList.filter(c => c.status === 'primary'));
	const secondaryRankedSurfaceStats = computeRankedSurfaceStats(rankedSurfaceAssignmentsResult, allRankedCandidateList.filter(c => c.status === 'secondary'));
	const aggregateRankedSurfaceStats = computeRankedSurfaceStats(rankedSurfaceAssignmentsResult, allRankedCandidateList);

	const verticalEnvelopesResult = buildVerticalEnvelopeCandidates(allRankedCandidateList, rankedSurfaceAssignmentsResult.assignments);
	const roomsResult = assembleRoomCandidates(allRankedCandidateList, rankedSurfaceAssignmentsResult.assignments, verticalEnvelopesResult.candidates, allNormalizedGraphs);

	const summary = {
		inputPath: path,
		inputSha256: sha256,
		parseTimeMs: Number(parseTime.toFixed(3)),
		runtimeConstructionTimeMs: Number(runtimeConstructionTime.toFixed(3)),
		geometryFoundationTimeMs: Number(geometryFoundationTime.toFixed(3)),
		classificationUnitCount: units.length,
		firstEvidenceTimeMs: Number(firstEvidenceTime.toFixed(3)),
		fullEvidenceProcessingTimeMs: Number(fullEvidenceProcessingTime.toFixed(3)),
		horizontalEvidenceCount: snapshot.horizontalSurfaces.length,
		verticalEvidenceCount: snapshot.verticalBarriers.length,
		rawStoreyBandCount,
		primaryCandidateCount: primaryCandidates.length,
		secondaryCandidateCount: secondaryCandidates.length,
		noiseCount: noiseCandidates.length,
		openingEvidenceCount: snapshot.boundaryOpenings.length,
		rejectedEvidenceCount: processor.diagnostics().rejected,
		duplicateUnitsSkipped: processor.diagnostics().duplicatesSkipped,
		fingerprint,
		initialFaceRecordExpansion,
		loops: {
			totalCandidateCount: totalLoopCandidates,
			diagnostics: aggregateLoopDiagnostics,
			ranked: {
				totalRawCount: totalRawLoops,
				totalPrimaryCount: totalPrimaryLoops,
				totalSecondaryCount: totalSecondaryLoops,
				totalNoiseCount: totalNoiseLoops,
				aggregateRankedFingerprint,
				areaStats: {
					primary: computeAreaStats(allRankedCandidateList.filter(c => c.status === 'primary')),
					secondary: computeAreaStats(allRankedCandidateList.filter(c => c.status === 'secondary')),
					noise: computeAreaStats(allRankedCandidateList.filter(c => c.status === 'noise')),
					all: computeAreaStats(allRankedCandidateList)
				},
				topCandidates: allRankedCandidateList.slice(0, 5).map(c => ({
					id: c.id,
					score: Number(c.score.toFixed(6)),
					status: c.status,
					area: Number(c.area.toFixed(6)),
					perimeter: Number(c.perimeter.toFixed(6)),
					compactness: Number(c.compactness.toFixed(6)),
					boundsAspectRatio: Number(c.boundsAspectRatio.toFixed(6)),
					edgeCount: c.edgeCount,
					uniqueSourceObjectCount: c.uniqueSourceObjectCount,
					qualityFlags: c.qualityFlags
				}))
			}
		},
		surfaces: {
			diagnostics: surfaceAssignmentsResult.diagnostics,
			stats: {
				primary: primaryAssignmentStats,
				secondary: secondaryAssignmentStats,
				aggregate: aggregateAssignmentStats
			},
			ranked: {
				diagnostics: rankedSurfaceAssignmentsResult.diagnostics,
				stats: {
					primary: primaryRankedSurfaceStats,
					secondary: secondaryRankedSurfaceStats,
					aggregate: aggregateRankedSurfaceStats
				}
			},
			envelopes: {
				diagnostics: verticalEnvelopesResult.diagnostics,
				stats: {
					primary: computeEnvelopeStats(verticalEnvelopesResult, allRankedCandidateList.filter(c => c.status === 'primary')),
					secondary: computeEnvelopeStats(verticalEnvelopesResult, allRankedCandidateList.filter(c => c.status === 'secondary')),
					aggregate: computeEnvelopeStats(verticalEnvelopesResult, allRankedCandidateList)
				}
			}
		},
		rooms: {
			diagnostics: roomsResult.diagnostics,
			stats: {
				primary: computeRoomStats(roomsResult, roomsResult.candidates.filter(c => c.status === 'primary')),
				secondary: computeRoomStats(roomsResult, roomsResult.candidates.filter(c => c.status === 'secondary')),
				ambiguous: computeRoomStats(roomsResult, roomsResult.candidates.filter(c => c.status === 'ambiguous')),
				aggregate: computeRoomStats(roomsResult, roomsResult.candidates)
			}
		},
		primaryCandidates: primaryCandidatesDetails,
		secondaryCandidates: secondaryCandidatesDetails

	};


	if (isJson) {
		console.log(JSON.stringify(summary, null, 2));
	} else {
		const showAll = !options.summary && !options.storeys && !options.barriers && !options.graphs && !options.loops && !options.surfaces && !options.envelopes && !options.rooms;

		if (showAll || options.summary) {
			console.log(`=== ROOM EVIDENCE AUDIT SUMMARY ===`);
			console.log(`Input Path:                    ${summary.inputPath}`);
			console.log(`Input SHA-256:                 ${summary.inputSha256}`);
			console.log(`Parse Time:                    ${summary.parseTimeMs.toFixed(3)} ms`);
			console.log(`Runtime Construction Time:     ${summary.runtimeConstructionTimeMs.toFixed(3)} ms`);
			console.log(`Geometry Foundation Time:      ${summary.geometryFoundationTimeMs.toFixed(3)} ms`);
			console.log(`Classification Unit Count:     ${summary.classificationUnitCount}`);
			console.log(`First Evidence Time:           ${summary.firstEvidenceTimeMs.toFixed(3)} ms`);
			console.log(`Full Evidence Processing Time: ${summary.fullEvidenceProcessingTimeMs.toFixed(3)} ms`);
			console.log(`Horizontal Evidence Count:     ${summary.horizontalEvidenceCount}`);
			console.log(`Vertical Evidence Count:       ${summary.verticalEvidenceCount}`);
			console.log(`Raw Storey Band Count:         ${summary.rawStoreyBandCount}`);
			console.log(`Primary Candidate Count:       ${summary.primaryCandidateCount}`);
			console.log(`Secondary Candidate Count:     ${summary.secondaryCandidateCount}`);
			console.log(`Noise Count:                   ${summary.noiseCount}`);
			console.log(`Opening Evidence Count:        ${summary.openingEvidenceCount}`);
			console.log(`Rejected Evidence Count:       ${summary.rejectedEvidenceCount}`);
			console.log(`Duplicate Units Skipped:       ${summary.duplicateUnitsSkipped}`);
			console.log(`Fingerprint:                   ${summary.fingerprint}`);
			console.log(`Initial FaceRecord Expansion:  ${summary.initialFaceRecordExpansion}`);
			console.log(`Total Loop Candidates:         ${summary.loops.totalCandidateCount}`);
			console.log(`Total Surface Assignments:     ${summary.surfaces.diagnostics.assignmentsAccepted}`);
			console.log(`Total Vertical Envelopes:      ${summary.surfaces.envelopes.diagnostics.primaryEnvelopeCandidates + summary.surfaces.envelopes.diagnostics.secondaryEnvelopeCandidates}`);
			console.log(`Total Room Candidates:         ${summary.rooms.diagnostics.primaryRoomCandidates + summary.rooms.diagnostics.secondaryRoomCandidates + summary.rooms.diagnostics.ambiguousRoomCandidates}`);
		}

		if (showAll || options.storeys || options.graphs || options.loops || options.surfaces || options.envelopes || options.rooms) {
			console.log(`\n=== PRIMARY CANDIDATES DETAILS ===`);
			for (const p of summary.primaryCandidates) {
				console.log(`  - ID: ${p.id.length > 80 ? p.id.slice(0, 77) + '...' : p.id}`);
				console.log(`    Elevation Range:  ${p.elevationRange.min.toFixed(3)} to ${p.elevationRange.max.toFixed(3)} m`);
				console.log(`    Score:            ${p.score.toFixed(6)}`);
				console.log(`    Total Area:       ${p.totalArea.toFixed(3)} m2`);
				console.log(`    Coverage Ratio:   ${p.modelRelativeCoverage.toFixed(6)}`);
				console.log(`    Ambiguous:        ${p.isAmbiguous}`);
				if (p.graph && (showAll || options.graphs || options.loops || options.surfaces || options.envelopes || options.rooms)) {
					if (showAll || options.graphs) {
						console.log(`    Graph Nodes:      ${p.graph.nodeCount}`);
						console.log(`    Graph Edges:      ${p.graph.edgeCount}`);
						console.log(`    Components:       ${p.graph.connectedComponentCount}`);
						console.log(`    Rejected Edges:   ${p.graph.rejectedEdgeCount}`);
						console.log(`    Duplicate Merges: ${p.graph.duplicateMerges}`);
						console.log(`    Graph FP:         ${p.graph.fingerprint}`);
						const n = p.graph.norm;
						console.log(`    Norm Nodes:       ${n.nodesAfter}  (snapped=${n.endpointsSnapped})`);
						console.log(`    Norm Edges:       ${n.edgesAfter}  (split=${n.edgesSplit} overlap=${n.collinearOverlapsMerged} dup=${n.duplicateSubsegmentsRemoved} zero=${n.zeroLengthRejected})`);
						console.log(`    Norm Components:  ${n.componentsAfter}`);
						console.log(`    Intersections:    ${n.intersectionsFound}  T-junctions: ${n.tJunctionsFound}`);
						console.log(`    Degree 1/2/3+:    ${n.degree1Nodes} / ${n.degree2Nodes} / ${n.degree3PlusNodes}`);
						console.log(`    Norm FP:          ${n.normFingerprint}`);
					}
					if (showAll || options.loops) {
						const l = p.graph.loops;
						console.log(`    Loops Found:      ${l.candidateCount}`);
						console.log(`    Loops FP:         ${l.fingerprint}`);
						console.log(`    Loop Diagnostics: inspected=${l.diagnostics.componentsInspected} halfEdges=${l.diagnostics.halfEdgesCreated} traversals=${l.diagnostics.traversalsAttempted} closed=${l.diagnostics.closedTraversalsFound} outerExcluded=${l.diagnostics.outerFacesExcluded} dupRemoved=${l.diagnostics.duplicateLoopsRemoved} zeroArea=${l.diagnostics.zeroAreaLoopsRejected} selfInt=${l.diagnostics.selfIntersectingLoopsRejected} accepted=${l.diagnostics.acceptedCandidates}`);
						if ((l as any).ranked) {
							const r = (l as any).ranked;
							console.log(`    Ranked Loops:     raw=${r.rawLoopCount} primary=${r.primaryLoopCount} secondary=${r.secondaryLoopCount} noise=${r.noiseLoopCount}`);
							console.log(`    Ranked FP:        ${r.rankedFingerprint}`);
							console.log(`    Area (primary):   min=${r.areaStats.primary.min} median=${r.areaStats.primary.median} max=${r.areaStats.primary.max} m2`);
							console.log(`    Area (secondary): min=${r.areaStats.secondary.min} median=${r.areaStats.secondary.median} max=${r.areaStats.secondary.max} m2`);
							console.log(`    Area (noise):     min=${r.areaStats.noise.min} median=${r.areaStats.noise.median} max=${r.areaStats.noise.max} m2`);
							console.log(`    Top 5 Candidates:`);
							for (const topC of r.topCandidates) {
								const flagsStr = Object.entries(topC.qualityFlags)
									.filter(([_, val]) => val)
									.map(([k]) => k)
									.join(',');
								console.log(`      - [${topC.status.toUpperCase()}] score=${topC.score.toFixed(3)} area=${topC.area.toFixed(3)}m2 flags=[${flagsStr || 'none'}] id=${topC.id.length > 50 ? topC.id.slice(0, 47) + '...' : topC.id}`);
							}
						}
					}
				}
			}

			console.log(`\n=== SECONDARY CANDIDATES DETAILS ===`);
			for (const s of summary.secondaryCandidates) {
				console.log(`  - ID: ${s.id.length > 80 ? s.id.slice(0, 77) + '...' : s.id}`);
				console.log(`    Elevation Range:  ${s.elevationRange.min.toFixed(3)} to ${s.elevationRange.max.toFixed(3)} m`);
				console.log(`    Score:            ${s.score.toFixed(6)}`);
				console.log(`    Total Area:       ${s.totalArea.toFixed(3)} m2`);
				console.log(`    Coverage Ratio:   ${s.modelRelativeCoverage.toFixed(6)}`);
				console.log(`    Ambiguous:        ${s.isAmbiguous}`);
				if (s.graph && (showAll || options.graphs || options.loops || options.surfaces || options.envelopes || options.rooms)) {

					if (showAll || options.graphs) {
						console.log(`    Graph Nodes:      ${s.graph.nodeCount}`);
						console.log(`    Graph Edges:      ${s.graph.edgeCount}`);
						console.log(`    Components:       ${s.graph.connectedComponentCount}`);
						console.log(`    Rejected Edges:   ${s.graph.rejectedEdgeCount}`);
						console.log(`    Duplicate Merges: ${s.graph.duplicateMerges}`);
						console.log(`    Graph FP:         ${s.graph.fingerprint}`);
						const n = s.graph.norm;
						console.log(`    Norm Nodes:       ${n.nodesAfter}  (snapped=${n.endpointsSnapped})`);
						console.log(`    Norm Edges:       ${n.edgesAfter}  (split=${n.edgesSplit} overlap=${n.collinearOverlapsMerged} dup=${n.duplicateSubsegmentsRemoved} zero=${n.zeroLengthRejected})`);
						console.log(`    Norm Components:  ${n.componentsAfter}`);
						console.log(`    Intersections:    ${n.intersectionsFound}  T-junctions: ${n.tJunctionsFound}`);
						console.log(`    Degree 1/2/3+:    ${n.degree1Nodes} / ${n.degree2Nodes} / ${n.degree3PlusNodes}`);
						console.log(`    Norm FP:          ${n.normFingerprint}`);
					}
					if (showAll || options.loops) {
						const l = s.graph.loops;
						console.log(`    Loops Found:      ${l.candidateCount}`);
						console.log(`    Loops FP:         ${l.fingerprint}`);
						console.log(`    Loop Diagnostics: inspected=${l.diagnostics.componentsInspected} halfEdges=${l.diagnostics.halfEdgesCreated} traversals=${l.diagnostics.traversalsAttempted} closed=${l.diagnostics.closedTraversalsFound} outerExcluded=${l.diagnostics.outerFacesExcluded} dupRemoved=${l.diagnostics.duplicateLoopsRemoved} zeroArea=${l.diagnostics.zeroAreaLoopsRejected} selfInt=${l.diagnostics.selfIntersectingLoopsRejected} accepted=${l.diagnostics.acceptedCandidates}`);
						if ((l as any).ranked) {
							const r = (l as any).ranked;
							console.log(`    Ranked Loops:     raw=${r.rawLoopCount} primary=${r.primaryLoopCount} secondary=${r.secondaryLoopCount} noise=${r.noiseLoopCount}`);
							console.log(`    Ranked FP:        ${r.rankedFingerprint}`);
							console.log(`    Area (primary):   min=${r.areaStats.primary.min} median=${r.areaStats.primary.median} max=${r.areaStats.primary.max} m2`);
							console.log(`    Area (secondary): min=${r.areaStats.secondary.min} median=${r.areaStats.secondary.median} max=${r.areaStats.secondary.max} m2`);
							console.log(`    Area (noise):     min=${r.areaStats.noise.min} median=${r.areaStats.noise.median} max=${r.areaStats.noise.max} m2`);
							console.log(`    Top 5 Candidates:`);
							for (const topC of r.topCandidates) {
								const flagsStr = Object.entries(topC.qualityFlags)
									.filter(([_, val]) => val)
									.map(([k]) => k)
									.join(',');
								console.log(`      - [${topC.status.toUpperCase()}] score=${topC.score.toFixed(3)} area=${topC.area.toFixed(3)}m2 flags=[${flagsStr || 'none'}] id=${topC.id.length > 50 ? topC.id.slice(0, 47) + '...' : topC.id}`);
							}
						}
					}
				}
			}
		}

		if (showAll || options.loops) {
			console.log(`\n=== LOOPS SUMMARY ===`);
			console.log(`Total Loop Candidates:         ${summary.loops.totalCandidateCount}`);
			console.log(`Components Inspected:          ${summary.loops.diagnostics.componentsInspected}`);
			console.log(`Half-Edges Created:            ${summary.loops.diagnostics.halfEdgesCreated}`);
			console.log(`Traversals Attempted:          ${summary.loops.diagnostics.traversalsAttempted}`);
			console.log(`Closed Traversals Found:       ${summary.loops.diagnostics.closedTraversalsFound}`);
			console.log(`Outer Faces Excluded:          ${summary.loops.diagnostics.outerFacesExcluded}`);
			console.log(`Duplicate Loops Removed:       ${summary.loops.diagnostics.duplicateLoopsRemoved}`);
			console.log(`Zero-Area Loops Rejected:      ${summary.loops.diagnostics.zeroAreaLoopsRejected}`);
			console.log(`Self-Intersecting Rejected:    ${summary.loops.diagnostics.selfIntersectingLoopsRejected}`);
			console.log(`Accepted Candidates:           ${summary.loops.diagnostics.acceptedCandidates}`);
			if ((summary.loops as any).ranked) {
				const r = (summary.loops as any).ranked;
				console.log(`\n=== RANKED LOOPS SUMMARY ===`);
				console.log(`Total Raw Loops:               ${r.totalRawCount}`);
				console.log(`Total Primary Loops:           ${r.totalPrimaryCount}`);
				console.log(`Total Secondary Loops:         ${r.totalSecondaryCount}`);
				console.log(`Total Noise Loops:             ${r.totalNoiseCount}`);
				console.log(`Aggregate Ranked FP:           ${r.aggregateRankedFingerprint}`);
				console.log(`Area (all primary):            min=${r.areaStats.primary.min} median=${r.areaStats.primary.median} max=${r.areaStats.primary.max} m2`);
				console.log(`Area (all secondary):          min=${r.areaStats.secondary.min} median=${r.areaStats.secondary.median} max=${r.areaStats.secondary.max} m2`);
				console.log(`Area (all noise):              min=${r.areaStats.noise.min} median=${r.areaStats.noise.median} max=${r.areaStats.noise.max} m2`);
				console.log(`Overall Top 5 Candidates:`);
				for (const topC of r.topCandidates) {
					const flagsStr = Object.entries(topC.qualityFlags)
						.filter(([_, val]) => val)
						.map(([k]) => k)
						.join(',');
					console.log(`  - [${topC.status.toUpperCase()}] score=${topC.score.toFixed(3)} area=${topC.area.toFixed(3)}m2 flags=[${flagsStr || 'none'}] id=${topC.id.length > 50 ? topC.id.slice(0, 47) + '...' : topC.id}`);
				}
			}
		}

		if (showAll || options.surfaces) {
			console.log(`\n=== HORIZONTAL SURFACE ASSIGNMENTS SUMMARY ===`);
			console.log(`Horizontal Evidence Inspected: ${summary.surfaces.diagnostics.horizontalEvidenceInspected}`);
			console.log(`Plan Overlap Tests:            ${summary.surfaces.diagnostics.planOverlapTests}`);
			console.log(`Assignments Accepted:          ${summary.surfaces.diagnostics.assignmentsAccepted}`);
			console.log(`Lower Support Candidates:      ${summary.surfaces.diagnostics.lowerSupportCandidates}`);
			console.log(`Upper Cover Candidates:        ${summary.surfaces.diagnostics.upperCoverCandidates}`);
			console.log(`Ambiguous Assignments:         ${summary.surfaces.diagnostics.ambiguousAssignments}`);
			console.log(`Approximate Assignments:       ${summary.surfaces.diagnostics.approximateOverlapAssignments}`);
			console.log(`Aggregate Surface FP:          ${summary.surfaces.diagnostics.fingerprint}`);

			const st = summary.surfaces.stats;
			console.log(`\n  [Primary Loops Assignment Stats]`);
			console.log(`    Loops Inspected:           ${st.primary.loopCountInspected}`);
			console.log(`    With Lower Support:        ${st.primary.loopsWithLowerSupport}`);
			console.log(`    With Upper Cover:          ${st.primary.loopsWithUpperCover}`);
			console.log(`    With No Assignment:        ${st.primary.loopsWithNoAssignment}`);
			console.log(`    Accepted Assignments:      ${st.primary.acceptedAssignmentCount}`);
			console.log(`    Approximate Assignments:   ${st.primary.approximateAssignmentCount}`);
			console.log(`    Loop Coverage Ratios:      min=${st.primary.coverageStats.min} median=${st.primary.coverageStats.median} max=${st.primary.coverageStats.max}`);
			console.log(`    Fingerprint:               ${st.primary.fingerprint}`);

			console.log(`\n  [Secondary Loops Assignment Stats]`);
			console.log(`    Loops Inspected:           ${st.secondary.loopCountInspected}`);
			console.log(`    With Lower Support:        ${st.secondary.loopsWithLowerSupport}`);
			console.log(`    With Upper Cover:          ${st.secondary.loopsWithUpperCover}`);
			console.log(`    With No Assignment:        ${st.secondary.loopsWithNoAssignment}`);
			console.log(`    Accepted Assignments:      ${st.secondary.acceptedAssignmentCount}`);
			console.log(`    Approximate Assignments:   ${st.secondary.approximateAssignmentCount}`);
			console.log(`    Loop Coverage Ratios:      min=${st.secondary.coverageStats.min} median=${st.secondary.coverageStats.median} max=${st.secondary.coverageStats.max}`);
			console.log(`    Fingerprint:               ${st.secondary.fingerprint}`);

			console.log(`\n  [Aggregate Loops Assignment Stats]`);
			console.log(`    Loops Inspected:           ${st.aggregate.loopCountInspected}`);
			console.log(`    With Lower Support:        ${st.aggregate.loopsWithLowerSupport}`);
			console.log(`    With Upper Cover:          ${st.aggregate.loopsWithUpperCover}`);
			console.log(`    With No Assignment:        ${st.aggregate.loopsWithNoAssignment}`);
			console.log(`    Accepted Assignments:      ${st.aggregate.acceptedAssignmentCount}`);
			console.log(`    Approximate Assignments:   ${st.aggregate.approximateAssignmentCount}`);
			console.log(`    Loop Coverage Ratios:      min=${st.aggregate.coverageStats.min} median=${st.aggregate.coverageStats.median} max=${st.aggregate.coverageStats.max}`);
			console.log(`    Fingerprint:               ${st.aggregate.fingerprint}`);

			const rst = summary.surfaces.ranked.stats;
			console.log(`\n  [Ranked Surface Assignments - Primary Loops]`);
			console.log(`    Raw Assignments:           ${rst.primary.rawAssignmentCount}`);
			console.log(`    Primary Lower:             ${rst.primary.primaryLowerCount}`);
			console.log(`    Primary Upper:             ${rst.primary.primaryUpperCount}`);
			console.log(`    Secondary Assignments:     ${rst.primary.secondaryAssignmentCount}`);
			console.log(`    Noise Assignments:         ${rst.primary.noiseAssignmentCount}`);
			console.log(`    Loops With Both Roles:     ${rst.primary.loopsWithBothRoles}`);
			console.log(`    Loops Missing Lower:       ${rst.primary.loopsMissingLowerSupport}`);
			console.log(`    Loops Missing Upper:       ${rst.primary.loopsMissingUpperCover}`);
			console.log(`    Ambiguous Envelopes:       ${rst.primary.ambiguousVerticalEnvelopes}`);
			console.log(`    Ranked Fingerprint:        ${rst.primary.rankedFingerprint}`);
			console.log(`    Top Selected Assignments:`);
			for (const topA of rst.primary.topSelectedAssignments) {
				const flagsStr = Object.entries(topA.flags).filter(([_, val]) => val).map(([k]) => k).join(',');
				console.log(`      - [${topA.role.toUpperCase()}] loop=${topA.loopId} score=${topA.score.toFixed(3)} loopCov=${topA.loopCoverage.toFixed(3)} evCov=${topA.evidenceCoverage.toFixed(3)} dist=${topA.verticalDistance.toFixed(3)} flags=[${flagsStr || 'none'}]`);
			}

			console.log(`\n  [Ranked Surface Assignments - Secondary Loops]`);
			console.log(`    Raw Assignments:           ${rst.secondary.rawAssignmentCount}`);
			console.log(`    Primary Lower:             ${rst.secondary.primaryLowerCount}`);
			console.log(`    Primary Upper:             ${rst.secondary.primaryUpperCount}`);
			console.log(`    Secondary Assignments:     ${rst.secondary.secondaryAssignmentCount}`);
			console.log(`    Noise Assignments:         ${rst.secondary.noiseAssignmentCount}`);
			console.log(`    Loops With Both Roles:     ${rst.secondary.loopsWithBothRoles}`);
			console.log(`    Loops Missing Lower:       ${rst.secondary.loopsMissingLowerSupport}`);
			console.log(`    Loops Missing Upper:       ${rst.secondary.loopsMissingUpperCover}`);
			console.log(`    Ambiguous Envelopes:       ${rst.secondary.ambiguousVerticalEnvelopes}`);
			console.log(`    Ranked Fingerprint:        ${rst.secondary.rankedFingerprint}`);
			console.log(`    Top Selected Assignments:`);
			for (const topA of rst.secondary.topSelectedAssignments) {
				const flagsStr = Object.entries(topA.flags).filter(([_, val]) => val).map(([k]) => k).join(',');
				console.log(`      - [${topA.role.toUpperCase()}] loop=${topA.loopId} score=${topA.score.toFixed(3)} loopCov=${topA.loopCoverage.toFixed(3)} evCov=${topA.evidenceCoverage.toFixed(3)} dist=${topA.verticalDistance.toFixed(3)} flags=[${flagsStr || 'none'}]`);
			}
		}

		if (showAll || options.envelopes || options.surfaces) {
			const ed = summary.surfaces.envelopes.diagnostics;
			console.log(`\n=== VERTICAL ENVELOPE CANDIDATES SUMMARY ===`);
			console.log(`Loops Inspected:               ${ed.loopsInspected}`);
			console.log(`Primary Envelope Candidates:   ${ed.primaryEnvelopeCandidates}`);
			console.log(`Secondary Envelope Candidates: ${ed.secondaryEnvelopeCandidates}`);
			console.log(`Noise Envelope Candidates:     ${ed.noiseEnvelopeCandidates}`);
			console.log(`Loops With Single Envelope:    ${ed.loopsWithSingleEnvelope}`);
			console.log(`Loops With Multiple Envelopes: ${ed.loopsWithMultipleEnvelopes}`);
			console.log(`Loops Missing Lower Support:   ${ed.loopsMissingLowerSupport}`);
			console.log(`Loops Missing Upper Cover:     ${ed.loopsMissingUpperCover}`);
			console.log(`Rejected Non-Positive Heights: ${ed.rejectedNonPositiveHeights}`);
			console.log(`Aggregate Envelope FP:         ${ed.fingerprint}`);

			const est = summary.surfaces.envelopes.stats;
			console.log(`\n  [Primary Loops Envelope Stats]`);
			console.log(`    Loops Inspected:           ${est.primary.loopsInspected}`);
			console.log(`    Primary Envelopes:         ${est.primary.primaryEnvelopeCount}`);
			console.log(`    Secondary Envelopes:       ${est.primary.secondaryEnvelopeCount}`);
			console.log(`    Single Envelope Loops:     ${est.primary.loopsWithSingleEnvelope}`);
			console.log(`    Multiple Envelope Loops:   ${est.primary.loopsWithMultipleEnvelopes}`);
			console.log(`    Missing Lower Support:     ${est.primary.loopsMissingLowerSupport}`);
			console.log(`    Missing Upper Cover:       ${est.primary.loopsMissingUpperCover}`);
			console.log(`    Rejected Zero/Neg Heights: ${est.primary.rejectedNonPositiveHeights}`);
			console.log(`    Clear Height Range:        min=${est.primary.heightStats.min} median=${est.primary.heightStats.median} max=${est.primary.heightStats.max} m`);
			console.log(`    Estimated Volume Range:    min=${est.primary.volumeStats.min} median=${est.primary.volumeStats.median} max=${est.primary.volumeStats.max} m3`);
			console.log(`    Envelope Fingerprint:      ${est.primary.fingerprint}`);

			console.log(`\n  [Secondary Loops Envelope Stats]`);
			console.log(`    Loops Inspected:           ${est.secondary.loopsInspected}`);
			console.log(`    Primary Envelopes:         ${est.secondary.primaryEnvelopeCount}`);
			console.log(`    Secondary Envelopes:       ${est.secondary.secondaryEnvelopeCount}`);
			console.log(`    Single Envelope Loops:     ${est.secondary.loopsWithSingleEnvelope}`);
			console.log(`    Multiple Envelope Loops:   ${est.secondary.loopsWithMultipleEnvelopes}`);
			console.log(`    Missing Lower Support:     ${est.secondary.loopsMissingLowerSupport}`);
			console.log(`    Missing Upper Cover:       ${est.secondary.loopsMissingUpperCover}`);
			console.log(`    Rejected Zero/Neg Heights: ${est.secondary.rejectedNonPositiveHeights}`);
			console.log(`    Clear Height Range:        min=${est.secondary.heightStats.min} median=${est.secondary.heightStats.median} max=${est.secondary.heightStats.max} m`);
			console.log(`    Estimated Volume Range:    min=${est.secondary.volumeStats.min} median=${est.secondary.volumeStats.median} max=${est.secondary.volumeStats.max} m3`);
			console.log(`    Envelope Fingerprint:      ${est.secondary.fingerprint}`);

			console.log(`\n  [Aggregate Loops Envelope Stats]`);
			console.log(`    Loops Inspected:           ${est.aggregate.loopsInspected}`);
			console.log(`    Primary Envelopes:         ${est.aggregate.primaryEnvelopeCount}`);
			console.log(`    Secondary Envelopes:       ${est.aggregate.secondaryEnvelopeCount}`);
			console.log(`    Single Envelope Loops:     ${est.aggregate.loopsWithSingleEnvelope}`);
			console.log(`    Multiple Envelope Loops:   ${est.aggregate.loopsWithMultipleEnvelopes}`);
			console.log(`    Missing Lower Support:     ${est.aggregate.loopsMissingLowerSupport}`);
			console.log(`    Missing Upper Cover:       ${est.aggregate.loopsMissingUpperCover}`);
			console.log(`    Rejected Zero/Neg Heights: ${est.aggregate.rejectedNonPositiveHeights}`);
			console.log(`    Clear Height Range:        min=${est.aggregate.heightStats.min} median=${est.aggregate.heightStats.median} max=${est.aggregate.heightStats.max} m`);
			console.log(`    Estimated Volume Range:    min=${est.aggregate.volumeStats.min} median=${est.aggregate.volumeStats.median} max=${est.aggregate.volumeStats.max} m3`);
			console.log(`    Envelope Fingerprint:      ${est.aggregate.fingerprint}`);
		}

		if (showAll || options.rooms) {
			const rd = summary.rooms.diagnostics;
			console.log(`\n=== GEOMETRIC ROOM CANDIDATES SUMMARY ===`);
			console.log(`Loops Inspected:               ${rd.loopsInspected}`);
			console.log(`Noise Loops Skipped:           ${rd.noiseLoopsSkipped}`);
			console.log(`Primary Room Candidates:       ${rd.primaryRoomCandidates}`);
			console.log(`Secondary Room Candidates:     ${rd.secondaryRoomCandidates}`);
			console.log(`Ambiguous Room Candidates:     ${rd.ambiguousRoomCandidates}`);
			console.log(`Loops Without Envelopes:       ${rd.loopsWithoutValidEnvelopes}`);

			console.log(`Invalid Area Rejected:         ${rd.invalidAreaCandidatesRejected}`);
			console.log(`Invalid Height Rejected:       ${rd.invalidHeightCandidatesRejected}`);
			console.log(`Alternative Envelopes Saved:   ${rd.alternativeEnvelopesPreserved}`);
			console.log(`Total Candidate Area:          ${rd.totalCandidateArea.toFixed(3)} m2`);
			console.log(`Total Estimated Volume:        ${rd.totalEstimatedVolume.toFixed(3)} m3`);
			console.log(`Aggregate Room FP:             ${rd.fingerprint}`);


			const rst = summary.rooms.stats;
			console.log(`\n  [Primary Room Candidates Stats]`);
			console.log(`    Candidate Count:           ${rst.primary.candidateCount}`);
			console.log(`    Plan Area Range:           min=${rst.primary.areaStats.min} median=${rst.primary.areaStats.median} max=${rst.primary.areaStats.max} m2`);
			console.log(`    Clear Height Range:        min=${rst.primary.heightStats.min} median=${rst.primary.heightStats.median} max=${rst.primary.heightStats.max} m`);
			console.log(`    Estimated Volume Range:    min=${rst.primary.volumeStats.min} median=${rst.primary.volumeStats.median} max=${rst.primary.volumeStats.max} m3`);
			console.log(`    Room Candidate FP:         ${rst.primary.fingerprint}`);
			console.log(`    Top Candidates:`);
			for (const topR of rst.primary.topCandidates) {
				const flagsStr = Object.entries(topR.qualityFlags).filter(([_, val]) => val).map(([k]) => k).join(',');
				console.log(`      - [${topR.status.toUpperCase()}] id=${topR.id.length > 45 ? topR.id.slice(0, 42) + '...' : topR.id} score=${topR.score.toFixed(3)} area=${topR.planArea.toFixed(3)}m2 height=${topR.clearHeight.toFixed(3)}m vol=${topR.estimatedVolume.toFixed(3)}m3 flags=[${flagsStr || 'none'}]`);
			}

			console.log(`\n  [Secondary Room Candidates Stats]`);
			console.log(`    Candidate Count:           ${rst.secondary.candidateCount}`);
			console.log(`    Plan Area Range:           min=${rst.secondary.areaStats.min} median=${rst.secondary.areaStats.median} max=${rst.secondary.areaStats.max} m2`);
			console.log(`    Clear Height Range:        min=${rst.secondary.heightStats.min} median=${rst.secondary.heightStats.median} max=${rst.secondary.heightStats.max} m`);
			console.log(`    Estimated Volume Range:    min=${rst.secondary.volumeStats.min} median=${rst.secondary.volumeStats.median} max=${rst.secondary.volumeStats.max} m3`);
			console.log(`    Room Candidate FP:         ${rst.secondary.fingerprint}`);
			console.log(`    Top Candidates:`);
			for (const topR of rst.secondary.topCandidates) {
				const flagsStr = Object.entries(topR.qualityFlags).filter(([_, val]) => val).map(([k]) => k).join(',');
				console.log(`      - [${topR.status.toUpperCase()}] id=${topR.id.length > 45 ? topR.id.slice(0, 42) + '...' : topR.id} score=${topR.score.toFixed(3)} area=${topR.planArea.toFixed(3)}m2 height=${topR.clearHeight.toFixed(3)}m vol=${topR.estimatedVolume.toFixed(3)}m3 flags=[${flagsStr || 'none'}]`);
			}

			console.log(`\n  [Ambiguous Room Candidates Stats]`);
			console.log(`    Candidate Count:           ${rst.ambiguous.candidateCount}`);
			console.log(`    Plan Area Range:           min=${rst.ambiguous.areaStats.min} median=${rst.ambiguous.areaStats.median} max=${rst.ambiguous.areaStats.max} m2`);
			console.log(`    Clear Height Range:        min=${rst.ambiguous.heightStats.min} median=${rst.ambiguous.heightStats.median} max=${rst.ambiguous.heightStats.max} m`);
			console.log(`    Estimated Volume Range:    min=${rst.ambiguous.volumeStats.min} median=${rst.ambiguous.volumeStats.median} max=${rst.ambiguous.volumeStats.max} m3`);
			console.log(`    Room Candidate FP:         ${rst.ambiguous.fingerprint}`);
			console.log(`    Top Candidates:`);
			for (const topR of rst.ambiguous.topCandidates) {
				const flagsStr = Object.entries(topR.qualityFlags).filter(([_, val]) => val).map(([k]) => k).join(',');
				console.log(`      - [${topR.status.toUpperCase()}] id=${topR.id.length > 45 ? topR.id.slice(0, 42) + '...' : topR.id} score=${topR.score.toFixed(3)} area=${topR.planArea.toFixed(3)}m2 height=${topR.clearHeight.toFixed(3)}m vol=${topR.estimatedVolume.toFixed(3)}m3 flags=[${flagsStr || 'none'}]`);
			}

			console.log(`\n  [Aggregate Room Candidates Stats]`);
			console.log(`    Candidate Count:           ${rst.aggregate.candidateCount}`);
			console.log(`    Plan Area Range:           min=${rst.aggregate.areaStats.min} median=${rst.aggregate.areaStats.median} max=${rst.aggregate.areaStats.max} m2`);
			console.log(`    Clear Height Range:        min=${rst.aggregate.heightStats.min} median=${rst.aggregate.heightStats.median} max=${rst.aggregate.heightStats.max} m`);
			console.log(`    Estimated Volume Range:    min=${rst.aggregate.volumeStats.min} median=${rst.aggregate.volumeStats.median} max=${rst.aggregate.volumeStats.max} m3`);
			console.log(`    Room Candidate FP:         ${rst.aggregate.fingerprint}`);
		}
	}
} catch (e: any) {

	console.error(e.stack || e.message);
	process.exit(1);
}


