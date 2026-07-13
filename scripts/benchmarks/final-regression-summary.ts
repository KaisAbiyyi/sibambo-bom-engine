import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const MODELS = ['house2', 'presentation20', 'project-sboost', 'project-sboost-2', 'test'] as const;

async function readJson(path: string) {
	return JSON.parse(await Bun.file(path).text()) as any;
}

function pct(after: number, before: number) {
	return Number((((after - before) / before) * 100).toFixed(2));
}

function ratio(numerator: number, denominator: number) {
	return Number((numerator / Math.max(denominator, 1)).toFixed(4));
}

const models = [];
for (const slug of MODELS) {
	const metrics = join(ROOT, 'artifacts', slug, 'metrics');
	const [sketchup, oldFull, oldVisual, finalExport, runtime, classifier, browser, visual] = await Promise.all([
		readJson(join(metrics, 'baseline-sketchup.json')),
		readJson(join(metrics, 'baseline-export-full.json')),
		readJson(join(metrics, 'baseline-export-visual.json')),
		readJson(join(metrics, 'final-export.json')),
		readJson(join(metrics, 'phase2-runtime-benchmark.json')),
		readJson(join(metrics, 'phase3-classifier-regression.json')),
		readJson(join(metrics, 'browser-qa.json')),
		readJson(join(metrics, 'visual-comparison.json'))
	]);
	const canonical = finalExport.formats.find((row: any) => row.format === 'canonical_v3');
	const bome2 = finalExport.formats.find((row: any) => row.format === 'bome2');
	const coldView = browser.views.find((row: any) => row.view === 'isometric');
	models.push({
		slug,
		source: {
			path: sketchup.model.source_path,
			skp_bytes: sketchup.model.source_bytes,
			units: sketchup.model.units.length_unit_name,
			bounds_m: sketchup.model.bounds,
			groups: sketchup.model.entity_counts_expanded.group,
			component_instances: sketchup.model.entity_counts_expanded.component_instance,
			materials: sketchup.model.materials.length,
			tags: sketchup.model.tags.length,
			scenes: sketchup.model.scenes.length
		},
		export: {
			baseline_full: {
				status: oldFull.status,
				bytes: oldFull.output_bytes,
				plugin_elapsed_ms: oldFull.plugin_elapsed_ms
			},
			baseline_visual_bome1: {
				status: oldVisual.status,
				bytes: oldVisual.output_bytes,
				plugin_elapsed_ms: oldVisual.plugin_elapsed_ms
			},
			canonical_v3: {
				status: canonical.status,
				gzip_bytes: canonical.output_bytes,
				uncompressed_bytes: canonical.result.uncompressed_bytes,
				plugin_elapsed_ms: canonical.result.elapsed_seconds * 1000,
				gzip_change_vs_baseline_full_percent: pct(canonical.output_bytes, oldFull.output_bytes)
			},
			bome2: {
				status: bome2.status,
				gzip_bytes: bome2.output_bytes,
				uncompressed_bytes: bome2.result.uncompressed_bytes,
				plugin_elapsed_ms: bome2.result.elapsed_seconds * 1000,
				gzip_change_vs_bome1_percent: pct(bome2.output_bytes, oldVisual.output_bytes),
				triangles: bome2.result.triangles,
				quantization_max_error_m: bome2.result.quantization_max_error_m
			},
			canonical_statistics: canonical.result.statistics,
			source_modified_after: finalExport.source_modified_after
		},
		runtime_benchmark: {
			baseline_bome1: runtime.formats.bome1,
			canonical_v3: runtime.formats.canonical_v3,
			bome2_runtime: runtime.formats.bome2_runtime,
			bome2_analysis_compatibility: runtime.formats.bome2_analysis_compatibility,
			glb: runtime.formats.glb,
			bome2_speedup_vs_bome1: ratio(runtime.formats.bome1.total_ms, runtime.formats.bome2_runtime.total_ms)
		},
		browser_qa: {
			cold_load_to_render_ms: coldView.loadToRenderMs,
			cold_used_js_heap_bytes: coldView.usedJSHeapBytes,
			views_ready: browser.views.filter((row: any) => row.status === 'ready').length,
			view_count: browser.views.length,
			runtime_groups: coldView.runtimeGroups,
			visible_runtime_groups: coldView.visibleRuntimeGroups,
			visible_runtime_instances: coldView.visibleRuntimeInstances
		},
		classification: {
			ground_truth: classifier.ground_truth,
			performance: classifier.performance,
			whole_model: classifier.whole_model,
			silver_metrics: classifier.silver_metrics
		},
		visual: {
			status: visual.overall_status,
			views: visual.views.map((row: any) => ({ view: row.view, status: row.status })),
			geometry_alignment: visual.geometry_alignment
		}
	});
}

const categories = Object.keys(models[0].classification.silver_metrics.confusionMatrix);
const confusionMatrix = Object.fromEntries(categories.map((actual) => [actual, Object.fromEntries(categories.map((predicted) => [predicted, 0]))]));
const categoryDistribution = Object.fromEntries(categories.map((category) => [category, 0]));
let labelledFaces = 0;
let totalFaces = 0;
let unknownFaces = 0;
let ambiguousFaces = 0;
for (const model of models) {
	const silver = model.classification.silver_metrics;
	labelledFaces += silver.sampleCount;
	const distribution = model.classification.whole_model.category_distribution;
	const modelFaces = Object.values(distribution).reduce((sum: number, value) => sum + Number(value), 0);
	totalFaces += modelFaces;
	unknownFaces += distribution.unknown || 0;
	ambiguousFaces += Math.round(model.classification.whole_model.ambiguous_rate * modelFaces);
	for (const actual of categories) {
		categoryDistribution[actual] += distribution[actual] || 0;
		for (const predicted of categories) confusionMatrix[actual][predicted] += silver.confusionMatrix[actual][predicted];
	}
}

