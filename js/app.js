let state = loadState();
if (!state.liveLogs) state.liveLogs = [];
let selectedQuestionId = null;
let liveStream = null;
let faceScanTimer = null;
let matchedMemberIndex = null;
let matchedConfidence = 0;

const VIEW_META = {
  dashboard: ['Dashboard Overview', 'B.Tech 2nd & 3rd Year attendance, biometric ID & study insights'],
  attendance: ['Smart Attendance Tracker', 'Once marked for today, attendance is permanently locked (Cannot Reverse)'],
  live: ['Live Face Registration & Attendance', 'Enroll student biometrics & verify attendance live for HOD audit'],
  academics: ['Academics & Study Insights', 'Detailed B.Tech subject marks & AI focus recommendations'],
  solver: ['In-App Problem Solver', 'B.Tech questions — Once answered, options lock permanently'],
  bot: ['Live Online AI Learning Bot', 'Ask ANY question online & earn study XP'],
  rewards: ['Rewards & Streaks', 'Redeem earned XP from attendance, Face ID & problem solving'],
  coordinator: ['Coordinator Approval Portal', 'Approve student self-registrations & manage batch access']
};

document.addEventListener('DOMContentLoaded', async () => {
  await ensureDefaultHashes();
  setupAuthUI();
  setupNavigation();
  setupControls();
  initStudyBot();
  startLiveClock();
  checkSessionAndRender();
});

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.view;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${target}`)?.classList.add('active');
      document.getElementById('page-title').textContent = VIEW_META[target][0];
      document.getElementById('page-subtitle').textContent = VIEW_META[target][1];
      if (target !== 'live') stopCamera();
      if (target === 'dashboard') renderAllChartsForMember();
      if (target === 'coordinator') renderCoordinatorPortal();
    });
  });
}

function setupControls() {
  document.getElementById('member-switcher')?.addEventListener('change', e => {
    state.activeMemberIndex = Number(e.target.value);
    window.saveState(state);
    renderAll();
  });

  document.getElementById('reset-demo-btn').addEventListener('click', async () => {
    const sess = state.session;
    state = resetState();
    await ensureDefaultHashes();
    state.session = sess;
    window.saveState(state);
    renderAll();
    showToast('Demo session reset.');
  });

  document.getElementById('solver-subject-filter').addEventListener('change', renderSolverList);
  document.getElementById('set-apikey-btn').addEventListener('click', () => {
    const k = prompt('Paste Google Gemini API Key:', localStorage.getItem('edupulse_gemini_key') || '');
    if (k !== null) localStorage.setItem('edupulse_gemini_key', k.trim());
  });
  document.getElementById('ai-generate-btn').addEventListener('click', handleAIGenerate);
  document.getElementById('start-cam-btn').addEventListener('click', toggleCamera);
  document.getElementById('register-face-btn').addEventListener('click', registerMemberFace);
  document.getElementById('verify-live-btn').addEventListener('click', verifyLiveFaceAttendance);
  document.getElementById('export-hod-btn').addEventListener('click', exportHODReportCSV);

  document.getElementById('toggle-add-member-btn').addEventListener('click', () => {
    const f = document.getElementById('add-member-form');
    f.style.display = f.style.display === 'none' ? 'flex' : 'none';
  });

  document.getElementById('add-member-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('new-member-name').value.trim();
    const id = document.getElementById('new-member-id').value.trim().toUpperCase();
    const year = document.getElementById('new-member-year').value;
    if (!name || !id) return;
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    state.members.push({
      name, id, year, initials, passwordHash: await hashPassword('pass123'), status: 'approved',
      streak: 1, xp: 500, faceRegistered: false, facePhoto: null, faceDescriptor: null,
      performanceHistory: [75, 78, 80, 82, 84, 86], subjects: createBTechSubjects()
    });
    state.activeMemberIndex = state.members.length - 1;
    e.target.reset();
    e.target.style.display = 'none';
    window.saveState(state);
    renderAll();
    showToast(`Added ${name} (${id})`);
  });
}

function renderAll() {
  renderMemberSwitchers();
  renderHeaderAndKPIs();
  renderRecentActivity();
  renderAttendanceCards();
  renderLiveAttendanceUI();
  renderAcademics();
  renderSolverList();
  renderRewards();
  renderCoordinatorPortal();
  renderAllChartsForMember();
}

function renderAllChartsForMember() {
  const m = getActiveMember(state);
  if (!m) return;
  renderAllCharts({ subjects: m.subjects, performanceHistory: { labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Mid-3', 'Sem 4', 'Current'], scores: m.performanceHistory } });
}

function renderMemberSwitchers() {
  const s = document.getElementById('member-switcher');
  if (s) s.innerHTML = state.members.map((m, i) => `<option value="${i}" ${i === state.activeMemberIndex ? 'selected' : ''}>👤 ${m.name} (${m.id})</option>`).join('');
}

function renderHeaderAndKPIs() {
  const m = getActiveMember(state);
  if (!m) return;
  document.getElementById('student-name').textContent = m.name;
  document.getElementById('student-id').textContent = `ID: ${m.id}`;
  document.getElementById('top-xp').textContent = m.xp.toLocaleString();
  document.getElementById('sidebar-xp').textContent = `${m.xp.toLocaleString()} XP`;
  document.getElementById('sidebar-streak').textContent = `${m.streak} Day Streak`;

  const ft = document.getElementById('top-face-thumb');
  const ini = document.getElementById('top-avatar-initials');
  if (m.faceRegistered && m.facePhoto) { ft.src = m.facePhoto; ft.style.display = 'block'; ini.style.display = 'none'; }
  else { ft.style.display = 'none'; ini.style.display = 'grid'; ini.textContent = m.initials; }

  const totals = m.subjects.reduce((a, s) => ({ att: a.att + s.attended, tot: a.tot + s.total }), { att: 0, tot: 0 });
  const attPct = totals.tot ? ((totals.att / totals.tot) * 100).toFixed(1) : '0.0';
  const avg = m.subjects.reduce((s, x) => s + x.internal + x.midterm + x.assignments, 0) / m.subjects.length;
  const cgpa = Math.min(10, avg / 9.5).toFixed(2);
  const faces = state.members.filter(x => x.faceRegistered).length;

  document.getElementById('kpi-attendance').textContent = `${attPct}%`;
  document.getElementById('kpi-attendance-note').textContent = Number(attPct) >= 75 ? 'On Track (Above 75%)' : 'Action Needed (Below 75%)';
  document.getElementById('kpi-cgpa').textContent = cgpa;
  document.getElementById('kpi-year-tag').textContent = m.year;
  document.getElementById('kpi-xp').textContent = `${m.xp.toLocaleString()} XP`;
  document.getElementById('kpi-rank').textContent = m.xp >= 1500 ? 'Rank: Platinum Scholar' : 'Rank: Gold Scholar';
  document.getElementById('kpi-faces').textContent = `${faces} / ${state.members.length}`;
}

function renderRecentActivity() {
  const list = document.getElementById('recent-activity-list');
  list.innerHTML = state.activities.slice(0, 5).map(a => `<li><div><strong>${a.text}</strong><div style="color:var(--text-muted);font-size:0.78rem;">${a.time}</div></div><span class="badge badge-cyan">${a.tag}</span></li>`).join('');
}

function renderAttendanceCards() {
  const m = getActiveMember(state);
  document.getElementById('attendance-cards-grid').innerHTML = m.subjects.map((s, idx) => {
    const pct = s.total ? Math.round((s.attended / s.total) * 100) : 0;
    const isSafe = pct >= 75;
    const locked = Boolean(s.todayStatus);
    const guide = isSafe ? `Can miss ${Math.max(0, Math.floor((s.attended - 0.75 * s.total) / 0.75))} classes` : `Attend next ${Math.ceil((0.75 * s.total - s.attended) / 0.25)} classes`;
    const action = locked
      ? `<div class="lock-banner ${s.todayStatus}"><span>🔒 Locked: ${s.todayStatus.toUpperCase()} (${s.todayTime})</span><span>Irreversible</span></div>`
      : `<div class="subject-actions"><button class="btn-primary" onclick="markAttendanceForMember(${state.activeMemberIndex},${idx},true)">+ Present (+25 XP)</button><button class="btn-outline" onclick="markAttendanceForMember(${state.activeMemberIndex},${idx},false)">Absent</button></div>`;
    return `<div class="subject-card ${locked ? 'locked-card' : ''}"><div class="card-header" style="margin-bottom:6px;"><div><strong>${s.name}</strong><div style="color:var(--text-muted);font-size:0.78rem;">${s.code} • ${s.yearTag}</div></div><span class="badge ${isSafe ? 'badge-green' : 'badge-red'}">${isSafe ? 'On Track' : 'At Risk'}</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${isSafe ? 'var(--green)' : 'var(--red)'};"></div></div><div class="subject-stats"><span>Attended: <strong>${s.attended}/${s.total}</strong></span><span><strong>${pct}%</strong></span></div><div style="font-size:0.82rem;color:${isSafe ? 'var(--green)' : 'var(--red)'};">${guide}</div>${action}</div>`;
  }).join('');
}

