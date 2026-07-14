/**
 * ottv.ts
 *
 * Façade and Building Level Overall Thermal Transfer Value (OTTV) calculation.
 * Groups exterior envelope surfaces and fenestration by orientation group
 * and evaluates:
 * OTTV = α × Uw × (1 - WWR) × TDEK + Uf × WWR × ΔT + SC × WWR × SF
 */

import type {
	RoomAnalysisInput,
	RoomAnalysisConfiguration,
	BuildingOttvResult,
	FacadeOrientationGroup
} from './types';

type OrientationName = FacadeOrientationGroup['orientationName'];

function classifyOrientation(
	azimuthDeg: number,
	projectNorthDeg: number | null
): OrientationName {
	let angle = azimuthDeg;
	if (projectNorthDeg !== null) {
		angle = (azimuthDeg - projectNorthDeg + 360) % 360;
	}
	// 8-way compass grouping
	if (angle >= 337.5 || angle < 22.5) return 'North';
	if (angle >= 22.5 && angle < 67.5) return 'Northeast';
	if (angle >= 67.5 && angle < 112.5) return 'East';
	if (angle >= 112.5 && angle < 157.5) return 'Southeast';
	if (angle >= 157.5 && angle < 202.5) return 'South';
	if (angle >= 202.5 && angle < 247.5) return 'Southwest';
	if (angle >= 247.5 && angle < 292.5) return 'West';
	return 'Northwest';
}

function getSolarFactorForOrientation(orient: OrientationName): number {
	// Tropical solar factors (W/m²) per SNI 6389 / CIBSE
	switch (orient) {
		case 'North': return 130;
		case 'Northeast': return 113;
		case 'East': return 243;
		case 'Southeast': return 176;
		case 'South': return 130;
		case 'Southwest': return 176;
		case 'West': return 243;
		case 'Northwest': return 113;
		case 'Horizontal/Roof': return 320;
	}
}

