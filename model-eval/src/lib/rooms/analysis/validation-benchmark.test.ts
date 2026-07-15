import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseModelEvalJsonV1 } from '../../formats/model-eval-json';
import { runRoomDebugPipeline } from '../room-debug-pipeline';
import { runScenarioAnalysis, compareScenarios, DEFAULT_PROPOSED_SCENARIO, type DesignScenario } from './scenarios';

describe('Real-Model Numerical Validation and Benchmarking (Task 4A)', () => {
	const house2Path = resolve(process.cwd(), 'static', 'dev-models', 'house2_model-eval.json');
	const hasHouse2 = existsSync(house2Path);

	it('validates house2_model-eval.json (simple representative clean model) across the full pipeline', async () => {
		if (!hasHouse2) {
			console.warn('house2_model-eval.json not found, skipping real-model test');
			return;
		}

		const jsonContent = JSON.parse(readFileSync(house2Path, 'utf8'));
		const scene = parseModelEvalJsonV1(jsonContent);
		const result = await runRoomDebugPipeline(scene);

		expect(result.error).toBeUndefined();
		expect(result.dataQuality).toBe('complete');
		expect(result.intelligence).toBeDefined();

		const intel = result.intelligence!;
		expect(intel.detectedRooms.length).toBe(1);
		expect(intel.topology.rooms.length).toBe(1);
		expect(intel.semantics.length).toBe(1);
		expect(intel.analysis).toBeDefined();

		const room = intel.detectedRooms[0];
		expect(room.floorArea).toBeCloseTo(6.555, 2);
		expect(room.estimatedVolume).toBeCloseTo(16.61, 2);
		expect(room.height).toBeCloseTo(2.534, 2);

		const semantic = intel.semantics[0];
		expect(semantic.primaryFunction).toBe('corridor');
		expect(semantic.confidence).toBeGreaterThan(0);

		const analysis = intel.analysis!;
		expect(analysis.summary.totalRooms).toBe(1);
		expect(analysis.summary.analyzedRooms).toBe(1);
		expect(analysis.summary.totalGrossFloorAreaM2).toBeCloseTo(6.6, 1);
		expect(analysis.summary.totalEstimatedCoolingCapacityKw).toBeCloseTo(2.24, 2);
		expect(analysis.summary.totalEstimatedCoolingCapacityPk).toBeCloseTo(0.8, 1);
		expect(analysis.summary.totalEstimatedLuminaires).toBe(1);
		expect(analysis.summary.predominantVentilationType).toBe('no_exterior_ventilation');

		// Check numerical calculation traces for room 1
		const roomAnalysis = analysis.rooms[0];
		expect(roomAnalysis.dataQuality).toBe('complete');

		// Cooling load numerical verification:
		expect(roomAnalysis.coolingCapacity.recommendedCapacityKw.value).toBeCloseTo(2.24, 2);
		expect(roomAnalysis.coolingCapacity.recommendedCapacityPk.value).toBeCloseTo(0.8, 1);
		expect(roomAnalysis.coolingCapacity.trace).toBeDefined();
		expect(roomAnalysis.coolingCapacity.trace!.formula).toContain('Q_total = Q_sensible + Q_latent');
		expect(roomAnalysis.coolingCapacity.trace!.inputs.length).toBeGreaterThan(0);

		// Artificial lighting verification:
		expect(roomAnalysis.artificialLighting.roundedUpCount.value).toBe(1);
		expect(roomAnalysis.artificialLighting.trace).toBeDefined();
		expect(roomAnalysis.artificialLighting.trace!.finalResult.unit).toContain('count');
		expect(roomAnalysis.artificialLighting.estimatedAchievedLux.value).toBeCloseTo(253.8, 1);
		expect(roomAnalysis.artificialLighting.trace!.method).toBe('Lumen Method (Average Horizontal Illuminance)');

		// Natural ventilation verification:
		expect(roomAnalysis.naturalVentilation.type).toBe('no_exterior_ventilation');
		expect(roomAnalysis.naturalVentilation.estimatedAch.value).toBe(0);
		expect(roomAnalysis.naturalVentilation.trace).toBeDefined();
		expect(roomAnalysis.naturalVentilation.trace!.assumptions[0]).toContain('mechanic');

		// OTTV numerical verification:
		expect(analysis.ottv).toBeDefined();
		expect(analysis.ottv.buildingOttvWm2.value).toBeCloseTo(25.2, 1);
		expect(analysis.ottv.isCompliant.value).toBe(true);
		expect(analysis.ottv.trace).toBeDefined();
		expect(analysis.ottv.trace!.formula).toContain('BuildingOTTV');

		// Scenario comparison verification on real model data
		const baselineScenario: DesignScenario = {
			id: 'baseline-real',
			name: 'Baseline House2',
			description: 'Baseline scenario on house2 model',
			isBaseline: true,
			overrides: {}
		};
		const baselineRun = runScenarioAnalysis(baselineScenario, intel.detectedRooms, intel.topology, intel.semantics);
		const proposedRun = runScenarioAnalysis(DEFAULT_PROPOSED_SCENARIO, intel.detectedRooms, intel.topology, intel.semantics);
		const comparison = compareScenarios(baselineRun, proposedRun);

		expect(comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityKwDelta).toBeDefined();
		expect(comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityPkDelta).toBeDefined();
		expect(comparison.rooms.length).toBe(1);
		expect(comparison.rooms[0].roomId).toBe(roomAnalysis.roomId);
	});
});
