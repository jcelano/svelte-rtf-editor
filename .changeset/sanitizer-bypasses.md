---
'svelte-rtf-editor': patch
---

Fixes for what a review of 1.11.0 found: three ways past the sanitizer, one way to stop it, and
two faults in the editor beside them.

**Made safe now**

- **What is dragged in.** Only a paste was made safe. Markup dropped on the editor, from another
  page or from elsewhere in the document, stayed as the browser left it: a block with
  `position: fixed` over the whole page, a `<form>` with its `action`, an `<iframe>`, and all of
  it in `getHTML()` and `onsave`. A drop goes the way a paste does.
- **What Redo puts back.** Undo takes a paste out and Redo puts the browser's own copy of it back,
  with the `<iframe>` the editor had taken out of it. Whatever Undo, Redo, a paste or a drop
  brings into the document that has not been checked is checked.
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
  stop there, with half the document looked at.
- A document that cannot be checked is not shown, and neither is the one before it: the editor is
  left empty and says so. `setHTML()` still throws. Given as `content` or kept as a draft, the
  editor opens; a draft that cannot be shown is said to be so, where it was dropped without a
  word.
- A paste or a drop that cannot be checked is left out.

**Fixed in the editor**

- **Ctrl+S did nothing where `autosave` is off**, which is the default since 1.10.0: the key was
  taken from the browser and `onsave` was never called. It calls `onsave`; a draft is kept only
  where `autosave` is on.
- **Bold, Italic, the lists, the color and the size changed the wrong words** after a link or a
  picture had been put in: the selection kept for the dialog was put back before every command
  from then on, so `Ctrl+B` made the link bold, whatever was selected. The selection in the
  document is the one acted on; the kept one is put back only where the selection has left the
  document (a dialog, a list of the toolbar), and it is the last one that was there.
