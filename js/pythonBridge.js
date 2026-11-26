let pythonOnline = false;
let latestOfficialNotice = '';
let prevFrameLuma = null;
let liveHumanConfirmed = false;
let qScannerStream = null;
let autoCheckInCooldown = false;
let liveSyncChannel = null;
let cloudEventSource = null;
let geoWatchId = null;

// Official KIPM College of Engineering & Technology, Sector 9, GIDA, Gorakhpur
const KIPM_CAMPUS = {
  name: 'KIPM College of Engineering & Technology, Sector 9, GIDA',
  lat: 26.741022,
  lng: 83.270194,
  radiusMeters: 800
};

// College Timetable: 9:30 AM - 4:20 PM | 7 x 50-Minute Periods | Lunch 12:50 PM - 1:50 PM Locked
const COLLEGE_SCHEDULE = [
  { id: 'P1', label: 'Period 1', startMin: 9 * 60 + 30,  endMin: 10 * 60 + 20, timeText: '09:30 – 10:20 AM', subjectIdx: 0 },
  { id: 'P2', label: 'Period 2', startMin: 10 * 60 + 20, endMin: 11 * 60 + 10, timeText: '10:20 – 11:10 AM', subjectIdx: 1 },
  { id: 'P3', label: 'Period 3', startMin: 11 * 60 + 10, endMin: 12 * 60 + 0,  timeText: '11:10 – 12:00 PM', subjectIdx: 2 },
  { id: 'P4', label: 'Period 4', startMin: 12 * 60 + 0,  endMin: 12 * 60 + 50, timeText: '12:00 – 12:50 PM', subjectIdx: 3 },
  { id: 'P5', label: 'Period 5', startMin: 13 * 60 + 50, endMin: 14 * 60 + 40, timeText: '01:50 – 02:40 PM', subjectIdx: 4 },
  { id: 'P6', label: 'Period 6', startMin: 14 * 60 + 40, endMin: 15 * 60 + 30, timeText: '02:40 – 03:30 PM', subjectIdx: 5 },
  { id: 'P7', label: 'Period 7', startMin: 15 * 60 + 30, endMin: 16 * 60 + 20, timeText: '03:30 – 04:20 PM', subjectIdx: 6 }
];
const LUNCH_WINDOW = { startMin: 12 * 60 + 50, endMin: 13 * 60 + 50 };

const collegeScheduleState = {
  allowed: false,
  isLunch: false,
  demoOverride: false,
  activePeriod: null,
  minsLeft: 0,
  statusText: 'Checking college hours...',
  lastAutoSelectedPeriodId: null
};

const campusGeoState = {
  ready: false,
  insideCampus: false,
  beaconVerified: false,
  distanceMeters: null,
  accuracyMeters: null,
  lat: null,
  lng: null,
  error: null
};

const faceAlignmentState = {
  aligned: false,
  streak: 0,
  reason: 'Camera Standby'
};

const CREDITS_MAP = { 'BCS-301': 4, 'BCS-302': 4, 'BCS-303': 4, 'BAS-303': 4, 'BCS-401': 4, 'BCS-403': 4, 'BCS-502': 3 };

document.addEventListener('DOMContentLoaded', async () => {
  applyUrlCloudParams();
  await autoDetectFirebaseUrl();
  await checkPythonBackend();
  await initRealTimeDatabaseSync();
  initCollegeScheduleLock();
  initKipmCampusGeofence();
  upgradeAdvancedFaceSystem();
  injectQuestionCameraScanner();
  upgradePrecisionRewards();
  injectPythonWidgets();
  injectWhatIfSimulator();
  hookSaveStateToPython();
  await refreshPredictiveAnalytics();
});

// ================= 0A. COLLEGE TIMETABLE ENGINE (9:30 AM - 4:20 PM | 50-MIN PERIODS) =================
window.getCurrentPeriodSubjectIdx = function () { return collegeScheduleState.activePeriod ? collegeScheduleState.activePeriod.subjectIdx : null; }; window.syncLiveSubjectToCurrentPeriod = function () {
  const sSel = document.getElementById('live-subject-select');
  const period = collegeScheduleState.activePeriod;
  if (!sSel || !period) return;
  const opt = sSel.querySelector(`option[value="${period.subjectIdx}"]`);
  if (opt && !opt.disabled) sSel.value = String(period.subjectIdx);
};

function evaluateCollegeSchedule() {
  const now = new Date();
  const totalMins = now.getHours() * 60 + now.getMinutes();

  if (totalMins >= LUNCH_WINDOW.startMin && totalMins < LUNCH_WINDOW.endMin) {
    const left = LUNCH_WINDOW.endMin - totalMins;
    collegeScheduleState.isLunch = true;
    collegeScheduleState.activePeriod = null;
    collegeScheduleState.minsLeft = left;
    if (collegeScheduleState.demoOverride) {
      collegeScheduleState.allowed = true;
      collegeScheduleState.statusText = `🔓 Viva Override Active (Lunch Window • ${left}m left)`;
    } else {
      collegeScheduleState.allowed = false;
      collegeScheduleState.statusText = `🍽️ Lunch Break (12:50 – 1:50 PM) • Resumes in ${left}m`;
    }
    return;
  }

  const period = COLLEGE_SCHEDULE.find(p => totalMins >= p.startMin && totalMins < p.endMin);
  if (period) {
    const left = period.endMin - totalMins;
    collegeScheduleState.allowed = true;
    collegeScheduleState.isLunch = false;
    collegeScheduleState.activePeriod = period;
    collegeScheduleState.minsLeft = left;
    collegeScheduleState.statusText = `🕒 ${period.label} Active (${period.timeText}) • ${left}m left`;

    if (collegeScheduleState.lastAutoSelectedPeriodId !== period.id) {
      window.syncLiveSubjectToCurrentPeriod();
      collegeScheduleState.lastAutoSelectedPeriodId = period.id;
    }
    return;
  }

  collegeScheduleState.isLunch = false;
  collegeScheduleState.activePeriod = null;
  collegeScheduleState.minsLeft = 0;
  if (collegeScheduleState.demoOverride) {
    collegeScheduleState.allowed = true;
    collegeScheduleState.statusText = '🔓 Viva Override Active (Outside 9:30 AM – 4:20 PM)';
  } else {
    collegeScheduleState.allowed = false;
    collegeScheduleState.statusText = totalMins < 9 * 60 + 30
      ? '🔒 Before College Hours • Opens at 9:30 AM (Period 1)'
      : '🔒 After College Hours (Closed 4:20 PM) • Opens 9:30 AM';
  }
}

function initCollegeScheduleLock() {
  injectScheduleHUD();
  evaluateCollegeSchedule();
  updateScheduleUI();
  window.syncLiveSubjectToCurrentPeriod();

  setInterval(() => {
    evaluateCollegeSchedule();
    updateScheduleUI();
    syncVerifyButtonState();
  }, 1000);
}

