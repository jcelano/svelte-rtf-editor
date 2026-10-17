import { describe, it, expect } from 'vitest';
import { htmlToRtf, estimateRtfBytes, isSafeLinkUrl } from '../rtf-writer.js';

/**
 * What the RTF writer sends to a receiving system (Epic Beaker) when formatting nests, when a
 * block sits in a table cell, for characters outside the Basic Multilingual Plane, and for links.
 * Each case was wrong in 1.5.2 (issue #3); the body text here is invented.
 */

function htmlEl(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
}

/** The document body: everything after the header, font and color tables. */
function body(html: string): string {
	return htmlToRtf(htmlEl(html)).replace(/^.*?\\viewkind4\\uc1\\pard\\f0\\fs24 /, '');
}

describe('closing a format restores the enclosing one', () => {
	it('an inner bold does not end the outer bold', () => {
		// 1.5.2 wrote "\b c\b0", so "d" and "e" reached Beaker plain while the screen showed them bold.
		expect(body('<p><b>a <i>b <b>c</b> d</i> e</b></p>')).toBe('\\pard \\b a \\i b c d\\i0  e\\b0 \\par }');
	});

	it('the same holds for italic, underline and strikethrough', () => {
		expect(body('<p><i>a <em>b</em> c</i></p>')).toBe('\\pard \\i a b c\\i0 \\par }');
		expect(body('<p><u>a <u>b</u> c</u></p>')).toBe('\\pard \\ul a b c\\ulnone \\par }');
		expect(body('<p><s>a <del>b</del> c</s></p>')).toBe('\\pard \\strike a b c\\strike0 \\par }');
	});

	it('a sized word inside a heading returns to the heading\'s size', () => {
		expect(body('<h1>big <span style="font-size:10pt">small</span> big</h1>')).toBe(
			'\\pard\\f0\\fs48\\b big \\fs20 small\\fs48  big\\b0\\fs24\\par }'
		);
	});

	it('bold inside a heading does not end the heading\'s bold', () => {
		expect(body('<h2>Final <b>diagnosis</b> here</h2>')).toBe('\\pard\\f0\\fs36\\b Final diagnosis here\\b0\\fs24\\par }');
	});

	it('a colored word inside a colored paragraph returns to the paragraph\'s color', () => {
		const rtf = htmlToRtf(htmlEl('<p style="color: red">r <span style="color: blue">b</span> r</p>'));
		expect(rtf).toContain('\\cf2 r \\cf3 b\\cf2  r\\cf0 \\par ');
	});

	it('a link inside underlined text leaves the underline on', () => {
		expect(body('<p><u>under <a href="https://example.org">link</a> still under</u></p>')).toContain(
			'link\\cf0 }} still under\\ulnone '
		);
	});

	it('leaves ordinary formatting exactly as 1.5.2 wrote it', () => {
		expect(body('<p>PROSTATE, NEEDLE BIOPSY:</p><p><b>- BENIGN.</b> <i>See</i> <u>note</u>.</p>')).toBe(
			'\\pard PROSTATE, NEEDLE BIOPSY:\\par \\pard \\b - BENIGN.\\b0  \\i See\\i0  \\ul note\\ulnone .\\par }'
		);
		expect(body('<p>a <span style="font-size: 18pt">big</span> b</p>')).toBe('\\pard a \\fs36 big\\fs24  b\\par }');
	});
});

describe('blocks inside a table cell stay in the cell', () => {
	it('a list keeps \\intbl and does not end the row with an extra paragraph', () => {
		const rtf = body('<table><tr><td><ul><li>x</li></ul></td></tr></table>');
		expect(rtf).toContain('\\pard\\intbl\\li720\\fi-360\\bullet\\tab x\\par}\\cell');
		expect(rtf).not.toMatch(/\\pard\\li720/);
	});

	it('headings, quotes, code, rules and figures keep \\intbl too', () => {
		const rtf = body(
			'<table><tr><td><h3>H</h3><blockquote>q</blockquote><pre>c</pre><hr></td></tr></table>'
		);
		for (const block of ['\\pard\\intbl\\f0\\fs28\\b H', '\\pard\\intbl\\li720\\i q', '\\pard\\intbl\\f1\\fs20 c', '\\pard\\intbl\\qc ']) {
			expect(rtf).toContain(block);
		}
		expect(rtf).not.toMatch(/\\pard(?!\\intbl)[\\ ]/);
	});

	it('two paragraphs in one cell stay two', () => {
		expect(body('<table><tr><td><p>x</p><p>y</p></td></tr></table>')).toContain('x\\par \\pard\\intbl y\\par}\\cell');
	});

	it('a one-paragraph cell is written exactly as before', () => {
		expect(body('<table><tr><td><p>x</p></td><td>y</td></tr></table>')).toContain(
			'{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 x\\par}\\cell{\\pard\\intbl \\f0 \\sa0 \\li0 \\fi0 y\\par}\\cell'
		);
	});
});

describe('characters from U+8000 up', () => {
	it('are written as signed 16-bit \\uN, which Word and Epic read correctly', () => {
		expect(body('<p>翿耀</p>')).toBe("\\pard \\u32767\\'3f\\u-32768\\'3f\\par }");
		// An emoji is a surrogate pair: both halves are above 0x7FFF.
		expect(body('<p>\u{1F600}</p>')).toBe("\\pard \\u-10179\\'3f\\u-8704\\'3f\\par }");
	});

	it('leave characters below U+8000 as they were', () => {
		expect(body('<p>µ ± ≥ é</p>')).toBe("\\pard \\u181\\'3f \\u177\\'3f \\u8805\\'3f \\u233\\'3f\\par }");
	});
});

describe('links', () => {
	it('accepts web, mail and phone addresses only', () => {
		for (const ok of ['https://example.org/a', 'http://example.org', 'mailto:a@example.org', 'tel:+12025550100', '/relative']) {
			expect(isSafeLinkUrl(ok)).toBe(true);
		}
		for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', '']) {
			expect(isSafeLinkUrl(bad)).toBe(false);
		}
	});

	it('writes an unsafe link as its text alone', () => {
		expect(body('<p><a href="javascript:alert(1)">x</a></p>')).toBe('\\pard x\\par }');
	});
});

describe('estimateRtfBytes does not undercount', () => {
	const cases: Record<string, string> = {
		'non-ASCII text': `<p>${'病理'.repeat(250)}</p>`,
		'a link': '<p><a href="https://example.org/a/long/path/to/a/page">click</a></p>',
		'rules': '<p>a</p><hr><hr><hr>',
		'inline formatting': '<p><b>a</b> <i>b</i> <u>c</u> <s>d</s> x<sup>2</sup> <code>e</code><br>f</p>',
		'colors and sizes': '<p><span style="color: red; font-size: 18pt">x</span> <font color="#00ff00">y</font></p>',
		'a picture that is a link': '<p><img src="https://example.org/figure.png" alt="figure"></p>'
	};
	for (const [name, html] of Object.entries(cases)) {
		it(`is close to the real size for ${name}, and not below it`, () => {
			const el = htmlEl(html);
			const actual = htmlToRtf(el).length;
			const estimate = estimateRtfBytes(el);
			expect(estimate).toBeGreaterThanOrEqual(actual);
			expect(estimate - actual).toBeLessThan(150);
		});
	}
});
