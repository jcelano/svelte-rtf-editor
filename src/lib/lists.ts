/**
 * Lists, as the editor makes them.
 *
 * The browsers' own list commands each make something else of the same click. Chromium and
 * Safari leave the list inside the paragraph it was made from, which no HTML can say;
 * Firefox starts a new list beside the one a line is next to, so that every line made an item
 * one at a time is numbered 1; Chromium puts the caret at the start of the line. None of
 * them nests an item under the one before it. So the document is changed here, the same way
 * in every browser, and the editor's own history (history.ts) undoes it.
 *
 * The shape made is the one the RTF reader writes and the writer reads: a <ul> or <ol> of
 * <li>, and a list inside a list as the last thing in the item it is under.
 *
 *   <ol><li>Skin, left arm<ul><li>margins clear</li></ul></li><li>Lymph node</li></ol>
 *
 * Every function takes the editor's element and the selection, changes the document where
 * there is something to change, puts the selection back in the words it was in, and returns
 * whether it changed anything.
 */

export type ListKind = 'ul' | 'ol';

/** What ends a line: an element that is laid out as a block. */
const BLOCKS = 'ul, ol, li, div, p, table, thead, tbody, tfoot, tr, td, th, blockquote, pre, h1, h2, h3, h4, h5, h6, hr, figure, figcaption';
/** Blocks that are a line of text, which can be an item. */
const TEXT_BLOCK = /^(p|h[1-6]|div)$/;
/** Blocks nothing in which is a line that can be an item: a picture, a table's own parts, code. */
const NOT_LINES = /^(pre|figure|figcaption|table|thead|tbody|tfoot|tr|hr|ul|ol)$/;

const isElement = (node: Node | null | undefined): node is HTMLElement => node?.nodeType === 1;
const isText = (node: Node | null | undefined): node is Text => node?.nodeType === 3;
const isList = (node: Node | null | undefined): node is HTMLElement => isElement(node) && (node.localName === 'ul' || node.localName === 'ol');
const isItem = (node: Node | null | undefined): node is HTMLLIElement => isElement(node) && node.localName === 'li';
const isBlock = (node: Node | null | undefined): node is HTMLElement => isElement(node) && node.matches(BLOCKS);
const isBreak = (node: Node | null | undefined): boolean => isElement(node) && node.localName === 'br';
const isBlank = (node: Node): boolean => isText(node) && node.data.trim() === '';

/** A line of the document that is, or can be made, an item of a list. */
type Line =
	| { item: HTMLLIElement }
	/** A paragraph, a heading, or a <div> that holds text. */
	| { block: HTMLElement }
	/** Words in no paragraph: the nodes in a row straight inside `parent`, and the <br> that ends them. */
	| { loose: Node[]; end: Node | null; parent: Node };

const keyOf = (line: Line): Node => ('item' in line ? line.item : 'block' in line ? line.block : (line.loose[0] ?? line.end ?? line.parent));

/** The line a node is in, or null where it is in none that can be an item. */
function lineAt(root: HTMLElement, node: Node): Line | null {
	let at: Node | null = node;
	/** The node on the way up that is straight inside the block found. */
	let inside: Node | null = null;
	while (at && at !== root && !isBlock(at)) {
		inside = at;
		at = at.parentNode;
	}
	if (!at) return null;
	if (at !== root && isElement(at)) {
		const name = at.localName;
		if (name === 'li') return { item: at as HTMLLIElement };
		if (NOT_LINES.test(name)) return null;
		if (TEXT_BLOCK.test(name) && !Array.from(at.children).some(isBlock)) {
			// (A paragraph straight inside an item, as Word pastes a list, is the item's text.)
			return isItem(at.parentNode) ? { item: at.parentNode } : { block: at };
		}
	}
	// Words straight inside the document, a table cell, a quotation, or a <div> of blocks.
	if (!inside) return null;
	if (isBreak(inside)) {
		const loose: Node[] = [];
		for (let before = inside.previousSibling; before && !isBlock(before) && !isBreak(before); before = before.previousSibling) loose.unshift(before);
		return { loose, end: inside, parent: at };
	}
	const loose: Node[] = [inside];
	for (let before = inside.previousSibling; before && !isBlock(before) && !isBreak(before); before = before.previousSibling) loose.unshift(before);
	let after = inside.nextSibling;
	for (; after && !isBlock(after) && !isBreak(after); after = after.nextSibling) loose.push(after);
	// (The space a source has between two blocks is no line.)
	if (!isBreak(after) && loose.every(isBlank)) return null;
	return { loose, end: isBreak(after) ? after : null, parent: at };
}