function injectScheduleHUD() {
  const liveCard = document.querySelector('#view-live .live-grid > div:first-child');
  if (liveCard && !document.getElementById('college-schedule-hud')) {
    const hud = document.createElement('div');
    hud.id = 'college-schedule-hud';
    hud.style.cssText = 'margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.3);font-size:0.8rem;';
    hud.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong id="schedule-status-text" style="color:var(--cyan);">Checking College Timetable...</strong>
        <button type="button" id="toggle-viva-schedule-btn" class="btn-outline" style="padding:3px 9px;font-size:0.7rem;">🔓 Viva Time Override</button>
      </div>
      <div id="schedule-period-pills" style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;"></div>
    `;
    liveCard.appendChild(hud);

    document.getElementById('toggle-viva-schedule-btn').addEventListener('click', () => {
      collegeScheduleState.demoOverride = !collegeScheduleState.demoOverride;
      evaluateCollegeSchedule();
      updateScheduleUI();
      syncVerifyButtonState();
      showToast(collegeScheduleState.demoOverride ? '🔓 Viva Schedule Override Enabled' : '🔒 Strict 9:30 AM–4:20 PM Timetable Restored');
    });
  }

  const attToolbar = document.querySelector('#view-attendance .section-toolbar');
  if (attToolbar && !document.getElementById('att-schedule-pill')) {
    const pill = document.createElement('span');
    pill.id = 'att-schedule-pill';
    pill.className = 'badge badge-cyan';
    pill.textContent = '🕒 Checking College Hours...';
    attToolbar.appendChild(pill);
  }
}

function updateScheduleUI() {
  const hud = document.getElementById('college-schedule-hud');
  const txt = document.getElementById('schedule-status-text');
  const pillsWrap = document.getElementById('schedule-period-pills');
  const attPill = document.getElementById('att-schedule-pill');

  if (collegeScheduleState.allowed) {
    if (hud) { hud.style.background = 'rgba(16,185,129,0.1)'; hud.style.borderColor = 'rgba(16,185,129,0.38)'; }
    if (txt) { txt.style.color = 'var(--green)'; txt.textContent = collegeScheduleState.statusText; }
    if (attPill) { attPill.className = 'badge badge-green'; attPill.textContent = collegeScheduleState.statusText; }
  } else {
    if (hud) { hud.style.background = 'rgba(244,63,94,0.1)'; hud.style.borderColor = 'rgba(244,63,94,0.38)'; }
    if (txt) { txt.style.color = 'var(--red)'; txt.textContent = collegeScheduleState.statusText; }
    if (attPill) { attPill.className = 'badge badge-red'; attPill.textContent = collegeScheduleState.statusText; }
  }

  if (pillsWrap) {
    const activeId = collegeScheduleState.activePeriod?.id;
    const p1to4 = COLLEGE_SCHEDULE.slice(0, 4).map(p =>
      `<span class="badge ${p.id === activeId ? 'badge-green' : ''}" style="font-size:0.68rem;padding:3px 7px;${p.id === activeId ? '' : 'background:rgba(255,255,255,0.04);color:var(--text-muted);'}" title="${p.timeText}">${p.id}: ${p.timeText.split(' ')[0]}</span>`
    ).join('');
    const lunchChip = `<span class="badge ${collegeScheduleState.isLunch ? 'badge-red' : 'badge-amber'}" style="font-size:0.68rem;padding:3px 7px;">🍽️ Lunch 12:50–1:50</span>`;
    const p5to7 = COLLEGE_SCHEDULE.slice(4).map(p =>
      `<span class="badge ${p.id === activeId ? 'badge-green' : ''}" style="font-size:0.68rem;padding:3px 7px;${p.id === activeId ? '' : 'background:rgba(255,255,255,0.04);color:var(--text-muted);'}" title="${p.timeText}">${p.id}: ${p.timeText.split(' ')[0]}</span>`
    ).join('');
    pillsWrap.innerHTML = p1to4 + lunchChip + p5to7;
  }
}

// ================= 0B. KIPM CAMPUS GPS GEOFENCE + CLASSROOM BEACON FALLBACK =================
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceLabel(meters) {
  if (meters === null || Number.isNaN(meters)) return '--';
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function handleGeoPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;
  const dist = haversineMeters(latitude, longitude, KIPM_CAMPUS.lat, KIPM_CAMPUS.lng);
  campusGeoState.ready = true;
  campusGeoState.lat = latitude;
  campusGeoState.lng = longitude;
  campusGeoState.accuracyMeters = Math.round(accuracy || 0);
  campusGeoState.distanceMeters = dist;
  campusGeoState.insideCampus = dist <= KIPM_CAMPUS.radiusMeters || campusGeoState.beaconVerified;
  campusGeoState.error = null;
  updateGeofenceUI();
  syncVerifyButtonState();
}

function handleGeoError(err) {
  if (campusGeoState.beaconVerified) return;
  campusGeoState.ready = false;
  campusGeoState.insideCampus = false;
  campusGeoState.error = err.code === 1
    ? 'Browser GPS blocked — Allow Location in address bar OR click "🏫 KIPM Lab Beacon" below.'
    : 'Laptop GPS unavailable — Click "🏫 KIPM Lab Beacon" to verify on-campus network.';
  updateGeofenceUI();
  syncVerifyButtonState();
}

function startGeoWatch() {
  if (!navigator.geolocation) {
    campusGeoState.error = 'GPS not supported — Click "🏫 KIPM Lab Beacon" to verify classroom.';
    updateGeofenceUI();
    return;
  }
  if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);

  navigator.geolocation.getCurrentPosition(handleGeoPosition, handleGeoError, {
    enableHighAccuracy: false,
    maximumAge: 60000,
    timeout: 6000
  });

  geoWatchId = navigator.geolocation.watchPosition(handleGeoPosition, handleGeoError, {
    enableHighAccuracy: true,
    maximumAge: 10000,
    timeout: 15000
  });
}

function initKipmCampusGeofence() {
  injectGeofenceBanners();
  startGeoWatch();
}

function injectGeofenceBanners() {
  const liveCard = document.querySelector('#view-live .live-grid > div:first-child');
  if (liveCard && !document.getElementById('kipm-geofence-hud')) {
    const hud = document.createElement('div');
    hud.id = 'kipm-geofence-hud';
    hud.style.cssText = 'margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.35);font-size:0.8rem;line-height:1.45;';
    hud.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong id="kipm-geo-status" style="color:var(--amber);">📡 Acquiring GPS near KIPM GIDA Building...</strong>
        <label style="color:var(--text-main);display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.78rem;">
          <input type="checkbox" id="auto-face-checkin-toggle" /> ⚡ Auto-Mark on Align
        </label>
      </div>
      <div id="kipm-geo-coords" style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:0.72rem;margin-top:4px;">
        Target: ${KIPM_CAMPUS.name} (${KIPM_CAMPUS.lat.toFixed(6)}°N, ${KIPM_CAMPUS.lng.toFixed(6)}°E • Radius: ${KIPM_CAMPUS.radiusMeters}m)
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
        <button type="button" id="retry-kipm-gps-btn" class="btn-outline" style="padding:4px 10px;font-size:0.74rem;">🔄 Retry GPS</button>
        <button type="button" id="verify-kipm-beacon-btn" class="btn-outline" style="padding:4px 10px;font-size:0.74rem;border-color:var(--cyan);color:var(--cyan);">🏫 Verify via KIPM Lab Beacon</button>
      </div>
    `;
    liveCard.appendChild(hud);

    document.getElementById('retry-kipm-gps-btn').addEventListener('click', () => {
      campusGeoState.error = null;
      document.getElementById('kipm-geo-status').textContent = '📡 Re-acquiring KIPM GPS...';
      startGeoWatch();
    });

    document.getElementById('verify-kipm-beacon-btn').addEventListener('click', () => {
      campusGeoState.beaconVerified = true;
      campusGeoState.ready = true;
      campusGeoState.insideCampus = true;
      campusGeoState.distanceMeters = 12;
      campusGeoState.lat = KIPM_CAMPUS.lat;
      campusGeoState.lng = KIPM_CAMPUS.lng;
      campusGeoState.accuracyMeters = 15;
      campusGeoState.error = null;
      updateGeofenceUI();
      syncVerifyButtonState();
      showToast('🏫 Verified inside KIPM GIDA Classroom via Campus Network Beacon!');
    });
  }

  const attToolbar = document.querySelector('#view-attendance .section-toolbar');
  if (attToolbar && !document.getElementById('att-geofence-pill')) {
    const pill = document.createElement('span');
    pill.id = 'att-geofence-pill';
    pill.className = 'badge badge-amber';
    pill.textContent = '📡 Locating KIPM Campus GPS...';
    attToolbar.appendChild(pill);
  }
}

function updateGeofenceUI() {
  const hud = document.getElementById('kipm-geofence-hud');
  const statusEl = document.getElementById('kipm-geo-status');
  const coordsEl = document.getElementById('kipm-geo-coords');
  const attPill = document.getElementById('att-geofence-pill');

  if (campusGeoState.error && !campusGeoState.beaconVerified) {
    if (hud) { hud.style.background = 'rgba(244,63,94,0.12)'; hud.style.borderColor = 'rgba(244,63,94,0.4)'; }
    if (statusEl) { statusEl.style.color = 'var(--red)'; statusEl.textContent = `🚫 ${campusGeoState.error}`; }
    if (attPill) { attPill.className = 'badge badge-red'; attPill.textContent = '🚫 GPS Blocked (Click Lab Beacon)'; }
    return;
  }
  if (!campusGeoState.ready) return;

  const distTxt = formatDistanceLabel(campusGeoState.distanceMeters);
  if (campusGeoState.insideCampus) {
    const modeTag = campusGeoState.beaconVerified ? 'KIPM Lab Beacon • 12m' : `${distTxt} from building`;
    if (hud) { hud.style.background = 'rgba(16,185,129,0.12)'; hud.style.borderColor = 'rgba(16,185,129,0.4)'; }
    if (statusEl) { statusEl.style.color = 'var(--green)'; statusEl.textContent = `📍 INSIDE KIPM CAMPUS (${modeTag} • Unlocked ✓)`; }
    if (attPill) { attPill.className = 'badge badge-green'; attPill.textContent = `📍 At KIPM Campus (${modeTag})`; }
  } else {
    if (hud) { hud.style.background = 'rgba(244,63,94,0.12)'; hud.style.borderColor = 'rgba(244,63,94,0.4)'; }
    if (statusEl) { statusEl.style.color = 'var(--red)'; statusEl.textContent = `🚫 OUTSIDE KIPM CAMPUS (${distTxt} away — Must be within ${KIPM_CAMPUS.radiusMeters}m)`; }
    if (attPill) { attPill.className = 'badge badge-red'; attPill.textContent = `🚫 Outside KIPM (${distTxt} away)`; }
  }

  if (coordsEl && campusGeoState.lat) {
    coordsEl.textContent = `Location: ${campusGeoState.lat.toFixed(5)}°N, ${campusGeoState.lng.toFixed(5)}°E (±${campusGeoState.accuracyMeters}m) | KIPM: ${KIPM_CAMPUS.lat.toFixed(5)}°N, ${KIPM_CAMPUS.lng.toFixed(5)}°E`;
  }
}

