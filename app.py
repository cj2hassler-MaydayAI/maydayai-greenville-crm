from flask import Flask, render_template, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os
import requests
import math
import time
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Use PostgreSQL on Railway (DATABASE_URL set automatically), SQLite locally
database_url = os.getenv('DATABASE_URL', 'sqlite:///greenville_crm.db')
if database_url.startswith('postgres://'):
    database_url = database_url.replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

GOOGLE_API_KEY  = os.getenv('GOOGLE_PLACES_API_KEY', '')
ORS_API_KEY     = os.getenv('ORS_API_KEY', '')
RETELL_API_KEY  = os.getenv('RETELL_API_KEY', '')
RETELL_LLM_ID   = os.getenv('RETELL_LLM_ID', '')
RETELL_AGENT_ID = os.getenv('RETELL_AGENT_ID', '')
RETELL_DEMO_URL = os.getenv('RETELL_DEMO_URL', '')

CENTER = {'lat': 35.6127, 'lng': -77.3664}

SKIP_TYPES = {
    'lodging', 'bank', 'atm', 'school', 'university', 'church',
    'place_of_worship', 'local_government_office', 'gas_station',
    'hospital', 'transit_station', 'subway_station', 'bus_station',
    'airport', 'parking', 'post_office'
}

CATEGORY_LABELS = {
    'restaurant': 'Restaurant', 'food': 'Food & Beverage', 'cafe': 'Café',
    'bar': 'Bar', 'bakery': 'Bakery', 'night_club': 'Nightclub',
    'hair_care': 'Hair Care', 'beauty_salon': 'Beauty Salon', 'spa': 'Spa',
    'nail_salon': 'Nail Salon', 'gym': 'Gym/Fitness', 'health': 'Health',
    'doctor': 'Medical', 'dentist': 'Dental', 'physiotherapist': 'Physical Therapy',
    'lawyer': 'Law Office', 'accounting': 'Accounting', 'insurance_agency': 'Insurance',
    'real_estate_agency': 'Real Estate', 'car_repair': 'Auto Repair',
    'car_wash': 'Car Wash', 'florist': 'Florist', 'jewelry_store': 'Jewelry',
    'clothing_store': 'Clothing', 'shoe_store': 'Shoes', 'book_store': 'Bookstore',
    'pet_store': 'Pet Store', 'veterinary_care': 'Veterinary',
    'hardware_store': 'Hardware', 'furniture_store': 'Furniture',
    'electronics_store': 'Electronics', 'pharmacy': 'Pharmacy',
    'store': 'Retail Store', 'establishment': 'Business',
}

