import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const SLUGS = new Set(['house2', 'presentation20', 'project-sboost', 'project-sboost-2', 'test']);
const FILES: Record<string, (slug: string) => string> = {
	bome2: (slug) => `${slug}_runtime.bome2.gz`,
	canonical: (slug) => `${slug}_canonical.json.gz`,
	bome1: () => 'baseline-current_visual.bome.gz'
};

export const GET: RequestHandler = async ({ params }) => {
	if (!SLUGS.has(params.slug) || !FILES[params.format]) throw error(404, 'Corpus artifact not found');
	const artifactRoot = resolve(process.cwd(), '..', 'artifacts');
	const path = resolve(artifactRoot, params.slug, 'exported', FILES[params.format](params.slug));
	if (!path.startsWith(`${artifactRoot}\\`) && !path.startsWith(`${artifactRoot}/`)) throw error(400, 'Invalid corpus path');
	try {
		const bytes = await readFile(path);
		return new Response(bytes, {
			headers: {
				'content-type': 'application/gzip',
				'cache-control': 'no-store',
				'x-bom-corpus-file': FILES[params.format](params.slug)
			}
		});
	} catch {
		throw error(404, 'Corpus artifact has not been generated');
	}
};
