async function test() {
  const getRes = await fetch('https://ddinter2.scbdd.com/server/drug/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const html = await getRes.text();
  const cookies = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
  const csrfMatch = html.match(/csrfmiddlewaretoken:\s*'([^']+)'/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  console.log('Got cookie:', cookieHeader);
  console.log('Got CSRF:', csrf);

  const body = new URLSearchParams({
    csrfmiddlewaretoken: csrf,
    draw: '1',
    start: '0',
    length: '5'
  });

  const postRes = await fetch('https://ddinter2.scbdd.com/server/drug-source/', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Cookie': cookieHeader || `csrftoken=${csrf}`,
      'Referer': 'https://ddinter2.scbdd.com/server/drug/',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  console.log('Post status:', postRes.status);
  const json = await postRes.json();
  console.log('recordsTotal:', json.recordsTotal);
  console.log('recordsFiltered:', json.recordsFiltered);
  console.log('Returned items:', json.data?.length);
  if (json.data?.length > 0) {
    console.log('Item 0:', {
      name: json.data[0].name,
      display: json.data[0].display,
      internalID: json.data[0].internalID,
      drugbank_id: json.data[0].drugbank_id,
      exist: json.data[0].exist,
      hasStructure: !!json.data[0].structure
    });
  }
}

test().catch(console.error);
