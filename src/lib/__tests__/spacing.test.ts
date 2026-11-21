import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { sanitizeHtml } from '../sanitize.js';

/**
 * The space before and after a paragraph, and between its lines.
 *
 * A report had one way to set two things apart: an empty line. 6 pt after a paragraph was
 * written to the RTF where the HTML had it, and there was no way to set it in the editor, and it
 * was gone when the RTF was read again. The lines of a paragraph were as far apart as the
 * reader's own. Both are now set from the toolbar, written, and read back. Invented text.
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
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('htmlToRtf: spacing', () => {
	it('the space before and after a paragraph is \\sb and \\sa, in twips', () => {
		expect(body('<p style="margin-top:6pt;margin-bottom:6pt">Spaced</p>')).toBe(R`\pard\sb120\sa120 Spaced\par `);
		expect(body('<p style="margin-bottom:12pt">After</p><p>Next</p>')).toBe(R`\pard\sa240 After\par \pard Next\par `);
		// None, and one that cannot be read, write nothing.
		expect(body('<p style="margin-top:0pt;margin-bottom:1em">Plain</p>')).toBe(R`\pard Plain\par `);
	});

	it('the lines of a paragraph are \\sl, counted in lines where the style counts in lines', () => {
		expect(body('<p style="line-height:1.5">One and a half</p>')).toBe(R`\pard\sl360\slmult1 One and a half\par `);
		expect(body('<p style="line-height:2">Double</p>')).toBe(R`\pard\sl480\slmult1 Double\par `);
		expect(body('<p style="line-height:115%">Word\'s own</p>')).toBe(R`\pard\sl276\slmult1 Word's own\par `);
		// Single is written too: it is what was chosen, and the screen's own lines are further apart.
		expect(body('<p style="line-height:1">Single</p>')).toBe(R`\pard\sl240\slmult1 Single\par `);
		// A height is exactly that height.
		expect(body('<p style="line-height:14pt">Exactly</p>')).toBe(R`\pard\sl-280\slmult0 Exactly\par `);
	});

	it('what is no spacing writes none', () => {
		for (const line of ['normal', '0', '-1', '11', '1100%', '2em', 'inherit']) {
			expect(body(`<p style="line-height:${line}">x</p>`), line).toBe(R`\pard x\par `);
		}
	});

	it('with the paragraph\'s other formatting, and ended by the next paragraph', () => {
		expect(body('<p style="text-align:center;margin-left:0.5in;margin-top:6pt;line-height:1.5">a</p><p>b</p>')).toBe(R`\pard\qc\li720\sb120\sl360\slmult1 a\par \pard b\par `);
		// A blank line after a spaced paragraph starts over, or it would be spaced too.
		expect(body('<p style="margin-bottom:6pt">a</p><p><br></p><p>b</p>')).toBe(R`\pard\sa120 a\par \pard \par \pard b\par `);
	});

	it('a heading has its spacing too', () => {
		expect(body('<h2 style="margin-top:12pt;margin-bottom:6pt">Diagnosis</h2>')).toBe(R`\pard\sb240\sa120\f0\fs36\b Diagnosis\b0\fs24\par `);
	});

	it('a picture has the space before it, and the space after it after its caption', () => {
		const spaced = body(`<figure style="margin-top:6pt;margin-bottom:12pt"><img src="${PNG}"><figcaption>Fig. 1</figcaption></figure>`);
		expect(spaced).toMatch(/^\\pard\\ql\\sb120 \{\\pict[^}]*\}\\par \{\\\*\\inkcap\}\\pard\\ql\\sa240\\i Fig\. 1\\i0\\par $/);
		// With no caption, both are the picture's.
		expect(body(`<figure style="margin-top:6pt;margin-bottom:12pt"><img src="${PNG}"><figcaption></figcaption></figure>`)).toMatch(/^\\pard\\ql\\sb120\\sa240 \{\\pict/);
	});

	it('in a table cell too, on a paragraph of its own after the one the cell declares', () => {
		const rtf = body('<table><tr><td><p style="margin-bottom:6pt;line-height:2">In a cell</p></td></tr></table>');
		expect(rtf).toContain('{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 \\pard\\intbl\\sa120\\sl480\\slmult1 In a cell\\cell}');
	});

	it('on a list item: the space before on its first paragraph, the space after on its last, its lines on each', () => {
		expect(body('<ul><li style="margin-bottom:12pt;line-height:1.5">one</li></ul>')).toBe('\\pard\\li720\\sl360\\slmult1\\sa240\\fi-360\\bullet\\tab one\\par ');
		expect(body('<ol><li style="margin-top:6pt;margin-bottom:6pt;line-height:2"><p>first</p><p>second</p></li></ol>')).toBe(
			'\\pard\\li720\\sb120\\sl480\\slmult1\\fi-360 1.\\tab first\\par \\pard\\li720\\sl480\\slmult1\\sa120 second\\par '
		);
		// (An item without spacing is written as it always was.)
		expect(body('<ul><li>plain</li></ul>')).toBe('\\pard\\li720\\fi-360\\bullet\\tab plain\\par ');
	});

	it('the size estimate counts it', () => {
		for (const html of [
			'<p style="margin-top:6pt;margin-bottom:6pt;line-height:1.15">Spaced</p><p><br></p>',
			'<h2 style="margin-top:12pt;margin-bottom:6pt;line-height:1.5">Diagnosis</h2>',
			`<figure style="margin-top:6pt;margin-bottom:12pt"><img src="${PNG}"><figcaption>Fig. 1</figcaption></figure>`
		]) {
			expect(estimateRtfBytes(el(html)), html.slice(0, 40)).toBeGreaterThanOrEqual(htmlToRtf(el(html)).length);
		}
	});
});

describe('rtfToHtml: spacing', () => {
	it('is read back as the writer sent it', () => {
		for (const html of [
			'<p style="margin-top:6pt;margin-bottom:6pt">Spaced</p>',
			'<p style="line-height:1.5">One and a half</p>',
			'<p style="line-height:1.15">Word\'s own</p>',
			'<p style="line-height:1">Single</p>',
			'<p style="line-height:14pt">Exactly</p>',
			'<p style="text-align:center;margin-left:36pt;margin-top:6pt;margin-bottom:12pt;line-height:2">All of it</p>',
			'<h2 style="margin-top:12pt;margin-bottom:6pt">Diagnosis</h2>'
		]) {
			expect(rtfToHtml(htmlToRtf(el(html))), html).toBe(html);
		}
	});

	it('holds from one paragraph to the next until \\pard, as the indents do', () => {
		expect(read(R`\pard\sa120\sl360\slmult1 one\par two\par\pard three\par`)).toBe(
			'<p style="margin-bottom:6pt;line-height:1.5">one</p>\n<p style="margin-bottom:6pt;line-height:1.5">two</p>\n<p>three</p>'
		);
		// And ends with the group it was set in.
		expect(read(R`{\pard\sb240 one\par}\pard two\par`)).toBe('<p style="margin-top:12pt">one</p>\n<p>two</p>');
	});

	it('lines that are at least a height are left to the screen: CSS has no such thing', () => {
		expect(read(R`\pard\sl360 at least\par`)).toBe('<p>at least</p>');
		expect(read(R`\pard\sl360\slmult0 at least\par`)).toBe('<p>at least</p>');
		expect(read(R`\pard\sl-360 exactly\par`)).toBe('<p style="line-height:18pt">exactly</p>');
		expect(read(R`\pard\sl0\slmult1 auto\par`)).toBe('<p>auto</p>');
	});

	it('a value no page has is not passed on', () => {
		expect(read(R`\pard\sb99999999\sa-200 far\par`)).toBe('<p style="margin-top:792pt">far</p>');
		expect(read(R`\pard\sl99999\slmult1 far\par`)).toBe('<p>far</p>');
		expect(read(R`\pard\sl-99999999 far\par`)).toBe('<p>far</p>');
	});

	it('a picture is read with the space before it, and the space after its caption', () => {
		const html = `<figure style="margin-top:6pt;margin-bottom:12pt"><img src="${PNG}" style="width:1px;height:auto" alt=""><figcaption>Fig. 1</figcaption></figure>`;
		const back = rtfToHtml(htmlToRtf(el(html)));
		expect(back).toMatch(/^<figure style="margin-top:6pt;margin-bottom:12pt"><img [^>]*><figcaption>Fig\. 1<\/figcaption><\/figure>$/);
		// With no caption, both are on the picture's own paragraph.
		const bare = rtfToHtml(htmlToRtf(el(`<figure style="margin-top:6pt;margin-bottom:12pt"><img src="${PNG}"></figure>`)));
		expect(bare).toMatch(/^<figure style="margin-top:6pt;margin-bottom:12pt"><img /);
	});

	it('in a table cell: each paragraph of a cell where one is spaced, as Word writes them', () => {
		const html = read(R`{\trowd\cellx3000\cellx6000\pard\intbl\sa160\sl259\slmult1 one\par\pard\intbl two\cell\pard\intbl three\par four\cell\row}\pard after\par`);
		expect(html).toContain('<p style="margin-bottom:8pt;line-height:1.08">one</p><p>two</p></td>');
		// A cell none of whose paragraphs is spaced is read as it always was: lines.
		expect(html).toContain('>three<br>four</td>');
	});

	it('on a list item, as the <li>\'s style', () => {
		const html = read(R`\pard\fi-360\li720\sa240\sl360\slmult1{\listtext\'95\tab}one\par\pard\fi-360\li720{\listtext\'95\tab}two\par`);
		expect(html).toBe('<ul><li style="margin-bottom:12pt;line-height:1.5">one</li><li>two</li></ul>');
	});

	it('a list item and a table cell go back as they came', () => {
		const html = '<ul><li style="margin-top:6pt;margin-bottom:12pt;line-height:1.5">item</li></ul><table><tr><td><p style="margin-bottom:6pt;line-height:2">spaced</p><p>plain</p></td></tr></table>';
		const back = rtfToHtml(htmlToRtf(el(html)));
		expect(back).toContain('<li style="margin-top:6pt;margin-bottom:12pt;line-height:1.5">item</li>');
		expect(back).toContain('<p style="margin-bottom:6pt;line-height:2">spaced</p><p>plain</p></td>');
		expect(estimateRtfBytes(el(html))).toBeGreaterThanOrEqual(new TextEncoder().encode(htmlToRtf(el(html))).length);
	});

	it('what is read is let through when it is made safe', () => {
		const html = '<p style="margin-top:6pt;margin-bottom:6pt;line-height:1.5">Spaced</p>';
		expect(sanitizeHtml(html)).toBe(html);
	});
});

// ── In the editor ──

const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

type Editor = {
	getRTF(): string;
	getHTML(): string;
	setLineSpacing(lines: number | null): void;
	setParagraphSpacing(space: { before?: number | null; after?: number | null }): void;
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

/** Put the caret in a piece of text, or select from one piece to another, and tell the editor. */
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

