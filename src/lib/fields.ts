/**
 * Fields (issue #56): places in a document the writer fills by choosing or typing. Only the
 * type ships so far, with `insertFragment()`, which returns the fields it put in; what it
 * returns does not change when fields arrive.
 */

/** A field of the document, as the editor reads it. */
export interface FieldInfo {
	/** The editor's; unique in the document; kept as `data-field-id`. */
	id: string;
	/** The application's (`data-field`); the editor never reads it. */
	name: string;
	state: 'open' | 'chosen' | 'typed';
	/** The words in the document; '' when open. */
	text: string;
	/** The chosen option's value; null unless chosen. */
	value: string | null;
}
