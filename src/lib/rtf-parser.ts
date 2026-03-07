/**
 * RTF to HTML converter
 *
 * Parses RTF control words and groups into an HTML string.
 * Supports: bold, italic, underline, strikethrough, super/subscript,
 * font size, foreground color (\cf), highlight background color (\highlight),
 * color table, font table, paragraphs, bullet/numbered lists,
 * Unicode characters, hex escapes, and nested groups.
 *
 * \cb (character background) is silently ignored on import.
 */

// ── Types ──

interface RtfGroup {
	type: 'group';
	children: RtfNode[];
}

interface RtfControl {
	type: 'control';
	word: string;
	param: number | null;
}

interface RtfText {
	type: 'text';
	value: string;
}

type RtfNode = RtfGroup | RtfControl | RtfText;

type Token =
	| { type: 'open' }
	| { type: 'close' }
	| { type: 'control'; word: string; param: number | null }
	| { type: 'text'; value: string };

interface RenderState {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	super_: boolean;
	sub: boolean;
	fontSize: number;
	colorIndex: number;
	highlightIndex: number;
	fontIndex: number;
	ucSkip: number;
	inList: boolean;
}

// ── Highlight palette (RTF \highlight 1-16) ──

const HIGHLIGHT_COLORS: Record<number, string> = {
	1:  '#000000', // Black
	2:  '#0000ff', // Blue
	3:  '#00ffff', // Cyan
	4:  '#00ff00', // Green
	5:  '#ff00ff', // Magenta
	6:  '#ff0000', // Red
	7:  '#ffff00', // Yellow
	8:  '#ffffff', // White
	9:  '#000080', // Dark Blue
	10: '#008080', // Dark Cyan
	11: '#008000', // Dark Green
	12: '#800080', // Dark Magenta
	13: '#800000', // Dark Red
	14: '#808000', // Dark Yellow
	15: '#808080', // Dark Gray
	16: '#c0c0c0', // Light Gray
};

// ── Tokenizer ──

function tokenize(rtf: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const len = rtf.length;

	while (i < len) {
		const ch = rtf[i];

		if (ch === '{') {
			tokens.push({ type: 'open' });
			i++;
		} else if (ch === '}') {
			tokens.push({ type: 'close' });
			i++;
		} else if (ch === '\\') {
			i++;
			if (i >= len) break;

			const next = rtf[i];

			// Hex escape \'xx
			if (next === "'") {
				i++;
				const hex = rtf.substring(i, i + 2);
				i += 2;
				const code = parseInt(hex, 16);
				tokens.push({ type: 'text', value: String.fromCharCode(code) });
			}
			// Special escapes
			else if (next === '\\' || next === '{' || next === '}') {
				tokens.push({ type: 'text', value: next });
				i++;
			}
			// Line breaks as control
			else if (next === '\n' || next === '\r') {
				tokens.push({ type: 'control', word: 'par', param: null });
				i++;
				if (i < len && rtf[i] === '\n') i++;
			}
			// Tilde = non-breaking space
			else if (next === '~') {
				tokens.push({ type: 'text', value: '\u00A0' });
				i++;
			}
			// Hyphen shortcuts
			else if (next === '-') {
				tokens.push({ type: 'text', value: '\u00AD' }); // soft hyphen
				i++;
			} else if (next === '_') {
				tokens.push({ type: 'text', value: '\u2011' }); // non-breaking hyphen
				i++;
			}
			// Control word or control symbol
			else if (/[a-zA-Z]/.test(next)) {
				let word = '';
				while (i < len && /[a-zA-Z]/.test(rtf[i])) {
					word += rtf[i];
					i++;
				}
				// Optional numeric parameter (can be negative)
				let param: number | null = null;
				if (i < len && (rtf[i] === '-' || /[0-9]/.test(rtf[i]))) {
					let numStr = '';
					if (rtf[i] === '-') {
						numStr += '-';
						i++;
					}
					while (i < len && /[0-9]/.test(rtf[i])) {
						numStr += rtf[i];
						i++;
					}
					param = parseInt(numStr, 10);
				}
				// Consume optional trailing space delimiter
				if (i < len && rtf[i] === ' ') i++;

				tokens.push({ type: 'control', word, param });
			}
			// Control symbol (single non-alpha char)
			else {
				tokens.push({ type: 'control', word: next, param: null });
				i++;
			}
		} else if (ch === '\r' || ch === '\n') {
			// Skip bare newlines (they're not meaningful in RTF)
			i++;
		} else {
			// Plain text - gather until next special char
			let text = '';
			while (i < len && rtf[i] !== '\\' && rtf[i] !== '{' && rtf[i] !== '}' && rtf[i] !== '\r' && rtf[i] !== '\n') {
				text += rtf[i];
				i++;
			}
			if (text) {
				tokens.push({ type: 'text', value: text });
			}
		}
	}

	return tokens;
}

