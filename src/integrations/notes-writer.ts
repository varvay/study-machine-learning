import type { AstroIntegration } from 'astro';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES_ENDPOINT, isNoteId } from '../lib/notes';

const MAX_NOTE_BYTES = 200_000;

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', (chunk: string) => {
			body += chunk;
			if (body.length > MAX_NOTE_BYTES) reject(new Error('Note too large'));
		});
		request.on('end', () => resolve(body));
		request.on('error', reject);
	});
}

function reply(response: ServerResponse, status: number, payload: object) {
	response.statusCode = status;
	response.setHeader('Content-Type', 'application/json');
	response.end(JSON.stringify(payload));
}

const noteFile = (notesDirectory: string, id: string) => join(notesDirectory, `${id}.md`);

async function removeEmptyFolders(folder: string, notesDirectory: string) {
	for (let current = folder; current.startsWith(notesDirectory); current = dirname(current)) {
		try {
			await rmdir(current);
		} catch {
			return;
		}
	}
}

async function saveNote(notesDirectory: string, id: string, markdown: string) {
	const file = noteFile(notesDirectory, id);
	if (markdown.trim() === '') {
		await rm(file, { force: true });
		await removeEmptyFolders(dirname(file), notesDirectory);
		return;
	}
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `---\nupdated: ${new Date().toISOString()}\n---\n\n${markdown.trimEnd()}\n`, 'utf8');
}

export default function notesWriter(): AstroIntegration {
	return {
		name: 'notes-writer',
		hooks: {
			'astro:server:setup': ({ server, logger }) => {
				const notesDirectory = fileURLToPath(new URL('../../notes/', import.meta.url));
				server.middlewares.use(async (request, response, next) => {
					const url = new URL(request.url ?? '/', 'http://localhost');
					if (!url.pathname.endsWith(`/${NOTES_ENDPOINT}`)) return next();
					if (request.method !== 'PUT') return reply(response, 405, { error: 'Use PUT' });
					const id = url.searchParams.get('id') ?? '';
					if (!isNoteId(id)) return reply(response, 400, { error: 'Unknown note id' });
					try {
						const { markdown } = JSON.parse(await readBody(request)) as { markdown?: unknown };
						if (typeof markdown !== 'string') return reply(response, 400, { error: 'Missing markdown' });
						await saveNote(notesDirectory, id, markdown);
						reply(response, 200, { saved: new Date().toISOString() });
					} catch (error) {
						logger.error(`Saving note ${id} failed: ${(error as Error).message}`);
						reply(response, 500, { error: (error as Error).message });
					}
				});
			},
		},
	};
}