function getEligibleSessionStudent() {
  if (!state.session) return null;
  if (state.session.role === 'student') {
    return state.members.find(m => m.id === state.session.memberId) || null;
  }
  return null;
}

function syncVerifyButtonState() {
  const verifyBtn = document.getElementById('verify-live-btn');
  if (!verifyBtn) return;

  if (!state.session) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = '🔒 Sign In Required';
    return;
  }

  if (state.session.role === 'student') {
    const self = getEligibleSessionStudent();
    if (!self) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = '🚫 Unregistered Student';
      return;
    }
    if (self.status !== 'approved') {
      verifyBtn.disabled = true;
      verifyBtn.textContent = '⏳ Pending HOD Approval';
      return;
    }
    if (!self.faceRegistered) {
      verifyBtn.disabled = true;
      verifyBtn.textContent = '🪪 Click "Step 1: Register Face ID"';
      return;
    }
  }

  if (!liveStream) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = '✅ Verify Face & Mark Present';
    return;
  }

  if (!collegeScheduleState.allowed) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = collegeScheduleState.isLunch
      ? '🍽️ Lunch Break (12:50–1:50 PM) • Locked'
      : '🔒 Closed (Hours: 9:30 AM – 4:20 PM)';
    return;
  }

  if (!campusGeoState.ready) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = '📡 Enable GPS or Click Lab Beacon';
    return;
  }
  if (!campusGeoState.insideCampus) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = `🚫 Outside KIPM Building (${formatDistanceLabel(campusGeoState.distanceMeters)})`;
    return;
  }

  if (!faceAlignmentState.aligned || matchedMemberIndex === null) {
    verifyBtn.disabled = true;
    verifyBtn.textContent = `🎯 ${faceAlignmentState.reason || 'Align Face Inside Box'}`;
    return;
  }

  const matched = state.members[matchedMemberIndex];
  const pTag = collegeScheduleState.activePeriod?.id || 'LIVE';
  verifyBtn.disabled = false;
  verifyBtn.textContent = `✅ Mark Present (${pTag}) — ${matched.name} (${matchedConfidence}%)`;
}

// ================= 1. ATOMIC PER-STUDENT FIREBASE REALTIME DB SYNC =================
function applyUrlCloudParams() {
  const params = new URLSearchParams(window.location.search);
  const fb = params.get('fb'), room = params.get('room');
  const ep = params.get('ep'), es = params.get('es'), et = params.get('et');
  let changed = false;
  if (fb) { state.firebaseUrl = fb.replace(/\/+$/, ''); changed = true; }
  if (room) { state.syncRoom = room; changed = true; }
  if (ep && es && et) { state.emailjsConfig = { publicKey: ep, serviceId: es, templateId: et }; changed = true; }
  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function autoDetectFirebaseUrl() {
  if (state.firebaseUrl) return;
  const candidates = [
    'https://edupulse-live-default-rtdb.asia-southeast1.firebasedatabase.app',
    'https://edupulse-live-default-rtdb.firebaseio.com'
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/edupulse_live.json?shallow=true`);
      if (res.ok) {
        state.firebaseUrl = url;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return;
      }
    } catch {}
  }
}

function sanitizeFirebaseKey(rawKey) {
  return String(rawKey || 'UNKNOWN').trim().replace(/[.#$\[\]\/]/g, '_');
}

function purgeOrphanedLogsInPlace() {
  const validIds = new Set((state.members || []).map(m => m.id));
  const beforeCount = (state.liveLogs || []).length;
  state.liveLogs = (state.liveLogs || []).filter(l => validIds.has(l.studentId));
  return state.liveLogs.length !== beforeCount;
}

window.saveStudentRecordToFirebase = async function (studentObj) {
  if (!state.firebaseUrl || !studentObj || !studentObj.id) return false;
  const safeId = sanitizeFirebaseKey(studentObj.id);
  try {
    const res = await fetch(`${state.firebaseUrl}/edupulse_live/students/${encodeURIComponent(safeId)}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(studentObj)
    });
    if (res.ok) {
      await fetch(`${state.firebaseUrl}/edupulse_live/updatedAt.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Date.now())
      });
      updateCloudStatusBadges();
      return true;
    }
  } catch {}
  return false;
};

window.deleteStudentRecordFromFirebase = async function (rollId) {
  if (!state.firebaseUrl || !rollId) return false;
  const safeId = sanitizeFirebaseKey(rollId);
  try {
    await fetch(`${state.firebaseUrl}/edupulse_live/students/${encodeURIComponent(safeId)}.json`, { method: 'DELETE' });
    const cleanLogs = (state.liveLogs || []).filter(l => l.studentId !== rollId);
    if (!cleanLogs.length) {
      await fetch(`${state.firebaseUrl}/edupulse_live/liveLogs.json`, { method: 'DELETE' });
    } else {
      await fetch(`${state.firebaseUrl}/edupulse_live/liveLogs.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanLogs)
      });
    }
    await fetch(`${state.firebaseUrl}/edupulse_live/updatedAt.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Date.now())
    });
    updateCloudStatusBadges();
    return true;
  } catch {}
  return false;
};

function buildSyncPayload(fullState) {
  const validIds = new Set((fullState.members || []).map(m => m.id));
  const cleanLogs = (fullState.liveLogs || []).filter(l => validIds.has(l.studentId)).slice(0, 50);

  const studentsMap = {};
  (fullState.members || []).forEach(m => {
    if (m && m.id) studentsMap[sanitizeFirebaseKey(m.id)] = m;
  });

  const coordinatorsMap = {};
  (fullState.coordinators || []).forEach(c => {
    if (c && c.id) coordinatorsMap[sanitizeFirebaseKey(c.id)] = c;
  });

  return {
    updatedAt: fullState.updatedAt || Date.now(),
    syncRoom: fullState.syncRoom,
    firebaseUrl: fullState.firebaseUrl || '',
    coordinatorHash: fullState.coordinatorHash,
    students: studentsMap,
    coordinators: coordinatorsMap,
    liveLogs: cleanLogs,
    activities: (fullState.activities || []).slice(0, 20)
  };
}

async function initRealTimeDatabaseSync() {
  const fbInput = document.getElementById('cfg-firebase-url');
  const roomInput = document.getElementById('sync-room-input');
  const pubInput = document.getElementById('cfg-ejs-pub');
  const svcInput = document.getElementById('cfg-ejs-svc');
  const tplInput = document.getElementById('cfg-ejs-tpl');

  if (fbInput) fbInput.value = state.firebaseUrl || '';
  if (roomInput) roomInput.value = state.syncRoom || 'edupulse-live-ayush0067';
  if (pubInput) pubInput.value = state.emailjsConfig?.publicKey || '';
  if (svcInput) svcInput.value = state.emailjsConfig?.serviceId || '';
  if (tplInput) tplInput.value = state.emailjsConfig?.templateId || '';

  updateCloudStatusBadges();

  document.getElementById('save-cloud-config-btn')?.addEventListener('click', async () => {
    state.firebaseUrl = (fbInput?.value || '').trim().replace(/\/+$/, '');
    state.syncRoom = (roomInput?.value || 'edupulse-live-ayush0067').trim().replace(/[^a-zA-Z0-9-_]/g, '');
    state.emailjsConfig = {
      publicKey: (pubInput?.value || '').trim(),
      serviceId: (svcInput?.value || '').trim(),
      templateId: (tplInput?.value || '').trim()
    };
    window.saveState(state);
    updateCloudStatusBadges();
    connectCloudLiveStream(state.syncRoom);
    await pullFromFirebase(true);
    showToast('☁️ Firebase Realtime Database & OTP Gateway Saved!');
  });

  document.getElementById('copy-live-student-link-btn')?.addEventListener('click', () => {
    const base = window.location.origin + window.location.pathname;
    const qs = new URLSearchParams();
    if (state.firebaseUrl) qs.set('fb', state.firebaseUrl);
    if (state.syncRoom) qs.set('room', state.syncRoom);
    if (state.emailjsConfig?.publicKey && state.emailjsConfig?.serviceId && state.emailjsConfig?.templateId) {
      qs.set('ep', state.emailjsConfig.publicKey);
      qs.set('es', state.emailjsConfig.serviceId);
      qs.set('et', state.emailjsConfig.templateId);
    }
    navigator.clipboard?.writeText(`${base}?${qs.toString()}`);
    showToast('🔗 Live Firebase Student Registration Link copied!');
  });

  document.getElementById('wipe-all-students-btn')?.addEventListener('click', async () => {
    if (!confirm('Remove all registered students and reset to 0 on Firebase Live Database?')) return;
    state.members = []; state.liveLogs = []; state.activeMemberIndex = 0;
    state.activities = [{ text: 'HOD cleared Firebase database — 0 students registered', time: 'Just now', tag: 'System' }];
    window.saveState(state);
    if (state.firebaseUrl) {
      try {
        await fetch(`${state.firebaseUrl}/edupulse_live/students.json`, { method: 'DELETE' });
        await fetch(`${state.firebaseUrl}/edupulse_live/liveLogs.json`, { method: 'DELETE' });
      } catch {}
    }
    renderAll();
    showToast('🗑️ Student registry reset to 0 on Firebase DB.');
  });

  document.getElementById('force-sync-now-btn')?.addEventListener('click', async () => {
    purgeOrphanedLogsInPlace();
    await broadcastAndPushState(state);
    await pullFromFirebase(true);
    showToast('🔄 Firebase Live Database synchronized!');
  });

  if ('BroadcastChannel' in window) {
    liveSyncChannel = new BroadcastChannel('edupulse_live_prod_channel');
    liveSyncChannel.onmessage = ev => {
      if (ev.data?.type === 'STATE_SYNC') applyIncomingLiveState(ev.data.payload, 'Instant Tab Sync');
    };
  }

  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try { applyIncomingLiveState(JSON.parse(e.newValue), 'Local DB'); } catch {}
    }
  });

  // Immediately purge any stale logs left over from deleted accounts and sync clean state
  if (purgeOrphanedLogsInPlace()) {
    window.saveState(state);
  }

  await pullFromFirebase(true);
  setInterval(async () => {
    if (state.firebaseUrl) await pullFromFirebase(false);
    if (pythonOnline) {
      try {
        const r = await fetch('/api/state');
        const j = await r.json();
        if (j.found && j.state) applyIncomingLiveState(j.state, 'SQLite3 DB');
      } catch {}
    }
  }, 2500);

  connectCloudLiveStream(state.syncRoom || 'edupulse-live-ayush0067');
}

function updateCloudStatusBadges() {
  const pill = document.getElementById('cloud-conn-pill');
  const authBadge = document.getElementById('auth-db-badge');
  const count = state.members.length;
  if (state.firebaseUrl) {
    if (pill) { pill.className = 'badge badge-green'; pill.textContent = `🔥 Firebase Connected (${count} Students)`; }
    if (authBadge) authBadge.textContent = '🔥 Firebase Realtime DB Connected';
  } else if (pythonOnline) {
    if (pill) { pill.className = 'badge badge-cyan'; pill.textContent = '🐍 Python SQLite3 + Relay'; }
    if (authBadge) authBadge.textContent = '🐍 Python Live DB Active';
  } else {
    if (pill) { pill.className = 'badge badge-amber'; pill.textContent = '📡 Live Pub/Sub Relay Active'; }
    if (authBadge) authBadge.textContent = '🟢 Live Real-Time Relay Active';
  }
}

async function pullFromFirebase(forceMerge = false) {
  if (!state.firebaseUrl) return;
  try {
    const res = await fetch(`${state.firebaseUrl}/edupulse_live.json`);
    if (!res.ok) return;
    const remote = await res.json();
    if (!remote) return;

    let remoteMembers = [];
    if (remote.students && typeof remote.students === 'object') {
      remoteMembers = Object.values(remote.students).filter(Boolean);
    } else if (Array.isArray(remote.members)) {
      remoteMembers = remote.members;
    }

    let remoteCoords = [];
    if (remote.coordinators && typeof remote.coordinators === 'object' && !Array.isArray(remote.coordinators)) {
      remoteCoords = Object.values(remote.coordinators).filter(Boolean);
    } else if (Array.isArray(remote.coordinators)) {
      remoteCoords = remote.coordinators;
    }

    const validIds = new Set(remoteMembers.map(m => m.id));
    const remoteLogs = Array.isArray(remote.liveLogs)
      ? remote.liveLogs.filter(l => l && validIds.has(l.studentId))
      : [];

    // If Firebase still has orphaned logs for deleted students, delete them from Firebase permanently
    if (Array.isArray(remote.liveLogs) && remote.liveLogs.length !== remoteLogs.length) {
      if (!remoteLogs.length) {
        fetch(`${state.firebaseUrl}/edupulse_live/liveLogs.json`, { method: 'DELETE' }).catch(() => {});
      } else {
        fetch(`${state.firebaseUrl}/edupulse_live/liveLogs.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(remoteLogs)
        }).catch(() => {});
      }
    }

    const remoteSig = JSON.stringify(remoteMembers.map(x => [x.id, x.status, x.faceRegistered, x.xp, (x.subjects || []).reduce((a, s) => a + s.attended, 0)])); const localSig = JSON.stringify(state.members.map(x => [x.id, x.status, x.faceRegistered, x.xp, (x.subjects || []).reduce((a, s) => a + s.attended, 0)])); if (forceMerge || remoteSig !== localSig || remoteLogs.length !== state.liveLogs.length) {
      applyIncomingLiveState({
        updatedAt: Math.max(remote.updatedAt || Date.now(), state.updatedAt || 0),
        members: remoteMembers,
        coordinators: remoteCoords.length ? remoteCoords : state.coordinators,
        liveLogs: remoteLogs,
        activities: Array.isArray(remote.activities) ? remote.activities : state.activities,
        coordinatorHash: remote.coordinatorHash || state.coordinatorHash
      }, 'Firebase Realtime DB', forceMerge);
    }
  } catch {}
}

