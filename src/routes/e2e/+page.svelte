<script lang="ts">
	// The page the browser tests (e2e/) drive: one editor and one viewer, set up from the
	// address, with the library on `window` so a test can call it in the browser.
	import { onMount } from 'svelte';
	import * as lib from '../../lib/index.js';
	import { InkEditor, RtfViewer } from '../../lib/index.js';

	type Harness = { toggles?: boolean[]; ed?: unknown; lib?: typeof lib; setViewer?: (rtf: string) => void; changes?: number; saves?: string[] };

	let ed: ReturnType<typeof InkEditor> | null = $state(null);
	let rtf = $state('');
	let moreOpen = $state(false);
	const names = (value: string | null) => (value === null ? undefined : (value.split(',').filter(Boolean) as lib.ToolbarTool[]));
	let params = $state<{ autosave: boolean; content?: string; key?: string; onchange: boolean; keepAttributes: string[]; keepClasses: string[]; fonts: string[]; fontFamily?: string; fontMenu: boolean; tools?: lib.ToolbarTool[]; moreTools?: lib.ToolbarTool[]; toolbarEnd: boolean; width?: string; readonly: boolean; stickyToolbar: boolean } | null>(null);

	onMount(() => {
		const q = new URLSearchParams(location.search);
		params = {
			autosave: q.get('autosave') === '1',
			content: q.get('content') ?? undefined,
			key: q.get('key') ?? undefined,
			onchange: q.get('onchange') === '1',
			keepAttributes: (q.get('keepAttributes') ?? '').split(',').filter(Boolean),
			keepClasses: (q.get('keepClasses') ?? '').split(',').filter(Boolean),
			// (A font may be a list with commas of its own: the fonts are set apart by "|".)
			fonts: (q.get('fonts') ?? '').split('|').filter(Boolean),
			fontMenu: q.has('fontMenu'),
			tools: names(q.get('tools')),
			moreTools: names(q.get('moreTools')),
			toolbarEnd: q.has('toolbarEnd'),
			width: q.get('width') ?? undefined,
			fontFamily: q.get('fontFamily') ?? undefined,
			readonly: q.get('readonly') === '1',
			stickyToolbar: q.get('stickyToolbar') !== '0'
		};
		const w = window as unknown as Harness;
		w.lib = lib;
		w.changes = 0;
		w.toggles = [];
		moreOpen = q.get('moreOpen') === '1';
		w.saves = [];
		w.setViewer = (value: string) => (rtf = value);
	});

	$effect(() => {
		(window as unknown as Harness).ed = ed;
	});
</script>

{#snippet template()}
	<button type="button" id="template">Template</button>
{/snippet}

{#if params}
	<div id="editor-box" style:width={params.width}>
	<InkEditor
		bind:this={ed}
		autosave={params.autosave}
		content={params.content}
		storageKey={params.key}
		keepAttributes={params.keepAttributes}
		keepClasses={params.keepClasses}
		fonts={params.fonts}
		fontMenu={params.fontMenu}
		tools={params.tools}
		moreTools={params.moreTools}
		bind:moreOpen
		onmoretoggle={(open) => (window as unknown as Harness).toggles!.push(open)}
		toolbarEnd={params.toolbarEnd ? template : undefined}
		fontFamily={params.fontFamily}
		readonly={params.readonly}
		stickyToolbar={params.stickyToolbar}
		onchange={params.onchange ? () => { (window as unknown as Harness).changes!++; } : undefined}
		onsave={({ html }) => { (window as unknown as Harness).saves!.push(html); }}
	/>
	</div>
	<div id="viewer"><RtfViewer content={rtf} fonts={params.fonts} fontFamily={params.fontFamily} /></div>
{/if}
