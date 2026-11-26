let state = loadState();
if (!state.liveLogs) state.liveLogs = [];
let selectedQuestionId = null;
let liveStream = null;
let faceScanTimer = null;
let matchedMemberIndex = null;
let matchedConfidence = 0;

const VIEW_META = {
  dashboard: ['Dashboard Overview', 'Real-time attendance, biometric ID & study insights'],
  attendance: ['Smart Attendance Tracker', 'Only HOD-approved, biometrically registered students can mark attendance'],
  live: ['Live Face Registration & Attendance', 'Enroll student biometrics & verify attendance live'],
  academics: ['Academics & Study Insights', 'Detailed B.Tech subject marks & AI focus recommendations'],
  solver: ['In-App Problem Solver', 'B.Tech questions — Once answered, options lock permanently'],
  bot: ['Live Online AI Learning Bot', 'Ask ANY question online & earn study XP'],
  rewards: ['Rewards & Streaks', 'Redeem earned XP from attendance, Face ID & problem solving'],
  coordinator: ['Admin, HOD & Coordinator Governance Portal', 'Real-Time Approvals, Live Cloud DB & Biometric Audit']
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
      const role = state.session?.role;
      if (role === 'student' && target === 'coordinator') return;
      if (role === 'coordinator' && !['coordinator', 'live'].includes(target)) return;

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
  document.getElementById('solver-subject-filter')?.addEventListener('change', renderSolverList);
  document.getElementById('set-apikey-btn')?.addEventListener('click', () => {
    const k = prompt('Paste Google Gemini API Key:', localStorage.getItem('edupulse_gemini_key') || '');
    if (k !== null) localStorage.setItem('edupulse_gemini_key', k.trim());
  });
  document.getElementById('ai-generate-btn')?.addEventListener('click', handleAIGenerate);
  document.getElementById('start-cam-btn')?.addEventListener('click', () => toggleCamera());
  document.getElementById('register-face-btn')?.addEventListener('click', () => registerMemberFace());
  document.getElementById('verify-live-btn')?.addEventListener('click', () => verifyLiveFaceAttendance());
  document.getElementById('export-hod-btn')?.addEventListener('click', exportHODReportCSV);

  document.getElementById('toggle-add-member-btn')?.addEventListener('click', () => {
    const f = document.getElementById('add-member-form');
    f.style.display = f.style.display === 'none' ? 'flex' : 'none';
  });

  document.getElementById('add-member-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('new-member-name').value.trim();
    const id = document.getElementById('new-member-id').value.trim().toUpperCase();
    const mobile = document.getElementById('new-member-mobile').value.trim().replace(/\D/g, '');
    const year = document.getElementById('new-member-year').value;
    if (!name || !id) return;
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const newStu = {
      name, id, mobile, mobileVerified: true, year, initials, passwordHash: await hashPassword('pass123'), status: 'approved',
      streak: 1, xp: 100, faceRegistered: false, facePhoto: null, faceDescriptor: null,
      performanceHistory: [0, 0, 0, 0, 0, 0], subjects: createBTechSubjects()
    };
    state.members.push(newStu);
    state.activeMemberIndex = state.members.length - 1;
    e.target.reset();
    e.target.style.display = 'none';
    window.saveState(state);
    if (typeof window.saveStudentRecordToFirebase === 'function') await window.saveStudentRecordToFirebase(newStu);
    renderAll();
    showToast(`Added ${name} (${id})`);
  });
}

function getValidSessionLogs() {
  const validIds = new Set((state.members || []).map(m => m.id));
  return (state.liveLogs || []).filter(l => validIds.has(l.studentId));
}