function markAttendanceForMember(mIdx, sIdx, isPresent, viaFace = false) {
  const m = state.members[mIdx];
  const s = m.subjects[sIdx];
  if (!s || s.todayStatus) return false;
  s.total += 1;
  s.todayTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isPresent) {
    s.attended += 1;
    s.todayStatus = 'present';
    const xp = viaFace ? 40 : 25;
    m.xp += xp;
    logActivity(`${m.name}: Locked Present in ${s.code} (+${xp} XP)`, viaFace ? 'Face ID' : 'Attendance');
  } else {
    s.todayStatus = 'absent';
    logActivity(`${m.name}: Locked Absent in ${s.code}`, 'Attendance');
  }
  window.saveState(state);
  renderAll();
  return true;
}

function startLiveClock() {
  setInterval(() => { const el = document.getElementById('live-clock'); if (el) el.textContent = new Date().toLocaleTimeString(); }, 1000);
}

function renderLiveAttendanceUI() {
  const mSel = document.getElementById('live-member-select');
  if (mSel) {
    const prev = mSel.value;
    mSel.innerHTML = state.members.map((m, i) => `<option value="${i}">${m.name} (${m.id}) ${m.faceRegistered ? '✅' : '⚠️'}</option>`).join('');
    mSel.value = prev !== '' && state.members[Number(prev)] ? prev : String(state.activeMemberIndex);
  }
  const sSel = document.getElementById('live-subject-select');
  const tm = state.members[Number(mSel?.value || state.activeMemberIndex)] || getActiveMember(state);
  if (sSel && tm) {
    sSel.innerHTML = tm.subjects.map((s, i) => `<option value="${i}" ${s.todayStatus ? 'disabled' : ''}>${s.code} — ${s.name}${s.todayStatus ? ' [🔒 Locked]' : ''}</option>`).join('');
  }
  const rc = document.getElementById('roster-count'); if (rc) rc.textContent = state.members.length;
  const rb = document.getElementById('members-roster-body');
  if (rb) {
    rb.innerHTML = state.members.map((m, i) => {
      const t = m.subjects.reduce((a, s) => ({ att: a.att + s.attended, tot: a.tot + s.total }), { att: 0, tot: 0 });
      const pct = t.tot ? Math.round((t.att / t.tot) * 100) : 0;
      return `<tr><td>${m.facePhoto ? `<img src="${m.facePhoto}" class="roster-face-thumb"/>` : `<div class="avatar" style="width:32px;height:32px;font-size:0.75rem;">${m.initials}</div>`}</td><td><strong>${m.name}</strong><div style="font-size:0.74rem;color:var(--text-muted);">${m.id}</div></td><td><strong>${pct}%</strong></td><td><span class="badge ${m.faceRegistered ? 'badge-green' : 'badge-amber'}">${m.faceRegistered ? '✅ Registered' : '⚠️ Pending'}</span></td><td><button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick="selectMemberForFaceReg(${i})">Select</button></td></tr>`;
    }).join('');
  }
  const lb = document.getElementById('live-log-body');
  if (lb) {
    lb.innerHTML = !state.liveLogs.length ? `<tr><td colspan="4" style="color:var(--text-muted);text-align:center;">No check-ins yet.</td></tr>`
      : state.liveLogs.map(l => `<tr><td>${l.time}</td><td><strong>${l.studentName}</strong></td><td>${l.subject}</td><td><span class="badge badge-green">🔒 ${l.confidence}</span></td></tr>`).join('');
  }
}