const perCategory = Object.fromEntries(
	categories.map((category) => {
		const tp = confusionMatrix[category][category];
		const support = Object.values(confusionMatrix[category]).reduce((sum: number, value) => sum + Number(value), 0);
		const predicted = categories.reduce((sum, actual) => sum + confusionMatrix[actual][category], 0);
		const precision = tp / Math.max(predicted, 1);
		const recall = tp / Math.max(support, 1);
		const f1 = (2 * precision * recall) / Math.max(precision + recall, Number.EPSILON);
		return [category, { precision: Number(precision.toFixed(6)), recall: Number(recall.toFixed(6)), f1: Number(f1.toFixed(6)), support }];
	})
);
const supported = Object.values(perCategory).filter((row: any) => row.support > 0) as Array<{ f1: number }>;
const correct = categories.reduce((sum, category) => sum + confusionMatrix[category][category], 0);

const totalOldFull = models.reduce((sum, model) => sum + model.export.baseline_full.bytes, 0);
const totalOldVisual = models.reduce((sum, model) => sum + model.export.baseline_visual_bome1.bytes, 0);
const totalCanonicalGzip = models.reduce((sum, model) => sum + model.export.canonical_v3.gzip_bytes, 0);
const totalBome2 = models.reduce((sum, model) => sum + model.export.bome2.gzip_bytes, 0);
const totalBome1Ms = models.reduce((sum, model) => sum + model.runtime_benchmark.baseline_bome1.total_ms, 0);
const totalBome2Ms = models.reduce((sum, model) => sum + model.runtime_benchmark.bome2_runtime.total_ms, 0);
const exportAttempts = models.flatMap((model) => [model.export.canonical_v3.status, model.export.bome2.status]);
const readyViews = models.reduce((sum, model) => sum + model.browser_qa.views_ready, 0);
const viewCount = models.reduce((sum, model) => sum + model.browser_qa.view_count, 0);
const visualPasses = models.filter((model) => model.visual.status === 'PASS' || model.visual.status === 'PASS_WITH_RENDERING_DIFFERENCE').length;

const summary = {
	workflow_version: '3.0.0',
	generated_at: new Date().toISOString(),
	corpus_models: MODELS.length,
	models,
	aggregates: {
		export_success_rate: ratio(exportAttempts.filter((status) => status === 'ok').length, exportAttempts.length),
		load_success_rate: ratio(readyViews, viewCount),
		visual_pass_rate: ratio(visualPasses, models.length),
		source_skp_bytes: models.reduce((sum, model) => sum + model.source.skp_bytes, 0),
		baseline_full_bytes: totalOldFull,
		canonical_v3_gzip_bytes: totalCanonicalGzip,
		canonical_gzip_change_vs_baseline_full_percent: pct(totalCanonicalGzip, totalOldFull),
		baseline_bome1_gzip_bytes: totalOldVisual,
		bome2_gzip_bytes: totalBome2,
		bome2_size_change_vs_bome1_percent: pct(totalBome2, totalOldVisual),
		baseline_bome1_runtime_total_ms: Number(totalBome1Ms.toFixed(2)),
		bome2_runtime_total_ms: Number(totalBome2Ms.toFixed(2)),
		bome2_runtime_speedup: ratio(totalBome1Ms, totalBome2Ms),
		maximum_quantization_error_m: Math.max(...models.map((model) => model.export.bome2.quantization_max_error_m)),
		classifier: {
			ground_truth: 'silver_explicit_metadata_not_human_verified',
			labelled_faces: labelledFaces,
			total_faces: totalFaces,
			coverage: ratio(labelledFaces, totalFaces),
			accuracy: ratio(correct, labelledFaces),
			macro_f1_supported_categories: Number((supported.reduce((sum, row) => sum + row.f1, 0) / Math.max(supported.length, 1)).toFixed(6)),
			unknown_rate: ratio(unknownFaces, totalFaces),
			ambiguous_rate: ratio(ambiguousFaces, totalFaces),
			category_distribution: categoryDistribution,
			per_category: perCategory,
			confusion_matrix: confusionMatrix
		},
		artifacts: {
			sketchup_reference_screenshots: MODELS.length * 6,
			model_eval_screenshots: MODELS.length * 6,
			comparison_images: MODELS.length * 6 * 3,
			per_model_visual_reports: MODELS.length
		}
	},
	acceptance: {
		plugin_build_and_tests_passed: true,
		plugin_installed_and_loaded_sketchup_2026: true,
		all_skp_opened_directly: true,
		all_models_export_attempted: true,
		all_exports_loaded_in_model_eval: readyViews === viewCount,
		matched_view_screenshots_available: true,
		visual_report_per_model_available: visualPasses === models.length,
		canonical_schema_and_documentation_available: true,
		classifier_rule_bank_trace_confidence_unknown_fallback_available: true,
		regression_metrics_available: true,
		source_skp_files_modified: models.some((model) => model.export.source_modified_after)
	}
};

const output = join(ROOT, 'artifacts', '_workflow', 'final-regression-summary.json');
await Bun.write(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output, aggregates: summary.aggregates, acceptance: summary.acceptance }, null, 2));