/** The lines a selection touches, in the order of the document. */
function linesIn(root: HTMLElement, range: Range): Line[] {
	const lines: Line[] = [];
	const seen = new Set<Node>();
	const add = (node: Node) => {
		const line = lineAt(root, node);
		if (!line || seen.has(keyOf(line))) return;
		seen.add(keyOf(line));
		lines.push(line);
	};
	if (range.collapsed) {
		let node = range.startContainer;
		// (A caret said by an element is at one of its children: <p><br></p>, an empty item.)
		if (isElement(node) && node.childNodes.length > 0) node = node.childNodes[Math.min(range.startOffset, node.childNodes.length - 1)];
		// (And before a block, it is in the block: the document's element, before its first paragraph.)
		while (isBlock(node) && !NOT_LINES.test(node.localName) && node.firstChild && Array.from(node.children).some(isBlock)) node = node.firstChild;
		add(node);
		return lines;
	}
	const doc = root.ownerDocument;
	const within = doc.createRange();
	const walker = doc.createTreeWalker(root, 0x1 | 0x4 /* elements and text */);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const leaf = isText(node) ? node.data !== '' : isElement(node) && (node.localName === 'br' || node.localName === 'img');
		if (!leaf) continue;
		if (isText(node)) within.selectNodeContents(node);
		else within.selectNode(node);
		// A line is touched where the selection ends after the line's start: one that ends
		// at the very start of the next line does not take that line in. (It begins in the
		// line it begins in, also at the end of it.)
		const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, within) > 0;
		const beginsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, within) <= 0;
		if (endsAfterStart && beginsBeforeEnd) add(node);
	}
	return lines;
}

// ── The selection ──
// A node that is moved takes no selection with it: the browser puts a selection that was in
// it at the place it was taken from. So the selection is read before anything moves and put
// back after, in the same text; and where it was said by an element that was replaced (an
// empty paragraph made an item), by the element that took its place.

let replaced = new Map<Node, Node>();

/**
 * An end of the selection that is said by an element, as the same place said by the text it is
 * at: text keeps its place in the selection wherever it is moved, and "after the document's
 * first child" (Firefox's Select All) is somewhere else once that child is three paragraphs.
 */
function inward(node: Node, offset: number, toEnd: boolean): [Node, number] {
	while (isElement(node)) {
		const next: Node | undefined = node.childNodes[toEnd ? offset - 1 : offset];
		// (An empty line, said by the line itself, is said so: there is no text in it.)
		if (!next || !(isText(next) || next.childNodes.length > 0)) break;
		node = next;
		offset = !toEnd ? 0 : isText(next) ? next.length : next.childNodes.length;
	}
	return [node, offset];
}

function keepingSelection(sel: Selection | null, change: () => boolean): boolean {
	replaced = new Map();
	let ends: { anchor: [Node, number]; focus: [Node, number] } | null = null;
	if (sel && sel.rangeCount > 0 && sel.anchorNode && sel.focusNode) {
		const range = sel.getRangeAt(0);
		const forward = sel.anchorNode === range.startContainer && sel.anchorOffset === range.startOffset;
		const start = inward(range.startContainer, range.startOffset, false);
		const end = range.collapsed ? start : inward(range.endContainer, range.endOffset, true);
		ends = forward ? { anchor: start, focus: end } : { anchor: end, focus: start };
	}
	const done = change();
	if (done && sel && ends) {
		const now = ([node, offset]: [Node, number]): [Node, number] | null => {
			const at = replaced.get(node) ?? node;
			if (!at.isConnected) return null;
			return [at, Math.min(offset, isText(at) ? at.length : at.childNodes.length)];
		};
		const anchor = now(ends.anchor);
		const focus = now(ends.focus);
		if (anchor && focus) sel.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
	}
	replaced = new Map();
	return done;
}

