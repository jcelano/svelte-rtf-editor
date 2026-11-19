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

Without `fonts` there is no font list, the writer writes one font and the reader gives none, as
before.

**Changed: an editor that offers no fonts lets none in**

The font of pasted text used to stay on the screen and was never written to the RTF: text pasted
from Word showed in Calibri and was sent in the document font. The editor now takes fonts off
HTML that is set or pasted, unless they are in `fonts`, so that the screen shows what the RTF
has. An application that uses the editor for its HTML and wants pasted fonts kept names them in
`fonts`. `sanitizeHtml` called without `fonts` is unchanged; `sanitizeHtml(html, { fonts: [] })`
takes every font off but the document's.

**The toolbar stays in sight of a long document**

The editing area grows with the document, and the toolbar used to leave the window with the
top of it: at the end of a long report there was no toolbar to use. It now stays at the top of
the window, or of the scrolling element the editor is in, and a caret moved up with the keys is
not left under it. New prop `stickyToolbar` (default `true`; `false` is the behaviour through
1.12.0) and CSS variable `--ink-toolbar-top`, for a page with a header of its own that stays.
The toolbar's ground is now white where `--bg-toolbar` is not set; it was see-through.

**A link opens on Ctrl+click (Cmd+click on a Mac)**

A click on a link in the editor puts the caret in it, and until now only the browser's own menu
opened it. A click with Ctrl or Cmd opens it in a new tab, as in Word, and the pointer over a
link shows a note with the address and how to open it. The note is not in the HTML or the RTF.
With `readonly`, a plain click opens the link in a new tab; it used to open in place of the page.

**The toolbar's lists are boxes one can see**

The lists of paragraph kinds, fonts and sizes have a rounded border, so a list that shows nothing
is still there to be chosen from. A list shows nothing where the selected text is in more than one
font, or more than one size, as in Word: this is now so for a font or size anywhere in the
selection, and not only at its two ends. New theme variable `--bg-select` (default transparent);
the border is `--border`, and `--border-active` under the pointer.

**A stand-in for a font the screen does not have**

`fontFamily` may be a CSS list: `fontFamily="Segoe UI, Selawik, sans-serif"`. The first family is
the font, as before: the one the RTF names. The rest of the list is now given to the screen, for
where that font is missing; it was ignored. A Mac has no Segoe UI and showed such a document in
Helvetica; with a stand-in font the page loads itself, it shows one with the same letter widths.
The README has the stylesheet for it and the stand-ins for the usual fonts. A list that does not
end in a generic family is given one, and the package itself still loads no fonts.

An application that passed a list and relied on only the first family being used on screen now
gets the whole list there.

Known limit: text set in a monospace font that is offered is written in that font, and read back
as code.
