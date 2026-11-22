/**
 * The marker a numbered list item shows: "3.", "C.", "iii.".
 *
 * A browser numbers the items of an <ol> by the list's `type` or `list-style-type`, the list's
 * `start` and an item's own `value`. The RTF and the Markdown carry a marker as text, so what is
 * written is worked out here, once, the way a browser shows it: a list lettered A, B, C that was
 * written 1, 2, 3 left "see part B" pointing at an item labelled "2.".
 */

/** The ways a numbered list counts that are written as they show. Any other is written in digits. */
export type NumberStyle = 'decimal' | 'upper-alpha' | 'lower-alpha' | 'upper-roman' | 'lower-roman';

/** The `type` attribute of an <ol> for each style, and back. */
const TYPE_OF_STYLE: Record<NumberStyle, string> = {
	decimal: '1',
	'upper-alpha': 'A',
	'lower-alpha': 'a',
	'upper-roman': 'I',
	'lower-roman': 'i'
};
const STYLE_OF_TYPE = new Map<string, NumberStyle>(Object.entries(TYPE_OF_STYLE).map(([style, type]) => [type, style as NumberStyle]));

/** What CSS calls each style; `upper-latin` is another name for `upper-alpha`. */
const STYLE_OF_CSS = new Map<string, NumberStyle>([
	['decimal', 'decimal'],
	['upper-alpha', 'upper-alpha'],
	['upper-latin', 'upper-alpha'],
	['lower-alpha', 'lower-alpha'],
	['lower-latin', 'lower-alpha'],
	['upper-roman', 'upper-roman'],
	['lower-roman', 'lower-roman']
]);

/** The `type` attribute that shows a style: 'A' for upper-alpha. */
export function listTypeAttribute(style: NumberStyle): string {
	return TYPE_OF_STYLE[style];
}

/** The style an element asks for by itself, or null: its `list-style-type`, then its `type`. */
function ownStyle(el: Element | null | undefined): NumberStyle | null {
	if (!el) return null;
	const css = ((el as HTMLElement).style?.listStyleType ?? '').trim().toLowerCase();
	if (css) return STYLE_OF_CSS.get(css) ?? 'decimal';
	// (The attribute tells "A" from "a": it is not lowercased.)
	return STYLE_OF_TYPE.get((el.getAttribute('type') ?? '').trim()) ?? null;
}

/**
 * How an item of a numbered list counts: its own `list-style-type` or `type` (Google Docs puts
 * the style on each item), then the list's. A style that is none of NumberStyle counts in digits.
 */
export function numberStyleOf(list: Element, item?: Element | null): NumberStyle {
	return ownStyle(item) ?? ownStyle(list) ?? 'decimal';
}

/** The number a list starts at: its `start`, or 1. */
export function listStart(list: Element): number {
	const start = parseInt(list.getAttribute('start') ?? '', 10);
	return Number.isFinite(start) ? start : 1;
}

/** The number of an item: its own `value` where it has one, else the count so far. */
export function itemNumber(item: Element, counter: number): number {
	if (!item.hasAttribute('value')) return counter;
	const value = parseInt(item.getAttribute('value') ?? '', 10);
	return Number.isFinite(value) ? value : counter;
}

