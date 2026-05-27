// State
let allBusinesses = [];
let map, markers = {};
let homeBase = null;
let homeMarker = null;
let pendingHomeLatLng = null;
let currentBusiness = null;
let selectedOutcome = null;
let routeVisible = false;
let routeLayer = null;
let currentTab = 'list';
let currentRep = localStorage.getItem('maydaycrm_rep') || null;

const STATUS_COLORS = {
  unvisited: '#6b7280',
  visited: '#3b82f6',
  interested: '#22c55e',
  not_interested: '#ef4444',
  follow_up: '#f59e0b',
  closed: '#a855f7',
  no_answer: '#6b7280',
};

const STATUS_LABELS = {
  unvisited: 'Unvisited',
  visited: 'Visited',
  interested: 'Interested',
  not_interested: 'Not Interested',
  follow_up: 'Follow-Up',
  closed: 'Closed',
  no_answer: 'No Answer',
};

// ── INIT ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  if (!currentRep) {
    showRepPicker();
  } else {
    applyRep(currentRep);
    loadAll();
  }
});

// ── REP / USER PICKER ─────────────────────────────────────────────────────────

function showRepPicker() {
  document.getElementById('repPicker').classList.remove('hidden');
}

function setRep(rep) {
  currentRep = rep;
  localStorage.setItem('maydaycrm_rep', rep);
  document.getElementById('repPicker').classList.add('hidden');
  applyRep(rep);
  loadAll();
}

function applyRep(rep) {
  const labels = { cj: 'CJ', mason: 'Mason', mayday: 'MaydayAI' };
  const colors = { cj: '#3b82f6', mason: '#22c55e', mayday: '#a855f7' };
  const badgeText = document.getElementById('repBadgeText');
  const badge = document.getElementById('repBadge');
  if (badgeText) badgeText.textContent = labels[rep] || rep;
  if (badge) badge.style.borderColor = colors[rep] || '';
}

