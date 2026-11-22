/**
 * RTF to HTML converter
 *
 * Parses RTF control words and groups into an HTML string.
 * Supports: bold, italic, underline, strikethrough, super/subscript,
 * font size, foreground color (\cf), highlight background color (\highlight),
 * color table, font table (monospace text reads as code), paragraphs with their
 * alignment and indents, headings, bullet/numbered lists, hyperlinks, tables with
 * merged cells, embedded pictures (\pict PNG/JPEG blips, with captions),
 * Unicode characters, Windows-1252 hex escapes, and nested groups.
 *
 * \cb (character background) is silently ignored on import.
 */

import {
	HEADING_SCALE,
	PRE_SCALE,
	LINK_COLOR,
	DEFAULT_FONT_FAMILY,
	fontChoices,
	fontKey,
	isMonospaceFontName,
	linkTarget,
	normalizeFontSize,
	hardToReadOnWhite,
	LEAST_LINES
} from './rtf-writer.js';
import { letterReadings, listTypeAttribute, type LetterReading, type NumberStyle } from './list-markers.js';

// ── Types ──

interface RtfGroup {
	type: 'group';
	children: RtfNode[];
}

interface RtfControl {
	type: 'control';
	word: string;
	param: number | null;
}

interface RtfText {
	type: 'text';
	value: string;
	/** A \'xx escape: one character to a \u fallback count, even when it decodes to nothing. */
	hex?: boolean;
}

type RtfNode = RtfGroup | RtfControl | RtfText;

interface RenderState {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	super_: boolean;
	sub: boolean;
	fontSize: number;
	colorIndex: number;
	highlightIndex: number;
	/**
	 * The background of the text, as an index of the color table: \cb and \chcbpat (character
	 * shading), and \cbpat, the shading of the paragraph, which holds until \pard. Shading is
	 * not shown; it is read to know which words were colored to stand on it (see readsOnWhite).
	 */
	backIndex: number;
	paragraphBackIndex: number;
	fontIndex: number;
	ucSkip: number;
	inList: boolean;
	/** \v: hidden text, which Word does not show. \deleted: text a tracked change took out. */
	hidden: boolean;
	deleted: boolean;
	/** \ql, \qc, \qr, \qj: like the indents, it holds until \pard and ends with its group. */
	align: string;
	/** The address of the link this text is in ({\field{\*\fldinst HYPERLINK …}}), or ''. */
	link: string;
	/**
	 * Paragraph indents in twips: \li (left), \ri (right) and \fi (first line, negative when the
	 * paragraph hangs). They hold from one paragraph to the next until \pard, and like the rest of
	 * this state they end with the group they were set in: a \pard inside {\listtext ...} or
	 * {\pntext ...} does not reach the paragraph around it.
	 */
	leftIndent: number;
	rightIndent: number;
	firstLineIndent: number;
	/**
	 * Paragraph spacing, which holds and ends as the indents do: \sb and \sa in twips (the space
	 * before and after), and \sl with \slmult for the lines. \sl counts in 240ths of a line
	 * where \slmult is 1; else it is a height in twips, exactly that where it is below zero
	 * and at least that above.
	 */
	spaceBefore: number;
	spaceAfter: number;
	lineSpacing: number;
	lineMultiple: boolean;
}

/**
 * The character formatting one piece of text is shown with. Only what shows is kept: a color
 * index with no entry in the table, black, and the underline and color a link has anyway are all
 * "none" here, so two pieces that look the same are the same, and are joined.
 */
interface RunFormat {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	super_: boolean;
	sub: boolean;
	/** In half-points. */
	fontSize: number;
	/** The text color as CSS, or '' for the reader's own. */
	color: string;
	/** The highlight color as CSS, or ''. */
	background: string;
	/** Set in a monospace font that is not the document's own font: code. */
	mono: boolean;
	/** The font the text is set in, as CSS, where it is one the application offers; or ''. */
	font: string;
	link: string;
}

/**
 * A paragraph is kept as its pieces until the whole document is read, because what a piece
 * becomes depends on the paragraph around it: the size on a heading's text is the heading's, the
 * bullet and tab that open a list item are the list's, and a paragraph set wholly in the code
 * font is a code block.
 */
type Run =
	| { type: 'text'; text: string; fmt: RunFormat }
	| {
			type: 'html';
			kind: 'br' | 'tab' | 'gap' | 'img';
			html: string;
			fmt: RunFormat;
			/** On the line break a paragraph mark in a table cell is read as: that paragraph's spacing. */
			spacing?: CellSpacing | null;
	  };

/** The spacing of a paragraph in a table cell, which the cell's paragraphs are read with where one has any. */
type CellSpacing = Pick<ParagraphBlock, 'before' | 'after' | 'line' | 'lineMultiple'>;

/** A bullet or a number, then a tab, at the start of a paragraph. */
interface ListMarker {
	kind: 'ul' | 'ol';
	/** The number of a numbered item. */
	number: number;
	/** The marker of an item numbered in letters, without its period: "C", "iv". */
	letters?: string;
	/** Index of the first run after the marker and its tab. */
	end: number;
}

interface ParagraphBlock {
	kind: 'paragraph';
	runs: Run[];
	align: string;
	/** \li, \ri and \fi in twips. */
	left: number;
	right: number;
	first: number;
	/** \sb, \sa and \sl (with whether \slmult1 makes it a count of lines). */
	before: number;
	after: number;
	line: number;
	lineMultiple: boolean;
	/** Tagged by {\*\inkcap}: the description of the figure above it. */
	caption: boolean;
	marker: ListMarker | null;
	/** Cell text that never met its \cell: its indents are the cell's, not a paragraph's. */
	inTable: boolean;
}

type Block =
	| ParagraphBlock
	| { kind: 'table'; html: string }
	| { kind: 'rule'; pageBreak: boolean };

/** One \cellx of a row definition, with the cell properties written before it. */
interface CellDef {
	right: number;
	/**
	 * A header cell, as the writer marks one: a bottom border and no other. Word and TextEdit put
	 * all four borders on every cell of a gridded table, and those cells are not headers.
	 */
	header: boolean;
	/** \clvmgf: the first cell of a vertical merge. \clvmrg: a cell merged into the one above. */
	vmgf: boolean;
	vmrg: boolean;
	/** \clmgf and \clmrg, the same for a horizontal merge. */
	hmgf: boolean;
	hmrg: boolean;
	/** \clcbpat: the shading of the cell as CSS, or ''. It is not shown (see readsOnWhite). */
	shade: string;
	/** The cell's borders (\clbrdrt, \clbrdrl, \clbrdrb, \clbrdrr with a line, a width and a color). */
	borders: Partial<Record<BorderEdge, BorderRead>>;
	/** The edge a \clbrdrX just named, until a line (\brdrs…) draws it or \brdrnone clears it. */
	edge: BorderEdge | null;
	/** The edge whose line was read last, which a \brdrw or \brdrcf after it belongs to. */
	drawn: BorderEdge | null;
}

type BorderEdge = 't' | 'l' | 'b' | 'r';
interface BorderRead {
	/** The line as CSS names it. */
	line: string;
	twips: number;
	/** Its color as CSS, or '' for the text's own. */
	color: string;
}
/** The lines RTF names that CSS has too; any other is a plain line. */
const BORDER_LINE_CSS: ReadonlyMap<string, string> = new Map(
	Object.entries({ brdrdb: 'double', brdrdot: 'dotted', brdrdash: 'dashed', brdrdashsm: 'dashed', brdrdashd: 'dashed', brdrdashdd: 'dashed' })
);

/**
 * A cell's borders as CSS, which the writer reads back as the same: "border:1px solid;" where
 * all four are one, else each side that has one. A width is given in px, 15 twips each, as
 * the writer counts them.
 */
function bordersStyle(borders: Partial<Record<BorderEdge, BorderRead>>): string {
	const css = (b: BorderRead | undefined) =>
		b ? `${Math.round((Math.max(1, Math.min(b.twips, 75)) / 15) * 100) / 100}px ${b.line}${b.color ? ` ${b.color}` : ''}` : '';
	const sides = [css(borders.t), css(borders.r), css(borders.b), css(borders.l)];
	if (sides[0] && sides.every((side) => side === sides[0])) return `border:${sides[0]};`;
	return ['top', 'right', 'bottom', 'left'].map((name, i) => (sides[i] ? `border-${name}:${sides[i]};` : '')).join('');
}

interface RowCell {
	html: string;
	/** The same with the colors left out that cannot be read on white, where it has any: what a shaded cell shows. */
	onWhite?: string;
	align: string;
	/** Marked a header cell in what it holds ({\*\inkth}), as the writer marks one that has borders. */
	header?: boolean;
}

interface TableRow {
	cells: RowCell[];
	defs: CellDef[];
	/** \trgaph: half the space between the text of two cells, in twips; null where the row says none. */
	gaph?: number | null;
}

// ── Highlight palette (RTF \highlight 1-16) ──

const HIGHLIGHT_COLORS: Record<number, string> = {
	1:  '#000000', // Black
	2:  '#0000ff', // Blue
	3:  '#00ffff', // Cyan
	4:  '#00ff00', // Green
	5:  '#ff00ff', // Magenta
	6:  '#ff0000', // Red
	7:  '#ffff00', // Yellow
	8:  '#ffffff', // White
	9:  '#000080', // Dark Blue
	10: '#008080', // Dark Cyan
	11: '#008000', // Dark Green
	12: '#800080', // Dark Magenta
	13: '#800000', // Dark Red
	14: '#808000', // Dark Yellow
	15: '#808080', // Dark Gray
	16: '#c0c0c0', // Light Gray
};

// ── Picture helpers ──

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 1 px at 96 dpi = 15 twips. */
const TWIPS_PER_PX = 15;

/** The widest a picture is shown, in px: 22 inches, the largest page Word has. */
const MAX_PICTURE_PX = 31680 / TWIPS_PER_PX;

/**
 * A paragraph made up of one picture and nothing else is rendered as a <figure>. Two pictures in
 * a paragraph stay a paragraph: a figure is written back as its picture and its caption.
 */
const IMAGE_ONLY_PARAGRAPH = /^<img\b[^>]*>$/;

/** Nibble value of each hex digit's char code; -1 for anything else. */
const HEX_NIBBLE = (() => {
	const table = new Int8Array(128).fill(-1);
	for (let i = 0; i < 10; i++) table[48 + i] = i; // '0'–'9'
	for (let i = 0; i < 6; i++) {
		table[97 + i] = 10 + i; // 'a'–'f'
		table[65 + i] = 10 + i; // 'A'–'F'
	}
	return table;
})();

/** A tab as the editor's Tab key inserts it (Chromium's own shape for a typed tab). */
const TAB_HTML = '<span style="white-space:pre">\t</span>';

/** Text so far holding only a list marker: a bullet, or a number and a period. */
const LIST_MARKER = /^\s*(?:\u2022|(\d+)\.)\s*$/;

/** The same for an item numbered in letters or Roman numerals: "C.", "iv.". */
const LETTER_MARKER = /^\s*([A-Z]{1,15}|[a-z]{1,15})\.\s*$/;

/**
 * The bullet Word writes inside {\listtext …} and {\pntext …}: byte B7 of the Symbol font, which
 * arrives as a middle dot or as the font's private-use character.
 */
const SYMBOL_BULLET = /^\s*[\u00b7\uf0b7]\s*$/;

/** U+2028, the line separator, and U+2029, the paragraph separator. */
const LINE_SEPARATOR = /[\u2028\u2029]/;

/** Text a browser shows as nothing but space. */
const ONLY_SPACES = /^[ \t\r\n\f]*$/;

/** The rule the writer sends for <hr>: a centered line of this many em dashes. */
const RULE_DASHES = '\u2014'.repeat(20);

/** A hanging indent of this many twips is the one the writer gives a list item (\fi-360). */
const LIST_HANG = 360;

/** The longest number a numbered list item is read with. */
const MAX_LIST_NUMBER_DIGITS = 9;

/** Each level of a list is indented this much further (\li720). */
const LIST_STEP = 720;

/**
 * The largest RTF string rtfToHtml reads unless told otherwise: 50 MB. A document is parsed in
 * one go on the main thread, and a picture is decoded from two characters per byte, so the size
 * of what is handed in is the only bound on how long the page stops responding.
 */
export const DEFAULT_MAX_RTF_BYTES = 50 * 1024 * 1024;

/** A byte count as people read it: "52.4 MB", rounded up when asked. */
function megabytes(n: number, roundUp = false): string {
	const tenths = (n / (1024 * 1024)) * 10;
	return `${((roundUp ? Math.ceil(tenths) : Math.round(tenths)) / 10).toFixed(1)} MB`;
}

/**
 * "52.4 MB, and the limit is 50.0 MB". A size just over the limit is rounded up, so it does not
 * read as "50.0 MB, and the limit is 50.0 MB".
 */
function overLimit(size: number, limit: number): string {
	let shown = megabytes(size);
	if (shown === megabytes(limit)) shown = megabytes(size, true);
	// Still the same at a tenth of a megabyte (a limit of its own, just under the size): bytes.
	if (shown === megabytes(limit)) return `${size} bytes, and the limit is ${limit} bytes`;
	return `${shown}, and the limit is ${megabytes(limit)}`;
}

/** Hex picture data → base64, without depending on btoa/Buffer. */
function hexToBase64(hex: string): string {
	const byteCount = hex.length >> 1;
	// A multi-MB picture runs to millions of digits, so this reads char codes
	// against a lookup table rather than slicing and parsing per byte, and
	// collects into an array rather than concatenating per output character.
	const out: string[] = new Array(Math.ceil(byteCount / 3) * 4);
	let written = 0;
	let buffer = 0;
	let bits = 0;

	for (let i = 0; i < byteCount; i++) {
		const hi = HEX_NIBBLE[hex.charCodeAt(i * 2)] ?? -1;
		const lo = HEX_NIBBLE[hex.charCodeAt(i * 2 + 1)] ?? -1;
		if (hi < 0 || lo < 0) return '';
		buffer = (buffer << 8) | ((hi << 4) | lo);
		bits += 8;
		while (bits >= 6) {
			bits -= 6;
			out[written++] = B64_ALPHABET[(buffer >> bits) & 0x3f];
		}
	}

	if (bits > 0) {
		out[written++] = B64_ALPHABET[(buffer << (6 - bits)) & 0x3f];
	}
	while (written % 4 !== 0) out[written++] = '=';

	out.length = written;
	return out.join('');
}

