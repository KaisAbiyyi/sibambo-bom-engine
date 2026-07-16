import type { DesignScenario, DesignScenarioOverrides } from './scenarios';
import type { BuildingAnalysisResult, RoomAnalysisConfiguration } from './types';
import type { RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference } from '../semantics';
import type { DetectedRoom } from '../detected-room';
import { runScenarioAnalysis, compareScenarios, type BuildingComparisonResult, type RoomComparisonResult } from './scenarios';

// 1. Contracts
export type OptimizationVariableConfig = {
	path: keyof DesignScenarioOverrides;
	min: number;
	max: number;
	step: number;
};

export type OptimizationObjectiveType = 'reduce_cooling_load' | 'reduce_ottv' | 'improve_ach' | 'improve_thermal_comfort' | 'reduce_luminaires' | 'minimize_changes';

export type OptimizationConstraint = {
	type: 'max_ottv' | 'min_ach' | 'max_cooling_load' | 'max_changes';
	value: number;
};

export type OptimizationConfig = {
	variables: OptimizationVariableConfig[];
	objectives: OptimizationObjectiveType[];
	constraints: OptimizationConstraint[];
	maxEvaluations: number;
	timeBudgetMs: number;
	seed: number;
};

export type EvaluatedScenario = {
	scenario: DesignScenario;
	comparison: BuildingComparisonResult;
	isFeasible: boolean;
	violationReasons: string[];
	objectiveValues: Record<OptimizationObjectiveType, number>;
	distanceFromBaseline: number; // for minimize_changes
};

export type OptimizationResult = {
	totalEvaluated: number;
	feasibleCount: number;
	rejectedCount: number;
	paretoFrontier: EvaluatedScenario[];
	recommendedScenario: EvaluatedScenario | null;
	diagnostics: string[];
};

// 2. Engine Logic
// Simple seeded random number generator for determinism
function mulberry32(a: number) {
	return function() {
		let t = a += 0x6D2B79F5;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	}
}

function calculateObjectiveValue(obj: OptimizationObjectiveType, comparison: BuildingComparisonResult, distance: number): number {
	// Returns a value where LOWER is ALWAYS BETTER for the Pareto sort.
	switch (obj) {
		case 'reduce_cooling_load':
			return comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityKwDelta?.proposedValue ?? Infinity;
		case 'reduce_ottv':
			return comparison.ottvDelta.buildingOttvWm2Delta?.proposedValue ?? Infinity;
		case 'improve_ach':
			// Higher ACH is better, so return negative
			return -(comparison.rooms.reduce((sum: number, r: RoomComparisonResult) => sum + (r.airflowAchDelta?.proposedValue ?? 0), 0) / Math.max(1, comparison.rooms.length));
		case 'improve_thermal_comfort':
			// Higher compliance rate is better
			return -(comparison.buildingSummaryDelta.thermalComfortComplianceRateDelta?.proposedValue ?? 0);
		case 'reduce_luminaires':
			return comparison.buildingSummaryDelta.totalEstimatedLuminairesDelta?.proposedValue ?? Infinity;
		case 'minimize_changes':
			return distance;
		default:
			return 0;
	}
}

function isFeasible(comparison: BuildingComparisonResult, constraints: OptimizationConstraint[]): { feasible: boolean, reasons: string[] } {
	const reasons: string[] = [];
	for (const c of constraints) {
		if (c.type === 'max_ottv') {
			const ottv = comparison.ottvDelta.buildingOttvWm2Delta?.proposedValue;
			if (ottv !== undefined && ottv > c.value) reasons.push(`OTTV ${ottv.toFixed(2)} exceeds max ${c.value}`);
		}
		if (c.type === 'min_ach') {
			const avgAch = comparison.rooms.reduce((sum: number, r: RoomComparisonResult) => sum + (r.airflowAchDelta?.proposedValue ?? 0), 0) / Math.max(1, comparison.rooms.length);
			if (avgAch < c.value) reasons.push(`Avg ACH ${avgAch.toFixed(2)} below min ${c.value}`);
		}
		if (c.type === 'max_cooling_load') {
			const load = comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityKwDelta?.proposedValue;
			if (load !== undefined && load > c.value) reasons.push(`Cooling load ${load.toFixed(2)} exceeds max ${c.value}`);
		}
	}
	return { feasible: reasons.length === 0, reasons };
}

function dominates(a: Record<OptimizationObjectiveType, number>, b: Record<OptimizationObjectiveType, number>, objectives: OptimizationObjectiveType[]): boolean {
	let strictlyBetter = false;
	for (const obj of objectives) {
		if (a[obj] > b[obj]) return false; // a is worse in at least one objective
		if (a[obj] < b[obj]) strictlyBetter = true; // a is strictly better in at least one
	}
	return strictlyBetter;
}

