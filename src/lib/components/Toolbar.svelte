<script lang="ts" module>
	/** Each toolbar's second row has an id of its own, for its More button to name. */
	let rows = 0;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toolbarRow, TOOLBAR_TOOLS, type ToolbarTool } from '../toolbar-tools.js';
	import ToolbarButton from './ToolbarButton.svelte';
	import ColorPicker from './ColorPicker.svelte';

	interface Props {
		formatState?: Record<string, boolean>;
		blockType?: string;
		onexec?: (cmd: string, value?: string | null) => void;
		onblock?: (tag: string) => void;
		oninsertlink?: () => void;
		oninsertimage?: () => void;
		oninserttable?: () => void;
		/** The size of the text at the caret, in points; null where the selection has more than one. */
		fontSize?: number | null;
		/** The sizes offered, in points. */
		fontSizes?: number[];
		onfontsize?: (points: number) => void;
		/** The font of the text at the caret, by its key: '' for the document font, null where the selection has more than one. */
		font?: string | null;
		/** The fonts offered beside the document's own. None, and there is no font list. */
		fonts?: { name: string; css: string; key: string }[];
		/** The document font's name: the first of the list, and what '' is shown as. */
		documentFont?: string;
		onfont?: (name: string) => void;
		/**
		 * The spacing of the paragraph at the caret: lines apart (null: none set), and points before
		 * and after; and in a list, the gap after its markers in points (null: the list sets none).
		 * Out of a list `gap` is left out, and the list does not offer it.
		 */
		spacing?: { line: number | null; before: number; after: number; gap?: number | null };
		/** The Copy format brush is in hand: the button shows as pressed. */
		copyingFormat?: boolean;
		oncopyformat?: () => void;
		/** The controls the toolbar has. All of them unless given. */
		tools?: ReadonlySet<ToolbarTool>;
		/** Those of `tools` that wait behind the More button, in a second row. None, and there is no button. */
		moreTools?: ReadonlySet<ToolbarTool>;
		/** Whether the second row is open. */
		moreOpen?: boolean;
		onmoretoggle?: (open: boolean) => void;
		moreLabel?: string;
		lessLabel?: string;
		/** The application's own controls, at the end of the first row (before the More button). */
		end?: Snippet;
	}

	let {
		formatState = {},
		blockType = 'p',
		onexec,
		onblock,
		oninsertlink,
		oninsertimage,
		oninserttable,
		fontSize = null,
		fontSizes = [],
		onfontsize,
		font = '',
		fonts = [],
		documentFont = '',
		onfont,
		spacing = { line: null, before: 0, after: 0 },
		copyingFormat = false,
		oncopyformat,
		tools = new Set(TOOLBAR_TOOLS),
		moreTools = new Set(),
		moreOpen = false,
		onmoretoggle,
		moreLabel = 'More',
		lessLabel = 'Less',
		end
	}: Props = $props();

	const moreId = `ink-toolbar-more-${++rows}`;

	/** A control that has something to offer: a font list needs fonts, a size list sizes. */
	const offers = (tool: ToolbarTool) => (tool === 'font' ? fonts.length > 0 : tool === 'fontSize' ? fontSizes.length > 0 : true);
	const firstRow = $derived(toolbarRow((tool) => tools.has(tool) && !moreTools.has(tool) && offers(tool)));
	const moreRow = $derived(toolbarRow((tool) => tools.has(tool) && moreTools.has(tool) && offers(tool)));

	// The size at the caret is shown even when it is not one of the sizes offered (13.5 pt in a
	// document from elsewhere), so the list never shows a size the text does not have.
	const sizeChoices = $derived(
		fontSize !== null && !fontSizes.includes(fontSize) ? [...fontSizes, fontSize].sort((a, b) => a - b) : fontSizes
	);

	function exec(cmd: string, value: string | null = null) {
		onexec?.(cmd, value);
	}

	// What the spacing list offers. The paragraph's own setting is offered too where it is
	// another (8 pt after, in a document from elsewhere), so the list shows what the paragraph has.
	const offered = (choices: number[], current: number | null) =>
		current !== null && !choices.includes(current) ? [...choices, current].sort((a, b) => a - b) : choices;
	const lineChoices = $derived(offered([1, 1.15, 1.5, 2], spacing.line));
	const beforeChoices = $derived(offered([0, 6, 12], spacing.before));
	const afterChoices = $derived(offered([0, 6, 12], spacing.after));
	const gapChoices = $derived(offered([9, 18, 27, 36], spacing.gap ?? null));
	const mark = (on: boolean) => (on ? '\u2713 ' : '\u2003');

	/** One choice of the spacing list is a command; the list goes back to showing its name. */
	function chooseSpacing(e: Event) {
		const list = e.target as HTMLSelectElement;
		const [cmd, value] = list.value.split(':');
		list.value = '';
		if (cmd) exec(cmd, value === 'none' ? null : value);
	}
