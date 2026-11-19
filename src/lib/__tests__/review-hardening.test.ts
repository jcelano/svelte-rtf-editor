// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { sanitizeHtml, sanitizeTree } from '../sanitize.js';
import { htmlToRtf, estimateRtfBytes } from '../rtf-writer.js';
import { htmlToMarkdown } from '../utils.js';

// happy-dom has none of the editing commands the editor asks the browser about.
const doc = document as unknown as { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

/** The browser's storage, stood in (see sanitize.test.ts). */
function memoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		get length() {
			return items.size;
		},
		clear: () => items.clear(),
		getItem: (key: string) => items.get(key) ?? null,
		key: (index: number) => Array.from(items.keys())[index] ?? null,
		removeItem: (key: string) => void items.delete(key),
		setItem: (key: string, value: string) => void items.set(key, String(value))
	} as Storage;
}

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const element = (html: string): HTMLElement => {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div;
};

/**
 * Every object has these names on it without being given them: `constructor`, `toString`,
 * `__proto__` and the rest. A table of tags, colors or units that is an object answers to them
 * too, with a function where a list or a number was meant.
 */
const NAMES_OF_EVERY_OBJECT = Object.getOwnPropertyNames(Object.prototype);

describe('a tag, a color or a unit named like something every object has', () => {
	it('an element named "constructor" with an attribute of its own is made safe like any other', () => {
		// (It threw "own?.includes is not a function": the table of attributes each tag may keep
		// answered "constructor" with a function. With that, the editor did not open a document
		// that held one, setHTML left the document before it on the screen, and a paste that held
		// one was not made safe at all.)
		const out = element(sanitizeHtml('<p>before</p><constructor data-x="1" src="x" width="5" onclick="x()">words</constructor><p>after</p>'));
		expect(out.textContent).toBe('beforewordsafter');
		const kept = out.querySelector('constructor');
		expect(kept === null || kept.attributes.length === 0).toBe(true);
	});

	it('none of those names, as a tag with attributes, stops the sanitizer', () => {
		for (const name of NAMES_OF_EVERY_OBJECT) {
			const html = `<p>a</p><${name} data-x="1" href="https://x.test/" colspan="2">w</${name}><p>z</p>`;
			expect(() => sanitizeHtml(html), name).not.toThrow();
			expect(sanitizeHtml(html), name).not.toMatch(/data-x|colspan/);
		}
	});

	it('none of those names, as a size or its unit, stops the sanitizer', () => {
		for (const name of NAMES_OF_EVERY_OBJECT) {
			const html = `<p style="margin-left: 5${name}; font-size: ${name}; padding: 2${name} 4px">a</p>`;
			expect(() => sanitizeHtml(html), name).not.toThrow();
		}
	});

	it('a color of such a name is no color: the color table is not written with "undefined" in it', () => {
		const plain = htmlToRtf(element('<p><font>x</font></p>'));
		for (const name of NAMES_OF_EVERY_OBJECT) {
			const rtf = htmlToRtf(element(`<p><font color="${name}">x</font></p>`));
			expect(rtf, name).not.toMatch(/undefined|NaN/);
			expect(rtf, name).toBe(plain);
		}
	});

	it('the size estimate is a number, and not below the real size, whatever the elements are named', () => {
		// (With an element named "constructor" it was the text "214function Object() { [native code] }":
		// an application that compares it with a size limit then lets every document through.)
		for (const name of NAMES_OF_EVERY_OBJECT) {
			const div = element(`<p>text</p><${name}>inside</${name}><table><tr><td rowspan="2">a</td></tr><tr></tr></table>`);
			const estimate = estimateRtfBytes(div);
			expect(typeof estimate, name).toBe('number');
			expect(Number.isFinite(estimate), name).toBe(true);
			expect(estimate, name).toBeGreaterThanOrEqual(htmlToRtf(div).length);
		}
	});

	it('the writers write what such an element holds', () => {
		for (const name of NAMES_OF_EVERY_OBJECT) {
			const div = element(`<p>a <${name}>held</${name}> b</p>`);
			// (A name the parser does not take for a tag is text, and written as text.)
			expect(htmlToRtf(div), name).toContain('held');
			expect(htmlToMarkdown(div), name).toContain('held');
		}
	});
});

