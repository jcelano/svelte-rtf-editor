/**
 * The editor's own Undo and Redo.
 *
 * A browser's history knows what its own commands and the keyboard changed. It knows nothing
 * of what the editor changes in the document itself: a picture or a table put in, a picture
 * moved, an indent. Its Undo skipped those and took back the typing before them, and what
 * the editor then changed behind it could leave it unable to undo at all. So the editor
 * keeps the history: the document as it was before each step, and Undo puts that back.
 *
 * A step is whatever changed between two calls of `step()`, however it was changed: by a
 * key, by a browser command, or by the editor. The editor calls `step()` before each thing it
 * does, and `typing()` before each key's worth of input, which keeps a run of typing as one
 * step. Nothing has to be said after a change: a MutationObserver knows there was one.
 *
 * What is kept is the document's HTML, with each embedded picture kept once, and the
 * selection. Putting a step back replaces only the blocks that differ, so a picture in a
 * part of the document that did not change is not read again.
 */

/** A place in the document: the child to take at each level from the root, and the offset in the node reached. */
interface Point {
	path: number[];
	offset: number;
}

interface Kept {
	/** The document's HTML, pictures as marks (see `pack`). */
	html: string;
	selection: { anchor: Point; focus: Point } | null;
}

export interface HistoryOptions {
	/** How many steps are kept. */
	limit?: number;
	/** Typing after a pause this long, in ms, is a new step. */
	pause?: number;
}

export interface DocumentHistory {
	/** What changed since the last step is a step, from here. Call before changing the document. */
	step(): void;
	/**
	 * A key's worth of input is about to change the document. A run of the same kind ('insert'
	 * or 'delete'), at the caret the last one left, with no pause, is one step; `null` is input
	 * that is a step of its own (a new paragraph, a paste, a cut).
	 */
	typing(kind: 'insert' | 'delete' | null): void;
	/** The input has changed the document. */
	typed(): void;
	/** Put the document back as it was before the last step. `then` runs once it is back, and what it changes is part of what was put back. */
	undo(then?: () => void): boolean;
	redo(then?: () => void): boolean;
	canUndo(): boolean;
	canRedo(): boolean;
	/** A change that is no step of its own: with nothing else changed since the last step, it is part of that one. */
	quietly(change: () => void): void;
	/** Forget every step: the document is another one. */
	reset(): void;
	/** Text is being composed (an input method): it is one run of typing, and nothing is undone until it is done. */
	composing(on: boolean): void;
	destroy(): void;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_PAUSE = 1000;

export function createHistory(root: HTMLElement, options: HistoryOptions = {}): DocumentHistory {
	const limit = options.limit ?? DEFAULT_LIMIT;
	const pause = options.pause ?? DEFAULT_PAUSE;
	const doc = root.ownerDocument;
	const view = doc.defaultView;

	// ── Pictures ──
	// A picture is in the HTML as its bytes, and a report has megabytes of them. Each step
	// would keep them all again: so a picture is kept once, and the HTML of a step has a mark
	// where it goes. (The mark has a part no document has, so that nothing a writer typed is
	// taken for one.)
	const mark = `ink-kept-${Math.random().toString(36).slice(2)}-`;
	const pictures: string[] = [];
	const pictureIds = new Map<string, number>();
	const pack = (html: string): string =>
		html.replace(/(\ssrc=")(data:[^"]{64,})(")/g, (_all, before: string, picture: string, after: string) => {
			let id = pictureIds.get(picture);
			if (id === undefined) {
				id = pictures.length;
				pictures.push(picture);
				pictureIds.set(picture, id);
			}
			return `${before}${mark}${id}${after}`;
		});
	const unpack = (html: string): string =>
		html.replace(new RegExp(`(\\ssrc=")${mark}(\\d+)(")`, 'g'), (all, before: string, id: string, after: string) =>
			pictures[Number(id)] === undefined ? all : `${before}${pictures[Number(id)]}${after}`
		);

	// ── The selection ──
	// A place is said as the HTML will have it when it is read again: text nodes that are side
	// by side are one there, and one with nothing in it is not there at all.
	const isText = (node: Node | null | undefined): node is Text => node?.nodeType === 3;