OWNER_PROFILES = {
    'restaurant':       {'score': 7, 'window': '9–11am or 2–4pm',  'tip': 'Avoid lunch/dinner rush'},
    'cafe':             {'score': 8, 'window': '7–10am',            'tip': 'Owner often opens personally'},
    'coffee':           {'score': 8, 'window': '7–10am',            'tip': 'Owner often opens personally'},
    'bakery':           {'score': 9, 'window': '7–9am',             'tip': 'Owner arrives early to prep'},
    'bar':              {'score': 6, 'window': '2–5pm',             'tip': 'Before evening rush'},
    'hair_care':        {'score': 9, 'window': '9–11am or 2–4pm',  'tip': 'Owner often works the floor'},
    'beauty_salon':     {'score': 9, 'window': '10am–12pm',         'tip': 'Owner often works the floor'},
    'spa':              {'score': 8, 'window': '10am–12pm',         'tip': 'Owner usually present mid-morning'},
    'nail_salon':       {'score': 7, 'window': '10am–12pm',         'tip': 'Owner often on-site'},
    'dentist':          {'score': 8, 'window': '8–9am or 1–2pm',   'tip': 'Between patient slots'},
    'doctor':           {'score': 6, 'window': '8–9am',             'tip': 'Before patients arrive'},
    'lawyer':           {'score': 7, 'window': '8–10am or 4–5pm',  'tip': 'Before/after client meetings'},
    'accounting':       {'score': 7, 'window': '9–11am',            'tip': 'Between client appointments'},
    'insurance':        {'score': 7, 'window': '9–11am',            'tip': 'Between client appointments'},
    'real_estate':      {'score': 7, 'window': '9–11am',            'tip': 'Before showings start'},
    'gym':              {'score': 8, 'window': '9–11am or 2–4pm',  'tip': 'Between peak hours'},
    'florist':          {'score': 9, 'window': '8–10am',            'tip': 'Owner arrives early to prep'},
    'jewelry':          {'score': 9, 'window': '10am–12pm',         'tip': 'High-value — owner usually present'},
    'clothing':         {'score': 7, 'window': '10am–12pm',         'tip': 'Owner present at opening'},
    'boutique':         {'score': 9, 'window': '10am–12pm',         'tip': 'Small shop — owner on floor'},
    'car_repair':       {'score': 8, 'window': '8–10am or 2–4pm',  'tip': 'Owner usually on-site all day'},
    'pet':              {'score': 8, 'window': '10am–12pm',         'tip': 'Owner often on-site'},
    'veterinary':       {'score': 6, 'window': '8–9am',             'tip': 'Before appointments begin'},
    'hardware':         {'score': 8, 'window': '8–10am',            'tip': 'Owner usually opens shop'},
    'pharmacy':         {'score': 5, 'window': '9–11am',            'tip': 'Between prescription rushes'},
    'book_store':       {'score': 8, 'window': '10am–12pm',         'tip': 'Independent owner often on-site'},
    'default':          {'score': 6, 'window': '10am–12pm',         'tip': 'Mid-morning generally best'},
}

PROFILE_ALIASES = {
    'dental': 'dentist', 'hair': 'hair_care', 'salon': 'beauty_salon',
    'nail': 'nail_salon', 'fitness': 'gym', 'medical': 'doctor',
    'law': 'lawyer', 'attorney': 'lawyer', 'finance': 'accounting',
    'cpa': 'accounting', 'floral': 'florist', 'flower': 'florist',
    'auto': 'car_repair', 'mechanic': 'car_repair', 'barber': 'hair_care',
    'boutique': 'clothing', 'clothing': 'clothing', 'apparel': 'clothing',
    'insurance': 'insurance', 'real estate': 'real_estate',
    'book': 'book_store', 'pet': 'pet', 'vet': 'veterinary',
}

def owner_profile(category):
    if not category:
        return OWNER_PROFILES['default']
    cat = category.lower()
    for alias, key in PROFILE_ALIASES.items():
        if alias in cat and key in OWNER_PROFILES:
            return OWNER_PROFILES[key]
    for key, val in OWNER_PROFILES.items():
        if key in cat:
            return val
    return OWNER_PROFILES['default']

def friendly_category(types):
    for t in (types or []):
        if t in CATEGORY_LABELS:
            return CATEGORY_LABELS[t]
    return 'Business'

def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))

def nearest_neighbor_route(businesses, start):
    remaining = list(businesses)
    route = []
    current = start
    while remaining:
        nearest = min(
            remaining,
            key=lambda b: haversine(current['lat'], current['lng'], b.lat or 0, b.lng or 0)
        )
        route.append(nearest)
        current = {'lat': nearest.lat or 0, 'lng': nearest.lng or 0}
        remaining.remove(nearest)
    return route

def time_to_minutes(t):
    if not t:
        return None
    try:
        h, m = map(int, t.split(':'))
        return h * 60 + m
    except Exception:
        return None

