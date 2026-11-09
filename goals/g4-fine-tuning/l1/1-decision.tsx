import { Canvas, Cell, Chips, RowLabel, SceneNote, SubLabel, type CellTone, type Chip, type ChipState } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface SetupInput {
	instruction: string;
	document: string;
	question: string;
}

type Setup = 'base' | 'prompting' | 'rag' | 'fine-tuned' | 'document-edited';

interface SetupStep extends Step {
	setup: Setup;
}

type SetupSceneProps = SceneProps<SetupInput, SetupStep>;

const SETUPS: Setup[] = ['base', 'prompting', 'rag', 'fine-tuned', 'document-edited'];

const STORED_DOCUMENTS = ['D1', 'D2', 'D3'];
const MATCHED_DOCUMENT_COLUMN = 1;
const ORIGINAL_WEIGHTS = ['0.4', '−1.2', '0.7', '2.1', '−0.3', '0.9'];
const TUNED_WEIGHTS = ['0.5', '−1.0', '0.6', '2.3', '−0.4', '1.1'];
const MAX_TEXT_LENGTH = 80;

const DOCUMENTS_TOP = 30;
const PROMPT_TOP = 140;
const WEIGHTS_TOP = 250;
const SCENE_HEIGHT = 340;

const INSTRUCTION_COLUMN = 0;
const RETRIEVED_COLUMN = 1;
const QUESTION_COLUMN = 2;

const instructionInPrompt = (setup: Setup) => setup === 'prompting' || setup === 'rag';
const documentInPrompt = (setup: Setup) => setup === 'rag' || setup === 'fine-tuned' || setup === 'document-edited';
const weightsTuned = (setup: Setup) => setup === 'fine-tuned' || setup === 'document-edited';
const documentEdited = (setup: Setup) => setup === 'document-edited';

const matchedDocumentName = (setup: Setup) => (documentEdited(setup) ? 'D2′' : 'D2');

function promptReadout(setup: Setup) {
	const parts = [instructionInPrompt(setup) && 'instruction', documentInPrompt(setup) && matchedDocumentName(setup), 'question'].filter(Boolean);
	return parts.join(' + ');
}

const readoutOf = (setup: Setup) => ({ prompt: promptReadout(setup), weights: weightsTuned(setup) ? 'fine-tuned' : 'original' });

function narrationOf(setup: Setup) {
	switch (setup) {
		case 'base':
			return `The starting point: the app sends the question alone. The model answers from its weights, the numbers set when it was trained (6 of its billions are shown). Nothing tells it your rules, and it has never seen your documents. The text the model reads is listed below the scene.`;
		case 'prompting':
			return `<b>Prompting</b> edits the text the model reads: an instruction now goes in front of the question. The weights are untouched, so the change is free to make or undo and takes effect on the next request. The instruction costs tokens on every request.`;
		case 'rag':
			return `<b>RAG</b> adds knowledge at query time. A search over the documents finds D2, the passage closest to the question, and the app pastes its text into the prompt. The model answers from that text. The weights are still untouched.`;
		case 'fine-tuned':
			return `<b>Fine-tuning</b> trains the model on example questions paired with answers that already follow the instruction. The weights change (green), and the model now follows the instruction without being told, so the instruction leaves the prompt. RAG still supplies D2: fine-tuning taught the behaviour, and the documents still carry the facts.`;
		case 'document-edited':
			return `Someone edits D2. The next request retrieves the edited version, D2′, with no retraining. A fact trained into the weights would change only with a new training run. Prompting and RAG change what the model reads, on every request; fine-tuning changes the model itself, once per training run.`;
	}
}

const buildSteps = (): SetupStep[] => SETUPS.map((setup) => ({ setup, readout: readoutOf(setup), narration: narrationOf(setup) }));

function instructionTone(setup: Setup): CellTone {
	return setup === 'prompting' ? 'add' : 'plain';
}

function retrievedTone(setup: Setup): CellTone {
	if (setup === 'rag') return 'add';
	return documentEdited(setup) ? 'focus' : 'plain';
}

function storedTone(setup: Setup, column: number): CellTone {
	if (column !== MATCHED_DOCUMENT_COLUMN) return 'plain';
	return setup === 'rag' || documentEdited(setup) ? 'focus' : 'plain';
}

