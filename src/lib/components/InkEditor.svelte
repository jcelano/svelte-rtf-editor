<script lang="ts">
	/**
	 * InkEditor — A reusable Svelte 5 Rich Text Editor component.
	 *
	 * Props:
	 *   content       — Initial HTML content (string). Default: an empty paragraph. It is made
 *                   safe before it is shown (see sanitize.ts): scripts, event handlers and
 *                   the like are taken out.
	 *   placeholder   — Placeholder text shown when editor is empty.
	 *   autosave      — Keep a draft in localStorage and restore it on mount, in place of
 *                   `content`. Default: false. Give each document its own storageKey.
	 *   storageKey    — localStorage key for auto-save. Default: 'ink-editor-content'.
	 *   showToolbar   — Show the formatting toolbar. Default: true.
	 *   stickyToolbar — Keep the toolbar in sight while a long document is scrolled: it
	 *                   stays at the top of the window, or of the scrolling element the
	 *                   editor is in. Default: true. Under a header of your own that stays
	 *                   too, set the CSS variable --ink-toolbar-top to its height.
	 *   showStatusBar — Show the word/char count status bar. Default: true.
	 *   minHeight     — CSS min-height of the editing area. Default: '40vh'.
	 *   readonly      — If true, editor is not editable. Default: false.
 *   ariaLabel     — The name of the editing area for a screen reader. Default: 'Document'.
	 *   maxImageEdge  — Longest edge (px) an inserted image is scaled down to.
	 *                   0 keeps the original dimensions. Default: 1600.
	 *   maxImageDisplayWidth
	 *                 — Width (px) a newly inserted image is displayed at, unless
	 *                   the editor column is narrower. Defaults to 624 — 6.5in of
	 *                   page at 96 dpi — so pictures arrive sized to the page
	 *                   rather than to the browser window. 0 fills the column.
	 *   maxImageBytes — Encoded byte ceiling per inserted image. Pictures over it
	 *                   are re-encoded (and shrunk if needed) until they fit,
	 *                   which is what bounds the RTF payload — it costs two hex
	 *                   characters per byte. 0 disables. Default: 524288 (512 KB,
	 *                   about 1 MB of document per image).
	 *   maxRtfBytes   — The largest RTF file Import reads. Default: 52428800 (50 MB);
	 *                   0 reads any size.
	 *   fontFamily    — Font for the document, both on screen and in the RTF.
	 *                   Given a CSS list ('Segoe UI, Selawik, sans-serif'), the first
	 *                   family is the font, and the rest is what a screen without it
	 *                   shows. Default: DEFAULT_FONT_FAMILY (rtf-writer.ts).
	 *   fontSize      — Body text size in points, both on screen and in the RTF.
	 *                   Headings scale from it. Default: 12.
	 *   fontSizes     — The sizes, in points, the toolbar's size list offers for the
	 *                   selected text. The body size is always among them. An empty
	 *                   list takes the size list off the toolbar.
	 *                   Default: 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36.
	 *   fonts         — The fonts the toolbar's font list offers for the selected text,
	 *                   beside the document's own: names ('Calibri'), or CSS lists whose
	 *                   first family is the name ('Calibri, Carlito, sans-serif'). Text
	 *                   in one of them is written in it to the RTF and read back in it;
	 *                   any other font is taken off HTML as it comes in, set or pasted.
	 *                   Default: none: there is no font list, and no font but the
	 *                   document's is let in.
	 *   keepAttributes — `data-` attributes the application's documents carry, which
	 *                   the editor leaves on their elements: a mark on a paragraph that
	 *                   the application reads back (`data-section="2"`). Every other
	 *                   attribute the editor does not know is taken off HTML as it comes
	 *                   in, set or pasted. Names that do not start with `data-` are not
	 *                   kept. Default: none.
	 *   keepClasses   — Class names of the application's own that stay in an element's
	 *                   class list the same way (`<pre class="summary">`). Every other
	 *                   class is taken off. Default: none.
	 *
	 * Events (callback props):
	 *   onchange      — Fires on content change with
	 *                   { html, text, wordCount, charCount, estimatedRtfBytes }.
	 *   onsave        — Fires on auto-save or Ctrl+S with { html }.
	 *   onimport      — Fires after a successful RTF import with { html }.
	 *
	 * Bindable methods (via bind:this):
	 *   getHTML()      — Returns the current editor HTML string.
	 *   getText()      — Returns plain text content.
	 *   setHTML(html)  — Replaces editor content with the given HTML.
	 *   getMarkdown()  — Returns Markdown conversion of current content.
	 *   getRTF()       — Returns RTF conversion of current content.
	 *   getRtfSize()   — Returns the exact byte size of that RTF.
	 *   clear()        — Clears the editor (no confirm dialog).
	 *   focus()        — Focuses the editor.
	 *   exportFile(format) — Downloads as 'html', 'md', or 'rtf'.
	 *   importRtf()    — Opens the file picker to import an RTF file.
	 *   setFontSize(points) — Sets the size of the selected text, or of what is typed next.
	 *   setFont(name)  — Sets the font of the selected text, or of what is typed next, to
	 *                    one of `fonts`; '' or the document font's name sets it back.
	 *   clearFormatting()   — Takes bold, italic, underline, strike, color, size and font off
	 *                    the selected text. Headings, lists, links, alignment, indents and
	 *                    the application's own marks stay.
	 */

	import { onMount } from 'svelte';
	import Toolbar from './Toolbar.svelte';
	import Modal from './Modal.svelte';
	import ImageOverlay, { type PicturePlace } from './ImageOverlay.svelte';
	import { htmlToMarkdown, downloadFile } from '../utils.js';
	import { keptMarks, pasteHasWords, pasteNotes, pasteWithoutFrames, removeWordHidden, sanitizedNodes, sanitizeTree, type PasteNotes } from '../sanitize.js';
	import { givePastedPictures, pastePictures, type PastePictures } from '../paste-pictures.js';
	import { readRtfFile, DEFAULT_MAX_RTF_BYTES } from '../rtf-parser.js';
	import {
		htmlToRtf,
		estimateRtfBytes,
		isSafeLinkUrl,
		linkTarget,
		cssFontFamily,
		fontChoices,
		fontKey,
		normalizeFontSize,
		DEFAULT_FONT_FAMILY,
		DEFAULT_FONT_SIZE
	} from '../rtf-writer.js';
	import {
		fileToImageSrc,
		urlToImageSrc,
		isSafeImageUrl,
		stripExtension,
		initialDisplayWidth,
		DEFAULT_MAX_IMAGE_EDGE,
		DEFAULT_MAX_IMAGE_BYTES,
		DEFAULT_MAX_IMAGE_DISPLAY_WIDTH
	} from '../images.js';

	interface ChangePayload {
		/**
		 * `html`, `text` and `estimatedRtfBytes` are worked out when the handler reads them, and
		 * once: on a long document each is work, and most handlers read one of them or none.
		 * They are the document as it is when first read, so read them in the handler. A payload
		 * kept and read after a later edit gives the document as it is by then.
		 */
		readonly html: string;
		readonly text: string;
		wordCount: number;
		charCount: number;
		/**
		 * Approximate size of this document as RTF. Pictures dominate it and are
		 * counted exactly; see getRtfSize() for the precise figure.
		 */
		readonly estimatedRtfBytes: number;
	}

	interface Props {
		content?: string;
		placeholder?: string;
		autosave?: boolean;
		storageKey?: string;
		showToolbar?: boolean;
		stickyToolbar?: boolean;
		showStatusBar?: boolean;
		minHeight?: string;
		readonly?: boolean;
		ariaLabel?: string;
		maxImageEdge?: number;
		maxImageBytes?: number;
		maxImageDisplayWidth?: number;
		/** The largest RTF file Import reads (readRtfFile's maxBytes); 0 for no limit. */
		maxRtfBytes?: number;
		fontFamily?: string;
		fontSize?: number;
		fontSizes?: number[];
		/** The fonts offered for text, beside the document's own; none unless given. */
		fonts?: string[];
		/** `data-` attributes of the application's own, kept on HTML that is set or pasted. */
		keepAttributes?: string[];
		/** Class names of the application's own, kept the same way. */
		keepClasses?: string[];
		onchange?: (payload: ChangePayload) => void;
		onsave?: (payload: { html: string }) => void;
		onimport?: (payload: { html: string }) => void;
	}

	/**
	 * An empty document: one paragraph with the line break that gives it height. Without the
	 * break the paragraph has no line to put the caret in, the first words typed land outside it,
	 * and the RTF then carries the empty paragraph as a blank line the screen never showed.
	 */
	const EMPTY_DOCUMENT = '<p><br></p>';

	/** The kinds of block the toolbar's list offers. */
	const BLOCK_CHOICES = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'pre']);

	/** The sizes, in points, the toolbar's size list offers unless `fontSizes` says otherwise. */
	const DEFAULT_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
	const NO_KEPT_ATTRIBUTES: string[] = [];

	// ── Props ──
	let {
		content = EMPTY_DOCUMENT,
		placeholder = 'Start writing something beautiful...',
		autosave = false,
		storageKey = 'ink-editor-content',
		showToolbar = true,
		stickyToolbar = true,
		showStatusBar = true,
		minHeight = '40vh',
		readonly = false,
		ariaLabel = 'Document',
		maxImageEdge = DEFAULT_MAX_IMAGE_EDGE,
		maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
		maxImageDisplayWidth = DEFAULT_MAX_IMAGE_DISPLAY_WIDTH,
		maxRtfBytes = DEFAULT_MAX_RTF_BYTES,
		fontFamily = DEFAULT_FONT_FAMILY,
		fontSize = DEFAULT_FONT_SIZE,
		fontSizes = DEFAULT_FONT_SIZES,
		fonts = NO_KEPT_ATTRIBUTES,
		keepAttributes = NO_KEPT_ATTRIBUTES,
		keepClasses = NO_KEPT_ATTRIBUTES,
		onchange,
		onsave,
		onimport
	}: Props = $props();

	const keptNames = $derived(keptMarks({ keepAttributes, keepClasses, fonts, fontFamily }));

	// The same font and size go to the screen and to the RTF, so the editor
	// shows what the receiving system will show.
	const rtfOptions = $derived({ fontFamily, fontSize, fonts });
	const screenFontFamily = $derived(cssFontFamily(fontFamily));
	/** The name the document font is looked up by, and the fonts offered beside it. */
	const documentFontKey = $derived(fontKey(screenFontFamily));
	const fontList = $derived(fontChoices(fonts).filter((choice) => choice.key !== documentFontKey));
	const screenFontSize = $derived(normalizeFontSize(fontSize));

	// ── Internal state ──
	let editorEl: HTMLDivElement | null = $state(null);
	let contentWrapEl: HTMLDivElement | null = $state(null);
	let wordCount: number = $state(0);
	let charCount: number = $state(0);
	let lastSaved: string = $state('');
	let currentBlock: string = $state('p');
	/** The size of the text at the caret, in points, for the toolbar. */
	let currentFontSize: number | null = $state(null);
	/** The spacing of the paragraph at the caret, as its own style sets it: see spacingOf. */
	let currentSpacing: ParagraphSpacing = $state({ line: null, before: 0, after: 0 });
	/** The font at the selection, by its key: '' for the document font, null where it has more than one. */
	let currentFont: string | null = $state('');

	let formatState = $state({
		bold: false,
		italic: false,
		underline: false,
		strikeThrough: false
	});

	// Modal state
	let linkModalOpen: boolean = $state(false);
	let imageModalOpen: boolean = $state(false);
	let tableModalOpen: boolean = $state(false);
	let tableRows: number | null = $state(3);
	let tableColumns: number | null = $state(3);
	let tableBorders: boolean = $state(true);
	let tableHeader: boolean = $state(false);
	let linkUrl: string = $state('');
	let linkError: string = $state('');
	let linkText: string = $state('');
	let imageUrl: string = $state('');
	let imageAlt: string = $state('');
	let imageCaption: string = $state('');
	let savedSelection: Range | null = $state(null);

	// Image state
	let imageInputEl: HTMLInputElement | null = $state(null);
	let pendingImageFiles: File[] = $state([]);
	let selectedImage: HTMLImageElement | null = $state(null);
	let overlayRef: { reposition: () => void } | null = $state(null);
	let insertingImages: boolean = $state(false);

	// Import state
	let fileInputEl: HTMLInputElement | null = $state(null);
	let importing: boolean = $state(false);
	let importError: string = $state('');

	// ── Public API (exposed via bind:this) ──
	export function getHTML(): string {
		return editorEl?.innerHTML || '';
	}

	export function getText(): string {
		return editorEl?.innerText || '';
	}

	export function setHTML(html: string): void {
		if (editorEl) {
			selectedImage = null;
			documentReplaced();
			const shown = showDocument(html);
			updateCounts();
			if (!shown) {
				// The caller is told, and the editor is empty: see showDocument.
				dropDraft();
				showError(NOT_SHOWN);
				throw new Error(`InkEditor.setHTML: ${NOT_SHOWN.toLowerCase()}`);
			}
			if (autosave) scheduleAutoSave();
		}
	}

	/**
	 * Put HTML from outside in the editor: made safe first, and with a line in every empty
	 * paragraph, so it shows as the blank line the RTF writes for it. The nodes that were checked
	 * are the nodes shown (see sanitizedNodes): the HTML is read once.
	 *
	 * Returns whether the document is shown. If it could not be made safe it is not shown, and
	 * neither is the one before it: the editor is left empty. (A failure here used to go up to
	 * whoever called. Given as `content`, there was then no editor at all; given to setHTML, the
	 * document before stayed on the screen, where it read as the one just asked for: one
	 * patient's report under another's name.)
	 */
	function showDocument(html: string): boolean {
		if (!editorEl) return false;
		// An id the page already uses outside an editor is not the document's to take: see
		// sanitize.ts. (Another editor on the page may hold a document with the same ids.)
		const idTaken = (id: string) => {
			const owner = document.getElementById(id);
			return owner !== null && owner.closest('.ink-content') === null;
		};
		let nodes: Node[] | null = null;
		try {
			nodes = sanitizedNodes(html, document, idTaken, keptNames, partLeftOut);
		} catch {
			// Not shown: see above.
		}
		if (nodes === null) editorEl.innerHTML = EMPTY_DOCUMENT;
		else editorEl.replaceChildren(...nodes);
		for (const p of Array.from(editorEl.querySelectorAll('p'))) {
			if (p.childNodes.length === 0) p.appendChild(document.createElement('br'));
		}
		return nodes !== null;
	}

	/** Said when a document could not be made safe, and so is not shown. */
	const NOT_SHOWN = 'This document could not be shown';

	/**
	 * Said when one element could not be checked and was taken out, with what was in it, while
	 * the rest was. (It went without a word: a part of a report gone, and nobody told.)
	 */
	const PART_LEFT_OUT = 'A part of this could not be checked, so that part was left out';
	const partLeftOut = () => showError(PART_LEFT_OUT);

	// ── What the browser brings in, and puts back ──
	// Markup reaches the document in more ways than setHTML and a paste: it is dragged in, and
	// Undo and Redo put back what the browser remembers of a paste, not what the editor made of
	// it. Redo brings back the frame or the form that was taken out, as an element the editor has
	// not seen. It also writes the style it first gave an element back on that element, which
	// the editor has seen and made safe: "position: fixed" was on it again, over the page. So
	// there is no element that, checked once, need not be looked at again: after Undo or Redo
	// the whole document is checked, as it is when it is first shown.

	/**
	 * Make safe the elements `only` accepts. If that cannot be done at all, they are taken out:
	 * what could not be checked does not stay. Returns whether it could be done.
	 */
	function makeSafe(only: (el: Element) => boolean): boolean {
		if (!editorEl) return true;
		try {
			sanitizeTree(editorEl, only, undefined, keptNames, wordsLeftFor, partLeftOut);
			return true;
		} catch {
			for (const el of Array.from(editorEl.querySelectorAll('*'))) {
				if (el.isConnected && only(el)) el.remove();
			}
			return false;
		}
	}

	/**
	 * Make the whole document safe again: after Undo or Redo, and after a paste or a drop the
	 * editor was not told of. What a paste was tidied of, Redo also puts back, and it is taken
	 * off again. A document that cannot be checked is not shown, as in showDocument, and the
	 * draft is left as it was last kept: that one was checked, and it is the writer's work.
	 * Returns whether the document is shown.
	 */
	function checkDocument(): boolean {
		if (!editorEl) return true;
		try {
			sanitizeTree(editorEl, undefined, undefined, keptNames, wordsLeftFor, partLeftOut);
		} catch {
			editorEl.innerHTML = EMPTY_DOCUMENT;
			documentReplaced();
			clearTimeout(saveTimer);
			showError(NOT_SHOWN);
			return false;
		}
		// (Only where the style is not the one it was left with: each of these is measured.)
		tidySpacing(
			(el) => broughtIn.has(el) && broughtIn.get(el)!.style !== el.getAttribute('style'),
			(el) => broughtIn.get(el)?.own ?? false
		);
		return true;
	}

	/**
	 * The words left in the document where an element was taken out of it: a button's, a text
	 * box's. The browser's history knows nothing of them. Undo takes the paste out and leaves
	 * them, and Redo puts the button back beside them, to be taken out again: its words were
	 * then in the document twice, and three times after the next Redo. So where an element comes
	 * back whose words are still there as they were left, those go, and the ones just left in
	 * its place stay.
	 *
	 * (The elements are held here, not looked up in a WeakMap. An element that is out of the
	 * document, with nothing but the browser's history holding it, is given a new object by
	 * WebKit when it comes back: a WeakMap had forgotten it, and Safari had the words twice.
	 * The history holds the elements as long anyway; these go when the document is replaced.)
	 */
	const wordsLeft = new Map<Element, { node: Text; text: string }>();

	function wordsLeftFor(el: Element, node: Text): void {
		const earlier = wordsLeft.get(el);
		// (Words that have been typed in since are the writer's own, and stay.)
		if (earlier && earlier.node !== node && earlier.node.isConnected && earlier.node.data === earlier.text) earlier.node.remove();
		wordsLeft.set(el, { node, text: node.data });
		leftNow?.push(el);
	}

	/**
	 * Each paste or drop that left such words, with the elements it brought that stayed. Undo of
	 * the paste takes those elements out and knows nothing of the words: they stayed in the
	 * report, words of a paste the writer had taken back. So where an Undo has just taken out
	 * every element a paste brought, the words it left go too, if they are still as they were
	 * left. (A paste that brought words and no element that stayed has nothing to be known by,
	 * and its words do stay.)
	 */
	const pastesWithWords: { stayed: Element[]; left: Element[]; there: boolean }[] = [];
	/** The elements the paste being made safe has left words for. */
	let leftNow: Element[] | null = null;

	function followPastes(undone: boolean): void {
		for (const paste of pastesWithWords) {
			const there = paste.stayed.some((el) => el.isConnected);
			if (undone && paste.there && !there) {
				for (const el of paste.left) {
					const words = wordsLeft.get(el);
					if (words?.node.isConnected && words.node.data === words.text) words.node.remove();
				}
			}
			paste.there = there;
		}
	}

	/**
	 * Each paste Word's hidden text was taken out of, with the elements that were left empty
	 * and went with it. Redo puts the paste back much as the browser first made it: some of the
	 * hidden words shown again, and those elements empty. Where the text there is once more that
	 * paste, the words are taken out again (see removeWordHidden), and the elements with them.
	 */
	const hiddenTaken: { notes: PasteNotes; from: number; came: Set<Element>; emptied: Element[] }[] = [];

	function hideAgain(): void {
		for (const paste of hiddenTaken) {
			takeHidden(paste.from, null, paste.notes, (el) => paste.came.has(el));
			const sel = window.getSelection();
			for (const el of paste.emptied) {
				if (!el.isConnected || el.childNodes.length > 0) continue;
				// (Not the one the caret is in: see takeHidden.)
				if (sel?.anchorNode && el.contains(sel.anchorNode)) el.appendChild(document.createElement('br'));
				else el.remove();
			}
		}
	}

	/** Said when what came in could not be made safe, and so was taken out again. */
	const LEFT_OUT = 'What was put in could not be checked, so it was left out';

	export function getMarkdown(): string {
		if (!editorEl) return '';
		return htmlToMarkdown(editorEl);
	}

	export function getRTF(): string {
		if (!editorEl) return '';
		return htmlToRtf(editorEl, rtfOptions);
	}

	/**
	 * Exact size of the RTF this document produces, in bytes. The output is
	 * ASCII, so this is also its character count — the figure a transport with a
	 * field-length limit cares about. Does the full conversion, including
	 * hex-encoding every picture, so call it when a number is needed rather than
	 * on every keystroke; the onchange payload carries an estimate for that.
	 */
	export function getRtfSize(): number {
		if (!editorEl) return 0;
		return htmlToRtf(editorEl, rtfOptions).length;
	}

	export function clear(): void {
		if (editorEl) {
			selectedImage = null;
			documentReplaced();
			editorEl.innerHTML = EMPTY_DOCUMENT;
			dropDraft();
			updateCounts();
			fireChange();
		}
	}

	export function focus(): void {
		editorEl?.focus();
	}

	export function exportFile(format = 'html'): void {
		if (!editorEl) return;
		switch (format) {
			case 'html': {
				const html = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>Document</title></head>\n<body>\n${editorEl.innerHTML}\n</body>\n</html>`;
				downloadFile('document.html', html, 'text/html');
				break;
			}
			case 'md':
			case 'markdown': {
				const md = htmlToMarkdown(editorEl);
				downloadFile('document.md', md, 'text/markdown');
				break;
			}
			case 'rtf': {
				const rtf = htmlToRtf(editorEl, rtfOptions);
				downloadFile('document.rtf', rtf, 'application/rtf');
				break;
			}
		}
	}

	export function importRtf(): void {
		fileInputEl?.click();
	}

	/**
	 * The whole document is about to be replaced (setHTML, clear, an RTF import): nothing that
	 * points into the old one may act on the new one. Indent steps no longer undo, the Copy format
	 * brush is put down, and a paste that inserted nothing is forgotten.
	 */
	function documentReplaced(): void {
		indentUndo = [];
		pastedOver = null;
		pastedLoss = null;
		pastedPictures = null;
		commentsBefore = null;
		// (A selection kept from the document before points at nothing in the new one.)
		savedSelection = null;
		dialogSelection = null;
		wordsLeft.clear();
		broughtIn.clear();
		pastesWithWords.length = 0;
		hiddenTaken.length = 0;
		clearUndo = clearRedo = clearPast = null;
		stopCopyFormat();
	}

	// The frame around the paragraph copied from follows it when the text reflows: typing is caught
	// by the input handler, and a picture finishing loading or the editor changing width by this.
	$effect(() => {
		if (copyFormat !== 'apply' || !editorEl || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => placeCopySourceBox());
		observer.observe(editorEl);
		return () => observer.disconnect();
	});

	// A read-only editor has no toolbar to put the brush down with.
	$effect(() => {
		if (readonly) stopCopyFormat();
	});

	// ── Selection helpers ──
	/** Whether what is selected now, or the caret, is in the document. */
	function selectionInEditor(): boolean {
		const sel = window.getSelection();
		return !!editorEl && !!sel && sel.rangeCount > 0 && editorEl.contains(sel.anchorNode) && editorEl.contains(sel.focusNode);
	}

	/**
	 * Keep the selection, to put back when a dialog closes. Only one in the document is kept:
	 * with something on the page around the editor selected, the one kept is still the last one
	 * that was in the document. (That one was kept in its place, and could not be put back: the
	 * link made from the toolbar then went to the top of the document, as its own address.)
	 */
	function saveSelection(): void {
		if (!selectionInEditor()) return;
		savedSelection = window.getSelection()!.getRangeAt(0).cloneRange();
	}

	/**
	 * Put the selection back in the document, where it has left it: a dialog or a list of the
	 * toolbar took the keyboard. Where the selection is in the document, that is the one to act
	 * on, and it is left alone. (The kept one was put back every time, and it was kept only when a
	 * dialog opened or a picture went in: after one link, Bold and every other button changed
	 * the words of that link, whatever was selected by then.)
	 */
	function restoreSelection(): void {
		if (selectionInEditor()) return;
		select(savedSelection);
	}

	/** Select a range kept earlier, if it is still in the document. Returns whether it was. */
	function select(kept: Range | null): boolean {
		if (!kept || !editorEl?.contains(kept.startContainer) || !editorEl.contains(kept.endContainer)) return false;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(kept);
		return true;
	}

	/**
	 * The selection a dialog was opened on, kept apart from the one that follows the document's.
	 * (That one moves when the dialog closes: the browser gives the document the keyboard back
	 * with a caret of its own at the top, and a picture that was still being read went in there,
	 * not where the writer had been.)
	 */
	let dialogSelection: Range | null = null;

	function keepForDialog(): void {
		saveSelection();
		dialogSelection = savedSelection?.cloneRange() ?? null;
	}

	/** Put back the selection a dialog was opened on, or failing that the last one in the document. */
	function restoreFor(dialog: Range | null): void {
		if (!select(dialog)) restoreSelection();
	}

	/**
	 * Keep the selection whenever it changes in the document, so the one put back is the last one
	 * there. (Kept in the one Range, moved along: a new Range for every key pressed would be a
	 * thousand of them for the browser to keep up to date with the text.)
	 */
	function trackSelection(): void {
		if (!selectionInEditor()) return;
		const range = window.getSelection()!.getRangeAt(0);
		if (!savedSelection) {
			savedSelection = range.cloneRange();
			return;
		}
		savedSelection.setStart(range.startContainer, range.startOffset);
		savedSelection.setEnd(range.endContainer, range.endOffset);
	}

	// ── Font size ──
	// The size of the selected text, or of what is typed next, is set with the browser's own
	// command: it wraps exactly the selection, takes a size already there out of it, and its
	// steps can be undone with everything else. But it knows only seven sizes and writes them as
	// <font size="1"> to <font size="7">. So it is asked for size 7, which nothing else in the
	// editor makes, and each element it marked that way is then given the size meant, in points
	// (<font style="font-size:14pt">), which is what the RTF writer reads. Only attributes are
	// changed, never the elements, so the browser's undo still finds what it made.
	//
	// Undo puts back what the browser itself recorded, which is right: the element goes, or gets
	// back the size it had. Redo is not: the browser does its own step again, the mark for size 7
	// and nothing after it, and the text came back at 36 pt. So each change of size is remembered
	// here with the size every element was given, and after a redo the elements that are marked
	// again are given theirs again.
	//
	// And undo is only right where the browser recorded something to put back. It records the
	// size it takes off an element, not the one given here afterwards. So a <font> element is
	// never left without a size of its own: where the text is to have the size of the text around
	// it, the size stated is 1em, which is that size. The writer reads 1em as no size.
	const SIZE_MARK = '7';
	/** The size that is the size of the text around: what "no size of its own" is written as. */
	const SIZE_AROUND = '1em';
	/** One change of size: the elements it sized, each with the font-size it was given. */
	type SizeStep = Map<HTMLElement, string>;
	/** The changes of size made, in order; those from `sizeStepsApplied` on were undone and can be redone. */
	let sizeSteps: SizeStep[] = [];
	let sizeStepsApplied = 0;
	/** Every element this editor has given a size: a mark on one of these is the browser redoing a step. */
	const sizedHere = new WeakSet<Element>();
	/** The size chosen and not yet given to an element: a caret has no text to carry it until something is typed. */
	let pendingSize: number | null = null;
	/** Elements that were marked size 7 before the command (pasted that way): not ours to change. */
	let markedBefore = new Set<Element>();

	/** The size of an element's text as the screen shows it, in points to the half-point; null if unknown. */
	function shownSize(el: Element): number | null {
		const px = parseFloat(getComputedStyle(el).fontSize);
		return Number.isFinite(px) && px > 0 ? Math.round(px * 0.75 * 2) / 2 : null;
	}

	/** Take the mark off an element and state the size it is to have. */
	function sizeElement(font: HTMLElement, fontSize: string): void {
		font.removeAttribute('size');
		font.style.fontSize = fontSize;
	}

	const markedElements = (): HTMLElement[] =>
		editorEl ? Array.from(editorEl.querySelectorAll<HTMLElement>(`font[size="${SIZE_MARK}"]`)) : [];

	/** Give the elements the command marked the size that was chosen, and remember the step. */
	function applyPendingSize(): void {
		if (!editorEl || pendingSize === null) return;
		const step: SizeStep = new Map();
		for (const font of markedElements()) {
			if (markedBefore.has(font)) continue;
			sizeElement(font, SIZE_AROUND);
			// Where the text around it has that size already (body text set back to the body
			// size, a heading to the heading's), it stays at the size around it: the text then
			// follows the document's size, as text that was never sized does.
			if (shownSize(font) !== pendingSize) sizeElement(font, `${pendingSize}pt`);
			step.set(font, font.style.fontSize);
			sizedHere.add(font);
		}
		if (step.size === 0) return;
		// A new change: what was undone before it can no longer be redone.
		sizeSteps = [...sizeSteps.slice(0, sizeStepsApplied), step];
		sizeStepsApplied = sizeSteps.length;
	}

	/** Whether a change of size is in the document as it was made: every element there, with its size. */
	function stepStands(step: SizeStep | undefined): boolean {
		if (!step) return false;
		for (const [font, fontSize] of step) {
			if (!font.isConnected || font.getAttribute('size') === SIZE_MARK || font.style.fontSize !== fontSize) return false;
		}
		return true;
	}

	/** After an undo or a redo: follow which changes of size are in the document, and finish a redone one. */
	function afterHistory(): void {
		const next = sizeSteps[sizeStepsApplied];
		const marked = markedElements().filter((font) => sizedHere.has(font));
		if (marked.length > 0) {
			// The browser redid its part of a change of size. (A mark with no step to go with it
			// should not happen; it is then taken off, and the text has the size around it,
			// which is better than 36 pt.)
			for (const font of marked) sizeElement(font, next?.get(font) ?? SIZE_AROUND);
			if (next) sizeStepsApplied++;
		} else if (stepStands(next)) {
			// Redone, and nothing was marked: the step only made elements, which came back as they were.
			sizeStepsApplied++;
		} else if (sizeStepsApplied > 0 && !stepStands(sizeSteps[sizeStepsApplied - 1])) {
			sizeStepsApplied--;
		}
	}

	/** Whether all the text selected has this size already. */
	function selectionHasSize(points: number): boolean {
		const selection = window.getSelection();
		if (!editorEl || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
		const range = selection.getRangeAt(0);
		const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
		let texts = 0;
		for (let node = walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode(); node; node = walker.nextNode()) {
			if (!range.intersectsNode(node) || !(node.textContent || '').trim() || !node.parentElement) continue;
			if (shownSize(node.parentElement) !== points) return false;
			texts++;
		}
		return texts > 0;
	}

	/**
	 * Set the size, in points, of the selected text; with nothing selected, of what is typed next.
	 * Also what the toolbar's size list calls.
	 */
	export function setFontSize(points: number): void {
		if (readonly || !editorEl) return;
		if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) return;
		restoreSelection();
		editorEl.focus();
		// The document changes outside an input event: earlier indent steps no longer undo.
		indentUndo = [];
		const size = normalizeFontSize(points);
		// Nothing to change: no step is made that would undo to the same thing.
		if (selectionHasSize(size)) {
			updateToolbarState();
			return;
		}
		markedBefore = new Set(markedElements());
		// The command may use a <font> element that is there already (one pasted with a color),
		// and undo then puts back only a size the command itself took off it: see SIZE_AROUND.
		for (const font of Array.from(editorEl.querySelectorAll<HTMLElement>('font'))) {
			if (!font.style.fontSize && !markedBefore.has(font)) font.style.fontSize = SIZE_AROUND;
		}
		pendingSize = size;
		document.execCommand('fontSize', false, SIZE_MARK);
		applyPendingSize();
		// With text selected the size is on it now. At a caret it waits for the typing.
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed) pendingSize = null;
		updateToolbarState();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/** The size of the text at the selection, for the toolbar: null where the text selected is in more than one. */
	function sizeAtSelection(): number | null {
		if (pendingSize !== null) return pendingSize;
		const selection = window.getSelection();
		if (!editorEl || !selection || selection.rangeCount === 0) return null;
		const range = selection.getRangeAt(0);
		if (!editorEl.contains(range.startContainer)) return null;
		const holder = (node: Node, offset: number, atEnd: boolean): Element | null => {
			if (node.nodeType === Node.ELEMENT_NODE) {
				const child = node.childNodes[atEnd ? offset - 1 : offset];
				return child?.nodeType === Node.ELEMENT_NODE ? (child as Element) : (node as Element);
			}
			return node.parentElement;
		};
		const start = holder(range.startContainer, range.startOffset, false);
		const first = start ? shownSize(start) : null;
		if (range.collapsed) return first;
		const end = holder(range.endContainer, range.endOffset, true);
		if (!end || shownSize(end) !== first) return null;
		// The same at both ends, and another in between: the list shows none, as for two.
		return throughout(range, (el) => shownSize(el) ?? 0) === null ? null : first;
	}

	// ── Font ──
	// The browser's own command does all of it: it writes <font face="…"> around the selected
	// text, cuts a font that is there already in two rather than putting one inside another,
	// and keeps the font for what is typed next at a caret. So a change of font is undone and
	// redone with everything else. Which fonts there may be is the application's to say
	// (`fonts`): the sanitizer takes any other off what comes in.

	/** The font chosen at a caret and not yet typed in: the document has no element to show it by. */
	let pendingFont: string | null = null;

	/**
	 * Set the font of the selected text; with nothing selected, of what is typed next. The name
	 * is one of `fonts`; '' or the document font's own name sets the text back to the document
	 * font. A font that is not offered is not set. Also what the toolbar's font list calls.
	 */
	export function setFont(name: string | null): void {
		if (readonly || !editorEl) return;
		const key = fontKey(name);
		const choice = fontList.find((font) => font.key === key);
		if (key !== '' && key !== documentFontKey && !choice) return;
		restoreSelection();
		editorEl.focus();
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || !selectionInEditor()) return;
		const wanted = choice?.key ?? '';
		// Nothing to change: no step is made that would undo to the same thing.
		if (fontAtSelection() === wanted) {
			updateToolbarState();
			return;
		}
		// (Given the document font as the screen has it, Chromium and Safari take the font off
		// the text; Firefox writes it, which the writer and the font list read as no font.)
		document.execCommand('fontName', false, choice ? choice.css : screenFontFamily);
		// With text selected the font is on it now. At a caret it waits for the typing.
		pendingFont = selection.isCollapsed ? wanted : null;
		updateToolbarState();
	}

	/** The font an element's text is in, by its key: '' for the document font, or a font that is not offered. */
	function fontOfElement(el: Element | null): string {
		for (let at = el; at && at !== editorEl; at = at.parentElement) {
			const key = fontKey((at as HTMLElement).style?.fontFamily || (at.tagName === 'FONT' ? at.getAttribute('face') : ''));
			if (key) return fontList.some((font) => font.key === key) ? key : '';
		}
		return '';
	}

	/** The font of the text at the selection, for the toolbar: null where the text selected is in more than one. */
	function fontAtSelection(): string | null {
		if (pendingFont !== null) return pendingFont;
		const selection = window.getSelection();
		if (!editorEl || !selection || selection.rangeCount === 0) return '';
		const range = selection.getRangeAt(0);
		if (!editorEl.contains(range.startContainer)) return '';
		if (range.collapsed) {
			const at = range.startContainer;
			return fontOfElement(at.nodeType === Node.ELEMENT_NODE ? (at as Element) : at.parentElement);
		}
		const font = throughout(range, fontOfElement);
		return font === undefined ? '' : font;
	}

	/** Lists, tables and the document itself: white space between their parts is not text one sees. */
	const HOLDS_BLOCKS = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);

	/**
	 * What all the text selected has in common, as `of` reads it from the element a text is in:
	 * its font, its size. null where two texts differ, so that the toolbar's list shows none
	 * rather than the one the selection happens to start in. undefined where no text is selected.
	 *
	 * From the first text selected to the last: a selection often starts at the end of the text
	 * before it (Safari leaves it there after the command), which is in another font.
	 */
	function throughout<T>(range: Range, of: (el: Element) => T): T | null | undefined {
		const first = textAtEdge(range, false);
		const last = textAtEdge(range, true);
		if (!editorEl || !first || !last) return undefined;
		if (first !== last && !(first.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING)) return undefined;
		const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
		walker.currentNode = first;
		let seen: Element | null = null;
		let value: T | undefined;
		for (let text: Text | null = first; text; text = walker.nextNode() as Text | null) {
			const parent = text.parentElement;
			const unseen = (parent === editorEl || HOLDS_BLOCKS.has(parent?.tagName ?? '')) && text.data.trim() === '';
			if (parent && parent !== seen && text.data !== '' && !unseen) {
				const here = of(parent);
				if (seen && here !== value) return null;
				value = here;
				seen = parent;
			}
			if (text === last) break;
		}
		return value;
	}

	/** The first text a range has a character of, or the last. */
	function textAtEdge(range: Range, last: boolean): Text | null {
		if (!editorEl) return null;
		const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
		const node = last ? range.endContainer : range.startContainer;
		const offset = last ? range.endOffset : range.startOffset;
		const step = () => (last ? walker.previousNode() : walker.nextNode()) as Text | null;
		let text: Text | null;
		if (node.nodeType === Node.TEXT_NODE) {
			walker.currentNode = node;
			const inside = last ? offset > 0 : offset < (node as Text).data.length;
			text = inside ? (node as Text) : step();
		} else {
			// From the point between two children: into the child on the range's side of it, or
			// on from the element where it has none there.
			const child = node.childNodes[last ? offset - 1 : offset];
			if (child) {
				let edge: Node = child;
				if (last) while (edge.lastChild) edge = edge.lastChild;
				walker.currentNode = edge;
				text = edge.nodeType === Node.TEXT_NODE ? (edge as Text) : step();
			} else {
				let edge: Node = node;
				if (!last) while (edge.lastChild) edge = edge.lastChild;
				walker.currentNode = edge;
				text = step();
			}
		}
		while (text && text.data === '') text = step();
		return text && range.intersectsNode(text) ? text : null;
	}

	/** The sizes the list offers: those asked for, and always the body size. */
	const sizeChoices = $derived.by(() => {
		const sizes = fontSizes.map((size) => normalizeFontSize(size));
		if (sizes.length === 0) return sizes;
		return Array.from(new Set([...sizes, screenFontSize])).sort((a, b) => a - b);
	});

	// ── Exec command ──
	function exec(cmd: string, value: string | null = null): void {
		if (cmd === 'removeFormat') {
			clearFormatting();
			return;
		}
		restoreSelection();
		editorEl?.focus();
		// Color commands require an actual text selection — a collapsed cursor
		// would silently apply the color to nothing (or to subsequently typed
		// text), which causes accidental color spans to appear in the RTF output.
		if (cmd === 'foreColor' || cmd === 'hiliteColor') {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) return;
		}
		if (isIndentCommand(cmd)) {
			indentBlocks(cmd);
			return;
		}
		if (cmd === 'hangAtCaret') {
			hangAtCaret();
			return;
		}
		if (cmd === 'lineSpacing' || cmd === 'spaceBefore' || cmd === 'spaceAfter') {
			const n = value === null || value === '' ? null : Number(value);
			if (n !== null && !Number.isFinite(n)) return;
			if (cmd === 'lineSpacing') applySpacing({ line: n });
			else applySpacing(cmd === 'spaceBefore' ? { before: n } : { after: n });
			return;
		}
		if (cmd === 'undo' && (undoIndent() || undoClear())) return;
		if (cmd === 'redo' && redoClear()) return;
		document.execCommand(cmd, false, value ?? undefined);
		if (cmd === 'undo' || cmd === 'redo') afterHistory();
		updateToolbarState();
	}

	// ── Clear formatting ──
	// The browser's own command does this, and each browser does it differently. Chromium and
	// Safari take a paragraph's alignment and first-line indent with its color; Firefox leaves
	// the color on the paragraph, and takes out the element an application's mark is on; Safari
	// leaves a size where it is. So the command is used for what only it can do, which is to
	// take the <b>, <i> and <font> elements out with an entry in the browser's own history
	// (taken out by the editor instead, the next Undo in Safari empties the document). What is
	// written on the elements is the editor's to change: before the command, the looks of the
	// text are taken off every element whose text is all selected, and after it, whatever the
	// command took off that is not a look of the text is written back.

	/** What is written on an element for the looks of its text. */
	const CHARACTER_STYLES = [
		'color', 'background', 'background-color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style',
		'font-variant', 'font-stretch', 'text-decoration', 'text-decoration-line', 'text-decoration-color',
		'text-decoration-style', 'text-decoration-thickness', 'letter-spacing', 'text-transform', 'text-shadow',
		'vertical-align', '-webkit-text-stroke-width', '-webkit-text-fill-color'
	];
	const isLook = (prop: string) =>
		CHARACTER_STYLES.includes(prop) || /^(font|text-decoration|background|-webkit-text)-/.test(prop);
	/** In a table these are the table's design, not the looks of its text. */
	const TABLE_PARTS = 'table, thead, tbody, tfoot, tr, td, th, col, colgroup';
	const TABLE_DESIGN = new Set(['background', 'background-color', 'vertical-align']);
	/** The attributes that carry looks: `style`, and on a <font> its own. */
	const LOOKS = ['style', 'color', 'size', 'face'] as const;
	type Looks = Record<(typeof LOOKS)[number], string | null>;

	/** One Clear formatting: what was written on each element before and after, to put back. */
	interface ClearStep {
		before: Map<Element, Looks>;
		after: Map<Element, Looks>;
		/** The browser's command changed something, and has an entry in its history. */
		native: boolean;
		/** The document as the editor handed it to the command: where the browser's Undo of the command leads back to. */
		pre: string;
		/** The document as the step left it. */
		cleared: string;
		/** The document as it is now, the step done or undone: it is undone, or redone, only from there. */
		html: string;
	}
	let clearUndo: ClearStep | null = null;
	let clearRedo: ClearStep | null = null;
	/** The last one made, also after more was typed: the browser's Undo may yet lead back to it. */
	let clearPast: ClearStep | null = null;
	/** The input events of the editor's own commands, while it clears: what they leave is not yet the document. */
	let clearing = false;

	/**
	 * After the browser's own Undo. A Clear formatting is the editor's to undo only while nothing
	 * else has been done. After that the browser undoes its command with everything else, and
	 * knows nothing of what the editor took off the elements: bold was back, and the color was
	 * not. Where its Undo has led back to the document as the command was given it, the rest is
	 * put back here. A step the command left nothing of (a paragraph's color and no more) has no
	 * such place to be led back to: it is the editor's to undo again once the document is as
	 * that step left it, which is when what was typed after it has been undone.
	 */
	function afterUndoOfClear(): void {
		const step = clearPast;
		if (!step || !editorEl || clearing) return;
		const now = editorEl.innerHTML;
		if (step.native && step.pre !== step.cleared) {
			if (now !== step.pre) return;
			writeLooks(step.before);
			clearUndo = null;
			clearRedo = { ...step, html: editorEl.innerHTML };
		} else if (now === step.cleared) {
			clearUndo = { ...step, html: now };
		}
	}

	const looksOf = (el: Element): Looks => ({
		style: el.getAttribute('style'),
		color: el.getAttribute('color'),
		size: el.getAttribute('size'),
		face: el.getAttribute('face')
	});

	function writeLooks(looks: Map<Element, Looks>): void {
		for (const [el, wanted] of looks) {
			if (!el.isConnected) continue;
			for (const name of LOOKS) {
				if (el.getAttribute(name) === wanted[name]) continue;
				if (wanted[name] === null) el.removeAttribute(name);
				else el.setAttribute(name, wanted[name]);
			}
		}
	}

	/** Whether all the text of an element is selected. (One with no text is, if it is in the selection.) */
	function allSelected(range: Range, el: Element): boolean {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
			if (text.data === '') continue;
			if (range.comparePoint(text, 0) !== 0 || range.comparePoint(text, text.data.length) !== 0) return false;
		}
		return true;
	}

	/**
	 * A <span> that is there for the looks of its text and nothing else. The command takes such
	 * a one out whole, in every browser, and its Undo puts it back as it was: it is left to it.
	 */
	function onlyLooks(el: HTMLElement): boolean {
		return el.tagName === 'SPAN' && el.attributes.length === 1 && el.style.length > 0 && Array.from(el.style).every(isLook);
	}

	/** An element that says something of its text other than how it looks: a mark of the application's, a tab. */
	function isMark(el: HTMLElement): boolean {
		return (
			Array.from(el.attributes).some((attr) => !(LOOKS as readonly string[]).includes(attr.name)) ||
			Array.from(el.style).some((prop) => !isLook(prop))
		);
	}

	/** Take the looks of its text off one element: the element stays, and so does its layout. */
	function plain(el: HTMLElement): void {
		const tablePart = el.matches(TABLE_PARTS);
		for (const prop of [...CHARACTER_STYLES, ...Array.from(el.style).filter(isLook)]) {
			if (tablePart && TABLE_DESIGN.has(prop)) continue;
			el.style.removeProperty(prop);
		}
		if (!el.getAttribute('style')) el.removeAttribute('style');
		if (el.tagName === 'FONT') for (const name of ['color', 'size', 'face']) el.removeAttribute(name);
	}

	/**
	 * Take the formatting off the selected text: bold, italic, underline, strike, color, size and
	 * font, wherever it is written. What the text is stays: a heading is still a heading, a list
	 * a list, a link a link, and a paragraph keeps its alignment and its indents. So do the
	 * marks the application named (keepAttributes, keepClasses). Undo puts it back.
	 */
	export function clearFormatting(): void {
		if (readonly || !editorEl) return;
		restoreSelection();
		editorEl.focus();
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !selectionInEditor()) return;
		if (sel.isCollapsed) {
			// At a caret there is nothing to clear but what was chosen for the words typed next.
			pendingSize = null;
			pendingFont = null;
			document.execCommand('removeFormat');
			updateToolbarState();
			return;
		}
		// The document changes outside an input event: earlier indent steps no longer undo.
		indentUndo = [];
		const range = sel.getRangeAt(0);
		const touched = Array.from(editorEl.querySelectorAll<HTMLElement>('*')).filter((el) => range.intersectsNode(el));
		const before = new Map(touched.map((el) => [el, looksOf(el)]));
		const whole = touched.filter((el) => allSelected(range, el));
		for (const el of whole) if (!onlyLooks(el)) plain(el);
		const wanted = new Map(touched.map((el) => [el, el.getAttribute('style')]));
		const html = editorEl.innerHTML;
		// An element that says something of its text other than how it looks is not there for the
		// command to take out: it is the application's mark, or the space a tab takes. Safari
		// takes out a <span> that has nothing but a style, and Firefox every <span> there is; and
		// where only some words of a mark are selected, Firefox cuts the mark in two around them.
		// So each such element is marked for the command as one to keep, which is enough for
		// Safari; and where one is taken out or cut all the same, the command is taken back and
		// done again with those elements closed to it. (What is bold inside one of them then
		// stays bold.)
		const marks = new Map(touched.filter(isMark).map((el) => [el, el.textContent]));
		const kept = Array.from(marks.keys());
		const selected = range.cloneRange();
		clearing = true;
		try {
			let closed = spansAreTakenOut ? kept.filter((el) => el.tagName === 'SPAN') : [];
			removeFormat(selected, kept, closed);
			const lost = kept.filter((el) => !el.isConnected || el.textContent !== marks.get(el));
			if (lost.length > 0) {
				document.execCommand('undo');
				if (lost.some((el) => el.tagName === 'SPAN')) spansAreTakenOut = true;
				closed = Array.from(new Set([...closed, ...lost])).filter((el) => el.isConnected);
				removeFormat(selected, kept.filter((el) => el.isConnected), closed);
			}
		} finally {
			clearing = false;
		}
		const native = editorEl.innerHTML !== html;
		// What the command took off that is not a look of the text goes back on.
		const probe = document.createElement('span');
		for (const el of touched) {
			if (!el.isConnected) continue;
			probe.setAttribute('style', wanted.get(el) ?? '');
			for (const prop of Array.from(probe.style)) {
				if (isLook(prop) && !(el.matches(TABLE_PARTS) && TABLE_DESIGN.has(prop))) continue;
				const value = probe.style.getPropertyValue(prop);
				if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value, probe.style.getPropertyPriority(prop));
			}
			if (!el.getAttribute('style')) el.removeAttribute('style');
		}
		// (And a <span> left to the command that it did not take out after all.)
		for (const el of whole) if (el.isConnected) plain(el);
		const after = new Map(touched.map((el) => [el, looksOf(el)]));
		const changed = native || touched.some((el) => LOOKS.some((name) => before.get(el)![name] !== after.get(el)![name]));
		const cleared = editorEl.innerHTML;
		clearUndo = clearPast = changed ? { before, after, native, pre: html, cleared, html: cleared } : null;
		clearRedo = null;
		updateToolbarState();
		if (!changed) return;
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/** Whether this browser's command has been seen to take out a <span> that was to stay. */
	let spansAreTakenOut = false;
	/** Written on an element while the command runs, so that it is not one with only a style. */
	const KEEP_MARK = 'data-ink-keep';

	/**
	 * The browser's command on what was selected, with the elements in `kept` marked to stay and
	 * those in `closed` out of its reach. Where the selection begins or ends inside a closed
	 * element, the command would do nothing at all: it is given the part outside it.
	 */
	function removeFormat(selected: Range, kept: HTMLElement[], closed: HTMLElement[]): void {
		const selection = window.getSelection();
		if (!selection) return;
		if (closed.length > 0 && selected.startContainer.isConnected && selected.endContainer.isConnected) {
			const outside = selected.cloneRange();
			for (const el of closed) {
				if (el.contains(outside.startContainer)) outside.setStartAfter(el);
				if (el.contains(outside.endContainer)) outside.setEndBefore(el);
			}
			if (outside.collapsed) return;
			selection.removeAllRanges();
			selection.addRange(outside);
		}
		const was = closed.map((el) => el.getAttribute('contenteditable'));
		for (const el of kept) el.setAttribute(KEEP_MARK, '');
		for (const el of closed) el.setAttribute('contenteditable', 'false');
		document.execCommand('removeFormat');
		// (Also off the copy the command makes of an element it cuts in two.)
		for (const el of [...kept, ...Array.from(editorEl?.querySelectorAll(`[${KEEP_MARK}]`) ?? [])]) el.removeAttribute(KEEP_MARK);
		closed.forEach((el, i) => {
			if (was[i] === null) el.removeAttribute('contenteditable');
			else el.setAttribute('contenteditable', was[i]!);
		});
	}

	/** Undo the last Clear formatting, if nothing has changed since. */
	function undoClear(): boolean {
		const step = clearUndo;
		clearUndo = null;
		if (!step || !editorEl || editorEl.innerHTML !== step.html) return false;
		clearing = true;
		try {
			if (step.native) document.execCommand('undo');
		} finally {
			clearing = false;
		}
		writeLooks(step.before);
		// (Safari may take the step before back with it, and that may be a change of size.)
		afterHistory();
		clearRedo = { ...step, html: editorEl.innerHTML };
		clearChanged();
		return true;
	}

	/** Do it again, if nothing has changed since it was undone. */
	function redoClear(): boolean {
		const step = clearRedo;
		clearRedo = null;
		if (!step || !editorEl || editorEl.innerHTML !== step.html) return false;
		// (In the order it was done: the command read the elements as the editor had left them.)
		writeLooks(step.after);
		clearing = true;
		try {
			if (step.native) document.execCommand('redo');
		} finally {
			clearing = false;
		}
		writeLooks(step.after);
		clearUndo = { ...step, html: editorEl.innerHTML };
		clearChanged();
		return true;
	}

	function clearChanged(): void {
		updateToolbarState();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	// ── Indent ──
	// Indent and Outdent move the paragraphs the selection touches by half an inch (48px, written
	// to RTF as \li720) per press, as margin-left on each paragraph. The browser's own commands are
	// not used: Chromium's Outdent strips the first paragraph to loose text ("one<br>"), and the
	// browsers disagree on the markup. Only a style changes (and a line of loose text gets a
	// paragraph of its own), so earlier typing stays undoable; the editor keeps its own undo for
	// these steps until the next edit.
	//
	// The right indent and the hanging indent move by the same step, on a paragraph (a <p>, or a
	// <div> that holds text) outside a table cell, which is where the RTF writer sends them:
	//
	// | Command                          | Style on the paragraph                 | RTF            |
	// |----------------------------------|----------------------------------------|----------------|
	// | indent / outdent                 | margin-left                            | \liN           |
	// | rightIndent / rightOutdent       | margin-right                           | \riN           |
	// | hangingIndent / hangingOutdent   | margin-left, and text-indent the other | \liN\fi-N     |
	// |                                  | way, so the first line stays put       |                |
	//
	// Outdent stops where the first line of a hanging paragraph would reach the left edge.
	const INDENT_STEP_PX = 48;
	const INDENT_COMMANDS = ['indent', 'outdent', 'rightIndent', 'rightOutdent', 'hangingIndent', 'hangingOutdent'] as const;
	type IndentCommand = (typeof INDENT_COMMANDS)[number];
	function isIndentCommand(cmd: string): cmd is IndentCommand {
		return (INDENT_COMMANDS as readonly string[]).includes(cmd);
	}
	/** Commands that take an indent away: they never make a paragraph around loose text. */
	function decreases(cmd: IndentCommand): boolean {
		return cmd === 'outdent' || cmd === 'rightOutdent' || cmd === 'hangingOutdent';
	}
	const INDENT_TARGETS = 'p, div, h1, h2, h3, h4, h5, h6, pre, ul, ol, blockquote, figure';
	/** CSS lengths a margin is written in, in px. */
	const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

	/** One block an Indent or Outdent changed, and how to put it back. */
	interface IndentChange {
		el: HTMLElement;
		before: string | null;
		after: string | null;
		/** The block is a paragraph this step made around loose text, and the <br> that ended it. */
		wrapped: { br: HTMLBRElement | null } | null;
		/** The paragraph's data-rtf-tab-stops before a step that changed it. */
		stops?: { before: string | null; after: string | null };
	}
	let indentUndo: IndentChange[][] = [];

	function indentBlocks(cmd: IndentCommand): void {
		if (readonly || !editorEl) return;
		editorEl.focus();
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !editorEl.contains(sel.anchorNode)) return;
		const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
		const wrapped = new Map<HTMLElement, HTMLBRElement | null>();
		const targets = indentTargets(sel.getRangeAt(0), cmd, wrapped);
		// Wrapping loose text moves the selected text nodes, which collapses the selection; put it
		// back so the next press moves the same lines.
		if (wrapped.size > 0 && anchorNode instanceof Text && focusNode instanceof Text && anchorNode.isConnected && focusNode.isConnected) {
			sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
		}
		const step: IndentChange[] = [];
		for (const el of targets) {
			const before = el.getAttribute('style');
			const left = marginLeftPx(el);
			const first = textIndentPx(el);
			const setPx = (prop: 'marginLeft' | 'marginRight' | 'textIndent', px: number) => {
				el.style[prop] = px !== 0 ? `${Math.round(px * 100) / 100}px` : '';
			};
			if (cmd === 'indent') {
				setPx('marginLeft', left + INDENT_STEP_PX);
			} else if (cmd === 'outdent') {
				// A hanging paragraph's first line starts left of its margin: stop at the edge.
				const next = Math.max(0, -first, left - INDENT_STEP_PX);
				if (next === left) continue;
				setPx('marginLeft', next);
			} else if (cmd === 'rightIndent') {
				setPx('marginRight', marginRightPx(el) + INDENT_STEP_PX);
			} else if (cmd === 'rightOutdent') {
				const right = marginRightPx(el);
				if (right === 0) continue;
				setPx('marginRight', Math.max(0, right - INDENT_STEP_PX));
			} else if (cmd === 'hangingIndent') {
				setPx('marginLeft', left + INDENT_STEP_PX);
				setPx('textIndent', first - INDENT_STEP_PX);
			} else {
				// Only what hangs comes back: a paragraph with no hanging indent stays as it is.
				const back = Math.min(INDENT_STEP_PX, -first, left);
				if (back <= 0) continue;
				setPx('marginLeft', left - back);
				setPx('textIndent', first + back);
			}
			if (!el.getAttribute('style')) el.removeAttribute('style');
			const br = wrapped.get(el);
			step.push({ el, before, after: el.getAttribute('style'), wrapped: br === undefined ? null : { br } });
		}
		if (step.length === 0) return;
		indentUndo.push(step);
		indentChanged();
	}

	// ── Spacing ──
	// The space before and after a paragraph, and between its lines, as a style on each
	// paragraph the selection touches: a paragraph, a heading, and a picture (which has the
	// space around it, and no lines). It is what the RTF writer sends:
	//
	// | Set                  | Style on the paragraph | RTF               |
	// |----------------------|------------------------|-------------------|
	// | 6 pt before          | margin-top: 6pt        | \sb120            |
	// | 6 pt after           | margin-bottom: 6pt     | \sa120            |
	// | lines 1.5 apart      | line-height: 1.5       | \sl360\slmult1   |
	//
	// Not in a table cell, where the writer sends a paragraph's alignment and left indent only,
	// and not on a list. Each change is one step of the editor's own Undo, as an indent is.

	/** A paragraph's spacing as its own style sets it: lines apart (null: the editor's own), and points before and after. */
	interface ParagraphSpacing {
		line: number | null;
		before: number;
		after: number;
	}
	/** The most that is set: ten lines, and a space of two inches. */
	const MOST_LINES = 10;
	const MOST_SPACE_PT = 144;

	/** A margin a style sets, in points; 0 where it sets none, or one that cannot be read. */
	function spacePt(value: string): number {
		const m = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?|\.\d+)(px|pt|in|cm|mm)$/);
		return m ? Math.round(((parseFloat(m[1]) * PX_PER_UNIT[m[2]]) / PX_PER_UNIT.pt) * 100) / 100 : 0;
	}

	function spacingOf(el: HTMLElement): ParagraphSpacing {
		const line = el.style.lineHeight.trim();
		const lines = /^(\d+(\.\d+)?|\.\d+)%?$/.test(line) ? parseFloat(line) / (line.endsWith('%') ? 100 : 1) : null;
		return { line: lines !== null && lines > 0 ? Math.round(lines * 100) / 100 : null, before: spacePt(el.style.marginTop), after: spacePt(el.style.marginBottom) };
	}

	/** The paragraph, heading or picture the caret is in, where spacing can be set on it. */
	function spacedBlockAtCaret(): HTMLElement | null {
		if (!editorEl) return null;
		const node = selectedImage ?? window.getSelection()?.anchorNode ?? null;
		if (!node || !editorEl.contains(node)) return null;
		const el = node instanceof Element ? node : node.parentElement;
		if (!el || el.closest('td, th, li')) return null;
		const block = el.closest<HTMLElement>(INDENT_TARGETS);
		if (!block || block === editorEl || !editorEl.contains(block)) return null;
		return isPlainParagraph(block) || /^(H[1-6]|FIGURE)$/.test(block.tagName) ? block : null;
	}

	function applySpacing(change: { line?: number | null; before?: number | null; after?: number | null }): void {
		if (readonly || !editorEl) return;
		const valid = (n: number | null | undefined, most: number) => n == null || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= most);
		if (!valid(change.line, MOST_LINES) || change.line === 0 || !valid(change.before, MOST_SPACE_PT) || !valid(change.after, MOST_SPACE_PT)) return;
		// A picture that is selected is spaced as the paragraph it is.
		const figure = selectedImage?.closest<HTMLElement>('figure') ?? null;
		// (Not one in a table cell, where no paragraph is spaced: nor is the paragraph the
		// caret was last in, which is not what is selected.)
		if (selectedImage?.closest('td, th')) return;
		const wrapped = new Map<HTMLElement, HTMLBRElement | null>();
		let targets: HTMLElement[];
		if (figure && editorEl.contains(figure)) {
			targets = [figure];
		} else {
			restoreSelection();
			editorEl.focus();
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !editorEl.contains(sel.anchorNode)) return;
			const { anchorNode, anchorOffset, focusNode, focusOffset } = sel;
			targets = indentTargets(sel.getRangeAt(0), 'spacing', wrapped);
			if (wrapped.size > 0 && anchorNode instanceof Text && focusNode instanceof Text && anchorNode.isConnected && focusNode.isConnected) {
				sel.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
			}
		}
		const points = (n: number) => `${Math.round(n * 100) / 100}pt`;
		const step: IndentChange[] = [];
		for (const el of targets) {
			const before = el.getAttribute('style');
			// (A picture has no lines to space.)
			if (change.line !== undefined && el.tagName !== 'FIGURE') el.style.lineHeight = change.line === null ? '' : String(Math.round(change.line * 100) / 100);
			if (change.before !== undefined) el.style.marginTop = change.before ? points(change.before) : '';
			if (change.after !== undefined) el.style.marginBottom = change.after ? points(change.after) : '';
			if (!el.getAttribute('style')) el.removeAttribute('style');
			const after = el.getAttribute('style');
			const br = wrapped.get(el);
			if (after === before && br === undefined) continue;
			step.push({ el, before, after, wrapped: br === undefined ? null : { br } });
		}
		if (step.length === 0) return;
		indentUndo.push(step);
		indentChanged();
		overlayRef?.reposition();
	}

	/**
	 * Set how far apart the lines are in the paragraphs the selection touches, in lines: 1, 1.15,
	 * 1.5, 2. `null` takes the setting off, and the lines are as far apart as the editor's own
	 * style has them. Also what the toolbar's spacing list calls.
	 */
	export function setLineSpacing(lines: number | null): void {
		applySpacing({ line: lines });
	}

	/**
	 * Set the space before and after the paragraphs the selection touches, in points; a picture
	 * that is selected is spaced the same way. `0` or `null` takes a space off, and a side that
	 * is left out stays as it is: `setParagraphSpacing({ after: 6 })`.
	 */
	export function setParagraphSpacing(space: { before?: number | null; after?: number | null }): void {
		if (!space || typeof space !== 'object') return;
		applySpacing({ before: space.before, after: space.after });
	}

	/** An element's left margin in px: its own, from the inline style, or 0. */
	function marginLeftPx(el: HTMLElement): number {
		return Math.max(0, stylePx(el, 'marginLeft'));
	}

	/** An element's right margin in px: its own, from the inline style, or 0. */
	function marginRightPx(el: HTMLElement): number {
		return Math.max(0, stylePx(el, 'marginRight'));
	}

	/** An element's first-line indent in px, from the inline style: negative when it hangs. */
	function textIndentPx(el: HTMLElement): number {
		return stylePx(el, 'textIndent');
	}

	/** A length from an element's inline style, in px, or 0 when it sets none. */
	function stylePx(el: HTMLElement, prop: 'marginLeft' | 'marginRight' | 'textIndent'): number {
		const value = el.style[prop].trim();
		if (!value) return 0;
		return (lengthPx(value) ?? parseFloat(getComputedStyle(el)[prop])) || 0;
	}

	/** A CSS length in px, or null when it is not a number in px, pt, in, cm or mm. */
	function lengthPx(value: string): number | null {
		const m = /^(-?\d*\.?\d+)(px|pt|in|cm|mm)$/.exec(value.trim().toLowerCase());
		return m ? parseFloat(m[1]) * PX_PER_UNIT[m[2]] : null;
	}

	/** A <p>, or a <div> that holds text and no blocks: what a right or hanging indent is set on. */
	function isPlainParagraph(el: HTMLElement): boolean {
		if (el.tagName !== 'P' && el.tagName !== 'DIV') return false;
		return !Array.from(el.children).some((c) => c.matches(`${INDENT_TARGETS}, table, hr`));
	}

	/**
	 * The indent shape Chromium, WebKit and Gmail paste: a blockquote with a left margin and
	 * border: none. A quotation keeps its border. The RTF writer reads it the same way.
	 */
	function isIndentBlockquote(el: Element): el is HTMLElement {
		return el instanceof HTMLElement && el.tagName === 'BLOCKQUOTE' && el.style.borderLeftStyle === 'none';
	}

	// ── Hang at caret ──
	// Sets the hanging indent to where the caret is: the first line stays where it starts, and the
	// lines after it begin under the caret. Put the caret after "A. Pancreas: " and the rest of the
	// paragraph lines up under the diagnosis. With the caret at the start of the line the hang is
	// taken away. Works on a paragraph (a <p>, or a <div> that holds text) outside a table cell,
	// aligned left or justified, where a position measured from the left means something.
	//
	// When a tab comes before the caret, the tab has to end at the new indent for the first line to
	// line up with the rest. The paragraph gets a tab stop there: tab-size on screen (stops are
	// counted from the indent, so one hang's width puts a stop on it) and data-rtf-tab-stops for
	// the writer's \tx.
	const TAB_STOPS = 'data-rtf-tab-stops';

	function hangAtCaret(): void {
		if (readonly || !editorEl) return;
		editorEl.focus();
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !editorEl.contains(sel.anchorNode)) return;
		const caret = sel.getRangeAt(0).cloneRange();
		caret.collapse(true);
		const node = caret.startContainer;
		const offset = caret.startOffset;
		const el = node instanceof Element ? node : node.parentElement;
		if (!el || el.closest('td, th, li, pre, figure, h1, h2, h3, h4, h5, h6')) return;
		const x = caretLeft(caret);
		if (x === null) return;

		const closest = el.closest(PAINT_BLOCKS);
		let block = closest instanceof HTMLElement && closest !== editorEl && editorEl.contains(closest) ? closest : null;
		let wrapped: { br: HTMLBRElement | null } | null = null;
		if (block && !isPlainParagraph(block)) return;
		if (!block) {
			const made = wrapLooseLine(node);
			if (!made) return;
			block = made.p;
			wrapped = { br: made.br };
			// Wrapping moved the text the caret was in: put the caret back.
			if (node.isConnected) sel.collapse(node, offset);
		}
		// A centered <div align="center"> computes to -webkit-center or -moz-center.
		if (/(center|right)$|^end$/.test(getComputedStyle(block).textAlign)) {
			if (wrapped) undoWrap(block, wrapped);
			return;
		}

		const left = marginLeftPx(block);
		// Where the first line starts, and where the caret is, both from the page's left edge.
		const first = Math.max(0, left + textIndentPx(block));
		const at = Math.round(x - (block.getBoundingClientRect().left - left));
		const hang = at - first;
		const before = wrapped ? null : block.getAttribute('style');
		const stopsBefore = block.getAttribute(TAB_STOPS);
		const before0 = document.createRange();
		before0.setStart(block, 0);
		before0.setEnd(node, offset);
		const tabBefore = before0.toString().includes('\t');

		// The stop an earlier hang put at the old indent goes with that hang. Any other stop the
		// paragraph has (data-rtf-tab-stops="1.75in,3.5in") is not this command's to remove.
		// A tab stop counts from the page margin, as \tx does, while the indents above count from the
		// block around the paragraph: a quotation or a pasted indent moves the stop with it.
		const outer = surroundingIndentPx(block);
		const hung = textIndentPx(block) < 0;
		const stops = (stopsBefore ?? '')
			.split(',')
			.map((v) => v.trim())
			.filter((v) => v && !(hung && Math.abs((lengthPx(v) ?? NaN) - (outer + left)) < 0.5));
		// tab-size shows one stop, the one at the hang: it goes when that stop does.
		block.style.tabSize = '';
		if (hang < 1) {
			block.style.marginLeft = first > 0 ? `${first}px` : '';
			block.style.textIndent = '';
		} else {
			block.style.marginLeft = `${at}px`;
			block.style.textIndent = `${-hang}px`;
			if (tabBefore) {
				block.style.tabSize = `${hang}px`;
				const stop = outer + at;
				if (!stops.some((v) => Math.abs((lengthPx(v) ?? NaN) - stop) < 0.5)) stops.push(`${stop}px`);
			}
		}
		if (stops.length > 0) block.setAttribute(TAB_STOPS, stops.join(','));
		else block.removeAttribute(TAB_STOPS);
		if (!block.getAttribute('style')) block.removeAttribute('style');
		const after = block.getAttribute('style');
		const stopsAfter = block.getAttribute(TAB_STOPS);
		if (!wrapped && after === before && stopsAfter === stopsBefore) return;
		indentUndo.push([{ el: block, before, after, wrapped, stops: { before: stopsBefore, after: stopsAfter } }]);
		indentChanged();
	}

	/**
	 * The left indent the RTF writer gives a paragraph from the blocks around it, in px: a pasted
	 * indent's margin, a <div>'s margin, and a quotation's margin plus the half inch every
	 * quotation is indented (rtf-writer's blockquote case).
	 */
	function surroundingIndentPx(block: HTMLElement): number {
		let px = 0;
		for (let a = block.parentElement; a && a !== editorEl; a = a.parentElement) {
			if (a.tagName === 'BLOCKQUOTE') px += marginLeftPx(a) + (isIndentBlockquote(a) ? 0 : INDENT_STEP_PX);
			else if (a.tagName === 'DIV') px += marginLeftPx(a);
		}
		return px;
	}

	/** Take away the paragraph wrapLooseLine made, leaving the loose line as it was. */
	function undoWrap(p: HTMLElement, wrapped: { br: HTMLBRElement | null }): void {
		if (wrapped.br) p.after(wrapped.br);
		p.replaceWith(...Array.from(p.childNodes));
	}

	/**
	 * The caret's distance from the left of the window. A caret between two pieces of text can have
	 * no box of its own, so the character after it, or the one before, stands in.
	 */
	function caretLeft(caret: Range): number | null {
		const own = caret.getClientRects()[0];
		if (own && (own.height > 0 || own.width > 0)) return own.left;
		const node = caret.startContainer;
		if (!(node instanceof Text)) return null;
		const probe = document.createRange();
		if (caret.startOffset < node.length) {
			probe.setStart(node, caret.startOffset);
			probe.setEnd(node, caret.startOffset + 1);
			const r = probe.getClientRects()[0];
			if (r) return r.left;
		}
		if (caret.startOffset > 0) {
			probe.setStart(node, caret.startOffset - 1);
			probe.setEnd(node, caret.startOffset);
			const rects = probe.getClientRects();
			const r = rects[rects.length - 1];
			if (r) return r.right;
		}
		return null;
	}

	// ── Copy format ──
	// The toolbar's Copy format button turns the pointer into a format brush. The first click in
	// the text picks the paragraph to copy from; each click after that gives the clicked paragraph
	// the same alignment and indents. It stays on until Escape, Done, or the button again, so one
	// format can go to as many paragraphs as needed.
	//
	// What is copied is the paragraph's own formatting, the part the RTF writer sends as \q, \li,
	// \ri and \fi: text-align, margin-left, margin-right and text-indent, and with them the tab
	// stop Hang at caret sets (tab-size, data-rtf-tab-stops). Each block takes what the writer
	// sends for it: a heading all of it but the tab stop, and a heading or paragraph in a table
	// cell the alignment and the left indent only. Lists, code blocks and pictures are left alone.
	// Each click is one Undo step.
	interface ParagraphFormat {
		textAlign: string;
		marginLeft: string;
		marginRight: string;
		textIndent: string;
		/** The tab stop that goes with a hanging indent: tab-size on screen, \tx in the RTF. */
		tabSize: string;
		tabStops: string;
		/** The space before and after it, and between its lines. */
		marginTop: string;
		marginBottom: string;
		lineHeight: string;
	}
	const NO_FORMAT: ParagraphFormat = { textAlign: '', marginLeft: '', marginRight: '', textIndent: '', tabSize: '', tabStops: '', marginTop: '', marginBottom: '', lineHeight: '' };
	const PAINT_BLOCKS = 'p, div, h1, h2, h3, h4, h5, h6';

	/** 'pick': waiting for the paragraph to copy from. 'apply': each click applies the format. */
	let copyFormat: 'off' | 'pick' | 'apply' = $state('off');
	let copiedFormat: ParagraphFormat = NO_FORMAT;
	let copySource: HTMLElement | null = null;
	/** Where the frame around the paragraph copied from sits, inside the content wrapper. */
	let copySourceBox: { top: number; left: number; width: number; height: number } | null = $state(null);

	function toggleCopyFormat(): void {
		if (copyFormat !== 'off') {
			stopCopyFormat();
			return;
		}
		if (readonly) return;
		selectedImage = null;
		copyFormat = 'pick';
	}

	function stopCopyFormat(): void {
		copyFormat = 'off';
		copiedFormat = NO_FORMAT;
		copySource = null;
		copySourceBox = null;
	}

	function placeCopySourceBox(): void {
		if (!copySource?.isConnected || !contentWrapEl) {
			copySourceBox = null;
			return;
		}
		const wrap = contentWrapEl.getBoundingClientRect();
		const r = copySource.getBoundingClientRect();
		// A hanging first line starts left of the paragraph's own box: frame it too.
		const hang = Math.max(0, -textIndentPx(copySource));
		copySourceBox = { top: r.top - wrap.top, left: r.left - wrap.left - hang, width: r.width + hang, height: r.height };
	}

	function formatOf(el: HTMLElement): ParagraphFormat {
		const align = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
		return {
			textAlign: align === 'left' || align === 'start' ? '' : align,
			marginLeft: el.style.marginLeft,
			marginRight: el.style.marginRight,
			textIndent: el.style.textIndent,
			tabSize: el.style.tabSize,
			tabStops: el.getAttribute(TAB_STOPS) ?? '',
			marginTop: el.style.marginTop,
			marginBottom: el.style.marginBottom,
			lineHeight: el.style.lineHeight
		};
	}

	/**
	 * The paragraph a click landed on: a <p>, a heading, or a <div> that holds text. A click on a
	 * line of loose text lands on the editor itself, so the caret the click placed says which line.
	 */
	function paragraphAt(e: MouseEvent): { block: HTMLElement | null; loose: Node | null } {
		const none = { block: null, loose: null };
		if (!editorEl) return none;
		const target = e.target instanceof Element ? e.target : null;
		if (!target || !editorEl.contains(target)) return none;
		if (target.closest('li, pre, figure')) return none;
		const own = paintable(target);
		if (own !== undefined) return own ? { block: own, loose: null } : none;
		// The click landed on the editor itself, not on a paragraph: loose text, a margin, or the
		// empty space below the text. Only loose text counts. The caret also lands in the nearest
		// paragraph when its margin is clicked, and that paragraph was not what was clicked.
		const anchor = window.getSelection()?.anchorNode ?? null;
		if (!(anchor instanceof Text) || !anchor.data.trim() || !editorEl.contains(anchor)) return none;
		const parent = anchor.parentElement;
		if (!parent || parent.closest('li, pre, figure, blockquote') || paintable(parent) !== undefined) return none;
		return { block: null, loose: anchor };
	}

	/**
	 * The paragraph an element is in that Copy format can read or set: a heading, a <p>, or a
	 * <div> that holds text. null when it is in a block that cannot take one (a <div> holding other
	 * blocks); undefined when it is in no block at all, which is loose text.
	 */
	function paintable(el: Element): HTMLElement | null | undefined {
		if (!editorEl) return undefined;
		const block = el.closest(PAINT_BLOCKS);
		const cell = el.closest('td, th');
		if (!(block instanceof HTMLElement) || block === editorEl || !editorEl.contains(block)) return undefined;
		if (cell && !cell.contains(block)) return undefined;
		return /^H[1-6]$/.test(block.tagName) || isPlainParagraph(block) ? block : null;
	}

	function handleCopyFormatClick(e: MouseEvent): void {
		const { block, loose } = paragraphAt(e);
		if (!block && !loose) return;
		if (copyFormat === 'pick') {
			copiedFormat = block ? formatOf(block) : NO_FORMAT;
			copySource = block;
			copyFormat = 'apply';
			placeCopySourceBox();
			return;
		}
		if (block && block === copySource) return;
		let target = block;
		let wrapped: { br: HTMLBRElement | null } | null = null;
		if (!target && loose) {
			// A line of loose text has no format to take away, and needs a paragraph to carry one.
			if (Object.values(copiedFormat).every((v) => !v)) return;
			const made = wrapLooseLine(loose);
			if (!made) return;
			target = made.p;
			wrapped = { br: made.br };
		}
		if (!target) return;
		const before = wrapped ? null : target.getAttribute('style');
		const stopsBefore = target.getAttribute(TAB_STOPS);
		// What the writer sends decides what a block can take: a paragraph or a heading outside a
		// table cell carries all three indents, and only a paragraph carries tab stops.
		const outsideCell = !target.closest('td, th');
		const whole = outsideCell && isPlainParagraph(target);
		const indents = whole || (outsideCell && /^H[1-6]$/.test(target.tagName));
		// align="center" (Firefox) outranks an empty style, so say left out loud over it.
		target.style.textAlign = copiedFormat.textAlign || (target.hasAttribute('align') ? 'left' : '');
		target.style.marginLeft = copiedFormat.marginLeft;
		if (indents) {
			target.style.marginRight = copiedFormat.marginRight;
			target.style.textIndent = copiedFormat.textIndent;
			// (Spacing goes where the writer sends it: the same blocks.)
			target.style.marginTop = copiedFormat.marginTop;
			target.style.marginBottom = copiedFormat.marginBottom;
			target.style.lineHeight = copiedFormat.lineHeight;
		}
		if (whole) {
			target.style.tabSize = copiedFormat.tabSize;
			if (copiedFormat.tabStops) target.setAttribute(TAB_STOPS, copiedFormat.tabStops);
			else target.removeAttribute(TAB_STOPS);
		}
		if (!target.getAttribute('style')) target.removeAttribute('style');
		const after = target.getAttribute('style');
		const stopsAfter = target.getAttribute(TAB_STOPS);
		if (!wrapped && after === before && stopsAfter === stopsBefore) return;
		indentUndo.push([{ el: target, before, after, wrapped, stops: { before: stopsBefore, after: stopsAfter } }]);
		indentChanged();
		placeCopySourceBox();
	}

	/** Undo the last Indent or Outdent, if nothing has changed since. */
	function undoIndent(): boolean {
		const step = indentUndo.pop();
		if (!step) return false;
		// Content replaced or edited since (setHTML, an import, a link): the step no longer applies.
		if (step.some(({ el, after }) => !el.isConnected || el.getAttribute('style') !== after)) {
			indentUndo = [];
			return false;
		}
		for (const { el, before, wrapped, stops } of step) {
			if (before === null) el.removeAttribute('style');
			else el.setAttribute('style', before);
			if (stops) {
				if (stops.before === null) el.removeAttribute(TAB_STOPS);
				else el.setAttribute(TAB_STOPS, stops.before);
			}
			if (wrapped) undoWrap(el, wrapped);
		}
		indentChanged();
		return true;
	}

	function indentChanged(): void {
		placeCopySourceBox();
		updateToolbarState();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/**
	 * The blocks Indent moves: each line's paragraph, and a list, a quotation or a picture as a
	 * whole. A line of loose text (typed straight into the editor or a table cell) is first given a
	 * paragraph of its own, so the margin moves that line only. Outdent on a line with no margin
	 * of its own moves the pasted indent around it (isIndentBlockquote) instead. A right or hanging
	 * indent moves paragraphs only (isPlainParagraph), and nothing inside a table cell.
	 */
	function indentTargets(
		range: Range,
		cmd: IndentCommand | 'spacing',
		wrapped: Map<HTMLElement, HTMLBRElement | null>
	): HTMLElement[] {
		if (!editorEl) return [];
		const root = editorEl;
		const found: HTMLElement[] = [];
		const add = (el: HTMLElement | null) => {
			if (el && !found.includes(el)) found.push(el);
		};
		const blockFor = (node: Node): HTMLElement | null => {
			if (node === root || !root.contains(node)) return null;
			const el = node instanceof Element ? node : node.parentElement;
			if (!el) return null;
			const cell = el.closest('td, th');
			const inScope = (b: Element | null | undefined): b is HTMLElement =>
				b instanceof HTMLElement && b !== root && root.contains(b) && (!cell || cell.contains(b));
			const item = el.closest('li');
			const closest = el.closest(INDENT_TARGETS);
			const block = inScope(item) ? item.parentElement : inScope(closest) ? closest : null;
			if (cmd !== 'indent' && cmd !== 'outdent') {
				if (cell) return null;
				// (Spacing is also a heading's and a picture's: the writer sends it for those.)
				if (inScope(block)) return isPlainParagraph(block) || (cmd === 'spacing' && /^(H[1-6]|FIGURE)$/.test(block.tagName)) ? block : null;
				if (cmd !== 'spacing' && decreases(cmd)) return null;
				const made = wrapLooseLine(node);
				if (made) wrapped.set(made.p, made.br);
				return made?.p ?? null;
			}
			if (cmd === 'outdent' && (!block || marginLeftPx(block) === 0)) {
				for (let a = (block ?? el).parentElement; inScope(a); a = a.parentElement) {
					if (isIndentBlockquote(a) && marginLeftPx(a) > 0) return a;
				}
				return block;
			}
			if (inScope(block)) return block;
			if (cmd === 'outdent') return null;
			const made = wrapLooseLine(node);
			if (made) wrapped.set(made.p, made.br);
			return made?.p ?? null;
		};
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const texts: Text[] = [];
		for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
			if (!n.data.trim() || !range.intersectsNode(n)) continue;
			// A selection that only touches a line's edge (dragged to the start of the next line)
			// does not move that line.
			if (n === range.endContainer && range.endOffset === 0 && !range.collapsed) continue;
			if (n === range.startContainer && range.startOffset === n.length && !range.collapsed) continue;
			texts.push(n);
		}
		if (texts.length === 0) add(blockFor(range.startContainer));
		for (const t of texts) add(blockFor(t));
		return found;
	}

	/**
	 * Put the run of loose text and inline elements around a node into a <p>, and return it with
	 * the <br> that ended the run, which the paragraph replaces.
	 */
	function wrapLooseLine(node: Node): { p: HTMLElement; br: HTMLBRElement | null } | null {
		if (!editorEl || node === editorEl || !editorEl.contains(node)) return null;
		let start: Node = node;
		while (start.parentNode && start.parentNode !== editorEl && !(start.parentNode as Element).matches?.('td, th')) {
			start = start.parentNode;
		}
		const parent = start.parentNode;
		if (!parent || !editorEl.contains(parent)) return null;
		const isBreak = (n: Node | null) =>
			!n || (n instanceof Element && (n.matches(INDENT_TARGETS) || n.matches('br, table, hr')));
		if (isBreak(start)) return null;
		let first: Node = start;
		while (!isBreak(first.previousSibling)) first = first.previousSibling!;
		let last: Node = start;
		while (!isBreak(last.nextSibling)) last = last.nextSibling!;
		const p = document.createElement('p');
		parent.insertBefore(p, first);
		let n: Node | null = first;
		while (n) {
			const next: Node | null = n === last ? null : n.nextSibling;
			p.appendChild(n);
			n = next;
		}
		let br: HTMLBRElement | null = null;
		if (p.nextSibling instanceof HTMLBRElement) {
			br = p.nextSibling;
			br.remove();
		}
		return { p, br };
	}

	// ── Block type ──
	function setBlock(tag: string): void {
		restoreSelection();
		editorEl?.focus();
		document.execCommand('formatBlock', false, tag);
		updateToolbarState();
	}

	// ── Toolbar state ──
	function updateToolbarState(): void {
		// Snapshot the selection so exec/setBlock can restore it even if focus
		// temporarily moved to a toolbar element (e.g. colour picker, select).
		saveSelection();
		currentFontSize = sizeAtSelection();
		currentFont = fontList.length > 0 ? fontAtSelection() : '';
		const spaced = spacedBlockAtCaret();
		currentSpacing = spaced ? spacingOf(spaced) : { line: null, before: 0, after: 0 };

		formatState = {
			bold: document.queryCommandState('bold'),
			italic: document.queryCommandState('italic'),
			underline: document.queryCommandState('underline'),
			strikeThrough: document.queryCommandState('strikeThrough')
		};

		const block = document.queryCommandValue('formatBlock');
		const normalized = block.replace(/[<>]/g, '').toLowerCase();
		currentBlock = BLOCK_CHOICES.has(normalized) ? normalized : 'p';

		updateCounts();
	}

	/**
	 * A click or a key in the text. A size chosen at a caret and not yet typed in is given up: the
	 * browser drops it when the caret moves, and the toolbar must not go on showing it.
	 */
	function caretMoved(): void {
		pendingSize = null;
		pendingFont = null;
		updateToolbarState();
		keepCaretInSight();
	}

	let headEl: HTMLDivElement | undefined = $state();

	/**
	 * The browser scrolls a caret into the window, and knows nothing of the toolbar that stays
	 * at the top of it: a caret moved up with the keys ends under the toolbar. The page is
	 * scrolled by what the toolbar covers of the caret's line.
	 */
	function keepCaretInSight(): void {
		if (!stickyToolbar || !headEl || !editorEl) return;
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || !selectionInEditor()) return;
		const focus = document.createRange();
		try {
			focus.setStart(selection.focusNode!, selection.focusOffset);
		} catch {
			return;
		}
		const caret = focus.getClientRects()[0];
		if (!caret) return;
		const head = headEl.getBoundingClientRect();
		// Only where the toolbar is over the document, which it is not until the page is scrolled.
		if (head.bottom <= editorEl.getBoundingClientRect().top) return;
		const covered = head.bottom + 8 - caret.top;
		if (covered <= 0 || caret.bottom < head.top) return;
		for (let at: HTMLElement | null = editorEl.parentElement; at; at = at.parentElement) {
			const overflow = getComputedStyle(at).overflowY;
			if ((overflow === 'auto' || overflow === 'scroll') && at.scrollHeight > at.clientHeight) {
				at.scrollTop -= covered;
				return;
			}
		}
		window.scrollBy(0, -covered);
	}

	/** The editing area was scrolled sideways (a wide table): what is drawn over it moves with it. */
	function contentScrolled(): void {
		hideLinkHint();
		overlayRef?.reposition();
		placeCopySourceBox();
	}

	function updateCounts(): void {
		if (!editorEl) return;
		const shown = editorEl.innerText || '';
		// A document with nothing in it is a paragraph with a line break, which innerText gives
		// as one character: an empty report then counted one, and so did one of blank lines only.
		const text = shown.trim() === '' && !editorEl.querySelector('img, table, hr') ? '' : shown;
		const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
		wordCount = words.length;
		charCount = text.length;
	}

	function fireChange(): void {
		if (!onchange) return;
		// The HTML, the text and the size estimate each read the whole document, and this runs on
		// every keystroke: with a few pictures in the document it took a tenth of a second. Each is
		// worked out when the handler asks for it, once, and not at all if it never does.
		const el = editorEl;
		const options = { fontFamily, fontSize, fonts };
		const once = <T,>(read: () => T): (() => T) => {
			let value: { v: T } | null = null;
			return () => (value ??= { v: read() }).v;
		};
		const html = once(() => el?.innerHTML || '');
		const text = once(() => el?.innerText || '');
		const estimate = once(() => (el ? estimateRtfBytes(el, options) : 0));
		onchange({
			get html() { return html(); },
			get text() { return text(); },
			wordCount,
			charCount,
			get estimatedRtfBytes() { return estimate(); }
		});
	}

	// ── Auto-save ──
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	/** Keep the draft in the browser's storage. */
	function keepDraft(): void {
		if (!editorEl) return;
		try {
			localStorage.setItem(storageKey, editorEl.innerHTML);
			lastSaved = `Saved ${new Date().toLocaleTimeString()}`;
		} catch (e) {
			// Embedded images can push a document past the localStorage quota. Say
			// so instead of showing a "Saved" that did not happen — onsave still
			// fires so the host app can persist the content itself.
			lastSaved = 'Too large to auto-save in this browser';
		}
	}

	/**
	 * Forget the draft, and the save that was waiting. (A document that could not be shown left
	 * the draft of the one before it: opened again, the editor showed that one, the report of
	 * the patient before.)
	 */
	function dropDraft(): void {
		clearTimeout(saveTimer);
		try { localStorage.removeItem(storageKey); } catch (e) {}
		lastSaved = '';
	}

	function autoSaveNow(): void {
		if (!editorEl || !autosave) return;
		keepDraft();
		onsave?.({ html: editorEl.innerHTML });
	}

	/**
	 * Ctrl+S: onsave, whether or not drafts are kept. (It went through the auto-save, which does
	 * nothing where `autosave` is off. Since that is the default, the key was taken from the
	 * browser and nothing was saved anywhere: an application that saves from onsave saved nothing.)
	 */
	function saveNow(): void {
		if (!editorEl) return;
		// The save that was waiting is this one.
		clearTimeout(saveTimer);
		if (autosave) keepDraft();
		onsave?.({ html: editorEl.innerHTML });
	}

	function scheduleAutoSave(): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(autoSaveNow, 1000);
	}

	/** The kinds of input event that put markup from somewhere else into the document. */
	const MARKUP_FROM_OUTSIDE = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank']);

	// ── Input handler ──
	function handleInput(e?: Event): void {
		placeCopySourceBox();
		const kind = (e as InputEvent | undefined)?.inputType ?? '';
		const history = kind === 'historyUndo' || kind === 'historyRedo';
		// (Words dragged from one place in the document to another are first taken out where
		// they were, which is an input event of its own: what was dropped has not come in yet.)
		let shown = true;
		if (pastedOver && kind !== 'deleteByDrag') {
			tidyPasted(pastedOver);
			pastedOver = null;
		} else if (history || MARKUP_FROM_OUTSIDE.has(kind)) {
			// Undo and Redo put back what the browser remembers, not what the editor made of it:
			// Redo after a paste brings back the frame that was taken out of the paste, the
			// style that was taken off what stayed, and Word's hidden text as words. And a drop
			// or a paste the editor was not told of is still a drop or a paste.
			if (kind === 'historyRedo') hideAgain();
			shown = checkDocument();
		}
		followPastes(kind === 'historyUndo');
		indentUndo = [];
		if (history) {
			// (Not in the middle of a Clear formatting or of its Undo: the sizes are then not
			// yet back on the elements. And what the editor puts back first, for the same reason.)
			if (kind === 'historyUndo') afterUndoOfClear();
			if (!clearing) afterHistory();
		} else {
			// (And a Clear formatting before this edit is the browser's to undo from here on.)
			clearUndo = clearRedo = null;
			// An edit: what was undone can no longer be redone.
			sizeSteps = sizeSteps.slice(0, sizeStepsApplied);
			// What was typed at a caret after a size was chosen came in marked: give it the size.
			applyPendingSize();
		}
		pendingSize = null;
		pendingFont = null;
		updateToolbarState();
		// Typing means the user is editing text, not the picture. Dropping the
		// selection here keeps Backspace editing that text instead of deleting a
		// still-selected image somewhere else in the document.
		selectedImage = null;
		// (Clear formatting says so itself, when the document is as it leaves it.)
		if (clearing) return;
		fireChange();
		if (autosave && shown) scheduleAutoSave();
	}

	// ── Link modal ──
	function openLinkModal(): void {
		keepForDialog();
		linkUrl = '';
		linkText = '';
		linkError = '';
		linkModalOpen = true;
	}

	function applyLink(): void {
		if (!linkUrl) { linkModalOpen = false; return; }
		// Only a web, mail or phone address becomes a link; a javascript: address would
		// run when clicked in the editor and in any viewer of the stored HTML. The dialog
		// stays open and says why, rather than closing as if the link had been added.
		if (!isSafeLinkUrl(linkUrl)) {
			linkError = 'Enter a web address (https://…), an email address (mailto:…) or a phone number (tel:…).';
			return;
		}
		linkError = '';
		// Inserting changes the document outside an input event: earlier indent steps no longer undo.
		indentUndo = [];
		restoreFor(dialogSelection);
		editorEl?.focus();

		if (linkText) {
			const sel = window.getSelection();
			if (sel && sel.rangeCount) {
				const range = sel.getRangeAt(0);
				range.deleteContents();
				const a = document.createElement('a');
				a.href = linkUrl.trim();
				a.textContent = linkText;
				range.insertNode(a);
				range.setStartAfter(a);
				sel.removeAllRanges();
				sel.addRange(range);
			}
		} else {
			document.execCommand('createLink', false, linkUrl.trim());
		}
		linkModalOpen = false;
		updateCounts();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/**
	 * Enter in a dialog's field does what the dialog's button does. The key press ends here: the
	 * dialog hands the keyboard back to the document, where the same Enter would go on to replace
	 * the selected text with a new line.
	 */
	function onEnter(e: KeyboardEvent, act: () => void): void {
		if (e.key !== 'Enter' || e.isComposing) return;
		e.preventDefault();
		e.stopPropagation();
		act();
	}

	// ── Tables ──
	// A table is put in from a dialog: its rows and columns, whether its cells have borders,
	// and whether its first row is a header. It is written the way rtfToHtml reads a table
	// back, so that a document is the same after it is saved and opened again: the cells
	// share the width of the table, and a border is a style on each cell, which is what the
	// RTF writer sends (\clbrdrt\brdrs\brdrw15 and so on). A table with no borders has none
	// in the RTF either; the editor draws a faint line around its cells while it is edited.
	const MOST_TABLE_ROWS = 50;
	const MOST_TABLE_COLUMNS = 12;
	const TABLE_STYLE = 'border-collapse:collapse;width:100%;margin:4px 0';
	const CELL_BORDER = 'border:1px solid;';

	/**
	 * A column's share of the width of a table of `count` equal columns, as the reader gives
	 * it: the edges, each rounded to a hundredth of a percent, and a cell the difference of two.
	 */
	function columnShare(column: number, count: number): string {
		const edge = (k: number) => Math.round((k / count) * 10000) / 100;
		return (edge(column + 1) - edge(column)).toFixed(2).replace(/0$/, '');
	}

	function openTableModal(): void {
		keepForDialog();
		tableModalOpen = true;
	}

	function applyTable(): void {
		const at = dialogSelection;
		tableModalOpen = false;
		restoreFor(at);
		insertTable(tableRows ?? 0, tableColumns ?? 0, { borders: tableBorders, header: tableHeader });
	}

	/**
	 * Put a table of empty cells in after the paragraph the caret is in (in its place where
	 * that is empty), and the caret in its first cell. `borders` (default true) gives every
	 * cell a border, which is written to the RTF; `header` makes the first row header cells.
	 * At most 50 rows and 12 columns. Also what the toolbar's Insert table dialog calls.
	 */
	export function insertTable(rows: number, columns: number, options: { borders?: boolean; header?: boolean } = {}): void {
		if (readonly || !editorEl) return;
		const whole = (n: unknown, most: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(most, Math.floor(n))) : 0);
		const rowCount = whole(rows, MOST_TABLE_ROWS);
		const columnCount = whole(columns, MOST_TABLE_COLUMNS);
		if (rowCount < 1 || columnCount < 1 || rows < 1 || columns < 1) return;
		const borders = options?.borders !== false;
		const header = options?.header === true;
		editorEl.focus();
		// Inserting changes the document outside an input event: earlier indent steps no longer undo.
		indentUndo = [];

		const table = document.createElement('table');
		table.setAttribute('style', TABLE_STYLE);
		const body = document.createElement('tbody');
		for (let r = 0; r < rowCount; r++) {
			const row = document.createElement('tr');
			for (let c = 0; c < columnCount; c++) {
				const head = header && r === 0;
				const cell = document.createElement(head ? 'th' : 'td');
				const width = `width:${columnShare(c, columnCount)}%`;
				// (A header cell says how it is aligned: a browser centers one that does not.
				// With no borders it has the line under it that marks a header cell in the RTF.)
				cell.setAttribute('style', head ? `${borders ? CELL_BORDER : 'border-bottom:1px solid;'}padding:2px 6px;text-align:left;${width}` : `${borders ? CELL_BORDER : ''}padding:2px 6px;${width}`);
				cell.appendChild(document.createElement('br'));
				row.appendChild(cell);
			}
			body.appendChild(row);
		}
		table.appendChild(body);

		const block = caretBlock();
		if (block && isEmptyBlock(block)) block.replaceWith(table);
		else if (block) block.after(table);
		else editorEl.appendChild(table);
		// Somewhere to go on typing after the table.
		const next = table.nextElementSibling;
		if (!next || next.tagName === 'TABLE' || next.tagName === 'FIGURE') {
			const p = document.createElement('p');
			p.appendChild(document.createElement('br'));
			table.after(p);
		}
		selectedImage = null;
		placeCaret(table.querySelector('td, th') as HTMLElement);
		updateToolbarState();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	// ── Images ──
	function openImageModal(): void {
		keepForDialog();
		imageUrl = '';
		imageAlt = '';
		imageCaption = '';
		pendingImageFiles = [];
		imageModalOpen = true;
	}

	function chooseImageFiles(): void {
		imageInputEl?.click();
	}

	function handleImageFilesChosen(e: Event): void {
		const input = e.target as HTMLInputElement;
		pendingImageFiles = Array.from(input.files || []).filter((f) => f.type.startsWith('image/'));
		input.value = '';
	}

	async function applyImage(): Promise<void> {
		const files = pendingImageFiles;
		const url = imageUrl.trim();
		const caption = imageCaption.trim();
		const alt = imageAlt.trim();
		const at = dialogSelection;

		imageModalOpen = false;
		pendingImageFiles = [];

		if (files.length > 0) {
			await insertImageFiles(files, caption, alt, at);
			return;
		}
		if (!url) return;
		if (!isSafeImageUrl(url)) {
			showError('That image address is not supported');
			return;
		}

		insertingImages = true;
		try {
			const { src, embedded, tooLarge, unreadable } = await urlToImageSrc(url, imageLimits());
			// Picture data over the size limit that could not be reduced is not inserted:
			// once in the document it would be written to the RTF at its full size.
			if (tooLarge) {
				showError(TOO_LARGE_MESSAGE);
				return;
			}
			// Nor is picture data the browser cannot open: it would show as a broken picture.
			if (unreadable) {
				showError(UNREADABLE_MESSAGE);
				return;
			}
			restoreFor(at);
			editorEl?.focus();
			finishInsert(insertFigure(src, alt || caption, caption));
			// It displays either way, but only embedded bytes reach the RTF.
			if (!embedded) {
				showError('That image could not be embedded — it will export as a placeholder');
			}
		} finally {
			insertingImages = false;
		}
	}

	/** Said when picture data given by address or pasted is over the size limit and cannot be reduced. */
	const TOO_LARGE_MESSAGE = 'That picture is over the size limit and could not be made smaller, so it was not inserted';

	/** Said when picture data given by address is in a format the browser cannot show, or is damaged. */
	const UNREADABLE_MESSAGE =
		'That picture could not be opened (the browser cannot show its format, or it is damaged), so it was not inserted';

	/** Caps applied to a picture as it is inserted. */
	function imageLimits(): { maxEdge: number; maxBytes: number } {
		return { maxEdge: maxImageEdge, maxBytes: maxImageBytes };
	}

	/** Width in px available to an image — the editor's content box. */
	function contentWidth(): number {
		if (!editorEl) return 0;
		const styles = getComputedStyle(editorEl);
		const padding = parseFloat(styles.paddingLeft || '0') + parseFloat(styles.paddingRight || '0');
		return Math.max(0, editorEl.clientWidth - padding);
	}

	/** The direct child of the editor that contains the caret, if any. */
	function caretBlock(): HTMLElement | null {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !editorEl) return null;
		let node: Node | null = sel.getRangeAt(0).startContainer;
		if (!editorEl.contains(node)) return null;
		while (node && node.parentNode !== editorEl) node = node.parentNode;
		return node instanceof HTMLElement ? node : null;
	}

	function isEmptyBlock(el: HTMLElement): boolean {
		if (el.querySelector('img, table, hr')) return false;
		return (el.textContent || '').trim().length === 0;
	}

	function placeCaret(el: HTMLElement, atStart = true): void {
		const range = document.createRange();
		range.selectNodeContents(el);
		range.collapse(atStart);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		savedSelection = range.cloneRange();
	}

	/**
	 * Insert a <figure><img><figcaption> block at the caret. Figures are block
	 * level, so they are placed between top-level blocks rather than inside the
	 * paragraph the caret happens to be in.
	 */
	function insertFigure(
		src: string,
		alt: string,
		caption: string
	): { img: HTMLImageElement; after: HTMLElement } | null {
		if (!editorEl) return null;
		indentUndo = [];

		const figure = document.createElement('figure');
		const img = document.createElement('img');
		img.src = src;
		if (alt) img.alt = alt;
		const figcaption = document.createElement('figcaption');
		if (caption) figcaption.textContent = caption;
		figure.append(img, figcaption);

		const block = caretBlock();
		if (block && isEmptyBlock(block)) block.replaceWith(figure);
		else if (block) block.after(figure);
		else editorEl.appendChild(figure);

		// Guarantee somewhere to keep typing after the image.
		let after = figure.nextElementSibling as HTMLElement | null;
		if (!after || after.tagName === 'FIGURE') {
			const p = document.createElement('p');
			p.appendChild(document.createElement('br'));
			figure.after(p);
			after = p;
		}

		fitImageWhenLoaded(img);
		return { img, after };
	}

	/**
	 * Size a freshly inserted image: the smallest of its natural width, the
	 * editor column and the page cap, never larger. The page cap is what keeps
	 * \picwgoal inside the width of the page the document lands on — a browser
	 * -wide picture would be written as 12in and overflow it. The user can still
	 * enlarge it deliberately with the resize handles.
	 */
	function fitImage(img: HTMLImageElement): void {
		const width = initialDisplayWidth(img.naturalWidth, contentWidth(), maxImageDisplayWidth);
		if (!width) return;
		img.style.width = `${width}px`;
		img.style.height = 'auto';
		overlayRef?.reposition();
	}

	function fitImageWhenLoaded(img: HTMLImageElement): void {
		if (img.complete && img.naturalWidth) {
			fitImage(img);
			return;
		}
		img.addEventListener(
			'load',
			() => {
				fitImage(img);
				updateCounts();
				fireChange();
				if (autosave) scheduleAutoSave();
			},
			{ once: true }
		);
	}

	function finishInsert(inserted: { img: HTMLImageElement; after: HTMLElement } | null): void {
		if (!inserted) return;
		placeCaret(inserted.after);
		selectedImage = inserted.img;
		updateCounts();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/**
	 * Insert one figure per file, in the order they were given: at `at`, the selection the dialog
	 * they were chosen in was opened on, or where the selection is.
	 */
	async function insertImageFiles(files: File[], caption = '', alt = '', at: Range | null = null): Promise<void> {
		if (files.length === 0) return;
		insertingImages = true;
		let inserted: { img: HTMLImageElement; after: HTMLElement } | null = null;

		try {
			for (const file of files) {
				try {
					const src = await fileToImageSrc(file, imageLimits());
					// (The next one goes after this one: the caret is put there.)
					restoreFor(at);
					at = null;
					editorEl?.focus();
					// A single image takes the description typed in the dialog; a batch
					// gets empty captions the user fills in under each picture.
					const isBatch = files.length > 1;
					inserted = insertFigure(
						src,
						alt || caption || stripExtension(file.name),
						isBatch ? '' : caption
					);
					if (inserted) placeCaret(inserted.after);
				} catch (err) {
					showError((err as Error).message || 'Could not insert the image');
				}
			}
		} finally {
			insertingImages = false;
		}

		finishInsert(inserted);
	}

	let errorTimer: ReturnType<typeof setTimeout> | undefined;

	function showError(message: string): void {
		importError = message;
		// Up for long enough to be read: four seconds, and longer for a message that says more
		// than one thing. An earlier message's timer must not take a later message down early.
		clearTimeout(errorTimer);
		errorTimer = setTimeout(() => (importError = ''), Math.max(4000, message.length * 50));
	}

	// ── Image selection / editing ──
	// ── Opening a link ──
	// A click in text one can edit puts the caret there, in a link as anywhere else, so that the
	// link's words can be changed: the browser follows no link in it. As in Word, a click with
	// Ctrl (Cmd on a Mac) opens the link, in a new tab, and a note at the link under the pointer
	// says so. The note is the editor's own and no part of the document.

	const ON_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
	const OPEN_HINT = ON_MAC ? '\u2318 Command-click to open link' : 'Ctrl+click to open link';
	/** Room kept for the note beside the link, so that it is not cut off at the right. */
	const HINT_WIDTH = 320;

	let linkHint: { top: number; left: number; above: boolean; href: string } | null = $state(null);
	/**
	 * Ctrl or Cmd is down: the link under the pointer shows the hand it will be opened with.
	 * (Only with the pointer at a link: the keys are down for every shortcut, and the document's
	 * element is not to change its class with each.)
	 */
	let linkArmed = $state(false);
	let hintedLink: Element | null = null;

	/** The link an event is at, where it has an address a link may have. */
	function linkAt(e: Event): Element | null {
		const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
		return link && editorEl?.contains(link) && linkTarget(link.getAttribute('href') ?? '') !== null ? link : null;
	}

	function hideLinkHint(): void {
		hintedLink = null;
		linkHint = null;
	}

	function linkHovered(e: MouseEvent): void {
		linkArmed = !readonly && (e.metaKey || e.ctrlKey);
		// (Not with a button down: the pointer is selecting text, and the note would be in its way.)
		if (readonly || copyFormat !== 'off' || e.buttons !== 0 || !contentWrapEl) return;
		const link = linkAt(e);
		if (!link || link === hintedLink) return;
		hintedLink = link;
		const wrap = contentWrapEl.getBoundingClientRect();
		// The line of the link the pointer is on: a link may run over two.
		const line = Array.from(link.getClientRects()).find((r) => e.clientY >= r.top && e.clientY <= r.bottom) ?? link.getBoundingClientRect();
		// Below the line, or above it where there is no room left in the window.
		const above = line.bottom + 64 > window.innerHeight;
		linkHint = {
			top: (above ? line.top - 6 : line.bottom + 6) - wrap.top,
			left: Math.max(0, Math.min(line.left - wrap.left, wrap.width - HINT_WIDTH)),
			above,
			href: link.getAttribute('href') ?? ''
		};
	}

	function linkLeft(e: MouseEvent): void {
		if (!hintedLink) return;
		const to = e.relatedTarget;
		if (!(to instanceof Node) || !hintedLink.contains(to)) hideLinkHint();
	}

	/** Open a link in a tab of its own, which is not handed this page. */
	function openLink(address: string): void {
		const target = linkTarget(address);
		if (target === null) return;
		const link = document.createElement('a');
		link.href = target;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.click();
	}

	/**
	 * A click on a link: with Ctrl or Cmd it is opened. Where the document cannot be edited a
	 * plain click opens it, as in the viewer, and in a new tab too: the browser would open it
	 * in this one, in place of the application. True where the click was the link's.
	 */
	function followLink(e: MouseEvent): boolean {
		const modified = e.metaKey || e.ctrlKey;
		// (Read only, a click with a key down is the browser's own: a new tab, a new window.)
		if (readonly ? modified || e.shiftKey || e.altKey : !modified) return false;
		const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
		if (!link || !editorEl?.contains(link)) return false;
		e.preventDefault();
		hideLinkHint();
		openLink(link.getAttribute('href') ?? '');
		return true;
	}

	function handleContentClick(e: MouseEvent): void {
		if (readonly) {
			followLink(e);
			return;
		}
		if (copyFormat !== 'off') {
			handleCopyFormatClick(e);
			return;
		}
		if (followLink(e)) return;
		const target = e.target as HTMLElement | null;
		selectedImage = target?.tagName === 'IMG' ? (target as HTMLImageElement) : null;
	}

	function selectionInCaption(): boolean {
		const node = window.getSelection()?.anchorNode;
		if (!node) return false;
		const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
		return !!el?.closest('figcaption');
	}

	// ── Pictures: where they are ──
	// A picture is moved up and down the document as the block it is: its figure, with its
	// caption. Two pictures side by side are a table of one row with no borders, a picture
	// and its own caption in each cell: that is what an RTF can say (a row of cells, read by
	// Word and by every other reader), and what rtfToHtml gives back. The frame around a
	// selected picture has the buttons: Move up, Move down, Place beside the picture above,
	// and, for a picture that is beside another, Place on its own line.
	const MOST_PICTURES_IN_ROW = 4;
	const PICTURE_CELL_STYLE = 'padding:2px 6px;';
	/** The padding of such a cell, left and right together, in px. */
	const PICTURE_CELL_PADDING = 12;

	/** The picture a cell holds and nothing else: its figure, or the picture itself. */
	function pictureInCell(cell: Element): HTMLElement | null {
		const held = Array.from(cell.children).filter((child) => child.tagName !== 'BR');
		if (held.length !== 1) return null;
		const unit = held[0] as HTMLElement;
		const pictures = unit.tagName === 'IMG' ? 1 : unit.tagName === 'FIGURE' ? unit.querySelectorAll('img').length : 0;
		if (pictures !== 1) return null;
		// (Words typed beside the picture make the cell an ordinary one.)
		return (cell.textContent ?? '').trim() === (unit.textContent ?? '').trim() ? unit : null;
	}

	/** The row of pictures a picture is in: a table of one row, a picture in each of its cells. */
	function pictureRowOf(node: Element | null): { table: HTMLTableElement; cells: HTMLTableCellElement[] } | null {
		const table = node?.closest('table');
		if (!table || !editorEl || table.parentElement !== editorEl || table.querySelector('table')) return null;
		if (table.rows.length !== 1 || table.querySelector('caption')) return null;
		const cells = Array.from(table.rows[0].cells);
		return cells.length > 0 && cells.every((cell) => pictureInCell(cell)) ? { table, cells } : null;
	}

	/** A block of the document that is one picture: its figure, or a paragraph that holds it alone. */
	function isPictureBlock(block: Element | null): block is HTMLElement {
		if (!(block instanceof HTMLElement) || block.parentElement !== editorEl) return false;
		if (block.tagName === 'IMG') return true;
		if (!/^(FIGURE|P|DIV)$/.test(block.tagName) || block.querySelectorAll('img').length !== 1) return false;
		const caption = block.tagName === 'FIGURE' ? block.querySelector('figcaption') : null;
		return (block.textContent ?? '').trim() === (caption?.textContent ?? '').trim();
	}

	/** What is moved when a picture is: its own block, or the row of pictures it is in. Null for a picture in a line of text. */
	function movedWith(img: HTMLImageElement | null): HTMLElement | null {
		if (!img || !editorEl?.contains(img)) return null;
		const row = pictureRowOf(img);
		if (row) return row.table;
		let block: HTMLElement = img.closest<HTMLElement>('figure') ?? img;
		while (block.parentElement && block.parentElement !== editorEl) block = block.parentElement;
		return isPictureBlock(block) ? block : null;
	}

	/** An empty line at the end of the document: where typing goes on, and nothing to move a picture past. */
	function isLastEmptyLine(el: Element | null): boolean {
		return !!el && el === editorEl?.lastElementChild && /^(P|DIV)$/.test(el.tagName) && isEmptyBlock(el as HTMLElement);
	}

	function picturePlace(): PicturePlace {
		const none: PicturePlace = { up: false, down: false, beside: null };
		const block = readonly ? null : movedWith(selectedImage);
		if (!block) return none;
		const above = block.previousElementSibling;
		const below = block.nextElementSibling;
		const inRow = block.tagName === 'TABLE';
		const joins = !inRow && !!above && (isPictureBlock(above) || (pictureRowOf(above)?.cells.length ?? MOST_PICTURES_IN_ROW) < MOST_PICTURES_IN_ROW);
		return { up: !!above, down: !!below && !isLastEmptyLine(below), beside: inRow ? 'leave' : joins ? 'join' : null };
	}

	function pictureMoved(): void {
		// A move changes the document outside an input event: earlier indent steps no longer undo.
		indentUndo = [];
		const last = editorEl?.lastElementChild;
		// Somewhere to go on typing after a picture that is now the last thing in the document.
		if (editorEl && last && (last.tagName === 'FIGURE' || last.tagName === 'TABLE')) {
			const p = document.createElement('p');
			p.appendChild(document.createElement('br'));
			editorEl.appendChild(p);
		}
		selectedImage?.scrollIntoView?.({ block: 'nearest' });
		overlayRef?.reposition();
		handleImageEdited();
	}

	/** Move the selected picture (with its caption, or the row of pictures it is in) over the block above it or below it. */
	function moveSelectedImage(direction: -1 | 1): void {
		const place = picturePlace();
		const block = movedWith(selectedImage);
		if (!block || !(direction < 0 ? place.up : place.down)) return;
		if (direction < 0) block.previousElementSibling!.before(block);
		else block.nextElementSibling!.after(block);
		pictureMoved();
	}

	/** A picture block as the figure it is put in a cell as. */
	function figureOf(block: HTMLElement): { figure: HTMLElement; align: string } {
		const align = block.style.textAlign;
		if (block.tagName === 'FIGURE') {
			// (In a cell it is the cell that is aligned, and nothing is indented or spaced.)
			block.removeAttribute('style');
			return { figure: block, align };
		}
		const figure = document.createElement('figure');
		const img = block.tagName === 'IMG' ? block : block.querySelector('img')!;
		figure.append(img, document.createElement('figcaption'));
		if (block !== img) block.remove();
		return { figure, align };
	}

	function pictureCell(block: HTMLElement): HTMLTableCellElement {
		const cell = document.createElement('td');
		const { figure, align } = figureOf(block);
		cell.appendChild(figure);
		cell.setAttribute('style', PICTURE_CELL_STYLE);
		if (align && align !== 'left') cell.style.textAlign = align;
		return cell;
	}

	/** The cells of a row of pictures share its width, and no picture is wider than its cell. */
	function fitPictureRow(cells: HTMLTableCellElement[]): void {
		const whole = contentWidth();
		cells.forEach((cell, i) => {
			const align = cell.style.textAlign;
			cell.setAttribute('style', `${PICTURE_CELL_STYLE}width:${columnShare(i, cells.length)}%`);
			if (align && align !== 'left') cell.style.textAlign = align;
			const img = cell.querySelector('img');
			const room = Math.floor(whole / cells.length) - PICTURE_CELL_PADDING;
			if (!img || room < 40) return;
			const width = parseFloat(img.style.width) || img.getBoundingClientRect().width || img.naturalWidth;
			if (width > room || !img.style.width) {
				img.removeAttribute('width');
				img.removeAttribute('height');
				img.style.width = `${Math.min(width || room, room)}px`;
				img.style.height = 'auto';
			}
		});
	}

	/** The picture of a cell back on a line of its own, where `at` is. */
	function pictureOutOfCell(cell: HTMLTableCellElement, at: Element, where: 'before' | 'after'): void {
		const unit = pictureInCell(cell);
		if (!unit) return;
		const { figure } = figureOf(unit);
		const align = cell.style.textAlign;
		if (align && align !== 'left') figure.style.textAlign = align;
		at[where](figure);
		cell.remove();
	}

	/** What is left of a row of pictures after one has gone: a narrower row, or the one picture on its own line. */
	function closeUpPictureRow(table: HTMLTableElement): void {
		const cells = Array.from(table.rows[0]?.cells ?? []);
		if (cells.length > 1) {
			fitPictureRow(cells);
			return;
		}
		if (cells.length === 1) pictureOutOfCell(cells[0], table, 'before');
		table.remove();
	}

	/**
	 * Put the selected picture beside the picture above it; or, where it is beside another,
	 * back on a line of its own, under the row it was in.
	 */
	function toggleBeside(): void {
		const place = picturePlace();
		const img = selectedImage;
		const block = movedWith(img);
		if (!img || !block || !place.beside) return;
		if (place.beside === 'leave') {
			const cell = img.closest('td, th') as HTMLTableCellElement;
			pictureOutOfCell(cell, block, 'after');
			closeUpPictureRow(block as HTMLTableElement);
		} else {
			const above = block.previousElementSibling as HTMLElement;
			let row = pictureRowOf(above)?.table.rows[0];
			if (!row) {
				const table = document.createElement('table');
				table.setAttribute('style', TABLE_STYLE);
				const body = document.createElement('tbody');
				row = document.createElement('tr');
				body.appendChild(row);
				table.appendChild(body);
				above.before(table);
				row.appendChild(pictureCell(above));
			}
			row.appendChild(pictureCell(block));
			fitPictureRow(Array.from(row.cells));
		}
		pictureMoved();
	}

	/** Width in px a picture has room for: its cell where it is one of a row of pictures, else the page. */
	function pictureRoom(): number {
		const whole = contentWidth();
		const row = selectedImage ? pictureRowOf(selectedImage) : null;
		return row ? Math.max(0, Math.floor(whole / row.cells.length) - PICTURE_CELL_PADDING) : whole;
	}

	function removeSelectedImage(): void {
		if (!selectedImage) return;
		const row = pictureRowOf(selectedImage);
		if (row) {
			// One of a row of pictures: the others close up, and a last one is on its own line again.
			selectedImage.closest('td, th')!.remove();
			selectedImage = null;
			const next = row.table.nextElementSibling as HTMLElement | null;
			closeUpPictureRow(row.table);
			indentUndo = [];
			if (next && !/^(TABLE|FIGURE)$/.test(next.tagName)) placeCaret(next);
			updateCounts();
			fireChange();
			if (autosave) scheduleAutoSave();
			return;
		}
		const figure = selectedImage.closest('figure');
		const next = (figure ?? selectedImage).nextElementSibling as HTMLElement | null;
		(figure ?? selectedImage).remove();
		selectedImage = null;
		if (next) placeCaret(next);
		updateCounts();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	/** Put the caret in the image's description line, creating it if needed. */
	function focusCaption(img: HTMLImageElement): void {
		let figure = img.closest('figure');
		// One of a row of pictures that had no caption is read back as the picture alone in
		// its cell: it is a figure again when it is given one.
		const cell = img.parentElement;
		if (!figure && cell && /^(TD|TH)$/.test(cell.tagName) && pictureInCell(cell) === img) {
			figure = document.createElement('figure');
			img.before(figure);
			figure.appendChild(img);
		}
		if (!figure) return;
		let caption = figure.querySelector('figcaption');
		if (!caption) {
			caption = document.createElement('figcaption');
			figure.appendChild(caption);
		}
		editorEl?.focus();
		placeCaret(caption as HTMLElement, false);
	}

	function handleImageEdited(): void {
		updateCounts();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	function handleDragOver(e: DragEvent): void {
		if (readonly) return;
		if (Array.from(e.dataTransfer?.types || []).includes('Files')) e.preventDefault();
	}

	function handleDrop(e: DragEvent): void {
		if (readonly) return;
		const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
		if (files.length === 0) {
			// Text or markup dragged in, from another page or from further up this one. The
			// browser puts it in the document itself, as it does a paste, and the input event
			// that follows makes it safe the same way. (Only a paste was: what was dragged in
			// stayed as the browser left it, with a block drawn over the whole page, a form
			// that sends what is typed in it somewhere else, a frame showing another site.)
			expectInsertion(draggedFromHere);
			// What the browser may lose of it, as of a paste: it begins where it is dropped.
			const dropped = e.dataTransfer?.getData?.('text/html') ?? '';
			pastedPictures = pastePictures(dropped, e.dataTransfer?.getData?.('text/rtf') ?? '');
			const notes = pasteNotes(dropped);
			const at = notes ? rangeAtPoint(e.clientX, e.clientY) : null;
			pastedLoss = notes && at && editorEl?.contains(at.startContainer) ? { notes, from: shownCharsBefore(at.startContainer, at.startOffset), dropped: true } : null;
			// What holds a frame is put in here, made safe and without it (see pasteWithoutFrames).
			const unframed = pasteWithoutFrames(dropped, keptNames);
			if (unframed !== null) {
				e.preventDefault();
				editorEl?.focus();
				placeCaretAtPoint(e.clientX, e.clientY);
				document.execCommand('insertHTML', false, unframed);
			}
			return;
		}
		e.preventDefault();
		editorEl?.focus();
		placeCaretAtPoint(e.clientX, e.clientY);
		void insertImageFiles(files);
	}

	/** The place in the text under the pointer. */
	function rangeAtPoint(x: number, y: number): Range | null {
		const doc = document as Document & {
			caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};

		let range: Range | null = null;
		if (typeof doc.caretPositionFromPoint === 'function') {
			const pos = doc.caretPositionFromPoint(x, y);
			if (pos) {
				range = document.createRange();
				range.setStart(pos.offsetNode, pos.offset);
				range.collapse(true);
			}
		} else if (typeof doc.caretRangeFromPoint === 'function') {
			range = doc.caretRangeFromPoint(x, y);
		}
		return range;
	}

	/** Move the caret under the pointer so a dropped image lands where it was dropped. */
	function placeCaretAtPoint(x: number, y: number): void {
		const range = rangeAtPoint(x, y);
		if (!range || !editorEl?.contains(range.startContainer)) return;
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		savedSelection = range.cloneRange();
	}

	// ── Import RTF ──
	async function handleFileImport(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		importError = '';
		importing = true;

		try {
			const html = await readRtfFile(file, { fontSize, fontFamily, fonts, maxBytes: maxRtfBytes });
			if (editorEl) {
				selectedImage = null;
				documentReplaced();
				// (What the reader writes is safe as it stands; it goes the same way as any other
				// HTML so there is one way in.)
				const shown = showDocument(html);
				updateCounts();
				// (Shown or not, the document before it is gone, and the application is told so.)
				fireChange();
				if (!shown) {
					dropDraft();
					throw new Error(NOT_SHOWN);
				}
				if (autosave) scheduleAutoSave();
				onimport?.({ html });
			}
		} catch (err) {
			showError((err as Error).message || 'Failed to import RTF file');
		} finally {
			importing = false;
			if (fileInputEl) fileInputEl.value = '';
		}
	}

	// ── Keyboard shortcuts ──
	function handleKeydown(e: KeyboardEvent): void {
		// Escape puts the Copy format brush down, and does nothing else that press.
		if (copyFormat !== 'off' && e.key === 'Escape') {
			e.preventDefault();
			stopCopyFormat();
			return;
		}
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === 'b') { e.preventDefault(); exec('bold'); }
		if (mod && e.key === 'i') { e.preventDefault(); exec('italic'); }
		if (mod && e.key === 'u') { e.preventDefault(); exec('underline'); }
		if (mod && e.key === 'k') { e.preventDefault(); openLinkModal(); }
		if (mod && e.key === 's') { e.preventDefault(); saveNow(); }
		if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && (undoIndent() || undoClear())) { e.preventDefault(); return; }
		// (Redo is Ctrl+Y as well, but not Cmd+Y.)
		const redoKey = (e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'y');
		if (mod && redoKey && redoClear()) { e.preventDefault(); return; }
		if (mod && e.key === ']') { e.preventDefault(); indentBlocks('indent'); return; }
		if (mod && e.key === '[') { e.preventDefault(); indentBlocks('outdent'); return; }

		// Moving the caret leaves the picture behind, so drop its selection frame.
		// Deliberately falls through: these keys still have their normal meaning,
		// including Tab inside a <pre> below.
		if (selectedImage && (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Escape' ||
			e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown')) {
			selectedImage = null;
		}

		// Backspace/Delete removes a selected image — but not while the caret is
		// in its description, where those keys must edit text as usual.
		if (selectedImage && !selectionInCaption() && (e.key === 'Backspace' || e.key === 'Delete')) {
			e.preventDefault();
			removeSelectedImage();
			return;
		}

		if (e.key === 'Tab') handleTab(e);
		else tabLeavesEditor = e.key === 'Escape';
	}

	// ── Tab ──
	// Tab types a tab, as in a word processor, so a pathologist can indent a line; before this it
	// left the editor for the next control on the page. Escape, then Tab or Shift+Tab, still moves
	// focus on, so the keyboard is never trapped here. A readonly editor keeps the browser's Tab.
	let tabLeavesEditor = false;

	function handleTab(e: KeyboardEvent): void {
		if (readonly || e.ctrlKey || e.metaKey || e.altKey) return;
		if (tabLeavesEditor) {
			tabLeavesEditor = false;
			return;
		}
		const sel = window.getSelection();
		if (!sel || !sel.anchorNode || !editorEl?.contains(sel.anchorNode)) return;
		e.preventDefault();

		if (sel.anchorNode.parentElement?.closest?.('pre')) {
			if (!e.shiftKey) document.execCommand('insertText', false, '  ');
			return;
		}
		// Several lines selected: Tab and Shift+Tab indent and outdent them all, as a word
		// processor does. Within one line, Tab types a tab.
		if (selectionSpansLines(sel)) {
			indentBlocks(e.shiftKey ? 'outdent' : 'indent');
			return;
		}
		if (!e.shiftKey) {
			insertTab(sel);
			return;
		}
		// Shift+Tab takes one tab off the start of the line the caret is on, wherever the caret is
		// on it, as a word processor outdents.
		if (sel.isCollapsed) removeLeadingTab(sel);
	}

	/**
	 * Type a tab, on the undo stack. Chromium and WebKit wrap it in <span style="white-space:pre">,
	 * which the RTF writer sends as \tab. Firefox types spaces instead, so there the typing is
	 * undone and the same span is inserted, with the caret put after it so the text that follows
	 * is not typed inside it.
	 */
	function insertTab(sel: Selection): void {
		document.execCommand('insertText', false, '\t');
		if (textBeforeCaret(sel).endsWith('\t')) return;
		document.execCommand('undo');
		document.execCommand('insertHTML', false, '<span style="white-space:pre">\t</span>');
		const node = sel.anchorNode;
		const span = (node instanceof Element ? node : node?.parentElement)?.closest('span');
		if (span && span.textContent === '\t' && editorEl?.contains(span)) {
			const after = document.createRange();
			after.setStartAfter(span);
			after.collapse(true);
			sel.removeAllRanges();
			sel.addRange(after);
		}
	}

	function textBeforeCaret(sel: Selection): string {
		if (!editorEl || sel.rangeCount === 0) return '';
		const range = sel.getRangeAt(0).cloneRange();
		range.collapse(true);
		range.setStart(editorEl, 0);
		return range.toString();
	}

	/** Whether a selection runs across more than one paragraph or line. */
	function selectionSpansLines(sel: Selection): boolean {
		if (sel.isCollapsed || sel.rangeCount === 0 || !editorEl) return false;
		const range = sel.getRangeAt(0);
		const blockOf = (n: Node) =>
			(n instanceof Element ? n : n.parentElement)?.closest(LINE_BLOCKS) ?? editorEl;
		if (blockOf(range.startContainer) !== blockOf(range.endContainer)) return true;
		return range.cloneContents().querySelector('br') !== null;
	}

	const LINE_BLOCKS = 'p, div, li, td, th, h1, h2, h3, h4, h5, h6, blockquote';

	/** The first tab of the caret's line, if the line starts with one: its text node and offset. */
	function leadingTab(sel: Selection): { node: Text; offset: number } | null {
		if (!editorEl || !sel.anchorNode) return null;
		const anchorEl = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
		const found = anchorEl?.closest(LINE_BLOCKS);
		const block = found && editorEl.contains(found) && found !== editorEl ? found : editorEl;
		const caret = sel.getRangeAt(0);

		// Walk the block's text and line breaks up to the caret. A <br>, or text in a different
		// block from the text before it, starts a new line.
		const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
		let lineStart: { node: Text; offset: number } | null = null;
		let lineHasText = false;
		let lastBlock: Element | null = null;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			if (caret.comparePoint(n, 0) > 0) break;
			if (n.nodeName === 'BR') {
				lineStart = null;
				lineHasText = false;
				continue;
			}
			if (n.nodeType !== Node.TEXT_NODE) continue;
			const textBlock = n.parentElement?.closest(LINE_BLOCKS) ?? block;
			if (textBlock !== lastBlock) {
				lastBlock = textBlock;
				lineStart = null;
				lineHasText = false;
			}
			if (!lineHasText) {
				const text = (n as Text).data;
				if (text.length === 0) continue;
				lineHasText = true;
				lineStart = text[0] === '\t' ? { node: n as Text, offset: 0 } : null;
			}
		}
		return lineStart;
	}

	function removeLeadingTab(sel: Selection): void {
		const tab = leadingTab(sel);
		if (!tab) return;
		const caret = sel.getRangeAt(0).cloneRange();
		const range = document.createRange();
		range.setStart(tab.node, tab.offset);
		range.setEnd(tab.node, tab.offset + 1);
		// Delete through execCommand so Ctrl+Z puts the tab back, then return the caret.
		sel.removeAllRanges();
		sel.addRange(range);
		document.execCommand('delete');
		if (caret.startContainer.isConnected) {
			sel.removeAllRanges();
			sel.addRange(caret);
		}
	}

	function handlePaste(e: ClipboardEvent): void {
		// clipboardData is only valid during the event — pull the files out first.
		const files = Array.from(e.clipboardData?.items || [])
			.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);

		// A picture that comes with words is a picture of those words: Word copies its text
		// that way, and Chromium hands over both. The words are what is pasted. (The picture was:
		// text copied in Word went in as a picture of it, which cannot be edited, and Word's
		// hidden text with it, unseen. Safari hands over no picture, and pasted the words.)
		const html = e.clipboardData?.getData('text/html') ?? '';
		if (files.length > 0 && !readonly && !pasteHasWords(html)) {
			e.preventDefault();
			void insertImageFiles(files);
			return;
		}

		const sel = window.getSelection();
		if (sel?.anchorNode?.parentElement?.closest?.('pre')) {
			e.preventDefault();
			const text = e.clipboardData?.getData('text/plain') || '';
			document.execCommand('insertText', false, text);
			return;
		}
		// The browser pastes next; the input event that follows tidies what came in.
		if (!readonly && editorEl) {
			expectInsertion();
			// What the browser's paste may lose (see pasteNotes), and where the paste begins.
			const notes = pasteNotes(html);
			const start = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
			pastedLoss =
				notes && start && editorEl.contains(start.startContainer)
					? { notes, from: shownCharsBefore(start.startContainer, start.startOffset) }
					: null;
			// The pictures Word's HTML only names, from its RTF (see pastePictures).
			pastedPictures = pastePictures(html, e.clipboardData?.getData('text/rtf') ?? '');
			// What holds a frame is put in here, made safe and without it (see pasteWithoutFrames).
			const unframed = pasteWithoutFrames(html, keptNames);
			if (unframed !== null) {
				e.preventDefault();
				document.execCommand('insertHTML', false, unframed);
			}
		}
	}

	/**
	 * The browser is about to put something in the document itself, a paste or a drop: remember
	 * which elements are there now, so that the input event that follows knows what came in.
	 * `own` says it was picked up in this document.
	 */
	function expectInsertion(own = false): void {
		if (readonly || !editorEl) return;
		const snapshot = new Set(editorEl.querySelectorAll('*'));
		pastedOver = snapshot;
		pastedOwn = own;
		pastedLoss = null;
		pastedPictures = null;
		commentsBefore = new Set(commentsIn(editorEl));
		// A paste that inserts nothing (an empty clipboard, a host that cancels it) raises no
		// input event. Left set, the snapshot would make the next keystroke treat the whole
		// document as pasted.
		setTimeout(() => {
			if (pastedOver === snapshot) {
				pastedOver = null;
				pastedLoss = null;
				pastedPictures = null;
				commentsBefore = null;
			}
		}, 0);
	}

	/** How many characters that are not white space the document has before a place in it. */
	function shownCharsBefore(node: Node, offset: number): number {
		if (!editorEl) return 0;
		const range = document.createRange();
		range.selectNodeContents(editorEl);
		range.setEnd(node, offset);
		return range.toString().replace(/\s/g, '').length;
	}

	/**
	 * Set right what the browser's paste changed before it could be looked at: Word's hidden
	 * text shown as text, and a text box left empty.
	 */
	function restorePasteLoss(before: Set<Element>, loss: { notes: PasteNotes; from: number; dropped?: boolean }): void {
		if (!editorEl) return;
		const areas = Array.from(editorEl.querySelectorAll('textarea')).filter((area) => !before.has(area));
		if (areas.length === loss.notes.textareas.length) {
			areas.forEach((area, i) => {
				if (area.value === '') area.textContent = loss.notes.textareas[i];
			});
		}
		// After a paste the caret is at its end. After a drop what was dropped may be selected
		// instead, and then it is known exactly where it begins as well.
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !editorEl.contains(sel.anchorNode) || !editorEl.contains(sel.focusNode)) return;
		if (!sel.isCollapsed && !loss.dropped) return;
		const range = sel.getRangeAt(0);
		let from = sel.isCollapsed ? loss.from : shownCharsBefore(range.startContainer, range.startOffset);
		let to = shownCharsBefore(range.endContainer, range.endOffset);
		const came = new Set(Array.from(editorEl.querySelectorAll('*')).filter((el) => !before.has(el)));
		// Firefox leaves the caret before a whole page it has pasted (a copy made in Word, with
		// its <head>), not after it. The paste is then the elements that came in, from the
		// first to the end of the last. (Text that is not the paste's own, to the character,
		// is left alone as ever: see removeWordHidden.)
		if (sel.isCollapsed && to <= from && came.size > 0) {
			const outer = Array.from(came).filter((el) => el.parentElement && !came.has(el.parentElement));
			const index = (el: Element) => Array.prototype.indexOf.call(el.parentNode!.childNodes, el);
			from = Math.min(...outer.map((el) => shownCharsBefore(el.parentNode!, index(el))));
			to = Math.max(...outer.map((el) => shownCharsBefore(el.parentNode!, index(el) + 1)));
		}
		if (takeHidden(from, to, loss.notes, (el) => came.has(el))) {
			hiddenTaken.push({ notes: loss.notes, from, came, emptied: Array.from(came).filter((el) => !el.isConnected) });
		}
	}

	/**
	 * Take Word's hidden text out of the paste that is the text from the `from`th to the `to`th
	 * character shown, or with null for `to`, the paste Redo has put back from the `from`th on
	 * (see removeWordHidden). Returns whether anything was taken out.
	 */
	/** Word's mark on text it hides, as a paste carries it in a style. */
	const WORD_HIDES = /mso-hide\s*:\s*all/i;

	function takeHidden(from: number, to: number | null, notes: PasteNotes, came: (el: Element) => boolean): boolean {
		if (!editorEl) return false;
		// A pasted element left with nothing in it goes, but not the one the caret is in: that
		// one becomes an empty line, to type in. (Taken out as well, a paste of hidden text
		// alone left the caret in no line at all, and the next words typed were in none.)
		const sel = window.getSelection();
		const at = sel && sel.rangeCount > 0 && editorEl.contains(sel.anchorNode) ? sel.anchorNode : null;
		let held = at instanceof Element ? at : (at?.parentElement ?? null);
		// Firefox pastes Word's hidden text as an element that is not displayed, and leaves the
		// caret inside it: what was typed next was typed where it is not seen, and what is not
		// seen is not written. The caret is put before a hidden piece of a line, which then
		// goes with its text; a hidden paragraph the caret is in becomes the empty line, shown.
		let unseen: HTMLElement | null = null;
		for (let el = held; el && el !== editorEl; el = el.parentElement) {
			// (Word's own mark is still on it as the style it came with: the browser knows no
			// such property, and what came in has not been made safe yet.)
			const hidden = el instanceof HTMLElement && (WORD_HIDES.test(el.getAttribute('style') ?? '') || el.style.display === 'none' || el.style.visibility === 'hidden' || el.hasAttribute('hidden'));
			if (hidden && came(el)) unseen = el as HTMLElement;
		}
		if (unseen && sel) {
			if (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TD|TH)$/.test(unseen.tagName)) {
				unseen.setAttribute('style', (unseen.getAttribute('style') ?? '').replace(new RegExp(`${WORD_HIDES.source}\\s*;?`, 'gi'), ''));
				unseen.style.removeProperty('display');
				unseen.style.removeProperty('visibility');
				unseen.removeAttribute('hidden');
				if (!unseen.getAttribute('style')?.trim()) unseen.removeAttribute('style');
			} else {
				const before = document.createRange();
				before.setStartBefore(unseen);
				before.collapse(true);
				sel.removeAllRanges();
				sel.addRange(before);
				held = unseen.parentElement;
			}
		}
		if (!removeWordHidden(editorEl, from, to, notes, (el) => came(el) && !(held !== null && el.contains(held)))) return false;
		if (held && held !== editorEl && held.isConnected && held.childNodes.length === 0) held.appendChild(document.createElement('br'));
		return true;
	}

	// ── Pasted formatting ──
	// A browser copies a paragraph with its looks written out: Chromium turns the editor's own
	// spacing into "margin: 0px 0px 0.2em 96px" on the copy, and repeats the id. Pasted back, the
	// copy looked the same until the writer or a later edit met those extra values, and two
	// elements shared one id. After a paste, each element that came in loses its id, and loses any
	// margin or first-line indent that changes nothing: one the editor's own style already gives,
	// or one on a piece of text inside a line, where neither has an effect.
	const PASTED_SPACING = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'text-indent'];
	/** The elements in the editor just before a paste; what is not in it came from the paste. */
	let pastedOver: Set<Element> | null = null;
	/** Whether what is coming in was picked up in this document, and dragged to another place in it. */
	let pastedOwn = false;
	/** Whether what is being dragged now was picked up in this document. */
	let draggedFromHere = false;
	/**
	 * Every element a paste or a drop has brought in, with the style it was left with when it
	 * was tidied, and whether it was the document's own (see pastedOwn). Redo writes back on
	 * these the style the browser first gave them, with the margins that were taken off: an
	 * element whose style is another by then is tidied again.
	 * (Held, not looked up in a WeakMap, for the reason given at wordsLeft.)
	 */
	const broughtIn = new Map<Element, { style: string | null; own: boolean }>();
	/** What the paste or the drop under way may lose, and how much text the document had before it. */
	let pastedLoss: { notes: PasteNotes; from: number; dropped?: boolean } | null = null;
	/** The pictures of the paste that is coming in, where its HTML only names them (see pastePictures). */
	let pastedPictures: PastePictures | null = null;

	// ── Comments that come in ──
	// HTML copied in another program may hold comments. What is in one is not shown and not
	// written to the RTF, but it is kept in the HTML that is saved, and Word writes in one the
	// address of each copied picture: a file on the writer's own disk, with the name of the
	// writer's account in it. A browser leaves comments out of a paste; Firefox keeps those of
	// markup that is dropped. So a comment that comes in is emptied. It is not taken out: Firefox
	// cannot undo a drop from which a node is gone, and an empty comment says nothing. Those the
	// application's own HTML has are not the editor's to judge, and stay as they are.
	/** The comments in the document just before a paste or a drop; what is not among them came with it. */
	let commentsBefore: Set<Comment> | null = null;

	function commentsIn(root: Node): Comment[] {
		const found: Comment[] = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) found.push(node as Comment);
		return found;
	}

	/**
	 * Take off the elements `came` accepts, the ones a paste or a drop brought in, their id and
	 * the margins and first-line indents that change nothing (see above). One `own` accepts was
	 * moved from another place in this document, and keeps its id unless another element has it
	 * too. (Moved words lost theirs like pasted ones, though the id was in the document once,
	 * as before: an application that marks elements with ids lost its marks to a drag.)
	 */
	function tidySpacing(came: (el: Element) => boolean, own: (el: Element) => boolean = () => false): void {
		if (!editorEl) return;
		const all = Array.from(editorEl.querySelectorAll<HTMLElement>('*'));
		const timesUsed = new Map<string, number>();
		for (const el of all) if (el.id) timesUsed.set(el.id, (timesUsed.get(el.id) ?? 0) + 1);
		for (const el of all) {
			if (!came(el)) continue;
			const isOwn = own(el);
			if (el.hasAttribute('id') && !(isOwn && timesUsed.get(el.id) === 1)) {
				timesUsed.set(el.id, (timesUsed.get(el.id) ?? 1) - 1);
				el.removeAttribute('id');
			}
			tidyStyle(el);
			broughtIn.set(el, { style: el.getAttribute('style'), own: isOwn });
		}
	}

	/** Take off one element the margins and the first-line indent that change nothing. */
	function tidyStyle(el: HTMLElement): void {
		if (!el.getAttribute('style')) return;
		const inline = !el.matches(`${INDENT_TARGETS}, li, table, thead, tbody, tfoot, tr, td, th, figcaption, hr`);
		for (const prop of PASTED_SPACING) {
			const value = el.style.getPropertyValue(prop);
			if (!value) continue;
			const shown = getComputedStyle(el).getPropertyValue(prop);
			el.style.removeProperty(prop);
			if (!inline && getComputedStyle(el).getPropertyValue(prop) !== shown) el.style.setProperty(prop, value);
		}
		if (!el.getAttribute('style')) el.removeAttribute('style');
	}

	function tidyPasted(before: Set<Element>): void {
		if (!editorEl) return;
		// Firefox pastes the <style> of a copied page into the document with its words. It is
		// taken out below with all that is not safe; here first, because its rules count as text
		// of the paste, and Word's hidden words are found by the paste's text, to the character:
		// with a style sheet among them they were not found, and stayed in the document, unseen.
		for (const el of Array.from(editorEl.querySelectorAll('style, script, template, title'))) {
			if (!before.has(el)) el.remove();
		}
		if (commentsBefore) {
			for (const comment of commentsIn(editorEl)) {
				if (!commentsBefore.has(comment) && comment.data !== '') comment.data = '';
			}
		}
		commentsBefore = null;
		if (pastedLoss) restorePasteLoss(before, pastedLoss);
		pastedLoss = null;
		// Before what came in is made safe: an image that names a file on a disk loses that
		// address there, and is then an image of nothing.
		if (pastedPictures) {
			givePastedPictures(
				Array.from(editorEl.querySelectorAll('img')).filter((img) => !before.has(img)),
				pastedPictures
			);
		}
		pastedPictures = null;
		// What the paste brought is made safe as HTML from anywhere else is: a browser takes the
		// scripts out of a paste itself, but leaves a form, an <iframe>, or a block with
		// position: fixed that covers the page.
		// (And if it cannot be made safe, none of it stays.)
		const came = (el: Element) => !before.has(el);
		const own = pastedOwn;
		pastedOwn = false;
		leftNow = [];
		const safe = makeSafe(came);
		const left = leftNow;
		leftNow = null;
		if (!safe) {
			showError(LEFT_OUT);
			return;
		}
		tidySpacing(came, () => own);
		if (left.length > 0) {
			const stayed = Array.from(editorEl.querySelectorAll('*')).filter(came);
			if (stayed.length > 0) pastesWithWords.push({ stayed, left, there: true });
		}
		// A picture copied with its text comes in by address (<img src="https://…">), or as data in
		// a format the RTF cannot carry (GIF, WebP, SVG) or larger than maxImageBytes. Only PNG or
		// JPEG data held in the document reaches the RTF, so each one goes through the same step as
		// the image dialog: fetched, converted and scaled as needed.
		const pasted = Array.from(editorEl.querySelectorAll('img')).filter((img) => !before.has(img));
		if (pasted.length === 0) return;
		// A browser pasting a block into an empty line puts the block in the line's place. If the
		// pictures of the paste are then taken out, that line is put back (removePastedImages).
		const replaced = Array.from(before).find(
			(el) => !el.isConnected && el.parentNode === null && el.matches('p, div') && showsNothing(el)
		);
		void embedPastedImages(pasted, before, replaced ?? null);
	}

	/**
	 * Fetch each pasted picture and hold its data in the document. One that cannot be fetched
	 * (the site forbids it, or there is no network) still shows, but leaves in the RTF as an
	 * "[Image: …]" placeholder: the editor says so now, rather than letting it be found downstream.
	 * `before` is what was in the document before the paste, and `replaced` an empty line of it
	 * whose place the paste took.
	 */
	async function embedPastedImages(images: HTMLImageElement[], before: Set<Element>, replaced: Element | null): Promise<void> {
		let failed = 0;
		let changed = false;
		// Pictures that must not stay: pasted picture data over the size limit that could not be
		// reduced, which left in the document would be written to the RTF at its full size, and
		// picture data the browser cannot open, which would show as a broken picture.
		const leftOut = new Map<HTMLImageElement, 'tooLarge' | 'unreadable'>();
		const embed = async (img: HTMLImageElement): Promise<void> => {
			const url = img.getAttribute('src') || '';
			if (!isSafeImageUrl(url)) {
				failed++;
				return;
			}
			const { src, embedded, tooLarge, unreadable } = await urlToImageSrc(url, imageLimits());
			// It may have been deleted or replaced while it was fetched.
			if (!img.isConnected || img.getAttribute('src') !== url) return;
			if (tooLarge || unreadable) {
				leftOut.set(img, tooLarge ? 'tooLarge' : 'unreadable');
			} else if (!embedded) {
				failed++;
			} else if (src !== url) {
				img.setAttribute('src', src);
				changed = true;
			}
		};
		/** What to say of the pictures left out so far; they are taken out as this is asked. */
		const takeOut = (): string[] => {
			const gone = images.filter((img) => leftOut.has(img) && img.isConnected);
			if (gone.length > 0) {
				removePastedImages(gone, before, replaced);
				updateCounts();
				fireChange();
				if (autosave) scheduleAutoSave();
			}
			const count = (kind: 'tooLarge' | 'unreadable') => Array.from(leftOut.values()).filter((k) => k === kind).length;
			const tooLarge = count('tooLarge');
			const unreadable = count('unreadable');
			const said: string[] = [];
			if (tooLarge > 0) {
				said.push(
					tooLarge === 1
						? 'A pasted picture was over the size limit and could not be made smaller, so it was left out'
						: `${tooLarge} pasted pictures were over the size limit and could not be made smaller, so they were left out`
				);
			}
			if (unreadable > 0) {
				said.push(
					unreadable === 1
						? 'A pasted picture could not be opened (the browser cannot show its format, or it is damaged), so it was left out'
						: `${unreadable} pasted pictures could not be opened (the browser cannot show their format, or they are damaged), so they were left out`
				);
			}
			return said;
		};

		// All at once, each with its own timeout, so one slow site does not hold up the rest.
		const isData = (img: HTMLImageElement) => /^\s*data:/i.test(img.getAttribute('src') || '');
		const fetched = images.filter((img) => !isData(img)).map(embed);
		// Picture data needs no network. Once all of it is settled, what has to go is taken out
		// in one pass in the order of the document, without waiting for a slow site: in the
		// order each happened to finish, what is left of a figure would depend on chance.
		await Promise.all(images.filter(isData).map(embed));
		const saidFirst = takeOut();
		if (saidFirst.length > 0) showError(saidFirst.join('. '));

		await Promise.all(fetched);
		// One paste can do all of it, and each is something the user has to know: a picture that
		// is gone, and a picture that is there but will leave as a placeholder. So what was said
		// of the first is said again with the second, not replaced by it.
		const said = takeOut();
		if (failed > 0) {
			said.push(
				failed === 1
					? 'A pasted image could not be embedded — it will export as a placeholder'
					: `${failed} pasted images could not be embedded — they will export as placeholders`
			);
		}
		if (failed > 0 || said.length > saidFirst.length) showError(said.join('. '));
		if (changed) {
			updateCounts();
			fireChange();
			if (autosave) scheduleAutoSave();
		}
	}

	/** Things that show without holding any text; an element with one of these is not empty. */
	const SHOWN_WITHOUT_TEXT = 'img, table, hr, svg, video, audio, canvas, iframe, object, embed, input, select, textarea, button, math';

	/** Whether an element shows nothing. A figure's caption does not count: it describes the picture. */
	function showsNothing(el: Element): boolean {
		let check = el;
		if (el.tagName === 'FIGURE') {
			check = el.cloneNode(true) as Element;
			for (const caption of Array.from(check.querySelectorAll('figcaption'))) caption.remove();
		}
		return !check.querySelector(SHOWN_WITHOUT_TEXT) && (check.textContent || '').trim().length === 0;
	}

	/**
	 * The next thing shown after a node (`forward`) or before it, in or beyond what it ends or
	 * starts: an element or some text. Not a line break, a comment or white space.
	 */
	function shownBeside(node: Node, root: Element, forward: boolean): Node | null {
		for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
			for (let near = forward ? at.nextSibling : at.previousSibling; near; near = forward ? near.nextSibling : near.previousSibling) {
				if (near.nodeType === Node.ELEMENT_NODE ? (near as Element).tagName !== 'BR' : near.nodeType === Node.TEXT_NODE && (near.textContent || '').trim()) {
					return near;
				}
			}
		}
		return null;
	}

	/**
	 * Whether this is a figure holding a caption and nothing else, or a wrapper around such a
	 * figure and nothing else (a <div>, a <section>, a link).
	 */
	function isCaptionAlone(el: Element): boolean {
		const figure = el.tagName === 'FIGURE' ? el : el.querySelector('figure');
		if (!figure || !figure.querySelector('figcaption') || !showsNothing(figure)) return false;
		if (figure === el) return true;
		const rest = el.cloneNode(true) as Element;
		rest.querySelector('figure')?.remove();
		return showsNothing(rest);
	}

	/** Lines of text: an empty one that was in the document before the paste stays a line. */
	const LINES = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre';

	/**
	 * Take pasted pictures out of the document, each with everything that was only there for it:
	 * its figure and caption, a link around it, a paragraph or list item that held nothing else.
	 * Left behind, the caption of a picture that is not there and an empty paragraph went into the
	 * RTF. Text that shared a paragraph with a picture stays, and so does whatever was in the
	 * document before the paste; a table cell stays, since the table needs it. `replaced` is an
	 * empty line whose place the paste took: if nothing of the paste is left, it is put back.
	 */
	function removePastedImages(images: HTMLImageElement[], before: Set<Element>, replaced: Element | null): void {
		if (!editorEl) return;
		const root = editorEl;
		const selection = window.getSelection();
		const caret = selection?.anchorNode && root.contains(selection.anchorNode) ? selection.anchorNode : null;
		// Holds the caret's place once what the caret was in has gone. (Written this way so the
		// type checker does not take it to be null for good: it is set inside `take`.)
		let place = null as Comment | null;
		// Holds the place of the first thing taken out, for the line the paste took the place of.
		let first = null as Comment | null;
		// What is put in here, as opposed to what the paste brought.
		const made = new Set<Element>();
		const take = (node: Element): void => {
			if (place ? node.contains(place) : !!caret && node.contains(caret)) {
				place ??= document.createComment('');
				node.after(place);
			}
			if (first && node.contains(first)) node.after(first);
			node.remove();
		};
		/** Take a node out, and after it each thing around it that came with the paste and now shows nothing. */
		const takeWithEmptied = (start: Element): void => {
			let node = start;
			let parent: Element | null;
			let next: Node | null;
			for (;;) {
				parent = node.parentElement;
				next = node.nextSibling;
				take(node);
				if (!parent || parent === root || before.has(parent) || parent.matches('td, th')) break;
				if (!showsNothing(parent)) break;
				node = parent;
			}
			if (!parent) return;
			if (!first) {
				first = document.createComment('');
				parent.insertBefore(first, next);
			}
			// A line that was in the document before the paste and is empty again stays a line.
			if (parent !== root && before.has(parent) && parent.matches(LINES) && showsNothing(parent) && !parent.querySelector('br')) {
				const lineBreak = document.createElement('br');
				made.add(lineBreak);
				parent.appendChild(lineBreak);
			}
		};
		const pastedPicture = (node: Node | null) =>
			node instanceof Element && node.isConnected && !before.has(node) && (node.tagName === 'IMG' || node.querySelector('img') !== null);

		for (const img of images) {
			if (!img.isConnected) continue;
			// The overlay and the Backspace key act on the selected picture: not on one that is gone.
			if (selectedImage === img) selectedImage = null;
			const after = shownBeside(img, root, true);
			const prior = shownBeside(img, root, false);
			takeWithEmptied(img);

			// Chromium, pasting a figure at the end of a line of text, moves its pictures into that
			// line and leaves the figure after them with the caption alone (inside the wrapper the
			// figure came in, if it had one). A pasted caption alone, straight after the picture, is
			// that picture's, and goes with it, unless another picture pasted with it is still
			// there before it: the caption is then that one's too.
			if (after instanceof Element && after.isConnected && !before.has(after) && isCaptionAlone(after) && !pastedPicture(prior)) {
				takeWithEmptied(after);
			}
		}

		// The paste took the place of an empty line, and nothing of the paste that shows is
		// left: the line is put back where the paste stood, as if nothing had been pasted.
		let line: HTMLElement | null = null;
		const holder = (first as Comment | null)?.parentElement ?? null;
		if (replaced && !replaced.isConnected && holder && !holder.matches('ul, ol, table, thead, tbody, tfoot, tr')) {
			const left = Array.from(root.querySelectorAll('*')).some((el) => !before.has(el) && !made.has(el) && !showsNothing(el));
			if (!left) {
				line = replaced as HTMLElement;
				// (Chromium takes the line's own line break out before it takes the line out.)
				if (!line.querySelector('br')) line.appendChild(document.createElement('br'));
				first!.before(line);
			}
		}
		first?.remove();

		// The caret goes back into the line that was put back: it was there when the paste was made.
		if (line && caret) {
			placeCaret(line);
			place?.remove();
			return;
		}

		// The caret went with what was removed: put it where typing carries on from.
		if (place?.isConnected) {
			const textBlock = (el: Element | null) => (el && !el.matches(`figure, ${SHOWN_WITHOUT_TEXT}`) ? (el as HTMLElement) : null);
			const previous = textBlock(place.previousElementSibling);
			const next = textBlock(place.nextElementSibling);
			if (place.parentElement && place.parentElement !== root) {
				// Inside something that stays (a line of text, a table cell): where it was.
				const range = document.createRange();
				range.setStartBefore(place);
				range.collapse(true);
				selection?.removeAllRanges();
				selection?.addRange(range);
				savedSelection = range.cloneRange();
			} else if (previous) {
				placeCaret(previous, false);
			} else if (next) {
				placeCaret(next, true);
			} else {
				// Nothing to type in next to it (the document is empty, or a table or another
				// picture is all there is): leave one empty line.
				const empty = document.createElement('p');
				empty.appendChild(document.createElement('br'));
				place.before(empty);
				placeCaret(empty);
			}
		}
		place?.remove();
	}


	// ── Lifecycle ──
	onMount(() => {
		if (!editorEl) return;
		document.addEventListener('selectionchange', trackSelection);
		const stopTracking = () => document.removeEventListener('selectionchange', trackSelection);
		if (autosave) {
			let saved: string | null = null;
			try {
				saved = localStorage.getItem(storageKey);
			} catch (e) {}
			if (saved) {
				// A draft is HTML from outside like any other: anything that can write to this
				// origin's storage can write it.
				if (showDocument(saved)) {
					updateCounts();
					return stopTracking;
				}
				// (A draft that cannot be shown was dropped without a word; it is said now, and
				// the content given is shown in its place.)
				showError('The draft kept in this browser could not be shown');
			}
		}
		// Always write the initial content prop so the div isn't empty.
		// {#html content} must NOT be used inside the contenteditable div —
		// Svelte would re-inject it on every reactive update, duplicating text.
		// (A document that cannot be shown leaves the editor empty and says so: the failure
		// used to go up through the component as it was made, and there was no editor.)
		if (!showDocument(content || EMPTY_DOCUMENT)) showError(NOT_SHOWN);
		updateCounts();
		return stopTracking;
	});

	// Suppress unused warning for importing state (used in template)
	$effect(() => { void importing; });
</script>

<!-- Hidden file input for RTF import -->
<input
	type="file"
	accept=".rtf,application/rtf,text/rtf"
	class="ink-hidden-input"
	bind:this={fileInputEl}
	onchange={handleFileImport}
/>

<!-- Hidden file input for image insertion (multiple images at once) -->
<input
	type="file"
	accept="image/*"
	multiple
	class="ink-hidden-input"
	bind:this={imageInputEl}
	onchange={handleImageFilesChosen}
/>

<svelte:window
	onkeydown={(e) => {
		if (copyFormat !== 'off' && e.key === 'Escape') stopCopyFormat();
		linkArmed = !readonly && (e.metaKey || e.ctrlKey);
		// Typing: the note at a link is in the way of the words.
		if (linkHint && e.key !== 'Meta' && e.key !== 'Control') hideLinkHint();
	}}
	onkeyup={(e) => (linkArmed = !readonly && (e.metaKey || e.ctrlKey))}
	onblur={() => {
		linkArmed = false;
		hideLinkHint();
	}}
	onresize={() => {
		placeCopySourceBox();
		hideLinkHint();
	}}
/>

<div
	class="ink-editor"
	style:--ink-min-height={minHeight}
	style:--ink-font-family={screenFontFamily}
	style:--ink-font-size="{screenFontSize}pt"
>
	{#if !readonly && (showToolbar || copyFormat !== 'off')}
		<div class="ink-head" class:sticky={stickyToolbar} bind:this={headEl}>
			{#if showToolbar}
				<Toolbar
					{formatState}
					blockType={currentBlock}
					onexec={exec}
					onblock={setBlock}
					oninsertlink={openLinkModal}
					oninsertimage={openImageModal}
					oninserttable={openTableModal}
					fontSize={currentFontSize}
					fontSizes={sizeChoices}
					onfontsize={setFontSize}
					font={currentFont}
					fonts={fontList}
					documentFont={fontChoices([fontFamily])[0]?.name ?? DEFAULT_FONT_FAMILY}
					onfont={setFont}
					spacing={currentSpacing}
					copyingFormat={copyFormat !== 'off'}
					oncopyformat={toggleCopyFormat}
				/>
			{/if}

			{#if copyFormat !== 'off'}
				<div class="ink-copy-format" role="status">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="14" height="6" rx="1.5"/><path d="M17 6h3v5h-9v3"/><rect x="9.5" y="14" width="3" height="7" rx="1"/></svg>
					<span>
						{copyFormat === 'pick'
							? 'Copy format: click the paragraph to copy from.'
							: 'Format copied. Click each paragraph that should get it.'}
					</span>
					<button type="button" class="ink-copy-format-done" onmousedown={(e) => e.preventDefault()} onclick={stopCopyFormat}>
						{copyFormat === 'pick' ? 'Cancel' : 'Done'}
					</button>
					<span class="ink-copy-format-key">or press Esc</span>
				</div>
			{/if}
		</div>
	{/if}

	<div class="ink-content-wrap" bind:this={contentWrapEl}>
		<!-- (The pointer over a link shows a note of how the pointer opens it: there is nothing
		     in it for the keyboard, which opens a link from the browser's own menu.) -->
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_mouse_events_have_key_events -->
		<div
			class="ink-content"
			class:copy-format-pick={copyFormat === 'pick'}
			class:copy-format-apply={copyFormat === 'apply'}
			class:links-open={linkArmed && linkHint !== null}
			contenteditable={!readonly}
			role="textbox"
			tabindex="0"
			aria-multiline="true"
			aria-label={ariaLabel}
			aria-readonly={readonly ? 'true' : undefined}
			spellcheck="true"
			bind:this={editorEl}
			oninput={handleInput}
			onmouseup={caretMoved}
			onkeyup={caretMoved}
			onscroll={contentScrolled}
			onkeydown={handleKeydown}
			onmousedown={() => {
				tabLeavesEditor = false;
				hideLinkHint();
			}}
			onmouseover={linkHovered}
			onmouseout={linkLeft}
			onblur={() => (tabLeavesEditor = false)}
			onpaste={handlePaste}
			onclick={handleContentClick}
			ondragstart={() => (draggedFromHere = true)}
			ondragend={() => (draggedFromHere = false)}
			ondragover={handleDragOver}
			ondrop={handleDrop}
			data-placeholder={placeholder}
		></div>

		{#if copySourceBox}
			<div
				class="ink-copy-format-source"
				style:top="{copySourceBox.top}px"
				style:left="{copySourceBox.left}px"
				style:width="{copySourceBox.width}px"
				style:height="{copySourceBox.height}px"
			></div>
		{/if}

		{#if linkHint && !readonly}
			<div
				class="ink-link-hint"
				class:above={linkHint.above}
				role="tooltip"
				style:top="{linkHint.top}px"
				style:left="{linkHint.left}px"
			>
				<span class="ink-link-hint-address">{linkHint.href}</span>
				<span class="ink-link-hint-how">{OPEN_HINT}</span>
			</div>
		{/if}

		{#if !readonly}
			<ImageOverlay
				bind:this={overlayRef}
				target={selectedImage}
				bounds={contentWrapEl}
				within={editorEl}
				maxWidth={pictureRoom}
				onchange={handleImageEdited}
				onremove={removeSelectedImage}
				oncaption={focusCaption}
				place={picturePlace}
				onmove={moveSelectedImage}
				onbeside={toggleBeside}
			/>
		{/if}
	</div>

	{#if showStatusBar}
		<div class="ink-status-bar">
			<span>{wordCount} word{wordCount !== 1 ? 's' : ''} · {charCount} character{charCount !== 1 ? 's' : ''}</span>
			{#if autosave}
				<span>{lastSaved || 'Auto-saved to browser'}</span>
			{/if}
		</div>
	{/if}
</div>

<!-- Link Modal -->
<Modal title="Insert Link" open={linkModalOpen} onclose={() => (linkModalOpen = false)}>
	<input
		type="text"
		placeholder="Link text (leave empty to use selection)"
		aria-label="Link text"
		bind:value={linkText}
		onkeydown={(e) => onEnter(e, applyLink)}
	/>
	<input
		type="url"
		placeholder="https://example.com"
		aria-label="Link address"
		data-autofocus
		bind:value={linkUrl}
		onkeydown={(e) => onEnter(e, applyLink)}
		aria-invalid={linkError ? 'true' : undefined}
		aria-describedby={linkError ? 'ink-link-error' : undefined}
	/>
	{#if linkError}
		<p class="ink-modal-error" id="ink-link-error" role="alert">{linkError}</p>
	{/if}
	{#snippet actions()}
		<button class="ink-btn-ghost" onclick={() => (linkModalOpen = false)}>Cancel</button>
		<button class="ink-btn-primary" onclick={applyLink}>Insert</button>
	{/snippet}
</Modal>

<!-- Table Modal -->
<Modal title="Insert Table" open={tableModalOpen} onclose={() => (tableModalOpen = false)}>
	<div class="ink-table-size">
		<label>
			<span>Rows</span>
			<input type="number" min="1" max={MOST_TABLE_ROWS} step="1" data-autofocus bind:value={tableRows} onkeydown={(e) => onEnter(e, applyTable)} />
		</label>
		<label>
			<span>Columns</span>
			<input type="number" min="1" max={MOST_TABLE_COLUMNS} step="1" bind:value={tableColumns} onkeydown={(e) => onEnter(e, applyTable)} />
		</label>
	</div>
	<label class="ink-check"><input type="checkbox" bind:checked={tableBorders} /> <span>Borders</span></label>
	<label class="ink-check"><input type="checkbox" bind:checked={tableHeader} /> <span>First row is a header</span></label>
	{#snippet actions()}
		<button class="ink-btn-ghost" onclick={() => (tableModalOpen = false)}>Cancel</button>
		<button class="ink-btn-primary" onclick={applyTable}>Insert</button>
	{/snippet}
</Modal>

<!-- Image Modal -->
<Modal title="Insert Image" open={imageModalOpen} onclose={() => (imageModalOpen = false)}>
	<button class="ink-file-pick" onclick={chooseImageFiles}>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
		{pendingImageFiles.length > 0
			? `${pendingImageFiles.length} image${pendingImageFiles.length === 1 ? '' : 's'} selected`
			: 'Choose images from this device'}
	</button>

	{#if pendingImageFiles.length > 0}
		<p class="ink-file-list">{pendingImageFiles.map((f) => f.name).join(', ')}</p>
	{/if}

	{#if pendingImageFiles.length === 0}
		<div class="ink-modal-or"><span>or paste an address</span></div>
		<input
			type="url"
			placeholder="https://example.com/image.jpg"
			aria-label="Image address"
			bind:value={imageUrl}
			onkeydown={(e) => onEnter(e, () => void applyImage())}
		/>
	{/if}

	{#if pendingImageFiles.length > 1}
		<p class="ink-modal-hint">Add a description under each image after inserting.</p>
	{:else}
		<input type="text" placeholder="Description shown below the image (optional)" aria-label="Description shown below the image" bind:value={imageCaption} />
	{/if}
	<input type="text" placeholder="Alt text for screen readers (optional)" aria-label="Alt text for screen readers" bind:value={imageAlt} />

	{#snippet actions()}
		<button class="ink-btn-ghost" onclick={() => (imageModalOpen = false)}>Cancel</button>
		<button
			class="ink-btn-primary"
			disabled={insertingImages || (pendingImageFiles.length === 0 && !imageUrl.trim())}
			onclick={applyImage}
		>
			{insertingImages ? 'Inserting…' : 'Insert'}
		</button>
	{/snippet}
</Modal>

<!-- Import Error Toast -->
{#if importError}
	<div class="ink-toast-error" role="alert">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
		{importError}
	</div>
{/if}

<style>
	.ink-hidden-input {
		display: none;
	}

	.ink-editor {
		width: 100%;
	}

	/* The toolbar, and under it the note of a format being copied. It stays in sight while a
	   long document is scrolled, at the top of the window or of the scrolling element the
	   editor is in: under a header of the page's own, --ink-toolbar-top is that header's
	   height. Its ground is the toolbar's, so that no words show between its parts. */
	.ink-head {
		margin: 24px 0 16px;
		border-radius: var(--radius, 8px);
		background: var(--bg-toolbar, #fff);
	}

	.ink-head.sticky {
		position: sticky;
		top: var(--ink-toolbar-top, 0px);
		z-index: 30;
	}

	/* Anchors the image selection frame, which lives outside the
	   contenteditable area so it never lands in the exported HTML. */
	.ink-content-wrap {
		position: relative;
	}

	/* ── Content Area ── */
	.ink-content {
		/* Nothing in the document is drawn outside the editing area, whatever its styles: a table
		   wider than the area scrolls inside it, and does not run out over the page beside it. */
		overflow: auto;
		min-height: var(--ink-min-height, 40vh);
		padding: 48px 56px;
		background: white;
		border: 1px solid var(--border, #e5e2dc);
		border-radius: var(--radius, 8px);
		box-shadow: var(--shadow-md, 0 4px 12px rgba(44, 37, 32, 0.08));
		outline: none;
		font-family: var(--ink-font-family, sans-serif);
		font-size: var(--ink-font-size, 12pt);
		line-height: 1.75;
		color: var(--text, #2c2520);
		caret-color: var(--accent, #d4622b);
		transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.ink-content:focus {
		border-color: var(--border-active, #c4b5a0);
	}

	/* ── Copy format ── */
	/* The pointer says which step it is: a crosshair to pick the paragraph to copy from, then a
	   brush that paints the format on. The paragraph under the pointer lights up, so it is clear
	   what a click will act on. None of this is in the content, so none of it is exported. */
	.ink-content.copy-format-pick,
	.ink-content.copy-format-pick :global(*) {
		cursor: crosshair !important;
	}

	.ink-content.copy-format-apply,
	.ink-content.copy-format-apply :global(*) {
		cursor:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='white' stroke='%231a1714' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='14' height='6' rx='1.5'/%3E%3Cpath d='M17 6h3v5h-9v3' fill='none'/%3E%3Crect x='9.5' y='14' width='3' height='7' rx='1'/%3E%3C/svg%3E")
				4 4,
			copy !important;
	}

	/* A <div> line counts as a paragraph (isPlainParagraph) unless it holds other blocks. */
	.ink-content.copy-format-pick :global(:is(p, h1, h2, h3, h4, h5, h6, div:not(:has(p, div, h1, h2, h3, h4, h5, h6, pre, ul, ol, blockquote, figure, table, hr))):hover),
	.ink-content.copy-format-apply :global(:is(p, h1, h2, h3, h4, h5, h6, div:not(:has(p, div, h1, h2, h3, h4, h5, h6, pre, ul, ol, blockquote, figure, table, hr))):hover) {
		background: var(--accent-soft, #ede9fe);
		border-radius: 3px;
	}

	.ink-copy-format {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 8px 0 0;
		padding: 8px 12px;
		border: 1px solid var(--accent, #6e56cf);
		border-radius: var(--radius-sm, 5px);
		background: var(--accent-soft, #ede9fe);
		color: var(--text, #2c2520);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
	}

	.ink-copy-format svg {
		flex-shrink: 0;
		color: var(--accent, #6e56cf);
	}

	.ink-copy-format-done {
		margin-left: auto;
		padding: 4px 12px;
		border: 1px solid var(--accent, #6e56cf);
		border-radius: var(--radius-sm, 5px);
		background: white;
		color: var(--accent, #6e56cf);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.ink-copy-format-done:hover {
		background: var(--accent, #6e56cf);
		color: white;
	}

	.ink-copy-format-key {
		color: var(--text-muted, #8a7e72);
		font-size: 12px;
	}

	.ink-copy-format-source {
		position: absolute;
		box-sizing: border-box;
		border: 1.5px dashed var(--accent, #6e56cf);
		border-radius: 3px;
		pointer-events: none;
	}

	/* The note at a link under the pointer: where it goes, and how to open it. */
	.ink-link-hint {
		position: absolute;
		z-index: 5;
		box-sizing: border-box;
		max-width: min(320px, 100%);
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 10px;
		border-radius: 8px;
		background: var(--ink, #1a1714);
		color: #fff;
		font-family: 'DM Sans', system-ui, sans-serif;
		font-size: 12px;
		line-height: 1.35;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
		pointer-events: none;
		/* Not at once: the pointer crosses links on its way elsewhere. */
		animation: ink-link-hint-in 120ms ease 350ms both;
	}

	.ink-link-hint.above {
		transform: translateY(-100%);
	}

	.ink-link-hint-address {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		opacity: 0.75;
	}

	.ink-link-hint-how {
		font-weight: 600;
		white-space: nowrap;
	}

	@keyframes ink-link-hint-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ink-link-hint {
			animation-duration: 1ms;
		}
	}

	/* Ctrl or Cmd is down: a click will open the link. */
	.ink-content.links-open :global(a[href]) {
		cursor: pointer;
	}

	/* Placeholder */
	.ink-content:empty::before {
		content: attr(data-placeholder);
		color: var(--text-muted, #8a7e72);
		opacity: 0.5;
		pointer-events: none;
	}

	/* ── Typography inside editor ── */
	/* Headings use the document font and keep the same ratio to the body text
	   as the RTF writer gives them, so the screen matches the RTF. */
	.ink-content :global(h1) {
		font-size: 2em;
		line-height: 1.2;
		color: var(--ink, #1a1714);
		margin-bottom: 16px;
		letter-spacing: -0.5px;
	}

	.ink-content :global(h2) {
		font-size: 1.5em;
		line-height: 1.3;
		color: var(--ink, #1a1714);
		margin-bottom: 12px;
		margin-top: 32px;
	}

	.ink-content :global(h3) {
		font-size: calc(7em / 6);
		font-weight: 600;
		line-height: 1.4;
		color: var(--ink, #1a1714);
		margin-bottom: 8px;
		margin-top: 24px;
	}

	/* A line the browser made as a <div> (after a paste, or Enter in loose text) is a paragraph
	   like any other, and is written to RTF the same way: it gets the same spacing. */
	.ink-content :global(p),
	.ink-content :global(div) {
		margin: 0 0 0.2em;
	}

	.ink-content :global(blockquote) {
		border-left: 3px solid var(--accent, #d4622b);
		padding: 8px 20px;
		margin: 16px 0;
		color: var(--text-muted, #8a7e72);
		font-style: italic;
		background: var(--accent-soft, #fdf0e9);
		border-radius: 0 var(--radius-sm, 5px) var(--radius-sm, 5px) 0;
	}

	/* The indent Chromium, WebKit and Gmail paste (border: none) is an indent, not a quotation:
	   the RTF writes it plain, so it shows plain here too. */
	.ink-content :global(blockquote[style*='border: none']),
	.ink-content :global(blockquote[style*='border:none']),
	.ink-content :global(blockquote[style*='border-style: none']),
	.ink-content :global(blockquote[style*='border-left: none']) {
		font-style: normal;
		color: inherit;
		background: none;
		border-radius: 0;
	}

	.ink-content :global(pre) {
		background: var(--ink, #1a1714);
		color: #e8e2da;
		padding: 20px 24px;
		border-radius: var(--radius, 8px);
		/* Same font and ratio to the body as the RTF writes code blocks in. */
		font-family: 'Courier New', monospace;
		font-size: calc(5em / 6);
		line-height: 1.6;
		margin: 16px 0;
		overflow-x: auto;
	}

	.ink-content :global(code) {
		font-family: 'Courier New', monospace;
		font-size: 1em;
		background: var(--surface, #f2f0ec);
		padding: 2px 6px;
		border-radius: 3px;
		color: var(--accent, #d4622b);
	}

	.ink-content :global(pre code) {
		background: none;
		padding: 0;
		color: inherit;
	}

	.ink-content :global(ul),
	.ink-content :global(ol) {
		padding-left: 24px;
		margin-bottom: 12px;
	}

	.ink-content :global(li) {
		margin-bottom: 4px;
	}

	.ink-content :global(a) {
		color: var(--accent, #d4622b);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.ink-content :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius, 8px);
		margin: 16px 0;
	}

	/* ── Figures (image + description) ── */
	/* A picture has the space of a paragraph, which is what the RTF gives it: none of its own.
	   The space before and after it is set from the Spacing list, and shows as it is set.
	   (It had 20px here that no reader of the RTF showed, and a space that was set was lost
	   in it.) */
	.ink-content :global(figure) {
		margin: 0 0 0.2em;
	}

	/* A cell with no border has none in the RTF. While the document is edited it is drawn with
	   a faint line, or a table of empty cells could not be seen at all. (Not a cell that holds
	   a picture: pictures side by side are a row of such cells, and show where they are.) */
	.ink-content[contenteditable='true'] :global(:is(td, th):not([style*='border']):not(:has(> figure, > img))) {
		outline: 1px dashed var(--border, #e5e2dc);
		outline-offset: -1px;
	}

	/* A picture in a cell starts at the top of it, where the RTF has it. */
	.ink-content :global(:is(td, th):has(> figure, > img)) {
		vertical-align: top;
	}

	.ink-content :global(:is(td, th) > img:only-child) {
		margin: 0;
		vertical-align: bottom;
	}

	.ink-content :global(figure img) {
		margin: 0;
		vertical-align: bottom;
		cursor: pointer;
	}

	.ink-content :global(figcaption) {
		margin-top: 8px;
		/* Body size, as the RTF writes captions. */
		font-size: 1em;
		line-height: 1.5;
		font-style: italic;
		color: var(--text-muted, #8a7e72);
	}

	.ink-content :global(figcaption:empty)::before {
		content: 'Add a description…';
		opacity: 0.55;
	}

	.ink-content :global(hr) {
		border: none;
		height: 1px;
		background: var(--border, #e5e2dc);
		margin: 32px 0;
	}

	/* A page break read from RTF (\page): a dashed rule, written back as \page. */
	.ink-content :global(hr[style*='break-after']) {
		height: 0;
		background: none;
		border-top: 1px dashed var(--text-muted, #8a7e72);
	}

	/* ── Status Bar ── */
	.ink-status-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 0;
		font-size: 12px;
		color: var(--text-muted, #8a7e72);
		letter-spacing: 0.2px;
	}

	.ink-status-bar span {
		opacity: 0.7;
	}

	/* ── Buttons (for modals) ── */
	:global(.ink-btn-primary) {
		background: var(--accent, #d4622b);
		border: none;
		padding: 8px 18px;
		border-radius: var(--radius-sm, 5px);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: white;
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ink-btn-primary:hover) {
		background: var(--accent-hover, #be5524);
	}

	:global(.ink-btn-primary:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Image dialog ── */
	.ink-file-pick {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 14px;
		margin-bottom: 12px;
		border: 1px dashed var(--border-active, #c4b5a0);
		border-radius: var(--radius-sm, 5px);
		background: var(--surface, #f2f0ec);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text, #2c2520);
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.ink-file-pick:hover {
		border-color: var(--accent, #d4622b);
		color: var(--accent, #d4622b);
	}

	.ink-file-list {
		margin: -6px 0 12px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-muted, #8a7e72);
		word-break: break-word;
	}

	.ink-modal-hint {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--text-muted, #8a7e72);
	}

	.ink-table-size {
		display: flex;
		gap: 16px;
		margin-bottom: 14px;
	}

	.ink-table-size label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
		font-size: 13px;
		color: var(--text-muted, #8a7e72);
	}

	.ink-table-size input {
		padding: 9px 12px;
		border: 1px solid var(--border, #e5e2dc);
		border-radius: var(--radius-sm, 5px);
		font: inherit;
		font-size: 14px;
		color: var(--text, #2c2520);
		outline: none;
	}

	.ink-table-size input:focus {
		border-color: var(--accent, #d4622b);
	}

	.ink-check {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		font-size: 14px;
		color: var(--text, #2c2520);
		cursor: pointer;
	}

	.ink-modal-error {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--danger, #b42318);
	}

	.ink-modal-or {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-muted, #8a7e72);
	}

	.ink-modal-or::before,
	.ink-modal-or::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--border, #e5e2dc);
	}

	:global(.ink-btn-ghost) {
		background: none;
		border: 1px solid var(--border, #e5e2dc);
		padding: 8px 16px;
		border-radius: var(--radius-sm, 5px);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted, #8a7e72);
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ink-btn-ghost:hover) {
		border-color: var(--border-active, #c4b5a0);
		color: var(--text, #2c2520);
		background: var(--surface, #f2f0ec);
	}

	/* ── Error Toast ── */
	.ink-toast-error {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		background: #d32f2f;
		color: white;
		padding: 10px 20px;
		border-radius: var(--radius, 8px);
		font-size: 13px;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 8px;
		box-shadow: var(--shadow-lg, 0 8px 30px rgba(44, 37, 32, 0.12));
		z-index: 300;
		animation: inkToastIn 0.25s ease-out;
	}

	.ink-toast-error svg {
		flex-shrink: 0;
	}

	@keyframes inkToastIn {
		from { opacity: 0; transform: translateX(-50%) translateY(12px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	/* ── Responsive ── */
	@media (max-width: 700px) {
		.ink-content {
			padding: 28px 24px;
		}
	}
</style>
