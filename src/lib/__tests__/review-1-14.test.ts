import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { sanitizeHtml } from '../sanitize.js';
import { toggleList, unnestItems, leaveList } from '../lists.js';

/**
 * Four findings of a review of 1.14.0, each as the test that would have caught it.
 *
 * 1. Words copied from a web page come with that page's line height ("line-height: 14px").
 *    1.14.0 wrote a length as a line of exactly that height, which Word and LibreOffice cut
 *    off at that height: a picture pasted with the words was whole in the editor and a strip
 *    14px high in the RTF.
 * 2. An item taken out from under another (Shift+Tab, Backspace, Outdent) went after everything
 *    the item above it held: where that held a second list, or a paragraph after its list, the
 *    item was moved below lines that had followed it.
 * 3. A line height had no least value: "\sl-20" in a file, "line-height:0" in a paste and
 *    setLineSpacing(0.05) all printed the lines of a paragraph over each other.
 * 4. estimateRtfBytes, which is never below the real size, was below it for a cell whose
 *    borders have colors: their color-table entries were not counted.
 *
 * Invented text.
 */

const R = String.raw;
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** The RTF after the header, without the closing brace, each picture as "{PICT}". */
const body = (html: string, options = {}) => {
	const rtf = htmlToRtf(el(html), options).replace(/\{\\pict[^}]*\}/g, '{PICT}');
	return rtf.slice(rtf.search(/\\pard\\f0\\fs\d+ /)).replace(/^\\pard\\f0\\fs\d+ /, '').slice(0, -1);
};
const read = (rtfBody: string) => rtfToHtml(`{\\rtf1\\ansi\\deff0 ${rtfBody}}`);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('a line height that is a length is not written where it would cut something off', () => {
	it('a paragraph that holds a picture has a height its lines have at least, never exactly', () => {
		const rtf = body(`<p style="line-height:14px">Pasted with its picture <img src="${PNG}" style="width:240px;height:180px"> in the line.</p>`);
		expect(rtf).toContain(R`\pard\sl210\slmult0 `);
		expect(rtf).not.toMatch(/\\sl-\d/);
		expect(rtf).toContain('{PICT}');
	});

	it('nor has what holds only a picture, as pages and mail wrap one ("line-height:1px")', () => {
		for (const html of [`<div style="line-height:1px"><img src="${PNG}" style="width:200px;height:150px"></div>`, `<p style="line-height:14px"><img src="${PNG}"></p>`]) {
			expect(body(html), html.slice(0, 40)).not.toMatch(/\\sl-\d/);
		}
	});

	it('text taller than the line is not put in it: the height is left out', () => {
		// 24pt text in lines of 10.5pt.
		expect(body('<p style="line-height:14px"><span style="font-size:24pt">CRITICAL VALUE</span></p>')).not.toContain(R`\sl`);
		expect(body('<p style="line-height:14px;font-size:24pt">CRITICAL VALUE</p>')).not.toContain(R`\sl`);
		expect(body('<p style="line-height:14px"><font size="7">CRITICAL VALUE</font></p>')).not.toContain(R`\sl`);
		// A heading is as tall as its level makes it: an <h1> is 24pt in a 12pt document.
		expect(body('<h1 style="line-height:14px">Diagnosis</h1>')).not.toContain(R`\sl`);
		// And body text is as tall as the document's own size.
		expect(body('<p style="line-height:12pt">Body</p>', { fontSize: 18 })).not.toContain(R`\sl`);
	});

	it('a height the text fits in is written exactly, as it was', () => {
		expect(body('<p style="line-height:14pt">Exactly</p>')).toBe(R`\pard\sl-280\slmult0 Exactly\par `);
		expect(body('<h1 style="line-height:30pt">Diagnosis</h1>')).toContain(R`\sl-600\slmult0`);
		expect(body('<p style="line-height:10pt"><span style="font-size:9pt">Small print</span></p>', { fontSize: 9 })).toContain(R`\sl-200\slmult0`);
	});

	it('what is written reads back as the same, and is the same when it is written again', () => {
		for (const html of ['<p style="line-height:14pt">Exactly</p>', '<p style="line-height:1.5">Lines</p>']) {
			const back = rtfToHtml(htmlToRtf(el(html)));
			expect(back).toBe(html);
			expect(htmlToRtf(el(back))).toBe(htmlToRtf(el(html)));
		}
	});

	it('the estimate is not below what is written, whichever form that is', () => {
		for (const html of [
			`<p style="line-height:14px">a <img src="${PNG}"> b</p>`,
			'<p style="line-height:14px"><span style="font-size:24pt">x</span></p>',
			'<p style="line-height:14pt">x</p>',
			'<h1 style="line-height:14px">x</h1>',
			'<p style="line-height:0.2">x</p>'
		]) {
			expect(estimateRtfBytes(el(html)), html.slice(0, 50)).toBeGreaterThanOrEqual(htmlToRtf(el(html)).length);
		}
	});
});