function renderAll() {
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

function renderHeaderAndKPIs() {
  const ft = document.getElementById('top-face-thumb');
  const ini = document.getElementById('top-avatar-initials');

  if (state.session?.role === 'coordinator') {
    const fac = (state.coordinators || []).find(c => c.id === state.session.memberId) || state.coordinators[0];
    if (fac) {
      document.getElementById('student-name').textContent = fac.name;
      document.getElementById('student-id').textContent = `${fac.designation} • ${fac.id}`;
      if (fac.facePhoto) { ft.src = fac.facePhoto; ft.style.display = 'block'; ini.style.display = 'none'; }
      else { ft.style.display = 'none'; ini.style.display = 'grid'; ini.textContent = fac.initials || 'HD'; }
    }
    return;
  }

  const m = getActiveMember(state);
  if (!m) return;
  document.getElementById('student-name').textContent = m.name;
  document.getElementById('student-id').textContent = `ID: ${m.id}`;
  document.getElementById('top-xp').textContent = m.xp.toLocaleString();
  document.getElementById('sidebar-xp').textContent = `${m.xp.toLocaleString()} XP`;
  document.getElementById('sidebar-streak').textContent = `${m.streak} Day Streak`;

  if (m.faceRegistered && m.facePhoto) { ft.src = m.facePhoto; ft.style.display = 'block'; ini.style.display = 'none'; }
  else { ft.style.display = 'none'; ini.style.display = 'grid'; ini.textContent = m.initials; }

  const totals = m.subjects.reduce((a, s) => ({ att: a.att + s.attended, tot: a.tot + s.total }), { att: 0, tot: 0 });
  const attPct = totals.tot ? ((totals.att / totals.tot) * 100).toFixed(1) : '0.0';
  const avg = m.subjects.reduce((s, x) => s + x.internal + x.midterm + x.assignments, 0) / m.subjects.length;
  const cgpa = Math.min(10, avg / 9.5).toFixed(2);
  const faces = state.members.filter(x => x.faceRegistered).length;

  document.getElementById('kpi-attendance').textContent = `${attPct}%`;
  document.getElementById('kpi-attendance-note').textContent = totals.tot === 0 ? 'No classes marked yet' : (Number(attPct) >= 75 ? 'On Track (Above 75%)' : 'Action Needed (Below 75%)');
  document.getElementById('kpi-cgpa').textContent = cgpa;
  document.getElementById('kpi-year-tag').textContent = m.year;
  document.getElementById('kpi-xp').textContent = `${m.xp.toLocaleString()} XP`;
  document.getElementById('kpi-rank').textContent = m.xp >= 1500 ? 'Rank: Platinum Scholar' : 'Rank: Rising Scholar';
  document.getElementById('kpi-faces').textContent = `${faces} / ${state.members.length}`;
}

function renderRecentActivity() {
  const list = document.getElementById('recent-activity-list');
  if (list) list.innerHTML = state.activities.slice(0, 5).map(a => `<li><div><strong>${a.text}</strong><div style="color:var(--text-muted);font-size:0.78rem;">${a.time}</div></div><span class="badge badge-cyan">${a.tag}</span></li>`).join('');
}

function goToLiveFaceForSubject(subjectIdx) {
  const liveBtn = document.querySelector('.nav-btn[data-view="live"]');
  if (liveBtn) liveBtn.click();
  setTimeout(() => {
    const sSel = document.getElementById('live-subject-select');
    if (sSel) sSel.value = String(subjectIdx);
  }, 50);
}

function renderAttendanceCards() {
  const m = getActiveMember(state);
  const grid = document.getElementById('attendance-cards-grid');
  if (!grid || !m) return;

  const isApproved = m.status === 'approved';
  const hasFace = Boolean(m.faceRegistered);

  grid.innerHTML = m.subjects.map((s, idx) => {
    const pct = s.total ? Math.round((s.attended / s.total) * 100) : 0;
    const isSafe = s.total === 0 || pct >= 75;
    const locked = Boolean(s.todayStatus);
    const guide = s.total === 0
      ? 'Requires Approved Student + Face ID Scan'
      : (isSafe ? `Can miss ${Math.max(0, Math.floor((s.attended - 0.75 * s.total) / 0.75))} classes` : `Attend next ${Math.ceil((0.75 * s.total - s.attended) / 0.25)} classes`);

    let action = '';
    if (locked) {
      action = `<div class="lock-banner ${s.todayStatus}"><span>🔒 Locked: ${s.todayStatus.toUpperCase()} (${s.todayTime})</span><span>Irreversible</span></div>`;
    } else if (!isApproved) {
      action = `<div class="lock-banner absent"><span>⏳ Pending HOD Approval</span><span>Account Locked</span></div>`;
    } else if (!hasFace) {
      action = `<div class="subject-actions"><button class="btn-outline" style="border-color:var(--amber);color:var(--amber);" onclick="goToLiveFaceForSubject(${idx})">🪪 Register Face ID First</button></div>`;
    } else {
      action = `<div class="subject-actions"><button class="btn-primary" onclick="goToLiveFaceForSubject(${idx})">📷 Scan Face to Mark Present</button></div>`;
    }

    return `<div class="subject-card ${locked ? 'locked-card' : ''}"><div class="card-header" style="margin-bottom:6px;"><div><strong>${s.name}</strong><div style="color:var(--text-muted);font-size:0.78rem;">${s.code} • ${s.yearTag}</div></div><span class="badge ${isSafe ? 'badge-green' : 'badge-red'}">${s.total === 0 ? 'Registered' : (isSafe ? 'On Track' : 'At Risk')}</span></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${isSafe ? 'var(--green)' : 'var(--red)'};"></div></div><div class="subject-stats"><span>Attended: <strong>${s.attended}/${s.total}</strong></span><span><strong>${pct}%</strong></span></div><div style="font-size:0.82rem;color:${isSafe ? 'var(--green)' : 'var(--red)'};">${guide}</div>${action}</div>`;
  }).join('');
}

function markAttendanceForMember(mIdx, sIdx, isPresent, viaFace = false) {
  if (!state.session) {
    showToast('🚫 Sign in with a registered student account first.');
    return false;
  }

  const m = state.members[mIdx];
  if (!m) return false;

  if (state.session.role === 'student' && m.id !== state.session.memberId) {
    showToast('🚫 Security Lock: You can only mark attendance for your own registered account.');
    return false;
  }
  if (m.status !== 'approved') {
    showToast(`🚫 Account Not Approved: ${m.name} (${m.id}) must be approved by HOD first.`);
    return false;
  }
  if (!m.faceRegistered || !viaFace) {
    showToast('🪪 Biometric Verification Required: Complete live face scan to mark attendance.');
    return false;
  }

  const s = m.subjects[sIdx];
  if (!s || s.todayStatus) return false;

  s.total += 1;
  s.todayTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isPresent) {
    s.attended += 1;
    s.todayStatus = 'present';
    m.xp += 40;
    logActivity(`${m.name} (${m.id}): Verified Biometric Present in ${s.code} (+40 XP)`, 'Verified Student');
  } else {
    s.todayStatus = 'absent';
    logActivity(`${m.name} (${m.id}): Locked Absent in ${s.code}`, 'Attendance');
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
  const sSel = document.getElementById('live-subject-select');
  const rc = document.getElementById('roster-count');
  const rb = document.getElementById('members-roster-body');
  const lb = document.getElementById('live-log-body');
  const regBtn = document.getElementById('register-face-btn');
  const verifyBtn = document.getElementById('verify-live-btn');

  const isStudentSession = state.session?.role === 'student';
  const loggedInStudent = isStudentSession
    ? state.members.find(m => m.id === state.session.memberId)
    : null;

  if (rc) rc.textContent = state.members.length;

  // Allow clicking Register Face ID anytime (it auto-starts the camera if needed)
  if (regBtn && verifyBtn && loggedInStudent) {
    regBtn.disabled = false;
    if (!loggedInStudent.faceRegistered) {
      regBtn.className = 'btn-primary';
      regBtn.textContent = '🪪 Step 1: Register Face ID Now';
      verifyBtn.className = 'btn-outline';
    } else {
      regBtn.className = 'btn-outline';
      regBtn.textContent = '🪪 Re-Enroll Face ID';
      verifyBtn.className = 'btn-primary';
    }
  }

  if (!state.members.length) {
    if (mSel) { mSel.innerHTML = `<option value="">No students registered yet</option>`; mSel.disabled = true; }
    if (sSel) sSel.innerHTML = `<option value="">Register a student first</option>`;
    if (rb) rb.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);text-align:center;">No students registered yet.</td></tr>`;
  } else if (isStudentSession && loggedInStudent) {
    const myIdx = state.members.findIndex(m => m.id === loggedInStudent.id);
    const prevSub = sSel?.value;
    if (mSel) {
      mSel.innerHTML = `<option value="${myIdx}">${loggedInStudent.name} (${loggedInStudent.id}) — Verified Session</option>`;
      mSel.value = String(myIdx);
      mSel.disabled = true;
    }
    if (sSel) {
      sSel.innerHTML = loggedInStudent.subjects.map((s, i) => `<option value="${i}" ${s.todayStatus ? 'disabled' : ''}>${s.code} — ${s.name}${s.todayStatus ? ' [🔒 Locked]' : ''}</option>`).join('');
      const activePeriodIdx = typeof window.getCurrentPeriodSubjectIdx === 'function' ? window.getCurrentPeriodSubjectIdx() : null;
      if (activePeriodIdx !== null && sSel.querySelector(`option[value="${activePeriodIdx}"]:not(:disabled)`)) {
        sSel.value = String(activePeriodIdx);
      } else if (prevSub && sSel.querySelector(`option[value="${prevSub}"]:not(:disabled)`)) {
        sSel.value = prevSub;
      }
    }
    if (rb) {
      rb.innerHTML = state.members.map(m => {
        const t = m.subjects.reduce((a, s) => ({ att: a.att + s.attended, tot: a.tot + s.total }), { att: 0, tot: 0 });
        const pct = t.tot ? Math.round((t.att / t.tot) * 100) : 0;
        const isSelf = m.id === loggedInStudent.id;
        return `<tr style="${isSelf ? 'background:rgba(34,211,238,0.06);' : ''}"><td>${m.facePhoto ? `<img src="${m.facePhoto}" class="roster-face-thumb"/>` : `<div class="avatar" style="width:32px;height:32px;font-size:0.75rem;">${m.initials}</div>`}</td><td><strong>${m.name}</strong><div style="font-size:0.74rem;color:var(--text-muted);">${m.id}</div></td><td><strong>${pct}%</strong></td><td><span class="badge ${m.faceRegistered ? 'badge-green' : 'badge-amber'}">${m.faceRegistered ? '✅ Registered' : '⚠️ Pending'}</span></td><td>${isSelf ? '<span class="badge badge-cyan">Active User</span>' : '<span style="color:var(--text-muted);font-size:0.75rem;">Locked</span>'}</td></tr>`;
      }).join('');
    }
  } else {
    const prevSub = sSel?.value;
    if (mSel) {
      const prev = mSel.value;
      mSel.disabled = false;
      mSel.innerHTML = state.members.map((m, i) => `<option value="${i}">${m.name} (${m.id}) ${m.status === 'approved' ? (m.faceRegistered ? '✅' : '⚠️') : '⏳ Unapproved'}</option>`).join('');
      mSel.value = prev !== '' && state.members[Number(prev)] ? prev : String(state.activeMemberIndex);
    }
    const tm = state.members[Number(mSel?.value || state.activeMemberIndex)] || getActiveMember(state);
    if (sSel && tm) {
      sSel.innerHTML = tm.subjects.map((s, i) => `<option value="${i}" ${s.todayStatus ? 'disabled' : ''}>${s.code} — ${s.name}${s.todayStatus ? ' [🔒 Locked]' : ''}</option>`).join('');
      const activePeriodIdx = typeof window.getCurrentPeriodSubjectIdx === 'function' ? window.getCurrentPeriodSubjectIdx() : null;
      if (activePeriodIdx !== null && sSel.querySelector(`option[value="${activePeriodIdx}"]:not(:disabled)`)) {
        sSel.value = String(activePeriodIdx);
      } else if (prevSub && sSel.querySelector(`option[value="${prevSub}"]:not(:disabled)`)) {
        sSel.value = prevSub;
      }
    }
    if (rb) {
      rb.innerHTML = state.members.map((m, i) => {
        const t = m.subjects.reduce((a, s) => ({ att: a.att + s.attended, tot: a.tot + s.total }), { att: 0, tot: 0 });
        const pct = t.tot ? Math.round((t.att / t.tot) * 100) : 0;
        return `<tr><td>${m.facePhoto ? `<img src="${m.facePhoto}" class="roster-face-thumb"/>` : `<div class="avatar" style="width:32px;height:32px;font-size:0.75rem;">${m.initials}</div>`}</td><td><strong>${m.name}</strong><div style="font-size:0.74rem;color:var(--text-muted);">${m.id}</div></td><td><strong>${pct}%</strong></td><td><span class="badge ${m.faceRegistered ? 'badge-green' : 'badge-amber'}">${m.faceRegistered ? '✅ Registered' : '⚠️ Pending'}</span></td><td><button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick="selectMemberForFaceReg(${i})">Select</button></td></tr>`;
      }).join('');
    }
  }

  const validLogs = getValidSessionLogs();
  if (lb) {
    lb.innerHTML = !validLogs.length
      ? `<tr><td colspan="4" style="color:var(--text-muted);text-align:center;">No check-ins recorded yet.</td></tr>`
      : validLogs.map(l => `<tr><td>${l.time}</td><td><strong>${l.studentName}</strong></td><td>${l.subject}</td><td><span class="badge badge-green">🔒 ${l.confidence}</span></td></tr>`).join('');
  }
}

