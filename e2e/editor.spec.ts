import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type Editor = {
	getHTML(): string;
	getRTF(): string;
	getMarkdown(): string;
	setHTML(html: string): void;
	focus(): void;
	clearFormatting(): void;
	setFont(name: string | null): void;
};
declare global {
	interface Window {
		ed: Editor;
		lib: typeof import('../src/lib/index.js');
		setViewer(rtf: string): void;
		changes: number;
		saves: string[];
		__ran?: string;
	}
}

async function open(page: Page, query: Record<string, string> = {}): Promise<void> {
	await page.goto(`/e2e?${new URLSearchParams(query)}`);
	await page.waitForFunction(() => !!window.ed && !!window.lib);
}
const html = (page: Page) => page.evaluate(() => window.ed.getHTML());
const body = (rtf: string) => rtf.slice(rtf.indexOf('\\fs24 ') + 6);
const content = '.ink-content';

test.describe('opening a link', () => {
	const link = { content: '<p>before <a href="https://example.com/report?id=7">the report</a> after</p><p>second</p>' };
	const anchor = `${content} a`;
	const hint = '.ink-link-hint';
	const MAC = process.platform === 'darwin';
	/** The address is answered here: no test goes out to the network. */
	async function local(page: Page): Promise<void> {
		await page.context().route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>opened</title>there' }));
	}

	test('a plain click puts the caret in the link and opens nothing', async ({ page }) => {
		await local(page);
		await open(page, link);
		await page.click(anchor);
		await page.keyboard.type('X');
		expect(await page.locator(anchor).textContent()).toContain('X');
		expect(page.context().pages()).toHaveLength(1);
		expect(page.url()).toContain('/e2e?');
	});

	test('a click with Ctrl or Cmd opens it in a new tab, which is not handed this page', async ({ page }) => {
		await local(page);
		await open(page, link);
		const before = await html(page);
		const [opened] = await Promise.all([page.waitForEvent('popup'), page.click(anchor, { modifiers: ['ControlOrMeta'] })]);
		await opened.waitForLoadState();
		expect(opened.url()).toBe('https://example.com/report?id=7');
		expect(await opened.evaluate(() => window.opener)).toBeNull();
		expect(await opened.evaluate(() => document.referrer)).toBe('');
		// This page is where it was, and the document as it was.
		expect(page.url()).toContain('/e2e?');
		expect(await html(page)).toBe(before);
		expect(page.context().pages()).toHaveLength(2);
	});

	test('the pointer over a link shows where it goes and how to open it, and the note is no part of the document', async ({ page }) => {
		await open(page, link);
		await expect(page.locator(hint)).toHaveCount(0);
		await page.hover(anchor);
		await expect(page.locator(hint)).toBeVisible();
		await expect(page.locator(hint)).toContainText('https://example.com/report?id=7');
		await expect(page.locator(hint)).toContainText(MAC ? 'Command-click to open link' : 'Ctrl+click to open link');
		expect(await page.locator(hint).evaluate((el) => !!el.closest('.ink-content'))).toBe(false);
		expect(await html(page)).not.toContain('click to open');
		expect(await page.evaluate(() => window.ed.getRTF())).not.toContain('click to open');
		// Below the link, and not over its words.
		const [at, note] = await Promise.all([page.locator(anchor).boundingBox(), page.locator(hint).boundingBox()]);
		expect(note!.y).toBeGreaterThanOrEqual(at!.y + at!.height);
		// With the key down, the link shows the hand.
		await page.keyboard.down('ControlOrMeta');
		await expect.poll(() => page.locator(anchor).evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
		await page.keyboard.up('ControlOrMeta');
		await expect.poll(() => page.locator(anchor).evaluate((el) => getComputedStyle(el).cursor)).not.toBe('pointer');
		// Away from the link, and in typing, the note is gone.
		await page.hover(`${content} p:last-child`);
		await expect(page.locator(hint)).toHaveCount(0);
		await page.hover(anchor);
		await expect(page.locator(hint)).toBeVisible();
		await page.keyboard.type('a');
		await expect(page.locator(hint)).toHaveCount(0);
	});

	test('a document that cannot be edited opens its link on a plain click, in a new tab and not in place of the page', async ({ page }) => {
		await local(page);
		await open(page, { ...link, readonly: '1' });
		await page.hover(anchor);
		await page.waitForTimeout(600);
		await expect(page.locator(hint)).toHaveCount(0);
		const [opened] = await Promise.all([page.waitForEvent('popup'), page.click(anchor)]);
		await opened.waitForLoadState();
		expect(opened.url()).toBe('https://example.com/report?id=7');
		expect(await opened.evaluate(() => window.opener)).toBeNull();
		expect(page.url()).toContain('/e2e?');
	});
});

test.describe('the toolbar of a long document', () => {
	const long = { content: Array.from({ length: 80 }, (_, i) => `<p>Paragraph ${i + 1} of a long report.</p>`).join('') };
	const END = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
	const where = (page: Page) =>
		page.evaluate(() => {
			const bar = document.querySelector('.toolbar')!.getBoundingClientRect();
			const selection = getSelection()!;
			const focus = document.createRange();
			focus.setStart(selection.focusNode!, selection.focusOffset);
			const caret = focus.getClientRects()[0];
			return { scrolled: scrollY, top: bar.top, bottom: bar.bottom, caret: caret ? caret.top : null };
		});

	test('stays in sight when the page is scrolled to the end of the document, and can be used there', async ({ page }) => {
		await open(page, long);
		await page.click(`${content} p:first-child`);
		expect((await where(page)).top).toBeGreaterThan(0);
		await page.keyboard.press(END);
		await expect.poll(async () => (await where(page)).scrolled).toBeGreaterThan(500);
		const at = await where(page);
		expect(Math.abs(at.top)).toBeLessThan(1);
		// It is over the document, not in front of a window the document shows through.
		await expect(page.locator('.toolbar')).toBeInViewport();
		expect(await page.locator('.ink-head').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
		// A button on it is the one a click at its place gets, and it does its work.
		await page.keyboard.press('Shift+ArrowUp');
		expect(await html(page)).not.toMatch(/<(b|strong)>/);
		await page.click('.toolbar button[title^="Bold"]');
		expect(await html(page)).toMatch(/<(b|strong)>[^<]*report\.<\/(b|strong)><\/p>$/);
		expect(Math.abs((await where(page)).top)).toBeLessThan(1);
	});

	test('a caret moved up with the keys is not left under it', async ({ page }) => {
		await open(page, long);
		await page.click(`${content} p:first-child`);
		await page.keyboard.press(END);
		await expect.poll(async () => (await where(page)).scrolled).toBeGreaterThan(500);
		for (let step = 0; step < 40; step++) {
			await page.keyboard.press('ArrowUp');
			const at = await where(page);
			if (at.caret !== null && at.top < 1) expect(at.caret, `step ${step}`).toBeGreaterThanOrEqual(at.bottom);
		}
		expect((await where(page)).scrolled).toBeGreaterThan(0);
	});

	test('goes with the page where the application asks for that', async ({ page }) => {
		await open(page, { ...long, stickyToolbar: '0' });
		await page.click(`${content} p:first-child`);
		await page.keyboard.press(END);
		await expect.poll(async () => (await where(page)).scrolled).toBeGreaterThan(500);
		expect((await where(page)).bottom).toBeLessThan(0);
	});
});

test.describe('what an outside review of 1.12.0 found', () => {
	// In a browser, which reads a list's type and a cell's background its own way. Invented text.
	const viewer = '#viewer .rtf-viewer';

	test('a list lettered A, B, C is written A, B, C, and read back as a lettered list', async ({ page }) => {
		// As a mail program writes one, and as Google Docs does: the style on each item.
		for (const list of [
			'<ol type="A"><li>Left breast, biopsy</li><li>Right breast, biopsy</li><li>Sentinel node</li></ol>',
			'<ol><li style="list-style-type:upper-alpha">Left breast, biopsy</li><li style="list-style-type:upper-alpha">Right breast, biopsy</li><li style="list-style-type:upper-alpha">Sentinel node</li></ol>'
		]) {
			await open(page, { content: `${list}<p>See part B.</p>` });
			// The screen shows letters.
			expect(await page.locator(`${content} li`).nth(1).evaluate((el) => getComputedStyle(el).listStyleType)).toBe('upper-alpha');
			const rtf = await page.evaluate(() => window.ed.getRTF());
			expect(body(rtf)).toBe(
				'\\pard\\li720\\fi-360 A.\\tab Left breast, biopsy\\par \\pard\\li720\\fi-360 B.\\tab Right breast, biopsy\\par \\pard\\li720\\fi-360 C.\\tab Sentinel node\\par \\pard See part B.\\par }'
			);
			expect(await page.evaluate(() => window.lib.htmlToMarkdown(document.querySelector('.ink-content') as HTMLElement))).toContain('- B. Right breast, biopsy');
			// And the reader of that RTF shows letters too.
			await page.evaluate((rtf) => window.setViewer(rtf), rtf);
			await expect(page.locator(`${viewer} ol[type="A"] li`)).toHaveCount(3);
			expect(await page.locator(`${viewer} li`).nth(1).evaluate((el) => getComputedStyle(el).listStyleType)).toBe('upper-alpha');
		}
	});

	test('Roman numerals the same, small and from a start', async ({ page }) => {
		await open(page, { content: '<ol type="i" start="3"><li>three</li><li>four</li><li>five</li></ol>' });
		const rtf = await page.evaluate(() => window.ed.getRTF());
		expect(body(rtf)).toContain(' iii.\\tab three\\par \\pard\\li720\\fi-360 iv.\\tab four\\par \\pard\\li720\\fi-360 v.\\tab five');
		await page.evaluate((rtf) => window.setViewer(rtf), rtf);
		await expect(page.locator(`${viewer} ol[type="i"][start="3"] li`)).toHaveCount(3);
	});

	test('the white header of a dark header row is in the RTF in a color that can be read', async ({ page }) => {
		// As Word puts a shaded header row on the clipboard.
		const header = ['Marker', 'Patient result', 'Control']
			.map((word) => `<td style="background:#1F3864"><p><b><span style="color:white">${word}</span></b></p></td>`)
			.join('');
		await open(page, { content: `<table><tr>${header}</tr><tr><td>HER2</td><td>Negative (1+)</td><td><span style="color:#C00000">Positive (3+)</span></td></tr></table>` });
		// On the screen the header is as Word had it: white on its shading.
		const shown = await page.locator(`${content} td`).first().evaluate((cell) => ({
			back: getComputedStyle(cell).backgroundColor,
			color: getComputedStyle(cell.querySelector('span')!).color
		}));
		expect(shown).toEqual({ back: 'rgb(31, 56, 100)', color: 'rgb(255, 255, 255)' });
		// The RTF carries no shading, and so no white.
		const rtf = await page.evaluate(() => window.ed.getRTF());
		expect(rtf).not.toContain('\\red255\\green255\\blue255;');
		for (const word of ['Marker', 'Patient result', 'Control']) expect(rtf).toContain(`\\b ${word}\\b0 `);
		expect(rtf).toMatch(/\\cf\d Positive \(3\+\)\\cf0 /);
		// What reads that RTF shows the header words.
		await page.evaluate((rtf) => window.setViewer(rtf), rtf);
		const cell = page.locator(`${viewer} td, ${viewer} th`).first();
		await expect(cell).toHaveText('Marker');
		expect(await cell.evaluate((el) => getComputedStyle(el.querySelector('strong, b') ?? el).color)).not.toBe('rgb(255, 255, 255)');
	});

	/**
	 * A paste as Word makes one, with the RTF Word puts beside its HTML. A script cannot put RTF
	 * on the clipboard, so the paste event is made here with both, and the browser's own paste
	 * of the HTML, which follows such an event, is stood in for by the command that inserts it.
	 */
	const pasteFromWord = (page: Page, html: string, rtf: string) =>
		page.evaluate(
			({ html, rtf }) => {
				const data = new DataTransfer();
				data.setData('text/html', html);
				if (rtf) data.setData('text/rtf', rtf);
				const paste = new Event('paste', { bubbles: true, cancelable: true });
				Object.defineProperty(paste, 'clipboardData', { value: data });
				document.querySelector('.ink-content')!.dispatchEvent(paste);
				document.execCommand('insertHTML', false, html);
			},
			{ html, rtf }
		);
	const pictures = (page: Page) =>
		page.locator(`${content} img`).evaluateAll((imgs) => imgs.map((img) => `${(img as HTMLImageElement).alt} ${(img as HTMLImageElement).naturalWidth}x${(img as HTMLImageElement).naturalHeight}`));

	test('the pictures of a paste from Word are in the document and in the RTF, read from the RTF Word copies beside its HTML', async ({ page }) => {
		// (Word's HTML names a picture by a file on the writer's disk, which a page may not
		// open: the picture was broken on the screen, and "[Image: micrograph]" in the RTF.)
		// Two paragraphs with a picture after each, as Word copies them: see test-files.
		const copied = readFileSync('test-files/word-paste-two-pictures.html', 'utf8');
		const rtf = readFileSync('test-files/word-paste-two-pictures.rtf', 'utf8');
		await open(page, { content: '<p>Body</p>' });
		await page.click(`${content} p`);
		await pasteFromWord(page, copied, rtf);
		await expect(page.locator(content)).toContainText('Between.');
		// Each image shows its own picture: the red one of 16 by 12, the blue one of 10 by 10.
		await expect.poll(() => pictures(page)).toEqual(['micrograph 16x12', 'second field 10x10']);
		const written = await page.evaluate(() => window.ed.getRTF());
		expect(written).not.toContain('[Image');
		expect(written.match(/\\pngblip/g)).toHaveLength(2);
		expect(await page.locator(`${content} img`).evaluateAll((imgs) => imgs.every((img) => (img.getAttribute('src') ?? '').startsWith('data:image/png;base64,')))).toBe(true);
	});

	test('a paste from Word with no RTF beside it is as it was: the picture is named, and said to be missing', async ({ page }) => {
		const copied = readFileSync('test-files/word-paste-two-pictures.html', 'utf8');
		await open(page, { content: '<p>Body</p>' });
		await page.click(`${content} p`);
		await pasteFromWord(page, copied, '');
		await expect(page.locator(content)).toContainText('Between.');
		await expect(page.locator(`${content} img`)).toHaveCount(2);
		const written = await page.evaluate(() => window.ed.getRTF());
		expect(written).toContain('[Image: micrograph]');
		expect(written).not.toContain('\\pngblip');
		// No image keeps the address of a file on a disk.
		expect(await page.locator(`${content} img`).evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')))).toEqual([null, null]);
	});

	test('the comments that come in with markup are emptied: the address of a file on the writer\'s disk is not kept in the HTML', async ({ page, browserName }) => {
		// (Word writes the address of each copied picture in a comment, with the name of the
		// writer's account in it. A browser's paste leaves comments out; markup put in another
		// way, and what is dropped in Firefox, keeps them, and they were saved with the HTML.)
		const copied = readFileSync('test-files/word-paste-two-pictures.html', 'utf8');
		expect(copied).toMatch(/<!--\[if gte vml 1\]>[^]*file:\/\/\/\/Users\/someone\//);
		// A comment of the application's own is not the editor's to judge.
		await open(page, { content: '<p>Body<!--kept by the application--></p>' });
		await page.click(`${content} p`);
		await pasteFromWord(page, copied, readFileSync('test-files/word-paste-two-pictures.rtf', 'utf8'));
		await expect(page.locator(content)).toContainText('Between.');
		const clean = async () => {
			const now = await html(page);
			expect(now).not.toContain('file:');
			expect(now).not.toContain('someone');
			expect(now).not.toContain('msohtmlclip');
			expect(now).toContain('<!--kept by the application-->');
		};
		await clean();
		// Emptied, not taken out: Undo and Redo of what came in are the browser's still.
		// (Not in Firefox, which cannot undo a paste the editor took an element out of, as it
		// takes Word's style sheet out of this one. A drop with a comment is undone there too:
		// see 'a comment in what is dragged in is emptied'.)
		if (browserName === 'firefox') return;
		await page.keyboard.press('ControlOrMeta+z');
		await expect(page.locator(content)).not.toContainText('Between.');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
		await expect(page.locator(content)).toContainText('Between.');
		await clean();
	});

	test('a sentence from a page with a dark theme, and a color the writer chose on white', async ({ page }) => {
		await open(page, {
			content:
				'<p><span style="color: rgb(230, 237, 243); background-color: rgb(13, 17, 23);">Margins are positive for carcinoma.</span></p><p><span style="color: rgb(255, 255, 0);">chosen</span></p>'
		});
		const rtf = await page.evaluate(() => window.ed.getRTF());
		expect(body(rtf)).toBe('\\pard Margins are positive for carcinoma.\\par \\pard \\cf2 chosen\\cf0 \\par }');
		expect(rtf).toContain('{\\colortbl;\\red0\\green0\\blue0;\\red255\\green255\\blue0;}');
	});
});

test.describe('a new document', () => {
	test('the first words typed are a paragraph, and two lines typed are two paragraphs in the RTF', async ({ page }) => {
		await open(page);
		await page.click(content);
		await page.keyboard.type('line one');
		await page.keyboard.press('Enter');
		await page.keyboard.type('line two');
		expect(await html(page)).toBe('<p>line one</p><p>line two</p>');
		expect(body(await page.evaluate(() => window.ed.getRTF()))).toBe('\\pard line one\\par \\pard line two\\par }');
	});

	test('the same when the editor is given the keyboard by focus()', async ({ page }) => {
		await open(page);
		await page.evaluate(() => window.ed.focus());
		await page.keyboard.type('line one');
		await page.keyboard.press('Enter');
		await page.keyboard.type('line two');
		expect(await html(page)).toBe('<p>line one</p><p>line two</p>');
	});

	test('everything selected and typed over leaves a paragraph, not loose text', async ({ page }) => {
		await open(page, { content: '<p>one</p><p>two</p>' });
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.type('new');
		await page.keyboard.press('Enter');
		await page.keyboard.type('next');
		expect(body(await page.evaluate(() => window.ed.getRTF()))).toBe('\\pard new\\par \\pard next\\par }');
	});
});

test.describe('the link dialog', () => {
	const two = { content: '<p>alpha beta gamma</p><p>second paragraph</p>' };
	async function selectBeta(page: Page): Promise<void> {
		await page.evaluate(() => {
			const text = document.querySelector('.ink-content p')!.firstChild!;
			const range = document.createRange();
			range.setStart(text, 6);
			range.setEnd(text, 10);
			const selection = getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			(document.querySelector('.ink-content') as HTMLElement).focus();
		});
	}

	test('takes the keyboard: an address typed after Ctrl+K goes in the dialog, and Enter makes the link', async ({ page }) => {
		await open(page, two);
		await selectBeta(page);
		await page.keyboard.press('ControlOrMeta+k');
		await expect(page.getByRole('dialog', { name: 'Insert Link' })).toBeVisible();
		await page.keyboard.type('https://example.com/');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(await html(page)).toBe('<p>alpha <a href="https://example.com/">beta</a> gamma</p><p>second paragraph</p>');
	});

	test('an address that is refused keeps the dialog open and the document as it was', async ({ page }) => {
		await open(page, two);
		await selectBeta(page);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.type('javascript:alert(1)');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('alert')).toContainText('Enter a web address');
		expect(await html(page)).toBe(two.content);
	});

	test('Escape closes it, hands the keyboard back, and the selection is still there to type over', async ({ page }) => {
		await open(page, two);
		await selectBeta(page);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(await page.evaluate(() => document.activeElement?.className)).toContain('ink-content');
		expect(await html(page)).toBe(two.content);
	});

	test('Tab stays in the dialog', async ({ page }) => {
		await open(page, two);
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+k');
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Tab');
			expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
		}
	});
});

test.describe('HTML from outside', () => {
	const EVIL = '<p>Body</p><img src="x" onerror="window.__ran = \'handler\'"><a href="javascript:window.__ran = \'link\'">l</a>';

	test('the content prop and setHTML run nothing', async ({ page }) => {
		await open(page, { content: EVIL });
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		await page.evaluate((evil) => window.ed.setHTML(evil), EVIL);
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		expect(await html(page)).not.toMatch(/onerror|javascript:/);
	});

	test('a draft in localStorage is not shown unless autosave is on, and runs nothing when it is', async ({ page }) => {
		await open(page);
		await page.evaluate((evil) => {
			localStorage.setItem('ink-editor-content', evil);
			localStorage.setItem('report-7', evil);
		}, EVIL);
		await open(page, { content: '<p>From the host</p>' });
		expect(await html(page)).toBe('<p>From the host</p>');
		await open(page, { autosave: '1', key: 'report-7', content: '<p>From the host</p>' });
		await page.waitForTimeout(300);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		expect(await html(page)).toContain('<p>Body</p>');
	});

	test('marks the application named stay on what it sets and on a paste, and nothing else does', async ({ page }) => {
		const MARKED = '<p data-section="A" data-other="x" class="summary wide" onclick="window.__ran = 1">Marked</p>';
		await open(page, { content: MARKED, keepAttributes: 'data-section,onclick', keepClasses: 'summary' });
		expect(await html(page)).toBe('<p data-section="A" class="summary">Marked</p>');
		await page.evaluate(async (pasted) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted.replace('Marked', 'Pasted')], { type: 'text/html' }) })]);
		}, MARKED);
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+a');
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(`${content} [data-section="A"]`)).toHaveText('Pasted');
		expect(await html(page)).not.toMatch(/data-other|onclick|wide/);
		await page.locator(`${content} [data-section="A"]`).click();
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		// And with nothing named, the same paste keeps neither.
		await open(page);
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(content)).toContainText('Pasted');
		expect(await html(page)).not.toMatch(/data-section|class=/);
	});

	test('a paste cannot cover the page, and brings no form, frame or script', async ({ page }) => {
		await open(page);
		await page.evaluate(async () => {
			const pasted =
				'<p onclick="window.__ran = 1">para</p><iframe src="https://example.com/"></iframe><form action="https://example.com/"><input name="q"><button>b</button></form>' +
				'<svg onload="window.__ran = 2"></svg><div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;color:red">overlay</div><a href="https://example.com/">ok</a>';
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted], { type: 'text/html' }) })]);
		});
		await page.click(content);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(`${content} a`)).toHaveCount(1);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
		expect(await page.locator(`${content} :is(iframe, input, button, svg, script)`).count()).toBe(0);
		const overlay = page.locator(content).getByText('overlay');
		expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe('static');
		expect(await overlay.evaluate((el) => (el as HTMLElement).style.color)).toBe('red');
	});

	test('a hostile RTF file shows as text in the viewer', async ({ page }) => {
		await open(page);
		await page.evaluate(() =>
			window.setViewer(
				String.raw`{\rtf1\ansi{\field{\*\fldinst HYPERLINK "javascript:window.__ran=6"}{\fldrslt click}} <img src=x onerror=window.__ran=7> \u60?script\u62?window.__ran=8\u60?/script\u62?\par}`
			)
		);
		await expect(page.locator('.rtf-viewer')).toContainText('click');
		expect(await page.locator('.rtf-viewer :is(a, img, script)').count()).toBe(0);
		expect(await page.evaluate(() => window.__ran)).toBeUndefined();
	});
});

