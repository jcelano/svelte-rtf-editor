import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

/**
 * The Tab key in the editor. It types a tab, as in a word processor, so that a line can be
 * indented; with several lines selected it indents them all; Shift+Tab takes the tab off the
 * start of the caret's line. Escape, then Tab, leaves the editor, so the keyboard is never
 * trapped in it. The browsers' own commands do the typing: they are stood in for here by what
 * each of them does with a tab. (What the real ones do is in the browser tests.) Invented text.
 */

const doc = document as Document & {
	queryCommandState?: () => boolean;
	queryCommandValue?: () => string;
	execCommand?: (command: string, ui?: boolean, value?: string) => boolean;
};
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

const TAB = '<span style="white-space:pre">\t</span>';
type Editor = { getRTF(): string; getHTML(): string };

let host: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;
let commands: [string, string | undefined][] = [];
const before = doc.execCommand;

afterEach(() => {
	doc.execCommand = before;
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
	commands = [];
});

/**
 * The commands the editor types with, as one browser carries them out. Chromium and Safari
 * type a tab as a tab, in a span that keeps its width; Firefox types spaces in its place.
 */
function browser(kind: 'chromium' | 'firefox'): void {
	const undo: (() => void)[] = [];
	doc.execCommand = (command, _ui, value) => {
		commands.push([command, value]);
		const sel = window.getSelection()!;
		if (sel.rangeCount === 0) return false;
		const range = sel.getRangeAt(0);
		const put = (node: Node, caretIn: Text) => {
			range.deleteContents();
			const at = { node: range.startContainer, offset: range.startOffset };
			range.insertNode(node);
			sel.collapse(caretIn, caretIn.length);
			undo.push(() => {
				node.parentNode?.removeChild(node);
				at.node.parentNode?.normalize();
				sel.collapse(at.node, Math.min(at.offset, at.node.textContent?.length ?? 0));
			});
		};
		if (command === 'insertText') {
			if (value === '\t' && kind === 'chromium') {
				const span = document.createElement('span');
				span.setAttribute('style', 'white-space:pre');
				span.textContent = '\t';
				put(span, span.firstChild as Text);
			} else {
				const text = document.createTextNode(value === '\t' ? `${String.fromCharCode(160).repeat(3)} ` : (value ?? ''));
				put(text, text);
			}
		} else if (command === 'insertHTML') {
			const holder = document.createElement('div');
			holder.innerHTML = value ?? '';
			const node = holder.firstChild as Element;
			put(node, node.firstChild as Text);
		} else if (command === 'undo') {
			undo.pop()?.();
		} else if (command === 'delete') {
			range.deleteContents();
		}
		return true;
	};
}

function open(content: string, props: Record<string, unknown> = {}): { editor: HTMLElement; api: Editor } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false, ...props } }) as Record<string, unknown>;
	flushSync();
	return { editor: host.querySelector('.ink-content') as HTMLElement, api: component as unknown as Editor };
}

function press(editor: HTMLElement, key: string, held: KeyboardEventInit = {}): KeyboardEvent {
	const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held });
	editor.dispatchEvent(e);
	flushSync();
	return e;
}

function textOf(editor: HTMLElement, text: string): Text {
	const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data === text) return n as Text;
	throw new Error(`no text ${JSON.stringify(text)}`);
}

/** Put the caret in a piece of text (at its end, or at `offset`), or select from one place to another. */
function caret(node: Text, offset = node.length, to: Text = node, toOffset = offset): void {
	window.getSelection()!.setBaseAndExtent(node, offset, to, toOffset);
}

const typed = () => commands.map(([command]) => command);