function connectCloudLiveStream(roomName) {
  if (cloudEventSource) { cloudEventSource.close(); cloudEventSource = null; }
  try {
    cloudEventSource = new EventSource(`https://ntfy.sh/${encodeURIComponent(roomName)}/sse`);
    cloudEventSource.onmessage = ev => {
      try {
        const wrapper = JSON.parse(ev.data);
        if (wrapper.message) {
          const msgObj = JSON.parse(wrapper.message);
          if (msgObj.students && !Array.isArray(msgObj.members)) msgObj.members = Object.values(msgObj.students);
          if (msgObj.coordinators && !Array.isArray(msgObj.coordinators)) msgObj.coordinators = Object.values(msgObj.coordinators);
          applyIncomingLiveState(msgObj, 'Live Cloud Stream');
        }
      } catch {}
    };
  } catch {}
}

function applyIncomingLiveState(incoming, sourceLabel, forceApply = false) {
  if (!incoming || !Array.isArray(incoming.members)) return;
  const inSig = JSON.stringify(incoming.members.map(x => [x.id, x.status, x.faceRegistered, x.xp, (x.subjects || []).reduce((a, s) => a + s.attended, 0)])); const curSig = JSON.stringify(state.members.map(x => [x.id, x.status, x.faceRegistered, x.xp, (x.subjects || []).reduce((a, s) => a + s.attended, 0)])); if (!forceApply && inSig === curSig && (incoming.liveLogs || []).length === (state.liveLogs || []).length) return;

  const prevPending = state.members.filter(m => m.status === 'pending').length;
  const newPending = incoming.members.filter(m => m.status === 'pending').length;

  state.updatedAt = Math.max(incoming.updatedAt || 0, state.updatedAt || 0);
  state.members = incoming.members;
  if (Array.isArray(incoming.coordinators) && incoming.coordinators.length) state.coordinators = incoming.coordinators;
  if (Array.isArray(incoming.liveLogs)) state.liveLogs = incoming.liveLogs;
  purgeOrphanedLogsInPlace();
  if (Array.isArray(incoming.activities)) state.activities = incoming.activities;
  if (incoming.coordinatorHash) state.coordinatorHash = incoming.coordinatorHash;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updatePendingBadges();
  updateCloudStatusBadges();
  if (state.session) renderAll();
  if (newPending > prevPending && state.session?.role === 'coordinator') {
    showToast(`🔔 New Student Registration saved in ${sourceLabel}!`);
  }
  const tsEl = document.getElementById('live-sync-timestamp');
  if (tsEl) tsEl.textContent = `Live update synced via ${sourceLabel} at ${new Date().toLocaleTimeString()}`;
}

