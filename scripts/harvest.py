import urllib.request
import urllib.parse
import json
import re
import time

def get_session():
    req = urllib.request.Request('https://ddinter2.scbdd.com/server/drug/', headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req)
    html = resp.read().decode('utf-8')
    cookie = resp.headers.get('Set-Cookie', '')
    csrf = re.search(r'csrfmiddlewaretoken:\s*\'([^\']+)\'', html).group(1)
    return cookie, csrf

def fetch_table(endpoint, referer, start=0, length=90, cookie=None, csrf=None):
    data = urllib.parse.urlencode({
        'csrfmiddlewaretoken': csrf,
        'draw': '1',
        'start': str(start),
        'length': str(length)
    }).encode('utf-8')
    req = urllib.request.Request(f'https://ddinter2.scbdd.com/server/{endpoint}/', data=data, headers={
        'User-Agent': 'Mozilla/5.0',
        'Cookie': cookie,
        'Referer': f'https://ddinter2.scbdd.com/server/{referer}/',
        'X-Requested-With': 'XMLHttpRequest'
    })
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read().decode('utf-8'))

print("Starting harvest from https://ddinter2.scbdd.com/...")
cookie, csrf = get_session()
print("Session acquired. CSRF:", csrf[:8])

# 1. Fetch 270 drugs (3 pages of 90)
all_drugs = []
for p in range(3):
    print(f"Fetching drugs page {p+1}...")
    res = fetch_table('drug-source', 'drug', start=p*90, length=90, cookie=cookie, csrf=csrf)
    all_drugs.extend(res.get('data', []))
    time.sleep(0.5)

print(f"Total drugs harvested: {len(all_drugs)}")
with open('src/data/ddinter_harvested_drugs.json', 'w') as f:
    json.dump(all_drugs, f, indent=2)

# 2. Fetch 60 interactions
print("Fetching interaction-source...")
res_inter = fetch_table('interaction-source', 'interaction', start=0, length=60, cookie=cookie, csrf=csrf)
interactions = res_inter.get('data', [])
print(f"Total interactions harvested: {len(interactions)}")
with open('src/data/ddinter_harvested_ddi.json', 'w') as f:
    json.dump(interactions, f, indent=2)

# 3. Fetch 40 food interactions
print("Fetching food-interaction-source...")
res_food = fetch_table('food-interaction-source', 'other_interaction', start=0, length=40, cookie=cookie, csrf=csrf)
food_items = res_food.get('data', [])
print(f"Total food interactions harvested: {len(food_items)}")
with open('src/data/ddinter_harvested_food.json', 'w') as f:
    json.dump(food_items, f, indent=2)

# 4. Fetch 40 disease interactions
print("Fetching disease-interaction-source...")
res_dis = fetch_table('disease-interaction-source', 'other_interaction', start=0, length=40, cookie=cookie, csrf=csrf)
dis_items = res_dis.get('data', [])
print(f"Total disease interactions harvested: {len(dis_items)}")
with open('src/data/ddinter_harvested_disease.json', 'w') as f:
    json.dump(dis_items, f, indent=2)

# 5. Fetch 30 duplication records
print("Fetching dupli-interaction-source...")
res_dupli = fetch_table('dupli-interaction-source', 'other_interaction', start=0, length=30, cookie=cookie, csrf=csrf)
dupli_items = res_dupli.get('data', [])
print(f"Total duplications harvested: {len(dupli_items)}")
with open('src/data/ddinter_harvested_dupli.json', 'w') as f:
    json.dump(dupli_items, f, indent=2)

print("Harvest completed successfully!")
