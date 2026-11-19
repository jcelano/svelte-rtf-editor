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

	it('and what was already made safe is not gone over again on every Undo', () => {
		const editor = open({ content: '<p id="keep" style="margin-left: 48px">Body</p>' });
		const first = editor.firstElementChild as HTMLElement;
		const read = vi.spyOn(first, 'getAttribute');
		input(editor, 'historyUndo');
		input(editor, 'historyRedo');
		expect(read).not.toHaveBeenCalled();
		expect(first.outerHTML).toBe('<p id="keep" style="margin-left: 48px">Body</p>');
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
