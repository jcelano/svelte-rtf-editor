---
'svelte-rtf-editor': patch
---

**Four findings of a review of 1.14.0**

- **A pasted line height no longer cuts a picture off in the RTF.** Words copied from a web
  page come with that page's line height (`line-height: 14px`), and 1.14.0 wrote a length as
  lines of exactly that height (`\sl-210\slmult0`). Word and LibreOffice cut such a line off
  at its height: a picture pasted with the words was whole in the editor and a strip in the
  RTF, and text taller than the line lost its top. A paragraph that holds a picture is now
  written with a height its lines have at least (`\sl210\slmult0`), and a height the
  paragraph's tallest text does not fit in is not written at all. A height the text fits in
  is written exactly, as before.
- **An item taken out from under another stays where it is in the document.** Shift+Tab,
  Backspace at the start of an item, Outdent and the list button put the item after the item
  it was under, and left behind whatever that item held after the list: a second list (bullets
  and then numbers, which the list buttons make) or a paragraph (as Word pastes an item). The
  item was then below lines that had followed it, on the screen and in the RTF. What followed
  it is now under it.
- **Lines are not printed over each other.** A line height had no least value: `\sl-20` in a
  file, `line-height:0` or `1px` in a paste and `setLineSpacing(0.05)` all put the lines of a
  paragraph on top of each other, and the next paragraph on both. Lines closer than 0.8 of the
  height of their text are not read from an RTF, not kept by `sanitizeHtml`, not written, and
  not set by `setLineSpacing`.
- **`estimateRtfBytes` counts the colors of a cell's borders.** It is never below the real
  size, and was, by up to 25 bytes for each border color.
