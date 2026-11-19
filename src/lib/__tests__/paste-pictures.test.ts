// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rtfPictures } from '../rtf-parser.js';
import { givePastedPictures, pastePictures } from '../paste-pictures.js';
import { htmlToRtf } from '../rtf-writer.js';

// What Word puts on the clipboard for "First. [picture] Between. [picture] Last.": its HTML,
// which names each picture as a file on the writer's disk, and its RTF, which holds them.
// Written by hand in the shape Word writes (the conditional comments around each image, the
// \shppict and \nonshppict pair around each picture), with two small pictures: one red, 16 by
// 12, and one blue, 10 by 10.
const file = (name: string) => readFileSync(resolve(__dirname, '../../../test-files', name), 'utf8');
const WORD_HTML = file('word-paste-two-pictures.html');
const WORD_RTF = file('word-paste-two-pictures.rtf');

const PNG = 'data:image/png;base64,iVBORw0KGgo';
/** The width and height a PNG says it has, from its header. */
function pngSize(dataUrl: string): [number, number] {
	const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
	const view = new DataView(bytes.buffer);
	return [view.getUint32(16), view.getUint32(20)];
}

/** A picture as Word writes one that is not a PNG or a JPEG: an enhanced metafile. */
const METAFILE = String.raw`{\*\shppict{\pict\picw100\pich100\picwgoal1500\pichgoal1500\emfblip\bliptag7{\*\blipuid 0011}0100000058000000}}`;

describe('the pictures of an RTF document', () => {
	it('are each read once, in order: not the copy Word writes for older readers', () => {
		const pictures = rtfPictures(WORD_RTF);
		expect(pictures).toHaveLength(2);
		expect(pictures.every((picture) => picture?.startsWith(PNG))).toBe(true);
		expect(pictures.map((picture) => pngSize(picture!))).toEqual([
			[16, 12],
			[10, 10]
		]);
	});

	it('has null for a picture no browser shows, so that the others keep their places', () => {
		const rtf = WORD_RTF.replace('Between.', `${METAFILE} Between.`);
		const pictures = rtfPictures(rtf);
		expect(pictures.map((picture) => (picture === null ? null : pngSize(picture)))).toEqual([[16, 12], null, [10, 10]]);
	});

	it('counts the picture of a shape once, and not what is written beside it for readers that know no shapes', () => {
		const picture = /\{\\pict[^]*?\}\}/.exec(WORD_RTF)![0].slice(0, -1);
		const shape = String.raw`{\shp{\*\shpinst\shpleft0\shptop0\shpright1000\shpbottom1000{\sp{\sn shapeType}{\sv 75}}{\sp{\sn pib}{\sv ${picture}}}}{\shprslt{\pict\wmetafile8\picw10\pich10 0100090000}}}`;
		expect(rtfPictures(String.raw`{\rtf1\ansi Text ${shape}\par }`)).toHaveLength(1);
	});

	it('are none where there are none, or where what was given is no RTF', () => {
		expect(rtfPictures(String.raw`{\rtf1\ansi Only words.\par }`)).toEqual([]);
		expect(rtfPictures('')).toEqual([]);
		expect(rtfPictures('not rtf at all {{{')).toEqual([]);
	});
});

