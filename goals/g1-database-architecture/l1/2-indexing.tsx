import { Canvas, Cell, ColumnMarker, Frame, RowLabel, SceneNote, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface LookupInput {
	values: number[];
	target: number;
}

interface IndexEntry {
	value: number;
	row: number;
}

interface Probe {
	low: number;
	high: number;
	middle: number;
}

type Phase = 'intro' | 'search' | 'summary';

interface LookupStep extends Step {
	phase: Phase;
	reads: number;
}

type LookupSceneProps = SceneProps<LookupInput, LookupStep>;

const MIN_VALUES = 2;
const MAX_VALUES = 10;
const MAX_VALUE = 99;

const CELL_TOP = 40;
const SCENE_HEIGHT = 128;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const indexEntriesOf = (values: number[]): IndexEntry[] => values.map((value, row) => ({ value, row })).sort((a, b) => a.value - b.value);

function probesOf(entries: IndexEntry[], target: number): Probe[] {
	const probes: Probe[] = [];
	let low = 0;
	let high = entries.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		probes.push({ low, high, middle });
		const value = entries[middle].value;
		if (value === target) break;
		if (value < target) low = middle + 1;
		else high = middle - 1;
	}
	return probes;
}

function lookupOf({ values, target }: LookupInput) {
	const entries = indexEntriesOf(values);
	const probes = probesOf(entries, target);
	const lastProbe = probes.at(-1);
	const found = lastProbe !== undefined && entries[lastProbe.middle].value === target ? entries[lastProbe.middle] : undefined;
	return { entries, probes, found };
}

function scanNarration(values: number[], target: number, read: number) {
	const value = values[read - 1];
	return `Scan reads row ${read}: ${value}${value === target ? ' — a match' : ''}.`;
}

function indexNarration(entries: IndexEntry[], probes: Probe[], target: number, read: number, found?: IndexEntry) {
	if (read > probes.length) return `Index is done after ${plural(probes.length, 'read')}.`;
	const { middle } = probes[read - 1];
	const value = entries[middle].value;
	if (value === target) return `Index reads the middle of its range: ${value}, a match → row ${found!.row + 1}.`;
	const direction = value < target ? `${value} < ${target}, so it drops the left half` : `${value} > ${target}, so it drops the right half`;
	const exhausted = read === probes.length ? ' Nothing is left: no match.' : '';
	return `Index reads the middle of its range: ${direction}.${exhausted}`;
}

function buildSteps(input: LookupInput): LookupStep[] {
	const { values, target } = input;
	const { entries, probes, found } = lookupOf(input);
	const readoutAt = (reads: number) => ({ 'scan reads': reads, 'index reads': Math.min(reads, probes.length) });

	const steps: LookupStep[] = [
		{
			phase: 'intro',
			reads: 0,
			readout: readoutAt(0),
			narration: `Find the row where <code>value = ${target}</code>. Top: the table, in insert order. Bottom: an index with the same values sorted, each pointing to its row.`,
		},
	];
	for (let reads = 1; reads <= values.length; reads++) {
		steps.push({
			phase: 'search',
			reads,
			readout: readoutAt(reads),
			narration: `${scanNarration(values, target, reads)} ${indexNarration(entries, probes, target, reads, found)}`,
		});
	}
	steps.push({
		phase: 'summary',
		reads: values.length,
		readout: readoutAt(values.length),
		narration: `The scan read all ${values.length} rows: without an index, a match could sit in any row. The index read ${probes.length}. At a million rows, a scan reads a million; a sorted search reads about 20.`,
	});
	return steps;
}

