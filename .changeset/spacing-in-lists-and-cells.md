---
'svelte-rtf-editor': patch
---

**Spacing in a list item and in a table cell**

The Spacing list did nothing in a list item or a table cell: no change, and the list went on
showing 0 pt and Default. Nor was spacing kept there anywhere else: the RTF writer left it out
of list items and table cells, and the reader dropped it from Word's list paragraphs and cells,
so a report with 1.5 lines in its lists came back single-spaced.

- **A list item is spaced** from the Spacing list, `setLineSpacing` and `setParagraphSpacing`:
  the item the caret is in (the innermost, in a list within a list), its style on the `<li>`.
  In the RTF its space before is on its first paragraph, its space after on its last, and its
  line spacing on each, as Word spaces list paragraphs. Read back, a list paragraph's spacing is
  the `<li>`'s style.
- **A paragraph in a table cell is spaced** the same way, and a line typed straight into a cell
  is made a paragraph to carry it. It is written after the paragraph the cell declares
  (`\pard\intbl\sa240 …`). Read back, a cell in which a paragraph is spaced has its paragraphs
  as `<p>`s, each with its own spacing; a cell with none spaced is read as lines, as before.
  A Word table whose cells have Word's default spacing (`\sa160\sl259\slmult1`) now shows it.
- The list shows what the item or the cell's paragraph has.