/**
 * Render a {\pict …} group as an <img> with a data URL. Returns '' for picture
 * formats a browser cannot display (metafiles, device-dependent bitmaps).
 *
 * Only hexadecimal picture data is read. RTF also allows \binN, where the next
 * N bytes are raw binary: rare outside of Word's own output. Such a picture is
 * skipped rather than mis-decoded: parseTree steps over the bytes, so nothing
 * of it is left here.
 */
function renderPicture(group: RtfGroup): string {
	let mime = '';
	let picw = 0, pich = 0, wgoal = 0, hgoal = 0;
	let scaleX = 100, scaleY = 100;
	const hexParts: string[] = [];

	for (const node of group.children) {
		if (node.type === 'control') {
			switch (node.word) {
				case 'pngblip': mime = 'image/png'; break;
				case 'jpegblip': mime = 'image/jpeg'; break;
				case 'picw': picw = node.param ?? 0; break;
				case 'pich': pich = node.param ?? 0; break;
				case 'picwgoal': wgoal = node.param ?? 0; break;
				case 'pichgoal': hgoal = node.param ?? 0; break;
				case 'picscalex': scaleX = node.param ?? 100; break;
				case 'picscaley': scaleY = node.param ?? 100; break;
				default: break;
			}
		} else if (node.type === 'text') {
			hexParts.push(node.value);
		}
		// Nested groups such as {\*\blipuid …} carry no picture data.
	}

	if (!mime) return '';

	const hex = hexParts.join('').replace(/[^0-9a-fA-F]/g, '');
	if (hex.length < 8) return '';
	// The bytes say what the picture is, where they say it: a PNG written as \jpegblip is a PNG.
	const signature = hex.slice(0, 8).toLowerCase();
	if (signature === '89504e47') mime = 'image/png';
	else if (signature.startsWith('ffd8ff')) mime = 'image/jpeg';

	const base64 = hexToBase64(hex);
	if (!base64) return '';

	// \picwgoal is the size the picture was placed at and \picscalex a percentage of it: Word
	// writes a picture someone dragged to half size as \picscalex50, with the goal unchanged.
	if (scaleX <= 0) scaleX = 100;
	if (scaleY <= 0) scaleY = 100;
	// (No wider than the largest page there is, 22 inches: a damaged \picwgoal gave a width of
	// billions of pixels.)
	const widthPx = Math.min(MAX_PICTURE_PX, Math.round(((wgoal ? wgoal / TWIPS_PER_PX : picw) * scaleX) / 100));
	const heightPx = Math.round(((hgoal ? hgoal / TWIPS_PER_PX : pich) * scaleY) / 100);

	const styles: string[] = [];
	if (widthPx > 0) styles.push(`width:${widthPx}px`);
	if (widthPx > 0 && heightPx > 0) styles.push('height:auto');
	const style = styles.length ? ` style="${styles.join(';')}"` : '';

	return `<img src="data:${mime};base64,${base64}"${style} alt="">`;
}

/**
 * The pictures of an RTF document, in the order they are in it: each as the data address a
 * browser shows (PNG or JPEG), or null for one it cannot show (a metafile).
 *
 * Word copies a picture to the clipboard twice: in its HTML as the address of a file on the
 * writer's own disk, which no page may open, and in its RTF as the picture itself. So the
 * pictures of a paste are read from here (see pastePictures). The second copy Word writes of
 * each for older readers (\nonshppict, and a shape's \shprslt) is not counted.
 */
export function rtfPictures(rtf: string): (string | null)[] {
	let tree: RtfGroup;
	try {
		tree = parseTree(rtf);
	} catch {
		return [];
	}
	const pictures: (string | null)[] = [];
	const todo: RtfGroup[] = [tree];
	while (todo.length > 0) {
		const group = todo.pop()!;
		const first = group.children.find((n): n is RtfControl => n.type === 'control' && n.word !== '*');
		if (first?.word === 'nonshppict' || first?.word === 'shprslt') continue;
		if (first?.word === 'pict') {
			pictures.push(/ src="([^"]+)"/.exec(renderPicture(group))?.[1] ?? null);
			continue;
		}
		for (let i = group.children.length - 1; i >= 0; i--) {
			const child = group.children[i];
			if (child.type === 'group') todo.push(child);
		}
	}
	return pictures;
}

// ── Tokenizer ──

/**
 * What \'80 to \'9f stand for in Windows-1252, the code page RTF's \ansi text is written in:
 * curly quotes, dashes, the euro sign and the like, where Latin-1 has invisible control
 * characters. \'92 is the apostrophe in "It's" as TextEdit and many Windows programs write it.
 * The five bytes Windows-1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their own value.
 */
const WINDOWS_1252_C1 = [
	0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
	0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
	0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
	0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178
];

/**
 * The character a \'xx byte stands for. A NUL is no character and decodes to nothing: it would
 * end the text where a browser or a receiving system reads it.
 */
function cp1252Char(byte: number): string {
	const code = WINDOWS_1252_C1[byte - 0x80] ?? byte;
	return code ? String.fromCharCode(code) : '';
}

/**
 * The deepest group the tree holds. Thousands of nested groups (damaged or hostile input) are
 * nothing a real document has: those nest a few dozen deep at most. Groups below this depth are
 * folded into the one at it: their text is kept, and their formatting carries on to the end of
 * that group.
 */
const MAX_GROUP_DEPTH = 500;

/**
 * The most pieces (groups, control words, runs of text) a document is read into. Each costs
 * memory, and a file well inside the size limit can be made of nothing but braces: 36 MB of them
 * ran a process out of 4 GB. A report has thousands of pieces, a long Word document some hundreds
 * of thousands; picture data is one for each line of the file it takes up.
 */
const MAX_NODES = 5_000_000;

/** C0 control characters other than tab, and DEL: no reader shows them, and NUL ends a string for some. */
const CONTROL_CHARACTER = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const CONTROL_CHARACTERS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** RTF text as a tree of groups, control words and text. */
function parseTree(rtf: string): RtfGroup {
	const root: RtfGroup = { type: 'group', children: [] };
	const stack: RtfGroup[] = [root];
	let current = root;
	/** Groups opened past MAX_GROUP_DEPTH and not closed yet. */
	let folded = 0;
	let count = 0;
	const add = (node: RtfNode): void => {
		if (++count > MAX_NODES) {
			throw new RangeError('This document is too complex to show: it has more than 5 million parts');
		}
		current.children.push(node);
	};

	let i = 0;
	const len = rtf.length;

	while (i < len) {
		const ch = rtf[i];

		if (ch === '{') {
			if (stack.length > MAX_GROUP_DEPTH) {
				folded++;
			} else {
				const group: RtfGroup = { type: 'group', children: [] };
				add(group);
				stack.push(group);
				current = group;
			}
			i++;
		} else if (ch === '}') {
			if (folded > 0) folded--;
			else if (stack.length > 1) {
				stack.pop();
				current = stack[stack.length - 1];
			}
			i++;
		} else if (ch === '\\') {
			i++;
			if (i >= len) break;

			const next = rtf[i];

			// Hex escape \'xx: one byte of Windows-1252.
			if (next === "'") {
				i++;
				const hi = HEX_NIBBLE[rtf.charCodeAt(i)] ?? -1;
				const lo = HEX_NIBBLE[rtf.charCodeAt(i + 1)] ?? -1;
				// A \' with no two hex digits after it is damage, not a character: it is
				// dropped, and what follows is read as it stands. (parseInt on it gave NaN,
				// which became a NUL in the HTML.)
				if (hi >= 0 && lo >= 0) {
					i += 2;
					const byte = (hi << 4) | lo;
					// A control character written as an escape is no more text than one written
					// as itself: a tab is a tab, the rest are dropped.
					// (Dropped as an empty piece, so that it still counts as the one character
					// that stands in for the Unicode escape before it.)
					if (byte === 9) add({ type: 'control', word: 'tab', param: null });
					else add({ type: 'text', value: byte >= 0x20 && byte !== 0x7f ? cp1252Char(byte) : '', hex: true });
				}
			}
			// Special escapes
			else if (next === '\\' || next === '{' || next === '}') {
				add({ type: 'text', value: next });
				i++;
			}
			// Line breaks as control
			else if (next === '\n' || next === '\r') {
				add({ type: 'control', word: 'par', param: null });
				i++;
				if (i < len && rtf[i] === '\n') i++;
			}
			// Tilde = non-breaking space
			else if (next === '~') {
				add({ type: 'text', value: '\u00A0' });
				i++;
			}
			// Hyphen shortcuts
			else if (next === '-') {
				add({ type: 'text', value: '\u00AD' }); // soft hyphen
				i++;
			} else if (next === '_') {
				add({ type: 'text', value: '\u2011' }); // non-breaking hyphen
				i++;
			}
			// Control word or control symbol
			else if (/[a-zA-Z]/.test(next)) {
				let word = '';
				while (i < len && /[a-zA-Z]/.test(rtf[i])) {
					word += rtf[i];
					i++;
				}
				// Optional numeric parameter (can be negative)
				let param: number | null = null;
				if (i < len && (rtf[i] === '-' || /[0-9]/.test(rtf[i]))) {
					let numStr = '';
					if (rtf[i] === '-') {
						numStr += '-';
						i++;
					}
					while (i < len && /[0-9]/.test(rtf[i])) {
						numStr += rtf[i];
						i++;
					}
					// A lone "-" is no number.
					const value = parseInt(numStr, 10);
					param = Number.isFinite(value) ? value : null;
				}
				// Consume optional trailing space delimiter
				if (i < len && rtf[i] === ' ') i++;

				// \binN: the next N bytes are raw picture data, not RTF. They are stepped over
				// whole: read as RTF, a brace among them closed the group, and with enough of
				// them the document, and everything after was gone. (readRtfFile reads a file
				// one character to the byte, so N characters is N bytes.)
				if (word === 'bin' && param != null && param > 0) {
					i += param;
					continue;
				}
				add({ type: 'control', word, param });
			}
			// Control symbol (single non-alpha char)
			else {
				add({ type: 'control', word: next, param: null });
				i++;
			}
		} else if (ch === '\r' || ch === '\n') {
			// Skip bare newlines (they're not meaningful in RTF)
			i++;
		} else if (ch === '\t') {
			// A tab character is a tab, the same as \tab: TextEdit writes every tab this way.
			add({ type: 'control', word: 'tab', param: null });
			i++;
		} else {
			// Plain text — slice up to the next special char. Slicing rather than
			// appending char-by-char keeps embedded picture data (which arrives as
			// one very long text run) from being quadratic.
			const start = i;
			while (i < len) {
				const c = rtf[i];
				if (c === '\\' || c === '{' || c === '}' || c === '\r' || c === '\n' || c === '\t') break;
				i++;
			}
			let value = rtf.substring(start, i);
			if (CONTROL_CHARACTER.test(value)) value = value.replace(CONTROL_CHARACTERS, '');
			if (value) add({ type: 'text', value });
		}
	}

	return root;
}

// ── Color table parser ──

/** A color component as a reader may use it: a damaged table can hold \red999 or \green-5. */
function colorComponent(value: number | null): number {
	return Math.min(255, Math.max(0, value ?? 0));
}

function parseColorTable(group: RtfGroup): string[] {
	const colors: string[] = [''];  // index 0 = auto/default
	let r = 0, g = 0, b = 0;
	let hasComponents = false;

	function finalizeEntry() {
		// In standard RTF, a leading ";" represents the auto color (index 0).
		// We already reserve colors[0] for auto, so do not append another entry.
		if (colors.length === 1 && !hasComponents) return;
		colors.push(`rgb(${r},${g},${b})`);
	}

	for (const node of group.children) {
		if (node.type === 'control') {
			if (node.word === 'red') { r = colorComponent(node.param); hasComponents = true; }
			else if (node.word === 'green') { g = colorComponent(node.param); hasComponents = true; }
			else if (node.word === 'blue') { b = colorComponent(node.param); hasComponents = true; }
		} else if (node.type === 'text' && node.value.includes(';')) {
			// Each ';' terminates one color entry
			const semiCount = (node.value.match(/;/g) || []).length;
			for (let i = 0; i < semiCount; i++) {
				finalizeEntry();
				r = 0; g = 0; b = 0;
				hasComponents = false;
			}
		}
	}

	return colors;
}

// ── Font table parser ──

/**
 * What each byte of the Symbol font shows, from 0x20 to 0xFF: Greek letters where the Latin ones
 * are, and mathematical signs. Text set in Symbol is stored as those bytes, so "5 mg" with its m
 * in Symbol is 5 micrograms. The table is the one macOS reads Symbol text with; 0 is a byte the font has
 * nothing for.
 */