	/** Where a child is among its parent's children as read again, and for text how far into the run of text it begins. */
	function placeOf(parent: Node, child: Node | null, upTo = parent.childNodes.length): { index: number; shift: number } {
		let index = -1;
		let run = 0;
		let inText = false;
		for (let i = 0; i < parent.childNodes.length; i++) {
			const at = parent.childNodes[i];
			if (child === null && i === upTo) break;
			if (isText(at)) {
				if (at === child || at.length > 0) {
					if (!inText) {
						index++;
						run = 0;
						inText = true;
					}
					if (at === child) return { index, shift: run };
					run += at.length;
				}
			} else {
				inText = false;
				index++;
				if (at === child) return { index, shift: 0 };
			}
		}
		return { index: index + 1, shift: 0 };
	}

	function pointOf(node: Node, offset: number): Point | null {
		const path: number[] = [];
		let at: Node = node;
		// (In an element, the offset counts its children: as they will be read again.)
		let within = isText(node) ? offset : placeOf(node, null, offset).index;
		while (at !== root) {
			const parent: Node | null = at.parentNode;
			if (!parent) return null;
			const { index, shift } = placeOf(parent, at);
			if (at === node) within += shift;
			path.unshift(index);
			at = parent;
		}
		return { path, offset: within };
	}

	/** The child that is the `index`th when read again: for text, the first piece of it. */
	function childAt(parent: Node, index: number): Node | null {
		let at = -1;
		let inText = false;
		for (let i = 0; i < parent.childNodes.length; i++) {
			const child = parent.childNodes[i];
			if (isText(child)) {
				if (child.length === 0 || inText) continue;
				inText = true;
			} else {
				inText = false;
			}
			if (++at === index) return child;
		}
		return null;
	}

	/** The place in the document as it is now: its text may be in pieces, or in one. */
	function nodeAt(point: Point): { node: Node; offset: number } | null {
		let node: Node = root;
		for (const index of point.path) {
			const child = childAt(node, index);
			if (!child) return null;
			node = child;
		}
		if (isText(node)) {
			let text = node;
			let offset = point.offset;
			while (offset > text.length && isText(text.nextSibling)) {
				offset -= text.length;
				text = text.nextSibling;
			}
			return { node: text, offset: Math.min(offset, text.length) };
		}
		const before = childAt(node, point.offset);
		return { node, offset: before ? Array.prototype.indexOf.call(node.childNodes, before) : node.childNodes.length };
	}

	function selectionNow(): Kept['selection'] {
		const sel = view?.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
		if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
		const anchor = pointOf(sel.anchorNode, sel.anchorOffset);
		const focus = pointOf(sel.focusNode, sel.focusOffset);
		return anchor && focus ? { anchor, focus } : null;
	}

	function select(kept: Kept['selection']): void {
		const sel = view?.getSelection();
		if (!sel || !kept) return;
		const anchor = nodeAt(kept.anchor);
		const focus = nodeAt(kept.focus);
		if (!anchor || !focus) return;
		try {
			sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
		} catch {
			// A place that is no longer one: the selection stays where the browser left it.
		}
	}

	// ── What is kept ──
	const take = (): Kept => ({ html: pack(root.innerHTML), selection: selectionNow() });

	/** The documents before each step, oldest first; and those after each step undone. */
	let before: Kept[] = [];
	let after: Kept[] = [];
	/** The document as it was when the last step ended. */
	let base = take();

	// ── Whether anything changed ──
	// (Without a MutationObserver, every step compares the HTML, which says the same.)
	let dirty = false;
	const own = (record: MutationRecord) => !(record.type === 'attributes' && record.target === root);
	const Observer = view?.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
	const observer = Observer
		? new Observer((records) => {
				if (records.some(own)) dirty = true;
			})
		: null;
	observer?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
	function changed(): boolean {
		if (!observer) return true;
		if (observer.takeRecords().some(own)) dirty = true;
		return dirty;
	}
	function settled(): void {
		observer?.takeRecords();
		dirty = false;
	}