test.describe('what a review of these changes found', () => {
	test('a block cannot be drawn over the toolbar with styles a document may have', async ({ page }) => {
		// A margin below zero pulled it up over the toolbar; a width of thousands ran it out
		// over the page beside the editor.
		await open(page, { content: '<p>Report body</p>' });
		await page.evaluate(() =>
			window.ed.setHTML(
				'<p>Report body</p><div style="margin-top:-600px;margin-left:-300px;width:3000px;height:3000px;background-color:red">COVER</div>' +
					'<a href="https://example.com/" style="display:block;margin:-2000px;padding:4000px">all of the page</a>'
			)
		);
		const over = await page.evaluate(() => {
			const bar = document.querySelector('.toolbar')!.getBoundingClientRect();
			const hit = document.elementFromPoint(bar.left + 20, bar.top + 10);
			return hit ? !!hit.closest('.ink-content') : false;
		});
		expect(over).toBe(false);
		expect(await html(page)).not.toMatch(/margin|padding|width|height/);
		// Whatever its styles, nothing in the document is drawn outside the editing area.
		const outside = await page.evaluate(() => {
			window.ed.setHTML('<table style="width:2000px"><tbody><tr><td style="background-color:red">wide</td></tr></tbody></table>');
			const area = document.querySelector('.ink-content')!.getBoundingClientRect();
			const hit = document.elementFromPoint(Math.min(area.right + 30, window.innerWidth - 5), area.top + 60);
			return hit ? !!hit.closest('.ink-content') : false;
		});
		expect(outside).toBe(false);
	});

	test('style text the browser did not read is not passed on', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() =>
			window.lib.sanitizeHtml('<div style="background:url(javascript:alert(1))">a</div><div style="width:expression(alert(1))">b</div><p style="color:red;margin-left:max(10px,5000px)">c</p>')
		);
		expect(out).not.toMatch(/expression|javascript|url\(|max\(/);
		expect(out).toContain('color: red');
	});

	test('what Word hid is hidden on screen as it is in the RTF', async ({ page }) => {
		await open(page, { content: '<p>a<span style="mso-hide:all">SECRET</span>b</p>' });
		expect(await page.locator(content).innerText()).not.toContain('SECRET');
		expect(await page.evaluate(() => window.ed.getRTF())).not.toContain('SECRET');
	});

	test('an empty document counts no characters', async ({ page }) => {
		await open(page);
		await expect(page.getByText('0 words · 0 characters')).toBeVisible();
		await page.click(content);
		await page.keyboard.type('ab');
		await expect(page.getByText('1 word · 2 characters')).toBeVisible();
	});

	test('lists nested 6000 deep, one straight in the next, are written', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() => {
			const root = document.createElement('div');
			let at: HTMLElement = root;
			for (let i = 0; i < 6000; i++) {
				const next = document.createElement(i % 2 ? 'ol' : 'ul');
				at.appendChild(next);
				at = next;
			}
			at.innerHTML = '<li>deep</li>';
			return [window.lib.htmlToRtf(root), window.lib.htmlToMarkdown(root)] as const;
		});
		expect(out[0]).toContain('deep');
		expect(out[1]).toContain('deep');
	});

	test('a button that does something once is not announced as a toggle', async ({ page }) => {
		await open(page);
		await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).not.toHaveAttribute('aria-pressed', /.*/);
		await expect(page.getByRole('button', { name: 'Bold (Ctrl+B)' })).toHaveAttribute('aria-pressed', 'false');
	});

	test('the words in a formula and a text box stay when the element goes', async ({ page }) => {
		await open(page, { content: '<p>Ki-67 <math><mn>30</mn><mo>%</mo></math>, note <textarea>margins clear</textarea></p>' });
		expect(await html(page)).toBe('<p>Ki-67 30%, note margins clear</p>');
	});
});

