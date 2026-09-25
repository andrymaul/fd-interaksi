import urllib.request
import urllib.parse
import json
import re
import time
import os

# 1. Download all CSVs from DDInter download center
csv_codes = ['A', 'D', 'H', 'L', 'P', 'R', 'V']
os.makedirs('data_harvest', exist_ok=True)

for code in csv_codes:
    filename = f'data_harvest/ddinter_downloads_code_{code}.csv'
    if not os.path.exists(filename):
        print(f"Downloading Code {code} CSV...")
        try:
            url = f'https://ddinter2.scbdd.com/static/media/download/ddinter_downloads_code_{code}.csv'
            urllib.request.urlretrieve(url, filename)
            print(f"Downloaded Code {code}: {os.path.getsize(filename)} bytes")
        except Exception as e:
            print(f"Error downloading {code}: {e}")

# Also move code B if exists
if os.path.exists('ddinter_downloads_code_B.csv'):
    os.rename('ddinter_downloads_code_B.csv', 'data_harvest/ddinter_downloads_code_B.csv')

print("All DDI CSV downloads complete!")
