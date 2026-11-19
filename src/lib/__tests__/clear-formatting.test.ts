// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

// happy-dom has none of the browser's editing commands. The one Clear formatting uses is stood
// in for by one that takes the <b> elements out and can put them back: what is tested here is
// the editor's own part, which is what is written on the elements. What the three browsers'
// own commands do is in e2e/editor.spec.ts.
type Editing = { queryCommandState?: () => boolean; queryCommandValue?: () => string; execCommand?: (cmd: string) => boolean };
const doc = document as unknown as Editing;
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

describe('InkEditor: Clear formatting', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	let commands: string[] = [];
	let taken: { b: Element; parent: Node; next: Node | null; kids: Node[] }[] = [];

	function open(content: string, props: Record<string, unknown> = {}): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props: { content, ...props } }) as Record<string, unknown>;
		flushSync();
		const editor = host.querySelector('.ink-content') as HTMLElement;
		commands = [];
		taken = [];
		doc.execCommand = (cmd: string) => {
			commands.push(cmd);
			if (cmd === 'removeFormat') {
				taken = Array.from(editor.querySelectorAll('b')).map((b) => ({ b, parent: b.parentNode!, next: b.nextSibling, kids: Array.from(b.childNodes) }));
				for (const { b, kids } of taken) b.replaceWith(...kids);
			} else if (cmd === 'undo') {
				for (const { b, parent, next, kids } of taken) {
					parent.insertBefore(b, next);
					b.append(...kids);
				}
			}
			return true;
		};
		return editor;
	}
	function selectAll(editor: HTMLElement): void {
		const range = document.createRange();
		range.selectNodeContents(editor);
		const selection = window.getSelection()!;
		selection.removeAllRanges();
		selection.addRange(range);
	}
	const api = () => component as unknown as { clearFormatting(): void };

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
		delete doc.execCommand;
	});

	it('takes the looks of the text off the elements that stay, and leaves their layout', () => {
		const editor = open(
			'<h2 style="text-align: center; color: red;">Heading</h2>' +
				'<p style="font-size: 14pt; color: red; text-align: right; margin-left: 48px;">a <b>bold</b> <font color="#ff0000" size="5">red</font></p>' +
				'<table><tbody><tr><td style="font-weight: bold; background-color: rgb(238, 238, 238);">cell</td></tr></tbody></table>'
		);
		selectAll(editor);
		api().clearFormatting();
		expect(commands).toEqual(['removeFormat']);
		expect(editor.querySelector('h2')!.getAttribute('style')).toBe('text-align: center;');
		const p = editor.querySelector('p')!;
		expect([p.style.color, p.style.fontSize, p.style.textAlign, p.style.marginLeft]).toEqual(['', '', 'right', '48px']);
		const font = editor.querySelector('font')!;
		expect([font.getAttribute('color'), font.getAttribute('size')]).toEqual([null, null]);
		// A cell's shading is the table's design; its bold is a look of the text.
		const td = editor.querySelector('td')!;
		expect([td.style.fontWeight, td.style.backgroundColor]).toEqual(['', 'rgb(238, 238, 238)']);
		expect(editor.querySelector('b')).toBeNull();
	});

	it('Undo puts back what was written on the elements, with what the browser puts back', () => {
		const editor = open('<p style="color: red; text-align: right;">a <b>bold</b></p><p>end</p>');
		const before = editor.innerHTML;
		selectAll(editor);
		api().clearFormatting();
		expect(editor.innerHTML).toBe('<p style="text-align: right;">a bold</p><p>end</p>');
		const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
		editor.dispatchEvent(undo);
		expect(undo.defaultPrevented).toBe(true);
		expect(commands).toEqual(['removeFormat', 'undo']);
		expect(editor.innerHTML).toBe(before);
	});

	it('is no longer the editor\'s to undo once the document has been edited', () => {
		const editor = open('<p style="color: red;">a <b>bold</b></p>');
		selectAll(editor);
		api().clearFormatting();
		editor.querySelector('p')!.append(' typed');
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
		editor.dispatchEvent(undo);
		// The key is left to the browser, whose history has the typing first.
		expect(undo.defaultPrevented).toBe(false);
		expect(commands).toEqual(['removeFormat']);
	});

	it('puts the color back when the browser itself undoes the command, after more was typed', () => {
		const editor = open('<p style="color: red; text-align: right;">a <b>bold</b></p><p>end</p>');
		const before = editor.innerHTML;
		selectAll(editor);
		api().clearFormatting();
		const typed = document.createTextNode(' typed');
		editor.querySelectorAll('p')[1].append(typed);
		editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true }));
		// The browser's Undo, twice: what was typed, then its command. The <b> is back; the
		// paragraph's color is not the browser's to put back.
		typed.remove();
		editor.dispatchEvent(new InputEvent('input', { inputType: 'historyUndo', bubbles: true }));
		expect(editor.innerHTML).toBe('<p style="text-align: right;">a bold</p><p>end</p>');
		doc.execCommand!('undo');
		editor.dispatchEvent(new InputEvent('input', { inputType: 'historyUndo', bubbles: true }));
		expect(editor.innerHTML).toBe(before);
	});

	it('is the editor\'s to undo again when what was typed after it has been undone, where the command left nothing', () => {
		// (No <b> here: all there is to clear is written on the paragraph.)
		const editor = open('<p style="color: red; text-align: right;">red</p><p>end</p>');
		const before = editor.innerHTML;
		selectAll(editor);
		api().clearFormatting();
		const cleared = editor.innerHTML;
		expect(cleared).toBe('<p style="text-align: right;">red</p><p>end</p>');
		const typed = document.createTextNode(' typed');
		editor.querySelectorAll('p')[1].append(typed);
		editor.dispatchEvent(new InputEvent('input', { inputType: 'insertText', bubbles: true }));
		typed.remove();
		editor.dispatchEvent(new InputEvent('input', { inputType: 'historyUndo', bubbles: true }));
		expect(editor.innerHTML).toBe(cleared);
		const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
		editor.dispatchEvent(undo);
		expect(undo.defaultPrevented).toBe(true);
		expect(editor.innerHTML).toBe(before);
		// And Redo, by Ctrl+Y, clears it again.
		const redo = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
		editor.dispatchEvent(redo);
		expect(redo.defaultPrevented).toBe(true);
		expect(editor.innerHTML).toBe(cleared);
	});

	it('tells the application the document changed, and does nothing in a read-only editor', () => {
		const changes: string[] = [];
		const editor = open('<p style="color: red;">red</p>', { onchange: (e: { html: string }) => changes.push(e.html) });
		selectAll(editor);
		api().clearFormatting();
		expect(changes[changes.length - 1]).toBe('<p>red</p>');
		if (component) unmount(component);
		host?.remove();
		const readOnly = open('<p style="color: red;">red</p>', { readonly: true });
		selectAll(readOnly);
		api().clearFormatting();
		expect(readOnly.innerHTML).toBe('<p style="color: red;">red</p>');
		expect(commands).toEqual([]);
	});
});
