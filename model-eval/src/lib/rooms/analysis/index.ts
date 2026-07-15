/**
 * index.ts
 *
 * Composition root for Task 3C: Room and Building Performance Analysis.
 * Orchestrates the input adapter and all seven analysis modules to produce
 * comprehensive per-room and building-level results.
 */

export * from './types';
export * from './profiles';
export * from './adapter';
export * from './thermal-comfort';
export * from './human-flow';
export * from './natural-ventilation';
export * from './cooling-capacity';
export * from './illuminance';
export * from './artificial-lighting';
export * from './ottv';
export * from './scenarios';
export * from './reporting';
export * from './project-configuration';

import type { DetectedRoom } from '../detected-room';
import type { RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference } from '../semantics';
import {
	DEFAULT_ANALYSIS_CONFIGURATION,
	type RoomAnalysisConfiguration,
	type RoomAnalysisResult,
	type BuildingAnalysisResult,
	type BuildingAnalysisSummary,
	type BuildingAnalysisDiagnostic
} from './types';
import { buildRoomAnalysisInputs } from './adapter';
import { calculateThermalComfort } from './thermal-comfort';
import { calculateHumanFlow } from './human-flow';
import { calculateNaturalVentilation } from './natural-ventilation';
import { calculateCoolingCapacity } from './cooling-capacity';
import { calculateIlluminanceRequirement } from './illuminance';
import { calculateArtificialLighting } from './artificial-lighting';
import { calculateBuildingOttv } from './ottv';

export function runBuildingAnalysisPipeline(
	detectedRooms: DetectedRoom[],
	topology: RoomTopologyGraph,
	semantics: RoomSemanticInference[],
	configOverrides?: Partial<RoomAnalysisConfiguration>
): BuildingAnalysisResult {
	const config: RoomAnalysisConfiguration = {
		...DEFAULT_ANALYSIS_CONFIGURATION,
		...(configOverrides || {})
	};

	const inputs = buildRoomAnalysisInputs(detectedRooms, topology, semantics, config);

	const rooms: RoomAnalysisResult[] = inputs.map((input) => {
		const thermalComfort = calculateThermalComfort(input, config);
		const humanFlow = calculateHumanFlow(input, inputs, topology);
		const naturalVentilation = calculateNaturalVentilation(input, config);
		const coolingCapacity = calculateCoolingCapacity(input, config);
		const illuminanceRequirement = calculateIlluminanceRequirement(input);
		const requiredLux = illuminanceRequirement.targetLux.value || 200;
		const artificialLighting = calculateArtificialLighting(input, config, requiredLux);

		const diagnostics: RoomAnalysisResult['diagnostics'] = [];
		if (thermalComfort.status === 'insufficient_data') {
			diagnostics.push({ module: 'thermal', severity: 'warning', message: 'Insufficient environmental data for thermal comfort' });
		}
		if (humanFlow.accessibilityStatus === 'isolated' || humanFlow.accessibilityStatus === 'unreachable') {
			diagnostics.push({ module: 'flow', severity: 'warning', message: `Room is ${humanFlow.accessibilityStatus}` });
		}
		if (input.dataQuality === 'insufficient') {
			diagnostics.push({ module: 'adapter', severity: 'error', message: 'Room geometry inputs insufficient for reliable analysis' });
		}

		return {
			roomId: input.room.id,
			storeyId: input.room.storeyId,
			thermalComfort,
			humanFlow,
			naturalVentilation,
			coolingCapacity,
			artificialLighting,
			illuminanceRequirement,
			diagnostics,
			dataQuality: input.dataQuality
		};
	});

	const ottv = calculateBuildingOttv(inputs, config);

	// Building summary
	const totalRooms = detectedRooms.length;
	const analyzedRooms = rooms.filter((r) => r.dataQuality !== 'insufficient').length;
	const totalGrossFloorAreaM2 = Math.round(detectedRooms.reduce((sum, r) => sum + r.floorArea, 0) * 10) / 10;
	const totalEstimatedCoolingCapacityKw = Math.round(rooms.reduce((sum, r) => sum + (r.coolingCapacity.recommendedCapacityKw.value || 0), 0) * 100) / 100;
	const totalEstimatedCoolingCapacityPk = Math.round(rooms.reduce((sum, r) => sum + (r.coolingCapacity.recommendedCapacityPk.value || 0), 0) * 10) / 10;
	const totalEstimatedLuminaires = rooms.reduce((sum, r) => sum + (r.artificialLighting.roundedUpCount.value || 0), 0);

	// Predominant ventilation type
	const ventCounts: Record<string, number> = {};
	for (const r of rooms) {
		const vt = r.naturalVentilation.type;
		ventCounts[vt] = (ventCounts[vt] || 0) + 1;
	}
	let predominantVentilationType = 'single_sided';
	let maxCount = 0;
	for (const [vt, count] of Object.entries(ventCounts)) {
		if (count > maxCount) {
			maxCount = count;
			predominantVentilationType = vt;
		}
	}

	const comfortableCount = rooms.filter((r) => r.thermalComfort.status === 'comfortable').length;
	const thermalComfortComplianceRate = analyzedRooms > 0 ? Math.round((comfortableCount / analyzedRooms) * 100) / 100 : 0;

	const summary: BuildingAnalysisSummary = {
		totalRooms,
		analyzedRooms,
		totalGrossFloorAreaM2,
		totalEstimatedCoolingCapacityKw,
		totalEstimatedCoolingCapacityPk,
		totalEstimatedLuminaires,
		predominantVentilationType,
		thermalComfortComplianceRate
	};

	const buildingDiagnostics: BuildingAnalysisDiagnostic[] = [];
	if (ottv.isCompliant.value === false) {
		buildingDiagnostics.push({
			category: 'OTTV_COMPLIANCE',
			message: `Building OTTV (${ottv.buildingOttvWm2.value} W/m²) exceeds threshold of ${config.ottvThresholdWm2} W/m²`
		});
	}
	if (config.projectNorthDeg === null) {
		buildingDiagnostics.push({
			category: 'PROJECT_NORTH',
			message: 'Project North is unresolved; orientation calculations use model +Z as North'
		});
	}

	return {
		rooms,
		ottv,
		summary,
		diagnostics: buildingDiagnostics,
		configuration: config
	};
}
