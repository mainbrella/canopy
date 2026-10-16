import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, '../public/images/blog/many-businesses-in-a-box-under-this-brella');
const paper = '#f7f4ec';
const ink = '#263238';
const quiet = '#64716d';
const green = '#698476';
const greenFill = '#e8eee7';
const rust = '#a45f47';
const rustFill = '#f4e9df';
const arrow = (x1, y1, x2, y2, planned = true) => `<path d="M${x1} ${y1} L${x2} ${y2}" class="${planned ? 'planned-line' : 'existing-line'}" marker-end="url(#arrow)"/>`;
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const text = (x, y, value, size = 14, weight = 500, color = ink, anchor = 'middle') =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(value)}</text>`;

function docIcon(x, y, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 2h27l12 12v42H2z"/><path d="M29 2v13h12M10 27h22M10 36h22M10 45h16"/>
  </g>`;
}

function browserIcon(x, y, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${rust}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="2" width="50" height="39" rx="4"/><path d="M1 12h50M8 7h.1M14 7h.1M20 7h.1M12 21h27M12 28h20M12 35h13"/>
  </g>`;
}

function knowledgeIcon(x, y, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${rust}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 8 24 2l22 6-22 7zM2 8v27l22 7 22-7V8M24 15v27"/>
    <circle cx="13" cy="24" r="1.4" fill="${rust}"/><circle cx="34" cy="26" r="1.4" fill="${rust}"/><circle cx="18" cy="34" r="1.4" fill="${rust}"/>
  </g>`;
}

function clockIcon(x, y, color = rust) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="21" cy="21" r="17"/><path d="M21 11v11l8 5M13 1h16"/>
  </g>`;
}

function phoneIcon(x, y) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${green}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 4c-3 1-5 4-4 8 3 11 12 20 23 23 4 1 7-1 8-4l1-5-10-5-4 5c-4-2-7-5-9-9l5-4-5-10z"/>
  </g>`;
}

function screenIcon(x, y) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${green}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="2" width="48" height="34" rx="3"/><path d="M1 10h48M18 44h14M25 36v8M9 6h.1M15 6h.1M10 17h12M10 23h28M10 29h20"/>
  </g>`;
}

function terminalIcon(x, y) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${green}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="2" width="49" height="37" rx="3"/><path d="M1 10h49M9 19l6 5-6 5M20 30h12"/>
  </g>`;
}

const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${rust}"/></marker><style>
  text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .planned-box{fill:${rustFill};stroke:${rust};stroke-width:1.8;stroke-dasharray:6 5}
  .existing-box{fill:${greenFill};stroke:${green};stroke-width:1.8}
  .planned-line{fill:none;stroke:${rust};stroke-width:2;stroke-dasharray:6 5;stroke-linecap:round;stroke-linejoin:round}
  .existing-line{fill:none;stroke:${green};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
</style></defs>`;

function desktop() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="600" viewBox="0 0 840 600" role="img" aria-labelledby="title desc">
    <title id="title">A bike shop's planned MainBrella composition</title>
    <desc id="desc">A shop website flows through planned web scraping into a planned knowledge base. Planned background jobs refresh the scrape on a schedule. The same knowledge base is planned to connect to existing voice, app, and Linux agent services. These connections are planned, not implemented.</desc>
    ${defs}<rect width="840" height="600" fill="${paper}"/>
    ${text(38, 43, 'PLANNED COMPOSITION', 12, 700, rust, 'start')}
    ${text(38, 75, 'One bike shop, shared business context', 23, 650, ink, 'start')}

    <!-- Website input -->
    <g>${docIcon(50, 145, .9)}
      ${text(69, 224, 'Shop website', 16, 600)}
      ${text(69, 246, 'Service info', 14, 450, quiet)}
    </g>
    ${arrow(104, 176, 177, 176)}

    <!-- Planned scraping -->
    <rect class="planned-box" x="177" y="132" width="142" height="102" rx="8"/>
    ${browserIcon(222, 145)}
    ${text(248, 207, 'Web scraping', 16, 650)}
    ${text(248, 225, 'Extract site info', 14, 500, quiet)}
    ${arrow(319, 176, 381, 176)}

    <!-- Planned knowledge base -->
    <rect class="planned-box" x="381" y="132" width="146" height="102" rx="8"/>
    ${knowledgeIcon(427, 142, .95)}
    ${text(454, 207, 'Knowledge base', 16, 650)}
    ${text(454, 225, 'Shared shop data', 14, 500, quiet)}

    <!-- Planned recurring refresh -->
    <rect class="planned-box" x="172" y="326" width="148" height="94" rx="8"/>
    ${clockIcon(224, 339)}
    ${text(246, 393, 'Background jobs', 16, 650)}
    ${text(246, 411, 'Refresh scrape', 14, 500, quiet)}
    <path d="M246 326V234" class="planned-line" marker-end="url(#arrow)"/>

    <!-- Fan-out from shared context -->
    <path d="M527 183H554V442" class="planned-line"/>
    <path d="M554 183H570" class="planned-line" marker-end="url(#arrow)"/>
    <path d="M554 312H570" class="planned-line" marker-end="url(#arrow)"/>
    <path d="M554 442H570" class="planned-line" marker-end="url(#arrow)"/>
    <!-- Existing voice -->
    <rect class="existing-box" x="570" y="137" width="222" height="91" rx="8"/>
    ${phoneIcon(586, 154)}
    ${text(650, 176, 'Voice calls', 16, 650, ink, 'start')}
    ${text(650, 201, 'Answer callers', 14, 500, quiet, 'start')}

    <!-- Existing app builder/output -->
    <rect class="existing-box" x="570" y="266" width="222" height="91" rx="8"/>
    ${screenIcon(586, 282)}
    ${text(650, 305, 'Shop app', 16, 650, ink, 'start')}
    ${text(650, 330, 'Built with Builder', 14, 500, quiet, 'start')}

    <!-- Existing Linux agent -->
    <rect class="existing-box" x="570" y="396" width="222" height="91" rx="8"/>
    ${terminalIcon(586, 412)}
    ${text(650, 435, 'Linux agent', 16, 650, ink, 'start')}
    ${text(650, 461, 'Custom processing', 14, 500, quiet, 'start')}

    <!-- Compact status key and shared account -->
    <path d="M38 526H802" stroke="#d8d2c7" stroke-width="1"/>
    <rect x="40" y="545" width="22" height="17" rx="3" class="existing-box"/>
    ${text(71, 558, 'Existing service', 14, 550, ink, 'start')}
    <rect x="183" y="545" width="22" height="17" rx="3" class="planned-box"/>
    ${text(214, 558, 'Planned service / connection', 14, 550, ink, 'start')}
    ${text(800, 558, 'One owner · one prepaid wallet', 13, 550, quiet, 'end')}
  </svg>`;
}

