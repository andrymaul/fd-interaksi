import fetch from 'node-fetch';

async function checkLiveDDInter() {
  console.log('Testing live DDInter endpoints...');
  
  // Try 1: check interaction pair on DDInter v2
  // URLs known from ddinter Live Service or standard DDInter URLs:
  const urls = [
    'https://ddinter2.scbdd.com/server/interaction_detail/DDInter54/DDInter534/',
    'https://ddinter2.scbdd.com/server/interaction_detail/DDInter54_DDInter534/',
    'https://ddinter2.scbdd.com/server/api/interaction/?drugA=DDInter54&drugB=DDInter534',
    'https://ddinter2.scbdd.com/server/drug-detail/DDInter54/',
    'https://ddinter2.scbdd.com/server/check_interaction/',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000
      });
      console.log(`URL: ${url} -> Status: ${res.status}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`Length: ${text.length}`);
        if (text.length < 2000) {
          console.log('Sample content:', text);
        } else {
          console.log('Snippet:', text.slice(0, 500));
        }
      }
    } catch (e) {
      console.log(`URL: ${url} -> Error: ${e.message}`);
    }
  }
}

checkLiveDDInter();
