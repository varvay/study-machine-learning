import type { ComponentType } from 'react';

export type Readout = Record<string, string | number>;

export interface Step {
	narration: string;
	readout: Readout;
	highlightedLines?: number[];
}

export interface SceneProps<Input, S extends Step> {
	input: Input;
	step: S;
}

export interface StageSpec<Input, S extends Step> {
	title: string;
	subtitle: string;
	Scene: ComponentType<SceneProps<Input, S>>;
	Footer?: ComponentType<SceneProps<Input, S>>;
}

export interface Example<Input> {
	input: Input;
	note: string;
}

export interface InputField {
	name: string;
	label: string;
	placeholder: string;
}

export type FieldValues = Record<string, string>;
export type ParsedInput<Input> = { input: Input } | { error: string };

export interface Explainer<Input, S extends Step> {
	title: string;
	codeFile?: string;
	stages: StageSpec<Input, S>[];
	examples: Example<Input>[];
	fields: InputField[];
	describe(input: Input): string;
	parse(values: FieldValues): ParsedInput<Input>;
	steps(input: Input): S[];
}

export const defineExplainer = <Input, S extends Step>(explainer: Explainer<Input, S>) => explainer;
