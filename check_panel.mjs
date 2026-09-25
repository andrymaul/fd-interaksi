import fetch from 'node-fetch';

async function checkPanel() {
  const url = 'https://ddinter2.scbdd.com/checker/result/DDInter54-DDInter534/';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  const start = html.indexOf('id="204328"');
  if (start !== -1) {
    console.log(html.slice(start, start + 3000));
  } else {
    console.log('Panel not found');
  }
}

checkPanel();
