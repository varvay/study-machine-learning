import { Dot, Link, Plane, PlotCanvas, Ring, type PlotPosition } from '../../../src/explainer/scene';
import { defineExplainer, type SceneProps, type Step } from '../../../src/explainer/types';

type Activation = 'sigmoid' | 'relu';

interface StackInput {
	activation: Activation;
	weight: number;
	layers: number;
}

interface GradientStep extends Step {
	reachedLayer: number;
}

type GradientSceneProps = SceneProps<StackInput, GradientStep>;

interface LayerTrace {
	preActivation: number;
	slope: number;
	localFactor: number;
}

const INPUT_VALUE = 1;
const MIN_LAYERS = 2;
const MAX_LAYERS = 12;
const MIN_WEIGHT = 0.25;
const MAX_WEIGHT = 3;
const VANISHED_BELOW = 0.01;
const EXPLODED_ABOVE = 100;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

const activationOf: Record<Activation, { apply: (z: number) => number; slope: (z: number) => number; name: string }> = {
	sigmoid: { apply: sigmoid, slope: (z) => sigmoid(z) * (1 - sigmoid(z)), name: 'sigmoid' },
	relu: { apply: (z) => Math.max(0, z), slope: (z) => (z > 0 ? 1 : 0), name: 'ReLU' },
};

function forwardPass({ activation, weight, layers }: StackInput): LayerTrace[] {
	const { apply, slope } = activationOf[activation];
	const traces: LayerTrace[] = [];
	let output = INPUT_VALUE;
	for (let layer = 1; layer <= layers; layer++) {
		const preActivation = weight * output;
		traces.push({ preActivation, slope: slope(preActivation), localFactor: weight * slope(preActivation) });
		output = apply(preActivation);
	}
	return traces;
}

function gradientsReaching(traces: LayerTrace[]): number[] {
	const gradients = new Array<number>(traces.length).fill(0);
	gradients[traces.length - 1] = 1;
	for (let layer = traces.length - 2; layer >= 0; layer--) gradients[layer] = gradients[layer + 1] * traces[layer + 1].localFactor;
	return gradients;
}

const format = (value: number) => {
	if (value === 0) return '0';
	if (Math.abs(value) >= 0.01 && Math.abs(value) < 1000) return Number(value.toPrecision(3)).toString();
	const [mantissa, exponent] = value.toExponential(1).split('e');
	return `${mantissa}e${Number(exponent)}`;
};

function introNarration({ activation, weight, layers }: StackInput, traces: LayerTrace[]) {
	const { name } = activationOf[activation];
	const slopeNote =
		activation === 'relu'
			? `ReLU's slope is 1 for any positive input, so each layer's factor is just w = ${weight}.`
			: `The sigmoid's slope is at most 0.25, so each factor is at most ${weight} × 0.25 = ${format(weight * 0.25)}; here the top layer's is ${format(traces.at(-1)!.localFactor)}.`;
	return `A stack of ${layers} layers, one neuron each, with ${name} activation and every weight w = ${weight}. The forward pass is done. Backpropagation starts at the top: the loss hands layer ${layers} a gradient of 1. On its way down, each layer multiplies the gradient by its local factor, w × f′(z): its weight times the activation's slope at its input. ${slopeNote}`;
}

function passNarration(receiver: number, traces: LayerTrace[], gradients: number[], input: StackInput) {
	const senderTrace = traces[receiver];
	const slope = input.activation === 'relu' ? '1' : format(senderTrace.slope);
	return `Layer ${receiver + 1} passes the gradient down. Its factor is w × f′(z) = ${input.weight} × ${slope} = ${format(senderTrace.localFactor)}, so layer ${receiver} receives ${format(gradients[receiver])} × ${format(senderTrace.localFactor)} = ${format(gradients[receiver - 1])}.`;
}

function verdictNarration(gradients: number[], input: StackInput) {
	const first = gradients[0];
	const fixes =
		input.activation === 'sigmoid'
			? ' Switching to ReLU, adding residual connections, or normalizing each layer keeps it near 1.'
			: ' He initialization picks the weight scale that keeps each factor near 1, and residual connections give the gradient a path around small factors.';
	if (first < VANISHED_BELOW)
		return ` Layer 1 gets ${format(first)} of the gradient the top layer got, so its weights barely move: the gradient has <b>vanished</b>. The early layers stop learning while the top ones train.${fixes}`;
	if (first > EXPLODED_ABOVE)
		return ` Layer 1 gets ${format(first)} times the top layer's gradient: the gradient has <b>exploded</b>. One update can throw its weights far off, and the loss spikes or turns into NaN. Gradient clipping caps the step; a smaller weight scale at initialization prevents the growth.`;
	return ` Layer 1 gets ${format(first)} times the top layer's gradient, within a factor of 100 either way, so every layer still gets a gradient it can learn from. Factors near 1 are what good initialization, ReLU, residual connections, and normalization aim for.`;
}

