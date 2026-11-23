// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InkEditor from '../components/InkEditor.svelte';
import { TOOLBAR_TOOLS, knownTools, toolbarRow } from '../toolbar-tools.js';
import * as lib from '../index.js';

/** The toolbar's controls by name, `tools` and `moreTools` (issue 52). Where they are on the screen is in e2e/editor.spec.ts. */

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
	mounted.splice(0).forEach((m) => unmount(m));
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});
function editor(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mounted.push(mount(InkEditor, { target, props }));
	flushSync();
	return target;
}
const names = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>('[data-tool]')).map((el) => el.dataset.tool);

describe('TOOLBAR_TOOLS', () => {
	it('names every control once, in the order of the toolbar, and is exported', () => {
		expect(TOOLBAR_TOOLS).toEqual([
			'block', 'font', 'fontSize', 'bold', 'italic', 'underline', 'strikethrough', 'textColor', 'clearFormatting',
			'bulletList', 'numberedList', 'alignLeft', 'alignCenter', 'alignRight', 'outdent', 'indent', 'hangingOutdent',
			'hangingIndent', 'hangAtCaret', 'rightOutdent', 'rightIndent', 'spacing', 'copyFormat', 'link', 'image', 'table',
			'horizontalRule', 'undo', 'redo'
		]);
		expect(lib.TOOLBAR_TOOLS).toBe(TOOLBAR_TOOLS);
		expect(Object.isFrozen(TOOLBAR_TOOLS)).toBe(true);
	});

	it('knownTools keeps the known names and warns once of each other one', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect([...knownTools(['bold', 'bold', 'Bold', 'heading', 'undo'], 'tools')]).toEqual(['bold', 'undo']);
		knownTools(['heading'], 'tools');
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn.mock.calls[0][0]).toContain('"Bold"');
		expect([...knownTools(undefined, 'tools')]).toEqual([]);
		expect([...knownTools('bold' as never, 'tools')]).toEqual([]);
	});

	it('toolbarRow leaves out empty groups and sections', () => {
		expect(toolbarRow((tool) => tool === 'bold' || tool === 'redo')).toEqual([[['bold']], [['redo']]]);
		expect(toolbarRow(() => false)).toEqual([]);
	});
});

describe('InkEditor: tools and moreTools', () => {
	it('every control carries its name; the lists only where they have something to offer', () => {
		expect(names(editor({ fonts: ['Georgia'] }))).toEqual([...TOOLBAR_TOOLS]);
		expect(names(editor({ fontSizes: [] }))).not.toContain('fontSize');
		expect(names(editor())).not.toContain('font');
	});

	it('tools renders the controls named, in the editor\'s order, with dividers only between sections', () => {
		const root = editor({ tools: ['redo', 'bold', 'italic'] });
		expect(names(root)).toEqual(['bold', 'italic', 'redo']);
		expect(root.querySelectorAll('.toolbar-divider')).toHaveLength(1);
		expect(root.querySelector('[data-tool-more]')).toBeNull();
		const one = editor({ tools: ['bold'] });
		expect(names(one)).toEqual(['bold']);
		expect(one.querySelectorAll('.toolbar-divider')).toHaveLength(0);
	});

	it('moreTools puts its controls in a hidden second row, and More opens it', () => {
		const toggled: boolean[] = [];
		const root = editor({ tools: ['bold', 'italic', 'link'], moreTools: ['link', 'italic', 'table'], onmoretoggle: (open: boolean) => toggled.push(open) });
		const [first, second] = Array.from(root.querySelectorAll('.toolbar-row'));
		expect(names(first)).toEqual(['bold']);
		expect(names(second)).toEqual(['italic', 'link']);
		expect((second as HTMLElement).hidden).toBe(true);
		const button = root.querySelector<HTMLButtonElement>('[data-tool-more]')!;
		expect(button.getAttribute('aria-controls')).toBe(second.id);
		expect(button.getAttribute('aria-expanded')).toBe('false');
		button.click();
		flushSync();
		expect((second as HTMLElement).hidden).toBe(false);
		expect(button.getAttribute('aria-expanded')).toBe('true');
		button.click();
		flushSync();
		expect(toggled).toEqual([true, false]);
	});

	it('More is there only where its row has a control, and takes words of the application', () => {
		expect(editor({ moreTools: ['font'] }).querySelector('[data-tool-more]')).toBeNull();
		const root = editor({ moreTools: ['link'], moreOpen: true, moreLabel: 'Mehr', lessLabel: 'Weniger' });
		const button = root.querySelector('[data-tool-more]')!;
		expect(button.textContent).toContain('Mehr');
		expect(button.querySelector('.shown')!.textContent).toBe('Weniger');
		expect(button.getAttribute('aria-expanded')).toBe('true');
		// Each toolbar's row has an id of its own.
		const other = editor({ moreTools: ['link'] });
		expect(other.querySelector('.toolbar-more')!.id).not.toBe(root.querySelector('.toolbar-more')!.id);
	});
});
