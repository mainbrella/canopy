import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const output = new URL('../public/images/blog/the-cloudflare-appstore-appflare-malware-audit/', import.meta.url);
await mkdir(output, { recursive: true });
const ink = '#263238', quiet = '#52645e', green = '#416a54', red = '#a13e33';
const text = (x,y,s,size=18,color=ink,anchor='start',weight=500) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${s.replaceAll('&','&amp;').replaceAll('<','&lt;')}</text>`;
function svg(w,h,title,description,body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title desc"><title id="title">${title}</title><desc id="desc">${description}</desc><defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="${green}"/></marker><marker id="r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="${red}"/></marker><style>text{font-family:Inter,Arial,sans-serif}.lane{stroke:#b4beb5;stroke-width:1.5;stroke-dasharray:4 6}.step{fill:none;stroke:${green};stroke-width:2;marker-end:url(#a)}.leak{fill:none;stroke:${red};stroke-width:2.5;marker-end:url(#r)}.boundary{fill:none;stroke:#8d9e91;stroke-dasharray:7 5;stroke-width:1.5}</style></defs><rect width="${w}" height="${h}" fill="#f7f4ec"/>${body}</svg>`;
}
const arrow=(x1,y1,x2,y2,bad=false)=>`<path d="M${x1} ${y1} L${x2} ${y2}" class="${bad?'leak':'step'}"/>`;
const file=(x,y,label,color=ink)=>`<g stroke="${color}" fill="#fffdf8" stroke-width="2"><path d="M${x} ${y}h35l13 13v47h-48z"/><path d="M${x+35} ${y}v13h13"/></g>${text(x+24,y+40,label,16,color,'middle',700)}`;
const deskReset=svg(900,520,'Where the reset token goes','The browser gets the reset page from the owner’s Worker, loads the upstream tracker, and sends the reset token to that tracker before password submission.',`
${text(34,42,'rdyrct: opening a reset link',25,ink,'start',650)}
<rect x="341" y="75" width="216" height="390" rx="8" fill="#e9eee4"/>
${text(449,102,'Your Cloudflare account',15,quiet,'middle')}
${text(153,136,'Browser',20,ink,'middle',650)}${text(449,136,'App Worker',20,ink,'middle',650)}${text(748,136,'stats.brnr.dev',20,red,'middle',650)}
<path class="lane" d="M153 153V458M449 153V458M748 153V458"/>
${text(176,188,'GET reset link + token',17)}${arrow(153,203,449,203)}
${text(176,244,'HTML loads remote tracker',17)}${arrow(449,259,153,259)}
${text(435,300,'GET tracker script',17,quiet,'middle')}${arrow(153,315,748,315)}
${text(435,361,'POST pageview: path + ?token=',18,red,'middle',650)}${arrow(153,377,748,377,true)}
<circle cx="748" cy="377" r="7" fill="${red}"/>
${text(34,492,'Token leaves before a new password is submitted.',18,red,'start',600)}
`);
const mobileReset=svg(400,690,'Reset token sequence, mobile','Browser and Worker exchange the reset page; the browser loads the tracker and sends a pageview containing the token to stats.brnr.dev.',`
${text(22,36,'Opening the reset link',22,ink,'start',650)}
<rect x="211" y="72" width="171" height="230" rx="6" fill="#e9eee4"/>
${text(296,100,'Your CF account',16,quiet,'middle')}
${text(73,133,'Browser',19,ink,'middle',650)}${text(296,133,'App Worker',19,ink,'middle',650)}
<path class="lane" d="M73 150V304M296 150V304"/>
${text(184,185,'GET reset link + token',17,ink,'middle')}${arrow(73,203,296,203)}
${text(184,247,'HTML + tracker tag',17,ink,'middle')}${arrow(296,265,73,265)}
<path d="M73 304V355" class="lane"/>
${text(22,350,'The browser calls upstream',19,ink,'start',650)}
${text(73,398,'Browser',18,ink,'middle',650)}${text(285,398,'stats.brnr.dev',18,red,'middle',650)}
<path class="lane" d="M73 414V601M296 414V601"/>
${text(185,451,'GET tracker script',17,quiet,'middle')}${arrow(73,468,296,468)}
${text(185,522,'POST pageview',18,red,'middle',650)}
${text(185,548,'path + ?token=',18,red,'middle',650)}${arrow(73,568,296,568,true)}
<circle cx="296" cy="568" r="6" fill="${red}"/>
${text(22,636,'Before password submission.',18,red,'start',650)}
`);
const deskFiles=svg(900,420,'Same editor, different storage','Image attachments go through the app’s upload endpoint to its own R2 bucket. Non-image attachments go to external 888box hosts without consulting the note password.',`
${text(34,42,'888wiki: the file type chooses the destination',24,ink,'start',650)}
<rect x="30" y="80" width="556" height="265" rx="8" fill="#e9eee4"/>
${text(52,111,'Your install',16,quiet)}<path class="boundary" d="M604 78V346"/>
${text(630,111,'External storage',16,red)}
${file(66,149,'PNG')}${text(144,183,'/upload',18)}${arrow(226,178,392,178)}
<ellipse cx="480" cy="160" rx="64" ry="15" fill="#f7f4ec" stroke="${green}" stroke-width="2"/><path d="M416 160v43c0 20 128 20 128 0v-43" fill="none" stroke="${green}" stroke-width="2"/>
${text(480,191,'Own R2',18,green,'middle',650)}
${file(66,248,'PDF',red)}${text(144,283,'raw file',18,red)}${arrow(226,278,652,278,true)}
${text(660,273,'box.david888.com',18,red,'start',650)}${text(660,299,'+ two fallback hosts',16,quiet)}
${text(34,386,'Generic block-editor upload; no note-password or destination check.',18,ink)}
`);
const mobileFiles=svg(400,590,'Attachment destinations, mobile','The editor sends an image to the install’s upload endpoint and own R2. A PDF instead goes to external 888box storage; note passwords do not govern that upload.',`
${text(22,38,'Same editor, two destinations',22,ink,'start',650)}
<rect x="18" y="72" width="364" height="214" rx="7" fill="#e9eee4"/>
${text(36,103,'Your install',17,quiet)}
${file(43,133,'PNG')}${text(135,166,'/upload',18)}${arrow(214,160,305,160)}
<ellipse cx="320" cy="148" rx="35" ry="10" fill="#f7f4ec" stroke="${green}" stroke-width="2"/><path d="M285 148v45c0 14 70 14 70 0v-45" fill="none" stroke="${green}" stroke-width="2"/>
${text(320,178,'R2',18,green,'middle',650)}${text(36,252,'Image stays in your account.',18,green)}
<path d="M18 312H382" class="boundary"/>
${file(43,337,'PDF',red)}${text(134,371,'raw file',18,red)}${arrow(218,367,327,367,true)}
${text(36,438,'box.david888.com',21,red,'start',650)}
${text(36,468,'External host + two fallbacks',17,quiet)}
${text(22,535,'No note-password or',18,ink)}${text(22,560,'destination choice in this callback.',18,ink)}
`);
for (const [name,value] of Object.entries({'reset-token-route':deskReset,'reset-token-route-mobile':mobileReset,'attachment-route':deskFiles,'attachment-route-mobile':mobileFiles})) {
  await writeFile(new URL(`${name}.svg`,output),value);
}
await sharp(Buffer.from(deskReset)).resize(1800,1040).png().toFile(new URL('reset-token-route.png',output).pathname);
console.log('Wrote reset sequence and attachment routing figures.');
