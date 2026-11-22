---
'svelte-rtf-editor': minor
---

**The gap between a list's bullets or numbers and its text**

Every list was written with its text a quarter inch after its marker, and on the screen the
browser put the marker where it liked. A list from Word hung by any other distance was not read
as a list at all: its paragraphs came back with the marker typed in front.

- **Set it** from the Spacing list (Bullet or number gap: 9, 18, 27 or 36 pt, or Default), or
  with `setListMarkerGap(points)`, 6 to 144 pt, `null` to take it off. It is Word's text indent:
  the marker stays where it is and the text moves. One step for Undo.
- **In the HTML** it is the list's own `padding-left`. A list without one is shown and written
  exactly as before.
- **On the screen** the editor draws the bullets and numbers of such a list itself, at the
  list's edge, the gap before the text, numbered as the RTF is (an item's own `value` too, which
  Chromium's own count misses). The markers are for the screen only: `getHTML()` and the rest
  do not hand them out.
- **In the RTF** each item hangs by the gap (27 pt is `\li900\fi-540`). `rtfToHtml` reads a list
  hung by any gap from 6 to 144 pt as a list with that gap, Word's own lists hung by 0.2 in
  among them; through 1.14 those were paragraphs with their markers typed in. A lettered line
  hung that way (`A.`, a tab, the specimen, hung by half an inch) is now a lettered list item.
