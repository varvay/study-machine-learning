import { Canvas, Cell, Frame, RowLabel, SubLabel } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface MemoryInput {
	turns: number;
	windowMessages: number;
	summarize: boolean;
}

interface MemoryStep extends Step {
	turn: number;
}

type MemorySceneProps = SceneProps<MemoryInput, MemoryStep>;

const MAX_TURNS = 6;
const MAX_WINDOW = 10;
const HISTORY_TOP = 40;
const PROMPT_TOP = 150;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const turnRange = (first: number, last: number) => (first === last ? `turn ${first}` : `turns ${first}–${last}`);

const storedMessages = (turn: number) => 2 * turn;
const evictedTurns = (turn: number, windowMessages: number) => Math.max(0, turn - windowMessages / 2);
const messagesInPrompt = (turn: number, windowMessages: number) => Math.min(storedMessages(turn), windowMessages);

function turnNarration(turn: number, { windowMessages, summarize }: MemoryInput) {
	const stored = `<b>Turn ${turn}.</b> The user's message u${turn} and the reply a${turn} are appended; the table now holds ${plural(storedMessages(turn), 'row')}.`;
	const evicted = evictedTurns(turn, windowMessages);
	if (evicted === 0) return `${stored} All of them fit in the window, so the next prompt carries the whole conversation.`;
	const kept = turnRange(evicted + 1, turn);
	const window = `The window holds the last ${windowMessages} messages, ${kept}. Turn ${evicted} leaves the prompt, but its rows stay in the table.`;
	if (summarize) return `${stored} ${window} The summarizer folds ${turnRange(1, evicted)} into the conversation's summary, so what was said there still reaches the model in a few sentences.`;
	return `${stored} ${window} With no summary, anything the user said in ${turnRange(1, evicted)} is now invisible to the model.`;
}

function closingNarration({ turns, windowMessages, summarize }: MemoryInput) {
	const evicted = evictedTurns(turns, windowMessages);
	const history = `After ${plural(turns, 'turn')} the table holds ${plural(storedMessages(turns), 'message')}, and the next prompt carries ${messagesInPrompt(turns, windowMessages)}${evicted > 0 && summarize ? ' plus the summary' : ''}.`;
	if (evicted === 0) return `${history} The window never filled, so nothing was dropped; a longer conversation would start evicting at turn ${windowMessages / 2 + 1}.`;
	const bound = 'The history keeps growing, while the prompt, and so its token cost, stays bounded.';
	if (summarize) return `${history} ${bound} The price of the summary is one extra model call each time it is refreshed, and the detail a summary leaves out.`;
	return `${history} ${bound} Ask about something from turn 1 and the model cannot answer; a summary or a vector-store recall of old turns fixes that.`;
}

function buildSteps(input: MemoryInput): MemoryStep[] {
	const readoutAt = (turn: number) => ({
		turn,
		'rows in table': storedMessages(turn),
		'messages in prompt': messagesInPrompt(turn, input.windowMessages),
		'summarized turns': input.summarize ? evictedTurns(turn, input.windowMessages) : '–',
	});
	const steps: MemoryStep[] = [
		{
			turn: 0,
			readout: readoutAt(0),
			narration: `Every turn stores two rows in the messages table: the user's message and the model's reply. The table is the chat history, and rows are never deleted. The chat memory is a query over it: the last ${input.windowMessages} messages, which is ${plural(input.windowMessages / 2, 'turn')}.${input.summarize ? ' Turns that leave the window are folded into a summary.' : ''}`,
		},
	];
	for (let turn = 1; turn <= input.turns; turn++) steps.push({ turn, readout: readoutAt(turn), narration: turnNarration(turn, input) });
	steps.push({ turn: input.turns, readout: readoutAt(input.turns), narration: closingNarration(input) });
	return steps;
}

