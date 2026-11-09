import { Canvas, Cell, Frame, RowLabel, SceneNote, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Vector = number[];
type Matrix = Vector[];

interface AttentionInput {
	tokens: string[];
	queries: Matrix;
	keys: Matrix;
	values: Matrix;
	causal: boolean;
}

type Phase = 'inputs' | 'scores' | 'scaled' | 'weights' | 'outputs' | 'summary';

interface AttentionStep extends Step {
	phase: Phase;
	row: number;
}

type AttentionSceneProps = SceneProps<AttentionInput, AttentionStep>;

interface Attention {
	scores: Matrix;
	scaled: Matrix;
	exponentials: Matrix;
	weights: Matrix;
	outputs: Matrix;
	scale: number;
}

const MIN_TOKENS = 2;
const MAX_TOKENS = 4;
const MAX_DIMENSIONS = 3;
const MAX_ABS_VALUE = 5;
const MAX_TOKEN_LENGTH = 6;

const CELL_PITCH_Y = 62;
const INPUT_TOP = 40;
const TITLE_OFFSET = 26;
const GRID_TITLE_OFFSET = 52;
const GRID_GAP = 80;

const dot = (a: Vector, b: Vector) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const isMasked = (causal: boolean, queryIndex: number, keyIndex: number) => causal && keyIndex > queryIndex;

function computeAttention({ queries, keys, values, causal }: AttentionInput): Attention {
	const scale = Math.sqrt(queries[0].length);
	const scores = queries.map((query) => keys.map((key) => dot(query, key)));
	const scaled = scores.map((row, i) => row.map((score, j) => (isMasked(causal, i, j) ? -Infinity : score / scale)));
	const exponentials = scaled.map((row) => row.map(Math.exp));
	const weights = exponentials.map((row) => {
		const total = row.reduce((sum, value) => sum + value, 0);
		return row.map((value) => value / total);
	});
	const outputs = weights.map((row) => values[0].map((_, column) => row.reduce((sum, weight, j) => sum + weight * values[j][column], 0)));
	return { scores, scaled, exponentials, weights, outputs, scale };
}

const precise = (value: number) => (value === -Infinity ? '−∞' : value.toFixed(2));
const vectorText = (vector: Vector) => `[${vector.map(precise).join(', ')}]`;
const inputText = (vector: Vector) => `[${vector.join(', ')}]`;

function cellText(value: number): string {
	if (value === -Infinity) return '−∞';
	if (Number.isInteger(value) && Math.abs(value) < 100) return String(value);
	if (Math.abs(value) >= 10) return value < 0 ? value.toFixed(0) : value.toFixed(1);
	return value < 0 ? value.toFixed(1) : value.toFixed(2);
}

function scoresNarration(input: AttentionInput, attention: Attention, row: number) {
	const token = input.tokens[row];
	const query = input.queries[row];
	const terms = input.keys.map((key, j) => {
		const product = query.map((value, c) => `${value}×${key[c]}`).join(' + ');
		const masked = isMasked(input.causal, row, j) ? ` — but ${input.tokens[j]} comes later, so the causal mask hides it` : '';
		return `q·k<sub>${input.tokens[j]}</sub> = ${product} = <b>${precise(attention.scores[row][j])}</b>${masked}`;
	});
	return `Row <b>${token}</b>: take its query ${inputText(query)} and take the dot product with every key. ${terms.join('; ')}. A larger dot product means that key matches what this query is looking for.`;
}

function scaledNarration(input: AttentionInput, attention: Attention) {
	const dimensions = input.queries[0].length;
	const masking = input.causal ? ' Masked cells become −∞, so softmax will give them weight 0.' : '';
	return `Divide every score by √d<sub>k</sub> = √${dimensions} = ${precise(attention.scale)}. Dot products grow with the vector length d<sub>k</sub>; unscaled, large scores push softmax toward giving one key all the weight, and training slows.${masking}`;
}

const TIE_TOLERANCE = 1e-9;

function strongestKeys(weights: Vector): number[] {
	const top = Math.max(...weights);
	return weights.flatMap((weight, j) => (top - weight < TIE_TOLERANCE ? [j] : []));
}

const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

function focusSentence(input: AttentionInput, weights: Vector, row: number) {
	const strongest = strongestKeys(weights);
	const visibleCount = weights.filter((_, j) => !isMasked(input.causal, row, j)).length;
	const token = `<b>${input.tokens[row]}</b>`;
	if (visibleCount === 1) return `${token} can see only itself, so all its weight lands there.`;
	if (strongest.length === visibleCount) return `${token} spreads its attention evenly over the ${visibleCount} tokens it can see.`;
	return `${token} attends most to <b>${joinNames(strongest.map((j) => input.tokens[j]))}</b>.`;
}

function roundingNote(weights: Vector) {
	const shownSum = weights.reduce((sum, weight) => sum + Number(weight.toFixed(2)), 0);
	return Math.abs(shownSum - 1) < TIE_TOLERANCE ? '' : ` (the rounded values show ${shownSum.toFixed(2)})`;
}

function weightsNarration(input: AttentionInput, attention: Attention, row: number) {
	const exponentials = attention.exponentials[row];
	const total = exponentials.reduce((sum, value) => sum + value, 0);
	const exponentialTerms = attention.scaled[row].map((value, j) => (value === -Infinity ? 'e<sup>−∞</sup> = 0' : `e<sup>${precise(value)}</sup> = ${precise(exponentials[j])}`));
	const weights = attention.weights[row];
	return `Softmax over row <b>${input.tokens[row]}</b>: ${exponentialTerms.join(', ')}; their sum is ${precise(total)}. Divide each by the sum: weights ${weights.map(precise).join(', ')}, which add up to 1${roundingNote(weights)}. ${focusSentence(input, weights, row)}`;
}

function outputsNarration(input: AttentionInput, attention: Attention, row: number) {
	const weights = attention.weights[row];
	const terms = input.values.map((value, j) => `${precise(weights[j])} × ${inputText(value)}`);
	return `Output for <b>${input.tokens[row]}</b> = the weighted sum of the value rows: ${terms.join(' + ')} = <b>${vectorText(attention.outputs[row])}</b>.`;
}

function summaryNarration(input: AttentionInput, attention: Attention) {
	const last = input.tokens.length - 1;
	const weights = attention.weights[last];
	const strongest = strongestKeys(weights);
	const lastToken = `The last token, <b>${input.tokens[last]}</b>,`;
	const output = vectorText(attention.outputs[last]);
	const strongestNames = joinNames(strongest.map((j) => input.tokens[j]));
	const focus =
		strongest.length === weights.length
			? `${lastToken} spreads its weight evenly, so its output ${output} is the plain average of the values: when every key scores the same, attention cannot single out a token.`
			: strongest.length === 1
				? `${lastToken} puts ${precise(weights[strongest[0]])} of its weight on <b>${strongestNames}</b>, so its output ${output} is pulled toward ${strongestNames}'s value ${inputText(input.values[strongest[0]])}.`
				: `${lastToken} gives its largest weight, ${precise(weights[strongest[0]])}, to each of <b>${strongestNames}</b>, so its output ${output} is pulled toward their values.`;
	const causal = input.causal ? ' With the causal mask, every token mixed in only itself and earlier tokens, as in a decoder-only model generating left to right.' : '';
	return `Each output row is a new vector for its token: a blend of all the values, weighted by how well the token's query matched each key. ${focus}${causal} A real layer runs this in h heads at once, each with its own learned W<sub>Q</sub>, W<sub>K</sub>, W<sub>V</sub>.`;
}

function buildSteps(input: AttentionInput): AttentionStep[] {
	const attention = computeAttention(input);
	const dimensions = input.queries[0].length;
	const tokenCount = input.tokens.length;
	const readout = (phase: Phase, row?: number) => ({
		stage: phase,
		row: row === undefined ? '–' : input.tokens[row],
		'd_k': dimensions,
		'√d_k': precise(attention.scale),
	});
	const steps: AttentionStep[] = [
		{
			phase: 'inputs',
			row: -1,
			readout: readout('inputs'),
			narration: `${tokenCount} tokens, each already projected into a query, a key, and a value of d<sub>k</sub> = ${dimensions} numbers. In a real model Q = XW<sub>Q</sub>, K = XW<sub>K</sub>, V = XW<sub>V</sub>: the token embeddings X times three learned matrices. Attention(Q, K, V) = softmax(QK<sup>T</sup> / √d<sub>k</sub>) V gives every token a new vector mixed from all the values.`,
		},
	];
	input.tokens.forEach((_, row) => steps.push({ phase: 'scores', row, readout: readout('scores', row), narration: scoresNarration(input, attention, row) }));
	steps.push({ phase: 'scaled', row: -1, readout: readout('scaled'), narration: scaledNarration(input, attention) });
	input.tokens.forEach((_, row) => steps.push({ phase: 'weights', row, readout: readout('weights', row), narration: weightsNarration(input, attention, row) }));
	input.tokens.forEach((_, row) => steps.push({ phase: 'outputs', row, readout: readout('outputs', row), narration: outputsNarration(input, attention, row) }));
	steps.push({ phase: 'summary', row: -1, readout: readout('summary'), narration: summaryNarration(input, attention) });
	return steps;
}

interface Layout {
	queryStart: number;
	keyStart: number;
	valueStart: number;
	columns: number;
	gridTop: number;
	height: number;
}

function layoutOf({ tokens, queries }: AttentionInput): Layout {
	const dimensions = queries[0].length;
	const valueStart = Math.max(2 * dimensions + 2, tokens.length + 1);
	const gridTop = INPUT_TOP + tokens.length * CELL_PITCH_Y + GRID_GAP;
	return {
		queryStart: 0,
		keyStart: dimensions + 1,
		valueStart,
		columns: valueStart + dimensions,
		gridTop,
		height: gridTop + tokens.length * CELL_PITCH_Y + 24,
	};
}

const rowTop = (top: number, row: number) => top + row * CELL_PITCH_Y;

type GridStage = 'hidden' | 'score' | 'scaled' | 'weight';

function gridStageOf({ phase, row }: AttentionStep, cellRow: number): GridStage {
	switch (phase) {
		case 'inputs':
			return 'hidden';
		case 'scores':
			return cellRow <= row ? 'score' : 'hidden';
		case 'scaled':
			return 'scaled';
		case 'weights':
			return cellRow <= row ? 'weight' : 'scaled';
		default:
			return 'weight';
	}
}

function gridValue(attention: Attention, stage: GridStage, i: number, j: number, causal: boolean): number {
	if (stage === 'weight') return attention.weights[i][j];
	if (isMasked(causal, i, j)) return -Infinity;
	return stage === 'scaled' ? attention.scaled[i][j] : attention.scores[i][j];
}

const gridTitles: Record<Phase, string> = {
	inputs: 'scores',
	scores: 'scores = QKᵀ',
	scaled: 'scaled = QKᵀ / √dₖ',
	weights: 'weights = softmax(row)',
	outputs: 'weights',
	summary: 'weights',
};

function AttentionScene({ input, step }: AttentionSceneProps) {
	const attention = computeAttention(input);
	const layout = layoutOf(input);
	const { phase, row } = step;
	const strongestKey = attention.weights.map((weights) => weights.indexOf(Math.max(...weights)));

	const queryTone = (i: number): CellTone => (phase === 'scores' && i === row ? 'focus' : 'plain');
	const keyTone: CellTone = phase === 'scores' ? 'focus' : 'plain';
	const valueTone: CellTone = phase === 'outputs' ? 'focus' : 'plain';
	const gridTone = (i: number, j: number): CellTone => {
		if (isMasked(input.causal, i, j) && phase !== 'inputs') return 'remove';
		if (phase === 'summary') return strongestKey[i] === j ? 'add' : 'plain';
		return i === row ? 'focus' : 'plain';
	};
	const outputShown = (i: number) => phase === 'summary' || (phase === 'outputs' && i <= row);
	const framedRow = phase === 'scores' || phase === 'weights' || phase === 'outputs' ? row : -1;

	const matrixCells = (prefix: string, matrix: Matrix, start: number, tone: (i: number) => CellTone) =>
		matrix.flatMap((vector, i) => vector.map((value, c) => <Cell key={`${prefix}-${i}-${c}`} value={cellText(value)} column={start + c} top={rowTop(INPUT_TOP, i)} tone={tone(i)} />));

	return (
		<Canvas columns={layout.columns} height={layout.height}>
			<SceneNote column={layout.queryStart} top={INPUT_TOP - TITLE_OFFSET}>
				Q · queries
			</SceneNote>
			<SceneNote column={layout.keyStart} top={INPUT_TOP - TITLE_OFFSET}>
				K · keys
			</SceneNote>
			<SceneNote column={layout.valueStart} top={INPUT_TOP - TITLE_OFFSET}>
				V · values
			</SceneNote>
			<SceneNote column={0} top={layout.gridTop - GRID_TITLE_OFFSET}>
				{gridTitles[phase]}
			</SceneNote>
			<SceneNote column={layout.valueStart} top={layout.gridTop - GRID_TITLE_OFFSET}>
				output = weights × V
			</SceneNote>
			{framedRow >= 0 && <Frame startColumn={0} columns={input.tokens.length} top={rowTop(layout.gridTop, framedRow) - 8} label={`query ${input.tokens[framedRow]}`} />}

			{input.tokens.map((token, i) => [
				<RowLabel key={`input-label-${i}`} top={rowTop(INPUT_TOP, i) + 16}>
					{token}
				</RowLabel>,
				<RowLabel key={`grid-label-${i}`} top={rowTop(layout.gridTop, i) + 16}>
					{token}
				</RowLabel>,
				<SubLabel key={`key-name-${i}`} column={i} top={rowTop(layout.gridTop, input.tokens.length) - 4}>
					key {token}
				</SubLabel>,
			])}

			{matrixCells('query', input.queries, layout.queryStart, queryTone)}
			{matrixCells('key', input.keys, layout.keyStart, () => keyTone)}
			{matrixCells('value', input.values, layout.valueStart, () => valueTone)}

			{input.tokens.flatMap((_, i) =>
				input.tokens.map((__, j) => {
					const stage = gridStageOf(step, i);
					return (
						<Cell
							key={`grid-${i}-${j}`}
							value={stage === 'hidden' ? '' : cellText(gridValue(attention, stage, i, j, input.causal))}
							column={j}
							top={rowTop(layout.gridTop, i)}
							tone={gridTone(i, j)}
							hidden={stage === 'hidden'}
						/>
					);
				}),
			)}

			{attention.outputs.flatMap((vector, i) =>
				vector.map((value, c) => {
					const shown = outputShown(i);
					return (
						<Cell
							key={`output-${i}-${c}`}
							value={cellText(value)}
							column={layout.valueStart + c}
							top={shown ? rowTop(layout.gridTop, i) : rowTop(INPUT_TOP, i)}
							tone={phase === 'outputs' && i === row ? 'add' : 'plain'}
							hidden={!shown}
						/>
					);
				}),
			)}
		</Canvas>
	);
}

function parseTokens(raw: string): string[] | string {
	const tokens = raw.split(/[\s,]+/).filter(Boolean);
	if (tokens.length < MIN_TOKENS || tokens.length > MAX_TOKENS) return `Enter ${MIN_TOKENS} to ${MAX_TOKENS} tokens, e.g. cat sat it.`;
	if (tokens.some((token) => token.length > MAX_TOKEN_LENGTH)) return `Keep each token to ${MAX_TOKEN_LENGTH} characters.`;
	if (new Set(tokens).size !== tokens.length) return 'Give each token a different name, so the rows can be told apart.';
	return tokens;
}

function parseMatrix(raw: string, name: string, tokenCount: number): Matrix | string {
	const rows = raw
		.split(/[;|]/)
		.map((row) => row.trim())
		.filter(Boolean)
		.map((row) => row.split(/[\s,]+/).filter(Boolean).map(Number));
	if (rows.length !== tokenCount) return `${name} needs one row per token (${tokenCount}), separated by ";", e.g. 1 0; 0 1; 2 0.`;
	const dimensions = rows[0].length;
	if (dimensions < 1 || dimensions > MAX_DIMENSIONS) return `${name}: each row holds 1 to ${MAX_DIMENSIONS} numbers.`;
	if (rows.some((row) => row.length !== dimensions)) return `${name}: every row needs the same number of values.`;
	if (rows.some((row) => row.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_ABS_VALUE))) return `${name}: every value is a number from −${MAX_ABS_VALUE} to ${MAX_ABS_VALUE}.`;
	return rows;
}