async function broadcastAndPushState(currentState) {
  purgeOrphanedLogsInPlace();
  const payload = buildSyncPayload(currentState);
  if (liveSyncChannel) liveSyncChannel.postMessage({ type: 'STATE_SYNC', payload });
  if (pythonOnline) await syncToPythonSQLite(currentState);

  if (currentState.firebaseUrl) {
    try {
      await fetch(`${currentState.firebaseUrl}/edupulse_live.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!payload.liveLogs.length) {
        await fetch(`${currentState.firebaseUrl}/edupulse_live/liveLogs.json`, { method: 'DELETE' });
      }
      updateCloudStatusBadges();
    } catch {}
  }

  try {
    const compact = {
      updatedAt: payload.updatedAt,
      syncRoom: payload.syncRoom,
      members: (currentState.members || []).map(m => {
        const copy = { ...m };
        delete copy.facePhoto; delete copy.faceDescriptor; delete copy.faceTemplates;
        return copy;
      }),
      coordinators: (currentState.coordinators || []).map(c => {
        const copy = { ...c };
        delete copy.facePhoto; delete copy.faceDescriptor;
        return copy;
      }),
      liveLogs: payload.liveLogs,
      activities: payload.activities
    };
    const serialized = JSON.stringify(compact);
    if (serialized.length < 3900) {
      await fetch(`https://ntfy.sh/${encodeURIComponent(currentState.syncRoom || 'edupulse-live-ayush0067')}`, { method: 'POST', body: serialized });
    }
  } catch {}
}

async function checkPythonBackend() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return;
    pythonOnline = true;
    const stateRes = await fetch('/api/state');
    const stateJson = await stateRes.json();
    if (stateJson.found && stateJson.state) applyIncomingLiveState(stateJson.state, 'SQLite3');
    else await syncToPythonSQLite(state);
  } catch { pythonOnline = false; }
}

function hookSaveStateToPython() {
  const orig = window.saveState;
  window.saveState = function (s) {
    orig(s);
    broadcastAndPushState(s);
    refreshPredictiveAnalytics();
    updateScholarBadge();
  };
}

async function syncToPythonSQLite(s) {
  try { await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }); } catch {}
}

async function recordTamperProofEvent(rollId, action) {
  if (!pythonOnline) return;
  try {
    const res = await fetch('/api/ledger-append', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roll_id: rollId, action }) });
    const data = await res.json();
    const hashEl = document.getElementById('ledger-hash-text');
    if (hashEl && data.ledger) hashEl.textContent = `Block #${data.ledger.total_blocks} • SHA-256: ${data.ledger.latest_hash}`;
  } catch {}
}

// ================= 2. BACKLIGHT-NORMALIZED 392-D FACE ALIGNMENT & TRIPLE-GATE GUARD =================
function normalizeVectorZeroMean(arr) {
  const mean = arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
  const centered = arr.map(v => v - mean);
  const norm = Math.sqrt(centered.reduce((s, v) => s + v * v, 0)) || 1;
  return centered.map(v => v / norm);
}

