import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';

/**
 * The editor's Insert Link dialog refuses an address a reader can't safely follow, and says why,
 * instead of closing as if the link had been added (#3).
 */

// happy-dom lacks the toolbar's state queries.
const doc = document as Document & {
	queryCommandState?: () => boolean;
	queryCommandValue?: () => string;
	execCommand?: (...args: unknown[]) => boolean;
};
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

function openDialog() {
	host = document.createElement('div');
	document.body.appendChild(host);
	component = mount(InkEditor, { target: host, props: { content: '<p>see here</p>', autosave: false } }) as Record<string, unknown>;
	flushSync();
	(host.querySelector('button[title^="Insert link"]') as HTMLButtonElement).click();
	flushSync();
	const [, url] = Array.from(document.querySelectorAll<HTMLInputElement>('.modal input'));
	return url;
}

function insert() {
	const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.modal button')).find(
		(b) => b.textContent?.trim() === 'Insert'
	)!;
	button.click();
	flushSync();
}

describe('the Insert Link dialog', () => {
	for (const address of ['javascript:alert(1)', 'ftp://example.org/x', '\\\\server\\share\\x.exe', '../x.exe']) {
		it(`stays open and says why for ${JSON.stringify(address)}`, () => {
			const url = openDialog();
			url.value = address;
			url.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
			insert();
			expect(document.querySelector('.modal')).not.toBeNull();
			const error = document.querySelector('[role="alert"]');
			expect(error?.textContent).toMatch(/web address/);
			expect(url.getAttribute('aria-invalid')).toBe('true');
			expect(host!.querySelector('.ink-content a')).toBeNull();
		});
	}

	it('closes for a web address, with no message', () => {
		const calls: unknown[][] = [];
		const before = doc.execCommand;
		doc.execCommand = (...args: unknown[]) => { calls.push(args); return true; };
		try {
			const url = openDialog();
			url.value = 'https://example.org/a';
			url.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
			insert();
		} finally {
			doc.execCommand = before;
		}
		expect(document.querySelector('.modal')).toBeNull();
		expect(calls).toEqual([['createLink', false, 'https://example.org/a']]);
	});
});
