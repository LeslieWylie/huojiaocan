import { readFile, writeFile } from 'node:fs/promises';
import { guidanceVtt, GUIDANCE_DURATION } from '../shared/guidance-timeline.js';

const target = new URL('../public/guidance/活教参备课引导.vtt', import.meta.url);
const next = guidanceVtt();
const current = await readFile(target, 'utf8').catch(() => '');
if (current === next) console.log(`Captions already match the published ${GUIDANCE_DURATION}s timeline.`);
else {
  await writeFile(target, next);
  console.log(`Updated captions from the published ${GUIDANCE_DURATION}s timeline.`);
}