function mobile() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="900" viewBox="0 0 440 900" role="img" aria-labelledby="title desc">
    <title id="title">A bike shop's planned MainBrella composition, mobile layout</title>
    <desc id="desc">A shop website flows through planned web scraping into a planned knowledge base. Planned background jobs refresh the scrape on a schedule. The same knowledge base is planned to connect to existing voice, app, and Linux agent services. These connections are planned, not implemented.</desc>
    ${defs}<rect width="440" height="900" fill="${paper}"/>
    ${text(24, 39, 'PLANNED COMPOSITION', 12, 700, rust, 'start')}
    ${text(24, 70, 'One bike shop, shared context', 22, 650, ink, 'start')}

    <!-- Website to scraper to knowledge base -->
    ${docIcon(195, 92, .8)}
    ${text(220, 157, 'Shop website', 16, 600)}
    ${text(220, 177, 'Service info', 15, 450, quiet)}
    ${arrow(220, 185, 220, 207)}

    <rect class="planned-box" x="154" y="207" width="132" height="96" rx="8"/>
    ${browserIcon(194, 217, .9)}
    ${text(220, 273, 'Web scraping', 16, 650)}
    ${text(220, 293, 'Extract site info', 15, 500, quiet)}

    <rect class="planned-box" x="22" y="207" width="120" height="124" rx="8"/>
    ${clockIcon(61, 215)}
    ${text(82, 278, 'Background', 16, 650)}
    ${text(82, 298, 'jobs', 16, 650)}
    ${text(82, 319, 'Refresh scrape', 15, 500, quiet)}
    <path d="M142 263H154" class="planned-line" marker-end="url(#arrow)"/>

    ${arrow(220, 303, 220, 340)}
    <rect class="planned-box" x="140" y="340" width="160" height="95" rx="8"/>
    ${knowledgeIcon(197, 350, .9)}
    ${text(220, 407, 'Knowledge base', 17, 650)}
    ${text(220, 427, 'Shared shop data', 15, 500, quiet)}

    <!-- Planned fan-out bus stays outside the service rows -->
    <path d="M300 388H420V736" class="planned-line"/>

    <!-- Existing services, laid out as compact rows -->
    <rect class="existing-box" x="31" y="474" width="378" height="88" rx="8"/>
    ${phoneIcon(53, 494)}
    ${text(120, 510, 'Voice receptionist', 18, 650, ink, 'start')}
    ${text(120, 538, 'Answer callers', 15, 500, quiet, 'start')}

    <rect class="existing-box" x="31" y="582" width="378" height="88" rx="8"/>
    ${screenIcon(53, 601)}
    ${text(120, 618, 'Shop app', 18, 650, ink, 'start')}
    ${text(120, 646, 'Built with Builder', 15, 500, quiet, 'start')}

    <rect class="existing-box" x="31" y="690" width="378" height="88" rx="8"/>
    ${terminalIcon(53, 709)}
    ${text(120, 726, 'Linux agent', 18, 650, ink, 'start')}
    ${text(120, 754, 'Custom processing', 15, 500, quiet, 'start')}

    <!-- Put incoming arrowheads above the row fills so their direction stays visible -->
    ${[518, 626, 734].map(y => arrow(420, y, 385, y)).join('')}

    <!-- Status key -->
    <path d="M24 800H416" stroke="#d8d2c7" stroke-width="1"/>
    <rect x="28" y="817" width="21" height="16" rx="3" class="existing-box"/>
    ${text(58, 831, 'Existing service', 15, 550, ink, 'start')}
    <rect x="220" y="817" width="21" height="16" rx="3" class="planned-box"/>
    ${text(250, 831, 'Planned service / link', 15, 550, ink, 'start')}
    ${text(28, 875, 'One owner · one prepaid wallet', 15, 550, quiet, 'start')}
  </svg>`;
}

await mkdir(outputDir, { recursive: true });
const desktopSvg = desktop();
const mobileSvg = mobile();
const desktopPath = path.join(outputDir, 'shop-roadmap.svg');
const mobilePath = path.join(outputDir, 'shop-roadmap-mobile.svg');
const pngPath = path.join(outputDir, 'shop-roadmap.png');
await Promise.all([
  writeFile(desktopPath, desktopSvg),
  writeFile(mobilePath, mobileSvg),
]);
await sharp(Buffer.from(desktopSvg)).resize(1680, 1200).png().toFile(pngPath);
console.log(`Wrote ${desktopPath}, ${mobilePath}, and ${pngPath}`);
