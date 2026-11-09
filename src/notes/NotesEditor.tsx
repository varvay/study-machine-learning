import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { renderNoteMarkdown } from './render';

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'failed';

interface NotesEditorProps {
	noteId: string;
	label: string;
	initialMarkdown: string;
	endpoint: string;
}

const AUTOSAVE_DELAY_MS = 1200;
const OPEN_EDITORS_KEY = 'notes:open-editors';

function readOpenEditors(): string[] {
	try {
		return JSON.parse(sessionStorage.getItem(OPEN_EDITORS_KEY) ?? '[]');
	} catch {
		return [];
	}
}

function rememberOpenEditor(noteId: string, open: boolean) {
	try {
		const others = readOpenEditors().filter((id) => id !== noteId);
		sessionStorage.setItem(OPEN_EDITORS_KEY, JSON.stringify(open ? [...others, noteId] : others));
	} catch {
		// Storage can be unavailable (private mode); the editor then simply starts closed.
	}
}

const statusText: Record<SaveStatus, string> = {
	saved: 'Saved',
	unsaved: 'Unsaved changes',
	saving: 'Saving…',
	failed: 'Save failed — is the dev server running?',
};

export default function NotesEditor({ noteId, label, initialMarkdown, endpoint }: NotesEditorProps) {
	const [markdown, setMarkdown] = useState(initialMarkdown);
	const [editing, setEditing] = useState(false);
	const [status, setStatus] = useState<SaveStatus>('saved');
	const lastSaved = useRef(initialMarkdown);
	const preview = useMemo(() => renderNoteMarkdown(markdown), [markdown]);

	useEffect(() => {
		if (readOpenEditors().includes(noteId)) setEditing(true);
	}, [noteId]);

	async function save(text: string) {
		if (text === lastSaved.current) {
			setStatus('saved');
			return;
		}
		setStatus('saving');
		try {
			const response = await fetch(`${endpoint}?id=${encodeURIComponent(noteId)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ markdown: text }),
			});
			if (!response.ok) throw new Error(String(response.status));
			lastSaved.current = text;
			setStatus('saved');
		} catch {
			setStatus('failed');
		}
	}

	useEffect(() => {
		if (!editing || markdown === lastSaved.current) return;
		setStatus('unsaved');
		const timer = window.setTimeout(() => save(markdown), AUTOSAVE_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [markdown, editing]);

	function open() {
		setEditing(true);
		rememberOpenEditor(noteId, true);
	}

	async function close() {
		await save(markdown);
		setEditing(false);
		rememberOpenEditor(noteId, false);
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if ((event.metaKey || event.ctrlKey) && event.key === 's') {
			event.preventDefault();
			save(markdown);
		}
		if (event.key === 'Escape') close();
	}

	if (!editing && markdown.trim() === '') {
		return (
			<button type="button" className="note-add" onClick={open}>
				+ Add {label.toLowerCase()}
			</button>
		);
	}

	if (!editing) {
		return (
			<section className="note panel">
				<header className="note-header">
					<h3 className="note-label">{label}</h3>
					<button type="button" className="note-button" onClick={open}>
						Edit
					</button>
				</header>
				<div className="note-body section-text" dangerouslySetInnerHTML={{ __html: preview }} />
			</section>
		);
	}

	return (
		<section className="note panel editing">
			<header className="note-header">
				<h3 className="note-label">{label}</h3>
				<span className={`note-status status-${status}`}>{statusText[status]}</span>
				<button type="button" className="note-button" onClick={() => save(markdown)}>
					Save
				</button>
				<button type="button" className="note-button primary" onClick={close}>
					Done
				</button>
			</header>
			<div className="note-split">
				<textarea
					className="note-input"
					value={markdown}
					onChange={(event) => setMarkdown(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder="Markdown: **bold**, - lists, `code`, | tables |, math $x^2$ or $$\frac{a}{b}$$"
					spellCheck
					autoFocus
				/>
				<div className="note-body section-text note-preview" dangerouslySetInnerHTML={{ __html: preview || '<p class="muted">Preview</p>' }} />
			</div>
			<p className="note-hint">Math as on GitHub: $…$ inline, $$…$$ or a ```math block for display; \$ for a literal dollar. Saves on its own after a pause, or with ⌘/Ctrl+S. Esc closes. Stored in notes/{noteId}.md.</p>
		</section>
	);
}
