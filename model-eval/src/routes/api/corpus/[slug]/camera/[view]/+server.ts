import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const SLUGS = new Set(['house2', 'presentation20', 'project-sboost', 'project-sboost-2', 'test']);
const VIEWS = new Set(['isometric', 'front', 'back', 'left', 'right', 'top']);

export const GET: RequestHandler = async ({ params }) => {
	if (!SLUGS.has(params.slug) || !VIEWS.has(params.view)) throw error(404, 'Camera capture not found');
	const artifactRoot = resolve(process.cwd(), '..', 'artifacts');
	const path = resolve(artifactRoot, params.slug, 'metrics', 'baseline-sketchup.json');
	if (!path.startsWith(`${artifactRoot}\\`) && !path.startsWith(`${artifactRoot}/`)) throw error(400, 'Invalid camera path');
	try {
		const metrics = JSON.parse(await readFile(path, 'utf8')) as {
			captures?: Array<{ view_name?: string }>;
			model?: { style?: { background_color?: { hex?: string } } };
		};
		const capture = metrics.captures?.find((row) => row.view_name === params.view);
		if (!capture) throw error(404, 'Camera capture not found');
		return json({
			capture,
			backgroundColor: metrics.model?.style?.background_color?.hex || '#EEF2F0'
		}, { headers: { 'cache-control': 'no-store' } });
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'status' in cause) throw cause;
		throw error(404, 'Camera metadata has not been generated');
	}
};