describe('an element the sanitizer cannot check', () => {
	it('is taken out, and everything after it is still made safe', () => {
		// The sanitizer goes through a document element by element. If one of them makes it fail,
		// for a reason nobody thought of, that one goes: stopping there left the rest of a paste
		// as it came in.
		const root = element('<p>first</p><span id="odd">odd one</span><p onclick="x()" style="position: fixed">last</p>');
		const odd = root.querySelector('#odd')!;
		Object.defineProperty(odd, 'attributes', {
			get() {
				throw new Error('not to be read');
			}
		});
		expect(() => sanitizeTree(root)).not.toThrow();
		expect(root.querySelector('#odd')).toBeNull();
		const last = root.querySelectorAll('p')[1] as HTMLElement;
		expect(last.hasAttribute('onclick')).toBe(false);
		expect(last.style.position).toBe('');
		expect(root.textContent).toBe('firstlast');
	});

	it('and whoever asked is told which one, so that the loss can be said', () => {
		// (It went without a word: a part of a document gone, and nothing to say so.)
		const root = element('<p>first</p><div id="odd"><p>a part of the report</p></div><p>last</p>');
		const odd = root.querySelector('#odd')!;
		Object.defineProperty(odd, 'attributes', {
			get() {
				throw new Error('not to be read');
			}
		});
		const leftOut: Element[] = [];
		sanitizeTree(root, undefined, undefined, undefined, undefined, (el) => leftOut.push(el));
		expect(leftOut).toEqual([odd]);
		expect(root.innerHTML).toBe('<p>first</p><p>last</p>');
	});
});

describe('an element taken out with its words left in its place', () => {
	it('is told of, with the text that holds its words', () => {
		const root = element('<p>one <button>Send</button><textarea>typed</textarea> two <b>kept</b></p>');
		const button = root.querySelector('button')!;
		const area = root.querySelector('textarea')!;
		const told: [Element, Text][] = [];
		sanitizeTree(root, undefined, undefined, undefined, (el, words) => told.push([el, words]));
		expect(told.map(([el, words]) => [el, words.data])).toEqual([[button, 'Send'], [area, ' typed']]);
		expect(told.every(([, words]) => words.parentNode === root.querySelector('p'))).toBe(true);
		expect(root.innerHTML).toBe('<p>one Send typed two <b>kept</b></p>');
	});
});

