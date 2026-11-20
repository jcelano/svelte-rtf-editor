import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { sanitizeHtml } from '../sanitize.js';

/**
 * A table with borders, and a table put in from the editor.
 *
 * A table came into a document by a paste or from a file, and in no other way; and whatever
 * borders it had, the RTF had none, and none were read from an RTF: a grid of results was
 * words in rows. A cell's borders are now written and read, and the toolbar puts a table in.
 * Invented text.
 */

const R = String.raw;
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const rtfOf = (html: string) => htmlToRtf(el(html));
/** The definition of each cell of a table's rows: what is written before each \cellx. */
const cellDefs = (rtf: string) => Array.from(rtf.matchAll(/\\trowd\\trgaph120(.*?)\\trkeep/g), (row) => row[1].split(/\\cellx\d+/).slice(0, -1));
const TABLE = '<table style="border-collapse:collapse;width:100%;margin:4px 0">';
const read = (rtfBody: string, colors = R`\red192\green0\blue0;\red0\green0\blue0;`) => rtfToHtml(`{\\rtf1\\ansi\\deff0{\\colortbl;${colors}}${rtfBody}}`);
const GRID = R`\clbrdrt\brdrs\brdrw15\clbrdrl\brdrs\brdrw15\clbrdrb\brdrs\brdrw15\clbrdrr\brdrs\brdrw15`;

describe('htmlToRtf: the borders of a table cell', () => {
	it('each side that has one is written: its line and its width', () => {
		const rtf = rtfOf('<table><tr><td style="border:1px solid">a</td><td>b</td></tr></table>');
		expect(cellDefs(rtf)).toEqual([[GRID, '']]);
	});

	it('one side, another line, another width', () => {
		const defs = cellDefs(rtfOf('<table><tr><td style="border-bottom:2px dashed;border-top:0.5pt solid">a</td><td style="border-left:3px double">b</td><td style="border-right:1px dotted">c</td></tr></table>'));
		expect(defs).toEqual([[R`\clbrdrt\brdrs\brdrw10\clbrdrb\brdrdash\brdrw30`, R`\clbrdrl\brdrdb\brdrw45`, R`\clbrdrr\brdrdot\brdrw15`]]);
	});

	it('a color is written by its place in the color table; black is the reader\'s own', () => {
		const rtf = rtfOf('<table><tr><td style="border:1px solid #c00000">a</td><td style="border:1px solid #000000">b</td></tr></table>');
		expect(rtf).toContain(R`{\colortbl;\red0\green0\blue0;\red192\green0\blue0;}`);
		expect(cellDefs(rtf)[0][0]).toBe(R`\clbrdrt\brdrs\brdrw15\brdrcf2\clbrdrl\brdrs\brdrw15\brdrcf2\clbrdrb\brdrs\brdrw15\brdrcf2\clbrdrr\brdrs\brdrw15\brdrcf2`);
		expect(cellDefs(rtf)[0][1]).toBe(GRID);
	});

	it('a width is what RTF can draw: a keyword is its usual width, and none is wider than 3.75 pt', () => {
		const width = (border: string) => cellDefs(rtfOf(`<table><tr><td style="border-top:${border}">a</td></tr></table>`))[0][0];
		expect(width('thin solid')).toBe(R`\clbrdrt\brdrs\brdrw15`);
		expect(width('thick solid')).toBe(R`\clbrdrt\brdrs\brdrw75`);
		expect(width('20px solid')).toBe(R`\clbrdrt\brdrs\brdrw75`);
		// A line of another kind that is drawn is a plain line.
		expect(width('2px groove')).toBe(R`\clbrdrt\brdrs\brdrw30`);
	});

	it('what draws nothing writes nothing', () => {
		for (const border of ['none', '0 solid', '1px hidden', '1px']) {
			expect(cellDefs(rtfOf(`<table><tr><td style="border:${border}">a</td></tr></table>`)), border).toEqual([['']]);
		}
	});

	it('a cell down several rows has its borders in each row it is in', () => {
		const defs = cellDefs(rtfOf('<table><tr><td rowspan="2" style="border:1px solid">a</td><td>b</td></tr><tr><td>c</td></tr></table>'));
		expect(defs).toEqual([[`\\clvmgf${GRID}`, ''], [`\\clvmrg${GRID}`, '']]);
	});

	it('the size estimate counts them', () => {
		for (const html of [
			'<table><tr><td style="border:1px solid">a</td><td style="border:3px double #c00000">b</td></tr></table>',
			'<table><tr><th style="border:1px solid">H</th></tr><tr><td rowspan="0" style="border:1px dashed #0000ff">a</td></tr><tr></tr><tr></tr></table>'
		]) {
			expect(estimateRtfBytes(el(html)), html.slice(0, 50)).toBeGreaterThanOrEqual(htmlToRtf(el(html)).length);
		}
	});
});

