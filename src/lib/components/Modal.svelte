<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		title?: string;
		onclose?: () => void;
		children: Snippet;
		actions?: Snippet;
	}

	let { open = false, title = '', onclose, children, actions }: Props = $props();

	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose?.();
	}
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={handleOverlayClick}>
		<div class="modal">
			<h3>{title}</h3>
			{@render children()}
			{#if actions}
				<div class="modal-actions">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(44, 37, 32, 0.3);
		backdrop-filter: blur(4px);
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		animation: fadeOverlay 0.15s ease-out;
	}

	@keyframes fadeOverlay {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.modal {
		background: white;
		border-radius: var(--radius);
		padding: 28px;
		width: 420px;
		max-width: 90vw;
		box-shadow: var(--shadow-lg);
		animation: slideUp 0.2s ease-out;
	}

	@keyframes slideUp {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.modal h3 {
		font-family: 'Instrument Serif', serif;
		font-size: 22px;
		margin-bottom: 16px;
		color: var(--ink);
	}

	.modal :global(input[type='text']),
	.modal :global(input[type='url']) {
		width: 100%;
		padding: 10px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-family: 'DM Sans', sans-serif;
		font-size: 14px;
		margin-bottom: 12px;
		outline: none;
		transition: border-color var(--transition);
	}

	.modal :global(input:focus) {
		border-color: var(--accent);
	}

	.modal-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-top: 8px;
	}
</style>
