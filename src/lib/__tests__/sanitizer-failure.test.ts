// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// The sanitizer, made to fail on a document that says so: what the editor does when the check
// itself cannot be done, for a reason nobody has thought of yet.
vi.mock('../sanitize.js', async (original) => {
	const real = await original<typeof import('../sanitize.js')>();
	return {
		...real,
		sanitizedNodes: (html: string, ...rest: [Document]) => {
			if (html.includes('THE-CHECK-FAILS')) throw new Error('the check failed');
			return real.sanitizedNodes(html, ...rest);
		},
		sanitizeTree: (root: Element, ...rest: []) => {
			if (root.querySelector('[title="THE-CHECK-FAILS"]')) throw new Error('the check failed');
			return real.sanitizeTree(root, ...rest);
		}
	};
});

const { default: InkEditor } = await import('../components/InkEditor.svelte');

const doc = document as unknown as { queryCommandState?: () => boolean; queryCommandValue?: () => string };
doc.queryCommandState ??= () => false;
doc.queryCommandValue ??= () => '';

describe('InkEditor: a document that cannot be checked is not shown, and nothing else is shown in its place', () => {
	let host: HTMLElement | null = null;
	let component: Record<string, unknown> | null = null;

	function open(props: Record<string, unknown>): HTMLElement {
		host = document.createElement('div');
		document.body.appendChild(host);
		component = mount(InkEditor, { target: host, props }) as Record<string, unknown>;
		flushSync();
		return host.querySelector('.ink-content') as HTMLElement;
	}

	afterEach(() => {
		if (component) unmount(component);
		host?.remove();
		component = null;
		host = null;
	});

	it('given as content: the editor still opens, empty, and says the document could not be shown', () => {
		// (The failure went up through the component as it was made: there was no editor.)
		const editor = open({ content: '<p>THE-CHECK-FAILS</p>' });
		expect(editor).not.toBeNull();
		expect(editor.innerHTML).toBe('<p><br></p>');
		expect(host!.querySelector('[role="alert"]')?.textContent).toContain('could not be shown');
	});

	it('given to setHTML: the document before it does not stay on the screen as if it were the new one', () => {
		// (setHTML threw and the report of the patient before was still what the editor showed.)
		const editor = open({ content: '<p>Patient A</p>' });
		const api = component as unknown as { setHTML(html: string): void; getText(): string };
		expect(() => api.setHTML('<p>Patient B THE-CHECK-FAILS</p>')).toThrow(/could not be shown/);
		flushSync();
		expect(editor.textContent).not.toContain('Patient A');
		expect(editor.innerHTML).toBe('<p><br></p>');
		expect(host!.querySelector('[role="alert"]')?.textContent).toContain('could not be shown');
	});

	it('pasted: all of the paste is left out, and what was there stays', () => {
		const editor = open({ content: '<p>Body</p>' });
		editor.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
		editor.insertAdjacentHTML('beforeend', '<p title="THE-CHECK-FAILS">pasted</p><iframe src="https://x.test/"></iframe><p>more</p>');
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(editor.innerHTML).toBe('<p>Body</p>');
		expect(host!.querySelector('[role="alert"]')?.textContent).toContain('left out');
	});
});
