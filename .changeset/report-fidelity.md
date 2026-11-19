---
'svelte-rtf-editor': patch
---

Three findings of an outside review of 1.12.0.

**Words that needed their background can be read**

A background is not written to the RTF, and shading in an RTF is not shown. A Word table with a
dark header row and white header text looked right in the editor and was written white on white:
the header of a results table was in the report and could not be seen. A sentence copied from a
page with a dark theme was written at a contrast of 1.18. A text color that can be read on its
background and not on white is now left out, by `htmlToRtf` and by `rtfToHtml`, and the words are
in the reader's own color. A color that can be read on white, and a light color with no
background behind it, are written as before, and a document with no backgrounds is the same RTF
byte for byte. `sanitizeHtml` keeps the `bgcolor` of older pages and mail as the background it
stands for, so that the screen shows it and the writer knows of it.

**Lettered lists are written with their letters**

A list numbered A, B, C (`type="A"`, `a`, `I`, `i`, or `list-style-type`, on the list or on each
item) showed letters in the editor and was written 1, 2, 3 to the RTF and the Markdown: "see part
B" pointed at an item labelled "2.". The RTF now carries the marker the screen shows, counted from
the list's `start` and an item's `value`, and such a list is read back as `<ol type="A">`.
Markdown, which numbers in digits only, carries the marker as the first words of a bullet
(`- B. Right breast, biopsy`). A numbered list is written as before.

**Firefox and Safari are tested, not only named**

The browser tests run in Chromium, Firefox and WebKit, locally (`npm run test:e2e`) and in CI.
Running them there found three faults, now fixed:

- Firefox: after a paste of text that Word hides entirely, the caret was left inside the hidden
  element, and what was typed next was not seen and not written.
- Firefox: Word's hidden words stayed in the document (undisplayed) where the paste carried a
  style sheet, as a copy made in Word does.
- Safari: Tab in the link and picture dialogs went from the last field out of the dialog, past its
  buttons, into the page behind it. Tab now goes round the dialog in every browser.

Three tests that paste Word's hidden text and a text box are skipped in WebKit, which rewrites
the HTML a script puts on the clipboard before it is pasted; a copy made in Word itself is checked
by hand there. In Firefox a paste of
whole paragraphs into an empty line leaves that line after them, which is the browser's own paste.