function initMap() {
  const isMobile = window.innerWidth <= 768;
  map = L.map('map', { zoomControl: !isMobile }).setView([35.6127, -77.3664], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  // Clicking the map while home modal is open pins the start location
  map.on('click', (e) => {
    if (!document.getElementById('homeModal').classList.contains('hidden')) {
      pendingHomeLatLng = e.latlng;
      document.getElementById('homeAddress').value = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
      placeHomeMarker(e.latlng.lat, e.latlng.lng, 'Click "Save" to confirm this location');
    }
  });
}

async function loadAll() {
  await Promise.all([loadBusinesses(), loadStats(), loadSuggestions(), loadHomeBase()]);
}

async function loadHomeBase() {
  const res = await fetch('/api/home_base');
  const data = await res.json();
  if (data.lat && data.lng) {
    homeBase = data;
    updateHomeUI();
    placeHomeMarker(data.lat, data.lng, data.address || 'Start / End');
  }
}

function updateHomeUI() {
  const label = document.getElementById('homeBaseLabel');
  if (homeBase && homeBase.address) {
    label.textContent = homeBase.address;
    label.classList.add('set');
  } else {
    label.textContent = 'No start location set';
    label.classList.remove('set');
  }
}

function placeHomeMarker(lat, lng, address) {
  if (homeMarker) map.removeLayer(homeMarker);
  homeMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div style="width:22px;height:22px;border-radius:50%;background:#14b8a6;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:11px">🏠</div>`,
      className: '',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
    zIndexOffset: 1000,
  }).addTo(map);
  homeMarker.bindPopup(`<div class="map-popup"><strong>Start / End Point</strong><div class="popup-meta">${esc(address || '')}</div></div>`);
}

// ── DATA ──────────────────────────────────────────────────────────────────────

async function loadBusinesses() {
  const res = await fetch(`/api/businesses?rep=${currentRep || 'mayday'}`);
  allBusinesses = await res.json();
  renderList(filtered());
  updateMapMarkers();
}

async function loadStats() {
  const res = await fetch(`/api/stats?rep=${currentRep || 'mayday'}`);
  const s = await res.json();
  setText('stat-total', s.total, 'Total');
  setText('stat-unvisited', s.unvisited, 'Unvisited');
  setText('stat-visited', s.visited, 'Visited');
  setText('stat-followup', s.follow_up, 'Follow-Up');
  setText('stat-closed', s.closed, 'Closed');
  setText('stat-rate', s.close_rate + '%', 'Close Rate');
  // Mobile stats bar
  const ms = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  ms('m-total', s.total);
  ms('m-unvisited', s.unvisited);
  ms('m-followup', s.follow_up);
  ms('m-closed', s.closed);
}

async function loadSuggestions() {
  const res = await fetch(`/api/suggestions?rep=${currentRep || 'mayday'}`);
  const list = await res.json();
  renderSuggestions(list);
}

function setText(id, num, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('.pill-num').textContent = num;
  el.querySelector('.pill-label').textContent = label;
}

// ── LIST RENDERING ────────────────────────────────────────────────────────────

function filtered() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const status = document.getElementById('statusFilter').value;
  const sort = document.getElementById('sortSelect').value;

  let list = allBusinesses.filter(b => {
    const matchQ = !q || b.name.toLowerCase().includes(q) || (b.address || '').toLowerCase().includes(q) || (b.category || '').toLowerCase().includes(q);
    const matchS = !status || b.status === status;
    return matchQ && matchS;
  });

  if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'recent') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else list.sort((a, b) => b.owner_score - a.owner_score);

  return list;
}

function filterList() {
  if (currentTab === 'list') renderList(filtered());
}

function renderList(businesses) {
  const el = document.getElementById('businessList');
  if (!businesses.length) {
    el.innerHTML = '<div class="empty-state">No businesses found.<br>Use Discover or Add Manual to get started.</div>';
    updateSelectionUI();
    return;
  }
  el.innerHTML = businesses.map(b => cardHTML(b)).join('');
  updateSelectionUI();
}

function renderSuggestions(businesses) {
  const el = document.getElementById('suggestionList');
  if (!businesses.length) {
    el.innerHTML = '<div class="empty-state">No unvisited businesses yet.</div>';
    return;
  }
  const now = new Date();
  const hour = now.getHours();
  let timeNote = '';
  if (hour >= 9 && hour < 12) timeNote = 'Good time to visit: mid-morning';
  else if (hour >= 14 && hour < 17) timeNote = 'Good time to visit: mid-afternoon';
  else if (hour < 9) timeNote = 'Tip: wait until 9am for most businesses';
  else if (hour >= 12 && hour < 14) timeNote = 'Tip: avoid lunch rush right now';
  else timeNote = 'Evening — plan your route for tomorrow';

  el.innerHTML = `<div class="suggest-header">${timeNote}</div>` + businesses.map(b => cardHTML(b)).join('');
}

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function cardHTML(b) {
  const dots = Array.from({length: 10}, (_, i) =>
    `<span class="score-dot${i < b.owner_score ? ' filled' : ''}"></span>`
  ).join('');
  const returnBadge = b.return_at
    ? `<span class="return-badge">⏰ Back at ${fmt12(b.return_at)}${b.return_note ? ' · ' + esc(b.return_note) : ''}</span>`
    : '';
  return `
    <div class="biz-card" id="card-${b.id}" onclick="openDetail(${b.id})">
      <div class="biz-card-top">
        <input type="checkbox" class="biz-check" data-id="${b.id}" onclick="event.stopPropagation(); toggleRouteSelect(${b.id})" />
        <span class="biz-name">${esc(b.name)}</span>
        <span class="status-badge s-${b.status}">${STATUS_LABELS[b.status] || b.status}</span>
      </div>
      <div class="biz-meta">
        <span class="biz-category">${esc(b.category || 'Business')}</span>
        ${b.best_window ? `<span class="biz-window">🕐 ${esc(b.best_window)}</span>` : ''}
        <span class="score-dots">${dots}</span>
      </div>
      ${returnBadge ? `<div style="padding-left:24px;margin-top:2px">${returnBadge}</div>` : ''}
    </div>`;
}

// ── MAP ───────────────────────────────────────────────────────────────────────

function updateMapMarkers() {
  // Remove markers that are no longer in the current rep's business list
  const activeIds = new Set(allBusinesses.map(b => b.id));
  Object.keys(markers).forEach(id => {
    if (!activeIds.has(parseInt(id))) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });

  // Add or update remaining markers
  allBusinesses.forEach(b => {
    if (!b.lat || !b.lng) return;
    const color = STATUS_COLORS[b.status] || '#6b7280';
    const icon = makeIcon(color);
    if (markers[b.id]) {
      markers[b.id].setIcon(icon);
    } else {
      const m = L.marker([b.lat, b.lng], { icon }).addTo(map);
      m.bindPopup(popupHTML(b));
      m.on('click', () => openDetail(b.id));
      markers[b.id] = m;
    }
  });
}

function makeIcon(color) {
  return L.divIcon({
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5)"></div>`,
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function popupHTML(b) {
  return `<div class="map-popup">
    <strong>${esc(b.name)}</strong>
    <div class="popup-meta">${esc(b.category || '')} · ⏰ ${esc(b.best_window || '—')}</div>
    <button onclick="openDetail(${b.id})">View Details</button>
  </div>`;
}

// ── BUSINESS DETAIL ───────────────────────────────────────────────────────────

async function openDetail(id) {
  currentBusiness = allBusinesses.find(b => b.id === id);
  if (!currentBusiness) return;
  const b = currentBusiness;

  document.getElementById('detailName').textContent = b.name;
  document.getElementById('detailCategory').textContent = b.category || 'Business';
  setStatusBadge('detailStatus', b.status);
  const addrEl = document.getElementById('detailAddress');
  if (b.address) {
    const mapsUrl = b.lat && b.lng
      ? `https://maps.apple.com/?ll=${b.lat},${b.lng}&q=${encodeURIComponent(b.name)}`
      : `https://maps.apple.com/?q=${encodeURIComponent(b.address)}`;
    addrEl.innerHTML = `<a href="${mapsUrl}" target="_blank" class="detail-link">${esc(b.address)}</a>`;
  } else { addrEl.textContent = '—'; }

  const phoneEl = document.getElementById('detailPhone');
  if (b.phone) {
    const tel = b.phone.replace(/\D/g, '');
    phoneEl.innerHTML = `<a href="tel:${tel}" class="detail-link">${esc(b.phone)}</a>`;
  } else { phoneEl.textContent = '—'; }

  const webEl = document.getElementById('detailWebsite');
  if (b.website) {
    const url = b.website.startsWith('http') ? b.website : `https://${b.website}`;
    webEl.innerHTML = `<a href="${esc(url)}" target="_blank" class="detail-link">${esc(b.website)}</a>`;
  } else { webEl.textContent = '—'; }
  document.getElementById('detailOwner').textContent = b.owner_name ? `Owner: ${b.owner_name}` : 'Owner unknown';
  document.getElementById('detailWindow').textContent = b.best_window || '';
  document.getElementById('detailTip').textContent = b.visit_tip || '';
  document.getElementById('detailNotes').textContent = b.notes || 'No notes yet.';

  const stars = Array.from({length: 10}, (_, i) =>
    `<span class="score-star">${i < b.owner_score ? '★' : '☆'}</span>`
  ).join('');
  document.getElementById('detailStars').innerHTML = stars;

  const visits = await fetch(`/api/visits/${id}`).then(r => r.json());
  const vh = document.getElementById('visitHistory');
  if (visits.length) {
    vh.innerHTML = '<div class="notes-label" style="margin-top:16px">Visit History</div>' +
      visits.map(v => `
        <div class="visit-item">
          <div class="visit-item-header">
            <span class="status-badge s-${v.outcome}">${STATUS_LABELS[v.outcome] || v.outcome}</span>
            <span class="visit-date">${new Date(v.visited_at).toLocaleDateString()}</span>
            ${v.contact_name ? `<span>${esc(v.contact_name)}</span>` : ''}
            <span style="color:#64748b;font-size:11px">${esc(v.product_pitched || '')}</span>
          </div>
          ${v.notes ? `<div class="visit-notes">${esc(v.notes)}</div>` : ''}
        </div>`).join('');
  } else {
    vh.innerHTML = '';
  }

  document.getElementById('voicePromptText').value = b.voice_prompt || generatePrompt(b);

  // If hours not cached yet and we have a Google place ID, fetch in background
  if (!b.hours && b.google_place_id) {
    fetch(`/api/businesses/${b.id}/fetch_hours`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.hours) {
          b.hours = data.hours;
          // Only update the textarea if user hasn't edited it yet
          const ta = document.getElementById('voicePromptText');
          if (ta && currentBusiness?.id === b.id) ta.value = generatePrompt(b);
        }
      })
      .catch(() => {});
  }

  show('detailModal');
  if (b.lat && b.lng) {
    document.querySelector('.left-panel').classList.remove('mobile-open');
    setTimeout(() => { map && map.invalidateSize(); map.setView([b.lat, b.lng], 17); }, 50);
  }
}