test.describe('what a second review found', () => {
	// What only a real browser shows of the fixes in sanitize.ts: where text is drawn, what a
	// paste brings, an id as a name on `window`. Invented text.
	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
	const rtfBody = (page: Page) => page.evaluate(() => window.ed.getRTF()).then(body);
	async function paste(page: Page, pasted: string, typedFirst = ''): Promise<void> {
		await open(page);
		await page.evaluate(async (pasted) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted], { type: 'text/html' }) })]);
		}, pasted);
		await page.click(content);
		if (typedFirst) await page.keyboard.type(typedFirst);
		await page.keyboard.press('ControlOrMeta+v');
	}

	test('words hidden in a button or a text box are not shown and not written', async ({ page }) => {
		await open(page);
		await page.evaluate(() =>
			window.ed.setHTML(
				'<p>Press <button>Sign<span style="display:none">SECRET</span></button></p><p>a<input hidden value="HIDDENINPUT">b</p>' +
					'<p>c<textarea style="display:none">HIDDENTEXT</textarea>d</p><p>e<math style="display:none"><mn>42</mn></math>f</p>'
			)
		);
		expect(await html(page)).toBe('<p>Press Sign</p><p>ab</p><p>cd</p><p>ef</p>');
		expect(await rtfBody(page)).toBe('\\pard Press Sign\\par \\pard ab\\par \\pard cd\\par \\pard ef\\par }');
	});

	test('a list read from RTF is written back at the indent it had', async ({ page }) => {
		await open(page);
		const rtf = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 \pard\li720\fi-360\bullet\tab a\par \pard\li1080\fi-360\bullet\tab b\par \pard\li360\fi-360\bullet\tab c\par }`;
		const read = await page.evaluate((rtf) => {
			const parsed = window.lib.rtfToHtml(rtf);
			window.ed.setHTML(parsed);
			return parsed;
		}, rtf);
		expect(await html(page)).toBe(read);
		expect(await rtfBody(page)).toBe('\\pard\\li720\\fi-360\\bullet\\tab a\\par \\pard\\li1080\\fi-360\\bullet\\tab b\\par \\pard\\li360\\fi-360\\bullet\\tab c\\par }');
	});

	test('a table border written in one word stays as it was written', async ({ page }) => {
		await open(page);
		const kept = await page.evaluate(() =>
			[
				'<table><tbody><tr><td style="border: 1px solid black">x</td></tr></tbody></table>',
				'<blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;">q</blockquote>',
				'<p style="border-bottom: 2px dotted red; border-top: none">x</p>'
			].map((html) => [html, window.lib.sanitizeHtml(html)])
		);
		for (const [given, got] of kept) expect(got).toBe(given);
		// A border picture is drawn outside its element, and a document has none.
		const picture = await page.evaluate(() => window.lib.sanitizeHtml('<p style="border: 1px solid; border-image: linear-gradient(red, blue) 1 / 1 / 5000px">x</p>'));
		expect(picture).not.toMatch(/gradient|5000|border-image/);
		expect(picture).toMatch(/border-style: solid/);
	});

	test('a document shown again keeps its ids, and an id still cannot stand in for a name of the page', async ({ page }) => {
		await open(page, { content: '<p id="dx-1">first</p>' });
		expect(await page.evaluate(() => 'dx-1' in window)).toBe(true);
		await page.evaluate(() => window.ed.setHTML('<p id="dx-1">again</p><p id="dx-2">new</p>'));
		expect(await html(page)).toBe('<p id="dx-1">again</p><p id="dx-2">new</p>');
		await page.evaluate(() => window.ed.setHTML(window.ed.getHTML()));
		expect(await html(page)).toBe('<p id="dx-1">again</p><p id="dx-2">new</p>');
		await page.evaluate(() => window.ed.setHTML('<a id="appConfig" href="https://evil.test/api">c</a><p id="location">x</p><p id="dx-3">y</p>'));
		expect(await html(page)).toBe('<a href="https://evil.test/api">c</a><p>x</p><p id="dx-3">y</p>');
		expect(await page.evaluate(() => String((window as unknown as Record<string, unknown>).appConfig))).toBe('undefined');
	});

	test('no first line is drawn outside the editing area, and no text has no size', async ({ page }) => {
		await open(page);
		for (const style of ['text-indent:-100%', 'text-indent:-2200px', 'margin-left: 20px; text-indent: -600px']) {
			await page.evaluate((style) => window.ed.setHTML(`<p style="${style}">FIRST LINE</p><p>second</p>`), style);
			const [text, area] = await page.evaluate(() => {
				const editing = document.querySelector('.ink-content')!;
				const range = document.createRange();
				range.selectNodeContents(editing.querySelector('p')!);
				return [range.getBoundingClientRect().left, editing.getBoundingClientRect().left];
			});
			expect(text, style).toBeGreaterThanOrEqual(area);
			expect(await rtfBody(page), style).toContain('FIRST LINE\\par');
			expect(await rtfBody(page), style).not.toContain('\\fi-');
		}
		// A hanging indent is drawn inside, and written.
		await page.evaluate(() => window.ed.setHTML('<p style="margin-left:48px;text-indent:-24px">hang</p>'));
		expect(await rtfBody(page)).toBe('\\pard\\li720\\fi-360 hang\\par }');
		await page.evaluate(() => window.ed.setHTML('<p><span style="font-size:0">INVISIBLE</span>seen</p>'));
		const box = await page.locator(`${content} span`).boundingBox();
		expect(box!.width).toBeGreaterThan(20);
		expect(box!.height).toBeGreaterThan(8);
	});

	// These pastes are made through the clipboard, by a script. Safari's engine rewrites the HTML
	// a script puts there (it takes off the style it does not know, and the text box): what it
	// then pastes is not what Word copies, so there is nothing of Word's to test with. A copy
	// made in Word itself is checked by hand in Safari.
	const REWRITTEN = 'WebKit rewrites the HTML a script puts on the clipboard: Word\'s mark and the text box are gone before the paste';
	/**
	 * Firefox keeps the empty line a paste of whole paragraphs was made in, after them. It is the
	 * browser's own paste, in any editable page, and its Undo takes the line back with the rest.
	 */
	const lineKept = (browserName: string) => (browserName === 'firefox' ? '<p><br></p>' : '');

	test('a pasted span that only Word hid is not pasted as words', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', REWRITTEN);
		await paste(page, '<p>one <span style="mso-hide:all">HID ONE</span> two</p><p style="mso-hide:all">whole para</p><p>three</p>');
		await expect(page.locator(content)).toContainText('three');
		expect(await html(page)).toBe(`<p>one two</p><p>three</p>${lineKept(browserName)}`);
		// As Word writes a copy: styles in the head, the copied part marked.
		await paste(
			page,
			'<html><head><style>p.MsoNormal{margin:0in;font-size:11pt}</style></head><body><!--StartFragment--><p class=MsoNormal>Shown <span style=\'mso-hide:all\'>hidden words</span>text</p><!--EndFragment--></body></html>'
		);
		await expect(page.locator(content)).toContainText('text');
		expect(await page.locator(content).textContent()).toBe('Shown text');
	});

	test('after such a paste the caret is where the paste ended', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', REWRITTEN);
		// (Firefox pastes the hidden words as an element that is not displayed and leaves the
		// caret in it: the "y" typed next was typed where it is not seen, and was not written.)
		await paste(page, '<span style="mso-hide:all">all hidden</span>', 'x');
		await page.waitForTimeout(100);
		expect(await html(page)).toBe('<p>x</p>');
		await page.keyboard.type('y');
		expect(await html(page)).toBe('<p>xy</p>');
		expect(await page.locator(content).evaluate((el) => (el as HTMLElement).innerText.trim())).toBe('xy');
		// And inside a line, between what was there.
		await paste(page, 'in<span style="mso-hide:all">HIDDEN</span>side', 'ab');
		await expect(page.locator(content)).toContainText('side');
		await page.keyboard.type('!');
		expect(await html(page)).toBe('<p>abinside!</p>');
		// A paste that ends in a hidden paragraph, or is nothing else, leaves an empty line
		// with the caret in it.
		await paste(page, '<p>one</p><p style="mso-hide:all">whole para</p>');
		await expect(page.locator(content)).toContainText('one');
		await expect.poll(() => html(page)).toBe(`<p>one</p><p><br></p>${lineKept(browserName)}`);
		await page.keyboard.type('two');
		expect(await html(page)).toBe(`<p>one</p><p>two</p>${lineKept(browserName)}`);
		await paste(page, '<p style="mso-hide:all">all hidden</p>');
		await expect.poll(() => html(page)).toBe(`<p><br></p>${lineKept(browserName)}`);
		await page.keyboard.type('typed');
		expect(await html(page)).toBe(`<p>typed</p>${lineKept(browserName)}`);
		// Whatever the browser, what was typed can be seen.
		expect(await page.locator(content).evaluate((el) => (el as HTMLElement).innerText.trim())).toBe('typed');
	});

	test('a text box pasted last keeps its words', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', REWRITTEN);
		await paste(page, '<p>note <textarea>margins clear</textarea></p>');
		await expect(page.locator(content)).toContainText('note');
		expect(await html(page)).toBe(`<p>note margins clear</p>${lineKept(browserName)}`);
	});

	test('a link with padding does not cover the lines above it', async ({ page }) => {
		await open(page);
		await page.evaluate(() => window.ed.setHTML('<p>Report body, first paragraph</p><p><a href="https://example.com/" style="padding:2200px">link</a></p><p>last</p>'));
		const first = page.locator(`${content} p`).first();
		const box = (await first.boundingBox())!;
		const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.tagName, [box.x + 40, box.y + box.height / 2]);
		expect(hit).toBe('P');
		await page.evaluate(() => window.ed.setHTML('<table width="100000"><tbody><tr><td>x</td></tr></tbody></table>'));
		expect((await page.locator(`${content} table`).boundingBox())!.width).toBeLessThan(2300);
	});

	test('the frame around a picture is not drawn outside the editing area', async ({ page }) => {
		await open(page);
		await page.evaluate((png) => {
			// Room to the left of the editor, where the frame used to be drawn.
			document.body.style.paddingLeft = '300px';
			window.ed.setHTML(`<table style="width:2000px"><tbody><tr><td><img src="${png}" style="width:200px;height:120px"></td><td>wide</td></tr></tbody></table>`);
		}, PNG);
		await page.click(`${content} img`);
		const frame = page.locator('.ink-img-frame');
		await expect(frame).toBeVisible();
		const area = (await page.locator(content).boundingBox())!;
		expect((await frame.boundingBox())!.width).toBeCloseTo(200, 0);
		// Part of the picture scrolled out: the frame is over the part still in view.
		const pictureLeft = (await page.locator(`${content} img`).boundingBox())!.x - area.x;
		await page.evaluate((by) => (document.querySelector('.ink-content')!.scrollLeft = by), pictureLeft + 80);
		await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(120);
		expect((await frame.boundingBox())!.x).toBeGreaterThanOrEqual(area.x - 0.5);
		// All of it scrolled out: no frame, and no tools.
		await page.evaluate((by) => (document.querySelector('.ink-content')!.scrollLeft = by), pictureLeft + 400);
		await expect(frame).toHaveCount(0);
		// Scrolled back, it is around the whole picture again.
		await page.evaluate(() => (document.querySelector('.ink-content')!.scrollLeft = 0));
		await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBe(200);
	});

	test('style text the browser did not read is not passed on behind a short form and one of its parts', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() =>
			[
				'<p style="margin: 0; margin-left: expr/**/ession(alert(1))">x</p>',
				'<p style="border: expr/**/ession(alert(1)); border-top-color: red">x</p>',
				'<p style="margin: 0 0 0 -9999px junk; margin-top: 1px">x</p>'
			].map((html) => window.lib.sanitizeHtml(html))
		);
		for (const html of out) expect(html).not.toMatch(/expr|ession|junk|9999/);
		expect(out[1]).toContain('border-top-color: red');
		expect(out[2]).toContain('margin-top: 1px');
		// Both read: left as written.
		const both = '<p style="margin: 0; margin-left: 4px">x</p>';
		expect(await page.evaluate((html) => window.lib.sanitizeHtml(html), both)).toBe(both);
	});

	test('a formula written twice is read once, and two boxes side by side are two words', async ({ page }) => {
		await open(page);
		await page.evaluate(() =>
			window.ed.setHTML(
				'<p>Ki-67 <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mn>30</mn><mi mathvariant="normal">%</mi></mrow><annotation encoding="application/x-tex">30\\%</annotation></semantics></math></span>' +
					'<span class="katex-html" aria-hidden="true"><span class="mord">30</span><span class="mord">%</span></span></span> positive</p><p>Size <input value="1"><input value="5"> cm</p>'
			)
		);
		expect(await rtfBody(page)).toBe('\\pard Ki-67 30% positive\\par \\pard Size 1 5 cm\\par }');
	});
});

test.describe('the writers', () => {
	test('numbers stay in range in a real browser', async ({ page }) => {
		await open(page);
		const rtf = await page.evaluate(() => {
			const div = document.createElement('div');
			div.innerHTML =
				'<font color="#abcd">a</font><font color="rgb(999,0,0)">c</font><span style="font-size:99999pt">d</span><p style="margin-left:99999999px">e</p>' +
				'<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" width="99999999999">';
			return window.lib.htmlToRtf(div);
		});
		expect(rtf).not.toMatch(/NaN|\\[a-z]+\d{6,}/);
		expect(rtf).toContain('\\red255\\green0\\blue0;');
	});

	test('elements nested 6000 deep are written', async ({ page }) => {
		await open(page);
		const out = await page.evaluate(() => {
			const root = document.createElement('div');
			let at: HTMLElement = root;
			for (let i = 0; i < 6000; i++) {
				const next = document.createElement(i % 2 ? 'span' : 'b');
				at.appendChild(next);
				at = next;
			}
			at.textContent = 'deep';
			return [window.lib.htmlToRtf(root), window.lib.htmlToMarkdown(root), window.lib.estimateRtfBytes(root)] as const;
		});
		expect(out[0]).toContain('deep');
		expect(out[1]).toContain('deep');
		expect(out[2]).toBeGreaterThanOrEqual(out[0].length);
	});

	test('typing does not read the whole document for a handler that does not ask for it', async ({ page }) => {
		await open(page, { onchange: '1' });
		const ms = await page.evaluate(async () => {
			const canvas = document.createElement('canvas');
			canvas.width = 900;
			canvas.height = 700;
			const g = canvas.getContext('2d')!;
			const data = g.createImageData(900, 700);
			for (let i = 0; i < data.data.length; i++) data.data[i] = i % 4 === 3 ? 255 : Math.random() * 255;
			g.putImageData(data, 0, 0);
			const url = canvas.toDataURL('image/jpeg', 0.92);
			window.ed.setHTML('<p>Body</p>' + `<figure><img src="${url}" style="width:300px"><figcaption>f</figcaption></figure>`.repeat(8));
			const p = document.querySelector('.ink-content p')!;
			const range = document.createRange();
			range.selectNodeContents(p);
			range.collapse(false);
			getSelection()!.removeAllRanges();
			getSelection()!.addRange(range);
			(document.querySelector('.ink-content') as HTMLElement).focus();
			const times: number[] = [];
			for (let i = 0; i < 9; i++) {
				const t = performance.now();
				document.execCommand('insertText', false, 'x');
				times.push(performance.now() - t);
				await new Promise((r) => requestAnimationFrame(r));
			}
			return times.sort((a, b) => a - b)[4];
		});
		expect(await page.evaluate(() => window.changes)).toBeGreaterThan(0);
		// It was 116 ms with these eight pictures; it is a few now. Wide enough for a slow machine.
		expect(ms).toBeLessThan(40);
	});
});

test.describe('what a third review found', () => {
	// Markup that a paste is made safe of, as it is dragged in or put back by Redo: a block drawn
	// over the page, a form that sends what is typed in it elsewhere, a frame, a picture address.
	const OUTSIDE =
		'<p>came in</p><div id="over" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;color:red">over</div>' +
		'<form action="https://example.com/collect"><input name="q" value="typed"><button>Go</button></form><iframe src="https://example.com/frame"></iframe>';

	// Redo is Ctrl+Shift+Z and Ctrl+Y, but on a Mac only Cmd+Shift+Z: Cmd+Y is not Redo there.
	const MAC = process.platform === 'darwin';
	const REDO_KEYS = MAC ? ['Meta+Shift+z'] : ['Control+Shift+z', 'Control+y'];
	// (And on a Mac, Home and End are not the ends of the line in every browser.)
	const SELECT_TO_LINE_START = MAC ? 'Meta+Shift+ArrowLeft' : 'Shift+Home';
	const LINE_END = MAC ? 'Meta+ArrowRight' : 'End';

	/** What of OUTSIDE is in the document: nothing of it should be, but its words. */
	const left = (page: Page) =>
		page.evaluate(() => {
			const ed = document.querySelector('.ink-content')!;
			const over = Array.from(ed.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent === 'over');
			return {
				risky: Array.from(ed.querySelectorAll('iframe, input, button, [action], [id="over"]')).map((el) => el.tagName.toLowerCase()),
				overPosition: over ? getComputedStyle(over).position : 'gone',
				overColor: over?.style.color ?? 'gone'
			};
		});

	/** Put something on the page that can be dragged, carrying `markup` as a drag from another page does. */
	async function draggable(page: Page, markup: string): Promise<void> {
		await page.evaluate((markup) => {
			const source = document.createElement('div');
			source.id = 'drag-source';
			source.draggable = true;
			source.textContent = 'drag me';
			source.addEventListener('dragstart', (e) => {
				e.dataTransfer!.setData('text/html', markup);
				e.dataTransfer!.setData('text/plain', 'came in');
				e.dataTransfer!.effectAllowed = 'copy';
			});
			document.body.prepend(source);
		}, markup);
	}

	async function selectIn(page: Page, paragraph: number, from: number, to: number): Promise<void> {
		await page.evaluate(
			({ paragraph, from, to }) => {
				const text = document.querySelectorAll('.ink-content p')[paragraph].firstChild!;
				const range = document.createRange();
				range.setStart(text, from);
				range.setEnd(text, to);
				const selection = getSelection()!;
				selection.removeAllRanges();
				selection.addRange(range);
				(document.querySelector('.ink-content') as HTMLElement).focus();
			},
			{ paragraph, from, to }
		);
	}

	test('markup dragged into the document is made safe as a paste is', async ({ page }) => {
		await open(page, { content: '<p>Line to drop on</p>' });
		await draggable(page, OUTSIDE);
		await page.dragAndDrop('#drag-source', `${content} p`);
		await expect(page.locator(content)).toContainText('came in');
		expect(await left(page)).toEqual({ risky: [], overPosition: 'static', overColor: 'red' });
		// What the application is handed is the same document.
		expect(await html(page)).not.toMatch(/iframe|<input|<button|action=|position/);
	});

	/** Drag what is selected to the third paragraph of the document. */
	async function dragSelectionToThirdLine(page: Page): Promise<void> {
		const at = await page.evaluate(() => {
			const from = getSelection()!.getRangeAt(0).getBoundingClientRect();
			const to = document.querySelectorAll('.ink-content p')[2].getBoundingClientRect();
			return { x: from.x + from.width / 2, y: from.y + from.height / 2, tx: to.x + 30, ty: to.y + to.height / 2 };
		});
		await page.mouse.move(at.x, at.y);
		await page.mouse.down();
		// (On a Mac, selected words pressed and moved at once are a new selection: they are
		// dragged only once the button has been held a moment.)
		await page.waitForTimeout(400);
		await page.mouse.move(at.x + 5, at.y + 5, { steps: 3 });
		await page.mouse.move(at.tx, at.ty, { steps: 8 });
		await page.mouse.up();
	}

	test('words dragged from one line of the document to another are still moved', async ({ page }) => {
		await open(page, { content: '<p>alpha beta gamma</p><p>second line</p><p>third line</p>' });
		await selectIn(page, 0, 0, 5);
		await dragSelectionToThirdLine(page);
		await expect(page.locator(`${content} p`).nth(2)).toContainText('alpha');
		await expect(page.locator(`${content} p`).nth(0)).not.toContainText('alpha');
		expect(await page.locator(`${content} p`).count()).toBe(3);
	});

	test('words moved by dragging are moved back by one Undo, and moved again by one Redo', async ({ page }) => {
		// (The move is two inputs, the words taken out and the words dropped. Each was a step of
		// its own: the first Undo took the dropped words out, and they were nowhere.)
		await open(page, { content: '<p>alpha beta gamma</p><p>second line</p><p>third line</p>' });
		const before = await html(page);
		await selectIn(page, 0, 0, 5);
		await dragSelectionToThirdLine(page);
		await expect(page.locator(`${content} p`).nth(2)).toContainText('alpha');
		const moved = await html(page);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => html(page)).toBe(before);
		await page.keyboard.press(REDO_KEYS[0]);
		await expect.poll(() => html(page)).toBe(moved);
	});

	test('and an element dragged with them keeps the id it had', async ({ page }) => {
		// (What is moved was treated as pasted, and a pasted element loses its id: it might be in
		// the document already. A moved one is in the document once, before and after.)
		await open(page, { content: '<p>alpha <b id="mark1">beta</b> gamma</p><p>second line</p><p>third line</p>' });
		await page.evaluate(() => {
			const range = document.createRange();
			range.selectNode(document.querySelector('.ink-content b')!);
			getSelection()!.removeAllRanges();
			getSelection()!.addRange(range);
			(document.querySelector('.ink-content') as HTMLElement).focus();
		});
		await dragSelectionToThirdLine(page);
		await expect(page.locator(`${content} p`).nth(2)).toContainText('beta');
		await expect(page.locator(`${content} p`).nth(0)).not.toContainText('beta');
		expect(await page.locator(`${content} p:nth-of-type(3) b#mark1`).count()).toBe(1);
		expect(await page.locator(`${content} [id]`).count()).toBe(1);
	});

	test('a comment in what is dragged in is emptied, and the drop can still be undone', async ({ page }) => {
		// (Firefox keeps the comments of dropped markup, where a paste has none. Word writes in
		// one the address of a copied picture, on the writer's own disk.)
		await open(page, { content: '<p>Line to drop on</p>' });
		await draggable(page, '<p>dropped<!-- file:////Users/someone/Library/msohtmlclip/clip_image001.png --> words</p>');
		await page.dragAndDrop('#drag-source', `${content} p`);
		await expect(page.locator(content)).toContainText('dropped');
		expect(await html(page)).not.toMatch(/file:|someone|clip_image/);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(page.locator(content)).not.toContainText('dropped');
	});

	test('words Word hid are not shown when they are dragged in, as when they are pasted', async ({ page }) => {
		// (Only a paste was read for them: the same markup dragged in showed them as words.)
		await open(page, { content: '<p>Line to drop on</p>' });
		await draggable(page, '<p>shown <span style="mso-hide:all">secret</span> words</p>');
		await page.dragAndDrop('#drag-source', `${content} p`);
		await expect(page.locator(content)).toContainText('shown');
		await expect(page.locator(content)).not.toContainText('secret');
		await expect(page.locator(content)).toContainText(/shown\s+words/);
	});

	test('Redo does not put back what a paste was made safe of', async ({ page }) => {
		await open(page, { content: '<p>Body</p>' });
		await page.evaluate(async (markup) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([markup], { type: 'text/html' }) })]);
		}, OUTSIDE);
		await page.click(`${content} p`);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(content)).toContainText('came in');
		expect((await left(page)).risky).toEqual([]);
		// Twice with each key. (Safari forgot the paste after its first Redo: the frame the paste
		// held was put back and taken out again, and with a frame goes all that could be undone.
		// On a Mac, where there is one key for Redo, it was done once and that was not seen.)
		for (const redo of [...REDO_KEYS, ...REDO_KEYS]) {
			await page.keyboard.press('ControlOrMeta+z');
			await expect(page.locator(content)).not.toContainText('came in');
			await page.keyboard.press(redo);
			await expect(page.locator(content)).toContainText('came in');
			expect(await left(page), redo).toEqual({ risky: [], overPosition: 'static', overColor: 'red' });
		}
	});

	// What a page one copies from may put in the copy to run script where it is pasted: each
	// writes its name in `window.__ran` if it runs. With a frame among them, because a paste that
	// holds a frame is put in by the editor itself, where no browser takes the handlers out.
	const RAN = (name: string) => `(window.__ran = window.__ran || []).push('${name}')`;
	const HOSTILE =
		'<p>came in</p><iframe></iframe>' +
		`<video><source src="x:" onerror="${RAN('source')}"></video>` +
		`<video src="x:" onerror="${RAN('video')}"></video>` +
		`<audio src="x:" onerror="${RAN('audio')}"></audio>` +
		`<svg onload="${RAN('svg')}"><image href="x:" onerror="${RAN('svg image')}"/></svg>` +
		`<img src="x:" onerror="${RAN('img')}">` +
		`<details open ontoggle="${RAN('details')}"><summary>s</summary>d</details>` +
		`<input autofocus onfocus="${RAN('input')}">` +
		`<object data="x:" onerror="${RAN('object')}"></object>` +
		`<link rel="stylesheet" href="x:" onerror="${RAN('link')}">` +
		`<style onload="${RAN('style')}">p{}</style>` +
		`<script>${RAN('script')}</scr` + `ipt>` +
		`<body onload="${RAN('body')}">` +
		'<p>and after</p>';
	const ran = (page: Page) => page.evaluate(() => (window as unknown as { __ran?: string[] }).__ran ?? []);

	test('a paste that holds a frame runs none of the handlers that came with it', async ({ page }) => {
		// (It ran those of <source>, <video>, <audio> and <svg><image>: the editor took out the
		// frames and put the rest in the page as it was, to be made safe there, too late.)
		await open(page, { content: '<p>Body</p>' });
		await page.click(`${content} p`);
		// The paste event, with the HTML as a clipboard carries it: a script cannot put handlers
		// on the clipboard, which the browser takes off what a script writes there.
		const insertedByEditor = await page.evaluate((markup) => {
			const data = new DataTransfer();
			data.setData('text/html', markup);
			const paste = new Event('paste', { bubbles: true, cancelable: true });
			Object.defineProperty(paste, 'clipboardData', { value: data });
			return !document.querySelector('.ink-content')!.dispatchEvent(paste);
		}, HOSTILE);
		expect(insertedByEditor).toBe(true);
		await expect(page.locator(content)).toContainText('and after');
		// (Long enough for a picture that is not there to have failed.)
		await page.waitForTimeout(700);
		expect(await ran(page)).toEqual([]);
		expect(await html(page)).not.toMatch(/\son[a-z]+=|__ran|<(iframe|video|audio|svg|script|style|link|object|input)\b/i);
		await expect(page.locator(content)).toContainText('came in');
	});

	test('nor does a drop that holds a frame', async ({ page }) => {
		await open(page, { content: '<p>Line to drop on</p>' });
		await draggable(page, HOSTILE);
		await page.dragAndDrop('#drag-source', `${content} p`);
		await expect(page.locator(content)).toContainText('and after');
		await page.waitForTimeout(700);
		expect(await ran(page)).toEqual([]);
		expect(await html(page)).not.toMatch(/\son[a-z]+=|__ran|<(iframe|video|audio|svg|script|style|link|object|input)\b/i);
	});

	test('a paste that holds a frame leaves what was done before it to be undone', async ({ page, browserName }) => {
		// (In Safari the words typed before such a paste could not be taken back after it.)
		await open(page, { content: '<p>Body</p>' });
		await page.evaluate(async (markup) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([markup], { type: 'text/html' }) })]);
		}, '<p>came in</p><iframe src="https://example.com/frame"></iframe>');
		await page.click(`${content} p`);
		await page.keyboard.press(LINE_END);
		await page.keyboard.type(' typed');
		await expect(page.locator(content)).toContainText('Body typed');
		// (A pause, as a writer makes one: keys pressed at once are one step to a browser.)
		await page.waitForTimeout(700);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(content)).toContainText('came in');
		expect(await page.locator(`${content} iframe`).count()).toBe(0);
		await page.keyboard.press('ControlOrMeta+z');
		await expect(page.locator(content)).not.toContainText('came in');
		await expect(page.locator(content)).toContainText('Body typed');
		// And the words typed before it can still be taken back.
		await expect
			.poll(async () => {
				await page.keyboard.press('ControlOrMeta+z');
				return page.locator(content).textContent();
			})
			.toBe('Body');
	});

	/** Paste markup at the end of the first paragraph, and give the document as it then is. */
	async function pasteAtEnd(page: Page, markup: string): Promise<string> {
		await page.evaluate(async (markup) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([markup], { type: 'text/html' }) })]);
		}, markup);
		await page.click(`${content} p`);
		await page.keyboard.press('End');
		const before = await html(page);
		await page.keyboard.press('ControlOrMeta+v');
		await expect.poll(() => html(page)).not.toBe(before);
		return html(page);
	}

	/** Undo the paste and redo it, and give the document as it then is. */
	async function undoAndRedo(page: Page, pasted: string, redo: string): Promise<string> {
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => html(page)).not.toBe(pasted);
		const undone = await html(page);
		await page.keyboard.press(redo);
		await expect.poll(() => html(page)).not.toBe(undone);
		return html(page);
	}

	test('Redo does not write back the style that was taken off an element that stayed', async ({ page }) => {
		// Chromium writes the style of a pasted element itself as it pastes, and Redo writes that
		// same style again, on the element the editor had made safe: it was not looked at twice.
		for (const markup of [
			'before <span style="position:fixed;top:0;left:0;width:100vw;height:100vh;color:rgb(0,0,0);font-size:16px">over</span> after',
			'<a href="https://example.com/" style="position:fixed;top:0">link</a> after'
		]) {
			await open(page, { content: '<p>Body text</p>' });
			const pasted = await pasteAtEnd(page, markup);
			expect(pasted).not.toContain('position');
			for (const redo of REDO_KEYS) {
				expect(await undoAndRedo(page, pasted, redo), redo).toBe(pasted);
				expect(
					await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.ink-content *')).filter((el) => getComputedStyle(el).position !== 'static').length),
					redo
				).toBe(0);
			}
		}
	});

	// (Firefox's own Undo did not take back a paste the editor had taken an element or words out
	// of. The editor's Undo does, in every browser.)

	test('Redo does not put the words of a button in the document a second time', async ({ page, browserName }) => {
		await open(page, { content: '<p>Body text</p>' });
		const pasted = await pasteAtEnd(page, '<p>first</p><p>second</p><button>Send</button><textarea>typed in a box</textarea>');
		expect(pasted).not.toMatch(/<button|<textarea/);
		expect(pasted.match(/Send/g)).toHaveLength(1);
		for (const redo of REDO_KEYS) expect(await undoAndRedo(page, pasted, redo), redo).toBe(pasted);
	});

	test('Undo of a paste takes with it the words left where a button was', async ({ page, browserName }) => {
		// (The browser's Undo knows nothing of those words: "Send" stayed in the report, a word
		// of a paste the writer had taken back.)
		await open(page, { content: '<p>Body text</p>' });
		const before = await html(page);
		const pasted = await pasteAtEnd(page, '<p>first</p><p>second</p><button>Send</button><textarea>typed in a box</textarea>');
		for (const redo of REDO_KEYS) {
			await page.keyboard.press('ControlOrMeta+z');
			await expect.poll(() => html(page)).toBe(before);
			await page.keyboard.press(redo);
			await expect.poll(() => html(page), redo).toBe(pasted);
		}
	});

	test('Redo does not show again the words Word hid in a paste', async ({ page, browserName }) => {
		// (Redo puts the paste back as the browser first made it, before those words were taken out.)
		// (WebKit rewrites markup a page puts on the clipboard: "mso-hide" is gone before the paste.)
		test.fixme(browserName === 'webkit');
		await open(page, { content: '<p>Body text</p>' });
		const pasted = await pasteAtEnd(page, '<p>shown <span style="mso-hide:all">secret</span> words</p><p style="mso-hide:all">hidden whole</p><p>next</p>');
		expect(pasted).not.toMatch(/secret|hidden whole/);
		for (const redo of REDO_KEYS) {
			const redone = await undoAndRedo(page, pasted, redo);
			expect(redone, redo).not.toMatch(/secret|hidden whole/);
			expect(redone, redo).toBe(pasted);
		}
	});

	test('Redo leaves a paste of the document\'s own paragraphs as the paste left it', async ({ page }) => {
		// Chromium copies a paragraph with its spacing written out; the paste is tidied of that
		// (see tidyPasted), and Redo wrote it back.
		await open(page, {
			content: '<p style="margin-left: 96px; text-indent: -48px;">indented <b>one</b></p><p style="margin-left: 48px; text-align: center">centered</p><p>target</p>'
		});
		await page.evaluate(() => {
			const blocks = document.querySelector('.ink-content')!.children;
			const range = document.createRange();
			range.setStart(blocks[0], 0);
			range.setEnd(blocks[1], blocks[1].childNodes.length);
			const selection = getSelection()!;
			selection.removeAllRanges();
			selection.addRange(range);
			(document.querySelector('.ink-content') as HTMLElement).focus();
		});
		await page.keyboard.press('ControlOrMeta+c');
		await page.click(`${content} > p >> nth=2`);
		await page.keyboard.press('End');
		const before = await html(page);
		await page.keyboard.press('ControlOrMeta+v');
		await expect.poll(() => html(page)).not.toBe(before);
		const pasted = await html(page);
		expect(pasted).not.toContain('0.2em');
		for (const redo of REDO_KEYS) expect(await undoAndRedo(page, pasted, redo), redo).toBe(pasted);
	});

	test('a document with an element named "constructor" opens, is replaced by the next one, and can be pasted', async ({ page }) => {
		const odd = '<constructor data-x="1" width="5">odd</constructor>';
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await open(page, { content: `<p>Patient A</p>${odd}` });
		await expect(page.locator(content)).toContainText('Patient A');
		await page.evaluate((odd) => window.ed.setHTML(`<p>Patient B</p>${odd}`), odd);
		await expect(page.locator(content)).toContainText('Patient B');
		await expect(page.locator(content)).not.toContainText('Patient A');
		// The size estimate is a number, which an application compares with its limit.
		const estimate = await page.evaluate(() => window.lib.estimateRtfBytes(document.querySelector('.ink-content') as HTMLElement));
		expect(typeof estimate).toBe('number');
		expect(estimate).toBeGreaterThanOrEqual(await page.evaluate(() => window.ed.getRTF().length));
		expect(await page.evaluate(() => window.ed.getRTF())).not.toMatch(/undefined|NaN/);
		expect(errors).toEqual([]);
	});

	test('Bold, and a button of the toolbar, change what is selected now, not what was selected when a link was made', async ({ page }) => {
		await open(page, { content: '<p>alpha beta gamma</p><p>second paragraph</p><p>third paragraph</p>' });
		await selectIn(page, 0, 6, 10);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.type('https://example.com/');
		await page.keyboard.press('Enter');
		await expect(page.locator(`${content} a`)).toHaveText('beta');
		await selectIn(page, 1, 0, 6);
		await page.keyboard.press('ControlOrMeta+b');
		await selectIn(page, 2, 0, 5);
		await page.getByRole('button', { name: 'Italic (Ctrl+I)' }).click();
		expect(await html(page)).toBe(
			'<p>alpha <a href="https://example.com/">beta</a> gamma</p><p><b>second</b> paragraph</p><p><i>third</i> paragraph</p>'
		);
	});

	test('a button of the toolbar pressed while the selection is elsewhere on the page changes what was last selected in the document', async ({ page }) => {
		await open(page, { content: '<p>alpha beta gamma</p><p>second paragraph</p>' });
		await selectIn(page, 0, 0, 5);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.press('Escape');
		await selectIn(page, 1, 0, 6);
		// (A selection is there for longer than no time at all: the browser says it has changed
		// a moment after it has.)
		await page.evaluate(() => new Promise((done) => setTimeout(done, 50)));
		// The selection leaves the document: something on the page around the editor is selected.
		await page.evaluate(() => {
			const outside = document.createElement('p');
			outside.id = 'outside';
			outside.textContent = 'words of the page around the editor';
			document.body.append(outside);
			getSelection()!.selectAllChildren(outside);
		});
		await page.getByRole('button', { name: 'Bold (Ctrl+B)' }).click();
		expect(await html(page)).toBe('<p>alpha beta gamma</p><p><b>second</b> paragraph</p>');
		expect(await page.evaluate(() => document.getElementById('outside')!.innerHTML)).toBe('words of the page around the editor');
		// The same for a dialog opened from the toolbar: the link is made of those words, not
		// put at the top of the document as its own address.
		await page.evaluate(() => getSelection()!.selectAllChildren(document.getElementById('outside')!));
		await page.evaluate(() => new Promise((done) => setTimeout(done, 50)));
		await page.getByRole('button', { name: 'Insert link (Ctrl+K)' }).click();
		await page.keyboard.type('https://example.com/');
		await page.keyboard.press('Enter');
		expect(await html(page)).toBe('<p>alpha beta gamma</p><p><b><a href="https://example.com/">second</a></b> paragraph</p>');
		expect(await page.evaluate(() => document.getElementById('outside')!.innerHTML)).toBe('words of the page around the editor');
	});

	test('text copied in Word is pasted as its words, not as the picture of them Word copies beside', async ({ page, browserName }) => {
		// (Chromium hands a paste both, and the picture was taken: the text of a report went in as
		// a picture of it. Only Chromium can put both on the clipboard from a page.)
		test.skip(browserName !== 'chromium');
		const copy = (html: string) =>
			page.evaluate(async (html) => {
				const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
				const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
				await navigator.clipboard.write([
					new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'image/png': new Blob([bytes], { type: 'image/png' }) })
				]);
			}, html);
		await open(page, { content: '<p>Body</p>' });
		await copy(
			"<html><head><style>p.MsoNormal{margin:0in;font-size:11pt}</style></head><body><!--StartFragment--><p class=MsoNormal>Margins are clear <span style='mso-hide:all'>SECRET </span>of tumor.</p><!--EndFragment--></body></html>"
		);
		await page.click(`${content} p`);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(content)).toContainText('of tumor.');
		await expect(page.locator(content)).not.toContainText('SECRET');
		await expect(page.locator(content)).toContainText(/Margins are clear\s+of tumor\./);
		expect(await page.locator(`${content} img`).count()).toBe(0);
		// A picture copied in a browser comes with HTML too, but no words: it is still a picture.
		await open(page, { content: '<p>Body</p>' });
		await copy('<meta charset="utf-8"><img src="https://example.com/a.png" alt="">');
		await page.click(`${content} p`);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(`${content} figure img`)).toHaveCount(1);
		expect(await page.locator(`${content} img`).getAttribute('src')).toMatch(/^data:image\/png/);
	});

	test('a picture from the dialog goes in where the caret was when the dialog was opened', async ({ page }) => {
		// (The dialog closes before the picture has been read, and the browser then puts a caret
		// of its own at the top of the document: the picture went in after the first paragraph.)
		const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
		for (const how of ['button', 'Enter']) {
			await open(page, { content: '<p>first</p><p>second</p><p>third</p>' });
			await selectIn(page, 2, 5, 5);
			await page.getByRole('button', { name: 'Insert image' }).click();
			await page.getByLabel('Image address').fill(PNG);
			if (how === 'Enter') await page.keyboard.press('Enter');
			else await page.getByRole('button', { name: 'Insert', exact: true }).click();
			await expect(page.locator(`${content} figure`)).toHaveCount(1);
			expect(await page.evaluate(() => Array.from(document.querySelector('.ink-content')!.children).map((el) => el.tagName.toLowerCase()).slice(0, 4)), how).toEqual(['p', 'p', 'p', 'figure']);
		}
	});

	test('Undo and Redo leave what was typed and formatted as it was', async ({ page }) => {
		// (They now look at what they bring back. Nothing of the editor's own is taken out by that.)
		await open(page);
		await page.click(content);
		await page.keyboard.type('Plain ');
		await page.keyboard.press('ControlOrMeta+b');
		await page.keyboard.type('bold');
		await page.keyboard.press('ControlOrMeta+b');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Tab');
		await page.keyboard.type('tabbed');
		await page.keyboard.press('Enter');
		await page.getByRole('button', { name: 'Bullet list' }).click();
		await page.keyboard.type('item one');
		await page.keyboard.press('Enter');
		await page.keyboard.type('sized');
		await page.keyboard.press(SELECT_TO_LINE_START);
		await page.locator('select[aria-label="Font size"]').selectOption('18');
		await page.keyboard.press(LINE_END);
		await page.keyboard.press('Enter');
		await page.keyboard.type('linked');
		await page.keyboard.press(SELECT_TO_LINE_START);
		await page.keyboard.press('ControlOrMeta+k');
		await page.keyboard.type('https://example.com/');
		await page.keyboard.press('Enter');
		const typed = await html(page);
		expect(typed).toContain('<b>bold</b>');
		expect(typed).toContain('font-size: 18pt');
		expect(typed).toContain('<a href="https://example.com/">linked</a>');
		for (const steps of [3, 60]) {
			for (let i = 0; i < steps; i++) await page.keyboard.press('ControlOrMeta+z');
			for (let i = 0; i < steps; i++) await page.keyboard.press('ControlOrMeta+Shift+z');
			expect(await html(page), `${steps} steps back and forth`).toBe(typed);
		}
	});

	test('Ctrl+S hands the document to onsave where no draft is kept', async ({ page }) => {
		await open(page, { content: '<p>Report</p>' });
		await page.click(`${content} p`);
		await page.keyboard.press('End');
		await page.keyboard.type('!');
		await page.keyboard.press('ControlOrMeta+s');
		expect(await page.evaluate(() => window.saves)).toEqual(['<p>Report!</p>']);
		expect(await page.evaluate(() => localStorage.length)).toBe(0);
	});
});

