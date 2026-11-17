---
'svelte-rtf-editor': patch
---

`rtfToHtml` keeps a Word table's cells. Word states each row's definition (`\trowd ... \cellx`)
a second time just before `\row`, and through 1.8.3 that second `\trowd` threw away the cells
already read, so a table saved by Word loaded as an empty table. A `\trowd` followed by new cells
still starts a new row, and the abandoned row's cell alignments no longer carry into it.
