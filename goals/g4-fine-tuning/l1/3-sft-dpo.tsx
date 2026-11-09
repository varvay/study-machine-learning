import { Canvas, Cell, Chips, ColumnMarker, RowLabel, SubLabel, type CellTone, type Chip } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface Scenario {
	goal: string;
	quality: string;
	pairs: { prompt: string; chosen: string; rejected: string }[];
	newAnswers: string[];
}

interface CompareInput {
	scenario: number;
	rounds: number;
}

type Phase = 'pairs' | 'reward-model' | 'generate' | 'score' | 'update' | 'result';

interface CompareStep extends Step {
	phase: Phase | 'intro';
	round: number;
}

type CompareSceneProps = SceneProps<CompareInput, CompareStep>;

const SCENARIOS: Scenario[] = [
	{
		goal: 'support replies',
		quality: 'short and warm',
		pairs: [
			{ prompt: '"My order is late."', chosen: 'sorry + tracking link', rejected: 'long list of delay causes' },
			{ prompt: '"I was charged twice."', chosen: 'apology + refund steps', rejected: 'policy paragraph' },
			{ prompt: '"Can I change my address?"', chosen: 'yes + 2 steps', rejected: 'cold "see FAQ"' },
		],
		newAnswers: ['a polite but long reply', 'a shorter, friendlier reply', 'a short, warm reply with a link'],
	},
	{
		goal: 'code answers',
		quality: 'concise, code first',
		pairs: [
			{ prompt: '"Reverse a list in Python"', chosen: 'one line + note', rejected: 'essay, code at the end' },
			{ prompt: '"Read a file in Java"', chosen: 'snippet + 1 caveat', rejected: '5 alternatives' },
			{ prompt: '"Fix this null error"', chosen: 'the fix, then why', rejected: 'generic advice' },
		],
		newAnswers: ['a wordy answer with code', 'code first, then a paragraph', 'code first, one-line note'],
	},
];

const MAX_ROUNDS = 3;
const RLHF_SCORES = [0.55, 0.72, 0.84];
const RLHF_SHARE = [40, 62, 78, 86];
const DPO_ODDS = [
	[45, 55],
	[64, 36],
	[77, 23],
	[85, 15],
];
const DPO_SHARE = [40, 63, 77, 85];

const PHASES: Phase[] = ['pairs', 'reward-model', 'generate', 'score', 'update', 'result'];
const columnOf = (phase: Phase) => PHASES.indexOf(phase);

interface LaneState {
	value: string;
	note: string;
	tone: CellTone;
	shown: boolean;
}

function buildSteps(input: CompareInput): CompareStep[] {
	const scenario = SCENARIOS[input.scenario];
	const steps: CompareStep[] = [];
	const readout = (round: number) => ({
		'RLHF: share preferred': `${RLHF_SHARE[round]}%`,
		'DPO: share preferred': `${DPO_SHARE[round]}%`,
		'models in memory': 'RLHF 4 · DPO 2',
	});
	const add = (phase: CompareStep['phase'], round: number, narration: string, readoutRound = round) => steps.push({ phase, round, narration, readout: readout(readoutRound) });

	add('intro', 0, `Goal: ${scenario.goal} that are ${scenario.quality}. Both methods start from the same SFT model and the same input: preference pairs, each one prompt with a chosen and a rejected answer (listed below). Top lane RLHF, bottom lane DPO, one phase per column. All scores and percentages here are illustrative.`);
	add('pairs', 0, `Both read the same ${scenario.pairs.length} pairs. Humans, or an AI judge, already decided which answer of each pair is better. At this point both models give a ${scenario.quality} answer only ${RLHF_SHARE[0]}% of the time.`);
	add('reward-model', 0, `RLHF first trains a separate reward model on the pairs, so it learns to score any answer: high for "${scenario.pairs[0].chosen}", low for "${scenario.pairs[0].rejected}". DPO skips this; it has no scorer at all.`);
	for (let round = 1; round <= input.rounds; round++) {
		const odds = DPO_ODDS[round - 1];
		add('generate', round, `Round ${round}. RLHF lets the model practise: it writes a new answer to a training prompt, here ${scenario.newAnswers[round - 1]}. DPO writes nothing new; it learns only from the answers already in the pairs.`, round - 1);
		add('score', round, `RLHF: the reward model scores that new answer ${RLHF_SCORES[round - 1]}. DPO: the model rates the two answers of each pair; right now it favours chosen over rejected ${odds[0]} : ${odds[1]}, measured against its frozen starting copy.`, round - 1);
		add('update', round, `RLHF updates the model to make high-scoring answers more likely: reinforcement learning on its own attempts. DPO updates the model to make each chosen answer more likely and its rejected answer less likely, the same kind of step as ordinary training. After this round: RLHF ${RLHF_SHARE[round]}%, DPO ${DPO_SHARE[round]}% ${scenario.quality}.`);
	}
	add('result', input.rounds, `Both models now prefer ${scenario.quality} answers, about equally; neither method is better by default. They learned the same preference, by different routes: RLHF built a reward model and practised with it, holding 4 models in memory (the model, its frozen copy, the reward model, and a value model PPO uses); DPO learned straight from the pairs with 2. The trade-off: RLHF's practice can find answers better than any in the pairs, while DPO can only learn what the pairs show.`);
	return steps;
}