test.describe('what a review of main before 1.13.0 found', () => {
	// Light words on a gradient or a picture: neither is kept, and the words were left white on
	// the white of the page, in the editor and in the RTF. Invented text.
	const BANNER =
		'<div style="background:linear-gradient(to right,#003366,#0055aa);color:#ffffff;padding:8px"><h2 style="color:#ffffff">Diagnosis</h2>' +
		'<p>Invasive ductal carcinoma, <span style="color:#fff">grade 2</span>, <span style="color:#c00000">margins positive</span>.</p></div>' +
		'<table><tr><td style="background-image:linear-gradient(#111,#333)"><font color="#FFFFFF">HER2</font></td><td>Negative (1+)</td></tr></table>';
	/** How each of the words is drawn: its color against white, as WCAG counts contrast. */
	const contrasts = (page: Page) =>
		page.evaluate(() => {
			const part = (value: number) => {
				const s = value / 255;
				return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
			};
			const onWhite = (color: string) => {
				const [r, g, b] = color.match(/\d+/g)!.map(Number);
				return 1.05 / (0.2126 * part(r) + 0.7152 * part(g) + 0.0722 * part(b) + 0.05);
			};
			const ed = document.querySelector('.ink-content')!;
			const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
			const out: Record<string, number> = {};
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const words = node.textContent!.trim();
				if (words) out[words] = Math.round(onWhite(getComputedStyle(node.parentElement!).color) * 10) / 10;
			}
			return out;
		});
	const readable = async (page: Page) => {
		const drawn = await contrasts(page);
		expect(Object.keys(drawn).join('|')).toContain('Diagnosis');
		expect(Object.keys(drawn).join('|')).toContain('HER2');
		// Every word can be read on the white it is now on, and the red is still red.
		for (const [words, contrast] of Object.entries(drawn)) expect(contrast, words).toBeGreaterThan(4.5);
		expect(await html(page)).toMatch(/color: ?(#c00000|rgb\(192, 0, 0\))/);
		expect(await html(page)).not.toMatch(/gradient|#fff|rgb\(255, 255, 255\)/i);
		const rtf = await page.evaluate(() => window.ed.getRTF());
		expect(rtf).not.toContain('\\red255\\green255\\blue255;');
		for (const words of ['Diagnosis', 'grade 2', 'HER2']) expect(rtf).toContain(words);
	};

	test('light words on a gradient are not left white on white: in a document that is opened', async ({ page }) => {
		await open(page, { content: BANNER });
		await readable(page);
	});

	test('nor in one that is pasted', async ({ page }) => {
		await open(page, { content: '<p>Report</p>' });
		await page.click(`${content} p`);
		await page.evaluate(async (pasted) => {
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([pasted], { type: 'text/html' }) })]);
		}, BANNER);
		await page.keyboard.press('ControlOrMeta+v');
		await expect(page.locator(content)).toContainText('Negative (1+)');
		await readable(page);
	});

	test('white that had a color behind it, or nothing at all, is left as it was chosen', async ({ page }) => {
		await open(page, {
			content:
				'<p><span style="background-color:#1F3864;color:#ffffff">shaded</span></p><p style="color:#ffffff">chosen</p>' +
				'<div style="background-color:#000080"><p style="background-image:linear-gradient(#000,#333);color:#ffffff">on navy</p></div>'
		});
		const drawn = await contrasts(page);
		expect(drawn).toEqual({ shaded: 1, chosen: 1, 'on navy': 1 });
	});
});

test.describe('Clear formatting', () => {
	// The browser's own command does this differently in each browser: these run in all three.
	const MAC = process.platform === 'darwin';
	const REDO = MAC ? 'Meta+Shift+z' : 'Control+Shift+z';
	const FORMATTED =
		'<h2 style="text-align: center;">Heading <i>one</i></h2>' +
		'<p style="font-size: 14pt; color: red; text-align: right; margin-left: 48px; text-indent: -24px;">plain <b>bold</b> <u>under</u> <s>strike</s> <font color="#ff0000">red</font> <font style="font-size: 18pt;">big</font></p>' +
		'<p>Body<span style="color: rgb(0, 0, 0); font-size: 11pt; font-family: Calibri, sans-serif;">from Word <b style="font-weight: 700">bold</b></span></p>' +
		'<p><span style="white-space:pre">\t</span>tabbed, a <a href="https://example.com/">link <b>in bold</b></a> and a <span data-field="dx" class="mark" style="color: blue;">mark</span></p>' +
		'<ul><li><b>item</b> one</li></ul>' +
		'<table><tbody><tr><td style="font-weight: bold; color: blue; background-color: rgb(238, 238, 238);">cell</td></tr></tbody></table><p>end</p>';
	const marks = { keepAttributes: 'data-field', keepClasses: 'mark' };

	/** Select from the `from`th to the `to`th character of the document's text, or all of it. */
	async function selectChars(page: Page, from = 0, to = Infinity): Promise<void> {
		await page.evaluate(
			({ from, to }) => {
				const ed = document.querySelector('.ink-content') as HTMLElement;
				ed.focus();
				const range = document.createRange();
				range.selectNodeContents(ed);
				const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
				let at = 0;
				for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
					if (from >= at && from <= at + text.data.length) range.setStart(text, from - at);
					if (to !== null && to >= at && to <= at + text.data.length) {
						range.setEnd(text, to - at);
						break;
					}
					at += text.data.length;
				}
				getSelection()!.removeAllRanges();
				getSelection()!.addRange(range);
			},
			{ from, to: Number.isFinite(to) ? to : null }
		);
	}
	const clear = (page: Page) => page.getByRole('button', { name: 'Clear formatting' }).click();

	test('takes the looks off the selected text, and leaves what the text is', async ({ page }) => {
		await open(page, { content: FORMATTED, ...marks });
		const words = await page.locator(content).textContent();
		await selectChars(page);
		await clear(page);
		const found = await page.evaluate(() => {
			const ed = document.querySelector('.ink-content')!;
			const styled = (el: HTMLElement) => ['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-decoration-line'].filter((prop) => el.style.getPropertyValue(prop));
			const [styledParagraph] = Array.from(ed.querySelectorAll('p'));
			const cell = ed.querySelector('td')!;
			const mark = ed.querySelector<HTMLElement>('span[data-field="dx"].mark');
			const tab = Array.from(ed.querySelectorAll('span')).find((span) => span.textContent === '\t');
			return {
				formatting: Array.from(ed.querySelectorAll('b, strong, i, em, u, s, strike, font[color], font[size], font[face]')).map((el) => el.tagName.toLowerCase()),
				looksWritten: Array.from(ed.querySelectorAll<HTMLElement>('*')).flatMap(styled),
				structure: Array.from(ed.children).map((el) => el.tagName.toLowerCase()).join(' '),
				heading: (ed.querySelector('h2') as HTMLElement).style.textAlign,
				layout: [styledParagraph.style.textAlign, styledParagraph.style.marginLeft, styledParagraph.style.textIndent],
				link: ed.querySelector('a')?.getAttribute('href'),
				tab: tab ? getComputedStyle(tab).whiteSpaceCollapse || getComputedStyle(tab).whiteSpace : 'gone',
				mark: mark ? mark.textContent : 'gone',
				cell: [cell.style.backgroundColor, getComputedStyle(cell).fontWeight]
			};
		});
		expect(found.formatting).toEqual([]);
		expect(found.looksWritten).toEqual([]);
		// What the text is, where it stands, and whose it is: as before.
		expect(found.structure).toBe('h2 p p p ul table p');
		expect(found.heading).toBe('center');
		expect(found.layout).toEqual(['right', '48px', '-24px']);
		expect(found.link).toBe('https://example.com/');
		expect(found.tab).toMatch(/^(pre|preserve)$/);
		expect(found.mark).toBe('mark');
		expect(found.cell).toEqual(['rgb(238, 238, 238)', '400']);
		expect(await page.locator(content).textContent()).toBe(words);
	});

	test('Undo puts everything back, and Redo takes it off again', async ({ page }) => {
		await open(page, { content: FORMATTED, ...marks });
		const before = await html(page);
		await selectChars(page);
		await clear(page);
		const cleared = await html(page);
		expect(cleared).not.toBe(before);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => html(page)).toBe(before);
		await page.keyboard.press(REDO);
		await expect.poll(() => html(page)).toBe(cleared);
		// And from the toolbar.
		await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
		await expect.poll(() => html(page)).toBe(before);
		await page.getByRole('button', { name: 'Redo' }).click();
		await expect.poll(() => html(page)).toBe(cleared);
	});

	test('clears only the words selected of a run in bold', async ({ page }) => {
		await open(page, { content: '<p>one <b>bold words here</b> two</p>' });
		await selectChars(page, 9, 14);
		await clear(page);
		expect(await html(page)).toBe('<p>one <b>bold </b>words<b> here</b> two</p>');
	});

	test('a mark of the application stays whole, whatever part of it is selected', async ({ page }) => {
		// (Firefox's command cuts the element in two around the selected words, and takes it
		// out where all of it is selected.)
		const content = '<p>a <span data-field="dx" style="color: red;">marked <b>words</b> here</span> b <i>end</i></p>';
		for (const [from, to] of [[9, 14], [0, 6], [12, 25], [0, 25]]) {
			await open(page, { content, ...marks });
			await selectChars(page, from, to);
			await clear(page);
			const found = await page.evaluate(() => {
				const ed = document.querySelector('.ink-content')!;
				return {
					marks: Array.from(ed.querySelectorAll('span[data-field="dx"]')).map((el) => el.textContent),
					leftBehind: ed.querySelectorAll('[data-ink-keep], [contenteditable]').length,
					text: ed.textContent
				};
			});
			expect(found, `${from} to ${to}`).toEqual({ marks: ['marked words here'], leftBehind: 0, text: 'a marked words here b end' });
		}
		// And what is selected outside the mark is cleared, also where the selection ends inside it.
		await open(page, { content: '<p><b>bold</b> a <span data-field="dx">marked words</span></p>', ...marks });
		await selectChars(page, 0, 13);
		await clear(page);
		expect(await html(page)).toBe('<p>bold a <span data-field="dx">marked words</span></p>');
	});

	test('after more is typed, Undo still loses no words', async ({ page }) => {
		// (An editor that takes the <b> out itself leaves the browser's history pointing at
		// what is no longer there: in Safari the next Undo then emptied the document.)
		await open(page, { content: '<p>keep this <b>bold</b> and <i>this</i> text</p><p>second paragraph</p>' });
		await selectChars(page, 0, 28);
		await clear(page);
		expect(await html(page)).toBe('<p>keep this bold and this text</p><p>second paragraph</p>');
		await page.evaluate(() => {
			const range = document.createRange();
			range.selectNodeContents(document.querySelectorAll('.ink-content p')[1]);
			range.collapse(false);
			getSelection()!.removeAllRanges();
			getSelection()!.addRange(range);
		});
		await page.keyboard.type(' typed');
		for (let i = 0; i < 4; i++) {
			await page.keyboard.press('ControlOrMeta+z');
			await page.waitForTimeout(100);
			expect(await page.locator(content).textContent()).toContain('keep this bold and this text');
			expect(await page.locator(content).textContent()).toContain('second paragraph');
		}
		// And the formatting came back with the browser's own Undo.
		expect(await html(page)).toBe('<p>keep this <b>bold</b> and <i>this</i> text</p><p>second paragraph</p>');
	});

	test('after more is typed, Undo brings the color back with the bold, and Redo clears both again', async ({ page }) => {
		// The browser undoes its own command and knows nothing of the color the editor took off
		// the paragraph: bold was back and the color was not.
		for (const content of [
			'<p style="color: red; text-align: center;">red <b>bold</b> <font color="#0000ff">blue</font></p><p>second</p>',
			// (Here the editor does all of it: the browser's command finds nothing to take out.)
			'<p style="color: red; text-align: center;">red paragraph</p><p>second</p>'
		]) {
			await open(page, { content });
			const before = await html(page);
			await page.evaluate(() => {
				const range = document.createRange();
				range.selectNodeContents(document.querySelector('.ink-content p')!);
				getSelection()!.removeAllRanges();
				getSelection()!.addRange(range);
			});
			await clear(page);
			const cleared = await html(page);
			expect(cleared).toContain('<p style="text-align: center;">red ');
			expect(cleared).not.toMatch(/color|<b>|<font/);
			await page.evaluate(() => {
				const range = document.createRange();
				range.selectNodeContents(document.querySelectorAll('.ink-content p')[1]);
				range.collapse(false);
				getSelection()!.removeAllRanges();
				getSelection()!.addRange(range);
			});
			await page.keyboard.type(' typed');
			// (Safari takes what was typed and the command back in one step, the others in two.)
			const pressUntil = async (keys: string, wanted: string) => {
				for (let i = 0; i < 3 && (await html(page)) !== wanted; i++) {
					await page.keyboard.press(keys);
					await page.waitForTimeout(100);
				}
				expect(await html(page)).toBe(wanted);
			};
			await pressUntil('ControlOrMeta+z', before);
			await pressUntil(REDO, cleared.replace('second', 'second typed'));
		}
	});

	test('the application can ask for it, and with nothing selected nothing is changed', async ({ page }) => {
		await open(page, { content: '<p style="color: red;">one <b>bold</b></p><p>two</p>' });
		const before = await html(page);
		await page.click(`${content} p:nth-of-type(2)`);
		await page.evaluate(() => window.ed.clearFormatting());
		expect(await html(page)).toBe(before);
		await selectChars(page);
		await page.evaluate(() => window.ed.clearFormatting());
		expect(await html(page)).toBe('<p>one bold</p><p>two</p>');
	});
});