// ── Lists ──

const listOf = (item: HTMLLIElement): HTMLElement | null => (isList(item.parentNode) ? item.parentNode : null);

/** Whether an item is in a list that is itself in a list. */
function isNested(item: HTMLLIElement): boolean {
	const above = listOf(item)?.parentNode;
	return isItem(above) || isList(above);
}

/** A list like this one, for the items that are parted from it: it looks the same, and is not the same list. */
function another(list: HTMLElement): HTMLElement {
	const copy = list.cloneNode(false) as HTMLElement;
	copy.removeAttribute('start');
	copy.removeAttribute('id');
	return copy;
}

/** Add a list to the list of its kind right before it, and the one right after it to it. Returns the list the items are in. */
function joinAround(list: HTMLElement): HTMLElement {
	const beside = (from: Node, step: 'previousSibling' | 'nextSibling'): HTMLElement | null => {
		let at = from[step];
		while (at && isBlank(at)) at = at[step];
		return isList(at) && at.localName === list.localName ? at : null;
	};
	const before = beside(list, 'previousSibling');
	if (before) {
		while (list.firstChild) before.appendChild(list.firstChild);
		list.remove();
		list = before;
	}
	const after = beside(list, 'nextSibling');
	if (after) {
		while (after.firstChild) list.appendChild(after.firstChild);
		after.remove();
	}
	return list;
}

/** Part a list around one of its items. Returns the list that item is now alone in, between what came before it and what came after. */
function alone(item: HTMLLIElement): HTMLElement {
	const list = listOf(item)!;
	const after: Node[] = [];
	for (let next = item.nextSibling; next; next = next.nextSibling) after.push(next);
	if (after.some((node) => !isBlank(node))) {
		const rest = another(list);
		rest.append(...after);
		list.after(rest);
	} else {
		for (const node of after) node.parentNode?.removeChild(node);
	}
	let first = true;
	for (let before = item.previousSibling; before; before = before.previousSibling) if (!isBlank(before)) first = false;
	if (first) return list;
	const own = another(list);
	list.after(own);
	own.appendChild(item);
	return own;
}

/** The same list as the other kind: what says how its items are marked is the other kind's to say. */
function asKind(list: HTMLElement, kind: ListKind): HTMLElement {
	if (list.localName === kind) return list;
	const made = list.ownerDocument.createElement(kind);
	for (const attr of Array.from(list.attributes)) {
		if (attr.name !== 'type' && attr.name !== 'start' && attr.name !== 'reversed') made.setAttribute(attr.name, attr.value);
	}
	made.style.listStyleType = '';
	made.style.listStyle = '';
	if (!made.getAttribute('style')) made.removeAttribute('style');
	list.replaceWith(made);
	while (list.firstChild) made.appendChild(list.firstChild);
	replaced.set(list, made);
	return made;
}

/** A line that has nothing in it is given the line break that keeps it a line to type in. */
function keepOpen(el: HTMLElement): void {
	if (!Array.from(el.childNodes).some((node) => !isBlank(node))) el.appendChild(el.ownerDocument.createElement('br'));
}

// ── What a line says of itself ──
// A paragraph made an item, and an item made a paragraph again, is the same line: its id, its
// class, an application's own data-* marks, its language, and the look of its words (a color,
// a font) go with it. What says how a paragraph is laid out does not: an item has the list's
// indent, and is written left-aligned with no spacing of its own (see the RTF writer), so on
// an item it would show what the RTF does not say. Nor does what says how an item is marked.