describe('lines are not printed over each other', () => {
	it('the reader does not read a line height below the height of the text', () => {
		// 12pt text (the default) in lines of 1pt, and of a twentieth of a point.
		expect(read(R`\pard\sl-20\slmult0 Positive for invasive carcinoma.\line Margin involved.\par`)).toBe('<p>Positive for invasive carcinoma.<br>Margin involved.</p>');
		expect(read(R`\pard\sl-1 Addendum\par`)).toBe('<p>Addendum</p>');
		// 24pt text in lines of 12pt.
		expect(read(R`\pard\sl-240\slmult0\fs48 Large\par`)).not.toContain('line-height');
		// Half a line, as a count of lines.
		expect(read(R`\pard\sl120\slmult1 Half\par`)).toBe('<p>Half</p>');
	});

	it('and reads one the text fits in, as it did', () => {
		expect(read(R`\pard\sl-360 exactly\par`)).toBe('<p style="line-height:18pt">exactly</p>');
		expect(read(R`\pard\sl-240\slmult0 twelve\par`)).toBe('<p style="line-height:12pt">twelve</p>');
		expect(read(R`\pard\sl-200\slmult0\fs18 small print\par`)).toContain('line-height:10pt');
		expect(read(R`\pard\sl192\slmult1 tight\par`)).toBe('<p style="line-height:0.8">tight</p>');
		expect(read(R`\pard\sl360\slmult1 one and a half\par`)).toBe('<p style="line-height:1.5">one and a half</p>');
	});

	it('the writer does not write one', () => {
		for (const height of ['0', '0.2', '50%', '1px', '3pt']) {
			expect(body(`<p style="line-height:${height}">Positive for malignancy.<br>Second line.</p>`), height).not.toContain(R`\sl`);
		}
		expect(body('<p style="line-height:0.8">Tight</p>')).toBe(R`\pard\sl192\slmult1 Tight\par `);
	});

	it('the sanitizer does not keep one', () => {
		for (const height of ['0', '0.2', '.5', '50%', '1px', '3pt', '0.5em']) {
			expect(sanitizeHtml(`<p style="line-height:${height}">Positive for malignancy.<br>Second line.</p>`), height).toBe('<p>Positive for malignancy.<br>Second line.</p>');
		}
		// Against the size of the element's own text: 12pt lines are too close for 24pt text.
		expect(sanitizeHtml('<p style="font-size:24pt;line-height:12pt">Large</p>')).not.toContain('line-height');
	});

	it('and keeps the line heights a document has', () => {
		for (const height of ['1', '1.15', '1.5', '2', '0.8', '107%', '14pt', '20px', 'normal']) {
			expect(sanitizeHtml(`<p style="line-height:${height}">Lines</p>`), height).toContain('line-height');
		}
	});
});

// ── In the editor ──

const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

describe('setLineSpacing', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
	});

	it('sets no spacing that puts the lines over each other', () => {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props: { content: '<p>one<br>two</p>', autosave: false } }) as Record<string, unknown>;
		flushSync();
		const editor = host.querySelector('.ink-content') as HTMLElement;
		const api = component as unknown as { setLineSpacing(lines: number | null): void };
		window.getSelection()!.collapse(editor.querySelector('p')!.firstChild, 1);
		editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
		flushSync();
		for (const lines of [0.05, 0.2, 0.5, 0.79]) api.setLineSpacing(lines);
		expect(editor.innerHTML).toBe('<p>one<br>two</p>');
		api.setLineSpacing(0.8);
		expect(editor.innerHTML).toBe('<p style="line-height: 0.8;">one<br>two</p>');
	});
});