function setStatusBadge(elId, status) {
  const el = document.getElementById(elId);
  el.textContent = STATUS_LABELS[status] || status;
  el.className = `status-badge s-${status}`;
}

function closeDetail(e) { if (e.target.id === 'detailModal') closeDetailModal(); }
function closeDetailModal() { hide('detailModal'); currentBusiness = null; }

async function deleteCurrentBusiness() {
  if (!currentBusiness) return;
  if (!confirm(`Delete "${currentBusiness.name}"?`)) return;
  await fetch(`/api/businesses/${currentBusiness.id}`, { method: 'DELETE' });
  if (markers[currentBusiness.id]) { map.removeLayer(markers[currentBusiness.id]); delete markers[currentBusiness.id]; }
  closeDetailModal();
  toast('Business deleted', 'success');
  loadAll();
}

// ── LOG VISIT ─────────────────────────────────────────────────────────────────

function openLogVisit() {
  selectedOutcome = null;
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('visitContact').value = currentBusiness?.owner_name || '';
  document.getElementById('visitProduct').value = 'AI Voice Receptionist';
  document.getElementById('visitNotes').value = '';
  document.getElementById('visitReturnAt').value = currentBusiness?.return_at || '';
  document.getElementById('visitReturnNote').value = currentBusiness?.return_note || '';
  document.getElementById('returnTimeSection').classList.add('hidden');
  show('visitModal');
}

function selectOutcome(btn) {
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedOutcome = btn.dataset.value;
  const showReturn = ['follow_up', 'interested'].includes(selectedOutcome);
  document.getElementById('returnTimeSection').classList.toggle('hidden', !showReturn);
  if (!showReturn) {
    document.getElementById('visitReturnAt').value = '';
    document.getElementById('visitReturnNote').value = '';
  }
}

async function submitVisit() {
  if (!selectedOutcome) { toast('Please select an outcome', 'error'); return; }
  if (!currentBusiness) return;

  const body = {
    business_id: currentBusiness.id,
    outcome: selectedOutcome,
    contact_name: document.getElementById('visitContact').value.trim(),
    product_pitched: document.getElementById('visitProduct').value.trim(),
    notes: document.getElementById('visitNotes').value.trim(),
    return_at: document.getElementById('visitReturnAt').value || null,
    return_note: document.getElementById('visitReturnNote').value.trim() || null,
  };

  const res = await fetch('/api/visits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) {
    closeVisitModal();
    toast('Visit logged!', 'success');
    await loadAll();
    await openDetail(currentBusiness.id);
  } else {
    toast('Error saving visit', 'error');
  }
}

