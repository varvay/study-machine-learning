import { Dot, Link, Plane, PlotCanvas, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

interface Sample {
	x: number;
	y: number;
}

interface FitInput {
	degree: number;
}

type Phase = 'data' | 'fit' | 'test' | 'verdict';

interface FitStep extends Step {
	phase: Phase;
}

type FitSceneProps = SceneProps<FitInput, FitStep>;

type Coefficients = number[];

const MAX_DEGREE = 9;
const HIGH_ERROR = 0.3;
const OVERFIT_GAP = 0.1;

const pattern = (x: number) => Math.sin(2 * Math.PI * x);

const withNoise = (xs: number[], noise: number[]): Sample[] => xs.map((x, index) => ({ x, y: pattern(x) + noise[index] }));

const TRAINING = withNoise([0.02, 0.13, 0.22, 0.33, 0.42, 0.53, 0.62, 0.72, 0.83, 0.97], [0.2, -0.15, 0.22, -0.2, 0.12, -0.22, 0.15, -0.1, 0.2, -0.16]);
const NEW_DATA = withNoise([0.07, 0.18, 0.27, 0.38, 0.47, 0.57, 0.67, 0.77, 0.88, 0.99], [-0.08, 0.1, -0.12, 0.06, -0.1, 0.12, -0.05, 0.1, -0.08, 0.05]);

const centered = (x: number) => 2 * x - 1;

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
	const rows = matrix.map((row, index) => [...row, vector[index]]);
	const size = rows.length;
	for (let column = 0; column < size; column++) {
		const pivot = rows.slice(column).reduce((best, row, offset) => (Math.abs(row[column]) > Math.abs(rows[best][column]) ? column + offset : best), column);
		[rows[column], rows[pivot]] = [rows[pivot], rows[column]];
		for (let row = column + 1; row < size; row++) {
			const factor = rows[row][column] / rows[column][column];
			for (let entry = column; entry <= size; entry++) rows[row][entry] -= factor * rows[column][entry];
		}
	}
	const solution = new Array<number>(size).fill(0);
	for (let row = size - 1; row >= 0; row--) {
		const known = rows[row].slice(row + 1, size).reduce((sum, value, offset) => sum + value * solution[row + 1 + offset], 0);
		solution[row] = (rows[row][size] - known) / rows[row][row];
	}
	return solution;
}

function fitPolynomial(samples: Sample[], degree: number): Coefficients {
	const powersOf = (x: number) => Array.from({ length: degree + 1 }, (_, power) => centered(x) ** power);
	const design = samples.map((sample) => powersOf(sample.x));
	const normalMatrix = design[0].map((_, i) => design[0].map((_, j) => design.reduce((sum, row) => sum + row[i] * row[j], 0)));
	const normalVector = design[0].map((_, i) => design.reduce((sum, row, index) => sum + row[i] * samples[index].y, 0));
	return solveLinearSystem(normalMatrix, normalVector);
}

const predict = (coefficients: Coefficients, x: number) => coefficients.reduce((sum, coefficient, power) => sum + coefficient * centered(x) ** power, 0);

const rmse = (coefficients: Coefficients, samples: Sample[]) =>
	Math.sqrt(samples.reduce((sum, sample) => sum + (predict(coefficients, sample.x) - sample.y) ** 2, 0) / samples.length);

function errorsFor(degree: number) {
	const coefficients = fitPolynomial(TRAINING, degree);
	return { coefficients, trainError: rmse(coefficients, TRAINING), testError: rmse(coefficients, NEW_DATA) };
}

const formatError = (error: number) => error.toFixed(2);

function fitNarration(degree: number, trainError: number) {
	const shape =
		degree + 1 >= TRAINING.length
			? 'It passes through every point: with as many parameters as points, it can memorize them, noise included.'
			: trainError > HIGH_ERROR
				? 'The curve is too stiff to follow the bends, however its numbers are set.'
				: 'It follows the bends and cuts through the noise.';
	return `Training is done. The curve misses the training points by ${formatError(trainError)} on average (RMSE, G2.2). ${shape}`;
}

function verdictNarration(trainError: number, testError: number) {
	if (trainError > HIGH_ERROR)
		return `Both errors are high (${formatError(trainError)} and ${formatError(testError)}): the model is too simple for the pattern. This is <b>underfitting</b>, or high bias. More data will not help; a more flexible model will.`;
	if (testError - trainError > OVERFIT_GAP)
		return `Training error is low (${formatError(trainError)}) but new data misses by ${formatError(testError)}: the curve learned the noise of these ten points. This is <b>overfitting</b>, or high variance. A simpler model, regularization, or more data would help.`;
	return `Both errors are low and close (${formatError(trainError)} and ${formatError(testError)}): the model learned the pattern, not the noise. It <b>generalizes</b>.`;
}

