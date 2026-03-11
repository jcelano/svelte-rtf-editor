import { describe, it, expect } from 'vitest';
import { rtfToHtml } from '../rtf-parser.js';
import { htmlToRtf } from '../rtf-writer.js';

/** Parse an HTML string into a div element (requires happy-dom environment). */
function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap plain RTF body content in a minimal valid RTF document. */
function rtf(body: string) {
	return `{\\rtf1\\ansi\\deff0 ${body}}`;
}

// ── Basic formatting ──────────────────────────────────────────────────────────

describe('basic formatting', () => {
	it('renders plain text', () => {
		expect(rtfToHtml(rtf('Hello world'))).toBe('<p>Hello world</p>');
	});

	it('renders bold', () => {
		expect(rtfToHtml(rtf('\\b Bold\\b0'))).toBe('<p><strong>Bold</strong></p>');
	});

	it('renders italic', () => {
		expect(rtfToHtml(rtf('\\i Italic\\i0'))).toBe('<p><em>Italic</em></p>');
	});

	it('renders underline', () => {
		expect(rtfToHtml(rtf('\\ul Underline\\ulnone'))).toBe('<p><u>Underline</u></p>');
	});

	it('renders strikethrough', () => {
		expect(rtfToHtml(rtf('\\strike Strike\\strike0'))).toBe('<p><s>Strike</s></p>');
	});

	it('renders superscript', () => {
		expect(rtfToHtml(rtf('x\\super 2\\nosupersub'))).toBe('<p>x<sup>2</sup></p>');
	});

	it('renders subscript', () => {
		expect(rtfToHtml(rtf('H\\sub 2\\nosupersub O'))).toBe('<p>H<sub>2</sub>O</p>');
	});
});

// ── Paragraphs ────────────────────────────────────────────────────────────────

describe('paragraphs', () => {
	it('splits on \\par', () => {
		const html = rtfToHtml(rtf('First\\par Second'));
		expect(html).toBe('<p>First</p>\n<p>Second</p>');
	});

	it('emits empty paragraph for blank lines', () => {
		const html = rtfToHtml(rtf('First\\par\\par Second'));
		expect(html).toBe('<p>First</p>\n<p><br></p>\n<p>Second</p>');
	});
});

// ── Bug regression tests ──────────────────────────────────────────────────────
// Add a new `it` block for each bug you fix. Include the raw RTF that triggered
// the bug and assert the expected HTML output.

// ── Color table ───────────────────────────────────────────────────────────────

describe('color table', () => {
	it('renders colored text (with leading auto-color entry)', () => {
		// Color table with leading ";" auto entry: \cf0=auto, \cf1=red, \cf2=green
		const input = String.raw`{\rtf1\ansi\deff0 {\colortbl;\red255\green0\blue0;\red0\green128\blue0;}\cf1 Red\cf0  and \cf2 Green\cf0 }`;
		expect(rtfToHtml(input)).toBe(
			'<p><span style="color:rgb(255,0,0)">Red</span> and <span style="color:rgb(0,128,0)">Green</span></p>'
		);
	});

	it('renders single colored run (with leading auto-color entry)', () => {
		// Color table with leading ";" auto entry: \cf0=auto, \cf1=red
		const input = String.raw`{\rtf1\ansi\deff0 {\colortbl;\red255\green0\blue0;}\cf1 Red text\cf0 }`;
		expect(rtfToHtml(input)).toBe('<p><span style="color:rgb(255,0,0)">Red text</span></p>');
	});

	it('renders three colored runs with standard auto slot indexing', () => {
		const input = String.raw`{\rtf1\ansi\deff0 {\colortbl;\red255\green0\blue0;\red0\green128\blue0;\red0\green0\blue255;}Normal, \cf1 red\cf0 , \cf2 green\cf0 , \cf3 blue\cf0 .}`;
		expect(rtfToHtml(input)).toBe(
			'<p>Normal, <span style="color:rgb(255,0,0)">red</span>, <span style="color:rgb(0,128,0)">green</span>, <span style="color:rgb(0,0,255)">blue</span>.</p>'
		);
	});

	it('drops \\cb background color on import (not rendered)', () => {
		// \cb is dropped; use \highlight in the writer for background color
		const input = String.raw`{\rtf1\ansi\deff0 {\colortbl;\red243\green224\blue18;}\cb1 Highlighted\cb0  text}`;
		expect(rtfToHtml(input)).toBe('<p>Highlighted text</p>');
	});

	it('renders \\highlight background color', () => {
		// \highlight7 = yellow from the 16-color RTF palette
		const input = String.raw`{\rtf1\ansi\deff0 \highlight7 Highlighted\highlight0  text}`;
		expect(rtfToHtml(input)).toBe(
			'<p><span style="background-color:#ffff00">Highlighted</span> text</p>'
		);
	});

	it('renders combined \\cf foreground and \\highlight background', () => {
		const input = String.raw`{\rtf1\ansi\deff0 {\colortbl;\red255\green0\blue0;}\cf1\highlight7 Red on yellow\cf0\highlight0 }`;
		expect(rtfToHtml(input)).toBe(
			'<p><span style="color:rgb(255,0,0);background-color:#ffff00">Red on yellow</span></p>'
		);
	});

	it('\\cb is silently dropped but \\cf still renders', () => {
		const input = String.raw`{\rtf1\ansi\deff0 {\colortbl;\red255\green0\blue0;\red243\green224\blue18;}\cf1\cb2 Red on yellow\cf0\cb0 }`;
		expect(rtfToHtml(input)).toBe(
			'<p><span style="color:rgb(255,0,0)">Red on yellow</span></p>'
		);
	});
});

