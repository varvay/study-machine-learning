export type Folder = `goals/${string}`;

export interface SourceFile {
	name: string;
	code: string;
	language: string;
}

const rawFiles = import.meta.glob<string>(['/goals/*/l[1-3]/*', '!/goals/*/l[1-3]/*.md', '!/goals/*/l[1-3]/*.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

const explainerPaths = Object.keys(import.meta.glob('/goals/*/l[1-3]/*.tsx'));

const languagesByExtension: Record<string, string> = {
	py: 'python',
	js: 'javascript',
	ts: 'typescript',
	java: 'java',
	kt: 'kotlin',
	sql: 'sql',
	sh: 'bash',
	json: 'json',
	yaml: 'yaml',
	yml: 'yaml',
};

export function sourceFilesIn(folder: Folder): SourceFile[] {
	return Object.entries(rawFiles)
		.filter(([path]) => path.startsWith(`/${folder}/`))
		.map(([path, code]) => {
			const name = path.split('/').pop()!;
			const extension = name.split('.').pop()!;
			return { name, code, language: languagesByExtension[extension] ?? 'plaintext' };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export const sectionExplainerPaths = (sectionId: string) =>
	explainerPaths.filter((path) => path.startsWith(`/goals/${sectionId}.`)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