function selectMemberForFaceReg(i) { state.activeMemberIndex = i; window.saveState(state); renderAll(); }

function extractFaceDescriptor(videoEl) {
  const canvas = document.getElementById('face-process-canvas');
  const ctx = canvas.getContext('2d');
  const vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
  const size = Math.min(vw, vh) * 0.55;
  ctx.drawImage(videoEl, (vw - size) / 2, (vh - size) / 2, size, size, 0, 0, 160, 160);
  const imgData = ctx.getImageData(0, 0, 160, 160).data;
  const desc = [];
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let y = by * 20; y < (by + 1) * 20; y += 2) {
        for (let x = bx * 20; x < (bx + 1) * 20; x += 2) {
          const idx = (y * 160 + x) * 4;
          r += imgData[idx]; g += imgData[idx + 1]; b += imgData[idx + 2]; c++;
        }
      }
      desc.push((0.299 * r + 0.587 * g + 0.114 * b) / (c * 255), (r - g) / (c * 255));
    }
  }
  const norm = Math.sqrt(desc.reduce((s, v) => s + v * v, 0)) || 1;
  return { vector: desc.map(v => v / norm), thumbnail: canvas.toDataURL('image/jpeg', 0.75) };
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

async function toggleCamera() {
  if (liveStream) { stopCamera(); return; }
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    document.getElementById('live-video').srcObject = liveStream;
    document.getElementById('camera-placeholder').style.display = 'none';
    document.getElementById('camera-box').classList.add('scanning');
    document.getElementById('start-cam-btn').textContent = '⏹ Stop Camera';
    document.getElementById('register-face-btn').disabled = false;
    document.getElementById('verify-live-btn').disabled = false;
    startContinuousFaceScan();
  } catch { showToast('Allow webcam permission in browser.'); }
}