function MemoryScene({ input, step: { turn } }: MemorySceneProps) {
	const { turns, windowMessages, summarize } = input;
	const stored = storedMessages(turn);
	const firstInWindow = Math.max(0, stored - windowMessages);
	const evicted = evictedTurns(turn, windowMessages);
	const messages = Array.from({ length: storedMessages(turns) }, (_, index) => ({
		label: `${index % 2 === 0 ? 'u' : 'a'}${Math.floor(index / 2) + 1}`,
		column: index,
	}));
	const showSummary = summarize && evicted > 0;
	return (
		<Canvas columns={storedMessages(turns)} height={PROMPT_TOP + 86}>
			<RowLabel top={HISTORY_TOP + 16}>messages</RowLabel>
			<RowLabel top={PROMPT_TOP + 16}>next prompt</RowLabel>
			{stored > 0 && <Frame startColumn={firstInWindow} columns={stored - firstInWindow} top={HISTORY_TOP - 8} label={`window: last ${Math.min(stored, windowMessages)} messages`} />}
			{messages.map(({ label, column }) => {
				const isStored = column < stored;
				const inWindow = isStored && column >= firstInWindow;
				const isNew = isStored && column >= stored - 2;
				return [
					<Cell key={`row-${label}`} value={label} column={column} top={HISTORY_TOP} tone={isNew ? 'add' : 'plain'} dimmed={isStored && !inWindow} hidden={!isStored} />,
					<Cell key={`prompt-${label}`} value={label} column={column} top={PROMPT_TOP} tone="focus" hidden={!inWindow} />,
				];
			})}
			<Cell key="summary" value="S" column={Math.max(0, firstInWindow - 1)} top={PROMPT_TOP} tone="add" hidden={!showSummary} />
			<SubLabel key="summary-label" column={Math.max(0, firstInWindow - 1)} top={PROMPT_TOP + 60} hidden={!showSummary}>
				{showSummary ? turnRange(1, evicted) : ''}
			</SubLabel>
		</Canvas>
	);
}

function parseWholeNumber(raw: string, fallback: number) {
	return raw.trim() === '' ? fallback : Number(raw);
}

export default defineExplainer<MemoryInput, MemoryStep>({
	title: 'A memory window over the chat history',
	stages: [
		{
			title: 'History grows, the prompt stays bounded',
			subtitle: 'Top row: the messages table, one cell per stored message (u = user, a = assistant); faded cells are outside the window. Bottom row: what the next model call receives. S is the summary of evicted turns.',
			Scene: MemoryScene,
		},
	],
	examples: [
		{ input: { turns: 5, windowMessages: 4, summarize: true }, note: 'Window plus summary' },
		{ input: { turns: 5, windowMessages: 4, summarize: false }, note: 'Window only' },
		{ input: { turns: 3, windowMessages: 8, summarize: true }, note: 'Everything fits' },
	],
	fields: [
		{ name: 'turns', label: 'turns', placeholder: `1 to ${MAX_TURNS}` },
		{ name: 'window', label: 'window (messages)', placeholder: 'even, 2 to 10' },
		{ name: 'summarize', label: 'summarize (yes / no)', placeholder: 'yes' },
	],
	describe: ({ turns, windowMessages, summarize }) => `${plural(turns, 'turn')} · window ${windowMessages} · ${summarize ? 'with' : 'no'} summary`,
	parse(values) {
		const turns = parseWholeNumber(values.turns, 5);
		if (!Number.isInteger(turns) || turns < 1 || turns > MAX_TURNS) return { error: `Turns is a whole number from 1 to ${MAX_TURNS}.` };
		const windowMessages = parseWholeNumber(values.window, 4);
		if (!Number.isInteger(windowMessages) || windowMessages < 2 || windowMessages > MAX_WINDOW || windowMessages % 2 !== 0)
			return { error: `The window is an even number of messages from 2 to ${MAX_WINDOW}, so it holds whole turns.` };
		const answer = values.summarize.trim().toLowerCase();
		if (!['', 'yes', 'no'].includes(answer)) return { error: 'Summarize is yes or no; leave it blank for yes.' };
		return { input: { turns, windowMessages, summarize: answer !== 'no' } };
	},
	steps: buildSteps,
});
