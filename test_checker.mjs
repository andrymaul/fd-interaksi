import fetch from 'node-fetch';

async function testChecker() {
  const params = new URLSearchParams();
  params.append('choices', 'DDInter54');
  params.append('choices', 'DDInter534');

  console.log('Sending choices to https://ddinter2.scbdd.com/checker/...');
  try {
    const res = await fetch('https://ddinter2.scbdd.com/checker/', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://ddinter2.scbdd.com/inter-checker/',
      },
      body: params.toString(),
      timeout: 10000,
    });
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('JSON result:');
    console.dir(json, { depth: 5 });
  } catch (e) {
    console.error('Error:', e.message);
  }
}

testChecker();
