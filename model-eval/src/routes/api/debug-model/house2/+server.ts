import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const HOUSE2_PATH = resolve(process.cwd(), '..', 'skps', 'model-eval-exports', 'house2_model-eval.json');

export async function GET() {
	if (!dev) error(404, 'Not found');

	try {
		const data = await readFile(HOUSE2_PATH);
		return new Response(data, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'cache-control': 'no-store'
			}
		});
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
			error(404, 'House2 debug model file is unavailable locally.');
		}
		throw cause;
	}
}
