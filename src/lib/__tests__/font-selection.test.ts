// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import RtfViewer from '../RtfViewer.svelte';
import { htmlToRtf, estimateRtfBytes, fontChoices, DEFAULT_FONT_FAMILY } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { sanitizeHtml } from '../sanitize.js';

/**
 * Fonts for text: the fonts an application offers (`fonts`), what the sanitizer lets in, what
 * the RTF carries and what is read back. The editor's own part is the browser's font command,
 * which the test DOM does not have: what Chromium, Firefox and WebKit make of it is in
 * e2e/editor.spec.ts. Invented text.
 */

const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const FONTS = ['Georgia', 'Calibri, Carlito, sans-serif', 'Times New Roman', 'Arial'];
/** The font table of an RTF document, and its body after the first paragraph's font and size. */
const table = (rtf: string) => rtf.slice(rtf.indexOf('{\\fonttbl'), rtf.indexOf('{\\colortbl'));
const body = (rtf: string) => rtf.slice(rtf.indexOf('\\fs24 ') + 6, -1);
const DOCUMENT_FONTS = `{\\fonttbl{\\f0\\fswiss\\fcharset0 ${DEFAULT_FONT_FAMILY};}{\\f1\\fmodern\\fcharset0 Courier New;}`;

describe('fontChoices: the fonts an application offers', () => {
	it('a name is given the generic family that suits it, and a list is taken as it is', () => {
		expect(fontChoices(['Georgia', 'Calibri, Carlito, sans-serif', 'Consolas'])).toEqual([
			{ name: 'Georgia', css: 'Georgia, serif', key: 'georgia' },
			{ name: 'Calibri', css: 'Calibri, Carlito, sans-serif', key: 'calibri' },
			{ name: 'Consolas', css: 'Consolas, monospace', key: 'consolas' }
		]);
	});

	it('a name that CSS could read as something else is quoted', () => {
		expect(fontChoices(['Source Sans 3', "'Segoe UI'", 'Inherit Sans']).map((font) => font.css)).toEqual([
			'"Source Sans 3", sans-serif',
			'Segoe UI, sans-serif',
			'"Inherit Sans", sans-serif'
		]);
	});

	it('leaves out what is no font name, a generic family by itself, and a name given twice', () => {
		const given = ['Arial', 'arial', 'serif', '', '  ', 'Bad;Name', 'x{y}', 'a<b', 'url(x)', 'Fine, Bad\\Name', null, 7];
		expect(fontChoices(given).map((font) => font.name)).toEqual(['Arial']);
		expect(fontChoices(undefined)).toEqual([]);
		// (One name where a list is meant is that one name, not its letters.)
		expect(fontChoices('Georgia').map((font) => font.name)).toEqual(['Georgia']);
	});
});

describe('htmlToRtf: text in a font of its own', () => {
	it('writes no font but the document font where none is offered, as before', () => {
		const rtf = htmlToRtf(el('<p>a <font face="Georgia">b</font> <span style="font-family: Arial">c</span></p>'));
		expect(table(rtf)).toBe(`${DOCUMENT_FONTS}}`);
		expect(body(rtf)).toBe('\\pard a b c\\par ');
	});

	it('writes an offered font in the font table when the document has text in it, and around that text', () => {
		const rtf = htmlToRtf(el('<p>a <font face="Georgia, serif">b</font> <span style="font-family: arial">c</span></p>'), { fonts: FONTS });
		expect(table(rtf)).toBe(`${DOCUMENT_FONTS}{\\f2\\froman\\fcharset0 Georgia;}{\\f3\\fswiss\\fcharset0 Arial;}}`);
		expect(body(rtf)).toBe('\\pard a \\f2 b\\f0  \\f3 c\\f0 \\par ');
	});

	it('does not write a font that is not offered', () => {
		const rtf = htmlToRtf(el('<p>a <font face="Papyrus">b</font></p>'), { fonts: FONTS });
		expect(table(rtf)).toBe(`${DOCUMENT_FONTS}}`);
		expect(body(rtf)).toBe('\\pard a b\\par ');
	});

	it('goes back to the font around, not to the document font', () => {
		const rtf = htmlToRtf(el('<p><font face="Georgia">a <font face="Arial">b</font> c</font></p>'), { fonts: FONTS });
		expect(body(rtf)).toBe('\\pard \\f2 a \\f3 b\\f2  c\\f0 \\par ');
	});

	it('text set back to the document font inside another font is in the document font', () => {
		const html = `<p><font face="Georgia">a <font face="&quot;${DEFAULT_FONT_FAMILY}&quot;, sans-serif">b</font> c</font></p>`;
		expect(body(htmlToRtf(el(html), { fonts: FONTS }))).toBe('\\pard \\f2 a \\f0 b\\f2  c\\f0 \\par ');
	});

	it('a paragraph, a heading and a table cell carry a font too', () => {
		const rtf = htmlToRtf(el('<p style="font-family: Georgia">a</p><h2 style="font-family: Arial">b</h2>'), { fonts: FONTS });
		expect(body(rtf)).toContain('\\pard \\f2 a\\f0 \\par ');
		expect(body(rtf)).toMatch(/\\f0\\fs36\\b \\f3 b\\f0 /);
	});

	it('code is in the code font whatever font is around it or in it, and the font around comes back after it', () => {
		const rtf = htmlToRtf(el('<p><font face="Georgia">a <code>b <font face="Arial">c</font></code> d</font></p>'), { fonts: FONTS });
		expect(body(rtf)).toBe('\\pard \\f2 a \\f1 b c\\f2  d\\f0 \\par ');
	});

	it('the estimate of the size is not under the size', () => {
		const html = '<p>a <font face="Georgia">b</font> <span style="font-family: Calibri">c</span> <code>d</code></p><h1><font face="Arial">e</font></h1>';
		const rtf = htmlToRtf(el(html), { fonts: FONTS });
		const estimate = estimateRtfBytes(el(html), { fonts: FONTS });
		expect(estimate).toBeGreaterThanOrEqual(rtf.length);
		expect(estimate - rtf.length).toBeLessThan(200);
	});
});

