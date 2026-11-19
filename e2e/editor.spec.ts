import { test, expect, type Page } from '@playwright/test';

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

	test('a pasted span that only Word hid is not pasted as words', async ({ page }) => {
		await paste(page, '<p>one <span style="mso-hide:all">HID ONE</span> two</p><p style="mso-hide:all">whole para</p><p>three</p>');
		await expect(page.locator(content)).toContainText('three');
		expect(await html(page)).toBe('<p>one two</p><p>three</p>');
		// As Word writes a copy: styles in the head, the copied part marked.
		await paste(
			page,
			'<html><head><style>p.MsoNormal{margin:0in;font-size:11pt}</style></head><body><!--StartFragment--><p class=MsoNormal>Shown <span style=\'mso-hide:all\'>hidden words</span>text</p><!--EndFragment--></body></html>'
		);
		await expect(page.locator(content)).toContainText('text');
		expect(await page.locator(content).textContent()).toBe('Shown text');
	});

	test('after such a paste the caret is where the paste ended', async ({ page }) => {
		await paste(page, '<span style="mso-hide:all">all hidden</span>', 'x');
		await page.waitForTimeout(100);
		expect(await html(page)).toBe('<p>x</p>');
		await page.keyboard.type('y');
		expect(await html(page)).toBe('<p>xy</p>');
		// And inside a line, between what was there.
		await paste(page, 'in<span style="mso-hide:all">HIDDEN</span>side', 'ab');
		await expect(page.locator(content)).toContainText('side');
		await page.keyboard.type('!');
		expect(await html(page)).toBe('<p>abinside!</p>');
		// A paste that ends in a hidden paragraph, or is nothing else, leaves an empty line
		// with the caret in it.
		await paste(page, '<p>one</p><p style="mso-hide:all">whole para</p>');
		await expect(page.locator(content)).toContainText('one');
		await expect.poll(() => html(page)).toBe('<p>one</p><p><br></p>');
		await page.keyboard.type('two');
		expect(await html(page)).toBe('<p>one</p><p>two</p>');
		await paste(page, '<p style="mso-hide:all">all hidden</p>');
		await expect.poll(() => html(page)).toBe('<p><br></p>');
		await page.keyboard.type('typed');
		expect(await html(page)).toBe('<p>typed</p>');
	});

	test('a text box pasted last keeps its words', async ({ page }) => {
		await paste(page, '<p>note <textarea>margins clear</textarea></p>');
		await expect(page.locator(content)).toContainText('note');
		expect(await html(page)).toBe('<p>note margins clear</p>');
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
		for (const redo of REDO_KEYS) {
			await page.keyboard.press('ControlOrMeta+z');
			await expect(page.locator(content)).not.toContainText('came in');
			await page.keyboard.press(redo);
			await expect(page.locator(content)).toContainText('came in');
			expect(await left(page), redo).toEqual({ risky: [], overPosition: 'static', overColor: 'red' });
		}
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

	// (Firefox does not undo a paste the editor has taken an element or words out of: so it was in 1.11.0.)
	const UNDOES_SUCH_A_PASTE = (browserName: string) => browserName !== 'firefox';

	test('Redo does not put the words of a button in the document a second time', async ({ page, browserName }) => {
		test.fixme(!UNDOES_SUCH_A_PASTE(browserName));
		await open(page, { content: '<p>Body text</p>' });
		const pasted = await pasteAtEnd(page, '<p>first</p><p>second</p><button>Send</button><textarea>typed in a box</textarea>');
		expect(pasted).not.toMatch(/<button|<textarea/);
		expect(pasted.match(/Send/g)).toHaveLength(1);
		for (const redo of REDO_KEYS) expect(await undoAndRedo(page, pasted, redo), redo).toBe(pasted);
	});

	test('Undo of a paste takes with it the words left where a button was', async ({ page, browserName }) => {
		// (The browser's Undo knows nothing of those words: "Send" stayed in the report, a word
		// of a paste the writer had taken back.)
		test.fixme(!UNDOES_SUCH_A_PASTE(browserName));
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
		test.fixme(!UNDOES_SUCH_A_PASTE(browserName));
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

	test('Clear formatting takes the font off', async ({ page }) => {
		await open(page, { content: '<p>one <font face="Georgia, serif">two</font> <span style="font-family: Arial, sans-serif;">three</span></p>', fonts });
		await selectChars(page, 0, 13);
		await page.getByRole('button', { name: 'Clear formatting' }).click();
		expect(await html(page)).toBe('<p>one two three</p>');
	});

	test('a document and a paste keep only the fonts that are offered', async ({ page, browserName }) => {
		await open(page, { content: '<p style="font-family: Papyrus;">one <font face="GEORGIA">two</font> <font face="Comic Sans MS">three</font></p>', fonts });
		expect(await html(page)).toBe('<p>one <font face="Georgia, serif">two</font> <font>three</font></p>');
		// (Firefox and WebKit do not let a page put markup on the clipboard in a test.)
		test.skip(browserName !== 'chromium', 'the paste is made through the clipboard, which only Chromium gives a test');
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
		expect(pasted).toMatch(/font-family: Arial, sans-serif;[^>]*> arial/);
		expect(await page.locator(`${content}`).textContent()).toContain('papyrus arial');
	});
});
