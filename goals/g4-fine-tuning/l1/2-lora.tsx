import { Canvas, Cell, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Vector = number[];
type Rank = 1 | 2;

interface LoraInput {
	x: Vector;
	rank: Rank;
}

type Phase = 'start' | 'detect' | 'write' | 'combine' | 'summary';

interface LoraStep extends Step {
	phase: Phase;
	pattern: number;
}

type LoraSceneProps = SceneProps<LoraInput, LoraStep>;

const WIDTH = 6;
const SCORE_COLUMN = 7;
const MIN_VALUE = -3;
const MAX_VALUE = 3;

const FROZEN_W: Vector[] = [
	[1, 0.5, 0, 0, 0, 0],
	[0, 1, 0.5, 0, 0, 0],
	[0, 0, 1, 0.5, 0, 0],
	[0, 0, 0, 1, 0.5, 0],
	[0, 0, 0, 0, 1, 0.5],
	[0.5, 0, 0, 0, 0, 1],
];

const A_ROWS: Vector[] = [
	[1, 1, 0, 0, 0, 0],
	[0, 0, 1, -1, 0, 0],
];

const B_COLUMNS: Vector[] = [
	[0, 0, 0, 0, 0.5, -0.5],
	[0.5, 0, 0, 0, 0, 0],
];

const PATTERN_MEANING = ['d1 and d2 high together', 'd3 above d4'];

const dot = (a: Vector, b: Vector) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const multiply = (matrix: Vector[], vector: Vector) => matrix.map((row) => dot(row, vector));
const scaled = (vector: Vector, factor: number) => vector.map((value) => value * factor);
const added = (a: Vector, b: Vector) => a.map((value, index) => value + b[index]);
const zeros = (): Vector => Array.from({ length: WIDTH }, () => 0);
const format = (value: number) => {
	const rounded = Math.round(value * 100) / 100;
	return Object.is(rounded, -0) ? '0' : String(rounded);
};
const term = (value: number) => (value < 0 ? `(${format(value)})` : format(value));
const listOf = (vector: Vector) => `[${vector.map(format).join(', ')}]`;

function lora({ x, rank }: LoraInput) {
	const scores = A_ROWS.slice(0, rank).map((row) => dot(row, x));
	const correctionAfter = (patterns: number) =>
		scores.slice(0, patterns).reduce((correction, score, index) => added(correction, scaled(B_COLUMNS[index], score)), zeros());
	const frozen = multiply(FROZEN_W, x);
	const correction = correctionAfter(rank);
	return { scores, correctionAfter, frozen, correction, output: added(frozen, correction) };
}

function detectNarration(x: Vector, pattern: number, score: number) {
	const row = A_ROWS[pattern];
	const products = row.map((weight, index) => `${term(weight)}×${term(x[index])}`).join(' + ');
	const reading =
		score === 0
			? `0: x shows none of pattern ${pattern + 1}, so this pattern will add nothing.`
			: `${format(score)}: x contains pattern ${pattern + 1} with that strength.`;
	return `A's row ${pattern + 1} is a pattern detector, here "${PATTERN_MEANING[pattern]}". It works like one neuron (G2.4): multiply x by the row number by number and add up. ${products} = ${reading}`;
}

function writeNarration(pattern: number, score: number, correction: Vector) {
	const column = B_COLUMNS[pattern];
	if (score === 0) return `B's column ${pattern + 1} says what pattern ${pattern + 1} changes in the output: ${listOf(column)}. Scaled by a score of 0, it adds nothing. The correction stays ${listOf(correction)}.`;
	return `B's column ${pattern + 1} says what pattern ${pattern + 1} changes in the output: ${listOf(column)}. Scaled by the score ${format(score)}, it adds ${listOf(scaled(column, score))}. The correction is now ${listOf(correction)}.`;
}

function combineNarration(frozen: Vector, correction: Vector, output: Vector) {
	const changed = correction.filter((value) => value !== 0).length;
	if (changed === 0)
		return `Output h = Wx + correction = ${listOf(output)}, exactly what the frozen layer gave. x matched no pattern, so LoRA leaves it alone: the change targets only inputs that look like what the task needs.`;
	return `Output h = Wx + correction = ${listOf(frozen)} + ${listOf(correction)} = ${listOf(output)}. ${changed} of ${WIDTH} outputs changed, and only in the directions B chose. (The scale α/r is taken as 1 here.)`;
}

function buildSteps(input: LoraInput): LoraStep[] {
	const { scores, correctionAfter, frozen, correction, output } = lora(input);
	const readout = (patterns: number, showsOutput = false) => ({
		rank: input.rank,
		scores: scores.slice(0, patterns).map(format).join(' · ') || '–',
		'changed outputs': showsOutput ? correction.filter((value) => value !== 0).length : '–',
	});
	const steps: LoraStep[] = [
		{
			phase: 'start',
			pattern: -1,
			readout: readout(0),
			narration: `One frozen weight matrix W turns the input vector x into its output Wx (the "x input" and "Wx frozen" rows). LoRA adds a correction beside W, built from ${input.rank === 1 ? 'one pattern' : `${input.rank} patterns`}: each is a row of A, which detects the pattern in x, and a column of B, which says what to change when it is found. Training learns these numbers; here they are set by hand to show the mechanics.`,
		},
	];
	scores.forEach((score, pattern) => {
		steps.push({ phase: 'detect', pattern, readout: readout(pattern + 1), narration: detectNarration(input.x, pattern, score) });
		steps.push({ phase: 'write', pattern, readout: readout(pattern + 1), narration: writeNarration(pattern, score, correctionAfter(pattern + 1)) });
	});
	steps.push({ phase: 'combine', pattern: input.rank - 1, readout: readout(input.rank, true), narration: combineNarration(frozen, correction, output) });
	steps.push({
		phase: 'summary',
		pattern: input.rank - 1,
		readout: readout(input.rank, true),
		narration: `Doing this for every input is the same as adding one full-size matrix, B × A (${WIDTH} × ${WIDTH} = ${WIDTH * WIDTH} numbers), to W, which is why it can be merged in after training. Yet it was built from only ${input.rank} × (${WIDTH} + ${WIDTH}) = ${input.rank * 2 * WIDTH} trained numbers. The rank r is how many patterns the correction can detect and respond to. At real scale, a 4,096-wide matrix at rank 8 trains 65,536 numbers instead of 16,777,216.`,
	});
	return steps;
}

const HEADER_TOP = 18;
const FIRST_ROW_TOP = 40;
const ROW_PITCH = 64;

interface RowSpec {
	key: string;
	label: string;
	values: Vector;
	tone: (column: number) => CellTone;
	hidden: boolean;
	score?: { value: string; shown: boolean; tone: CellTone };
}

function LoraScene({ input, step: { phase, pattern } }: LoraSceneProps) {
	const { scores, correctionAfter, frozen, output } = lora(input);
	const patternsWritten = phase === 'start' ? 0 : phase === 'detect' ? pattern : phase === 'write' ? pattern + 1 : input.rank;
	const correction = correctionAfter(patternsWritten);
	const reached = (milestone: Phase) => ['start', 'detect', 'write', 'combine', 'summary'].indexOf(phase) >= ['start', 'detect', 'write', 'combine', 'summary'].indexOf(milestone);
	const isActive = (target: 'detect' | 'write', index: number) => phase === target && pattern === index;

	const rows: RowSpec[] = [
		{
			key: 'x',
			label: 'x input',
			values: input.x,
			tone: (column) => (phase === 'detect' && A_ROWS[pattern][column] !== 0 ? 'focus' : 'plain'),
			hidden: false,
		},
		...A_ROWS.slice(0, input.rank).map(
			(row, index): RowSpec => ({
				key: `a-${index}`,
				label: `A row ${index + 1}`,
				values: row,
				tone: (column) => (isActive('detect', index) && row[column] !== 0 ? 'focus' : 'plain'),
				hidden: false,
				score: {
					value: format(scores[index]),
					shown: patternsWritten > index || isActive('detect', index),
					tone: isActive('detect', index) || isActive('write', index) ? (scores[index] === 0 ? 'remove' : 'add') : 'plain',
				},
			}),
		),
		...B_COLUMNS.slice(0, input.rank).map(
			(column, index): RowSpec => ({
				key: `b-${index}`,
				label: `B col ${index + 1}`,
				values: column,
				tone: (cell) => (isActive('write', index) && column[cell] !== 0 ? 'focus' : 'plain'),
				hidden: false,
			}),
		),
		{
			key: 'correction',
			label: 'correction',
			values: correction,
			tone: (column) => (correction[column] !== 0 ? 'add' : 'plain'),
			hidden: false,
		},
		{ key: 'frozen', label: 'Wx frozen', values: frozen, tone: () => 'plain', hidden: false },
		{
			key: 'output',
			label: 'output h',
			values: output,
			tone: (column) => (output[column] !== frozen[column] ? 'add' : 'plain'),
			hidden: !reached('combine'),
		},
	];

	return (
		<Canvas columns={SCORE_COLUMN + 1} height={FIRST_ROW_TOP + rows.length * ROW_PITCH}>
			{Array.from({ length: WIDTH }, (_, column) => (
				<SubLabel key={`header-${column}`} column={column} top={HEADER_TOP}>
					d{column + 1}
				</SubLabel>
			))}
			<SubLabel key="header-score" column={SCORE_COLUMN} top={HEADER_TOP}>
				score
			</SubLabel>
			{rows.flatMap((row, rowIndex) => {
				const top = FIRST_ROW_TOP + rowIndex * ROW_PITCH;
				return [
					<RowLabel key={`label-${row.key}`} top={top + 16} hidden={row.hidden}>
						{row.label}
					</RowLabel>,
					...row.values.map((value, column) => (
						<Cell key={`${row.key}-${column}`} value={format(value)} column={column} top={top} tone={row.tone(column)} hidden={row.hidden} />
					)),
					...(row.score
						? [<Cell key={`${row.key}-score`} value={row.score.value} column={SCORE_COLUMN} top={top} tone={row.score.tone} hidden={!row.score.shown} />]
						: []),
				];
			})}
		</Canvas>
	);
}

function parseVector(raw: string): Vector | string {
	const values = raw
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (values.length !== WIDTH) return `Enter exactly ${WIDTH} numbers for x, one per dimension.`;
	if (values.some((value) => !Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE)) return `Keep each number between ${MIN_VALUE} and ${MAX_VALUE}.`;
	return values;
}

export default defineExplainer<LoraInput, LoraStep>({
	title: 'LoRA: a few pattern detectors beside a frozen layer',
	stages: [
		{
			title: 'Detect patterns in x, write corrections to the output',
			subtitle: "Each row of A scores how strongly the input contains one pattern; the matching column of B, scaled by that score, is added to the frozen layer's output. Green marks what the correction changed.",
			Scene: LoraScene,
		},
	],
	examples: [
		{ input: { x: [2, 1, 0, 0, 1, 0], rank: 1 }, note: 'Input matches the pattern' },
		{ input: { x: [0, 0, 2, 1, 1, 0], rank: 1 }, note: 'Input matches nothing: no change' },
		{ input: { x: [2, 1, 2, 1, 1, 0], rank: 2 }, note: 'Rank 2: two patterns' },
	],
	fields: [
		{ name: 'x', label: 'x (6 numbers)', placeholder: 'e.g. 2 1 0 0 1 0' },
		{ name: 'rank', label: 'rank r', placeholder: '1 or 2' },
	],
	describe: ({ x, rank }) => `x = [${x.join(', ')}], r = ${rank}`,
	parse(values) {
		const x = parseVector(values.x);
		if (typeof x === 'string') return { error: x };
		const rank = values.rank === '' ? 1 : Number(values.rank);
		if (rank !== 1 && rank !== 2) return { error: 'This walkthrough has two patterns, so r is 1 or 2.' };
		return { input: { x, rank } };
	},
	steps: buildSteps,
});