function closeVisit(e) { if (e.target.id === 'visitModal') closeVisitModal(); }
function closeVisitModal() { hide('visitModal'); }

// ── ROUTE ─────────────────────────────────────────────────────────────────────

function openRoute() {
  routeVisible = true;
  document.getElementById('routePanel').classList.remove('hidden');
  document.getElementById('routeList').innerHTML = '';
  document.getElementById('routeSummary').textContent = '';
  document.getElementById('routeInstructions').style.display = '';
}

function closeRoute() {
  routeVisible = false;
  document.getElementById('routePanel').classList.add('hidden');
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (window.innerWidth <= 768) {
    mobileTab('map', document.getElementById('mnav-map'));
  }
}

// ── HOME BASE ─────────────────────────────────────────────────────────────────

function useCurrentLocation() {
  if (!navigator.geolocation) {
    toast('Geolocation not supported by your browser', 'error');
    return;
  }
  const btn = event && event.currentTarget;
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Getting location...'; btn.disabled = true; }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { 'Accept-Language': 'en-US,en' } }
      );
      const geo = await r.json();
      if (geo.display_name) {
        const parts = geo.display_name.split(', ');
        address = parts.slice(0, 4).join(', ');
      }
    } catch (_) { /* keep coordinate fallback */ }

    const res = await fetch('/api/home_base', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, address }),
    });
    const data = await res.json();
    if (btn) { btn.textContent = orig; btn.disabled = false; }
    if (data.error) { toast(data.error, 'error'); return; }
    homeBase = data;
    updateHomeUI();
    placeHomeMarker(data.lat, data.lng, data.address);
    hide('homeModal');
    toast('Location set!', 'success');
  }, () => {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
    toast('Could not get your location — check browser permissions', 'error');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function openSetHome() {
  pendingHomeLatLng = null;
  document.getElementById('homeAddress').value = homeBase?.address || '';
  show('homeModal');
}

function closeHomeModal(e) {
  if (!e || e.target.id === 'homeModal') {
    hide('homeModal');
    // Remove temp marker if user cancels without saving
    if (pendingHomeLatLng && homeBase) {
      placeHomeMarker(homeBase.lat, homeBase.lng, homeBase.address);
    } else if (pendingHomeLatLng && !homeBase) {
      if (homeMarker) { map.removeLayer(homeMarker); homeMarker = null; }
    }
    pendingHomeLatLng = null;
  }
}

async function submitHome() {
  const address = document.getElementById('homeAddress').value.trim();
  if (!address) { toast('Enter an address', 'error'); return; }

  const body = { address };
  if (pendingHomeLatLng) {
    body.lat = pendingHomeLatLng.lat;
    body.lng = pendingHomeLatLng.lng;
  }

  const res = await fetch('/api/home_base', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (data.error) { toast(data.error, 'error'); return; }

  homeBase = data;
  pendingHomeLatLng = null;
  updateHomeUI();
  placeHomeMarker(data.lat, data.lng, data.address);
  hide('homeModal');
  toast('Start location saved!', 'success');
}

function toggleRouteSelect(id) {
  const card = document.getElementById(`card-${id}`);
  if (card) card.classList.toggle('selected');
  updateSelectionUI();
}

function selectAll() {
  document.querySelectorAll('.biz-check').forEach(cb => {
    cb.checked = true;
    const card = document.getElementById(`card-${cb.dataset.id}`);
    if (card) card.classList.add('selected');
  });
  updateSelectionUI();
}

function clearSelection() {
  document.querySelectorAll('.biz-check').forEach(cb => {
    cb.checked = false;
    const card = document.getElementById(`card-${cb.dataset.id}`);
    if (card) card.classList.remove('selected');
  });
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = document.querySelectorAll('.biz-check:checked').length;
  const btn = document.getElementById('deleteSelectedBtn');
  if (!btn) return;
  btn.textContent = count > 0 ? `Delete Selected (${count})` : 'Delete Selected';
  btn.disabled = count === 0;
}

async function deleteSelected() {
  const ids = [...document.querySelectorAll('.biz-check:checked')].map(c => parseInt(c.dataset.id));
  if (!ids.length) { toast('No businesses selected', 'error'); return; }
  if (!confirm(`Delete ${ids.length} business${ids.length > 1 ? 'es' : ''}? This cannot be undone.`)) return;

  const res = await fetch('/api/businesses/bulk_delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, rep: currentRep }),
  });
  const data = await res.json();
  if (data.deleted !== undefined) {
    toast(`Deleted ${data.deleted} business${data.deleted !== 1 ? 'es' : ''}`, 'success');
    loadAll();
  } else {
    toast('Error deleting businesses', 'error');
  }
}

async function renderRouteResult(data, batchInfo = null) {
  const ol = document.getElementById('routeList');
  const homeItem = `<li style="color:#14b8a6;list-style:none"><span class="route-num" style="background:#14b8a6">🏠</span><div><strong>Start: ${esc(homeBase.address || 'Home Base')}</strong></div></li>`;
  ol.innerHTML = homeItem + data.route.map((b, i) => {
    const returnTag = b.return_at
      ? `<span class="return-badge" style="margin-left:4px">⏰ ${fmt12(b.return_at)}${b.return_note ? ' · ' + esc(b.return_note) : ''}</span>`
      : '';
    return `<li>
      <span class="route-num">${i + 1}</span>
      <div style="flex:1">
        <strong>${esc(b.name)}</strong>${returnTag}
        <div style="font-size:11px;color:#94a3b8">${esc(b.address || '')}</div>
      </div>
      <button class="route-prompt-btn" onclick="copyPromptById(${b.id})" title="Copy AI voice prompt">📋</button>
    </li>`;
  }).join('') + homeItem.replace('Start:', 'End:');

  let summary = batchInfo
    ? `Batch ${batchInfo.num} of ${batchInfo.total} · ${data.route.length} stops (closest to home)`
    : `${data.route.length} stops`;
  if (data.distance_km) summary += ` · ${data.distance_km} km`;
  if (data.duration_min) summary += ` · ~${data.duration_min} min`;
  document.getElementById('routeSummary').textContent = summary;
  document.getElementById('routeInstructions').style.display = 'none';

  if (routeLayer) map.removeLayer(routeLayer);
  const stops = data.route.filter(b => b.lat && b.lng).map(b => [b.lat, b.lng]);
  const latlngs = [[homeBase.lat, homeBase.lng], ...stops, [homeBase.lat, homeBase.lng]];
  if (latlngs.length < 2) return;

  // Draw straight lines immediately so the layout is visible right away
  routeLayer = L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.8, dashArray: '8 5' }).addTo(map);

  // On mobile the route panel covers the map — flip to map tab so the line is visible
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    mobileTab('map', document.getElementById('mnav-map'));
    setTimeout(() => {
      map && map.invalidateSize();
      routeLayer && map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });
    }, 150);
  } else {
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  // Silently upgrade to road-following geometry via OSRM (free, no key needed)
  try {
    const coordStr = latlngs.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const osrm = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`,
      { signal: AbortSignal.timeout(10000) }
    );
    const osrmData = await osrm.json();
    if (osrmData.code === 'Ok' && osrmData.routes?.[0]?.geometry?.coordinates?.length) {
      const roadCoords = osrmData.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      if (routeLayer) map.removeLayer(routeLayer);
      routeLayer = L.polyline(roadCoords, { color: '#3b82f6', weight: 4, opacity: 0.9 }).addTo(map);
      if (!isMobile) map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    }
  } catch (_) { /* keep straight lines if OSRM unavailable */ }
}

async function runRoute() {
  if (!homeBase) { toast('Set your start location first', 'error'); openSetHome(); return; }

  const checked = [...document.querySelectorAll('.biz-check:checked')].map(c => parseInt(c.dataset.id));
  if (checked.length < 2) { toast('Check at least 2 businesses', 'error'); return; }

  const honorTimes = document.getElementById('honorTimesToggle').checked;
  document.getElementById('routeSummary').textContent = 'Calculating...';
  const res = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_ids: checked, honor_times: honorTimes }),
  });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }
  await renderRouteResult(data);
}

// ── AI VOICE PROMPT ───────────────────────────────────────────────────────────

const CATEGORY_DESCRIPTIONS = {
  'Luxury Hair Salon':  'a luxury hair salon offering premium cuts, color, and styling',
  'Medical Front Desk': 'a healthcare and wellness practice',
  'Law Firm':           'a law firm offering legal services to individuals and businesses',
  'Law Office':         'a law office offering legal counsel and representation',
  'Dental':             'a dental practice offering general and cosmetic dentistry',
  'Spa':                'a spa and wellness center offering relaxation and beauty treatments',
  'Hair Care':          'a hair salon offering cuts, color, and styling services',
  'Beauty Salon':       'a full-service beauty salon',
  'Medical':            'a medical practice',
  'Physical Therapy':   'a physical therapy and rehabilitation clinic',
  'Gym/Fitness':        'a fitness center and gym',
  'Restaurant':         'a restaurant',
  'Accounting':         'an accounting and financial services firm',
  'Real Estate':        'a real estate agency',
};

const CATEGORY_SERVICES = {
  'Luxury Hair Salon': `Haircut & style — 45–60 min — from $65
Color & highlights — 90–150 min — from $85
Blowout — 30–45 min — from $45
Keratin treatment — 2–3 hrs — pricing on consultation`,
  'Medical Front Desk': `New patient consultation — 30–60 min — pricing varies
Follow-up appointment — 15–30 min — pricing varies
Wellness & treatment session — 30–60 min — pricing varies`,
  'Law Firm': `Initial consultation — 30–60 min — pricing varies
Case review & legal strategy — varies — hourly rate applies
Document drafting & review — varies — hourly rate applies
Ongoing legal representation — varies — retainer-based`,
  'Law Office': `Initial consultation — 30–60 min — pricing varies
Case review & legal strategy — varies — hourly rate applies
Document drafting & review — varies — hourly rate applies`,
  'Dental': `Routine cleaning & exam — 45–60 min — pricing varies
Fillings — 30–60 min — pricing varies
Teeth whitening — 60–90 min — pricing varies
Emergency dental visit — 30–60 min — pricing varies`,
  'Spa': `Swedish massage — 60 min — from $75
Deep tissue massage — 60 min — from $90
Facial treatment — 60 min — from $80
Body wrap — 75 min — from $95`,
  'Hair Care': `Haircut — 30–45 min — from $35
Color service — 60–120 min — from $60
Blowout & style — 30–45 min — from $40`,
  'Beauty Salon': `Haircut & style — 30–60 min — pricing varies
Color service — 60–120 min — pricing varies
Nail services — 30–60 min — pricing varies`,
  'Medical': `New patient appointment — 30–60 min — pricing varies
Follow-up visit — 15–30 min — pricing varies
Consultation — 30 min — pricing varies`,
  'Physical Therapy': `Initial evaluation — 60 min — pricing varies
Physical therapy session — 45–60 min — pricing varies
Sports rehabilitation — 45–60 min — pricing varies`,
  'Gym/Fitness': `Monthly membership — unlimited access — pricing varies
Personal training session — 60 min — pricing varies
Group fitness class — 45–60 min — included with membership`,
};

function generatePrompt(b) {
  const name     = b.name    || 'this business';
  const desc     = CATEGORY_DESCRIPTIONS[b.category] || (b.category ? `a ${b.category.toLowerCase()}` : 'a local business');
  const services = CATEGORY_SERVICES[b.category] || 'Services and pricing to be confirmed with the business — this is a demo.';
  const owner    = b.owner_name || 'the owner';

  // Build business info block — only include lines we have data for
  const bizLines = [
    `Business name: ${name}`,
    `What they do: ${desc}`,
    b.address ? `Location / address: ${b.address}` : null,
    b.hours   ? `Opening hours: ${b.hours}`         : null,
    b.phone   ? `Phone: ${b.phone}`                 : null,
    b.website ? `Website: ${b.website}`             : null,
  ].filter(Boolean).join('\n');

  // Build FAQ block — only include questions we can actually answer
  const faqLines = [
    b.address ? `Q: Where are you located? A: We're at ${b.address}.`    : null,
    b.hours   ? `Q: What are your hours? A: We're open ${b.hours}.`      : null,
    `Q: Do you take walk-ins? A: This is a demo — we don't have that info on file yet, but the full version will have you covered.`,
  ].filter(Boolean).join('\n');

  return `Role
You are Mason, the receptionist at ${name}. You answer incoming phone calls, help people book appointments, and answer questions about the business.
You are NOT an AI. You are NOT a bot. You are a real person doing a real job. Never say you are an AI, a virtual assistant, automated, or anything similar. If someone asks, you're just the receptionist.

How you talk
You sound like a normal human on the phone. That means:
Keep replies SHORT. One or two sentences most of the time.
Only ask ONE question at a time. Never stack multiple questions in one breath.
Use casual, everyday words. "Yeah," "sure," "no worries," "got it," "one sec."
Use small filler words sometimes: "um," "uh," "okay so," "alright." Don't overdo it. Sprinkle them in like a real person would.
Contractions always. "I'll," "we're," "can't," "you're." Never "I will," "we are," "cannot."
Do NOT sound like a corporate script. No "I would be more than happy to assist you today." Just "yeah, happy to help."
Do NOT list things like a robot. If you have three options, say them naturally.
Match the caller's energy. If they're chatty, be chatty. If they're in a rush, be quick.
If a caller is upset, slow down, lower the energy, and just listen first before trying to fix anything.

What you actually do
Your job is three things:
Book appointments
Answer questions about the business
Take a message if you can't help
That's it. Stay in that lane.

Business info
${bizLines}

Services and prices
${services}

Booking flow
When someone wants to book, walk them through it naturally — ONE question at a time:
What service they want
What day/time works for them
Their full name
Their phone number (repeat it back to confirm)
Then confirm: "Cool, so that's a [service] on [day] at [time] — I've got you down, [name]."
Important for demo: you don't actually have a real calendar, so just act like the time they want is available (unless it's clearly outside opening hours). If they ask "did that actually book?" or "is this real?", tell them it's a demo so nothing's really on the books, but the full version connects to the actual calendar.

FAQ — common questions callers ask
${faqLines}

IMPORTANT — you are a demo version
This version of you is a demo. You only know what's written in this prompt. You do NOT have access to a real calendar, real customer records, real payment systems, or anything outside what's on this page.
If someone asks something not covered here, say in your own casual words:
"Ah, so just a heads up — this is a demo version, so I can't answer that one. The full version we set up for businesses can handle stuff like that no problem, but this one's a bit more limited."

What NOT to do
Don't give medical, legal, or financial advice.
Don't make promises about results or outcomes.
Don't negotiate on price. If they push, say "that's just our standard pricing, but ${owner} can chat with you about it if you want."
Don't argue with anyone. If they're being rude, stay calm and polite.
Don't keep them on the line longer than you need to.

Ending the call
Keep it short and warm:
"Alright, you're all set — see you [day]."
"No worries, have a good one."
"Cool, speak soon."`;
}

