import { describe, expect, test } from 'bun:test';
import { evaluateClassifications } from './metrics';

describe('classifier regression metrics', () => {
	test('computes per-category precision, recall, F1, confusion, unknown, and ambiguous rates', () => {
		const report = evaluateClassifications([
			{ truth: 'roof', predicted: 'roof', confidence: 0.92, candidateScores: [0.92] },
			{ truth: 'floor', predicted: 'floor', confidence: 0.88, candidateScores: [0.88, 0.32] },
			{ truth: 'window', predicted: 'unknown', confidence: 0.6, candidateScores: [0.51, 0.47] },
			{ truth: 'furniture', predicted: 'fixture', confidence: 0.7, candidateScores: [0.7, 0.2] }
		]);

		expect(report.sampleCount).toBe(4);
		expect(report.accuracy).toBe(0.5);
		expect(report.unknownRate).toBe(0.25);
		expect(report.ambiguousRate).toBe(0.25);
		expect(report.confusionMatrix.window.unknown).toBe(1);
		expect(report.confusionMatrix.furniture.fixture).toBe(1);
		expect(report.perCategory.roof).toMatchObject({ precision: 1, recall: 1, f1: 1, support: 1 });
		expect(report.perCategory.window).toMatchObject({ precision: 0, recall: 0, f1: 0, support: 1 });
	});

	test('returns stable zero metrics for an empty labelled corpus', () => {
		const report = evaluateClassifications([]);
		expect(report.sampleCount).toBe(0);
		expect(report.accuracy).toBe(0);
		expect(report.macroF1).toBe(0);
		expect(report.unknownRate).toBe(0);
		expect(report.ambiguousRate).toBe(0);
	});
});