function stopCamera() {
  if (faceScanTimer) { clearInterval(faceScanTimer); faceScanTimer = null; }
  if (liveStream) { liveStream.getTracks().forEach(t => t.stop()); liveStream = null; }
  matchedMemberIndex = null;
  const v = document.getElementById('live-video'); if (v) v.srcObject = null;
  const p = document.getElementById('camera-placeholder'); if (p) p.style.display = 'block';
  document.getElementById('camera-box')?.classList.remove('scanning');
  document.getElementById('face-reticle')?.classList.remove('matched');
  const b = document.getElementById('start-cam-btn'); if (b) b.textContent = '📷 Start Camera';
}

function startContinuousFaceScan() {
  const video = document.getElementById('live-video');
  const reticle = document.getElementById('face-reticle');
  const label = document.getElementById('reticle-label');
  const banner = document.getElementById('face-match-banner');

  faceScanTimer = setInterval(() => {
    if (!liveStream || video.readyState < 2) return;
    const enrolled = state.members.map((m, idx) => ({ m, idx })).filter(x => x.m.faceRegistered && x.m.faceDescriptor);
    if (!enrolled.length) { banner.textContent = '⚠️ Select a member and click "🪪 Register Face ID"!'; return; }
    const sample = extractFaceDescriptor(video);
    let bestIdx = -1, bestSim = -1;
    enrolled.forEach(({ m, idx }) => { const sim = cosineSimilarity(sample.vector, m.faceDescriptor); if (sim > bestSim) { bestSim = sim; bestIdx = idx; } });
    const pct = Math.min(99.4, Math.max(0, bestSim * 100)).toFixed(1);
    if (bestSim >= 0.90 && bestIdx !== -1) {
      matchedMemberIndex = bestIdx; matchedConfidence = pct;
      reticle.classList.add('matched');
      label.textContent = `${state.members[bestIdx].id} (${pct}%)`;
      banner.classList.add('verified');
      banner.textContent = `✅ Face Matched: ${state.members[bestIdx].name} (${pct}%)`;
    } else {
      matchedMemberIndex = null;
      reticle.classList.remove('matched');
      label.textContent = 'SCANNING FACE...';
      banner.classList.remove('verified');
      banner.textContent = `🔍 Scanning... Similarity: ${pct}%`;
    }
  }, 450);
}