describe('a header cell, with borders and without', () => {
	it('with none it is marked as it always was: a bare line under it', () => {
		const rtf = rtfOf('<table><tr><th>Marker</th></tr><tr><td>HER2</td></tr></table>');
		expect(cellDefs(rtf)).toEqual([[R`\clbrdrb\brdrs`], ['']]);
		expect(rtf).not.toContain('inkth');
		// And read back with that line, which is written as the same mark again.
		const back = rtfToHtml(rtf);
		expect(back).toContain('<th style="border-bottom:1px solid;padding:2px 6px;text-align:left;width:100.0%">Marker</th>');
		expect(htmlToRtf(el(back))).toBe(rtf);
	});

	it('with borders of its own it has those, and is marked in what it holds', () => {
		const rtf = rtfOf('<table><tr><th style="border:1px solid">Marker</th></tr><tr><td style="border:1px solid">HER2</td></tr></table>');
		expect(cellDefs(rtf)).toEqual([[GRID], [GRID]]);
		expect(rtf).toContain(R`\fi0 {\*\inkth}Marker\cell}`);
		expect(rtf).toContain(R`\fi0 HER2\cell}`);
		const back = rtfToHtml(rtf);
		expect(back).toBe(
			`${TABLE}<tr><th style="border:1px solid;padding:2px 6px;text-align:left;width:100.0%">Marker</th></tr>` +
				'<tr><td style="border:1px solid;padding:2px 6px;width:100.0%">HER2</td></tr></table>'
		);
		expect(htmlToRtf(el(back))).toBe(rtf);
	});

	it('a gridded table from Word or TextEdit has no header cells: every cell has borders there', () => {
		const word = R`{\trowd${GRID}\cellx3000${GRID}\cellx6000\pard\intbl a\cell b\cell\row}`;
		expect(read(word)).not.toContain('<th');
	});

	it('the mark is one cell\'s, and ends with it', () => {
		const html = read(R`{\trowd\cellx3000\cellx6000\pard\intbl {\*\inkth}Head\cell plain\cell\row}{\trowd\cellx3000\cellx6000\pard\intbl a\cell b\cell\row}`);
		expect(html.match(/<th/g)).toHaveLength(1);
		expect(html).toContain('>Head</th><td');
	});
});

