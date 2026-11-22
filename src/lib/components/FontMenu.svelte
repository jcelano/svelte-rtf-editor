<script lang="ts">
	/**
	 * The font menu a right-click on the text opens (InkEditor's `fontMenu`): the document's
	 * font and the fonts offered, each in itself, the font of the selected text checked. It
	 * takes the keyboard while it is open: the arrows, Home and End move in it, Enter or Space
	 * chooses, Escape or Tab closes it. A press anywhere else closes it, and so do a scroll
	 * and the window losing the keyboard.
	 */
	import { onMount, tick } from 'svelte';

	interface Choice {
		key: string;
		name: string;
		css: string;
	}

	interface Props {
		/** Where the menu opens, in the window's coordinates: its top left corner. */
		x: number;
		y: number;
		/** The choices, the document's own font first, with the key ''. */
		choices: Choice[];
		/** The key of the font of the selected text; null where it is in more than one. */
		current: string | null;
		onpick: (key: string) => void;
		/** `refocus`: the menu was left from the keyboard, and the text should have it back. */
		onclose: (refocus: boolean) => void;
	}

	let { x, y, choices, current, onpick, onclose }: Props = $props();

	let menuEl: HTMLDivElement | null = $state(null);
	/** Where the menu is shown: where it opens, moved in so that all of it is in the window. */
	let left = $state(0);
	let top = $state(0);

	const MARGIN = 8;

	function items(): HTMLElement[] {
		return menuEl ? Array.from(menuEl.querySelectorAll<HTMLElement>('[role="menuitemradio"]')) : [];
	}

	function focusItem(index: number): void {
		const all = items();
		if (all.length === 0) return;
		all[(index + all.length) % all.length].focus();
	}

	onMount(() => {
		left = x;
		top = y;
		void tick().then(() => {
			if (!menuEl) return;
			const box = menuEl.getBoundingClientRect();
			left = Math.max(MARGIN, Math.min(x, window.innerWidth - box.width - MARGIN));
			top = y + box.height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - box.height) : y;
			const at = choices.findIndex((choice) => choice.key === current);
			focusItem(at < 0 ? 0 : at);
		});
	});

	function onkeydown(e: KeyboardEvent): void {
		const all = items();
		const at = all.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown') focusItem(at + 1);
		else if (e.key === 'ArrowUp') focusItem(at < 0 ? -1 : at - 1);
		else if (e.key === 'Home') focusItem(0);
		else if (e.key === 'End') focusItem(-1);
		else if (e.key === 'Escape' || e.key === 'Tab') onclose(true);
		else return;
		e.preventDefault();
		e.stopPropagation();
	}

	/** A press outside the menu closes it, and goes on to do what it does there. */
	function pressedOutside(e: PointerEvent): void {
		if (menuEl && !menuEl.contains(e.target as Node)) onclose(false);
	}
</script>

<svelte:window
	onpointerdowncapture={pressedOutside}
	onscrollcapture={(e) => {
		if (!menuEl?.contains(e.target as Node)) onclose(false);
	}}
	onresize={() => onclose(false)}
	onblur={() => onclose(false)}
/>

<div
	class="ink-font-menu"
	role="menu"
	aria-label="Font"
	tabindex="-1"
	style:left="{left}px"
	style:top="{top}px"
	bind:this={menuEl}
	{onkeydown}
	oncontextmenu={(e) => e.preventDefault()}
>
	<div class="ink-font-menu-title" aria-hidden="true">Font</div>
	{#each choices as choice (choice.key)}
		<button
			type="button"
			role="menuitemradio"
			aria-checked={choice.key === current}
			tabindex="-1"
			style:font-family={choice.css}
			onmousedown={(e) => e.preventDefault()}
			onclick={() => onpick(choice.key)}
		>
			<span class="ink-font-menu-check" aria-hidden="true">{choice.key === current ? '✓' : ''}</span>
			{choice.name}
		</button>
	{/each}
	<div class="ink-font-menu-note" aria-hidden="true">Shift + right-click: the browser's menu</div>
</div>

<style>
	.ink-font-menu {
		position: fixed;
		z-index: 1000;
		box-sizing: border-box;
		min-width: 190px;
		max-width: min(320px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow-y: auto;
		padding: 4px;
		border: 1px solid var(--border, #d9d4cc);
		border-radius: 10px;
		background: var(--bg, #fff);
		color: var(--text, #1a1714);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
		font-family: 'DM Sans', system-ui, sans-serif;
		font-size: 14px;
	}

	.ink-font-menu:focus {
		outline: none;
	}

	.ink-font-menu-title {
		padding: 4px 10px 2px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted, #8a7e72);
	}

	.ink-font-menu button {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 10px 6px 6px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font-size: 15px;
		text-align: left;
		cursor: pointer;
	}

	.ink-font-menu button:hover,
	.ink-font-menu button:focus-visible,
	.ink-font-menu button:focus {
		outline: none;
		background: var(--accent-soft, #ede9fe);
	}

	.ink-font-menu-check {
		display: inline-block;
		width: 1.1em;
		font-family: 'DM Sans', system-ui, sans-serif;
		color: var(--accent, #6e56cf);
	}

	.ink-font-menu-note {
		margin-top: 4px;
		padding: 6px 10px 4px;
		border-top: 1px solid var(--border, #d9d4cc);
		font-size: 11px;
		color: var(--text-muted, #8a7e72);
	}
</style>
