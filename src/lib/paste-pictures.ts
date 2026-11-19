/**
 * The pictures of a paste from Word.
 *
 * Word puts what is copied on the clipboard several times over. Its HTML names each picture by
 * the address of a file on the writer's own disk (file:///…/msohtmlclip/clip_image001.png),
 * which a page may not open: the picture came in broken, and left in the RTF as "[Image: …]",
 * its description and no picture. Word's RTF copy of the same selection holds the pictures
 * themselves. So where a paste has both, the pictures are read from the RTF and given to the
 * images of the HTML, in order.
 */
import { DEFAULT_MAX_RTF_BYTES, rtfPictures } from './rtf-parser.js';

/** What is known of a paste's pictures before the browser has pasted it. */
export interface PastePictures {
	/** For each image of the HTML, in order: whether it is a file on the writer's disk. */
	local: boolean[];
	/** The picture of each of those that are, in order: its data, or null for one no browser shows. */
	pictures: (string | null)[];
}

/** An address that is a file on the disk of the computer the copy was made on. */
const LOCAL_FILE = /^\s*file:/i;

/**
 * Read from a paste's HTML and RTF the pictures the HTML only names: null where it names none,
 * or the RTF does not have them, which is nearly every paste.
 *
 * Nothing is guessed: unless the RTF has as many pictures as the HTML has images on the
 * writer's disk, it is not known which is which, and none is given. A wrong picture in a
 * report is worse than a missing one.
 */
export function pastePictures(html: string, rtf: string): PastePictures | null {
	if (!rtf || !/<img\b/i.test(html) || !/file:/i.test(html) || !rtf.includes('\\pict') || typeof DOMParser === 'undefined') return null;
	if (rtf.length > DEFAULT_MAX_RTF_BYTES) return null;
	const images = Array.from(new DOMParser().parseFromString(html, 'text/html').body.querySelectorAll('img'));
	const local = images.map((img) => LOCAL_FILE.test(img.getAttribute('src') ?? ''));
	const count = local.filter(Boolean).length;
	if (count === 0) return null;
	const pictures = rtfPictures(rtf);
	if (pictures.length !== count || pictures.every((picture) => picture === null)) return null;
	return { local, pictures };
}

/**
 * Give the images a paste brought in the pictures read for them. `images` are those that came
 * in, in order: where they are not as many as the HTML had, the browser has pasted something
 * else than was read, and nothing is done. Returns how many were given a picture.
 */
export function givePastedPictures(images: Element[], known: PastePictures): number {
	if (images.length !== known.local.length) return 0;
	let given = 0;
	let next = 0;
	images.forEach((img, i) => {
		if (!known.local[i]) return;
		const picture = known.pictures[next++];
		if (picture === null) return;
		img.setAttribute('src', picture);
		given++;
	});
	return given;
}
