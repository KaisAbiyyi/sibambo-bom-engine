<script lang="ts">
	import type { BuildingDesignRecommendation } from '../analysis/recommendations';

	let { 
		recommendations = [], 
		selectedRecommendation = null, 
		onSelect = () => {}, 
		onApplyScenario = () => {} 
	}: { 
		recommendations: BuildingDesignRecommendation[], 
		selectedRecommendation: BuildingDesignRecommendation | null, 
		onSelect: (rec: BuildingDesignRecommendation | null) => void, 
		onApplyScenario: (rec: BuildingDesignRecommendation) => void 
	} = $props();

	let filterSeverity = $state<'all' | 'critical' | 'warning' | 'info'>('all');
	let filtered = $derived(recommendations.filter(r => filterSeverity === 'all' || r.severity === filterSeverity));

	function handleSelect(rec: BuildingDesignRecommendation) {
		if (selectedRecommendation === rec) {
			onSelect(null);
		} else {
			onSelect(rec);
		}
	}
</script>

<div class="recommendations-panel">
	<div class="header">
		<h3>Design Recommendations</h3>
		<div class="filters">
			<label>
				<input type="radio" bind:group={filterSeverity} value="all" /> All
			</label>
			<label>
				<input type="radio" bind:group={filterSeverity} value="critical" /> Critical
			</label>
			<label>
				<input type="radio" bind:group={filterSeverity} value="warning" /> Warning
			</label>
		</div>
	</div>

	<div class="recommendations-list">
		{#if filtered.length === 0}
			<div class="empty-state">No recommendations match the current filter.</div>
		{/if}
		{#each filtered as rec}
			<div 
				role="button"
				tabindex="0"
				class="card {rec.severity} {selectedRecommendation === rec ? 'selected' : ''}" 
				onclick={() => handleSelect(rec)}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect(rec); }}
			>
				<div class="card-header">
					<span class="badge {rec.severity}">{rec.severity.toUpperCase()}</span>
					<span class="category">{rec.category}</span>
					<span class="confidence">{Math.round(rec.confidence * 100)}% Conf.</span>
				</div>
				<h4>{rec.title}</h4>
				<p>{rec.explanation}</p>
				
				{#if selectedRecommendation === rec}
					<div class="details">
						<div class="evidence">
							<strong>Evidence:</strong>
							<ul>
								{#each rec.evidence as ev}
									<li>{ev}</li>
								{/each}
							</ul>
						</div>

						{#if Object.keys(rec.suggestedOverrides).length > 0}
							<div class="overrides">
								<strong>Suggested Parameters:</strong>
								<pre>{JSON.stringify(rec.suggestedOverrides, null, 2)}</pre>
								<button type="button" class="apply-btn" onclick={(e) => { e.stopPropagation(); onApplyScenario(rec); }}>
									Apply as Proposed Scenario
								</button>
							</div>
						{/if}

						{#if Object.keys(rec.estimatedImpact).length > 0}
							<div class="impact">
								<strong>Estimated Impact:</strong>
								<pre>{JSON.stringify(rec.estimatedImpact, null, 2)}</pre>
							</div>
						{/if}

						{#if rec.limitations.length > 0}
							<div class="limitations">
								<strong>Limitations & Conflicts:</strong>
								<ul>
									{#each rec.limitations as lim}
										<li>{lim}</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.recommendations-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: #f9fafb;
		border-left: 1px solid #e5e7eb;
		overflow: hidden;
	}

	.header {
		padding: 16px;
		background: white;
		border-bottom: 1px solid #e5e7eb;
	}

	.header h3 {
		margin: 0 0 12px 0;
		font-size: 16px;
		font-weight: 600;
	}

	.filters {
		display: flex;
		gap: 12px;
		font-size: 13px;
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.empty {
		padding: 32px;
		text-align: center;
		color: #6b7280;
		font-size: 14px;
	}

	.card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		padding: 12px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.card:hover {
		border-color: #d1d5db;
		box-shadow: 0 2px 4px rgba(0,0,0,0.05);
	}

	.card.selected {
		border-color: #3b82f6;
		box-shadow: 0 0 0 1px #3b82f6;
	}

	.card.critical { border-left: 4px solid #ef4444; }
	.card.warning { border-left: 4px solid #f59e0b; }
	.card.info { border-left: 4px solid #3b82f6; }

	.card-header {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 8px;
		font-size: 12px;
	}

	.badge {
		padding: 2px 6px;
		border-radius: 4px;
		font-weight: 600;
		font-size: 10px;
	}

	.badge.critical { background: #fee2e2; color: #b91c1c; }
	.badge.warning { background: #fef3c7; color: #b45309; }
	.badge.info { background: #dbeafe; color: #1d4ed8; }

	.category {
		color: #4b5563;
		font-weight: 500;
		flex: 1;
	}

	.confidence {
		color: #9ca3af;
	}

	h4 {
		margin: 0 0 4px 0;
		font-size: 14px;
		color: #111827;
	}

	p {
		margin: 0;
		font-size: 13px;
		color: #4b5563;
		line-height: 1.4;
	}

	.details {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px dashed #e5e7eb;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.details strong {
		color: #374151;
		display: block;
		margin-bottom: 4px;
	}

	.details ul {
		margin: 0;
		padding-left: 16px;
		color: #4b5563;
	}

	.details pre {
		margin: 0;
		background: #f3f4f6;
		padding: 8px;
		border-radius: 4px;
		overflow-x: auto;
		font-family: monospace;
		font-size: 11px;
	}

	.limitations ul {
		color: #b91c1c;
	}

	.apply-btn {
		margin-top: 8px;
		width: 100%;
		padding: 6px 12px;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-weight: 500;
	}

	.apply-btn:hover {
		background: #2563eb;
	}
</style>