describe('InkEditor: every way markup comes in is made safe', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;

	function open(props: Record<string, unknown> = {}): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props: { content: '<p>Body</p>', ...props } }) as Record<string, unknown>;
		flushSync();
		return host.querySelector('.ink-content') as HTMLElement;
	}
	const input = (editor: HTMLElement, inputType: string) => {
		const event = new Event('input', { bubbles: true });
		Object.defineProperty(event, 'inputType', { value: inputType });
		editor.dispatchEvent(event);
		flushSync();
	};
	const OUTSIDE =
		'<div class="over" style="position: fixed; top: 0px; left: 0px; z-index: 9999; color: red">over</div>' +
		'<form action="https://x.test/"><input name="q" value="typed"><button>Go</button></form><iframe src="https://x.test/"></iframe>';
	const safe = (editor: HTMLElement) => {
		expect(editor.querySelector('iframe, input, button, [action], [class]')).toBeNull();
		const over = Array.from(editor.querySelectorAll('div')).find((d) => d.textContent === 'over')!;
		expect(over.style.position).toBe('');
		expect(over.style.color).toBe('red');
	};

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
	});

	it('what is dropped on the editor, from another page or from further up this one', () => {
		// (Only a paste was looked at. Markup dragged in went into the document as the browser
		// left it: a block over the whole page, a form, a frame.)
		const editor = open();
		editor.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
		editor.insertAdjacentHTML('beforeend', OUTSIDE);
		input(editor, 'insertFromDrop');
		safe(editor);
	});

	it('what is dragged from one place in the document to another: the browser takes it out first, then puts it in', () => {
		const editor = open();
		editor.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
		input(editor, 'deleteByDrag');
		editor.insertAdjacentHTML('beforeend', OUTSIDE);
		input(editor, 'insertFromDrop');
		safe(editor);
	});

	it('what a drop brings when the editor was not told of the drop', () => {
		const editor = open();
		editor.insertAdjacentHTML('beforeend', OUTSIDE);
		input(editor, 'insertFromDrop');
		safe(editor);
	});

	it('what Redo puts back: the elements a paste was made safe by taking out', () => {
		// (Undo takes a paste out and Redo puts it back as the browser first had it, with the
		// frame the editor had removed.)
		const editor = open();
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		editor.insertAdjacentHTML('beforeend', OUTSIDE);
		input(editor, 'insertFromPaste');
		safe(editor);
		// Undo, then Redo, as the browser does them.
		const pasted = Array.from(editor.children).slice(1);
		pasted.forEach((el) => el.remove());
		input(editor, 'historyUndo');
		editor.insertAdjacentHTML('beforeend', OUTSIDE);
		input(editor, 'historyRedo');
		safe(editor);
	});

	it('what Redo writes back on an element that stayed: the style it was made safe by taking off', () => {
		// (Chromium writes a pasted element's style itself as it pastes, and Redo writes that
		// style again on the same element. The editor had seen that element, and looked only at
		// the ones it had not: "position: fixed" was back, over the page.)
		const editor = open();
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		editor.insertAdjacentHTML('beforeend', '<span style="position: fixed; top: 0px; color: red">over</span>');
		input(editor, 'insertFromPaste');
		const over = editor.querySelector('span') as HTMLElement;
		expect(over.getAttribute('style')).toBe('color: red;');
		// Undo takes the element out; Redo puts the same one back, with the style it first had.
		over.remove();
		input(editor, 'historyUndo');
		over.setAttribute('style', 'position: fixed; top: 0px; color: red');
		editor.append(over);
		input(editor, 'historyRedo');
		expect(editor.querySelector('span')).toBe(over);
		expect(over.getAttribute('style')).toBe('color: red;');
	});

	it('what Redo writes back of the spacing a paste was tidied of', () => {
		const editor = open();
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		editor.insertAdjacentHTML('beforeend', '<p>line <span id="twice" style="text-indent: -48px; color: red">piece</span></p>');
		input(editor, 'insertFromPaste');
		const piece = editor.querySelector('span') as HTMLElement;
		expect(piece.outerHTML).toBe('<span style="color: red;">piece</span>');
		piece.setAttribute('style', 'text-indent: -48px; color: red');
		input(editor, 'historyRedo');
		expect(piece.outerHTML).toBe('<span style="color: red;">piece</span>');
	});

	it('the words of a button are in the document once, however often Redo puts the button back', () => {
		// (The words left where a button is taken out are not in the browser's history. Undo
		// left them, Redo put the button back beside them, and its words were there twice.)
		const editor = open();
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		const button = document.createElement('button');
		button.textContent = 'Send';
		editor.append(button);
		input(editor, 'insertFromPaste');
		expect(editor.innerHTML).toBe('<p>Body</p>Send');
		for (let i = 0; i < 3; i++) {
			input(editor, 'historyUndo');
			editor.querySelector('p')!.after(button);
			input(editor, 'historyRedo');
			expect(editor.innerHTML).toBe('<p>Body</p>Send');
		}
		// Words typed into the ones left are the writer's own: they stay when the button comes back.
		(editor.lastChild as Text).data = 'Send it today';
		editor.append(button);
		input(editor, 'historyRedo');
		expect(editor.innerHTML).toBe('<p>Body</p>Send it todaySend');
	});

	it('Undo of a paste takes the words of its button with it, and Redo puts them back once', () => {
		// (Undo took the paste out and left "Send": a word of a paste the writer had taken back.)
		const editor = open();
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		editor.insertAdjacentHTML('beforeend', '<p>pasted</p><button>Send</button>');
		const [pasted, button] = [editor.children[1], editor.children[2]];
		input(editor, 'insertFromPaste');
		expect(editor.innerHTML).toBe('<p>Body</p><p>pasted</p>Send');
		for (let i = 0; i < 2; i++) {
			pasted.remove();
			input(editor, 'historyUndo');
			expect(editor.innerHTML).toBe('<p>Body</p>');
			editor.append(pasted, button);
			input(editor, 'historyRedo');
			expect(editor.innerHTML).toBe('<p>Body</p><p>pasted</p>Send');
		}
		// An Undo that leaves what the paste brought leaves its words.
		input(editor, 'historyUndo');
		expect(editor.innerHTML).toBe('<p>Body</p><p>pasted</p>Send');
		// And words typed into are the writer's own: they stay when the paste is undone.
		(editor.lastChild as Text).data = 'Send it today';
		pasted.remove();
		input(editor, 'historyUndo');
		expect(editor.innerHTML).toBe('<p>Body</p>Send it today');
	});

	it('an element dragged from one place in the document to another keeps its id, unless another has it', () => {
		// (What is moved comes in as a drop, and what a drop or a paste brings loses its id: it
		// may be in the document already. A moved element was there once, and is there once.)
		const drop = (editor: HTMLElement, markup: string, own: boolean) => {
			if (own) editor.dispatchEvent(new Event('dragstart', { bubbles: true }));
			editor.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
			if (own) input(editor, 'deleteByDrag');
			editor.insertAdjacentHTML('beforeend', markup);
			input(editor, 'insertFromDrop');
			editor.dispatchEvent(new Event('dragend', { bubbles: true }));
		};
		const editor = open();
		drop(editor, '<p><b id="mark1">moved</b></p>', true);
		expect(editor.querySelectorAll('#mark1')).toHaveLength(1);
		// Held down to copy, the same drag leaves the first one where it was: the copy has no id.
		drop(editor, '<p><b id="mark1">copied</b></p>', true);
		expect(Array.from(editor.querySelectorAll('b')).map((b) => b.id)).toEqual(['mark1', '']);
		// And what comes from another page has none, as before.
		drop(editor, '<p><b id="mark2">from outside</b></p>', false);
		expect(editor.querySelector('#mark2')).toBeNull();
	});

	it('a part that cannot be checked is taken out, the rest is kept, and it is said', () => {
		const editor = open();
		editor.insertAdjacentHTML('beforeend', '<div><p>a part of the report</p></div><p onclick="x()">the rest</p>');
		Object.defineProperty(editor.querySelector('div')!, 'attributes', {
			get() {
				throw new Error('not to be read');
			}
		});
		input(editor, 'insertFromDrop');
		expect(editor.innerHTML).toBe('<p>Body</p><p>the rest</p>');
		expect(host!.querySelector('[role="alert"]')?.textContent).toContain('part was left out');
	});

	it('Undo and Redo leave a document that is safe as it was', () => {
		const written = '<p id="keep" style="margin-left: 48px">Body <a href="https://x.test/">link</a></p><ul><li>item</li></ul>';
		const editor = open({ content: written });
		input(editor, 'historyUndo');
		input(editor, 'historyRedo');
		expect(editor.innerHTML).toBe(written);
	});

	it('a document with an element named "constructor" opens, and one set later takes the place of the one before', () => {
		const editor = open({ content: '<p>Patient A</p><constructor data-x="1">a</constructor>' });
		expect(editor.textContent).toContain('Patient A');
		(component as unknown as { setHTML(html: string): void }).setHTML('<p>Patient B</p><constructor data-x="1">b</constructor>');
		expect(editor.textContent).toContain('Patient B');
		expect(editor.textContent).not.toContain('Patient A');
	});
});