test.describe('Fonts', () => {
	// The browser's own font command does the work, and each browser has its own: these run in
	// all three. The fonts are set apart by "|" in the address, since a font may be a list.
	const fonts = 'Georgia|Calibri, Carlito, sans-serif|Arial';
	const MAC = process.platform === 'darwin';
	const REDO = MAC ? 'Meta+Shift+z' : 'Control+Shift+z';
	const list = 'select[title="Font"]';
	const rtfBody = async (page: Page) => body(await page.evaluate(() => window.ed.getRTF()));

	/** Select from the `from`th to the `to`th character of the document's text. */
	async function selectChars(page: Page, from: number, to: number): Promise<void> {
		await page.evaluate(
			({ from, to }) => {
				const ed = document.querySelector('.ink-content') as HTMLElement;
				ed.focus();
				const range = document.createRange();
				const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
				let at = 0;
				for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
					if (from >= at && from <= at + text.data.length) range.setStart(text, from - at);
					if (to >= at && to <= at + text.data.length) {
						range.setEnd(text, to - at);
						break;
					}
					at += text.data.length;
				}
				getSelection()!.removeAllRanges();
				getSelection()!.addRange(range);
			},
			{ from, to }
		);
	}
	/** What the font list shows. (After a key, so that the toolbar has looked at the selection.) */
	async function shown(page: Page): Promise<string> {
		await page.keyboard.press('Shift');
		return page.locator(list).evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
	}

	test('an editor that offers no fonts shows none: not from a document, and not from a paste', async ({ page }) => {
		// (They used to stay on the screen, and were never in the RTF.)
		await open(page, { content: '<p style="font-family: Papyrus; text-align: right;">one <font face="Georgia" color="#ff0000">two</font></p>' });
		expect(await html(page)).toBe('<p style="text-align: right;">one <font color="#ff0000">two</font></p>');
		await page.evaluate(async () => {
			const markup = '<span style="font-family: Calibri, sans-serif; font-size: 11pt; font-weight: bold;">from Word</span>';
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([markup], { type: 'text/html' }) })]);
		});
		await page.click(`${content} p`);
		await page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End');
		const before = await html(page);
		await page.keyboard.press('ControlOrMeta+v');
		await expect.poll(() => html(page)).not.toBe(before);
		const pasted = await html(page);
		expect(pasted).not.toMatch(/Calibri|font-family/);
		expect(pasted).toMatch(/font-weight: (bold|700)/);
		expect(await page.locator(content).textContent()).toContain('from Word');
	});

	test('there is no font list unless fonts are offered', async ({ page }) => {
		await open(page, { content: '<p>one</p>' });
		await expect(page.locator(list)).toHaveCount(0);
		await open(page, { content: '<p>one</p>', fonts });
		expect(await page.locator(`${list} option`).allTextContents()).toEqual(['Segoe UI', 'Georgia', 'Calibri', 'Arial']);
	});

	test('the list sets the font of the selected words, shows it, and the RTF and the viewer carry it', async ({ page }) => {
		await open(page, { content: '<p>one two three four</p>', fonts });
		await selectChars(page, 4, 13);
		await page.selectOption(list, 'georgia');
		expect(await html(page)).toBe('<p>one <font face="Georgia, serif">two three</font> four</p>');
		expect(await shown(page)).toBe('Georgia');
		// A second font on some of those words: beside the first, not inside it.
		await selectChars(page, 8, 13);
		await page.selectOption(list, 'calibri');
		expect(await html(page)).toBe('<p>one <font face="Georgia, serif">two </font><font face="Calibri, Carlito, sans-serif">three</font> four</p>');
		expect(await shown(page)).toBe('Calibri');
		await selectChars(page, 5, 10);
		expect(await shown(page)).toBe('');
		await selectChars(page, 0, 2);
		expect(await shown(page)).toBe('Segoe UI');

		const rtf = await page.evaluate(() => window.ed.getRTF());
		expect(rtf).toContain('{\\f2\\froman\\fcharset0 Georgia;}{\\f3\\fswiss\\fcharset0 Calibri;}}');
		expect(body(rtf)).toBe('\\pard one \\f2 two \\f0 \\f3 three\\f0  four\\par }');
		await page.evaluate((rtf) => window.setViewer(rtf), rtf);
		await expect(page.locator('#viewer span[style*="Georgia"]')).toHaveText('two');
		await expect(page.locator('#viewer span[style*="Calibri"]')).toHaveText('three');
	});

	test('Undo takes the font off again and Redo puts it back', async ({ page }) => {
		await open(page, { content: '<p>one two three</p>', fonts });
		const before = await html(page);
		await selectChars(page, 4, 7);
		await page.selectOption(list, 'arial');
		const set = await html(page);
		expect(set).toBe('<p>one <font face="Arial, sans-serif">two</font> three</p>');
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => html(page)).toBe(before);
		await page.keyboard.press(REDO);
		await expect.poll(() => html(page)).toBe(set);
	});

	test('the document font, chosen from the list, sets words back to it', async ({ page }) => {
		await open(page, { content: '<p>one <font face="Georgia, serif">two three</font> four</p>', fonts });
		await selectChars(page, 4, 7);
		await page.selectOption(list, '');
		// (Chromium and Safari take the font off the words; Firefox names the document font on
		// them. Either way they are in the document font: in the RTF, and in the list.)
		expect(await rtfBody(page)).toBe('\\pard one two\\f2  three\\f0  four\\par }');
		await selectChars(page, 4, 7);
		expect(await shown(page)).toBe('Segoe UI');
		expect(await page.locator(`${content} p`).textContent()).toBe('one two three four');
	});

	test('a document font given as a list is shown in what follows where the first is missing, and words go back to it', async ({ page }) => {
		// (A font no machine has, then one the page could have loaded: here Courier New, whose
		// letters are all one width, so that it shows in the width of a line.)
		const fontFamily = 'No Such Font 3, Courier New, monospace';
		await open(page, { content: '<p>iiiiii <font face="Georgia, serif">WWWWWW</font> end</p>', fonts, fontFamily });
		const widths = await page.evaluate(() => {
			const paragraph = document.querySelector('.ink-content p') as HTMLElement;
			const measure = (font: string) => {
				const probe = document.createElement('span');
				probe.style.cssText = `font-family: ${font}; font-size: ${getComputedStyle(paragraph).fontSize}; white-space: pre; position: absolute;`;
				probe.textContent = 'iiiiii';
				document.body.append(probe);
				const width = probe.getBoundingClientRect().width;
				probe.remove();
				return width;
			};
			const range = document.createRange();
			range.setStart(paragraph.firstChild!, 0);
			range.setEnd(paragraph.firstChild!, 6);
			return { shown: range.getBoundingClientRect().width, fallback: measure('"Courier New", monospace'), family: getComputedStyle(paragraph).fontFamily };
		});
		expect(widths.family).toMatch(/No Such Font 3.*Courier New.*monospace/);
		expect(Math.abs(widths.shown - widths.fallback)).toBeLessThan(0.5);
		// The list names the document font by its first family, and that is what the RTF names.
		expect(await page.locator(`${list} option`).first().textContent()).toBe('No Such Font 3');
		await selectChars(page, 7, 13);
		await page.selectOption(list, '');
		const rtf = await page.evaluate(() => window.ed.getRTF());
		expect(rtf).toContain('{\\fonttbl{\\f0\\fswiss\\fcharset0 No Such Font 3;}{\\f1\\fmodern\\fcharset0 Courier New;}}');
		expect(body(rtf)).toBe('\\pard iiiiii WWWWWW end\\par }');
		await selectChars(page, 7, 13);
		expect(await shown(page)).toBe('No Such Font 3');
	});

	test('the lists show nothing where the selection is in more than one font or size, and are boxes one can see', async ({ page }) => {
		// The same font and size at both ends, and others in between.
		await open(page, { content: '<p>plain <font face="Georgia, serif">geo</font> and <font style="font-size: 18pt;">big</font> end</p>', fonts });
		const size = 'select[title="Font size"]';
		const all = 'plain geo and big end'.length;
		await selectChars(page, 0, all);
		expect(await shown(page)).toBe('');
		expect(await page.locator(size).evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent)).toBe('');
		for (const box of [list, size, 'select[title="Paragraph style"]']) {
			const style = await page.locator(box).evaluate((el) => {
				const css = getComputedStyle(el);
				return { width: css.borderTopWidth, line: css.borderTopStyle, radius: parseFloat(css.borderTopLeftRadius), color: css.borderTopColor };
			});
			expect(style.width, box).toBe('1px');
			expect(style.line, box).toBe('solid');
			expect(style.radius, box).toBeGreaterThanOrEqual(6);
			expect(style.color, box).not.toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
		}
		// Part of it, in one font and one size: the lists say which.
		await selectChars(page, 0, 5);
		expect(await shown(page)).toBe('Segoe UI');
		await selectChars(page, 6, 9);
		expect(await shown(page)).toBe('Georgia');
		await selectChars(page, 0, 12);
		expect(await shown(page)).toBe('');
		expect(await page.inputValue(size)).toBe('12');
		// Chosen from the empty list, a font is the font of all of it.
		await selectChars(page, 0, all);
		await page.selectOption(list, { label: 'Arial' });
		await selectChars(page, 0, all);
		expect(await shown(page)).toBe('Arial');
		expect(await page.locator(size).evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent)).toBe('');
	});

	test('a font chosen at a caret is the font of what is typed next', async ({ page }) => {
		await open(page, { content: '<p>one</p>', fonts });
		await page.click(`${content} p`);
		await page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End');
		await page.selectOption(list, 'georgia');
		expect(await page.locator(list).evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent)).toBe('Georgia');
		await page.keyboard.type('X');
		expect(await html(page)).toBe('<p>one<font face="Georgia, serif">X</font></p>');
		expect(await shown(page)).toBe('Georgia');
	});

	test('the application can set a font, and only one that is offered', async ({ page }) => {
		await open(page, { content: '<p>one two</p>', fonts });
		await selectChars(page, 0, 3);
		await page.evaluate(() => window.ed.setFont('Papyrus'));
		expect(await html(page)).toBe('<p>one two</p>');
		await page.evaluate(() => window.ed.setFont('Calibri'));
		expect(await html(page)).toBe('<p><font face="Calibri, Carlito, sans-serif">one</font> two</p>');
	});

	/** Right-click in the middle of the selected text. */
	async function rightClickSelection(page: Page, modifiers: ('Shift')[] = []): Promise<void> {
		const box = await page.evaluate(() => {
			const r = getSelection()!.getRangeAt(0).getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.move(box.x, box.y);
		for (const key of modifiers) await page.keyboard.down(key);
		await page.mouse.down({ button: 'right' });
		await page.mouse.up({ button: 'right' });
		for (const key of modifiers) await page.keyboard.up(key);
	}
	const menu = '[role="menu"][aria-label="Font"]';

	test('a right-click opens no menu of the editor unless the application asks for one', async ({ page }) => {
		await open(page, { content: '<p>one two</p>', fonts });
		await selectChars(page, 0, 3);
		await rightClickSelection(page);
		await expect(page.locator(menu)).toHaveCount(0);
		// (Nor with the menu asked for, where there are no fonts to offer.)
		await open(page, { content: '<p>one two</p>', fontMenu: '' });
		await selectChars(page, 0, 3);
		await rightClickSelection(page);
		await expect(page.locator(menu)).toHaveCount(0);
	});

	test('the font menu sets the font of the selected words, shows the font they are in, and is undone with the rest', async ({ page }) => {
		await open(page, { content: '<p>one two three</p>', fonts, fontMenu: '' });
		const before = await html(page);
		await selectChars(page, 4, 7);
		await rightClickSelection(page);
		await expect(page.locator(menu)).toBeVisible();
		const names = (await page.locator(`${menu} [role="menuitemradio"]`).allTextContents()).map((t) => t.replace('✓', '').trim());
		expect(names).toEqual(['Segoe UI', 'Georgia', 'Calibri', 'Arial']);
		await expect(page.locator(`${menu} [aria-checked="true"]`)).toHaveText(/Segoe UI/);
		// Each choice is shown in its own font.
		expect(await page.locator(`${menu} [role="menuitemradio"]`, { hasText: 'Georgia' }).evaluate((b) => getComputedStyle(b).fontFamily)).toMatch(/^Georgia/);
		await page.locator(`${menu} [role="menuitemradio"]`, { hasText: 'Georgia' }).click();
		await expect(page.locator(menu)).toHaveCount(0);
		expect(await html(page)).toBe('<p>one <font face="Georgia, serif">two</font> three</p>');
		// The words keep the selection and the keyboard: typing goes on there.
		expect(await page.evaluate(() => [document.activeElement?.className.includes('ink-content'), getSelection()!.toString()])).toEqual([true, 'two']);
		// The toolbar's list shows it, and the menu, opened again, has it checked.
		expect(await shown(page)).toBe('Georgia');
		await selectChars(page, 4, 7);
		await rightClickSelection(page);
		await expect(page.locator(`${menu} [aria-checked="true"]`)).toHaveText(/Georgia/);
		await page.keyboard.press('Escape');
		await expect(page.locator(menu)).toHaveCount(0);
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => html(page)).toBe(before);
	});

	test('the font menu is used from the keyboard, and a press elsewhere closes it', async ({ page }) => {
		await open(page, { content: '<p>one two three</p>', fonts, fontMenu: '' });
		await selectChars(page, 8, 13);
		await rightClickSelection(page);
		await expect(page.locator(`${menu} [role="menuitemradio"]`).first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await expect(page.locator(menu)).toHaveCount(0);
		expect(await html(page)).toBe('<p>one two <font face="Calibri, Carlito, sans-serif">three</font></p>');
		// Up from the first goes round to the last.
		await selectChars(page, 0, 3);
		await rightClickSelection(page);
		await page.keyboard.press('ArrowUp');
		await expect(page.locator(`${menu} [role="menuitemradio"]`).last()).toBeFocused();
		await page.keyboard.press(' ');
		expect(await html(page)).toBe('<p><font face="Arial, sans-serif">one</font> two <font face="Calibri, Carlito, sans-serif">three</font></p>');
		// A click outside closes it and changes nothing.
		await selectChars(page, 4, 7);
		await rightClickSelection(page);
		await expect(page.locator(menu)).toBeVisible();
		const now = await html(page);
		await page.mouse.click(5, 5);
		await expect(page.locator(menu)).toHaveCount(0);
		expect(await html(page)).toBe(now);
	});

	test('the menu key opens the font menu at the caret', async ({ page, browserName }) => {
		// (Only Chromium makes the menu's event of a key that a test presses.)
		test.skip(browserName !== 'chromium', 'the key opens no menu under test in this engine');
		await open(page, { content: '<p>one two three</p>', fonts, fontMenu: '' });
		await selectChars(page, 4, 7);
		await page.keyboard.press('ContextMenu');
		await expect(page.locator(`${menu} [aria-checked="true"]`)).toBeFocused();
		const [word, box] = await Promise.all([
			page.evaluate(() => getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON()),
			page.locator(menu).boundingBox()
		]);
		expect(Math.abs(box!.x - word.left)).toBeLessThan(2);
		expect(box!.y).toBeGreaterThanOrEqual(word.bottom);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		expect(await html(page)).toBe('<p>one <font face="Arial, sans-serif">two</font> three</p>');
	});

	test('Shift with the right-click, and a right-click on a link, leave the browser its own menu', async ({ page }) => {
		await open(page, { content: '<p>one <a href="https://example.com/">two</a> three</p>', fonts, fontMenu: '' });
		const prevented = () => page.evaluate(() => window.__ran ?? '');
		await page.evaluate(() => {
			window.addEventListener('contextmenu', (e) => (window.__ran = String(e.defaultPrevented)));
		});
		await selectChars(page, 8, 13);
		await rightClickSelection(page, ['Shift']);
		await expect(page.locator(menu)).toHaveCount(0);
		// (Firefox gives Shift and a right-click to its own menu without telling the page.)
		expect(await prevented()).not.toBe('true');
		await selectChars(page, 4, 7);
		await rightClickSelection(page);
		await expect(page.locator(menu)).toHaveCount(0);
		expect(await prevented()).toBe('false');
		await selectChars(page, 8, 13);
		await rightClickSelection(page);
		await expect(page.locator(menu)).toBeVisible();
		expect(await prevented()).toBe('true');
	});

	test('Clear formatting takes the font off', async ({ page }) => {
		await open(page, { content: '<p>one <font face="Georgia, serif">two</font> <span style="font-family: Arial, sans-serif;">three</span></p>', fonts });
		await selectChars(page, 0, 13);
		await page.getByRole('button', { name: 'Clear formatting' }).click();
		expect(await html(page)).toBe('<p>one two three</p>');
	});

	test('a document and a paste keep only the fonts that are offered', async ({ page }) => {
		await open(page, { content: '<p style="font-family: Papyrus;">one <font face="GEORGIA">two</font> <font face="Comic Sans MS">three</font></p>', fonts });
		expect(await html(page)).toBe('<p>one <font face="Georgia, serif">two</font> <font>three</font></p>');
		// (Firefox and WebKit do not let a page put markup on the clipboard in a test.)
		await page.evaluate(async () => {
			const markup = '<span style="font-family: Papyrus; font-weight: bold;">papyrus</span><span style="font-family: arial;"> arial</span>';
			await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([markup], { type: 'text/html' }) })]);
		});
		await page.click(`${content} p`);
		await page.keyboard.press(MAC ? 'Meta+ArrowRight' : 'End');
		const before = await html(page);
		await page.keyboard.press('ControlOrMeta+v');
		await expect.poll(() => html(page)).not.toBe(before);
		const pasted = await html(page);
		expect(pasted).not.toMatch(/papyrus,|Papyrus;|Comic/);
		// (Safari's engine pastes the space between the two as one that does not break.)
		expect(pasted).toMatch(/font-family: Arial, sans-serif;[^>]*>(?: |&nbsp;)arial/);
		expect(((await page.locator(`${content}`).textContent()) ?? '').replace(/\s/g, ' ')).toContain('papyrus arial');
	});
});