function selectMemberForFaceReg(i) {
  if (state.session?.role === 'student') return;
  state.activeMemberIndex = i;
  window.saveState(state);
  renderAll();
}

function extractFaceDescriptor(videoEl) {
  const canvas = document.getElementById('face-process-canvas');
  const ctx = canvas.getContext('2d');
  const vw = videoEl.videoWidth || 640, vh = videoEl.videoHeight || 480;
  const size = Math.min(vw, vh) * 0.55;
  ctx.drawImage(videoEl, (vw - size) / 2, (vh - size) / 2, size, size, 0, 0, 140, 140);
  const imgData = ctx.getImageData(0, 0, 140, 140).data;
  const desc = [];
  for (let by = 0; by < 14; by++) {
    for (let bx = 0; bx < 14; bx++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let y = by * 10; y < (by + 1) * 10; y += 2) {
        for (let x = bx * 10; x < (bx + 1) * 10; x += 2) {
          const idx = (y * 140 + x) * 4;
          r += imgData[idx]; g += imgData[idx + 1]; b += imgData[idx + 2]; c++;
        }
      }
      desc.push((0.299 * r + 0.587 * g + 0.114 * b) / (c * 255), (r - g) / (c * 255));
    }
  }
  const norm = Math.sqrt(desc.reduce((s, v) => s + v * v, 0)) || 1;
  return { vector: desc.map(v => v / norm), thumbnail: canvas.toDataURL('image/jpeg', 0.85) };
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
    document.getElementById('verify-live-btn').disabled = true;
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