describe('Tab types a tab', () => {
	it('where the caret is, by the browser\'s own typing, so that Undo takes it back', () => {
		browser('chromium');
		const { editor, api } = open('<p>Invasive carcinoma</p>');
		caret(textOf(editor, 'Invasive carcinoma'), 0);
		const e = press(editor, 'Tab');
		expect(e.defaultPrevented).toBe(true);
		expect(commands).toEqual([['insertText', '\t']]);
		expect(editor.innerHTML).toBe(`<p>${TAB}Invasive carcinoma</p>`);
		expect(api.getRTF()).toContain('\\tab Invasive carcinoma');
	});

	it('in the middle of a line, and in place of what is selected on it', () => {
		browser('chromium');
		const { editor } = open('<p>ER positive</p>');
		const words = textOf(editor, 'ER positive');
		caret(words, 2, words, 3);
		press(editor, 'Tab');
		expect(editor.innerHTML).toBe(`<p>ER${TAB}positive</p>`);
	});

	it('in Firefox, which types spaces for it: they are taken back, and the tab is put in, with the caret after it', () => {
		browser('firefox');
		const { editor, api } = open('<p>Invasive carcinoma</p>');
		caret(textOf(editor, 'Invasive carcinoma'), 0);
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		expect(typed()).toEqual(['insertText', 'undo', 'insertHTML']);
		expect(commands[2][1]).toBe(TAB);
		expect(editor.innerHTML).toBe(`<p>${TAB}Invasive carcinoma</p>`);
		expect(api.getRTF()).toContain('\\tab Invasive carcinoma');
		// What is typed next is not in the span that holds the tab.
		const sel = window.getSelection()!;
		expect(editor.querySelector('span')!.contains(sel.anchorNode)).toBe(false);
		expect(sel.isCollapsed).toBe(true);
	});

	it('in a block of code it types two spaces, and Shift+Tab does nothing there', () => {
		browser('chromium');
		const { editor } = open('<pre>if (margin) {</pre>');
		caret(textOf(editor, 'if (margin) {'), 0);
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		expect(commands).toEqual([['insertText', '  ']]);
		expect(press(editor, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
		expect(commands).toHaveLength(1);
	});
});

describe('Tab is left to the browser', () => {
	it('with Ctrl, Cmd or Alt held: those are the browser\'s and the system\'s', () => {
		browser('chromium');
		const { editor } = open('<p>Line</p>');
		caret(textOf(editor, 'Line'));
		for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) expect(press(editor, 'Tab', held).defaultPrevented).toBe(false);
		expect(commands).toEqual([]);
	});

	it('where the document cannot be edited', () => {
		browser('chromium');
		const { editor } = open('<p>Line</p>', { readonly: true });
		caret(textOf(editor, 'Line'));
		expect(press(editor, 'Tab').defaultPrevented).toBe(false);
		expect(commands).toEqual([]);
	});

	it('where the caret is not in the document', () => {
		browser('chromium');
		const { editor } = open('<p>Line</p>');
		const outside = document.createElement('p');
		outside.textContent = 'outside';
		document.body.appendChild(outside);
		try {
			caret(outside.firstChild as Text);
			expect(press(editor, 'Tab').defaultPrevented).toBe(false);
			window.getSelection()!.removeAllRanges();
			expect(press(editor, 'Tab').defaultPrevented).toBe(false);
			expect(commands).toEqual([]);
		} finally {
			outside.remove();
		}
	});

	it('after Escape: the next Tab, or Shift+Tab, leaves the editor, and only that one', () => {
		browser('chromium');
		const { editor } = open('<p>Line</p>');
		caret(textOf(editor, 'Line'));
		press(editor, 'Escape');
		expect(press(editor, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
		expect(commands).toEqual([]);
		// Back in the editor, Tab types again.
		caret(textOf(editor, 'Line'));
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		expect(typed()).toEqual(['insertText']);
	});

	it('but not if Escape was followed by another key, a click in the text, or the keyboard leaving it', () => {
		browser('chromium');
		const { editor } = open('<p>Line</p>');
		const again = () => {
			caret(textOf(editor, 'Line'), 0);
			press(editor, 'Escape');
		};
		again();
		press(editor, 'a');
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		again();
		editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		caret(textOf(editor, 'Line'), 0);
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		again();
		editor.dispatchEvent(new FocusEvent('blur'));
		caret(textOf(editor, 'Line'), 0);
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		expect(typed()).toEqual(['insertText', 'insertText', 'insertText']);
	});
});

describe('Tab with several lines selected', () => {
	it('indents them all, and Shift+Tab brings them back: no tab is typed over them', () => {
		browser('chromium');
		const { editor, api } = open('<p>Left breast</p><p>Right breast</p><p>Node</p>');
		const select = () => caret(textOf(editor, 'Left breast'), 2, textOf(editor, 'Right breast'), 4);
		select();
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		expect(typed()).not.toContain('insertText');
		expect(editor.textContent).toBe('Left breastRight breastNode');
		const indented = api.getRTF();
		expect(indented).toMatch(/\\li720[^\\]*(\\[a-z0-9-]+)* ?Left breast/);
		expect(indented).toMatch(/\\li720[^\\]*(\\[a-z0-9-]+)* ?Right breast/);
		expect(indented).not.toMatch(/\\li720[^\\]*(\\[a-z0-9-]+)* ?Node/);
		select();
		expect(press(editor, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
		expect(api.getRTF()).not.toContain('\\li720');
	});

	it('two lines of one paragraph are several lines too', () => {
		browser('chromium');
		const { editor } = open('<p>Gross:<br>Three fragments</p>');
		caret(textOf(editor, 'Gross:'), 1, textOf(editor, 'Three fragments'), 5);
		expect(press(editor, 'Tab').defaultPrevented).toBe(true);
		expect(typed()).not.toContain('insertText');
		expect(editor.textContent).toBe('Gross:Three fragments');
	});
});

describe('Shift+Tab takes the tab off the start of the line', () => {
	it('wherever on the line the caret is, by a command of the browser\'s, so that Undo puts it back', () => {
		browser('chromium');
		const { editor } = open(`<p>A. Breast:</p><p>${TAB}Invasive carcinoma</p>`);
		const words = textOf(editor, 'Invasive carcinoma');
		caret(words, 8);
		expect(press(editor, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
		expect(commands).toEqual([['delete', undefined]]);
		expect(editor.textContent).toBe('A. Breast:Invasive carcinoma');
		// The caret is where it was in the words.
		const sel = window.getSelection()!;
		expect([sel.anchorNode, sel.anchorOffset, sel.isCollapsed]).toEqual([words, 8, true]);
	});

	it('the first of two, and one typed as plain text', () => {
		browser('chromium');
		const { editor } = open('<p>\t\tTwo tabs</p>');
		caret(textOf(editor, '\t\tTwo tabs'));
		press(editor, 'Tab', { shiftKey: true });
		expect(editor.querySelector('p')!.textContent).toBe('\tTwo tabs');
		press(editor, 'Tab', { shiftKey: true });
		expect(editor.querySelector('p')!.textContent).toBe('Two tabs');
		press(editor, 'Tab', { shiftKey: true });
		expect(typed()).toEqual(['delete', 'delete']);
	});

	it('of the caret\'s own line: not of the line before it or after it in the paragraph', () => {
		browser('chromium');
		const { editor } = open(`<p>${TAB}first<br>second<br>${TAB}third</p>`);
		caret(textOf(editor, 'second'));
		press(editor, 'Tab', { shiftKey: true });
		expect(commands).toEqual([]);
		caret(textOf(editor, 'third'), 2);
		press(editor, 'Tab', { shiftKey: true });
		expect(typed()).toEqual(['delete']);
		expect(editor.querySelector('p')!.textContent).toBe('\tfirstsecondthird');
		caret(textOf(editor, 'first'), 1);
		press(editor, 'Tab', { shiftKey: true });
		expect(editor.querySelector('p')!.textContent).toBe('firstsecondthird');
	});

	it('not a tab further along the line, and not with words selected', () => {
		browser('chromium');
		const { editor } = open(`<p>ER${TAB}positive</p><p>${TAB}PR positive</p>`);
		caret(textOf(editor, 'positive'));
		expect(press(editor, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
		const words = textOf(editor, 'PR positive');
		caret(words, 0, words, 2);
		press(editor, 'Tab', { shiftKey: true });
		expect(commands).toEqual([]);
		expect(editor.textContent).toBe('ER\tpositive\tPR positive');
	});

	it('in a table cell, a list item, and text that is in no paragraph', () => {
		browser('chromium');
		const { editor } = open(`<table><tbody><tr><td>${TAB}cell</td><td>next</td></tr></tbody></table><ul><li>${TAB}item</li></ul>`);
		caret(textOf(editor, 'next'));
		press(editor, 'Tab', { shiftKey: true });
		expect(commands).toEqual([]);
		caret(textOf(editor, 'cell'));
		press(editor, 'Tab', { shiftKey: true });
		caret(textOf(editor, 'item'));
		press(editor, 'Tab', { shiftKey: true });
		expect(typed()).toEqual(['delete', 'delete']);
		expect(editor.textContent).toBe('cellnextitem');
	});
});
