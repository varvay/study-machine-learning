import { Canvas, Cell, Frame, RowLabel, SceneNote, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Currency = 'USD' | 'EUR' | 'GBP' | 'JPY';
type Actor = 'LLM' | 'app' | 'SQL' | 'FX';
type ToolName = 'SQL' | 'FX';
type MessageRole = 'S' | 'U' | 'A' | 'T';

interface LoopInput {
	currency: Currency;
	failedQueries: number;
	maxModelCalls: number;
}

interface Message {
	role: MessageRole;
	label: string;
	failed?: boolean;
}

type Phase = 'start' | 'reason-act' | 'answer' | 'observe' | 'capped' | 'done';

interface LoopStep extends Step {
	phase: Phase;
	visibleMessages: number;
	framedMessages: number;
	activeActors: Actor[];
	modelCall: number;
}

type LoopSceneProps = SceneProps<LoopInput, LoopStep>;

interface ToolCallTurn {
	thought: string;
	tool: ToolName;
	call: string;
	callLabel: string;
	resultLabel: string;
	resultText: string;
	failed: boolean;
}

interface AnswerTurn {
	thought: string;
	answer: string;
}

const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'JPY'];
const CURRENCY_NAMES: Record<Currency, string> = { USD: 'dollars', EUR: 'euros', GBP: 'pounds', JPY: 'yen' };
const CURRENCY_SYMBOLS: Record<Currency, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const ILLUSTRATIVE_RATES_FROM_USD: Record<Currency, number> = { USD: 1, EUR: 0.85, GBP: 0.74, JPY: 147 };
const REVENUE_USD = 48_200;
const MAX_FAILED_QUERIES = 2;
const MAX_MODEL_CALL_LIMIT = 8;
const DEFAULT_MODEL_CALL_LIMIT = 6;

const ACTORS: Actor[] = ['LLM', 'app', 'SQL', 'FX'];
const ACTOR_TOP = 26;
const CONTEXT_TOP = 150;
const SCENE_HEIGHT = CONTEXT_TOP + 90;

const CORRECT_QUERY = "SELECT SUM(amount_usd) FROM orders WHERE created_at >= '2026-09-01' AND created_at < '2026-10-01'";

const FAILING_QUERIES = [
	{
		query: "SELECT SUM(amount) FROM orders WHERE month = '2026-09'",
		error: 'ERROR: column "amount" does not exist',
		lesson: 'There is no column named amount; the schema in my system prompt says amount_usd.',
	},
	{
		query: "SELECT SUM(amount_usd) FROM orders WHERE month = '2026-09'",
		error: 'ERROR: column "month" does not exist',
		lesson: 'There is no month column. I will filter created_at to September 2026.',
	},
];

const formatAmount = (amount: number, currency: Currency) => `${CURRENCY_SYMBOLS[currency]}${Math.round(amount).toLocaleString('en-US')}`;

function shortAmount(amount: number, currency: Currency) {
	if (amount < 1_000_000) return formatAmount(amount, currency);
	return `${CURRENCY_SYMBOLS[currency]}${(amount / 1_000_000).toFixed(2)}M`;
}

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const questionOf =(currency: Currency) => `What was our revenue last month in ${CURRENCY_NAMES[currency]}?`;

function queryTurns(failedQueries: number): ToolCallTurn[] {
	const failing = FAILING_QUERIES.slice(MAX_FAILED_QUERIES - failedQueries);
	const firstThought = "I need last month's revenue. The orders table holds it.";
	const thoughts = [firstThought, ...failing.map((attempt) => attempt.lesson)];
	const attempts = [...failing.map(({ query, error }) => ({ query, error })), { query: CORRECT_QUERY, error: undefined }];
	return attempts.map(({ query, error }, index) => ({
		thought: thoughts[index],
		tool: 'SQL',
		call: `sql_query(query: "${query}")`,
		callLabel: 'SQL call',
		resultLabel: error ? 'error' : shortAmount(REVENUE_USD, 'USD'),
		resultText: error ?? `${REVENUE_USD} (the sum, in US dollars)`,
		failed: error !== undefined,
	}));
}

function conversionTurn(currency: Currency): ToolCallTurn {
	const converted = REVENUE_USD * ILLUSTRATIVE_RATES_FROM_USD[currency];
	return {
		thought: `Revenue is ${formatAmount(REVENUE_USD, 'USD')}, but the user asked for ${CURRENCY_NAMES[currency]}. convert_currency does that.`,
		tool: 'FX',
		call: `convert_currency(amount: ${REVENUE_USD}, from: "USD", to: "${currency}")`,
		callLabel: 'FX call',
		resultLabel: shortAmount(converted, currency),
		resultText: `${formatAmount(converted, currency)} (at an illustrative rate of 1 USD = ${ILLUSTRATIVE_RATES_FROM_USD[currency]} ${currency})`,
		failed: false,
	};
}

function toolTurnsOf({ currency, failedQueries }: LoopInput): ToolCallTurn[] {
	const turns = queryTurns(failedQueries);
	return currency === 'USD' ? turns : [...turns, conversionTurn(currency)];
}

