import katex from 'katex';
import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';

interface MathToken extends Tokens.Generic {
	text: string;
}

const renderMath = (tex: string, displayMode: boolean) => katex.renderToString(tex, { displayMode, throwOnError: false });

const indexOrUndefined = (index: number) => (index < 0 ? undefined : index);

// GitHub's and Pandoc's rules, so prices such as "$5 to $10" stay text: the math may not start or end
// with a space, and the closing dollar may not be followed by a digit.
const INLINE_DOLLAR_MATH = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;
const INLINE_BACKTICK_MATH = /^\$`([^`\n]+?)`\$/;
const BLOCK_MATH = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/;

const blockMath: TokenizerAndRendererExtension = {
	name: 'blockMath',
	level: 'block',
	start: (source) => indexOrUndefined(source.search(/^\$\$/m)),
	tokenizer(source) {
		const match = BLOCK_MATH.exec(source);
		if (match) return { type: 'blockMath', raw: match[0], text: match[1].trim() };
	},
	renderer: (token) => `${renderMath((token as MathToken).text, true)}\n`,
};

const inlineMath: TokenizerAndRendererExtension = {
	name: 'inlineMath',
	level: 'inline',
	start: (source) => indexOrUndefined(source.indexOf('$')),
	tokenizer(source) {
		const match = INLINE_BACKTICK_MATH.exec(source) ?? INLINE_DOLLAR_MATH.exec(source);
		if (match) return { type: 'inlineMath', raw: match[0], text: match[1] };
	},
	renderer: (token) => renderMath((token as MathToken).text, false),
};

const notesMarkdown = new Marked(
	{ gfm: true },
	{
		extensions: [blockMath, inlineMath],
		renderer: {
			code({ text, lang }) {
				return lang === 'math' ? renderMath(text, true) : false;
			},
		},
	},
);

export const renderNoteMarkdown = (markdown: string) => notesMarkdown.parse(markdown, { async: false }) as string;
