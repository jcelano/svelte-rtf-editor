import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

/**
 * A link in the document: a click in the text puts the caret there, as in any editor, and the
 * link is opened with Ctrl or Cmd held, in a tab of its own that is not handed this page. A
 * note at the link says so, with the address. Where the document cannot be edited a plain
 * click opens it. Only an address a link may have is ever opened. Invented text.
 */

// happy-dom lacks the toolbar's state queries.
const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

const REPORT = '<p>See the <a href="https://example.org/protocol">protocol</a> and <a href="mailto:lab@example.org"><b>write</b> to the lab</a>.</p><p>No link here.</p>';

let host: HTMLDivElement | null = null;
let component: Record<string, unknown> | null = null;
/** Each link the editor opened: where, in what, and what it is told of this page. */
let opened: { href: string; target: string; rel: string }[] = [];
/** Whether the editor took each click for its own, before this test stopped the click. */
let taken: boolean[] = [];
const stopClick = (e: Event) => {
	taken.push(e.defaultPrevented);
	// (Nothing is to follow a link in a test.)
	e.preventDefault();
};

beforeEach(() => {
	opened = [];
	taken = [];
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
		opened.push({ href: this.href, target: this.target, rel: this.rel });
	});
	document.body.addEventListener('click', stopClick);
});

afterEach(() => {
	document.body.removeEventListener('click', stopClick);
	vi.restoreAllMocks();
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
});

function open(props: Record<string, unknown> = {}): { editor: HTMLElement; links: HTMLAnchorElement[] } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content: REPORT, autosave: false, ...props } }) as Record<string, unknown>;
	flushSync();
	const editor = host.querySelector('.ink-content') as HTMLElement;
	return { editor, links: Array.from(editor.querySelectorAll('a')) };
}

function mouse(type: string, on: Element, init: MouseEventInit = {}): MouseEvent {
	const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
	on.dispatchEvent(e);
	flushSync();
	return e;
}

const note = () => host!.querySelector('.ink-link-hint');
const noteAddress = () => host!.querySelector('.ink-link-hint-address')?.textContent ?? null;

describe('a click on a link', () => {
	it('with Ctrl or Cmd opens it, in a tab of its own that is told nothing of this page', () => {
		const { links } = open();
		mouse('click', links[0], { ctrlKey: true });
		mouse('click', links[0], { metaKey: true });
		expect(opened).toEqual([
			{ href: 'https://example.org/protocol', target: '_blank', rel: 'noopener noreferrer' },
			{ href: 'https://example.org/protocol', target: '_blank', rel: 'noopener noreferrer' }
		]);
		expect(taken).toEqual([true, true]);
	});

	it('on words inside the link, too', () => {
		const { links } = open();
		mouse('click', links[1].querySelector('b')!, { ctrlKey: true });
		expect(opened.map((link) => link.href)).toEqual(['mailto:lab@example.org']);
	});

	it('alone opens nothing: it puts the caret in the words', () => {
		const { editor, links } = open();
		mouse('click', links[0]);
		mouse('click', editor.querySelectorAll('p')[1], { ctrlKey: true });
		expect(opened).toEqual([]);
		expect(taken).toEqual([false, false]);
	});

	it('opens no address a link may not have', () => {
		const { editor } = open();
		const risky = document.createElement('a');
		risky.setAttribute('href', 'javascript:window.__ran=1');
		risky.textContent = 'risky';
		editor.querySelector('p')!.appendChild(risky);
		mouse('click', risky, { ctrlKey: true });
		expect(opened).toEqual([]);
		// The click is still the editor's: the browser is not to follow it either.
		expect(taken).toEqual([true]);
	});

	it('where the document cannot be edited, a plain click opens it, and a click with a key down is the browser\'s', () => {
		const { links } = open({ readonly: true });
		mouse('click', links[0]);
		expect(opened).toEqual([{ href: 'https://example.org/protocol', target: '_blank', rel: 'noopener noreferrer' }]);
		expect(taken).toEqual([true]);
		for (const held of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) mouse('click', links[0], held);
		expect(opened).toHaveLength(1);
		expect(taken).toEqual([true, false, false, false, false]);
	});
});

