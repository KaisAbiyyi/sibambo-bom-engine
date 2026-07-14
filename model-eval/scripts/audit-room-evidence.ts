import { createClassificationUnitIndex } from '../src/lib/annotation';
import { parseModelEvalJsonV1 } from '../src/lib/formats/model-eval-json';
import { createGeometryFoundation } from '../src/lib/geometry';
import { createRoomEvidenceProcessor } from '../src/lib/rooms/processor';
import { calculateRoomEvidenceFingerprint, calculateBarrierGraphFingerprint, normalizeBarrierGraph } from '../src/lib/rooms/helpers';
import { findBoundaryLoopCandidates, calculateBoundaryLoopFingerprint } from '../src/lib/rooms/loops';
import type { BoundaryLoopDiagnostics } from '../src/lib/rooms/types';
import { createHash } from 'crypto';
import { resolve } from 'path';

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
		else if (!arg.startsWith('--') && !path) path = arg;
	}

	if (house2 && !path) {
		path = resolve(import.meta.dirname, '../../skps/model-eval-exports/house2_model-eval.json');
	}

	return { path, isJson, house2, summary, snapshot, storeys, barriers, graphs, loops };
}

const options = parseOptions(Bun.argv.slice(2));

if (!options.path) {
	console.error('Usage: bun run audit-room-evidence.ts <absolute-model-json-path> [--json] [--house2] [--summary|--snapshot|--storeys|--barriers|--graphs|--loops]');
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

	const getGraphInfo = (candId: string) => {
		const g = snapshot.barrierGraphs?.find(x => x.storeyCandidateId === candId);
		if (!g) return null;
		const normG = normalizeBarrierGraph(g);
		const nd = normG.normalizationDiagnostics;
		const loopRes = findBoundaryLoopCandidates(normG);
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
				}))
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
		}
	}

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
			diagnostics: aggregateLoopDiagnostics
		},
		primaryCandidates: primaryCandidatesDetails,
		secondaryCandidates: secondaryCandidatesDetails
	};

	if (isJson) {
		console.log(JSON.stringify(summary, null, 2));
	} else {
		const showAll = !options.summary && !options.storeys && !options.barriers && !options.graphs && !options.loops;

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
		}

		if (showAll || options.storeys || options.graphs || options.loops) {
			console.log(`\n=== PRIMARY CANDIDATES DETAILS ===`);
			for (const p of summary.primaryCandidates) {
				console.log(`  - ID: ${p.id.length > 80 ? p.id.slice(0, 77) + '...' : p.id}`);
				console.log(`    Elevation Range:  ${p.elevationRange.min.toFixed(3)} to ${p.elevationRange.max.toFixed(3)} m`);
				console.log(`    Score:            ${p.score.toFixed(6)}`);
				console.log(`    Total Area:       ${p.totalArea.toFixed(3)} m2`);
				console.log(`    Coverage Ratio:   ${p.modelRelativeCoverage.toFixed(6)}`);
				console.log(`    Ambiguous:        ${p.isAmbiguous}`);
				if (p.graph && (showAll || options.graphs || options.loops)) {
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
				if (s.graph && (showAll || options.graphs || options.loops)) {
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
		}
	}
} catch (e: any) {
	console.error(`Execution failed: ${e.message}`);
	process.exit(1);
}