	// ── Steps ──
	let run: 'insert' | 'delete' | null = null;
	let caret: { node: Node; offset: number } | null = null;
	let last = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inComposition = false;

	function step(): void {
		clearTimeout(timer);
		run = null;
		caret = null;
		if (!changed()) {
			// Where the next step begins is where its Undo puts the caret back.
			base = { html: base.html, selection: selectionNow() ?? base.selection };
			return;
		}
		settled();
		const now = take();
		if (now.html === base.html) {
			base = now;
			return;
		}
		before.push(base);
		if (before.length > limit) before.shift();
		after = [];
		base = now;
	}

	function caretIsWhereLeft(): boolean {
		const sel = view?.getSelection();
		return !!caret && !!sel && sel.isCollapsed && sel.anchorNode === caret.node && sel.anchorOffset === caret.offset;
	}

	function typing(kind: 'insert' | 'delete' | null): void {
		const now = Date.now();
		// What an input method composes is one run of typing, from its first input to its
		// last: its text is replaced as it is composed, and the caret goes where the method
		// puts it, neither of which ends a step in the middle of a word.
		if (inComposition && run === 'insert') {
			last = now;
			return;
		}
		if (kind === null || kind !== run || now - last > pause || !caretIsWhereLeft()) step();
		run = kind;
		last = now;
	}

	function typed(): void {
		const sel = view?.getSelection();
		caret = sel?.anchorNode ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
		last = Date.now();
		clearTimeout(timer);
		if (run === null) return;
		// A pause ends the step: it is kept while nothing is being typed.
		const end = () => {
			if (inComposition) timer = setTimeout(end, pause);
			else step();
		};
		timer = setTimeout(end, pause);
	}

	// ── Putting a step back ──
	function show(kept: Kept): void {
		const holder = doc.createElement('template');
		holder.innerHTML = unpack(kept.html);
		const wanted = Array.from(holder.content.childNodes);
		const shown = Array.from(root.childNodes);
		let same = 0;
		while (same < wanted.length && same < shown.length && shown[same].isEqualNode(wanted[same])) same++;
		let wantedEnd = wanted.length;
		let shownEnd = shown.length;
		while (wantedEnd > same && shownEnd > same && shown[shownEnd - 1].isEqualNode(wanted[wantedEnd - 1])) {
			wantedEnd--;
			shownEnd--;
		}
		const next = shown[shownEnd] ?? null;
		for (let i = same; i < shownEnd; i++) root.removeChild(shown[i]);
		for (let i = same; i < wantedEnd; i++) root.insertBefore(wanted[i], next);
		select(kept.selection);
	}

	function back(undo: boolean, then?: () => void): boolean {
		// (Not while an input method composes: the document put back would be taken from under
		// the text it holds, which it then writes somewhere that is no longer there.)
		if (inComposition) return false;
		// (What changed since the last step is a step first: and then there is nothing to redo.)
		step();
		const kept = (undo ? before : after).pop();
		if (!kept) return false;
		(undo ? after : before).push(base);
		base = kept;
		show(kept);
		then?.();
		// (What `then` made of it is the document that was put back: a check that took
		// something out of it is no step to undo.)
		if (changed()) base = { html: pack(root.innerHTML), selection: base.selection };
		settled();
		return true;
	}

	return {
		step,
		typing,
		typed,
		undo: (then) => back(true, then),
		redo: (then) => back(false, then),
		canUndo: () => before.length > 0 || changed(),
		canRedo: () => after.length > 0 && !changed(),
		quietly(change) {
			const open = changed();
			change();
			if (open || !changed()) return;
			settled();
			base = { html: pack(root.innerHTML), selection: base.selection };
		},
		reset() {
			clearTimeout(timer);
			settled();
			before = [];
			after = [];
			pictures.length = 0;
			pictureIds.clear();
			run = null;
			caret = null;
			base = take();
		},
		composing(on) {
			inComposition = on;
		},
		destroy() {
			clearTimeout(timer);
			observer?.disconnect();
		}
	};
}