/** The choices of the list that are marked as the paragraph's own. */
const marked = (list: HTMLSelectElement) =>
	Array.from(list.options)
		.filter((option) => option.textContent!.startsWith('✓'))
		.map((option) => option.value);

const undo = (editor: HTMLElement) => {
	const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
	editor.dispatchEvent(e);
	flushSync();
	return e.defaultPrevented;
};

describe('the spacing list of the toolbar', () => {
	it('sets the space after the paragraph the caret is in, as the style the writer sends', () => {
		const { editor, api, list } = open('<p>Final diagnosis</p><p>Invasive carcinoma</p>');
		caret(editor, 'Final diagnosis');
		choose(list, 'spaceAfter:6');
		expect(editor.innerHTML).toBe('<p style="margin-bottom: 6pt;">Final diagnosis</p><p>Invasive carcinoma</p>');
		expect(api.getRTF()).toContain(R`\pard\sa120 Final diagnosis\par \pard Invasive carcinoma\par`);
		// The list shows its name again, to be chosen from again.
		expect(list.value).toBe('');
		choose(list, 'spaceBefore:12');
		expect(api.getRTF()).toContain(R`\pard\sb240\sa120 Final diagnosis\par`);
	});

	it('sets the lines of every paragraph the selection touches', () => {
		const { editor, api, list } = open('<p>one</p><p>two</p><p>three</p>');
		caret(editor, 'one', 'two');
		choose(list, 'lineSpacing:1.5');
		expect(editor.innerHTML).toBe('<p style="line-height: 1.5;">one</p><p style="line-height: 1.5;">two</p><p>three</p>');
		expect(api.getRTF()).toContain(R`\pard\sl360\slmult1 one\par \pard\sl360\slmult1 two\par \pard three\par`);
	});

	it('marks what the paragraph at the caret has', () => {
		const { editor, list } = open('<p style="line-height:1.15;margin-bottom:6pt">set</p><p>plain</p>');
		caret(editor, 'set');
		expect(marked(list)).toEqual(['lineSpacing:1.15', 'spaceBefore:0', 'spaceAfter:6']);
		caret(editor, 'plain');
		expect(marked(list)).toEqual(['lineSpacing:none', 'spaceBefore:0', 'spaceAfter:0']);
	});

	it('offers a setting from elsewhere that is not one of its own, so that it shows what the paragraph has', () => {
		const { editor, list } = open('<p style="line-height:1.38;margin-top:8pt">from elsewhere</p><p>plain</p>');
		caret(editor, 'from elsewhere');
		expect(marked(list)).toEqual(['lineSpacing:1.38', 'spaceBefore:8', 'spaceAfter:0']);
		caret(editor, 'plain');
		expect(Array.from(list.options).map((option) => option.value)).not.toContain('lineSpacing:1.38');
	});

	it('takes a setting off again: no space, and the editor\'s own lines', () => {
		const { editor, list } = open('<p style="line-height:2;margin-bottom:12pt">set</p>');
		caret(editor, 'set');
		choose(list, 'spaceAfter:0');
		choose(list, 'lineSpacing:none');
		expect(editor.innerHTML).toBe('<p>set</p>');
	});

	it('each change is undone by Ctrl+Z, the last first', () => {
		const { editor, list } = open('<p>one</p><p>two</p>');
		caret(editor, 'one', 'two');
		choose(list, 'lineSpacing:2');
		choose(list, 'spaceAfter:6');
		expect(editor.querySelectorAll('p[style*="margin-bottom"]')).toHaveLength(2);
		expect(undo(editor)).toBe(true);
		expect(editor.innerHTML).toBe('<p style="line-height: 2;">one</p><p style="line-height: 2;">two</p>');
		expect(undo(editor)).toBe(true);
		expect(editor.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('gives a line of loose text a paragraph of its own to carry it', () => {
		const { editor, list } = open('loose line<br>second line');
		caret(editor, 'loose line');
		choose(list, 'spaceAfter:6');
		expect(editor.innerHTML).toBe('<p style="margin-bottom: 6pt;">loose line</p>second line');
		expect(undo(editor)).toBe(true);
		expect(editor.innerHTML).toBe('loose line<br>second line');
	});

	it('spaces a heading, a list item and a paragraph in a table cell, and shows what each has', () => {
		const { editor, list } = open('<h2>Diagnosis</h2><ul><li>item</li><li>other</li></ul><table><tbody><tr><td><p>cell</p></td><td>loose</td></tr></tbody></table>');
		caret(editor, 'Diagnosis');
		choose(list, 'spaceAfter:6');
		expect(editor.querySelector('h2')!.getAttribute('style')).toBe('margin-bottom: 6pt;');
		for (const words of ['item', 'cell', 'loose']) {
			caret(editor, words);
			choose(list, 'spaceAfter:6');
			choose(list, 'lineSpacing:2');
			caret(editor, words);
			expect(marked(list)).toEqual(['lineSpacing:2', 'spaceBefore:0', 'spaceAfter:6']);
		}
		expect(editor.querySelector('ul')!.outerHTML).toBe('<ul><li style="margin-bottom: 6pt; line-height: 2;">item</li><li>other</li></ul>');
		// (A line typed straight into a cell is made a paragraph to carry it.)
		expect(Array.from(editor.querySelectorAll('td')).map((cell) => cell.innerHTML)).toEqual([
			'<p style="margin-bottom: 6pt; line-height: 2;">cell</p>',
			'<p style="margin-bottom: 6pt; line-height: 2;">loose</p>'
		]);
	});

	it('spaces the item the caret is in, not the list around it, in a list within a list too', () => {
		const { editor, list } = open('<ol><li><p>outer</p><ul><li>inner</li></ul></li></ol>');
		caret(editor, 'inner');
		choose(list, 'spaceBefore:12');
		expect(editor.innerHTML).toBe('<ol><li><p>outer</p><ul><li style="margin-top: 12pt;">inner</li></ul></li></ol>');
		caret(editor, 'outer');
		choose(list, 'lineSpacing:1.5');
		expect(editor.innerHTML).toBe('<ol><li style="line-height: 1.5;"><p>outer</p><ul><li style="margin-top: 12pt;">inner</li></ul></li></ol>');
	});

	it('is not there to change a document that cannot be edited', () => {
		const { editor, api } = open('<p>fixed</p>', { readonly: true });
		caret(editor, 'fixed');
		api.setLineSpacing(2);
		api.setParagraphSpacing({ after: 6 });
		expect(editor.innerHTML).toBe('<p>fixed</p>');
	});
});

describe('setLineSpacing and setParagraphSpacing', () => {
	it('do what the list does, for an application\'s own toolbar', () => {
		const { editor, api } = open('<p>one</p><p>two</p>');
		caret(editor, 'one');
		api.setLineSpacing(1.15);
		api.setParagraphSpacing({ before: 3, after: 6 });
		expect(editor.innerHTML).toBe('<p style="line-height: 1.15; margin-top: 3pt; margin-bottom: 6pt;">one</p><p>two</p>');
		// A side that is left out stays; null and 0 take one off.
		api.setParagraphSpacing({ before: null });
		expect(editor.querySelector('p')!.getAttribute('style')).toBe('line-height: 1.15; margin-bottom: 6pt;');
		api.setParagraphSpacing({ after: 0 });
		api.setLineSpacing(null);
		expect(editor.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('take no value that is not a spacing', () => {
		const { editor, api } = open('<p>one</p>');
		caret(editor, 'one');
		for (const lines of [0, -1, 11, NaN, Infinity, '2' as unknown as number]) api.setLineSpacing(lines);
		for (const points of [-6, 145, NaN, '6' as unknown as number]) api.setParagraphSpacing({ after: points, before: points });
		api.setParagraphSpacing(null as unknown as { after: number });
		expect(editor.innerHTML).toBe('<p>one</p>');
	});
});