def time_aware_route(businesses, start):
    """Slot time-constrained businesses at the right position; fill gaps with nearest-neighbor."""
    constrained = sorted(
        [(b, time_to_minutes(b.return_at)) for b in businesses if time_to_minutes(b.return_at)],
        key=lambda x: x[1]
    )
    unconstrained = [b for b in businesses if not time_to_minutes(b.return_at)]

    route = []
    remaining = list(unconstrained)
    prev_min = 9 * 60  # assume 9 AM start
    current_pos = start

    for biz, target_min in constrained:
        gap = target_min - prev_min
        slots = max(0, int(gap / 20) - 1)  # ~20 min per stop (drive + pitch)

        for _ in range(min(slots, len(remaining))):
            nearest = min(remaining, key=lambda b: haversine(
                current_pos['lat'], current_pos['lng'], b.lat or 0, b.lng or 0))
            route.append(nearest)
            current_pos = {'lat': nearest.lat or 0, 'lng': nearest.lng or 0}
            remaining.remove(nearest)

        route.append(biz)
        current_pos = {'lat': biz.lat or 0, 'lng': biz.lng or 0}
        prev_min = target_min + 20

    # Append remaining unconstrained stops at the end
    if remaining:
        route.extend(nearest_neighbor_route(remaining, current_pos))

    return route


class Business(db.Model):
    # Each rep owns their own copy of a business — CJ and Mason can both have
    # "Spa X" with independent statuses. Uniqueness is per (place, rep).
    __table_args__ = (db.UniqueConstraint('google_place_id', 'rep', name='uq_business_place_rep'),)
    id = db.Column(db.Integer, primary_key=True)
    google_place_id = db.Column(db.String(255), nullable=True)
    name = db.Column(db.String(255), nullable=False)
    address = db.Column(db.String(500))
    lat = db.Column(db.Float)
    lng = db.Column(db.Float)
    phone = db.Column(db.String(50))
    website = db.Column(db.String(500))
    category = db.Column(db.String(100))
    status = db.Column(db.String(50), default='unvisited')
    owner_name = db.Column(db.String(255))
    notes = db.Column(db.Text)
    owner_score = db.Column(db.Integer, default=6)
    best_window = db.Column(db.String(100))
    visit_tip = db.Column(db.String(255))
    return_at = db.Column(db.String(10))   # HH:MM 24h, e.g. "14:00"
    return_note = db.Column(db.String(255)) # e.g. "ask for Mike"
    rep = db.Column(db.String(20))          # 'cj', 'mason', or null (shared/legacy)
    hours = db.Column(db.Text)
    voice_prompt = db.Column(db.Text)
    last_visited = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'google_place_id': self.google_place_id,
            'name': self.name,
            'address': self.address,
            'lat': self.lat,
            'lng': self.lng,
            'phone': self.phone,
            'website': self.website,
            'category': self.category,
            'status': self.status,
            'owner_name': self.owner_name,
            'notes': self.notes,
            'owner_score': self.owner_score,
            'best_window': self.best_window,
            'visit_tip': self.visit_tip,
            'return_at': self.return_at,
            'return_note': self.return_note,
            'rep': self.rep,
            'hours': self.hours,
            'voice_prompt': self.voice_prompt,
            'last_visited': self.last_visited.isoformat() if self.last_visited else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Setting(db.Model):
    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text)


class Visit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    business_id = db.Column(db.Integer, db.ForeignKey('business.id'), nullable=False)
    visited_at = db.Column(db.DateTime, default=datetime.utcnow)
    outcome = db.Column(db.String(50))
    contact_name = db.Column(db.String(255))
    notes = db.Column(db.Text)
    product_pitched = db.Column(db.String(255), default='AI Voice Receptionist')

    def to_dict(self):
        return {
            'id': self.id,
            'business_id': self.business_id,
            'visited_at': self.visited_at.isoformat(),
            'outcome': self.outcome,
            'contact_name': self.contact_name,
            'notes': self.notes,
            'product_pitched': self.product_pitched,
        }


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/health')
def health():
    # Lightweight target for UptimeRobot — no DB query, no template render
    return jsonify({'ok': True})

@app.route('/api/businesses', methods=['GET'])
def get_businesses():
    rep = request.args.get('rep', '')
    q = Business.query
    if rep and rep != 'mayday':
        q = q.filter(Business.rep == rep)
    businesses = q.order_by(Business.owner_score.desc()).all()
    return jsonify([b.to_dict() for b in businesses])

