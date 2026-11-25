// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

// insertText() and insertFragment() (issue #56, Part 1): the editor's own part. happy-dom has
// none of the browser's editing commands, so those it calls are recorded, and the simple ones
// stood in for; what the three browsers make of them is in e2e/insert.spec.ts and
// e2e/editor.spec.ts.
type Editing = { queryCommandState?: () => boolean; queryCommandValue?: () => string; execCommand?: (cmd: string, ui?: boolean, value?: string) => boolean };
const doc = document as unknown as Editing;
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

type Api = {
	insertText(text: unknown): boolean;
	insertFragment(html: unknown): unknown[] | null;
	getHTML(): string;
	undo(): boolean;
};

describe('InkEditor: insertText and insertFragment', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	let commands: string[] = [];
	let editor: HTMLElement;

	function open(content: string, props: Record<string, unknown> = {}): Api {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props: { content, ...props } }) as Record<string, unknown>;
		flushSync();
		editor = host.querySelector('.ink-content') as HTMLElement;
		commands = [];
		doc.execCommand = (cmd: string, _ui?: boolean, value?: string) => {
			commands.push(value === undefined ? cmd : `${cmd}:${value}`);
			const sel = window.getSelection()!;
			if (cmd === 'insertText' && value) {
				const range = sel.getRangeAt(0);
				const text = document.createTextNode(value);
				range.insertNode(text);
				range.setStartAfter(text);
				range.collapse(true);
				sel.removeAllRanges();
				sel.addRange(range);
			}
			return true;
		};
		return component as unknown as Api;
	}
	/** Put the selection from `from` to `to` in the text of the first element `selector` names. */
	function select(selector: string, from: number, to = from): void {
		const text = editor.querySelector(selector)!.firstChild!;
		const range = document.createRange();
		range.setStart(text, from);
		range.setEnd(text, to);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
	}

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
		window.getSelection()?.removeAllRanges();
		delete doc.execCommand;
	});

	it('nothing to put in, or a read-only editor, is nothing done', () => {
		let ed = open('<p>one</p>');
		expect(ed.insertText('')).toBe(false);
		expect(ed.insertText(7)).toBe(false);
		expect(ed.insertFragment(7)).toBeNull();
		expect(ed.insertFragment('')).toBeNull();
		expect(ed.insertFragment('<script>x()</script><!-- c --> <span> </span>')).toBeNull();
		expect(commands).toEqual([]);
		expect(ed.getHTML()).toBe('<p>one</p>');
		unmount(component!);
		host!.remove();
		ed = open('<p>one</p>', { readonly: true });
		expect(ed.insertText('x')).toBe(false);
		expect(ed.insertFragment('<b>x</b>')).toBeNull();
		expect(ed.getHTML()).toBe('<p>one</p>');
	});

	it('inline HTML goes in at the caret as it was given, and the caret after it', () => {
		const ed = open('<p>one two</p>');
		select('p', 3);
		expect(ed.insertFragment(' <b>and</b> a half')).toEqual([]);
		expect(ed.getHTML()).toBe('<p>one <b>and</b> a half two</p>');
		const sel = window.getSelection()!;
		expect(sel.isCollapsed).toBe(true);
		expect(sel.anchorNode!.childNodes[sel.anchorOffset - 1].nodeValue).toBe(' a half');
		// (No command of the browser's: it would have changed the spaces.)
		expect(commands).toEqual([]);
		expect(ed.undo()).toBe(true);
		expect(ed.getHTML()).toBe('<p>one two</p>');
	});

	it('inline HTML over words of one paragraph takes their place, and a space that did not break beside it becomes an ordinary one', () => {
		const ed = open('<p>one two three</p>');
		select('p', 4, 7);
		ed.insertFragment('<i>2</i>');
		expect(ed.getHTML()).toBe('<p>one <i>2</i> three</p>');

		const nbsp = open('<p>one&nbsp;</p>');
		select('p', 4);
		nbsp.insertFragment('<b>x</b>');
		expect(nbsp.getHTML()).toBe('<p>one <b>x</b></p>');
		// (Where what came in has a space of its own there, the one that does not break stays.)
		const spaced = open('<p>one&nbsp;</p>');
		select('p', 4);
		spaced.insertFragment(' <b>x</b>');
		expect(spaced.getHTML()).toBe('<p>one&nbsp; <b>x</b></p>');
	});

	it('a selection across paragraphs is the browser\'s delete to join', () => {
		const ed = open('<p>one</p><p>two</p>');
		const ps = editor.querySelectorAll('p');
		const range = document.createRange();
		range.setStart(ps[0].firstChild!, 1);
		range.setEnd(ps[1].firstChild!, 1);
		window.getSelection()!.removeAllRanges();
		window.getSelection()!.addRange(range);
		ed.insertFragment('<b>x</b>');
		expect(commands).toEqual(['delete']);
	});

	it('HTML with blocks is put in by the browser, as a paste of it is, made safe first', () => {
		const ed = open('<p>one</p>');
		select('p', 3);
		expect(ed.insertFragment('<p id="a" onclick="x()">A</p><ul><li>B</li></ul>')).toEqual([]);
		// (An id goes as the paste is tidied, after the browser has put it in.)
		expect(commands).toEqual(['insertHTML:<p id="a">A</p><ul><li>B</li></ul>']);
	});

	it('a line break in text starts a paragraph, as Enter does', () => {
		const ed = open('<p>one</p>');
		select('p', 3);
		expect(ed.insertText('a\r\nb\n\nc')).toBe(true);
		expect(commands).toEqual(['insertText:a', 'insertParagraph', 'insertText:b', 'insertParagraph', 'insertParagraph', 'insertText:c']);
	});

	it('in a code block a line break stays in the code, and the text goes in as it is', () => {
		const ed = open('<pre>a</pre>');
		select('pre', 1);
		ed.insertText('\r\nb');
		expect(commands).toEqual([]);
		expect(editor.querySelector('pre')!.textContent).toBe('a\nb');
	});

	it('with no caret in the editor, the end of the document: its last line, the last item of a list, or a line after a table', () => {
		let ed = open('<p>one</p><p><br></p>');
		ed.insertFragment('<b>x</b>');
		expect(ed.getHTML()).toBe('<p>one</p><p><b>x</b></p>');

		ed = open('<ul><li>a</li><li>b</li></ul>');
		ed.insertFragment('c');
		expect(ed.getHTML()).toBe('<ul><li>a</li><li>bc</li></ul>');

		ed = open('<table><tbody><tr><td>a</td></tr></tbody></table>');
		ed.insertFragment('c');
		expect(ed.getHTML()).toBe('<table><tbody><tr><td>a</td></tr></tbody></table><p>c</p>');

		ed = open('<p>one</p><hr>');
		ed.insertFragment('c');
		expect(ed.getHTML()).toBe('<p>one</p><hr><p>c</p>');
	});

	it('after the editor has lost the keyboard, where the caret last was', () => {
		const ed = open('<p>one two</p>');
		select('p', 3);
		document.dispatchEvent(new Event('selectionchange'));
		const elsewhere = document.createElement('input');
		document.body.appendChild(elsewhere);
		window.getSelection()!.removeAllRanges();
		elsewhere.focus();
		ed.insertFragment(' and');
		expect(ed.getHTML()).toBe('<p>one and two</p>');
		elsewhere.remove();
	});
});