function parseMask(raw: string): boolean | string {
	const mask = raw.trim().toLowerCase();
	if (mask === '' || mask === 'none') return false;
	if (mask === 'causal') return true;
	return 'Mask is "causal" or "none" (blank means none).';
}

export default defineExplainer<AttentionInput, AttentionStep>({
	title: 'Scaled dot-product attention, step by step',
	stages: [
		{
			title: 'softmax(QKᵀ / √dₖ) V on a few tokens',
			subtitle: 'Top: each token\'s query, key, and value vectors. Bottom left: one row per query token, one column per key token — raw scores, then scaled scores, then softmax weights. Bottom right: each token\'s output vector.',
			Scene: AttentionScene,
		},
	],
	examples: [
		{
			input: {
				tokens: ['cat', 'sat', 'it'],
				queries: [
					[1, 0],
					[0, 1],
					[2, 0],
				],
				keys: [
					[2, 0],
					[0, 1],
					[1, 1],
				],
				values: [
					[1, 0],
					[0, 1],
					[0.5, 0.5],
				],
				causal: false,
			},
			note: '"it" looks back at "cat"',
		},
		{
			input: {
				tokens: ['cat', 'sat', 'it'],
				queries: [
					[1, 0],
					[0, 1],
					[2, 0],
				],
				keys: [
					[2, 0],
					[0, 1],
					[1, 1],
				],
				values: [
					[1, 0],
					[0, 1],
					[0.5, 0.5],
				],
				causal: true,
			},
			note: 'Same tokens, causal mask (decoder-only)',
		},
		{
			input: {
				tokens: ['a', 'b', 'c'],
				queries: [
					[1, 1],
					[1, 1],
					[1, 1],
				],
				keys: [
					[1, 0],
					[1, 0],
					[1, 0],
				],
				values: [
					[3, 0],
					[0, 3],
					[0, 0],
				],
				causal: false,
			},
			note: 'Identical keys: attention spreads evenly',
		},
	],
	fields: [
		{ name: 'tokens', label: 'tokens', placeholder: 'e.g. cat sat it' },
		{ name: 'queries', label: 'Q rows', placeholder: 'e.g. 1 0; 0 1; 2 0' },
		{ name: 'keys', label: 'K rows', placeholder: 'e.g. 2 0; 0 1; 1 1' },
		{ name: 'values', label: 'V rows', placeholder: 'e.g. 1 0; 0 1; 0.5 0.5' },
		{ name: 'mask', label: 'mask', placeholder: 'none or causal' },
	],
	describe: ({ tokens, queries, keys, values, causal }) =>
		`${tokens.join(' ')} · Q ${queries.map(inputText).join(' ')} · K ${keys.map(inputText).join(' ')} · V ${values.map(inputText).join(' ')}${causal ? ' · causal' : ''}`,
	parse(values) {
		const tokens = parseTokens(values.tokens ?? '');
		if (typeof tokens === 'string') return { error: tokens };
		const queries = parseMatrix(values.queries ?? '', 'Q', tokens.length);
		if (typeof queries === 'string') return { error: queries };
		const keys = parseMatrix(values.keys ?? '', 'K', tokens.length);
		if (typeof keys === 'string') return { error: keys };
		if (keys[0].length !== queries[0].length) return { error: 'Q and K rows need the same length: a query is dotted with each key.' };
		const valueRows = parseMatrix(values.values ?? '', 'V', tokens.length);
		if (typeof valueRows === 'string') return { error: valueRows };
		if (valueRows[0].length !== queries[0].length) return { error: 'Keep V rows the same length as Q and K rows, so the scene fits.' };
		const causal = parseMask(values.mask ?? '');
		if (typeof causal === 'string') return { error: causal };
		return { input: { tokens, queries, keys, values: valueRows, causal } };
	},
	steps: buildSteps,
});
