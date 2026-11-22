import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { sanitizeHtml } from '../sanitize.js';
import { markerGapTwips, markItems, withoutMarkers } from '../list-markers.js';

/**
 * The gap after a list's markers: how far an item's text starts from its bullet or number.
 *
 * Every list was written with its text a quarter inch after its marker (\fi-360), and a list
 * from Word hung by any other distance was not read as a list at all: its paragraphs came back
 * with the marker typed in front. The gap is now the list's own, as Word's text indent is: set
 * in the editor, drawn there as the RTF has it, written, and read back. Invented text.
 */

const R = String.raw;
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
/** The RTF after the header, without the closing brace. */
const body = (html: string) => {
	const rtf = htmlToRtf(el(html));
	return rtf.slice(rtf.indexOf('\\pard\\f0\\fs24 ') + '\\pard\\f0\\fs24 '.length, -1);
};
const read = (rtfBody: string) => rtfToHtml(`{\\rtf1\\ansi\\deff0 ${rtfBody}}`);

describe('the gap a list sets', () => {
	it('is its own padding-left, from 6 pt to two inches', () => {
		const gap = (style: string) => markerGapTwips(el(`<ul style="${style}"><li>x</li></ul>`).firstElementChild!);
		expect(gap('padding-left:36pt')).toBe(720);
		expect(gap('padding-left:24px')).toBe(360);
		expect(gap('padding-left:0.5in')).toBe(720);
		// None of its own, or one that is no gap a document has (a page's padding-left: 0).
		expect(gap('')).toBeNull();
		expect(gap('padding-left:0')).toBeNull();
		expect(gap('padding-left:3pt')).toBeNull();
		expect(gap('padding-left:3in')).toBeNull();
		expect(gap('padding-left:2em')).toBeNull();
	});
});

describe('htmlToRtf: the gap', () => {
	it('hangs each item by the gap; the marker stays a quarter inch in, where it always was', () => {
		expect(body('<ol style="padding-left:36pt"><li>one</li><li>two</li></ol>')).toBe('\\pard\\li1080\\fi-720 1.\\tab one\\par \\pard\\li1080\\fi-720 2.\\tab two\\par ');
		expect(body('<ul style="padding-left:9pt"><li>one</li></ul>')).toBe('\\pard\\li540\\fi-180\\bullet\\tab one\\par ');
		// A list with none is written as it always was.
		expect(body('<ul><li>one</li></ul>')).toBe('\\pard\\li720\\fi-360\\bullet\\tab one\\par ');
	});

	it('a list in an item hangs from the item\'s text, by its own gap', () => {
		const rtf = body('<ol style="padding-left:36pt"><li>outer<ul style="padding-left:9pt"><li>inner</li></ul></li></ol>');
		expect(rtf).toBe('\\pard\\li1080\\fi-720 1.\\tab outer\\par \\pard\\li1620\\fi-180\\bullet\\tab inner\\par ');
	});

	it('every paragraph of an item, and its spacing, go with it', () => {
		const rtf = body('<ol style="padding-left:27pt"><li style="margin-bottom:6pt"><p>first</p><p>second</p></li></ol>');
		expect(rtf).toBe('\\pard\\li900\\fi-540 1.\\tab first\\par \\pard\\li900\\sa120 second\\par ');
	});

	it('the size estimate counts it', () => {
		for (const html of [
			'<ol style="padding-left:144pt" start="9999"><li>a</li><li><p>b</p><p>c</p><br></li></ol>',
			'<ul style="padding-left:2in"><li>x<ul style="padding-left:2in"><li>y<ul style="padding-left:2in"><li>z</li></ul></li></ul></li></ul>'
		]) {
			expect(estimateRtfBytes(el(html))).toBeGreaterThanOrEqual(new TextEncoder().encode(htmlToRtf(el(html))).length);
		}
	});
});

