export type LevelNumber = 1 | 2 | 3;

export const levelNames: Record<LevelNumber, string> = {
	1: 'Surface',
	2: 'Practical',
	3: 'Expertise',
};

export interface LevelPath {
	goalSlug: string;
	levelSlug: string;
	level: LevelNumber;
}

export interface SectionPath {
	levelId: string;
	itemNumber: number;
	itemLabel: string;
	anchor: string;
}

export const goalLabel = (goalSlug: string) => goalSlug.split('-')[0].toUpperCase();

export const levelLabel = (level: LevelNumber) => `L${level} · ${levelNames[level]}`;

export function parseLevelId(levelId: string): LevelPath {
	const [goalSlug, levelSlug] = levelId.split('/');
	return { goalSlug, levelSlug, level: Number(levelSlug.slice(1)) as LevelNumber };
}

export function parseSectionId(sectionId: string): SectionPath {
	const [goalSlug, levelSlug, fileStem] = sectionId.split('/');
	const [itemNumber, ...slugWords] = fileStem.split('-');
	return {
		levelId: `${goalSlug}/${levelSlug}`,
		itemNumber: Number(itemNumber),
		itemLabel: `${goalLabel(goalSlug)}.${itemNumber}`,
		anchor: slugWords.join('-'),
	};
}
