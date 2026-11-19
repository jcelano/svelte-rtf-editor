---
'svelte-rtf-editor': minor
---

Clear formatting does what it says, and the same in every browser.

The toolbar had the button, at the end, after Undo and Redo, and it ran the browser's own
command. What that command does depends on the browser:

- Chromium and Safari took a paragraph's alignment and its first-line indent with its color.
- Firefox left a color or a size written on a paragraph or a table cell where it was, and took
  out the element an application's mark is on (`keepAttributes`, `keepClasses`).
- Safari left a size where it was, and took out the element that keeps a tab a tab.

Now:

- Bold, italic, underline, strikethrough, color, highlight, size, font, superscript, subscript and
  inline code are taken off the selected text, wherever they are written: on a `<b>` or a
  `<font>`, or as a style on a paragraph, a table cell or a pasted `<span>`.
- Headings, lists, links, tables and a cell's shading, pictures, alignment, indents, tabs and the
  application's marks stay.
- The HTML that results is the same in Chromium, Firefox and Safari.
- Undo puts the formatting back and Redo takes it off again, with the keys and with the toolbar's
  buttons, also after more has been typed and undone.
- `editor.clearFormatting()` does it from an application's own toolbar.
- The button is next to the text color, with the other formatting of text.

Known limits: in Firefox, the words inside an element that carries an application's mark keep
the bold or italic they have there, because its command cannot clear them without cutting the
mark in two (the mark itself stays whole in all three). In Safari one Undo after Clear formatting
may take back the step before it as well; no text is lost.
