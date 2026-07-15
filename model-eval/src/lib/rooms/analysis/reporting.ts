/**
 * reporting.ts
 *
 * Export and report generation module for Task 3E: Design-Scenario Comparison.
 * Produces structured JSON bundles preserving calculation traces/units and
 * clean, printable HTML reports highlighting baseline vs. proposed improvements.
 */

import type { BuildingAnalysisResult } from './types';
import type { BuildingComparisonResult, DesignScenario } from './scenarios';

export type ExportedScenarioAnalysisJson = {
	schemaVersion: '3.0.0-scenario-eval';
	exportedAt: string;
	projectSummary: {
		projectName: string;
		totalRooms: number;
		analyzedRooms: number;
		totalGrossFloorAreaM2: number;
	};
	scenarios: {
		baseline: {
			id: string;
			name: string;
			description: string;
			assumptions: Record<string, any>;
		};
		proposed: {
			id: string;
			name: string;
			description: string;
			assumptions: Record<string, any>;
			overrides: Record<string, any>;
		};
	};
	comparisonSummary: {
		floorAreaDelta: any;
		coolingCapacityKwDelta: any;
		coolingCapacityPkDelta: any;
		luminairesDelta: any;
		thermalComplianceRateDelta: any;
		buildingOttvDelta: any;
	};
	roomComparisonTable: Array<{
		roomId: string;
		storeyId: string;
		status: string;
		thermalStatus: { baseline?: string; proposed?: string; changeStatus: string };
		operativeTempDelta: any;
		pmvDelta: any;
		airflowAchDelta: any;
		coolingPkDelta: any;
		targetLuxDelta: any;
		luminaireCountDelta: any;
		humanFlowScoreDelta: any;
	}>;
	facadeOttvComparison: Array<{
		orientationName: string;
		facadeOttvWm2Delta: any;
		wwrDelta: any;
	}>;
	detailedResults: {
		baseline: BuildingAnalysisResult;
		proposed: BuildingAnalysisResult;
	};
	warningsAndDiagnostics: {
		baselineDiagnostics: any[];
		proposedDiagnostics: any[];
		comparisonDiagnostics: string[];
	};
	knownLimitations: string[];
};

export const KNOWN_METHOD_LIMITATIONS = [
	'First-order opening balance does not account for complex multi-zone CFD stack effects or wind turbulence around surrounding urban obstructions.',
	'Lumen method assumes uniform rectangular grid layouts without local task lighting geometry or non-uniform furniture shading.',
	'OTTV calculation uses area-weighted U-values, solar factors, and shading coefficients without hourly dynamic thermal mass simulation (e.g. EnergyPlus / RTS).',
	'Topological human-flow scoring evaluates graph connectivity and door traversal degrees without dynamic crowd evacuation or bottleneck simulation.',
	'Peak cooling load estimation applies steady-state component summation and AC sizing margins without part-load efficiency curves or dehumidification psychrometric trajectories.'
];

/**
 * Generates a full JSON export bundle containing comparison results, complete calculation traces, and explicit physical units.
 */
export function exportScenarioAnalysisReportJson(
	comparison: BuildingComparisonResult,
	baselineResult: BuildingAnalysisResult,
	proposedResult: BuildingAnalysisResult,
	baselineScenario: DesignScenario,
	proposedScenario: DesignScenario,
	projectName = 'SIBAMBO Building Evaluation'
): ExportedScenarioAnalysisJson {
	return {
		schemaVersion: '3.0.0-scenario-eval',
		exportedAt: new Date().toISOString(),
		projectSummary: {
			projectName,
			totalRooms: baselineResult.summary.totalRooms,
			analyzedRooms: baselineResult.summary.analyzedRooms,
			totalGrossFloorAreaM2: baselineResult.summary.totalGrossFloorAreaM2
		},
		scenarios: {
			baseline: {
				id: baselineScenario.id,
				name: baselineScenario.name,
				description: baselineScenario.description,
				assumptions: { ...baselineResult.configuration }
			},
			proposed: {
				id: proposedScenario.id,
				name: proposedScenario.name,
				description: proposedScenario.description,
				assumptions: { ...proposedResult.configuration },
				overrides: { ...proposedScenario.overrides }
			}
		},
		comparisonSummary: {
			floorAreaDelta: comparison.buildingSummaryDelta.totalGrossFloorAreaM2Delta,
			coolingCapacityKwDelta: comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityKwDelta,
			coolingCapacityPkDelta: comparison.buildingSummaryDelta.totalEstimatedCoolingCapacityPkDelta,
			luminairesDelta: comparison.buildingSummaryDelta.totalEstimatedLuminairesDelta,
			thermalComplianceRateDelta: comparison.buildingSummaryDelta.thermalComfortComplianceRateDelta,
			buildingOttvDelta: comparison.ottvDelta.buildingOttvWm2Delta
		},
		roomComparisonTable: comparison.rooms.map((r) => ({
			roomId: r.roomId,
			storeyId: r.storeyId,
			status: r.status,
			thermalStatus: {
				baseline: r.thermalComfortStatusChange.baselineStatus,
				proposed: r.thermalComfortStatusChange.proposedStatus,
				changeStatus: r.thermalComfortStatusChange.status
			},
			operativeTempDelta: r.operativeTempDelta,
			pmvDelta: r.pmvDelta,
			airflowAchDelta: r.airflowAchDelta,
			coolingPkDelta: r.coolingCapacityPkDelta,
			targetLuxDelta: r.targetLuxDelta,
			luminaireCountDelta: r.luminaireCountDelta,
			humanFlowScoreDelta: r.humanFlowScoreDelta
		})),
		facadeOttvComparison: comparison.ottvDelta.facades,
		detailedResults: {
			baseline: baselineResult,
			proposed: proposedResult
		},
		warningsAndDiagnostics: {
			baselineDiagnostics: baselineResult.diagnostics,
			proposedDiagnostics: proposedResult.diagnostics,
			comparisonDiagnostics: comparison.diagnostics
		},
		knownLimitations: KNOWN_METHOD_LIMITATIONS
	};
}

