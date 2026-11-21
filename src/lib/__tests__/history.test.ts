import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHistory, type DocumentHistory } from '../history.js';

const PICTURE = `data:image/png;base64,${'iVBORw0KGgo'.repeat(40)}`;

describe('the editor\'s own history', () => {
	let root: HTMLElement;
	let history: DocumentHistory;

	beforeEach(() => {
		root = document.createElement('div');
		root.contentEditable = 'true';
		root.innerHTML = '<p>one</p><p>two</p>';
		document.body.appendChild(root);
		history = createHistory(root);
	});

	afterEach(() => {
		history.destroy();
		root.remove();
		vi.useRealTimers();
	});

	const text = (index: number) => root.children[index].firstChild as Text;
	/** A key typed at the end of a paragraph, as the editor tells the history of it. */
	function type(index: number, chars: string, kind: 'insert' | 'delete' = 'insert'): void {
		for (const char of chars) {
			const node = text(index);
			window.getSelection()!.collapse(node, node.length);
			history.typing(kind);
			if (kind === 'insert') node.appendData(char);
			else node.deleteData(node.length - 1, 1);
			window.getSelection()!.collapse(node, node.length);
			history.typed();
		}
	}

	it('with nothing done there is nothing to undo, and Undo says so', () => {
		expect(history.canUndo()).toBe(false);
		expect(history.undo()).toBe(false);
		expect(history.redo()).toBe(false);
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('a change the editor makes is a step: Undo takes it back and Redo makes it again', () => {
		history.step();
		root.appendChild(document.createElement('hr'));
		expect(history.canUndo()).toBe(true);
		expect(history.undo()).toBe(true);
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
		expect(history.canRedo()).toBe(true);
		expect(history.redo()).toBe(true);
		expect(root.innerHTML).toBe('<p>one</p><p>two</p><hr>');
		expect(history.redo()).toBe(false);
	});

	it('each thing done is its own step, undone in turn', () => {
		history.step();
		root.children[0].setAttribute('style', 'margin-left: 48px;');
		history.step();
		root.appendChild(document.createElement('table'));
		history.step();
		text(1).data = 'TWO';
		history.undo();
		expect(root.innerHTML).toBe('<p style="margin-left: 48px;">one</p><p>two</p><table></table>');
		history.undo();
		expect(root.innerHTML).toBe('<p style="margin-left: 48px;">one</p><p>two</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
		expect(history.undo()).toBe(false);
		history.redo();
		history.redo();
		history.redo();
		expect(root.innerHTML).toBe('<p style="margin-left: 48px;">one</p><p>TWO</p><table></table>');
	});

	it('a run of typing is one step, and what the editor does after it another', () => {
		type(0, ' more');
		history.step();
		root.children[0].setAttribute('style', 'margin-left: 48px;');
		type(0, '!');
		expect(root.innerHTML).toBe('<p style="margin-left: 48px;">one more!</p><p>two</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p style="margin-left: 48px;">one more</p><p>two</p>');
		// (The indent could not be undone once anything was typed after it.)
		history.undo();
		expect(root.innerHTML).toBe('<p>one more</p><p>two</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('typing somewhere else, deleting, and typing after a pause are steps of their own', () => {
		vi.useFakeTimers();
		type(0, 'ab');
		type(1, 'cd');
		type(1, 'x', 'delete');
		type(1, 'x', 'delete');
		vi.advanceTimersByTime(1500);
		type(1, 'e');
		expect(root.innerHTML).toBe('<p>oneab</p><p>twoe</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>oneab</p><p>two</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>oneab</p><p>twocd</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>oneab</p><p>two</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('input that is a step of its own ends the run before it', () => {
		type(0, 'a');
		history.typing(null);
		root.appendChild(document.createElement('p'));
		history.typed();
		type(0, 'b');
		history.undo();
		expect(root.innerHTML).toBe('<p>onea</p><p>two</p><p></p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>onea</p><p>two</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('what an input method composes is one step, though the caret moves and its text is replaced', () => {
		type(0, ' ');
		history.step();
		history.composing(true);
		// (Each input replaces the text composed so far, the text node with it, as Chromium
		// does; and the method moves the caret between inputs: here, before the last character.)
		for (const composed of ['k', 'ka', 'かn', 'かな']) {
			history.typing('insert');
			const node = document.createTextNode(`two${composed}`);
			text(1).replaceWith(node);
			window.getSelection()!.collapse(node, node.length);
			history.typed();
			window.getSelection()!.collapse(node, node.length - 1);
		}
		history.composing(false);
		expect(root.innerHTML).toBe('<p>one </p><p>twoかな</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>one </p><p>two</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('nothing is undone or redone while an input method composes', () => {
		history.step();
		root.appendChild(document.createElement('hr'));
		history.step();
		history.composing(true);
		history.typing('insert');
		text(1).data = 'twoか';
		history.typed();
		expect(history.undo()).toBe(false);
		expect(history.redo()).toBe(false);
		expect(root.innerHTML).toBe('<p>one</p><p>twoか</p><hr>');
		history.composing(false);
		expect(history.undo()).toBe(true);
		expect(root.innerHTML).toBe('<p>one</p><p>two</p><hr>');
	});

	it('a new change after an Undo leaves nothing to redo', () => {
		history.step();
		text(0).data = 'ONE';
		history.undo();
		history.step();
		text(1).data = 'TWO';
		expect(history.redo()).toBe(false);
		expect(root.innerHTML).toBe('<p>one</p><p>TWO</p>');
		history.undo();
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
	});

	it('the caret goes back to where the step began', () => {
		window.getSelection()!.collapse(text(1), 2);
		history.step();
		root.children[0].remove();
		window.getSelection()!.collapse(root, 0);
		history.undo();
		const sel = window.getSelection()!;
		expect(sel.anchorNode).toBe(text(1));
		expect(sel.anchorOffset).toBe(2);
	});

	it('the caret is put back in text the browser had in several pieces, which is one piece when read again', () => {
		const pieces = () => {
			const bold = document.createElement('b');
			bold.textContent = 'bold';
			root.children[1].replaceChildren('', 'tw', 'o and ', bold, 'more');
			history.reset();
			return root.children[1];
		};

		// In the third piece, after "o a": five characters into the text as one piece.
		let p = pieces();
		window.getSelection()!.collapse(p.childNodes[2], 3);
		history.step();
		root.children[0].remove();
		window.getSelection()!.collapse(root, 0);
		history.undo();
		let sel = window.getSelection()!;
		expect(sel.anchorNode!.textContent).toBe('two and ');
		expect(sel.anchorOffset).toBe(5);

		// And a caret said by the paragraph itself: before "more", its fifth piece and its third when read again.
		p = pieces();
		window.getSelection()!.collapse(p, 4);
		history.step();
		p.setAttribute('style', 'margin-left: 96px;');
		window.getSelection()!.collapse(root, 0);
		history.undo();
		sel = window.getSelection()!;
		expect(sel.anchorNode).toBe(root.children[1]);
		expect(sel.anchorNode!.childNodes[sel.anchorOffset].textContent).toBe('more');
	});

	it('a block that did not change is the same element after Undo: its picture is not read again', () => {
		root.innerHTML = `<figure><img src="${PICTURE}"></figure><p>words</p>`;
		history.reset();
		const figure = root.children[0];
		history.step();
		(root.children[1].firstChild as Text).data = 'other words';
		history.step();
		root.appendChild(document.createElement('hr'));
		history.undo();
		history.undo();
		expect(root.children[0]).toBe(figure);
		expect(root.innerHTML).toBe(`<figure><img src="${PICTURE}"></figure><p>words</p>`);
	});

	it('a picture taken out comes back whole', () => {
		root.innerHTML = `<p>a</p><figure><img src="${PICTURE}" alt="field"></figure>`;
		history.reset();
		history.step();
		root.children[1].remove();
		history.undo();
		expect(root.querySelector('img')!.getAttribute('src')).toBe(PICTURE);
		history.redo();
		expect(root.querySelector('img')).toBeNull();
	});

	it('text that reads like a kept picture is text', () => {
		root.innerHTML = '<p>x</p>';
		history.reset();
		history.step();
		root.children[0].textContent = ' src="ink-kept-abc-0" and src="data:,"';
		history.step();
		root.appendChild(document.createElement('hr'));
		history.undo();
		expect(root.children[0].textContent).toBe(' src="ink-kept-abc-0" and src="data:,"');
	});

	it('a change made quietly is part of the step before it', () => {
		history.step();
		const img = document.createElement('img');
		root.appendChild(img);
		history.step();
		history.quietly(() => img.setAttribute('style', 'width: 200px;'));
		expect(root.querySelector('img')!.getAttribute('style')).toBe('width: 200px;');
		history.undo();
		expect(root.innerHTML).toBe('<p>one</p><p>two</p>');
		history.redo();
		expect(root.querySelector('img')!.getAttribute('style')).toBe('width: 200px;');
	});

	it('what is done to the document once it is back is not a step', () => {
		history.step();
		root.appendChild(document.createElement('hr'));
		history.undo(() => root.children[0].setAttribute('data-checked', ''));
		expect(root.innerHTML).toBe('<p data-checked="">one</p><p>two</p>');
		expect(history.canUndo()).toBe(false);
		history.redo();
		expect(root.querySelector('hr')).not.toBeNull();
	});

	it('after a reset there is nothing to undo: the document is another one', () => {
		history.step();
		text(0).data = 'the report before';
		history.step();
		root.innerHTML = '<p>another patient</p>';
		history.reset();
		expect(history.canUndo()).toBe(false);
		expect(history.undo()).toBe(false);
		expect(root.innerHTML).toBe('<p>another patient</p>');
	});

	it('only so many steps are kept', () => {
		history.destroy();
		history = createHistory(root, { limit: 3 });
		for (let i = 0; i < 6; i++) {
			history.step();
			text(0).data = `one ${i}`;
		}
		let undone = 0;
		while (history.undo()) undone++;
		expect(undone).toBe(3);
		expect(root.innerHTML).toBe('<p>one 2</p><p>two</p>');
	});

	it('the editor\'s own attributes on the document\'s element are no change to the document', () => {
		history.step();
		root.setAttribute('class', 'ink-content links-open');
		expect(history.canUndo()).toBe(false);
	});
});