test.describe('the layout of a report: spacing, tables with borders, pictures side by side', () => {
	type Layout = Editor & { insertTable(rows: number, columns: number, options?: { borders?: boolean; header?: boolean }): void };
	const rtf = (page: Page) => page.evaluate(() => window.ed.getRTF());
	const spacing = 'select.tb-spacing';
	const tool = (page: Page, title: string) => page.locator(`.ink-img-tools button[title="${title}"]`);
	/** The document as its blocks: a paragraph's text, a picture's caption, [a|b] for a row of pictures. */
	const blocks = (page: Page) =>
		page.evaluate(() =>
			Array.from(document.querySelector('.ink-content')!.children, (child) => {
				if (child.tagName === 'FIGURE') return child.querySelector('figcaption')?.textContent || 'figure';
				if (child.tagName === 'TABLE') return `[${Array.from(child.querySelectorAll('td, th'), (cell) => cell.querySelector('figcaption')?.textContent || cell.textContent).join('|')}]`;
				return (child.textContent ?? '').trim() || 'empty';
			})
		);
	/** Two pictures, each wider than half the page, one under the other, between two paragraphs. */
	async function twoPictures(page: Page): Promise<void> {
		// (A page on which the two do not fit side by side as they are.)
		await page.setViewportSize({ width: 900, height: 900 });
		await open(page);
		await page.evaluate(async () => {
			const picture = (color: string) => {
				const canvas = document.createElement('canvas');
				canvas.width = 520;
				canvas.height = 300;
				const g = canvas.getContext('2d')!;
				g.fillStyle = color;
				g.fillRect(0, 0, 520, 300);
				return canvas.toDataURL('image/png');
			};
			const figure = (color: string, caption: string) => `<figure><img src="${picture(color)}" alt="" style="width:520px;height:auto"><figcaption>${caption}</figcaption></figure>`;
			window.ed.setHTML(`<p>Gross description</p>${figure('#b04a5a', 'Figure 1. H&amp;E')}${figure('#4a6ab0', 'Figure 2. Ki-67')}<p>Diagnosis</p>`);
			await Promise.all(Array.from(document.querySelectorAll('.ink-content img'), (img) => (img as HTMLImageElement).decode()));
		});
	}
	const boxes = (page: Page) =>
		page.evaluate(() =>
			Array.from(document.querySelectorAll('.ink-content img'), (img) => {
				const r = img.getBoundingClientRect();
				const c = (img.closest('figure')?.querySelector('figcaption') ?? img).getBoundingClientRect();
				const cell = (img.closest('td') ?? document.querySelector('.ink-content')!).getBoundingClientRect();
				return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, captionTop: c.top, captionLeft: c.left, cellLeft: cell.left, cellRight: cell.right };
			})
		);

	test('the Spacing list sets the line spacing and the space after a paragraph, on the page and in the RTF', async ({ page }) => {
		await open(page, { content: '<p>Specimen A: skin, left forearm, shave biopsy.</p><p>Specimen B: skin, right forearm.</p>' });
		const tops = () => page.evaluate(() => Array.from(document.querySelectorAll('.ink-content p'), (p) => p.getBoundingClientRect().top));
		const before = await tops();
		await page.click(`${content} p >> nth=0`);
		await page.selectOption(spacing, 'spaceAfter:12');
		expect(await html(page)).toBe('<p style="margin-bottom: 12pt;">Specimen A: skin, left forearm, shave biopsy.</p><p>Specimen B: skin, right forearm.</p>');
		const spaced = await tops();
		// 12 pt is 16 px, in place of the little space a paragraph has by itself.
		expect(spaced[1] - before[1]).toBeGreaterThan(8);
		expect(spaced[1] - before[1]).toBeLessThan(17);
		await page.selectOption(spacing, 'lineSpacing:2');
		expect(await page.evaluate(() => (document.querySelector('.ink-content p') as HTMLElement).style.lineHeight)).toBe('2');
		expect(body(await rtf(page))).toMatch(/^\\pard\\sa240\\sl480\\slmult1 Specimen A/);
		// The list shows what the paragraph has, and is back at its name.
		expect(await page.locator(`${spacing} option:checked`).textContent()).toBe('Spacing');
		expect(await page.locator(`${spacing} option[value="lineSpacing:2"]`).textContent()).toContain('✓');
		// The typing goes on in the paragraph, and each step is undone by itself.
		await page.keyboard.press('ControlOrMeta+z');
		expect(await html(page)).toBe('<p style="margin-bottom: 12pt;">Specimen A: skin, left forearm, shave biopsy.</p><p>Specimen B: skin, right forearm.</p>');
		// And what is saved is read back the same.
		const again = await page.evaluate(() => window.lib.rtfToHtml(window.ed.getRTF()));
		expect(again).toBe('<p style="margin-bottom:12pt">Specimen A: skin, left forearm, shave biopsy.</p>\n<p>Specimen B: skin, right forearm.</p>');
	});

	test('the Spacing list sets the gap after the markers of a list: the marker stays, the text moves, and the RTF has it', async ({ page }) => {
		await open(page, { content: '<p>Diagnosis:</p><ol start="3"><li>Skin, left forearm.</li><li value="7">Margins free of tumor.</li><li>No invasion.</li></ol>' });
		/** Where each item's marker and its text start, in px from the paragraph above. */
		const places = () =>
			page.evaluate(() => {
				const edge = document.querySelector('.ink-content p')!.getBoundingClientRect().left;
				return Array.from(document.querySelectorAll('.ink-content li'), (li) => {
					const range = document.createRange();
					range.selectNodeContents(li);
					const text = range.getClientRects()[0].left - edge;
					const marker = li.hasAttribute('data-ink-marker') ? li.getBoundingClientRect().left - edge - parseFloat(getComputedStyle(li.parentElement!).paddingLeft) : null;
					return { marker, text: Math.round(text), shown: getComputedStyle(li, '::before').content };
				});
			});
		await page.click('.ink-content li >> nth=0');
		await page.selectOption(spacing, 'markerGap:36');
		const wide = await places();
		// Each marker at the list's edge, and its text 36 pt (48 px) further in; the numbers as
		// the list has them, an item's own value too (which Chromium's own count does not see).
		for (const place of wide) {
			expect(place.marker).toBe(0);
			expect(place.text).toBe(48);
		}
		expect(wide.map((place) => place.shown)).toEqual(['"3."', '"7."', '"8."']);
		await page.selectOption(spacing, 'markerGap:9');
		expect((await places()).map((place) => place.text)).toEqual([12, 12, 12]);
		expect(await page.locator(`${spacing} option[value="markerGap:9"]`).textContent()).toContain('✓');
		// What is given is the document: the gap, and no markers of the editor's.
		expect(await page.evaluate(() => window.ed.getHTML())).toBe('<p>Diagnosis:</p><ol start="3" style="padding-left: 9pt;"><li>Skin, left forearm.</li><li value="7">Margins free of tumor.</li><li>No invasion.</li></ol>');
		expect(await rtf(page)).toContain('\\pard\\li540\\fi-180 3.\\tab Skin, left forearm.\\par \\pard\\li540\\fi-180 7.\\tab Margins free of tumor.\\par ');
		// An item typed in is numbered with the rest.
		await page.click('.ink-content li >> nth=2');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Added.');
		await expect.poll(async () => (await places()).map((place) => place.shown)).toEqual(['"3."', '"7."', '"8."', '"9."']);
		// Default puts the list back as it was, the browser's own markers and all.
		await page.click('.ink-content li >> nth=0');
		await page.selectOption(spacing, 'markerGap:none');
		expect(await page.evaluate(() => document.querySelector('.ink-content ol')!.outerHTML)).toBe('<ol start="3"><li>Skin, left forearm.</li><li value="7">Margins free of tumor.</li><li>No invasion.</li><li>Added.</li></ol>');
	});

	test('the Spacing list spaces a list item and a line in a table cell, on the page and in the RTF', async ({ page }) => {
		await open(page, {
			content: '<ul><li>Margins free of tumor.</li><li>No lymphovascular invasion.</li></ul><table><tbody><tr><td>Specimen A</td><td>Skin</td></tr><tr><td>Specimen B</td><td>Skin</td></tr></tbody></table>'
		});
		const top = (selector: string) => page.evaluate((s) => document.querySelector(s)!.getBoundingClientRect().top, selector);
		const second = await top('.ink-content li:nth-child(2)');
		await page.click('.ink-content li >> nth=0');
		await page.selectOption(spacing, 'spaceAfter:12');
		// The next item is further down: by 12 pt (16 px), in place of the 4 px an item has by itself.
		expect((await top('.ink-content li:nth-child(2)')) - second).toBeGreaterThan(10);
		await page.selectOption(spacing, 'lineSpacing:1.5');
		expect(await page.evaluate(() => document.querySelector('.ink-content ul')!.outerHTML)).toBe(
			'<ul><li style="margin-bottom: 12pt; line-height: 1.5;">Margins free of tumor.</li><li>No lymphovascular invasion.</li></ul>'
		);
		expect(await page.locator(`${spacing} option[value="spaceAfter:12"]`).textContent()).toContain('✓');
		const rowTwo = await top('.ink-content tr:nth-child(2)');
		await page.click('.ink-content td >> nth=0');
		await page.selectOption(spacing, 'spaceAfter:12');
		expect(await page.evaluate(() => document.querySelector('.ink-content td')!.innerHTML)).toBe('<p style="margin-bottom: 12pt;">Specimen A</p>');
		expect((await top('.ink-content tr:nth-child(2)')) - rowTwo).toBeGreaterThan(10);
		const out = await rtf(page);
		expect(out).toContain('\\pard\\li720\\sl360\\slmult1\\sa240\\fi-360\\bullet\\tab Margins free of tumor.\\par ');
		expect(out).toContain('\\pard\\intbl\\sa240 Specimen A');
		// Read back the same, and each step is undone by itself.
		const again = await page.evaluate(() => window.lib.rtfToHtml(window.ed.getRTF()));
		expect(again).toContain('<li style="margin-bottom:12pt;line-height:1.5">Margins free of tumor.</li>');
		expect(again).toContain('<p style="margin-bottom:12pt">Specimen A</p>');
		await page.keyboard.press('ControlOrMeta+z');
		expect(await page.evaluate(() => document.querySelector('.ink-content td')!.innerHTML)).toBe('Specimen A');
	});

	test('Insert table puts in a table with borders, to type in; the RTF has the borders and the viewer shows them', async ({ page }) => {
		await open(page, { content: '<p>Results</p>' });
		await page.click(`${content} p`);
		await page.getByRole('button', { name: 'Insert table' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByLabel('Rows')).toBeFocused();
		await dialog.getByLabel('Rows').fill('2');
		await dialog.getByLabel('Columns').fill('2');
		await dialog.getByLabel('First row is a header').check();
		await dialog.getByRole('button', { name: 'Insert' }).click();
		await expect(dialog).toBeHidden();
		// The caret is in the first cell.
		await page.keyboard.type('Marker');
		expect(await page.locator(`${content} th >> nth=0`).textContent()).toBe('Marker');
		await page.click(`${content} td >> nth=1`);
		await page.keyboard.type('Negative');
		expect(await page.locator(`${content} table`).evaluate((table) => Array.from(table.querySelectorAll('th, td'), (cell) => `${cell.tagName}:${cell.textContent}`))).toEqual(['TH:Marker', 'TH:', 'TD:', 'TD:Negative']);
		const border = (selector: string) =>
			page.locator(selector).evaluate((cell) => {
				const s = getComputedStyle(cell);
				return [s.borderTopStyle, s.borderLeftStyle, s.borderBottomStyle, s.borderRightStyle, s.borderTopWidth].join(' ');
			});
		expect(await border(`${content} td >> nth=1`)).toBe('solid solid solid solid 1px');
		const written = await rtf(page);
		expect(written.match(/\\clbrdrt\\brdrs\\brdrw15\\clbrdrl\\brdrs\\brdrw15\\clbrdrb\\brdrs\\brdrw15\\clbrdrr\\brdrs\\brdrw15\\cellx/g)).toHaveLength(4);
		await page.evaluate((value) => window.setViewer(value), written);
		await expect(page.locator('#viewer th')).toHaveCount(2);
		expect(await border('#viewer td >> nth=1')).toBe('solid solid solid solid 1px');
		expect(await page.locator('#viewer td >> nth=1').textContent()).toBe('Negative');
	});

	test('a table with no borders has none in the RTF, and is drawn with a faint line only while it is edited', async ({ page }) => {
		await open(page, { content: '<p>Results</p>' });
		await page.click(`${content} p`);
		await page.getByRole('button', { name: 'Insert table' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Borders').uncheck();
		await dialog.getByLabel('Rows').press('Enter');
		await expect(page.locator(`${content} td`)).toHaveCount(9);
		const outline = (selector: string) => page.locator(selector).evaluate((cell) => getComputedStyle(cell).outlineStyle);
		expect(await outline(`${content} td >> nth=0`)).toBe('dashed');
		const written = await rtf(page);
		expect(written).not.toContain('\\clbrdr');
		expect(await html(page)).not.toContain('outline');
		await page.evaluate((value) => window.setViewer(value), written);
		await expect(page.locator('#viewer td')).toHaveCount(9);
		expect(await outline('#viewer td >> nth=0')).toBe('none');
	});

	test('a picture is moved down and up with its caption', async ({ page }) => {
		await twoPictures(page);
		await page.click(`${content} img >> nth=0`);
		await tool(page, 'Move down').click();
		expect(await blocks(page)).toEqual(['Gross description', 'Figure 2. Ki-67', 'Figure 1. H&E', 'Diagnosis']);
		// The frame is still around the picture that was moved.
		const frame = await page.locator('.ink-img-frame').boundingBox();
		const moved = await page.locator(`${content} img >> nth=1`).boundingBox();
		expect(Math.abs(frame!.y - moved!.y)).toBeLessThan(3);
		await tool(page, 'Move up').click();
		await tool(page, 'Move up').click();
		expect(await blocks(page)).toEqual(['Figure 1. H&E', 'Gross description', 'Figure 2. Ki-67', 'Diagnosis']);
		await expect(tool(page, 'Move up')).toBeDisabled();
	});

	test('two pictures are put side by side, each with its own caption under it, and are still so when the RTF is read', async ({ page }) => {
		await twoPictures(page);
		await page.click(`${content} img >> nth=1`);
		await tool(page, 'Place beside the picture above').click();
		expect(await blocks(page)).toEqual(['Gross description', '[Figure 1. H&E|Figure 2. Ki-67]', 'Diagnosis']);
		const sideBySide = async () => {
			const [a, b] = await boxes(page);
			// On one line, the second to the right of the first, each inside its own half.
			expect(Math.abs(a.top - b.top)).toBeLessThan(3);
			expect(b.left).toBeGreaterThanOrEqual(a.right);
			for (const box of [a, b]) {
				expect(box.left).toBeGreaterThanOrEqual(box.cellLeft);
				expect(box.right).toBeLessThanOrEqual(box.cellRight + 0.5);
				// Its caption is under it, in its own cell.
				expect(box.captionTop).toBeGreaterThanOrEqual(box.bottom);
				expect(box.captionLeft).toBeGreaterThanOrEqual(box.cellLeft);
				expect(box.captionLeft).toBeLessThan(box.cellRight);
			}
			return [a, b];
		};
		const [a] = await sideBySide();
		// Each was wider than half the page, and was made to fit.
		expect(a.width).toBeLessThan(520);
		// The tools of the picture at the left edge are all on the page.
		await page.click(`${content} img >> nth=0`);
		const tools = await page.locator('.ink-img-tools').boundingBox();
		const wrap = await page.locator('.ink-content-wrap').boundingBox();
		expect(tools!.x).toBeGreaterThanOrEqual(wrap!.x);
		expect(tools!.x + tools!.width).toBeLessThanOrEqual(wrap!.x + wrap!.width + 0.5);
		// A caption is typed where it is.
		await page.click(`${content} figcaption >> nth=1`);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
		await page.keyboard.type(', 20x');
		expect(await page.locator(`${content} figcaption >> nth=1`).textContent()).toBe('Figure 2. Ki-67, 20x');
		// Saved and opened again.
		const written = await rtf(page);
		expect(written.match(/\{\\\*\\inkcap\}/g)).toHaveLength(2);
		await page.evaluate(async (value) => {
			window.ed.setHTML(window.lib.rtfToHtml(value));
			await Promise.all(Array.from(document.querySelectorAll('.ink-content img'), (img) => (img as HTMLImageElement).decode()));
		}, written);
		expect(await blocks(page)).toEqual(['Gross description', '[Figure 1. H&E|Figure 2. Ki-67, 20x]', 'Diagnosis']);
		await sideBySide();
		expect(await rtf(page)).toBe(written);
		// And the viewer shows them the same way.
		await page.evaluate((value) => window.setViewer(value), written);
		await expect(page.locator('#viewer td figure')).toHaveCount(2);
	});

	test('a picture that is beside another goes back on a line of its own', async ({ page }) => {
		await twoPictures(page);
		await page.click(`${content} img >> nth=1`);
		await tool(page, 'Place beside the picture above').click();
		await page.click(`${content} img >> nth=0`);
		await tool(page, 'Place on its own line').click();
		expect(await blocks(page)).toEqual(['Gross description', 'Figure 2. Ki-67', 'Figure 1. H&E', 'Diagnosis']);
		await expect(page.locator(`${content} table`)).toHaveCount(0);
		const [first, second] = await boxes(page);
		expect(second.top).toBeGreaterThan(first.bottom);
	});

	test('the space between two pictures, one under the other, is set from the Spacing list', async ({ page }) => {
		await twoPictures(page);
		const gap = async () => {
			const [a, b] = await boxes(page);
			return b.top - a.bottom;
		};
		const before = await gap();
		await page.click(`${content} img >> nth=1`);
		await page.selectOption(spacing, 'spaceBefore:12');
		expect(await page.locator(`${content} figure >> nth=1`).getAttribute('style')).toBe('margin-top: 12pt;');
		// 12 pt is 16 px, in place of the little space a picture has by itself.
		expect((await gap()) - before).toBeGreaterThan(10);
		expect((await gap()) - before).toBeLessThan(17);
		// And none again.
		await page.selectOption(spacing, 'spaceBefore:0');
		expect(await gap()).toBe(before);
		await page.selectOption(spacing, 'spaceBefore:12');
		expect(await rtf(page)).toMatch(/\\pard\\ql\\sb240 \{\\pict/);
	});

	/** Two pictures side by side, with this many points set between them. */
	async function gapped(page: Page, points: string): Promise<void> {
		await twoPictures(page);
		await page.click(`${content} img >> nth=1`);
		await tool(page, 'Place beside the picture above').click();
		await page.fill('.ink-img-gap input', points);
		await page.press('.ink-img-gap input', 'Enter');
	}
	const between = async (page: Page) => {
		const [a, b] = await boxes(page);
		return b.left - a.right;
	};

	test('the gap set between two pictures side by side is the distance between them, on the page and in the RTF', async ({ page }) => {
		await gapped(page, '36');
		// 36 pt is 48 px.
		await expect.poll(() => between(page)).toBeCloseTo(48, 0);
		// Too wide for the page together, they were made smaller alike, and fit on it.
		const [a, b] = await boxes(page);
		expect(a.width).toBeCloseTo(b.width, 0);
		const page_ = await page.evaluate(() => document.querySelector('.ink-content')!.getBoundingClientRect().right);
		expect(b.right).toBeLessThanOrEqual(page_);
		// The gap is no cell drawn with a line while the document is edited.
		expect(await page.evaluate(() => getComputedStyle(document.querySelector('.ink-content td:empty')!).outlineStyle)).toBe('none');
		// In the RTF the gap is an empty cell of 720 twips, and no space inside a cell.
		const written = await rtf(page);
		const edges = written.match(/\\cellx(\d+)/g)!.map((edge) => Number(edge.slice(6)));
		expect(edges).toHaveLength(3);
		expect(edges[1] - edges[0]).toBe(720);
		expect(written).toContain('\\trgaph0');
		// Read back, the pictures are as far apart as they were, and the RTF is written the same.
		await page.evaluate(async (value) => {
			window.ed.setHTML(window.lib.rtfToHtml(value));
			await Promise.all(Array.from(document.querySelectorAll('.ink-content img'), (img) => (img as HTMLImageElement).decode()));
		}, written);
		await expect.poll(() => between(page)).toBeCloseTo(48, 0);
		expect(await rtf(page)).toBe(written);
		// And the viewer shows them as far apart.
		await page.evaluate((value) => window.setViewer(value), written);
		const viewerGap = await page.evaluate(() => {
			const [a, b] = Array.from(document.querySelectorAll('#viewer img'), (img) => img.getBoundingClientRect());
			return b.left - a.right;
		});
		expect(viewerGap).toBeCloseTo(48, 0);
	});

	test('a picture beside another, resized by its handle, keeps the gap between them', async ({ page }) => {
		await gapped(page, '18');
		await expect.poll(() => between(page)).toBeCloseTo(24, 0);
		await page.click(`${content} img >> nth=0`);
		const handle = page.locator('.ink-img-handle.se');
		const at = (await handle.boundingBox())!;
		await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
		await page.mouse.down();
		await page.mouse.move(at.x - 100, at.y + 10, { steps: 6 });
		// (While it is being resized, too.)
		expect(await between(page)).toBeCloseTo(24, 0);
		await page.mouse.up();
		const [a] = await boxes(page);
		expect(await between(page)).toBeCloseTo(24, 0);
		expect(a.width).toBeLessThan(330);
	});

	/** Drag the picture `from` (its index) by the mouse to a point given as a share of another element's box. */
	async function dragPicture(page: Page, from: number, to: string, at: { x: number; y: number }): Promise<void> {
		const source = (await page.locator(`${content} img >> nth=${from}`).boundingBox())!;
		const target = (await page.locator(to).boundingBox())!;
		await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
		await page.mouse.down();
		await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2 + 8, { steps: 3 });
		await page.mouse.move(target.x + target.width * at.x, target.y + target.height * at.y, { steps: 12 });
		await page.mouse.up();
	}
	/**
	 * Playwright's WebKit on Linux (the GTK build, which CI runs) hangs on the first mouse move
	 * of any picture dragged by the mouse: on a bare page with no editor too, editable or not.
	 * Safari's engine on a Mac drags it, and these run there.
	 */
	const NO_PICTURE_DRAG = 'WebKit on Linux hangs on a picture dragged by the mouse, on any page';
	const noPictureDrag = (browserName: string) => browserName === 'webkit' && process.platform === 'linux';
	const RIGHT = { x: 0.8, y: 0.5 };
	const LEFT = { x: 0.2, y: 0.5 };

	test('a picture dragged onto another is put beside it, each with its own caption under it', async ({ page, browserName }) => {
		test.skip(noPictureDrag(browserName), NO_PICTURE_DRAG);
		// (The browser put the dragged picture in the other's figure, and its caption was left
		// behind as an empty line: both captions under the two pictures, at the left.)
		await twoPictures(page);
		await dragPicture(page, 1, `${content} img >> nth=0`, RIGHT);
		await expect.poll(() => blocks(page)).toEqual(['Gross description', '[Figure 1. H&E|Figure 2. Ki-67]', 'Diagnosis']);
		const [a, b] = await boxes(page);
		expect(b.left).toBeGreaterThan(a.right);
		expect(a.captionTop).toBeGreaterThan(a.bottom);
		expect(b.captionLeft).toBeCloseTo(b.left, 0);
		// It is a row as Place beside makes one: a gap can be set.
		await expect(page.locator('.ink-img-gap input')).toBeVisible();
		// And one step to undo.
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => blocks(page)).toEqual(['Gross description', 'Figure 1. H&E', 'Figure 2. Ki-67', 'Diagnosis']);
	});

	test('dropped on the left half of a picture, it is put before it', async ({ page, browserName }) => {
		test.skip(noPictureDrag(browserName), NO_PICTURE_DRAG);
		await twoPictures(page);
		await dragPicture(page, 1, `${content} img >> nth=0`, LEFT);
		await expect.poll(() => blocks(page)).toEqual(['Gross description', '[Figure 2. Ki-67|Figure 1. H&E]', 'Diagnosis']);
	});

	test('in a row, a picture dragged onto the other changes places with it; dragged onto a paragraph, it leaves the row', async ({ page, browserName }) => {
		test.skip(noPictureDrag(browserName), NO_PICTURE_DRAG);
		await twoPictures(page);
		await dragPicture(page, 1, `${content} img >> nth=0`, RIGHT);
		await expect.poll(() => blocks(page)).toEqual(['Gross description', '[Figure 1. H&E|Figure 2. Ki-67]', 'Diagnosis']);
		await dragPicture(page, 1, `${content} img >> nth=0`, LEFT);
		await expect.poll(() => blocks(page)).toEqual(['Gross description', '[Figure 2. Ki-67|Figure 1. H&E]', 'Diagnosis']);
		await dragPicture(page, 0, `${content} p >> nth=1`, { x: 0.3, y: 0.9 });
		await expect.poll(() => blocks(page)).toEqual(['Gross description', 'Figure 1. H&E', 'Diagnosis', 'Figure 2. Ki-67', 'empty']);
	});

	test('the gap is taken off by leaving it empty: the pictures share the page again', async ({ page }) => {
		await gapped(page, '18');
		await page.click(`${content} img >> nth=0`);
		await page.fill('.ink-img-gap input', '');
		await page.press('.ink-img-gap input', 'Enter');
		await expect(page.locator(`${content} table`)).toHaveAttribute('style', /width:\s*100%/);
		await expect(page.locator(`${content} td`)).toHaveCount(2);
	});

	test('a table that comes with borders, as Word, Excel and Google Docs paste one, has them in the RTF', async ({ page }) => {
		await open(page);
		await page.evaluate(() =>
			window.ed.setHTML(
				'<table style="border-collapse:collapse"><tbody>' +
					'<tr><td style="border:solid windowtext 1.0pt;padding:0in 5.4pt">Marker</td><td style="border:solid windowtext 1.0pt;border-left:none">Result</td></tr>' +
					'<tr><td style="border: 0.5pt solid windowtext;">ER</td><td style="border-width: 1pt; border-style: solid; border-color: rgb(192, 0, 0);">Positive</td></tr>' +
					'</tbody></table>'
			)
		);
		const cells = (await rtf(page)).match(/(?:\\clbrdr[tlbr]\\brdr[a-z]+\\brdrw\d+(?:\\brdrcf\d+)?)*\\cellx/g)!.map((cell) => cell.replace(/\\cellx$/, ''));
		const all = (width: number, color = '') => ['t', 'l', 'b', 'r'].map((side) => `\\clbrdr${side}\\brdrs\\brdrw${width}${color}`).join('');
		expect(cells).toEqual([all(20), all(20).replace('\\clbrdrl\\brdrs\\brdrw20', ''), all(10), all(20, '\\brdrcf2')]);
		// And they are there when the RTF is read.
		await page.evaluate(() => window.setViewer(window.ed.getRTF()));
		await expect(page.locator('#viewer td')).toHaveCount(4);
		expect(await page.locator('#viewer td >> nth=3').evaluate((cell) => [getComputedStyle(cell).borderTopStyle, getComputedStyle(cell).borderTopColor])).toEqual(['solid', 'rgb(192, 0, 0)']);
		expect(await page.locator('#viewer td >> nth=1').evaluate((cell) => [getComputedStyle(cell).borderLeftStyle, getComputedStyle(cell).borderRightStyle])).toEqual(['none', 'solid']);
	});

	test('insertTable is there for a page that has its own button', async ({ page }) => {
		await open(page, { content: '<p>Results</p>' });
		await page.click(`${content} p`);
		await page.evaluate(() => (window.ed as Layout).insertTable(1, 3, { borders: false }));
		await expect(page.locator(`${content} td`)).toHaveCount(3);
		await page.keyboard.type('a');
		expect(await page.locator(`${content} td >> nth=0`).textContent()).toBe('a');
	});
});

test.describe('lists: in a page with styles of its own, and as the HTML the editor hands out', () => {
	const rtf = (page: Page) => page.evaluate(() => window.ed.getRTF());
	const END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
	const bullet = (page: Page) => page.getByRole('button', { name: 'Bullet list' }).click();
	const numbered = (page: Page) => page.getByRole('button', { name: 'Numbered list' }).click();
	/** What Tailwind's base styles and most CSS resets say about lists. */
	const RESET = 'ol, ul, menu { list-style: none; margin: 0; padding: 0; }';
	const markers = (page: Page, within: string) =>
		page.evaluate((within) => Array.from(document.querySelectorAll(`${within} ul, ${within} ol`), (list) => `${list.tagName.toLowerCase()}:${getComputedStyle(list).listStyleType}`), within);
	async function endOfFirst(page: Page): Promise<void> {
		await page.click(`${content} p >> nth=0`);
		await page.keyboard.press(END);
	}

	test('bullets and numbers show in a page that takes them off its own lists', async ({ page }) => {
		const nested = '<ul><li>skin<ul><li>left<ul><li>distal</li></ul></li></ul></li></ul><ol><li>first</li><li>second</li></ol><ol type="A"><li>lettered</li></ol><ol style="list-style-type: lower-roman;"><li>roman</li></ol>';
		await open(page, { content: nested });
		await page.addStyleTag({ content: RESET });
		expect(await markers(page, content)).toEqual(['ul:disc', 'ul:circle', 'ul:square', 'ol:decimal', 'ol:none', 'ol:lower-roman']);
		// An item has its marker's room, and the marker is drawn (an item that is a list item).
		expect(await page.locator(`${content} li >> nth=0`).evaluate((li) => getComputedStyle(li).display)).toBe('list-item');
		expect(await page.locator(`${content} ul >> nth=0`).evaluate((ul) => parseFloat(getComputedStyle(ul).paddingLeft))).toBeGreaterThan(20);
		await page.evaluate(() => window.setViewer(window.ed.getRTF()));
		await expect(page.locator('#viewer ol')).toHaveCount(3);
		expect((await markers(page, '#viewer')).slice(0, 4)).toEqual(['ul:disc', 'ul:circle', 'ul:square', 'ol:decimal']);
	});

	test('a list made from the toolbar in such a page has its bullets and its numbers', async ({ page }) => {
		await open(page, { content: '<p>Specimens</p><p>Steps</p>' });
		await page.addStyleTag({ content: RESET });
		await endOfFirst(page);
		await bullet(page);
		await page.getByText('Steps', { exact: true }).click();
		await numbered(page);
		expect(await markers(page, content)).toEqual(['ul:disc', 'ol:decimal']);
	});

	test('the caret stays where it was when a line is made a list item', async ({ page }) => {
		await open(page, { content: '<p>Specimens</p><p>two</p>' });
		await endOfFirst(page);
		await bullet(page);
		await page.keyboard.type(' received');
		expect(await page.locator(`${content} li`).textContent()).toBe('Specimens received');
		// And in the middle of a line.
		await page.getByText('two', { exact: true }).click();
		await page.keyboard.press(END);
		await page.keyboard.press('ArrowLeft');
		await numbered(page);
		await page.keyboard.type('X');
		expect(await page.locator(`${content} ol li`).textContent()).toBe('twXo');
	});

	test('the HTML of a list made from the toolbar is HTML that reads back as the same document', async ({ page }) => {
		await open(page, { content: '<p>Specimens</p><p>x</p>' });
		await page.click(`${content} p >> nth=1`);
		await page.keyboard.press(END);
		await page.keyboard.press('Backspace');
		await bullet(page);
		await page.keyboard.type('skin');
		await page.keyboard.press('Enter');
		await page.keyboard.type('node');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Diagnosis');
		const handedOut = await html(page);
		// No list inside a paragraph, which a parser reads as an empty paragraph on each side of it.
		const parsed = await page.evaluate((value) => {
			const d = document.createElement('div');
			d.innerHTML = value;
			return d.innerHTML;
		}, handedOut);
		expect(parsed).toBe(handedOut);
		expect(handedOut).not.toMatch(/<p[^>]*>\s*<(ul|ol|div)/);
		const written = await rtf(page);
		expect(body(written)).toMatch(/^\\pard Specimens\\par \\pard\\li720\\fi-360\\bullet\\tab skin\\par \\pard\\li720\\fi-360\\bullet\\tab node\\par \\pard Diagnosis\\par \}$/);
		// Kept by an application and shown again: the same document, with no empty lines added.
		await page.evaluate((value) => window.ed.setHTML(value), handedOut);
		expect(await html(page)).toBe(handedOut);
		expect(await rtf(page)).toBe(written);
	});

	test('Undo takes a list back, and Redo makes it again', async ({ page }) => {
		await open(page, { content: '<p>Specimens</p><p>two</p>' });
		await endOfFirst(page);
		await bullet(page);
		await expect(page.locator(`${content} li`)).toHaveCount(1);
		await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
		expect(await html(page)).toBe('<p>Specimens</p><p>two</p>');
		await page.getByRole('button', { name: 'Redo' }).click();
		await expect(page.locator(`${content} li`)).toHaveCount(1);
		expect(await page.locator(`${content} li`).textContent()).toBe('Specimens');
		expect(await html(page)).not.toMatch(/<p[^>]*><ul/);
	});

	const items = (page: Page) => page.locator(`${content} li`).allTextContents();
	const line = (page: Page, text: string) => page.locator(content).getByText(text, { exact: true }).click();

	for (const order of [
		['one', 'two', 'three'],
		['three', 'two', 'one']
	]) {
		test(`lines made items one at a time (${order.join(', ')}) are one list, numbered on from one another`, async ({ page }) => {
			await open(page, { content: '<p>one</p><p>two</p><p>three</p><p>after</p>' });
			for (const text of order) {
				await line(page, text);
				await numbered(page);
			}
			// (Firefox made a list of each, and each began at 1.)
			await expect(page.locator(`${content} ol`)).toHaveCount(1);
			expect(await items(page)).toEqual(['one', 'two', 'three']);
			expect((await rtf(page)).match(/\d\.\\tab/g)).toEqual(['1.\\tab', '2.\\tab', '3.\\tab']);
			// Each was one step, and Undo takes the last one back.
			await page.getByRole('button', { name: 'Undo' }).click();
			expect(await items(page)).toEqual(order.slice(0, 2).sort((a, b) => ['one', 'two', 'three'].indexOf(a) - ['one', 'two', 'three'].indexOf(b)));
			await page.getByRole('button', { name: 'Undo' }).click();
			expect(await items(page)).toEqual([order[0]]);
			await page.getByRole('button', { name: 'Undo' }).click();
			await expect(page.locator(`${content} li`)).toHaveCount(0);
			await expect(page.locator(`${content} p`)).toHaveCount(4);
		});
	}

	test('a line under a list is made its next item, and one between two lists joins them', async ({ page }) => {
		await open(page, { content: '<ol><li>a</li><li>b</li></ol><p>c</p><p>d</p><ol><li>e</li></ol><p>after</p>' });
		await line(page, 'c');
		await page.keyboard.press(END);
		await numbered(page);
		await page.keyboard.type('!');
		expect(await items(page)).toEqual(['a', 'b', 'c!', 'e']);
		await expect(page.locator(`${content} ol`)).toHaveCount(2);
		await line(page, 'd');
		await numbered(page);
		await expect(page.locator(`${content} ol`)).toHaveCount(1);
		expect(await items(page)).toEqual(['a', 'b', 'c!', 'd', 'e']);
		// A list of the other kind beside it is not one to join.
		await line(page, 'after');
		await bullet(page);
		await expect(page.locator(`${content} ol`)).toHaveCount(1);
		await expect(page.locator(`${content} ul li`)).toHaveText(['after']);
	});

	test('the list buttons show which kind of list the caret is in', async ({ page }) => {
		await open(page, { content: '<ul><li>bulleted</li></ul><ol><li>numbered</li><li>second<ul><li>within</li></ul></li></ol><p>neither</p>' });
		const pressed = async () => [
			await page.getByRole('button', { name: 'Bullet list' }).getAttribute('aria-pressed'),
			await page.getByRole('button', { name: 'Numbered list' }).getAttribute('aria-pressed')
		];
		await line(page, 'bulleted');
		expect(await pressed()).toEqual(['true', 'false']);
		await line(page, 'numbered');
		expect(await pressed()).toEqual(['false', 'true']);
		await line(page, 'within');
		expect(await pressed()).toEqual(['true', 'false']);
		await line(page, 'neither');
		expect(await pressed()).toEqual(['false', 'false']);
		await numbered(page);
		expect(await pressed()).toEqual(['false', 'true']);
	});

	test('the caret stays where it was in words that are in no paragraph', async ({ page }) => {
		await open(page);
		await page.evaluate(() => window.ed.setHTML(''));
		await page.click(content);
		await page.keyboard.type('alpha');
		await numbered(page);
		await page.keyboard.type(' more');
		await page.keyboard.press('Enter');
		await page.keyboard.type('beta');
		expect(await items(page)).toEqual(['alpha more', 'beta']);
	});
});