const SYMBOL_FONT = [
	0x0020, 0x0021, 0x2200, 0x0023, 0x2203, 0x0025, 0x0026, 0x220d, 0x0028, 0x0029, 0x2217, 0x002b, 0x002c, 0x2212, 0x002e, 0x002f,
	0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0039, 0x003a, 0x003b, 0x003c, 0x003d, 0x003e, 0x003f,
	0x2245, 0x0391, 0x0392, 0x03a7, 0x0394, 0x0395, 0x03a6, 0x0393, 0x0397, 0x0399, 0x03d1, 0x039a, 0x039b, 0x039c, 0x039d, 0x039f,
	0x03a0, 0x0398, 0x03a1, 0x03a3, 0x03a4, 0x03a5, 0x03c2, 0x03a9, 0x039e, 0x03a8, 0x0396, 0x005b, 0x2234, 0x005d, 0x22a5, 0x005f,
	0x203e, 0x03b1, 0x03b2, 0x03c7, 0x03b4, 0x03b5, 0x03c6, 0x03b3, 0x03b7, 0x03b9, 0x03d5, 0x03ba, 0x03bb, 0x03bc, 0x03bd, 0x03bf,
	0x03c0, 0x03b8, 0x03c1, 0x03c3, 0x03c4, 0x03c5, 0x03d6, 0x03c9, 0x03be, 0x03c8, 0x03b6, 0x007b, 0x007c, 0x007d, 0x223c, 0,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	0x20ac, 0x03d2, 0x2032, 0x2264, 0x2044, 0x221e, 0x0192, 0x2663, 0x2666, 0x2665, 0x2660, 0x2194, 0x2190, 0x2191, 0x2192, 0x2193,
	0x00b0, 0x00b1, 0x2033, 0x2265, 0x00d7, 0x221d, 0x2202, 0x2022, 0x00f7, 0x2260, 0x2261, 0x2248, 0x2026, 0x23d0, 0x23af, 0x21b5,
	0x2135, 0x2111, 0x211c, 0x2118, 0x2297, 0x2295, 0x2205, 0x2229, 0x222a, 0x2283, 0x2287, 0x2284, 0x2282, 0x2286, 0x2208, 0x2209,
	0x2220, 0x2207, 0x00ae, 0x00a9, 0x2122, 0x220f, 0x221a, 0x22c5, 0x00ac, 0x2227, 0x2228, 0x21d4, 0x21d0, 0x21d1, 0x21d2, 0x21d3,
	0x25ca, 0x3008, 0x00ae, 0x00a9, 0x2122, 0x2211, 0x239b, 0x239c, 0x239d, 0x23a1, 0x23a2, 0x23a3, 0x23a7, 0x23a8, 0x23a9, 0x23aa,
	0, 0x3009, 0x222b, 0x2320, 0x23ae, 0x2321, 0x239e, 0x239f, 0x23a0, 0x23a4, 0x23a5, 0x23a6, 0x23ab, 0x23ac, 0x23ad, 0
];

/** A font named Symbol, or Symbol MT. */
function isSymbolFontName(name: string): boolean {
	return /^symbol(?: ?mt)?$/i.test(name.trim());
}

/** Text set in the Symbol font as the characters it shows. */
function symbolText(text: string): string {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		let code = text.charCodeAt(i);
		// Word writes a Symbol character as U+F000 plus its byte.
		if (code >= 0xf020 && code <= 0xf0ff) code -= 0xf000;
		const shown = code >= 0x20 && code <= 0xff ? SYMBOL_FONT[code - 0x20] : 0;
		out += shown ? String.fromCharCode(shown) : text[i];
	}
	return out;
}

/**
 * The numbers of the fonts that are monospace, and of the ones that are Symbol. A font is
 * monospace when it is named like one (Courier New, Consolas), or declared \fmodern or
 * fixed-pitch (\fprq1). It is Symbol when it is named Symbol and declared in the symbol
 * character set (\fcharset2), which is how Word declares it: only then are its bytes places in
 * that font. TextEdit declares its Symbol font in the Mac character set (\fcharset77), where a
 * byte is an ordinary character, and Apple's reader maps neither that nor a Symbol with no
 * character set. Reads both shapes a font table comes in: one group per font
 * ({\f1\fmodern Courier New;}), and TextEdit's run of entries with no groups
 * (\f0\fswiss Helvetica;\f1\fmodern Courier;).
 */
function readFontTable(group: RtfGroup): { mono: Set<number>; symbol: Set<number>; names: Map<number, string> } {
	const mono = new Set<number>();
	const symbol = new Set<number>();
	const names = new Map<number, string>();
	let num: number | null = null;
	let name = '';
	let fixed = false;
	let symbolSet = false;

	const finish = () => {
		if (num != null) {
			if (fixed || isMonospaceFontName(name)) mono.add(num);
			if (symbolSet && isSymbolFontName(name)) symbol.add(num);
			names.set(num, name.trim());
		}
		num = null;
		name = '';
		fixed = false;
		symbolSet = false;
	};

	const read = (nodes: RtfNode[]) => {
		for (const node of nodes) {
			if (node.type === 'control') {
				if (node.word === 'f' && node.param != null) {
					if (num != null) finish();
					num = node.param;
				} else if (node.word === 'fmodern' || (node.word === 'fprq' && node.param === 1)) {
					fixed = true;
				} else if (node.word === 'fcharset') {
					symbolSet = node.param === 2;
				}
			} else if (node.type === 'text') {
				// A name ends at its ';'.
				const parts = node.value.split(';');
				name += parts[0];
				if (parts.length > 1) finish();
			}
			// A group inside an entry ({\*\panose …}, {\*\falt …}) is not part of the name.
		}
	};

	for (const child of group.children) {
		if (child.type === 'group') {
			read(child.children);
			finish();
		}
	}
	read(group.children.filter((n) => n.type !== 'group'));
	finish();

	return { mono, symbol, names };
}

/**
 * A font name as programs that name each cut of a font write it, brought back to the family:
 * TextEdit's "Helvetica-Bold", "TimesNewRomanPS-ItalicMT" and "ArialMT" are Helvetica, Times New
 * Roman and Arial. Without spaces or capitals, to be compared with a name taken the same way.
 */
function looseFontKey(name: string): string {
	return name
		.toLowerCase()
		.replace(/-(regular|roman|book|light|medium|semibold|demibold|bold|heavy|black|italic|oblique|bolditalic|boldoblique)[a-z]*$/, '')
		.replace(/(ps)?mt$/, '')
		.replace(/ps$/, '')
		.replace(/[\s_-]/g, '');
}

// ── Links ──

/** The longest field instruction looked at for a link's address. */
const MAX_FIELD_INSTRUCTION = 8192;

/**
 * The text of a field's instruction group, {\*\fldinst HYPERLINK "…"}, or null when it holds a
 * \u escape: the address would then be the fallback character's, not the one meant.
 */
function fieldInstruction(group: RtfGroup): string | null {
	let text = '';
	const pending: RtfNode[] = [...group.children].reverse();
	while (pending.length > 0) {
		const node = pending.pop()!;
		if (node.type === 'group') {
			for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
		} else if (node.type === 'control') {
			if (node.word === 'u') return null;
			// A tab between the instruction's words is a space between them.
			if (node.word === 'tab') text += ' ';
		} else {
			text += node.value;
			if (text.length > MAX_FIELD_INSTRUCTION) return null;
		}
	}
	return text;
}

/** The instruction of a {\field …} group as text, or null when it has none that can be read. */
function fieldText(field: RtfGroup): string | null {
	const instruction = field.children.find(
		(n): n is RtfGroup => n.type === 'group' && n.children.some((c) => c.type === 'control' && c.word === 'fldinst')
	);
	return instruction ? fieldInstruction(instruction) : null;
}

/**
 * The address a {\field …} group links to, or '' when it is not a link, or not one that may be
 * followed. Only what the writer itself would write is accepted (linkTarget): an absolute web,
 * mail or phone address. A javascript: or file: address, or a link to a bookmark, stays text.
 */
function fieldLink(field: RtfGroup): string {
	const text = fieldText(field);
	if (text == null) return '';
	const m = text.match(/^\s*HYPERLINK\s+(?:"([^"]*)"|([^\s"\\]\S*))/i);
	if (!m) return '';
	return linkTarget(m[1] ?? m[2] ?? '') ?? '';
}

/**
 * The character of a symbol field, {\field{\*\fldinst SYMBOL 176 \\f "Symbol"}}, which is how Word
 * stores a character put in with Insert Symbol: its number, and the font it is a character of.
 * '' when the field is not one, or its font is one whose characters are not known here
 * (Wingdings): the field's own result is shown then, as for any other field.
 */
function fieldSymbol(field: RtfGroup): string {
	const text = fieldText(field);
	if (text == null) return '';
	const m = text.match(/^\s*SYMBOL\s+(0x[0-9a-f]+|\d+)(?![0-9a-z])([\s\S]*)$/i);
	if (!m) return '';
	const code = Number(m[1]);
	const font = /\\f\s*"([^"]*)"/i.exec(m[2])?.[1] ?? /\\f\s+([^\s"\\]+)/i.exec(m[2])?.[1];
	if (font != null && isSymbolFontName(font)) {
		const byte = code >= 0xf020 && code <= 0xf0ff ? code - 0xf000 : code;
		const shown = byte >= 0x20 && byte <= 0xff ? SYMBOL_FONT[byte - 0x20] : 0;
		return shown ? String.fromCharCode(shown) : '';
	}
	// Another font: what the number shows depends on that font.
	if (font != null) return '';
	// No font: the number is the character's own. A \\u switch says Unicode; without it a
	// number below 256 is a byte of Windows-1252.
	if (code < 0x20 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
	if (code < 256 && !/\\u(?![a-z])/i.test(m[2])) return cp1252Char(code);
	return String.fromCodePoint(code);
}

// ── Body size ──

/** Groups whose content is not document text. */
const destinationWords = new Set([
	'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer',
	'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
	// \nonshppict duplicates the picture already carried by \*\shppict
	'nonshppict',
	// {\nonesttables \par} is for readers that do not know nested tables; \nestrow is read here
	'nonesttables',
	// (\object is handled where groups are read: its data is skipped and its \result shown)
	'objdata', 'objclass', 'objname', 'fldinst', 'xmlnstbl',
	// An index entry and a contents entry: text that is shown in the index, not where it is marked
	'xe', 'tc', 'tcn',
	// The drawing a shape is shown as where shapes are not read; the shape itself is read
	'shprslt', 'listtable', 'listoverridetable',
	'rsidtbl', 'generator', 'datafield', 'themedata', 'colorschememapping',
	'latentstyles', 'datastore', 'mmathPr', 'author', 'operator',
	'title', 'subject', 'doccomm', 'company', 'category', 'keywords'
]);

// ── Renderer ──

/** Options for rtfToHtml. */
export interface RtfReadOptions {
	/**
	 * The body text size of the screen the HTML will be shown on, in points:
	 * the editor's or viewer's fontSize. Text at this size carries no size of
	 * its own, text at any other size keeps its font-size, and headings are
	 * recognized by their ratio to it (HEADING_SCALE). Default: 12, which reads
	 * a document exactly as 1.4.0 did.
	 */
	fontSize?: number;
	/**
	 * The largest RTF string to read, in characters (RTF is ASCII, so also bytes). A longer one
	 * is refused with a RangeError before any of it is parsed. Default: DEFAULT_MAX_RTF_BYTES
	 * (50 MB). 0 reads a document of any size.
	 */
	maxBytes?: number;
	/**
	 * The fonts text may be shown in, beside the document's own: the editor's or viewer's
	 * `fonts`. Text the RTF sets in one of them carries that font; text in any other font is
	 * shown in the document font, as all text is where this is not given. Each is a font name,
	 * or a CSS list whose first family is the name. Default: none.
	 */
	fonts?: readonly string[];
	/**
	 * The document font of the screen the HTML will be shown on: the editor's or viewer's
	 * `fontFamily`. Text the RTF sets in it carries no font of its own. Only read where `fonts`
	 * is given. Default: DEFAULT_FONT_FAMILY.
	 */
	fontFamily?: string;
}

/** Twips as a CSS length in points (20 twips), which the writer reads back as the same twips. */
function twipsToPt(twips: number): string {
	return `${Math.round(twips * 5) / 100}pt`;
}

function resetIndents(state: RenderState): void {
	state.leftIndent = 0;
	state.rightIndent = 0;
	state.firstLineIndent = 0;
	state.spaceBefore = 0;
	state.spaceAfter = 0;
	state.lineSpacing = 0;
	state.lineMultiple = false;
}

/** The most space before or after a paragraph that is read: a page's height. More is a mistake in the file. */
const MOST_SPACE_TWIPS = 15840;

/**
 * A paragraph's spacing as CSS, which the writer reads back as the same \sb, \sa and \sl:
 * "margin-top:6pt;margin-bottom:6pt;line-height:1.5". A height the lines have at least (\sl
 * above zero with no \slmult1) is not a thing CSS has, and is left to the screen.
 */
function spacingStyle(block: ParagraphBlock, part: 'all' | 'before' | 'after' = 'all'): string {
	const parts: string[] = [];
	const space = (twips: number) => twipsToPt(Math.min(twips, MOST_SPACE_TWIPS));
	if (part !== 'after' && block.before > 0) parts.push(`margin-top:${space(block.before)}`);
	if (part !== 'before' && block.after > 0) parts.push(`margin-bottom:${space(block.after)}`);
	if (part === 'all') {
		// Lines closer than LEAST_LINES of their text are printed over each other, and are
		// not read: "\sl-20" put two lines of a diagnosis on top of each other, and the
		// paragraph after them on both. (A half-point is ten twips.)
		const tallest = block.runs.reduce((most, run) => Math.max(most, run.fmt.fontSize || 0), 0);
		if (block.lineMultiple && block.line >= LEAST_LINES * 240 && block.line <= 2400) parts.push(`line-height:${Math.round((block.line / 240) * 100) / 100}`);
		else if (!block.lineMultiple && block.line < 0 && block.line >= -MOST_SPACE_TWIPS && -block.line >= LEAST_LINES * tallest * 10) parts.push(`line-height:${twipsToPt(-block.line)}`);
	}
	return parts.join(';');
}

/** A style added to the element an HTML string opens with: `<figure>` or `<figure style="…">`. */
function withStyle(html: string, style: string): string {
	if (!style) return html;
	const open = html.match(/^<[a-z0-9]+( style="([^"]*)")?/);
	if (!open) return html;
	const tag = open[0].slice(0, open[0].length - (open[1]?.length ?? 0));
	// (What it sets replaces what the element had of the same name.)
	const named = new Set(style.split(';').map((declaration) => declaration.split(':')[0]));
	const kept = (open[2] ?? '').split(';').filter((declaration) => declaration && !named.has(declaration.split(':')[0]));
	return `${tag} style="${[...kept, style].join(';')}"${html.slice(open[0].length)}`;
}

/**
 * A paragraph's indents as CSS, in points (20 twips), which the writer reads back as the same
 * \li, \ri and \fi: "margin-left:36pt;text-indent:-36pt". A first line may not start left of
 * the page margin, where a browser would clip it.
 */
