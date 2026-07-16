import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const FILES: Record<string, string> = {
	'1': 'PROJECT SBOOST 1_model-eval.json',
	'2': 'PROJECT SBOOST 2_model-eval.json'
};

export const GET: RequestHandler = async ({ params }) => {
	if (!import.meta.env.DEV) throw error(404, 'Development fixture loader is disabled');
	const filename = FILES[params.id];
	if (!filename) throw error(404, 'SMBOOST fixture not found');
	const path = resolve(process.cwd(), '..', 'skps', 'model-eval-exports', filename);
	try {
		return new Response(await readFile(path), {
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-bom-fixture-file': filename }
		});
	} catch {
		throw error(404, 'SMBOOST fixture file is unavailable');
	}
};
