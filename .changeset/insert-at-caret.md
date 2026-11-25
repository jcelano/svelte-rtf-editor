---
'svelte-rtf-editor': minor
---

Text and HTML at the caret, from code (issue #56, Part 1). `editor.insertText(text)` puts text in at the caret, or over the selection, as one Undo step of its own; a line break starts a paragraph. `editor.insertFragment(html)` does the same with HTML, made safe first by the rules `setHTML()` and a paste share, and tidied as a paste is: inline content goes into the paragraph at the caret exactly as given, and paragraphs split it as a paste does. Where the editor has lost the keyboard, both go where the caret last was; with no such place, at the end of the document. Nothing to put in, or a read-only editor, changes nothing (`false`, `null`). `insertFragment` returns the fields it put in (always `[]` until fields arrive); the type `FieldInfo` is exported.
