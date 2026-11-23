# svelte-rtf-editor

RTF viewer and rich-text editor components for **Svelte 5**.

[![npm](https://img.shields.io/npm/v/svelte-rtf-editor)](https://www.npmjs.com/package/svelte-rtf-editor)
[![license](https://img.shields.io/npm/l/svelte-rtf-editor)](./LICENSE)

---

## Features

- **`RtfViewer`** — Renders an RTF string as formatted HTML with a one-click "Copy RTF" button
- **`InkEditor`** — Full rich-text editor that reads and writes RTF, built on `contenteditable`
  - Formatting toolbar: bold, italic, underline, strikethrough, font colour
  - Block-level controls: headings (H1–H3), paragraph, blockquote, code block
  - Bullet and numbered lists, and lists within lists, made the same in every browser. See [Lists](#lists)
  - Undo and Redo of everything the editor changes, a picture or a table put in as much as typing. See [Undo and Redo](#undo-and-redo)
  - Line spacing, and the space before and after a paragraph, in points; and the gap between a list's bullets or numbers and its text. See [Line and paragraph spacing](#line-and-paragraph-spacing)
  - Tables: insert one with or without borders; the borders are in the RTF. See [Tables](#tables)
  - Images: upload, paste or drag-and-drop, with a description below each picture, drag-to-resize, left/centre/right placement, move up and down, and two or more side by side, each with its own description — embedded in the RTF, not linked
  - Import an RTF file from disk; export as RTF, HTML, or Markdown
  - Optional auto-save to `localStorage` (off unless asked for)
  - HTML from outside (the `content` prop, `setHTML`, a restored draft, a paste, a drop) is made safe before it is shown. See [HTML from outside](#html-from-outside)
  - Word count and character count status bar
  - Keyboard shortcuts (`Ctrl+S` to save, `Ctrl+B/I/U` for formatting)
- **Utility functions** — `rtfToHtml`, `htmlToRtf`, `readRtfFile`, `htmlToMarkdown`, `downloadFile`
- Zero runtime dependencies — just Svelte 5 as a peer dependency

---

## Installation

```bash
npm install svelte-rtf-editor
```

---

## Usage

### Read-only RTF viewer

```svelte
<script>
  import { RtfViewer } from 'svelte-rtf-editor';

  const rtf = String.raw`{\rtf1\ansi {\b Hello}, {\i world}!}`;
</script>

<RtfViewer content={rtf} />
```

The viewer renders the RTF as HTML and places a **Copy RTF** button in the top-right corner.

---

### Rich-text editor

```svelte
<script>
  import { InkEditor } from 'svelte-rtf-editor';

  let html = '';
</script>

<InkEditor
  placeholder="Start writing…"
  onchange={({ html: h }) => (html = h)}
/>
```

#### Getting RTF out of the editor

Bind a reference to the component with `bind:this` and call `getRTF()`:

```svelte
<script>
  import { InkEditor } from 'svelte-rtf-editor';

  let editor;

  function save() {
    const rtf = editor.getRTF();
    console.log(rtf); // {\rtf1\ansi ...}
  }
</script>

<InkEditor bind:this={editor} />
<button onclick={save}>Save</button>
```

#### Pre-loading content

Pass an HTML string as `content`. If the content is already RTF, convert it first:

```svelte
<script>
  import { InkEditor, rtfToHtml } from 'svelte-rtf-editor';

  const rtfFromServer = String.raw`{\rtf1\ansi {\b Hello}}`;
  const html = rtfToHtml(rtfFromServer);
</script>

<InkEditor content={html} autosave={false} />
```

---

## API

### `<RtfViewer>`

| Prop         | Type     | Default   | Description                              |
|--------------|----------|-----------|------------------------------------------|
| `content`    | `string` | —         | Raw RTF string to parse and display      |
| `fontFamily` | `string` | `'Segoe UI'` | Font the document is shown in; a CSS list names the font first, then what a screen without it shows. See [Fonts](#fonts) |
| `fontSize`   | `number` | `12`      | Body text size in points                 |
| `maxRtfBytes` | `number` | `52428800` | The largest document it reads (50 MB); `0` reads any size. See [Size limit on import](#size-limit-on-import) |
| `fonts`      | `string[]` | `[]`    | The fonts text may be shown in beside the document's own: the same list you give the editor. See [Fonts for selected text](#fonts-for-selected-text) |

---

### `<InkEditor>`

#### Props

| Prop            | Type       | Default                      | Description                                               |
|-----------------|------------|------------------------------|-----------------------------------------------------------|
| `content`       | `string`   | `'<p><br></p>'`              | Initial HTML content. Made safe before it is shown: see [HTML from outside](#html-from-outside) |
| `placeholder`   | `string`   | `'Start writing something beautiful...'` | Placeholder text when editor is empty     |
| `autosave`      | `boolean`  | `false`                      | Keep a draft in `localStorage`, and show it on mount in place of `content`. See [Auto-save](#auto-save) |
| `storageKey`    | `string`   | `'ink-editor-content'`       | `localStorage` key the draft is kept under. Give each document its own |
| `ariaLabel`     | `string`   | `'Document'`                 | The name of the editing area for a screen reader          |
| `showToolbar`   | `boolean`  | `true`                       | Show the formatting toolbar                               |
| `stickyToolbar` | `boolean`  | `true`                       | Keep the toolbar in sight while a long document is scrolled. See [The toolbar of a long document](#the-toolbar-of-a-long-document) |
| `showStatusBar` | `boolean`  | `true`                       | Show the word/character count bar                         |
| `minHeight`     | `string`   | `'40vh'`                     | CSS `min-height` of the editing area                      |
| `readonly`      | `boolean`  | `false`                      | Disable editing                                           |
| `maxImageEdge`  | `number`   | `1600`                       | Longest edge (px) an inserted image is scaled down to; `0` keeps full size |
| `maxImageBytes` | `number`   | `524288`                     | Encoded byte ceiling per image; an oversized picture is re-encoded and shrunk until it fits, and is not inserted if it cannot. `0` disables |
| `maxRtfBytes`   | `number`   | `52428800`                   | The largest RTF file Import reads (50 MB); `0` reads any size |
| `maxImageDisplayWidth` | `number` | `624`                 | Width (px) a newly inserted image is displayed at, unless the column is narrower — 6.5in of page. `0` fills the column |
| `fontFamily`    | `string`   | `'Segoe UI'`                 | Document font, on screen and in the RTF. A CSS list names the font first, then what a screen without it shows. See [Fonts](#fonts) |
| `fontSize`      | `number`   | `12`                         | Body text size in points, on screen and in the RTF        |
| `fontSizes`     | `number[]` | `[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36]` | The sizes, in points, the toolbar's size list offers for selected text. The body size is always among them; `[]` takes the list off the toolbar. See [Size of selected text](#size-of-selected-text) |
| `fonts`         | `string[]` | `[]`                         | The fonts the toolbar's font list offers for selected text, beside the document's own. `[]` means no font list, and one font for the whole document. See [Fonts for selected text](#fonts-for-selected-text) |
| `fontMenu`      | `boolean`  | `false`                      | A right-click on the text opens a menu of `fonts` in place of the browser's menu. Shift + right-click still opens the browser's. See [The font menu](#the-font-menu) |
| `tools`         | `ToolbarTool[]` | all (`TOOLBAR_TOOLS`)   | The toolbar's controls, by name. A control not named is not rendered. See [Choosing the toolbar's controls](#choosing-the-toolbars-controls) |
| `moreTools`     | `ToolbarTool[]` | `[]`                    | Those of `tools` that wait behind a More button, in a second row. `[]`: no button |
| `moreOpen`      | `boolean`  | `false`                      | Bindable: whether that second row is open. The editor keeps it nowhere itself |
| `moreLabel`, `lessLabel` | `string` | `'More'`, `'Less'`  | The button's words, closed and open                         |
| `toolbarEnd`    | `Snippet`  | none                         | Controls of your own, at the end of the toolbar's first row (before More) |
| `keepAttributes` | `string[]` | `[]` | `data-` attributes of your own that stay on HTML you set or the user pastes. See [HTML from outside](#html-from-outside) |
| `keepClasses` | `string[]` | `[]` | Class names of your own that stay the same way |

#### Callback props

| Prop       | Payload                                      | Description                                 |
|------------|----------------------------------------------|---------------------------------------------|
| `onchange` | `{ html, text, wordCount, charCount, estimatedRtfBytes }` | Fired on every content change. `html`, `text` and `estimatedRtfBytes` are worked out when the handler reads them, so a handler that only wants the counts costs nothing on a long document. They are the document as it is when first read: read them in the handler. A payload kept and read after a later edit gives the document as it is by then |
| `onsave`   | `{ html }`                                   | Fired on `Ctrl+S`, and after each auto-save where `autosave` is on |
| `onimport` | `{ html }`                                   | Fired after a successful RTF file import    |
| `onmoretoggle` | `open: boolean`                          | Fired when the More button opens or closes the second row |

#### Methods (via `bind:this`)

```ts
editor.getHTML()          // → string  — current editor HTML
editor.getText()          // → string  — plain text (no tags)
editor.setHTML(html)      // → void    — replace content programmatically (made safe first; throws, leaving the editor empty, if it cannot be)
editor.getMarkdown()      // → string  — Markdown conversion of content
editor.getRTF()           // → string  — RTF conversion of content
editor.getRtfSize()       // → number  — exact byte size of that RTF
editor.clear()            // → void    — clear the editor
editor.focus()            // → void    — focus the editor
editor.exportFile(format) // → void    — download as 'html' | 'md' | 'rtf'
editor.importRtf()        // → void    — open the file picker to import .rtf
editor.setFontSize(14)    // → void    — size, in points, of the selected text, or of what is typed next
editor.setFont('Calibri') // → void    — font of the selected text, or of what is typed next: one of `fonts`, or '' for the document font
editor.clearFormatting()  // → void    — take bold, italic, underline, strike, color, size and font off the selected text
editor.setLineSpacing(1.5) // → void   — line spacing of the selected paragraphs, in lines; null for the document's own
editor.setParagraphSpacing({ before: 6, after: 12 }) // → void — space before and after them, in points; either may be left out, 0 or null is none
editor.setListMarkerGap(27) // → void   — gap between the markers and the text of the selected lists, in points (6 to 144); null for the quarter inch
editor.insertTable(3, 2, { borders: true, header: false }) // → void — a table of empty cells after the paragraph the caret is in
editor.undo()             // → boolean — take back the last step; false if there was none
editor.redo()             // → boolean — make a step that was taken back again; false if there was none
```

#### Auto-save

`autosave` is off by default. Turned on, the editor writes the document's HTML to `localStorage` under `storageKey` a second after each change, and on mount shows a draft it finds there **in place of `content`**. Two things follow, and both matter where the documents are patient reports:

- Give every document its own `storageKey` (`storageKey={`report-${id}`}`). With one key for all of them, the draft of the last document edited is shown in place of the next one opened.
- The draft is plain text in the browser's storage until `clear()` is called. Call it when the document is saved or abandoned, or leave `autosave` off and keep drafts yourself from `onsave`/`onchange`.

#### HTML from outside

Whatever HTML reaches the editor is made safe before it is shown: the `content` prop, `setHTML()`, a draft restored from `localStorage`, what a paste brings, what is dragged in from another page or from elsewhere in the document, and what Undo and Redo put back (Redo after a paste gives the browser's own copy of the paste, not the one that was made safe). `sanitizeHtml` is exported for HTML you show yourself (stored editor output in a preview, say).

A paste and a drop are made safe just after the browser has put them in the document, not before: a frame or a picture in them may be asked for from its address in that moment, though it does not stay.

An element that cannot be checked is taken out, and a document that cannot be checked at all is not shown: the editor is left empty and says so, `setHTML()` throws, and the document that was there before does not stay on the screen in its place.

| Taken out | Why |
|---|---|
| `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<svg>`, `<video>`, `<audio>`, with what is in them | They run code or load a page of their own |
| `<button>`, `<textarea>`, `<select>`, `<input>` and `<math>`: the element goes, the words it showed stay as text | They take input, or are not something RTF can carry. A formula of numbers and signs in a row stays as those characters (`30%`); one with a fraction, a power or a root is written `[formula]`, since its parts read in a row would say something else. Only words that were shown stay: none of an element that was hidden (`hidden`, `display:none`, `visibility:hidden`, `mso-hide:all`), none of a hidden part of a button, and a formula that KaTeX wrote twice, once as text and once to be read aloud, is kept once. Elements side by side leave their words a space apart (`1 5`, not `15`) |
| Every attribute but the ones a document uses (`style`, `href`, `src`, `alt`, `colspan`, `start`, …) | That is how `onclick`, `onerror` and the rest go |
| A link that is not `http(s):`, `mailto:` or `tel:`; a picture address that is not a web address or picture data | `javascript:`, `data:text/html`, `file:` |
| Style properties that do not format text, a paragraph, a picture or a table (`position`, `z-index`, …), and any value with `url()` | A pasted block with `position: fixed` covered the page the editor sat in |
| A size that would put an element outside the page: a margin below zero, a margin, padding or width over 2200 px (a little more than the widest page), a width or height on anything but a picture, a table, its cells or a rule, a `width` or `height` attribute over 2200 or 100%, a padding over 32 px on a piece of text inside a line, a border picture, a size in `vw`/`vh` or worked out with `calc()`, a `display` other than the ones a document uses | A block with a negative margin was drawn over the toolbar, and a link with a padding of thousands of pixels was the size of the page. Sizes counted in ems or percent are worked out from the text size the document's styles give, so they do not grow past the limit by being nested. One margin below zero is kept: on a list, up to the half inch a list is indented by itself, which is how a list read from RTF carries an indent smaller than that |
| A size that would put words out of sight: a first line that starts further left than its paragraph is moved in (`text-indent: -100%`), and a text size under half a pixel | The words were in the RTF and not on the screen. A hanging indent (`margin-left:36pt; text-indent:-36pt`) stays as written |
| Style text the browser did not read as a property (`width: expression(…)`, a property named twice) | It does nothing here, but it would still be in the HTML for whatever shows it next. Where there is any, the attribute is written again from the properties that were read and kept. An attribute that is all read and kept stays exactly as it was written, `border: 1px solid black` included |
| `class`; an `id` that names something on `document` or `window`; the `id` of a link; in the editor, an `id` the page already uses for an element outside an editor | They would take on the page's own styles, or answer to a name or an `id` the page's scripts look up. A document's own ids are kept, also when it is shown again while its first showing is still in the editor. They are still names on `window`, as every `id` in a page is: a page whose scripts read settings from `window` by a name they do not define should not show documents from strangers |

**Marks of your own.** An application that marks elements in its documents and reads the marks back (`<p data-section="2">`), or styles one by a class (`<pre class="summary">`), names them in `keepAttributes` and `keepClasses`, and they stay on HTML it sets and on what the user pastes:

```svelte
<InkEditor content={html} keepAttributes={['data-section', 'data-row']} keepClasses={['summary']} />
```

Only attribute names that start with `data-` are kept, and after it only letters, digits, `-`, `_` and `.`; anything else in the list (`onclick`, `style`, `src`) is ignored, so the list cannot let in what the table above takes out. Any class name can be named, `md:flex` and `w-1/2` included. A kept class is kept by name alone: how it looks is your stylesheet's doing, and a paste that happens to use the same name gets it too. A kept attribute comes in with a paste the same way, with whatever value the pasted page gave it, so read a mark back as you would read anything a user typed; and a marked paragraph copied and pasted is two paragraphs with the same mark. Neither changes the RTF. `sanitizeHtml(html, { keepAttributes, keepClasses })` does the same for HTML you show yourself. Without the settings both are taken off, as since 1.10.0: an application that upgraded from an earlier version and relies on one has to name it.

The editing area also clips what it holds: nothing in a document is drawn outside it, whatever its styles, and a table wider than the area scrolls inside it. The frame around a selected picture stays inside it too. Text that Word marked hidden (`mso-hide: all`) is hidden on screen as it is left out of the RTF, and in a paste it is not pasted. A closed `<details>` is shown open, since what is in it is written to the RTF either way.

`getHTML()` returns what is in the editor, which has been through this. HTML from `rtfToHtml` is safe by construction (see [What `rtfToHtml` may return](#what-rtftohtml-may-return)).

---

## Utility functions

```ts
import {
  rtfToHtml, htmlToRtf, estimateRtfBytes, readRtfFile, htmlToMarkdown, downloadFile, sanitizeHtml,
  DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, DEFAULT_MAX_RTF_BYTES, isSafeLinkUrl
} from 'svelte-rtf-editor';
```

| Function                              | Description                                        |
|---------------------------------------|----------------------------------------------------|
| `rtfToHtml(rtf: string, options?: { fontSize?, maxBytes?, fonts?, fontFamily? }): string` | Parse an RTF string and return an HTML string. `fontSize` is the size of the screen it will be shown on (default 12). `fonts` and `fontFamily` are the editor's: see [Fonts for selected text](#fonts-for-selected-text). Throws a `RangeError` for a string longer than `maxBytes` (default 50 MB; see [Size limit on import](#size-limit-on-import)) |
| `htmlToRtf(el: HTMLElement, options?: { fontFamily?, fontSize? }): string` | Convert a DOM element's content to RTF, in Segoe UI 12 pt unless told otherwise |
| `estimateRtfBytes(el: HTMLElement, options?: { fontFamily?, fontSize? }): number` | Approximate RTF size of a DOM element without converting it. Give it the options `htmlToRtf` is called with; it is never below the real size |
| `isSafeLinkUrl(url: string): boolean` | Whether a link address is a web, mail or phone address; `htmlToRtf` and `htmlToMarkdown` write any other link as its text alone, and `rtfToHtml` reads any other as text |
| `readRtfFile(file: File, options?: { fontSize?, maxBytes? }): Promise<string>` | Read a `.rtf` File object and return HTML. Rejects, without reading it, for a file larger than `maxBytes` |
| `htmlToMarkdown(el: HTMLElement): string` | Convert a DOM element's content to Markdown. See [Markdown export](#markdown-export) |
| `sanitizeHtml(html: string, options?: { keepAttributes?: string[]; keepClasses?: string[]; fonts?: string[]; fontFamily?: string }): string` | HTML made safe to show and edit. See [HTML from outside](#html-from-outside). Needs a DOM (`DOMParser`); without one it returns `''` |
| `downloadFile(name, content, mime): void` | Trigger a file download in the browser        |

---

## Fonts

The editor and the viewer show a document in the same font and size the RTF carries, so what you see on screen is what the receiving system gets. Both default to **Segoe UI 12 pt** (`DEFAULT_FONT_FAMILY` and `DEFAULT_FONT_SIZE`, which the package exports).

To use another font, pass it to each of the three places a document goes through. Nothing else has to change:

```svelte
<InkEditor fontFamily="Calibri" fontSize={11} bind:this={editor} />
```

```svelte
<RtfViewer content={rtf} fontFamily="Calibri" fontSize={11} />
```

```ts
htmlToRtf(el, { fontFamily: 'Calibri', fontSize: 11 });
```

An application that shows documents in more than one place does well to keep the two values in one module of its own and pass them from there, so that a change of font is one line.

The default was Arial through 1.9.0. A document is written in the font of the editor that saves it, not in the font it was written in before: a report saved in Arial and opened and saved again by an editor left at the default comes out in Segoe UI. To keep Arial, pass `fontFamily="Arial"`.

Segoe UI is installed with Windows. On a system without it (macOS, Linux, a phone) the screen shows the system's sans-serif font in its place, and the RTF still names Segoe UI, which is what the receiving system reads. To show such a screen something closer, see [A font the screen does not have](#a-font-the-screen-does-not-have).

- `fontFamily` is used for the whole document: body text, headings, lists and tables. Code keeps Courier New.
- `fontSize` is the body size in points. Headings scale from it: at 12 pt, `h1` is 24 pt, `h2` 18 pt and `h3` 14 pt.
- If you call `htmlToRtf` yourself on the editor's content, pass the same options you gave the editor, or the two produce different RTF.
- `fontFamily` names one font. Given a CSS list such as `'Segoe UI, Selawik, sans-serif'`, the first family is the font: the one the RTF names, and the one the toolbar's font list shows. The rest of the list is for the screen alone, where the font is missing. Through 1.12.0 the rest of the list was ignored.
- `fontSize` is rounded to the nearest half-point, which is what RTF measures in, and kept between 1 and 1638 pt.
- If you show RTF in an editor or viewer set to another size, pass the same `fontSize` to `rtfToHtml`. Text at that size then carries no size of its own, text at any other size keeps it, and headings are recognized by the same ratios the writer uses. `InkEditor`'s RTF import and `RtfViewer` do this themselves. A heading must also be bold, at every body size, as every heading the writer emits is.

### The toolbar of a long document

The editing area grows with the document, and the page scrolls. The toolbar stays at the top of the window while it does, or at the top of the scrolling element the editor is in, and leaves with the end of the editor. A caret moved up with the keys is not left under it.

- Under a header of your own that stays at the top too, give the toolbar its place below it: `--ink-toolbar-top: 56px` on the editor or any element around it.
- It cannot stay where an element around the editor has `overflow: hidden`, `auto` or `scroll` and is not itself what scrolls: that is how `position: sticky` works. Take the `overflow` off that element, or make it the one that scrolls.
- `stickyToolbar={false}` lets the toolbar go with the page, as it did through 1.12.0.

### Choosing the toolbar's controls

Every control of the toolbar has a name that is part of the API, and is on the element as `data-tool`. A name does not change when a tooltip is reworded or translated; a control added later gets a new name, and the release notes say so.

```ts
import { TOOLBAR_TOOLS, type ToolbarTool } from 'svelte-rtf-editor';
// block, font, fontSize, bold, italic, underline, strikethrough, textColor, clearFormatting,
// bulletList, numberedList, alignLeft, alignCenter, alignRight, outdent, indent, hangingOutdent,
// hangingIndent, hangAtCaret, rightOutdent, rightIndent, spacing, copyFormat, link, image, table,
// horizontalRule, undo, redo
```

**`tools`** says which controls the toolbar has. Leave out what the receiving system does not keep: a control that changes the screen and not the delivered document misleads whoever signs it.

```svelte
<InkEditor tools={['bold', 'italic', 'underline', 'clearFormatting', 'bulletList', 'numberedList', 'undo', 'redo']} />
```

- A control that is not named is not rendered at all. Its keyboard shortcut still works (Ctrl+B with `bold` left out).
- The order is the editor's own, whatever order you name them in. A group left empty is not rendered, and a divider stands only between two groups of controls.
- `fonts={[]}` and `fontSizes={[]}` still take those lists off; `tools` can only narrow further.
- A name that is no control is ignored, with a warning in the console.

**`moreTools`** puts some of those controls behind a More button, for what applies but is seldom wanted:

```svelte
<script>
	let moreOpen = $state(false); // keep it where you like: the editor stores nothing
</script>

<InkEditor
	{fonts}
	moreTools={['font', 'fontSize', 'strikethrough', 'alignLeft', 'alignCenter', 'alignRight',
	            'hangingOutdent', 'hangingIndent', 'rightOutdent', 'rightIndent', 'copyFormat', 'link', 'image']}
	bind:moreOpen
/>
```

- The first row has the other controls and, at its end, a button with a word on it: **More** when closed, **Less** when open (`moreLabel`, `lessLabel` to translate them). It has `aria-expanded`, and `aria-controls` names the second row.
- Open, the second row is under the first, in the editor's order with its dividers. Closed, it is `hidden`.
- Nothing in the first row moves when the second opens or closes: the button is one width for both of its words.
- Pressing it leaves the selection where it was, so words selected, then More, then a size, sizes those words. A font or size on the text stays when the row closes, and the lists show it when it opens again.
- Tab goes through the first row, the button, then the second row: the order they are seen in.
- The toolbar that stays in sight of a long document (`stickyToolbar`) is both rows.
- On a narrow page the first row wraps, with the button at the end of its last line; the second row starts on a line of its own.
- `onmoretoggle(open)` fires on each press.

**`toolbarEnd`** is a place for a control of your own, at the end of the first row and before More. It is inside the toolbar, in the Tab order, and styled by you:

```svelte
<InkEditor>
	{#snippet toolbarEnd()}
		<button type="button" onclick={insertTemplate}>Template</button>
	{/snippet}
</InkEditor>
```

With none of these set, the toolbar is as it was in 1.16.0, apart from the `data-tool` names.

### Opening a link

A click on a link in the editor puts the caret in it, as anywhere else in the text, so that its words can be changed. To open the link, click it with `Ctrl` held down (`Cmd` on a Mac), as in Word. The pointer over a link shows a note with the address and that instruction. The note is the editor's own: it is not in the HTML or the RTF.

- The link opens in a new tab, which is given no access to your page and is not told where it was opened from.
- Only an address `isSafeLinkUrl` accepts is opened: a web, mail or phone address.
- With `readonly` there is no caret to place, so a plain click opens the link, in a new tab like the viewer's. It used to open in place of your application.
- How a link opens for the reader of the RTF is the receiving system's own affair. The RTF holds the address and the words (a `HYPERLINK` field), and says nothing of clicks.

### A font the screen does not have

The RTF names a font; it does not carry one. Whoever opens the document sees it in that font only if their machine has it, and that goes for your users' browsers too. On a Mac, a document in Segoe UI is shown in Helvetica, which is hard to tell from Arial, and lines break in other places than they will for the reader on Windows.

A page cannot reliably find out which fonts a machine has, and does not need to. Give the font a stand-in the page loads itself, and name it after the font:

```css
/* Your page's stylesheet. The files are served by your own application. */
@font-face { font-family: "Selawik"; font-weight: 400; src: url("/fonts/selawik-regular.woff2") format("woff2"); }
@font-face { font-family: "Selawik"; font-weight: 700; src: url("/fonts/selawik-bold.woff2") format("woff2"); }
```

```svelte
<InkEditor fontFamily="Segoe UI, Selawik, sans-serif" />
<RtfViewer content={rtf} fontFamily="Segoe UI, Selawik, sans-serif" />
```

Where Segoe UI is installed the browser uses it and does not fetch the stand-in. Where it is not, the stand-in is fetched and shown. The RTF names Segoe UI either way. The fonts you offer for selected text take a stand-in the same way: `fonts={['Calibri, Carlito, sans-serif']}`.

Fonts made to take the place of the usual ones, with letters of the same widths, so that lines break where they do in the original:

| Font | Stand-in |
| --- | --- |
| Segoe UI | Selawik (upright cuts only: italic is slanted by the browser) |
| Calibri | Carlito |
| Cambria | Caladea |
| Arial | Arimo, Liberation Sans |
| Times New Roman | Tinos, Liberation Serif |
| Courier New | Cousine, Liberation Mono |

- Use a stand-in rather than the font itself. Segoe UI, Calibri and the others belong to their makers and are not yours to serve from a web page; the stand-ins are published under open licences. Read each one's licence before you ship it.
- Serve the files from your own application, not from a font service. A request to someone else's server tells them who opened a document and when, is stopped by a strict content security policy, and does not work on a network that is closed to the outside.
- Give the stand-in its own name, as above, and do not declare it under the name of the font it stands in for. A page that declares `"Segoe UI"` with one regular file takes the place of the installed Segoe UI too, and its bold is then the regular cut drawn thicker.
- This package loads no fonts and makes no requests. The stylesheet and the files are your page's.

### Size of selected text

The toolbar has a list of sizes, next to the list of paragraph kinds. A size chosen there is given to the selected text; with nothing selected, to what is typed next. The list shows the size of the text at the caret, also when it is not one of the sizes offered, and is empty where the selection starts in one size and ends in another.

- The size is written to the RTF as `\fsN` around that text, and read back as that size by `rtfToHtml`.
- Text set back to the size the text around it has (the body size in a paragraph, the heading's size in a heading) is given that size as `1em`, and follows `fontSize` again like text that was never sized. The writer reads `1em` as no size.
- The sizes offered are `fontSizes`; pass your own list, or `[]` to leave the size list out. `editor.setFontSize(points)` does the same from your own toolbar.
- The editor uses the browser's own font-size command, so a change of size is undone and redone with everything else. In the HTML the size is on a `<font>` element (`<font style="font-size: 14pt">`).
- A whole paragraph that is bold and at the size a heading has is read back from RTF as that heading: it looks the same, and the list of paragraph kinds then names it a heading.
- `htmlToRtf` also reads `<font size="1">` to `<font size="7">`, which is how older pages and mail carry sizes, as the sizes a browser shows them at (7.5, 10, 12, 13.5, 18, 24 and 36 pt). They were shown at those sizes and written at the body size.

The font has to be installed on the machine that displays the document. The RTF names it, and a reader without it substitutes one of its own.

### Fonts for selected text

By default a document has one font, `fontFamily`, and the toolbar has no font list. To let users set words in other fonts, name the fonts you offer:

```svelte
<InkEditor fonts={['Georgia', 'Calibri, Carlito, sans-serif', 'Arial']} bind:this={editor} />
```

The toolbar then has a font list before the size list: the document font first, then yours. A font chosen there is given to the selected text; with nothing selected, to what is typed next. `editor.setFont(name)` does the same from your own toolbar, and `editor.setFont('')` sets text back to the document font.

Which fonts to offer is decided by the system that receives the RTF, not by what is installed where the document is written or viewed. A font that system cannot show is a choice the user only appears to have: the words come out in whatever it substitutes. So the list is set by whoever integrates the editor, once for each receiving system, and leaving it out is as good a decision as any: one font, and no font list.

The list is the limit. A font that is not on it is not offered, is taken off HTML that is set or pasted, is not written to the RTF and is not read back from one. Keep it with `fontFamily` and `fontSize` in one module of your own, and pass all three wherever a document goes. What your own screens show of a font they do not have is a separate matter: see [A font the screen does not have](#a-font-the-screen-does-not-have).

- An entry is a font name, or a CSS list whose first family is the name. The rest of the list is what a screen without that font shows the text in: `'Calibri, Carlito, sans-serif'` is Calibri in the list and in the RTF, and Carlito on a machine that has no Calibri. A name alone is given `serif`, `sans-serif` or `monospace` after it, whichever suits it.
- In the RTF, each font the document has text in is one more entry of the font table, and the text is written between `\fN` and the font it was in before. A font that is offered and not used is not in the table.
- An editor that offers no fonts lets none in. Text pasted from Word or a web page is shown in the document font, as the RTF has it. Through 1.12.0 the font of a paste stayed on the screen and was never written to the RTF: the editor showed Calibri and sent Segoe UI. If you use the editor for its HTML and want pasted fonts kept, name them in `fonts`.
- Pass the same list wherever the document goes: `<RtfViewer fonts={…}>`, `htmlToRtf(el, { fonts })`, `rtfToHtml(rtf, { fonts, fontFamily })` and `sanitizeHtml(html, { fonts, fontFamily })`. Without it the writer writes one font and the reader gives none. `sanitizeHtml` called without `fonts` leaves fonts as they come, as before; with a list, `[]` included, it keeps those fonts and the document's and takes any other off.
- An RTF file from another program is read the same way. Text it sets in a font you offer carries that font; text in any other font, and text in the font your screen shows the document in, carries none. TextEdit names each cut of a font (`TimesNewRomanPS-BoldMT`, `Arial-ItalicMT`): those are read as Times New Roman and Arial.
- The editor uses the browser's own font command, so a change of font is undone and redone with everything else. In the HTML the font is on a `<font>` element (`<font face="Georgia, serif">`); what is read from RTF has it as a style (`<span style="font-family:Georgia, serif">`). Both are written to RTF alike.
- Set back to the document font, the words lose their `<font>` in Chromium and Safari, and in Firefox are given one that names the document font. The RTF is the same.
- Code stays in Courier New whatever font is around it. A monospace font you offer is written as that font, and read back as code, which is what a reader makes of text in a monospace font.
- [Clear formatting](#clear-formatting) takes a font off with the rest.

#### The font menu

The font list is in the toolbar. Set `fontMenu` and a right-click on the text opens the same fonts as a menu as well, where the pointer is:

```svelte
<InkEditor fonts={['Georgia', 'Calibri, Carlito, sans-serif', 'Arial']} fontMenu />
```

The menu shows the document font first, then yours, each in its own font, with the font of the selected text checked. Choosing one sets the font of the selection, exactly as the toolbar's list does, and Undo takes it off again. On a Mac a right-click selects the word it is on, so a right-click on a word and a choice from the menu are enough to set that word.

The menu is off by default because it takes the place of the browser's own menu, and with it the spelling suggestions, Copy and Paste. The browser's menu is still there when you need it:

- Shift + right-click opens the browser's menu. The foot of the font menu says so.
- A right-click on a link or a picture opens the browser's menu, which has what a link or a picture needs (Open link, Copy image).
- Without `fonts`, or with `readonly`, `fontMenu` changes nothing.

From the keyboard, the menu key or Shift+F10 opens the menu at the caret, where the browser sends the page the menu's event (Chromium does; check the others in your own setup). In the menu, the arrow keys, Home and End move, Enter or Space chooses, and Escape or Tab closes it and gives the text the keyboard back. A click anywhere else, a scroll, or the window losing the keyboard closes it too.

### Clear formatting

The toolbar's Clear formatting button, next to the text color, takes the formatting off the selected text. `editor.clearFormatting()` does the same from your own toolbar. With nothing selected it changes nothing in the document.

| Taken off | Stays |
| --- | --- |
| Bold, italic, underline, strikethrough | Headings, lists, block quotes, code blocks, tables |
| Text color and highlight | Links |
| Size and font | Alignment, indents, hanging indents, tabs |
| Superscript, subscript, inline code | Pictures, their size and captions |
| The same written as a style on a paragraph, a table cell or a pasted `<span>` | A table cell's shading |
| | Elements carrying your `keepAttributes` or `keepClasses` |

- Only the selected words change: clearing two words of a bold sentence leaves the rest bold.
- The result is the same HTML in Chromium, Firefox and Safari (the browser tests run in all three engines, on every push). The browsers' own command is not: one takes a paragraph's alignment with its color, another leaves the color on the paragraph, a third takes out the element your mark is on.
- Undo puts the formatting back and Redo takes it off again, from the keyboard and from the toolbar, also after more has been typed and undone.
- On a very long selection it takes time, and four times as long for twice the length. The time is the browser's own command: measured on paragraphs with four formatted runs each, 250 of them (about eight pages) clear in a quarter of a second in Chromium, 1,000 in three seconds, 2,000 in twelve; Safari's engine takes about two thirds of that and Firefox a tenth. A report of ordinary length is not affected.
- A mark stays whole in all three browsers, whatever part of it is selected. In Firefox the words inside it keep the bold or italic they have there: its command cannot clear them without cutting the mark in two.

---

## Lists

The toolbar's **Bullet list** and **Numbered list** buttons are the editor's own, not the browser's list commands, so a list is made the same in Chrome, Edge, Safari and Firefox, and its HTML is the same.

- **Making a list.** Every line the selection touches becomes an item: a paragraph, a heading, or a line of words in no paragraph. Lines next to each other are one list, and a line made an item next to a list of the same kind is an item of that list, whichever is made first; the numbers run on. The caret stays in the words where it was.
- **Taking it off.** The button of the kind the items already are makes them paragraphs again, one paragraph for each item. One item taken off in the middle leaves a list before it and a list after it.
- **The other kind.** With the caret in a list, the other button changes the whole list, bullets to numbers or back. With items selected, it changes those items.
- **A list within a list.** `Tab` at the start of an item, or Increase indent anywhere in it, puts the item under the item before it; `Shift+Tab` or Decrease indent takes it out again. Several items selected go together. The first item of a list has none before it to go under: there Increase indent moves the whole list, as it moves a paragraph, and `Tab` types a tab.
- **Leaving a list.** `Enter` in an item with nothing in it, and `Backspace` at the start of an item, take the item one list out; from a list that is in no other, it becomes a paragraph.
- The buttons are lit while the caret is in a list of their kind. In a list within a list, the kind is the inner list's.
- Not made an item: a picture with its caption, a table as a whole (a line inside a cell is), a code block.
- A lettered list or one in Roman numerals (`<ol type="A">`) is kept as it is and takes new items; the buttons make bullets and plain numbers only.

How a list is written to RTF and read back is under [What is written, and what is read back](#what-is-written-and-what-is-read-back).

## Undo and Redo

The editor keeps its own history. `Ctrl+Z` / `Cmd+Z`, `Ctrl+Shift+Z` / `Cmd+Shift+Z`, `Ctrl+Y`, the toolbar's buttons, the browser's Edit menu, and `editor.undo()` / `editor.redo()` all go through it.

A browser's history knows only its own commands and what was typed. It knew nothing of a picture or a table put in, a picture moved, placed beside another or resized, an indent, a spacing, or a list: its Undo went past those to the typing before them, and after some of them it could undo nothing at all. The editor's history takes back whatever changed the document, in the order it was done.

- **A step** is one press of a button, one paste, one drop, a new paragraph, or a run of typing. Typing is one step until the writer pauses for a second, moves the caret, or changes from typing to deleting.
- **The caret** is put back where it was before the step.
- **Redo** makes a step again that Undo took back, until something else is changed.
- **A new document starts a new history.** After `setHTML()`, `clear()`, or an RTF file imported, Undo does not lead back into the document that was there before.
- What Undo puts back is checked as everything that reaches the editor is (see [HTML from outside](#html-from-outside)).
- 200 steps are kept. A step holds the document's HTML with each embedded picture kept once, not once per step, so a report with megabytes of pictures does not hold them 200 times.

## Paragraph formatting

A `<p>` or `<div>` keeps its own indents, spacing and tab stops in the RTF, so a layout made of ordinary paragraphs, such as a bold label, a tab, and text in a column with later lines hanging under it, reaches the receiving system:

| HTML on the paragraph | RTF |
|---|---|
| `margin-left: 1.75in` | `\li2520` |
| `margin-right: 0.5in` | `\ri720` |
| `text-indent: -1.75in` | `\fi-2520` |
| `margin-top: 5pt` / `margin-bottom: 5pt` | `\sb100` / `\sa100` |
| `line-height: 1.5` (or `150%`) | `\sl360\slmult1` |
| `line-height: 14pt` | `\sl-280\slmult0` (exactly 14 pt) |
| `break-after: avoid` or `page-break-after: avoid` | `\keepn` |
| `data-rtf-tab-stops="1.75in"` (comma-separated) | `\tx2520` |

- Lengths in `in`, `pt`, `cm`, `mm` or `px` (15 twips per px), rounded to whole twips. Only `text-indent` may be negative. A value the writer cannot read, or zero, writes nothing.
- CSS has no absolute tab stop, hence the `data-` attribute. On screen, `white-space: pre-wrap; tab-size: 1.75in` with that hanging indent puts the browser's first stop at the same place, and `pre-wrap` makes the writer send the tab as `\tab`.
- `margin-left` adds to the indent of the blocks around the paragraph (an indent pasted from a browser, or a `<div>` with a margin that holds paragraphs), and is written as one `\li`.
- Inside a table cell the cell declares its own paragraph: alignment, the left indent and spacing are written there, not the right or first-line indent, tab stops or keep-with-next.
- `rtfToHtml` reads the three indents back, in points: `\li720\ri720\fi-720` becomes `margin-left:36pt;margin-right:36pt;text-indent:-36pt`, and `RtfViewer` shows them. As in RTF, they hold from one paragraph to the next until `\pard`. Indents inside a table cell are not read.
- A heading outside a table cell also writes its right and first-line indents, so a heading read from RTF with a hanging number goes back as it came. A picture is read with a left margin only, where its line starts.
- `rtfToHtml` reads spacing back too: `\sb120\sa240\sl360\slmult1` becomes `margin-top:6pt;margin-bottom:12pt;line-height:1.5`, on a paragraph, a heading, a list item (as the `<li>`'s style) or a picture, and holds until `\pard` as the indents do. Line spacing "at least" (a positive `\sl` without `\slmult1`) is not something CSS can say, and is left out. In a table cell where a paragraph is spaced, as Word writes a cell's paragraphs, each of the cell's paragraphs is read as a `<p>` with its spacing; a cell with none spaced is read as lines, as before.
- `rtfToHtml` does not yet read keep-with-next or tab stops back.

### Line and paragraph spacing

The **Spacing** list in the toolbar sets, for the paragraphs the selection touches:

- **Line spacing**: 1, 1.15, 1.5 or 2 lines, or Default (the document's own).
- **Space before paragraph** and **Space after paragraph**: 0, 6 or 12 pt.

The list marks what the paragraph at the caret has, and shows a value it does not offer (`7.5 pt` from a pasted document) so that it can be seen and changed. A heading takes spacing as a paragraph does, and so does a list item: the item the caret is in, as one paragraph, its style on the `<li>`. In the RTF its space before is on its first paragraph, its space after on its last, and its line spacing on each. In a table cell the paragraph the caret is in is spaced; a line typed straight into the cell is made a paragraph first. With a picture selected, the space before and after is the picture's, which is how the distance between two pictures, one under the other, is set. Each change is one step for Undo.

`setLineSpacing(lines)` and `setParagraphSpacing({ before, after })` do the same from code, with any value: up to 10 lines, and up to 144 pt. Copy format carries a paragraph's spacing with its alignment and indents.

#### The gap after a list's bullets or numbers

With the caret in a list, the Spacing list also offers **Bullet or number gap**: how far each item's text starts from its bullet or number, 9, 18, 27 or 36 pt, or Default. It is Word's *text indent* of a list: the marker stays where it is, and the text moves. `setListMarkerGap(points)` sets any gap from 6 to 144 pt, and `null` takes it off. It is set on the lists the selection touches, the innermost for an item of a list within a list, and is one step for Undo.

- **In the HTML** the gap is the list's own `padding-left` (`<ol style="padding-left: 27pt;">`), which is that distance in CSS too. A list without one has the quarter inch (18 pt) every list always had, and is shown and written as before.
- **On the screen** the editor draws the bullets and numbers of a list with a gap itself, at the list's edge, where Word has them; a browser draws its own markers against the text, by how wide they are. The numbers are worked out as the RTF writer works them out, from the list's `start` and `type` and an item's own `value`. They are written on each item as `data-ink-marker`, for the screen only: `getHTML()`, `onchange`, `onsave`, the draft and the HTML export do not have them.
- **In the RTF** each item hangs by the gap: 27 pt is `\li900\fi-540`, the marker still a quarter inch in. `rtfToHtml` reads a list hung by any gap from 6 to 144 pt as a list with that gap, Word's own lists hung by 0.2 in among them, and lists whose markers stand at one place are at one level whatever their gaps.

In the editor and in `RtfViewer` a picture has no space of its own around it, as it has none in the RTF: what is set is what shows. (Through 1.13 a picture was drawn with 20 px above and below it that no reader of the RTF showed.)

---

## What is written, and what is read back

`htmlToRtf` writes each construct below as the RTF beside it, and `rtfToHtml` reads that RTF back as the same HTML, so a document saved, reloaded and saved again is the same RTF. Where a reload changes how something is written, it changes once and then stays: nothing drifts from save to save.

| HTML | RTF | Read back as |
|---|---|---|
| `<h1>`, `<h2>`, `<h3>` | a bold paragraph at 2, 1.5 and 7/6 of the body size | the same heading, with nothing inside it but its text |
| `<h4>`, `<h5>`, `<h6>` (pasted text) | a bold paragraph at 1, 5/6 and 2/3 of the body size | a bold paragraph |
| `<ul>`, `<ol>` | one paragraph per item: `\li720\fi-360`, then `\bullet\tab` or `1.\tab` | `<ul>`, `<ol>` |
| a list inside a list item | the same, `\li720` further in for each level | a list inside the item |
| `<ol start="5">` | `5.\tab`, `6.\tab`, … | `<ol start="5">` |
| `<ol type="A">`, and `a`, `I`, `i`; the same by `list-style-type` | `A.\tab`, `B.\tab`, …: the marker the list shows | `<ol type="A">` |
| `<a href="https://…">` | `{\field{\*\fldinst HYPERLINK "…"}{\fldrslt …}}`, underlined, in the link color | `<a href="https://…" target="_blank" rel="noopener noreferrer">` |
| `<code>` | `\f1` (Courier New) | `<code>` |
| `<pre>` | a paragraph in `\f1` at 5/6 of the body size, lines separated by `\line` | `<pre>` |
| `<hr>` | a centered line of twenty em dashes | `<hr>` |
| `<hr style="break-after:page">` | `\page` | the same |
| `<blockquote>` | paragraphs indented half an inch, in italics | indented italic paragraphs |
| `<table>` | one `\trowd … \row` per row; see [Tables](#tables) | `<table>` |
| `<br>` | `\line` | `<br>` |

- **The HTML of a list made in the editor** is a `<ul>` or `<ol>` beside the paragraphs around it, and a list within a list is inside the item it is under (`<ul><li>skin<ul><li>left arm</li></ul></li></ul>`): the shape `rtfToHtml` returns, so what is kept reads back as the same document. See [Lists](#lists). A block a browser leaves inside a paragraph (Firefox leaves pasted paragraphs inside the paragraph they were pasted in), which no HTML can say, is put beside the paragraph as soon as it is there, and `getHTML()`, `onchange`, `onsave`, the draft kept by `autosave` and the HTML export never hand one out.
- **Lists.** Only the shape above is read back as a list: a bullet or `N.`, a tab, and a paragraph that hangs by 360 twips and has no right indent or alignment of its own. Word's lists have that shape and are read as lists, including the bullet it writes in a `{\listtext}` group. A paragraph hung by another distance, from 6 to 144 pt, is a list with that gap after its markers (see [the gap after a list's bullets or numbers](#the-gap-after-a-lists-bullets-or-numbers)). Anything else stays the paragraph it is, marker and all, because it could not be written back the same: a line typed as `- Invasive adenocarcinoma.`, one marked `a)` or `1)`, a centered one. A list in a table cell is read as lines of text.
- **Lettered lists.** A list numbered in letters or Roman numerals (`type="A"`, `a`, `I`, `i`, or the same as `list-style-type`, on the list or on each item as Google Docs writes it) is written with the markers the screen shows, from the list's `start` and an item's own `value`: specimen parts lettered A, B, C are A, B, C in the RTF, and "see part B" finds its item. Through 1.12.0 they were written 1, 2, 3. Such a list is read back as a list of its kind. Letters that are numerals too are told apart by what comes next: `C.` before `D.` is the third letter, before `CI.` it is a hundred. A letter and a tab typed on a line of another shape (`A.`, a tab, the specimen, as other systems write a report) stay what was typed.
- **Colors and backgrounds.** A text color is written (`\cf`). A background is not, neither a highlight nor the shading of a table cell, and shading in an RTF is not shown: every word ends up on white. So a color that can be read on its background and not on white is left out, and the words are in the reader's own color: the white header of a table with a dark header row, a sentence copied from a page with a dark theme. Through 1.12.0 such words were written white, and could not be seen in the report. A color that can be read on white is written whatever is behind it, and a light color with no background behind it is written as the screen shows it. The editor still shows a pasted table with its shading; the RTF has the same words without it. A picture or a gradient as a background is not kept at all (nothing is loaded for a document), so light words that stood on one are put in the page's own color when the document is made safe, in the editor as in the RTF, unless there is a background color behind them still.
- **List items.** A paragraph inside an item (`<li><p>…</p></li>`, as Word and Google Docs paste a list) is the item's text; a second paragraph in the item is a line under it. A list written straight inside a list (`<ul><ul>`) is one level deeper. An item with no list around it is written as a bulleted line. The list a browser's own list command makes, which the toolbar's list buttons run, is left inside the paragraph it was made from (`<p><ul>…</ul></p>`); it is written as the list alone.
- **Headings.** A paragraph is read as a heading when all of its text is at a heading's size and all of it is bold, as every heading `htmlToRtf` writes is. Size alone does not make a heading: a report set in 14 pt throughout is 14 pt paragraphs, with the words that were bold still the only bold ones. (Through 1.9.0, at a 12 pt body size, large text was read as a heading whether bold or not, and was saved bold.) A large word in an ordinary paragraph is a large word. A heading set larger than its level keeps that size.
- **Links.** A link is read back only for an address `isSafeLinkUrl` accepts, the same test the writer applies: an absolute web, mail or phone address. A field with a `javascript:`, `data:` or `file:` address, a relative or network path, or a link to a bookmark is read as its text alone. A web link opens in a tab of its own, so a click in `RtfViewer` does not replace your application. A document with a link carries the link color as the first entry of its color table (`\red0\green0\blue255`); a document without one is written as before.
- **Code.** Text in a monospace font other than the document's own font is read as code, and a paragraph set wholly in it at the code block size as a code block. In a document whose own font is monospace, nothing is.
- **Line breaks.** The `<br>` a browser leaves at the end of a paragraph, a list item or a table cell shows as nothing and is not written. A line break that does end a paragraph in the RTF (`\line\par`) is read as `<br><br>`, which a browser shows as that empty last line.
- **Page breaks.** `\page` is read as a rule that is shown dashed and written back as `\page`, so a page break in a document that passes through the editor is still one.

### Tables

RTF has no table element: each row says where its cells end (`\cellx`), so columns only line up if every row is written against the same edges. `htmlToRtf` works the columns out once for the table and writes every row against them.

- **`colspan`**: one cell that ends at the right edge of the last column it covers.
- **`rowspan`**: `\clvmgf` on the cell where it starts and an empty `\clvmrg` cell in the same columns of each row below. `rowspan="0"` reaches the last row, and no span reaches past the table.
- **Column widths** come from the cells' own `width`, or else from `<col>` and `<colgroup>`. A cell across several columns gives what it has left to those of them with no width; columns with none share what remains. Widths given as lengths (`120px`, `90pt`, the bare `width="120"` of a pasted table) keep the columns in proportion; beside percentages they count only where the table's own width is a length to measure them against. The table is written 6 in wide.
- **`<caption>`** is written as a centered paragraph before the table, where a browser shows it, and is read back as that paragraph.
- **A column no cell starts in is not a column.** `colspan="100"` on a cell meant to cross the whole table adds none.
- **A row short of cells** is filled with empty ones, so its edges are the table's.
- **Borders.** A cell's own borders are written, each side by itself: `border: 1px solid` is `\clbrdrt\brdrs\brdrw15` and the same for `l`, `b` and `r`. The line is `solid`, `double`, `dotted` or `dashed` (any other that draws one is a plain line), the width is in twentieths of a point up to the 3.75 pt RTF allows, and a color other than black is written by its place in the color table (`\brdrcf`). `rtfToHtml` reads them back as `border:1px solid` where the four sides are one, else as `border-top`, `border-right`, and so on. A border set on the `<table>` or by a style sheet is not a cell's own, and is not written.
- **Insert table.** The toolbar's table button asks for rows and columns (up to 50 by 12), whether the cells have borders, and whether the first row is a header, and puts the table after the paragraph the caret is in. `insertTable(rows, columns, { borders, header })` does the same from code. A table with no borders has none in the RTF; while it is edited its cells are drawn with a faint dashed line, which is not in `getHTML()` or the RTF. Adding and removing rows and columns is not there yet.
- **`<th>`** with no borders of its own gets a bottom border, on that cell only, which is how `rtfToHtml` knows a header cell: a bare `\clbrdrb\brdrs` and no border on any other side. A header cell that has borders is written with those, and marked in what it holds by `{\*\inkth}`, a group other readers skip: Word and TextEdit put a border on every cell of a gridded table, so a border cannot say which cells are headers there. A bottom border with a width or a color (`\brdrw`, `\brdrcf`), which is how Word and TextEdit write a line someone drew under a cell, is not a header: a signature line stays an ordinary cell.
- **Each cell ends with `\cell` inside its group**, with no `\par` before it, and the last row of a table carries `\lastrow`. Through 1.9.0 a cell ended `\par}\cell`, which Apple's reader (TextEdit, Pages, Mail) showed as an empty second paragraph in every cell, and two tables with nothing between them were read back as one. `rtfToHtml` reads both shapes.
- **`<thead>` and `<tfoot>`** are written first and last, wherever the source has them.
- **A cell's `text-align`** is written on its paragraphs (`\qc`, `\qr`, `\qj`), and read back onto the cell.
- **A table inside a table cell** is written as lines of text in that cell: each of its rows a paragraph, its cells a tab apart. RTF can nest tables, but many readers show a nested table wrongly or not at all; every word is kept, the inner grid is not. `rtfToHtml` reads a nested table Word wrote the same way.
- **Reading.** `\clvmgf` and `\clvmrg` become `rowspan`; a cell that crosses the column edges of other rows gets `colspan` (as do `\clmgf` and `\clmrg`). Each paragraph in a cell is a line in it. Widths are read to a hundredth of a percent, so a column edge is written back where it was.

### Reading RTF from other programs

- `\'xx` is read as Windows-1252, the code page RTF is written in: `\'92`, the apostrophe TextEdit writes, is `’`, not an invisible control character. Other code pages (`\ansicpg1251`, `\mac`) are still read as Windows-1252.
- Word writes each table row's definition twice, before its cells and again before `\row`. Both are read as one row. A row with no definition repeats the one before it.
- `\pard` resets the paragraph, not the characters: bold, italic, underline and strikethrough carry on until `\plain` or their own `\b0`.
- `\sect` ends a paragraph, as `\par` does.
- A font table is read in both shapes: one group per font, and TextEdit's run of fonts with no groups.
- **Alignment** (`\qc`, `\qr`, `\qj`) holds until `\pard`, as an indent does: Word and TextEdit state it once for a run of centered paragraphs or right-aligned cells. It ends with the group it was set in, and with the row.
- **Tracked changes.** Text a tracked change deleted (`\deleted`) is not shown; what replaced it is. Shown, "malignant" struck out and "benign" put in read "malignantbenign".
- **Hidden text** (`\v`) is not shown, and neither are index and contents entries (`\xe`, `\tc`), nor a footnote that sits in hidden or deleted text.
- **The Symbol font.** Text set in a font named Symbol is read as the characters that font shows: `m` is μ, `\'b0` is °, `\'b3` is ≥. So is the U+F0xx form Word writes, and a `SYMBOL` field (Insert Symbol in Word). Other symbol fonts (Wingdings) are not mapped.
- **Footnotes and endnotes** go to the end of the document, each after the number the text refers to it by; the sentence the note sits in is not split.
- **Text boxes** are read as paragraphs after the paragraph, or the table, they are anchored in. A picture with text wrapped around it is shown where it is anchored, and an embedded object as the picture or text it carries to be shown.
- **Binary picture data** (`\binN`) is stepped over; a brace among its bytes no longer ends the document. The picture itself is not shown.
- **U+2028**, which TextEdit writes for Shift-Return, is a line break, and U+2029 a paragraph mark. **A tab character** in the file is a tab, as `\tab` is: TextEdit writes every tab that way. Any other control character is dropped, written as itself or as an escape.
- **`\lastrow`** ends a table, so a table that follows another with no paragraph between is a table of its own.
- A byte-order mark or blank lines before `{\rtf1` do not hide the color and font tables.
- Damaged input does not stop a document being read: a `\'` with no hex digits after it, a `\u` out of range, half of a surrogate pair, a color component outside 0 to 255, groups nested tens of thousands deep, `\intbl` with no `\row`, a table row the file ends in the middle of.

### Writing HTML that was pasted

The editor's own buttons make a small set of elements. A paste brings more, and `htmlToRtf` writes what the screen shows of it:

- **Formatting set by a style.** `font-weight`, `font-style`, `text-decoration` and `vertical-align` on an element are bold, italic, underline, strikethrough, superscript and subscript, which is how Google Docs writes all of them. A style can also take formatting off: Docs wraps a paste in `<b style="font-weight:normal">`, which is not bold. `color` is written on a heading, a list item and a table cell as it is on a paragraph.
- **What is not shown is not written:** `<style>`, `<script>` and `<template>`, an element with `hidden`, `display:none` or `visibility:hidden`, and Word's hidden text (`mso-hide:all`).
- **Blocks of a web page** (`<section>`, `<article>`, `<header>`, `<footer>`, `<main>`, `<aside>`, `<nav>`, `<address>`, `<details>`, `<summary>`, `<dl>`, `<dt>`, `<dd>`, `<center>`, `<fieldset>`, `<form>`) are written as a `<div>` is: each ends its line.
- **Alignment on a block around others** (`<div style="text-align:center">`, `<center>`) is the alignment of the paragraphs, headings and table cells inside it that set none. A list inside it is written left-aligned, so that it is still read back as a list.
- **`white-space: pre-wrap`** (also `pre`, `pre-line`, `break-spaces`): a new line in the text is a line break.
- **A figure with more than its picture** (text typed beside the picture, a second picture) is written as everything it holds, then its caption. The editor's own figure, one picture and a caption, is written as before.
- **A picture that cannot be embedded** is written as `[Image: description]`, or its address, and never as its data.
- **Control characters** are not written: a vertical tab or form feed becomes a space, the rest are dropped. 0x0B and 0x1C are among them, the bytes that start and end an HL7 message on the wire.
- **Loose text after a table** starts a plain paragraph of its own.

### What `rtfToHtml` may return

`RtfViewer` puts the HTML `rtfToHtml` returns into the page as it is, so that HTML is limited to a fixed set, whatever the file holds: the elements `p`, `br`, `strong`, `em`, `u`, `s`, `sup`, `sub`, `span`, `code`, `pre`, `h1` to `h3`, `hr`, `ul`, `ol`, `li`, `a`, `table`, `tr`, `td`, `th`, `figure`, `figcaption` and `img`, and the attributes `style` (built from numbers and fixed words only), `href` (a web, mail or phone address, escaped), `target` and `rel` (fixed), `start`, `colspan` and `rowspan` (digits), and on a picture `src` (a PNG or JPEG data URL) and `alt`. Text from the file is always escaped. The test suite checks this against hostile files.

### Size limit on import

`rtfToHtml` parses a document in one go on the main thread, and a picture costs two characters per byte, so the only bound on how long a page stops responding is the size of what it is handed. A string longer than `maxBytes` (`DEFAULT_MAX_RTF_BYTES`, 50 MB) is refused with a `RangeError` before any of it is parsed; `readRtfFile` rejects a larger file without reading it, and the editor's import shows that message; `RtfViewer` shows it in place of the document. Pass `maxBytes: 0` to read a document of any size, or a smaller number to refuse sooner; the components take the same number as `maxRtfBytes`. Where reports can carry large pictures, raise it: a 30 MB picture is a document of over 60 MB.

Size is not the only way to exhaust a page: a file of nothing but braces is small and still costs memory for each one. A document of more than five million parts (groups, control words, runs of text) is refused with a `RangeError` too, whatever `maxBytes` is. A long Word document has some hundreds of thousands; a picture is one for each line of the file its data takes up.

### Markdown export

`htmlToMarkdown` writes a table as a Markdown table (a merged cell where it starts, with the cells it covers left empty, since Markdown has none), a numbered list from its `start` (an item with a number of its own, `<li value="7">`, and a numbered list right after another, are written with the other mark, `7)`: Markdown counts on from a list's first number whatever the numbers after it say, and the other mark is what starts a new list at its own number), a list numbered in letters or Roman numerals as bullets that begin with their marker (`- B. Right breast, biopsy`: Markdown numbers in digits only), and `<h4>` to `<h6>` as headings. Characters that Markdown would read as markup are escaped in text (`*`, `_`, `` ` ``, `#`, `[`, `]`, `<`, `~`, `\` and `|`), and so are `-`, `+`, `>` and `1.` at the start of a line: a report line typed as `- Benign.` stays that line. A link with an address `isSafeLinkUrl` refuses is written as its text alone.

A line break in a paragraph is a hard break (two spaces before the new line; a `<br>` in a heading or a table cell, which are one line). Text typed before a block is a paragraph of its own, and so is each `<div>`, `<section>`, `<dt>` and `<dd>`. A quotation of several paragraphs, or one holding a code block, carries its `>` on every line. A list written straight inside a list is nested under the item before it. Bold with a space inside the tag (`<b>diagnosis </b>`) is written with the space outside the marks, and `<b style="font-weight:normal">` is not bold. `<sup>`, `<sub>`, `<u>` and `<ins>` are written as those tags, which Markdown allows, and `<del>` as `~~`. A table's `<caption>` is a line before the table; a figure writes everything it holds, then its caption. `&copy;` typed as text stays those characters, and a line of `---` or `===` is escaped so that it is not a rule or a heading. What the screen does not show (`<style>`, `<script>`, `hidden`, `display:none`, `visibility:hidden`, `mso-hide:all`) is not written.

Code is the one thing written as it is, so it has to stay inside its code span or its fenced block. A line break in a code span is written as a space, which is how Markdown shows one; a code block starts a line of its own, whatever element is around it (in a heading or a table cell, which are one line, it is a code span on that line); every line of a quotation carries its `>`. Underline is the `<u>` tag around the text itself, and so are `<ins>`, `<sup>` and `<sub>`. No tag is ever alone on a line, or first on one after white space, where it would open a block of HTML: an empty line in a paragraph is a `<br>` at the end of the line before it, and a line that holds white space alone is written as `&nbsp;`. A tab at the start of a line is written as `&#9;`, since a tab there makes the line a code block. Code right after code is one code span, because two spans back to back run their backticks together. A `|` is escaped in all text, not only in a table: two typed lines such as `Stain | Result` and `--- | ---` are a table to a viewer that knows tables. A numbered list starts no lower than 0 and ends no higher than 999999999, the numbers Markdown can write. Bold, a link and underline are not written around a code block; around a quotation, a list or a table they are written on the text inside. Markdown allows HTML, and this export keeps a document's text from being read as any, but a page that shows Markdown from more than one source should still use a viewer that does not pass HTML through, or sanitize what the viewer makes.

## Theming

The components use CSS custom properties with sensible fallbacks, so they work out of the box but are easy to customise. Override these in your own CSS:

```css
:root {
  --text:        #2c2520;
  --text-muted:  #8a7e72;
  --surface:     #f2f0ec;
  --border:      #e5e2dc;        /* also the box around the toolbar's lists */
  --border-active: #c4b5a0;      /* that box, and the editor's, under the pointer */
  --bg-select:   transparent;    /* inside the toolbar's lists */
  --bg-toolbar:  #fff;           /* the toolbar; not see-through, the document passes under it */
  --ink-toolbar-top: 0px;        /* where the toolbar stays: the height of a header of yours that stays too */
  --ink:         #1a1714;
  --accent:      #6e56cf;
  --accent-soft: #ede9fe;
  --radius-sm:   5px;
  --transition:  150ms ease;
}
```

### In a page with styles of its own

The editor and the viewer say for themselves how a list is shown: a bullet, a circle and a square by depth, and numbers. A page that takes the markers off its own lists (`ol, ul { list-style: none }`, as Tailwind's base styles and most CSS resets do) does not take them off a document's; through 1.13 a list in such a page was indented lines with nothing in front of them. A list that says its own marker by `list-style-type` keeps it. One that says it by `type="A"` alone is still at the mercy of such a rule: CSS cannot tell `type="A"` from `type="a"` in every browser, so the editor has no rule of its own for it.

---

## Keyboard shortcuts

| Shortcut   | Action            |
|------------|-------------------|
| `Ctrl+B`   | Bold              |
| `Ctrl+I`   | Italic            |
| `Ctrl+U`   | Underline         |
| `Ctrl+K`   | Insert link       |
| `Ctrl+click` / `Cmd+click` | Open the link under the pointer in a new tab |
| `Ctrl+S`   | Save (fires `onsave`) |
| `Backspace` / `Delete` | Remove the selected image |
| `Ctrl+]` / `Cmd+]` | Increase indent of the selected paragraphs by 0.5 in (RTF `\li720` per step) |
| `Ctrl+[` / `Cmd+[` | Decrease indent |
| `Tab`      | Insert a tab (sent to RTF as `\tab`); two spaces in a code block. With several lines selected, increase their indent. At the start of a list item, put the item under the item before it |
| `Shift+Tab` | Remove one tab from the start of the line. With several lines selected, decrease their indent. In an item of a list within a list, take the item out from under the item it is under |
| `Enter` in an empty list item, `Backspace` at the start of one | Take the item out of its list: one list out, then a paragraph |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z`, `Ctrl+Y` | Redo |
| `Esc`, then `Tab` / `Shift+Tab` | Move focus out of the editor |

The toolbar's Increase indent and Decrease indent buttons do the same as `Ctrl+]` and `Ctrl+[`. Each press is one Undo step. In a list they put the selected items under the item before them, and take them out again (see [Lists](#lists)).

Four more toolbar buttons set the other two RTF indents, 0.5 in per press, on a paragraph outside a table cell (not on a list, a heading, a quotation or a code block):

| Button | What moves | RTF per step |
|---|---|---|
| Increase / Decrease hanging indent | Every line but the first; the first line stays where it is | `\li720\fi-720` |
| Increase / Decrease right indent | The right edge of the paragraph | `\ri720` |

Decrease indent stops where the first line of a hanging paragraph reaches the left edge.

**Hang at caret** sets the hanging indent to any distance: put the caret where the later lines should begin, for example after `A. Pancreas: `, and press the button. The first line stays where it starts and the lines after it begin under the caret. With the caret at the start of the line, the hang is taken away. When a tab comes before the caret, the paragraph also gets a tab stop at the new indent (`tab-size` on screen, `data-rtf-tab-stops` for the RTF's `\tx`), so the text after the tab lines up with the lines below it. Tab stops the paragraph already has are kept. It works on a paragraph outside a table cell that is aligned left or justified.

### Copy format

The **Copy format** button gives several paragraphs the same alignment and indents:

1. Press the button. The pointer becomes a crosshair and a bar under the toolbar says what to click.
2. Click the paragraph to copy from. A dashed frame marks it and the pointer becomes a brush.
3. Click each paragraph that should get the format. The one under the pointer is highlighted.

It stays on until **Done** in the bar, `Esc`, or the button again. Each click is one Undo step.

- What is copied is the paragraph's alignment, indent, right indent and hanging indent, with the tab stop Hang at caret sets. Bold, italic, color and size are not.
- A click in the margin beside a paragraph, or in the empty space below the text, does nothing.
- Copying from a plain paragraph clears those from the paragraphs clicked.
- Each block takes what the RTF carries for it: a heading everything but the tab stop, and a heading or paragraph in a table cell the alignment and the indent only. Lists, code blocks and pictures are left alone.
- The frame, the highlight and the bar are not part of the text and never reach `getHTML()` or the RTF.

### Pasted text

A browser copies a paragraph with its looks written out as inline styles, and repeats its `id`. After a paste, each element that came in loses its `id` and any margin or first-line indent that changes nothing on screen, so a copy pasted inside the editor is the same markup as its source. A line the browser makes as a `<div>` is spaced like a `<p>`; both are written to RTF as a paragraph.

A picture copied with its text comes in by address (`<img src="https://…">`). The editor fetches it and holds its data in the document, as it does for an address typed in the image dialog, so it reaches the RTF as a picture. When it cannot be fetched (the site forbids it, there is no network, it takes longer than 15 seconds or is larger than 25 MB) the picture still shows and the editor says that it will export as a placeholder. The pictures in one paste are fetched at the same time, so one slow site does not hold up the others. A picture pasted as data in a format RTF cannot carry (GIF, WebP, SVG), or larger than `maxImageBytes`, is converted and scaled the same way.

A picture copied in Word with its text is another case. Word's HTML names it by a file on the writer's own disk (`file:///…/msohtmlclip/clip_image001.png`), which no page may open, and puts the picture itself in the RTF it copies beside the HTML. The editor reads the pictures from that RTF and gives each image its own, so the picture is on the screen and in the RTF that is written. Through 1.12.0 it was a broken image on the screen and `[Image: description]` in the RTF. Nothing is guessed: unless the RTF has exactly as many pictures as the HTML has images on the disk, none is given, and the paste is as before. A picture Word holds as a metafile (a chart, an old drawing) has no form a browser shows and stays a placeholder. A browser that does not hand a page the RTF of a paste leaves all of them so.

Word also writes that address in an HTML comment, with the name of the writer's account in it. A comment is not shown and not written to the RTF, but it is kept in the HTML that is saved. A browser leaves comments out of a paste; Firefox keeps those of markup that is dropped. So a comment that comes in with a paste or a drop is emptied (`<!---->`); it is not taken out, because Firefox cannot undo a drop from which a node is gone. Comments in the HTML your application gives the editor stay as they are.

A picture pasted as data that cannot be brought under `maxImageBytes`, or that the browser cannot open, is taken out of the paste, and the editor says so. What was only there for it goes with it: its figure and caption, a link around it, a paragraph or list item that held nothing else. Text that shared its paragraph stays, a table cell stays, and so does anything that was in the document before the paste. Chromium, pasting a figure at the end of a line of text, moves its pictures into that line and leaves the caption in a figure of its own (inside the `<div>` or `<section>` the figure came in, if it had one); that caption goes with the picture too, unless another picture pasted with it is still there. Pasting a block into an empty line, Chromium puts the block in the line's place; if nothing of the paste is left once its pictures are out, the empty line is put back, with the caret in it. Pasting a figure into the middle of a line, it turns the caption into ordinary text of that line, and there the caption stays, since it can no longer be told from the words around it. When one paste has a picture left out and another that will export as a placeholder, the message says both.

Paragraph alignment (left, center, right, justify) is written to RTF as `\qc`, `\qr` or `\qj`.

Tab stays in the editor so a line can be indented. To leave the editor from the keyboard, press
`Esc` first. A readonly editor leaves Tab to the browser.

---

## Working with images

Three ways to add a picture:

- **Toolbar** — the image button opens a dialog where you can pick one or several files from disk, or paste an image address
- **Paste** — paste an image straight from the clipboard (a screenshot, for example)
- **Drag and drop** — drop image files anywhere in the editing area; they are inserted where you dropped them

Each picture is inserted as a `<figure>` with a `<figcaption>` under it. Click the caption line and type to describe the image — the description travels with the picture through every export. Insert as many images as a document needs.

Click an image to select it. A frame appears with corner handles you can drag to resize (the aspect ratio is kept and the width is capped at the editor's text width), buttons for 25% / 50% / 100% width, left / centre / right placement, moving it, a shortcut to its description, and a remove button.

### Where a picture is on the page

- **Move up** and **Move down** take the selected picture, with its description, over the block above or below it: a paragraph, a table, another picture.
- **Place beside the picture above** puts the selected picture to the right of the picture before it, each with its own description under it. A third and a fourth can join the row. Pictures too wide for their share of the page are made to fit; after that each is resized and aligned inside its own share, which is also how the distance between two of them is set (the left one aligned right and the right one aligned left are as close as they go).
- **Dragging a picture** with the mouse does the same as the buttons. Dropped on the left or right half of another picture, it is put beside it, in a row, each picture with its own description under it; dropped on a picture of a row, it joins the row there, or changes places in its own row; dropped anywhere else, it is moved there whole, with its description, before or after the block it is dropped on. (Through 1.13 the browser moved the picture alone into the line it was dropped in, inside the other picture's figure, and its description was left behind as an empty line.)
- **Gap** sets an exact distance between the pictures of a row, in points (72 pt = 1 inch), from the field in the frame of any picture in the row. Each picture's cell is then as wide as the picture and the gap is an empty cell between each two, so the distance is the same on the screen, in the RTF (`\cellx` edges, no padding inside a cell) and in Word; the row is as wide as what it holds, not stretched across the page. Pictures too wide for the page together with their gaps are made smaller alike. A picture that joins the row or leaves it keeps the gap; resizing one keeps it too. Left empty, the row shares the page equally again. `rtfToHtml` reads such a row back with the same widths.
- **Place on its own line** takes a picture out of a row, and puts it under the row. Removing a picture from a row closes the row up; the last picture left is on a line of its own again.
- A row of pictures is moved up and down as one.
- **The space above and below a picture** is set from the toolbar's Spacing list while the picture is selected (see [Line and paragraph spacing](#line-and-paragraph-spacing)). A row of pictures has none to set.

In the document a row of pictures is a table of one row with no borders, a `<figure>` in each cell (and, with a gap set, an empty cell between each two), and that is what the RTF holds: a row of cells, each with a picture and its description. Word and other readers show the pictures side by side; `rtfToHtml` reads the row back as it was written. A picture in a row that has no description is read back as the picture alone in its cell, and is given a `<figure>` again when one is typed (the frame's Edit description button). There is no wrapping of text around a picture: RTF can say it, but the systems these documents go to do not show it reliably.

### How images are stored

Images are held inline as base64 data URLs, so a document is self-contained — it auto-saves, exports and re-imports with the pictures intact, and needs no image server.

- **RTF export** writes each picture as a real `\pict` group (`\pngblip` / `\jpegblip`) sized with `\picwgoal` / `\pichgoal`, so it opens with the images in Word and other RTF readers that show pictures. (TextEdit opens the file and shows its text, but does not show the pictures of a plain `.rtf` file.) The description follows as an italic line, tagged with an ignorable `{\*\inkcap}` destination that this library uses to re-attach it to the figure on import; other readers simply skip the tag.
- **RTF import** decodes `\pict` PNG and JPEG data (including pictures wrapped in `{\*\shppict}`) back into images at their stored size. Picture formats a browser cannot display — metafiles and device-dependent bitmaps — are skipped.
- **Formats**: PNG and JPEG are embedded as-is. Anything else (GIF, WebP, SVG, …) is re-encoded to PNG when inserted, since RTF carries no other bitmap types. Animated images keep their first frame. A picture the browser cannot open (a TIFF, a HEIC photograph in most browsers, a damaged file) is not inserted, whatever its size, and the editor says that it could not be opened: it would show as a broken picture, and its data could not be converted for the RTF. That holds for a file, for picture data typed in the dialog and for picture data pasted with text. A picture fetched from an address that cannot be opened keeps its address and exports as the placeholder, as above.
- **Images added by address**, typed in the dialog or pasted with text copied from a web page, are fetched and inlined so they survive export. When the fetch is blocked (CORS or offline) the address is kept and the picture still displays, but it exports as an `[Image: …]` placeholder instead of picture data — the editor says so at insert time rather than letting it go unnoticed until the document is read downstream.
- **Size**: RTF stores picture data as hexadecimal — two characters per byte — so an embedded image costs twice its file size in the document. Resizing an image in the editor changes its display size only; two caps applied at insert time are what bound the payload:
  - `maxImageEdge` (1600 px) scales the picture down so neither edge exceeds it.
  - `maxImageBytes` (512 KB, so roughly 1 MB of document per image) is the ceiling that actually matters, and it is a ceiling: no picture goes into the document over it. A picture over it is re-encoded until it fits:
    1. At full size, then 80%, 64% and 50% of it, a PNG is tried as PNG first so screenshots and diagrams stay sharp, and as JPEG only when it is too heavy *and* has no transparency to lose.
    2. If none of those fits, the picture is made smaller still, each step sized from how far over the last one was, down to 16 px on its longest edge. A picture with transparency is laid on white and written as a JPEG from full size again, which keeps far more of it than a PNG a fraction of the size.
    3. A picture that still does not fit is not inserted, and the editor says so. This takes a limit of a few hundred bytes, or a picture the browser cannot redraw.

    Measured in Chromium with a 6.8 MB, 4000×3000 JPEG dropped on the editor: 312 KB at the defaults, 92 KB at a limit of 100 KB, 14 KB at 20 KB, 4.8 KB at 5 KB, refused at 300 bytes. A 6.9 MB PNG with transparency: a 368 KB JPEG on white at the defaults.

  Set either to `0` to disable it. With `maxImageEdge` at `0` a very large picture can be more than the browser's canvas holds (268 million pixels in Chromium, about 16.7 million in Safari on a phone). A canvas asked for more gives back an empty picture and no error, so such a picture is first brought down to a size the canvas holds, half the area at a time, and the steps above start from there. Both caps are applied by re-encoding through a `<canvas>`, so pictures are only made smaller in a browser. In a runtime without one (SSR, jsdom/happy-dom tests) a picture within `maxImageBytes` is passed through untouched and one over it is refused, since it cannot be made to fit. The caps apply when a picture is inserted: HTML handed to the editor through `content` or `setHTML` is not checked, so do not rely on them to bound a payload assembled elsewhere.
- **Page fit**: a newly inserted picture is displayed at `maxImageDisplayWidth` (624 px) rather than filling the editor. RTF records the display size in twips — 624 px × 15 = 9360 twips = 6.5 in, the text width of a Letter page with 1 in margins — so pictures arrive sized to the page they will be printed or filed on, not to the width of the browser window. Resize handles still go up to the full column width when a picture deserves it.

### Sending RTF over a transport

`htmlToRtf` output is written to survive being carried inside another format — an HL7 `OBX-5` field, a JSON string, a CSV cell:

- **One line.** The document contains no CR or LF anywhere — not in picture data, and not in text either: a newline inside text content is collapsed to the space a browser would have rendered (RTF readers ignore raw CR/LF, so `Hello\nworld` used to render as "Helloworld"). `<pre>` blocks keep their line structure as `\line`.
- **Uppercase hex.** Picture bytes are written as uppercase hex, so a PNG begins with the `89504E470D0A1A0A` signature that receivers commonly match on.
- **Format read from the bytes.** `\pngblip` vs `\jpegblip` is decided by sniffing the image's leading bytes, never by its declared MIME type — an operating system assigns `File.type` from the file extension, so a WebP saved as `.png` claims to be PNG. Bytes that are neither PNG nor JPEG are re-encoded on insert, or exported as a text placeholder rather than as a blip whose declared type contradicts its content.
- **Sized for the pipe.** `maxImageBytes` bounds each picture, and the payload is roughly twice that in hex. Lower it to fit a field-length limit.

Some receivers require the whole field on one unbroken line when it carries an image — that is why the writer emits no line breaks at all, rather than wrapping picture data the way many RTF writers do.

### Knowing how big a document is

The transport cares about the size of the finished RTF, and pictures make that unpredictable. Two ways to read it:

```svelte
<script>
  let editor;
  let size = 0;
</script>

<!-- an estimate on every change, cheap enough for a live indicator -->
<InkEditor bind:this={editor} onchange={({ estimatedRtfBytes }) => (size = estimatedRtfBytes)} />

<!-- the exact figure, when it is time to send -->
<button onclick={() => console.log(editor.getRtfSize())}>Check size</button>
```

`getRtfSize()` does the full conversion — call it when a decision depends on it, not on every keystroke. `estimatedRtfBytes` counts picture data exactly (two characters per byte, which is what dominates) and approximates the rest, never below the real size and, for what the editor itself makes, a few hundred bytes above it at most. (A pasted page of many small elements is counted further above, a few bytes for each.) The editor passes its own `fontFamily` and `fontSize`; calling `estimateRtfBytes` yourself, pass the options you give `htmlToRtf`. The output is ASCII, so bytes and characters are the same number.

The library reports the size and stops there; whether an oversized document may be sent is the host application's decision.

Escaping for the carrying format is the integration layer's job, not the editor's. For HL7 v2 that means escaping the whole string's delimiters — `\` → `\E\`, `|` → `\F\`, `^` → `\S\`, `&` → `\T\`, `~` → `\R\` — because ordinary typed text ("Smith & Jones") reaches the RTF unescaped.

---

## Contributing & releasing

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and changelog generation.

### Making changes

After making code changes, describe them with a changeset:

```bash
npm run changeset
# → interactive prompt: pick patch / minor / major, write a short description
```

Commit both your code and the generated `.changeset/*.md` file together.

### Checks

Four commands must pass before a change is merged, and CI (`.github/workflows/ci.yml`) runs them on every push and pull request:

```bash
npm run check          # svelte-check: types
npm run test:coverage  # vitest, with a floor under the coverage (vite.config.ts)
npm run prepack        # build the package and lint it with publint
npm run test:e2e       # Playwright, in Chromium, Firefox and WebKit (once: npx playwright install chromium firefox webkit)
```

`npm test` runs the same unit tests without measuring coverage. They run in a test DOM, which has no caret, no editing commands and no clipboard; `e2e/` holds what only a browser shows: where the first words typed go, what a key does after a dialog closes, what a real paste brings in. It drives the page at `src/routes/e2e`.

The publish workflow runs the same four before it publishes, so a release cannot go out with a failing test.

`src/lib/__tests__/random-documents.test.ts` builds 400 documents at random on each run and checks what must hold for all of them: no text lost, the RTF settles after one reload, the size estimate is never low, the HTML read back is made of known elements. For a longer run, in batches:

```bash
RTF_RANDOM_DOCUMENTS=4000 RTF_RANDOM_FIRST=4001 npx vitest run random-documents
```

### Publishing a new version

When ready to cut a release:

```bash
# 1. Consume pending changesets — bumps package.json and updates CHANGELOG.md
npm run version

# 2. Commit the version bump
git add .
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git push

# 3. Create a GitHub release — this triggers CI to build and publish to npm
VERSION=$(node -p "require('./package.json').version")
gh release create "v$VERSION" --title "v$VERSION" --generate-notes
```

Requires the [GitHub CLI](https://cli.github.com/) (`brew install gh`, then `gh auth login` once).
The `--generate-notes` flag has GitHub auto-generate release notes from commits since the last tag.

### Version bump rules

| Change type | Bump |
|---|---|
| Bug fix | `patch` — 0.1.0 → 0.1.1 |
| New feature (backwards compatible) | `minor` — 0.1.0 → 0.2.0 |
| Breaking change | `major` — 0.1.0 → 1.0.0 |

### First-time npm publish

The npm Trusted Publisher (OIDC) setup requires the package to exist on npm before it can be configured. For the very first publish, run locally:

```bash
npm login
npm run prepack
npm publish --access public
```

Then go to `npmjs.com/package/svelte-rtf-editor` → **Settings** → **Trusted Publishers** and add the GitHub Actions publisher pointing at this repo's `publish.yml`. All subsequent releases will go through CI automatically.

---

## Local development

Clone this repo and link it to your project for instant iteration without publishing:

```bash
# In svelte-rtf-editor/
npm run prepack   # builds dist/
npm link

# In your project/
npm link svelte-rtf-editor
```

Re-run `npm run prepack` in this repo after any change. When done:

```bash
# In your project/
npm unlink svelte-rtf-editor
npm install svelte-rtf-editor
```

---

## License

MIT
