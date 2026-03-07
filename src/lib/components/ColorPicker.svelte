<script lang="ts">
	interface Props {
		value?: string;
		title?: string;
		onchange?: (color: string) => void;
	}

	let { value = $bindable('#2C2520'), title = 'Color', onchange }: Props = $props();

	function handleChange(e: Event) {
		value = (e.target as HTMLInputElement).value;
		onchange?.(value);
	}
</script>

<div class="color-picker-wrap">
	<button class="color-swatch" {title} type="button">
		<div class="color-swatch-inner" style="background: {value};"></div>
	</button>
	<input
		type="color"
		class="color-input"
		value={value}
		onchange={handleChange}
		{title}
	/>
</div>

<style>
	.color-picker-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}

	.color-swatch {
		width: 34px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all var(--transition);
	}

	.color-swatch:hover {
		background: var(--surface);
	}

	.color-swatch-inner {
		width: 18px;
		height: 18px;
		border-radius: 4px;
		border: 2px solid var(--border);
		transition: all var(--transition);
	}

	.color-input {
		position: absolute;
		width: 34px;
		height: 34px;
		opacity: 0;
		cursor: pointer;
		top: 0;
		left: 0;
	}
</style>
