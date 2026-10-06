// Converts the race's official medical guide (Word .docx) into an offline page
// for the app: data/medical.html plus compressed diagrams in data/medical/.
// The guide's wording is kept exactly; only the layout is adapted for phones.
// Usage: node tools/build-medical.mjs "path/to/SkyRun 2026 Athlete Medical Guide.docx"
import mammoth from 'mammoth';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const src = process.argv[2];
if (!src) throw new Error('Give the path to the .docx file');
rmSync('data/medical', { recursive: true, force: true });
mkdirSync('data/medical', { recursive: true });

let n = 0;
const images = [];
const result = await mammoth.convertToHtml({ path: src }, {
  styleMap: [
    "p[style-name='Title'] => h1.med-title:fresh",
    "p[style-name='Small Note'] => p.med-note:fresh",
    "p[style-name='Action Step'] => p.med-step:fresh",
  ],
  // Diagrams are shrunk to phone width (logo smaller still) and saved as WebP.
  convertImage: mammoth.images.imgElement(async image => {
    const buf = Buffer.from(await image.read('base64'), 'base64');
    const img = await loadImage(buf);
    const maxW = n === 0 ? 360 : 1050;
    const s = Math.min(1, maxW / img.width);
    const c = createCanvas(Math.round(img.width * s), Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const name = `data/medical/image${++n}.webp`;
    writeFileSync(name, await c.encode('webp', 85));
    images.push(name);
    return { src: name, alt: n === 1 ? 'SkyRun Zimbabwe, Far and Wide' : 'Diagram from the medical guide' };
  }),
});

let html = result.value;
// Bookmark ids get a prefix so they cannot clash with the app's own ids.
html = html.replace(/ id="([^"]+)"/g, ' id="med-$1"').replace(/ href="#([^"]+)"/g, ' href="#med-$1"');
// Zimbabwe phone numbers become tap-to-call links (they need signal to work).
// Only plain text is changed: numbers inside tags or existing links are left alone.
let inLink = 0;
html = html.split(/(<[^>]+>)/).map(part => {
  if (part.startsWith('<')) {
    if (/^<a\b/.test(part)) { inLink++; return part.replace(/^<a (href="tel:)/, '<a class="med-tel" $1'); }
    if (/^<\/a>/.test(part)) inLink = Math.max(0, inLink - 1);
    return part;
  }
  return inLink ? part : part.replace(/\+263(?:\s*\d){9}/g, num => `<a class="med-tel" href="tel:${num.replace(/\s/g, '')}">${num}</a>`);
}).join('');
// Tables that are mostly buttons (the quick reference) are fitted to the screen
// width; other wide tables scroll sideways on small screens instead of squashing.
html = html.replace(/<table>([\s\S]*?)<\/table>/g, (all, inner) => {
  const cells = (inner.match(/<t[dh]\b/g) || []).length, links = (inner.match(/<a /g) || []).length;
  const cls = links >= cells * 0.6 ? 'med-table med-buttons' : 'med-table';
  return `<div class="${cls}"><table>${inner}</table></div>`;
});
// Diagrams can be tapped to show them full size.
html = html.replace(/<img ([^>]*)\/>/g, (all, attrs) => attrs.includes('image1.webp')
  ? `<img ${attrs} class="med-logo" />`
  : `<div class="med-img" title="Tap to enlarge"><img ${attrs} /></div><p class="med-note">Tap the diagram to enlarge it.</p>`);

writeFileSync('data/medical.html', html);
console.log(`data/medical.html ${(html.length / 1024).toFixed(0)} KB, ${images.length} images`);
for (const m of result.messages) if (!/Unrecognised paragraph style/.test(m.message)) console.log('note:', m.message);
console.log(images.join('\n'));