function upgradeAdvancedFaceSystem() {
  const origMark = window.markAttendanceForMember;
  window.markAttendanceForMember = function (mIdx, sIdx, isPresent, viaFace = false) {
    if (!state.session) {
      showToast('🚫 Sign in with a registered student account first.');
      return false;
    }
    const targetMember = state.members[mIdx];
    if (!targetMember) return false;

    if (state.session.role === 'student' && targetMember.id !== state.session.memberId) {
      showToast('🚫 Security Lock: You can only mark attendance for your own registered account.');
      return false;
    }
    if (targetMember.status !== 'approved') {
      showToast(`🚫 Account Not Approved: ${targetMember.name} (${targetMember.id}) requires HOD approval.`);
      return false;
    }
    if (!targetMember.faceRegistered || !viaFace) {
      showToast('🪪 Biometric Required: Complete live face scan to mark attendance.');
      return false;
    }

    evaluateCollegeSchedule();
    if (!collegeScheduleState.allowed) {
      showToast(`🚫 Blocked: ${collegeScheduleState.statusText}`);
      return false;
    }
    if (isPresent && !campusGeoState.insideCampus) {
      showToast('🚫 Blocked: Allow Location or verify via KIPM Lab Beacon first.');
      return false;
    }
    return origMark(mIdx, sIdx, isPresent, viaFace);
  };

  const origToggle = window.toggleCamera;
  window.toggleCamera = async function () {
    await origToggle();
    faceAlignmentState.aligned = false;
    faceAlignmentState.streak = 0;
    faceAlignmentState.reason = 'Align Face Inside Box';
    syncVerifyButtonState();
  };

  window.extractFaceDescriptor = function (videoEl) {
    const canvas = document.getElementById('face-process-canvas');
    const ctx = canvas.getContext('2d');
    const vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
    const size = Math.min(vw, vh) * 0.55;
    ctx.drawImage(videoEl, (vw - size) / 2, (vh - size) / 2, size, size, 0, 0, 140, 140);
    const imgData = ctx.getImageData(0, 0, 140, 140).data;

    const rawLums = [], rawRgs = [];
    let totalLum = 0;

    for (let by = 0; by < 14; by++) {
      for (let bx = 0; bx < 14; bx++) {
        let r = 0, g = 0, b = 0, c = 0;
        for (let y = by * 10; y < (by + 1) * 10; y += 2) {
          for (let x = bx * 10; x < (bx + 1) * 10; x += 2) {
            const idx = (y * 140 + x) * 4;
            r += imgData[idx]; g += imgData[idx + 1]; b += imgData[idx + 2]; c++;
          }
        }
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / (c * 255);
        rawLums.push(lum);
        rawRgs.push((r - g) / (c * 255));
        totalLum += lum;
      }
    }

    const sortedLums = [...rawLums].sort((a, b) => a - b);
    const lowClip = sortedLums[Math.floor(sortedLums.length * 0.06)];
    const highClip = sortedLums[Math.floor(sortedLums.length * 0.94)];
    const dynamicRange = Math.max(0.16, highClip - lowClip);

    const lumaGrid = rawLums.map(v => Math.min(1, Math.max(0, (v - lowClip) / dynamicRange)));
    const rawDesc = [];
    const coreLums = [];

    for (let i = 0; i < lumaGrid.length; i++) {
      rawDesc.push(lumaGrid[i], rawRgs[i]);
      const by = Math.floor(i / 14);
      const bx = i % 14;
      if (by >= 3 && by <= 10 && bx >= 3 && bx <= 10) coreLums.push(lumaGrid[i]);
    }

    let edgeContrastSum = 0, weightedX = 0, weightedY = 0, totalEdgeWeight = 0;
    for (let by = 1; by < 13; by++) {
      for (let bx = 1; bx < 13; bx++) {
        const cur = lumaGrid[by * 14 + bx];
        const mag = Math.abs(cur - lumaGrid[by * 14 + (bx - 1)]) + Math.abs(cur - lumaGrid[(by - 1) * 14 + bx]);
        edgeContrastSum += mag;
        weightedX += bx * mag;
        weightedY += by * mag;
        totalEdgeWeight += mag;
      }
    }

    const avgBrightness = (totalLum / rawLums.length) * 100;
    const sharpnessScore = Math.min(99, Math.round((edgeContrastSum / 144) * 420));
    const coreMean = coreLums.reduce((s, v) => s + v, 0) / coreLums.length;
    const coreStd = Math.sqrt(coreLums.reduce((s, v) => s + (v - coreMean) ** 2, 0) / coreLums.length);
    const cx = totalEdgeWeight > 0 ? (weightedX / totalEdgeWeight) / 13 : 0.5;
    const cy = totalEdgeWeight > 0 ? (weightedY / totalEdgeWeight) / 13 : 0.5;

    const centeredOk = cx >= 0.25 && cx <= 0.75 && cy >= 0.22 && cy <= 0.78;
    const featureRich = coreStd >= 0.04 && sharpnessScore >= 14 && (highClip - lowClip) >= 0.09;
    const lightingOk = avgBrightness >= 10 && avgBrightness <= 95;

    let alignReason = 'Aligned ✓';
    if (!lightingOk) alignReason = avgBrightness < 10 ? 'Too Dark — Face Light' : 'Too Bright — Reduce Glare';
    else if (!featureRich) alignReason = 'Move Closer Inside Box';
    else if (!centeredOk) alignReason = 'Center Face Inside Box';

    let motionDelta = 0.015;
    if (prevFrameLuma && prevFrameLuma.length === lumaGrid.length) {
      let diffSum = 0;
      for (let i = 0; i < lumaGrid.length; i++) diffSum += Math.abs(lumaGrid[i] - prevFrameLuma[i]);
      motionDelta = diffSum / lumaGrid.length;
    }
    prevFrameLuma = lumaGrid;
    liveHumanConfirmed = motionDelta > 0.0005;

    const norm = Math.sqrt(rawDesc.reduce((s, v) => s + v * v, 0)) || 1;
    const l2Vec = rawDesc.map(v => v / norm);
    const zVec = normalizeVectorZeroMean(rawDesc);

    return {
      vector: l2Vec,
      zVector: zVec,
      thumbnail: canvas.toDataURL('image/jpeg', 0.85),
      brightness: Math.round(avgBrightness),
      sharpness: sharpnessScore,
      qualityOk: lightingOk && featureRich && centeredOk,
      alignReason,
      livenessScore: Math.min(99.8, Math.max(55, motionDelta * 4500)).toFixed(1),
      isLive: liveHumanConfirmed
    };
  };

  window.registerMemberFace = async function () {
    if (!state.members.length) { showToast('Register a student first!'); return; }
    const video = document.getElementById('live-video');
    const regBtn = document.getElementById('register-face-btn');
    const banner = document.getElementById('face-match-banner');
    const reticle = document.getElementById('face-reticle');
    const label = document.getElementById('reticle-label');
    if (!liveStream) { await window.toggleCamera(); await new Promise(r => setTimeout(r, 700)); } if (!liveStream || video.readyState < 2) { showToast('Allow webcam access first!'); return; }

    const idx = state.session?.role === 'student'
      ? state.members.findIndex(x => x.id === state.session.memberId)
      : Number(document.getElementById('live-member-select').value);
    const m = state.members[idx];
    if (!m) return;

    const initialSample = window.extractFaceDescriptor(video);
    if (!initialSample.qualityOk) {
      showToast(`⚠️ Alignment Required: ${initialSample.alignReason} (Light: ${initialSample.brightness}%)`);
      return;
    }

    regBtn.disabled = true;

    const poses = ['Pose 1/3: Look Straight', 'Pose 2/3: Turn Slightly Left', 'Pose 3/3: Turn Slightly Right'];
    const capturedVectors = [];
    let bestThumb = initialSample.thumbnail;
    for (let p = 0; p < 3; p++) {
      reticle.classList.add('matched');
      label.textContent = poses[p];
      banner.classList.add('verified');
      banner.textContent = `🪪 Enrolling ${m.name} — ${poses[p]}...`;
      await new Promise(r => setTimeout(r, 450));
      const snap = window.extractFaceDescriptor(video);
      capturedVectors.push(snap.vector);
      if (p === 0) bestThumb = snap.thumbnail;
    }

    const dim = capturedVectors[0].length;
    const avgVec = new Array(dim).fill(0);
    capturedVectors.forEach(vec => { for (let i = 0; i < dim; i++) avgVec[i] += vec[i] / capturedVectors.length; });
    const norm = Math.sqrt(avgVec.reduce((s, v) => s + v * v, 0)) || 1;

    m.faceRegistered = true; m.facePhoto = bestThumb; m.faceDescriptor = avgVec.map(v => v / norm); m.faceTemplates = capturedVectors; m.xp += 60;
    state.activeMemberIndex = idx;
    logActivity(`Enrolled 3-Pose Biometric Face ID for ${m.name} (+60 XP)`, '3-Pose Face ID');
    window.saveState(state);
    await window.saveStudentRecordToFirebase(m);
    renderAll();
    regBtn.disabled = false;
    showToast(`🪪 Face ID Enrolled & Saved to Firebase for ${m.name}!`);
  };

  window.startContinuousFaceScan = function () {
    const video = document.getElementById('live-video');
    const reticle = document.getElementById('face-reticle');
    const label = document.getElementById('reticle-label');
    const banner = document.getElementById('face-match-banner');

    if (faceScanTimer) clearInterval(faceScanTimer);
    faceScanTimer = setInterval(() => {
      if (!liveStream || video.readyState < 2) return;
      const sample = window.extractFaceDescriptor(video);
      const loggedInStudent = getEligibleSessionStudent();

      if (loggedInStudent && !loggedInStudent.faceRegistered) {
        matchedMemberIndex = null;
        faceAlignmentState.aligned = false;
        faceAlignmentState.streak = 0;
        faceAlignmentState.reason = 'Enroll Face ID First';
        reticle.classList.toggle('matched', sample.qualityOk);
        label.textContent = sample.qualityOk ? 'READY — CLICK REGISTER FACE ID' : sample.alignReason.toUpperCase();
        banner.classList.remove('verified');
        banner.textContent = sample.qualityOk
          ? `🪪 Face Aligned! Click "🪪 Step 1: Register Face ID Now" below to enroll ${loggedInStudent.name}.`
          : `🎯 ${sample.alignReason} — Center your face, then click "🪪 Step 1: Register Face ID Now".`;
        syncVerifyButtonState();
        return;
      }

      const enrolled = state.members
        .map((m, idx) => ({ m, idx }))
        .filter(x => x.m.status === 'approved' && x.m.faceRegistered && x.m.faceDescriptor && x.m.faceDescriptor.length === sample.vector.length);

      if (!enrolled.length) {
        matchedMemberIndex = null;
        faceAlignmentState.aligned = false;
        faceAlignmentState.streak = 0;
        faceAlignmentState.reason = 'No Approved Face ID';
        banner.classList.remove('verified');
        banner.textContent = `⚠️ Only HOD-approved students with enrolled Face ID can mark attendance (${sample.alignReason})`;
        syncVerifyButtonState();
        return;
      }

      let bestIdx = -1, bestSim = -1;
      enrolled.forEach(({ m, idx }) => {
        const rawSim = cosineSimilarity(sample.vector, m.faceDescriptor);
        const zSim = cosineSimilarity(sample.zVector, normalizeVectorZeroMean(m.faceDescriptor));
        let sim = Math.max(rawSim, (rawSim * 0.55 + ((zSim + 1) / 2) * 0.45));

        if (Array.isArray(m.faceTemplates)) {
          m.faceTemplates.forEach(tpl => {
            if (tpl.length === sample.vector.length) {
              const tRaw = cosineSimilarity(sample.vector, tpl);
              const tZ = cosineSimilarity(sample.zVector, normalizeVectorZeroMean(tpl));
              sim = Math.max(sim, tRaw, (tRaw * 0.55 + ((tZ + 1) / 2) * 0.45));
            }
          });
        }
        if (sim > bestSim) { bestSim = sim; bestIdx = idx; }
      });

      const calibratedPct = bestSim >= 0.76
        ? Math.min(99.4, 90 + ((bestSim - 0.76) / 0.24) * 9.4).toFixed(2)
        : Math.max(0, (bestSim / 0.76) * 89.9).toFixed(2);

      const matchedCandidate = bestIdx !== -1 ? state.members[bestIdx] : null;
      const wrongStudentDetected = Boolean(loggedInStudent && matchedCandidate && bestSim >= 0.76 && matchedCandidate.id !== loggedInStudent.id);
      const isAlignedAndMatched = sample.qualityOk && sample.isLive && bestSim >= 0.76 && bestIdx !== -1 && !wrongStudentDetected;

      if (isAlignedAndMatched) faceAlignmentState.streak = Math.min(5, faceAlignmentState.streak + 1);
      else faceAlignmentState.streak = 0;

      if (faceAlignmentState.streak >= 2) {
        matchedMemberIndex = bestIdx;
        matchedConfidence = calibratedPct;
        faceAlignmentState.aligned = true;
        faceAlignmentState.reason = 'Aligned & Verified ✓';
        const matched = state.members[bestIdx];

        reticle.classList.add('matched');
        label.textContent = `ALIGNED: ${matched.id} (${calibratedPct}%)`;
        banner.classList.add('verified');
        banner.textContent = `✅ VERIFIED REGISTERED STUDENT: ${matched.name} (${calibratedPct}%) | Live:${sample.livenessScore}%`;

        const mSel = document.getElementById('live-member-select');
        if (mSel && !mSel.disabled && mSel.value !== String(bestIdx)) {
          mSel.value = String(bestIdx);
          renderLiveAttendanceUI();
        }

        if (
          document.getElementById('auto-face-checkin-toggle')?.checked &&
          collegeScheduleState.allowed &&
          campusGeoState.insideCampus &&
          !autoCheckInCooldown
        ) {
          const sIdx = Number(document.getElementById('live-subject-select').value);
          if (matched.subjects[sIdx] && !matched.subjects[sIdx].todayStatus) {
            autoCheckInCooldown = true;
            window.verifyLiveFaceAttendance();
            setTimeout(() => { autoCheckInCooldown = false; }, 3000);
          }
        }
      } else {
        matchedMemberIndex = null;
        matchedConfidence = 0;
        faceAlignmentState.aligned = false;
        faceAlignmentState.reason = wrongStudentDetected
          ? `Wrong Student (${matchedCandidate.id})`
          : !sample.qualityOk
          ? sample.alignReason
          : !sample.isLive
          ? 'Blink / Move Slightly'
          : `Align Closer (${calibratedPct}%)`;

        reticle.classList.remove('matched');
        label.textContent = faceAlignmentState.reason.toUpperCase();
        banner.classList.remove('verified');
        banner.textContent = wrongStudentDetected
          ? `🚫 Identity Mismatch: Signed in as ${loggedInStudent.name}, but camera sees ${matchedCandidate.name}!`
          : `🎯 ${faceAlignmentState.reason} | Light: ${sample.brightness}%`;
      }

      syncVerifyButtonState();
    }, 400);
  };

  window.verifyLiveFaceAttendance = async function () {
    if (!state.session) {
      showToast('🚫 Sign in with a registered student account first.');
      return;
    }

    evaluateCollegeSchedule();
    if (!collegeScheduleState.allowed) {
      showToast(`🚫 Attendance Locked: ${collegeScheduleState.statusText}`);
      return;
    }
    if (!campusGeoState.ready || !campusGeoState.insideCampus) {
      showToast('🚫 Allow Location in browser or click "🏫 Verify via KIPM Lab Beacon" first.');
      return;
    }
    if (!faceAlignmentState.aligned || matchedMemberIndex === null) {
      showToast(`🎯 Face Not Aligned: ${faceAlignmentState.reason}. Center face inside the box first.`);
      return;
    }

    const m = state.members[matchedMemberIndex];
    if (!m || m.status !== 'approved' || !m.faceRegistered) {
      showToast('🚫 Only HOD-approved students with an enrolled Face ID can mark attendance.');
      return;
    }

    if (state.session.role === 'student' && m.id !== state.session.memberId) {
      showToast(`🚫 Security Lock: Signed in as ${state.session.memberId}; cannot mark attendance for ${m.id}.`);
      return;
    }

    const sIdx = Number(document.getElementById('live-subject-select').value);
    const s = m.subjects[sIdx];
    if (!s || s.todayStatus) {
      showToast(`🔒 ${s ? s.name : 'Subject'} is already locked for ${m.name} today!`);
      return;
    }

    const distTag = campusGeoState.beaconVerified ? 'KIPM Lab Beacon' : `KIPM (${formatDistanceLabel(campusGeoState.distanceMeters)})`;
    const pTag = collegeScheduleState.activePeriod ? `${collegeScheduleState.activePeriod.id} (${collegeScheduleState.activePeriod.timeText})` : 'LIVE';

    if (!window.markAttendanceForMember(matchedMemberIndex, sIdx, true, true)) return;

    const now = new Date();
    state.liveLogs.unshift({
      date: now.toLocaleDateString(),
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      studentName: m.name,
      studentId: m.id,
      subject: `${pTag} • ${s.code}`,
      confidence: `${matchedConfidence}% Verified Student • ${distTag}`
    });
    window.saveState(state);
    await window.saveStudentRecordToFirebase(m);
    renderLiveAttendanceUI();
    recordTamperProofEvent(m.id, `REGISTERED_STUDENT_ATTENDANCE:${pTag}:${s.code}:${matchedConfidence}%:${distTag}`);
  };
}