// ── AST Builder ──

function buildTree(tokens: Token[]): RtfGroup {
	const root: RtfGroup = { type: 'group', children: [] };
	const stack: RtfGroup[] = [root];

	for (const tok of tokens) {
		const current = stack[stack.length - 1];

		if (tok.type === 'open') {
			const group: RtfGroup = { type: 'group', children: [] };
			current.children.push(group);
			stack.push(group);
		} else if (tok.type === 'close') {
			if (stack.length > 1) stack.pop();
		} else if (tok.type === 'control') {
			current.children.push({ type: 'control', word: tok.word, param: tok.param ?? null });
		} else if (tok.type === 'text') {
			current.children.push({ type: 'text', value: tok.value });
		}
	}

	return root;
}

// ── Color table parser ──

function parseColorTable(group: RtfGroup): string[] {
	const colors: string[] = [''];  // index 0 = auto/default (black)
	let r = 0, g = 0, b = 0;

	for (const node of group.children) {
		if (node.type === 'control') {
			if (node.word === 'red') r = node.param ?? 0;
			else if (node.word === 'green') g = node.param ?? 0;
			else if (node.word === 'blue') b = node.param ?? 0;
		} else if (node.type === 'text' && node.value.includes(';')) {
			// Each ';' terminates one color entry
			const semiCount = (node.value.match(/;/g) || []).length;
			for (let i = 0; i < semiCount; i++) {
				colors.push(`rgb(${r},${g},${b})`);
				r = 0; g = 0; b = 0;
			}
		}
	}

	return colors;
}

// ── Font table parser ──

function parseFontTable(group: RtfGroup): Map<number, string> {
	const fonts = new Map<number, string>();

	for (const child of group.children) {
		if (child.type === 'group') {
			let fNum = 0;
			let fName = '';
			for (const node of child.children) {
				if (node.type === 'control' && node.word === 'f' && node.param != null) {
					fNum = node.param;
				}
				if (node.type === 'text') {
					fName += node.value;
				}
			}
			// Remove trailing semicolons
			fName = fName.replace(/;$/, '').trim();
			if (fName) fonts.set(fNum, fName);
		}
	}

	return fonts;
}

// ── Renderer ──

