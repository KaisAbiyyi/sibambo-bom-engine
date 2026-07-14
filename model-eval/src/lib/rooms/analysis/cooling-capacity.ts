/**
 * cooling-capacity.ts
 *
 * Transparent room cooling-load estimation and AC capacity sizing.
 * Separates envelope conductive, glazing conductive, solar glazing,
 * occupant sensible/latent, lighting, equipment, and ventilation/infiltration loads.
 * Outputs recommendations in W, kW, BTU/h, and nominal PK.
 */

import type {
	RoomAnalysisInput,
	RoomAnalysisConfiguration,
	CoolingCapacityResult,
	CoolingLoadBreakdown,
	AnalysisValue
} from './types';

export function calculateCoolingCapacity(
	input: RoomAnalysisInput,
	config: RoomAnalysisConfiguration
): CoolingCapacityResult {
	const missingInputs: string[] = [];
	const assumptions: string[] = [];

	const deltaT = Math.max(0, input.assumptions.outdoorDesignTempC - input.assumptions.indoorDesignTempC);
	assumptions.push(`Design ΔT: ${deltaT.toFixed(1)} °C (${input.assumptions.indoorDesignTempC} °C indoor, ${input.assumptions.outdoorDesignTempC} °C outdoor)`);
	assumptions.push(`Safety margin: ${(config.acSafetyMargin * 100).toFixed(0)}%`);

	// 1. Envelope Conductive Load
	let envelopeConductive = 0;
	for (const surf of input.envelopeSurfaces) {
		const uVal = surf.uValue.value || config.defaultWallUValue;
		if (surf.role === 'exterior_wall') {
			const cltd = deltaT + 6.0; // equivalent solar sol-air allowance for masonry
			envelopeConductive += surf.area * uVal * cltd;
		} else if (surf.role === 'ceiling' || surf.role === 'roof') {
			const cltd = deltaT + 12.0;
			envelopeConductive += surf.area * uVal * cltd;
		} else if (surf.role === 'interior_wall' || surf.role === 'floor') {
			const cltd = Math.max(0, deltaT - 3.0);
			envelopeConductive += surf.area * uVal * cltd;
		}
	}

	// 2. Glazing Conductive & Solar Load
	let glazingConductive = 0;
	let solarGlazing = 0;
	const extWindows = input.openings.filter((o) => o.isExterior && o.type === 'window');
	for (const win of extWindows) {
		glazingConductive += win.area * config.defaultGlazingUValue * deltaT;
		const shgfPeak = 350.0; // W/m² peak solar heat gain factor
		solarGlazing += win.area * config.defaultShadingCoefficient * config.defaultSolarFactor * shgfPeak;
	}

	// 3. Occupant Sensible & Latent Load
	const occupants = input.assumptions.occupantCount.value || 1;
	const occupantSensible = occupants * input.assumptions.usageProfile.sensibleHeatPerPersonW;
	const occupantLatent = occupants * input.assumptions.usageProfile.latentHeatPerPersonW;

	// 4. Lighting & Equipment Load
	const lighting = input.geometry.floorArea * input.assumptions.usageProfile.lightingPowerDensityWm2 * 1.2;
	let equipment = input.geometry.floorArea * input.assumptions.usageProfile.equipmentLoadDensityWm2;
	for (const comp of input.components) {
		if (comp.assumedLoadW) {
			equipment += comp.assumedLoadW * comp.count;
		}
	}

	// 5. Ventilation / Infiltration Load
	// Fresh air requirement (ASHRAE 62.1 approx: 8 L/s/person + 0.3 L/s/m²)
	const qFreshAirM3s = occupants * 0.008 + input.geometry.floorArea * 0.0003;
	const ventSensible = 1.2 * 1000.0 * qFreshAirM3s * deltaT;
	const rhDiff = Math.max(0, config.relativeHumidityPercent - 50.0);
	const ventLatent = 1.2 * 2500.0 * qFreshAirM3s * (rhDiff * 0.00015);

	const totalSensible = Math.round((envelopeConductive + glazingConductive + solarGlazing + occupantSensible + lighting + equipment + ventSensible) * 10) / 10;
	const totalLatent = Math.round((occupantLatent + ventLatent) * 10) / 10;
	const totalCoolingLoad = Math.round((totalSensible + totalLatent) * 10) / 10;

	const factor = 1.0 + config.acSafetyMargin;
	const recommendedW = Math.round(totalCoolingLoad * factor);
	const recommendedKw = Math.round((recommendedW / 1000.0) * 100) / 100;
	const recommendedBtuh = Math.round(recommendedW * 3.412142);
	const recommendedPk = Math.round((recommendedBtuh / 9000.0) * 10) / 10;

	const breakdown: CoolingLoadBreakdown = {
		envelopeConductiveW: { value: Math.round(envelopeConductive), state: 'calculated', source: ['model', 'user_config'], confidence: 0.8, diagnostics: [] },
		glazingConductiveW: { value: Math.round(glazingConductive), state: 'calculated', source: ['model', 'user_config'], confidence: 0.8, diagnostics: [] },
		solarGlazingW: { value: Math.round(solarGlazing), state: 'calculated', source: ['model', 'user_config'], confidence: 0.8, diagnostics: [] },
		occupantSensibleW: { value: Math.round(occupantSensible), state: 'calculated', source: ['standard_profile'], confidence: 0.8, diagnostics: [] },
		occupantLatentW: { value: Math.round(occupantLatent), state: 'calculated', source: ['standard_profile'], confidence: 0.8, diagnostics: [] },
		lightingW: { value: Math.round(lighting), state: 'calculated', source: ['standard_profile'], confidence: 0.85, diagnostics: [] },
		equipmentW: { value: Math.round(equipment), state: 'calculated', source: ['standard_profile'], confidence: 0.8, diagnostics: [] },
		ventilationInfiltrationW: { value: Math.round(ventSensible + ventLatent), state: 'calculated', source: ['standard_profile', 'user_config'], confidence: 0.75, diagnostics: [] }
	};

	return {
		methodIdentifier: 'simplified_peak_load_component_summation',
		breakdown,
		totalSensibleW: { value: totalSensible, state: 'calculated', source: ['model', 'standard_profile'], confidence: 0.8, diagnostics: [] },
		totalLatentW: { value: totalLatent, state: 'calculated', source: ['model', 'standard_profile'], confidence: 0.8, diagnostics: [] },
		totalCoolingLoadW: { value: totalCoolingLoad, state: 'calculated', source: ['model', 'standard_profile'], confidence: 0.8, diagnostics: [] },
		recommendedCapacityW: { value: recommendedW, state: 'calculated', source: ['model', 'standard_profile', 'user_config'], confidence: 0.85, diagnostics: [] },
		recommendedCapacityKw: { value: recommendedKw, state: 'calculated', source: ['model', 'standard_profile', 'user_config'], confidence: 0.85, diagnostics: [] },
		recommendedCapacityBtuh: { value: recommendedBtuh, state: 'calculated', source: ['model', 'standard_profile', 'user_config'], confidence: 0.85, diagnostics: [] },
		recommendedCapacityPk: { value: recommendedPk, state: 'calculated', source: ['model', 'standard_profile', 'user_config'], confidence: 0.85, diagnostics: [`Nominal PK: ${recommendedPk.toFixed(1)} PK (~9000 BTU/h per PK)`] },
		missingInputs,
		assumptions
	};
}