</script>

<!-- One control of the toolbar, by its name. -->
{#snippet control(tool: ToolbarTool)}
	{#if tool === 'block'}
		<select
			data-tool="block"
			class="tb-select"
			title="Paragraph style"
			aria-label="Paragraph style"
			value={blockType}
			onchange={(e) => onblock?.((e.target as HTMLSelectElement).value)}
		>
			<option value="p">Paragraph</option>
			<option value="h1">Heading 1</option>
			<option value="h2">Heading 2</option>
			<option value="h3">Heading 3</option>
			<option value="blockquote">Quote</option>
			<option value="pre">Code Block</option>
		</select>
	{:else if tool === 'font'}
		<select
			data-tool="font"
			class="tb-select tb-font"
			title="Font"
			aria-label="Font"
			value={font === null ? ' ' : font}
			onchange={(e) => {
				const key = (e.target as HTMLSelectElement).value;
				if (key !== ' ') onfont?.(key);
			}}
		>
			{#if font === null}
				<option value=" "></option>
			{/if}
			<option value="">{documentFont}</option>
			{#each fonts as choice (choice.key)}
				<option value={choice.key} style:font-family={choice.css}>{choice.name}</option>
			{/each}
		</select>
	{:else if tool === 'fontSize'}
		<select
			data-tool="fontSize"
			class="tb-select tb-size"
			title="Font size"
			aria-label="Font size"
			value={fontSize === null ? '' : String(fontSize)}
			onchange={(e) => {
				const points = Number((e.target as HTMLSelectElement).value);
				if (points > 0) onfontsize?.(points);
			}}
		>
			{#if fontSize === null}
				<option value=""></option>
			{/if}
			{#each sizeChoices as size (size)}
				<option value={String(size)}>{size}</option>
			{/each}
		</select>
	{:else if tool === 'bold'}
		<ToolbarButton tool="bold" active={formatState.bold} title="Bold (Ctrl+B)" onclick={() => exec('bold')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
		</ToolbarButton>
	{:else if tool === 'italic'}
		<ToolbarButton tool="italic" active={formatState.italic} title="Italic (Ctrl+I)" onclick={() => exec('italic')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
		</ToolbarButton>
	{:else if tool === 'underline'}
		<ToolbarButton tool="underline" active={formatState.underline} title="Underline (Ctrl+U)" onclick={() => exec('underline')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>
		</ToolbarButton>
	{:else if tool === 'strikethrough'}
		<ToolbarButton tool="strikethrough" active={formatState.strikeThrough} title="Strikethrough" onclick={() => exec('strikeThrough')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 4c-.5-1.5-2.5-3-5-3-3 0-5 2-5 4.5 0 2 1 3.5 5 5"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M8 20c.5 1.5 2.5 3 5 3 3 0 5-2 5-4.5 0-1.5-.5-2.5-2-3.5"/></svg>
		</ToolbarButton>
	{:else if tool === 'textColor'}
		<ColorPicker tool="textColor" value="#2C2520" title="Text color" onchange={(c) => exec('foreColor', c)} />
	{:else if tool === 'clearFormatting'}
		<ToolbarButton tool="clearFormatting" title="Clear formatting" onclick={() => exec('removeFormat')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><line x1="18" y1="4" x2="4" y2="20" stroke="var(--accent)" stroke-width="2"/></svg>
		</ToolbarButton>
	{:else if tool === 'bulletList'}
		<ToolbarButton tool="bulletList" active={formatState.bulletList} title="Bullet list" onclick={() => exec('insertUnorderedList')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="18" r="1.5" fill="currentColor"/></svg>
		</ToolbarButton>
	{:else if tool === 'numberedList'}
		<ToolbarButton tool="numberedList" active={formatState.numberedList} title="Numbered list" onclick={() => exec('insertOrderedList')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="3" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="3" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="3" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
		</ToolbarButton>
	{:else if tool === 'alignLeft'}
		<ToolbarButton tool="alignLeft" title="Align left" onclick={() => exec('justifyLeft')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
		</ToolbarButton>
	{:else if tool === 'alignCenter'}
		<ToolbarButton tool="alignCenter" title="Align center" onclick={() => exec('justifyCenter')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
		</ToolbarButton>
	{:else if tool === 'alignRight'}
		<ToolbarButton tool="alignRight" title="Align right" onclick={() => exec('justifyRight')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
		</ToolbarButton>
	{:else if tool === 'outdent'}
		<ToolbarButton tool="outdent" title="Decrease indent (Ctrl+[)" onclick={() => exec('outdent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="11" y1="10" x2="21" y2="10"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="7 9 4 12 7 15"/></svg>
		</ToolbarButton>
	{:else if tool === 'indent'}
		<ToolbarButton tool="indent" title="Increase indent (Ctrl+])" onclick={() => exec('indent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="11" y1="10" x2="21" y2="10"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="4 9 7 12 4 15"/></svg>
		</ToolbarButton>
	{:else if tool === 'hangingOutdent'}
		<ToolbarButton tool="hangingOutdent" title="Decrease hanging indent" onclick={() => exec('hangingOutdent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="11" y1="10" x2="21" y2="10"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="11" y1="19" x2="21" y2="19"/><polyline points="7 11.5 4 14.5 7 17.5"/></svg>
		</ToolbarButton>
	{:else if tool === 'hangingIndent'}
		<ToolbarButton tool="hangingIndent" title="Increase hanging indent" onclick={() => exec('hangingIndent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="11" y1="10" x2="21" y2="10"/><line x1="11" y1="14" x2="21" y2="14"/><line x1="11" y1="19" x2="21" y2="19"/><polyline points="4 11.5 7 14.5 4 17.5"/></svg>
		</ToolbarButton>
	{:else if tool === 'hangAtCaret'}
		<ToolbarButton tool="hangAtCaret" title="Hang at caret" onclick={() => exec('hangAtCaret')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="7" y2="5"/><line x1="14" y1="5" x2="21" y2="5"/><line x1="10.5" y1="2" x2="10.5" y2="8" stroke="var(--accent, currentColor)"/><line x1="10.5" y1="11" x2="21" y2="11"/><line x1="10.5" y1="15" x2="21" y2="15"/><line x1="10.5" y1="19" x2="21" y2="19"/></svg>
		</ToolbarButton>
	{:else if tool === 'rightOutdent'}
		<ToolbarButton tool="rightOutdent" title="Decrease right indent" onclick={() => exec('rightOutdent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="10" x2="13" y2="10"/><line x1="3" y1="14" x2="13" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="17 9 20 12 17 15"/></svg>
		</ToolbarButton>
	{:else if tool === 'rightIndent'}
		<ToolbarButton tool="rightIndent" title="Increase right indent" onclick={() => exec('rightIndent')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="3" y1="10" x2="13" y2="10"/><line x1="3" y1="14" x2="13" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/><polyline points="20 9 17 12 20 15"/></svg>
		</ToolbarButton>
	{:else if tool === 'spacing'}
		<select class="tb-select tb-spacing" data-tool="spacing" title="Line and paragraph spacing" aria-label="Line and paragraph spacing" value="" onchange={chooseSpacing}>
			<option value="" hidden>Spacing</option>
			<optgroup label="Line spacing">
				{#each lineChoices as lines (lines)}
					<option value="lineSpacing:{lines}">{mark(spacing.line === lines)}{lines === 1 ? '1.0' : lines === 2 ? '2.0' : lines}</option>
				{/each}
				<option value="lineSpacing:none">{mark(spacing.line === null)}Default</option>
			</optgroup>
			<optgroup label="Space before paragraph">
				{#each beforeChoices as points (points)}
					<option value="spaceBefore:{points}">{mark(spacing.before === points)}{points} pt</option>
				{/each}
			</optgroup>
			<optgroup label="Space after paragraph">
				{#each afterChoices as points (points)}
					<option value="spaceAfter:{points}">{mark(spacing.after === points)}{points} pt</option>
				{/each}
			</optgroup>
			{#if spacing.gap !== undefined}
				<optgroup label="Bullet or number gap">
					{#each gapChoices as points (points)}
						<option value="markerGap:{points}">{mark(spacing.gap === points)}{points} pt</option>
					{/each}
					<option value="markerGap:none">{mark(spacing.gap === null)}Default</option>
				</optgroup>
			{/if}
		</select>
	{:else if tool === 'copyFormat'}
		<ToolbarButton tool="copyFormat" active={copyingFormat} title="Copy format" onclick={oncopyformat}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="6" rx="1.5"/><path d="M17 6h3v5h-9v3"/><rect x="9.5" y="14" width="3" height="7" rx="1"/></svg>
		</ToolbarButton>
	{:else if tool === 'link'}
		<ToolbarButton tool="link" title="Insert link (Ctrl+K)" onclick={oninsertlink}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
		</ToolbarButton>
	{:else if tool === 'image'}
		<ToolbarButton tool="image" title="Insert image" onclick={oninsertimage}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
		</ToolbarButton>
	{:else if tool === 'table'}
		<ToolbarButton tool="table" title="Insert table" onclick={oninserttable}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
		</ToolbarButton>
	{:else if tool === 'horizontalRule'}
		<ToolbarButton tool="horizontalRule" title="Horizontal rule" onclick={() => exec('insertHorizontalRule')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>
		</ToolbarButton>
	{:else if tool === 'undo'}
		<ToolbarButton tool="undo" title="Undo (Ctrl+Z)" onclick={() => exec('undo')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7v6h6"/><path d="M3 13c0 0 2.03-7 9-7a9 9 0 0 1 9 9 9 9 0 0 1-9 9c-3.5 0-6-1.5-7.5-4"/></svg>
		</ToolbarButton>
	{:else if tool === 'redo'}
		<ToolbarButton tool="redo" title="Redo" onclick={() => exec('redo')}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 7v6h-6"/><path d="M21 13c0 0-2.03-7-9-7a9 9 0 0 0-9 9 9 9 0 0 0 9 9c3.5 0 6-1.5 7.5-4"/></svg>
		</ToolbarButton>
	{/if}
{/snippet}

<!-- A row of the toolbar: its sections, a divider between two of them. `tail` goes after its
     last group, held to it: a row that wraps has it at the end of its last line, not alone. -->
{#snippet row(sections: ToolbarTool[][][], tail?: Snippet)}
	{#each sections as section, i}
		{#if i > 0}
			<div class="toolbar-divider"></div>
		{/if}
		{#each section as group, j}
			{#if tail && i === sections.length - 1 && j === section.length - 1}
				<div class="toolbar-tail">
					{@render toolGroup(group)}
					{@render tail()}
				</div>
			{:else}
				{@render toolGroup(group)}
			{/if}
		{/each}
	{/each}
	{#if tail && sections.length === 0}
		{@render tail()}
	{/if}
{/snippet}

{#snippet toolGroup(group: ToolbarTool[])}
	<div class="toolbar-group">
		{#each group as tool (tool)}
			{@render control(tool)}
		{/each}
	</div>
{/snippet}

<!-- The end of the first row where there is a second: the application's own controls, then More. -->
{#snippet firstRowEnd()}
	{@render end?.()}
	<!-- (One width for both words: what is before it, and the row under it, stay where they are.) -->
	<button
		type="button"
		class="tb-more"
		data-tool-more
		aria-expanded={moreOpen}
		aria-controls={moreId}
		onmousedown={(e) => e.preventDefault()}
		onclick={() => onmoretoggle?.(!moreOpen)}
	>
		<span class:shown={!moreOpen}>{moreLabel}</span>
		<span class:shown={moreOpen}>{lessLabel}</span>
	</button>
{/snippet}

<div class="toolbar" class:two-rows={moreRow.length > 0} role="toolbar" aria-label="Formatting">
	{#if moreRow.length > 0}
		<div class="toolbar-row">
			{@render row(firstRow, firstRowEnd)}
		</div>
		<div class="toolbar-row toolbar-more" id={moreId} hidden={!moreOpen}>
			{@render row(moreRow)}
		</div>
	{:else}
		{@render row(firstRow)}
		{@render end?.()}
	{/if}
</div>

<style>
	/* (Where it stands, and that it stays in sight of a long document, is the editor's: see
	   .ink-head there. Its ground is not see-through: the document passes under it.) */
	.toolbar {
		background: var(--bg-toolbar, #fff);
		border: 1px solid var(--border, #e5e2dc);
		border-radius: var(--radius, 8px);
		padding: 6px 8px;
		display: flex;
		align-items: center;
		gap: 2px;
		flex-wrap: wrap;
		box-shadow: var(--shadow-sm);
	}

	/* With a More button the toolbar is two rows, one under the other: the second does not
	   move the first, and the first wraps on a narrow page with the button at its end. */
	.toolbar.two-rows {
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
	}

	.toolbar-row {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-wrap: wrap;
	}

	.toolbar-row[hidden] {
		display: none;
	}

	.toolbar-more {
		padding-top: 4px;
		border-top: 1px solid var(--border, #e5e2dc);
	}

	/* A word, not an icon; one width for both words (the two are laid over one another). */
	.toolbar-tail {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.tb-more {
		display: inline-grid;
		align-items: center;
		justify-items: center;
		height: 32px;
		margin-left: 4px;
		padding: 0 12px;
		border: 1px solid var(--border, #d9d4cc);
		border-radius: 8px;
		background: transparent;
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
	}

	.tb-more > span {
		grid-area: 1 / 1;
		visibility: hidden;
	}

	.tb-more > span.shown {
		visibility: visible;
	}

	.tb-more:hover {
		background: var(--surface, #f6f4f0);
		border-color: var(--border-active, #b8ab98);
		color: var(--text);
	}

	.tb-more[aria-expanded='true'] {
		background: var(--accent-soft, #ede9fe);
		color: var(--text);
	}

	.tb-more:focus-visible {
		outline: none;
		border-color: var(--accent, #6e56cf);
		box-shadow: 0 0 0 3px var(--accent-soft, #ede9fe);
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.toolbar-divider {
		width: 1px;
		height: 24px;
		background: var(--border);
		margin: 0 6px;
		flex-shrink: 0;
	}

	/* The lists are boxes one can see: a list that shows nothing (a selection in two fonts, or
	   in two sizes) is still there to be chosen from. */
	.tb-select {
		height: 32px;
		margin: 0 3px;
		padding: 0 26px 0 11px;
		border: 1px solid var(--border, #d9d4cc);
		border-radius: 8px;
		background-color: var(--bg-select, transparent);
		font-family: 'DM Sans', sans-serif;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color var(--transition, 150ms ease),
			background-color var(--transition, 150ms ease),
			box-shadow var(--transition, 150ms ease);
		appearance: none;
		-webkit-appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A7E72' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 8px center;
	}

	/* Wide enough for a font's name, and no narrower when it shows none. */
	.tb-font {
		min-width: 9em;
		max-width: 12em;
	}

	/* Two or three digits: narrower than the list of paragraph kinds. */
	.tb-size {
		min-width: 62px;
	}

	/* It shows its name, not the longest of its choices. */
	.tb-spacing {
		width: 6.6em;
	}

	/* (The color alone: `background` would take the arrow off with it.) */
	.tb-select:hover {
		background-color: var(--surface, #f6f4f0);
		border-color: var(--border-active, #b8ab98);
		color: var(--text);
	}

	.tb-select:focus-visible {
		outline: none;
		border-color: var(--accent, #6e56cf);
		box-shadow: 0 0 0 3px var(--accent-soft, #ede9fe);
	}
</style>
