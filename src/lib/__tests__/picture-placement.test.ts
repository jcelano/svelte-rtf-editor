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

describe('a row of pictures with a set gap', () => {
	const ROW = `<p>Before</p>${TABLE}<tbody><tr><td style="padding:2px 6px;width:50.0%">${fig('A')}</td><td style="padding:2px 6px;width:50.0%;text-align:center">${fig('B')}</td></tr></tbody></table><p>After</p>`;
	const GAPPED = '<table style="border-collapse:collapse;margin:4px 0">';
	const gapInput = () => host!.querySelector<HTMLInputElement>('.ink-img-gap input');
	function typeGap(value: string): void {
		const input = gapInput();
		if (!input) throw new Error('no gap to set');
		input.value = value;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
	}
	/** Each cell of the row as its width, and what it holds: a caption, or nothing for a gap. */
	const cells = (editor: HTMLElement) => Array.from(editor.querySelectorAll('td'), (cell) => `${cell.querySelector('figcaption')?.textContent ?? ''}:${cell.style.width}`);
	/** The editor laid out on a page this wide, in px. */
	function pageWidth(editor: HTMLElement, px: number): void {
		Object.defineProperty(editor, 'clientWidth', { configurable: true, get: () => px });
	}

	it('is written at its own widths: each picture its cell, the gap an empty cell, nothing stretched to the page', () => {
		const html = `${GAPPED}<tr><td style="padding:0;width:75pt">${fig('A')}</td><td style="padding:0;width:18pt"></td><td style="padding:0;width:75pt">${fig('B')}</td></tr></table>`;
		const rtf = htmlToRtf(el(html));
		// 100 px is 1500 twips, 18 pt is 360; and no space inside a cell, so the picture fills it.
		expect(rtf.match(/\\cellx\d+/g)).toEqual(['\\cellx1500', '\\cellx1860', '\\cellx3360']);
		expect(rtf).toContain('\\trowd\\trgaph0\\cellx1500');
		expect(rtf.match(/\{\\pict/g)).toHaveLength(2);
		// Read back as it was, and written again the same.
		const back = rtfToHtml(rtf);
		expect(back).toBe(html);
		expect(htmlToRtf(el(back))).toBe(rtf);
	});

	it('a gap in a row of pictures that has no captions is read back too', () => {
		const html = `${GAPPED}<tr><td style="padding:0;width:75pt">${fig('')}</td><td style="padding:0;width:36pt"></td><td style="padding:0;width:75pt">${fig('')}</td></tr></table>`;
		expect(shape(rtfToHtml(htmlToRtf(el(html))))).toBe(`${GAPPED}<tr><td style="padding:0;width:75pt"><img></td><td style="padding:0;width:36pt"></td><td style="padding:0;width:75pt"><img></td></tr></table>`);
	});

	it('an empty cell in a table of words is no gap: the table is read across the page as it always was', () => {
		const back = rtfToHtml(htmlToRtf(el(`${GAPPED}<tr><td style="width:75pt">Specimen</td><td style="width:18pt"></td><td style="width:75pt">${fig('B')}</td></tr></table>`)));
		expect(back).toContain('width:100%');
	});

	it('a table that only looks like one, with borders or the space a reader puts in its cells, is read as the table it is', () => {
		// (Its borders were taken off, and it was no longer as wide as the page.)
		const bordered = `${TABLE}<tr><td style="border:1px solid;width:40%">${fig('A')}</td><td style="border:1px solid;width:20%"></td><td style="border:1px solid;width:40%">${fig('B')}</td></tr></table>`;
		const back = rtfToHtml(htmlToRtf(el(bordered)));
		expect(back).toContain('width:100%');
		expect(back.match(/border:1px solid;/g)).toHaveLength(3);
		// The same shape with no width of its own, and borders: written across the page, and read with them.
		const unsized = bordered.replace(TABLE, GAPPED).replace(/width:\d+%/g, 'width:75pt');
		expect(htmlToRtf(el(unsized))).toContain('\\trgaph120');
		expect(rtfToHtml(htmlToRtf(el(unsized))).match(/border:1px solid;/g)).toHaveLength(3);
		// From Word: the space it puts in every cell, and no borders.
		const R = String.raw;
		const pict = htmlToRtf(el(`<p><img src="${PNG}" style="width:100px;height:auto"></p>`)).match(/\{\\pict[^}]*\}/)![0];
		const word = R`{\rtf1\ansi{\trowd\trgaph108\cellx1500\cellx1860\cellx3360\pard\intbl ${pict}\cell\pard\intbl\cell\pard\intbl ${pict}\cell\row}\pard After\par}`;
		expect(rtfToHtml(word)).toContain('width:100%');
	});

	it('an empty cell with a border in a table pasted with no width is no gap: the table is left as it is', () => {
		const pasted = `<table><tbody><tr><td style="border: 1px solid; width: 75pt;">${fig('A')}</td><td style="border: 1px solid; width: 18pt;"></td><td style="border: 1px solid; width: 75pt;">${fig('B')}</td></tr></tbody></table>`;
		const { editor } = open(`<p>Before</p>${pasted}`);
		const before = editor.innerHTML;
		pick(editor, 'A');
		expect(gapInput()).toBeNull();
		expect(tool('Place on its own line')).toBeNull();
		expect(editor.innerHTML).toBe(before);
	});

	it('a gap the caret left a line break in is still the gap', () => {
		const row = `${GAPPED}<tbody><tr><td style="padding:0;width:75pt">${fig('A')}</td><td style="padding:0;width:18pt"><br></td><td style="padding:0;width:75pt">${fig('B')}</td></tr></tbody></table>`;
		const { editor, api } = open(row);
		pick(editor, 'A');
		expect(gapInput()!.value).toBe('18');
		expect(api.getRTF().match(/\\cellx\d+/g)).toEqual(['\\cellx1500', '\\cellx1860', '\\cellx3360']);
	});

	it('a gap too wide for the page is the widest that leaves every picture room, and a picture can still be resized only so far', () => {
		const { editor } = open(`${fig('A')}${fig('B')}${fig('C')}${fig('D')}`);
		pageWidth(editor, 600);
		for (const name of ['B', 'C', 'D']) {
			pick(editor, name);
			press('Place beside the picture above');
		}
		typeGap('144');
		// (600 px less 4 pictures of at least 40 px, in 3 gaps: 146 px, 110 pt.)
		const widths = cells(editor).filter((cell) => cell.startsWith(':')).map((cell) => parseFloat(cell.slice(1)));
		expect(widths).toEqual([110, 110, 110]);
		const row = Array.from(editor.querySelectorAll('img'), (img) => parseFloat(img.style.width)).reduce((a, b) => a + b, 0) + 3 * (110 * 4) / 3;
		expect(row).toBeLessThanOrEqual(600);
		expect(gapInput()!.value).toBe('110');
		// The frame is given a limit, not none: Full width is no wider than the room left.
		press('Full width');
		expect(parseFloat(editor.querySelectorAll('img')[3].style.width)).toBeLessThan(100);
	});

	it('a picture not yet loaded is not made small: it is laid out once it has its width', () => {
		const html = `${TABLE}<tbody><tr><td>${fig('A')}</td><td><figure><img src="${PNG}" alt="late"><figcaption>B</figcaption></figure></td></tr></tbody></table>`;
		const { editor } = open(html);
		const late = editor.querySelector<HTMLImageElement>('img[alt="late"]')!;
		let loaded = false;
		late.getBoundingClientRect = () => ({ left: 0, top: 0, width: loaded ? 120 : 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }) as DOMRect;
		// (Not loaded: no size of its own yet, nor on the page.)
		Object.defineProperty(late, 'naturalWidth', { configurable: true, get: () => (loaded ? 120 : 0) });
		Object.defineProperty(late, 'complete', { configurable: true, get: () => loaded });
		pick(editor, 'A');
		typeGap('18');
		expect(late.style.width).toBe('');
		expect(cells(editor)).toEqual(['A:75pt', ':18pt', 'B:']);
		loaded = true;
		late.dispatchEvent(new Event('load'));
		flushSync();
		expect(late.style.width).toBe('120px');
		expect(cells(editor)).toEqual(['A:75pt', ':18pt', 'B:90pt']);
	});

	it('is set from the frame of a picture in the row, in points, and taken off by leaving it empty', () => {
		const { editor, api } = open(ROW);
		pick(editor, 'A');
		expect(gapInput()!.value).toBe('');
		typeGap('18');
		expect(cells(editor)).toEqual(['A:75pt', ':18pt', 'B:75pt']);
		expect(shape(editor.innerHTML)).toContain(`${GAPPED}<tr><td style="padding:0;width:75pt"><figure><img><figcaption>A</figcaption>`);
		expect(gapInput()!.value).toBe('18');
		expect(api.getRTF().match(/\\cellx\d+/g)).toEqual(['\\cellx1500', '\\cellx1860', '\\cellx3360']);
		// Any gap: an inch and a half.
		typeGap('108');
		expect(cells(editor)).toEqual(['A:75pt', ':108pt', 'B:75pt']);
		// Empty: the pictures share the page again, each in the middle of its half no more.
		typeGap('');
		expect(cells(editor)).toEqual(['A:50.0%', 'B:50.0%']);
		expect(editor.querySelector('table')!.style.width).toBe('100%');
	});

	it('what is not a gap is not set: the row stays as it was', () => {
		const { editor } = open(ROW);
		pick(editor, 'A');
		typeGap('12');
		typeGap('-4');
		expect(cells(editor)).toEqual(['A:75pt', ':12pt', 'B:75pt']);
		expect(gapInput()!.value).toBe('12');
		typeGap('100000');
		expect(cells(editor)).toEqual(['A:75pt', ':144pt', 'B:75pt']);
	});

	it('is one step to undo', () => {
		const { editor } = open(ROW);
		const before = editor.innerHTML;
		pick(editor, 'B');
		typeGap('24');
		expect((component as unknown as { undo(): boolean }).undo()).toBe(true);
		expect(editor.innerHTML).toBe(before);
	});

	it('stays when a picture joins the row or leaves it, and a picture left alone is on its own line', () => {
		const { editor } = open(`${fig('A')}${fig('B')}${fig('C')}`);
		pick(editor, 'B');
		press('Place beside the picture above');
		typeGap('10');
		pick(editor, 'C');
		press('Place beside the picture above');
		expect(cells(editor)).toEqual(['A:75pt', ':10pt', 'B:75pt', ':10pt', 'C:75pt']);
		pick(editor, 'B');
		press('Place on its own line');
		expect(cells(editor)).toEqual(['A:75pt', ':10pt', 'C:75pt']);
		pick(editor, 'A');
		press('Remove image');
		expect(editor.querySelector('table')).toBeNull();
		expect(blocks(editor)).toEqual(['C', 'B', 'empty']);
	});

	it('pictures too wide for the page together with their gaps are made smaller alike', () => {
		const { editor } = open(ROW.replace(/width:100px/g, 'width:400px'));
		pageWidth(editor, 600);
		pick(editor, 'A');
		// 600 px of page, less 36 pt (48 px) of gap: 276 px each.
		typeGap('36');
		expect(Array.from(editor.querySelectorAll('img'), (img) => img.style.width)).toEqual(['276px', '276px']);
		expect(cells(editor)).toEqual(['A:207pt', ':36pt', 'B:207pt']);
	});

	it('a picture made wider or narrower takes its cell with it, and has the room the gap and the others leave', () => {
		const { editor } = open(ROW);
		pageWidth(editor, 600);
		pick(editor, 'A');
		typeGap('36');
		// The page is 600 px; B is 100, the gap 48: A has 452.
		press('Full width');
		expect(editor.querySelector('img')!.style.width).toBe('452px');
		expect(cells(editor)).toEqual(['A:339pt', ':36pt', 'B:75pt']);
		press('Half width');
		expect(cells(editor)).toEqual(['A:169.5pt', ':36pt', 'B:75pt']);
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