describe('the note at a link', () => {
	it('is shown with the pointer over the link, with its address, and goes when the pointer leaves', () => {
		const { editor, links } = open();
		expect(note()).toBeNull();
		mouse('mouseover', links[0]);
		expect(note()?.getAttribute('role')).toBe('tooltip');
		expect(noteAddress()).toBe('https://example.org/protocol');
		// Over the same link again: the same note.
		mouse('mouseover', links[0]);
		expect(host!.querySelectorAll('.ink-link-hint')).toHaveLength(1);
		mouse('mouseout', links[0], { relatedTarget: editor.querySelector('p') });
		expect(note()).toBeNull();
	});

	it('stays while the pointer moves inside the link, and is the other link\'s over the other', () => {
		const { links } = open();
		const bold = links[1].querySelector('b')!;
		mouse('mouseover', bold);
		expect(noteAddress()).toBe('mailto:lab@example.org');
		mouse('mouseout', bold, { relatedTarget: links[1] });
		expect(noteAddress()).toBe('mailto:lab@example.org');
		mouse('mouseover', links[0]);
		expect(noteAddress()).toBe('https://example.org/protocol');
		// Out of the window: there is nothing the pointer went to.
		mouse('mouseout', links[0]);
		expect(note()).toBeNull();
	});

	it('is under the line the pointer is on, or over it where the window ends', () => {
		const { links } = open();
		const rect = (top: number) => ({ top, bottom: top + 20, left: 30, right: 130, width: 100, height: 20, x: 30, y: top, toJSON: () => ({}) }) as DOMRect;
		// A link over two lines: the note is at the one the pointer is on.
		links[0].getClientRects = () => [rect(100), rect(120)] as unknown as DOMRectList;
		mouse('mouseover', links[0], { clientY: 130 });
		expect(note()!.classList.contains('above')).toBe(false);
		expect((note() as HTMLElement).style.top).toBe('146px');
		mouse('mouseout', links[0]);
		// At the foot of the window there is no room under it.
		links[0].getClientRects = () => [rect(window.innerHeight - 30)] as unknown as DOMRectList;
		mouse('mouseover', links[0], { clientY: window.innerHeight - 20 });
		expect(note()!.classList.contains('above')).toBe(true);
		expect((note() as HTMLElement).style.top).toBe(`${window.innerHeight - 36}px`);
	});

	it('is not shown while a button is down (text is being selected), nor for an address a link may not have', () => {
		const { editor, links } = open();
		mouse('mouseover', links[0], { buttons: 1 });
		expect(note()).toBeNull();
		const risky = document.createElement('a');
		risky.setAttribute('href', 'javascript:void 0');
		risky.textContent = 'risky';
		editor.querySelector('p')!.appendChild(risky);
		mouse('mouseover', risky);
		mouse('mouseover', editor.querySelectorAll('p')[1]);
		expect(note()).toBeNull();
		// Nor is there one to take away.
		mouse('mouseout', links[0]);
		expect(note()).toBeNull();
	});

	it('goes when a key is typed, a button is pressed in the text, or the window is left or resized', () => {
		const { editor, links } = open();
		const shown = () => {
			mouse('mouseout', links[0]);
			mouse('mouseover', links[0]);
			expect(note()).not.toBeNull();
		};
		shown();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
		flushSync();
		expect(note()).toBeNull();
		shown();
		mouse('mousedown', editor);
		expect(note()).toBeNull();
		shown();
		window.dispatchEvent(new Event('blur'));
		flushSync();
		expect(note()).toBeNull();
		shown();
		window.dispatchEvent(new Event('resize'));
		flushSync();
		expect(note()).toBeNull();
	});

	it('stays while Ctrl or Cmd is pressed, which is what opens the link: the link is then shown as one to click', () => {
		const { editor, links } = open();
		mouse('mouseover', links[0]);
		expect(editor.classList.contains('links-open')).toBe(false);
		for (const [key, held] of [['Control', { ctrlKey: true }], ['Meta', { metaKey: true }]] as const) {
			window.dispatchEvent(new KeyboardEvent('keydown', { key, ...held }));
			flushSync();
			expect(note()).not.toBeNull();
			expect(editor.classList.contains('links-open')).toBe(true);
			window.dispatchEvent(new KeyboardEvent('keyup', { key }));
			flushSync();
			expect(editor.classList.contains('links-open')).toBe(false);
		}
		// With the key down already when the pointer comes to the link.
		mouse('mouseout', links[0]);
		mouse('mouseover', links[0], { ctrlKey: true });
		expect(editor.classList.contains('links-open')).toBe(true);
		// Leaving the window lets go of it.
		window.dispatchEvent(new Event('blur'));
		flushSync();
		expect(editor.classList.contains('links-open')).toBe(false);
	});

	it('is not shown where the document cannot be edited: a click opens the link there', () => {
		const { editor, links } = open({ readonly: true });
		mouse('mouseover', links[0], { ctrlKey: true });
		expect(note()).toBeNull();
		expect(editor.classList.contains('links-open')).toBe(false);
	});
});