function buildSteps({ degree }: FitInput): FitStep[] {
	const { trainError, testError } = errorsFor(degree);
	const parameters = degree + 1;
	const readout = (showsTest: boolean) => ({
		parameters,
		'train error': formatError(trainError),
		'new-data error': showsTest ? formatError(testError) : '–',
	});
	return [
		{
			phase: 'data',
			readout: { parameters, 'train error': '–', 'new-data error': '–' },
			narration: `Ten training points: a smooth pattern plus noise. The model is a polynomial of degree ${degree} (a sum of powers of x, up to x to the power ${degree}, each times its own number), a curve with ${parameters} adjustable numbers (its parameters). Training picks the numbers that bring the curve closest to the points.`,
		},
		{ phase: 'fit', readout: readout(false), narration: fitNarration(degree, trainError) },
		{
			phase: 'test',
			readout: readout(true),
			narration: `Now ten new points from the same pattern, which the model never saw. Its typical miss on them is ${formatError(testError)}. The red lines show each miss.`,
		},
		{ phase: 'verdict', readout: readout(true), narration: verdictNarration(trainError, testError) },
	];
}

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 300;
const PLOT_TOP = 24;
const PLOT_PADDING = 18;
const Y_LIMIT = 1.8;
const CURVE_SEGMENTS = 90;

const toPlot = ({ x, y }: Sample): PlotPosition => ({
	x: PLOT_PADDING + x * (PLOT_WIDTH - 2 * PLOT_PADDING),
	y: PLOT_TOP + PLOT_PADDING + ((Y_LIMIT - y) / (2 * Y_LIMIT)) * (PLOT_HEIGHT - 2 * PLOT_PADDING),
});

const insidePlot = (y: number) => Math.abs(y) <= Y_LIMIT;
const clampToPlot = (y: number) => Math.max(-Y_LIMIT, Math.min(Y_LIMIT, y));

function FitScene({ input: { degree }, step: { phase } }: FitSceneProps) {
	const { coefficients } = errorsFor(degree);
	const fitted = phase !== 'data';
	const showsNewData = phase === 'test' || phase === 'verdict';
	const curve = Array.from({ length: CURVE_SEGMENTS + 1 }, (_, index) => {
		const x = index / CURVE_SEGMENTS;
		return { x, y: predict(coefficients, x) };
	});

	return (
		<PlotCanvas width={PLOT_WIDTH} height={PLOT_TOP + PLOT_HEIGHT + 4}>
			<Plane left={0} top={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} label={`degree ${degree} · ${degree + 1} parameters`} active={fitted} />
			{curve.slice(1).map((end, index) => {
				const start = curve[index];
				return (
					<Link
						key={`curve-${index}`}
						from={toPlot(start)}
						to={toPlot(end)}
						tone="focus"
						hidden={!fitted || !insidePlot(start.y) || !insidePlot(end.y)}
					/>
				);
			})}
			{NEW_DATA.map((sample, index) => (
				<Link
					key={`miss-${index}`}
					from={toPlot(sample)}
					to={toPlot({ x: sample.x, y: clampToPlot(predict(coefficients, sample.x)) })}
					tone="remove"
					hidden={!showsNewData}
				/>
			))}
			{TRAINING.map((sample, index) => (
				<Dot key={`train-${index}`} position={toPlot(sample)} />
			))}
			{NEW_DATA.map((sample, index) => (
				<Dot key={`new-${index}`} position={toPlot(sample)} tone="add" hidden={!showsNewData} />
			))}
		</PlotCanvas>
	);
}

export default defineExplainer<FitInput, FitStep>({
	title: 'Fit a curve: underfit, fit, overfit',
	stages: [
		{
			title: 'One pattern, three levels of flexibility',
			subtitle: 'Dark dots train the model. Green dots are new data it never saw; red lines are its misses on them.',
			Scene: FitScene,
		},
	],
	examples: [
		{ input: { degree: 1 }, note: 'A straight line' },
		{ input: { degree: 3 }, note: 'A gentle curve' },
		{ input: { degree: 9 }, note: 'As many parameters as points' },
	],
	fields: [{ name: 'degree', label: 'degree', placeholder: `0–${MAX_DEGREE}` }],
	describe: ({ degree }) => `degree ${degree}`,
	parse(values) {
		const degree = Number(values.degree);
		if (values.degree === '' || !Number.isInteger(degree) || degree < 0 || degree > MAX_DEGREE) return { error: `Use a whole number from 0 to ${MAX_DEGREE}.` };
		return { input: { degree } };
	},
	steps: buildSteps,
});
