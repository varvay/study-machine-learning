import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const stripExtension = (entry: string) => entry.replace(/\.md$/, '');

// Each goal lives in goals/<goal-slug>/index.md, e.g. goals/g1-database-architecture/.
const goals = defineCollection({
	loader: glob({
		base: './goals',
		pattern: '*/index.md',
		generateId: ({ entry }) => entry.split('/')[0],
	}),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
	}),
});

// Each level page lives in goals/<goal-slug>/l<1-3>/index.md.
const levels = defineCollection({
	loader: glob({
		base: './goals',
		pattern: '*/l[1-3]/index.md',
		generateId: ({ entry }) => entry.replace(/\/index\.md$/, ''),
	}),
	schema: z.object({
		description: z.string().optional(),
	}),
});

// Each section lives in goals/<goal-slug>/l<1-3>/<item-number>-<item-slug>.md, one per goal.md checkbox.
const sections = defineCollection({
	loader: glob({
		base: './goals',
		pattern: '*/l[1-3]/[0-9]*-*.md',
		generateId: ({ entry }) => stripExtension(entry),
	}),
	schema: z.object({
		title: z.string(),
	}),
});

export const collections = { goals, levels, sections };