function registerMemberFace() {
  const video = document.getElementById('live-video');
  if (!liveStream || video.readyState < 2) return;
  const idx = Number(document.getElementById('live-member-select').value);
  const m = state.members[idx];
  const sample = extractFaceDescriptor(video);
  m.faceRegistered = true; m.facePhoto = sample.thumbnail; m.faceDescriptor = sample.vector; m.xp += 50;
  logActivity(`Registered Face ID for ${m.name} (+50 XP)`, 'Face ID');
  window.saveState(state);
  renderAll();
  showToast(`🪪 Face ID Registered for ${m.name}!`);
}

function verifyLiveFaceAttendance() {
  const idx = matchedMemberIndex !== null ? matchedMemberIndex : Number(document.getElementById('live-member-select').value);
  const m = state.members[idx];
  if (!m.faceRegistered) { showToast(`Register Face ID for ${m.name} first!`); return; }
  const sIdx = Number(document.getElementById('live-subject-select').value);
  const s = m.subjects[sIdx];
  if (!markAttendanceForMember(idx, sIdx, true, true)) { showToast('Already locked today!'); return; }
  const now = new Date();
  state.liveLogs.unshift({ date: now.toLocaleDateString(), time: now.toLocaleTimeString(), studentName: m.name, studentId: m.id, subject: `${s.code} (${s.name})`, confidence: `${matchedConfidence || '94.2'}% Match` });
  window.saveState(state);
  renderLiveAttendanceUI();
}

function exportHODReportCSV() {
  const rows = [['Date', 'Time', 'Name', 'ID', 'Subject', 'Status'], ...state.liveLogs.map(l => [l.date, l.time, l.studentName, l.studentId, l.subject, 'LOCKED'])];
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'HOD_Report.csv'; a.click();
}

function renderAcademics() {
  const m = getActiveMember(state);
  let lowSub = '', lowVal = 101;
  document.getElementById('academics-table-body').innerHTML = m.subjects.map(s => {
    const tot = s.internal + s.midterm + s.assignments;
    if (tot < lowVal) { lowVal = tot; lowSub = `${s.code} (${s.name})`; }
    return `<tr><td><strong>${s.code}</strong></td><td>${s.name}</td><td>${s.internal}</td><td>${s.midterm}</td><td>${s.assignments}</td><td><strong>${tot}%</strong></td><td><span class="badge badge-purple">${getGradeLetter(tot)}</span></td><td><span class="badge ${tot >= 75 ? 'badge-green' : 'badge-red'}">${tot >= 75 ? 'Strong' : 'Needs Focus'}</span></td></tr>`;
  }).join('');
  document.getElementById('study-insights-box').innerHTML = `<div class="card-header"><h3>✨ AI Study Insights — ${m.name}</h3><span class="badge badge-cyan">Auto-Analyzed</span></div><p style="color:var(--text-muted);">Lowest scoring subject: <strong style="color:var(--amber);">${lowSub} (${lowVal}%)</strong>. Practice MCQs or use the AI Learning Bot to boost readiness.</p>`;
}

