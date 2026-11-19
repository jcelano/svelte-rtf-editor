---
'svelte-rtf-editor': patch
---

**A paste or a drop that holds a frame is made safe before it is put in the page**

Not in any release: found by a review of `main` before 1.13.0 went out.

A paste that holds an `<iframe>` is put in by the editor itself, without the frame, so that
Safari keeps what it could undo. Only the frames were taken out first, and the rest was made safe
once it was in the page. A browser's own paste takes the handlers off what it pastes; the command
the editor inserts with does not, and a handler runs as soon as its element is in the page. So a
page one copied from could run script in the application, by having a frame in the copy: the
`onerror` of a `<video>`, a `<source>`, an `<audio>` or an `<svg><image>` ran. The whole of such a
paste is now made safe in a document of its own, as HTML from anywhere else is, before any of it
is inserted. A paste with no frame was the browser's own all along, and was not affected.
