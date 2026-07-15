import { expect, test } from 'bun:test';
import type { DetectedRoom } from '../detected-room';
import type { RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference } from '../semantics';
import type { BuildingAnalysisResult, RoomAnalysisConfiguration } from './types';
import { runOptimization, type OptimizationConfig } from './optimization';

const DUMMY_ROOMS: DetectedRoom[] = [
	{
		id: 'R1',
		storeyId: 'S1',
		boundary2D: [],
		holes2D: [],
		floorElevation: 0,
		ceilingElevation: 3,
		height: 3,
		floorArea: 10,
		perimeter: 12,
		estimatedVolume: 30,
		centroid: { x: 0, y: 0, z: 0 },
		boundingBox: { min: { x: -1.5, y: -1.5, z: 0 }, max: { x: 1.5, y: 1.5, z: 3 } },
		planBounds: { min: { x: -1.5, y: -1.5 }, max: { x: 1.5, y: 1.5 } },
		sourceEnvelopeIds: []
	} as any
];

const DUMMY_TOPOLOGY: RoomTopologyGraph = { rooms: [], connections: [], sharedBoundaries: [], exteriorConnections: [], diagnostics: { } as any } as any;
const DUMMY_SEMANTICS: RoomSemanticInference[] = [];
const DUMMY_CONFIG: RoomAnalysisConfiguration = {
	indoorDesignTempC: 24,
	outdoorDesignTempC: 32,
	relativeHumidityPercent: 60,
	localWindSpeedMs: 2.5,
	localWindDirectionDeg: 0,
	projectNorthDeg: 0,
	defaultLuminaireFluxLm: 1000,
	defaultLuminaireWattageW: 10,
	coefficientOfUtilization: 0.8,
	lightLossFactor: 0.8,
	acSafetyMargin: 0.1,
	defaultWallUValue: 2,
	defaultGlazingUValue: 5,
	defaultSolarFactor: 0.7,
	defaultShadingCoefficient: 0.8,
	defaultSolarAbsorptance: 0.6,
	ottvThresholdWm2: 35
};