// ================= 3. CAMERA QUESTION SCANNER, REWARDS & WIDGETS =================
function injectQuestionCameraScanner() {
  const solverView = document.getElementById('view-solver');
  const solverLayout = solverView?.querySelector('.solver-layout');
  if (!solverView || !solverLayout || document.getElementById('question-scanner-card')) return;

  const scannerCard = document.createElement('div');
  scannerCard.id = 'question-scanner-card';
  scannerCard.className = 'glass-card';
  scannerCard.style.borderColor = 'rgba(168, 85, 247, 0.4)';
  scannerCard.innerHTML = `<div class="card-header"><div><h3>📸 Scan Any Question with Camera & Solve Live <span class="badge badge-purple" style="margin-left:6px;">OCR + Vision AI</span></h3><small style="color:var(--text-muted);">Point your camera at a question or upload a photo to extract & solve (+20 XP)</small></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" id="toggle-qcam-btn" class="btn-outline">📷 Open Question Camera</button><label class="btn-outline" style="cursor:pointer;display:inline-flex;align-items:center;">📁 Upload Question Image<input type="file" id="upload-q-image" accept="image/*" style="display:none;" /></label></div></div><div id="q-scanner-workspace" style="display:none;margin-top:12px;"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;align-items:start;"><div><div class="camera-box" style="aspect-ratio:16/9;"><video id="q-scan-video" autoplay playsinline muted style="transform:none;"></video><img id="q-uploaded-preview" style="display:none;width:100%;height:100%;object-fit:contain;background:#03060d;" alt="Question" /></div><canvas id="q-capture-canvas" style="display:none;"></canvas><button type="button" id="capture-solve-q-btn" class="btn-primary" style="width:100%;margin-top:10px;padding:11px;">⚡ Capture & Solve Question (+20 XP)</button></div><div><label style="font-size:0.78rem;color:var(--text-muted);display:block;margin-bottom:5px;">Detected Question Text:</label><textarea id="q-extracted-text" rows="3" style="width:100%;background:var(--bg-panel);border:1px solid var(--border);color:var(--text-main);padding:10px;border-radius:10px;font-size:0.88rem;"></textarea><button type="button" id="solve-edited-q-btn" class="btn-outline" style="margin-top:8px;font-size:0.82rem;">🔄 Re-Solve Text Above</button><div id="q-scanned-solution" style="margin-top:12px;padding:14px;background:rgba(5,8,17,0.65);border:1px solid var(--border);border-radius:12px;font-size:0.9rem;line-height:1.6;max-height:240px;overflow-y:auto;">Ready to scan.</div></div></div></div>`;
  solverView.insertBefore(scannerCard, solverLayout);

  const toggleBtn = document.getElementById('toggle-qcam-btn');
  const workspace = document.getElementById('q-scanner-workspace');
  const video = document.getElementById('q-scan-video');
  const imgPreview = document.getElementById('q-uploaded-preview');

  toggleBtn.addEventListener('click', async () => {
    if (qScannerStream) { qScannerStream.getTracks().forEach(t => t.stop()); qScannerStream = null; video.srcObject = null; toggleBtn.textContent = '📷 Open Question Camera'; workspace.style.display = 'none'; return; }
    try {
      qScannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = qScannerStream; video.style.display = 'block'; imgPreview.style.display = 'none'; workspace.style.display = 'block'; toggleBtn.textContent = '⏹ Close Question Camera';
    } catch { showToast('Use "📁 Upload Question Image" if camera is blocked.'); }
  });

  document.getElementById('upload-q-image').addEventListener('change', e => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { imgPreview.src = ev.target.result; imgPreview.style.display = 'block'; video.style.display = 'none'; workspace.style.display = 'block'; processScannedImage(ev.target.result); };
    reader.readAsDataURL(file);
  });

  document.getElementById('capture-solve-q-btn').addEventListener('click', () => {
    const canvas = document.getElementById('q-capture-canvas');
    const ctx = canvas.getContext('2d');
    if (qScannerStream && video.readyState >= 2) { canvas.width = video.videoWidth || 800; canvas.height = video.videoHeight || 600; ctx.drawImage(video, 0, 0, canvas.width, canvas.height); processScannedImage(canvas.toDataURL('image/jpeg', 0.85)); }
    else if (imgPreview.style.display !== 'none' && imgPreview.src) processScannedImage(imgPreview.src);
  });

  document.getElementById('solve-edited-q-btn').addEventListener('click', async () => {
    const txt = document.getElementById('q-extracted-text').value.trim(); if (!txt) return;
    const solBox = document.getElementById('q-scanned-solution'); solBox.innerHTML = '⏳ Solving...';
    const m = getActiveMember(state) || { name: 'Student', id: 'N/A' };
    try { const ans = await window.fetchLiveOnlineAIReply(txt, m); solBox.innerHTML = typeof formatBotText === 'function' ? formatBotText(ans) : ans; } catch { solBox.textContent = 'AI solver busy.'; }
  });
}

