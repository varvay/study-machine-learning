import { Canvas, Cell, ColumnMarker, Frame, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type GateRule = 'no-harm' | 'non-inferiority';
type Decision = 'advance' | 'hold' | 'rollback';
type DecisionReason = 'confidently-worse' | 'no-evidence-of-harm' | 'within-margin' | 'undecided' | 'out-of-time';
type Outcome = 'promoted' | 'rolled-back';

interface Stage {
	weightPercent: number;
	rule: GateRule;
}

interface CanaryInput {
	controlPassRate: number;
	canaryPassRates: number[];
	marginPoints: number;
	judgedPerWindow: number;
}

interface WindowResult {
	stageIndex: number;
	windowInStage: number;
	canaryJudged: number;
	controlJudged: number;
	deltaPoints: number;
	lowerPoints: number;
	upperPoints: number;
	decision: Decision;
	reason: DecisionReason;
}

interface CanaryStep extends Step {
	revealedWindows: number;
	showsVerdict: boolean;
}

type CanarySceneProps = SceneProps<CanaryInput, CanaryStep>;

const STAGES: Stage[] = [
	{ weightPercent: 5, rule: 'no-harm' },
	{ weightPercent: 25, rule: 'no-harm' },
	{ weightPercent: 50, rule: 'non-inferiority' },
];
const MAX_WINDOWS_PER_STAGE = 3;
const Z_95 = 1.96;

const LIMITS = {
	passRate: { min: 1, max: 99 },
	marginPoints: { min: 0.5, max: 10 },
	judgedPerWindow: { min: 100, max: 20000 },
};

const TRAFFIC_TOP = 44;
const DELTA_TOP = 156;
const DECISION_TOP = 246;
const SCENE_HEIGHT = 276;

function standardErrorPoints(canaryRate: number, canaryJudged: number, controlRate: number, controlJudged: number) {
	const variance = (canaryRate * (1 - canaryRate)) / canaryJudged + (controlRate * (1 - controlRate)) / controlJudged;
	return Math.sqrt(variance) * 100;
}

function decide(rule: GateRule, lowerPoints: number, upperPoints: number, marginPoints: number, windowInStage: number) {
	if (upperPoints < -marginPoints) return { decision: 'rollback', reason: 'confidently-worse' } as const;
	if (rule === 'no-harm') return { decision: 'advance', reason: 'no-evidence-of-harm' } as const;
	if (lowerPoints >= -marginPoints) return { decision: 'advance', reason: 'within-margin' } as const;
	if (windowInStage === MAX_WINDOWS_PER_STAGE) return { decision: 'rollback', reason: 'out-of-time' } as const;
	return { decision: 'hold', reason: 'undecided' } as const;
}

function measureWindow(input: CanaryInput, stageIndex: number, windowInStage: number): WindowResult {
	const { weightPercent, rule } = STAGES[stageIndex];
	const canaryJudged = Math.round((windowInStage * input.judgedPerWindow * weightPercent) / 100);
	const controlJudged = windowInStage * input.judgedPerWindow - canaryJudged;
	const canaryRate = input.canaryPassRates[stageIndex] / 100;
	const controlRate = input.controlPassRate / 100;
	const deltaPoints = input.canaryPassRates[stageIndex] - input.controlPassRate;
	const halfWidth = Z_95 * standardErrorPoints(canaryRate, canaryJudged, controlRate, controlJudged);
	const lowerPoints = deltaPoints - halfWidth;
	const upperPoints = deltaPoints + halfWidth;
	return { stageIndex, windowInStage, canaryJudged, controlJudged, deltaPoints, lowerPoints, upperPoints, ...decide(rule, lowerPoints, upperPoints, input.marginPoints, windowInStage) };
}

function runRollout(input: CanaryInput): WindowResult[] {
	const windows: WindowResult[] = [];
	for (let stageIndex = 0; stageIndex < STAGES.length; stageIndex++) {
		for (let windowInStage = 1; windowInStage <= MAX_WINDOWS_PER_STAGE; windowInStage++) {
			const result = measureWindow(input, stageIndex, windowInStage);
			windows.push(result);
			if (result.decision === 'rollback') return windows;
			if (result.decision === 'advance') break;
		}
	}
	return windows;
}

const outcomeOf = (windows: WindowResult[]): Outcome => (windows.at(-1)!.decision === 'advance' ? 'promoted' : 'rolled-back');

const signed = (points: number) => `${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points).toFixed(1)}`;
const intervalLabel = ({ lowerPoints, upperPoints }: WindowResult) => `${signed(lowerPoints)}…${signed(upperPoints)}`;
const percent = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

function ruleSentence(rule: GateRule, marginPoints: number) {
	return rule === 'no-harm'
		? `The rule at this stage: roll back only if the canary is confidently worse by more than ${marginPoints} points (the whole interval below −${marginPoints}).`
		: `The rule at this stage: go to 100% only once the canary is shown to be at most ${marginPoints} points worse (the whole interval above −${marginPoints}).`;
}

function reasonSentence(result: WindowResult, marginPoints: number) {
	switch (result.reason) {
		case 'confidently-worse':
			return `The whole interval lies below −${marginPoints}: the canary is confidently worse. <b>Roll back.</b>`;
		case 'no-evidence-of-harm':
			return `The interval reaches above −${marginPoints}, so there is no proof of harm. <b>Advance</b> to more traffic.`;
		case 'within-margin':
			return `The whole interval lies above −${marginPoints}: the canary is at most ${marginPoints} points worse, and possibly better. <b>Advance.</b>`;
		case 'undecided':
			return `The interval straddles −${marginPoints}: the data cannot yet tell. <b>Hold</b> at this weight for another window.`;
		case 'out-of-time':
			return `After ${MAX_WINDOWS_PER_STAGE} windows the interval still straddles −${marginPoints}. Shipping needs proof, so no proof means <b>roll back</b>.`;
	}
}

function windowNarration(input: CanaryInput, result: WindowResult) {
	const { weightPercent, rule } = STAGES[result.stageIndex];
	const opening =
		result.windowInStage === 1
			? `${weightPercent}% of traffic goes to the canary. ${ruleSentence(rule, input.marginPoints)} `
			: `Window ${result.windowInStage} at ${weightPercent}%: the samples add up. `;
	const measured = `So far ${result.canaryJudged} canary answers and ${result.controlJudged} control answers are judged. The canary passes ${percent(input.canaryPassRates[result.stageIndex])} against ${percent(input.controlPassRate)}: Δ = ${signed(result.deltaPoints)} points, 95% interval ${intervalLabel(result)}.`;
	return `${opening}${measured} ${reasonSentence(result, input.marginPoints)}`;
}

function verdictNarration(input: CanaryInput, windows: WindowResult[]) {
	const last = windows.at(-1)!;
	const canaryAnswers = windows.filter((result, index) => windows[index + 1]?.stageIndex !== result.stageIndex).reduce((sum, result) => sum + result.canaryJudged, 0);
	if (outcomeOf(windows) === 'promoted')
		return `The candidate goes to 100% after ${windows.length} windows and ${canaryAnswers} judged canary answers. At 100% there is no control group left to compare with, so the proof had to come at 50%.`;
	const stage = STAGES[last.stageIndex];
	const unprovenReason =
		last.deltaPoints > -input.marginPoints
			? `Its measured Δ of ${signed(last.deltaPoints)} lies inside the margin, but ${last.canaryJudged} answers per version were too few to prove it: judge more answers per window, or run longer windows.`
			: `Its Δ of ${signed(last.deltaPoints)} sits at or beyond the margin itself, so more data would not prove it acceptable.`;
	const caught =
		last.reason === 'confidently-worse'
			? `The regression was caught at ${stage.weightPercent}%, after ${canaryAnswers} judged canary answers.`
			: `It was never proven to be within ${input.marginPoints} points, so it does not ship. ${unprovenReason}`;
	const [first] = windows;
	const hiddenEarly = last.stageIndex > 0 && last.reason === 'confidently-worse' && first.deltaPoints < -input.marginPoints;
	const smallStageNote = hiddenEarly
		? ` At ${STAGES[0].weightPercent}%, a Δ of ${signed(first.deltaPoints)} was already measured, but its interval (${intervalLabel(first)}) was too wide to act on: too few answers.`
		: '';
	return `Rolled back: all traffic returns to the control version. ${caught}${smallStageNote}`;
}

function buildSteps(input: CanaryInput): CanaryStep[] {
	const windows = runRollout(input);
	const readoutFor = (result?: WindowResult) =>
		result
			? {
					'canary share': `${STAGES[result.stageIndex].weightPercent}%`,
					window: result.windowInStage,
					Δ: `${signed(result.deltaPoints)} pts`,
					'95% interval': intervalLabel(result),
				}
			: { 'canary share': '0%', window: '–', Δ: '–', '95% interval': '–' };

	const steps: CanaryStep[] = [
		{
			revealedWindows: 0,
			showsVerdict: false,
			readout: readoutFor(),
			narration: `A new prompt version (the canary) rolls out in stages: ${STAGES.map((stage) => `${stage.weightPercent}%`).join(', ')}, then 100%. The current version (the control) answers the rest. An LLM judge scores ${input.judgedPerWindow} answers per window, split by traffic share, and the gate compares pass rates: the control passes ${percent(input.controlPassRate)}. A drop of up to ${input.marginPoints} points is acceptable (the margin).`,
		},
	];
	windows.forEach((result, index) =>
		steps.push({ revealedWindows: index + 1, showsVerdict: false, readout: readoutFor(result), narration: windowNarration(input, result) }),
	);
	steps.push({ revealedWindows: windows.length, showsVerdict: true, readout: readoutFor(windows.at(-1)), narration: verdictNarration(input, windows) });
	return steps;
}

const decisionTone: Record<Decision, CellTone> = { advance: 'add', hold: 'focus', rollback: 'remove' };

function stageSpans(windows: WindowResult[]) {
	return STAGES.map((stage, stageIndex) => {
		const startColumn = windows.findIndex((result) => result.stageIndex === stageIndex);
		const columns = windows.filter((result) => result.stageIndex === stageIndex).length;
		return { stage, stageIndex, startColumn, columns };
	}).filter((span) => span.columns > 0);
}

function RolloutScene({ input, step: { revealedWindows, showsVerdict } }: CanarySceneProps) {
	const windows = runRollout(input);
	const verdictColumn = windows.length;
	const promoted = outcomeOf(windows) === 'promoted';
	const currentColumn = showsVerdict ? verdictColumn : revealedWindows - 1;
	return (
		<Canvas columns={windows.length + 1} height={SCENE_HEIGHT}>
			<RowLabel top={TRAFFIC_TOP + 16}>canary share</RowLabel>
			<RowLabel top={DELTA_TOP + 16}>Δ pass rate</RowLabel>
			<RowLabel top={DECISION_TOP}>decision</RowLabel>
			{stageSpans(windows)
				.filter((span) => span.startColumn < revealedWindows)
				.map((span, index, revealed) => (
					<Frame
						key={`stage-${span.stageIndex}`}
						startColumn={span.startColumn}
						columns={span.columns}
						top={TRAFFIC_TOP - 8}
						label={index < revealed.length - 1 ? '' : span.stage.rule === 'no-harm' ? `${span.stage.weightPercent}%: no harm?` : `${span.stage.weightPercent}%: within margin?`}
					/>
				))}
			{revealedWindows > 0 && <ColumnMarker key="current" column={currentColumn} top={DELTA_TOP - 10} height={120} label="now" />}
			{windows.map((result, column) => {
				const hidden = column >= revealedWindows;
				return [
					<Cell key={`traffic-${column}`} value={`${STAGES[result.stageIndex].weightPercent}%`} column={column} top={TRAFFIC_TOP} hidden={hidden} />,
					<SubLabel key={`judged-${column}`} column={column} top={TRAFFIC_TOP + 58} hidden={hidden}>
						n={result.canaryJudged}
					</SubLabel>,
					<Cell key={`delta-${column}`} value={signed(result.deltaPoints)} column={column} top={DELTA_TOP} tone={decisionTone[result.decision]} hidden={hidden} />,
					<SubLabel key={`interval-${column}`} column={column} top={DELTA_TOP + 58} hidden={hidden}>
						{intervalLabel(result)}
					</SubLabel>,
					<SubLabel key={`decision-${column}`} column={column} top={DECISION_TOP} hidden={hidden}>
						{result.decision}
					</SubLabel>,
				];
			})}
			<Cell key="verdict" value={promoted ? '100%' : '0%'} column={verdictColumn} top={TRAFFIC_TOP} tone={promoted ? 'add' : 'remove'} hidden={!showsVerdict} />
			<SubLabel key="verdict-label" column={verdictColumn} top={TRAFFIC_TOP + 58} hidden={!showsVerdict}>
				{promoted ? 'promoted' : 'rolled back'}
			</SubLabel>
		</Canvas>
	);
}

function parseNumber(raw: string, label: string, { min, max }: { min: number; max: number }): number | string {
	const value = Number(raw);
	if (raw.trim() === '' || !Number.isFinite(value) || value < min || value > max) return `${label} must be a number from ${min} to ${max}.`;
	return value;
}

function parseCanaryRates(raw: string): number[] | string {
	const rates = raw.split(/[\s,]+/).filter(Boolean).map(Number);
	if (rates.length !== STAGES.length) return `Enter ${STAGES.length} canary pass rates, one per stage (${STAGES.map((stage) => `${stage.weightPercent}%`).join(', ')}).`;
	if (rates.some((rate) => !Number.isFinite(rate) || rate < LIMITS.passRate.min || rate > LIMITS.passRate.max))
		return `Pass rates are percentages from ${LIMITS.passRate.min} to ${LIMITS.passRate.max}.`;
	return rates;
}

export default defineExplainer<CanaryInput, CanaryStep>({
	title: 'A canary rollout gated by an eval score',
	stages: [
		{
			title: 'Canary vs control, window by window',
			subtitle:
				'Each column is one observation window. Top: the canary’s share of traffic and how many of its answers were judged so far. Middle: the canary’s pass rate minus the control’s, with its 95% interval below. Green: advance. Amber: hold. Red: roll back.',
			Scene: RolloutScene,
		},
	],
	examples: [
		{ input: { controlPassRate: 85, canaryPassRates: [86, 85.5, 86], marginPoints: 2, judgedPerWindow: 2000 }, note: 'A good candidate' },
		{ input: { controlPassRate: 85, canaryPassRates: [78, 78, 78], marginPoints: 2, judgedPerWindow: 2000 }, note: 'A clear regression' },
		{ input: { controlPassRate: 85, canaryPassRates: [84, 83.5, 83], marginPoints: 2, judgedPerWindow: 2000 }, note: 'A regression the size of the margin' },
		{ input: { controlPassRate: 85, canaryPassRates: [86, 85.5, 86], marginPoints: 2, judgedPerWindow: 600 }, note: 'A good candidate, too little traffic' },
	],
	fields: [
		{ name: 'control', label: 'control pass rate %', placeholder: 'e.g. 85' },
		{ name: 'canary', label: `canary pass rate % at ${STAGES.map((stage) => `${stage.weightPercent}%`).join(' / ')}`, placeholder: 'e.g. 86 85.5 86' },
		{ name: 'margin', label: 'margin (points)', placeholder: 'e.g. 2' },
		{ name: 'judged', label: 'judged answers per window', placeholder: 'e.g. 2000' },
	],
	describe: ({ controlPassRate, canaryPassRates, marginPoints, judgedPerWindow }) =>
		`control ${controlPassRate}% · canary ${canaryPassRates.join(' / ')}% · margin ${marginPoints} · ${judgedPerWindow} judged per window`,
	parse(values) {
		const controlPassRate = parseNumber(values.control, 'The control pass rate', LIMITS.passRate);
		if (typeof controlPassRate === 'string') return { error: controlPassRate };
		const canaryPassRates = parseCanaryRates(values.canary);
		if (typeof canaryPassRates === 'string') return { error: canaryPassRates };
		const marginPoints = parseNumber(values.margin, 'The margin', LIMITS.marginPoints);
		if (typeof marginPoints === 'string') return { error: marginPoints };
		const judgedPerWindow = parseNumber(values.judged, 'Judged answers per window', LIMITS.judgedPerWindow);
		if (typeof judgedPerWindow === 'string') return { error: judgedPerWindow };
		if (!Number.isInteger(judgedPerWindow)) return { error: 'Judged answers per window is a whole number.' };
		return { input: { controlPassRate, canaryPassRates, marginPoints, judgedPerWindow } };
	},
	steps: buildSteps,
});
