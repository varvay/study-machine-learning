import { Canvas, Cell, RowLabel, SceneNote, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface ChainInput {
	historyMessages: number;
	retrievedChunks: number;
	toolRounds: number;
}

type ChainLink = 'memory' | 'tools' | 'rag' | 'model';

type Phase = 'request' | 'memoryLoad' | 'toolLoop' | 'retrieve' | 'toolCall' | 'toolRun' | 'answer' | 'citations' | 'memorySave' | 'summary';

interface ChainStep extends Step {
	phase: Phase;
	stepIndex: number;
}

type ChainSceneProps = SceneProps<ChainInput, ChainStep>;

interface Position {
	column: number;
	top: number;
}

interface Block {
	key: string;
	label: string;
	appearsAt: number;
	origin: Position;
	target: Position;
}

interface Moment {
	phase: Phase;
	round: number;
	activeLink?: ChainLink;
}

interface Timeline {
	moments: Moment[];
	blocks: Block[];
}

const MAX_HISTORY = 4;
const MAX_CHUNKS = 3;
const MAX_TOOL_ROUNDS = 2;

const CHAIN_TOP = 34;
const PROMPT_TOP = 170;
const MEMORY_TOP = 290;
const SCENE_HEIGHT = 380;

const ANSWER_COLUMN = 5;

const chainLinks: { link: ChainLink; label: string; name: string; order: string }[] = [
	{ link: 'memory', label: 'M', name: 'memory', order: '+200' },
	{ link: 'tools', label: 'T', name: 'tools', order: '+300' },
	{ link: 'rag', label: 'R', name: 'RAG', order: '0' },
	{ link: 'model', label: 'AI', name: 'model', order: 'end' },
];

const chainPosition = (link: ChainLink): Position => ({ column: chainLinks.findIndex((each) => each.link === link), top: CHAIN_TOP });
const promptPosition = (column: number): Position => ({ column, top: PROMPT_TOP });
const memoryPosition = (column: number): Position => ({ column, top: MEMORY_TOP });
const answerPosition: Position = { column: ANSWER_COLUMN, top: CHAIN_TOP };

const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

function buildTimeline({ historyMessages, retrievedChunks, toolRounds }: ChainInput): Timeline {
	const moments: Moment[] = [];
	const blocks: Block[] = [];
	const addMoment = (moment: Moment) => moments.push(moment) - 1;
	const questionColumn = historyMessages + 1;
	let promptColumn = questionColumn + 1;

	const request = addMoment({ phase: 'request', round: 0 });
	blocks.push({ key: 'system', label: 'S', appearsAt: request, origin: promptPosition(0), target: promptPosition(0) });
	blocks.push({ key: 'question', label: 'Q', appearsAt: request, origin: promptPosition(questionColumn), target: promptPosition(questionColumn) });
	range(historyMessages).forEach((index) =>
		blocks.push({ key: `stored-${index}`, label: `h${index}`, appearsAt: request, origin: memoryPosition(index - 1), target: memoryPosition(index - 1) }),
	);

	const memoryLoad = addMoment({ phase: 'memoryLoad', round: 0, activeLink: 'memory' });
	range(historyMessages).forEach((index) =>
		blocks.push({ key: `history-${index}`, label: `h${index}`, appearsAt: memoryLoad, origin: memoryPosition(index - 1), target: promptPosition(index) }),
	);
	blocks.push({ key: 'stored-question', label: 'Q', appearsAt: memoryLoad, origin: promptPosition(questionColumn), target: memoryPosition(historyMessages) });

	addMoment({ phase: 'toolLoop', round: 1, activeLink: 'tools' });

	for (let round = 1; round <= toolRounds + 1; round++) {
		const retrieve = addMoment({ phase: 'retrieve', round, activeLink: 'rag' });
		if (round === 1) {
			range(retrievedChunks).forEach((index) => {
				blocks.push({ key: `chunk-${index}`, label: `c${index}`, appearsAt: retrieve, origin: chainPosition('rag'), target: promptPosition(promptColumn) });
				promptColumn += 1;
			});
		}
		if (round > toolRounds) break;
		const toolCall = addMoment({ phase: 'toolCall', round, activeLink: 'model' });
		blocks.push({ key: `call-${round}`, label: `tc${round}`, appearsAt: toolCall, origin: chainPosition('model'), target: promptPosition(promptColumn) });
		promptColumn += 1;
		const toolRun = addMoment({ phase: 'toolRun', round, activeLink: 'tools' });
		blocks.push({ key: `result-${round}`, label: `tr${round}`, appearsAt: toolRun, origin: chainPosition('tools'), target: promptPosition(promptColumn) });
		promptColumn += 1;
	}

	const answer = addMoment({ phase: 'answer', round: toolRounds + 1, activeLink: 'model' });
	blocks.push({ key: 'answer', label: 'A', appearsAt: answer, origin: chainPosition('model'), target: answerPosition });

	addMoment({ phase: 'citations', round: toolRounds + 1, activeLink: 'rag' });
	const memorySave = addMoment({ phase: 'memorySave', round: toolRounds + 1, activeLink: 'memory' });
	blocks.push({ key: 'stored-answer', label: 'A', appearsAt: memorySave, origin: answerPosition, target: memoryPosition(historyMessages + 1) });
	addMoment({ phase: 'summary', round: toolRounds + 1 });

	return { moments, blocks };
}

const promptBlockCount = (blocks: Block[], stepIndex: number) => blocks.filter((block) => block.target.top === PROMPT_TOP && block.appearsAt <= stepIndex).length;

const plural = (count: number, word: string, pluralWord = `${word}s`) => `${count} ${count === 1 ? word : pluralWord}`;

function countsAt(timeline: Timeline, stepIndex: number) {
	const reached = timeline.moments.slice(0, stepIndex + 1);
	const modelCalls = reached.filter((moment) => moment.phase === 'toolCall' || moment.phase === 'answer').length;
	const vectorSearches = reached.filter((moment) => moment.phase === 'retrieve').length;
	return { modelCalls, vectorSearches, promptBlocks: promptBlockCount(timeline.blocks, stepIndex) };
}

function narrationFor(moment: Moment, input: ChainInput, timeline: Timeline, stepIndex: number): string {
	const { historyMessages, retrievedChunks, toolRounds } = input;
	const { modelCalls, vectorSearches, promptBlocks } = countsAt(timeline, stepIndex);
	const storedHistory =
		historyMessages === 0 ? 'ChatMemory holds nothing yet for this conversation.' : `ChatMemory already holds ${plural(historyMessages, 'earlier message')} of this conversation.`;
	switch (moment.phase) {
		case 'request':
			return `<code>chatClient.prompt().user(question).call()</code> starts with two messages: the default system text (S) and the user's question (Q). Advisors run by their order value, lowest first: MessageChatMemoryAdvisor (HIGHEST_PRECEDENCE + 200), ToolCallingAdvisor (+ 300), QuestionAnswerAdvisor (0). The ChatModel is the last link. ${storedHistory}`;
		case 'memoryLoad':
			return historyMessages === 0
				? 'MessageChatMemoryAdvisor reads the conversation named by <code>ChatMemory.CONVERSATION_ID</code>. It is empty, a first turn, so nothing is added. It saves the new question to ChatMemory on the way in.'
				: `MessageChatMemoryAdvisor reads the conversation named by <code>ChatMemory.CONVERSATION_ID</code> and puts its ${plural(historyMessages, 'earlier message')} between the system text and the question. It also saves the new question to ChatMemory now, on the way in.`;
		case 'toolLoop':
			return 'ToolCallingAdvisor attaches the tool definitions (name, description, parameter schema) to the request and starts the tool loop. Every link after it runs again on each round trip to the model.';
		case 'retrieve':
			return moment.round === 1
				? `QuestionAnswerAdvisor searches the vector store with the question and adds the ${plural(retrievedChunks, 'closest chunk')} to the user message (topK = ${retrievedChunks}). Vector search #${vectorSearches}.`
				: `Round ${moment.round}: the loop re-enters the chain below ToolCallingAdvisor, so QuestionAnswerAdvisor searches again. Vector search #${vectorSearches}.`;
		case 'toolCall':
			return `Model call #${modelCalls} sends the ${promptBlocks - 1} prompt blocks to Bedrock. The model replies with a tool call (tc${moment.round}) instead of text, such as <code>findTicket(1042)</code>.`;
		case 'toolRun':
			return `ToolCallingAdvisor runs the Java method and appends the call and its result (tr${moment.round}) to the conversation, then sends everything back down the chain: round ${moment.round + 1}.`;
		case 'answer':
			return toolRounds === 0
				? `Model call #${modelCalls} sends the ${promptBlocks} prompt blocks to Bedrock. The model answers in text (A) without asking for a tool, so the loop ends after one round.`
				: `Model call #${modelCalls} sends the ${promptBlocks} prompt blocks to Bedrock. With the tool results in hand, the model answers in text (A), so the loop ends.`;
		case 'citations':
			return 'The response travels back up the chain, last link first. QuestionAnswerAdvisor puts the chunks it used into the response metadata under <code>qa_retrieved_documents</code>; the controller turns their <code>source</code> metadata into citations.';
		case 'memorySave':
			return toolRounds === 0
				? 'MessageChatMemoryAdvisor, first on the way in, is last on the way out: it saves the answer to ChatMemory, so the next turn sees Q and A.'
				: 'MessageChatMemoryAdvisor, first on the way in, is last on the way out: it saves the answer to ChatMemory. The tool calls and results stay out of memory, because this advisor sits outside the tool loop.';
		case 'summary':
			return `This call made ${plural(modelCalls, 'model call')} and ${plural(vectorSearches, 'vector search', 'vector searches')}. ${
				toolRounds === 0
					? 'With no tool call, it is one round trip.'
					: 'Each tool round resends the whole prompt, history and chunks included, as input tokens, so tool loops multiply cost (G6.8).'
			}`;
	}
}

function buildSteps(input: ChainInput): ChainStep[] {
	const timeline = buildTimeline(input);
	return timeline.moments.map((moment, stepIndex) => {
		const { modelCalls, vectorSearches, promptBlocks } = countsAt(timeline, stepIndex);
		return {
			phase: moment.phase,
			stepIndex,
			readout: { 'model calls': modelCalls, 'vector searches': vectorSearches, 'prompt blocks': promptBlocks },
			narration: narrationFor(moment, input, timeline, stepIndex),
		};
	});
}

function ChainScene({ input, step: { stepIndex } }: ChainSceneProps) {
	const timeline = buildTimeline(input);
	const moment = timeline.moments[stepIndex];
	const columns = Math.max(ANSWER_COLUMN + 1, ...timeline.blocks.map((block) => block.target.column + 1));
	const linkTone = (link: ChainLink): CellTone => (moment.activeLink === link ? 'focus' : 'plain');
	const chunksInFocus = moment.phase === 'citations' || (moment.phase === 'retrieve' && moment.round > 1);
	const blockTone = (block: Block): CellTone => {
		if (block.appearsAt > stepIndex || moment.phase === 'request') return 'plain';
		if (block.appearsAt === stepIndex) return 'add';
		return chunksInFocus && block.key.startsWith('chunk-') ? 'focus' : 'plain';
	};

	return (
		<Canvas columns={columns} height={SCENE_HEIGHT}>
			<RowLabel top={CHAIN_TOP + 16}>chain</RowLabel>
			<RowLabel top={PROMPT_TOP + 16}>prompt</RowLabel>
			<RowLabel top={MEMORY_TOP + 16}>memory</RowLabel>
			<SceneNote column={0} top={CHAIN_TOP - 26}>
				request → right, response ← left
			</SceneNote>
			<SceneNote column={0} top={PROMPT_TOP - 26}>
				messages sent to the model
			</SceneNote>
			<SceneNote column={0} top={MEMORY_TOP - 26}>
				ChatMemory (JDBC table)
			</SceneNote>

			{chainLinks.map(({ link, label, name, order }, column) => [
				<Cell key={`link-${link}`} value={label} column={column} top={CHAIN_TOP} tone={linkTone(link)} />,
				<SubLabel key={`link-name-${link}`} column={column} top={CHAIN_TOP + 58}>
					{name}
				</SubLabel>,
				<SubLabel key={`link-order-${link}`} column={column} top={CHAIN_TOP + 74}>
					{order}
				</SubLabel>,
			])}
			<SubLabel key="answer-label" column={ANSWER_COLUMN} top={CHAIN_TOP + 58} hidden={!timeline.blocks.some((block) => block.key === 'answer' && block.appearsAt <= stepIndex)}>
				answer
			</SubLabel>

			{timeline.blocks.map((block) => {
				const shown = block.appearsAt <= stepIndex;
				const position = shown ? block.target : block.origin;
				return <Cell key={block.key} value={block.label} column={position.column} top={position.top} tone={blockTone(block)} hidden={!shown} />;
			})}
		</Canvas>
	);
}

function parseCount(raw: string, label: string, max: number): number | string {
	const value = Number(raw.trim());
	if (raw.trim() === '' || !Number.isInteger(value)) return `Enter ${label} as a whole number.`;
	if (value < 0 || value > max) return `${label[0].toUpperCase()}${label.slice(1)} must be from 0 to ${max}.`;
	return value;
}

export default defineExplainer<ChainInput, ChainStep>({
	title: 'One ChatClient call through the advisor chain',
	stages: [
		{
			title: 'Memory, tools, RAG, model',
			subtitle: 'Top: the advisors in their default order, with the ChatModel last. Middle: the messages the model receives. Bottom: the conversation stored in ChatMemory. Green blocks were added in this step.',
			Scene: ChainScene,
		},
	],
	examples: [
		{ input: { historyMessages: 2, retrievedChunks: 3, toolRounds: 1 }, note: 'Second turn, one ticket lookup' },
		{ input: { historyMessages: 0, retrievedChunks: 3, toolRounds: 0 }, note: 'First turn, no tools' },
		{ input: { historyMessages: 4, retrievedChunks: 2, toolRounds: 2 }, note: 'Two tool rounds' },
	],
	fields: [
		{ name: 'history', label: 'earlier messages (0–4)', placeholder: 'e.g. 2' },
		{ name: 'chunks', label: 'retrieved chunks (1–3)', placeholder: 'e.g. 3' },
		{ name: 'rounds', label: 'tool rounds (0–2)', placeholder: 'e.g. 1' },
	],
	describe: ({ historyMessages, retrievedChunks, toolRounds }) => `${historyMessages} earlier · ${retrievedChunks} chunks · ${toolRounds} tool rounds`,
	parse(values) {
		const historyMessages = parseCount(values.history ?? '', 'earlier messages', MAX_HISTORY);
		if (typeof historyMessages === 'string') return { error: historyMessages };
		const retrievedChunks = parseCount(values.chunks ?? '', 'retrieved chunks', MAX_CHUNKS);
		if (typeof retrievedChunks === 'string') return { error: retrievedChunks };
		if (retrievedChunks === 0) return { error: 'Retrieved chunks must be from 1 to 3: a RAG call adds at least one chunk.' };
		const toolRounds = parseCount(values.rounds ?? '', 'tool rounds', MAX_TOOL_ROUNDS);
		if (typeof toolRounds === 'string') return { error: toolRounds };
		return { input: { historyMessages, retrievedChunks, toolRounds } };
	},
	steps: buildSteps,
});