describe('lists: an item taken out from under another stays where it is in the document', () => {
	let root: HTMLElement;
	const sel = () => window.getSelection()!;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
	});
	afterEach(() => root.remove());

	const text = (words: string): Text => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent === words) return node as Text;
		throw new Error(`no text "${words}"`);
	};
	/** The lines of the document, in the order they are read. */
	const lines = () => {
		const found: string[] = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent!.trim()) found.push(node.textContent!.trim());
		return found;
	};
	/** The same lines as the RTF has them. */
	const written = () => Array.from(el(rtfToHtml(htmlToRtf(root))).querySelectorAll('li, p'), (line) => Array.from(line.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join('')).filter(Boolean);

	const TWO_LISTS = '<ul><li>Colon, biopsy:<ul><li>Tubular adenoma</li><li>Negative for high-grade dysplasia</li></ul><ol><li>See comment</li></ol></li><li>Rectum, biopsy</li></ul>';
	const ORDER = ['Colon, biopsy:', 'Tubular adenoma', 'Negative for high-grade dysplasia', 'See comment', 'Rectum, biopsy'];

	it('the list buttons alone make an item with two lists under it', () => {
		root.innerHTML = '<ul><li>Colon, biopsy:<ul><li>Tubular adenoma</li><li>Negative for high-grade dysplasia</li><li>See comment</li></ul></li><li>Rectum, biopsy</li></ul>';
		sel().setBaseAndExtent(text('See comment'), 0, text('See comment'), 11);
		toggleList(root, sel(), 'ol');
		expect(root.innerHTML).toBe(TWO_LISTS);
	});

	it('Shift+Tab on the last item of the first list: what followed it is under it, not above it', () => {
		root.innerHTML = TWO_LISTS;
		sel().collapse(text('Negative for high-grade dysplasia'), 0);
		expect(unnestItems(root, sel())).toBe(true);
		expect(root.innerHTML).toBe(
			'<ul><li>Colon, biopsy:<ul><li>Tubular adenoma</li></ul></li><li>Negative for high-grade dysplasia<ol><li>See comment</li></ol></li><li>Rectum, biopsy</li></ul>'
		);
		expect(lines()).toEqual(ORDER);
		expect(written()).toEqual(ORDER);
	});

	it('the first item of the first list too, with the rest of its list', () => {
		root.innerHTML = TWO_LISTS;
		sel().collapse(text('Tubular adenoma'), 0);
		expect(unnestItems(root, sel())).toBe(true);
		expect(root.innerHTML).toBe(
			'<ul><li>Colon, biopsy:</li><li>Tubular adenoma<ul><li>Negative for high-grade dysplasia</li></ul><ol><li>See comment</li></ol></li><li>Rectum, biopsy</li></ul>'
		);
		expect(lines()).toEqual(ORDER);
	});

	it('Backspace at the start of the item, and the list button that makes it a paragraph', () => {
		root.innerHTML = TWO_LISTS;
		sel().collapse(text('Negative for high-grade dysplasia'), 0);
		expect(leaveList(root, sel())).toBe(true);
		expect(lines()).toEqual(ORDER);

		root.innerHTML = TWO_LISTS;
		sel().collapse(text('Negative for high-grade dysplasia'), 3);
		expect(toggleList(root, sel(), 'ul')).toBe(true);
		expect(root.querySelector('p')?.textContent).toBe('Negative for high-grade dysplasia');
		expect(lines()).toEqual(ORDER);
		expect(written()).toEqual(ORDER);
	});

	it('a paragraph after the list of an item, as Word pastes one, stays after the item taken out', () => {
		root.innerHTML = '<ol><li><p>Specimen A</p><ul><li>one</li><li>two</li></ul><p>Note: margins negative</p></li><li>Specimen B</li></ol>';
		sel().collapse(text('two'), 0);
		expect(unnestItems(root, sel())).toBe(true);
		expect(lines()).toEqual(['Specimen A', 'one', 'two', 'Note: margins negative', 'Specimen B']);
	});

	it('an item with nothing after its list is taken out as it was', () => {
		root.innerHTML = '<ul><li>gamma<ol><li>one</li><li>two</li><li>three</li></ol></li><li>delta</li></ul>';
		sel().collapse(text('two'), 0);
		expect(unnestItems(root, sel())).toBe(true);
		expect(root.innerHTML).toBe('<ul><li>gamma<ol><li>one</li></ol></li><li>two<ol><li>three</li></ol></li><li>delta</li></ul>');
	});
});

describe('estimateRtfBytes: the colors of a cell\'s borders', () => {
	it('is not below the real size for borders of one color, of four, and of a color for each cell', () => {
		for (const html of [
			'<table><tr><td style="border:1px solid red">ER</td></tr></table>',
			'<table><tr><td style="border-top:1px solid #123456;border-left:1px solid #234567;border-bottom:1px solid #345678;border-right:1px solid #456789">ER</td></tr></table>',
			`<table><tr>${Array.from({ length: 6 }, (_, i) => `<td style="border:1px solid rgb(${200 + i},${100 + i},${150 + i})">c</td>`).join('')}</tr></table>`,
			'<table><tr><th style="border-style:solid;border-width:1px 2px 3px 4px;border-color:red green">Marker</th></tr></table>',
			'<table><tr><td rowspan="0" style="border-top:2px double red;border-left:1px dashed rgb(1,2,3)">c</td></tr></table>'
		]) {
			expect(estimateRtfBytes(el(html)), html.slice(0, 60)).toBeGreaterThanOrEqual(htmlToRtf(el(html)).length);
		}
	});
});