function indentStyle(block: ParagraphBlock): string {
	const left = Math.max(0, block.left);
	const first = Math.max(-left, block.first);
	const parts: string[] = [];
	if (left > 0) parts.push(`margin-left:${twipsToPt(left)}`);
	if (block.right > 0) parts.push(`margin-right:${twipsToPt(block.right)}`);
	if (first !== 0) parts.push(`text-indent:${twipsToPt(first)}`);
	return parts.join(';');
}

/**
 * The indent of a picture's paragraph: where its one line starts, as a left margin. A figure
 * is written back with a left indent only, and a first-line indent on it would be passed on to
 * its caption.
 */
function figureIndentStyle(block: ParagraphBlock): string {
	const left = Math.max(0, block.left);
	const start = left + Math.max(-left, block.first);
	return start > 0 ? `margin-left:${twipsToPt(start)}` : '';
}

/**
 * A paragraph's HTML without the spaces at its ends, which a browser does not show. Only those:
 * a non-breaking space or an em space there is text someone put there, and is kept.
 */
function trimSpaces(html: string): string {
	// Two loops, not a regular expression: /[ \t]+$/ starts again at every space of a long run
	// that does not reach the end, and 200,000 spaces in a paragraph took 23 seconds.
	let start = 0;
	let end = html.length;
	while (start < end && isSpace(html.charCodeAt(start))) start++;
	while (end > start && isSpace(html.charCodeAt(end - 1))) end--;
	return start === 0 && end === html.length ? html : html.slice(start, end);
}

/** Space, tab, line feed, form feed, carriage return. */
function isSpace(code: number): boolean {
	return code === 32 || (code >= 9 && code <= 13 && code !== 11);
}

function escapeText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Text as an attribute value in double quotes. */
function escapeAttribute(text: string): string {
	return escapeText(text).replace(/"/g, '&quot;');
}

function sameFormat(a: RunFormat, b: RunFormat): boolean {
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.super_ === b.super_ &&
		a.sub === b.sub &&
		a.fontSize === b.fontSize &&
		sameFormatButSize(a, b)
	);
}

function sameFormatButSize(a: RunFormat, b: RunFormat): boolean {
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.super_ === b.super_ &&
		a.sub === b.sub &&
		a.color === b.color &&
		a.background === b.background &&
		a.mono === b.mono &&
		a.font === b.font &&
		a.link === b.link
	);
}

/** How a paragraph's pieces are written out, where it is not as an ordinary paragraph. */
interface RenderOptions {
	/** A font size, in half-points, the element around the text already gives it. */
	dropSize?: number;
	/** The element around the text is bold already (a heading). */
	dropBold?: boolean;
	/** Inside <pre>: no <code>, a line break is a newline and a tab is a tab. */
	pre?: boolean;
	/** Leave out a color that cannot be read on white: the text of a shaded cell (see readsOnWhite). */
	onWhite?: boolean;
}