function startContinuousFaceScan() {}
function registerMemberFace() {}
function verifyLiveFaceAttendance() {}

function exportHODReportCSV() {
  const validLogs = getValidSessionLogs();
  const rows = [['Date', 'Time', 'Name', 'ID', 'Subject', 'Status'], ...validLogs.map(l => [l.date, l.time, l.studentName, l.studentId, l.subject, 'LOCKED'])];
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'HOD_Report.csv'; a.click();
}

function renderAcademics() {
  const m = getActiveMember(state);
  if (!m) return;
  let lowSub = '', lowVal = 101;
  const tbody = document.getElementById('academics-table-body');
  if (tbody) tbody.innerHTML = m.subjects.map(s => {
    const tot = s.internal + s.midterm + s.assignments;
    if (tot < lowVal) { lowVal = tot; lowSub = `${s.code} (${s.name})`; }
    return `<tr><td><strong>${s.code}</strong></td><td>${s.name}</td><td>${s.internal}</td><td>${s.midterm}</td><td>${s.assignments}</td><td><strong>${tot}%</strong></td><td><span class="badge badge-purple">${getGradeLetter(tot)}</span></td><td><span class="badge ${tot >= 75 ? 'badge-green' : 'badge-amber'}">${tot === 0 ? 'Pending Marks' : (tot >= 75 ? 'Strong' : 'Needs Focus')}</span></td></tr>`;
  }).join('');
  const ib = document.getElementById('study-insights-box');
  if (ib) ib.innerHTML = `<div class="card-header"><h3>✨ AI Study Insights — ${m.name}</h3><span class="badge badge-cyan">Live Profile</span></div><p style="color:var(--text-muted);">Focus subject: <strong style="color:var(--amber);">${lowSub}</strong>. Practice MCQs or use the AI Learning Bot to prepare.</p>`;
}

