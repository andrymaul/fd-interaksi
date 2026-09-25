import fetch from 'node-fetch';

async function testKnownPair() {
  const params = new URLSearchParams();
  // Aluminum hydroxide (DDInter58) & Dolutegravir (DDInter582)
  params.append('choices', 'DDInter58');
  params.append('choices', 'DDInter582');

  const res = await fetch('https://ddinter2.scbdd.com/checker/', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://ddinter2.scbdd.com/inter-checker/',
    },
    body: params.toString(),
  });

  const json = await res.json();
  console.log('Result for DDInter58 & DDInter582:');
  console.dir(json, { depth: 5 });
}

testKnownPair();
