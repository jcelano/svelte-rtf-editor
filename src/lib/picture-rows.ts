/**
 * Pictures side by side with a set gap between them.
 *
 * Pictures side by side are a table of one row, a picture in each cell. Without a gap the row
 * is as wide as the page and its cells share it equally; how far apart the pictures are then
 * depends on how wide the page is, and each is aligned within its share.
 *
 * With a gap, the row is laid out exactly: each picture's cell is as wide as the picture,
 * and between two pictures is an empty cell as wide as the gap. The table has no width of
 * its own, so it is as wide as what it holds, on the screen and in the RTF, where each cell
 * ends at an edge in twips (\cellx) and nothing is stretched to the page.
 *
 *   <table style="border-collapse:collapse;margin:4px 0"><tbody><tr>
 *     <td style="padding:0;width:150pt"><figure><img …></figure></td>
 *     <td style="padding:0;width:18pt"></td>
 *     <td style="padding:0;width:150pt"><figure><img …></figure></td>
 *   </tr></tbody></table>
 *
 * The RTF reader knows the shape again, a row of picture cells with an empty cell between
 * each two, and gives the same widths back.
 */

/** The style of the table of a row of pictures with a set gap: no width of its own. */
export const GAPPED_ROW_STYLE = 'border-collapse:collapse;margin:4px 0';

/** The widest gap that can be set, in points: two inches. */
export const MOST_GAP_PT = 144;

const TWIPS_PER_UNIT: Record<string, number> = { px: 15, pt: 20, in: 1440, cm: 1440 / 2.54, mm: 144 / 2.54 };

/** The width an element asks for as a length (not a share), in twips; null where it asks for none. */
export function lengthTwips(el: Element): number | null {
	const value = ((el as HTMLElement).style?.width || el.getAttribute('width') || '').trim().toLowerCase();
	const m = value.match(/^(\d+(?:\.\d+)?|\.\d+)(px|pt|in|cm|mm)?$/);
	if (!m) return null;
	const n = parseFloat(m[1]);
	return n > 0 ? n * TWIPS_PER_UNIT[m[2] ?? 'px'] : null;
}

/** A width in twips as the points a cell is given: exact to the twip. */
export const pointsOf = (twips: number): string => `${Math.round(twips) / 20}pt`;

const isCell = (el: Element) => /^(td|th)$/i.test(el.tagName);

/** A cell with nothing in it: the gap between two pictures. */
export function isGapCell(cell: Element): boolean {
	return isCell(cell) && cell.childNodes.length === 0;
}

/** A cell that holds one picture and nothing else: alone, or in its figure with its caption. */
export function holdsOnePicture(cell: Element): boolean {
	const held = Array.from(cell.children).filter((child) => child.tagName !== 'BR');
	if (held.length !== 1) return false;
	const unit = held[0];
	const tag = unit.tagName.toUpperCase();
	const pictures = tag === 'IMG' ? 1 : tag === 'FIGURE' ? unit.querySelectorAll('img').length : 0;
	if (pictures !== 1) return false;
	// (Words typed beside the picture make the cell an ordinary one.)
	return (cell.textContent ?? '').trim() === (unit.textContent ?? '').trim();
}

/**
 * Each column's width in twips, where the table is a row of pictures with set gaps: one row,
 * a picture's cell first and last and between each two of them a gap cell, every cell with a
 * length of its own, and the table with no width. Null for any other table, which is written
 * across the page as it always was.
 */
export function gappedRowWidths(table: Element): number[] | null {
	if (lengthOrShare(table)) return null;
	const rows = Array.from(table.querySelectorAll('tr')).filter((row) => row.closest('table') === table);
	if (rows.length !== 1) return null;
	const cells = Array.from(rows[0].children).filter(isCell);
	if (cells.length < 3 || cells.length % 2 === 0) return null;
	const widths: number[] = [];
	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i];
		if ((cell.getAttribute('colspan') ?? '1') !== '1' || (cell.getAttribute('rowspan') ?? '1') !== '1') return null;
		if (i % 2 === 0 ? !holdsOnePicture(cell) : !isGapCell(cell)) return null;
		const twips = lengthTwips(cell);
		if (twips === null) return null;
		widths.push(twips);
	}
	return widths;
}

/** Whether an element says how wide it is, in any unit. */
function lengthOrShare(el: Element): boolean {
	return !!((el as HTMLElement).style?.width || el.getAttribute('width'));
}
