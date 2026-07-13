import Ajv2020 from 'ajv/dist/2020.js';
import { validateCanonicalV3 } from '../src/lib/formats/canonical-v3';

const schemaUrl = new URL('../../bom_engine_plugin/schema/bom-engine-3.0.schema.json', import.meta.url);
const paths = Bun.argv.slice(2);

if (paths.length === 0) {
	console.error('Usage: bun run validate:v3 <file.json|file.json.gz> [...]');
	process.exit(2);
}

const schema = await Bun.file(schemaUrl).json();
const validateSchema = new Ajv2020({
	allErrors: true,
	strict: true,
	allowUnionTypes: true
}).compile(schema);

let failed = 0;
for (const path of paths) {
	try {
		const data = await readJson(path);
		const schemaValid = validateSchema(data);
		const referenceErrors = validateCanonicalV3(data);
		if (!schemaValid || referenceErrors.length > 0) {
			failed += 1;
			console.error(`FAIL ${path}`);
			for (const error of validateSchema.errors || []) {
				console.error(`  schema ${error.instancePath || '/'} ${error.message}`);
			}
			for (const error of referenceErrors) console.error(`  reference ${error}`);
			continue;
		}
		console.log(`PASS ${path}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL ${path}`);
		console.error(`  ${error instanceof Error ? error.message : String(error)}`);
	}
}

process.exit(failed === 0 ? 0 : 1);

async function readJson(path: string): Promise<unknown> {
	const file = Bun.file(path);
	if (!(await file.exists())) throw new Error('file does not exist');
	if (!path.toLowerCase().endsWith('.gz')) return file.json();
	const compressed = new Uint8Array(await file.arrayBuffer());
	const json = new TextDecoder().decode(Bun.gunzipSync(compressed));
	return JSON.parse(json);
}