describe('InkEditor: Ctrl+S', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;
	const saves: string[] = [];

	function open(props: Record<string, unknown>): HTMLElement {
		saves.length = 0;
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, {
			target: host,
			props: { content: '<p>Report</p>', onsave: (p: { html: string }) => saves.push(p.html), ...props }
		}) as Record<string, unknown>;
		flushSync();
		return host.querySelector('.ink-content') as HTMLElement;
	}
	const ctrlS = (editor: HTMLElement) => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
	});

	it('fires onsave where autosave is off, which is the default, and keeps no draft', () => {
		// (Since autosave is off unless asked for, Ctrl+S did nothing at all: the key was taken
		// from the browser and onsave was never called.)
		const editor = open({});
		ctrlS(editor);
		expect(saves).toEqual(['<p>Report</p>']);
		expect(localStorage.length).toBe(0);
	});

	it('fires onsave once and keeps the draft where autosave is on', () => {
		const editor = open({ autosave: true, storageKey: 'report-9' });
		ctrlS(editor);
		expect(saves).toEqual(['<p>Report</p>']);
		expect(localStorage.getItem('report-9')).toBe('<p>Report</p>');
	});

	it('does not hand the key to the browser, which would offer to save the page', () => {
		const editor = open({});
		const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
		editor.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});
});