/** A paragraph's layout: not an item's. */
const PARAGRAPH_LAYOUT = { attributes: /^(align|data-rtf-tab-stops)$/, style: /^(margin|padding|text-indent|text-align|line-height)(-|$)/ };
/** An item's marker and number: not a paragraph's. */
const ITEM_MARKER = { attributes: /^(value|type)$/, style: /^list-style(-|$)/ };

/** Move what `from` says of itself to `to`, but what `leave` names; what `to` says already stays. */
function carry(from: Element, to: Element, leave: { attributes: RegExp; style: RegExp }): void {
	for (const attr of Array.from(from.attributes)) {
		if (leave.attributes.test(attr.name) || to.hasAttribute(attr.name)) continue;
		if (attr.name !== 'style') {
			to.setAttribute(attr.name, attr.value);
			continue;
		}
		const style = (from as HTMLElement).style;
		const own = (to as HTMLElement).style;
		for (const name of Array.from(style)) if (!leave.style.test(name)) own.setProperty(name, style.getPropertyValue(name), style.getPropertyPriority(name));
		if (!to.getAttribute('style')) to.removeAttribute('style');
	}
}

/** Make a line an item of a list of this kind: of the list it is next to, where it is next to one. */
function toItem(line: Exclude<Line, { item: HTMLLIElement }>, kind: ListKind): void {
	const doc = keyOf(line).ownerDocument!;
	const list = doc.createElement(kind);
	const item = doc.createElement('li');
	if ('block' in line) {
		line.block.replaceWith(list);
		while (line.block.firstChild) item.appendChild(line.block.firstChild);
		carry(line.block, item, PARAGRAPH_LAYOUT);
		replaced.set(line.block, item);
	} else {
		line.parent.insertBefore(list, line.loose[0] ?? line.end);
		item.append(...line.loose);
		// (The line break that ended the line: an item ends its own.)
		line.end?.parentNode?.removeChild(line.end);
		// (A caret said by what the words were straight inside, an empty table cell, is in the item.)
		if (!replaced.has(line.parent)) replaced.set(line.parent, item);
	}
	keepOpen(item);
	list.appendChild(item);
	joinAround(list);
}

/** Put an item one list further in: in a list at the end of the item before it. Returns false where there is none before it. */
function nest(item: HTMLLIElement): boolean {
	const list = listOf(item);
	let before = item.previousSibling;
	while (before && isBlank(before)) before = before.previousSibling;
	if (!list || !isItem(before)) return false;
	let last = before.lastChild;
	while (last && isBlank(last)) last = last.previousSibling;
	let under = isList(last) && last.localName === list.localName ? last : null;
	if (!under) {
		under = list.ownerDocument.createElement(list.localName);
		before.appendChild(under);
	}
	under.appendChild(item);
	// (A list of its own that it had is one list with what it is put beside.)
	return true;
}

/** Put an item one list further out: after the item its list is under. What followed it in its list is under it now. */
function unnest(item: HTMLLIElement): boolean {
	const list = listOf(item);
	const above = list?.parentNode;
	if (!list || !(isItem(above) || isList(above))) return false;
	const after: Node[] = [];
	for (let next = item.nextSibling; next; next = next.nextSibling) after.push(next);
	if (after.some((node) => !isBlank(node))) {
		let last = item.lastChild;
		while (last && isBlank(last)) last = last.previousSibling;
		let under = isList(last) && last.localName === list.localName ? last : null;
		if (!under) {
			under = another(list);
			item.appendChild(under);
		}
		under.append(...after);
	} else {
		for (const node of after) node.parentNode?.removeChild(node);
	}
	// (A list straight inside a list, as some editors nest, is parted where the item was.)
	(isItem(above) ? above : list).after(item);
	if (!Array.from(list.childNodes).some((node) => !isBlank(node))) list.remove();
	return true;
}

