/**
 * HTML to RTF converter
 *
 * Walks a contenteditable DOM tree and produces a valid RTF 1.x string.
 * Supports: bold, italic, underline, strikethrough, font sizes (h1–h3),
 * foreground colors (\cf), paragraphs, bullet/numbered lists, blockquotes,
 * code blocks, hyperlinks, images (as alt-text placeholders), horizontal
 * rules, line breaks, and Unicode characters.
 *
 * Background color is intentionally not written — RTF highlight support
 * is inconsistent across viewers (TextEdit uses \AppleHighlight, not \highlight).
 */

// ── Types ──

interface RGB {
	r: number;
	g: number;
	b: number;
}

interface WalkContext {
	colorIndex: Map<string, number>;
	inPre: boolean;
	listCounter: number;
}

// ── Color helpers ──

function parseColor(colorStr: string): RGB | null {
	if (!colorStr) return null;
	const s = colorStr.trim().toLowerCase();

	// rgb(r, g, b) or rgba(r, g, b, a)
	const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgbMatch) {
		return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
	}

	// Hex
	const hexMatch = s.match(/^#([0-9a-f]{3,8})$/);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
		return {
			r: parseInt(hex.substring(0, 2), 16),
			g: parseInt(hex.substring(2, 4), 16),
			b: parseInt(hex.substring(4, 6), 16)
		};
	}

	// Basic named colors
	const named: Record<string, RGB> = {
		black: { r: 0, g: 0, b: 0 },
		white: { r: 255, g: 255, b: 255 },
		red: { r: 255, g: 0, b: 0 },
		green: { r: 0, g: 128, b: 0 },
		blue: { r: 0, g: 0, b: 255 },
		yellow: { r: 255, g: 255, b: 0 },
		orange: { r: 255, g: 165, b: 0 },
		purple: { r: 128, g: 0, b: 128 },
		gray: { r: 128, g: 128, b: 128 },
		grey: { r: 128, g: 128, b: 128 }
	};

	return named[s] || null;
}

function colorKey(c: RGB): string {
	return `${c.r},${c.g},${c.b}`;
}

// ── RTF text escaping ──

function escapeRtf(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const code = text.charCodeAt(i);

		if (ch === '\\') out += '\\\\';
		else if (ch === '{') out += '\\{';
		else if (ch === '}') out += '\\}';
		else if (code > 127) {
			out += `\\u${code}\\'3f`;
		} else {
			out += ch;
		}
	}
	return out;
}

// ── DOM walker / RTF generator ──

export function htmlToRtf(editorEl: HTMLElement): string {
	const colorMap = new Map<string, RGB>();
	colorMap.set('0,0,0', { r: 0, g: 0, b: 0 });

	collectColors(editorEl, colorMap);

	const colors = Array.from(colorMap.values());

	const colorIndex = new Map<string, number>();
	colors.forEach((c, i) => {
		colorIndex.set(colorKey(c), i + 1);
	});

	// Emit a leading auto/default color entry for broad RTF compatibility:
	// \cf0 = auto, first explicit color starts at \cf1.
	let colorTable = '{\\colortbl;';
	for (const c of colors) {
		colorTable += `\\red${c.r}\\green${c.g}\\blue${c.b};`;
	}
	colorTable += '}';

	const fontTable =
		'{\\fonttbl' +
		'{\\f0\\fswiss\\fcharset0 Helvetica;}' +
		'{\\f1\\froman\\fcharset0 Georgia;}' +
		'{\\f2\\fmodern\\fcharset0 Courier New;}' +
		'}';

	const body = walkChildren(editorEl, { colorIndex, inPre: false, listCounter: 0 });

	const rtf =
		'{\\rtf1\\ansi\\ansicpg1252\\deff0' +
		fontTable +
		colorTable +
		'\\viewkind4\\uc1' +
		'\\pard\\f0\\fs24 ' +
		body +
		'}';

	return rtf;
}

function addColor(colorStr: string | null | undefined, colorMap: Map<string, RGB>): void {
	if (!colorStr) return;
	const c = parseColor(colorStr);
	if (c) colorMap.set(colorKey(c), c);
}

function collectColors(el: HTMLElement, colorMap: Map<string, RGB>): void {
	addColor(el.style?.color, colorMap);
	// <font color="..."> is produced by execCommand('foreColor')
	if (el.tagName?.toLowerCase() === 'font') addColor(el.getAttribute('color'), colorMap);
	for (const child of el.children) collectColors(child as HTMLElement, colorMap);
}