function answerTurnOf(currency: Currency): AnswerTurn {
	const amount = formatAmount(REVENUE_USD * ILLUSTRATIVE_RATES_FROM_USD[currency], currency);
	const thought = currency === 'USD' ? `Revenue is ${amount}, already in dollars. I need no more tools.` : `I have the revenue in ${CURRENCY_NAMES[currency]}.`;
	return { thought, answer: `Revenue last month (September 2026) was ${amount}.` };
}

function messagesOf(input: LoopInput): Message[] {
	const toolMessages = toolTurnsOf(input).flatMap((turn): Message[] => [
		{ role: 'A', label: turn.callLabel },
		{ role: 'T', label: turn.resultLabel, failed: turn.failed },
	]);
	return [{ role: 'S', label: 'system' }, { role: 'U', label: 'question' }, ...toolMessages, { role: 'A', label: 'answer' }];
}

const toolCallsIn = (visibleMessages: number) => Math.max(0, Math.floor((visibleMessages - 2) / 2));

function buildSteps(input: LoopInput): LoopStep[] {
	const toolTurns = toolTurnsOf(input);
	const answerTurn = answerTurnOf(input.currency);
	const modelCallsNeeded = toolTurns.length + 1;
	const steps: LoopStep[] = [];
	const readsPerCall: number[] = [];

	const readout = (visibleMessages: number, modelCall: number) => ({
		'model calls': `${modelCall} of max ${input.maxModelCalls}`,
		'tool calls': toolCallsIn(visibleMessages),
		context: `${visibleMessages} messages`,
		'messages sent': readsPerCall.slice(0, modelCall).reduce((sum, reads) => sum + reads, 0),
	});

	const push = (phase: Phase, visibleMessages: number, framedMessages: number, activeActors: Actor[], modelCall: number, narration: string) =>
		steps.push({ phase, visibleMessages, framedMessages, activeActors, modelCall, readout: readout(visibleMessages, modelCall), narration });

	push(
		'start',
		2,
		0,
		['app'],
		0,
		`The user asks: <i>“${questionOf(input.currency)}”</i> The app builds the context from 2 messages: a system prompt, holding the database schema and the definitions of 2 tools (<code>sql_query</code> and <code>convert_currency</code>), and the question.`,
	);

	for (const [index, turn] of toolTurns.entries()) {
		const modelCall = index + 1;
		if (modelCall > input.maxModelCalls) break;
		const reads = 2 + index * 2;
		readsPerCall.push(reads);
		push(
			'reason-act',
			reads + 1,
			reads,
			['LLM'],
			modelCall,
			`<b>Model call ${modelCall}</b> reads all ${reads} messages. <b>Reason:</b> <i>“${turn.thought}”</i> <b>Act:</b> it replies with a tool call instead of text: <code>${escapeHtml(turn.call)}</code>.`,
		);
		const toolActor = turn.tool;
		const observation = turn.failed
			? `The query fails, and the error text becomes message ${reads + 2}: <code>${turn.resultText}</code>. The model will read the error and can fix its query.`
			: `The result becomes message ${reads + 2}: <code>${turn.resultText}</code>.`;
		push(
			'observe',
			reads + 2,
			0,
			['app', toolActor],
			modelCall,
			`<b>Observe:</b> the app, not the model, runs <code>${toolActor === 'SQL' ? 'sql_query' : 'convert_currency'}</code>. ${observation}`,
		);
	}

	const visibleAfterTools = 2 + Math.min(toolTurns.length, input.maxModelCalls) * 2;

	if (modelCallsNeeded > input.maxModelCalls) {
		push(
			'capped',
			visibleAfterTools,
			0,
			['app'],
			input.maxModelCalls,
			`The next step would be model call ${input.maxModelCalls + 1}, but the limit is ${input.maxModelCalls}. The app stops the loop and returns no answer. A limit like this is a <b>guardrail</b> against endless loops and runaway cost (G5.5). This run needs ${modelCallsNeeded} model calls to finish.`,
		);
		return steps;
	}

	const answerReads = visibleAfterTools;
	readsPerCall.push(answerReads);
	push(
		'answer',
		answerReads + 1,
		answerReads,
		['LLM'],
		modelCallsNeeded,
		`<b>Model call ${modelCallsNeeded}</b> reads all ${answerReads} messages. <b>Reason:</b> <i>“${answerTurn.thought}”</i> It replies with plain text and no tool call: <i>“${answerTurn.answer}”</i> A reply with no tool call ends the loop.`,
	);

	const totalSent = readsPerCall.reduce((sum, reads) => sum + reads, 0);
	push(
		'done',
		answerReads + 1,
		0,
		[],
		modelCallsNeeded,
		`Done: ${plural(modelCallsNeeded, 'model call')} and ${plural(toolTurns.length, 'tool call')}. The model keeps nothing between calls, so each call re-sent the whole history: ${readsPerCall.join(', ')} messages, ${totalSent} in total. The context grows every turn, and each call costs more than the one before it.`,
	);
	return steps;
}

