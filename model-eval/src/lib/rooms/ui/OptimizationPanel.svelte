<script lang="ts">
	import type { DetectedRoom } from '../detected-room';
	import type { RoomTopologyGraph } from '../topology';
	import type { RoomSemanticInference } from '../semantics';
	import type { BuildingAnalysisResult, RoomAnalysisConfiguration } from '../analysis/types';
	import { runOptimization, type OptimizationConfig, type OptimizationVariableConfig, type OptimizationObjectiveType, type EvaluatedScenario } from '../analysis/optimization';
	import type { DesignScenarioOverrides } from '../analysis/scenarios';

	let {
		rooms,
		topology,
		semantics,
		analysis,
		config,
		onApplyScenario
	}: {
		rooms: DetectedRoom[];
		topology: RoomTopologyGraph;
		semantics: RoomSemanticInference[];
		analysis: BuildingAnalysisResult;
		config: RoomAnalysisConfiguration;
		onApplyScenario: (overrides: DesignScenarioOverrides) => void;
	} = $props();

	let running = $state(false);
	let progress = $state(0);
	let totalEvaluations = $state(50);
	let timeBudgetMs = $state(2000);
	let abortController: AbortController | null = null;
	let results: EvaluatedScenario[] = $state([]);
	let bestScenario: EvaluatedScenario | null = $state(null);
	let diagnostics: string[] = $state([]);
	let feasibleCount = $state(0);
	let rejectedCount = $state(0);

	let objectives = $state<OptimizationObjectiveType[]>(['reduce_cooling_load', 'reduce_ottv']);
	
	let variables = $state<OptimizationVariableConfig[]>([
		{ path: 'wallUValueMultiplier', min: 0.5, max: 1.5, step: 0.1 },
		{ path: 'windowAreaMultiplier', min: 0.5, max: 1.2, step: 0.1 }
	]);

	const availableObjectives: OptimizationObjectiveType[] = [
		'reduce_cooling_load', 'reduce_ottv', 'improve_ach', 'improve_thermal_comfort', 'reduce_luminaires', 'minimize_changes'
	];

	function toggleObjective(obj: OptimizationObjectiveType) {
		if (objectives.includes(obj)) {
			objectives = objectives.filter(o => o !== obj);
		} else {
			objectives = [...objectives, obj];
		}
	}

	async function startOptimization() {
		running = true;
		results = [];
		bestScenario = null;
		diagnostics = [];
		progress = 0;
		abortController = new AbortController();

		const optConfig: OptimizationConfig = {
			variables,
			objectives,
			constraints: [],
			maxEvaluations: totalEvaluations,
			timeBudgetMs,
			seed: Math.floor(Math.random() * 10000)
		};

		try {
			const res = await runOptimization(
				rooms, topology, semantics, analysis, config, optConfig,
				(p, t) => { progress = p; },
				abortController.signal
			);
			results = res.paretoFrontier;
			bestScenario = res.recommendedScenario;
			diagnostics = res.diagnostics;
			feasibleCount = res.feasibleCount;
			rejectedCount = res.rejectedCount;
		} catch (e) {
			diagnostics = [...diagnostics, (e as Error).message];
		} finally {
			running = false;
			abortController = null;
		}
	}

	function cancelOptimization() {
		if (abortController) {
			abortController.abort();
		}
	}

	function applyScenario(scenario: EvaluatedScenario) {
		onApplyScenario(scenario.scenario.overrides);
	}
</script>

<div class="optimization-panel panel">
	<h3>Multi-Variable Optimization</h3>

	<div class="section">
		<h4>Objectives</h4>
		<div class="objectives">
			{#each availableObjectives as obj}
				<label class="checkbox-label">
					<input type="checkbox" checked={objectives.includes(obj)} onchange={() => toggleObjective(obj)} disabled={running} />
					{obj.replace(/_/g, ' ')}
				</label>
			{/each}
		</div>
	</div>

	<div class="section controls">
		<label>
			Max Evaluations:
			<input type="number" bind:value={totalEvaluations} disabled={running} min="10" max="1000" />
		</label>
		<label>
			Time Budget (ms):
			<input type="number" bind:value={timeBudgetMs} disabled={running} min="100" max="10000" />
		</label>
	</div>

	<div class="actions">
		{#if running}
			<button class="btn btn-danger" onclick={cancelOptimization}>Cancel</button>
			<span class="progress">Running... {progress} / {totalEvaluations}</span>
		{:else}
			<button class="btn btn-primary" onclick={startOptimization} disabled={objectives.length === 0}>
				Run Optimization
			</button>
		{/if}
	</div>

	{#if diagnostics.length > 0}
		<div class="diagnostics warning">
			{#each diagnostics as d}
				<p>{d}</p>
			{/each}
		</div>
	{/if}

	{#if results.length > 0}
		<div class="results">
			<h4>Pareto Frontier ({results.length} feasible scenarios)</h4>
			<p class="stats">Feasible: {feasibleCount} | Rejected: {rejectedCount}</p>
			
			{#if bestScenario}
				<div class="best-scenario card">
					<h5>Recommended Balance</h5>
					<ul>
						{#each Object.entries(bestScenario.objectiveValues) as [obj, val]}
							<li>{obj.replace(/_/g, ' ')}: {val.toFixed(2)}</li>
						{/each}
					</ul>
					<button class="btn btn-success" onclick={() => applyScenario(bestScenario!)}>
						Apply to Design
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.optimization-panel {
		padding: 1rem;
		background: var(--surface-2);
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 100%;
		overflow-y: auto;
	}
	h3, h4, h5 {
		margin: 0 0 0.5rem 0;
	}
	.section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.objectives {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-transform: capitalize;
		font-size: 0.9rem;
	}
	.controls label {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
	}
	.controls input {
		width: 80px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 0.5rem;
	}
	.btn {
		padding: 0.5rem 1rem;
		border-radius: 4px;
		border: none;
		cursor: pointer;
		font-weight: bold;
	}
	.btn-primary { background: #3b82f6; color: white; }
	.btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }
	.btn-danger { background: #ef4444; color: white; }
	.btn-success { background: #10b981; color: white; margin-top: 0.5rem; }
	.progress {
		font-size: 0.9rem;
		color: #64748b;
	}
	.results {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
		margin-top: 0.5rem;
	}
	.stats {
		font-size: 0.85rem;
		color: #64748b;
		margin: 0 0 1rem 0;
	}
	.card {
		background: var(--surface-1);
		padding: 1rem;
		border-radius: 6px;
		border: 1px solid var(--border);
	}
	ul {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.9rem;
	}
	.warning {
		color: #b45309;
		background: #fef3c7;
		padding: 0.5rem;
		border-radius: 4px;
		font-size: 0.85rem;
	}
	.warning p { margin: 0; }
</style>
