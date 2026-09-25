import fetch from 'node-fetch';

async function testEndpoints() {
  const tests = [
    'https://ddinter2.scbdd.com/server/interaction/',
    'https://ddinter2.scbdd.com/server/interact-with/?drug=DDInter54',
    'https://ddinter2.scbdd.com/server/interact/?drugA=DDInter54&drugB=DDInter534',
    'https://ddinter2.scbdd.com/server/interact-with/?drugA=DDInter54&drugB=DDInter534',
    'https://ddinter2.scbdd.com/server/interact/?drug1=DDInter54&drug2=DDInter534',
    'https://ddinter2.scbdd.com/server/interact/?id=DDInter54_DDInter534',
    'https://ddinter2.scbdd.com/server/interact-with/?id=DDInter54_DDInter534',
    'https://ddinter2.scbdd.com/server/interaction/?drugA=DDInter54&drugB=DDInter534',
    'https://ddinter2.scbdd.com/server/other_interaction/',
  ];

  for (const url of tests) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      console.log(`URL: ${url} -> Status: ${res.status}`);
      const text = await res.text();
      console.log(`  Length: ${text.length}, Snippet: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
    } catch (e) {
      console.log(`URL: ${url} -> Error: ${e.message}`);
    }
  }
}

testEndpoints();
