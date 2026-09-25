import json
import re

print("Building comprehensive DDInter v2.0 datasets...")

# Let's inspect harvested files
with open('src/data/ddinter_harvested_disease.json') as f:
    dis_harvested = json.load(f)

with open('src/data/ddinter_harvested_food.json') as f:
    food_harvested = json.load(f)

with open('src/data/ddinter_harvested_dupli.json') as f:
    dupli_harvested = json.load(f)

print(f"Loaded: {len(dis_harvested)} disease, {len(food_harvested)} food, {len(dupli_harvested)} dupli records.")