describe('rtfToHtml: text in a font of its own', () => {
	it('reads back the font the writer wrote, as the application wrote that font', () => {
		const rtf = htmlToRtf(el('<p>a <font face="Georgia">b</font> <font face="Calibri">c</font></p>'), { fonts: FONTS });
		expect(rtfToHtml(rtf, { fonts: FONTS })).toBe(
			'<p>a <span style="font-family:Georgia, serif">b</span> <span style="font-family:Calibri, Carlito, sans-serif">c</span></p>'
		);
	});

	it('gives no font where none is offered, as before, and none that is not offered', () => {
		const rtf = htmlToRtf(el('<p>a <font face="Georgia">b</font></p>'), { fonts: FONTS });
		expect(rtfToHtml(rtf)).toBe('<p>a b</p>');
		expect(rtfToHtml(rtf, { fonts: ['Arial'] })).toBe('<p>a b</p>');
	});

	it('text in the font the screen shows the document in carries none', () => {
		const rtf = htmlToRtf(el('<p>a <font face="Georgia">b</font></p>'), { fonts: FONTS, fontFamily: 'Arial' });
		// Written with Arial as the document font, and read for a screen in Georgia.
		expect(rtfToHtml(rtf, { fonts: FONTS, fontFamily: 'Georgia' })).toBe('<p><span style="font-family:Arial, sans-serif">a </span>b</p>');
		expect(rtfToHtml(rtf, { fonts: FONTS, fontFamily: 'Arial' })).toBe('<p>a <span style="font-family:Georgia, serif">b</span></p>');
	});

	it('reads the fonts of a file from TextEdit, which names each cut of a font', () => {
		// Written by macOS textutil (cocoartf2870) from a paragraph in Helvetica with words in
		// Georgia, bold Times New Roman, italic Arial and Courier New.
		const rtf =
			'{\\rtf1\\ansi\\ansicpg1252\\cocoartf2870\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;\\f1\\fnil\\fcharset0 Georgia;\\f2\\froman\\fcharset0 TimesNewRomanPS-BoldMT;\n' +
			'\\f3\\fswiss\\fcharset0 Arial-ItalicMT;\\f4\\fmodern\\fcharset0 CourierNewPSMT;}\n{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}\n' +
			'{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;}\n\\deftab720\n\\pard\\pardeftab720\\sa320\\partightenfactor0\n\n\\f0\\fs24 \\cf0 \\expnd0\\expndtw0\\kerning0\n' +
			'\\outl0\\strokewidth0 \\strokec2 Plain \n\\f1 georgia\n\\f0  \n\\f2\\b times bold\n\\f0\\b0  \n\\f3\\i arial italic\n\\f0\\i0  \n\\f4 courier\n\\f0  end\\\n}';
		const html = rtfToHtml(rtf, { fonts: FONTS });
		expect(html).toContain('Plain <span style="font-family:Georgia, serif">georgia</span>');
		expect(html).toContain('<strong><span style="font-family:Times New Roman, serif">times bold</span></strong>');
		expect(html).toContain('<em><span style="font-family:Arial, sans-serif">arial italic</span></em>');
		// Helvetica is not offered; text in a monospace font is code, as it always was.
		expect(html).toContain('<code>courier</code>');
		expect(html).not.toMatch(/Helvetica/i);
	});

	it('reads a font table as Word writes it, with what stands beside the name', () => {
		const rtf =
			'{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fbidi \\froman\\fcharset0\\fprq2{\\*\\panose 02020603050405020304}Times New Roman;}' +
			'{\\f37\\fbidi \\fswiss\\fcharset0\\fprq2{\\*\\panose 020f0502020204030204}Calibri{\\*\\falt Arial};}}' +
			'\\pard\\f0\\fs24 times \\f37 calibri\\f0  end\\par }';
		expect(rtfToHtml(rtf, { fonts: FONTS })).toBe(
			'<p><span style="font-family:Times New Roman, serif">times </span><span style="font-family:Calibri, Carlito, sans-serif">calibri</span><span style="font-family:Times New Roman, serif"> end</span></p>'
		);
	});
});

