---
'svelte-rtf-editor': minor
---

A right-click font menu. With the new `fontMenu` prop, a right-click on the text opens the editor's own menu of `fonts` (the document font first, each shown in its own font, the font of the selection checked) in place of the browser's menu. Choosing one sets the font of the selected text, exactly as the toolbar's font list does, and Undo takes it off. Shift + right-click, and a right-click on a link or a picture, still open the browser's menu. The menu key and Shift+F10 open it at the caret, and the arrow keys, Home, End, Enter, Space, Escape and Tab work in it. Off by default; nothing changes without `fonts` or when readonly.
