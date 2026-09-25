import fetch from 'node-fetch';

async function check404() {
  const res = await fetch('https://ddinter2.scbdd.com/server/nonexistent_test_url/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const text = await res.text();
  console.log('404 text length:', text.length);
  // Look for url pattern list
  if (text.includes('Using the URLconf defined in')) {
    console.log('Django DEBUG is enabled! Patterns:');
    const start = text.indexOf('<ol>');
    const end = text.indexOf('</ol>');
    if (start !== -1 && end !== -1) {
      console.log(text.slice(start, end + 5));
    } else {
      console.log(text.slice(0, 1500));
    }
  } else {
    console.log('Django 404 snippet:', text.slice(0, 1000));
  }
}

check404();
