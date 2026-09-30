import { Canvas, Cell, Chips, RowLabel, SubLabel, type CellTone, type Chip } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type DocumentId = string;

interface HybridInput {
	query?: string;
	titles?: Record<DocumentId, string>;
	keywordRanking: DocumentId[];
	vectorRanking: DocumentId[];
	k: number;
}

type Phase = 'lists' | 'score' | 'sorted';

interface HybridStep extends Step {
	phase: Phase;
	scoredCount: number;
}

type HybridSceneProps = SceneProps<HybridInput, HybridStep>;

interface FusedDocument {
	id: DocumentId;
	keywordRank?: number;
	vectorRank?: number;
	score: number;
	readOrder: number;
}

const DEFAULT_K = 60;
const MAX_RANKING_LENGTH = 6;
const MAX_ID_LENGTH = 3;

const KEYWORD_TOP = 26;
const VECTOR_TOP = 126;
const FUSED_TOP = 236;
const SCENE_HEIGHT = 320;

const rankOf = (ranking: DocumentId[], id: DocumentId) => {
	const index = ranking.indexOf(id);
	return index < 0 ? undefined : index + 1;
};

const formatScore = (score: number) => score.toFixed(4);

function fusedDocuments({ keywordRanking, vectorRanking, k }: HybridInput): FusedDocument[] {
	const readOrder = [...new Set([...keywordRanking, ...vectorRanking])];
	return readOrder.map((id, index) => {
		const keywordRank = rankOf(keywordRanking, id);
		const vectorRank = rankOf(vectorRanking, id);
		const score = [keywordRank, vectorRank].reduce<number>((sum, rank) => (rank === undefined ? sum : sum + 1 / (k + rank)), 0);
		return { id, keywordRank, vectorRank, score, readOrder: index };
	});
}

const bySortedScore = (a: FusedDocument, b: FusedDocument) => b.score - a.score || a.readOrder - b.readOrder;

function scoreNarration(document: FusedDocument, k: number) {
	const term = (list: string, rank?: number) => (rank === undefined ? `not in the ${list} list, adds 0` : `rank ${rank} in ${list} → 1/(${k} + ${rank})`);
	return `<b>${document.id}</b>: ${term('keyword', document.keywordRank)}; ${term('vector', document.vectorRank)}. Fused score = <b>${formatScore(document.score)}</b>.`;
}

const hasTies = (sorted: FusedDocument[]) => sorted.some((document, index) => index > 0 && Math.abs(document.score - sorted[index - 1].score) < 1e-12);

function sortedNarration(sorted: FusedDocument[], k: number) {
	const [top] = sorted;
	const inBoth = top.keywordRank !== undefined && top.vectorRank !== undefined;
	const reason = inBoth ? `${top.id} comes first: both searches found it, and the two terms add up.` : `${top.id} comes first on its rank in one list.`;
	const kEffect = `A larger k (here ${k}) shrinks the gap between neighboring ranks, so documents both lists agree on gain weight over a single first place.`;
	const ties = hasTies(sorted) ? ' Tied scores keep the order they were read in.' : '';
	return `Sort by fused score: ${sorted.map((document) => document.id).join(', ')}. ${reason} ${kEffect}${ties}`;
}

function buildSteps(input: HybridInput): HybridStep[] {
	const documents = fusedDocuments(input);
	const query = input.query ? `"${input.query}"` : 'one query';
	const readout = { documents: documents.length, 'RRF k': input.k };
	const steps: HybridStep[] = [
		{
			phase: 'lists',
			scoredCount: 0,
			readout,
			narration: `Both searches ran on ${query}, and each returned its own top results (the rankings here are illustrative). Keyword search (BM25) ranks by the query words a document contains; vector search ranks by meaning. Their scores use different scales, so Reciprocal Rank Fusion ignores the scores and uses only each document's rank: score = Σ 1/(k + rank).`,
		},
	];
	documents.forEach((document, index) =>
		steps.push({
			phase: 'score',
			scoredCount: index + 1,
			readout,
			narration: scoreNarration(document, input.k),
		}),
	);
	steps.push({
		phase: 'sorted',
		scoredCount: documents.length,
		readout,
		narration: sortedNarration([...documents].sort(bySortedScore), input.k),
	});
	return steps;
}

