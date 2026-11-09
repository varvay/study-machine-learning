import { Canvas, Cell, Frame, RowLabel, SubLabel, type CellTone } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Truth = 'fire' | 'toast';
type Outcome = 'TP' | 'FP' | 'FN' | 'TN';

interface Reading {
	score: number;
	truth: Truth;
}

interface ThresholdInput {
	fireScores: number[];
	toastScores: number[];
}

interface ThresholdStep extends Step {
	threshold?: number;
}

type ThresholdSceneProps = SceneProps<ThresholdInput, ThresholdStep>;

interface Counts {
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	trueNegatives: number;
}

const THRESHOLDS = [90, 70, 50, 30, 10];
const MAX_READINGS = 10;

const CELL_TOP = 40;

function readingsOf({ fireScores, toastScores }: ThresholdInput): Reading[] {
	const readings: Reading[] = [
		...fireScores.map((score): Reading => ({ score, truth: 'fire' })),
		...toastScores.map((score): Reading => ({ score, truth: 'toast' })),
	];
	return readings.sort((a, b) => a.score - b.score);
}

function outcomeOf(reading: Reading, threshold: number): Outcome {
	const alarmSounds = reading.score >= threshold;
	if (reading.truth === 'fire') return alarmSounds ? 'TP' : 'FN';
	return alarmSounds ? 'FP' : 'TN';
}

