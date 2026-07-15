import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { parseModelEvalJsonV1 } from '../../formats/model-eval-json';
import { createGeometryFoundation } from '../../geometry';
import { createClassificationUnitIndex } from '../../annotation';
import { createRoomEvidenceProcessor } from '../processor';
import { normalizeBarrierGraph } from '../helpers';
import { findBoundaryLoopCandidates, rankBoundaryLoopCandidates } from '../loops';
import { assignHorizontalEvidenceToLoops, rankLoopSurfaceAssignments } from '../surfaces';
import { buildVerticalEnvelopeCandidates, calculateVerticalEnvelopeCandidateFingerprint, refineVerticalEnvelopeCandidates } from '../envelopes';
import { checkBudget, createCounters, stratifiedSample, type BenchmarkPhase } from './performance-workflow';

type Options = { model: string; phase: BenchmarkPhase; maxCandidates: number; sampleRatio: number; seed: number; timeBudgetMs: number; memoryBudgetMb: number; repeat: number; output?: string; full: boolean };
const defaults: Options = { model: 'static/dev-models/house2_model-eval.json', phase: 'all', maxCandidates: 5000, sampleRatio: 1, seed: 4_005, timeBudgetMs: 30_000, memoryBudgetMb: 1024, repeat: 1, full: false };

function parseArgs(argv: string[]): Options {
	const result = { ...defaults };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--full') { result.full = true; continue; }
		const value = argv[++i];
		if (value === undefined || !arg.startsWith('--')) throw new Error(`missing value for ${arg}`);
		if (arg === '--model') result.model = value;
		else if (arg === '--phase' && ['fingerprint', 'envelope-refinement', 'all'].includes(value)) result.phase = value as BenchmarkPhase;
		else if (arg === '--max-candidates') result.maxCandidates = Number(value);
		else if (arg === '--sample-ratio') result.sampleRatio = Number(value);
		else if (arg === '--seed') result.seed = Number(value);
		else if (arg === '--time-budget-ms') result.timeBudgetMs = Number(value);
		else if (arg === '--memory-budget-mb') result.memoryBudgetMb = Number(value);
		else if (arg === '--repeat') result.repeat = Number(value);
		else if (arg === '--output') result.output = value;
		else throw new Error(`unknown option ${arg}`);
	}
	if (!Number.isFinite(result.maxCandidates) || result.maxCandidates < 1 || result.sampleRatio <= 0 || result.sampleRatio > 1 || result.repeat < 1) throw new Error('invalid benchmark limit');
	return result;
}

function writeResult(output: string | undefined, result: unknown) { if (output) { const path = resolve(output); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(result, null, 2)); } }

async function run(options: Options) {
	const started = performance.now(); const counters = createCounters(); const result: Record<string, unknown> = { options, startedAt: new Date().toISOString(), counters, aborted: null };
	try {
		const modelPath = resolve(process.cwd(), options.model);
		// Large source models require explicit acknowledgement. Sampling happens after evidence extraction.
		if (!options.full && /presentation20/i.test(modelPath)) throw new Error('large model requires --full; default benchmark never opens it');
		const scene = parseModelEvalJsonV1(JSON.parse(readFileSync(modelPath, 'utf8')));
		const foundation = createGeometryFoundation(scene); const index = createClassificationUnitIndex(foundation); const objects = foundation.buildLogicalObjectIndex().objects;
		for (const object of objects) index.processObject(object.id);
		const processor = createRoomEvidenceProcessor(); processor.processAll(index.units); const snapshot = processor.snapshot();
		const loops = snapshot.storeyBands.filter(b => b.status !== 'noise').flatMap(b => { const graph = snapshot.barrierGraphs?.find(g => g.storeyCandidateId === b.id); if (!graph) return []; const normalized = normalizeBarrierGraph(graph); const found = findBoundaryLoopCandidates(normalized); return rankBoundaryLoopCandidates(found.candidates, normalized, found.diagnostics).candidates.filter(c => c.status !== 'noise'); });
		const requested = Math.min(options.maxCandidates, Math.max(1, Math.floor(loops.length * options.sampleRatio)));
		const sample = options.full ? loops : stratifiedSample(loops, requested, options.seed, loop => `${loop.storeyCandidateId}:${Math.round(loop.area / 25)}`);
		counters.candidatesInspected = sample.length; result.sampleSize = sample.length; result.availableCandidates = loops.length;
		const assignments = rankLoopSurfaceAssignments(assignHorizontalEvidenceToLoops(sample, snapshot.horizontalSurfaces, snapshot.storeyBands).assignments, sample).assignments;
		const envelopes = buildVerticalEnvelopeCandidates(sample, assignments).candidates;
		// Each envelope represents one lower/upper candidate pair. No cross-storey all-pairs pass exists.
		counters.candidatePairsConsidered = envelopes.length;
		const initialAbort = checkBudget(started, { timeBudgetMs: options.timeBudgetMs, memoryBudgetMb: options.memoryBudgetMb, pairBudget: Math.max(sample.length * 64, 100_000) }, counters);
		if (initialAbort) { result.aborted = initialAbort; return; }
		for (let iteration = 0; iteration < options.repeat; iteration++) {
			if (options.phase === 'fingerprint' || options.phase === 'all') { const ordered = [...envelopes].sort((a, b) => { counters.sortComparisons++; return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }); result.fingerprint = calculateVerticalEnvelopeCandidateFingerprint(ordered); }
			if (options.phase === 'envelope-refinement' || options.phase === 'all') { const abort = checkBudget(started, { timeBudgetMs: options.timeBudgetMs, memoryBudgetMb: options.memoryBudgetMb, pairBudget: Math.max(sample.length * 64, 100_000) }, counters); if (abort) { result.aborted = abort; break; } const refined = refineVerticalEnvelopeCandidates(envelopes, sample, snapshot.verticalBarriers, snapshot.storeyBands); result.refinedFingerprint = refined.diagnostics.refinementFingerprint; result.detectedRoomCount = refined.candidates.filter(c => c.eligibleForRoomAssembly).length; }
		}
	} catch (error) { result.aborted = { reason: 'error', message: error instanceof Error ? error.message : String(error) }; }
	finally { result.elapsedMs = Math.round(performance.now() - started); result.memoryMb = Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)); writeResult(options.output, result); console.log(JSON.stringify(result, null, 2)); }
}

run(parseArgs(process.argv.slice(2)));
