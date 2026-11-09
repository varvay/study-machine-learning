export const NOTES_ENDPOINT = '__notes';

export const PAGE_NOTE_NAME = '_page';

const NOTE_ID_PATTERN = /^g\d+-[a-z0-9-]+\/l[1-3]\/(_page|\d+-[a-z0-9-]+)$/;

export const isNoteId = (id: string) => NOTE_ID_PATTERN.test(id);

export const pageNoteId = (levelId: string) => `${levelId}/${PAGE_NOTE_NAME}`;

export const sectionNoteId = (sectionId: string) => sectionId;