function copyPromptById(id) {
  const b = allBusinesses.find(biz => biz.id === id);
  if (!b) return;
  const text = b.voice_prompt || generatePrompt(b);
  navigator.clipboard.writeText(text)
    .then(() => toast('Prompt copied!', 'success'))
    .catch(() => { toast('Copy failed — open business to copy', 'error'); });
}

function copyPromptFromDetail() {
  const text = document.getElementById('voicePromptText').value;
  navigator.clipboard.writeText(text)
    .then(() => toast('Prompt copied!', 'success'))
    .catch(() => {
      const ta = document.getElementById('voicePromptText');
      ta.select(); document.execCommand('copy');
      toast('Prompt copied!', 'success');
    });
}

async function savePromptFromDetail() {
  if (!currentBusiness) return;
  const text = document.getElementById('voicePromptText').value;
  await fetch(`/api/businesses/${currentBusiness.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_prompt: text }),
  });
  const b = allBusinesses.find(b => b.id === currentBusiness.id);
  if (b) b.voice_prompt = text;
  currentBusiness.voice_prompt = text;
  toast('Prompt saved!', 'success');
}

// ── GEOGRAPHIC CLUSTERING HELPERS ────────────────────────────────────────────

function geoDistKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function centroid(businesses) {
  return {
    lat: businesses.reduce((s, b) => s + b.lat, 0) / businesses.length,
    lng: businesses.reduce((s, b) => s + b.lng, 0) / businesses.length,
  };
}

function clusterBusinesses(businesses, batchSize) {
  const pool = [...businesses];
  const clusters = [];
  while (pool.length > 0) {
    const seed = pool.shift();
    pool.sort((a, b) => geoDistKm(seed.lat, seed.lng, a.lat, a.lng) - geoDistKm(seed.lat, seed.lng, b.lat, b.lng));
    const batch = [seed, ...pool.splice(0, Math.min(batchSize - 1, pool.length))];
    clusters.push(batch);
  }
  return clusters;
}

async function routeBatch() {
  if (!homeBase) { toast('Set your start location first', 'error'); openSetHome(); return; }

  const unvisited = allBusinesses.filter(b => b.status === 'unvisited' && b.lat && b.lng);
  if (unvisited.length < 2) { toast('Need at least 2 unvisited businesses on the map', 'error'); return; }

  const clusters  = clusterBusinesses(unvisited, 20);
  const best      = clusters.reduce((a, b) => {
    const ca = centroid(a), cb = centroid(b);
    return geoDistKm(homeBase.lat, homeBase.lng, ca.lat, ca.lng) <=
           geoDistKm(homeBase.lat, homeBase.lng, cb.lat, cb.lng) ? a : b;
  });
  const batchNum  = clusters.indexOf(best) + 1;
  const batchInfo = { num: batchNum, total: clusters.length, size: best.length };

  document.getElementById('routeSummary').textContent = `Finding best batch...`;
  document.getElementById('routeInstructions').style.display = 'none';

  const res = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_ids: best.map(b => b.id), honor_times: document.getElementById('honorTimesToggle').checked }),
  });
  const data = await res.json();
  if (data.error) { toast(data.error, 'error'); return; }
  await renderRouteResult(data, batchInfo);
}

function centerOnHome() {
  if (!homeBase) { toast('No home base set', 'error'); return; }
  map.setView([homeBase.lat, homeBase.lng], 15);
}

// ── DISCOVER ──────────────────────────────────────────────────────────────────

function openDiscover() { show('discoverModal'); document.getElementById('discoverResult').textContent = ''; }
function closeDiscover(e) { if (e.target.id === 'discoverModal') closeDiscoverModal(); }
function closeDiscoverModal() { hide('discoverModal'); }

async function runDiscover(type, keyword) {
  const btns = document.querySelectorAll('.cat-btn');
  const resultEl = document.getElementById('discoverResult');
  btns.forEach(b => b.disabled = true);

  // 1. Try GPS; 2. Fall back to saved home base; 3. Fall back to Greenville
  let lat = null, lng = null, locationLabel = 'your area';
  resultEl.textContent = 'Getting your location...';
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 60000 })
    );
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
    locationLabel = 'your current location';
  } catch (_) {
    if (homeBase && homeBase.lat) {
      lat = homeBase.lat;
      lng = homeBase.lng;
      locationLabel = homeBase.address || 'your start location';
    }
  }

  resultEl.textContent = 'Searching...';
  const body = { type, keyword };
  if (lat !== null) { body.lat = lat; body.lng = lng; }

  const res = await fetch('/api/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  btns.forEach(b => b.disabled = false);

  if (data.error) {
    resultEl.textContent = '⚠ ' + data.error;
    return;
  }

  resultEl.textContent =
    `✓ Added ${data.added} businesses within 30 miles of ${locationLabel}. Skipped ${data.skipped} (already in DB or filtered out).`;

  if (data.added > 0) loadAll();
}

// ── ADD MANUAL (lookup flow) ──────────────────────────────────────────────────

let pendingAddData = null;

function openAddModal() {
  resetAddModal();
  show('addModal');
  setTimeout(() => document.getElementById('addName').focus(), 50);
}

function closeAdd(e) { if (e.target.id === 'addModal') closeAddModal(); }

function closeAddModal() {
  hide('addModal');
  pendingAddData = null;
}

function resetAddModal() {
  pendingAddData = null;
  document.getElementById('addName').value = '';
  document.getElementById('addLookupMsg').textContent = '';
  show('addStep1'); hide('addStep2');
  show('addFooter1'); hide('addFooter2');
  document.getElementById('lookupPreview').innerHTML = '';
}

async function lookupBusiness() {
  const name = document.getElementById('addName').value.trim();
  if (!name) { toast('Enter a business name', 'error'); return; }

  const msg = document.getElementById('addLookupMsg');
  msg.textContent = 'Looking up...';
  msg.style.color = '#94a3b8';

  const res = await fetch('/api/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();

  if (data.error) { msg.textContent = '⚠ ' + data.error; msg.style.color = '#ef4444'; return; }

  if (!data.found) {
    msg.textContent = data.message + ' — you can still add it manually below.';
    msg.style.color = '#f59e0b';
    pendingAddData = { name, address: '', phone: '', website: '', lat: null, lng: null, category: '', owner_score: 6, best_window: '10am–12pm', visit_tip: '' };
    showLookupPreview(pendingAddData, false);
    return;
  }

  msg.textContent = '';
  pendingAddData = data;
  showLookupPreview(data, true);
}

function field(label, value, editable = false, fieldKey = '') {
  const missing = !value;
  const displayVal = value || 'Information Needed';
  const id = fieldKey ? `preview_${fieldKey}` : '';
  if (editable) {
    return `<div class="lookup-field">
      <span class="lookup-label">${label}</span>
      <input class="lookup-value form-input${missing ? ' missing' : ''}" id="${id}" value="${esc(value || '')}" placeholder="Information Needed" oninput="pendingAddData['${fieldKey}']=this.value" />
    </div>`;
  }
  return `<div class="lookup-field">
    <span class="lookup-label">${label}</span>
    <div class="lookup-value${missing ? ' missing' : ''}">${esc(displayVal)}</div>
  </div>`;
}

function showLookupPreview(data, found) {
  const badge = found
    ? `<div class="lookup-found-badge">✓ Found on Google Maps</div>`
    : `<div class="lookup-found-badge" style="color:#f59e0b">⚠ Not found — fill in what you know</div>`;

  document.getElementById('lookupPreview').innerHTML = `
    ${badge}
    ${field('Business Name', data.name, true, 'name')}
    ${field('Address', data.address)}
    <div class="lookup-grid">
      ${field('Phone', data.phone, true, 'phone')}
      ${field('Category', data.category)}
    </div>
    ${field('Website', data.website, true, 'website')}
    <div class="lookup-grid">
      ${field('Best Time to Visit', data.best_window)}
      ${field('Owner Score', data.owner_score ? `${data.owner_score}/10` : '')}
    </div>
    <div class="lookup-field" style="margin-top:4px">
      <span class="lookup-label" style="color:#64748b;font-size:10px">📍 ${data.lat ? `Coordinates found (${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)})` : 'No coordinates — won\'t appear on map'}</span>
    </div>`;

  hide('addStep1'); show('addStep2');
  hide('addFooter1'); show('addFooter2');
}

async function confirmAdd() {
  if (!pendingAddData) return;
  const nameEl = document.getElementById('preview_name');
  if (nameEl) pendingAddData.name = nameEl.value.trim();
  if (!pendingAddData.name) { toast('Business name is required', 'error'); return; }

  const payload = { ...pendingAddData, rep: currentRep !== 'mayday' ? currentRep : null };
  const res = await fetch('/api/businesses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    closeAddModal();
    toast(`"${pendingAddData.name}" added!`, 'success');
    loadAll();
  } else {
    toast('Error adding business', 'error');
  }
}

// ── TABS ──────────────────────────────────────────────────────────────────────

function setTab(tab, btn) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('businessList').style.display = tab === 'list' ? 'flex' : 'none';
  document.getElementById('suggestionList').style.display = tab === 'suggestions' ? 'flex' : 'none';
  if (tab === 'suggestions') loadSuggestions();
}

// ── MOBILE NAV ────────────────────────────────────────────────────────────────

function mobileTab(tab, btn) {
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const listPanel  = document.querySelector('.left-panel');
  const routePanel = document.getElementById('routePanel');

  if (tab === 'map') {
    listPanel.classList.remove('mobile-open');
    routePanel.classList.add('hidden');
    setTimeout(() => map && map.invalidateSize(), 50);
  } else if (tab === 'list') {
    listPanel.classList.add('mobile-open');
    routePanel.classList.add('hidden');
    renderList(filtered()); // always re-render so list is never stale
  } else if (tab === 'route') {
    listPanel.classList.remove('mobile-open');
    routePanel.classList.remove('hidden');
    document.getElementById('routeInstructions').style.display = '';
    document.getElementById('routeSummary').textContent = '';
    setTimeout(() => map && map.invalidateSize(), 50);
  }
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
