import { basename, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

const inputPath = Bun.argv[2];
if (!inputPath) {
	console.error('Usage: bun run scripts/prepare-annotation-smoke.ts <compact-json-path>');
	process.exit(1);
}

try {
	const absoluteInputPath = resolve(inputPath);
	if (!existsSync(absoluteInputPath)) {
		console.error(`Error: File does not exist at ${absoluteInputPath}`);
		process.exit(1);
	}

	const text = await Bun.file(absoluteInputPath).text();
	const payload = JSON.parse(text);

	if (payload?.format?.identifier !== 'model_eval_json_v1') {
		console.error('Error: Invalid format. Must be model_eval_json_v1.');
		process.exit(1);
	}

	const devModelsDir = resolve(import.meta.dirname, '..', 'static', 'dev-models');
	if (!existsSync(devModelsDir)) {
		mkdirSync(devModelsDir, { recursive: true });
	}

	const fileName = basename(absoluteInputPath);
	const targetPath = resolve(devModelsDir, fileName);

	await Bun.write(targetPath, text);

	console.log(`Copied ${fileName} to ${targetPath}`);
	console.log(`Direct browser URL: http://localhost:5173/?annotate=tier1&devModel=${fileName}`);
} catch (error) {
	console.error('Failed to prepare annotation smoke model:', error);
	process.exit(1);
}
