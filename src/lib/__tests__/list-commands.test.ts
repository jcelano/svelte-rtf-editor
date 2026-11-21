import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toggleList, nestItems, unnestItems, leaveList, inEmptyItem, atItemStart, listKindAt } from '../lists.js';

/**
 * The editor's own list commands, on the document as it is: what the list buttons, Tab,
 * Enter and Backspace change. The same in every browser, which is the point of them: each
 * browser's own command made something else. Invented text.
 */
describe('lists: what the editor makes of the list buttons', () => {
	let root: HTMLElement;
	const sel = () => window.getSelection()!;

	beforeEach(() => {
		root = document.createElement('div');
		document.body.appendChild(root);
	});
	afterEach(() => root.remove());

	const show = (html: string) => (root.innerHTML = html);
	/** The text node that holds these words. */
	const text = (words: string): Text => {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent === words) return node as Text;
		throw new Error(`no text "${words}"`);
	};
	const caret = (words: string, at = 1) => sel().collapse(text(words), at);
	const select = (from: string, to: string, fromAt = 0, toAt = to.length) => sel().setBaseAndExtent(text(from), fromAt, text(to), toAt);
	/** Where the caret is: the words of its text node, with a bar at the caret. */
	const caretIn = () => {
		const node = sel().anchorNode!;
		return node.nodeType === 3 ? `${node.textContent!.slice(0, sel().anchorOffset)}|${node.textContent!.slice(sel().anchorOffset)}` : `<${(node as Element).localName}>:${sel().anchorOffset}`;
	};

	describe('making a list', () => {
		it('a paragraph is made an item, and the caret stays in its words where it was', () => {
			show('<p>Specimens</p><p>Steps</p>');
			caret('Specimens', 9);
			expect(toggleList(root, sel(), 'ul')).toBe(true);
			expect(root.innerHTML).toBe('<ul><li>Specimens</li></ul><p>Steps</p>');
			expect(caretIn()).toBe('Specimens|');
		});

		it('the list is beside the paragraphs around it, never inside one', () => {
			show('<p>one</p><p>two</p><p>three</p>');
			caret('two');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<p>one</p><ol><li>two</li></ol><p>three</p>');
		});

		it('every line the selection touches is an item of the one list', () => {
			show('<p>one</p><p>two</p><p>three</p><p>four</p>');
			select('one', 'three', 1, 2);
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ol><li>one</li><li>two</li><li>three</li></ol><p>four</p>');
			expect(sel().anchorNode).toBe(text('one'));
			expect(sel().focusNode).toBe(text('three'));
		});

		it('a selection that ends at the very start of the next line does not take that line in', () => {
			show('<p>one</p><p>two</p><p>three</p>');
			select('one', 'three', 0, 0);
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>one</li><li>two</li></ul><p>three</p>');
		});

		it('lines made items one at a time are one list, in whatever order: each was numbered 1', () => {
			for (const order of [['one', 'two', 'three'], ['three', 'two', 'one'], ['one', 'three', 'two'], ['two', 'one', 'three']]) {
				show('<p>one</p><p>two</p><p>three</p><p>after</p>');
				for (const words of order) {
					caret(words);
					toggleList(root, sel(), 'ol');
				}
				expect(root.innerHTML, order.join()).toBe('<ol><li>one</li><li>two</li><li>three</li></ol><p>after</p>');
			}
		});

		it('a line under a list is its next item, and a line between two lists joins them', () => {
			show('<ol><li>a</li><li>b</li></ol><p>c</p><p>d</p><ol><li>e</li></ol>');
			caret('c');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ol><li>a</li><li>b</li><li>c</li></ol><p>d</p><ol><li>e</li></ol>');
			caret('d');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ol><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li></ol>');
		});

		it('a list of the other kind beside it is not one to join', () => {
			show('<ul><li>a</li></ul><p>b</p>');
			caret('b');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
		});

		it('an empty paragraph is an empty item, with the caret in it', () => {
			show('<p>one</p><p><br></p>');
			sel().collapse(root.children[1], 0);
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<p>one</p><ul><li><br></li></ul>');
			expect(caretIn()).toBe('<li>:0');
		});

		it('a heading or a <div> that holds text is made an item of its words', () => {
			show('<h2>Final <i>diagnosis</i></h2><div>Skin</div>');
			select('Final ', 'Skin');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>Final <i>diagnosis</i></li><li>Skin</li></ul>');
		});

		it('a paragraph made an item keeps what it says of itself, but not how a paragraph is laid out', () => {
			// (An application's marks on its paragraphs went: a list toggled on and off was
			// another document.)
			show(
				'<p id="finding-2" class="finding" data-app="7" lang="en" align="center" data-rtf-tab-stops="720" ' +
					'style="color: red; margin-left: 48px; text-align: center; line-height: 1.5; margin-bottom: 6pt;">Margins clear</p>'
			);
			caret('Margins clear');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li id="finding-2" class="finding" data-app="7" lang="en" style="color: red;">Margins clear</li></ul>');
			expect(caretIn()).toBe('M|argins clear');
		});

		it('words in no paragraph are an item, line by line, and the line break that ended a line goes', () => {
			show('alpha<br>beta <b>bold</b><br>gamma');
			caret('beta ');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('alpha<br><ul><li>beta <b>bold</b></li></ul>gamma');
			select('alpha', 'gamma');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>alpha</li><li>beta <b>bold</b></li><li>gamma</li></ul>');
		});

		it('in a table cell the list is in the cell', () => {
			show('<table><tbody><tr><td>skin<br>node</td><td><p>other</p></td></tr></tbody></table>');
			select('skin', 'node');
			toggleList(root, sel(), 'ol');
			expect(root.querySelector('td')!.innerHTML).toBe('<ol><li>skin</li><li>node</li></ol>');
			expect(root.querySelectorAll('td')[1].innerHTML).toBe('<p>other</p>');
		});

		it('the space a source has between its blocks is no line, and a picture or a table is not made an item', () => {
			show('<p>one</p>\n<figure><img src="data:,"><figcaption>cap</figcaption></figure>\n<pre>code</pre>\n<p>two</p>');
			select('one', 'two');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>one</li></ul>\n<figure><img src="data:,"><figcaption>cap</figcaption></figure>\n<pre>code</pre>\n<ul><li>two</li></ul>');
		});

		it('with nothing that can be an item, nothing changes and it says so', () => {
			show('<pre>code</pre>');
			caret('code');
			expect(toggleList(root, sel(), 'ul')).toBe(false);
			expect(root.innerHTML).toBe('<pre>code</pre>');
			sel().removeAllRanges();
			expect(toggleList(root, sel(), 'ul')).toBe(false);
		});
	});

	describe('taking a list off, and changing its kind', () => {
		it('the button of the list the caret is in makes the item a paragraph again, and parts the list around it', () => {
			show('<ul><li>one</li><li>two</li><li>three</li></ul>');
			caret('two');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>one</li></ul><p>two</p><ul><li>three</li></ul>');
			expect(caretIn()).toBe('t|wo');
		});

		it('every item selected is a paragraph of its own: they were one paragraph with line breaks', () => {
			show('<ol><li>one</li><li>two</li><li>three</li></ol>');
			select('one', 'three');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<p>one</p><p>two</p><p>three</p>');
		});

		it('a selection said by the document itself, as Firefox says Select All, is still the whole of it', () => {
			show('<ol><li>one</li><li>two</li><li>three</li></ol>');
			sel().setBaseAndExtent(root, 0, root, 1);
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<p>one</p><p>two</p><p>three</p>');
			expect(sel().toString().replace(/\s/g, '')).toBe('onetwothree');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>one</li><li>two</li><li>three</li></ul>');
			// (And said from its end to its start.)
			sel().setBaseAndExtent(root, 1, root, 0);
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<p>one</p><p>two</p><p>three</p>');
			expect(sel().anchorNode).toBe(text('three'));
			expect(sel().focusNode).toBe(text('one'));
		});

		it('an empty item is an empty paragraph to type in', () => {
			show('<ul><li>one</li><li><br></li></ul>');
			sel().collapse(root.querySelectorAll('li')[1], 0);
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>one</li></ul><p><br></p>');
			expect(caretIn()).toBe('<p>:0');
		});

		it('with a caret, the other button changes the kind of the whole list: it parted the list in three', () => {
			show('<ul style="margin-left: 48px;"><li>one</li><li>two</li><li>three</li></ul>');
			caret('two');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ol style="margin-left: 48px;"><li>one</li><li>two</li><li>three</li></ol>');
			expect(caretIn()).toBe('t|wo');
		});

		it('what said how the other kind was marked does not come with it', () => {
			show('<ol type="A" start="3" style="list-style-type: upper-alpha;"><li>one</li></ol>');
			caret('one');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>one</li></ul>');
		});

		it('with items selected, those items change kind', () => {
			show('<ul><li>one</li><li>two</li><li>three</li><li>four</li></ul>');
			select('two', 'three');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ul><li>one</li></ul><ol><li>two</li><li>three</li></ol><ul><li>four</li></ul>');
		});

		it('items and paragraphs selected together are all items of the kind asked for', () => {
			show('<p>one</p><ul><li>two</li></ul><p>three</p>');
			select('one', 'three');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ol><li>one</li><li>two</li><li>three</li></ol>');
		});

		it('an item that has a list under it leaves that list after it', () => {
			show('<ul><li>one<ul><li>under</li></ul></li><li>two</li></ul>');
			caret('one');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<p>one</p><ul><li>under</li><li>two</li></ul>');
		});

		it('an item made a paragraph keeps what it says of itself, but not how an item is marked', () => {
			show('<ol><li>one</li><li id="finding-2" class="finding" data-app="7" value="5" style="color: red; list-style-type: lower-alpha;">two<ul><li>under</li></ul></li></ol>');
			caret('two');
			toggleList(root, sel(), 'ol');
			expect(root.innerHTML).toBe('<ol><li>one</li></ol><p id="finding-2" class="finding" data-app="7" style="color: red;">two</p><ul><li>under</li></ul>');
		});

		it('on and off again, a paragraph is the paragraph it was, but for its layout', () => {
			const marked = '<p id="finding-2" class="finding" data-app="7" style="color: red;">two</p>';
			show(`<p>one</p>${marked}`);
			caret('two');
			toggleList(root, sel(), 'ul');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe(`<p>one</p>${marked}`);
			// (The id is the item's, and then the paragraph's: never two elements'.)
			expect(root.querySelectorAll('#finding-2')).toHaveLength(1);
		});

		it('an item pasted from Word, with its words in a paragraph, is that paragraph, which keeps its own', () => {
			show('<ul><li id="item" class="from-item"><p class="from-word">one</p></li></ul>');
			caret('one');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<p class="from-word" id="item">one</p>');
		});

		it('an item pasted from Word, with its words in a paragraph, is that paragraph', () => {
			show('<ul><li><p>one</p></li><li><p>two</p><p>more</p></li></ul>');
			select('one', 'more');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<p>one</p><p>two</p><p>more</p>');
		});
	});

	describe('a list within a list', () => {
		it('an item is put under the item before it, and the next one beside it there', () => {
			show('<ol><li>a</li><li>b</li><li>c</li></ol>');
			caret('b');
			expect(nestItems(root, sel())).toBe(true);
			expect(root.innerHTML).toBe('<ol><li>a<ol><li>b</li></ol></li><li>c</li></ol>');
			expect(caretIn()).toBe('b|');
			caret('c');
			nestItems(root, sel());
			expect(root.innerHTML).toBe('<ol><li>a<ol><li>b</li><li>c</li></ol></li></ol>');
		});

		it('several items selected go under the one before them together', () => {
			show('<ul><li>a</li><li>b</li><li>c</li><li>d</li></ul>');
			select('b', 'c');
			nestItems(root, sel());
			expect(root.innerHTML).toBe('<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>');
		});

		it('an item takes the list under it with it', () => {
			show('<ul><li>a</li><li>b<ul><li>under b</li></ul></li></ul>');
			caret('b');
			nestItems(root, sel());
			expect(root.innerHTML).toBe('<ul><li>a<ul><li>b<ul><li>under b</li></ul></li></ul></li></ul>');
		});

		it('the first item of a list has none before it to be under: nothing changes, and it says so', () => {
			show('<ul><li>a</li><li>b</li></ul><p>para</p>');
			caret('a');
			expect(nestItems(root, sel())).toBe(false);
			select('a', 'b');
			expect(nestItems(root, sel())).toBe(false);
			caret('para');
			expect(nestItems(root, sel())).toBe(false);
			expect(root.innerHTML).toBe('<ul><li>a</li><li>b</li></ul><p>para</p>');
		});

		it('an item is put one list further out, after the item it was under, and what followed it is under it', () => {
			show('<ul><li>a<ul><li>b</li><li>c</li><li>d</li></ul></li><li>e</li></ul>');
			caret('c');
			expect(unnestItems(root, sel())).toBe(true);
			expect(root.innerHTML).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c<ul><li>d</li></ul></li><li>e</li></ul>');
			expect(caretIn()).toBe('c|');
		});

		it('the only item of a list within a list leaves no empty list behind', () => {
			show('<ol><li>a<ol><li>b</li></ol></li></ol>');
			caret('b');
			unnestItems(root, sel());
			expect(root.innerHTML).toBe('<ol><li>a</li><li>b</li></ol>');
		});

		it('an item of a list in no other list is not put further out', () => {
			show('<ul><li>a</li></ul>');
			caret('a');
			expect(unnestItems(root, sel())).toBe(false);
			expect(root.innerHTML).toBe('<ul><li>a</li></ul>');
		});

		it('a list straight inside a list, as some editors nest, is put out and in the same way', () => {
			show('<ul><li>a</li><ul><li>b</li><li>c</li></ul><li>d</li></ul>');
			caret('b');
			unnestItems(root, sel());
			expect(root.innerHTML).toBe('<ul><li>a</li><li>b<ul><li>c</li></ul></li><li>d</li></ul>');
		});

		it('the list button on an item of a list within a list makes it a paragraph, out of both', () => {
			show('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
			caret('b');
			toggleList(root, sel(), 'ul');
			expect(root.innerHTML).toBe('<ul><li>a</li></ul><p>b</p><ul><li>c</li></ul>');
		});

		it('which kind of list the caret is in is the innermost', () => {
			show('<ul><li>a<ol><li>b</li></ol></li></ul><p>c</p>');
			caret('a');
			expect(listKindAt(root, sel())).toBe('ul');
			caret('b');
			expect(listKindAt(root, sel())).toBe('ol');
			caret('c');
			expect(listKindAt(root, sel())).toBeNull();
		});
	});

	describe('Enter in an empty item, and Backspace at the start of one', () => {
		it('an item with nothing in it is known, and one with words or a list under it is not', () => {
			show('<ul><li>a</li><li><br></li><li><ul><li>under</li></ul></li></ul><p><br></p>');
			sel().collapse(root.querySelectorAll('li')[1], 0);
			expect(inEmptyItem(root, sel())).toBe(true);
			caret('a');
			expect(inEmptyItem(root, sel())).toBe(false);
			sel().collapse(root.querySelectorAll('li')[2], 0);
			expect(inEmptyItem(root, sel())).toBe(false);
			sel().collapse(root.querySelector('p')!, 0);
			expect(inEmptyItem(root, sel())).toBe(false);
		});

		it('the start of an item is before all its words, and nowhere else', () => {
			show('<ul><li><b>bold</b> a</li><li>line<br>two<ul><li>under</li></ul></li></ul><p>para</p>');
			caret('bold', 0);
			expect(atItemStart(root, sel())).toBe(true);
			caret('bold', 2);
			expect(atItemStart(root, sel())).toBe(false);
			caret('two', 0);
			expect(atItemStart(root, sel())).toBe(false);
			caret('under', 0);
			expect(atItemStart(root, sel())).toBe(true);
			caret('para', 0);
			expect(atItemStart(root, sel())).toBe(false);
			select('bold', 'bold');
			expect(atItemStart(root, sel())).toBe(false);
		});

		it('leaving a list is one step: out of the list within, then a paragraph', () => {
			show('<ul><li>a<ul><li><br></li></ul></li></ul>');
			sel().collapse(root.querySelectorAll('li')[1], 0);
			expect(leaveList(root, sel())).toBe(true);
			expect(root.innerHTML).toBe('<ul><li>a</li><li><br></li></ul>');
			expect(caretIn()).toBe('<li>:0');
			expect(leaveList(root, sel())).toBe(true);
			expect(root.innerHTML).toBe('<ul><li>a</li></ul><p><br></p>');
			expect(caretIn()).toBe('<p>:0');
			expect(leaveList(root, sel())).toBe(false);
		});
	});
});
