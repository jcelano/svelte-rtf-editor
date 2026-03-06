import { describe, it, expect } from 'vitest';
import { rtfToHtml } from '../rtf-parser.js';

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

describe('bug regressions', () => {
	// Add a new `it` block for each bug you fix. Include the raw RTF that
	// triggered the bug and assert the expected HTML output.

	it('blank lines between bullet section and next header are preserved', () => {
		// RTF from TST-AP-S-0003/final-diagnosis.rtf
		// Bug: \par\par after a bullet paragraph produces no blank line because
		// isListLine(prev) === true causes the empty paragraph to be skipped.
		const input = String.raw`{\rtf1\ansi\deff0 {\fonttbl {\f0 Arial;}}
{\b A. UTERUS, CERVIX, BILATERAL TUBES AND OVARIES:}\par \bullet Endometrioid adenocarcinoma, FIGO grade 1.\line \bullet Myometrial invasion present: 28% (0.5 cm of 1.8 cm).\line \bullet Cervix: negative for carcinoma.\line \bullet Bilateral ovaries and fallopian tubes: negative for carcinoma.\par \par {\b B. RIGHT PELVIC SENTINEL LYMPH NODE:}\par \bullet One lymph node, negative for metastatic carcinoma (0/1).\par \par {\b C. LEFT PELVIC SENTINEL LYMPH NODE:}\par \bullet One lymph node, negative for metastatic carcinoma (0/1).\par \par {\b COMMENT:}\par MMR protein immunohistochemistry shows intact expression of MLH1, PMS2, MSH2, and MSH6.\par }`;

		expect(rtfToHtml(input)).toBe(
			'<p><strong>A. UTERUS, CERVIX, BILATERAL TUBES AND OVARIES:</strong></p>\n' +
			'<p>\u2022Endometrioid adenocarcinoma, FIGO grade 1.<br>\u2022Myometrial invasion present: 28% (0.5 cm of 1.8 cm).<br>\u2022Cervix: negative for carcinoma.<br>\u2022Bilateral ovaries and fallopian tubes: negative for carcinoma.</p>\n' +
			'<p><br></p>\n' +
			'<p><strong>B. RIGHT PELVIC SENTINEL LYMPH NODE:</strong></p>\n' +
			'<p>\u2022One lymph node, negative for metastatic carcinoma (0/1).</p>\n' +
			'<p><br></p>\n' +
			'<p><strong>C. LEFT PELVIC SENTINEL LYMPH NODE:</strong></p>\n' +
			'<p>\u2022One lymph node, negative for metastatic carcinoma (0/1).</p>\n' +
			'<p><br></p>\n' +
			'<p><strong>COMMENT:</strong></p>\n' +
			'<p>MMR protein immunohistochemistry shows intact expression of MLH1, PMS2, MSH2, and MSH6.</p>'
		);
	});
});
