import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';

/**
 * Where a picture is on the page: moved up and down, and two side by side.
 *
 * A picture stayed where it was put in: to move one it was removed and put in again. And
 * pictures were one under another, never beside each other with a caption each. A selected
 * picture's frame now moves it over the block above or below, and puts it beside the picture
 * above it: a table of one row with no borders, a picture and its caption in each cell, which
 * is what an RTF can say and every reader of one shows. Invented text.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TABLE = '<table style="border-collapse:collapse;width:100%;margin:4px 0">';
const fig = (caption: string, more = '') => `<figure${more}><img src="${PNG}" style="width:100px;height:auto" alt=""><figcaption>${caption}</figcaption></figure>`;
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** A document with its pictures named, to read. */
const shape = (html: string) => html.replace(/<img [^>]*>/g, '<img>').replace(/<\/?tbody>/g, '').replace(/\n/g, '');

describe('pictures side by side, in the RTF', () => {
	const row = `${TABLE}<tr><td style="padding:2px 6px;width:50.0%">${fig('Figure 1. H&amp;E, 40x')}</td><td style="padding:2px 6px;width:50.0%;text-align:center">${fig('Figure 2. Ki-67')}</td></tr></table>`;

	it('are a row of two cells, a picture and its caption in each', () => {
		const rtf = htmlToRtf(el(row));
		expect(rtf.match(/\\cellx\d+/g)).toEqual(['\\cellx4320', '\\cellx8640']);
		expect(rtf.match(/\{\\pict/g)).toHaveLength(2);
		expect(rtf.match(/\{\\\*\\inkcap\}/g)).toHaveLength(2);
		// No borders: nothing is drawn around the pictures.
		expect(rtf).not.toContain('\\clbrdr');
	});

	it('are read back as they were: each picture a figure with its own caption', () => {
		const back = rtfToHtml(htmlToRtf(el(row)));
		expect(back).toBe(row);
		expect(htmlToRtf(el(back))).toBe(htmlToRtf(el(row)));
	});

	it('a caption with "$&" in it is that text', () => {
		const html = `${TABLE}<tr><td style="padding:2px 6px;width:100.0%">${fig('Costs $&amp; and $1')}</td></tr></table>`;
		expect(rtfToHtml(htmlToRtf(el(html)))).toBe(html);
	});

	it('a picture with no caption is read as the picture alone in its cell, as it always was', () => {
		const back = rtfToHtml(htmlToRtf(el(`${TABLE}<tr><td>${fig('')}</td><td>${fig('Two')}</td></tr></table><p>After</p>`)));
		expect(shape(back)).toBe(
			`${TABLE}<tr><td style="padding:2px 6px;width:50.0%"><img></td><td style="padding:2px 6px;width:50.0%"><figure><img><figcaption>Two</figcaption></figure></td></tr></table><p>After</p>`
		);
	});

	it('a cell with more in it than a picture and its caption is read as its lines', () => {
		const R = String.raw;
		const pict = htmlToRtf(el(`<p><img src="${PNG}" style="width:100px;height:auto"></p>`)).match(/\{\\pict[^}]*\}/)![0];
		const read = (cell: string) => shape(rtfToHtml(R`{\rtf1\ansi{\trowd\cellx6000\pard\intbl ${cell}\cell\row}\pard After\par}`));
		// Words before the picture; two pictures; a caption mark with nothing after it.
		expect(read(R`Specimen A\par ${pict}\par {\*\inkcap}\pard\intbl\i shown\i0`)).toContain('<td style="padding:2px 6px;width:100.0%">Specimen A<br><img><br><em>shown</em></td>');
		expect(read(R`${pict}${pict}\par {\*\inkcap}\pard\intbl\i both\i0`)).not.toContain('<figure');
		expect(read(R`${pict}\par {\*\inkcap}\pard\intbl `)).toContain('<td style="padding:2px 6px;width:100.0%"><img></td>');
		// And the mark is the cell's: the paragraph after the table is no caption.
		expect(read(R`${pict}\par {\*\inkcap}\pard\intbl `)).toContain('<p>After</p>');
	});
});

// ── In the editor ──

const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