@app.route('/api/businesses', methods=['POST'])
def add_business():
    data = request.json
    rep = (data.get('rep') or '').strip()
    if rep not in ('cj', 'mason'):
        return jsonify({'error': 'Switch to your CJ or Mason tab to add businesses — MaydayAI is a read-only overview'}), 400
    # Duplicate check is per-rep: Mason having it doesn't block CJ from adding it
    if data.get('google_place_id'):
        existing = Business.query.filter_by(google_place_id=data['google_place_id'], rep=rep).first()
        if existing:
            return jsonify({'error': f'"{existing.name}" is already in your list'}), 409
    profile = owner_profile(data.get('category', ''))
    b = Business(
        name=data['name'],
        address=data.get('address', ''),
        lat=data.get('lat'),
        lng=data.get('lng'),
        phone=data.get('phone', ''),
        website=data.get('website', ''),
        category=data.get('category', ''),
        google_place_id=data.get('google_place_id'),
        owner_score=profile['score'],
        best_window=profile['window'],
        visit_tip=profile['tip'],
        rep=rep,
    )
    db.session.add(b)
    db.session.commit()
    return jsonify(b.to_dict()), 201

@app.route('/api/businesses/<int:bid>', methods=['PUT'])
def update_business(bid):
    b = Business.query.get_or_404(bid)
    data = request.json
    for key, value in data.items():
        if hasattr(b, key) and key not in ('id', 'created_at', 'google_place_id'):
            setattr(b, key, value)
    if data.get('status') and data['status'] != 'unvisited':
        b.last_visited = datetime.utcnow()
    b.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(b.to_dict())

@app.route('/api/businesses/<int:bid>', methods=['DELETE'])
def delete_business(bid):
    b = Business.query.get_or_404(bid)
    Visit.query.filter_by(business_id=bid).delete()
    db.session.delete(b)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/businesses/<int:bid>/fetch_hours', methods=['POST'])
def fetch_hours(bid):
    b = Business.query.get_or_404(bid)
    if not b.google_place_id or not GOOGLE_API_KEY:
        return jsonify({'hours': None})
    try:
        resp = requests.get('https://maps.googleapis.com/maps/api/place/details/json', params={
            'place_id': b.google_place_id,
            'fields': 'opening_hours',
            'key': GOOGLE_API_KEY,
        }, timeout=10)
        weekday_text = resp.json().get('result', {}).get('opening_hours', {}).get('weekday_text', [])
        if weekday_text:
            b.hours = '\n'.join(weekday_text)
            b.updated_at = datetime.utcnow()
            db.session.commit()
            return jsonify({'hours': b.hours})
    except Exception:
        pass
    return jsonify({'hours': None})

@app.route('/api/businesses/<int:bid>/push_to_retell', methods=['POST'])
def push_to_retell(bid):
    b = Business.query.get_or_404(bid)
    prompt = (request.json or {}).get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': 'No prompt provided'}), 400
    if not RETELL_API_KEY or not RETELL_LLM_ID:
        return jsonify({'error': 'Retell not configured on server'}), 500

    headers = {
        'Authorization': f'Bearer {RETELL_API_KEY}',
        'Content-Type': 'application/json',
    }
    begin_msg = f"Hey, thanks for calling {b.name} — this is Mason. How can I help you today?"

    llm_resp = requests.patch(
        f'https://api.retellai.com/update-retell-llm/{RETELL_LLM_ID}',
        headers=headers,
        json={'general_prompt': prompt, 'begin_message': begin_msg},
        timeout=15,
    )
    if llm_resp.status_code not in (200, 201):
        return jsonify({'error': f'Retell LLM update failed ({llm_resp.status_code})'}), 500

    if RETELL_AGENT_ID:
        requests.post(
            f'https://api.retellai.com/publish-agent-version/{RETELL_AGENT_ID}',
            headers=headers,
            timeout=10,
        )

    return jsonify({'ok': True, 'demo_url': RETELL_DEMO_URL})