const ROMAN: [number, string][] = [
	[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
	[50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
];

function roman(n: number): string {
	let out = '';
	for (const [value, letters] of ROMAN) {
		while (n >= value) {
			out += letters;
			n -= value;
		}
	}
	return out;
}

/** A, B, … Z, AA, AB, …: the letters count as a browser's do. */
function alpha(n: number): string {
	let out = '';
	for (; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
	return out;
}

/**
 * A number as a list of that style shows it, without the period: 3, "C", "iii". A number the
 * style cannot write (letters below 1, Roman numerals below 1 or above 3999) is shown in digits,
 * as a browser shows it.
 */
export function markerText(n: number, style: NumberStyle): string {
	if (style === 'decimal' || !Number.isInteger(n) || n < 1) return String(n);
	if (style === 'upper-alpha') return alpha(n);
	if (style === 'lower-alpha') return alpha(n).toLowerCase();
	if (n > 3999) return String(n);
	return style === 'upper-roman' ? roman(n) : roman(n).toLowerCase();
}

/** A marker written in letters, read as a number: by which style, and which number. */
export interface LetterReading {
	style: NumberStyle;
	number: number;
}

/**
 * What a marker written in letters can mean: "C" is the third letter and the Roman 100; "IV" is
 * a Roman 4; "ab" is the 28th item of a lettered list. Empty for letters that are no marker: of
 * mixed case, more than two letters that are no Roman numeral.
 */
export function letterReadings(letters: string): LetterReading[] {
	const upper = letters.toUpperCase();
	const isUpper = letters === upper;
	if (!/^[A-Z]+$/.test(upper) || (!isUpper && letters !== letters.toLowerCase())) return [];
	const readings: LetterReading[] = [];
	if (upper.length <= 2) {
		let number = 0;
		for (const letter of upper) number = number * 26 + (letter.charCodeAt(0) - 64);
		readings.push({ style: isUpper ? 'upper-alpha' : 'lower-alpha', number });
	}
	if (/^[MDCLXVI]+$/.test(upper)) {
		let number = 0;
		let rest = upper;
		for (const [value, numeral] of ROMAN) {
			while (rest.startsWith(numeral)) {
				number += value;
				rest = rest.slice(numeral.length);
			}
		}
		// (Only a numeral as it is written: "IIII" and "VX" are letters.)
		if (number >= 1 && number <= 3999 && roman(number) === upper) readings.push({ style: isUpper ? 'upper-roman' : 'lower-roman', number });
	}
	return readings;
}

// ── The gap after the marker ──
// How far an item's text starts from its bullet or number is the list's text indent, as Word
// has it: the marker starts where the list does, and the text that far further in. In the HTML
// it is the list's own `padding-left`, which is that distance in CSS too: from the list's edge
// to its items' text. The editor draws the marker at the list's edge (see markItems), and the
// RTF has it as the hang of each item (\fi-N). A list with no padding of its own has the gap
// the writer always gave one: a quarter inch, \fi-360.

/** The least gap there is, in twips: 6 pt. Closer, a number runs into its text. */
export const LEAST_MARKER_GAP = 120;
/** The most, in twips: two inches. */
export const MOST_MARKER_GAP = 2880;

const TWIPS_PER: Record<string, number> = { px: 15, pt: 20, in: 1440, cm: 1440 / 2.54, mm: 144 / 2.54 };

/**
 * The gap a list sets after its markers, in twips, or null where it sets none: no
 * `padding-left` of its own, or one out of the range above (a page's `padding-left: 0`).
 */
export function markerGapTwips(list: Element): number | null {
	const value = ((list as HTMLElement).style?.paddingLeft ?? '').trim().toLowerCase();
	const m = value.match(/^(\d+(?:\.\d+)?|\.\d+)(px|pt|in|cm|mm)$/);
	if (!m) return null;
	const twips = Math.round(parseFloat(m[1]) * TWIPS_PER[m[2]]);
	return twips >= LEAST_MARKER_GAP && twips <= MOST_MARKER_GAP ? twips : null;
}

/**
 * Where the editor writes, for the screen, the marker an item of a list with a gap shows. A
 * browser draws its own markers against the item's text, and cannot be told how far before
 * it; so for such a list the editor draws them itself, at the list's edge (see the editor's
 * style), from this. It is worked out here, as the RTF writer works it out: a browser's own
 * count does not see an item's `value` in every browser. It is no part of the document, and
 * the editor takes it out of what it gives (getHTML, onsave, the draft).
 */
export const MARKER_ATTRIBUTE = 'data-ink-marker';

/** The bullets of a list in a list, as the browser draws them: disc, circle, square. */
const BULLETS: Record<string, string> = { disc: '•', circle: '◦', square: '▪' };

/**
 * Write the marker of each item of each list with a gap under `root`, and take it off the
 * items of every other list. Only what differs is written, so that a document that has not
 * changed is not changed by this either.
 */
export function markItems(root: Element): void {
	for (const list of Array.from(root.querySelectorAll('ul, ol'))) {
		const gapped = markerGapTwips(list) !== null;
		const ordered = list.tagName === 'OL';
		let counter = ordered ? listStart(list) : 1;
		let bullet = '';
		if (gapped && !ordered) {
			const own = ((list as HTMLElement).style?.listStyleType ?? '').trim().toLowerCase();
			let depth = 0;
			for (let up = list.parentElement?.closest('ul, ol'); up && root.contains(up); up = up.parentElement?.closest('ul, ol')) depth++;
			bullet = BULLETS[own] ?? (depth === 0 ? BULLETS.disc : depth === 1 ? BULLETS.circle : BULLETS.square);
		}
		for (const item of Array.from(list.children)) {
			if (item.tagName !== 'LI') continue;
			let marker: string | null = null;
			if (gapped) {
				if (ordered) {
					counter = itemNumber(item, counter);
					marker = `${markerText(counter, numberStyleOf(list, item))}.`;
					counter++;
				} else {
					marker = bullet;
				}
			}
			if (marker === null) {
				if (item.hasAttribute(MARKER_ATTRIBUTE)) item.removeAttribute(MARKER_ATTRIBUTE);
			} else if (item.getAttribute(MARKER_ATTRIBUTE) !== marker) {
				item.setAttribute(MARKER_ATTRIBUTE, marker);
			}
		}
	}
}

/** Take the editor's markers out of a copy of a document. */
export function withoutMarkers(root: Element): void {
	for (const item of Array.from(root.querySelectorAll(`[${MARKER_ATTRIBUTE}]`))) item.removeAttribute(MARKER_ATTRIBUTE);
}