export function rtfToHtml(rtfString: string, options: RtfReadOptions = {}): string {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_RTF_BYTES;
	if (maxBytes > 0 && rtfString.length > maxBytes) {
		throw new RangeError(
			`This document is too large to show: ${overLimit(rtfString.length, maxBytes)}`
		);
	}

	const tree = parseTree(rtfString);

	let colorTable: string[] = [''];
	let monoFonts = new Set<number>();
	let symbolFonts = new Set<number>();
	let fontNames = new Map<number, string>();
	let defaultFont = 0;

	/** Where finished paragraphs and tables go: the document, or the footnote or text box being read. */
	let blocks: Block[] = [];

	// The paragraph being read
	let runs: Run[] = [];
	/** Nothing but text has been read into the paragraph so far. */
	let onlyText = true;
	/**
	 * The alignment in force where the paragraph's last piece was read. A paragraph whose
	 * alignment was set in a group that closes before its \par ({\qc Title}\par, or a cell
	 * written {\pard\intbl\qr 1.0\par}\cell) is still that paragraph's: Apple's reader shows it
	 * so, and so did this one while alignment was not kept with the group.
	 */
	let contentAlign = 'left';
	let marker: ListMarker | null = null;
	let paragraphHasListMarker = false;
	let paragraphIsCaption = false;

	/**
	 * Text boxes met while a paragraph or a table was being read. A box is not part of the line
	 * it is anchored in: its text goes after that paragraph, or after that table.
	 */
	let paragraphAsides: Block[] = [];
	let tableAsides: Block[] = [];
	/** Each footnote's paragraphs, in the order the notes were met. They go at the end. */
	const notes: Block[][] = [];
	/** How many footnotes have been given a number. */
	let noteCount = 0;
	/** The number written where the text refers to a note, until the note itself takes it. */
	let noteMark = 0;
	/** Inside a footnote: its number, or 0 until it has one. Outside: -1. */
	let noteNumber = -1;
	/** Reading a footnote or text box that sits in hidden or deleted text: none of it is shown. */
	let unshown = false;
	/** Where in the stack of formatting states the footnote or text box being read begins. */
	let stateBase = 0;

	// Table state
	let tableRows: TableRow[] = [];
	let currentRowCells: RowCell[] = [];
	let currentRowDefs: CellDef[] = [];
	/** The definition of the row before, which a row with no \trowd of its own repeats. */
	let lastRowDefs: CellDef[] = [];
	/** The row's \trgaph, and the row before's, which a row with no \trowd of its own repeats. */
	let rowGaph: number | null = null;
	let lastRowGaph: number | null = null;
	let pendingDef = newCellDef();
	/** The side a \clbrdrX just named, until a border type (\brdrs...) confirms or \brdrnone clears it. */
	let pendingSide: 'b' | 'other' | null = null;
	/**
	 * The sides of the cell being defined that have a real border, and whether the bottom one is
	 * the bare \brdrs the writer marks a header cell with: no width, no color.
	 */
	let cellBorders = { b: false, other: false, bare: false };
	/** The side whose border type was read last, which a \brdrw or \brdrcf after it belongs to. */
	let borderSide: 'b' | 'other' | null = null;
	/** {\*\inkth} was read in the cell being read: it is a header cell. */
	let cellMarkedHeader = false;
	/** How much of the cell had been read when {\*\inkcap} marked what follows as a caption. */
	let captionAt: number | null = null;
	let inTableCell = false;
	/** \par seen in a table cell since its last text: line breaks owed if more text follows. */
	let cellBreaks = 0;
	/** The spacing of the paragraph each of those paragraph marks ended; null for a line that is no paragraph's (a row of a table in the cell). */
	let cellBreakSpacing: (CellSpacing | null)[] = [];
	/** \lastrow seen in the definition of the row being read: its \row ends the table. */
	let lastRow = false;
	/** \nestcell seen: a tab is owed if more text follows on the line. */
	let nestTabPending = false;

	function newCellDef(): CellDef {
		return { right: 0, header: false, vmgf: false, vmrg: false, hmgf: false, hmrg: false, shade: '', borders: {}, edge: null, drawn: null };
	}

	// The document is the first group. A byte-order mark or blank lines before it (a file saved
	// by a tool that adds them) do not make it something else: with those the color and font
	// tables were not found, and every color and code font was lost.
	const firstGroupAt = tree.children.findIndex((n) => n.type === 'group');
	const rootGroup =
		firstGroupAt >= 0 &&
		tree.children
			.slice(0, firstGroupAt)
			.every((n) => (n.type === 'text' ? /^[\s\uFEFF\u00EF\u00BB\u00BF]*$/.test(n.value) : n.type === 'control' && n.word === 'tab'))
			? (tree.children[firstGroupAt] as RtfGroup)
			: tree;

	// First pass: extract color table and font table from the root group

	for (let i = 0; i < rootGroup.children.length; i++) {
		const child = rootGroup.children[i];
		if (child.type === 'group') {
			const firstControl = child.children.find((n) => n.type === 'control') as RtfControl | undefined;
			if (firstControl?.word === 'colortbl') {
				colorTable = parseColorTable(child);
			} else if (firstControl?.word === 'fonttbl') {
				({ mono: monoFonts, symbol: symbolFonts, names: fontNames } = readFontTable(child));
			}
		} else if (child.type === 'control' && child.word === 'deff' && child.param != null) {
			defaultFont = child.param;
		}
	}

	// In a document whose own font is monospace, code cannot be told from text by its font.
	const documentIsMono = monoFonts.has(defaultFont);

	// The fonts the application offers. Text in any other font, and text in the font the screen
	// shows the document in, carries no font.
	const offered = fontChoices(options.fonts);
	const screenFont = fontKey(options.fontFamily) || fontKey(DEFAULT_FONT_FAMILY);
	const fontCss = new Map<number, string>();
	/** The font with this number in the font table, as CSS, if it is one text is shown in. */
	function fontOf(index: number): string {
		if (offered.length === 0) return '';
		let css = fontCss.get(index);
		if (css === undefined) {
			const name = fontNames.get(index) ?? '';
			const key = fontKey(name);
			const loose = looseFontKey(name);
			const isScreenFont = key === screenFont || loose === looseFontKey(screenFont);
			const choice = offered.find((font) => font.key === key) ?? offered.find((font) => looseFontKey(font.key) === loose);
			css = !key || isScreenFont || !choice ? '' : choice.css;
			fontCss.set(index, css);
		}
		return css;
	}
	const linkColor = `rgb(${LINK_COLOR.r},${LINK_COLOR.g},${LINK_COLOR.b})`;

	// The screen's body size, in half-points. It is given, not guessed from the
	// document: guessing misread short documents and ones set below 12 pt.
	const bodySize = normalizeFontSize(options.fontSize) * 2;
	/** The size the writer sets a code block in, in half-points. */
	const preSize = Math.round(bodySize * PRE_SCALE);

	// State stack for nested groups
	function defaultState(): RenderState {
		return {
			bold: false,
			italic: false,
			underline: false,
			strike: false,
			super_: false,
			sub: false,
			fontSize: 24, // 12pt default
			colorIndex: 0,
			highlightIndex: 0,
			backIndex: 0,
			paragraphBackIndex: 0,
			fontIndex: defaultFont,
			ucSkip: 1,
			inList: false,
			hidden: false,
			deleted: false,
			align: 'left',
			link: '',
			leftIndent: 0,
			rightIndent: 0,
			firstLineIndent: 0,
			spaceBefore: 0,
			spaceAfter: 0,
			lineSpacing: 0,
			lineMultiple: false,
		};
	}

	const stateStack: RenderState[] = [defaultState()];

	function currentState(): RenderState {
		return stateStack[stateStack.length - 1];
	}

	function cloneState(): RenderState {
		return { ...currentState() };
	}

	/** A color of the table as the background it is: none for the automatic color, and none for white, which the page is. */
	function shadeAt(index: number): string {
		const color = index > 0 && index < colorTable.length ? colorTable[index] : '';
		return color === 'rgb(255,255,255)' ? '' : color;
	}

	/**
	 * Shading is not shown: every word is on the white of the page. A color given to words so
	 * that they could be read on their shading (the white header of a table whose header row is
	 * dark, a white title on a shaded bar) cannot be read without it, and the cell or the line
	 * looked empty. Such words are shown in the page's own color. A color that can be read on
	 * white stays, shaded or not.
	 */
	function readsOnWhite(color: string): boolean {
		const parts = color.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
		return !parts || !hardToReadOnWhite({ r: +parts[1], g: +parts[2], b: +parts[3] });
	}

	function formatOf(state: RenderState): RunFormat {
		let color = state.colorIndex > 0 && state.colorIndex < colorTable.length ? colorTable[state.colorIndex] : '';
		if (color && (shadeAt(state.backIndex) || shadeAt(state.paragraphBackIndex)) && !readsOnWhite(color)) color = '';
		// Black is the color text has anyway, and a link's own color is the <a>'s to give.
		if (color === 'rgb(0,0,0)' || (state.link && color === linkColor)) color = '';
		return {
			bold: state.bold,
			italic: state.italic,
			// A link is underlined as a link; the writer adds that underline itself.
			underline: state.underline && !state.link,
			strike: state.strike,
			super_: state.super_,
			sub: state.sub,
			fontSize: state.fontSize || bodySize,
			color,
			background: (state.highlightIndex > 0 && HIGHLIGHT_COLORS[state.highlightIndex]) || '',
			// A list marker is set in whatever font the list uses (Word's second-level "o" is in
			// Courier New): it is not code.
			mono: !documentIsMono && !state.inList && monoFonts.has(state.fontIndex),
			// (Not a list marker's, as above: Word sets its bullets in Symbol and Wingdings.)
			font: state.inList ? '' : fontOf(state.fontIndex),
			link: state.link
		};
	}

	// ── Writing a paragraph's pieces as HTML ──

	function renderText(text: string, fmt: RunFormat, opts: RenderOptions): string {
		if (!text) return '';
		// A size on spaces alone is not shown and would be read as the
		// paragraph's size, so it is dropped. Underline, strikethrough and
		// highlight are kept: an underlined blank is a signature line.
		const onlySpaces = ONLY_SPACES.test(text);

		let result = escapeText(text);

		const styles: string[] = [];
		// (A highlight is shown, and its words are read on it.)
		if (fmt.color && (!opts.onWhite || fmt.background || readsOnWhite(fmt.color))) styles.push(`color:${fmt.color}`);
		if (fmt.background) styles.push(`background-color:${fmt.background}`);
		if (!onlySpaces && fmt.fontSize !== bodySize && fmt.fontSize !== opts.dropSize) {
			styles.push(`font-size:${fmt.fontSize / 2}pt`);
		}
		// (Code is in the code font: a font named for it would be the one it is shown in.)
		if (!onlySpaces && fmt.font && !fmt.mono && !opts.pre) styles.push(`font-family:${escapeAttribute(fmt.font)}`);
		if (styles.length > 0) result = `<span style="${styles.join(';')}">${result}</span>`;

		if (fmt.mono && !opts.pre) result = `<code>${result}</code>`;
		if (fmt.bold && !opts.dropBold) result = `<strong>${result}</strong>`;
		if (fmt.italic) result = `<em>${result}</em>`;
		if (fmt.underline) result = `<u>${result}</u>`;
		if (fmt.strike) result = `<s>${result}</s>`;
		if (fmt.super_) result = `<sup>${result}</sup>`;
		if (fmt.sub) result = `<sub>${result}</sub>`;

		return result;
	}

	function renderRun(run: Run, opts: RenderOptions): string {
		if (run.type === 'text') return renderText(run.text, run.fmt, opts);
		if (opts.pre && run.kind === 'br') return '\n';
		if (opts.pre && run.kind === 'tab') return '\t';
		return run.html;
	}

	/** The opening tag of a link. The address has been through linkTarget; a web page opens in a tab of its own. */
	function linkOpen(href: string): string {
		const newTab = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
		return `<a href="${escapeAttribute(href)}"${newTab}>`;
	}

	function renderRuns(list: Run[], opts: RenderOptions = {}): string {
		// A line break that ends the paragraph (\line\par) leaves an empty last line. A browser
		// shows nothing for a <br> at the end of a block, so that one is written twice; the
		// writer, which drops a closing <br>, then sends the one \line back.
		let closing = -1;
		if (!opts.pre) {
			let k = list.length - 1;
			while (k >= 0 && list[k].type === 'text' && ONLY_SPACES.test((list[k] as { text: string }).text)) k--;
			if (k >= 0 && list[k].type === 'html' && (list[k] as { kind: string }).kind === 'br') closing = k;
		}
		const render = (i: number) => renderRun(list[i], opts) + (i === closing ? '<br>' : '');

		let out = '';
		for (let i = 0; i < list.length; ) {
			const link = list[i].fmt.link;
			if (!link) {
				out += render(i++);
				continue;
			}
			// Every piece in a row that carries the same address is one link.
			let inner = '';
			while (i < list.length && list[i].fmt.link === link) inner += render(i++);
			out += `${linkOpen(link)}${inner}</a>`;
		}
		return out;
	}

	// ── Collecting a paragraph ──

	/** Half of a surrogate pair read from \uN, waiting for the \uN that completes the character. */
	let pendingHighSurrogate = 0;

	/** A piece of the paragraph that is not text: a line break, a tab, a picture. */
	function pushHtml(kind: 'br' | 'tab' | 'gap' | 'img', html: string, state: RenderState): void {
		runs.push({ type: 'html', kind, html, fmt: formatOf(state) });
		onlyText = false;
	}

	/** An empty paragraph to read into. */
	function newRuns(): void {
		runs = [];
		captionAt = null;
		onlyText = true;
		contentAlign = 'left';
		marker = null;
	}

	/** The alignment of the paragraph, or the cell, that ends here: see contentAlign. */
	function alignHere(state: RenderState): string {
		return state.align !== 'left' || runs.length === 0 ? state.align : contentAlign;
	}

	function pushText(text: string, state: RenderState): void {
		if (!text) return;
		const fmt = formatOf(state);
		const last = runs[runs.length - 1];
		if (last && last.type === 'text') {
			// Text in the same formatting as the text before it is one piece: "caf" and the
			// \'e9 after it, or the two \u halves of an emoji, are not two elements.
			if (sameFormat(last.fmt, fmt)) {
				last.text += text;
				return;
			}
			// A size does not show on spaces, so spaces go with the text beside them
			// whatever size they were set in.
			if (sameFormatButSize(last.fmt, fmt)) {
				if (ONLY_SPACES.test(text)) {
					last.text += text;
					return;
				}
				if (ONLY_SPACES.test(last.text)) {
					last.text += text;
					last.fmt = fmt;
					return;
				}
			}
		}
		runs.push({ type: 'text', text, fmt });
	}

	/** What is owed before the next piece of a paragraph: see cellBreaks and nestTabPending. */
	function beforeContent(state: RenderState): void {
		contentAlign = state.align;
		if (pendingHighSurrogate) {
			// A lone half of a pair is no character.
			pendingHighSurrogate = 0;
			pushText('\ufffd', state);
		}
		if (cellBreaks > 0) {
			const count = cellBreaks;
			const spacings = cellBreakSpacing;
			cellBreaks = 0;
			cellBreakSpacing = [];
			if (inTableCell) {
				// A paragraph mark inside a cell: the cell's text goes on, on a new line.
				for (let k = 0; k < count; k++) {
					pushHtml('br', '<br>', state);
					(runs[runs.length - 1] as { spacing?: CellSpacing | null }).spacing = spacings[k] ?? null;
				}
			} else {
				// \pard has left the table without a \cell: what was read is a paragraph.
				for (let k = 0; k < count; k++) flushParagraph();
			}
		}
		if (nestTabPending) {
			nestTabPending = false;
			pushHtml('tab', TAB_HTML, state);
		}
	}

	/**
	 * Whether what is being read is shown at all. Hidden text (\v) is not, in Word or anywhere:
	 * it holds notes and field codes. Nor is text a tracked change deleted (\deleted), which is
	 * still in the file beside what replaced it, so "malignant" struck out and "benign" put in
	 * read "malignantbenign".
	 */
	function shown(state: RenderState): boolean {
		return !unshown && !state.hidden && !state.deleted;
	}

	function appendText(text: string, state: RenderState): void {
		if (!text || !shown(state)) return;
		beforeContent(state);
		pushText(text, state);
	}

	function appendHtml(kind: 'br' | 'tab' | 'gap' | 'img', html: string, state: RenderState): void {
		if (!shown(state)) return;
		beforeContent(state);
		pushHtml(kind, html, state);
	}

	/** The spacing the paragraph being read has. */
	function spacingHere(state: RenderState): CellSpacing {
		return { before: state.spaceBefore, after: state.spaceAfter, line: state.lineSpacing, lineMultiple: state.lineMultiple };
	}

	/**
	 * What a table cell holds, as HTML. Its paragraphs are lines of the cell, a <br> apart; where
	 * one of them is spaced (\sa, \sb, \sl, as Word writes a cell's paragraphs), each is a
	 * paragraph of its own with its spacing. `last` is the spacing of the last one.
	 */
	function cellHtml(last: CellSpacing): string {
		const paragraphs: { runs: Run[]; spacing: CellSpacing }[] = [];
		let from = 0;
		runs.forEach((run, i) => {
			if (run.type !== 'html' || !run.spacing) return;
			paragraphs.push({ runs: runs.slice(from, i), spacing: run.spacing });
			from = i + 1;
		});
		paragraphs.push({ runs: runs.slice(from), spacing: last });
		const styles = paragraphs.map((paragraph) => spacingStyle({ ...paragraph.spacing, runs: paragraph.runs } as ParagraphBlock));
		if (styles.every((style) => !style)) return trimSpaces(renderRuns(runs));
		return paragraphs
			.map((paragraph, k) => `<p${styles[k] ? ` style="${styles[k]}"` : ''}>${trimSpaces(renderRuns(paragraph.runs)) || '<br>'}</p>`)
			.join('');
	}

	/** \par, where it ends a paragraph and where, in a table cell, it starts a new line. */
	function paragraphMark(state: RenderState): void {
		if (inTableCell) {
			cellBreaks++;
			cellBreakSpacing.push(spacingHere(state));
		} else {
			// Paragraph marks from a cell that \pard has since left end paragraphs too.
			for (; cellBreaks > 0; cellBreaks--) flushParagraph();
			cellBreakSpacing = [];
			flushParagraph();
		}
	}

	/**
	 * Text as the file has it. In a Symbol font each character is the sign that font shows for
	 * it. U+2028 is a line break (TextEdit writes Shift-Return that way; a browser shows nothing
	 * for the character itself, and the two lines ran together) and U+2029 a paragraph mark.
	 */
	function appendChars(text: string, state: RenderState, bytes = true): void {
		if (!text || !shown(state)) return;
		if (bytes && symbolFonts.has(state.fontIndex)) text = symbolText(text);
		if (!LINE_SEPARATOR.test(text)) {
			appendText(text, state);
			return;
		}
		let from = 0;
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (code !== 0x2028 && code !== 0x2029) continue;
			appendText(text.slice(from, i), state);
			if (code === 0x2028) appendHtml('br', '<br>', state);
			else paragraphMark(state);
			from = i + 1;
		}
		appendText(text.slice(from), state);
	}

	/**
	 * The cell being read as the figure it is, where it holds one picture and then the caption
	 * the writer marked ({\*\inkcap}): pictures side by side are a row of such cells, each
	 * picture with its own caption. Null for any other cell, which is read as its lines.
	 */
	function cellFigure(): string | null {
		if (captionAt == null || captionAt < 1) return null;
		const before = runs.slice(0, captionAt).filter((run) => !(run.type === 'text' && ONLY_SPACES.test(run.text)));
		if (before.length !== 1 || before[0].type !== 'html' || before[0].kind !== 'img') return null;
		let from = captionAt;
		while (from < runs.length && runs[from].type === 'html' && (runs[from] as { kind: string }).kind === 'br') from++;
		const caption = stripWrappingEm(trimSpaces(renderRuns(runs.slice(from))));
		if (!caption) return null;
		return `<figure>${trimSpaces(renderRuns(before))}<figcaption>${caption}</figcaption></figure>`;
	}

	/** The cell being read, with the colors left out that cannot be read on white; undefined where it has none. */
	function cellOnWhite(): string | undefined {
		if (!runs.some((run) => run.fmt.color && !run.fmt.background && !readsOnWhite(run.fmt.color))) return undefined;
		return trimSpaces(renderRuns(runs, { onWhite: true }));
	}

	function lineText(): string | null {
		let text = '';
		for (let i = runs.length - 1; i >= 0; i--) {
			const run = runs[i];
			if (run.type === 'html' && run.kind === 'br') break;
			if (run.type !== 'text') return null;
			text = run.text + text;
		}
		return text;
	}

	function appendTab(state: RenderState): void {
		if (!shown(state)) return;
		beforeContent(state);
		// A real tab, in the shape the editor's Tab key inserts, so it shows as
		// one and is written back as \tab (an em space came back as a \u escape for U+2003).
		// After a list marker ("\bullet\tab", "1.\tab") the gap stays an em
		// space where the line is read as a plain one: a full tab there is too wide.
		const lead = lineText();
		// Only a marker that opens the paragraph can make it a list item.
		const opensParagraph = marker === null && onlyText;
		const listed = lead != null ? lead.match(LIST_MARKER) : null;
		if (listed) {
			pushHtml('gap', '&emsp;', state);
			// (A number too long to be an item's number is text, and so is one written with a
			// leading zero, "01.": a list would show it as "1.".)
			if (opensParagraph && (!listed[1] || (listed[1].length <= MAX_LIST_NUMBER_DIGITS && !/^0\d/.test(listed[1])))) {
				marker = listed[1]
					? { kind: 'ol', number: Number(listed[1]), end: runs.length }
					: { kind: 'ul', number: 0, end: runs.length };
			}
			return;
		}
		// "C." or "iv.", which is a marker only on a paragraph set as the writer sets a list
		// item: on any other line it is what someone typed ("A.", a tab, the specimen), and
		// the tab after it stays a tab.
		const lettered = opensParagraph && lead != null ? lead.match(LETTER_MARKER) : null;
		if (
			lettered &&
			state.firstLineIndent === -LIST_HANG &&
			state.leftIndent >= LIST_HANG &&
			state.rightIndent === 0 &&
			(state.align || 'left') === 'left' &&
			letterReadings(lettered[1]).length > 0
		) {
			pushHtml('gap', '&emsp;', state);
			marker = { kind: 'ol', number: 0, letters: lettered[1], end: runs.length };
			return;
		}
		pushHtml('tab', TAB_HTML, state);
		// Word's bullet, inside {\listtext …} or {\pntext …}.
		if (opensParagraph && lead != null && state.inList && SYMBOL_BULLET.test(lead)) {
			marker = { kind: 'ul', number: 0, end: runs.length };
		}
	}

	// ── Tables ──

	/** Column edges closer than this, in twips (2 px), are the same edge. */
	const EDGE_TOLERANCE = 30;

	function flushTable() {
		if (tableRows.length === 0) return;
		const rows = tableRows;
		tableRows = [];

		// Each row as its cells with their right edges. A cell with no \cellx of its own takes
		// an edge past the last one, so its text is kept; a cell merged to the left (\clmrg)
		// joins the cell before it.
		interface Placed {
			html: string;
			align: string;
			/** A header cell, by either mark: the bare line under it, or {\*\inkth} in it. */
			header: boolean;
			def: CellDef;
			left: number;
			right: number;
			start: number;
			end: number;
			rowspan: number;
			merged: boolean;
		}
		const placedRows: Placed[][] = rows.map((row) => {
			const placed: Placed[] = [];
			let prevRight = 0;
			let step = 0;
			for (let ci = 0; ci < row.cells.length; ci++) {
				const def = row.defs[ci] ?? { ...newCellDef(), right: prevRight + (step || 1440) };
				const cell = row.cells[ci];
				// The words of a shaded cell, as they can be read without the shading.
				const cellHtml = def.shade && cell.onWhite !== undefined ? cell.onWhite : cell.html;
				const last = placed[placed.length - 1];
				if (def.hmrg && last) {
					last.right = Math.max(last.right, def.right);
					if (cellHtml) last.html += (last.html ? ' ' : '') + cellHtml;
				} else {
					placed.push({
						html: cellHtml, align: cell.align, header: def.header || cell.header === true, def,
						left: prevRight, right: Math.max(def.right, prevRight),
						start: 0, end: 0, rowspan: 1, merged: false
					});
				}
				step = Math.max(1, def.right - prevRight);
				prevRight = Math.max(def.right, prevRight);
			}
			return placed;
		});

		// One set of columns for the table: every edge any row has. A cell that crosses edges
		// of other rows spans those columns.
		const allEdges = placedRows.flatMap((row) => row.map((c) => c.right)).sort((a, b) => a - b);
		const edges: number[] = [];
		for (const e of allEdges) {
			if (edges.length === 0 || e - edges[edges.length - 1] > EDGE_TOLERANCE) edges.push(e);
		}
		// The column whose edge is nearest, the earlier one on a tie. A binary search over the
		// sorted edges: a scan of every edge for every cell froze the page on a row of 100,000
		// cells (14 s for 2 MB).
		const columnOf = (right: number): number => {
			let lo = 0;
			let hi = edges.length - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (edges[mid] < right) lo = mid + 1;
				else hi = mid;
			}
			if (lo > 0 && Math.abs(edges[lo - 1] - right) <= Math.abs(edges[lo] - right)) return lo - 1;
			return lo;
		};
		for (const row of placedRows) {
			let start = 0;
			for (const cell of row) {
				cell.start = start;
				cell.end = Math.max(start, columnOf(cell.right));
				start = cell.end + 1;
			}
		}

		// A vertical merge: the cell marked \clvmgf takes in each \clvmrg cell under it, row
		// after row. A \clvmrg cell with nothing above it to join stays an ordinary cell.
		// Each row's cells by the column they start in, so the cell under another is looked up,
		// not searched for: a search per merged cell took a second for a row of 40,000.
		const byStart = placedRows.map((row) => new Map(row.map((c) => [c.start, c])));
		for (let r = 0; r < placedRows.length; r++) {
			for (const cell of placedRows[r]) {
				if (!cell.def.vmgf || cell.merged) continue;
				for (let below = r + 1; below < placedRows.length; below++) {
					const under = byStart[below].get(cell.start);
					if (!under || !under.def.vmrg || under.merged) break;
					under.merged = true;
					cell.rowspan++;
					// A merged cell is empty; if a damaged file has text there, it is kept.
					if (under.html) cell.html += (cell.html ? '<br>' : '') + under.html;
				}
			}
		}

		// Pictures side by side with a set gap: one row, a picture in each cell and an empty
		// cell between each two, written with no space inside a cell (\trgaph0) and nothing
		// drawn or shaded. It is read at its own widths, as it was written, and not stretched
		// across the page: what was set is the distance between the pictures. (See
		// picture-rows.ts.) A table that only looks like one, with borders, shading, or the
		// space a reader puts inside its cells, is read as the table it is.
		const plain = rows.length === 1 && rows[0].gaph === 0 && rows[0].defs.every((def) => !def.shade && Object.keys(def.borders).length === 0);
		const only = plain && placedRows.length === 1 ? placedRows[0] : null;
		const onePicture = (html: string) => /^<(figure|img)\b/.test(html) && html.split('<img').length === 2;
		if (
			only &&
			only.length >= 3 &&
			only.length % 2 === 1 &&
			only.every((cell, i) => !cell.merged && !cell.header && cell.rowspan === 1 && cell.end === cell.start && cell.right > cell.left && (i % 2 === 0 ? onePicture(cell.html) : cell.html === ''))
		) {
			const cells = only.map((cell) => `<td style="padding:0;width:${(cell.right - cell.left) / 20}pt">${cell.html}</td>`).join('');
			blocks.push({ kind: 'table', html: `<table style="border-collapse:collapse;margin:4px 0"><tr>${cells}</tr></table>` });
			for (const aside of tableAsides) blocks.push(aside);
			tableAsides = [];
			return;
		}

		const total = edges[edges.length - 1] || 1;
		// A cell's width is the difference of where it ends and where it starts, each as a
		// share of the table rounded to a hundredth of a percent. Written that way the widths
		// of a row add up exactly, and the writer puts every column edge back where it was;
		// each width rounded by itself moved an edge a few twips on every save.
		const shareAt = (edge: number) => Math.round((edge / total) * 10000) / 100;
		let html = '<table style="border-collapse:collapse;width:100%;margin:4px 0">';
		for (const row of placedRows) {
			html += '<tr>';
			for (const cell of row) {
				if (cell.merged) continue;
				const tag = cell.header ? 'th' : 'td';
				const pct = (shareAt(cell.right) - shareAt(cell.left)).toFixed(2).replace(/0$/, '');
				const alignStyle = cell.align !== 'left' ? `;text-align:${cell.align}` : '';
				// (A header cell says how it is aligned, left too: a browser centers one that does not.)
				const style = cell.def.header
					? `border-bottom:1px solid;padding:2px 6px;text-align:${cell.align};width:${pct}%`
					: cell.header
						? `${bordersStyle(cell.def.borders)}padding:2px 6px;text-align:${cell.align};width:${pct}%`
						: `${bordersStyle(cell.def.borders)}padding:2px 6px;width:${pct}%${alignStyle}`;
				const colspan = cell.end > cell.start ? ` colspan="${cell.end - cell.start + 1}"` : '';
				const rowspan = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
				html += `<${tag}${colspan}${rowspan} style="${style}">${cell.html}</${tag}>`;
			}
			html += '</tr>';
		}
		html += '</table>';
		blocks.push({ kind: 'table', html });
		for (const aside of tableAsides) blocks.push(aside);
		tableAsides = [];
	}

	function flushParagraph() {
		const state = currentState();
		if (pendingHighSurrogate) {
			pendingHighSurrogate = 0;
			pushText('\ufffd', state);
		}
		flushTable();
		// A paragraph that held a list marker and nothing else is no line of its own.
		if (!paragraphHasListMarker || trimSpaces(renderRuns(runs))) {
			blocks.push({
				kind: 'paragraph',
				runs,
				align: alignHere(state),
				left: state.leftIndent,
				right: state.rightIndent,
				first: state.firstLineIndent,
				before: state.spaceBefore,
				after: state.spaceAfter,
				line: state.lineSpacing,
				lineMultiple: state.lineMultiple,
				caption: paragraphIsCaption,
				marker,
				inTable: inTableCell
			});
		}
		newRuns();
		paragraphHasListMarker = false;
		paragraphIsCaption = false;
		nestTabPending = false;
		for (const aside of paragraphAsides) blocks.push(aside);
		paragraphAsides = [];
	}

	/** What is still being read when the document, a footnote or a text box ends. */
	function finishContent(): void {
		if (pendingHighSurrogate) {
			pendingHighSurrogate = 0;
			pushText('\uFFFD', currentState());
		}
		// A row the file ends in the middle of, with cells and no \row, is still a row.
		if (currentRowCells.length > 0) {
			tableRows.push({ cells: currentRowCells, defs: currentRowDefs.length > 0 ? currentRowDefs : lastRowDefs });
			currentRowCells = [];
			inTableCell = false;
		}
		flushTable(); // flush any trailing table rows
		// Only flush if there's actually pending content — the final \par in most RTF
		// files already flushed the last paragraph, so an unconditional call here
		// would push a spurious empty paragraph that becomes a trailing <p><br></p>.
		if (runs.length > 0) {
			flushParagraph();
		}
		for (const aside of tableAsides) blocks.push(aside);
		for (const aside of paragraphAsides) blocks.push(aside);
		tableAsides = [];
		paragraphAsides = [];
	}

	let pendingUnicodeSkip = 0;

	// ── Walking the document ──
	// With a stack of its own rather than a call per group: a document nested tens of
	// thousands of groups deep, which a damaged or hostile file can be, overflowed the call stack.

	interface Frame {
		nodes: RtfNode[];
		index: number;
		/** Whether leaving this group ends a formatting state. */
		scoped: boolean;
		/** Run when the group is reached, and when it has been read. */
		enter?: () => void;
		exit?: () => void;
	}
	const frames: Frame[] = [{ nodes: rootGroup.children, index: 0, scoped: false }];

	const enterGroup = (group: RtfGroup, state: RenderState) => {
		stateStack.push(state);
		frames.push({ nodes: group.children, index: 0, scoped: true });
	};

	const firstControl = (group: RtfGroup) => group.children.find((n) => n.type === 'control') as RtfControl | undefined;

	/**
	 * A group whose text is not part of the line it sits in: a footnote, a text box. It is read
	 * as a small document of its own, with its own paragraphs and tables, and what was being read
	 * around it is put back as it was afterwards. Read in place, a footnote's paragraph mark
	 * split the sentence it was in, and its \pard took a table cell out of its table.
	 */
	function aside(group: RtfGroup, done: (read: Block[]) => void, note = false): Frame {
		let restore = (): void => {};
		return {
			nodes: group.children,
			index: 0,
			scoped: true,
			enter() {
				const saved = {
					blocks, runs, onlyText, marker, paragraphHasListMarker, paragraphIsCaption, paragraphAsides,
					tableAsides, tableRows, currentRowCells, currentRowDefs, lastRowDefs, pendingDef, pendingSide,
					cellBorders, borderSide, cellMarkedHeader, captionAt, inTableCell, cellBreaks, cellBreakSpacing, contentAlign, lastRow, nestTabPending,
					pendingHighSurrogate, pendingUnicodeSkip, noteNumber, unshown, stateBase
				};
				restore = () => {
					({
						blocks, runs, onlyText, marker, paragraphHasListMarker, paragraphIsCaption, paragraphAsides,
						tableAsides, tableRows, currentRowCells, currentRowDefs, lastRowDefs, pendingDef, pendingSide,
						cellBorders, borderSide, cellMarkedHeader, captionAt, inTableCell, cellBreaks, cellBreakSpacing, contentAlign, lastRow, nestTabPending,
						pendingHighSurrogate, pendingUnicodeSkip, noteNumber, unshown, stateBase
					} = saved);
				};
				blocks = [];
				newRuns();
				paragraphHasListMarker = false;
				paragraphIsCaption = false;
				paragraphAsides = [];
				tableAsides = [];
				tableRows = [];
				currentRowCells = [];
				currentRowDefs = [];
				lastRowDefs = [];
				pendingDef = newCellDef();
				pendingSide = null;
				cellBorders = { b: false, other: false, bare: false };
				borderSide = null;
				cellMarkedHeader = false;
				inTableCell = false;
				cellBreaks = 0;
				cellBreakSpacing = [];
				lastRow = false;
				nestTabPending = false;
				pendingHighSurrogate = 0;
				pendingUnicodeSkip = 0;
				if (note) {
					noteNumber = noteMark;
					noteMark = 0;
				}
				// Its own formatting from the start: Word opens every one with \pard\plain. What
				// stays is whether the text around it is shown at all: a note in hidden or
				// deleted text is not, whatever \plain inside it resets.
				const outer = currentState();
				unshown = !shown(outer);
				stateBase = stateStack.length;
				stateStack.push({ ...defaultState(), ucSkip: outer.ucSkip });
			},
			exit() {
				finishContent();
				const read = unshown ? [] : blocks;
				restore();
				done(read);
			}
		};
	}

	/** A text box's paragraphs, kept until the paragraph or the table it is anchored in is done. */
	const keepAside = (read: Block[]) => {
		const target = inTableCell || currentRowCells.length > 0 ? tableAsides : paragraphAsides;
		for (const block of read) target.push(block);
	};

	/**
	 * A drawing, {\shp{\*\shpinst …}}: a text box, a picture with text wrapped around it. The
	 * pictures in it are shown where it is anchored and the text of its boxes is read after the
	 * paragraph; the rest of a drawing (lines, fills, positions) is not shown.
	 */
	function readShape(shape: RtfGroup): void {
		const boxes: RtfGroup[] = [];
		const pending: RtfNode[] = [shape];
		while (pending.length > 0) {
			const node = pending.pop()!;
			if (node.type !== 'group') continue;
			const word = node.children.find((n): n is RtfControl => n.type === 'control' && n.word !== '*')?.word;
			if (word === 'shptxt') {
				boxes.push(node);
				continue;
			}
			if (word === 'sp') {
				// A property of the shape. The one named pib holds its picture.
				const groups = node.children.filter((n): n is RtfGroup => n.type === 'group');
				const name = groups.find((g) => firstControl(g)?.word === 'sn');
				const value = groups.find((g) => firstControl(g)?.word === 'sv');
				const isPicture = name?.children.some((n) => n.type === 'text' && n.value.trim() === 'pib');
				const picture = isPicture
					? value?.children.find((n): n is RtfGroup => n.type === 'group' && firstControl(n)?.word === 'pict')
					: undefined;
				if (picture) {
					const img = renderPicture(picture);
					if (img) appendHtml('img', img, currentState());
				}
				continue;
			}
			for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
		}
		// The last one first: the frame pushed last is read first.
		for (let i = boxes.length - 1; i >= 0; i--) frames.push(aside(boxes[i], keepAside));
	}

	while (frames.length > 0) {
		const frame = frames[frames.length - 1];
		if (frame.enter) {
			const enter = frame.enter;
			frame.enter = undefined;
			enter();
		}
		if (frame.index >= frame.nodes.length) {
			frames.pop();
			frame.exit?.();
			if (frame.scoped) stateStack.pop();
			continue;
		}
		const node = frame.nodes[frame.index++];

		if (node.type === 'group') {
			const firstCtrl = firstControl(node);

			if (firstCtrl?.word === 'pict') {
				const img = renderPicture(node);
				if (img) appendHtml('img', img, currentState());
				continue;
			}

			if (firstCtrl?.word === 'footnote') {
				// A footnote or an endnote. Its text goes to the end of the document; the number
				// that refers to it (\chftn) stays where it is in the text.
				frames.push(
					aside(node, (read) => notes.push(read), true)
				);
				continue;
			}

			if (firstCtrl?.word === 'object') {
				// An embedded object: a spreadsheet, an equation. Its data is not read; what it
				// carries to be shown in its place, {\result …}, is.
				const result = node.children.find((n): n is RtfGroup => n.type === 'group' && firstControl(n)?.word === 'result');
				if (result) enterGroup(result, cloneState());
				continue;
			}

			if (firstCtrl && destinationWords.has(firstCtrl.word)) {
				continue;
			}

			const hasStarDest = node.children.length >= 2 &&
				node.children[0].type === 'control' && (node.children[0] as RtfControl).word === '*';
			if (hasStarDest) {
				const dest = node.children.find(
					(n) => n.type === 'control' && n.word !== '*'
				) as RtfControl | undefined;

				// Word wraps pictures in {\*\shppict{\pict …}} — descend into it
				// rather than dropping the picture with the rest of the ignorables.
				if (dest?.word === 'shppict') {
					enterGroup(node, cloneState());
				} else if (dest?.word === 'shpinst') {
					readShape(node);
				} else if (dest?.word === 'inkcap') {
					// Marks the paragraph that follows as a picture caption.
					paragraphIsCaption = true;
					captionAt = runs.length;
				} else if (dest?.word === 'inkth') {
					// Marks the cell it is in as a header cell.
					cellMarkedHeader = true;
				} else if (dest?.word === 'nesttableprops') {
					// Word ends each row of a table inside a cell with this group, which holds
					// the row's definition and its \nestrow.
					nestTabPending = false;
					cellBreaks++;
					cellBreakSpacing.push(null);
				}
				continue;
			}

			const state = cloneState();
			// {\field{\*\fldinst HYPERLINK "…"}{\fldrslt text}}: the text is a link, if the
			// address is one the writer would write.
			if (firstCtrl?.word === 'field') {
				// A character put in with Insert Symbol: the field says which, and that is
				// shown in place of the field's own result.
				const symbol = fieldSymbol(node);
				if (symbol) {
					appendText(symbol, currentState());
					continue;
				}
				const href = fieldLink(node);
				if (href) state.link = href;
			}
			enterGroup(node, state);
		} else if (node.type === 'control') {
			const state = currentState();
			const w = node.word;
			const p = node.param;

			switch (w) {
				case 'b':
					state.bold = p !== 0;
					break;
				case 'i':
					state.italic = p !== 0;
					break;
				case 'ul':
				case 'ulnone':
					state.underline = w === 'ul' && p !== 0;
					break;
				case 'strike':
					state.strike = p !== 0;
					break;
				case 'super':
					state.super_ = true;
					state.sub = false;
					break;
				case 'sub':
					state.sub = true;
					state.super_ = false;
					break;
				case 'nosupersub':
					state.super_ = false;
					state.sub = false;
					break;
				case 'fs':
					// (Up to Word's limit of 1638 pt; a damaged file can say anything.)
					if (p != null) state.fontSize = Math.min(Math.max(p, 0), 3276);
					break;
				case 'cf':
					if (p != null) state.colorIndex = p;
					break;
				case 'cb':
				case 'chcbpat':
					state.backIndex = p ?? 0;
					break;
				case 'cbpat':
					state.paragraphBackIndex = p ?? 0;
					break;
				case 'clcbpat':
					pendingDef.shade = shadeAt(p ?? 0);
					break;
				case 'highlight':
					if (p != null) state.highlightIndex = p;
					break;
				case 'f':
					if (p != null) state.fontIndex = p;
					break;
				// Alignment is the paragraph's and holds, like an indent, until \pard: Word and
				// TextEdit state it once for a run of centered paragraphs, not once for each.
				case 'ql':
					state.align = 'left';
					break;
				case 'qr':
					state.align = 'right';
					break;
				case 'qc':
					state.align = 'center';
					break;
				case 'qj':
					state.align = 'justify';
					break;
				case 'v':
					state.hidden = p !== 0;
					break;
				case 'deleted':
					state.deleted = p !== 0;
					break;
				case 'li':
					state.leftIndent = p ?? 0;
					break;
				case 'ri':
					state.rightIndent = p ?? 0;
					break;
				case 'fi':
					state.firstLineIndent = p ?? 0;
					break;
				case 'sb':
					state.spaceBefore = Math.max(0, p ?? 0);
					break;
				case 'sa':
					state.spaceAfter = Math.max(0, p ?? 0);
					break;
				case 'sl':
					state.lineSpacing = p ?? 0;
					break;
				case 'slmult':
					state.lineMultiple = p === 1;
					break;
				case 'par':
				case 'sect':
					// \sect ends a section, and with it the paragraph: "A\sect B" is two lines.
					paragraphMark(state);
					break;
				case 'trowd':
					// A row's definition, not its start: Word writes the definition before the
					// cells and again before \row, so the cells read so far are kept.
					currentRowDefs = [];
					rowGaph = null;
					pendingDef = newCellDef();
					pendingSide = null;
					borderSide = null;
					cellBorders = { b: false, other: false, bare: false };
					lastRow = false;
					break;
				case 'lastrow':
					lastRow = true;
					break;
				case 'trgaph':
					rowGaph = p ?? null;
					pendingSide = null;
					pendingDef.edge = null;
					break;
				case 'trkeep':
				case 'trleft':
				case 'trhdr':
					pendingSide = null;
					pendingDef.edge = null;
					break; // table formatting, ignored
				case 'clbrdrr':
				case 'clbrdrl':
				case 'clbrdrt':
					pendingSide = 'other';
					borderSide = null;
					pendingDef.edge = w === 'clbrdrr' ? 'r' : w === 'clbrdrl' ? 'l' : 't';
					pendingDef.drawn = null;
					break;
				case 'clbrdrb':
					pendingSide = 'b';
					borderSide = null;
					pendingDef.edge = 'b';
					pendingDef.drawn = null;
					break;
				case 'brdrnone':
				case 'brdrnil':
				case 'brdrtbl':
					pendingSide = null;
					borderSide = null;
					pendingDef.edge = null;
					pendingDef.drawn = null;
					break;
				case 'brdrw':
				case 'brdrcf':
					// A width or a color: a line someone drew under the cell (a signature line,
					// the rule that closes a table), which Word and TextEdit never write
					// without one. The writer's header mark is the bare \clbrdrb\brdrs.
					if (borderSide === 'b') cellBorders.bare = false;
					if (pendingDef.drawn && p != null) {
						const border = pendingDef.borders[pendingDef.drawn]!;
						if (w === 'brdrw') {
							// (No width is no line: Word writes \brdrw0 for a border that is off.)
							if (p > 0) border.twips = p;
							else delete pendingDef.borders[pendingDef.drawn];
						} else {
							const color = p > 0 && p < colorTable.length ? colorTable[p] : '';
							border.color = color === 'rgb(0,0,0)' ? '' : color;
						}
					}
					break;
				// Every border style RTF names: any of them makes the side a border.
				case 'brdrs':
				case 'brdrdb':
				case 'brdrth':
				case 'brdrsh':
				case 'brdrdot':
				case 'brdrdash':
				case 'brdrhair':
				case 'brdrdashsm':
				case 'brdrdashd':
				case 'brdrdashdd':
				case 'brdrdashdotstr':
				case 'brdrtriple':
				case 'brdrtnthsg':
				case 'brdrthtnsg':
				case 'brdrtnthtnsg':
				case 'brdrtnthmg':
				case 'brdrthtnmg':
				case 'brdrtnthtnmg':
				case 'brdrtnthlg':
				case 'brdrthtnlg':
				case 'brdrtnthtnlg':
				case 'brdrwavy':
				case 'brdrwavydb':
				case 'brdremboss':
				case 'brdrengrave':
				case 'brdroutset':
				case 'brdrinset':
					if (pendingSide) {
						cellBorders[pendingSide] = true;
						if (pendingSide === 'b') cellBorders.bare = w === 'brdrs';
					}
					borderSide = pendingSide;
					pendingSide = null;
					if (pendingDef.edge) {
						pendingDef.borders[pendingDef.edge] = { line: BORDER_LINE_CSS.get(w) ?? 'solid', twips: 15, color: '' };
						pendingDef.drawn = pendingDef.edge;
						pendingDef.edge = null;
					}
					break;
				case 'clvmgf':
					pendingDef.vmgf = true;
					break;
				case 'clvmrg':
					pendingDef.vmrg = true;
					break;
				case 'clmgf':
					pendingDef.hmgf = true;
					break;
				case 'clmrg':
					pendingDef.hmrg = true;
					break;
				case 'cellx':
					if (p != null) {
						pendingDef.right = p;
						pendingDef.header = cellBorders.b && cellBorders.bare && !cellBorders.other;
						currentRowDefs.push(pendingDef);
					}
					pendingDef = newCellDef();
					pendingSide = null;
					borderSide = null;
					cellBorders = { b: false, other: false, bare: false };
					break;
				case 'intbl':
					inTableCell = true;
					break;
				case 'cell':
					if (pendingHighSurrogate) {
						pendingHighSurrogate = 0;
						pushText('\ufffd', state);
					}
					// (A caption in a cell is the cell's; it is not the paragraph's after the table.)
					paragraphIsCaption = false;
					const figure = cellFigure();
					currentRowCells.push({
						html: figure ?? cellHtml(spacingHere(state)),
						onWhite: figure ? undefined : cellOnWhite(),
						// The alignment of the cell's last paragraph, also where that paragraph
						// was ended inside a group ({\pard\intbl\qr 1.0\par}\cell, as this writer
						// wrote cells up to 1.9.0).
						align: alignHere(state),
						header: cellMarkedHeader
					});
					cellMarkedHeader = false;
					newRuns();
					// The paragraph mark that ends a cell's last paragraph adds no line.
					cellBreaks = 0;
					cellBreakSpacing = [];
					nestTabPending = false;
					break;
				case 'nestcell':
					// A table inside a cell is read as lines of text in that cell: its cells a
					// tab apart, each of its rows a line. The writer sends one the same way.
					nestTabPending = true;
					break;
				case 'nestrow':
					nestTabPending = false;
					cellBreaks++;
					cellBreakSpacing.push(null);
					break;
				case 'row': {
					// Text after the row's last \cell is a cell that was not closed, not the
					// start of the paragraph after the table.
					if (trimSpaces(renderRuns(runs))) {
						currentRowCells.push({ html: trimSpaces(renderRuns(runs)), onWhite: cellOnWhite(), align: alignHere(state) });
						newRuns();
					}
					// A row with no definition of its own repeats the one before it.
					const defs = currentRowDefs.length > 0 ? currentRowDefs : lastRowDefs;
					const gaph: number | null = currentRowDefs.length > 0 ? rowGaph : lastRowGaph;
					tableRows.push({ cells: currentRowCells, defs, gaph });
					lastRowDefs = defs;
					lastRowGaph = gaph;
					currentRowCells = [];
					currentRowDefs = [];
					pendingDef = newCellDef();
					inTableCell = false;
					cellBreaks = 0;
					cellBreakSpacing = [];
					nestTabPending = false;
					// The cell's indents and alignment end with the row, in whichever group
					// set them: \row may sit in a group of its own ({\row}). Not in the text a
					// footnote or text box is anchored in, though: a table in a note left the
					// paragraph around the note uncentered.
					for (let k = stateBase; k < stateStack.length; k++) {
						resetIndents(stateStack[k]);
						stateStack[k].align = 'left';
					}
					// \lastrow: the table ends here. Without this, a table that follows with
					// no paragraph between was read as more rows of the same one, and where
					// their columns differed the cells came out merged.
					if (lastRow) {
						lastRow = false;
						flushTable();
					}
					break;
				}
				case 'pard':
					// \pard resets the paragraph, not the characters: bold, italic, underline
					// and strikethrough carry on until \plain or their own \b0. Word relies on it.
					state.align = 'left';
					state.paragraphBackIndex = 0;
					resetIndents(state);
					// Being in a table is a paragraph property too. Without this, one \intbl with
					// no \row made a single cell of the rest of the document. The marker group
					// of a list item ({\listtext\pard …}) resets only itself. Between a row's
					// first \cell and its \row the table goes on whatever \pard says: a writer
					// that leaves \intbl out there still means the next cell.
					if (!state.inList && currentRowCells.length === 0) inTableCell = false;
					break;
				case 'line':
				case 'column':
					// (\column: the text goes on in the next column, which on a screen with one
					// column is the next line.)
					appendHtml('br', '<br>', state);
					break;
				case 'chftn':
					// The number of a footnote: where the text refers to it, and again at the
					// start of the note itself.
					if (!shown(state)) break;
					if (noteNumber < 0) {
						noteMark = ++noteCount;
						appendText(String(noteMark), state);
					} else {
						if (noteNumber === 0) noteNumber = ++noteCount;
						appendText(String(noteNumber), state);
					}
					break;
				case 'tab':
					appendTab(state);
					break;
				case 'pntext':
				case 'listtext':
					state.inList = true;
					paragraphHasListMarker = true;
					break;
				case 'u': {
					if (p != null) {
						pendingUnicodeSkip = state.ucSkip ?? 1;
						// \uN is a signed 16-bit number; some writers give the code point itself.
						const code = p < 0 ? p + 65536 : p;
						if (code <= 0 || code > 0x10ffff) break; // no character: a NUL, or out of range
						if (!shown(state)) break;
						if (code >= 0xd800 && code <= 0xdbff) {
							// The first half of a pair: one character with the \u that follows.
							if (pendingHighSurrogate) appendText('\ufffd', state);
							pendingHighSurrogate = code;
						} else if (code >= 0xdc00 && code <= 0xdfff) {
							const high = pendingHighSurrogate;
							pendingHighSurrogate = 0;
							appendText(high ? String.fromCharCode(high, code) : '\ufffd', state);
						} else if (code < 0x20 || code === 0x7f) {
							// A control character: a tab is a tab, the rest are not text.
							if (code === 9) appendTab(state);
						} else {
							// A Unicode character is itself in any font. Only Word's U+F0xx,
							// its way of writing a byte of a symbol font, is a place in Symbol.
							appendChars(String.fromCodePoint(code), state, code >= 0xf020 && code <= 0xf0ff);
						}
					}
					break;
				}
				case 'uc':
					if (p != null) {
						state.ucSkip = Math.max(0, p);
					}
					break;
				case 'plain':
					state.bold = false;
					state.italic = false;
					state.underline = false;
					state.strike = false;
					state.super_ = false;
					state.sub = false;
					state.fontSize = 24;
					state.colorIndex = 0;
					state.highlightIndex = 0;
					state.backIndex = 0;
					state.fontIndex = defaultFont;
					state.hidden = false;
					state.deleted = false;
					break;
				case 'page':
					// A page break. On screen it is a rule; the writer sends it back as \page.
					if (inTableCell) {
						cellBreaks++;
						cellBreakSpacing.push(null);
						break;
					}
					for (; cellBreaks > 0; cellBreaks--) flushParagraph();
					cellBreakSpacing = [];
					if (runs.length > 0) flushParagraph();
					flushTable();
					blocks.push({ kind: 'rule', pageBreak: true });
					break;
				case 'emspace':
				case 'enspace':
					appendHtml('gap', '&emsp;', state);
					break;
				case 'qmspace':
					appendText('\u2005', state); // a quarter of an em
					break;
				case 'emdash':
					appendText('\u2014', state);
					break;
				case 'endash':
					appendText('\u2013', state);
					break;
				case 'lquote':
					appendText('\u2018', state);
					break;
				case 'rquote':
					appendText('\u2019', state);
					break;
				case 'ldblquote':
					appendText('\u201C', state);
					break;
				case 'rdblquote':
					appendText('\u201D', state);
					break;
				case 'bullet':
					appendText('\u2022', state);
					break;
				default:
					break;
			}
		} else {
			const state = currentState();
			if (pendingUnicodeSkip > 0) {
				// The characters after \uN that stand in for it where Unicode is not read.
				if (node.hex) {
					pendingUnicodeSkip--;
					continue;
				}
				const skipCount = Math.min(pendingUnicodeSkip, node.value.length);
				pendingUnicodeSkip -= skipCount;
				appendChars(node.value.slice(skipCount), state);
				continue;
			}
			appendChars(node.value, state);
		}
	}

	finishContent();
	// Footnotes, after everything else: each begins with the number the text refers to it by.
	for (const note of notes) {
		for (const block of note) blocks.push(block);
	}

	// ── Building the HTML ──

	/** Each block as an ordinary paragraph's content: what it is unless it turns out to be more. */
	const plain = blocks.map((b) => (b.kind === 'paragraph' ? trimSpaces(renderRuns(b.runs)) : b.kind === 'table' ? b.html : '<hr>'));

	/**
	 * A list item as the writer sends one: a bullet or "N.", a tab, and a paragraph that hangs by
	 * 360 twips with nothing else set. Only that shape is rebuilt as <ul> or <ol>, because only
	 * that shape is written back the same. A line someone typed with a dash or a bullet, a list
	 * hung by another distance or centered, stays the paragraph it is, marker and all. An item
	 * numbered in letters ("C.", "iv.") is one of a list that counts so (<ol type="A">).
	 */
	interface ListItem {
		kind: 'ul' | 'ol';
		number: number;
		letters?: string;
		left: number;
		html: string;
		/** Its spacing, as the <li>'s style: Word spaces list paragraphs as any other. */
		spacing: string;
	}
	const items: (ListItem | null)[] = blocks.map((b) => {
		if (b.kind !== 'paragraph' || !b.marker || b.inTable || b.caption) return null;
		if (b.first !== -LIST_HANG || b.left < LIST_HANG || b.right !== 0 || b.align !== 'left') return null;
		return {
			kind: b.marker.kind,
			number: b.marker.number,
			letters: b.marker.letters,
			left: b.left,
			html: trimSpaces(renderRuns(b.runs.slice(b.marker.end))),
			spacing: spacingStyle(b)
		};
	});

	/** Consecutive list items as nested <ul> and <ol>, one string per list at the top level. */
	function renderLists(list: ListItem[]): string[] {
		const out: string[] = [];
		let html = '';
		const open: { kind: 'ul' | 'ol'; left: number; next: number; style: NumberStyle }[] = [];
		/**
		 * The number an item has and the way its list counts. Letters can be read two ways: "C"
		 * is the third letter and the Roman 100. It is the one that goes on with the list the
		 * item is in; where it opens a list, the one the next item at its level goes on with
		 * ("D." or "CI."); and with neither to go by, a Roman numeral for "I" and for several
		 * letters, a letter for any other.
		 */
		/**
		 * For each item, the next one at its level in the same run of items: the one after it
		 * with the same indent, with none of a smaller indent between; -1 where there is none.
		 * Found for all of them in one pass from the end. (Looked for from each item in turn,
		 * a list in which every item is one level deeper than the last was read through once
		 * for each of its items: a second for 20,000 of them, four for 40,000.)
		 */
		const nextAtLevel: number[] = new Array(list.length).fill(-1);
		{
			/** The items after this one that one before it may still go on to: the nearest at each indent, the smallest indent first. */
			const ahead: { left: number; at: number }[] = [];
			for (let i = list.length - 1; i >= 0; i--) {
				const left = list[i].left;
				while (ahead.length > 0 && ahead[ahead.length - 1].left > left) ahead.pop();
				const same = ahead[ahead.length - 1];
				if (same && same.left === left) {
					nextAtLevel[i] = same.at;
					same.at = i;
				} else {
					ahead.push({ left, at: i });
				}
			}
		}
		const readingOf = (at: number, top: (typeof open)[number] | undefined): LetterReading => {
			const item = list[at];
			if (!item.letters) return { style: 'decimal', number: item.number };
			const readings = letterReadings(item.letters);
			if (top && top.kind === 'ol' && item.left === top.left) {
				const goesOn = readings.find((r) => r.style === top.style && r.number === top.next);
				if (goesOn) return goesOn;
			}
			if (readings.length === 1) return readings[0];
			const next = nextAtLevel[at];
			if (next !== -1) {
				const after = list[next].letters ? letterReadings(list[next].letters!) : [];
				const led = readings.find((r) => after.some((a) => a.style === r.style && a.number === r.number + 1));
				if (led) return led;
			}
			const roman = item.letters.length > 1 || /^[Ii]$/.test(item.letters);
			return readings.find((r) => r.style.endsWith(roman ? 'roman' : 'alpha')) ?? readings[0];
		};
		const closeList = () => {
			const done = open.pop()!;
			html += `</li></${done.kind}>`;
			if (open.length === 0) {
				out.push(html);
				html = '';
			}
		};
		for (const [at, item] of list.entries()) {
			// A smaller indent ends the lists nested deeper than it.
			while (open.length > 0 && item.left < open[open.length - 1].left) closeList();
			const top = open[open.length - 1];
			const { style, number } = readingOf(at, top);
			if (top && item.left === top.left && item.kind === top.kind && (item.kind === 'ul' || (number === top.next && style === top.style))) {
				html += `</li><li${item.spacing ? ` style="${item.spacing}"` : ''}>`;
				top.next = number + 1;
			} else {
				// A change from bullets to numbers, or a number out of sequence, is a new list
				// in the same place.
				if (top && item.left === top.left) closeList();
				const parent = open[open.length - 1];
				// What the indent adds to the half inch a list level has by itself.
				const margin = item.left - (parent ? parent.left : 0) - LIST_STEP;
				const start = item.kind === 'ol' && number !== 1 ? ` start="${number}"` : '';
				const type = item.kind === 'ol' && style !== 'decimal' ? ` type="${listTypeAttribute(style)}"` : '';
				html += `<${item.kind}${type}${start}${margin !== 0 ? ` style="margin-left:${twipsToPt(margin)}"` : ''}><li${item.spacing ? ` style="${item.spacing}"` : ''}>`;
				open.push({ kind: item.kind, left: item.left, next: number + 1, style });
			}
			html += item.html || '<br>';
		}
		while (open.length > 0) closeList();
		return out;
	}

	/** Whether a paragraph is a heading or a code block, from the formatting of all its text. */
	function classify(b: ParagraphBlock): { tag: 'h1' | 'h2' | 'h3'; options: RenderOptions } | { tag: 'pre' } | null {
		const visible = b.runs.filter((r): r is Extract<Run, { type: 'text' }> => r.type === 'text' && !ONLY_SPACES.test(r.text));
		if (visible.length === 0 || b.runs.some((r) => r.type === 'html' && r.kind === 'img')) return null;
		// The size must be the whole paragraph's: one large word does not make a heading.
		const size = visible[0].fmt.fontSize;
		if (visible.some((r) => r.fmt.fontSize !== size)) return null;
		if (size === preSize && visible.every((r) => r.fmt.mono)) return { tag: 'pre' };
		if (size === bodySize) return null;
		// A heading is larger than the body and bold throughout, as every heading the writer
		// emits is. Size alone does not make one: a report set in 14 pt throughout, read on a
		// 12 pt screen, came back as nothing but headings, and was saved all bold.
		if (!visible.every((r) => r.fmt.bold)) return null;
		// Compared in half-points, rounded the way the writer rounds them, so
		// a heading written at any body size is read back as the same level.
		for (const tag of ['h1', 'h2', 'h3'] as const) {
			const nominal = Math.round(bodySize * HEADING_SCALE[tag]);
			// The heading's own size and bold are the element's: only a size that differs
			// from it is kept inside.
			if (size >= nominal) return { tag, options: { dropSize: nominal, dropBold: true } };
		}
		return null;
	}

	const rendered: string[] = [];
	// A typed line that starts with a dash or a bullet; a rebuilt list item is not one.
	const isListLine = (i: number) =>
		i >= 0 && i < plain.length && !items[i] && /^[-\u2022]/.test(plain[i].replace(/^&emsp;+/g, ''));

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const trimmed = plain[i];

		if (block.kind === 'rule') {
			rendered.push(block.pageBreak ? '<hr style="break-after:page">' : '<hr>');
			continue;
		}
		if (block.kind === 'table') {
			rendered.push(trimmed);
			continue;
		}

		if (items[i]) {
			const list: ListItem[] = [];
			for (; i < blocks.length && items[i]; i++) list.push(items[i]!);
			i--;
			rendered.push(...renderLists(list));
			continue;
		}

		const align = block.align;
		// The paragraph's style attribute: its alignment, then its indents and its spacing.
		const blockStyle = [align !== 'left' ? `text-align:${align}` : '', block.inTable ? '' : indentStyle(block), block.inTable ? '' : spacingStyle(block)]
			.filter(Boolean)
			.join(';');
		const styleAttr = blockStyle ? ` style="${blockStyle}"` : '';

		if (!trimmed) {
			if (isListLine(i - 1) && isListLine(i + 1)) {
				continue;
			}
			const last = rendered[rendered.length - 1];
			if (last === '<p><br></p>') {
				continue;
			}
			rendered.push('<p><br></p>');
			continue;
		}

		// The rule the writer sends for <hr>: a centered line of em dashes, and nothing else.
		if (
			align === 'center' &&
			block.runs.every((r) => r.type === 'text' && !r.fmt.bold && !r.fmt.italic && !r.fmt.underline && !r.fmt.strike && !r.fmt.link) &&
			// (Spaces around the dashes do not show: a space written between two blocks lands in
			// front of them, and the rule was then a line of dashes until the next save.)
			trimSpaces(block.runs.map((r) => (r.type === 'text' ? r.text : '')).join('')) === RULE_DASHES
		) {
			rendered.push('<hr>');
			continue;
		}

		// A paragraph tagged by {\*\inkcap} is the description of the figure above it.
		if (block.caption) {
			const last = rendered.length - 1;
			if (last >= 0 && rendered[last].startsWith('<figure') && !rendered[last].includes('<figcaption')) {
				// The caption is given by a function: as a replacement string, a "$&" or a "$`"
				// in the caption's own text would be read as the match or as the figure before it.
				const caption = `<figcaption>${stripWrappingEm(trimmed)}</figcaption></figure>`;
				// (The space after a picture is written after its caption.)
				rendered[last] = withStyle(rendered[last].replace('</figure>', () => caption), block.inTable ? '' : spacingStyle(block, 'after'));
				continue;
			}
		}

		// A paragraph holding nothing but pictures becomes a figure, so it can carry
		// a caption and be aligned/resized as a unit in the editor.
		if (IMAGE_ONLY_PARAGRAPH.test(trimmed)) {
			const figureStyle = [align !== 'left' ? `text-align:${align}` : '', block.inTable ? '' : figureIndentStyle(block), block.inTable ? '' : spacingStyle(block, 'before'), block.inTable ? '' : spacingStyle(block, 'after')]
				.filter(Boolean)
				.join(';');
			rendered.push(`<figure${figureStyle ? ` style="${figureStyle}"` : ''}>${trimmed}</figure>`);
			continue;
		}

		const kind = classify(block);
		if (kind?.tag === 'pre') {
			// A code block keeps its spaces, and is written back with a left indent only.
			const left = block.inTable ? 0 : Math.max(0, block.left);
			const preStyle = left > 0 ? ` style="margin-left:${twipsToPt(left)}"` : '';
			rendered.push(`<pre${preStyle}>${renderRuns(block.runs, { pre: true, dropSize: preSize })}</pre>`);
			continue;
		}
		if (kind) {
			// A heading is bold throughout, on screen and when it is written again, so its
			// pieces are joined as if they all were: what differed only in bold is one piece.
			const bold: Run[] = [];
			for (const run of block.runs) {
				const fmt = { ...run.fmt, bold: true };
				const last = bold[bold.length - 1];
				if (run.type === 'text' && last?.type === 'text' && sameFormat(last.fmt, fmt)) last.text += run.text;
				else bold.push({ ...run, fmt });
			}
			rendered.push(`<${kind.tag}${styleAttr}>${trimSpaces(renderRuns(bold, kind.options))}</${kind.tag}>`);
			continue;
		}
		rendered.push(`<p${styleAttr}>${trimmed}</p>`);
	}

	const output = rendered.join('\n');

	return output || '<p></p>';
}

/** Captions are written as italic text; <figcaption> supplies its own styling. */
function stripWrappingEm(html: string): string {
	// Only when the italics are one piece: "<em>a</em> b <em>c</em>" starts and ends the same way.
	if (!html.startsWith('<em>') || !html.endsWith('</em>')) return html;
	const inner = html.slice(4, -5);
	return inner.includes('</em>') ? html : inner;
}

export function readRtfFile(file: File, options: RtfReadOptions = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const maxBytes = options.maxBytes ?? DEFAULT_MAX_RTF_BYTES;
		// Refused before it is read: reading is what takes the memory.
		if (maxBytes > 0 && file.size > maxBytes) {
			reject(new Error(`This file is too large to import: ${overLimit(file.size, maxBytes)}`));
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const text = reader.result as string;
				const html = rtfToHtml(text, options);
				resolve(html);
			} catch (err) {
				reject(new Error(`Failed to parse RTF: ${(err as Error).message}`));
			}
		};
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file, 'ascii');
	});
}
