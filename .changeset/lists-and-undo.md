---
'svelte-rtf-editor': minor
---

**Lists and Undo are the editor's own**

In 1.13.0 the list buttons and Undo did what each browser's own commands do, and that was
neither the same from browser to browser nor right in any of them.

**Lists**

- **A list is made the same in Chrome, Edge, Safari and Firefox.** Chromium and Safari left
  the list inside the paragraph it was made from, which no HTML can say: kept and shown again
  it was an empty paragraph, the list and another empty paragraph, and an empty line before
  and after the list in the RTF. Firefox started a new list for every line made an item one
  at a time, so each was numbered 1. Chromium put the caret at the start of the line, and
  what was typed next came before the words. The editor now makes the list itself: a `<ul>`
  or `<ol>` beside the paragraphs around it, one list with a list of its kind it is next to,
  the caret where it was.
- **A list taken off is a paragraph for each item.** It was one paragraph with line breaks,
  or words in no paragraph at all.
- **A paragraph made an item, and back, is the same paragraph.** Its `id`, `class`, an
  application's `data-*` attributes, its language and the color or font of its words go with
  it. How it was laid out (indent, alignment, spacing, tab stops) does not: an item has the
  list's.
- **The other list button changes the whole list** the caret is in, bullets to numbers or
  back. It made the one item a list of its own, between two lists of what was left.
- **A list within a list.** `Tab` at the start of an item, or Increase indent, puts the item
  under the item before it; `Shift+Tab` or Decrease indent takes it out. The RTF has it one
  step further in (`\li1440`), and it is read back as a list inside the item.
- **`Enter` in an empty item and `Backspace` at the start of an item leave the list**, one
  list at a time. (Backspace did nothing in the first item of a list in Chromium.)
- **A heading made an item is an item**, not a heading with a list inside it.
- **Bullets and numbers show in a page that takes them off its own lists.** A page with
  `ol, ul { list-style: none }` (Tailwind's base styles, most CSS resets) took the markers off
  the lists of a document too, in the editor and in `RtfViewer`. Both now say the markers
  themselves.
- **The list buttons show which kind of list the caret is in**, as Bold shows bold.

**Undo and Redo**

- **Undo takes back whatever changed the document, in the order it was done.** The browser's
  history knew nothing of what the editor changes itself: a picture or a table put in, a
  picture moved, placed beside another or resized, an indent, a spacing. Its Undo went past
  those and took back the typing before them, and after some of them could undo nothing. The
  editor now keeps the history: `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`, the toolbar and the
  browser's Edit menu all go through it.
- **`editor.undo()` and `editor.redo()`**, for an application's own toolbar. Each returns
  whether there was a step.
- **A new document starts a new history.** After `setHTML()`, `clear()` or an imported file,
  Undo does not lead back into the document that was there before.
- **In Firefox, Undo takes back a paste the editor took something out of** (a button, words
  Word had hidden). Firefox's own Undo did not.
- A run of typing is one step until a pause of a second, a move of the caret, or a change from
  typing to deleting. 200 steps are kept, each embedded picture once.
- **Words dragged from one place in the document to another are one step**: one Undo puts
  them back where they were.
- **What an input method composes (Japanese, Chinese, Korean, dictation) is one step**, and
  Undo waits until it is done.

A block a browser leaves inside a paragraph (Firefox, for pasted paragraphs) is now put beside
the paragraph in the document being edited, not only in the HTML handed out.

**Pictures side by side**

- **An exact gap between pictures side by side.** The frame of a picture in a row has a Gap
  field, in points. The pictures are then that far apart on the screen, in the RTF and in Word,
  and read back the same; before, the distance followed from how wide the page was, and could
  only be changed by resizing and aligning each picture in its half. Left empty, the row shares
  the page equally, as before.
- **A picture dragged onto another is put beside it**, each with its own description under it,
  as Place beside does. Dragged anywhere else, it is moved there whole. The browser used to
  put the picture inside the other picture's figure, and both descriptions ended up under the
  two pictures at the left.
