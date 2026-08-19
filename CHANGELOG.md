# svelte-rtf-editor

## 1.4.0

### Minor Changes

- 9c872bc: Images now work end to end in the editor. Pictures can be added by file upload (one or many at a time), clipboard paste, drag-and-drop or address; each is inserted as a figure with a description line below it. Selecting an image shows a frame with drag-to-resize corner handles, width presets and left/centre/right placement.

  Images are embedded rather than linked: `htmlToRtf` now writes real `\pict` picture groups (`\pngblip`/`\jpegblip`, sized with `\picwgoal`/`\pichgoal`) instead of an `[Image: …]` text placeholder, and `rtfToHtml` decodes `\pict` data — including pictures wrapped in `{\*\shppict}` — back into images at their stored size, with their descriptions re-attached.

  `htmlToRtf` output is also made safe to carry inside another format (an HL7 `OBX-5` field, a JSON string): the document is emitted on a single line with no CR or LF anywhere — including newlines inside text content, which are collapsed to the space a browser would render (RTF ignores raw CR/LF, so they previously rendered as nothing while still emitting bytes a CR-terminated transport treats as a record separator) — and picture bytes are written as uppercase hex so a PNG starts with the `89504E470D0A1A0A` signature receivers match on. The blip type is now sniffed from those bytes rather than taken from the declared MIME type, so a mislabelled image (a WebP saved as `.png`) is re-encoded or placeholdered instead of being written as a `\pngblip` nothing can decode. Inserted pictures are bounded by two new props, since RTF costs two characters per image byte: `maxImageEdge` (1600 px) scales them down, and `maxImageBytes` (512 KB) re-encodes anything still too heavy — PNG first so screenshots stay sharp, JPEG only when the image is large and has no transparency to lose, then progressively smaller — until it fits.

  A third, `maxImageDisplayWidth` (624 px), sizes a newly inserted picture to the page rather than to the editor: RTF records the display size in twips, so a browser-wide picture was written as `\picwgoal` 12 in and overflowed the 6.5 in text column of the page it landed on. Resize handles still reach the full column width.

  The editor also reports how large the document will be as RTF, since that is what a size-limited transport cares about: `getRtfSize()` returns the exact byte count, and the `onchange` payload carries an `estimatedRtfBytes` cheap enough to update on every keystroke (picture data is counted exactly; the rest is approximated within a few hundred bytes). `estimateRtfBytes` is exported as a utility for callers holding HTML rather than an editor instance. Reporting only — the library does not refuse oversized documents.

## 1.3.0

### Minor Changes

- updated the formatting for tables

## 1.2.0

### Minor Changes

- Added support for rendering tables

## 1.1.0

### Minor Changes

- Removed background color tool

## 1.0.3

### Patch Changes

- Fixed issue where coloring was not set correctly

## 1.0.2

### Patch Changes

- Added testing framework, fixed issue with new line being skipped

## 1.0.1

### Patch Changes

- Updates to git URLs in package.json

## 1.0.0

### Major Changes

- Stable 1.0.0 version

## 0.2.0

### Minor Changes

- Initial release of RTF viewer and rich-text editor components for Svelte 5