describe('sanitizeHtml: the fonts that may come in', () => {
	it('leaves fonts as they come where no list is given, as before', () => {
		const html = '<p style="font-family: Papyrus;">a <font face="Comic Sans MS">b</font></p>';
		expect(sanitizeHtml(html)).toBe(html);
		expect(sanitizeHtml(html, { keepClasses: ['x'] })).toBe(html);
	});

	it('takes every font off where the list given is empty, but for the document font', () => {
		const html = `<p style="font-family: Papyrus; text-align: center;">a <font face="Georgia" color="#ff0000">b</font> <span style="font: italic 12pt Arial;">c</span> <font face="${DEFAULT_FONT_FAMILY}">d</font></p>`;
		const safe = sanitizeHtml(html, { fonts: [] });
		expect(safe).toContain('<p style="text-align: center;">a <font color="#ff0000">b</font>');
		expect(safe).toContain(`<font face="&quot;${DEFAULT_FONT_FAMILY}&quot;, sans-serif">d</font>`);
		expect(safe).not.toMatch(/Papyrus|Georgia|Arial/);
		// What else the shorthand said of the text stays.
		expect(safe).toMatch(/<span style="[^"]*font-style: italic[^"]*">c<\/span>/);
	});

	it('keeps an offered font, written as the application wrote it, and takes any other off', () => {
		const html =
			'<p style="font-family: Papyrus; text-align: center;">a <font face="CALIBRI" color="#ff0000">b</font> <span style="font-family: \'georgia\'; color: red;">c</span> <font face="Comic Sans MS">d</font></p>';
		expect(sanitizeHtml(html, { fonts: FONTS })).toBe(
			'<p style="text-align: center;">a <font face="Calibri, Carlito, sans-serif" color="#ff0000">b</font> <span style="font-family: Georgia, serif; color: red;">c</span> <font>d</font></p>'
		);
	});

	it('the document font may always be named, and what is kept is not changed a second time', () => {
		const html = `<p>a <font face="'${DEFAULT_FONT_FAMILY}', sans-serif">b</font> <font face="Georgia, serif">c</font> <span style="font-family: Georgia, serif;">d</span></p>`;
		const once = sanitizeHtml(html, { fonts: FONTS });
		// (Named with other quotes than the editor uses: the same font, and left as it is.)
		expect(once).toContain(`<font face="'${DEFAULT_FONT_FAMILY}', sans-serif">b</font>`);
		expect(once).toContain('<font face="Georgia, serif">c</font>');
		expect(sanitizeHtml(once, { fonts: FONTS })).toBe(once);
		// Another document font is another font that may be named.
		expect(sanitizeHtml('<p><font face="Verdana">a</font></p>', { fonts: FONTS, fontFamily: 'Verdana' })).toContain('face="&quot;Verdana&quot;, sans-serif"');
	});
});

