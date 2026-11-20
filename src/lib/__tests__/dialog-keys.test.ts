import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

/**
 * The keyboard in a dialog of the editor (the Insert Link dialog here): it has the keyboard
 * while it is open, Tab goes round it and not on into the page behind it, Escape closes it,
 * and the keyboard goes back to where it was. Every step of Tab is made by the dialog itself:
 * Safari's Tab goes to text fields alone, and from the last one it went out of the dialog.
 */

// happy-dom lacks the toolbar's state queries.
const doc = document as Document & { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

let host: HTMLDivElement | null = null;
let component: Record<string, unknown> | null = null;

afterEach(() => {
	if (component) unmount(component);
	host?.remove();
	component = null;
	host = null;
});

/** The dialog, open: its fields and buttons in order, and which of them has the keyboard first (the address). */
function openDialog(): { editor: HTMLElement; fields: HTMLElement[]; first: number } {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content: '<p>see here</p>', autosave: false } }) as Record<string, unknown>;
	flushSync();
	const editor = host.querySelector('.ink-content') as HTMLElement;
	editor.focus();
	(host.querySelector('button[title^="Insert link"]') as HTMLButtonElement).click();
	flushSync();
	const fields = Array.from(document.querySelectorAll<HTMLElement>('.modal input, .modal button'));
	return { editor, fields, first: fields.findIndex((field) => field.hasAttribute('data-autofocus')) };
}

function key(name: string, shiftKey = false): KeyboardEvent {
	const e = new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true });
	window.dispatchEvent(e);
	flushSync();
	return e;
}

const dialog = () => document.querySelector('.modal');

describe('the keyboard in a dialog', () => {
	it('is the dialog\'s when it opens: the field to type in has it', () => {
		const { fields, first } = openDialog();
		expect(dialog()?.getAttribute('aria-modal')).toBe('true');
		expect(fields.length).toBeGreaterThanOrEqual(4);
		expect(first).toBeGreaterThanOrEqual(0);
		expect(document.activeElement).toBe(fields[first]);
		expect((fields[first] as HTMLInputElement).type).toBe('url');
	});

	it('Tab goes to each field and button in turn, and from the last to the first', () => {
		const { fields, first } = openDialog();
		for (let step = 1; step <= fields.length; step++) {
			const e = key('Tab');
			expect(e.defaultPrevented).toBe(true);
			expect(document.activeElement).toBe(fields[(first + step) % fields.length]);
		}
	});

	it('Shift+Tab goes back, and from the first to the last', () => {
		const { fields, first } = openDialog();
		for (let step = 1; step <= fields.length; step++) {
			expect(key('Tab', true).defaultPrevented).toBe(true);
			expect(document.activeElement).toBe(fields[(first - step + 2 * fields.length) % fields.length]);
		}
	});

	it('what a field holds is selected when Tab comes to it, to be typed over', () => {
		const { fields, first } = openDialog();
		const address = fields[first] as HTMLInputElement;
		address.value = 'https://example.org/a';
		address.setSelectionRange(3, 3);
		key('Tab');
		// (A button has nothing to select.)
		expect(document.activeElement).not.toBe(address);
		key('Tab', true);
		expect(document.activeElement).toBe(address);
		expect([address.selectionStart, address.selectionEnd]).toEqual([0, address.value.length]);
	});

	it('Tab pressed with the keyboard outside the dialog brings it in: to the first field, or the last with Shift', () => {
		const { editor, fields } = openDialog();
		editor.focus();
		expect(key('Tab').defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(fields[0]);
		editor.focus();
		key('Tab', true);
		expect(document.activeElement).toBe(fields[fields.length - 1]);
	});

	it('another key is left alone', () => {
		const { fields, first } = openDialog();
		expect(key('a').defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(fields[first]);
		expect(dialog()).not.toBeNull();
	});

	it('Escape closes it, and the keyboard is back in the document', () => {
		const { editor } = openDialog();
		const e = key('Escape');
		expect(e.defaultPrevented).toBe(true);
		expect(dialog()).toBeNull();
		expect(document.activeElement).toBe(editor);
		// With no dialog open, the keys are the page's again.
		expect(key('Tab').defaultPrevented).toBe(false);
		expect(key('Escape').defaultPrevented).toBe(false);
	});

	it('Cancel closes it too', () => {
		const { editor, fields } = openDialog();
		fields.find((field) => field.textContent?.trim() === 'Cancel')!.click();
		flushSync();
		expect(dialog()).toBeNull();
		expect(document.activeElement).toBe(editor);
	});

	it('a click beside it closes it; a click in it does not', () => {
		openDialog();
		dialog()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(dialog()).not.toBeNull();
		document.querySelector('.modal-overlay')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(dialog()).toBeNull();
	});

	it('the keyboard is not taken back from whoever has it when the dialog closes', () => {
		openDialog();
		const elsewhere = document.createElement('input');
		document.body.appendChild(elsewhere);
		try {
			elsewhere.focus();
			document.querySelector('.modal-overlay')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			flushSync();
			expect(dialog()).toBeNull();
			expect(document.activeElement).toBe(elsewhere);
		} finally {
			elsewhere.remove();
		}
	});
});
