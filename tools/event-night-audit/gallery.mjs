import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { auditPaths } from './config.mjs';

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function pickSpread(items, count) {
  if (items.length <= count) return items;
  return [...new Set(Array.from({ length: count }, (_, index) => items[Math.round(index * (items.length - 1) / (count - 1))]))];
}

async function main() {
  const paths = auditPaths();
  const visual = JSON.parse(await readFile(paths.visualResults, 'utf8'));
  const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
  await mkdir(paths.galleryRoot, { recursive: true });
  const cards = visual.galleryItems.map((item, index) => `
    <figure data-index="${index}" data-kind="${escapeHtml(item.kind)}" data-ref="${escapeHtml(item.semanticRef)}">
      <a href="screenshots/${escapeHtml(item.file)}" target="_blank" rel="noreferrer"><img loading="lazy" src="screenshots/${escapeHtml(item.file)}" alt="${escapeHtml(item.semanticRef)} ${escapeHtml(item.mode)}"></a>
      <figcaption><strong>${escapeHtml(item.semanticRef)}</strong><span>${escapeHtml(item.kind)} · ${escapeHtml(item.mode)}</span></figcaption>
    </figure>`).join('');
  const html = `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local event-night visual audit</title>
<style>
body{margin:0;background:#0b0e12;color:#f2f4f7;font:16px system-ui,sans-serif}header{position:sticky;top:0;z-index:2;padding:16px 24px;background:#121821;border-bottom:1px solid #2d3745}h1{margin:0 0 12px;font-size:22px}.filters{display:flex;gap:12px;flex-wrap:wrap}select,button{padding:10px 12px;border:1px solid #46546a;border-radius:8px;background:#1c2531;color:inherit}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px;padding:24px}figure{margin:0;border:1px solid #293544;border-radius:12px;overflow:hidden;background:#141a22}figure[hidden]{display:none}img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#000}figcaption{display:flex;justify-content:space-between;gap:12px;padding:12px;color:#aeb9c8}figcaption strong{color:#fff}
</style></head><body><header><h1>Local-only event-night visual audit</h1><div class="filters"><select id="kind"><option value="">Všechny typy</option>${[...new Set(visual.galleryItems.map((item) => item.kind))].sort().map((kind) => `<option>${escapeHtml(kind)}</option>`).join('')}</select><input id="ref" placeholder="R2 Q8"><button id="prev">Předchozí</button><button id="next">Další</button></div></header><main>${cards}</main><script>
const cards=[...document.querySelectorAll('figure')],kind=document.querySelector('#kind'),ref=document.querySelector('#ref');let cursor=0;
function filtered(){return cards.filter(c=>(!kind.value||c.dataset.kind===kind.value)&&(!ref.value||c.dataset.ref.toLowerCase().includes(ref.value.toLowerCase())))}
function apply(){for(const c of cards)c.hidden=!filtered().includes(c);cursor=0}kind.onchange=apply;ref.oninput=apply;
function go(delta){const items=filtered();if(!items.length)return;cursor=(cursor+delta+items.length)%items.length;items[cursor].scrollIntoView({behavior:'smooth',block:'center'})}
document.querySelector('#prev').onclick=()=>go(-1);document.querySelector('#next').onclick=()=>go(1);
</script></body></html>`;
  await writeFile(`${paths.galleryRoot}/index.html`, html, 'utf8');

  const usages = manifest.usages;
  const audio = usages.filter((item) => item.kind === 'audio');
  const video = usages.filter((item) => item.kind === 'video');
  const timing = video.find((item) => item.timingStatus !== 'VALID');
  const longSlide = [...manifest.slides].sort((left, right) => (
    Math.max(right.titleLength, right.textLength, right.maxOptionLength)
    - Math.max(left.titleLength, left.textLength, left.maxOptionLength)
  ))[0];
  const legacy = manifest.slides.find((slide) => slide.kind === 'legacy-pl');
  const entries = [
    ...pickSpread(audio, 2).map((item) => ({ ref: item.semanticRef, type: 'AUDIO', check: 'Slyšitelný zvuk, PLAY/STOP/REPLAY a vinyl.' })),
    ...pickSpread(video.filter((item) => item !== timing), 2).map((item) => ({ ref: item.semanticRef, type: 'VIDEO', check: 'Obraz, přibližný START/END, STOP a REPLAY.' })),
    ...(timing ? [{ ref: timing.semanticRef, type: 'VIDEO', check: 'CONTENT BLOCKED — HUMAN TIMING REQUIRED; nejdřív ručně opravit.' }] : []),
    ...(audio[0] ? [{ ref: audio[0].semanticRef, type: 'AUDIO RECAP', check: 'Bez autoplay, start 0:00, timeline a seek.' }] : []),
    ...(video[0] ? [{ ref: video[0].semanticRef, type: 'VIDEO RECAP', check: 'Bez autoplay, start 0:00, timeline a seek.' }] : []),
    ...(longSlide ? [{ ref: longSlide.semanticRef, type: 'DLOUHÝ TEXT', check: 'Čitelnost a clipping na fyzickém projektoru.' }] : []),
    ...(legacy ? [{ ref: legacy.semanticRef, type: 'LEGACY PL', check: 'Pravda/Lež vzhled a žádný předčasný answer.' }] : []),
  ];
  const shortlist = `# Physical QA shortlist\n\nLocal-only seznam. Neobsahuje odpovědi ani mediální zdroje.\n\n${entries.map((entry) => `- **${entry.ref} — ${entry.type}:** ${entry.check}`).join('\n')}\n`;
  await writeFile(paths.physicalShortlist, shortlist, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', galleryItems: visual.galleryItems.length, physicalChecks: entries.length }));
}

await main();