describe('rtfToHtml: the borders of a table cell', () => {
	it('are read as the writer sent them', () => {
		for (const html of [
			`${TABLE}<tr><td style="border:1px solid;padding:2px 6px;width:50.0%">a</td><td style="padding:2px 6px;width:50.0%">b</td></tr></table>`,
			`${TABLE}<tr><td style="border-top:0.67px solid;border-bottom:2px dashed;padding:2px 6px;width:50.0%">a</td><td style="border-left:3px double rgb(0,0,255);padding:2px 6px;width:50.0%">b</td></tr></table>`,
			`${TABLE}<tr><td style="border:1px dotted rgb(192,0,0);padding:2px 6px;width:100.0%;text-align:center">a</td></tr></table>`
		]) {
			expect(rtfToHtml(htmlToRtf(el(html))), html).toBe(html);
		}
	});

	it('a table Word wrote with a grid: half a point on every side', () => {
		const side = R`\brdrs\brdrw10`;
		const cellDef = R`\clbrdrt${side}\clbrdrl${side}\clbrdrb${side}\clbrdrr${side}`;
		const html = read(R`{\trowd\trgaph108\trbrdrt${side}\trbrdrl${side}\trbrdrb${side}\trbrdrr${side}\trbrdrh${side}\trbrdrv${side}${cellDef}\cellx3000${cellDef}\cellx6000\pard\intbl HER2\cell Negative\cell\row}`);
		expect(html).toBe(`${TABLE}<tr><td style="border:0.67px solid;padding:2px 6px;width:50.0%">HER2</td><td style="border:0.67px solid;padding:2px 6px;width:50.0%">Negative</td></tr></table>`);
	});

	it('a side that is said to have none has none, and a color is the color table\'s', () => {
		const html = read(R`{\trowd\clbrdrt\brdrnone\clbrdrl\brdrtbl\clbrdrb\brdrdb\brdrw30\brdrcf1\clbrdrr\brdrs\brdrw0\cellx6000\pard\intbl Total\cell\row}`);
		expect(html).toContain('<td style="border-bottom:2px double rgb(192,0,0);padding');
		// Black is the text's own color, and is not said.
		expect(read(R`{\trowd\clbrdrb\brdrs\brdrw15\brdrcf2\cellx6000\pard\intbl x\cell\row}`)).toContain('<td style="border-bottom:1px solid;padding');
	});

	it('a line RTF has and CSS has not is a plain line; a width is one that can be drawn', () => {
		expect(read(R`{\trowd\clbrdrt\brdrwavy\brdrw20\cellx6000\pard\intbl x\cell\row}`)).toContain('border-top:1.33px solid;');
		expect(read(R`{\trowd\clbrdrt\brdrs\brdrw99999\cellx6000\pard\intbl x\cell\row}`)).toContain('border-top:5px solid;');
	});

	it('a border of a paragraph, or of the row, is not a cell\'s', () => {
		const html = read(R`\pard\brdrb\brdrs\brdrw10 ruled\par{\trowd\trbrdrt\brdrs\brdrw10\cellx6000\pard\intbl x\cell\row}`);
		expect(html).not.toMatch(/border(-(top|right|bottom|left))?:/);
		expect(html).toContain('<td style="padding:2px 6px;width:100.0%">x</td>');
	});

	it('what is read is let through when it is made safe', () => {
		const html = `${TABLE}<tbody><tr><td style="border:1px solid;padding:2px 6px;width:100.0%">a</td></tr></tbody></table>`;
		expect(sanitizeHtml(html)).toBe(html);
	});
});

// ── In the editor ──

const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

type Editor = { getRTF(): string; getHTML(): string; setHTML(html: string): void; insertTable(rows: number, columns: number, options?: { borders?: boolean; header?: boolean }): void };

let host: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
});

function open(content: string, props: Record<string, unknown> = {}): { editor: HTMLElement; api: Editor } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false, ...props } }) as Record<string, unknown>;
	flushSync();
	return { editor: host.querySelector('.ink-content') as HTMLElement, api: component as unknown as Editor };
}

function caretIn(editor: HTMLElement, selector: string): void {
	const at = editor.querySelector(selector)!;
	window.getSelection()!.setBaseAndExtent(at.firstChild ?? at, 0, at.firstChild ?? at, 0);
	editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
	flushSync();
}

const dialog = () => document.querySelector('.modal');
const field = (label: string) =>
	Array.from(document.querySelectorAll<HTMLLabelElement>('.modal label')).find((l) => l.textContent!.trim() === label)!.querySelector('input') as HTMLInputElement;
function set(input: HTMLInputElement, value: string | boolean): void {
	if (typeof value === 'boolean') {
		if (input.checked !== value) input.click();
	} else {
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}
	flushSync();
}
function press(button: string): void {
	Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button')).find((b) => b.textContent?.trim() === button)!.click();
	flushSync();
}
const openDialog = () => {
	(host!.querySelector('button[title="Insert table"]') as HTMLButtonElement).click();
	flushSync();
};

