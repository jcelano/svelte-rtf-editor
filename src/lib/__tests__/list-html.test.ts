import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { htmlToRtf } from '../rtf-writer.js';

/**
 * The HTML of a list made with the toolbar.
 *
 * Chromium's and Safari's list commands leave the list inside the paragraph it was made from
 * (<p><ul>…</ul></p>), and the line typed after the list inside it too. No HTML says that: an
 * application that kept getHTML() and showed it again got an empty paragraph, the list, and
 * another empty paragraph, and an empty line before and after the list in the RTF. What the
 * editor hands out has the list beside the paragraph. No HTML parser builds the shape, so it
 * is built here as the command builds it. Invented text.
 */

const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

type Editor = { getHTML(): string; getRTF(): string; setHTML(html: string): void };

let host: HTMLElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
	localStorage.clear();
});

function open(content: string, props: Record<string, unknown> = {}): { editor: HTMLElement; api: Editor } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content, autosave: false, ...props } }) as Record<string, unknown>;
	flushSync();
	return { editor: host.querySelector('.ink-content') as HTMLElement, api: component as unknown as Editor };
}

/** Put `innerHtml` inside the editor's nth paragraph, as a browser's command does and a parser cannot. */
function inside(editor: HTMLElement, innerHtml: string, nth = 0): void {
	editor.querySelectorAll('p')[nth].innerHTML = innerHtml;
}
const LIST = '<ul><li>skin</li><li>node</li></ul>';
const body = (rtf: string) => rtf.slice(rtf.indexOf('\\fs24 ') + 6);