test.describe('lists: made by the editor itself, the same in every browser', () => {
	const rtf = (page: Page) => page.evaluate(() => window.ed.getRTF());
	const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
	const HOME = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home';
	const END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
	const button = (page: Page, name: string) => page.getByRole('button', { name });
	const bullet = (page: Page) => button(page, 'Bullet list').click();
	const numbered = (page: Page) => button(page, 'Numbered list').click();
	const line = (page: Page, text: string) => page.locator(content).getByText(text, { exact: true }).click();
	const THREE = '<li>one</li><li>two</li><li>three</li>';

	test('a list is taken off as paragraphs, one for each item; one item taken off parts the list around it', async ({ page }) => {
		await open(page, { content: `<ol>${THREE}</ol>` });
		await line(page, 'two');
		await page.keyboard.press(`${MOD}+a`);
		await numbered(page);
		// (They were one paragraph, with a line break between them.)
		expect(await html(page)).toBe('<p>one</p><p>two</p><p>three</p>');
		await bullet(page);
		expect(await html(page)).toBe(`<ul>${THREE}</ul>`);
		await line(page, 'two');
		await bullet(page);
		expect(await html(page)).toBe('<ul><li>one</li></ul><p>two</p><ul><li>three</li></ul>');
		await expect(button(page, 'Bullet list')).toHaveAttribute('aria-pressed', 'false');
	});

	test('a paragraph made an item and a paragraph again keeps its id and the look of its words, and the RTF its color', async ({ page }) => {
		// (An application's id on a paragraph went with the paragraph: and with it the place
		// the application kept in the document.)
		const marked = '<p id="finding-2" style="color: rgb(192, 0, 0);">two</p>';
		await open(page, { content: `<p>one</p>${marked}<p>three</p>` });
		await line(page, 'two');
		await bullet(page);
		expect(await html(page)).toBe('<p>one</p><ul><li id="finding-2" style="color: rgb(192, 0, 0);">two</li></ul><p>three</p>');
		expect(await rtf(page)).toContain('\\cf2 \\pard\\li720\\fi-360\\bullet\\tab two\\par');
		await bullet(page);
		expect(await html(page)).toBe(`<p>one</p>${marked}<p>three</p>`);
	});

	test('the other list button, with the caret in a list, makes the whole list the other kind', async ({ page }) => {
		// (It made the one item a list of its own, between two lists of what was left.)
		await open(page, { content: `<ul>${THREE}</ul>` });
		await line(page, 'two');
		await numbered(page);
		expect(await html(page)).toBe(`<ol>${THREE}</ol>`);
		expect((await rtf(page)).match(/\d\.\\tab/g)).toEqual(['1.\\tab', '2.\\tab', '3.\\tab']);
		await expect(button(page, 'Numbered list')).toHaveAttribute('aria-pressed', 'true');
		await expect(button(page, 'Bullet list')).toHaveAttribute('aria-pressed', 'false');
		// With items selected, those items are.
		await line(page, 'three');
		await page.keyboard.press(HOME);
		await page.keyboard.press(`Shift+${END}`);
		await bullet(page);
		expect(await html(page)).toBe('<ol><li>one</li><li>two</li></ol><ul><li>three</li></ul>');
	});

	test('Tab at the start of an item puts it under the item before it, and Shift+Tab takes it out again', async ({ page }) => {
		await open(page);
		await page.click(content);
		await numbered(page);
		await page.keyboard.type('a');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Tab');
		await page.keyboard.type('b');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.type('c');
		expect(await html(page)).toBe('<ol><li>a<ol><li>b</li></ol></li><li>c</li></ol>');
		// The RTF has the item one step further in, numbered from 1 again; and reads back so.
		const written = await rtf(page);
		expect(written.match(/\\li\d+\\fi-360 \d\./g)).toEqual(['\\li720\\fi-360 1.', '\\li1440\\fi-360 1.', '\\li720\\fi-360 2.']);
		await page.evaluate((value) => window.setViewer(value), written);
		await expect(page.locator('#viewer ol ol li')).toHaveText('b');
		// Anywhere else in an item, Tab types a tab, as it did.
		await page.keyboard.press('Tab');
		expect(await page.locator(`${content} li >> nth=2`).textContent()).toBe('c\t');
		await expect(page.locator(`${content} ol`)).toHaveCount(2);
		// And in the first item of a list, which has none before it to be under.
		await open(page, { content: '<ul><li>only</li></ul>' });
		await line(page, 'only');
		await page.keyboard.press(HOME);
		await page.keyboard.press('Tab');
		expect(await page.locator(`${content} li`).textContent()).toBe('\tonly');
		await expect(page.locator(`${content} ul`)).toHaveCount(1);
	});

	test('Increase indent puts the items selected under the item before them; Decrease indent takes them out', async ({ page }) => {
		await open(page, { content: `<ul>${THREE}</ul>` });
		await line(page, 'two');
		await page.keyboard.press(HOME);
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press(`Shift+${END}`);
		await button(page, 'Increase indent').click();
		expect(await html(page)).toBe('<ul><li>one<ul><li>two</li><li>three</li></ul></li></ul>');
		await line(page, 'three');
		await button(page, 'Decrease indent').click();
		expect(await html(page)).toBe('<ul><li>one<ul><li>two</li></ul></li><li>three</li></ul>');
		// Undo takes it back one step at a time, with the keys as with the button.
		await page.keyboard.press(`${MOD}+z`);
		expect(await html(page)).toBe('<ul><li>one<ul><li>two</li><li>three</li></ul></li></ul>');
		await button(page, 'Undo').click();
		expect(await html(page)).toBe(`<ul>${THREE}</ul>`);
		// The first item has none before it: the list itself is moved, as a paragraph is.
		await line(page, 'one');
		await button(page, 'Increase indent').click();
		await expect(page.locator(`${content} ul`)).toHaveCount(1);
		expect(await page.locator(`${content} ul`).evaluate((list) => (list as HTMLElement).style.marginLeft)).not.toBe('');
	});

	test('Enter in an item with nothing in it leaves the list, one list at a time', async ({ page }) => {
		await open(page);
		await page.click(content);
		await bullet(page);
		await page.keyboard.type('a');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Tab');
		await page.keyboard.type('b');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('c');
		expect(await html(page)).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('after');
		expect(await html(page)).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><p>after</p>');
		await expect(button(page, 'Bullet list')).toHaveAttribute('aria-pressed', 'false');
	});

	test('Backspace at the start of an item makes it a paragraph, where it is', async ({ page }) => {
		// (In Chromium it did nothing in the first item of a list.)
		await open(page, { content: '<ul><li>one</li><li>two</li></ul><p>x</p>' });
		for (const text of ['two', 'one']) {
			await line(page, text);
			await page.keyboard.press(HOME);
			await page.keyboard.press('Backspace');
		}
		expect(await html(page)).toBe('<p>one</p><p>two</p><p>x</p>');
		await page.keyboard.type('Z');
		expect(await html(page)).toBe('<p>Zone</p><p>two</p><p>x</p>');
		// Anywhere else in an item it takes off a letter, as it did.
		await open(page, { content: '<ul><li>one</li></ul>' });
		await line(page, 'one');
		await page.keyboard.press(END);
		await page.keyboard.press('Backspace');
		expect(await html(page)).toBe('<ul><li>on</li></ul>');
	});

	test('a heading made an item is an item of its words, not a heading with a list in it', async ({ page }) => {
		await open(page, { content: '<h2>Final diagnosis</h2><p>Skin</p>' });
		await line(page, 'Final diagnosis');
		await bullet(page);
		expect(await html(page)).toBe('<ul><li>Final diagnosis</li></ul><p>Skin</p>');
	});

	test('the list buttons are lit for the whole document selected, in a list', async ({ page }) => {
		// (Firefox says such a selection by the document's element, not by a word in an item.)
		await open(page, { content: `<ol>${THREE}</ol>` });
		await line(page, 'two');
		await page.keyboard.press(`${MOD}+a`);
		await expect(button(page, 'Numbered list')).toHaveAttribute('aria-pressed', 'true');
	});
});