function ScanScene({ input: { values, target }, step: { phase, reads } }: LookupSceneProps) {
	const current = phase === 'search' ? reads - 1 : -1;
	const toneAt = (row: number): CellTone => {
		if (row < reads && values[row] === target) return 'add';
		return row === current ? 'focus' : 'plain';
	};
	const dimmedAt = (row: number) => row < reads && row !== current && values[row] !== target;
	return (
		<Canvas columns={values.length} height={SCENE_HEIGHT}>
			<RowLabel top={CELL_TOP + 16}>table</RowLabel>
			<ColumnMarker column={Math.max(0, current)} top={CELL_TOP - 6} height={66} label="read" hidden={current < 0} />
			{values.map((value, row) => (
				<Cell key={row} value={value} column={row} top={CELL_TOP} tone={toneAt(row)} dimmed={dimmedAt(row)} />
			))}
			{values.map((_, row) => (
				<SubLabel key={row} column={row} top={CELL_TOP + 60}>
					row {row + 1}
				</SubLabel>
			))}
		</Canvas>
	);
}

function IndexScene({ input, step: { phase, reads } }: LookupSceneProps) {
	const { entries, probes, found } = lookupOf(input);
	const searching = phase === 'search' && reads <= probes.length;
	const probe = searching ? probes[reads - 1] : undefined;
	const finished = reads > 0 && !searching;

	const toneAt = (position: number): CellTone => {
		if (probe && position === probe.middle) return entries[position].value === input.target ? 'add' : 'focus';
		if (finished && found && entries[position] === found) return 'add';
		return 'plain';
	};
	const dimmedAt = (position: number) => {
		if (probe) return position < probe.low || position > probe.high;
		return finished && entries[position] !== found;
	};

	return (
		<Canvas columns={entries.length} height={SCENE_HEIGHT}>
			<RowLabel top={CELL_TOP + 16}>index</RowLabel>
			{probe && <Frame startColumn={probe.low} columns={probe.high - probe.low + 1} top={CELL_TOP - 8} label="search range" />}
			{entries.map((entry, position) => (
				<Cell key={entry.row} value={entry.value} column={position} top={CELL_TOP} tone={toneAt(position)} dimmed={dimmedAt(position)} />
			))}
			{entries.map((entry, position) => (
				<SubLabel key={entry.row} column={position} top={CELL_TOP + 60}>
					→ row {entry.row + 1}
				</SubLabel>
			))}
			<SceneNote column={0} top={CELL_TOP - 30} hidden={!(finished && !found)}>
				no match in the index
			</SceneNote>
		</Canvas>
	);
}

function parseNumbers(raw: string) {
	return raw
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
}

const isValidValue = (value: number) => Number.isInteger(value) && value >= 0 && value <= MAX_VALUE;

const sampleTable = [42, 7, 93, 15, 68, 31, 56, 24];

export default defineExplainer<LookupInput, LookupStep>({
	title: 'Sequential scan vs index lookup',
	stages: [
		{
			title: 'Sequential scan',
			subtitle: 'Reads every row, in the order rows were inserted.',
			Scene: ScanScene,
		},
		{
			title: 'Index lookup',
			subtitle: 'Reads the middle of a sorted range and halves it each time.',
			Scene: IndexScene,
		},
	],
	examples: [
		{ input: { values: sampleTable, target: 56 }, note: 'Match near the end' },
		{ input: { values: sampleTable, target: 50 }, note: 'No match' },
		{ input: { values: [12, 88, 5, 61, 37, 70, 19, 94, 46, 3], target: 88 }, note: 'Ten rows' },
	],
	fields: [
		{ name: 'values', label: 'rows', placeholder: 'e.g. 42 7 93 15' },
		{ name: 'target', label: 'find', placeholder: 'e.g. 15' },
	],
	describe: ({ values, target }) => `find ${target} in ${plural(values.length, 'row')}`,
	parse(fieldValues) {
		const values = parseNumbers(fieldValues.values);
		const target = Number(fieldValues.target);
		if (values.length < MIN_VALUES || values.length > MAX_VALUES) return { error: `Enter ${MIN_VALUES} to ${MAX_VALUES} row values.` };
		if (![...values, target].every(isValidValue) || fieldValues.target === '') return { error: `Use whole numbers from 0 to ${MAX_VALUE}.` };
		if (new Set(values).size !== values.length) return { error: 'Use distinct values, like a unique id column.' };
		return { input: { values, target } };
	},
	steps: buildSteps,
});
