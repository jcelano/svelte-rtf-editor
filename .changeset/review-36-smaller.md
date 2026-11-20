---
'svelte-rtf-editor': patch
---

**The four smaller findings of the review of `main` before 1.13.0**

- **Light words on a gradient or a picture are not left white on white.** No picture is loaded
  for a document and an RTF has no gradient, so both are taken off what comes in; the color of
  the words that stood on them was left, and the words were in the report where nobody saw
  them, in the editor and in the RTF. Their color is now taken off with the background it was
  chosen for: by `sanitizeHtml`, on a paste, and where a document is opened. A light color with
  a background color behind it stays (the writer leaves it out of the RTF, as before), and so
  does one with no background at all, which is the writer's own choice.
- **Markdown follows a list item's own number.** `<li value="7">` was "7." in the RTF and "2."
  in the Markdown. Written "7." after "1." it would still be shown as 2: Markdown counts on from
  a list's first number. It is written `7)`, the other mark, which starts a new list at that
  number, and so is a numbered list that comes right after another (the reader makes two lists
  of numbers that jump, 1, 2, 5, 6, and they were shown as 1 to 4). Checked with pandoc.
- **The reader is linear again on a list nested one level deeper at every item.** Lettered items
  of that shape took 1 s at 20,000 items and 4.2 s at 40,000; they take 0.13 s.
- **Branch coverage is 86.3%, from 83.3%,** with tests of the Tab key, of links in the editor
  and of the keyboard in a dialog, which only the browser tests had held to. The floors are
  raised to stay a little under what the suite reaches.