describe('the pictures of a paste from Word', () => {
	it('are read from the RTF for the images the HTML names by a file on the disk', () => {
		const known = pastePictures(WORD_HTML, WORD_RTF)!;
		expect(known.local).toEqual([true, true]);
		expect(known.pictures.map((picture) => pngSize(picture!))).toEqual([
			[16, 12],
			[10, 10]
		]);
	});

	it('is nothing where the paste has no RTF, no image on a disk, or no picture in the RTF', () => {
		expect(pastePictures(WORD_HTML, '')).toBeNull();
		expect(pastePictures('<p>words <img src="https://example.com/a.png" alt="a"></p>', WORD_RTF)).toBeNull();
		expect(pastePictures('<p>write file: and &lt;img&gt;</p>', WORD_RTF)).toBeNull();
		expect(pastePictures(WORD_HTML, String.raw`{\rtf1\ansi First.\par Between.\par Last.\par }`)).toBeNull();
	});

	it('gives none where the RTF has not as many pictures as the HTML has images on the disk', () => {
		// (It is then not known which is which, and a wrong picture is worse than none.)
		const oneImage = WORD_HTML.replace(/<p class=MsoNormal><span[^]*?second field[^]*?<\/p>/, '');
		expect(oneImage).not.toBe(WORD_HTML);
		expect(pastePictures(oneImage, WORD_RTF)).toBeNull();
		expect(pastePictures(WORD_HTML, WORD_RTF.replace('Between.', `${METAFILE} Between.`))).toBeNull();
	});

	it('leaves alone an image that is on the web, and gives the others theirs in order', () => {
		const html = WORD_HTML.replace('<p class=MsoNormal>Between.', '<p class=MsoNormal><img src="https://example.com/logo.png" alt="logo">Between.');
		const known = pastePictures(html, WORD_RTF)!;
		expect(known.local).toEqual([true, false, true]);
		const div = document.createElement('div');
		div.innerHTML = '<img src="file:///a.png" alt="micrograph"><img src="https://example.com/logo.png" alt="logo"><img alt="second field">';
		const images = Array.from(div.querySelectorAll('img'));
		expect(givePastedPictures(images, known)).toBe(2);
		expect(pngSize(images[0].getAttribute('src')!)).toEqual([16, 12]);
		expect(images[1].getAttribute('src')).toBe('https://example.com/logo.png');
		// (A browser that had taken the address off the image: it is the third all the same.)
		expect(pngSize(images[2].getAttribute('src')!)).toEqual([10, 10]);
		expect(images.map((img) => img.alt)).toEqual(['micrograph', 'logo', 'second field']);
	});

	it('gives none where the browser pasted other images than were read', () => {
		const known = pastePictures(WORD_HTML, WORD_RTF)!;
		const div = document.createElement('div');
		div.innerHTML = '<img src="file:///a.png" alt="only one came in">';
		expect(givePastedPictures(Array.from(div.querySelectorAll('img')), known)).toBe(0);
		expect(div.querySelector('img')!.getAttribute('src')).toBe('file:///a.png');
	});

	it('a picture no browser shows leaves its image as it was, and the next has its own', () => {
		const html = WORD_HTML.replace('<p class=MsoNormal>Between.', '<p class=MsoNormal><img src="file:///C:/Users/x/AppData/Local/Temp/msohtmlclip1/01/clip_image005.gif" alt="chart">Between.');
		const known = pastePictures(html, WORD_RTF.replace('Between.', `${METAFILE} Between.`))!;
		const div = document.createElement('div');
		div.innerHTML = '<img src="file:///1.png"><img src="file:///2.gif" alt="chart"><img src="file:///3.png">';
		const images = Array.from(div.querySelectorAll('img'));
		expect(givePastedPictures(images, known)).toBe(2);
		expect(images[1].getAttribute('src')).toBe('file:///2.gif');
		expect(pngSize(images[2].getAttribute('src')!)).toEqual([10, 10]);
	});

	it('the picture is then in the RTF, where there was "[Image: micrograph]"', () => {
		const div = document.createElement('div');
		div.innerHTML = '<p>First.</p><p><img alt="micrograph" src="file:///a.png"></p><p>Between.</p><p><img alt="second field" src="file:///b.png"></p>';
		expect(htmlToRtf(div)).toContain('[Image: micrograph]');
		givePastedPictures(Array.from(div.querySelectorAll('img')), pastePictures(WORD_HTML, WORD_RTF)!);
		const rtf = htmlToRtf(div);
		expect(rtf).not.toContain('[Image');
		expect(rtf.match(/\\pngblip/g)).toHaveLength(2);
	});
});
