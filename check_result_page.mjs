import fetch from 'node-fetch';

async function checkResultPage() {
  const url = 'https://ddinter2.scbdd.com/checker/result/DDInter54-DDInter534/';
  console.log('Fetching', url);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    console.log('Status:', res.status);
    const html = await res.text();
    console.log('Length:', html.length);
    // Find table or result rows
    const matches = html.match(/<table[\s\S]*?<\/table>/gi) || [];
    console.log('Tables:', matches.length);
    for (const t of matches) {
      console.log('Table content:', t.slice(0, 1000));
    }
    // Also look for "Unknown" or "No interaction"
    const idx = html.indexOf('Unknown');
    if (idx !== -1) {
      console.log('Context of Unknown:', html.slice(idx - 100, idx + 300));
    }
  } catch (e) {
    console.error(e.message);
  }
}

checkResultPage();
