export type BenchmarkPhase = 'fingerprint' | 'envelope-refinement' | 'all';

export interface BenchmarkBudget {
	timeBudgetMs: number;
	memoryBudgetMb: number;
	pairBudget: number;
}

export interface BenchmarkCounters {
	candidatesInspected: number;
	candidatePairsConsidered: number;
	pairsRejectedByStorey: number;
	pairsRejectedByBounds: number;
	expensivePolygonComparisons: number;
	normalizedPolygonCacheHits: number;
	fingerprintCacheHits: number;
	duplicatePairsSkipped: number;
	sortComparisons: number;
	containmentTests: number;
}

export interface BenchmarkAbort {
	reason: 'time-budget' | 'memory-budget' | 'pair-budget';
	message: string;
}

export function createCounters(): BenchmarkCounters {
	return { candidatesInspected: 0, candidatePairsConsidered: 0, pairsRejectedByStorey: 0, pairsRejectedByBounds: 0, expensivePolygonComparisons: 0, normalizedPolygonCacheHits: 0, fingerprintCacheHits: 0, duplicatePairsSkipped: 0, sortComparisons: 0, containmentTests: 0 };
}

export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

/** Deterministic round-robin strata sampling. Preserves every storey before filling dense groups. */
export function stratifiedSample<T>(items: T[], max: number, seed: number, key: (item: T) => string): T[] {
	if (max >= items.length) return [...items];
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const group = key(item);
		const list = groups.get(group) ?? [];
		list.push(item);
		groups.set(group, list);
	}
	const random = seededRandom(seed);
	const buckets = [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, list]) =>
		list.map((item, index) => ({ item, rank: random() + index * 1e-9 })).sort((a, b) => a.rank - b.rank).map(({ item }) => item)
	);
	const result: T[] = [];
	for (let round = 0; result.length < max; round++) {
		let progressed = false;
		for (const bucket of buckets) {
			if (round < bucket.length) { result.push(bucket[round]); progressed = true; }
			if (result.length === max) break;
		}
		if (!progressed) break;
	}
	return result;
}

export function checkBudget(startMs: number, budget: BenchmarkBudget, counters: BenchmarkCounters): BenchmarkAbort | undefined {
	if (counters.candidatePairsConsidered > budget.pairBudget) return { reason: 'pair-budget', message: `pair budget ${budget.pairBudget} exceeded` };
	if (performance.now() - startMs > budget.timeBudgetMs) return { reason: 'time-budget', message: `time budget ${budget.timeBudgetMs}ms exceeded` };
	const memoryMb = process.memoryUsage().heapUsed / 1024 / 1024;
	if (memoryMb > budget.memoryBudgetMb) return { reason: 'memory-budget', message: `heap ${memoryMb.toFixed(1)}MB exceeds ${budget.memoryBudgetMb}MB` };
	return undefined;
}