function renderSolverList() {
  const filter = document.getElementById('solver-subject-filter')?.value || 'ALL';
  const filtered = state.questions.filter(q => filter === 'ALL' || q.subject === filter);
  const locked = filtered.filter(q => q.attempted || q.solved).length;
  if (document.getElementById('solver-progress-badge')) document.getElementById('solver-progress-badge').textContent = `${locked} / ${filtered.length} Locked`;
  const ql = document.getElementById('question-list');
  if (ql) ql.innerHTML = filtered.map(q => {
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
  const m = getActiveMember(state);
  if (!q || !m || q.attempted || q.solved) return;
  q.attempted = true; q.selectedIdx = idx;
  if (idx === q.answerIndex) { q.solved = true; m.xp += q.xp; }
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
  if (!m) return;
  if (document.getElementById('rewards-xp-balance')) document.getElementById('rewards-xp-balance').textContent = `${m.xp.toLocaleString()} XP`;
  if (document.getElementById('rewards-streak')) document.getElementById('rewards-streak').textContent = `${m.streak} Days`;
  const rg = document.getElementById('rewards-grid');
  if (rg) rg.innerHTML = state.rewards.map(r => `<div class="reward-card ${r.claimed ? 'unlocked' : ''}"><div><div style="font-size:1.8rem;">${r.icon}</div><strong>${r.title}</strong><p style="color:var(--text-muted);font-size:0.85rem;">${r.desc}</p></div><div style="display:flex;justify-content:space-between;align-items:center;"><span class="badge badge-cyan">${r.cost} XP</span>${r.claimed ? `<span class="badge badge-green">Claimed ✓</span>` : `<button class="btn-primary" onclick="claimReward('${r.id}')">Claim</button>`}</div></div>`).join('');
}

function claimReward(id) {
  const m = getActiveMember(state), r = state.rewards.find(x => x.id === id);
  if (!m || !r || r.claimed || m.xp < r.cost) return;
  m.xp -= r.cost; r.claimed = true; window.saveState(state); renderAll();
}

function logActivity(text, tag) { state.activities.unshift({ text, time: 'Just now', tag }); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); }
