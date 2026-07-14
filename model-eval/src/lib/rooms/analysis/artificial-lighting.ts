/**
 * artificial-lighting.ts
 *
 * Artificial lighting calculation using the Lumen method:
 * N = E × A / (Φ × CU × LLF)
 * Also generates 3D luminaire grid positions and validates each candidate
 * against the room's concave 2D boundary and interior holes.
 */

import type { PlanCoord } from '../types';
import type {
	RoomAnalysisInput,
	RoomAnalysisConfiguration,
	ArtificialLightingResult,
	LuminairePoint3D
} from './types';

// Standard point-in-polygon ray-casting test for 2D boundary (CCW winding)
function isPointInPolygon(p: { x: number; z: number }, polygon: PlanCoord[]): boolean {
	if (!polygon || polygon.length < 3) return false;
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x, zi = polygon[i].z;
		const xj = polygon[j].x, zj = polygon[j].z;
		const intersect = ((zi > p.z) !== (zj > p.z)) &&
			(p.x < ((xj - xi) * (p.z - zi)) / ((zj - zi) || 0.00001) + xi);
		if (intersect) inside = !inside;
	}
	return inside;
}

export function calculateArtificialLighting(
	input: RoomAnalysisInput,
	config: RoomAnalysisConfiguration,
	requiredLux: number
): ArtificialLightingResult {
	const assumptions: string[] = [];
	const limitations: string[] = [
		'Lumen method provides average horizontal illuminance only',
		'Photometric simulation required for exact UGR (glare), uniformity, and shadow analysis'
	];
	const warnings: string[] = [];

	let cu = config.coefficientOfUtilization;
	let llf = config.lightLossFactor;
	const flux = Math.max(1, config.defaultLuminaireFluxLm);

	if (!Number.isFinite(cu) || cu <= 0 || cu > 1.0) {
		warnings.push(`Invalid CU value (${cu}); restricted to (0, 1.0] range`);
		if (cu <= 0) cu = 0.6;
		if (cu > 1.0) cu = 1.0;
	}
	if (!Number.isFinite(llf) || llf <= 0 || llf > 1.0) {
		warnings.push(`Invalid LLF value (${llf}); restricted to (0, 1.0] range`);
		if (llf <= 0) llf = 0.8;
		if (llf > 1.0) llf = 1.0;
	}
	if (!Number.isFinite(input.geometry.floorArea) || input.geometry.floorArea < 0 || !Number.isFinite(requiredLux) || requiredLux < 0) {
		warnings.push('Non-finite or negative floor area or required lux detected');
	}

	const area = Math.max(0.1, input.geometry.floorArea);

	assumptions.push(`Luminaire flux: ${flux} Lm, CU: ${cu}, LLF: ${llf}`);
	assumptions.push(`Target illuminance: ${requiredLux} Lux`);

	const rawCount = (requiredLux * area) / (flux * cu * llf);
	const roundedCount = Math.max(1, Math.ceil(rawCount));
	const achievedLux = Math.round(((roundedCount * flux * cu * llf) / area) * 10) / 10;

	// Grid planning adhering to aspect ratio
	const minX = input.room.planBounds.min.x;
	const maxX = input.room.planBounds.max.x;
	const minZ = input.room.planBounds.min.z;
	const maxZ = input.room.planBounds.max.z;
	const spanX = Math.max(0.5, maxX - minX);
	const spanZ = Math.max(0.5, maxZ - minZ);

	let cols = Math.max(1, Math.round(Math.sqrt(roundedCount * (spanX / spanZ))));
	let rows = Math.max(1, Math.ceil(roundedCount / cols));

	// If cols * rows < roundedCount, adjust
	while (cols * rows < roundedCount) {
		if (spanX / cols > spanZ / rows) {
			cols++;
		} else {
			rows++;
		}
	}

	const spacingX = Math.round((spanX / cols) * 100) / 100;
	const spacingZ = Math.round((spanZ / rows) * 100) / 100;
	const mountingHeight = input.room.ceilingElevation;
	const workPlaneHeight = input.assumptions.usageProfile.workPlaneHeightM;

	const proposedPositions: LuminairePoint3D[] = [];
	const boundary = input.room.boundary2D;
	const holes = input.room.holes2D || [];

	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const x = minX + (c + 0.5) * spacingX;
			const z = minZ + (r + 0.5) * spacingZ;
			const p = { x, z };

			let valid = isPointInPolygon(p, boundary);
			if (valid && holes.length > 0) {
				for (const hole of holes) {
					// Hole points also raycast
					if (isPointInPolygon(p, hole)) {
						valid = false;
						break;
					}
				}
			}

			proposedPositions.push({
				id: `${input.room.id}_light_${r}_${c}`,
				position: { x, y: mountingHeight - 0.05, z },
				isValidInsidePolygon: valid
			});
		}
	}

	return {
		methodIdentifier: 'lumen_method_average_horizontal_illuminance',
		rawCalculatedCount: {
			value: Math.round(rawCount * 100) / 100,
			state: 'calculated',
			source: ['model', 'user_config', 'standard_profile'],
			confidence: 0.85,
			diagnostics: []
		},
		roundedUpCount: {
			value: roundedCount,
			state: 'calculated',
			source: ['model', 'user_config', 'standard_profile'],
			confidence: 0.85,
			diagnostics: []
		},
		targetLux: requiredLux,
		estimatedAchievedLux: {
			value: achievedLux,
			state: 'calculated',
			source: ['model', 'user_config', 'standard_profile'],
			confidence: 0.85,
			diagnostics: [`Achieved: ${achievedLux} Lux (${((achievedLux / requiredLux) * 100).toFixed(0)}% of target)`]
		},
		luminousFluxLm: flux,
		coefficientOfUtilization: cu,
		lightLossFactor: llf,
		proposedGrid: {
			rows,
			columns: cols,
			spacingXM: spacingX,
			spacingZM: spacingZ
		},
		mountingHeightM: mountingHeight,
		workPlaneHeightM: workPlaneHeight,
		proposedPositions,
		assumptions,
		limitations,
		trace: {
			method: 'Lumen Method (Average Horizontal Illuminance)',
			formula: 'N = (E * A) / (Phi * CU * LLF); E_achieved = (N_rounded * Phi * CU * LLF) / A',
			inputs: [
				{ name: 'Target Illuminance E', value: requiredLux, unit: 'lux' },
				{ name: 'Floor Area A', value: input.geometry.floorArea, unit: 'm²' },
				{ name: 'Luminaire Flux Phi', value: flux, unit: 'lumen' },
				{ name: 'Coefficient of Utilization CU', value: cu, unit: 'ratio (0-1)' },
				{ name: 'Light Loss Factor LLF', value: llf, unit: 'ratio (0-1)' }
			],
			intermediateValues: [
				{ name: 'Raw Luminaire Count', value: Math.round(rawCount * 100) / 100, unit: 'count' },
				{ name: 'Proposed Grid Columns', value: cols, unit: 'count' },
				{ name: 'Proposed Grid Rows', value: rows, unit: 'count' },
				{ name: 'Luminaire Spacing X', value: spacingX, unit: 'm' },
				{ name: 'Luminaire Spacing Z', value: spacingZ, unit: 'm' }
			],
			assumptions,
			finalResult: { value: `${roundedCount} luminaires (${achievedLux} lux achieved)`, unit: 'count / lux' },
			confidence: 0.85,
			warnings
		}
	};
}
