import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Explainer, FieldValues, Step } from './types';

const AUTOPLAY_INTERVAL_MS = 2000;

type AnyExplainer = Explainer<unknown, Step>;
export type TitleHeading = 'h2' | 'h3';

const explainerModules = import.meta.glob<{ default: AnyExplainer }>('/goals/*/l[1-3]/*.tsx');

let keyboardOwner: HTMLElement | undefined;

const ownsKeyboard = (player: HTMLElement) => player === (keyboardOwner ?? document.querySelector('[data-player]'));

export default function Player({ file, heading }: { file: string; heading: TitleHeading }) {
	const [explainer, setExplainer] = useState<AnyExplainer>();

	useEffect(() => {
		explainerModules[file]().then((module) => setExplainer(() => module.default));
	}, [file]);

	return explainer ? <Walkthrough explainer={explainer} heading={heading} /> : null;
}

function Walkthrough<Input, S extends Step>({ explainer, heading: Title }: { explainer: Explainer<Input, S>; heading: TitleHeading }) {
	const player = useRef<HTMLDivElement>(null);
	const [input, setInput] = useState(explainer.examples[0].input);
	const [pressedExample, setPressedExample] = useState<number | undefined>(0);
	const [stepIndex, setStepIndex] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [inputError, setInputError] = useState('');

	const steps = useMemo(() => explainer.steps(input), [explainer, input]);
	const lastStepIndex = steps.length - 1;
	const step = steps[stepIndex];

	const clampStep = (target: number) => Math.max(0, Math.min(lastStepIndex, target));

	function load(next: Input, example: number | undefined) {
		setInput(next);
		setPressedExample(example);
		setStepIndex(0);
		setPlaying(false);
		setInputError('');
	}

	function stepBy(offset: number) {
		setPlaying(false);
		setStepIndex(clampStep(stepIndex + offset));
	}

	function togglePlaying() {
		if (!playing && stepIndex === lastStepIndex) setStepIndex(0);
		setPlaying(!playing);
	}

	function restart() {
		setPlaying(false);
		setStepIndex(0);
	}

	useEffect(() => {
		if (!playing) return;
		if (stepIndex === lastStepIndex) {
			setPlaying(false);
			return;
		}
		const timer = window.setTimeout(() => setStepIndex(stepIndex + 1), AUTOPLAY_INTERVAL_MS);
		return () => window.clearTimeout(timer);
	}, [playing, stepIndex, lastStepIndex]);

	useEffect(() => {
		if (!explainer.codeFile) return;
		const highlightedLines = step.highlightedLines ?? [];
		const codeLines = document.querySelectorAll<HTMLElement>(`[data-code-file="${explainer.codeFile}"] .line`);
		codeLines.forEach((line, index) => line.classList.toggle('highlighted', highlightedLines.includes(index + 1)));
	}, [explainer, step]);

	useEffect(() => {
		const onKeydown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || !ownsKeyboard(player.current!)) return;
			if (event.key === 'ArrowRight') stepBy(1);
			else if (event.key === 'ArrowLeft') stepBy(-1);
			else if (event.key === ' ' && target.tagName !== 'BUTTON') {
				event.preventDefault();
				togglePlaying();
			}
		};
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

	function submitCustomInput(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const values: FieldValues = Object.fromEntries(
			[...new FormData(event.currentTarget)].map(([name, value]) => [name, String(value).trim()]),
		);
		const parsed = explainer.parse(values);
		if ('error' in parsed) setInputError(parsed.error);
		else load(parsed.input, undefined);
	}

	const claimKeyboard = () => {
		keyboardOwner = player.current!;
	};

	return (
		<div data-player ref={player} onPointerDown={claimKeyboard} onFocus={claimKeyboard}>
			<Title className="explainer-title">{explainer.title}</Title>

			<div className="examples" role="group" aria-label="Examples">
				{explainer.examples.map((example, index) => (
					<button
						key={index}
						type="button"
						className="example"
						aria-pressed={pressedExample === index}
						onClick={() => load(example.input, index)}
					>
						{explainer.describe(example.input)}
						<small>{example.note}</small>
					</button>
				))}
			</div>

			<form className="custom-input" onSubmit={submitCustomInput}>
				{explainer.fields.map((field) => (
					<span key={field.name} className="custom-field">
						<label htmlFor={`field-${field.name}`}>{field.label}</label>
						<input
							id={`field-${field.name}`}
							name={field.name}
							type="text"
							placeholder={field.placeholder}
							size={Math.max(4, field.placeholder.length)}
							autoComplete="off"
						/>
					</span>
				))}
				<button className="button" type="submit">
					Run
				</button>
				<div className="input-error" role="alert">
					{inputError}
				</div>
			</form>

			{explainer.stages.map(({ title, subtitle, Scene, Footer }) => (
				<section key={title} className="stage" aria-label={title}>
					<h3>{title}</h3>
					<p className="stage-subtitle">{subtitle}</p>
					<div className="stage-scroll">
						<Scene input={input} step={step} />
					</div>
					{Footer && (
						<div className="stage-footer">
							<Footer input={input} step={step} />
						</div>
					)}
				</section>
			))}

			<div className="controls">
				<button className="button" type="button" disabled={stepIndex === 0} onClick={restart}>
					Restart
				</button>
				<button className="button" type="button" aria-label="Previous step" disabled={stepIndex === 0} onClick={() => stepBy(-1)}>
					Back
				</button>
				<button className="button" type="button" onClick={togglePlaying}>
					{playing ? 'Pause' : 'Play'}
				</button>
				<button className="button primary" type="button" disabled={stepIndex === lastStepIndex} onClick={() => stepBy(1)}>
					Next
				</button>
				<span className="counter">
					Step {stepIndex} of {lastStepIndex}
				</span>
			</div>

			<div className="narration-row">
				<p className="narration" aria-live="polite" dangerouslySetInnerHTML={{ __html: step.narration }} />
				<dl className="readout">
					{Object.entries(step.readout).map(([name, value]) => (
						<div key={name}>
							<dt>{name}</dt>
							<dd>{value}</dd>
						</div>
					))}
				</dl>
			</div>
		</div>
	);
}