export function rtfToHtml(rtfString: string): string {
	const tokens = tokenize(rtfString);
	const tree = buildTree(tokens);

	let colorTable: string[] = [''];
	let fontTable = new Map<number, string>();
	let currentParagraph = '';
	let paragraphs: string[] = [];
	let paragraphHasText = false;
	let paragraphHasListMarker = false;

	// First pass: extract color table and font table from the root group
	const rootGroup = tree.children[0]?.type === 'group' ? (tree.children[0] as RtfGroup) : tree;

	for (let i = 0; i < rootGroup.children.length; i++) {
		const child = rootGroup.children[i];
		if (child.type === 'group') {
			const firstControl = child.children.find((n) => n.type === 'control') as RtfControl | undefined;
			if (firstControl?.word === 'colortbl') {
				colorTable = parseColorTable(child);
			} else if (firstControl?.word === 'fonttbl') {
				fontTable = parseFontTable(child);
			}
		}
	}

	// State stack for nested groups
	function defaultState(): RenderState {
		return {
			bold: false,
			italic: false,
			underline: false,
			strike: false,
			super_: false,
			sub: false,
			fontSize: 24, // 12pt default
			colorIndex: 0,
			highlightIndex: 0,
			fontIndex: 0,
			ucSkip: 1,
			inList: false,
		};
	}

	const stateStack: RenderState[] = [defaultState()];

	function currentState(): RenderState {
		return stateStack[stateStack.length - 1];
	}

	function cloneState(): RenderState {
		return { ...currentState() };
	}

	function buildSpanOpen(state: RenderState): string {
		const styles: string[] = [];

		if (state.colorIndex > 0 && state.colorIndex < colorTable.length) {
			const color = colorTable[state.colorIndex];
			if (color && color !== 'rgb(0,0,0)') {
				styles.push(`color:${color}`);
			}
		}

		if (state.highlightIndex > 0) {
			const bg = HIGHLIGHT_COLORS[state.highlightIndex];
			if (bg) styles.push(`background-color:${bg}`);
		}

		const ptSize = state.fontSize / 2;
		if (ptSize && ptSize !== 12) {
			styles.push(`font-size:${ptSize}pt`);
		}

		if (styles.length === 0) return '';
		return `<span style="${styles.join(';')}">`;
	}

	function wrapText(text: string, state: RenderState): string {
		if (!text) return '';

		let result = text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');

		// Apply span styles
		const spanOpen = buildSpanOpen(state);
		if (spanOpen) {
			result = `${spanOpen}${result}</span>`;
		}

		if (state.bold) result = `<strong>${result}</strong>`;
		if (state.italic) result = `<em>${result}</em>`;
		if (state.underline) result = `<u>${result}</u>`;
		if (state.strike) result = `<s>${result}</s>`;
		if (state.super_) result = `<sup>${result}</sup>`;
		if (state.sub) result = `<sub>${result}</sub>`;

		return result;
	}

	let skipDepth = 0;

	const destinationWords = new Set([
		'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer',
		'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf',
		'pict', 'object', 'fldinst', 'xmlnstbl', 'listtable', 'listoverridetable',
		'rsidtbl', 'generator', 'datafield', 'themedata', 'colorschememapping',
		'latentstyles', 'datastore', 'mmathPr', 'author', 'operator',
		'title', 'subject', 'doccomm', 'company', 'category', 'keywords'
	]);

	function flushParagraph() {
		const trimmed = currentParagraph.trim();
		if (!trimmed) {
			if (!paragraphHasListMarker) {
				paragraphs.push(currentParagraph);
			}
		} else {
			paragraphs.push(currentParagraph);
		}
		currentParagraph = '';
		paragraphHasText = false;
		paragraphHasListMarker = false;
	}

	let pendingUnicodeSkip = 0;

	function walk(nodes: RtfNode[]) {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];

			if (skipDepth > 0 && node.type !== 'group') {
				continue;
			}

			if (node.type === 'group') {
				if (skipDepth > 0) {
					skipDepth++;
					walk(node.children);
					skipDepth--;
					continue;
				}

				const firstCtrl = node.children.find((n) => n.type === 'control') as RtfControl | undefined;
				if (firstCtrl && destinationWords.has(firstCtrl.word)) {
					continue;
				}

				const hasStarDest = node.children.length >= 2 &&
					node.children[0].type === 'control' && (node.children[0] as RtfControl).word === '*';
				if (hasStarDest) {
					continue;
				}

				stateStack.push(cloneState());
				walk(node.children);
				stateStack.pop();
			} else if (node.type === 'control') {
				const state = currentState();
				const w = node.word;
				const p = node.param;

				switch (w) {
					case 'b':
						state.bold = p !== 0;
						break;
					case 'i':
						state.italic = p !== 0;
						break;
					case 'ul':
					case 'ulnone':
						state.underline = w === 'ul' && p !== 0;
						break;
					case 'strike':
						state.strike = p !== 0;
						break;
					case 'super':
						state.super_ = true;
						state.sub = false;
						break;
					case 'sub':
						state.sub = true;
						state.super_ = false;
						break;
					case 'nosupersub':
						state.super_ = false;
						state.sub = false;
						break;
					case 'fs':
						if (p != null) state.fontSize = p;
						break;
					case 'cf':
						if (p != null) state.colorIndex = p;
						break;
					case 'cb':
						break; // \cb not rendered on import
					case 'highlight':
						if (p != null) state.highlightIndex = p;
						break;
					case 'f':
						if (p != null) state.fontIndex = p;
						break;
					case 'par':
						flushParagraph();
						break;
					case 'pard':
						state.bold = false;
						state.italic = false;
						state.underline = false;
						state.strike = false;
						break;
					case 'line':
						currentParagraph += '<br>';
						paragraphHasText = true;
						break;
					case 'tab':
						currentParagraph += '&emsp;';
						paragraphHasText = true;
						break;
					case 'pntext':
					case 'listtext':
						state.inList = true;
						paragraphHasListMarker = true;
						break;
					case 'u': {
						if (p != null) {
							let codePoint = p;
							if (codePoint < 0) codePoint += 65536;
							currentParagraph += wrapText(String.fromCodePoint(codePoint), state);
							paragraphHasText = true;
							pendingUnicodeSkip = state.ucSkip ?? 1;
						}
						break;
					}
					case 'uc':
						if (p != null) {
							state.ucSkip = p;
						}
						break;
					case 'plain':
						state.bold = false;
						state.italic = false;
						state.underline = false;
						state.strike = false;
						state.super_ = false;
						state.sub = false;
						state.fontSize = 24;
						state.colorIndex = 0;
						state.highlightIndex = 0;
						state.fontIndex = 0;
						break;
					case 'page':
						flushParagraph();
						paragraphs.push('<hr>');
						break;
					case 'emspace':
					case 'enspace':
						currentParagraph += '&emsp;';
						paragraphHasText = true;
						break;
					case 'emdash':
						currentParagraph += '—';
						paragraphHasText = true;
						break;
					case 'endash':
						currentParagraph += '–';
						paragraphHasText = true;
						break;
					case 'lquote':
						currentParagraph += '\u2018';
						paragraphHasText = true;
						break;
					case 'rquote':
						currentParagraph += '\u2019';
						paragraphHasText = true;
						break;
					case 'ldblquote':
						currentParagraph += '\u201C';
						paragraphHasText = true;
						break;
					case 'rdblquote':
						currentParagraph += '\u201D';
						paragraphHasText = true;
						break;
					case 'bullet':
						currentParagraph += '\u2022';
						paragraphHasText = true;
						break;
					default:
						break;
				}
			} else if (node.type === 'text') {
				if (skipDepth > 0) continue;
				const state = currentState();
				if (pendingUnicodeSkip > 0) {
					const skipCount = Math.min(pendingUnicodeSkip, node.value.length);
					pendingUnicodeSkip -= skipCount;
					const remainder = node.value.slice(skipCount);
					if (remainder) {
						currentParagraph += wrapText(remainder, state);
						if (/[^\s]/.test(remainder)) paragraphHasText = true;
					}
					continue;
				}
				currentParagraph += wrapText(node.value, state);
				if (/[^\s]/.test(node.value)) paragraphHasText = true;
			}
		}
	}

	walk(rootGroup.children);
	// Only flush if there's actually pending content — the final \par in most RTF
	// files already flushed the last paragraph, so an unconditional call here
	// would push a spurious empty paragraph that becomes a trailing <p><br></p>.
	if (currentParagraph || paragraphHasText) {
		flushParagraph();
	}

	// Build final HTML from paragraphs (collapse repeated empty lines)
	const rendered: string[] = [];
	const trimmedParagraphs = paragraphs.map((p) => p.trim());
	const isListLine = (text: string) => /^[-\u2022]/.test(text.replace(/^&emsp;+/g, ''));

	for (let i = 0; i < trimmedParagraphs.length; i++) {
		const trimmed = trimmedParagraphs[i];
		const prev = i > 0 ? trimmedParagraphs[i - 1] : '';
		const next = i + 1 < trimmedParagraphs.length ? trimmedParagraphs[i + 1] : '';

		if (!trimmed) {
			if (isListLine(prev) && isListLine(next)) {
				continue;
			}
			const last = rendered[rendered.length - 1];
			if (last === '<p><br></p>') {
				continue;
			}
			rendered.push('<p><br></p>');
			continue;
		}

		if (trimmed === '<hr>') {
			rendered.push('<hr>');
			continue;
		}
		const sizeMatch = trimmed.match(/font-size:\s*([\d.]+)pt/);
		if (sizeMatch) {
			const pt = parseFloat(sizeMatch[1]);
			if (pt >= 24) { rendered.push(`<h1>${stripSizeSpan(trimmed)}</h1>`); continue; }
			if (pt >= 18) { rendered.push(`<h2>${stripSizeSpan(trimmed)}</h2>`); continue; }
			if (pt >= 14) { rendered.push(`<h3>${stripSizeSpan(trimmed)}</h3>`); continue; }
		}
		rendered.push(`<p>${trimmed}</p>`);
	}

	const output = rendered.join('\n');

	// fontTable is parsed (for future font rendering) but not yet used in output
	void fontTable;

	return output || '<p></p>';
}

function stripSizeSpan(html: string): string {
	return html.replace(/^<span style="[^"]*font-size:[^"]*">([\s\S]*)<\/span>$/, '$1');
}

export function readRtfFile(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const text = reader.result as string;
				const html = rtfToHtml(text);
				resolve(html);
			} catch (err) {
				reject(new Error(`Failed to parse RTF: ${(err as Error).message}`));
			}
		};
		reader.onerror = () => reject(new Error('Failed to read file'));
		reader.readAsText(file, 'ascii');
	});
}