/**
 * Generates a concise, printable HTML report summarizing the scenario evaluation and room-by-room differences.
 */
export function generateBuildingAnalysisHtmlReport(
	comparison: BuildingComparisonResult,
	baselineResult: BuildingAnalysisResult,
	proposedResult: BuildingAnalysisResult,
	baselineScenario: DesignScenario,
	proposedScenario: DesignScenario,
	projectName = 'SIBAMBO Building Evaluation'
): string {
	const bSum = baselineResult.summary;
	const pSum = proposedResult.summary;
	const cSum = comparison.buildingSummaryDelta;

	const formatDeltaSpan = (status: string, diffText: string) => {
		if (status === 'improved') {
			return `<span class="badge badge-improved">▼/▲ ${diffText} (Improved)</span>`;
		} else if (status === 'degraded') {
			return `<span class="badge badge-degraded">▲/▼ ${diffText} (Degraded)</span>`;
		}
		return `<span class="badge badge-unchanged">Unchanged</span>`;
	};

	const roomRowsHtml = comparison.rooms
		.map((r) => {
			const statusBadge =
				r.status === 'comparable'
					? '<span class="status-ok">Comparable</span>'
					: `<span class="status-warn">${r.status.replace(/_/g, ' ')}</span>`;

			const achBase = r.airflowAchDelta.baselineValue !== undefined ? `${r.airflowAchDelta.baselineValue} ACH` : 'N/A';
			const achProp = r.airflowAchDelta.proposedValue !== undefined ? `${r.airflowAchDelta.proposedValue} ACH` : 'N/A';
			const achDiff =
				r.airflowAchDelta.status !== 'unchanged' && r.airflowAchDelta.status !== 'not_applicable'
					? `<br><small class="${r.airflowAchDelta.status}">${r.airflowAchDelta.absoluteDifference > 0 ? '+' : ''}${r.airflowAchDelta.absoluteDifference} (${r.airflowAchDelta.status})</small>`
					: '';

			const pkBase = r.coolingCapacityPkDelta.baselineValue !== undefined ? `${r.coolingCapacityPkDelta.baselineValue} PK` : 'N/A';
			const pkProp = r.coolingCapacityPkDelta.proposedValue !== undefined ? `${r.coolingCapacityPkDelta.proposedValue} PK` : 'N/A';
			const pkDiff =
				r.coolingCapacityPkDelta.status !== 'unchanged' && r.coolingCapacityPkDelta.status !== 'not_applicable'
					? `<br><small class="${r.coolingCapacityPkDelta.status}">${r.coolingCapacityPkDelta.absoluteDifference > 0 ? '+' : ''}${r.coolingCapacityPkDelta.absoluteDifference} (${r.coolingCapacityPkDelta.status})</small>`
					: '';

			const lumBase = r.luminaireCountDelta.baselineValue !== undefined ? `${r.luminaireCountDelta.baselineValue}` : 'N/A';
			const lumProp = r.luminaireCountDelta.proposedValue !== undefined ? `${r.luminaireCountDelta.proposedValue}` : 'N/A';
			const lumDiff =
				r.luminaireCountDelta.status !== 'unchanged' && r.luminaireCountDelta.status !== 'not_applicable'
					? `<br><small class="${r.luminaireCountDelta.status}">${r.luminaireCountDelta.absoluteDifference > 0 ? '+' : ''}${r.luminaireCountDelta.absoluteDifference} (${r.luminaireCountDelta.status})</small>`
					: '';

			const tcBase = r.thermalComfortStatusChange.baselineStatus || 'N/A';
			const tcProp = r.thermalComfortStatusChange.proposedStatus || 'N/A';
			const tcDiffClass = r.thermalComfortStatusChange.status;

			return `
			<tr>
				<td><strong>${r.roomId}</strong><br><small style="color:#666">${r.storeyId}</small></td>
				<td>${statusBadge}</td>
				<td>${tcBase}</td>
				<td class="${tcDiffClass}"><strong>${tcProp}</strong>${tcDiffClass !== 'unchanged' && tcDiffClass !== 'not_applicable' ? ` <small>(${tcDiffClass})</small>` : ''}</td>
				<td>${achBase}</td>
				<td>${achProp}${achDiff}</td>
				<td>${pkBase}</td>
				<td>${pkProp}${pkDiff}</td>
				<td>${lumBase}</td>
				<td>${lumProp}${lumDiff}</td>
			</tr>
		`;
		})
		.join('\n');

	const facadeRowsHtml = comparison.ottvDelta.facades
		.map((f) => {
			const bOttv = f.facadeOttvWm2Delta.baselineValue !== undefined ? `${f.facadeOttvWm2Delta.baselineValue} W/m²` : 'N/A';
			const pOttv = f.facadeOttvWm2Delta.proposedValue !== undefined ? `${f.facadeOttvWm2Delta.proposedValue} W/m²` : 'N/A';
			const bWwr = f.wwrDelta.baselineValue !== undefined ? `${(f.wwrDelta.baselineValue * 100).toFixed(1)}%` : 'N/A';
			const pWwr = f.wwrDelta.proposedValue !== undefined ? `${(f.wwrDelta.proposedValue * 100).toFixed(1)}%` : 'N/A';
			const fStatus = f.facadeOttvWm2Delta.status;
			return `
			<tr>
				<td><strong>${f.orientationName}</strong></td>
				<td>${bWwr}</td>
				<td>${pWwr}</td>
				<td>${bOttv}</td>
				<td class="${fStatus}"><strong>${pOttv}</strong>${fStatus !== 'unchanged' && fStatus !== 'not_applicable' ? ` <small>(${f.facadeOttvWm2Delta.absoluteDifference > 0 ? '+' : ''}${f.facadeOttvWm2Delta.absoluteDifference})</small>` : ''}</td>
			</tr>
		`;
		})
		.join('\n');

	const allDiagnostics = [
		...baselineResult.diagnostics.map((d) => `[Baseline] [${d.category}] ${d.message}`),
		...proposedResult.diagnostics.map((d) => `[Proposed] [${d.category}] ${d.message}`),
		...comparison.diagnostics.map((d) => `[Comparison] ${d}`)
	];

	const diagnosticsHtml =
		allDiagnostics.length > 0
			? `<ul>${allDiagnostics.map((msg) => `<li>${msg}</li>`).join('')}</ul>`
			: '<p>No warnings or errors reported across either scenario.</p>';

	const limitationsHtml = `<ul>${KNOWN_METHOD_LIMITATIONS.map((lim) => `<li>${lim}</li>`).join('')}</ul>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>Building Analysis Report: ${projectName}</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #1e293b; background: #f8fafc; }
		.report-container { max-width: 1200px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
		h1 { margin-top: 0; color: #0f172a; font-size: 28px; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
		h2 { margin-top: 32px; color: #1e293b; font-size: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
		.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 16px; }
		.card { background: #f1f5f9; padding: 16px; border-radius: 6px; border-left: 4px solid #3b82f6; }
		.card.improved { border-left-color: #10b981; background: #ecfdf5; }
		.card.degraded { border-left-color: #ef4444; background: #fef2f2; }
		.card-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600; margin-bottom: 4px; }
		.card-value { font-size: 22px; font-weight: 700; color: #0f172a; }
		.card-sub { font-size: 13px; margin-top: 4px; }
		.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
		.badge-improved, .improved { color: #047857; }
		.badge-degraded, .degraded { color: #b91c1c; }
		.badge-unchanged { color: #64748b; }
		table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
		th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
		th { background: #f8fafc; color: #475569; font-weight: 600; }
		.status-ok { color: #10b981; font-weight: 600; }
		.status-warn { color: #f59e0b; font-weight: 600; }
		.limitations, .diagnostics { background: #fffbeb; border: 1px solid #fde68a; padding: 16px; border-radius: 6px; margin-top: 16px; }
		.limitations ul, .diagnostics ul { margin: 0; padding-left: 20px; }
		.limitations li, .diagnostics li { margin-bottom: 6px; font-size: 13px; color: #92400e; }
		.diagnostics { background: #fef2f2; border-color: #fecaca; }
		.diagnostics li { color: #991b1b; }
		@media print {
			body { background: #ffffff; padding: 0; }
			.report-container { box-shadow: none; padding: 0; }
		}
	</style>
</head>
<body>
	<div class="report-container">
		<h1>Building Analysis Report: ${projectName}</h1>
		<p><strong>Baseline Scenario:</strong> ${baselineScenario.name} (${baselineScenario.id})<br>
		<strong>Proposed Scenario:</strong> ${proposedScenario.name} (${proposedScenario.id})<br>
		<strong>Generated:</strong> ${new Date().toLocaleString()}</p>

		<h2>1. Executive Summary & Comparison</h2>
		<div class="summary-grid">
			<div class="card ${cSum.totalEstimatedCoolingCapacityPkDelta.status}">
				<div class="card-title">Peak Cooling Capacity</div>
				<div class="card-value">${pSum.totalEstimatedCoolingCapacityPk} PK</div>
				<div class="card-sub">Baseline: ${bSum.totalEstimatedCoolingCapacityPk} PK ${formatDeltaSpan(cSum.totalEstimatedCoolingCapacityPkDelta.status, `${cSum.totalEstimatedCoolingCapacityPkDelta.absoluteDifference} PK`)}</div>
			</div>
			<div class="card ${comparison.ottvDelta.buildingOttvWm2Delta.status}">
				<div class="card-title">Building OTTV</div>
				<div class="card-value">${proposedResult.ottv.buildingOttvWm2.value} W/m²</div>
				<div class="card-sub">Baseline: ${baselineResult.ottv.buildingOttvWm2.value} W/m² ${formatDeltaSpan(comparison.ottvDelta.buildingOttvWm2Delta.status, `${comparison.ottvDelta.buildingOttvWm2Delta.absoluteDifference} W/m²`)}</div>
			</div>
			<div class="card ${cSum.totalEstimatedLuminairesDelta.status}">
				<div class="card-title">Total Luminaire Count</div>
				<div class="card-value">${pSum.totalEstimatedLuminaires} fixtures</div>
				<div class="card-sub">Baseline: ${bSum.totalEstimatedLuminaires} fixtures ${formatDeltaSpan(cSum.totalEstimatedLuminairesDelta.status, `${cSum.totalEstimatedLuminairesDelta.absoluteDifference} fixtures`)}</div>
			</div>
			<div class="card ${cSum.thermalComfortComplianceRateDelta.status}">
				<div class="card-title">Thermal Comfort Compliance</div>
				<div class="card-value">${(pSum.thermalComfortComplianceRate * 100).toFixed(0)}%</div>
				<div class="card-sub">Baseline: ${(bSum.thermalComfortComplianceRate * 100).toFixed(0)}% ${formatDeltaSpan(cSum.thermalComfortComplianceRateDelta.status, `${cSum.thermalComfortComplianceRateDelta.absoluteDifference}%`)}</div>
			</div>
		</div>

		<h2>2. Room-by-Room Performance Comparison</h2>
		<table>
			<thead>
				<tr>
					<th>Room ID</th>
					<th>Status</th>
					<th>Base Comfort</th>
					<th>Prop Comfort</th>
					<th>Base ACH</th>
					<th>Prop ACH</th>
					<th>Base Cooling</th>
					<th>Prop Cooling</th>
					<th>Base Lights</th>
					<th>Prop Lights</th>
				</tr>
			</thead>
			<tbody>
				${roomRowsHtml}
			</tbody>
		</table>

		<h2>3. Façade OTTV Breakdown</h2>
		<table>
			<thead>
				<tr>
					<th>Orientation</th>
					<th>Base WWR</th>
					<th>Prop WWR</th>
					<th>Base OTTV</th>
					<th>Prop OTTV</th>
				</tr>
			</thead>
			<tbody>
				${facadeRowsHtml}
			</tbody>
		</table>

		<h2>4. Diagnostics & Warnings</h2>
		<div class="diagnostics">
			${diagnosticsHtml}
		</div>

		<h2>5. Known Method Limitations & Engineering Disclaimers</h2>
		<div class="limitations">
			${limitationsHtml}
		</div>
	</div>
</body>
</html>`;
}