// Layout does not run in happy-dom: a picture and the page it is on are given a size, so
// that the picture's frame is shown.
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
	Element.prototype.getBoundingClientRect = function (this: Element) {
		const [left, top, width, height] = this.tagName === 'IMG' ? [10, 10, 100, 80] : [0, 0, 600, 800];
		return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top } as DOMRect;
	};
});
afterAll(() => {
	Element.prototype.getBoundingClientRect = realRect;
});

type Editor = { getRTF(): string; getHTML(): string; setParagraphSpacing(space: { before?: number | null; after?: number | null }): void };

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

/** Select the picture whose caption (or alt) is given, as a click on it does. */
function pick(editor: HTMLElement, name: string): HTMLImageElement {
	const img = Array.from(editor.querySelectorAll('img')).find((i) => i.closest('figure')?.querySelector('figcaption')?.textContent === name || i.alt === name);
	if (!img) throw new Error(`no picture "${name}"`);
	img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
	return img;
}
const tool = (title: string) => host!.querySelector<HTMLButtonElement>(`.ink-img-tools button[title="${title}"]`);
function press(title: string): void {
	const button = tool(title);
	if (!button) throw new Error(`no "${title}" button`);
	if (button.disabled) throw new Error(`"${title}" is disabled`);
	button.click();
	flushSync();
}
/** The document as its blocks: p for a paragraph, a caption for a picture, [a|b] for a row of pictures. */
function blocks(editor: HTMLElement): string[] {
	return Array.from(editor.children).map((child) => {
		if (child.tagName === 'FIGURE') return child.querySelector('figcaption')?.textContent || 'figure';
		if (child.tagName === 'TABLE') return `[${Array.from(child.querySelectorAll('td, th'), (cell) => cell.querySelector('figcaption')?.textContent || (cell.querySelector('img') ? 'img' : cell.textContent)).join('|')}]`;
		return (child.textContent ?? '').trim() || 'empty';
	});
}

const THREE = `<p>Gross description</p>${fig('A')}${fig('B')}${fig('C')}<p>Diagnosis</p>`;

describe('Move up and Move down', () => {
	it('move a picture, with its caption, over the block above it or below it', () => {
		const { editor } = open(THREE);
		pick(editor, 'B');
		press('Move up');
		expect(blocks(editor)).toEqual(['Gross description', 'B', 'A', 'C', 'Diagnosis']);
		press('Move up');
		expect(blocks(editor)).toEqual(['B', 'Gross description', 'A', 'C', 'Diagnosis']);
		// At the top there is nothing to move over.
		expect(tool('Move up')!.disabled).toBe(true);
		press('Move down');
		press('Move down');
		press('Move down');
		expect(blocks(editor)).toEqual(['Gross description', 'A', 'C', 'B', 'Diagnosis']);
		// The picture is still the one selected, and is where it was put in the RTF.
		expect(host!.querySelector('.ink-img-frame')).not.toBeNull();
	});

	it('a picture moved to the end has a line after it to go on typing; that empty line is nothing to move past', () => {
		const { editor } = open(`${fig('A')}<p>Diagnosis</p>`);
		pick(editor, 'A');
		press('Move down');
		expect(editor.innerHTML).toMatch(/<p>Diagnosis<\/p><figure>.*<\/figure><p><br><\/p>$/);
		expect(tool('Move down')!.disabled).toBe(true);
		press('Move up');
		expect(blocks(editor)).toEqual(['A', 'Diagnosis', 'empty']);
	});

	it('tell the editor the document changed', () => {
		let changes = 0;
		const { editor } = open(THREE, { onchange: () => changes++ });
		pick(editor, 'C');
		press('Move up');
		expect(changes).toBe(1);
	});

	it('a picture in a line of text is not moved: the line is not the picture', () => {
		const { editor } = open(`<p>Before</p><p>See <img src="${PNG}" alt="inline"> here</p><p>After</p>`);
		pick(editor, 'inline');
		expect([tool('Move up')!.disabled, tool('Move down')!.disabled, tool('Place beside the picture above')!.disabled]).toEqual([true, true, true]);
	});

	it('a paragraph that holds a picture alone is moved as one', () => {
		const { editor } = open(`<p>Before</p><p><img src="${PNG}" alt="alone"></p><p>After</p>`);
		pick(editor, 'alone');
		press('Move up');
		expect(blocks(editor)).toEqual(['empty', 'Before', 'After']);
		expect(editor.firstElementChild!.querySelector('img')).not.toBeNull();
	});
});