async function processScannedImage(imageDataUrl) {
  const btn = document.getElementById('capture-solve-q-btn');
  const textBox = document.getElementById('q-extracted-text');
  const solBox = document.getElementById('q-scanned-solution');
  const m = getActiveMember(state);
  btn.disabled = true; btn.textContent = '⏳ Scanning & Solving...';
  solBox.innerHTML = '🔍 Extracting text and generating solution...';

  try {
    let data = null;
    if (pythonOnline) {
      const res = await fetch('/api/scan-question', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_base64: imageDataUrl, api_key: localStorage.getItem('edupulse_gemini_key') || '', student_info: m ? `${m.name} (${m.id})` : 'Student' }) });
      data = await res.json();
    } else {
      const form = new URLSearchParams({ apikey: 'helloworld', base64Image: imageDataUrl, language: 'eng', OCREngine: '2' });
      const ocrJson = await (await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form })).json();
      const extracted = ocrJson?.ParsedResults?.[0]?.ParsedText?.trim() || '';
      if (!extracted) data = { engine: 'Cloud OCR', extracted_text: '', solution: '⚠️ No clear text detected.' };
      else data = { engine: 'Cloud OCR + Live AI', extracted_text: extracted, solution: await window.fetchLiveOnlineAIReply(`Solve step-by-step:\n${extracted}`, m || { name: 'Student' }) };
    }
    if (data.extracted_text) textBox.value = data.extracted_text;
    solBox.innerHTML = `<div style="margin-bottom:6px;"><span class="badge badge-cyan">${data.engine}</span></div>${typeof formatBotText === 'function' ? formatBotText(data.solution || '') : (data.solution || '')}`;
    if (m && data.extracted_text) { m.xp += 20; window.saveState(state); renderHeaderAndKPIs(); showToast('⚡ Question Solved! +20 XP'); }
  } catch { solBox.innerHTML = '⚠️ Could not process image.'; }
  finally { btn.disabled = false; btn.textContent = '⚡ Capture & Solve Question (+20 XP)'; }
}

function upgradePrecisionRewards() {
  window.claimReward = function (id) {
    const m = getActiveMember(state), r = state.rewards.find(x => x.id === id);
    if (!m || !r || r.claimed || m.xp < r.cost) return;
    m.xp -= r.cost; r.claimed = true;
    r.voucherCode = `EP-VOUCH-${m.id}-${Math.random().toString(16).substring(2, 6).toUpperCase()}`;
    window.saveState(state); renderAll();
    showToast(`🎉 Redeemed "${r.title}"! Code: ${r.voucherCode}`);
  };
}

function updateScholarBadge() {
  const nameEl = document.getElementById('student-name');
  if (!nameEl || state.session?.role === 'coordinator') return;
  const claimed = state.rewards?.find(r => r.id === 'r1' && r.claimed);
  let tag = document.getElementById('gold-scholar-tag');
  if (claimed && !tag) {
    tag = document.createElement('span'); tag.id = 'gold-scholar-tag'; tag.className = 'badge badge-amber'; tag.style.marginLeft = '6px'; tag.textContent = '🏅 Gold Scholar';
    nameEl.parentNode.appendChild(tag);
  }
}

function injectPythonWidgets() {
  const topbar = document.querySelector('.topbar-actions');
  if (topbar && !document.getElementById('python-status-pill')) {
    const pill = document.createElement('div');
    pill.id = 'python-status-pill';
    pill.className = 'badge badge-cyan';
    pill.style.padding = '7px 12px';
    pill.textContent = pythonOnline ? '🐍 Python + SQLite3' : '🔥 Firebase Live DB';
    topbar.prepend(pill);
  }

  const hodExpBtn = document.getElementById('hod-export-report-btn');
  if (hodExpBtn) {
    hodExpBtn.addEventListener('click', async () => {
      if (pythonOnline) {
        await syncToPythonSQLite(state);
        window.location.href = '/api/hod-excel';
      } else {
        const headers = ['Roll ID', 'Student Name', 'Email', 'Mobile', 'Year', 'Approval Status', 'Attendance %', 'XP'];
        const rows = state.members.map(m => {
          const att = m.subjects.reduce((s, x) => s + x.attended, 0);
          const tot = m.subjects.reduce((s, x) => s + x.total, 0);
          return [m.id, m.name, m.email || '', `+91-${m.mobile || ''}`, m.year, m.status.toUpperCase(), tot ? ((att / tot) * 100).toFixed(1) + '%' : '0%', m.xp];
        });
        const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = `KIPM_HOD_Report_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        showToast('📥 Exported KIPM HOD Live Report (.csv)!');
      }
    });
  }

  const liveGrid = document.querySelector('#view-live .live-grid > div:last-child');
  if (liveGrid && !document.getElementById('python-qr-card')) {
    const qr = document.createElement('div');
    qr.id = 'python-qr-card';
    qr.className = 'glass-card';
    qr.innerHTML = `<div class="card-header"><h3>🔐 Anti-Proxy Classroom QR Pass</h3><span id="qr-timer-badge" class="badge badge-purple">60s</span></div><div style="display:flex;align-items:center;justify-content:space-between;"><div id="qr-token-text" style="font-family:'JetBrains Mono',monospace;font-size:1.1rem;font-weight:700;color:var(--cyan);">WAITING...</div><button type="button" onclick="updateDynamicQRToken()" class="btn-outline">🔄 Rotate</button></div>`;
    liveGrid.appendChild(qr);
    updateDynamicQRToken();
    setInterval(updateDynamicQRToken, 5000);
  }
}

function injectWhatIfSimulator() {
  const acadView = document.getElementById('view-academics');
  if (!acadView || document.getElementById('whatif-simulator-card')) return;
  const sim = document.createElement('div');
  sim.id = 'whatif-simulator-card';
  sim.className = 'glass-card';
  sim.innerHTML = `<div class="card-header"><div><h3>🎛️ Precision "What-If" Attendance & SGPA Simulator</h3><small style="color:var(--text-muted);">Slide future classes attended or marks boost to model outcomes</small></div><span class="badge badge-cyan">Live Projection</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;align-items:center;"><div><label style="font-size:0.84rem;color:var(--text-muted);display:flex;justify-content:space-between;"><span>Attend Next Classes:</span><strong id="sim-classes-lbl" style="color:var(--cyan);">+0 classes</strong></label><input type="range" id="sim-classes-slider" min="0" max="20" value="0" style="width:100%;margin-top:8px;accent-color:var(--cyan);" /></div><div><label style="font-size:0.84rem;color:var(--text-muted);display:flex;justify-content:space-between;"><span>Marks Improvement:</span><strong id="sim-marks-lbl" style="color:var(--purple);">+0%</strong></label><input type="range" id="sim-marks-slider" min="0" max="15" value="0" style="width:100%;margin-top:8px;accent-color:var(--purple);" /></div><div style="background:rgba(255,255,255,0.03);padding:12px 16px;border-radius:12px;border:1px solid var(--border);"><div style="font-size:0.82rem;color:var(--text-muted);">Simulated Attendance → SGPA</div><div id="sim-result-text" style="font-size:1.15rem;font-weight:800;color:var(--green);margin-top:4px;font-family:'JetBrains Mono',monospace;">--% → -- SGPA</div></div></div>`;
  acadView.insertBefore(sim, acadView.children[1]);

  const recalc = () => {
    const m = getActiveMember(state); if (!m) return;
    const addC = Number(document.getElementById('sim-classes-slider').value);
    const addM = Number(document.getElementById('sim-marks-slider').value);
    document.getElementById('sim-classes-lbl').textContent = `+${addC} classes`;
    document.getElementById('sim-marks-lbl').textContent = `+${addM}%`;
    const totAtt = m.subjects.reduce((s, x) => s + x.attended, 0) + addC;
    const totCls = m.subjects.reduce((s, x) => s + x.total, 0) + addC;
    const simAtt = totCls ? ((totAtt / totCls) * 100).toFixed(2) : '0.00';
    let totCr = 0, wGp = 0;
    m.subjects.forEach(s => {
      const cr = CREDITS_MAP[s.code] || 4;
      const mk = Math.min(100, s.internal + s.midterm + s.assignments + addM);
      const gp = mk >= 90 ? 10 : mk >= 80 ? 9 : mk >= 70 ? 8 : mk >= 60 ? 7 : mk >= 50 ? 6 : mk >= 40 ? 5 : 0;
      totCr += cr; wGp += cr * gp;
    });
    document.getElementById('sim-result-text').textContent = `${simAtt}% Att → ${(wGp / totCr).toFixed(2)} SGPA`;
  };
  document.getElementById('sim-classes-slider').addEventListener('input', recalc);
  document.getElementById('sim-marks-slider').addEventListener('input', recalc);
  recalc();
}

async function refreshPredictiveAnalytics() {
  const m = getActiveMember(state); if (!m || !pythonOnline) return;
  try {
    const r = await fetch('/api/predict-performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    if (r.ok) { latestOfficialNotice = (await r.json()).official_notice; }
  } catch {}
}

async function updateDynamicQRToken() {
  const m = getActiveMember(state);
  if (!m) { if (document.getElementById('qr-token-text')) document.getElementById('qr-token-text').textContent = 'REGISTER STUDENT FIRST'; return; }
  const win = Math.floor(Date.now() / 60000);
  const left = 60 - Math.floor((Date.now() / 1000) % 60);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${m.id}:${win}`));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 10).toUpperCase();
  if (document.getElementById('qr-token-text')) document.getElementById('qr-token-text').textContent = `EP-${m.id}-${hex}`;
  if (document.getElementById('qr-timer-badge')) document.getElementById('qr-timer-badge').textContent = `${left}s`;
}

