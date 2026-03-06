<script lang="ts">
	/**
	 * InkEditor — A reusable Svelte 5 Rich Text Editor component.
	 *
	 * Props:
	 *   content       — Initial HTML content (string). Default: empty paragraph.
	 *   placeholder   — Placeholder text shown when editor is empty.
	 *   autosave      — Enable localStorage auto-save. Default: true.
	 *   storageKey    — localStorage key for auto-save. Default: 'ink-editor-content'.
	 *   showToolbar   — Show the formatting toolbar. Default: true.
	 *   showStatusBar — Show the word/char count status bar. Default: true.
	 *   minHeight     — CSS min-height of the editing area. Default: '40vh'.
	 *   readonly      — If true, editor is not editable. Default: false.
	 *
	 * Events (callback props):
	 *   onchange      — Fires on content change with { html, text, wordCount, charCount }.
	 *   onsave        — Fires on auto-save or Ctrl+S with { html }.
	 *   onimport      — Fires after a successful RTF import with { html }.
	 *
	 * Bindable methods (via bind:this):
	 *   getHTML()      — Returns the current editor HTML string.
	 *   getText()      — Returns plain text content.
	 *   setHTML(html)  — Replaces editor content with the given HTML.
	 *   getMarkdown()  — Returns Markdown conversion of current content.
	 *   getRTF()       — Returns RTF conversion of current content.
	 *   clear()        — Clears the editor (no confirm dialog).
	 *   focus()        — Focuses the editor.
	 *   exportFile(format) — Downloads as 'html', 'md', or 'rtf'.
	 *   importRtf()    — Opens the file picker to import an RTF file.
	 */

	import { onMount } from 'svelte';
	import Toolbar from './Toolbar.svelte';
	import Modal from './Modal.svelte';
	import { htmlToMarkdown, downloadFile } from '../utils.js';
	import { readRtfFile } from '../rtf-parser.js';
	import { htmlToRtf } from '../rtf-writer.js';

	interface ChangePayload {
		html: string;
		text: string;
		wordCount: number;
		charCount: number;
	}

	interface Props {
		content?: string;
		placeholder?: string;
		autosave?: boolean;
		storageKey?: string;
		showToolbar?: boolean;
		showStatusBar?: boolean;
		minHeight?: string;
		readonly?: boolean;
		onchange?: (payload: ChangePayload) => void;
		onsave?: (payload: { html: string }) => void;
		onimport?: (payload: { html: string }) => void;
	}

	// ── Props ──
	let {
		content = '<p></p>',
		placeholder = 'Start writing something beautiful...',
		autosave = true,
		storageKey = 'ink-editor-content',
		showToolbar = true,
		showStatusBar = true,
		minHeight = '40vh',
		readonly = false,
		onchange,
		onsave,
		onimport
	}: Props = $props();

	// ── Internal state ──
	let editorEl: HTMLDivElement | null = $state(null);
	let wordCount: number = $state(0);
	let charCount: number = $state(0);
	let lastSaved: string = $state('');
	let currentBlock: string = $state('p');

	let formatState = $state({
		bold: false,
		italic: false,
		underline: false,
		strikeThrough: false
	});

	// Modal state
	let linkModalOpen: boolean = $state(false);
	let imageModalOpen: boolean = $state(false);
	let linkUrl: string = $state('');
	let linkText: string = $state('');
	let imageUrl: string = $state('');
	let imageAlt: string = $state('');
	let savedSelection: Range | null = $state(null);

	// Import state
	let fileInputEl: HTMLInputElement | null = $state(null);
	let importing: boolean = $state(false);
	let importError: string = $state('');

	// ── Public API (exposed via bind:this) ──
	export function getHTML(): string {
		return editorEl?.innerHTML || '';
	}

	export function getText(): string {
		return editorEl?.innerText || '';
	}

	export function setHTML(html: string): void {
		if (editorEl) {
			editorEl.innerHTML = html;
			updateCounts();
			if (autosave) scheduleAutoSave();
		}
	}

	export function getMarkdown(): string {
		if (!editorEl) return '';
		return htmlToMarkdown(editorEl);
	}

	export function getRTF(): string {
		if (!editorEl) return '';
		return htmlToRtf(editorEl);
	}

	export function clear(): void {
		if (editorEl) {
			editorEl.innerHTML = '<p></p>';
			try { localStorage.removeItem(storageKey); } catch (e) {}
			updateCounts();
			lastSaved = '';
			fireChange();
		}
	}

	export function focus(): void {
		editorEl?.focus();
	}

	export function exportFile(format = 'html'): void {
		if (!editorEl) return;
		switch (format) {
			case 'html': {
				const html = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>Document</title></head>\n<body>\n${editorEl.innerHTML}\n</body>\n</html>`;
				downloadFile('document.html', html, 'text/html');
				break;
			}
			case 'md':
			case 'markdown': {
				const md = htmlToMarkdown(editorEl);
				downloadFile('document.md', md, 'text/markdown');
				break;
			}
			case 'rtf': {
				const rtf = htmlToRtf(editorEl);
				downloadFile('document.rtf', rtf, 'application/rtf');
				break;
			}
		}
	}

	export function importRtf(): void {
		fileInputEl?.click();
	}

	// ── Selection helpers ──
	function saveSelection(): void {
		const sel = window.getSelection();
		if (sel && sel.rangeCount > 0) {
			savedSelection = sel.getRangeAt(0).cloneRange();
		}
	}

	function restoreSelection(): void {
		if (savedSelection) {
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(savedSelection);
		}
	}

	// ── Exec command ──
	function exec(cmd: string, value: string | null = null): void {
		restoreSelection();
		editorEl?.focus();
		document.execCommand(cmd, false, value ?? undefined);
		updateToolbarState();
	}

	// ── Block type ──
	function setBlock(tag: string): void {
		restoreSelection();
		editorEl?.focus();
		document.execCommand('formatBlock', false, tag);
		updateToolbarState();
	}

	// ── Toolbar state ──
	function updateToolbarState(): void {
		// Snapshot the selection so exec/setBlock can restore it even if focus
		// temporarily moved to a toolbar element (e.g. colour picker, select).
		saveSelection();

		formatState = {
			bold: document.queryCommandState('bold'),
			italic: document.queryCommandState('italic'),
			underline: document.queryCommandState('underline'),
			strikeThrough: document.queryCommandState('strikeThrough')
		};

		const block = document.queryCommandValue('formatBlock');
		const normalized = block.replace(/[<>]/g, '').toLowerCase();
		const map: Record<string, string> = { h1: 'h1', h2: 'h2', h3: 'h3', blockquote: 'blockquote', pre: 'pre', p: 'p' };
		currentBlock = map[normalized] || 'p';

		updateCounts();
	}

	function updateCounts(): void {
		if (!editorEl) return;
		const text = editorEl.innerText || '';
		const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
		wordCount = words.length;
		charCount = text.length;
	}

	function fireChange(): void {
		onchange?.({
			html: editorEl?.innerHTML || '',
			text: editorEl?.innerText || '',
			wordCount,
			charCount
		});
	}

	// ── Auto-save ──
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	function autoSaveNow(): void {
		if (!editorEl || !autosave) return;
		try {
			localStorage.setItem(storageKey, editorEl.innerHTML);
			lastSaved = `Saved ${new Date().toLocaleTimeString()}`;
		} catch (e) {}
		onsave?.({ html: editorEl.innerHTML });
	}

	function scheduleAutoSave(): void {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(autoSaveNow, 1000);
	}

	// ── Input handler ──
	function handleInput(): void {
		updateToolbarState();
		fireChange();
		if (autosave) scheduleAutoSave();
	}

	// ── Link modal ──
	function openLinkModal(): void {
		saveSelection();
		linkUrl = '';
		linkText = '';
		linkModalOpen = true;
	}

	function applyLink(): void {
		if (!linkUrl) { linkModalOpen = false; return; }
		restoreSelection();
		editorEl?.focus();

		if (linkText) {
			const sel = window.getSelection();
			if (sel && sel.rangeCount) {
				const range = sel.getRangeAt(0);
				range.deleteContents();
				const a = document.createElement('a');
				a.href = linkUrl;
				a.textContent = linkText;
				range.insertNode(a);
				range.setStartAfter(a);
				sel.removeAllRanges();
				sel.addRange(range);
			}
		} else {
			document.execCommand('createLink', false, linkUrl);
		}
		linkModalOpen = false;
	}

	// ── Image modal ──
	function openImageModal(): void {
		saveSelection();
		imageUrl = '';
		imageAlt = '';
		imageModalOpen = true;
	}

	function applyImage(): void {
		if (!imageUrl) { imageModalOpen = false; return; }
		restoreSelection();
		editorEl?.focus();
		document.execCommand('insertHTML', false, `<img src="${imageUrl}" alt="${imageAlt || ''}" />`);
		imageModalOpen = false;
	}

	// ── Import RTF ──
	async function handleFileImport(e: Event): Promise<void> {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		importError = '';
		importing = true;

		try {
			const html = await readRtfFile(file);
			if (editorEl) {
				editorEl.innerHTML = html;
				updateCounts();
				fireChange();
				if (autosave) scheduleAutoSave();
				onimport?.({ html });
			}
		} catch (err) {
			importError = (err as Error).message || 'Failed to import RTF file';
			setTimeout(() => (importError = ''), 4000);
		} finally {
			importing = false;
			if (fileInputEl) fileInputEl.value = '';
		}
	}

	// ── Keyboard shortcuts ──
	function handleKeydown(e: KeyboardEvent): void {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === 'b') { e.preventDefault(); exec('bold'); }
		if (mod && e.key === 'i') { e.preventDefault(); exec('italic'); }
		if (mod && e.key === 'u') { e.preventDefault(); exec('underline'); }
		if (mod && e.key === 'k') { e.preventDefault(); openLinkModal(); }
		if (mod && e.key === 's') { e.preventDefault(); autoSaveNow(); }

		if (e.key === 'Tab') {
			const sel = window.getSelection();
			if (sel?.anchorNode?.parentElement?.closest?.('pre')) {
				e.preventDefault();
				document.execCommand('insertHTML', false, '  ');
			}
		}
	}

	function handlePaste(e: ClipboardEvent): void {
		const sel = window.getSelection();
		if (sel?.anchorNode?.parentElement?.closest?.('pre')) {
			e.preventDefault();
			const text = e.clipboardData?.getData('text/plain') || '';
			document.execCommand('insertText', false, text);
		}
	}

	// ── Lifecycle ──
	onMount(() => {
		if (!editorEl) return;
		if (autosave) {
			try {
				const saved = localStorage.getItem(storageKey);
				if (saved) {
					editorEl.innerHTML = saved;
					updateCounts();
					return;
				}
			} catch (e) {}
		}
		// Always write the initial content prop so the div isn't empty.
		// {#html content} must NOT be used inside the contenteditable div —
		// Svelte would re-inject it on every reactive update, duplicating text.
		editorEl.innerHTML = content || '<p></p>';
		updateCounts();
	});

	// Suppress unused warning for importing state (used in template)
	$effect(() => { void importing; });
</script>

<!-- Hidden file input for RTF import -->
<input
	type="file"
	accept=".rtf,application/rtf,text/rtf"
	class="ink-hidden-input"
	bind:this={fileInputEl}
	onchange={handleFileImport}
/>

<div class="ink-editor" style="--ink-min-height: {minHeight};">
	{#if showToolbar && !readonly}
		<Toolbar
			{formatState}
			blockType={currentBlock}
			onexec={exec}
			onblock={setBlock}
			oninsertlink={openLinkModal}
			oninsertimage={openImageModal}
		/>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="ink-content"
		contenteditable={!readonly}
		spellcheck="true"
		bind:this={editorEl}
		oninput={handleInput}
		onmouseup={updateToolbarState}
		onkeyup={updateToolbarState}
		onkeydown={handleKeydown}
		onpaste={handlePaste}
		data-placeholder={placeholder}
	></div>

	{#if showStatusBar}
		<div class="ink-status-bar">
			<span>{wordCount} word{wordCount !== 1 ? 's' : ''} · {charCount} character{charCount !== 1 ? 's' : ''}</span>
			{#if autosave}
				<span>{lastSaved || 'Auto-saved to browser'}</span>
			{/if}
		</div>
	{/if}
</div>

<!-- Link Modal -->
<Modal title="Insert Link" open={linkModalOpen} onclose={() => (linkModalOpen = false)}>
	<input type="text" placeholder="Link text (leave empty to use selection)" bind:value={linkText} />
	<input
		type="url"
		placeholder="https://example.com"
		bind:value={linkUrl}
		onkeydown={(e) => e.key === 'Enter' && applyLink()}
	/>
	{#snippet actions()}
		<button class="ink-btn-ghost" onclick={() => (linkModalOpen = false)}>Cancel</button>
		<button class="ink-btn-primary" onclick={applyLink}>Insert</button>
	{/snippet}
</Modal>

<!-- Image Modal -->
<Modal title="Insert Image" open={imageModalOpen} onclose={() => (imageModalOpen = false)}>
	<input
		type="url"
		placeholder="https://example.com/image.jpg"
		bind:value={imageUrl}
		onkeydown={(e) => e.key === 'Enter' && applyImage()}
	/>
	<input type="text" placeholder="Alt text (optional)" bind:value={imageAlt} />
	{#snippet actions()}
		<button class="ink-btn-ghost" onclick={() => (imageModalOpen = false)}>Cancel</button>
		<button class="ink-btn-primary" onclick={applyImage}>Insert</button>
	{/snippet}
</Modal>

<!-- Import Error Toast -->
{#if importError}
	<div class="ink-toast-error">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
		{importError}
	</div>
{/if}

<style>
	.ink-hidden-input {
		display: none;
	}

	.ink-editor {
		width: 100%;
	}

	/* ── Content Area ── */
	.ink-content {
		min-height: var(--ink-min-height, 40vh);
		padding: 48px 56px;
		background: white;
		border: 1px solid var(--border, #e5e2dc);
		border-radius: var(--radius, 8px);
		box-shadow: var(--shadow-md, 0 4px 12px rgba(44, 37, 32, 0.08));
		outline: none;
		font-family: 'DM Sans', sans-serif;
		font-size: 16px;
		line-height: 1.75;
		color: var(--text, #2c2520);
		caret-color: var(--accent, #d4622b);
		transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.ink-content:focus {
		border-color: var(--border-active, #c4b5a0);
	}

	/* Placeholder */
	.ink-content:empty::before {
		content: attr(data-placeholder);
		color: var(--text-muted, #8a7e72);
		opacity: 0.5;
		pointer-events: none;
	}

	/* ── Typography inside editor ── */
	.ink-content :global(h1) {
		font-family: 'Instrument Serif', serif;
		font-size: 38px;
		line-height: 1.2;
		color: var(--ink, #1a1714);
		margin-bottom: 16px;
		letter-spacing: -0.5px;
	}

	.ink-content :global(h2) {
		font-family: 'Instrument Serif', serif;
		font-size: 28px;
		line-height: 1.3;
		color: var(--ink, #1a1714);
		margin-bottom: 12px;
		margin-top: 32px;
	}

	.ink-content :global(h3) {
		font-family: 'DM Sans', sans-serif;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.4;
		color: var(--ink, #1a1714);
		margin-bottom: 8px;
		margin-top: 24px;
	}

	.ink-content :global(p) {
		margin: 0 0 0.2em;
	}

	.ink-content :global(blockquote) {
		border-left: 3px solid var(--accent, #d4622b);
		padding: 8px 20px;
		margin: 16px 0;
		color: var(--text-muted, #8a7e72);
		font-style: italic;
		background: var(--accent-soft, #fdf0e9);
		border-radius: 0 var(--radius-sm, 5px) var(--radius-sm, 5px) 0;
	}

	.ink-content :global(pre) {
		background: var(--ink, #1a1714);
		color: #e8e2da;
		padding: 20px 24px;
		border-radius: var(--radius, 8px);
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		line-height: 1.6;
		margin: 16px 0;
		overflow-x: auto;
	}

	.ink-content :global(code) {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		background: var(--surface, #f2f0ec);
		padding: 2px 6px;
		border-radius: 3px;
		color: var(--accent, #d4622b);
	}

	.ink-content :global(pre code) {
		background: none;
		padding: 0;
		color: inherit;
	}

	.ink-content :global(ul),
	.ink-content :global(ol) {
		padding-left: 24px;
		margin-bottom: 12px;
	}

	.ink-content :global(li) {
		margin-bottom: 4px;
	}

	.ink-content :global(a) {
		color: var(--accent, #d4622b);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.ink-content :global(img) {
		max-width: 100%;
		border-radius: var(--radius, 8px);
		margin: 16px 0;
	}

	.ink-content :global(hr) {
		border: none;
		height: 1px;
		background: var(--border, #e5e2dc);
		margin: 32px 0;
	}

	/* ── Status Bar ── */
	.ink-status-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 0;
		font-size: 12px;
		color: var(--text-muted, #8a7e72);
		letter-spacing: 0.2px;
	}

	.ink-status-bar span {
		opacity: 0.7;
	}

	/* ── Buttons (for modals) ── */
	:global(.ink-btn-primary) {
		background: var(--accent, #d4622b);
		border: none;
		padding: 8px 18px;
		border-radius: var(--radius-sm, 5px);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: white;
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ink-btn-primary:hover) {
		background: var(--accent-hover, #be5524);
	}

	:global(.ink-btn-ghost) {
		background: none;
		border: 1px solid var(--border, #e5e2dc);
		padding: 8px 16px;
		border-radius: var(--radius-sm, 5px);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted, #8a7e72);
		cursor: pointer;
		transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.ink-btn-ghost:hover) {
		border-color: var(--border-active, #c4b5a0);
		color: var(--text, #2c2520);
		background: var(--surface, #f2f0ec);
	}

	/* ── Error Toast ── */
	.ink-toast-error {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		background: #d32f2f;
		color: white;
		padding: 10px 20px;
		border-radius: var(--radius, 8px);
		font-size: 13px;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 8px;
		box-shadow: var(--shadow-lg, 0 8px 30px rgba(44, 37, 32, 0.12));
		z-index: 300;
		animation: inkToastIn 0.25s ease-out;
	}

	.ink-toast-error svg {
		flex-shrink: 0;
	}

	@keyframes inkToastIn {
		from { opacity: 0; transform: translateX(-50%) translateY(12px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	/* ── Responsive ── */
	@media (max-width: 700px) {
		.ink-content {
			padding: 28px 24px;
		}
		.ink-content :global(h1) {
			font-size: 28px;
		}
		.ink-content :global(h2) {
			font-size: 22px;
		}
	}
</style>