describe('Place beside the picture above', () => {
	it('puts the two in a row, each with its own caption', () => {
		const { editor, api } = open(THREE);
		pick(editor, 'B');
		press('Place beside the picture above');
		expect(blocks(editor)).toEqual(['Gross description', '[A|B]', 'C', 'Diagnosis']);
		expect(shape(editor.innerHTML)).toContain(
			`<p>Gross description</p>${TABLE}<tr><td style="padding:2px 6px;width:50.0%"><figure><img><figcaption>A</figcaption></figure></td>` +
				'<td style="padding:2px 6px;width:50.0%"><figure><img><figcaption>B</figcaption></figure></td></tr></table><figure>'
		);
		// And the same row when the RTF is read again.
		const back = rtfToHtml(api.getRTF());
		expect(shape(back)).toContain('<td style="padding:2px 6px;width:50.0%"><figure><img><figcaption>A</figcaption></figure></td><td style="padding:2px 6px;width:50.0%"><figure><img><figcaption>B</figcaption></figure></td>');
		expect(htmlToRtf(el(back))).toBe(api.getRTF());
	});

	it('is there only for a picture that has one above it', () => {
		const { editor } = open(THREE);
		pick(editor, 'A');
		expect(tool('Place beside the picture above')!.disabled).toBe(true);
		pick(editor, 'C');
		expect(tool('Place beside the picture above')!.disabled).toBe(false);
	});

	it('a third and a fourth join the row, which shares its width among them; a fifth does not', () => {
		const { editor } = open(`${fig('A')}${fig('B')}${fig('C')}${fig('D')}${fig('E')}`);
		for (const name of ['B', 'C', 'D']) {
			pick(editor, name);
			press('Place beside the picture above');
		}
		expect(blocks(editor)).toEqual(['[A|B|C|D]', 'E', 'empty']);
		expect(Array.from(editor.querySelectorAll('td'), (cell) => parseFloat(cell.style.width))).toEqual([25, 25, 25, 25]);
		pick(editor, 'E');
		expect(tool('Place beside the picture above')!.disabled).toBe(true);
	});

	it('keeps where each picture was aligned, on its cell; and takes off the space a figure had, which a cell does not have', () => {
		const { editor } = open(`${fig('A', ' style="text-align:center;margin-top:12pt"')}${fig('B', ' style="text-align:right"')}`);
		pick(editor, 'B');
		press('Place beside the picture above');
		expect(Array.from(editor.querySelectorAll('td'), (cell) => [cell.style.padding, parseFloat(cell.style.width), cell.style.textAlign])).toEqual([['2px 6px', 50, 'center'], ['2px 6px', 50, 'right']]);
		expect(Array.from(editor.querySelectorAll('figure'), (f) => f.getAttribute('style'))).toEqual([null, null]);
	});

	it('a picture alone in its paragraph becomes a figure in its cell', () => {
		const { editor } = open(`${fig('A')}<p><img src="${PNG}" alt="alone"></p><p>After</p>`);
		pick(editor, 'alone');
		press('Place beside the picture above');
		expect(shape(editor.innerHTML)).toContain('<figure><img><figcaption>A</figcaption></figure></td><td style="padding:2px 6px;width:50.0%"><figure><img><figcaption></figcaption></figure></td>');
		expect(blocks(editor)).toEqual(['[A|img]', 'After']);
	});
});