/** Make an item a paragraph again, where it is: its list is parted around it, and a list it had under it is a list after it. */
function toParagraph(item: HTMLLIElement): void {
	while (isNested(item)) unnest(item);
	if (!listOf(item)) return;
	const own = alone(item);
	const doc = item.ownerDocument;
	const parts: HTMLElement[] = [];
	let paragraph: HTMLElement | null = null;
	for (const child of Array.from(item.childNodes)) {
		if (isBlock(child)) {
			paragraph = null;
			parts.push(child);
			continue;
		}
		// (The space between two blocks of an item is no paragraph.)
		if (!paragraph && isBlank(child) && parts.length > 0) continue;
		if (!paragraph) {
			paragraph = doc.createElement('p');
			parts.push(paragraph);
		}
		paragraph.appendChild(child);
	}
	if (parts.length === 0) parts.push(doc.createElement('p'));
	for (const part of parts) if (part.localName === 'p') keepOpen(part);
	// (What the item said of itself is the first line's that it was: the paragraph of its own
	// words, or the paragraph Word put them in.)
	const first = parts.find((part) => TEXT_BLOCK.test(part.localName));
	if (first) carry(item, first, ITEM_MARKER);
	own.replaceWith(...parts);
	replaced.set(item, parts[0]);
	for (const part of parts) if (isList(part) && part.isConnected) joinAround(part);
}

/** The items among these that are not under another of them: that one takes them with it. */
function outermost(items: HTMLLIElement[]): HTMLLIElement[] {
	const all = new Set<Node>(items);
	return items.filter((item) => {
		for (let up = item.parentNode; up; up = up.parentNode) if (all.has(up)) return false;
		return true;
	});
}

const rangeOf = (sel: Selection | null, root: HTMLElement): Range | null => {
	if (!sel || sel.rangeCount === 0) return null;
	const range = sel.getRangeAt(0);
	return root.contains(range.startContainer) && root.contains(range.endContainer) ? range : null;
};

/** The items the selection touches, if every line it touches is one; else none. */
function itemsOnly(root: HTMLElement, range: Range): HTMLLIElement[] {
	const lines = linesIn(root, range);
	return lines.length > 0 && lines.every((line) => 'item' in line) ? lines.map((line) => (line as { item: HTMLLIElement }).item) : [];
}

/**
 * The toolbar's list button. The lines the selection touches are made items of a list of
 * this kind, and one list with a list of that kind they are next to. Where they are all
 * items of such a list already, they are paragraphs again. Where they are items of the
 * other kind: with a caret, the list the caret is in is made this kind; with words
 * selected, the items selected are.
 */
export function toggleList(root: HTMLElement, sel: Selection | null, kind: ListKind): boolean {
	const range = rangeOf(sel, root);
	if (!range) return false;
	const collapsed = range.collapsed;
	const lines = linesIn(root, range);
	if (lines.length === 0) return false;
	return keepingSelection(sel, () => {
		const items = lines.filter((line): line is { item: HTMLLIElement } => 'item' in line).map((line) => line.item);
		if (items.length === lines.length) {
			if (items.every((item) => listOf(item)?.localName === kind)) {
				// (Each of them: one that was under another is a paragraph after it.)
				for (const item of items) if (item.isConnected) toParagraph(item);
				return true;
			}
			if (collapsed) {
				const list = listOf(items[0]);
				if (list) joinAround(asKind(list, kind));
				return true;
			}
		}
		for (const line of lines) {
			if (!('item' in line)) toItem(line, kind);
			else if (line.item.isConnected && listOf(line.item) && listOf(line.item)!.localName !== kind) joinAround(asKind(alone(line.item), kind));
		}
		return true;
	});
}