@app.route('/api/visits', methods=['POST'])
def add_visit():
    data = request.json
    visit = Visit(
        business_id=data['business_id'],
        outcome=data.get('outcome', 'visited'),
        contact_name=data.get('contact_name', ''),
        notes=data.get('notes', ''),
        product_pitched=data.get('product_pitched', 'AI Voice Receptionist'),
    )
    db.session.add(visit)
    b = Business.query.get(data['business_id'])
    if b:
        b.status = data.get('outcome', 'visited')
        b.last_visited = datetime.utcnow()
        if data.get('contact_name'):
            b.owner_name = data['contact_name']
        if data.get('notes'):
            existing = b.notes or ''
            b.notes = (existing + '\n' + data['notes']).strip()
        if data.get('return_at'):
            b.return_at = data['return_at']
            b.return_note = data.get('return_note', '')
        else:
            # Clear any previous return time if not setting a new one
            b.return_at = None
            b.return_note = None
        b.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(visit.to_dict()), 201

@app.route('/api/visits/<int:bid>', methods=['GET'])
def get_visits(bid):
    visits = Visit.query.filter_by(business_id=bid).order_by(Visit.visited_at.desc()).all()
    return jsonify([v.to_dict() for v in visits])

@app.route('/api/lookup', methods=['POST'])
def lookup_business():
    if not GOOGLE_API_KEY:
        return jsonify({'error': 'Google API key required'}), 400

    name = (request.json or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    search_resp = requests.get('https://maps.googleapis.com/maps/api/place/textsearch/json', params={
        'query': f'{name} Greenville NC',
        'location': f"{CENTER['lat']},{CENTER['lng']}",
        'radius': 8000,
        'key': GOOGLE_API_KEY,
    }, timeout=10)
    results = search_resp.json().get('results', [])

    if not results:
        return jsonify({'found': False, 'message': f'No Google listing found for "{name}" in Greenville, NC'})

    place = results[0]
    place_id = place['place_id']

    detail_resp = requests.get('https://maps.googleapis.com/maps/api/place/details/json', params={
        'place_id': place_id,
        'fields': 'name,formatted_address,formatted_phone_number,website,geometry,types',
        'key': GOOGLE_API_KEY,
    }, timeout=10)
    detail = detail_resp.json().get('result', {})

    types = detail.get('types') or place.get('types', [])
    cat = friendly_category(types)
    raw_type = types[0] if types else ''
    profile = owner_profile(raw_type)
    loc = (detail.get('geometry') or place.get('geometry', {})).get('location', {})

    return jsonify({
        'found': True,
        'google_place_id': place_id,
        'name': detail.get('name') or place.get('name', name),
        'address': detail.get('formatted_address') or place.get('formatted_address', ''),
        'phone': detail.get('formatted_phone_number', ''),
        'website': detail.get('website', ''),
        'lat': loc.get('lat'),
        'lng': loc.get('lng'),
        'category': cat,
        'owner_score': profile['score'],
        'best_window': profile['window'],
        'visit_tip': profile['tip'],
    })

@app.route('/api/discover', methods=['POST'])
def discover():
    if not GOOGLE_API_KEY:
        return jsonify({'error': 'Add your GOOGLE_PLACES_API_KEY to .env to use discovery'}), 400

    data = request.json
    rep = (data.get('rep') or '').strip()
    if rep not in ('cj', 'mason'):
        return jsonify({'error': 'Switch to your CJ or Mason tab to discover — MaydayAI is a read-only overview'}), 400
    place_type = data.get('type', '')
    keyword = data.get('keyword', 'small business')
    lat = data.get('lat', CENTER['lat'])
    lng = data.get('lng', CENTER['lng'])
    # Discovered businesses go into the CURRENT rep's list. The dedup below is
    # per-rep, so Mason having a business never blocks CJ from discovering it.

    THIRTY_MILES_M = 48280

    url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
    params = {
        'location': f"{lat},{lng}",
        'radius': THIRTY_MILES_M,
        'key': GOOGLE_API_KEY,
    }
    if place_type:
        params['type'] = place_type
    else:
        params['keyword'] = keyword

    resp = requests.get(url, params=params, timeout=10)
    places = resp.json().get('results', [])

    added, skipped = [], []
    for place in places[:25]:
        types = place.get('types', [])
        if any(t in SKIP_TYPES for t in types):
            skipped.append(place['name'])
            continue
        if Business.query.filter_by(google_place_id=place['place_id'], rep=rep).first():
            skipped.append(place['name'])
            continue

        cat = friendly_category(types)
        raw_type = types[0] if types else ''
        profile = owner_profile(raw_type)
        loc = place.get('geometry', {}).get('location', {})

        b = Business(
            google_place_id=place['place_id'],
            name=place['name'],
            address=place.get('vicinity', ''),
            lat=loc.get('lat'),
            lng=loc.get('lng'),
            category=cat,
            owner_score=profile['score'],
            best_window=profile['window'],
            visit_tip=profile['tip'],
            rep=rep,
        )
        db.session.add(b)
        added.append(place['name'])

    db.session.commit()
    return jsonify({'added': len(added), 'skipped': len(skipped), 'names': added})

def get_home_base():
    s = Setting.query.get('home_base')
    if s:
        import json
        return json.loads(s.value)
    return None

@app.route('/api/home_base', methods=['GET'])
def get_home():
    hb = get_home_base()
    return jsonify(hb or {})

@app.route('/api/home_base', methods=['POST'])
def set_home():
    data = request.json
    address = data.get('address', '')
    lat = data.get('lat')
    lng = data.get('lng')

    if address and not (lat and lng) and GOOGLE_API_KEY:
        resp = requests.get('https://maps.googleapis.com/maps/api/place/textsearch/json', params={
            'query': address + ' Greenville NC',
            'key': GOOGLE_API_KEY,
        }, timeout=10)
        result = resp.json()
        if result.get('results'):
            loc = result['results'][0]['geometry']['location']
            lat, lng = loc['lat'], loc['lng']
            address = result['results'][0].get('formatted_address') or result['results'][0].get('name', address)

    if not (lat and lng):
        return jsonify({'error': 'Could not resolve location'}), 400

    import json
    payload = {'lat': lat, 'lng': lng, 'address': address}
    s = Setting.query.get('home_base')
    if s:
        s.value = json.dumps(payload)
    else:
        db.session.add(Setting(key='home_base', value=json.dumps(payload)))
    db.session.commit()
    return jsonify(payload)

@app.route('/api/route', methods=['POST'])
def optimize_route():
    data = request.json
    ids = data.get('business_ids', [])
    honor_times = data.get('honor_times', False)
    start = get_home_base() or CENTER

    if len(ids) < 2:
        return jsonify({'error': 'Select at least 2 businesses'}), 400

    businesses = Business.query.filter(Business.id.in_(ids)).all()
    valid = [b for b in businesses if b.lat and b.lng]

    has_constrained = honor_times and any(time_to_minutes(b.return_at) for b in valid)

    if ORS_API_KEY and len(valid) >= 2 and not has_constrained:
        try:
            jobs = [{'id': b.id, 'location': [b.lng, b.lat], 'service': 300} for b in valid]
            payload = {
                'jobs': jobs,
                'vehicles': [{'id': 1, 'start': [start['lng'], start['lat']], 'end': [start['lng'], start['lat']]}]
            }
            headers = {'Authorization': ORS_API_KEY, 'Content-Type': 'application/json'}
            resp = requests.post('https://api.openrouteservice.org/optimization', json=payload, headers=headers, timeout=10)
            result = resp.json()
            if 'routes' in result and result['routes']:
                steps = result['routes'][0]['steps']
                ordered_ids = [s['job'] for s in steps if s.get('type') == 'job']
                bmap = {b.id: b for b in valid}
                ordered = [bmap[i].to_dict() for i in ordered_ids if i in bmap]
                summary = result['routes'][0].get('summary', {})
                return jsonify({
                    'optimized': True,
                    'route': ordered,
                    'distance_km': round(summary.get('distance', 0) / 1000, 1),
                    'duration_min': round(summary.get('duration', 0) / 60),
                })
        except Exception:
            pass

    if has_constrained:
        ordered = time_aware_route(valid, start)
        method = 'time-aware'
    else:
        ordered = nearest_neighbor_route(valid, start)
        method = 'nearest-neighbor'

    return jsonify({
        'optimized': True,
        'route': [b.to_dict() for b in ordered],
        'distance_km': None,
        'duration_min': None,
        'method': method,
    })

@app.route('/api/stats', methods=['GET'])
def stats():
    rep = request.args.get('rep', '')
    q = Business.query
    if rep and rep != 'mayday':
        q = q.filter(Business.rep == rep)
    total = q.count()
    visited = q.filter(Business.status != 'unvisited').count()
    interested = q.filter_by(status='interested').count()
    follow_up = q.filter_by(status='follow_up').count()
    closed = q.filter_by(status='closed').count()
    not_interested = q.filter_by(status='not_interested').count()

    return jsonify({
        'total': total,
        'visited': visited,
        'unvisited': total - visited,
        'interested': interested,
        'follow_up': follow_up,
        'closed': closed,
        'not_interested': not_interested,
        'interest_rate': round((interested + follow_up + closed) / visited * 100, 1) if visited else 0,
        'close_rate': round(closed / visited * 100, 1) if visited else 0,
    })

@app.route('/api/suggestions', methods=['GET'])
def suggestions():
    rep = request.args.get('rep', '')
    q = Business.query.filter_by(status='unvisited')
    if rep and rep != 'mayday':
        q = q.filter(Business.rep == rep)
    businesses = q.order_by(Business.owner_score.desc()).limit(10).all()
    return jsonify([b.to_dict() for b in businesses])

IMPORT_CHAIN_BLOCKLIST = {
    'great clips', 'sport clips', 'supercuts', "fantastic sam's", 'cost cutters', 'master cuts',
    'aspen dental', 'bright now', 'western dental', 'pacific dental', 'kool smiles', 'comfort dental',
}

@app.route('/api/admin/import_greenville', methods=['POST'])
def import_greenville():
    if not GOOGLE_API_KEY:
        return jsonify({'error': 'No Google API key configured'}), 400
    rep = ((request.json or {}).get('rep') or '').strip()
    if rep not in ('cj', 'mason'):
        return jsonify({'error': 'Pass rep: cj or mason — imports go into a specific rep\'s list'}), 400

    SEARCHES = [
        # (place_type, keyword, category_label, profile_key)
        ('',         'med spa',           'Medical Front Desk', 'spa'),
        ('dentist',  '',                  'Medical Front Desk', 'dentist'),
        ('',         'chiropractor',      'Medical Front Desk', 'doctor'),
        ('',         'physical therapy',  'Medical Front Desk', 'doctor'),
        ('lawyer',   '',                  'Law Firm',           'lawyer'),
        ('hair_care','',                  'Luxury Hair Salon',  'hair_care'),
    ]

    NB_URL  = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
    DET_URL = 'https://maps.googleapis.com/maps/api/place/details/json'
    CENTER_LAT, CENTER_LNG = 35.6127, -77.3664
    THIRTY_MILES_M = 48280

    total_added = total_skipped = 0
    breakdown = []

    for place_type, keyword, category_label, profile_key in SEARCHES:
        base_params = {'location': f'{CENTER_LAT},{CENTER_LNG}', 'radius': THIRTY_MILES_M, 'key': GOOGLE_API_KEY}
        if place_type:
            base_params['type'] = place_type
        if keyword:
            base_params['keyword'] = keyword

        # Paginate up to 3 pages (max 60 results per search)
        places = []
        page_params = base_params.copy()
        for _ in range(3):
            resp = requests.get(NB_URL, params=page_params, timeout=15)
            rdata = resp.json()
            places.extend(rdata.get('results', []))
            next_token = rdata.get('next_page_token')
            if not next_token:
                break
            time.sleep(2)
            page_params = {'pagetoken': next_token, 'key': GOOGLE_API_KEY}

        profile = owner_profile(profile_key)
        added = skipped = 0

        for place in places:
            name = place.get('name', '')
            if any(c in name.lower() for c in IMPORT_CHAIN_BLOCKLIST):
                skipped += 1
                continue

            types = place.get('types', [])
            if any(t in SKIP_TYPES for t in types):
                skipped += 1
                continue

            place_id = place.get('place_id', '')
            if Business.query.filter_by(google_place_id=place_id, rep=rep).first():
                skipped += 1
                continue

            loc = place.get('geometry', {}).get('location', {})
            plat, plng = loc.get('lat'), loc.get('lng')
            if plat and plng and haversine(CENTER_LAT, CENTER_LNG, plat, plng) > 48.28:
                skipped += 1
                continue

            # Fetch phone + website from Details API
            phone = website = ''
            try:
                det = requests.get(DET_URL, params={
                    'place_id': place_id, 'fields': 'formatted_phone_number,website', 'key': GOOGLE_API_KEY
                }, timeout=10).json().get('result', {})
                phone   = det.get('formatted_phone_number', '')
                website = det.get('website', '')
            except Exception:
                pass

            db.session.add(Business(
                google_place_id=place_id,
                name=name,
                address=place.get('vicinity', ''),
                lat=plat, lng=plng,
                phone=phone, website=website,
                category=category_label,
                owner_score=profile['score'],
                best_window=profile['window'],
                visit_tip=profile['tip'],
                rep=rep,
            ))
            added += 1

        db.session.commit()
        breakdown.append({'search': keyword or place_type, 'category': category_label, 'added': added, 'skipped': skipped})
        total_added += added
        total_skipped += skipped

    return jsonify({'total_added': total_added, 'total_skipped': total_skipped, 'breakdown': breakdown})

@app.route('/api/businesses/bulk_delete', methods=['POST'])
def bulk_delete_businesses():
    ids  = request.json.get('ids', [])
    rep  = request.json.get('rep', '')
    if rep not in ('cj', 'mason'):
        return jsonify({'error': 'MaydayAI is a read-only overview — switch to your own tab to delete'}), 403
    if not ids:
        return jsonify({'deleted': 0})
    q = Business.query.filter(Business.id.in_(ids), Business.rep == rep)
    safe_ids = [b.id for b in q.all()]
    if safe_ids:
        Visit.query.filter(Visit.business_id.in_(safe_ids)).delete(synchronize_session=False)
        Business.query.filter(Business.id.in_(safe_ids)).delete(synchronize_session=False)
        db.session.commit()
    return jsonify({'deleted': len(safe_ids)})


with app.app_context():
    db.create_all()
    # Migration: add rep column to existing databases
    for col_sql in [
        'ALTER TABLE business ADD COLUMN rep VARCHAR(20)',
        'ALTER TABLE business ADD COLUMN hours TEXT',
        'ALTER TABLE business ADD COLUMN voice_prompt TEXT',
        # Per-rep ownership: global unique on google_place_id → unique per (place, rep)
        'ALTER TABLE business DROP CONSTRAINT business_google_place_id_key',
        'ALTER TABLE business ADD CONSTRAINT uq_business_place_rep UNIQUE (google_place_id, rep)',
    ]:
        try:
            db.session.execute(db.text(col_sql))
            db.session.commit()
        except Exception:
            db.session.rollback()

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5001))
    debug = os.getenv('RAILWAY_ENVIRONMENT') is None
    app.run(debug=debug, port=port, host='0.0.0.0')
