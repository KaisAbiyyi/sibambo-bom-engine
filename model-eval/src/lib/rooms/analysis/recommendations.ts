import type { DetectedRoom } from '../detected-room';
import type { RoomTopologyGraph } from '../topology';
import type { RoomSemanticInference } from '../semantics';
import type { BuildingAnalysisResult, RoomAnalysisResult } from './types';
import type { DesignScenarioOverrides, DesignScenario } from './scenarios';
import type { RoomAnalysisConfiguration } from './types';
import { runScenarioAnalysis, compareScenarios } from './scenarios';

export type RecommendationCategory =
	| 'envelope insulation'
	| 'glazing performance'
	| 'solar shading'
	| 'natural ventilation'
	| 'AC capacity'
	| 'lighting quantity'
	| 'circulation/access'
	| 'missing project data';

export type RecommendationSeverity = 'critical' | 'warning' | 'info';

export type BuildingDesignRecommendation = {
	id: string;
	scope: 'building' | 'room';
	roomIds: string[];
	category: RecommendationCategory;
	severity: RecommendationSeverity;
	title: string;
	explanation: string;
	evidence: string[];
	suggestedOverrides: DesignScenarioOverrides;
	estimatedImpact: Record<string, any>;
	confidence: number;
	assumptions: string[];
	limitations: string[];
};