function laneStates(input: CompareInput, step: CompareStep) {
	const scenario = SCENARIOS[input.scenario];
	const reached = (phase: Phase) => step.phase !== 'intro' && (step.phase === 'result' || PHASES.indexOf(step.phase) >= PHASES.indexOf(phase) || step.round > 1);
	const round = Math.max(step.round, 1);
	const active = (phase: Phase): CellTone => (step.phase === phase ? 'focus' : 'plain');
	const rlhf: Record<Phase, LaneState> = {
		pairs: { value: `${scenario.pairs.length}`, note: 'pairs', tone: active('pairs'), shown: reached('pairs') },
		'reward-model': { value: 'RM', note: 'rewarder', tone: active('reward-model'), shown: reached('reward-model') },
		generate: { value: 'new', note: `try ${round}`, tone: active('generate'), shown: reached('generate') },
		score: { value: String(RLHF_SCORES[round - 1]), note: 'scored', tone: active('score'), shown: reached('score') },
		update: { value: '↑', note: 'RL step', tone: active('update'), shown: reached('update') },
		result: { value: `${RLHF_SHARE[input.rounds]}%`, note: 'prefers', tone: step.phase === 'result' ? 'add' : 'plain', shown: step.phase === 'result' },
	};
	const odds = DPO_ODDS[step.phase === 'update' || step.phase === 'result' ? round : round - 1];
	const dpo: Record<Phase, LaneState> = {
		pairs: { value: `${scenario.pairs.length}`, note: 'pairs', tone: active('pairs'), shown: reached('pairs') },
		'reward-model': { value: '—', note: 'skipped', tone: step.phase === 'reward-model' ? 'remove' : 'plain', shown: reached('reward-model') },
		generate: { value: '—', note: 'skipped', tone: step.phase === 'generate' ? 'remove' : 'plain', shown: reached('generate') },
		score: { value: `${odds[0]}:${odds[1]}`, note: 'odds', tone: active('score'), shown: reached('score') },
		update: { value: '↑↓', note: 'DPO step', tone: active('update'), shown: reached('update') },
		result: { value: `${DPO_SHARE[input.rounds]}%`, note: 'prefers', tone: step.phase === 'result' ? 'add' : 'plain', shown: step.phase === 'result' },
	};
	return { rlhf, dpo };
}

const LANE_TOPS = { rlhf: 44, dpo: 164 };
const SCENE_HEIGHT = 250;

function CompareScene({ input, step }: CompareSceneProps) {
	const { rlhf, dpo } = laneStates(input, step);
	const markerColumn = step.phase === 'intro' ? 0 : columnOf(step.phase);
	const markerLabel = step.phase === 'intro' ? '' : step.round > 0 && step.phase !== 'result' ? `round ${step.round}` : step.phase.replace('-', ' ');
	const lanes = [
		{ key: 'rlhf', label: 'RLHF', top: LANE_TOPS.rlhf, states: rlhf },
		{ key: 'dpo', label: 'DPO', top: LANE_TOPS.dpo, states: dpo },
	];
	return (
		<Canvas columns={PHASES.length} height={SCENE_HEIGHT}>
			<ColumnMarker column={markerColumn} top={LANE_TOPS.rlhf - 8} height={LANE_TOPS.dpo - LANE_TOPS.rlhf + 92} label={markerLabel} hidden={step.phase === 'intro'} />
			{lanes.flatMap((lane) => [
				<RowLabel key={`label-${lane.key}`} top={lane.top + 16}>
					{lane.label}
				</RowLabel>,
				...PHASES.flatMap((phase, column) => {
					const state = lane.states[phase];
					return [
						<Cell key={`${lane.key}-${phase}`} value={state.value} column={column} top={lane.top} tone={state.tone} hidden={!state.shown} dimmed={state.value === '—'} />,
						<SubLabel key={`${lane.key}-${phase}-note`} column={column} top={lane.top + 60} hidden={!state.shown}>
							{state.note}
						</SubLabel>,
					];
				}),
			])}
		</Canvas>
	);
}

function PairsFooter({ input }: CompareSceneProps) {
	const chips: Chip[] = SCENARIOS[input.scenario].pairs.map((pair) => ({
		label: `${pair.prompt} → ✓ ${pair.chosen} · ✗ ${pair.rejected}`,
		state: 'plain',
	}));
	return <Chips chips={chips} />;
}

export default defineExplainer<CompareInput, CompareStep>({
	title: 'RLHF and DPO on the same preference pairs',
	stages: [
		{
			title: 'Same input, two routes',
			subtitle: 'Columns are training phases: the pairs, the reward model (RM), a new attempt, its score, the update, the result. Dashes are phases DPO skips; "odds" is how strongly DPO\'s model favours chosen over rejected. Below: the shared pairs (✓ chosen, ✗ rejected).',
			Scene: CompareScene,
			Footer: PairsFooter,
		},
	],
	examples: [
		{ input: { scenario: 0, rounds: 2 }, note: 'Preferred: short and warm' },
		{ input: { scenario: 1, rounds: 2 }, note: 'Preferred: concise, code first' },
		{ input: { scenario: 0, rounds: 3 }, note: 'One more round' },
	],
	fields: [{ name: 'rounds', label: 'training rounds', placeholder: `1 to ${MAX_ROUNDS}` }],
	describe: ({ scenario, rounds }) => `${SCENARIOS[scenario].goal} · ${rounds} round${rounds === 1 ? '' : 's'}`,
	parse(values) {
		const rounds = Number(values.rounds);
		if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) return { error: `Use 1 to ${MAX_ROUNDS} training rounds.` };
		return { input: { scenario: 0, rounds } };
	},
	steps: buildSteps,
});
