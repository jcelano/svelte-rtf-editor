---
'svelte-rtf-editor': minor
---

The application chooses the toolbar's controls, and can put the less-used ones behind a More button (issue #52).

- Every control has a stable name, on the element as `data-tool`, exported as `TOOLBAR_TOOLS` (type `ToolbarTool`): `block`, `font`, `fontSize`, `bold`, `italic`, `underline`, `strikethrough`, `textColor`, `clearFormatting`, `bulletList`, `numberedList`, `alignLeft`, `alignCenter`, `alignRight`, `outdent`, `indent`, `hangingOutdent`, `hangingIndent`, `hangAtCaret`, `rightOutdent`, `rightIndent`, `spacing`, `copyFormat`, `link`, `image`, `table`, `horizontalRule`, `undo`, `redo`.
- `tools`: the controls the toolbar has. One not named is not rendered (its shortcut still works); empty groups and stray dividers are left out; unknown names are ignored with a console warning.
- `moreTools`, `bind:moreOpen`, `onmoretoggle`, `moreLabel`, `lessLabel`: the named controls wait in a second row under the first, opened by a More / Less button at the end of the first row. The first row does not move, the selection stays, Tab follows the rows, and the sticky toolbar covers both.
- `toolbarEnd`: a snippet for the application's own controls at the end of the first row.

With none of them set, the toolbar is as in 1.16.0 apart from the `data-tool` attributes.