export function generateRecommendations(
	rooms: DetectedRoom[],
	topology: RoomTopologyGraph,
	semantics: RoomSemanticInference[],
	analysis: BuildingAnalysisResult,
	config: RoomAnalysisConfiguration
): BuildingDesignRecommendation[] {
	const rawRecommendations: BuildingDesignRecommendation[] = [];
	let idCounter = 1;
	const createRec = (partial: Omit<BuildingDesignRecommendation, 'id' | 'estimatedImpact'>) => {
		rawRecommendations.push({
			...partial,
			id: `REC-${idCounter++}`,
			estimatedImpact: {}
		});
	};

	// 1. Check building-level diagnostics and OTTV
	if (analysis.diagnostics.length > 0) {
		for (const diag of analysis.diagnostics) {
			if (diag.message.toLowerCase().includes('missing project data') || diag.message.toLowerCase().includes('project north')) {
				createRec({
					scope: 'building',
					roomIds: [],
					category: 'missing project data',
					severity: 'critical',
					title: 'Missing Project North',
					explanation: 'Project north orientation is required to accurately calculate solar loads and natural ventilation direction.',
					evidence: [diag.message],
					suggestedOverrides: { projectNorthDeg: 0 }, // Just a placeholder
					confidence: 1.0,
					assumptions: ['North is assumed to be 0 degrees until specified.'],
					limitations: ['Solar analysis is invalid without north orientation.']
				});
			}
		}
	}

	if (analysis.ottv && analysis.ottv.buildingOttvWm2.state === 'calculated') {
		const ottvValue = analysis.ottv.buildingOttvWm2.value || 0;
		if (ottvValue > config.ottvThresholdWm2) {
			createRec({
				scope: 'building',
				roomIds: [],
				category: 'envelope insulation',
				severity: 'warning',
				title: 'High Overall Thermal Transfer Value (OTTV)',
				explanation: `The building OTTV of ${ottvValue.toFixed(1)} W/m² exceeds the recommended threshold of ${config.ottvThresholdWm2} W/m². Consider improving wall insulation or reducing window-to-wall ratio.`,
				evidence: [`OTTV: ${ottvValue.toFixed(1)} W/m² > ${config.ottvThresholdWm2} W/m²`],
				suggestedOverrides: { wallUValueMultiplier: 0.8 },
				confidence: 0.9,
				assumptions: ['Reduced U-value applies to all exterior walls homogeneously.'],
				limitations: ['Actual impact depends on specific wall construction chosen.']
			});
			createRec({
				scope: 'building',
				roomIds: [],
				category: 'solar shading',
				severity: 'warning',
				title: 'High Solar Heat Gain',
				explanation: `To reduce the high OTTV (${ottvValue.toFixed(1)} W/m²), consider applying shading devices to reduce shading coefficient.`,
				evidence: [`OTTV: ${ottvValue.toFixed(1)} W/m²`],
				suggestedOverrides: { shadingCoefficientMultiplier: 0.7 },
				confidence: 0.8,
				assumptions: ['Shading devices applied to all exposed windows.'],
				limitations: ['May reduce natural daylighting.']
			});
		}
	}

	// 2. Room-level checks
	for (const roomResult of analysis.rooms) {
		const rid = roomResult.roomId;

		// Missing Data
		if (roomResult.dataQuality === 'insufficient') {
			createRec({
				scope: 'room',
				roomIds: [rid],
				category: 'missing project data',
				severity: 'critical',
				title: 'Insufficient Geometry Data',
				explanation: 'This room lacks complete geometry, preventing reliable analysis.',
				evidence: ['Room data quality marked as insufficient.'],
				suggestedOverrides: {},
				confidence: 1.0,
				assumptions: [],
				limitations: []
			});
		}

		// Human Flow / Inaccessible
		if (roomResult.humanFlow.accessibilityStatus === 'isolated' || roomResult.humanFlow.accessibilityStatus === 'unreachable') {
			createRec({
				scope: 'room',
				roomIds: [rid],
				category: 'circulation/access',
				severity: 'warning',
				title: 'Inaccessible Room',
				explanation: 'This room has no detected doors or circulation path from the exterior.',
				evidence: [`Accessibility status: ${roomResult.humanFlow.accessibilityStatus}`],
				suggestedOverrides: {},
				confidence: 0.95,
				assumptions: [],
				limitations: ['Opening detection may have missed sliding doors or open arches.']
			});
		}

		// Ventilation
		if (roomResult.naturalVentilation.estimatedAch.state === 'calculated') {
			const ach = roomResult.naturalVentilation.estimatedAch.value || 0;
			if (ach < 2.0 && ach > 0) { // e.g. poor ventilation
				createRec({
					scope: 'room',
					roomIds: [rid],
					category: 'natural ventilation',
					severity: 'warning',
					title: 'Poor Natural Ventilation',
					explanation: `The calculated air changes per hour (ACH) is ${ach.toFixed(1)}, which is low for natural ventilation. Consider larger openings or cross ventilation.`,
					evidence: [`ACH: ${ach.toFixed(1)}`],
					suggestedOverrides: { windowAreaMultiplier: 1.5 },
					confidence: 0.8,
					assumptions: ['Windows can be enlarged.'],
					limitations: ['May increase thermal load and OTTV.']
				});
			} else if (ach === 0 && roomResult.naturalVentilation.type === 'no_exterior_ventilation') {
				createRec({
					scope: 'room',
					roomIds: [rid],
					category: 'natural ventilation',
					severity: 'warning',
					title: 'No Natural Ventilation',
					explanation: 'Room has no exterior openings for ventilation.',
					evidence: ['Ventilation type: none'],
					suggestedOverrides: { windowAreaMultiplier: 1.5 },
					confidence: 0.85,
					assumptions: ['Exterior walls exist.'],
					limitations: ['Requires exterior exposure.']
				});
			}
		}

		// Cooling capacity
		if (roomResult.coolingCapacity.recommendedCapacityKw.state === 'calculated') {
			const reqKw = (roomResult.coolingCapacity.totalCoolingLoadW.value || 0) / 1000;
			if (reqKw > 10.0) { // arbitrary threshold for warning
				createRec({
					scope: 'room',
					roomIds: [rid],
					category: 'AC capacity',
					severity: 'warning',
					title: 'High Cooling Load',
					explanation: `This room requires ${reqKw.toFixed(1)} kW of cooling, which is substantial. Consider reducing solar heat gain to lower AC capacity requirements.`,
					evidence: [`Cooling load: ${reqKw.toFixed(1)} kW`],
					suggestedOverrides: { solarFactorMultiplier: 0.6 },
					confidence: 0.8,
					assumptions: ['Glazing is a significant contributor to cooling load.'],
					limitations: []
				});
			}
		}

		// Lighting
		if (roomResult.artificialLighting.roundedUpCount.state === 'calculated') {
			const count = roomResult.artificialLighting.roundedUpCount.value || 0;
			const reqLux = roomResult.illuminanceRequirement.targetLux.value || 0;
			if (count > 20) { // High fixture count
				createRec({
					scope: 'room',
					roomIds: [rid],
					category: 'lighting quantity',
					severity: 'info',
					title: 'High Fixture Count',
					explanation: `Achieving the target ${reqLux} lux requires ${count} standard fixtures. Consider using higher flux luminaires.`,
					evidence: [`Fixtures: ${count}`, `Target lux: ${reqLux}`],
					suggestedOverrides: {}, // In a real scenario, we might override defaultLuminaireFluxLm
					confidence: 0.9,
					assumptions: ['Standard luminaire flux is used.'],
					limitations: []
				});
			}
		}
	}

	// 3. Merge duplicate recommendations
	const merged = mergeAndRankRecommendations(rawRecommendations);

	// 4. Estimate impacts
	const baselineScenario: DesignScenario = {
		id: 'baseline',
		name: 'Baseline',
		description: 'Base model',
		isBaseline: true,
		overrides: {}
	};
	for (const rec of merged) {
		if (Object.keys(rec.suggestedOverrides).length > 0) {
			const proposedScenario: DesignScenario = {
				id: 'proposed_' + rec.id,
				name: 'Proposed ' + rec.title,
				description: 'Overrides applied',
				isBaseline: false,
				overrides: rec.suggestedOverrides
			};
			const proposedResult = runScenarioAnalysis(proposedScenario, rooms, topology, semantics, config);
			const comparison = compareScenarios(analysis, proposedResult);
			
			rec.estimatedImpact = {
				buildingOttvDelta: comparison.ottvDelta.buildingOttvWm2Delta.absoluteDifference,
				buildingCoolingKwDelta: comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityKwDelta.absoluteDifference
			};

			if (rec.scope === 'room' && rec.roomIds.length > 0) {
				const roomDiff = comparison.rooms.find(r => r.roomId === rec.roomIds[0]);
				if (roomDiff) {
					rec.estimatedImpact.roomAchDelta = roomDiff.airflowAchDelta?.absoluteDifference;
					rec.estimatedImpact.roomCoolingKwDelta = roomDiff.coolingCapacityWDelta?.absoluteDifference !== undefined ? (roomDiff.coolingCapacityWDelta.absoluteDifference / 1000) : undefined;
				}
			}
		}
	}

	return merged;
}