describe('InkEditor: the font list', () => {
	type Editing = { queryCommandState?: () => boolean; queryCommandValue?: () => string; execCommand?: (cmd: string, ui?: boolean, value?: string) => boolean };
	const doc = document as unknown as Editing;
	doc.queryCommandState ??= () => false;
	doc.queryCommandValue ??= () => '';

	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	let commands: [string, string | undefined][] = [];

	function open(props: Record<string, unknown>): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props }) as Record<string, unknown>;
		flushSync();
		commands = [];
		doc.execCommand = (cmd, _ui, value) => {
			commands.push([cmd, value]);
			return true;
		};
		return host.querySelector('.ink-content') as HTMLElement;
	}
	function selectAll(editor: HTMLElement): void {
		const range = document.createRange();
		range.selectNodeContents(editor);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
	}
	const api = () => component as unknown as { setFont(name: string | null): void; getRTF(): string; getHTML(): string; setHTML(html: string): void };
	const list = () => host!.querySelector<HTMLSelectElement>('.toolbar select[title="Font"]');

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
		delete doc.execCommand;
	});

	it('is not there unless fonts are offered', () => {
		open({ content: '<p>a</p>' });
		expect(list()).toBeNull();
	});

	it('an editor that offers no fonts lets none in: what it shows is what the RTF has', () => {
		// (Fonts on a paste used to stay on the screen, and were never written to the RTF.)
		const editor = open({ content: '<p style="font-family: Calibri, sans-serif; text-align: right;">a <font face="Georgia" color="#ff0000">b</font></p>' });
		expect(editor.innerHTML).toBe('<p style="text-align: right;">a <font color="#ff0000">b</font></p>');
		api().setHTML('<p><span style="font-family: Papyrus; font-weight: bold;">c</span></p>');
		expect(editor.innerHTML).toBe('<p><span style="font-weight: bold;">c</span></p>');
		api().setFont('Georgia');
		expect(commands).toEqual([]);
	});

	it('offers the document font first, then the fonts given, and the document font once', () => {
		open({ content: '<p>a</p>', fonts: ['Georgia', DEFAULT_FONT_FAMILY, 'Calibri, Carlito, sans-serif'] });
		expect(Array.from(list()!.options).map((option) => [option.value, option.textContent])).toEqual([
			['', DEFAULT_FONT_FAMILY],
			['georgia', 'Georgia'],
			['calibri', 'Calibri']
		]);
	});

	it('shows the font of the text selected, and nothing where there are two', () => {
		const editor = open({ content: '<p><font face="Georgia">a</font></p><p>b</p>', fonts: FONTS });
		const select = (node: Node) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			window.getSelection()!.removeAllRanges();
			window.getSelection()!.addRange(range);
			editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
			flushSync();
		};
		select(editor.querySelector('font')!);
		expect(list()!.value).toBe('georgia');
		select(editor.querySelectorAll('p')[1]);
		expect(list()!.value).toBe('');
		select(editor);
		expect(list()!.value.trim()).toBe('');
		expect(list()!.selectedOptions[0].textContent).toBe('');
	});

	it('takes a font that is not offered off a document it is given', () => {
		const editor = open({ content: '<p><font face="Papyrus">a</font> <font face="georgia">b</font></p>', fonts: FONTS });
		expect(editor.innerHTML).toBe('<p><font>a</font> <font face="Georgia, serif">b</font></p>');
		api().setHTML('<p style="font-family: Papyrus">c</p>');
		expect(editor.innerHTML).toBe('<p>c</p>');
	});

	it('setFont asks the browser for an offered font as the application wrote it, and for no other', () => {
		const editor = open({ content: '<p>a</p>', fonts: FONTS });
		selectAll(editor);
		api().setFont('Papyrus');
		expect(commands).toEqual([]);
		api().setFont('calibri');
		expect(commands).toEqual([['fontName', 'Calibri, Carlito, sans-serif']]);
	});

	it('setFont with no name, or the document font\'s, sets text in another font back', () => {
		const editor = open({ content: '<p><font face="Georgia">a</font></p>', fonts: FONTS });
		selectAll(editor);
		api().setFont('');
		api().setFont(DEFAULT_FONT_FAMILY);
		expect(commands).toEqual([
			['fontName', `"${DEFAULT_FONT_FAMILY}", sans-serif`],
			['fontName', `"${DEFAULT_FONT_FAMILY}", sans-serif`]
		]);
	});

	it('setFont does nothing where the text has that font already, or the editor is read-only', () => {
		const editor = open({ content: '<p><font face="Georgia">a</font></p>', fonts: FONTS });
		selectAll(editor);
		api().setFont('Georgia');
		expect(commands).toEqual([]);
		if (component) unmount(component);
		host?.remove();
		const readOnly = open({ content: '<p>a</p>', fonts: FONTS, readonly: true });
		selectAll(readOnly);
		api().setFont('Georgia');
		expect(commands).toEqual([]);
	});

	it('writes the fonts offered to the RTF, and the viewer shows them', () => {
		open({ content: '<p>a <font face="Georgia">b</font> <font face="Papyrus">c</font></p>', fonts: FONTS });
		const rtf = api().getRTF();
		expect(table(rtf)).toBe(`${DOCUMENT_FONTS}{\\f2\\froman\\fcharset0 Georgia;}}`);
		const viewerHost = document.createElement('div');
		document.body.appendChild(viewerHost);
		const viewer = mount(RtfViewer, { target: viewerHost, props: { content: rtf, fonts: FONTS } });
		flushSync();
		expect(viewerHost.querySelector('.rtf-viewer')!.innerHTML).toContain('<span style="font-family:Georgia, serif">b</span>');
		unmount(viewer);
		viewerHost.remove();
	});
});