const PHASE_NOTES: Record<Phase, string> = {
	start: 'the app starts the loop',
	'reason-act': 'reason → act',
	answer: 'reason → answer',
	observe: 'observe',
	capped: 'stopped by the limit',
	done: 'loop ended',
};

function messageTone(message: Message, index: number, step: LoopStep): CellTone {
	const isNewest = index === step.visibleMessages - 1 && step.phase !== 'done' && step.phase !== 'capped';
	if (message.failed) return 'remove';
	if (message.label === 'answer') return 'add';
	return isNewest ? 'focus' : 'plain';
}

function LoopScene({ input, step }: LoopSceneProps) {
	const messages = messagesOf(input);
	const columns = Math.max(ACTORS.length, messages.length);
	return (
		<Canvas columns={columns} height={SCENE_HEIGHT}>
			<RowLabel top={ACTOR_TOP + 16}>who acts</RowLabel>
			<RowLabel top={CONTEXT_TOP + 16}>context</RowLabel>
			{ACTORS.map((actor, index) => (
				<Cell
					key={`actor-${actor}`}
					value={actor}
					column={index}
					top={ACTOR_TOP}
					tone={step.activeActors.includes(actor) ? (step.phase === 'capped' ? 'remove' : 'focus') : 'plain'}
					dimmed={!step.activeActors.includes(actor)}
				/>
			))}
			<SceneNote column={0} top={ACTOR_TOP + 62}>
				{PHASE_NOTES[step.phase]}
			</SceneNote>
			{step.framedMessages > 0 && <Frame startColumn={0} columns={step.framedMessages} top={CONTEXT_TOP - 8} label={`sent to the model: call ${step.modelCall}`} />}
			{messages.map((message, index) => {
				const hidden = index >= step.visibleMessages;
				return [
					<Cell key={`message-${index}`} value={message.role} column={index} top={CONTEXT_TOP} tone={messageTone(message, index, step)} hidden={hidden} />,
					<SubLabel key={`message-label-${index}`} column={index} top={CONTEXT_TOP + 62} hidden={hidden}>
						{message.label}
					</SubLabel>,
				];
			})}
		</Canvas>
	);
}

function parseWholeNumber(raw: string, fallback: number, min: number, max: number): number | undefined {
	if (raw === '') return fallback;
	const value = Number(raw);
	return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

export default defineExplainer<LoopInput, LoopStep>({
	title: 'The agent loop, one question at a time',
	stages: [
		{
			title: 'Reason, act, observe',
			subtitle:
				'Top: who acts on this step. Bottom: the context, one cell per message: S the system prompt, U the user, A a model reply, T a tool result. The frame marks what the model reads on each call. Revenue figures and exchange rates are illustrative.',
			Scene: LoopScene,
		},
	],
	examples: [
		{ input: { currency: 'EUR', failedQueries: 0, maxModelCalls: DEFAULT_MODEL_CALL_LIMIT }, note: 'Two tools, then an answer' },
		{ input: { currency: 'USD', failedQueries: 0, maxModelCalls: DEFAULT_MODEL_CALL_LIMIT }, note: 'One tool is enough' },
		{ input: { currency: 'EUR', failedQueries: 2, maxModelCalls: DEFAULT_MODEL_CALL_LIMIT }, note: 'Recovering from SQL errors' },
		{ input: { currency: 'EUR', failedQueries: 2, maxModelCalls: 3 }, note: 'The limit stops the loop' },
	],
	fields: [
		{ name: 'currency', label: 'currency', placeholder: 'USD EUR GBP JPY' },
		{ name: 'failed', label: 'failed queries', placeholder: '0 to 2' },
		{ name: 'limit', label: 'max model calls', placeholder: '1 to 8' },
	],
	describe: ({ currency, failedQueries, maxModelCalls }) =>
		`${currency} · ${failedQueries} failed ${failedQueries === 1 ? 'query' : 'queries'} · max ${plural(maxModelCalls, 'call')}`,
	parse(values) {
		const currency = (values.currency === '' ? 'EUR' : values.currency.toUpperCase()) as Currency;
		if (!CURRENCIES.includes(currency)) return { error: `Currency is one of ${CURRENCIES.join(', ')}.` };
		const failedQueries = parseWholeNumber(values.failed, 0, 0, MAX_FAILED_QUERIES);
		if (failedQueries === undefined) return { error: `Failed queries is a whole number from 0 to ${MAX_FAILED_QUERIES}: how many SQL attempts fail before one works.` };
		const maxModelCalls = parseWholeNumber(values.limit, DEFAULT_MODEL_CALL_LIMIT, 1, MAX_MODEL_CALL_LIMIT);
		if (maxModelCalls === undefined) return { error: `Max model calls is a whole number from 1 to ${MAX_MODEL_CALL_LIMIT}.` };
		return { input: { currency, failedQueries, maxModelCalls } };
	},
	steps: buildSteps,
});
