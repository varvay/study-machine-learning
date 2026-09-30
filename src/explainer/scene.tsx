import type { CSSProperties, ReactNode } from 'react';

export const CELL_SIZE = 54;
export const CELL_PITCH = 62;
export const ROW_LABEL_GUTTER = 96;

export const columnLeft = (column: number) => ROW_LABEL_GUTTER + column * CELL_PITCH;
export const columnCenter = (column: number) => columnLeft(column) + CELL_SIZE / 2;

export type CellTone = 'plain' | 'focus' | 'add' | 'remove';
export type TagTone = 'add' | 'remove';
export type ChipState = 'plain' | 'current' | 'upcoming';

export interface Chip {
	label: string;
	state: ChipState;
}

const at = (left: number, top: number, hidden = false): CSSProperties => ({ left, top, ...(hidden && { opacity: 0 }) });

export function Canvas({ columns, height, children }: { columns: number; height: number; children: ReactNode }) {
	return (
		<div className="canvas" style={{ width: columnLeft(columns) + 20, height }}>
			{children}
		</div>
	);
}

export function Cell({
	value,
	column,
	top,
	tone = 'plain',
	dimmed = false,
	hidden = false,
}: {
	value: string | number;
	column: number;
	top: number;
	tone?: CellTone;
	dimmed?: boolean;
	hidden?: boolean;
}) {
	return (
		<div className={`cell tone-${tone}${dimmed ? ' dimmed' : ''}`} style={at(columnLeft(column), top, hidden)}>
			{value}
		</div>
	);
}

export function SubLabel({ column, top, hidden, children }: { column: number; top: number; hidden?: boolean; children: ReactNode }) {
	return (
		<div className="sub-label" style={at(columnLeft(column), top, hidden)}>
			{children}
		</div>
	);
}

export function RowLabel({ top, hidden, children }: { top: number; hidden?: boolean; children: ReactNode }) {
	return (
		<div className="row-label" style={at(0, top, hidden)}>
			{children}
		</div>
	);
}

export function SceneNote({ column, top, hidden, children }: { column: number; top: number; hidden?: boolean; children: ReactNode }) {
	return (
		<div className="scene-note" style={at(columnLeft(column), top, hidden)}>
			{children}
		</div>
	);
}

export function ColumnMarker({
	column,
	top,
	height,
	label,
	hidden,
}: {
	column: number;
	top: number;
	height: number;
	label: string;
	hidden?: boolean;
}) {
	return (
		<div className="column-marker" style={{ ...at(columnLeft(column) - 6, top, hidden), height }}>
			<span>{label}</span>
		</div>
	);
}

export function Frame({ startColumn, columns, top, label }: { startColumn: number; columns: number; top: number; label: string }) {
	return (
		<>
			<div className="frame-label" style={at(columnLeft(startColumn) - 2, top - 24)}>
				{label}
			</div>
			<div className="frame" style={{ ...at(columnLeft(startColumn) - 6, top), width: columns * CELL_PITCH + 6 }} />
		</>
	);
}

export function Tag({
	column,
	top,
	tone,
	hidden,
	children,
}: {
	column: number;
	top: number;
	tone: TagTone;
	hidden?: boolean;
	children: ReactNode;
}) {
	return (
		<div className={`tag tone-${tone}`} style={at(columnCenter(column), top, hidden)}>
			{children}
		</div>
	);
}

export interface PlotPosition {
	x: number;
	y: number;
}

export type DotTone = 'plain' | 'focus' | 'add' | 'remove';
export type LinkTone = 'plain' | 'focus' | 'add' | 'remove';

const placed = (position: PlotPosition, hidden = false): CSSProperties => at(position.x, position.y, hidden);

export function PlotCanvas({ width, height, children }: { width: number; height: number; children: ReactNode }) {
	return (
		<div className="canvas" style={{ width, height }}>
			{children}
		</div>
	);
}

export function Plane({
	left,
	top,
	width,
	height,
	label,
	active = false,
}: {
	left: number;
	top: number;
	width: number;
	height: number;
	label: string;
	active?: boolean;
}) {
	return (
		<>
			<div className="plane-label" style={at(left, top - 22)}>
				{label}
			</div>
			<div className={`plane${active ? ' active' : ''}`} style={{ left, top, width, height }} />
		</>
	);
}

export function Dot({
	position,
	tone = 'plain',
	ghost = false,
	label,
	hidden,
}: {
	position: PlotPosition;
	tone?: DotTone;
	ghost?: boolean;
	label?: string;
	hidden?: boolean;
}) {
	return (
		<div className={`dot tone-${tone}${ghost ? ' ghost' : ''}`} style={placed(position, hidden)}>
			{label && <span>{label}</span>}
		</div>
	);
}

export function QueryMark({ position, label }: { position: PlotPosition; label: string }) {
	return (
		<div className="query-mark" style={placed(position)}>
			<span>{label}</span>
		</div>
	);
}

export function Link({ from, to, tone = 'plain', hidden }: { from: PlotPosition; to: PlotPosition; tone?: LinkTone; hidden?: boolean }) {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	const angle = Math.atan2(to.y - from.y, to.x - from.x);
	return <div className={`link tone-${tone}`} style={{ ...placed(from, hidden), width: length, transform: `rotate(${angle}rad)` }} />;
}

export function Ring({ position, label, hidden }: { position: PlotPosition; label?: string; hidden?: boolean }) {
	return (
		<div className="ring" style={placed(position, hidden)}>
			{label && <span>{label}</span>}
		</div>
	);
}

export function Chips({ chips }: { chips: Chip[] }) {
	return chips.map((chip, index) => (
		<span key={index} className={`chip chip-${chip.state}`}>
			{chip.label}
		</span>
	));
}
