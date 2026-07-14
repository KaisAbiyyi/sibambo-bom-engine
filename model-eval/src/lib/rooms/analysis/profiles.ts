/**
 * profiles.ts
 *
 * Centralized room-usage profiles and default engineering parameters for
 * every RoomFunction category (ASHRAE 62.1/55, IESNA/CIBSE lighting, SNI defaults).
 */

import type { RoomFunction } from '../semantics';
import type { RoomUsageProfile } from './types';

export const ROOM_USAGE_PROFILES: Record<RoomFunction, RoomUsageProfile> = {
	living: {
		function: 'living',
		targetIlluminanceLux: 150,
		workPlaneHeightM: 0.75,
		typicalOccupancyAreaPerPersonM2: 5.0,
		sensibleHeatPerPersonW: 70,
		latentHeatPerPersonW: 45,
		equipmentLoadDensityWm2: 8.0,
		lightingPowerDensityWm2: 6.0,
		metabolicRateMet: 1.1,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 2.0,
		thermalComfortMethodEligibility: 'both'
	},
	bedroom: {
		function: 'bedroom',
		targetIlluminanceLux: 100,
		workPlaneHeightM: 0.75,
		typicalOccupancyAreaPerPersonM2: 10.0,
		sensibleHeatPerPersonW: 60,
		latentHeatPerPersonW: 40,
		equipmentLoadDensityWm2: 4.0,
		lightingPowerDensityWm2: 5.0,
		metabolicRateMet: 0.8,
		clothingInsulationClo: 0.8,
		ventilationAchExpectation: 1.5,
		thermalComfortMethodEligibility: 'both'
	},
	bathroom: {
		function: 'bathroom',
		targetIlluminanceLux: 200,
		workPlaneHeightM: 0.85,
		typicalOccupancyAreaPerPersonM2: 4.0,
		sensibleHeatPerPersonW: 65,
		latentHeatPerPersonW: 60,
		equipmentLoadDensityWm2: 2.0,
		lightingPowerDensityWm2: 8.0,
		metabolicRateMet: 1.2,
		clothingInsulationClo: 0.3,
		ventilationAchExpectation: 6.0,
		thermalComfortMethodEligibility: 'mechanical'
	},
	kitchen: {
		function: 'kitchen',
		targetIlluminanceLux: 300,
		workPlaneHeightM: 0.90,
		typicalOccupancyAreaPerPersonM2: 6.0,
		sensibleHeatPerPersonW: 85,
		latentHeatPerPersonW: 75,
		equipmentLoadDensityWm2: 35.0,
		lightingPowerDensityWm2: 10.0,
		metabolicRateMet: 1.6,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 8.0,
		thermalComfortMethodEligibility: 'both'
	},
	dining: {
		function: 'dining',
		targetIlluminanceLux: 200,
		workPlaneHeightM: 0.75,
		typicalOccupancyAreaPerPersonM2: 3.0,
		sensibleHeatPerPersonW: 75,
		latentHeatPerPersonW: 55,
		equipmentLoadDensityWm2: 5.0,
		lightingPowerDensityWm2: 7.0,
		metabolicRateMet: 1.2,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 3.0,
		thermalComfortMethodEligibility: 'both'
	},
	office: {
		function: 'office',
		targetIlluminanceLux: 500,
		workPlaneHeightM: 0.75,
		typicalOccupancyAreaPerPersonM2: 8.0,
		sensibleHeatPerPersonW: 75,
		latentHeatPerPersonW: 55,
		equipmentLoadDensityWm2: 15.0,
		lightingPowerDensityWm2: 9.0,
		metabolicRateMet: 1.1,
		clothingInsulationClo: 0.6,
		ventilationAchExpectation: 4.0,
		thermalComfortMethodEligibility: 'both'
	},
	corridor: {
		function: 'corridor',
		targetIlluminanceLux: 100,
		workPlaneHeightM: 0.0, // Floor plane
		typicalOccupancyAreaPerPersonM2: 15.0,
		sensibleHeatPerPersonW: 80,
		latentHeatPerPersonW: 60,
		equipmentLoadDensityWm2: 1.0,
		lightingPowerDensityWm2: 4.0,
		metabolicRateMet: 1.4,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 1.0,
		thermalComfortMethodEligibility: 'both'
	},
	balcony: {
		function: 'balcony',
		targetIlluminanceLux: 100,
		workPlaneHeightM: 0.0,
		typicalOccupancyAreaPerPersonM2: 5.0,
		sensibleHeatPerPersonW: 70,
		latentHeatPerPersonW: 50,
		equipmentLoadDensityWm2: 0.0,
		lightingPowerDensityWm2: 3.0,
		metabolicRateMet: 1.2,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 15.0,
		thermalComfortMethodEligibility: 'adaptive'
	},
	staircase: {
		function: 'staircase',
		targetIlluminanceLux: 150,
		workPlaneHeightM: 0.0,
		typicalOccupancyAreaPerPersonM2: 12.0,
		sensibleHeatPerPersonW: 100,
		latentHeatPerPersonW: 80,
		equipmentLoadDensityWm2: 1.0,
		lightingPowerDensityWm2: 5.0,
		metabolicRateMet: 2.0,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 2.0,
		thermalComfortMethodEligibility: 'both'
	},
	utility: {
		function: 'utility',
		targetIlluminanceLux: 200,
		workPlaneHeightM: 0.85,
		typicalOccupancyAreaPerPersonM2: 10.0,
		sensibleHeatPerPersonW: 80,
		latentHeatPerPersonW: 60,
		equipmentLoadDensityWm2: 25.0,
		lightingPowerDensityWm2: 6.0,
		metabolicRateMet: 1.4,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 5.0,
		thermalComfortMethodEligibility: 'mechanical'
	},
	storage: {
		function: 'storage',
		targetIlluminanceLux: 100,
		workPlaneHeightM: 0.0,
		typicalOccupancyAreaPerPersonM2: 25.0,
		sensibleHeatPerPersonW: 70,
		latentHeatPerPersonW: 50,
		equipmentLoadDensityWm2: 2.0,
		lightingPowerDensityWm2: 4.0,
		metabolicRateMet: 1.4,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 1.0,
		thermalComfortMethodEligibility: 'both'
	},
	garage: {
		function: 'garage',
		targetIlluminanceLux: 100,
		workPlaneHeightM: 0.0,
		typicalOccupancyAreaPerPersonM2: 20.0,
		sensibleHeatPerPersonW: 80,
		latentHeatPerPersonW: 60,
		equipmentLoadDensityWm2: 5.0,
		lightingPowerDensityWm2: 3.0,
		metabolicRateMet: 1.4,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 6.0,
		thermalComfortMethodEligibility: 'adaptive'
	},
	unassigned: {
		function: 'unassigned',
		targetIlluminanceLux: 200, // Generic fallback
		workPlaneHeightM: 0.75,
		typicalOccupancyAreaPerPersonM2: 8.0,
		sensibleHeatPerPersonW: 70,
		latentHeatPerPersonW: 50,
		equipmentLoadDensityWm2: 8.0,
		lightingPowerDensityWm2: 6.0,
		metabolicRateMet: 1.2,
		clothingInsulationClo: 0.5,
		ventilationAchExpectation: 2.0,
		thermalComfortMethodEligibility: 'both'
	}
};

export function getRoomUsageProfile(fn?: RoomFunction | string | null): RoomUsageProfile {
	if (fn && fn in ROOM_USAGE_PROFILES) {
		return ROOM_USAGE_PROFILES[fn as RoomFunction];
	}
	return ROOM_USAGE_PROFILES.unassigned;
}