function buildSteps(input: StackInput): GradientStep[] {
	const traces = forwardPass(input);
	const gradients = gradientsReaching(traces);
	const readoutAt = (layer: number, factor: number | undefined) => ({
		layer,
		gradient: format(gradients[layer - 1]),
		'factor applied': factor === undefined ? '–' : format(factor),
	});
	const steps: GradientStep[] = [{ reachedLayer: input.layers, readout: readoutAt(input.layers, undefined), narration: introNarration(input, traces) }];
	for (let layer = input.layers - 1; layer >= 1; layer--) {
		const isLast = layer === 1;
		steps.push({
			reachedLayer: layer,
			readout: readoutAt(layer, traces[layer].localFactor),
			narration: passNarration(layer, traces, gradients, input) + (isLast ? verdictNarration(gradients, input) : ''),
		});
	}
	return steps;
}

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 300;
const PLOT_TOP = 24;
const PLOT_PADDING = 28;
const LOG_MIN = -10;
const LOG_MAX = 6;

const toPlot = (layer: number, layers: number, gradient: number): PlotPosition => {
	const logValue = Math.max(LOG_MIN, Math.min(LOG_MAX, Math.log10(Math.max(gradient, 1e-300))));
	return {
		x: PLOT_PADDING + ((layer - 1) / (layers - 1)) * (PLOT_WIDTH - 2 * PLOT_PADDING),
		y: PLOT_TOP + PLOT_PADDING + ((LOG_MAX - logValue) / (LOG_MAX - LOG_MIN)) * (PLOT_HEIGHT - 2 * PLOT_PADDING),
	};
};

function GradientScene({ input, step: { reachedLayer } }: GradientSceneProps) {
	const gradients = gradientsReaching(forwardPass(input));
	const layerNumbers = Array.from({ length: input.layers }, (_, index) => index + 1);
	const isReached = (layer: number) => layer >= reachedLayer;

	return (
		<PlotCanvas width={PLOT_WIDTH} height={PLOT_TOP + PLOT_HEIGHT + 4}>
			<Plane left={0} top={PLOT_TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT} label={`gradient reaching layers 1 to ${input.layers}, log scale from 1e${LOG_MIN} to 1e${LOG_MAX}`} />
			<Link key="gradient-one" from={toPlot(1, input.layers, 1)} to={toPlot(input.layers, input.layers, 1)} />
			{layerNumbers.slice(1).map((layer) => (
				<Link
					key={`pass-${layer}`}
					from={toPlot(layer, input.layers, gradients[layer - 1])}
					to={toPlot(layer - 1, input.layers, gradients[layer - 2])}
					tone="focus"
					hidden={!isReached(layer - 1)}
				/>
			))}
			{layerNumbers.map((layer) => (
				<Dot
					key={`layer-${layer}`}
					position={toPlot(layer, input.layers, gradients[layer - 1])}
					tone={layer === reachedLayer ? 'focus' : 'plain'}
					label={isReached(layer) ? format(gradients[layer - 1]) : undefined}
					hidden={!isReached(layer)}
				/>
			))}
			<Ring position={toPlot(reachedLayer, input.layers, gradients[reachedLayer - 1])} label={`layer ${reachedLayer}`} />
		</PlotCanvas>
	);
}

const ACTIVATIONS = Object.keys(activationOf) as Activation[];

export default defineExplainer<StackInput, GradientStep>({
	title: 'Vanishing and exploding gradients',
	stages: [
		{
			title: 'The backward pass through a deep stack',
			subtitle: 'Each dot is the gradient reaching one layer; layer 1 is on the left, the top layer on the right. The grey line marks a gradient of 1.',
			Scene: GradientScene,
		},
	],
	examples: [
		{ input: { activation: 'sigmoid', weight: 1, layers: 10 }, note: 'Sigmoid: vanishes' },
		{ input: { activation: 'relu', weight: 1, layers: 10 }, note: 'ReLU, weight 1: survives' },
		{ input: { activation: 'relu', weight: 0.5, layers: 10 }, note: 'ReLU, small weights: vanishes' },
		{ input: { activation: 'relu', weight: 2, layers: 12 }, note: 'ReLU, large weights: explodes' },
	],
	fields: [
		{ name: 'activation', label: 'activation', placeholder: ACTIVATIONS.join(' or ') },
		{ name: 'weight', label: 'weight w', placeholder: `${MIN_WEIGHT} to ${MAX_WEIGHT}` },
		{ name: 'layers', label: 'layers', placeholder: `${MIN_LAYERS} to ${MAX_LAYERS}` },
	],
	describe: ({ activation, weight, layers }) => `${activationOf[activation].name}, w = ${weight}, ${layers} layers`,
	parse(values) {
		const activation = values.activation.trim().toLowerCase();
		if (!ACTIVATIONS.includes(activation as Activation)) return { error: `Activation must be ${ACTIVATIONS.join(' or ')}.` };
		const weight = Number(values.weight);
		if (values.weight === '' || !Number.isFinite(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) return { error: `Use a weight from ${MIN_WEIGHT} to ${MAX_WEIGHT}.` };
		const layers = Number(values.layers);
		if (values.layers === '' || !Number.isInteger(layers) || layers < MIN_LAYERS || layers > MAX_LAYERS) return { error: `Use a whole number of layers from ${MIN_LAYERS} to ${MAX_LAYERS}.` };
		return { input: { activation: activation as Activation, weight, layers } };
	},
	steps: buildSteps,
});
