import { BUILDING_CATEGORIES, type BuildingCategory } from './rule-bank-v1';

export type ClassificationMetricRow = {
	truth: BuildingCategory;
	predicted: BuildingCategory;
	confidence: number;
	candidateScores?: number[];
};

export type CategoryMetric = {
	precision: number;
	recall: number;
	f1: number;
	support: number;
};

export type ClassificationMetrics = {
	sampleCount: number;
	accuracy: number;
	macroF1: number;
	unknownRate: number;
	ambiguousRate: number;
	perCategory: Record<BuildingCategory, CategoryMetric>;
	confusionMatrix: Record<BuildingCategory, Record<BuildingCategory, number>>;
};

export function evaluateClassifications(rows: ClassificationMetricRow[]): ClassificationMetrics {
	const confusionMatrix = Object.fromEntries(
		BUILDING_CATEGORIES.map((truth) => [truth, Object.fromEntries(BUILDING_CATEGORIES.map((predicted) => [predicted, 0]))])
	) as Record<BuildingCategory, Record<BuildingCategory, number>>;

	for (const row of rows) confusionMatrix[row.truth][row.predicted] += 1;

	const perCategory = Object.fromEntries(
		BUILDING_CATEGORIES.map((category) => {
			const truePositive = confusionMatrix[category][category];
			const support = BUILDING_CATEGORIES.reduce((sum, predicted) => sum + confusionMatrix[category][predicted], 0);
			const predictedCount = BUILDING_CATEGORIES.reduce((sum, truth) => sum + confusionMatrix[truth][category], 0);
			const precision = divide(truePositive, predictedCount);
			const recall = divide(truePositive, support);
			const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
			return [category, { precision: round(precision), recall: round(recall), f1: round(f1), support }];
		})
	) as Record<BuildingCategory, CategoryMetric>;

	const supported = BUILDING_CATEGORIES.filter((category) => perCategory[category].support > 0);
	const correct = rows.filter((row) => row.truth === row.predicted).length;
	const ambiguous = rows.filter((row) => {
		const scores = [...(row.candidateScores || [])].sort((left, right) => right - left);
		return scores.length > 1 && scores[0] - scores[1] < 0.08;
	}).length;

	return {
		sampleCount: rows.length,
		accuracy: round(divide(correct, rows.length)),
		macroF1: round(divide(supported.reduce((sum, category) => sum + perCategory[category].f1, 0), supported.length)),
		unknownRate: round(divide(rows.filter((row) => row.predicted === 'unknown').length, rows.length)),
		ambiguousRate: round(divide(ambiguous, rows.length)),
		perCategory,
		confusionMatrix
	};
}

function divide(numerator: number, denominator: number) {
	return denominator > 0 ? numerator / denominator : 0;
}

function round(value: number) {
	return Number(value.toFixed(6));
}
