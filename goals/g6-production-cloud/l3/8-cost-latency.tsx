import { Canvas, Cell, Frame, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Truth = 'right' | 'wrong';

interface SmallModelAnswer {
	confidence: number;
	truth: Truth;
}

interface CascadeInput {
	rightConfidences: number[];
	wrongConfidences: number[];
	costRatio: number;
	qualityFloor: number;
}

type Setting = { kind: 'always-large' } | { kind: 'cascade'; threshold: number };

interface CascadeStep extends Step {
	setting?: Setting;
}

type CascadeSceneProps = SceneProps<CascadeInput, CascadeStep>;

interface SettingResult {
	escalated: number;
	correct: number;
	costUnits: number;
	alwaysLargeUnits: number;
}

const THRESHOLDS = [90, 70, 50, 30, 0];
const MAX_REQUESTS = 10;
const LIMITS = {
	confidence: { min: 0, max: 100 },
	costRatio: { min: 1.1, max: 50 },
	qualityFloor: { min: 1, max: 100 },
};

const CELL_TOP = 40;
const SCENE_HEIGHT = 150;

function answersOf({ rightConfidences, wrongConfidences }: CascadeInput): SmallModelAnswer[] {
	const answers: SmallModelAnswer[] = [
		...rightConfidences.map((confidence): SmallModelAnswer => ({ confidence, truth: 'right' })),
		...wrongConfidences.map((confidence): SmallModelAnswer => ({ confidence, truth: 'wrong' })),
	];
	return answers.sort((a, b) => a.confidence - b.confidence);
}

const escalates = (answer: SmallModelAnswer, setting: Setting) => setting.kind === 'always-large' || answer.confidence < setting.threshold;

function evaluate(answers: SmallModelAnswer[], setting: Setting, costRatio: number): SettingResult {
	const alwaysLargeUnits = answers.length * costRatio;
	if (setting.kind === 'always-large') return { escalated: answers.length, correct: answers.length, costUnits: alwaysLargeUnits, alwaysLargeUnits };
	const escalated = answers.filter((answer) => escalates(answer, setting)).length;
	const keptWrong = answers.filter((answer) => !escalates(answer, setting) && answer.truth === 'wrong').length;
	return { escalated, correct: answers.length - keptWrong, costUnits: answers.length + escalated * costRatio, alwaysLargeUnits };
}

const share = (part: number, whole: number) => Math.round((100 * part) / whole);
const units = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const settingName = (setting: Setting) =>
	setting.kind === 'always-large' ? 'always the large model' : setting.threshold === 0 ? 'always the small model' : `threshold ${setting.threshold}`;

function thresholdNarration(answers: SmallModelAnswer[], threshold: number, costRatio: number) {
	const setting: Setting = { kind: 'cascade', threshold };
	const result = evaluate(answers, setting, costRatio);
	const kept = answers.filter((answer) => !escalates(answer, setting));
	const keptWrong = kept.filter((answer) => answer.truth === 'wrong');
	const routing =
		threshold === 0
			? `Threshold 0: nothing escalates.`
			: `Threshold ${threshold}: requests where the small model's confidence is below ${threshold} go on to the large model: ${result.escalated} of ${answers.length}.`;
	const keptGroup = result.escalated === 0 ? `All ${kept.length}` : `The other ${kept.length}`;
	const keptWrongDetail = keptWrong.length > 0 ? ` (wrong answers kept at confidence ${keptWrong.map((answer) => answer.confidence).join(', ')})` : '';
	const keptSentence = kept.length === 0 ? '' : ` ${keptGroup} keep the small answer: ${kept.length - keptWrong.length} right, ${keptWrong.length} wrong${keptWrongDetail}.`;
	const largeCalls = `${result.escalated} large call${result.escalated === 1 ? '' : 's'}`;
	const cost = `Cost: ${answers.length} small calls + ${largeCalls} × ${units(costRatio)} = ${units(result.costUnits)} units, ${share(result.costUnits, result.alwaysLargeUnits)}% of always-large.`;
	const overBudget = result.costUnits > result.alwaysLargeUnits ? ' That is more than sending everything to the large model: escalated requests pay for both calls.' : '';
	return `${routing}${keptSentence} Accuracy ${result.correct}/${answers.length} = ${share(result.correct, answers.length)}%. ${cost}${overBudget}`;
}

function summaryNarration(input: CascadeInput, answers: SmallModelAnswer[]) {
	const settings: Setting[] = [{ kind: 'always-large' }, ...THRESHOLDS.map((threshold): Setting => ({ kind: 'cascade', threshold }))];
	const meetingFloor = settings
		.map((setting) => ({ setting, result: evaluate(answers, setting, input.costRatio) }))
		.filter(({ result }) => share(result.correct, answers.length) >= input.qualityFloor)
		.sort((a, b) => a.result.costUnits - b.result.costUnits);
	const breakEven = share(input.costRatio - 1, input.costRatio);
	const breakEvenSentence = `A cascade saves money only while fewer than 1 − 1/${units(input.costRatio)} = ${breakEven}% of requests escalate.`;
	const [cheapest] = meetingFloor;
	if (cheapest.setting.kind === 'always-large')
		return `The client's floor is ${input.qualityFloor}% accuracy. Only "always the large model" meets it: the small model's confidence does not separate its right answers from its wrong ones, so every threshold that saves money lets wrong answers through. Fix the scorer before building the cascade. ${breakEvenSentence}`;
	const saving = 100 - share(cheapest.result.costUnits, cheapest.result.alwaysLargeUnits);
	return `The client's floor is ${input.qualityFloor}% accuracy. The cheapest setting that meets it is ${settingName(cheapest.setting)}: ${share(cheapest.result.correct, answers.length)}% accuracy at ${share(cheapest.result.costUnits, cheapest.result.alwaysLargeUnits)}% of the always-large cost, a ${saving}% saving. ${breakEvenSentence}`;
}

function buildSteps(input: CascadeInput): CascadeStep[] {
	const answers = answersOf(input);
	const readoutFor = (setting?: Setting) => {
		if (!setting) return { setting: '–', escalated: '–', accuracy: '–', 'cost vs large': '–' };
		const result = evaluate(answers, setting, input.costRatio);
		return {
			setting: settingName(setting),
			escalated: `${result.escalated}/${answers.length}`,
			accuracy: `${share(result.correct, answers.length)}%`,
			'cost vs large': `${share(result.costUnits, result.alwaysLargeUnits)}%`,
		};
	};
	const alwaysLarge: Setting = { kind: 'always-large' };
	const wrongCount = input.wrongConfidences.length;
	const steps: CascadeStep[] = [
		{
			readout: readoutFor(),
			narration: `${answers.length} requests, sorted by the small model's confidence in its own answer (0–100). Below each is whether that answer was right: ${wrongCount} of ${answers.length} are wrong. A cascade keeps the small answer when the confidence reaches a threshold, and otherwise asks the large model, which costs ${units(input.costRatio)}× as much per request. Assume the large model answers every escalated request correctly, and the confidence score is free.`,
		},
		{
			setting: alwaysLarge,
			readout: readoutFor(alwaysLarge),
			narration: `Baseline: send everything to the large model. Accuracy ${answers.length}/${answers.length} = 100%, cost ${answers.length} × ${units(input.costRatio)} = ${units(answers.length * input.costRatio)} units (one unit is one small-model call).`,
		},
	];
	for (const threshold of THRESHOLDS) {
		const setting: Setting = { kind: 'cascade', threshold };
		steps.push({ setting, readout: readoutFor(setting), narration: thresholdNarration(answers, threshold, input.costRatio) });
	}
	steps.push({ setting: { kind: 'cascade', threshold: THRESHOLDS.at(-1)! }, readout: readoutFor({ kind: 'cascade', threshold: THRESHOLDS.at(-1)! }), narration: summaryNarration(input, answers) });
	return steps;
}

function toneOf(answer: SmallModelAnswer, setting?: Setting): CellTone {
	if (!setting) return 'plain';
	if (escalates(answer, setting)) return 'focus';
	return answer.truth === 'right' ? 'add' : 'remove';
}

function CascadeScene({ input, step: { setting } }: CascadeSceneProps) {
	const answers = answersOf(input);
	const escalatedCount = setting ? answers.filter((answer) => escalates(answer, setting)).length : 0;
	const frameLabel = setting?.kind === 'always-large' ? 'all → large' : `→ large (below ${setting?.kind === 'cascade' ? setting.threshold : ''})`;
	return (
		<Canvas columns={answers.length} height={SCENE_HEIGHT}>
			<RowLabel top={CELL_TOP + 16}>confidence</RowLabel>
			<RowLabel top={CELL_TOP + 60}>small answer</RowLabel>
			<RowLabel top={CELL_TOP + 82}>served by</RowLabel>
			{escalatedCount > 0 && <Frame startColumn={0} columns={escalatedCount} top={CELL_TOP - 8} label={frameLabel} />}
			{answers.map((answer, index) => [
				<Cell key={`confidence-${index}`} value={answer.confidence} column={index} top={CELL_TOP} tone={toneOf(answer, setting)} />,
				<SubLabel key={`truth-${index}`} column={index} top={CELL_TOP + 62}>
					{answer.truth}
				</SubLabel>,
				<SubLabel key={`route-${index}`} column={index} top={CELL_TOP + 84} hidden={!setting}>
					{setting && escalates(answer, setting) ? 'large' : 'small'}
				</SubLabel>,
			])}
		</Canvas>
	);
}

function parseConfidences(raw: string, label: string): number[] | string {
	const confidences = raw.split(/[\s,]+/).filter(Boolean).map(Number);
	if (confidences.length === 0) return `Enter at least one confidence for ${label} answers.`;
	if (confidences.some((value) => !Number.isInteger(value) || value < LIMITS.confidence.min || value > LIMITS.confidence.max))
		return `Confidences are whole numbers from ${LIMITS.confidence.min} to ${LIMITS.confidence.max}.`;
	return confidences;
}

function parseBounded(raw: string, label: string, { min, max }: { min: number; max: number }): number | string {
	const value = Number(raw);
	if (raw.trim() === '' || !Number.isFinite(value) || value < min || value > max) return `${label} must be a number from ${min} to ${max}.`;
	return value;
}

export default defineExplainer<CascadeInput, CascadeStep>({
	title: 'A model cascade: when to ask the bigger model',
	stages: [
		{
			title: 'One threshold, many settings',
			subtitle:
				'Each cell is one request, labeled with the small model’s confidence. Amber: escalated to the large model. Green: the small answer is kept and right. Red: the small answer is kept and wrong.',
			Scene: CascadeScene,
		},
	],
	examples: [
		{
			input: { rightConfidences: [96, 92, 88, 81, 74, 66], wrongConfidences: [72, 58, 41, 25], costRatio: 4, qualityFloor: 90 },
			note: 'Haiku → Opus: 4× the price',
		},
		{
			input: { rightConfidences: [96, 92, 88, 81, 74, 66], wrongConfidences: [72, 58, 41, 25], costRatio: 2, qualityFloor: 90 },
			note: 'Haiku → Sonnet: 2× the price',
		},
		{
			input: { rightConfidences: [95, 85, 70, 60, 45], wrongConfidences: [97, 90, 80, 55, 35], costRatio: 4, qualityFloor: 90 },
			note: 'An overconfident small model',
		},
	],
	fields: [
		{ name: 'right', label: 'confidences, right answers', placeholder: 'e.g. 96 88 74' },
		{ name: 'wrong', label: 'confidences, wrong answers', placeholder: 'e.g. 72 41' },
		{ name: 'ratio', label: 'large ÷ small cost', placeholder: 'e.g. 4' },
		{ name: 'floor', label: 'quality floor %', placeholder: 'e.g. 90' },
	],
	describe: ({ rightConfidences, wrongConfidences, costRatio, qualityFloor }) =>
		`right ${rightConfidences.join(' ')} · wrong ${wrongConfidences.join(' ')} · ${costRatio}× · floor ${qualityFloor}%`,
	parse(values) {
		const rightConfidences = parseConfidences(values.right, 'right');
		if (typeof rightConfidences === 'string') return { error: rightConfidences };
		const wrongConfidences = parseConfidences(values.wrong, 'wrong');
		if (typeof wrongConfidences === 'string') return { error: wrongConfidences };
		if (rightConfidences.length + wrongConfidences.length > MAX_REQUESTS) return { error: `Use ${MAX_REQUESTS} requests or fewer in total.` };
		const costRatio = parseBounded(values.ratio, 'The cost ratio', LIMITS.costRatio);
		if (typeof costRatio === 'string') return { error: costRatio };
		const qualityFloor = parseBounded(values.floor, 'The quality floor', LIMITS.qualityFloor);
		if (typeof qualityFloor === 'string') return { error: qualityFloor };
		return { input: { rightConfidences, wrongConfidences, costRatio, qualityFloor } };
	},
	steps: buildSteps,
});