describe('a row of pictures', () => {
	const ROW = `<p>Before</p>${TABLE}<tbody><tr><td style="padding:2px 6px;width:50.0%">${fig('A')}</td><td style="padding:2px 6px;width:50.0%;text-align:center">${fig('B')}</td></tr></tbody></table>${fig('C')}<p>After</p>`;

	it('is moved as one', () => {
		const { editor } = open(ROW);
		pick(editor, 'B');
		press('Move down');
		expect(blocks(editor)).toEqual(['Before', 'C', '[A|B]', 'After']);
		press('Move up');
		press('Move up');
		expect(blocks(editor)).toEqual(['[A|B]', 'Before', 'C', 'After']);
	});

	it('Place on its own line takes a picture out, under the row; the one left is on its own line too', () => {
		const { editor } = open(ROW);
		pick(editor, 'A');
		expect(tool('Place beside the picture above')).toBeNull();
		press('Place on its own line');
		expect(blocks(editor)).toEqual(['Before', 'B', 'A', 'C', 'After']);
		expect(editor.querySelector('table')).toBeNull();
		// B was centered in its cell, and is still.
		expect(Array.from(editor.querySelectorAll('figure'), (f) => f.getAttribute('style'))).toEqual(['text-align: center;', null, null]);
		// A is still selected, and can go back beside B.
		press('Place beside the picture above');
		expect(blocks(editor)).toEqual(['Before', '[B|A]', 'C', 'After']);
	});

	it('of three is a row of two when one is taken out', () => {
		const { editor } = open(`${TABLE}<tbody><tr><td>${fig('A')}</td><td>${fig('B')}</td><td>${fig('C')}</td></tr></tbody></table>`);
		pick(editor, 'B');
		press('Place on its own line');
		expect(blocks(editor)).toEqual(['[A|C]', 'B', 'empty']);
		expect(Array.from(editor.querySelectorAll('td'), (cell) => parseFloat(cell.style.width))).toEqual([50, 50]);
	});

	it('Remove image takes one out; the other is on its own line again', () => {
		const { editor } = open(ROW);
		pick(editor, 'A');
		press('Remove image');
		expect(blocks(editor)).toEqual(['Before', 'B', 'C', 'After']);
		expect(host!.querySelector('.ink-img-frame')).toBeNull();
	});

	it('a picture in it is aligned in its cell, where the RTF has it', () => {
		const { editor, api } = open(ROW);
		pick(editor, 'A');
		press('Align right');
		expect(editor.querySelector('td')!.style.textAlign).toBe('right');
		expect(editor.querySelector('figure')!.getAttribute('style')).toBeNull();
		expect(tool('Align right')!.classList.contains('active')).toBe(true);
		expect(api.getRTF()).toMatch(/\\pard\\intbl\\qr \{\\pict/);
		pick(editor, 'B');
		press('Align left');
		expect(editor.querySelectorAll('td')[1].style.textAlign).toBe('');
	});

	it('Edit description gives a caption to a picture that was read back without one', () => {
		const { editor } = open(`${TABLE}<tbody><tr><td><img src="${PNG}" alt="bare"></td><td>${fig('B')}</td></tr></tbody></table>`);
		pick(editor, 'bare');
		expect(tool('Place on its own line')).not.toBeNull();
		press('Edit description');
		expect(shape(editor.querySelector('td')!.innerHTML)).toBe('<figure><img><figcaption></figcaption></figure>');
	});

	it('has no space before or after to set: a cell has none', () => {
		const { editor, api } = open(ROW);
		const before = editor.innerHTML;
		pick(editor, 'A');
		api.setParagraphSpacing({ before: 12 });
		expect(editor.innerHTML).toBe(before);
	});

	it('a table that holds more than pictures is not one: its picture is not moved or taken out', () => {
		const { editor } = open(`<p>Before</p>${TABLE}<tbody><tr><td>${fig('A')}</td><td>Specimen A</td></tr></tbody></table>`);
		pick(editor, 'A');
		expect([tool('Move up')!.disabled, tool('Move down')!.disabled, tool('Place beside the picture above')!.disabled]).toEqual([true, true, true]);
		expect(tool('Place on its own line')).toBeNull();
	});
});

describe('one under another', () => {
	it('the space between two pictures is the space after one or before the other', () => {
		const { editor, api } = open(`${fig('A')}${fig('B')}`);
		pick(editor, 'A');
		api.setParagraphSpacing({ after: 12 });
		expect(editor.querySelector('figure')!.getAttribute('style')).toBe('margin-bottom: 12pt;');
		expect(api.getRTF()).toContain('\\sa240\\i A');
		// And aligning it left again leaves that space as it is.
		press('Align center');
		press('Align left');
		expect(editor.querySelector('figure')!.getAttribute('style')).toBe('margin-bottom: 12pt;');
	});
});

describe('read only', () => {
	it('no picture is moved', () => {
		const { editor } = open(THREE, { readonly: true });
		const img = editor.querySelectorAll('img')[1];
		img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(host!.querySelector('.ink-img-tools')).toBeNull();
		expect(blocks(editor)).toEqual(['Gross description', 'A', 'B', 'C', 'Diagnosis']);
	});
});