export function mergeAndRankRecommendations(recs: BuildingDesignRecommendation[]): BuildingDesignRecommendation[] {
	// Group by category, title, and overrides signature
	const groups = new Map<string, BuildingDesignRecommendation>();

	for (const rec of recs) {
		const signature = `${rec.category}|${rec.title}|${JSON.stringify(rec.suggestedOverrides)}`;
		if (groups.has(signature)) {
			const existing = groups.get(signature)!;
			// Merge roomIds
			for (const rId of rec.roomIds) {
				if (!existing.roomIds.includes(rId)) {
					existing.roomIds.push(rId);
				}
			}
			// Scope becomes building if affected rooms > 5 (arbitrary heuristic) or kept as room
			if (existing.roomIds.length > 5) {
				existing.scope = 'building';
			}
		} else {
			groups.set(signature, { ...rec, roomIds: [...rec.roomIds] });
		}
	}

	const merged = Array.from(groups.values());

	// Deterministic ranking
	// severity (critical > warning > info) > confidence > affected rooms count > title alphabetical
	const severityScore = { critical: 3, warning: 2, info: 1 };
	merged.sort((a, b) => {
		if (severityScore[a.severity] !== severityScore[b.severity]) {
			return severityScore[b.severity] - severityScore[a.severity];
		}
		if (a.confidence !== b.confidence) {
			return b.confidence - a.confidence;
		}
		if (a.roomIds.length !== b.roomIds.length) {
			return b.roomIds.length - a.roomIds.length;
		}
		return a.title.localeCompare(b.title);
	});

	// Re-assign IDs deterministically after merging
	merged.forEach((rec, idx) => {
		rec.id = `REC-${idx + 1}`;
	});

	// Conflict detection: 
	// e.g., if one rec increases window area and another decreases it or adds shading
	for (const rec of merged) {
		// naive conflict marking logic
		// if a recommendation increases window area but OTTV is a critical issue
		if (rec.suggestedOverrides.windowAreaMultiplier && rec.suggestedOverrides.windowAreaMultiplier > 1.0) {
			const ottvRec = merged.find(r => r.category === 'envelope insulation' && r.severity === 'warning');
			if (ottvRec) {
				rec.limitations.push(`Conflicts with: ${ottvRec.title} (Increasing window area may worsen OTTV).`);
			}
		}
	}

	return merged;
}
