import { test, expect, type Page } from '@playwright/test';

// Part 1 of the request "Fields: places in a document that the writer fills by choosing or
// typing": text and HTML put in at the caret from code. These tests drive the page the
// repository already has (src/routes/e2e), and need nothing of Part 2, so they can be merged
// with Part 1 alone.

type Editor = {
	getHTML(): string;
	undo(): boolean;
	redo(): boolean;
	insertText(text: string): boolean;
	insertFragment(html: string): unknown[] | null;
};
type Harness = { ed: Editor; lib: unknown; __ran?: string };

const content = '.ink-content';
const REWRITTEN = 'WebKit rewrites the HTML a script puts on the clipboard, so there is no paste to compare with';

async function open(page: Page, query: Record<string, string> = {}): Promise<void> {
	await page.goto(`/e2e?${new URLSearchParams(query)}`);
	await page.waitForFunction(() => !!(window as unknown as Harness).ed && !!(window as unknown as Harness).lib);
}

/** Call a method of the editor in the page. */
function call<K extends keyof Editor>(page: Page, method: K, ...args: Parameters<Editor[K]>): Promise<ReturnType<Editor[K]>> {
	return page.evaluate(
		([name, given]) => (window as unknown as { ed: Record<string, (...a: unknown[]) => unknown> }).ed[name](...given),
		[method as string, args as unknown[]] as const
	) as Promise<ReturnType<Editor[K]>>;
}
const html = (page: Page) => call(page, 'getHTML');
const ran = (page: Page) => page.evaluate(() => (window as unknown as Harness).__ran);

/** Put the caret, or a selection, at `words` where they first appear in the document. */
async function place(page: Page, words: string, how: 'before' | 'after' | 'select'): Promise<void> {
	await page.evaluate(
		({ words, how }) => {
			const root = document.querySelector<HTMLElement>('.ink-content')!;
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const at = (node.nodeValue ?? '').indexOf(words);
				if (at < 0) continue;
				const range = document.createRange();
				range.setStart(node, how === 'after' ? at + words.length : at);
				range.setEnd(node, how === 'before' ? at : at + words.length);
				root.focus();
				const selection = getSelection()!;
				selection.removeAllRanges();
				selection.addRange(range);
				return;
			}
			throw new Error(`"${words}" is not in the document`);
		},
		{ words, how }
	);
}

test.describe('text and HTML at the caret', () => {
	const two = { content: '<p>one two</p>' };

	test('insertText puts the words at the caret, leaves the caret after them, and is one Undo step', async ({ page }) => {
		await open(page, two);
		await place(page, 'one', 'after');
		expect(await call(page, 'insertText', ' and a half')).toBe(true);
		expect(await html(page)).toBe('<p>one and a half two</p>');
		expect(await call(page, 'undo')).toBe(true);
		expect(await html(page)).toBe('<p>one two</p>');
		expect(await call(page, 'redo')).toBe(true);
		await page.keyboard.type('!');
		expect(await html(page)).toBe('<p>one and a half! two</p>');
	});

	test('insertText goes over a selection, and a line break in it starts a paragraph', async ({ page }) => {
		await open(page, two);
		await place(page, 'two', 'select');
		await call(page, 'insertText', '2');
		expect(await html(page)).toBe('<p>one 2</p>');
		await call(page, 'insertText', 'a\nb');
		expect(await html(page)).toBe('<p>one 2a</p><p>b</p>');
	});

	test('insertText is a step of its own, not part of the typing before it', async ({ page }) => {
		await open(page);
		await page.locator(content).click();
		await page.keyboard.type('typed');
		await call(page, 'insertText', ' put in');
		await call(page, 'undo');
		expect(await html(page)).toBe('<p>typed</p>');
	});

	test('insertFragment puts inline HTML in the paragraph at the caret, as one Undo step, and returns no fields', async ({ page }) => {
		await open(page, two);
		await place(page, 'one', 'after');
		expect(await call(page, 'insertFragment', ' <b>and</b> a half')).toEqual([]);
		expect(await html(page)).toBe('<p>one <b>and</b> a half two</p>');
		await call(page, 'undo');
		expect(await html(page)).toBe('<p>one two</p>');
	});

	test('insertFragment with paragraphs leaves what a paste of the same HTML leaves', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', REWRITTEN);
		const blocks = '<p>first</p><p>second</p>';
		await open(page, two);
		await page.evaluate(async (pasted) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted], { type: 'text/html' }) })]);
		}, blocks);
		await place(page, 'one', 'after');
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(content)).toContainText('second');
		const pasted = await html(page);

		await open(page, two);
		await place(page, 'one', 'after');
		await call(page, 'insertFragment', blocks);
		expect(await html(page)).toBe(pasted);
	});

	test('insertFragment runs nothing, and keeps only the marks the application named', async ({ page }) => {
		await open(page, { content: '<p>one</p>', keepAttributes: 'data-section' });
		await place(page, 'one', 'after');
		await call(
			page,
			'insertFragment',
			'<span data-section="A" data-other="x" onclick="window.__ran = 1">marked</span><img src="x" onerror="window.__ran = \'handler\'">'
		);
		await page.waitForTimeout(300);
		expect(await ran(page)).toBeUndefined();
		const after = await html(page);
		expect(after).toContain('data-section="A"');
		expect(after).not.toMatch(/data-other|onclick|onerror/);
	});

	test('with no caret in the editor, both go at the end of the document, and the editor takes the keyboard', async ({ page }) => {
		await open(page, two);
		expect(await call(page, 'insertText', '!')).toBe(true);
		expect(await html(page)).toBe('<p>one two!</p>');
		await page.keyboard.type('?');
		expect(await html(page)).toBe('<p>one two!?</p>');

		await open(page, two);
		expect(await call(page, 'insertFragment', ' <b>three</b>')).toEqual([]);
		expect(await html(page)).toBe('<p>one two <b>three</b></p>');
	});

	test('after the editor has lost the keyboard, it goes where the caret last was', async ({ page }) => {
		await open(page, two);
		await place(page, 'one', 'after');
		await page.evaluate(() => {
			const elsewhere = document.createElement('button');
			document.body.append(elsewhere);
			elsewhere.focus();
		});
		expect(await call(page, 'insertText', ' and')).toBe(true);
		expect(await html(page)).toBe('<p>one and two</p>');
	});

	test('nothing to put in is nothing done: no change, and no Undo step', async ({ page }) => {
		await open(page, two);
		await place(page, 'one', 'after');
		expect(await call(page, 'insertText', '')).toBe(false);
		expect(await call(page, 'insertFragment', '<script>window.__ran = "script"</script>')).toBeNull();
		expect(await html(page)).toBe('<p>one two</p>');
		expect(await call(page, 'undo')).toBe(false);
		expect(await ran(page)).toBeUndefined();
	});

	test('in a read-only editor both change nothing and say so', async ({ page }) => {
		await open(page, { readonly: '1', content: '<p>one</p>' });
		expect(await call(page, 'insertText', 'x')).toBe(false);
		expect(await call(page, 'insertFragment', '<b>x</b>')).toBeNull();
		expect(await html(page)).toBe('<p>one</p>');
	});
});

