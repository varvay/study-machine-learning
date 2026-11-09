import { Canvas, Cell, ColumnMarker, Plane, RowLabel, SubLabel, columnLeft, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface AttentionInput {
	tokens: string[];
	queryIndex: number;
	scores: number[];
	lesson?: string;
}

type Phase = 'sentence' | 'scores' | 'weights' | 'mix';

interface AttentionStep extends Step {
	phase: Phase;
}

type AttentionSceneProps = SceneProps<AttentionInput, AttentionStep>;

interface WeightedToken {
	token: string;
	index: number;
	weight: number;
}

const MIN_TOKENS = 2;
const MAX_TOKENS = 12;
const MAX_TOKEN_LENGTH = 9;
const MIN_SCORE = -5;
const MAX_SCORE = 10;
const LISTED_IN_MIX = 3;
const DIMMED_BELOW = 0.05;

const BAR_TOP = 30;
const BAR_MAX_HEIGHT = 100;
const BAR_WIDTH = 38;
const CELL_TOP = BAR_TOP + BAR_MAX_HEIGHT + 14;
const WORD_TOP = CELL_TOP + 62;
const SCENE_HEIGHT = WORD_TOP + 30;

function softmax(scores: number[]): number[] {
	const highest = Math.max(...scores);
	const exponentials = scores.map((score) => Math.exp(score - highest));
	const total = exponentials.reduce((sum, value) => sum + value, 0);
	return exponentials.map((value) => value / total);
}

const percent = (weight: number) => `${Math.round(weight * 100)}%`;
const quoted = (token: string) => `"${token}"`;
const formatScore = (score: number) => score.toFixed(1);

function rankedTokens({ tokens, scores }: AttentionInput): WeightedToken[] {
	const weights = softmax(scores);
	return tokens.map((token, index) => ({ token, index, weight: weights[index] })).sort((a, b) => b.weight - a.weight || a.index - b.index);
}

function leadersOf(input: AttentionInput): WeightedToken[] {
	const ranked = rankedTokens(input);
	return ranked.filter((each) => input.scores[each.index] === input.scores[ranked[0].index]);
}

const quotedList = (tokens: WeightedToken[]) => tokens.map(({ token }) => quoted(token)).join(', ');

function sentenceNarration({ tokens, queryIndex }: AttentionInput) {
	const query = quoted(tokens[queryIndex]);
	return `Before attention, each token's vector (its embedding plus its position) describes that token alone: the vector for ${query} is the same in every sentence, apart from its position. Self-attention mixes in the context. It runs for every token at once; this walkthrough follows one of them, ${query}.`;
}

function scoresNarration(input: AttentionInput) {
	const query = quoted(input.tokens[input.queryIndex]);
	const leaders = leadersOf(input);
	const highest = formatScore(input.scores[leaders[0].index]);
	const verdict = leaders.length === 1 ? `${quoted(leaders[0].token)} scores highest, ${highest}.` : `${quotedList(leaders)} tie for the highest score, ${highest}.`;
	return `${query} compares itself with every token in the sentence, itself included, and gets one relevance score per token: higher means more relevant to ${query}. A trained model computes these scores from weights it learned (G3.1 L2); the scores here are made up for illustration. ${verdict}`;
}

function weightsNarration(input: AttentionInput) {
	const rule = 'The scores become weights through softmax: raise e to each score, then divide by the total. Every weight is positive and together they add up to 100%.';
	const [first, second] = rankedTokens(input);
	const gap = input.scores[first.index] - input.scores[second.index];
	if (gap === 0) return `${rule} Equal scores get equal weights: ${quotedList(leadersOf(input))} each get ${percent(first.weight)}.`;
	const comparison = `${quoted(first.token)} (score ${formatScore(input.scores[first.index])}) gets ${percent(first.weight)}, ${quoted(second.token)} (score ${formatScore(input.scores[second.index])}) gets ${percent(second.weight)}`;
	return `${rule} A score gap of 1 becomes a weight ratio of about 2.7, so the highest scores take most of the weight: ${comparison}, a ratio of ${Math.exp(gap).toFixed(1)} for a gap of ${formatScore(gap)}.`;
}

function mixNarration(input: AttentionInput) {
	const query = quoted(input.tokens[input.queryIndex]);
	const ranked = rankedTokens(input);
	const listed = ranked.slice(0, LISTED_IN_MIX);
	const rest = ranked.slice(LISTED_IN_MIX);
	const terms = listed.map(({ token, weight }) => `${percent(weight)} of ${quoted(token)}`).join(' + ');
	const restWeight = rest.reduce((sum, { weight }) => sum + weight, 0);
	const restTerm = rest.length === 0 ? '' : ` + the other ${rest.length} tokens, ${percent(restWeight)} together`;
	const leaders = leadersOf(input);
	const source =
		leaders.length === 1
			? `The largest share comes from ${quoted(leaders[0].token)}, so after this layer the vector for ${query} carries much of ${quoted(leaders[0].token)}'s meaning.`
			: `${quotedList(leaders)} share the largest weight equally, so the vector for ${query} takes in their meanings evenly.`;
	const lesson = input.lesson ? ` ${input.lesson}` : '';
	return `The new vector for ${query} is the weighted mix of all the tokens' vectors: ${terms}${restTerm}. ${source}${lesson}`;
}

function buildSteps(input: AttentionInput): AttentionStep[] {
	const query = input.tokens[input.queryIndex];
	const leaders = leadersOf(input);
	const hidden = { query, 'top token': '–', 'its weight': '–' };
	const shown = { query, 'top token': leaders.map(({ token }) => token).join(', '), 'its weight': percent(leaders[0].weight) };
	return [
		{ phase: 'sentence', readout: hidden, narration: sentenceNarration(input) },
		{ phase: 'scores', readout: hidden, narration: scoresNarration(input) },
		{ phase: 'weights', readout: shown, narration: weightsNarration(input) },
		{ phase: 'mix', readout: shown, narration: mixNarration(input) },
	];
}

function AttentionScene({ input, step: { phase } }: AttentionSceneProps) {
	const weights = softmax(input.scores);
	const leaderIndexes = new Set(leadersOf(input).map(({ index }) => index));
	const isHighlighted = (index: number) => phase === 'mix' && leaderIndexes.has(index);
	const showsWeights = phase === 'weights' || phase === 'mix';
	const cellValue = (index: number) => (showsWeights ? Math.round(weights[index] * 100) : formatScore(input.scores[index]));
	const cellTone = (index: number): CellTone => (isHighlighted(index) ? 'add' : 'plain');

	return (
		<Canvas columns={input.tokens.length} height={SCENE_HEIGHT}>
			<RowLabel top={CELL_TOP + 16} hidden={phase === 'sentence'}>
				{showsWeights ? 'weight %' : 'score'}
			</RowLabel>
			<RowLabel top={WORD_TOP}>token</RowLabel>
			<ColumnMarker column={input.queryIndex} top={BAR_TOP - 6} height={WORD_TOP - BAR_TOP + 30} label="following" />
			{showsWeights &&
				input.tokens.map((_, index) => {
					const height = Math.max(2, weights[index] * BAR_MAX_HEIGHT);
					return (
						<Plane
							key={`bar-${index}`}
							left={columnLeft(index) + 8}
							top={BAR_TOP + BAR_MAX_HEIGHT - height}
							width={BAR_WIDTH}
							height={height}
							label=""
							active={isHighlighted(index)}
						/>
					);
				})}
			{input.tokens.map((token, index) => [
				<Cell
					key={`cell-${index}`}
					value={cellValue(index)}
					column={index}
					top={CELL_TOP}
					tone={cellTone(index)}
					dimmed={phase === 'mix' && weights[index] < DIMMED_BELOW}
					hidden={phase === 'sentence'}
				/>,
				<SubLabel key={`token-${index}`} column={index} top={WORD_TOP}>
					{token}
				</SubLabel>,
			])}
		</Canvas>
	);
}

function parseTokens(raw: string): string[] | string {
	const tokens = raw.split(/\s+/).filter(Boolean);
	if (tokens.length < MIN_TOKENS || tokens.length > MAX_TOKENS) return `Enter ${MIN_TOKENS} to ${MAX_TOKENS} words, separated by spaces.`;
	if (tokens.some((token) => token.length > MAX_TOKEN_LENGTH)) return `Keep each word to ${MAX_TOKEN_LENGTH} characters so it fits under its cell.`;
	return tokens;
}

function parseScores(raw: string, count: number): number[] | string {
	const scores = raw.split(/[\s,]+/).filter(Boolean).map(Number);
	if (scores.length !== count) return `Give one score per word: ${count} words, ${scores.length} scores.`;
	if (scores.some((score) => !Number.isFinite(score) || score < MIN_SCORE || score > MAX_SCORE)) return `Scores are numbers from ${MIN_SCORE} to ${MAX_SCORE}.`;
	return scores;
}

export default defineExplainer<AttentionInput, AttentionStep>({
	title: 'Self-attention: what does "it" look at?',
	stages: [
		{
			title: 'One token attends to the whole sentence',
			subtitle: 'The outlined column is the token being followed. Each cell holds its relevance score, then its attention weight; the bars show the weights, which add up to 100%. Scores are illustrative.',
			Scene: AttentionScene,
		},
	],
	examples: [
		{
			input: {
				tokens: ['The', 'animal', "didn't", 'cross', 'the', 'street', 'because', 'it', 'was', 'too', 'tired'],
				queryIndex: 7,
				scores: [0.2, 4, 0.4, 0.8, 0.2, 2, 0.3, 1.5, 0.6, 0.2, 2.4],
				lesson: 'Animals get tired and streets do not, so the context points "it" at "animal".',
			},
			note: '"it" is the animal',
		},
		{
			input: {
				tokens: ['The', 'animal', "didn't", 'cross', 'the', 'street', 'because', 'it', 'was', 'too', 'wide'],
				queryIndex: 7,
				scores: [0.2, 2, 0.4, 0.8, 0.2, 4, 0.3, 1.5, 0.6, 0.2, 2.4],
				lesson: 'One word changed: streets are wide and animals are not, so the weight moves to "street".',
			},
			note: '"it" is the street',
		},
		{
			input: {
				tokens: ['She', 'sat', 'on', 'the', 'river', 'bank'],
				queryIndex: 5,
				scores: [0.5, 1.2, 0.8, 0.1, 3.5, 1.5],
				lesson: 'The same attention picks a meaning for an ambiguous word: next to "river", "bank" is a riverside, not a lender.',
			},
			note: '"bank" by a river',
		},
	],
	fields: [
		{ name: 'sentence', label: 'words', placeholder: 'e.g. She sat on the river bank' },
		{ name: 'query', label: 'word to follow', placeholder: 'e.g. bank' },
		{ name: 'scores', label: 'one score per word', placeholder: 'e.g. 0.5 1.2 0.8 0.1 3.5 1.5' },
	],
	describe: ({ tokens, queryIndex }) => `${tokens.join(' ')} · following "${tokens[queryIndex]}"`,
	parse(values) {
		const tokens = parseTokens(values.sentence);
		if (typeof tokens === 'string') return { error: tokens };
		const query = values.query.trim();
		const queryIndex = tokens.indexOf(query);
		if (query === '' || queryIndex < 0) return { error: 'The word to follow must be one of the words, spelled the same way.' };
		const scores = parseScores(values.scores, tokens.length);
		if (typeof scores === 'string') return { error: scores };
		return { input: { tokens, queryIndex, scores } };
	},
	steps: buildSteps,
});
