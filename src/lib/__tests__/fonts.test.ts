import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import RtfViewer from '../RtfViewer.svelte';
import { htmlToRtf, cssFontFamily, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../rtf-writer.js';

/**
 * The document font and body size: what the RTF declares, and what the editor
 * and viewer show on screen. The two must agree, so the writer sees what the
 * receiving system will show.
 */

function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

/** The font table group of an RTF string. */
function fontTable(rtf: string): string {
	const start = rtf.indexOf('{\\fonttbl');
	expect(start).toBeGreaterThan(-1);
	return rtf.substring(start, rtf.indexOf('}}', start) + 2);
}

describe('htmlToRtf document font', () => {
	it('defaults to Arial 12 pt', () => {
		expect(DEFAULT_FONT_FAMILY).toBe('Arial');
		expect(DEFAULT_FONT_SIZE).toBe(12);

		const rtf = htmlToRtf(htmlEl('<p>Benign prostatic tissue.</p>'));
		expect(fontTable(rtf)).toContain('{\\f0\\fswiss\\fcharset0 Arial;}');
		expect(rtf).toContain('\\pard\\f0\\fs24 ');
		expect(rtf).not.toContain('Helvetica');
		expect(rtf).not.toContain('Georgia');
	});

	it('writes the font and size it is given', () => {
		const rtf = htmlToRtf(htmlEl('<p>Text</p>'), { fontFamily: 'Times New Roman', fontSize: 11 });
		expect(fontTable(rtf)).toContain('{\\f0\\froman\\fcharset0 Times New Roman;}');
		expect(rtf).toContain('\\pard\\f0\\fs22 ');
	});

	it('accepts half-point sizes', () => {
		const rtf = htmlToRtf(htmlEl('<p>Text</p>'), { fontSize: 10.5 });
		expect(rtf).toContain('\\pard\\f0\\fs21 ');
	});

	it('falls back to the default for a missing or nonsense font and size', () => {
		for (const options of [{ fontFamily: '', fontSize: 0 }, { fontFamily: '  ', fontSize: NaN }, { fontSize: -4 }]) {
			const rtf = htmlToRtf(htmlEl('<p>Text</p>'), options);
			expect(fontTable(rtf)).toContain(' Arial;}');
			expect(rtf).toContain('\\pard\\f0\\fs24 ');
		}
	});

	it('keeps a font name from breaking the font table', () => {
		const rtf = htmlToRtf(htmlEl('<p>Text</p>'), { fontFamily: 'Evil}{\\b;Font' });
		expect(fontTable(rtf)).toContain('{\\f0\\fswiss\\fcharset0 EvilbFont;}');
	});

	it('writes headings in the document font, scaled from the body size', () => {
		const at12 = htmlToRtf(htmlEl('<h1>A</h1><h2>B</h2><h3>C</h3>'));
		expect(at12).toContain('\\pard\\f0\\fs48\\b A\\b0\\fs24\\par ');
		expect(at12).toContain('\\pard\\f0\\fs36\\b B\\b0\\fs24\\par ');
		expect(at12).toContain('\\pard\\f0\\fs28\\b C\\b0\\fs24\\par ');

		const at10 = htmlToRtf(htmlEl('<h1>A</h1><h2>B</h2><h3>C</h3>'), { fontSize: 10 });
		expect(at10).toContain('\\pard\\f0\\fs40\\b A\\b0\\fs20\\par ');
		expect(at10).toContain('\\pard\\f0\\fs30\\b B\\b0\\fs20\\par ');
		expect(at10).toContain('\\pard\\f0\\fs23\\b C\\b0\\fs20\\par ');
	});

	it('returns to the body size after a sized span and a code block', () => {
		const rtf = htmlToRtf(
			htmlEl('<p><span style="font-size: 18pt">big</span> after</p><pre>x = 1</pre><p>next</p>'),
			{ fontSize: 11 }
		);
		expect(rtf).toContain('\\fs36 big\\fs22  after');
		expect(rtf).toContain('\\pard\\f1\\fs18 x = 1\\f0\\fs22\\par ');
		expect(rtf).not.toContain('\\fs24');
	});

	it('writes code in the monospace font', () => {
		const rtf = htmlToRtf(htmlEl('<p>run <code>ls</code></p>'));
		expect(fontTable(rtf)).toContain('{\\f1\\fmodern\\fcharset0 Courier New;}');
		expect(rtf).toContain('\\f1 ls\\f0 ');
	});
});

describe('cssFontFamily', () => {
	it('quotes the name and adds the matching generic family', () => {
		expect(cssFontFamily('Arial')).toBe('"Arial", sans-serif');
		expect(cssFontFamily('Times New Roman')).toBe('"Times New Roman", serif');
		expect(cssFontFamily('Courier New')).toBe('"Courier New", monospace');
		expect(cssFontFamily(undefined)).toBe('"Arial", sans-serif');
	});
});

// ── On screen ─────────────────────────────────────────────────────────────────

let host: HTMLDivElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
});

function mountInto<P extends Record<string, unknown>>(Comp: unknown, props: P) {
	host = document.createElement('div');
	document.body.appendChild(host);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component = mount(Comp as any, { target: host, props }) as Record<string, unknown>;
	flushSync();
	return component;
}

describe('InkEditor font', () => {
	it('shows Arial 12 pt and writes it to the RTF by default', () => {
		const editor = mountInto(InkEditor, {
			content: '<p>Text</p>',
			autosave: false,
			showToolbar: false
		}) as unknown as { getRTF: () => string };

		const root = host!.querySelector('.ink-editor') as HTMLElement;
		expect(root.style.getPropertyValue('--ink-font-family')).toBe('"Arial", sans-serif');
		expect(root.style.getPropertyValue('--ink-font-size')).toBe('12pt');

		const rtf = editor.getRTF();
		expect(rtf).toContain(' Arial;}');
		expect(rtf).toContain('\\pard\\f0\\fs24 ');
	});

	it('uses the same font and size on screen and in the RTF', () => {
		const editor = mountInto(InkEditor, {
			content: '<p>Text</p>',
			autosave: false,
			showToolbar: false,
			fontFamily: 'Calibri',
			fontSize: 11
		}) as unknown as { getRTF: () => string; getRtfSize: () => number };

		const root = host!.querySelector('.ink-editor') as HTMLElement;
		expect(root.style.getPropertyValue('--ink-font-family')).toBe('"Calibri", sans-serif');
		expect(root.style.getPropertyValue('--ink-font-size')).toBe('11pt');

		const rtf = editor.getRTF();
		expect(rtf).toContain(' Calibri;}');
		expect(rtf).toContain('\\pard\\f0\\fs22 ');
		expect(editor.getRtfSize()).toBe(rtf.length);
	});
});

describe('RtfViewer font', () => {
	it('shows Arial 12 pt by default', () => {
		mountInto(RtfViewer, { content: '{\\rtf1\\ansi Text}' });
		const viewer = host!.querySelector('.rtf-viewer') as HTMLElement;
		expect(viewer.style.fontFamily).toContain('Arial');
		expect(viewer.style.fontSize).toBe('12pt');
	});

	it('shows the font and size it is given', () => {
		mountInto(RtfViewer, { content: '{\\rtf1\\ansi Text}', fontFamily: 'Georgia', fontSize: 14 });
		const viewer = host!.querySelector('.rtf-viewer') as HTMLElement;
		expect(viewer.style.fontFamily).toContain('Georgia');
		expect(viewer.style.fontSize).toBe('14pt');
	});
});