describe('Insert table', () => {
	it('puts in a table of the rows and columns asked for, with borders, after the paragraph the caret is in', () => {
		const { editor, api } = open('<p>Results:</p><p>After</p>');
		caretIn(editor, 'p');
		openDialog();
		expect(dialog()).not.toBeNull();
		expect([field('Rows').value, field('Columns').value, field('Borders').checked, field('First row is a header').checked]).toEqual(['3', '3', true, false]);
		set(field('Rows'), '2');
		set(field('Columns'), '3');
		press('Insert');
		expect(dialog()).toBeNull();
		const cell = (width: string) => `<td style="border:1px solid;padding:2px 6px;width:${width}%"><br></td>`;
		const row = `<tr>${cell('33.33')}${cell('33.34')}${cell('33.33')}</tr>`;
		expect(editor.innerHTML).toBe(`<p>Results:</p>${TABLE}<tbody>${row}${row}</tbody></table><p>After</p>`);
		// The caret is in its first cell, to type in.
		expect(window.getSelection()!.anchorNode).toBe(editor.querySelector('td'));
		// Every cell has its borders in the RTF.
		const defs = cellDefs(api.getRTF());
		expect(defs).toHaveLength(2);
		expect(defs.flat()).toEqual(Array(6).fill(GRID));
	});

	it('is the same table after the RTF is read again', () => {
		const { editor, api } = open('<p>Results:</p>');
		caretIn(editor, 'p');
		api.insertTable(2, 2, { header: true });
		const cells = Array.from(editor.querySelectorAll('th, td'));
		cells.forEach((cell, i) => (cell.textContent = ['Marker', 'Result', 'HER2', 'Negative'][i]));
		const rtf = api.getRTF();
		const before = api.getHTML().replace(/<\/?tbody>/g, '');
		// (With the empty line after it, where typing goes on.)
		expect(before).toMatch(/<\/table><p><br><\/p>$/);
		expect(rtfToHtml(rtf).replace(/\n/g, '')).toBe(before);
		api.setHTML(rtfToHtml(rtf));
		expect(api.getRTF()).toBe(rtf);
	});

	it('with no borders the cells have none in the RTF, and a header row has the line that marks one', () => {
		const { editor, api } = open('<p><br></p>');
		caretIn(editor, 'p');
		openDialog();
		set(field('Rows'), '2');
		set(field('Columns'), '1');
		set(field('Borders'), false);
		set(field('First row is a header'), true);
		press('Insert');
		// An empty paragraph is replaced, and there is a line to go on typing after the table.
		expect(editor.innerHTML).toBe(
			`${TABLE}<tbody><tr><th style="border-bottom:1px solid;padding:2px 6px;text-align:left;width:100.0%"><br></th></tr>` +
				'<tr><td style="padding:2px 6px;width:100.0%"><br></td></tr></tbody></table><p><br></p>'
		);
		expect(cellDefs(api.getRTF())).toEqual([[R`\clbrdrb\brdrs`], ['']]);
	});

	it('Enter in a field inserts, Cancel does not, and the dialog keeps to what a table can be', () => {
		const { editor, api } = open('<p>x</p>');
		caretIn(editor, 'p');
		openDialog();
		press('Cancel');
		expect(editor.querySelector('table')).toBeNull();
		openDialog();
		set(field('Rows'), '500');
		set(field('Columns'), '40');
		field('Columns').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		flushSync();
		expect(dialog()).toBeNull();
		expect(editor.querySelectorAll('tr')).toHaveLength(50);
		expect(editor.querySelectorAll('tr:first-child td')).toHaveLength(12);
		expect(api.getRTF().match(/\\row\}/g)).toHaveLength(50);
	});

	it('nothing is put in for a count that is none, or into a document that cannot be edited', () => {
		const { editor, api } = open('<p>x</p>');
		caretIn(editor, 'p');
		for (const [rows, columns] of [[0, 2], [2, 0], [-1, 2], [NaN, 2], [2, Infinity], ['2' as unknown as number, 2]]) api.insertTable(rows, columns);
		openDialog();
		set(field('Rows'), '');
		press('Insert');
		expect(editor.innerHTML).toBe('<p>x</p>');
	});

	it('is not put in a table: with the caret in a cell, the new table comes after that table', () => {
		const { editor, api } = open(`${TABLE}<tbody><tr><td>in</td></tr></tbody></table>`);
		caretIn(editor, 'td');
		api.insertTable(1, 1, { borders: false });
		expect(editor.querySelectorAll('table table')).toHaveLength(0);
		expect(Array.from(editor.children).map((child) => child.tagName)).toEqual(['TABLE', 'TABLE', 'P']);
	});
});

describe('Insert table, read only', () => {
	it('does nothing', () => {
		const { editor, api } = open('<p>fixed</p>', { readonly: true });
		api.insertTable(2, 2);
		expect(editor.innerHTML).toBe('<p>fixed</p>');
	});
});
