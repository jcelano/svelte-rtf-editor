/**
 * The toolbar's controls, by names that are part of the public API: an application chooses
 * which the toolbar has (`tools`) and which wait behind its More button (`moreTools`) by these,
 * and each control carries its name as `data-tool`. A name does not change when a control's
 * tooltip does. A control added in a later version gets a name of its own, and the release
 * notes say so.
 */

/**
 * The toolbar's layout: sections, set apart by dividers, of groups, of controls. A row of the
 * toolbar shows each section that has a control in it, and a divider only between two of them.
 */
export const TOOLBAR_SECTIONS = [
	[['block'], ['font'], ['fontSize']],
	[['bold', 'italic', 'underline', 'strikethrough']],
	[['textColor', 'clearFormatting']],
	[['bulletList', 'numberedList']],
	[['alignLeft', 'alignCenter', 'alignRight']],
	[['outdent', 'indent', 'hangingOutdent', 'hangingIndent', 'hangAtCaret', 'rightOutdent', 'rightIndent']],
	[['spacing']],
	[['copyFormat']],
	[['link', 'image', 'table', 'horizontalRule']],
	[['undo', 'redo']]
] as const;

/** The name of one of the toolbar's controls. */
export type ToolbarTool = (typeof TOOLBAR_SECTIONS)[number][number][number];

/** Every control of the toolbar, by name, in the toolbar's own order. */
export const TOOLBAR_TOOLS: readonly ToolbarTool[] = Object.freeze(TOOLBAR_SECTIONS.flat(2));

const KNOWN = new Set<string>(TOOLBAR_TOOLS);
const warned = new Set<string>();

/**
 * The known controls of a list an application gave, in the toolbar's own order. A name that
 * is no control is left out, with a warning in the console (once for each name).
 */
export function knownTools(given: readonly string[] | null | undefined, prop: string): Set<ToolbarTool> {
	const tools = new Set<ToolbarTool>();
	for (const name of Array.isArray(given) ? given : []) {
		if (KNOWN.has(name)) tools.add(name as ToolbarTool);
		else if (!warned.has(`${prop}:${name}`)) {
			warned.add(`${prop}:${name}`);
			console.warn(`svelte-rtf-editor: \`${prop}\` names "${name}", which is no toolbar control. Known: ${TOOLBAR_TOOLS.join(', ')}.`);
		}
	}
	return tools;
}

/**
 * The sections of one row of the toolbar: those of its layout that keep a control, with the
 * groups that keep one, with the controls `shown` has.
 */
export function toolbarRow(shown: (tool: ToolbarTool) => boolean): ToolbarTool[][][] {
	return TOOLBAR_SECTIONS.map((section) =>
		section.map((group) => group.filter(shown)).filter((group) => group.length > 0)
	).filter((section) => section.length > 0);
}
