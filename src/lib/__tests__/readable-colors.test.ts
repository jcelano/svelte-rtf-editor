import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { htmlToRtf, colorContrast } from '../rtf-writer.js';
import { rtfToHtml } from '../rtf-parser.js';
import { sanitizeHtml } from '../sanitize.js';

/**
 * Words that needed their background (an outside review of 1.12.0, finding 1).
 *
 * A background is not written to the RTF and shading is not shown from one: every word ends up
 * on white. A Word table with a dark header row and white header text looked right in the
 * editor, and in the RTF "Marker", "Patient result" and "Control" were white on white: the row
 * under them read "HER2 | Negative (1+) | Positive (3+)" with nothing to say which column was
 * the patient's. A sentence copied from a page with a dark theme, "Margins are positive for
 * carcinoma.", was written at a contrast of 1.18. The reader had the same fault the other way.
 *
 * A color that can be read on its background and not on white is left out, by the writer and by
 * the reader, and the words are in the page's own color. Invented text.
 */

const R = String.raw;
const el = (html: string) => {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
};
const rtfOf = (html: string) => htmlToRtf(el(html));
const colorTable = (rtf: string) => rtf.match(/\{\\colortbl[^}]*\}/)![0];
/** The RTF after the header, without the closing brace. */
const body = (html: string) => {
	const rtf = rtfOf(html);
	return rtf.slice(rtf.indexOf('\\pard\\f0\\fs24 ') + '\\pard\\f0\\fs24 '.length, -1);
};
const WHITE_ENTRY = R`\red255\green255\blue255;`;
const read = (rtfBody: string, colors = R`\red255\green255\blue255;\red31\green56\blue100;\red192\green0\blue0;\red255\green255\blue0;`) =>
	rtfToHtml(`{\\rtf1\\ansi\\deff0{\\colortbl;${colors}}${rtfBody}}`);

