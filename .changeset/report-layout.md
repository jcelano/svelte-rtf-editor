---
'svelte-rtf-editor': minor
---

**The layout of a report: spacing, tables with borders, pictures side by side**

- **Line spacing and the space before and after a paragraph.** The toolbar has a Spacing list:
  1, 1.15, 1.5 or 2 lines, and 0, 6 or 12 pt before and after the paragraphs the selection
  touches (a heading and a selected picture too). `setLineSpacing(lines)` and
  `setParagraphSpacing({ before, after })` take any value. They are written as `\sl…\slmult`,
  `\sb` and `\sa`, and `rtfToHtml` now reads all three back; until now `\sb` and `\sa` were
  written for a paragraph that had them and lost when the RTF was read. Each change is a step
  for Undo, and Copy format carries a paragraph's spacing.
- **Tables with borders.** A cell's own borders are written to the RTF (`\clbrdrt\brdrs\brdrw15`,
  with the line, the width and the color of each side) and read back; a table had none in the
  RTF whatever it had on the page. The toolbar has an Insert table button (rows, columns,
  borders or none, a header row), and `insertTable(rows, columns, options)` does the same from
  code. A header cell that has borders is marked by `{\*\inkth}` in what it holds; one with
  none keeps the bare line under it. Rows and columns cannot be added or removed yet.
- **Pictures.** The frame of a selected picture has Move up and Move down, and Place beside the
  picture above: two to four pictures in a row, each with its own description. In the document
  and in the RTF the row is a table of one row with no borders; `rtfToHtml` reads a picture
  and its description in a cell back as the figure it was.
- **A picture has no space of its own around it** in the editor and in `RtfViewer`, as it has
  none in the RTF: it was drawn with 20 px (16 px in the viewer) above and below that no
  reader of the RTF showed, and in which a space that was set could not be seen. Documents
  are not changed; pictures sit closer to the text around them on screen until a space is set.
- A line someone drew under a cell (`\clbrdrb\brdrs\brdrw10`, a signature line) is now shown,
  as a cell's border, where it was read and dropped.
- The frame's Align left no longer takes a picture's indent and spacing off with its alignment,
  the frame's alignment buttons show the alignment a click has just set, and its buttons stay
  on the page for a small picture at the edge.
- Two tests that time the reader allow for a slow machine (8 s, where the code they guard
  against took 12 s and more).