function countsAt(readings: Reading[], threshold: number): Counts {
	const outcomes = readings.map((reading) => outcomeOf(reading, threshold));
	const count = (outcome: Outcome) => outcomes.filter((each) => each === outcome).length;
	return { truePositives: count('TP'), falsePositives: count('FP'), falseNegatives: count('FN'), trueNegatives: count('TN') };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const ratio = (part: number, whole: number) => (whole === 0 ? undefined : part / whole);
const formatRatio = (part: number, whole: number) => {
	const value = ratio(part, whole);
	return value === undefined ? `${part}/${whole}: undefined` : `${part}/${whole} = ${value.toFixed(2)}`;
};

function precisionAndRecall({ truePositives, falsePositives, falseNegatives }: Counts) {
	return {
		precision: ratio(truePositives, truePositives + falsePositives),
		recall: ratio(truePositives, truePositives + falseNegatives),
	};
}

function thresholdNarration(threshold: number, counts: Counts) {
	const { truePositives, falsePositives, falseNegatives } = counts;
	const alarms = truePositives + falsePositives;
	const precision =
		alarms === 0
			? 'Precision is undefined: the alarm never sounded.'
			: `Precision ${formatRatio(truePositives, alarms)}: of the times the alarm sounded, that share was a real fire.`;
	const verb = (count: number, one: string, many: string) => (count === 1 ? one : many);
	return `Threshold ${threshold}: ${plural(alarms, 'reading')} ${verb(alarms, 'scores', 'score')} ${threshold} or more, so the alarm sounds. ${truePositives} ${verb(truePositives, 'is a real fire', 'are real fires')} (TP) and ${falsePositives} ${verb(falsePositives, 'is', 'are')} toast (FP, false alarms). ${plural(falseNegatives, 'real fire')} ${verb(falseNegatives, 'scores', 'score')} lower and the detector stays silent: missed (FN). ${precision} Recall ${formatRatio(truePositives, truePositives + falseNegatives)}: of the real fires, that share set off the alarm.`;
}

const formatMetric = (value?: number) => (value === undefined ? '–' : value.toFixed(2));

function summaryNarration(readings: Reading[]) {
	const [highest, lowest] = [THRESHOLDS[0], THRESHOLDS.at(-1)!];
	const atHigh = precisionAndRecall(countsAt(readings, highest));
	const atLow = precisionAndRecall(countsAt(readings, lowest));
	const spoken = (value?: number) => (value === undefined ? 'undefined' : value.toFixed(2));
	const trend = `From threshold ${highest} down to ${lowest}, recall went from ${spoken(atHigh.recall)} to ${spoken(atLow.recall)} and precision from ${spoken(atHigh.precision)} to ${spoken(atLow.precision)}: a lower threshold misses fewer fires and beeps at more toast.`;
	const perfect = THRESHOLDS.find((threshold) => {
		const { precision, recall } = precisionAndRecall(countsAt(readings, threshold));
		return precision === 1 && recall === 1;
	});
	if (perfect !== undefined)
		return `${trend} At threshold ${perfect}, though, both are 1.00: every fire reads higher than every piece of toast, so one threshold separates them perfectly. Real detectors rarely rank this cleanly.`;
	return `${trend} No threshold here wins on both, so choose it by what a miss and a false alarm each cost. For fire, a miss is far worse, so detectors are set to beep too often rather than too rarely.`;
}

function buildSteps(input: ThresholdInput): ThresholdStep[] {
	const readings = readingsOf(input);
	const fireCount = input.fireScores.length;
	const readoutAt = (threshold?: number) => {
		if (threshold === undefined) return { threshold: '–', precision: '–', recall: '–', F1: '–' };
		const { precision, recall } = precisionAndRecall(countsAt(readings, threshold));
		const f1 = precision === undefined || recall === undefined || precision + recall === 0 ? undefined : (2 * precision * recall) / (precision + recall);
		return { threshold, precision: formatMetric(precision), recall: formatMetric(recall), F1: formatMetric(f1) };
	};

	const steps: ThresholdStep[] = [
		{
			readout: readoutAt(),
			narration: `${readings.length} smoke readings, sorted by the detector's score (0–100). Below each score is the truth: ${fireCount} were real fires, the rest burnt toast or steam. A threshold turns scores into decisions: at or above it, the alarm sounds.`,
		},
	];
	for (const threshold of THRESHOLDS) {
		steps.push({ threshold, readout: readoutAt(threshold), narration: thresholdNarration(threshold, countsAt(readings, threshold)) });
	}
	steps.push({ threshold: THRESHOLDS.at(-1), readout: readoutAt(THRESHOLDS.at(-1)), narration: summaryNarration(readings) });
	return steps;
}

const outcomeTone: Record<Outcome, CellTone> = { TP: 'add', FP: 'remove', FN: 'remove', TN: 'plain' };

function ThresholdScene({ input, step: { threshold } }: ThresholdSceneProps) {
	const readings = readingsOf(input);
	const firstAlarm = threshold === undefined ? -1 : readings.findIndex((reading) => reading.score >= threshold);
	return (
		<Canvas columns={readings.length} height={CELL_TOP + 110}>
			<RowLabel top={CELL_TOP + 16}>score</RowLabel>
			<RowLabel top={CELL_TOP + 60}>truth</RowLabel>
			<RowLabel top={CELL_TOP + 80}>outcome</RowLabel>
			{firstAlarm >= 0 && <Frame startColumn={firstAlarm} columns={readings.length - firstAlarm} top={CELL_TOP - 8} label={`alarm sounds (≥ ${threshold})`} />}
			{readings.map((reading, index) => {
				const outcome = threshold === undefined ? undefined : outcomeOf(reading, threshold);
				return [
					<Cell key={`reading-${index}`} value={reading.score} column={index} top={CELL_TOP} tone={outcome ? outcomeTone[outcome] : 'plain'} />,
					<SubLabel key={`truth-${index}`} column={index} top={CELL_TOP + 62}>
						{reading.truth}
					</SubLabel>,
					<SubLabel key={`outcome-${index}`} column={index} top={CELL_TOP + 82} hidden={!outcome}>
						{outcome ?? ''}
					</SubLabel>,
				];
			})}
		</Canvas>
	);
}

function parseScores(raw: string, label: string): number[] | string {
	const scores = raw
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (scores.length === 0) return `Enter at least one ${label} score.`;
	if (scores.some((score) => !Number.isInteger(score) || score < 0 || score > 100)) return 'Scores are whole numbers from 0 to 100.';
	return scores;
}

export default defineExplainer<ThresholdInput, ThresholdStep>({
	title: 'Move the threshold: precision against recall',
	stages: [
		{
			title: 'A smoke detector at five thresholds',
			subtitle: 'Green: a real fire caught (TP). Red: a mistake, either a false alarm at toast (FP) or a silent miss during a fire (FN). Plain: toast correctly ignored (TN).',
			Scene: ThresholdScene,
		},
	],
	examples: [
		{ input: { fireScores: [95, 85, 72, 55, 30], toastScores: [65, 45, 20, 12, 5] }, note: 'A decent detector' },
		{ input: { fireScores: [95, 88, 80, 75, 62], toastScores: [40, 31, 22, 15, 8] }, note: 'A perfect ranking' },
		{ input: { fireScores: [70, 50, 35, 20, 12], toastScores: [85, 60, 45, 25, 8] }, note: 'A weak detector' },
	],
	fields: [
		{ name: 'fire', label: 'fire readings', placeholder: 'e.g. 95 72 30' },
		{ name: 'toast', label: 'toast readings', placeholder: 'e.g. 65 20 5' },
	],
	describe: ({ fireScores, toastScores }) => `fire ${fireScores.join(' ')} · toast ${toastScores.join(' ')}`,
	parse(values) {
		const fireScores = parseScores(values.fire, 'fire');
		if (typeof fireScores === 'string') return { error: fireScores };
		const toastScores = parseScores(values.toast, 'toast');
		if (typeof toastScores === 'string') return { error: toastScores };
		if (fireScores.length + toastScores.length > MAX_READINGS) return { error: `Use ${MAX_READINGS} readings or fewer in total.` };
		return { input: { fireScores, toastScores } };
	},
	steps: buildSteps,
});
