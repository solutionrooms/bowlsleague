// scripts/roster.mjs — extract registered player names from a team page, and
// the canonical-name alias map. Shared by the build (scrape.mjs, to embed a
// player->leagues roster in data.json) and the players.md generator.

// Same person listed under spelling variants across leagues — canonicalise.
export const ALIASES = {
  'D Pedlar': 'Dave Pedlar',
  'Steve Crawley': 'Steve Cawley',
  'Alf Glaze': 'Alfie Glaze',
  'Glynis Wilburn': 'Glenys Wilburn',
};
export const canon = name => ALIASES[name] || name;

const strip = s => String(s || '')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ').trim();
const tables = h => h.split(/<table[^>]*>/i).slice(1).map(p => p.replace(/<\/table>[\s\S]*$/i, ''));
const rows = t => t.split(/<tr[^>]*>/i).slice(1).map(p => p.replace(/<\/tr>[\s\S]*$/i, ''));
const cells = r => r.split(/<t[dh][^>]*>/i).slice(1).map(p => p.replace(/<\/t[dh]>[\s\S]*$/i, '').replace(/<\/tr>[\s\S]*$/i, ''));

// cgleague team.php: every row of the "Registered players" table (played or not).
export function cgNames(html) {
  const tbl = tables(html).find(t => /registration/i.test(t));
  if (!tbl) return [];
  const out = [];
  for (const r of rows(tbl)) {
    const cs = cells(r);
    if (cs.length < 5) continue;
    const name = strip(cs[0]);
    if (!name || /^team$/i.test(name)) continue;
    out.push(name);
  }
  return out;
}

// bowlsresults teamaverages.php: players listed on the team averages page.
export function bowlsNames(html) {
  for (const t of tables(html)) {
    if (!/indresults\.php/i.test(t)) continue;
    const out = [];
    for (const r of rows(t)) {
      if (!/indresults\.php/i.test(r)) continue;
      const name = strip((cells(r).find(c => /indresults\.php/i.test(c))) || '');
      if (name) out.push(name);
    }
    if (out.length) return out;
  }
  return [];
}