describe('rtfToHtml: the gap', () => {
	it('reads a list hung by any gap a list can have as a list with that gap', () => {
		expect(read(R`\pard\li1080\fi-720 1.\tab one\par\pard\li1080\fi-720 2.\tab two\par`)).toBe('<ol style="padding-left:36pt"><li>one</li><li>two</li></ol>');
		expect(read(R`\pard\li540\fi-180\bullet\tab one\par`)).toBe('<ul style="padding-left:9pt"><li>one</li></ul>');
		// Word's own list, hung by 0.2 in: its bullet is 0.3 in in, a little further than the quarter inch.
		expect(read(R`\pard\li720\fi-288{\listtext\'95\tab}one\par`)).toBe('<ul style="margin-left:3.6pt;padding-left:14.4pt"><li>one</li></ul>');
		// The quarter inch is no gap of the list's own.
		expect(read(R`\pard\li720\fi-360\bullet\tab one\par`)).toBe('<ul><li>one</li></ul>');
	});

	it('a lettered item hung by another gap is a lettered item too', () => {
		expect(read(R`\pard\li1080\fi-720 A.\tab first\par\pard\li1080\fi-720 B.\tab second\par`)).toBe('<ol type="A" style="padding-left:36pt"><li>first</li><li>second</li></ol>');
	});

	it('a hang too small or too large for a list is the paragraph it is', () => {
		expect(read(R`\pard\li720\fi-60 1.\tab close\par`)).not.toContain('<ol');
		expect(read(R`\pard\li4320\fi-4320 1.\tab far\par`)).not.toContain('<ol');
	});

	it('another gap at the same place is another list', () => {
		const html = read(R`\pard\li720\fi-360\bullet\tab quarter\par\pard\li1080\fi-720\bullet\tab half\par`);
		expect(html).toBe('<ul><li>quarter</li></ul>\n<ul style="padding-left:36pt"><li>half</li></ul>');
	});

	it('goes back as it came', () => {
		for (const html of [
			'<ol start="3" style="padding-left:36pt"><li>three</li><li>four<ul style="padding-left:9pt"><li>sub</li></ul></li></ol>',
			'<ul style="margin-left:36pt;padding-left:27pt"><li>moved in</li></ul>'
		]) {
			expect(rtfToHtml(htmlToRtf(el(html)))).toBe(html);
		}
	});
});

describe('sanitizeHtml: the gap', () => {
	it('is kept', () => {
		expect(sanitizeHtml('<ol style="padding-left:36pt"><li>one</li></ol>')).toBe('<ol style="padding-left:36pt"><li>one</li></ol>');
	});

	it('the editor\'s markers are not', () => {
		expect(sanitizeHtml('<ol style="padding-left:36pt"><li data-ink-marker="1.">one</li></ol>')).toBe('<ol style="padding-left:36pt"><li>one</li></ol>');
	});
});

describe('markItems: the markers the editor draws a list with a gap by', () => {
	it('numbers as the RTF does: the start, an item\'s own value, letters and Roman numerals', () => {
		const root = el('<ol start="3" style="padding-left:36pt"><li>a</li><li value="7">b</li><li>c</li></ol><ol type="A" style="padding-left:18pt"><li>a</li><li>b</li></ol><ol type="i" start="4" style="padding-left:18pt"><li>a</li></ol>');
		markItems(root);
		expect(Array.from(root.querySelectorAll('li'), (li) => li.getAttribute('data-ink-marker'))).toEqual(['3.', '7.', '8.', 'A.', 'B.', 'iv.']);
	});

	it('bullets as the browser does, one kind for each list in a list', () => {
		const root = el('<ul style="padding-left:18pt"><li>a<ul style="padding-left:18pt"><li>b<ul style="padding-left:18pt"><li>c</li></ul></li></ul></li></ul><ul style="padding-left:18pt;list-style-type:square"><li>d</li></ul>');
		markItems(root);
		expect(Array.from(root.querySelectorAll('li'), (li) => li.getAttribute('data-ink-marker'))).toEqual(['•', '◦', '▪', '▪']);
	});

	it('marks nothing in a list with no gap, and takes the marks off a list that no longer has one', () => {
		const root = el('<ol><li>a</li></ol><ol style="padding-left:36pt"><li>b</li></ol>');
		markItems(root);
		expect(root.innerHTML).toBe('<ol><li>a</li></ol><ol style="padding-left:36pt"><li data-ink-marker="1.">b</li></ol>');
		(root.querySelectorAll('ol')[1] as HTMLElement).style.paddingLeft = '';
		markItems(root);
		expect(root.querySelector('[data-ink-marker]')).toBeNull();
		(root.querySelectorAll('ol')[1] as HTMLElement).style.paddingLeft = '36pt';
		markItems(root);
		withoutMarkers(root);
		expect(root.querySelector('[data-ink-marker]')).toBeNull();
	});
});