describe('colorContrast', () => {
	it('is WCAG\'s contrast: 1 for a color on itself, 21 for black on white', () => {
		const white = { r: 255, g: 255, b: 255 };
		expect(colorContrast(white, white)).toBe(1);
		expect(colorContrast({ r: 0, g: 0, b: 0 }, white)).toBeCloseTo(21, 5);
		expect(colorContrast(white, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 5);
		expect(colorContrast({ r: 255, g: 0, b: 0 }, white)).toBeCloseTo(4.0, 1);
		expect(colorContrast({ r: 255, g: 255, b: 0 }, white)).toBeCloseTo(1.07, 2);
	});
});

describe('htmlToRtf: a color that needed its background is not written', () => {
	// As Word puts a shaded header row on the clipboard: the shading on the cell, the color on a span.
	const wordTable =
		'<table><tr>' +
		['Marker', 'Patient result', 'Control']
			.map((word) => `<td style="background:#1F3864;padding:0in 5.4pt"><p class="MsoNormal"><b><span style="color:white">${word}</span></b></p></td>`)
			.join('') +
		'</tr><tr><td><p>HER2</p></td><td><p>Negative (1+)</p></td><td><p><span style="color:#C00000">Positive (3+)</span></p></td></tr></table>';

	it('the white header of a Word table with a dark header row', () => {
		const rtf = rtfOf(wordTable);
		expect(colorTable(rtf)).not.toContain(WHITE_ENTRY);
		for (const word of ['Marker', 'Patient result', 'Control']) expect(rtf).toMatch(new RegExp(`\\\\b ${word}\\\\b0 `));
		// No color is switched on before a header word, and the result's own red is still red.
		expect(rtf.slice(0, rtf.indexOf('HER2'))).not.toMatch(/\\cf[1-9]/);
		expect(colorTable(rtf)).toContain(R`\red192\green0\blue0;`);
		expect(rtf).toMatch(/\\cf\d Positive \(3\+\)\\cf0 /);
	});

	it('a sentence copied from a page with a dark theme', () => {
		const html = '<p><span style="color: rgb(230, 237, 243); background-color: rgb(13, 17, 23);">Margins are positive for carcinoma.</span></p>';
		expect(body(html)).toBe(R`\pard Margins are positive for carcinoma.\par `);
		expect(colorTable(rtfOf(html))).toBe(R`{\colortbl;\red0\green0\blue0;}`);
	});

	it('where the background is on the row, the table or a block around the words', () => {
		for (const html of [
			'<table><tr style="background-color:#000080"><td style="color:#ffffff">Marker</td></tr></table>',
			'<table style="background-color:#000080"><tr><td><span style="color:#ffffff">Marker</span></td></tr></table>',
			'<table><thead style="background:#333"><tr><th><font color="#ffffff">Marker</font></th></tr></thead></table>',
			'<div style="background-color:#222222"><p style="color:#eeeeee">Marker</p></div>',
			'<p style="background-color:#1F3864;color:#ffffff">Marker</p>',
			'<ul><li style="background-color:black;color:yellow">Marker</li></ul>'
		]) {
			const rtf = rtfOf(html);
			expect(rtf, html).toContain('Marker');
			expect(rtf, html).not.toMatch(/\\cf[1-9]/);
			expect(colorTable(rtf), html).toBe(R`{\colortbl;\red0\green0\blue0;}`);
		}
	});

	it('where the color is around the background: the words on it are set back to the page\'s color', () => {
		expect(body('<div style="color:#ffffff"><p>on the page</p><p style="background-color:#000080">on the bar</p><p>after</p></div>')).toBe(
			R`\cf2 \pard on the page\par \pard \cf0 on the bar\cf2 \par \pard after\par \cf0 `
		);
	});

	it('inside words of another color, which go on after it', () => {
		expect(body('<p><span style="color:#c00000">a <span style="background-color:#000000;color:#ffffff">b</span> c</span></p>')).toBe(
			R`\pard \cf2 a \cf0 b\cf2  c\cf0 \par `
		);
	});

	it('by the bgcolor of older pages and mail, and by a background this file cannot read', () => {
		expect(colorTable(rtfOf('<table><tr><td bgcolor="#000080"><font color="#ffffff">Marker</font></td></tr></table>'))).not.toContain(WHITE_ENTRY);
		expect(colorTable(rtfOf('<table><tr><td bgcolor="000080"><font color="#ffffff">Marker</font></td></tr></table>'))).not.toContain(WHITE_ENTRY);
		expect(colorTable(rtfOf('<p style="background-color:midnightblue"><span style="color:#ffffff">Marker</span></p>'))).not.toContain(WHITE_ENTRY);
		expect(colorTable(rtfOf('<p style="background-image:linear-gradient(#000,#333)"><span style="color:#ffffff">Marker</span></p>'))).not.toContain(WHITE_ENTRY);
	});

	it('a color that can be read on white is written, background or not', () => {
		expect(body('<p style="background-color:#000000"><span style="color:#c00000">red</span></p>')).toBe(R`\pard \cf2 red\cf0 \par `);
		expect(body('<p><span style="background-color:#ffff00;color:#000080">navy on a highlight</span></p>')).toBe(R`\pard \cf2 navy on a highlight\cf0 \par `);
		// Mid grey: 3.5 to 1 on white.
		expect(body('<p style="background-color:#000000"><span style="color:#888888">grey</span></p>')).toContain(R`\cf2 grey`);
	});

	it('a light color with no background behind it is the writer\'s own choice, as the screen shows it', () => {
		expect(body('<p><span style="color:#ffff00">yellow</span></p>')).toBe(R`\pard \cf2 yellow\cf0 \par `);
		expect(body('<p><font color="#ffffff">white</font></p>')).toBe(R`\pard \cf2 white\cf0 \par `);
		// A background that shows nothing is none.
		expect(body('<p style="background-color:transparent"><span style="color:#ffff00">yellow</span></p>')).toContain(R`\cf2 yellow`);
		expect(body('<p style="background-color:rgba(0, 0, 0, 0)"><span style="color:#ffff00">yellow</span></p>')).toContain(R`\cf2 yellow`);
	});

	it('and so is one on a background it reads no better on', () => {
		expect(body('<p style="background-color:#ffffff"><span style="color:#ffff00">yellow</span></p>')).toContain(R`\cf2 yellow`);
		expect(body('<p style="background-color:#ffffee"><span style="color:#ffffff">white</span></p>')).toContain(R`\cf2 white`);
	});

	it('a link in a dark header is the link color, as any link', () => {
		const rtf = rtfOf('<table><tr><td style="background-color:#000080"><a href="https://example.com/" style="color:#ffffff">site</a></td></tr></table>');
		expect(rtf).toContain(R`{\fldrslt\ul\cf1 site`);
		expect(colorTable(rtf)).toBe(R`{\colortbl;\red0\green0\blue255;\red0\green0\blue0;}`);
	});

	it('a document with no background is written as before', () => {
		expect(rtfOf('<p><span style="color:#c00000">red</span> and <font color="#008000">green</font></p>')).toBe(
			R`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss\fcharset0 Segoe UI;}{\f1\fmodern\fcharset0 Courier New;}}{\colortbl;\red0\green0\blue0;\red192\green0\blue0;\red0\green128\blue0;}\viewkind4\uc1\pard\f0\fs24 \pard \cf2 red\cf0  and \cf3 green\cf0 \par }`
		);
	});
});

describe('rtfToHtml: words colored to stand on shading that is not shown', () => {
	const row = (shade: string, cell: string) => R`\trowd${shade}\cellx3000\pard\intbl ${cell}\cell\row`;

	it('the white header of a shaded header row can be read', () => {
		const html = read(row(R`\clcbpat2`, R`\cf1\b Marker\b0\cf0`) + row('', R`HER2`));
		expect(html).toContain('<strong>Marker</strong>');
		expect(html).not.toContain('color:');
		expect(html).not.toContain('background');
	});

	it('a color that can be read on white stays in a shaded cell, and beside one that cannot', () => {
		const html = read(row(R`\clcbpat2`, R`\cf1 Marker \cf3 flagged\cf0  \cf4 note\cf0`));
		expect(html).toContain('Marker <span style="color:rgb(192,0,0)">flagged</span> note');
	});

	it('white words in a cell that is not shaded are as the file has them', () => {
		expect(read(row('', R`\cf1 Marker\cf0`))).toContain('<span style="color:rgb(255,255,255)">Marker</span>');
		// Shaded white is not shaded.
		expect(read(row(R`\clcbpat1`, R`\cf4 Marker\cf0`))).toContain('<span style="color:rgb(255,255,0)">Marker</span>');
	});

	it('each cell by its own shading, also where the next row repeats the definition', () => {
		const html = read(R`\trowd\clcbpat2\cellx3000\cellx6000\pard\intbl\cf1 dark\cell\pard\intbl\cf1 plain\cell\row\pard\intbl\cf1 dark again\cell\pard\intbl\cf0 x\cell\row`);
		expect(html).toMatch(/<td[^>]*>dark<\/td><td[^>]*><span style="color:rgb\(255,255,255\)">plain<\/span><\/td>/);
		expect(html).toMatch(/<td[^>]*>dark again<\/td>/);
	});

	it('character shading (\\cb, \\chcbpat) and paragraph shading (\\cbpat)', () => {
		expect(read(R`\pard\cf1\cb2 on a bar\cb0\cf0  after\par`)).toBe('<p>on a bar after</p>');
		expect(read(R`\pard\cf1\chshdng0\chcbpat2 on a bar\chcbpat0\cf0  after\par`)).toBe('<p>on a bar after</p>');
		expect(read(R`\pard\cbpat2\cf1 A white title\par\pard\cf3 next\par`)).toBe('<p>A white title</p>\n<p><span style="color:rgb(192,0,0)">next</span></p>');
	});

	it('shading ends where the file ends it: \\cb0, \\plain, \\pard', () => {
		expect(read(R`\pard\cb2\cf1 dark\cb0  light\par`)).toBe('<p>dark<span style="color:rgb(255,255,255)"> light</span></p>');
		expect(read(R`\pard\cb2\cf1 dark\plain\cf1  light\par`)).toContain('<span style="color:rgb(255,255,255)"> light</span>');
		expect(read(R`\pard\cbpat2\cf1 dark\par\pard light\par`)).toBe('<p>dark</p>\n<p><span style="color:rgb(255,255,255)">light</span></p>');
	});

	it('a highlight is shown, and the words on it keep their color', () => {
		expect(read(R`\pard\highlight1\cf1 white on black\highlight0\cf0\par`)).toBe(
			'<p><span style="color:rgb(255,255,255);background-color:#000000">white on black</span></p>'
		);
	});

	it('a table TextEdit wrote: a shaded header row with white words, a white title on a bar, yellow on black', () => {
		// (textutil -convert rtf, from HTML with those backgrounds: \clcbpat on the cells, \cb on the lines.)
		const html = rtfToHtml(readFileSync('test-files/shaded-header-textedit.rtf', 'ascii'));
		// (With the space TextEdit puts after it, which is read since 1.14.0.)
		expect(html).toContain('<p style="margin-bottom:12pt">A white title on a shaded bar</p>');
		for (const word of ['Marker', 'Patient result', 'Control']) expect(html).toContain(`<strong>${word}</strong></td>`);
		expect(html).toContain('<span style="color:rgb(176,0,4)">Positive (3+)</span>');
		expect(html).toContain('After yellow on black and <span style="color:rgb(255,255,11)">yellow on nothing</span>.');
		expect(html).not.toContain('rgb(255,255,255)');
	});

	it('and what is read is written without the lost colors', () => {
		const rtf = rtfOf(rtfToHtml(readFileSync('test-files/shaded-header-textedit.rtf', 'ascii')));
		expect(colorTable(rtf)).not.toContain(WHITE_ENTRY);
		expect(rtf).toContain('Marker');
	});
});

/**
 * Light words on a background that is not kept (a review of main before 1.13.0, item 2).
 *
 * No picture is loaded for a document, and a gradient is not a thing an RTF has: both are taken
 * off what comes in. The color of the words that stood on them was left: white, on the white
 * of the page, in the editor and in the RTF. The words were in the report and nobody saw them.
 */
describe('sanitizeHtml: light words whose picture or gradient is taken away', () => {
	it('are in the page\'s color: on the element itself, and in what it holds', () => {
		expect(sanitizeHtml('<div style="background-image:linear-gradient(#003366,#0055aa);color:#ffffff"><p>Header</p></div>')).toBe('<div><p>Header</p></div>');
		expect(sanitizeHtml('<div style="background-image:url(https://example.com/dark.png)"><p style="color:white">On a picture</p></div>')).toBe(
			'<div><p>On a picture</p></div>'
		);
		// The rest of the style stays.
		expect(sanitizeHtml('<div style="background-image:linear-gradient(#000,#333)"><p><span style="color:#fff;font-weight:bold">Bold</span></p></div>')).toMatch(
			/<span style="font-weight: ?bold;?">Bold<\/span>/
		);
		// `background`, the short form, as it is mostly written.
		const short = sanitizeHtml('<div style="background:linear-gradient(to right,#003366,#0055aa);color:#fff"><p>Header</p></div>');
		expect(short).not.toMatch(/(^|[ ;"])color:/);
		expect(short).toContain('<p>Header</p>');
	});

	it('by the `background` and the <font color> of older pages and mail, too', () => {
		expect(sanitizeHtml('<table><tr><td background="dark.png"><font color="#FFFFFF">Old mail</font></td></tr></table>')).toBe(
			'<table><tbody><tr><td><font>Old mail</font></td></tr></tbody></table>'
		);
		expect(sanitizeHtml('<table background="dark.png"><tr><td><font color="ffffff" size="2">No hash</font></td></tr></table>')).toContain('<font size="2">No hash</font>');
	});

	it('a color that can be read on white stays, and so does one that still has a color behind it', () => {
		expect(sanitizeHtml('<div style="background-image:linear-gradient(#000,#333)"><p style="color:#c00000">red</p></div>')).toBe('<div><p style="color:#c00000">red</p></div>');
		// Its own background color, among the words.
		const own = sanitizeHtml('<div style="background-image:linear-gradient(#000,#333)"><p><span style="background-color:#000000;color:#ffffff">shaded</span></p></div>');
		expect(own).toContain('<span style="background-color:#000000;color:#ffffff">shaded</span>');
		// A color under the gradient, on the same element.
		const under = sanitizeHtml('<div style="background:linear-gradient(#003366,#0055aa) #003366;color:#fff"><p>Header</p></div>');
		expect(under).toMatch(/color: ?#fff/);
		expect(under).toMatch(/background-color: ?#003366/);
		// A color around it: the words still stand on that.
		const around = sanitizeHtml('<div style="background-color:#000080"><p style="background-image:linear-gradient(#000,#333);color:#ffffff">On navy</p></div>');
		expect(around).toMatch(/<p style="color: ?#ffffff;?">On navy<\/p>/);
		// (And is left out of the RTF by the writer, which knows the navy is not written.)
		expect(colorTable(rtfOf(around))).not.toContain(WHITE_ENTRY);
	});

	it('white with no background at all is the writer\'s own choice, as before', () => {
		expect(sanitizeHtml('<p style="color:#ffffff">white by choice</p>')).toBe('<p style="color:#ffffff">white by choice</p>');
		expect(sanitizeHtml('<p><font color="#ffffff">white by choice</font></p>')).toBe('<p><font color="#ffffff">white by choice</font></p>');
		// Next to an element that lost its picture, not in it.
		expect(sanitizeHtml('<div style="background-image:url(x.png)"><p>in</p></div><p style="color:#ffffff">beside</p>')).toContain('<p style="color:#ffffff">beside</p>');
	});

	it('the RTF of such a paste has no white in it', () => {
		const safe = sanitizeHtml('<div style="background:linear-gradient(#003366,#0055aa);color:#fff"><h2 style="color:#ffffff">Diagnosis</h2><p>Invasive carcinoma.</p></div>')!;
		const rtf = rtfOf(safe);
		expect(rtf).toContain('Diagnosis');
		expect(rtf).not.toContain(WHITE_ENTRY);
	});
});

describe('sanitizeHtml: bgcolor', () => {
	it('is kept as the background it stands for, so that the screen shows it and the writer knows of it', () => {
		const safe = sanitizeHtml('<table><tr><td bgcolor="#000080"><font color="#ffffff">Marker</font></td><td bgcolor="1F3864">x</td></tr></table>');
		expect(safe).not.toContain('bgcolor');
		expect(safe).toMatch(/<td style="background-color: (#000080|rgb\(0, 0, 128\));?">/);
		expect(safe).toMatch(/<td style="background-color: (#1F3864|#1f3864|rgb\(31, 56, 100\));?">/);
		expect(colorTable(rtfOf(safe))).not.toContain(WHITE_ENTRY);
	});

	it('a background the element has already is not replaced, and what is no color makes no style', () => {
		expect(sanitizeHtml('<table><tr><td bgcolor="red" style="background-color: blue;">x</td></tr></table>')).toMatch(/background-color: blue/);
		const safe = sanitizeHtml('<table><tr><td bgcolor="red;position:fixed">x</td><td bgcolor="url(https://example.com/x)">y</td></tr></table>');
		expect(safe).not.toMatch(/style|bgcolor|position|url/);
	});
});