describe('getHTML: a list the browser left inside a paragraph', () => {
	it('is handed out beside it, with no empty paragraph around it', () => {
		const { editor, api } = open('<p>Specimens</p><p>x</p><p>Diagnosis</p>');
		inside(editor, LIST, 1);
		expect(editor.innerHTML).toBe(`<p>Specimens</p><p>${LIST}</p><p>Diagnosis</p>`);
		expect(api.getHTML()).toBe(`<p>Specimens</p>${LIST}<p>Diagnosis</p>`);
	});

	it('reads back as the same document: the same RTF, where it had an empty line before the list and after it', () => {
		const { editor, api } = open('<p>Specimens</p><p>x</p>');
		inside(editor, LIST, 1);
		const rtf = api.getRTF();
		expect(body(rtf)).toBe('\\pard Specimens\\par \\pard\\li720\\fi-360\\bullet\\tab skin\\par \\pard\\li720\\fi-360\\bullet\\tab node\\par }');
		const kept = api.getHTML();
		api.setHTML(kept);
		expect(api.getHTML()).toBe(kept);
		expect(api.getRTF()).toBe(rtf);
		// (What a browser's parser made of it as it was handed out before, an empty paragraph
		// on each side of the list, is in the browser tests.)
	});

	it('the line typed after the list, which the browser leaves in the paragraph too, is a block after it', () => {
		const { editor, api } = open('<p>x</p>');
		inside(editor, `${LIST}<div>after</div>`);
		expect(api.getHTML()).toBe(`${LIST}<div>after</div>`);
		const rtf = api.getRTF();
		api.setHTML(api.getHTML());
		expect(api.getRTF()).toBe(rtf);
	});

	it('what the paragraph held before the list and after it are paragraphs of their own, as the paragraph was', () => {
		const { editor, api } = open('<p style="text-align:center">x</p>');
		inside(editor, `Parts:${LIST}<b>and</b> margins<ol><li>one</li></ol>`);
		expect(api.getHTML().replace(/text-align: ?center;?/g, 'text-align:center')).toBe(
			`<p style="text-align:center">Parts:</p>${LIST}<p style="text-align:center"><b>and</b> margins</p><ol><li>one</li></ol>`
		);
	});

	it('a line break the browser left beside the list is no paragraph', () => {
		const { editor, api } = open('<p>x</p><p>After</p>');
		inside(editor, `${LIST}<br>`);
		expect(api.getHTML()).toBe(`${LIST}<p>After</p>`);
	});

	it('a comment of the application\'s own beside the list is kept, where an empty line is not', () => {
		const { editor, api } = open('<p>x</p>', { keepAttributes: [] });
		const paragraph = editor.querySelector('p')!;
		paragraph.innerHTML = LIST;
		paragraph.append(document.createComment('kept by the application'), '\n');
		expect(api.getHTML()).toBe(`${LIST}<!--kept by the application-->`);
	});

	it('paragraphs a paste left inside a paragraph, as Firefox leaves them, are paragraphs beside it', () => {
		const { editor, api } = open('<p>x</p>');
		inside(editor, 'Body<p>First.</p><p>Second.</p>');
		expect(api.getHTML()).toBe('<p>Body</p><p>First.</p><p>Second.</p>');
	});

	it('the list buttons are on in a list of their kind: the innermost, for a list within a list', () => {
		const { editor } = open('<ul><li>bulleted</li></ul><ol><li>numbered<ul><li>within</li></ul></li></ol><p>neither</p>');
		const pressed = () => ['Bullet list', 'Numbered list'].map((title) => document.querySelector(`.toolbar button[title="${title}"]`)!.getAttribute('aria-pressed'));
		const caretIn = (text: string) => {
			const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
			let node = walker.nextNode();
			while (node && node.textContent !== text) node = walker.nextNode();
			window.getSelection()!.collapse(node, 1);
			editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			flushSync();
		};
		caretIn('bulleted');
		expect(pressed()).toEqual(['true', 'false']);
		caretIn('numbered');
		expect(pressed()).toEqual(['false', 'true']);
		caretIn('within');
		expect(pressed()).toEqual(['true', 'false']);
		caretIn('neither');
		expect(pressed()).toEqual(['false', 'false']);
	});

	it('reading the HTML changes nothing in the document being edited; the next input puts the list beside its paragraph there too', () => {
		const { editor, api } = open('<p>x</p>');
		inside(editor, LIST);
		api.getHTML();
		expect(editor.innerHTML).toBe(`<p>${LIST}</p>`);
		// (The editor's Undo puts the document back from its HTML, and no HTML says a list
		// inside a paragraph: so the document does not stay one.)
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		expect(editor.innerHTML).toBe(LIST);
	});

	it('a document with no such paragraph is handed out as it is', () => {
		const html = `<p>Specimens</p>${LIST}<div><ol><li>one</li></ol></div><table><tbody><tr><td><p>in a cell</p></td></tr></tbody></table>`;
		const { editor, api } = open(html);
		expect(api.getHTML()).toBe(editor.innerHTML);
	});
});

describe('the same HTML wherever the editor hands the document out', () => {
	it('onchange, onsave and the draft kept by autosave', () => {
		let changed = '';
		let saved = '';
		const { editor } = open('<p>Specimens</p><p>x</p>', {
			autosave: true,
			storageKey: 'list-html-test',
			onchange: (e: { html: string }) => (changed = e.html),
			onsave: (e: { html: string }) => (saved = e.html)
		});
		inside(editor, LIST, 1);
		editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
		flushSync();
		expect(changed).toBe(`<p>Specimens</p>${LIST}`);
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
		flushSync();
		expect(saved).toBe(`<p>Specimens</p>${LIST}`);
		expect(localStorage.getItem('list-html-test')).toBe(`<p>Specimens</p>${LIST}`);
	});

	it('is what the RTF writer makes the same RTF of', () => {
		const { editor, api } = open('<p>Specimens</p><p>x</p><p>Diagnosis</p>');
		inside(editor, `${LIST}<div>after</div>`, 1);
		const handedOut = document.createElement('div');
		handedOut.innerHTML = api.getHTML();
		expect(body(htmlToRtf(handedOut))).toBe(body(api.getRTF()));
	});
});
