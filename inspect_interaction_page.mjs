import fetch from 'node-fetch';

async function inspectInteractionPage() {
  const res = await fetch('https://ddinter2.scbdd.com/server/interaction/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await res.text();
  console.log('Interaction page length:', html.length);
  
  // Find scripts and forms
  const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
  console.log('Scripts found:', scripts.length);
  for (const s of scripts) {
    if (s.includes('http') || s.includes('url') || s.includes('table') || s.includes('post') || s.includes('get')) {
      console.log('Script snippet:', s.slice(0, 500));
    }
  }

  // Look for input fields
  const inputs = html.match(/<input[^>]*>/gi) || [];
  console.log('Inputs:', inputs);

  // Look for buttons
  const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/gi) || [];
  console.log('Buttons:', buttons);
}

inspectInteractionPage();
