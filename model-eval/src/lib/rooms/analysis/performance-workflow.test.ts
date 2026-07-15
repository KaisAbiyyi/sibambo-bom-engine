import { describe, expect, test } from 'bun:test';
import { checkBudget, createCounters, stratifiedSample } from './performance-workflow';

describe('bounded benchmark workflow', () => {
	test('deterministic strata sample preserves each storey', () => {
		const input = ['a:1', 'a:2', 'b:1', 'b:2', 'c:1', 'c:2'];
		const sample = stratifiedSample(input, 3, 42, value => value[0]);
		expect(sample).toEqual(stratifiedSample(input, 3, 42, value => value[0]));
		expect(new Set(sample.map(value => value[0]))).toEqual(new Set(['a', 'b', 'c']));
	});

	test('pair budget aborts before expensive work', () => {
		const counters = createCounters(); counters.candidatePairsConsidered = 11;
		expect(checkBudget(performance.now(), { timeBudgetMs: 10_000, memoryBudgetMb: 9_999_999, pairBudget: 10 }, counters)?.reason).toBe('pair-budget');
	});

	test('time budget aborts', () => {
		expect(checkBudget(performance.now() - 100, { timeBudgetMs: 1, memoryBudgetMb: 9_999_999, pairBudget: 10 }, createCounters())?.reason).toBe('time-budget');
	});

	test('memory budget handling is reported', () => {
		expect(checkBudget(performance.now(), { timeBudgetMs: 10_000, memoryBudgetMb: 0, pairBudget: 10 }, createCounters())?.reason).toBe('memory-budget');
	});
});