function RankingsScene({ input, step: { phase, scoredCount } }: HybridSceneProps) {
	const documents = fusedDocuments(input);
	const sortedIds = [...documents].sort(bySortedScore).map((document) => document.id);
	const current = phase === 'score' ? documents[scoredCount - 1] : undefined;
	const columns = Math.max(documents.length, input.keywordRanking.length, input.vectorRanking.length);

	const listTone = (id: DocumentId): CellTone => (current?.id === id ? 'focus' : 'plain');
	const fusedColumn = (document: FusedDocument) => (phase === 'sorted' ? sortedIds.indexOf(document.id) : document.readOrder);
	const fusedTone = (document: FusedDocument): CellTone => {
		if (phase === 'sorted') return sortedIds[0] === document.id ? 'add' : 'plain';
		return current?.id === document.id ? 'focus' : 'plain';
	};
	const sourceOf = (document: FusedDocument) =>
		document.keywordRank !== undefined
			? { column: document.keywordRank - 1, top: KEYWORD_TOP }
			: { column: document.vectorRank! - 1, top: VECTOR_TOP };

	return (
		<Canvas columns={columns} height={SCENE_HEIGHT}>
			<RowLabel top={KEYWORD_TOP + 16}>keyword</RowLabel>
			<RowLabel top={VECTOR_TOP + 16}>vector</RowLabel>
			<RowLabel top={FUSED_TOP + 16}>fused</RowLabel>

			{input.keywordRanking.map((id, index) => [
				<Cell key={`keyword-${id}`} value={id} column={index} top={KEYWORD_TOP} tone={listTone(id)} />,
				<SubLabel key={`keyword-rank-${index}`} column={index} top={KEYWORD_TOP + 58}>
					rank {index + 1}
				</SubLabel>,
			])}
			{input.vectorRanking.map((id, index) => [
				<Cell key={`vector-${id}`} value={id} column={index} top={VECTOR_TOP} tone={listTone(id)} />,
				<SubLabel key={`vector-rank-${index}`} column={index} top={VECTOR_TOP + 58}>
					rank {index + 1}
				</SubLabel>,
			])}

			{documents.map((document) => {
				const scored = document.readOrder < scoredCount;
				const position = scored ? { column: fusedColumn(document), top: FUSED_TOP } : sourceOf(document);
				return [
					<Cell
						key={`fused-${document.id}`}
						value={document.id}
						column={position.column}
						top={position.top}
						tone={fusedTone(document)}
						hidden={!scored}
					/>,
					<SubLabel key={`fused-score-${document.id}`} column={position.column} top={FUSED_TOP + 58} hidden={!scored}>
						{formatScore(document.score)}
					</SubLabel>,
				];
			})}
		</Canvas>
	);
}

function DocumentTitles({ input }: HybridSceneProps) {
	if (!input.titles) return null;
	const titles = input.titles;
	const chips: Chip[] = fusedDocuments(input).map((document) => ({
		label: `${document.id} · ${titles[document.id] ?? ''}`,
		state: 'plain',
	}));
	return <Chips chips={chips} />;
}

function parseRanking(raw: string, list: string): DocumentId[] | string {
	const ids = raw.split(/[\s,]+/).filter(Boolean);
	if (ids.length === 0 || ids.length > MAX_RANKING_LENGTH) return `Enter 1 to ${MAX_RANKING_LENGTH} document ids for the ${list} list.`;
	if (ids.some((id) => id.length > MAX_ID_LENGTH)) return `Keep each id to ${MAX_ID_LENGTH} characters, e.g. D1.`;
	if (new Set(ids).size !== ids.length) return `The ${list} list names a document twice; a ranking lists each once.`;
	return ids;
}

const supportTitles = {
	D1: 'E-1042: session token expired',
	D2: 'Error code reference',
	D3: "Can't sign in after a password change",
	D4: 'Login page redesign notes',
	D5: 'Fixing sign-in failures',
};

export default defineExplainer<HybridInput, HybridStep>({
	title: 'Hybrid search: fuse two rankings',
	stages: [
		{
			title: 'Reciprocal Rank Fusion',
			subtitle: 'The top rows are the results of two searches on the same query. Each document scores Σ 1/(k + rank) over the lists it appears in, where k is a constant, not a result count; the fused row sorts by that score.',
			Scene: RankingsScene,
			Footer: DocumentTitles,
		},
	],
	examples: [
		{
			input: {
				query: 'error E-1042 on login',
				titles: supportTitles,
				keywordRanking: ['D1', 'D2', 'D4'],
				vectorRanking: ['D3', 'D5', 'D1'],
				k: DEFAULT_K,
			},
			note: 'Support search (illustrative)',
		},
		{
			input: { keywordRanking: ['D1', 'D2', 'D3'], vectorRanking: ['D4', 'D2', 'D3'], k: DEFAULT_K },
			note: 'Agreement beats first place',
		},
	],
	fields: [
		{ name: 'keyword', label: 'keyword results', placeholder: 'e.g. D1 D2 D4' },
		{ name: 'vector', label: 'vector results', placeholder: 'e.g. D3 D5 D1' },
		{ name: 'k', label: 'RRF k', placeholder: String(DEFAULT_K) },
	],
	describe: ({ keywordRanking, vectorRanking, k }) => `keyword ${keywordRanking.join(' ')} · vector ${vectorRanking.join(' ')} · RRF k ${k}`,
	parse(values) {
		const keywordRanking = parseRanking(values.keyword, 'keyword');
		if (typeof keywordRanking === 'string') return { error: keywordRanking };
		const vectorRanking = parseRanking(values.vector, 'vector');
		if (typeof vectorRanking === 'string') return { error: vectorRanking };
		const k = values.k === '' ? DEFAULT_K : Number(values.k);
		if (!Number.isInteger(k) || k < 0 || k > 1000) return { error: 'k is a whole number from 0 to 1000; leave it blank for 60.' };
		return { input: { keywordRanking, vectorRanking, k } };
	},
	steps: buildSteps,
});
