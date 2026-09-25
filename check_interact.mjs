import fetch from 'node-fetch';

async function checkInteract() {
  const url = 'https://ddinter2.scbdd.com/server/interact/204328/';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await res.text();
  console.log('Interact length:', html.length);
  // Look for References or table
  const start = html.indexOf('References');
  if (start !== -1) {
    console.log(html.slice(start - 100, start + 600));
  } else {
    console.log('Snippet:', html.slice(0, 1000));
  }
}

checkInteract();
