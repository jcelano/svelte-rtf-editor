---
'svelte-rtf-editor': patch
---

**A picture copied in Word with its text is pasted as the picture**

Word names a copied picture in its HTML by a file on the writer's own disk, which no page may
open: pasted with text, the picture was a broken image on the screen and `[Image: description]`
in the RTF. Word puts the picture itself in the RTF it copies beside the HTML, and the editor now
reads it from there, for a paste and for a drop, and gives each image its own. It then goes
through the same steps as any pasted picture (`maxImageEdge`, `maxImageBytes`).

Nothing is guessed: unless the RTF has exactly as many pictures as the HTML has images on the
disk, none is given and the paste is as before. A metafile, which no browser shows, stays a
placeholder.

**A comment that comes in with a paste or a drop is emptied**

Word writes the address of each copied picture in an HTML comment: a file on the writer's own
disk, with the name of the writer's account in it. A browser leaves comments out of a paste, but
Firefox keeps those of markup that is dropped, and they were saved with the HTML (never in the
RTF). A comment that comes in is now emptied. Comments in the application's own HTML stay.

**Clear formatting on a very long selection** is slow, and the README now says how slow: the time
is the browser's own command (three seconds for 1,000 formatted paragraphs in Chromium). It is not
changed here.