describe('bug regressions', () => {
	// Add a new `it` block for each bug you fix. Include the raw RTF that
	// triggered the bug and assert the expected HTML output.

	it('blank lines between bullet section and next header are preserved', () => {
		// Bug: \par\par after a bullet paragraph produces no blank line because
		// isListLine(prev) === true causes the empty paragraph to be skipped.
		const input = String.raw`{\rtf1\ansi\deff0 {\fonttbl {\f0 Arial;}}
{\b A. SECTION ONE:}\par \bullet First item.\line \bullet Second item.\line \bullet Third item.\par \par {\b B. SECTION TWO:}\par \bullet Only item here.\par \par {\b C. SECTION THREE:}\par \bullet Only item here.\par \par {\b NOTES:}\par Some additional commentary goes here.\par }`;

		expect(rtfToHtml(input)).toBe(
			'<p><strong>A. SECTION ONE:</strong></p>\n' +
			'<p>\u2022First item.<br>\u2022Second item.<br>\u2022Third item.</p>\n' +
			'<p><br></p>\n' +
			'<p><strong>B. SECTION TWO:</strong></p>\n' +
			'<p>\u2022Only item here.</p>\n' +
			'<p><br></p>\n' +
			'<p><strong>C. SECTION THREE:</strong></p>\n' +
			'<p>\u2022Only item here.</p>\n' +
			'<p><br></p>\n' +
			'<p><strong>NOTES:</strong></p>\n' +
			'<p>Some additional commentary goes here.</p>'
		);
	});
});

// ── Tables ────────────────────────────────────────────────────────────────────

describe('tables', () => {
	it('renders a simple 2-column table', () => {
		// Header row (with \clbrdrb) + one data row
		const input = String.raw`{\rtf1\ansi\deff0 {\trowd \trgaph120 \clbrdrb\brdrs\cellx2160\clbrdrb\brdrs\cellx4320 \trkeep\intbl { {{\pard\intbl Name\par}\cell}{{\pard\intbl Value\par}\cell}} \intbl\row}{\trowd \trgaph120 \cellx2160\cellx4320 \trkeep\intbl { {{\pard\intbl Heart\par}\cell}{{\pard\intbl 620 g\par}\cell}} \intbl\row}}`;
		const result = rtfToHtml(input);
		expect(result).toContain('<table');
		expect(result).toContain('<th');
		expect(result).toContain('Name');
		expect(result).toContain('Value');
		expect(result).toContain('<td');
		expect(result).toContain('Heart');
		expect(result).toContain('620 g');
		expect(result).toContain('</table>');
	});

	it('renders the organ-weights RTF file with tables', async () => {
		const { readFileSync } = await import('node:fs');
		const rtf = readFileSync('test-files/organ-weights.rtf', 'ascii');
		const result = rtfToHtml(rtf);
		expect(result).toContain('<table');
		expect(result).toContain('Heart Weight');
		expect(result).toContain('620 g');
		expect(result).toContain('Brain Weight');
		expect(result).toContain('</table>');
	});
});

// ── Table round-trip (parser → writer → parser) ───────────────────────────────

describe('table round-trip', () => {
	it('writer emits \trowd/\\cell/\\row for a <table>', () => {
		const html = rtfToHtml(String.raw`{\rtf1\ansi\deff0 {\trowd \trgaph120 \clbrdrb\brdrs\cellx4320\clbrdrb\brdrs\cellx8640 \trkeep\intbl {{{\pard\intbl Name\par}\cell}{{\pard\intbl Value\par}\cell}}\intbl\row}{\trowd \trgaph120 \cellx4320\cellx8640 \trkeep\intbl {{{\pard\intbl Heart\par}\cell}{{\pard\intbl 620 g\par}\cell}}\intbl\row}}`);
		const rtf = htmlToRtf(htmlEl(html));
		expect(rtf).toContain('\\trowd');
		expect(rtf).toContain('\\cell');
		expect(rtf).toContain('\\row');
		expect(rtf).toContain('\\clbrdrb\\brdrs'); // header row preserved
	});

	it('round-trip preserves cell text content', () => {
		const sourceRtf = String.raw`{\rtf1\ansi\deff0 {\trowd \trgaph120 \clbrdrb\brdrs\cellx4320\clbrdrb\brdrs\cellx8640 \trkeep\intbl {{{\pard\intbl Organ\par}\cell}{{\pard\intbl Weight\par}\cell}}\intbl\row}{\trowd \trgaph120 \cellx4320\cellx8640 \trkeep\intbl {{{\pard\intbl Heart\par}\cell}{{\pard\intbl 620 g\par}\cell}}\intbl\row}}`;
		const html = rtfToHtml(sourceRtf);
		const rtf2 = htmlToRtf(htmlEl(html));
		// Re-parse the written RTF and check all cell values survive
		const html2 = rtfToHtml(rtf2);
		expect(html2).toContain('Organ');
		expect(html2).toContain('Weight');
		expect(html2).toContain('Heart');
		expect(html2).toContain('620 g');
	});

	it('round-trip preserves bold formatting inside cells', () => {
		const sourceRtf = String.raw`{\rtf1\ansi\deff0 {\trowd \trgaph120 \cellx8640 \trkeep\intbl {{{\pard\intbl {\b HIGH}\par}\cell}}\intbl\row}}`;
		const html = rtfToHtml(sourceRtf);
		const rtf2 = htmlToRtf(htmlEl(html));
		const html2 = rtfToHtml(rtf2);
		expect(html2).toContain('<strong>HIGH</strong>');
	});
});
