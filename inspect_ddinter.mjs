import fetch from 'node-fetch';


async function inspectDDInter54() {
  const res = await fetch('https://ddinter2.scbdd.com/server/drug-detail/DDInter54/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await res.text();
  console.log('HTML length:', html.length);
  
  // Search for DDInter534 or Diazepam in html
  const has534 = html.includes('DDInter534');
  const hasDiazepam = html.toLowerCase().includes('diazepam');
  console.log('Has DDInter534:', has534);
  console.log('Has Diazepam:', hasDiazepam);

  // Let's check table or scripts in html
  const idx = html.toLowerCase().indexOf('diazepam');
  if (idx !== -1) {
    console.log('Context around diazepam:');
    console.log(html.slice(Math.max(0, idx - 200), idx + 400));
  }

  // Also check what URL DDInter uses for checking interaction:
  // Let's look for form actions, ajax calls, or layui tables
  const forms = html.match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];
  console.log('Forms found:', forms.length);
  for (const f of forms) {
    console.log(f.slice(0, 200));
  }

  // Look for any table url or /server/ endpoints
  const serverUrls = html.match(/\/server\/[a-zA-Z0-9_\-\/]+/g) || [];
  console.log('Unique /server/ URLs:', [...new Set(serverUrls)]);
}

inspectDDInter54();