export function calculateBuildingOttv(
	inputs: RoomAnalysisInput[],
	config: RoomAnalysisConfiguration
): BuildingOttvResult {
	const missingInputs: string[] = [];
	const assumptions: string[] = [];
	const diagnostics: string[] = [];

	if (config.projectNorthDeg === null) {
		diagnostics.push('Project North is unresolved; orientation grouping defaults to model world coordinates (0° = +Z)');
	} else {
		assumptions.push(`Project North adjustment: ${config.projectNorthDeg}°`);
	}

	const deltaT = Math.max(0, config.outdoorDesignTempC - config.indoorDesignTempC);
	const tdek = 15.0; // Equivalent temperature difference for masonry/concrete walls (SNI 6389)
	assumptions.push(`Equivalent temperature difference TDEK = ${tdek} K, Design ΔT = ${deltaT.toFixed(1)} K`);

	// Accumulate wall and window areas per orientation group
	const groupMap = new Map<OrientationName, {
		totalGrossWallArea: number;
		totalWindowArea: number;
		sumWallUArea: number;
		sumWindowUArea: number;
		sumScArea: number;
		sumAlphaArea: number;
		roomIds: Set<string>;
	}>();

	const allOrients: OrientationName[] = ['North', 'East', 'South', 'West', 'Northeast', 'Southeast', 'Southwest', 'Northwest'];
	for (const o of allOrients) {
		groupMap.set(o, {
			totalGrossWallArea: 0,
			totalWindowArea: 0,
			sumWallUArea: 0,
			sumWindowUArea: 0,
			sumScArea: 0,
			sumAlphaArea: 0,
			roomIds: new Set()
		});
	}

	for (const inp of inputs) {
		// Only consider exterior walls
		for (const surf of inp.envelopeSurfaces) {
			if (surf.role === 'exterior_wall') {
				const orient = classifyOrientation(surf.orientationDeg || 0, config.projectNorthDeg);
				const grp = groupMap.get(orient)!;
				const uVal = surf.uValue.value || config.defaultWallUValue;
				const alpha = surf.solarAbsorptance.value || config.defaultSolarAbsorptance;

				grp.totalGrossWallArea += surf.area;
				grp.sumWallUArea += surf.area * uVal;
				grp.sumAlphaArea += surf.area * alpha;
				grp.roomIds.add(inp.room.id);
			}
		}

		// Exterior windows associated with this room
		const extWindows = inp.openings.filter((o) => o.isExterior && o.type === 'window');
		for (const win of extWindows) {
			const orient = classifyOrientation(win.orientationDeg || 0, config.projectNorthDeg);
			const grp = groupMap.get(orient)!;
			const uGlazing = config.defaultGlazingUValue;
			const sc = config.defaultShadingCoefficient;

			grp.totalWindowArea += win.area;
			grp.sumWindowUArea += win.area * uGlazing;
			grp.sumScArea += win.area * sc;
			grp.roomIds.add(inp.room.id);
		}
	}

	const facades: FacadeOrientationGroup[] = [];
	let totalFacadeArea = 0;
	let sumOttvArea = 0;
	let totalExteriorOpaqueAreaM2 = 0;
	let totalExteriorGlazingAreaM2 = 0;
	const warnings: string[] = [];

	for (const [orientName, grp] of groupMap.entries()) {
		// Subtract window area from gross wall area to ensure no double-counting
		const opaqueArea = Math.max(0, grp.totalGrossWallArea - grp.totalWindowArea);
		const glazingArea = grp.totalWindowArea;
		const facadeGrossArea = opaqueArea + glazingArea;

		if (facadeGrossArea < 0.1) continue; // Skip orientation if no exterior envelope present

		let wwr = grp.totalGrossWallArea > 0 ? glazingArea / grp.totalGrossWallArea : (glazingArea > 0 ? 1.0 : 0);
		if (!Number.isFinite(wwr) || wwr < 0 || wwr > 1.0) {
			warnings.push(`WWR out of bounds on ${orientName} façade (${wwr.toFixed(2)}); clamped to [0, 1]`);
			wwr = Math.max(0, Math.min(1.0, wwr));
		}

		const areaWeightedWallU = opaqueArea > 0 ? grp.sumWallUArea / grp.totalGrossWallArea : config.defaultWallUValue;
		const areaWeightedAlpha = opaqueArea > 0 ? grp.sumAlphaArea / grp.totalGrossWallArea : config.defaultSolarAbsorptance;
		const areaWeightedGlazingU = glazingArea > 0 ? grp.sumWindowUArea / glazingArea : config.defaultGlazingUValue;
		const areaWeightedSc = glazingArea > 0 ? grp.sumScArea / glazingArea : config.defaultShadingCoefficient;
		const sf = getSolarFactorForOrientation(orientName);

		if (!Number.isFinite(areaWeightedWallU) || !Number.isFinite(areaWeightedAlpha) || !Number.isFinite(areaWeightedGlazingU) || !Number.isFinite(areaWeightedSc)) {
			warnings.push(`Non-finite thermal properties on ${orientName} façade`);
		}

		// OTTV Formula terms
		const opaqueConduction = areaWeightedAlpha * areaWeightedWallU * (1.0 - wwr) * tdek;
		const glazingConduction = areaWeightedGlazingU * wwr * deltaT;
		const solarFenestration = areaWeightedSc * wwr * sf;
		const facadeOttv = Math.round((opaqueConduction + glazingConduction + solarFenestration) * 10) / 10;

		totalFacadeArea += facadeGrossArea;
		sumOttvArea += facadeOttv * facadeGrossArea;
		totalExteriorOpaqueAreaM2 += opaqueArea;
		totalExteriorGlazingAreaM2 += glazingArea;

		let azimuth = 0;
		switch (orientName) {
			case 'North': azimuth = 0; break;
			case 'Northeast': azimuth = 45; break;
			case 'East': azimuth = 90; break;
			case 'Southeast': azimuth = 135; break;
			case 'South': azimuth = 180; break;
			case 'Southwest': azimuth = 225; break;
			case 'West': azimuth = 270; break;
			case 'Northwest': azimuth = 315; break;
		}

		facades.push({
			orientationName: orientName,
			azimuthDeg: azimuth,
			totalOpaqueAreaM2: Math.round(opaqueArea * 100) / 100,
			totalGlazingAreaM2: Math.round(glazingArea * 100) / 100,
			wwr: Math.round(wwr * 1000) / 1000,
			areaWeightedWallUValue: Math.round(areaWeightedWallU * 100) / 100,
			areaWeightedGlazingUValue: Math.round(areaWeightedGlazingU * 100) / 100,
			areaWeightedSolarFactor: sf,
			areaWeightedShadingCoefficient: Math.round(areaWeightedSc * 100) / 100,
			areaWeightedSolarAbsorptance: Math.round(areaWeightedAlpha * 100) / 100,
			opaqueConductionContributionWm2: Math.round(opaqueConduction * 10) / 10,
			glazingConductionContributionWm2: Math.round(glazingConduction * 10) / 10,
			solarFenestrationContributionWm2: Math.round(solarFenestration * 10) / 10,
			facadeOttvWm2: facadeOttv,
			adjacentRoomIds: Array.from(grp.roomIds),
			trace: {
				method: `Façade OTTV (${orientName})`,
				formula: 'OTTV_facade = alpha * U_w * (1 - WWR) * TDEK + U_f * WWR * deltaT + SC * WWR * SF',
				inputs: [
					{ name: 'Opaque Area', value: Math.round(opaqueArea * 100) / 100, unit: 'm²' },
					{ name: 'Glazing Area', value: Math.round(glazingArea * 100) / 100, unit: 'm²' },
					{ name: 'WWR', value: Math.round(wwr * 1000) / 1000, unit: 'ratio (0-1)' },
					{ name: 'Wall U-Value', value: Math.round(areaWeightedWallU * 100) / 100, unit: 'W/m²·K' },
					{ name: 'Glazing U-Value', value: Math.round(areaWeightedGlazingU * 100) / 100, unit: 'W/m²·K' },
					{ name: 'Solar Factor SF', value: sf, unit: 'W/m²' }
				],
				intermediateValues: [
					{ name: 'Opaque Conduction Contribution', value: Math.round(opaqueConduction * 10) / 10, unit: 'W/m²' },
					{ name: 'Glazing Conduction Contribution', value: Math.round(glazingConduction * 10) / 10, unit: 'W/m²' },
					{ name: 'Solar Fenestration Contribution', value: Math.round(solarFenestration * 10) / 10, unit: 'W/m²' }
				],
				assumptions,
				finalResult: { value: facadeOttv, unit: 'W/m²' },
				confidence: 0.85,
				warnings
			}
		});
	}

	const buildingOttv = totalFacadeArea > 0 ? Math.round((sumOttvArea / totalFacadeArea) * 10) / 10 : 0;
	const isCompliant = buildingOttv <= config.ottvThresholdWm2;
	let overallWwr = totalFacadeArea > 0 ? Math.round((totalExteriorGlazingAreaM2 / totalFacadeArea) * 1000) / 1000 : 0;
	if (overallWwr < 0 || overallWwr > 1.0) {
		warnings.push(`Overall building WWR clamped to [0, 1] range (${overallWwr})`);
		overallWwr = Math.max(0, Math.min(1.0, overallWwr));
	}

	return {
		facades,
		buildingOttvWm2: {
			value: buildingOttv,
			state: totalFacadeArea > 0 ? 'calculated' : 'insufficient_data',
			source: ['model', 'user_config', 'standard_profile'],
			confidence: totalFacadeArea > 0 ? 0.85 : 0.2,
			diagnostics: [`Area-weighted across ${facades.length} exterior façades`]
		},
		thresholdWm2: config.ottvThresholdWm2,
		isCompliant: {
			value: isCompliant,
			state: totalFacadeArea > 0 ? 'calculated' : 'insufficient_data',
			source: ['user_config'],
			confidence: 0.9,
			diagnostics: [`Threshold: ${config.ottvThresholdWm2} W/m² (${isCompliant ? 'COMPLIANT' : 'EXCEEDS THRESHOLD'})`]
		},
		totalExteriorOpaqueAreaM2: Math.round(totalExteriorOpaqueAreaM2 * 100) / 100,
		totalExteriorGlazingAreaM2: Math.round(totalExteriorGlazingAreaM2 * 100) / 100,
		overallWwr,
		missingInputs,
		assumptions,
		diagnostics,
		trace: {
			method: 'Façade-Area Weighted Building OTTV (SNI 6389 / CIBSE)',
			formula: 'BuildingOTTV = sum(OTTV_facade_i * A_facade_i) / sum(A_facade_i)',
			inputs: [
				{ name: 'Total Exterior Façade Area', value: Math.round(totalFacadeArea * 100) / 100, unit: 'm²' },
				{ name: 'Total Opaque Wall Area', value: Math.round(totalExteriorOpaqueAreaM2 * 100) / 100, unit: 'm²' },
				{ name: 'Total Exterior Glazing Area', value: Math.round(totalExteriorGlazingAreaM2 * 100) / 100, unit: 'm²' },
				{ name: 'Overall WWR', value: overallWwr, unit: 'ratio (0-1)' },
				{ name: 'OTTV Threshold', value: config.ottvThresholdWm2, unit: 'W/m²' }
			],
			intermediateValues: facades.map((f) => ({
				name: `Façade Contribution (${f.orientationName}, ${f.totalOpaqueAreaM2 + f.totalGlazingAreaM2} m²)`,
				value: f.facadeOttvWm2,
				unit: 'W/m²'
			})),
			assumptions,
			finalResult: { value: buildingOttv, unit: 'W/m²' },
			confidence: totalFacadeArea > 0 ? 0.85 : 0.2,
			warnings
		}
	};
}
