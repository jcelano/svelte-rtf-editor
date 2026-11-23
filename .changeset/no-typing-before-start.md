---
'svelte-rtf-editor': patch
---

On a page rendered on the server, the editing area could be typed in before the editor's script had run, and what was typed was then replaced by the editor's document when it started. The text now cannot be edited until the editor has started (`contenteditable="false"` and `aria-busy="true"` in the server's HTML), so nothing typed is lost.