function getParetoFrontier(scenarios: EvaluatedScenario[], objectives: OptimizationObjectiveType[]): EvaluatedScenario[] {
	const frontier: EvaluatedScenario[] = [];
	for (let i = 0; i < scenarios.length; i++) {
		let isDominated = false;
		for (let j = 0; j < scenarios.length; j++) {
			if (i === j) continue;
			if (dominates(scenarios[j].objectiveValues, scenarios[i].objectiveValues, objectives)) {
				isDominated = true;
				break;
			}
		}
		if (!isDominated) {
			frontier.push(scenarios[i]);
		}
	}
	return frontier;
}

export async function runOptimization(
	baselineRooms: DetectedRoom[],
	topology: RoomTopologyGraph,
	semantics: RoomSemanticInference[],
	baselineAnalysis: BuildingAnalysisResult,
	baseConfig: RoomAnalysisConfiguration,
	optConfig: OptimizationConfig,
	onProgress?: (progress: number, total: number) => void,
	signal?: AbortSignal
): Promise<OptimizationResult> {
	
	const rng = mulberry32(optConfig.seed);
	const startMs = performance.now();
	const evaluated: EvaluatedScenario[] = [];
	const diagnostics: string[] = [];

	let feasibleCount = 0;
	let rejectedCount = 0;

	for (let i = 0; i < optConfig.maxEvaluations; i++) {
		if (signal?.aborted) {
			diagnostics.push('Optimization cancelled by user.');
			break;
		}

		if (performance.now() - startMs > optConfig.timeBudgetMs) {
			diagnostics.push(`Time budget of ${optConfig.timeBudgetMs}ms exceeded.`);
			break;
		}

		// Generate random overrides
		const overrides: DesignScenarioOverrides = {};
		let distance = 0;
		for (const v of optConfig.variables) {
			// random step-aligned value
			const steps = Math.floor((v.max - v.min) / v.step);
			const stepIndex = Math.floor(rng() * (steps + 1));
			const val = v.min + stepIndex * v.step;
			(overrides as any)[v.path] = val;
			
			// normalized distance 0 to 1
			distance += Math.abs((val - v.min) / (v.max - v.min || 1));
		}

		const scenario: DesignScenario = {
			id: `opt_${i}`,
			name: `Candidate ${i+1}`,
			description: 'Optimization candidate',
			isBaseline: false,
			overrides
		};

		try {
			const proposedAnalysis = runScenarioAnalysis(scenario, baselineRooms, topology, semantics, baseConfig);
			const comparison = compareScenarios(baselineAnalysis, proposedAnalysis);
			
			const { feasible, reasons } = isFeasible(comparison, optConfig.constraints);
			if (feasible) feasibleCount++;
			else rejectedCount++;

			const objectiveValues = {} as Record<OptimizationObjectiveType, number>;
			for (const obj of optConfig.objectives) {
				objectiveValues[obj] = calculateObjectiveValue(obj, comparison, distance);
			}

			evaluated.push({
				scenario,
				comparison,
				isFeasible: feasible,
				violationReasons: reasons,
				objectiveValues,
				distanceFromBaseline: distance
			});
		} catch (e) {
			rejectedCount++;
			diagnostics.push(`Scenario ${i} failed evaluation: ${(e as Error).message}`);
		}

		if (onProgress) {
			onProgress(i + 1, optConfig.maxEvaluations);
		}

		// Yield to event loop to allow cancellation
		await new Promise(r => setTimeout(r, 0));
	}

	const feasibleScenarios = evaluated.filter(s => s.isFeasible);
	const paretoFrontier = getParetoFrontier(feasibleScenarios, optConfig.objectives);

	// Recommended scenario: select one that balances all objectives (min sum of normalized objectives)
	let recommendedScenario: EvaluatedScenario | null = null;
	if (paretoFrontier.length > 0) {
		const mins = {} as Record<OptimizationObjectiveType, number>;
		const maxs = {} as Record<OptimizationObjectiveType, number>;
		
		for (const obj of optConfig.objectives) {
			mins[obj] = Math.min(...paretoFrontier.map(s => s.objectiveValues[obj]));
			maxs[obj] = Math.max(...paretoFrontier.map(s => s.objectiveValues[obj]));
		}

		let bestScore = Infinity;
		for (const s of paretoFrontier) {
			let score = 0;
			for (const obj of optConfig.objectives) {
				const range = maxs[obj] - mins[obj];
				if (range > 0) {
					score += (s.objectiveValues[obj] - mins[obj]) / range;
				}
			}
			if (score < bestScore) {
				bestScore = score;
				recommendedScenario = s;
			}
		}
	}

	return {
		totalEvaluated: evaluated.length,
		feasibleCount,
		rejectedCount,
		paretoFrontier,
		recommendedScenario,
		diagnostics
	};
}