function createMockAnalysisResult(): BuildingAnalysisResult {
	return {
		rooms: [
			{
				roomId: 'R1',
				storeyId: 'S1',
				thermalComfort: { status: 'pass', operativeTempC: { value: 25, state: 'calculated', source: [], confidence: 1, diagnostics: [] }, predictedValue: { value: 0, state: 'calculated', source: [], confidence: 1, diagnostics: [] } } as any,
				humanFlow: { accessibilityStatus: 'accessible', movementScore: { value: 100, state: 'calculated', source: [], confidence: 1, diagnostics: [] } } as any,
				naturalVentilation: { type: 'single_sided', estimatedAch: { value: 1.0, state: 'calculated', source: [], confidence: 1, diagnostics: [] } } as any,
				coolingCapacity: { recommendedCapacityW: { value: 2000, state: 'calculated', source: [], confidence: 1, diagnostics: [] }, recommendedCapacityKw: { value: 2.0, state: 'calculated', source: [], confidence: 1, diagnostics: [] }, recommendedCapacityPk: { value: 1.0, state: 'calculated', source: [], confidence: 1, diagnostics: [] } } as any,
				artificialLighting: { roundedUpCount: { value: 4, state: 'calculated', source: [], confidence: 1, diagnostics: [] } } as any,
				illuminanceRequirement: { targetLux: { value: 300, state: 'calculated', source: [], confidence: 1, diagnostics: [] } } as any,
				diagnostics: [],
				dataQuality: 'complete'
			}
		],
		ottv: {
			buildingOttvWm2: { value: 40, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			isCompliant: { value: false, state: 'calculated', source: [], confidence: 1, diagnostics: [] },
			facades: []
		} as any,
		summary: { totalRooms: 1, analyzedRooms: 1, totalGrossFloorAreaM2: 10, totalEstimatedCoolingCapacityKw: 2, totalEstimatedCoolingCapacityPk: 1, totalEstimatedLuminaires: 4, predominantVentilationType: 'single_sided', thermalComfortComplianceRate: 1 },
		diagnostics: [],
		configuration: DUMMY_CONFIG
	};
}

test('Deterministic search produces repeatable results', async () => {
	const optConfig: OptimizationConfig = {
		variables: [{ path: 'windowAreaMultiplier', min: 0.5, max: 1.5, step: 0.1 }],
		objectives: ['reduce_cooling_load', 'improve_ach'],
		constraints: [],
		maxEvaluations: 10,
		timeBudgetMs: 5000,
		seed: 123
	};
	const analysis = createMockAnalysisResult();
	
	const run1 = await runOptimization(DUMMY_ROOMS, DUMMY_TOPOLOGY, DUMMY_SEMANTICS, analysis, DUMMY_CONFIG, optConfig);
	const run2 = await runOptimization(DUMMY_ROOMS, DUMMY_TOPOLOGY, DUMMY_SEMANTICS, analysis, DUMMY_CONFIG, optConfig);
	
	expect(run1.totalEvaluated).toBe(10);
	expect(run2.totalEvaluated).toBe(10);
	
	expect(run1.paretoFrontier.length).toBe(run2.paretoFrontier.length);
	if (run1.paretoFrontier.length > 0) {
		expect(run1.paretoFrontier[0].scenario.overrides.windowAreaMultiplier)
			.toBe(run2.paretoFrontier[0].scenario.overrides.windowAreaMultiplier);
	}
});

test('Constraints safely reject non-compliant scenarios', async () => {
	const optConfig: OptimizationConfig = {
		variables: [{ path: 'wallUValueMultiplier', min: 0.1, max: 2.0, step: 0.5 }],
		objectives: ['reduce_ottv'],
		constraints: [{ type: 'max_ottv', value: 35 }],
		maxEvaluations: 5,
		timeBudgetMs: 5000,
		seed: 42
	};
	const analysis = createMockAnalysisResult();
	const res = await runOptimization(DUMMY_ROOMS, DUMMY_TOPOLOGY, DUMMY_SEMANTICS, analysis, DUMMY_CONFIG, optConfig);
	
	for (const s of res.paretoFrontier) {
		expect(s.isFeasible).toBe(true);
		expect(s.objectiveValues['reduce_ottv']).toBeLessThanOrEqual(35);
	}
});

test('Time budget aborts execution early', async () => {
	const optConfig: OptimizationConfig = {
		variables: [{ path: 'windowAreaMultiplier', min: 0.1, max: 2.0, step: 0.1 }],
		objectives: ['reduce_ottv'],
		constraints: [],
		maxEvaluations: 10000,
		timeBudgetMs: 5,
		seed: 42
	};
	const analysis = createMockAnalysisResult();
	const res = await runOptimization(DUMMY_ROOMS, DUMMY_TOPOLOGY, DUMMY_SEMANTICS, analysis, DUMMY_CONFIG, optConfig);
	
	expect(res.totalEvaluated).toBeLessThan(10000);
	expect(res.diagnostics.some(d => d.includes('budget'))).toBe(true);
});

test('Cancellation controller aborts execution', async () => {
	const optConfig: OptimizationConfig = {
		variables: [{ path: 'windowAreaMultiplier', min: 0.1, max: 2.0, step: 0.1 }],
		objectives: ['reduce_ottv'],
		constraints: [],
		maxEvaluations: 1000,
		timeBudgetMs: 10000,
		seed: 42
	};
	const ac = new AbortController();
	setTimeout(() => ac.abort(), 2);
	
	const analysis = createMockAnalysisResult();
	const res = await runOptimization(DUMMY_ROOMS, DUMMY_TOPOLOGY, DUMMY_SEMANTICS, analysis, DUMMY_CONFIG, optConfig, undefined, ac.signal);
	
	expect(res.totalEvaluated).toBeLessThan(1000);
	expect(res.diagnostics.some(d => d.includes('cancelled'))).toBe(true);
});

test('Pareto frontier excludes dominated scenarios', async () => {
	const optConfig: OptimizationConfig = {
		variables: [{ path: 'windowAreaMultiplier', min: 0.5, max: 2.0, step: 0.5 }],
		objectives: ['reduce_cooling_load', 'reduce_ottv'],
		constraints: [],
		maxEvaluations: 10,
		timeBudgetMs: 5000,
		seed: 1
	};
	const analysis = createMockAnalysisResult();
	const res = await runOptimization(DUMMY_ROOMS, DUMMY_TOPOLOGY, DUMMY_SEMANTICS, analysis, DUMMY_CONFIG, optConfig);
	
	const frontier = res.paretoFrontier;
	for (let i = 0; i < frontier.length; i++) {
		for (let j = 0; j < frontier.length; j++) {
			if (i === j) continue;
			const a = frontier[j].objectiveValues;
			const b = frontier[i].objectiveValues;
			let strictlyBetter = false;
			let strictlyWorse = false;
			if (a.reduce_cooling_load < b.reduce_cooling_load) strictlyBetter = true;
			if (a.reduce_cooling_load > b.reduce_cooling_load) strictlyWorse = true;
			if (a.reduce_ottv < b.reduce_ottv) strictlyBetter = true;
			if (a.reduce_ottv > b.reduce_ottv) strictlyWorse = true;
			
			expect(strictlyBetter && !strictlyWorse).toBe(false);
		}
	}
});
