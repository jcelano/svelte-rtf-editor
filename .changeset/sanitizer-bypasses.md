---
'svelte-rtf-editor': patch
---

Fixes for what a review of 1.11.0 found: three ways past the sanitizer, one way to stop it, and
two faults in the editor beside them.

**Made safe now**

- **What is dragged in.** Only a paste was made safe. Markup dropped on the editor, from another
  page or from elsewhere in the document, stayed as the browser left it: a block with
  `position: fixed` over the whole page, a `<form>` with its `action`, an `<iframe>`, and all of
  it in `getHTML()` and `onsave`. A drop goes the way a paste does: Word's hidden text dragged
  in is not shown as words either.
  - An element dragged from one place in the document to another keeps its `id`, unless
    another element has the same one (the drag was a copy). Only what comes from outside
    loses it.
- **What Redo puts back.** Undo takes a paste out and Redo puts the browser's own copy of it back:
  the `<iframe>` the editor had taken out of it, and, on the elements that stayed, the style the
  editor had taken off them (Chromium writes a pasted element's style itself, and Redo writes
  it again: `position: fixed` was back on an element already made safe). After Undo or Redo the
  whole document is checked, as it is when it is first shown.
  - The words left where a button or a text box was taken out of a paste were in the document
    a second time after Undo and Redo, and a third after the next. They are there once. In
    Safari too, which forgot between Undo and Redo which element they were the words of.
  - Undo of such a paste left those words in the document, words of a paste that had been
    taken back. They go with the paste, where it brought at least one element that stayed, and
    Redo puts them back once. (Firefox does not undo a paste the editor has changed; that is
    as it was.)
  - Word's hidden text, taken out of a paste, was shown again after Undo and Redo. It is taken
    out again.
  - The margins a paste of the document's own paragraphs is tidied of
    (`margin: 0px 0px 0.2em 48px`) came back with Redo. They are taken off again.
- **An element named `<constructor>`.** The tables the sanitizer and the writer look tags, colors
  and units up in were objects, which also answer to the names every object has. An element
  named `constructor` with a `data-` attribute stopped the sanitizer where it stood
  (`own?.includes is not a function`):
  - given as `content`, the editor did not open;
  - given to `setHTML()`, the call threw and the document before it stayed on the screen;
  - in a paste, nothing after it was made safe, and an `<iframe>` and a `position: fixed` block
    went into the document;
  - `<font color="constructor">` was written to the color table as
    `\redundefined\greenundefined\blueundefined`;
  - `estimateRtfBytes` returned the text `"214function Object() { [native code] }"`, which is not
    over any size limit it is compared with.

  The tables are Maps. The estimate is a number whatever the elements are named.

**If the check itself fails**

- An element the sanitizer cannot check is taken out and the rest is still checked; it used to
  stop there, with half the document looked at. The editor says that a part was left out.
- A document that cannot be checked is not shown, and neither is the one before it: the editor is
  left empty and says so. `setHTML()` still throws. Given as `content` or kept as a draft, the
  editor opens; a draft that cannot be shown is said to be so, where it was dropped without a
  word. The draft of the document before it is dropped as well: opened again, the editor
  showed that one.
- If the document cannot be checked after Undo or Redo, the editor is left empty in the same
  way, and the draft stays as it was last kept: it is not written over with the empty document.
- A paste or a drop that cannot be checked is left out.

**Fixed in the editor**

- **Ctrl+S did nothing where `autosave` is off**, which is the default since 1.10.0: the key was
  taken from the browser and `onsave` was never called. It calls `onsave`; a draft is kept only
  where `autosave` is on.
- **Bold, Italic, the lists, the color and the size changed the wrong words** after a link or a
  picture had been put in: the selection kept for the dialog was put back before every command
  from then on, so `Ctrl+B` made the link bold, whatever was selected. The selection in the
  document is the one acted on; the kept one is put back only where the selection has left the
  document (a dialog, a list of the toolbar), and it is the last one that was there. That holds
  for the link and picture dialogs too: opened from the toolbar while words of the page around
  the editor were selected, the link went to the top of the document as its own address. And a
  dialog keeps the selection it was opened on apart from that one, so a picture still goes in
  where the caret was: read after the dialog had closed, it would have gone in after the first
  paragraph.
- **Text copied in Word was pasted as a picture of it** in Chrome and Edge. Word puts a
  picture of the copied text on the clipboard beside the text, Chromium hands a paste both, and
  the editor took the picture: the words could not be edited and did not reach the RTF as text.
  Where a paste has words, the words are pasted. A picture copied by itself is still a picture.
- **An RTF file that could not be shown** left the editor empty without `onchange`: the
  application went on holding the document before it. `onchange` is fired.