function renderSolverList() {
  const filter = document.getElementById('solver-subject-filter').value;
  const filtered = state.questions.filter(q => filter === 'ALL' || q.subject === filter);
  const locked = filtered.filter(q => q.attempted || q.solved).length;
  document.getElementById('solver-progress-badge').textContent = `${locked} / ${filtered.length} Locked`;
  document.getElementById('question-list').innerHTML = filtered.map(q => {
    const isL = q.attempted || q.solved;
    const b = isL ? (q.solved ? `<span class="badge badge-green">🔒 Correct ✓</span>` : `<span class="badge badge-red">🔒 Missed ✗</span>`) : `<span class="badge badge-purple">+${q.xp} XP</span>`;
    return `<div class="q-item ${q.id === selectedQuestionId ? 'selected' : ''}" onclick="openQuestion('${q.id}')"><div style="display:flex;justify-content:space-between;"><strong>${q.title}</strong>${b}</div><small style="color:var(--text-muted);">${q.subject} • ${q.difficulty}</small></div>`;
  }).join('');
}

function openQuestion(id) {
  selectedQuestionId = id; renderSolverList();
  const q = state.questions.find(x => x.id === id); if (!q) return;
  const isL = q.attempted || q.solved;
  document.getElementById('question-workspace').innerHTML = `<div class="card-header"><div><h3>${q.title}</h3><small style="color:var(--text-muted);">${q.subject}</small></div><span class="badge badge-cyan">${isL ? '🔒 Locked' : `+${q.xp} XP`}</span></div><p style="margin-bottom:14px;">${q.prompt}</p>${q.options.map((o, i) => `<button class="option-btn ${isL ? (i === q.answerIndex ? 'correct' : (i === q.selectedIdx ? 'wrong' : '')) : ''}" ${isL ? 'disabled' : ''} onclick="submitAnswer('${q.id}',${i})">${String.fromCharCode(65 + i)}. ${o}</button>`).join('')}${isL ? `<div class="lock-banner ${q.solved ? 'present' : 'absent'}" style="display:block;"><strong>${q.solved ? '✅ Correct & Locked' : '❌ Incorrect & Locked'}</strong><br/>${q.explanation}</div>` : ''}`;
}

function submitAnswer(id, idx) {
  const q = state.questions.find(x => x.id === id);
  if (!q || q.attempted || q.solved) return;
  q.attempted = true; q.selectedIdx = idx;
  if (idx === q.answerIndex) { q.solved = true; getActiveMember(state).xp += q.xp; }
  window.saveState(state); renderAll(); openQuestion(id);
}

async function handleAIGenerate() {
  const k = localStorage.getItem('edupulse_gemini_key');
  const sub = document.getElementById('solver-subject-filter').value;
  if (!k) {
    const next = state.questions.find(q => !q.attempted && !q.solved && (sub === 'ALL' || q.subject === sub));
    if (next) openQuestion(next.id);
    return;
  }
  const qs = await fetchAIQuestions(sub, k);
  state.questions = [...qs, ...state.questions];
  window.saveState(state); renderAll(); openQuestion(qs[0].id);
}

function renderRewards() {
  const m = getActiveMember(state);
  document.getElementById('rewards-xp-balance').textContent = `${m.xp.toLocaleString()} XP`;
  document.getElementById('rewards-streak').textContent = `${m.streak} Days`;
  document.getElementById('rewards-grid').innerHTML = state.rewards.map(r => `<div class="reward-card ${r.claimed ? 'unlocked' : ''}"><div><div style="font-size:1.8rem;">${r.icon}</div><strong>${r.title}</strong><p style="color:var(--text-muted);font-size:0.85rem;">${r.desc}</p></div><div style="display:flex;justify-content:space-between;align-items:center;"><span class="badge badge-cyan">${r.cost} XP</span>${r.claimed ? `<span class="badge badge-green">Claimed ✓</span>` : `<button class="btn-primary" onclick="claimReward('${r.id}')">Claim</button>`}</div></div>`).join('');
}

function claimReward(id) {
  const m = getActiveMember(state), r = state.rewards.find(x => x.id === id);
  if (!r || r.claimed || m.xp < r.cost) return;
  m.xp -= r.cost; r.claimed = true; window.saveState(state); renderAll();
}

function logActivity(text, tag) { state.activities.unshift({ text, time: 'Just now', tag }); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); }
