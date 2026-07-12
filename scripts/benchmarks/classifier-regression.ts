import { join } from 'node:path';
import { evaluateClassifications, type ClassificationMetricRow } from '../../model-eval/src/lib/classifier/metrics';
import { BUILDING_CATEGORIES, type BuildingCategory } from '../../model-eval/src/lib/classifier/rule-bank-v1';
import { parseBomModelJson, type BomModelJson, type FaceRecord } from '../../model-eval/src/lib/model';

const ROOT = 'D:/projects/sibambo-bom-engine';
const slug = Bun.argv.find((argument) => argument.startsWith('--slug='))?.slice(7) || 'project-sboost-2';
const inputPath = join(ROOT, 'artifacts', slug, 'exported', `${slug}_canonical.json.gz`);
const outputPath = join(ROOT, 'artifacts', slug, 'metrics', 'phase3-classifier-regression.json');

const compressed = new Uint8Array(await Bun.file(inputPath).arrayBuffer());
const inflated = Bun.gunzipSync(compressed);
const jsonStart = performance.now();
const canonical = JSON.parse(new TextDecoder().decode(inflated)) as BomModelJson;
const jsonParseMs = performance.now() - jsonStart;
const classifierStart = performance.now();
const parsed = parseBomModelJson(canonical, `${slug}_canonical.json`);
const classifierParseMs = performance.now() - classifierStart;

const silverRows: ClassificationMetricRow[] = [];
for (const face of parsed.faces) {
	const truth = explicitSilverLabel(face);
	if (!truth || !face.category || !face.classification) continue;
	silverRows.push({
		truth,
		predicted: face.category,
		confidence: face.classification.confidence,
		candidateScores: face.classification.candidates.map((candidate) => candidate.score)
	});
}

const categoryDistribution = Object.fromEntries(BUILDING_CATEGORIES.map((category) => [category, 0])) as Record<BuildingCategory, number>;
let ambiguousCount = 0;
for (const face of parsed.faces) {
	categoryDistribution[face.category || 'unknown'] += 1;
	if (face.classification?.unknownReason?.includes('ambiguous')) ambiguousCount += 1;
}

const report = {
	workflow_version: '3.0.0',
	measured_at: new Date().toISOString(),
	model: slug,
	source: inputPath,
	ground_truth: {
		kind: 'silver_explicit_metadata_not_human_verified',
		description:
			'Only unambiguous explicit multilingual category tokens in face name/path/layer are scored. Geometry-only and contextual predictions are excluded from precision/recall ground truth.',
		labelled_faces: silverRows.length,
		total_faces: parsed.faceCount,
		coverage: round(silverRows.length / Math.max(parsed.faceCount, 1))
	},
	performance: {
		compressed_bytes: compressed.byteLength,
		decompressed_bytes: inflated.byteLength,
		json_parse_ms: round(jsonParseMs),
		model_parse_and_classify_ms: round(classifierParseMs)
	},
	whole_model: {
		category_distribution: categoryDistribution,
		unknown_rate: round(categoryDistribution.unknown / Math.max(parsed.faceCount, 1)),
		ambiguous_rate: round(ambiguousCount / Math.max(parsed.faceCount, 1))
	},
	silver_metrics: evaluateClassifications(silverRows)
};

await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function explicitSilverLabel(face: FaceRecord): BuildingCategory | undefined {
	const text = normalize(`${face.name} ${face.path} ${face.layer || ''}`);
	const matches = new Set<BuildingCategory>();
	const add = (category: BuildingCategory, pattern: RegExp) => {
		if (pattern.test(text)) matches.add(category);
	};
	add('room_boundary', /\b(room boundary|batas ruang|space boundary)\b/);
	add('exterior_wall', /\b(exterior wall|external wall|dinding luar|facade wall|fasad)\b/);
	add('interior_wall', /\b(interior wall|internal wall|dinding dalam|sekat|partition)\b/);
	add('roof', /\b(roof|atap|toit|techo|dach)\b/);
	add('floor', /\b(floor|slab|lantai|pelat lantai|sol|boden)\b/);
	add('ceiling', /\b(ceiling|plafon|plafond|langit langit)\b/);
	add('door', /\b(door|pintu|porte|puerta|tur)\b/);
	add('window', /\b(window|jendela|fenestration|fenetre|ventana)\b/);
	add('column', /\b(column|kolom|pillar|tiang)\b/);
	add('beam', /\b(beam|balok|girder)\b/);
	add('stair', /\b(stair|stairs|staircase|tangga)\b/);
	add('railing', /\b(railing|balustrade|pagar tangga|handrail)\b/);
	add('furniture', /\b(furniture|furnitur|meja|table|chair|kursi|sofa|cabinet|lemari)\b/);
	add('fixture', /\b(fixture|sanitary|wastafel|toilet|sink|luminaire)\b/);
	add('opening', /\b(opening|bukaan|void)\b/);
	return matches.size === 1 ? [...matches][0] : undefined;
}

function normalize(value: string) {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function round(value: number) {
	return Number(value.toFixed(6));
}