test.describe("Undo and Redo: the editor's own, of whatever changed the document", () => {
	const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
	const END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
	const button = (page: Page, name: string) => page.getByRole('button', { name });
	const undo = (page: Page) => button(page, 'Undo').click();
	const redo = (page: Page) => button(page, 'Redo').click();
	const tool = (page: Page, title: string) => page.locator(`.ink-img-tools button[title="${title}"]`);
	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
	async function typeAtEnd(page: Page, text: string): Promise<void> {
		await page.click(`${content} p >> nth=0`);
		await page.keyboard.press(END);
		await page.keyboard.type(text);
	}
	const shape = (page: Page) => page.evaluate(() => Array.from(document.querySelector('.ink-content')!.children, (el) => (el.tagName === 'P' ? el.textContent : el.tagName.toLowerCase())));

	test('each thing done is a step, taken back in the order it was done: typing, a button, typing again', async ({ page }) => {
		await open(page, { content: '<p>start</p>' });
		await typeAtEnd(page, '-one');
		await button(page, 'Bullet list').click();
		await page.keyboard.type('-two');
		expect(await html(page)).toBe('<ul><li>start-one-two</li></ul>');
		await undo(page);
		expect(await html(page)).toBe('<ul><li>start-one</li></ul>');
		await undo(page);
		expect(await html(page)).toBe('<p>start-one</p>');
		await undo(page);
		expect(await html(page)).toBe('<p>start</p>');
		// With nothing left to undo, nothing happens.
		await undo(page);
		expect(await html(page)).toBe('<p>start</p>');
		for (let i = 0; i < 3; i++) await redo(page);
		expect(await html(page)).toBe('<ul><li>start-one-two</li></ul>');
		// The keys do what the buttons do.
		await page.keyboard.press(`${MOD}+z`);
		expect(await html(page)).toBe('<ul><li>start-one</li></ul>');
		await page.keyboard.press(`${MOD}+Shift+z`);
		expect(await html(page)).toBe('<ul><li>start-one-two</li></ul>');
		// The caret is back where it was, and after a new change there is nothing to redo.
		await page.keyboard.press(`${MOD}+z`);
		await page.keyboard.type('!');
		expect(await html(page)).toBe('<ul><li>start-one!</li></ul>');
		await redo(page);
		expect(await html(page)).toBe('<ul><li>start-one!</li></ul>');
	});

	test('a table put in is taken back by Undo, and not the typing before it', async ({ page }) => {
		// (The browser's Undo knew nothing of the table: it took the typing back and left the table.)
		await open(page, { content: '<p>Results</p>' });
		await typeAtEnd(page, '-typed');
		await button(page, 'Insert table').click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Rows').fill('2');
		await dialog.getByLabel('Columns').fill('2');
		await dialog.getByRole('button', { name: 'Insert' }).click();
		await expect(page.locator(`${content} table`)).toHaveCount(1);
		await undo(page);
		expect(await html(page)).toBe('<p>Results-typed</p>');
		await redo(page);
		await expect(page.locator(`${content} table`)).toHaveCount(1);
		// The caret is in the first cell again.
		await page.keyboard.type('a');
		expect(await page.locator(`${content} td, ${content} th`).first().textContent()).toBe('a');
		await undo(page);
		await undo(page);
		await undo(page);
		expect(await html(page)).toBe('<p>Results</p>');
	});

	test('a picture put in is taken back by Undo, and is whole again after Redo', async ({ page }) => {
		await open(page, { content: '<p>first</p>' });
		await typeAtEnd(page, '-typed');
		await button(page, 'Insert image').click();
		await page.getByLabel('Image address').fill(PNG);
		await page.getByRole('button', { name: 'Insert', exact: true }).click();
		await expect(page.locator(`${content} figure`)).toHaveCount(1);
		await page.locator(`${content} img`).evaluate((img) => (img as HTMLImageElement).decode());
		await undo(page);
		await expect(page.locator(`${content} figure`)).toHaveCount(0);
		expect(await page.locator(`${content} p >> nth=0`).textContent()).toBe('first-typed');
		await redo(page);
		await expect(page.locator(`${content} figure`)).toHaveCount(1);
		expect(await page.locator(`${content} img`).getAttribute('src')).toBe(PNG);
	});

	test('a picture moved, and one put beside another, go back where they were', async ({ page }) => {
		await open(page);
		await page.evaluate(async () => {
			const picture = (color: string) => {
				const canvas = document.createElement('canvas');
				canvas.width = 200;
				canvas.height = 100;
				const g = canvas.getContext('2d')!;
				g.fillStyle = color;
				g.fillRect(0, 0, 200, 100);
				return canvas.toDataURL('image/png');
			};
			const figure = (color: string, caption: string) => `<figure><img src="${picture(color)}" alt="" style="width:200px;height:auto"><figcaption>${caption}</figcaption></figure>`;
			window.ed.setHTML(`<p>Gross</p>${figure('#b04a5a', 'Figure 1')}<p>Micro</p>${figure('#4a6ab0', 'Figure 2')}`);
			await Promise.all(Array.from(document.querySelectorAll('.ink-content img'), (img) => (img as HTMLImageElement).decode()));
		});
		const before = await html(page);
		const captions = () => page.locator(`${content} figcaption`).allTextContents();
		await page.click(`${content} img >> nth=1`);
		await tool(page, 'Move up').click();
		expect(await shape(page)).toEqual(['Gross', 'figure', 'figure', 'Micro']);
		await tool(page, 'Move up').click();
		expect(await captions()).toEqual(['Figure 2', 'Figure 1']);
		await undo(page);
		expect(await captions()).toEqual(['Figure 1', 'Figure 2']);
		expect(await shape(page)).toEqual(['Gross', 'figure', 'figure', 'Micro']);
		await page.click(`${content} img >> nth=1`);
		await tool(page, 'Place beside the picture above').click();
		await expect(page.locator(`${content} table`)).toHaveCount(1);
		await undo(page);
		await expect(page.locator(`${content} table`)).toHaveCount(0);
		await undo(page);
		expect(await html(page)).toBe(before);
		await redo(page);
		await redo(page);
		await expect(page.locator(`${content} table img`)).toHaveCount(2);
		// The pictures are the ones that were there: whole, and shown.
		expect(await page.locator(`${content} img`).evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).src.startsWith('data:image/png') && (img as HTMLImageElement).src.length > 200))).toBe(true);
	});

	test('an indent and a spacing set between two runs of typing are each a step', async ({ page }) => {
		await open(page, { content: '<p>para</p><p>next</p>' });
		await typeAtEnd(page, '-a');
		await button(page, 'Increase indent').click();
		await page.keyboard.type('-b');
		await page.selectOption('select.tb-spacing', 'spaceAfter:12');
		const first = () => page.locator(`${content} p >> nth=0`).evaluate((p) => `${p.textContent}|${(p as HTMLElement).style.marginLeft ? 'indent' : ''}|${(p as HTMLElement).style.marginBottom}`);
		expect(await first()).toBe('para-a-b|indent|12pt');
		await undo(page);
		expect(await first()).toBe('para-a-b|indent|');
		await undo(page);
		expect(await first()).toBe('para-a|indent|');
		await undo(page);
		expect(await first()).toBe('para-a||');
		await undo(page);
		expect(await html(page)).toBe('<p>para</p><p>next</p>');
		for (let i = 0; i < 4; i++) await redo(page);
		expect(await first()).toBe('para-a-b|indent|12pt');
	});

	test('typing after a pause is a step of its own, and a new paragraph is one', async ({ page }) => {
		await open(page, { content: '<p>a</p>' });
		await typeAtEnd(page, 'bc');
		await page.waitForTimeout(1200);
		await page.keyboard.type('de');
		await page.keyboard.press('Enter');
		await page.keyboard.type('fg');
		expect(await shape(page)).toEqual(['abcde', 'fg']);
		await undo(page);
		expect(await shape(page)).toEqual(['abcde', '']);
		await undo(page);
		expect(await shape(page)).toEqual(['abcde']);
		await undo(page);
		expect(await shape(page)).toEqual(['abc']);
		await undo(page);
		expect(await shape(page)).toEqual(['a']);
	});

	test('Undo does not lead back into the document that was there before a new one was set', async ({ page }) => {
		await open(page, { content: '<p>the first report</p>' });
		await typeAtEnd(page, '-typed');
		await page.evaluate(() => window.ed.setHTML('<p>another report</p>'));
		await undo(page);
		await page.click(content);
		await page.keyboard.press(`${MOD}+z`);
		expect(await html(page)).toBe('<p>another report</p>');
		// And what is typed in the new one is taken back as far as the new one.
		await typeAtEnd(page, '-x');
		await undo(page);
		await undo(page);
		expect(await html(page)).toBe('<p>another report</p>');
	});

	test('undo() and redo() are the application\'s to call, and say whether there was a step', async ({ page }) => {
		type WithHistory = Editor & { undo(): boolean; redo(): boolean };
		await open(page, { content: '<p>start</p>' });
		expect(await page.evaluate(() => (window.ed as WithHistory).undo())).toBe(false);
		await typeAtEnd(page, '-one');
		expect(await page.evaluate(() => (window.ed as WithHistory).undo())).toBe(true);
		expect(await html(page)).toBe('<p>start</p>');
		expect(await page.evaluate(() => (window.ed as WithHistory).redo())).toBe(true);
		expect(await html(page)).toBe('<p>start-one</p>');
		expect(await page.evaluate(() => (window.ed as WithHistory).redo())).toBe(false);
	});

	test('what an input method composes is one step, and Undo waits until it is done', async ({ page, browserName }) => {
		// (Chromium alone lets a test compose as an input method does, through its own protocol.)
		test.skip(browserName !== 'chromium', 'composition is driven through the Chrome DevTools Protocol');
		await open(page, { content: '<p>start</p>' });
		// (Typed first, and ended as a step by a click on the toolbar.)
		await typeAtEnd(page, '-');
		await button(page, 'Bold').click();
		await button(page, 'Bold').click();
		const cdp = await page.context().newCDPSession(page);
		for (const text of ['k', 'か', 'かn', 'かな']) await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
		// (In the middle of it, Undo takes nothing from under the method.)
		await page.keyboard.press(`${MOD}+z`);
		await undo(page);
		expect(await html(page)).toBe('<p>start-かな</p>');
		await cdp.send('Input.insertText', { text: 'かな' });
		expect(await html(page)).toBe('<p>start-かな</p>');
		await page.keyboard.press(`${MOD}+z`);
		expect(await html(page)).toBe('<p>start-</p>');
		await page.keyboard.press(`${MOD}+Shift+z`);
		expect(await html(page)).toBe('<p>start-かな</p>');
	});
});
