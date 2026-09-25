import fetch from 'node-fetch';

async function checkKnownResultPage() {
  const url = 'https://ddinter2.scbdd.com/checker/result/DDInter58-DDInter582/';
  console.log('Fetching', url);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 6000
    });
    const html = await res.text();
    console.log('Known result page length:', html.length);
    const seeMore = html.match(/\/server\/interact\/\d+\//g) || [];
    console.log('See more links:', seeMore);

    if (seeMore.length > 0) {
      const detailUrl = 'https://ddinter2.scbdd.com' + seeMore[0];
      console.log('Fetching detail URL:', detailUrl);
      const dRes = await fetch(detailUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 6000
      });
      const dHtml = await dRes.text();
      console.log('Detail length:', dHtml.length);
      const refIdx = dHtml.indexOf('References');
      if (refIdx !== -1) {
        console.log('References section:', dHtml.slice(refIdx - 50, refIdx + 800));
      } else {
        console.log('References not found in page');
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

checkKnownResultPage();