/** Which kind of list the selection is in: the innermost list of the line it begins in. */
export function listKindAt(root: HTMLElement, sel: Selection | null): ListKind | null {
	let node = sel?.anchorNode;
	if (!sel || !node || !root.contains(node)) return null;
	// (A selection said by an element begins at one of its children: Firefox's Select All
	// is said by the document's element.)
	for (let offset = sel.anchorOffset; isElement(node) && node.localName !== 'li' && node.childNodes.length > 0; offset = 0) {
		node = node.childNodes[Math.min(offset, node.childNodes.length - 1)];
	}
	const item = (isElement(node) ? node : node.parentElement)?.closest('li');
	const list = item && root.contains(item) ? item.parentElement : null;
	return isList(list) ? (list.localName as ListKind) : null;
}

/**
 * Put the items the selection touches one list further in, each under the item before it.
 * Returns false, with nothing changed, where the selection is not all items, or the first of
 * them has no item before it to be under.
 */
export function nestItems(root: HTMLElement, sel: Selection | null): boolean {
	const range = rangeOf(sel, root);
	const items = range ? outermost(itemsOnly(root, range)) : [];
	if (items.length === 0) return false;
	let before = items[0].previousSibling;
	while (before && isBlank(before)) before = before.previousSibling;
	if (!isItem(before)) return false;
	return keepingSelection(sel, () => {
		let any = false;
		for (const item of items) any = nest(item) || any;
		return any;
	});
}

/** Put the items the selection touches that are in a list within a list one list further out. Returns false where none is. */
export function unnestItems(root: HTMLElement, sel: Selection | null): boolean {
	const range = rangeOf(sel, root);
	const items = range ? outermost(itemsOnly(root, range)).filter(isNested) : [];
	if (items.length === 0) return false;
	return keepingSelection(sel, () => {
		let any = false;
		for (const item of items) any = unnest(item) || any;
		return any;
	});
}

/**
 * The item the caret is in leaves its list by one step: one list further out, or, from a
 * list that is in no other, a paragraph. (What Enter does in an item with nothing in it, and
 * Backspace at the start of one.)
 */
export function leaveList(root: HTMLElement, sel: Selection | null): boolean {
	const range = rangeOf(sel, root);
	const items = range ? itemsOnly(root, range) : [];
	if (items.length !== 1) return false;
	return keepingSelection(sel, () => {
		if (isNested(items[0])) return unnest(items[0]);
		toParagraph(items[0]);
		return true;
	});
}

/** The item's own words and pictures: not those of a list under it. */
function ownContent(item: HTMLLIElement, upTo?: Range): { text: string; shows: boolean } {
	const range = item.ownerDocument.createRange();
	range.selectNodeContents(item);
	const under = Array.from(item.childNodes).find(isList);
	if (under) range.setEndBefore(under);
	if (upTo) range.setEnd(upTo.startContainer, upTo.startOffset);
	const held = range.cloneContents();
	return { text: (held.textContent ?? '').replace(/​/g, ''), shows: held.querySelector('img, br, hr, table') !== null };
}

/** The item the caret is in, where it is a caret in an item. */
function caretItem(root: HTMLElement, sel: Selection | null): { item: HTMLLIElement; range: Range } | null {
	const range = rangeOf(sel, root);
	if (!range || !range.collapsed) return null;
	const [item] = itemsOnly(root, range);
	return item ? { item, range } : null;
}

/** Whether the caret is in an item with nothing in it: no words, no picture. (One with a list under it has that.) */
export function inEmptyItem(root: HTMLElement, sel: Selection | null): boolean {
	const at = caretItem(root, sel);
	if (!at || Array.from(at.item.childNodes).some(isList)) return false;
	const own = ownContent(at.item);
	return own.text.trim() === '' && at.item.querySelector('img, hr, table') === null;
}

/** Whether the caret is at the very start of an item: nothing of the item before it. */
export function atItemStart(root: HTMLElement, sel: Selection | null): boolean {
	const at = caretItem(root, sel);
	if (!at) return false;
	const under = Array.from(at.item.childNodes).find(isList);
	if (under && (under === at.range.startContainer || under.contains(at.range.startContainer))) return false;
	const before = ownContent(at.item, at.range);
	return before.text === '' && !before.shows;
}
