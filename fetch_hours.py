#!/usr/bin/env python3
"""Batch-fetch Google Places hours for all businesses missing them."""

import os, json, requests, time
from dotenv import load_dotenv

load_dotenv()

GOOGLE_KEY = os.getenv('GOOGLE_PLACES_API_KEY', '')
RENDER_URL = 'https://maydayai-greenville-crm.onrender.com'
DET_URL    = 'https://maps.googleapis.com/maps/api/place/details/json'

businesses = requests.get(f'{RENDER_URL}/api/businesses?rep=mayday', timeout=30).json()
need_hours = [b for b in businesses if b.get('google_place_id') and not b.get('hours')]
print(f'{len(need_hours)} businesses need hours\n')

ok = skip = fail = 0

for i, b in enumerate(need_hours, 1):
    try:
        resp = requests.get(DET_URL, params={
            'place_id': b['google_place_id'],
            'fields':   'opening_hours',
            'key':      GOOGLE_KEY,
        }, timeout=10).json()

        weekday = resp.get('result', {}).get('opening_hours', {}).get('weekday_text', [])

        if weekday:
            hours_str = '\n'.join(weekday)
            put = requests.put(f'{RENDER_URL}/api/businesses/{b["id"]}',
                               json={'hours': hours_str}, timeout=10)
            if put.status_code == 200:
                print(f'[{i}/{len(need_hours)}] ✓ {b["name"]}')
                ok += 1
            else:
                print(f'[{i}/{len(need_hours)}] ! PUT failed ({put.status_code}): {b["name"]}')
                fail += 1
        else:
            print(f'[{i}/{len(need_hours)}] – no hours on Google: {b["name"]}')
            skip += 1

    except Exception as e:
        print(f'[{i}/{len(need_hours)}] ✗ error: {b["name"]} — {e}')
        fail += 1

    time.sleep(0.12)  # stay well under Google rate limit

print(f'\nDone — updated: {ok}, no hours listed: {skip}, errors: {fail}')
