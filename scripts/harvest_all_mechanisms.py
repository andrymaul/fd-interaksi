import urllib.request
import urllib.parse
import json
import re
import time
import os

print("=== Harvesting All 8,466 Mechanism Descriptions from DDInter 2.0 ===")

req = urllib.request.Request('https://ddinter2.scbdd.com/server/interaction/', headers={'User-Agent': 'Mozilla/5.0'})
resp = urllib.request.urlopen(req, timeout=15)
html = resp.read().decode('utf-8')
cookie = resp.headers.get('Set-Cookie', '')
csrf = re.search(r'csrfmiddlewaretoken:\s*\'([^\']+)\'', html).group(1)
print(f"Session established. CSRF: {csrf[:10]}...")

all_mechanisms = []
start = 0
batch_size = 1000
total_records = 8466

while start < total_records:
    print(f"Fetching mechanisms from offset {start}...")
    try:
        data = urllib.parse.urlencode({
            'csrfmiddlewaretoken': csrf,
            'draw': '1',
            'start': str(start),
            'length': str(batch_size)
        }).encode('utf-8')
        
        req_post = urllib.request.Request(
            'https://ddinter2.scbdd.com/server/interaction-source/',
            data=data,
            headers={
                'User-Agent': 'Mozilla/5.0',
                'Cookie': cookie,
                'Referer': 'https://ddinter2.scbdd.com/server/interaction/',
                'X-Requested-With': 'XMLHttpRequest'
            }
        )
        
        res = json.loads(urllib.request.urlopen(req_post, timeout=30).read().decode('utf-8'))
        items = res.get('data', [])
        if not items:
            break
        all_mechanisms.extend(items)
        total_records = res.get('recordsTotal', 8466)
        print(f"Fetched {len(items)} items. Total collected: {len(all_mechanisms)} / {total_records}")
        start += batch_size
        time.sleep(0.5)
    except Exception as e:
        print(f"Error fetching offset {start}: {e}. Retrying in 2s...")
        time.sleep(2)

print(f"Total mechanisms harvested: {len(all_mechanisms)}")
os.makedirs('src/data', exist_ok=True)
with open('src/data/ddinter_all_mechanisms.json', 'w', encoding='utf-8') as f:
    json.dump(all_mechanisms, f, indent=2)

print("Saved to src/data/ddinter_all_mechanisms.json!")