function SetupScene({ step: { setup } }: SetupSceneProps) {
	const retrieved = documentInPrompt(setup);
	const instructionShown = instructionInPrompt(setup);
	const weights = weightsTuned(setup) ? TUNED_WEIGHTS : ORIGINAL_WEIGHTS;
	return (
		<Canvas columns={ORIGINAL_WEIGHTS.length} height={SCENE_HEIGHT}>
			<RowLabel top={DOCUMENTS_TOP + 16}>documents</RowLabel>
			<RowLabel top={PROMPT_TOP + 16}>prompt</RowLabel>
			<RowLabel top={WEIGHTS_TOP + 16}>weights</RowLabel>

			{STORED_DOCUMENTS.map((name, column) => (
				<Cell
					key={`stored-${name}`}
					value={column === MATCHED_DOCUMENT_COLUMN ? matchedDocumentName(setup) : name}
					column={column}
					top={DOCUMENTS_TOP}
					tone={storedTone(setup, column)}
				/>
			))}

			<Cell key="instruction" value="I" column={INSTRUCTION_COLUMN} top={PROMPT_TOP} tone={instructionTone(setup)} hidden={!instructionShown} />
			<SubLabel key="instruction-label" column={INSTRUCTION_COLUMN} top={PROMPT_TOP + 58} hidden={!instructionShown}>
				instruction
			</SubLabel>
			<Cell
				key="retrieved"
				value={matchedDocumentName(setup)}
				column={RETRIEVED_COLUMN}
				top={retrieved ? PROMPT_TOP : DOCUMENTS_TOP}
				tone={retrievedTone(setup)}
				hidden={!retrieved}
			/>
			<SubLabel key="retrieved-label" column={RETRIEVED_COLUMN} top={PROMPT_TOP + 58} hidden={!retrieved}>
				retrieved
			</SubLabel>
			<Cell key="question" value="Q" column={QUESTION_COLUMN} top={PROMPT_TOP} />
			<SubLabel key="question-label" column={QUESTION_COLUMN} top={PROMPT_TOP + 58}>
				question
			</SubLabel>

			{weights.map((weight, column) => (
				<Cell key={`weight-${column}`} value={weight} column={column} top={WEIGHTS_TOP} tone={weightsTuned(setup) ? 'add' : 'plain'} />
			))}
			<SceneNote column={0} top={WEIGHTS_TOP + 62}>
				6 of the model's billions of weights
			</SceneNote>
		</Canvas>
	);
}

const chipState = (inPrompt: boolean): ChipState => (inPrompt ? 'current' : 'upcoming');

function PromptText({ input, step: { setup } }: SetupSceneProps) {
	const documentLabel = documentEdited(setup) ? `D2′: the edited version of "${input.document}"` : `D2: "${input.document}"`;
	const chips: Chip[] = [
		{ label: `instruction: "${input.instruction}"`, state: chipState(instructionInPrompt(setup)) },
		{ label: documentLabel, state: chipState(documentInPrompt(setup)) },
		{ label: `question: "${input.question}"`, state: 'current' },
	];
	return <Chips chips={chips} />;
}

function parseText(raw: string | undefined, part: string, example: string): string | { error: string } {
	const text = (raw ?? '').trim();
	if (text === '') return { error: `Enter the ${part}, e.g. ${example}` };
	if (text.length > MAX_TEXT_LENGTH) return { error: `Keep the ${part} to ${MAX_TEXT_LENGTH} characters; it has ${text.length}.` };
	return text;
}

export default defineExplainer<SetupInput, SetupStep>({
	title: 'Prompt, context, or weights: what each method changes',
	stages: [
		{
			title: 'One question, four setups',
			subtitle: 'Top row: the document store. Middle row: the prompt the model reads. Bottom row: a few of the model’s weights. Green marks what the current step added or changed; teal marks the document retrieved.',
			Scene: SetupScene,
			Footer: PromptText,
		},
	],
	examples: [
		{
			input: {
				instruction: 'Reply in two friendly sentences.',
				document: 'Refunds are accepted within 30 days of delivery.',
				question: 'Can I return my headphones?',
			},
			note: 'Support bot',
		},
		{
			input: {
				instruction: 'Return JSON with the keys party, amount, due_date.',
				document: 'Clause 4: Acme pays $12,000 within 45 days of invoice.',
				question: 'What are the payment terms?',
			},
			note: 'Contract extraction',
		},
	],
	fields: [
		{ name: 'instruction', label: 'instruction', placeholder: 'e.g. Reply in two sentences.' },
		{ name: 'document', label: 'matching document', placeholder: 'e.g. Refunds within 30 days.' },
		{ name: 'question', label: 'question', placeholder: 'e.g. Can I return it?' },
	],
	describe: ({ question }) => `"${question}"`,
	parse(values) {
		const instruction = parseText(values.instruction, 'instruction', '"Reply in two sentences."');
		if (typeof instruction !== 'string') return instruction;
		const document = parseText(values.document, 'matching document', '"Refunds are accepted within 30 days."');
		if (typeof document !== 'string') return document;
		const question = parseText(values.question, 'question', '"Can I return my headphones?"');
		if (typeof question !== 'string') return question;
		return { input: { instruction, document, question } };
	},
	steps: buildSteps,
});
