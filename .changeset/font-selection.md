---
'svelte-rtf-editor': minor
---

Fonts for selected text, from a list the application gives.

A document had one font. With `fonts`, the editor's toolbar has a font list, and words can be set
in any font on it:

```svelte
<InkEditor fonts={['Georgia', 'Calibri, Carlito, sans-serif', 'Arial']} />
```

- The list is the limit: a font that is not on it is not offered, is taken off HTML that is set
  or pasted, is not written to the RTF and is not read back from one. An application names the
  fonts its receiving system has, or the ones its page loads itself.
- An entry is a font name, or a CSS list whose first family is the name; the rest of the list is
  what a screen without the font shows. A name alone is given the generic family that suits it.
- The RTF's font table has one more entry for each font the document has text in.
- `editor.setFont(name)` sets a font from an application's own toolbar; `''` sets text back to
  the document font.
- `RtfViewer`, `htmlToRtf`, `rtfToHtml` and `sanitizeHtml` take the same `fonts`. `rtfToHtml` and
  `sanitizeHtml` also take `fontFamily`, the document font, which text may always name.
- RTF from other programs is read the same way, also where a font table names each cut of a font
  as TextEdit does (`TimesNewRomanPS-BoldMT`).
- A change of font is the browser's own command: Undo and Redo treat it as any other change, in
  Chromium, Firefox and Safari. Clear formatting takes a font off.

Without `fonts` nothing changes: there is no font list, the writer writes one font and the
reader gives none.

Known limit: text set in a monospace font that is offered is written in that font, and read back
as code.
