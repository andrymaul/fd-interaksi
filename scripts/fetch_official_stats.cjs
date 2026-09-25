const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

async function getStatsPage() {
  const res = await fetch('https://ddinter2.scbdd.com/server/statistics/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(15000)
  });
  const html = await res.text();
  console.log('Length:', html.length);
  // Extract all paragraphs and cards
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ');
  const m = text.match(/(?:Overview|Summary|Statistics|approved|DDI|DFI|DDSI|duplication)[\s\S]{0,500}/gi) || [];
  for (const snippet of m.slice(0, 10)) {
    console.log('--- SNIPPET ---');
    console.log(snippet.trim());
  }
}

getStatsPage().catch(console.error);