function walkChildren(parent: Node, ctx: WalkContext): string {
	let rtf = '';
	const children = parent.childNodes;

	for (let i = 0; i < children.length; i++) {
		const node = children[i];

		if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent || '';
			if (ctx.inPre) {
				rtf += escapeRtf(text).replace(/\n/g, '\\line\n');
			} else {
				rtf += escapeRtf(text);
			}
			continue;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) continue;

		const el = node as HTMLElement;
		const tag = el.tagName.toLowerCase();

		switch (tag) {
			case 'h1':
				rtf += `\\pard\\f1\\fs48\\b ${walkChildren(el, ctx)}\\b0\\f0\\fs24\\par\n`;
				break;

			case 'h2':
				rtf += `\\pard\\f1\\fs36\\b ${walkChildren(el, ctx)}\\b0\\f0\\fs24\\par\n`;
				break;

			case 'h3':
				rtf += `\\pard\\f0\\fs28\\b ${walkChildren(el, ctx)}\\b0\\fs24\\par\n`;
				break;

			case 'p':
			case 'div': {
				// A <p> with no children or only a single <br> is a blank line —
				// emit a bare \par rather than \pard \line\par, which adds an extra line.
				const isBlankLine =
					el.childNodes.length === 0 ||
					(el.childNodes.length === 1 && el.childNodes[0].nodeName === 'BR');
				if (isBlankLine) {
					rtf += '\\par\n';
					break;
				}
				const inlineRtf = walkChildren(el, ctx);
				const colorPrefix = getColorPrefix(el, ctx);
				const colorSuffix = colorPrefix ? '\\cf0 ' : '';
				rtf += `\\pard ${colorPrefix}${inlineRtf}${colorSuffix}\\par\n`;
				break;
			}

			case 'blockquote':
				rtf += `\\pard\\li720\\i ${walkChildren(el, ctx)}\\i0\\par\n`;
				break;

			case 'pre':
				rtf += `\\pard\\f2\\fs20 ${walkChildren(el, { ...ctx, inPre: true })}\\f0\\fs24\\par\n`;
				break;

			case 'hr':
				rtf += `\\pard\\qc \\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\emdash\\par\n`;
				break;

			case 'ul': {
				const items = el.querySelectorAll(':scope > li');
				items.forEach((li) => {
					rtf += `\\pard\\li720\\fi-360\\bullet\\tab ${walkChildren(li, ctx)}\\par\n`;
				});
				break;
			}

			case 'ol': {
				let counter = 1;
				const items = el.querySelectorAll(':scope > li');
				items.forEach((li) => {
					rtf += `\\pard\\li720\\fi-360 ${counter}.\\tab ${walkChildren(li, ctx)}\\par\n`;
					counter++;
				});
				break;
			}

			case 'li':
				rtf += walkChildren(el, ctx);
				break;

			case 'strong':
			case 'b':
				rtf += `\\b ${walkChildren(el, ctx)}\\b0 `;
				break;

			case 'em':
			case 'i':
				rtf += `\\i ${walkChildren(el, ctx)}\\i0 `;
				break;

			case 'u':
				rtf += `\\ul ${walkChildren(el, ctx)}\\ulnone `;
				break;

			case 's':
			case 'strike':
			case 'del':
				rtf += `\\strike ${walkChildren(el, ctx)}\\strike0 `;
				break;

			case 'sup':
				rtf += `\\super ${walkChildren(el, ctx)}\\nosupersub `;
				break;

			case 'sub':
				rtf += `\\sub ${walkChildren(el, ctx)}\\nosupersub `;
				break;

			case 'code':
				if (!ctx.inPre) {
					rtf += `\\f2 ${walkChildren(el, ctx)}\\f0 `;
				} else {
					rtf += walkChildren(el, ctx);
				}
				break;

			case 'a': {
				const href = el.getAttribute('href') || '';
				const inner = walkChildren(el, ctx);
				if (href) {
					rtf += `{\\field{\\*\\fldinst HYPERLINK "${escapeRtf(href)}"}{\\fldrslt\\ul\\cf1 ${inner}\\cf0\\ulnone }}`;
				} else {
					rtf += inner;
				}
				break;
			}

			case 'img': {
				const alt = el.getAttribute('alt') || '';
				const src = el.getAttribute('src') || '';
				const label = alt || src || '[image]';
				rtf += `\\pard\\i [Image: ${escapeRtf(label)}]\\i0\\par\n`;
				break;
			}

			case 'br':
				rtf += '\\line\n';
				break;

			case 'span': {
				const colorPfx = getColorPrefix(el, ctx);
				const sizePfx = getSizePrefix(el);
				const sizesfx = sizePfx ? '\\fs24 ' : '';
				const colorSfx = colorPfx ? '\\cf0 ' : '';

				rtf += `${colorPfx}${sizePfx}${walkChildren(el, ctx)}${sizesfx}${colorSfx}`;
				break;
			}

			// <font color="..."> is produced by execCommand('foreColor') in contenteditable
			case 'font': {
				const colorPfx = getColorPrefix(el, ctx);
				const colorSfx = colorPfx ? '\\cf0 ' : '';
				rtf += `${colorPfx}${walkChildren(el, ctx)}${colorSfx}`;
				break;
			}

			default:
				rtf += walkChildren(el, ctx);
				break;
		}
	}

	return rtf;
}

function getColorPrefix(el: HTMLElement, ctx: WalkContext): string {
	// Support both inline style.color (spans) and the color attribute (<font>)
	const color = el.style?.color ||
		(el.tagName.toLowerCase() === 'font' ? (el.getAttribute('color') ?? '') : '');
	if (!color) return '';
	const c = parseColor(color);
	if (!c) return '';
	const idx = ctx.colorIndex.get(colorKey(c));
	if (idx != null) return `\\cf${idx} `;
	return '';
}

function getSizePrefix(el: HTMLElement): string {
	const fs = el.style?.fontSize;
	if (!fs) return '';
	const ptMatch = fs.match(/([\d.]+)\s*pt/);
	if (ptMatch) {
		const halfPoints = Math.round(parseFloat(ptMatch[1]) * 2);
		return `\\fs${halfPoints} `;
	}
	const pxMatch = fs.match(/([\d.]+)\s*px/);
	if (pxMatch) {
		const halfPoints = Math.round(parseFloat(pxMatch[1]) * 0.75 * 2);
		return `\\fs${halfPoints} `;
	}
	return '';
}