// ── In the editor ──

const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

type Editor = {
	getRTF(): string;
	getHTML(): string;
	setHTML(html: string): void;
	setListMarkerGap(points: number | null): void;
};

let host: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
});

function open(content: string, props: Record<string, unknown> = {}): { editor: HTMLElement; api: Editor; list: HTMLSelectElement } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false, ...props } }) as Record<string, unknown>;
	flushSync();
	return {
		editor: host.querySelector('.ink-content') as HTMLElement,
		api: component as unknown as Editor,
		list: host.querySelector('select[title="Line and paragraph spacing"]') as HTMLSelectElement
	};
}

function textOf(editor: HTMLElement, text: string): Text {
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data === text) return n as Text;
	throw new Error(`no text ${JSON.stringify(text)}`);
}

function caret(editor: HTMLElement, from: string, to: string = from): void {
	const start = textOf(editor, from);
	const end = textOf(editor, to);
	window.getSelection()!.setBaseAndExtent(start, 1, end, from === to ? 1 : 2);
	editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
	flushSync();
}

function choose(list: HTMLSelectElement, value: string): void {
	list.value = value;
	list.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

const marked = (list: HTMLSelectElement) =>
	Array.from(list.options)
		.filter((option) => option.textContent!.startsWith('✓'))
		.map((option) => option.value);

const gapChoices = (list: HTMLSelectElement) => Array.from(list.querySelectorAll('optgroup[label="Bullet or number gap"] option'), (option) => option.getAttribute('value'));

const undo = (editor: HTMLElement) => {
	const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
	editor.dispatchEvent(e);
	flushSync();
	return e.defaultPrevented;
};

/** What the editor's MutationObserver does after a change: its markers. */
const settled = () => new Promise<void>((done) => setTimeout(done, 0));

describe('the spacing list: the gap after the markers', () => {
	it('is offered in a list, marked as the list has it, and not out of one', () => {
		const { editor, list } = open('<p>Diagnosis</p><ol><li>Carcinoma</li></ol><ul style="padding-left:27pt"><li>Margins free</li></ul>');
		caret(editor, 'Diagnosis');
		expect(gapChoices(list)).toEqual([]);
		caret(editor, 'Carcinoma');
		expect(gapChoices(list)).toEqual(['markerGap:9', 'markerGap:18', 'markerGap:27', 'markerGap:36', 'markerGap:none']);
		expect(marked(list)).toContain('markerGap:none');
		caret(editor, 'Margins free');
		expect(marked(list)).toContain('markerGap:27');
	});

	it('sets the gap of the list the caret is in, draws its markers, and writes it', async () => {
		const { editor, api, list } = open('<ol start="3"><li>Carcinoma</li><li value="7">Margins free</li></ol>');
		caret(editor, 'Carcinoma');
		choose(list, 'markerGap:36');
		expect(editor.innerHTML).toBe('<ol start="3" style="padding-left: 36pt;"><li data-ink-marker="3.">Carcinoma</li><li value="7" data-ink-marker="7.">Margins free</li></ol>');
		expect(marked(list)).toContain('markerGap:36');
		// The markers are the screen's, not the document's.
		expect(api.getHTML()).toBe('<ol start="3" style="padding-left: 36pt;"><li>Carcinoma</li><li value="7">Margins free</li></ol>');
		expect(api.getRTF()).toContain('\\pard\\li1080\\fi-720 3.\\tab Carcinoma\\par \\pard\\li1080\\fi-720 7.\\tab Margins free\\par ');
		// An item put in is numbered as the rest.
		editor.querySelector('ol')!.insertAdjacentHTML('beforeend', '<li>Added</li>');
		await settled();
		expect(editor.querySelectorAll('li')[2].getAttribute('data-ink-marker')).toBe('8.');
	});

	it('Default takes the gap off, and with it the markers the editor drew', () => {
		const { editor, list } = open('<ul style="padding-left:27pt"><li>Margins free</li></ul>');
		caret(editor, 'Margins free');
		choose(list, 'markerGap:none');
		expect(editor.innerHTML).toBe('<ul><li>Margins free</li></ul>');
	});

	it('sets the gap of each list the selection touches, the innermost for an item in a list in a list', () => {
		const { editor, list } = open('<ol><li>outer<ul><li>inner</li></ul></li></ol><ul><li>other</li></ul>');
		caret(editor, 'inner');
		choose(list, 'markerGap:9');
		expect(editor.querySelector('ol')!.getAttribute('style')).toBeNull();
		expect(editor.querySelector('ol ul')!.getAttribute('style')).toBe('padding-left: 9pt;');
		caret(editor, 'outer', 'other');
		choose(list, 'markerGap:27');
		// (The selection runs through the inner list too.)
		expect(Array.from(editor.querySelectorAll('ol, ul'), (l) => l.getAttribute('style'))).toEqual(['padding-left: 27pt;', 'padding-left: 27pt;', 'padding-left: 27pt;']);
	});

	it('each change is undone by Ctrl+Z, markers and all', () => {
		const { editor, list } = open('<ol><li>one</li><li>two</li></ol>');
		caret(editor, 'one');
		choose(list, 'markerGap:36');
		choose(list, 'markerGap:9');
		expect(undo(editor)).toBe(true);
		expect(editor.querySelector('ol')!.getAttribute('style')).toBe('padding-left: 36pt;');
		expect(undo(editor)).toBe(true);
		expect(editor.innerHTML).toBe('<ol><li>one</li><li>two</li></ol>');
	});

	it('a document read with a gap is drawn with its markers from the start, and given back without them', async () => {
		const { editor, api } = open('<p>x</p>');
		api.setHTML(read(R`\pard\li1080\fi-720 1.\tab one\par`));
		await settled();
		expect(editor.querySelector('li')!.getAttribute('data-ink-marker')).toBe('1.');
		expect(api.getHTML()).toBe('<ol style="padding-left:36pt"><li>one</li></ol>');
	});
});

describe('setListMarkerGap', () => {
	it('does what the list does, for an application\'s own toolbar, with any gap from 6 pt to two inches', () => {
		const { editor, api } = open('<ul><li>one</li></ul>');
		caret(editor, 'one');
		api.setListMarkerGap(22.5);
		expect(editor.querySelector('ul')!.getAttribute('style')).toBe('padding-left: 22.5pt;');
		for (const wrong of [0, 5, 145, NaN, -10, '18' as unknown as number]) api.setListMarkerGap(wrong);
		expect(editor.querySelector('ul')!.getAttribute('style')).toBe('padding-left: 22.5pt;');
		api.setListMarkerGap(null);
		expect(editor.querySelector('ul')!.hasAttribute('style')).toBe(false);
	});

	it('does nothing out of a list, or in a document that cannot be edited', () => {
		const { editor, api } = open('<p>plain</p>');
		caret(editor, 'plain');
		api.setListMarkerGap(36);
		expect(editor.innerHTML).toBe('<p>plain</p>');
		unmount(component!);
		host!.remove();
		const fixed = open('<ul><li>fixed</li></ul>', { readonly: true });
		caret(fixed.editor, 'fixed');
		fixed.api.setListMarkerGap(36);
		expect(fixed.editor.querySelector('ul')!.hasAttribute('style')).toBe(false);
		component = null;
	});
});
