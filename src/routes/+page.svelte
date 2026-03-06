<script lang="ts">
	import { rtfToHtml } from '$lib/rtf-parser.js';
	import { htmlToRtf } from '$lib/rtf-writer.js';

	// Add your RTF test cases here. Each entry shows side-by-side in the dev page.
	const cases: { label: string; rtf: string }[] = [
		{
			label: 'Basic formatting',
			rtf: String.raw`{\rtf1\ansi\deff0 {\fonttbl{\f0 Times New Roman;}}Plain, \b bold\b0 , \i italic\i0 , \ul underline\ulnone .}`
		},
		{
			label: 'Paragraphs',
			rtf: String.raw`{\rtf1\ansi First paragraph.\par Second paragraph.\par\par After blank line.}`
		},
		{
			label: 'Colors',
			rtf: String.raw`{\rtf1\ansi\deff0 {\colortbl\red255\green0\blue0;\red0\green128\blue0;\red0\green0\blue255;}Normal, \cf1 red\cf0 , \cf2 green\cf0 , \cf3 blue\cf0 .}`
		},
		// ── Bug reproductions ──────────────────────────────────────────────────
		// Add entries here to visually inspect failing RTF.
		{
			label: 'Bug: blank lines after bullet sections dropped (TST-AP-S-0003)',
			rtf: String.raw`{\rtf1\ansi\deff0 {\fonttbl {\f0 Arial;}}
{\b A. UTERUS, CERVIX, BILATERAL TUBES AND OVARIES:}\par \bullet Endometrioid adenocarcinoma, FIGO grade 1.\line \bullet Myometrial invasion present: 28% (0.5 cm of 1.8 cm).\line \bullet Cervix: negative for carcinoma.\line \bullet Bilateral ovaries and fallopian tubes: negative for carcinoma.\par \par {\b B. RIGHT PELVIC SENTINEL LYMPH NODE:}\par \bullet One lymph node, negative for metastatic carcinoma (0/1).\par \par {\b C. LEFT PELVIC SENTINEL LYMPH NODE:}\par \bullet One lymph node, negative for metastatic carcinoma (0/1).\par \par {\b COMMENT:}\par MMR protein immunohistochemistry shows intact expression of MLH1, PMS2, MSH2, and MSH6.\par }`
		},
	];

	function parse(rtfString: string): string {
		try {
			return rtfToHtml(rtfString);
		} catch (e) {
			return `<pre style="color:red">${e}</pre>`;
		}
	}

	let copied = $state<string | null>(null);

	async function copySource(label: string, rtfString: string) {
		await navigator.clipboard.writeText(rtfString);
		copied = label + ':source';
		setTimeout(() => (copied = null), 1500);
	}

	async function copyRoundtrip(label: string, rtfString: string) {
		const html = parse(rtfString);
		const container = document.createElement('div');
		container.innerHTML = html;
		const rtf = htmlToRtf(container);
		await navigator.clipboard.writeText(rtf);
		copied = label + ':roundtrip';
		setTimeout(() => (copied = null), 1500);
	}
</script>

<style>
	body { font-family: sans-serif; margin: 0; }
	h1 { padding: 1rem; margin: 0; font-size: 1.2rem; background: #f0f0f0; border-bottom: 1px solid #ccc; }
	.cases { display: flex; flex-direction: column; gap: 0; }
	.case { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #ddd; }
	.case-label { grid-column: 1 / -1; padding: 0.4rem 1rem; background: #e8e8e8; font-weight: bold; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; }
	button { font-size: 0.75rem; padding: 0.2rem 0.6rem; cursor: pointer; border: 1px solid #aaa; border-radius: 3px; background: white; }
	button.copied { background: #d4edda; border-color: #5a9e6f; color: #2d6a4f; }
	.pane { padding: 1rem; overflow: auto; }
	.pane + .pane { border-left: 1px solid #ddd; }
	pre { margin: 0; white-space: pre-wrap; font-size: 0.75rem; color: #444; }
	.rendered { font-family: serif; }
</style>

<h1>RTF Parser — Visual Test Cases</h1>

<div class="cases">
	{#each cases as c}
		<div class="case">
			<div class="case-label">
				<span>{c.label}</span>
				<span>
					<button class:copied={copied === c.label + ':source'} onclick={() => copySource(c.label, c.rtf)}>
						{copied === c.label + ':source' ? 'Copied!' : 'Copy source RTF'}
					</button>
					<button class:copied={copied === c.label + ':roundtrip'} onclick={() => copyRoundtrip(c.label, c.rtf)}>
						{copied === c.label + ':roundtrip' ? 'Copied!' : 'Copy round-trip RTF'}
					</button>
				</span>
			</div>
			<div class="pane"><pre>{c.rtf}</pre></div>
			<div class="pane rendered">{@html parse(c.rtf)}</div>
		</div>
	{/each}
</div>
