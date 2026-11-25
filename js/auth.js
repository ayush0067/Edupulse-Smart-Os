let authCamStream = null;
let signupFaceData = null;
let faceLoginTimer = null;
let activeRecoveryOTP = null;
let activeRecoveryRollId = null;

async function hashPassword(plainText) {
  if (window.crypto && window.crypto.subtle) {
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(plainText));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return 'h_' + plainText;
}

async function ensureDefaultHashes() {
  let changed = false;
  if (!state.coordinatorHash) { state.coordinatorHash = await hashPassword('admin123'); changed = true; }
  const defHash = await hashPassword('pass123');
  state.members.forEach(m => { if (!m.passwordHash) { m.passwordHash = defHash; changed = true; } });
  if (changed) window.saveState(state);
}

function togglePasswordField(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btnEl.textContent = input.type === 'password' ? '👁️' : '🙈';
}

function setupAuthUI() {
  document.querySelectorAll('.auth-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopAuthCamera();
      document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.authTab}`).classList.add('active');
      setAuthAlert('', '');
    });
  });

  document.getElementById('open-forgot-btn').addEventListener('click', () => {
    stopAuthCamera();
    document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-forgot-password').classList.add('active');
    const prefill = document.getElementById('login-roll-id').value.trim().toUpperCase();
    if (prefill) document.getElementById('forgot-roll-id').value = prefill;
    setAuthAlert('', '');
  });

  document.getElementById('back-to-login-btn').addEventListener('click', () => {
    document.querySelector('.auth-tab-btn[data-auth-tab="student-login"]').click();
  });

  document.getElementById('send-otp-btn').addEventListener('click', () => {
    const rollId = document.getElementById('forgot-roll-id').value.trim().toUpperCase();
    const member = state.members.find(m => m.id.toUpperCase() === rollId);
    if (!member) { setAuthAlert('error', `Roll ID "${rollId}" not found.`); return; }
    activeRecoveryOTP = String(Math.floor(100000 + Math.random() * 900000));
    activeRecoveryRollId = rollId;
    const banner = document.getElementById('otp-display-banner');
    banner.style.display = 'block';
    banner.innerHTML = `📩 Verification OTP for <strong>${member.name} (${rollId})</strong>: <strong>${activeRecoveryOTP}</strong>`;
    document.getElementById('forgot-step-2').style.display = 'block';
    setAuthAlert('', '');
  });

  document.getElementById('forgot-password-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rollId = document.getElementById('forgot-roll-id').value.trim().toUpperCase();
    const otp = document.getElementById('forgot-otp-input').value.trim();
    const p1 = document.getElementById('forgot-new-pass').value;
    const p2 = document.getElementById('forgot-confirm-pass').value;
    if (otp !== activeRecoveryOTP || rollId !== activeRecoveryRollId) { setAuthAlert('error', 'Invalid OTP.'); return; }
    if (p1 !== p2) { setAuthAlert('error', 'Passwords do not match.'); return; }
    const member = state.members.find(m => m.id.toUpperCase() === rollId);
    member.passwordHash = await hashPassword(p1);
    window.saveState(state);
    e.target.reset();
    document.querySelector('.auth-tab-btn[data-auth-tab="student-login"]').click();
    document.getElementById('login-roll-id').value = rollId;
    setAuthAlert('success', `✅ Password updated for ${member.name}! Sign in now.`);
  });

  document.getElementById('student-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rollId = document.getElementById('login-roll-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-password').value;
    const idx = state.members.findIndex(m => m.id.toUpperCase() === rollId);
    if (idx === -1) { setAuthAlert('error', `Roll ID "${rollId}" not found.`); return; }
    const member = state.members[idx];
    if ((await hashPassword(pass)) !== member.passwordHash) { setAuthAlert('error', 'Incorrect password.'); return; }
    if (member.status === 'pending') { setAuthAlert('warning', `⏳ Pending Coordinator Approval for ${member.name} (${member.id}).`); return; }
    if (member.status === 'rejected') { setAuthAlert('error', `❌ Registration Rejected for ${member.id}.`); return; }
    stopAuthCamera();
    state.activeMemberIndex = idx;
    state.session = { role: 'student', memberId: member.id };
    window.saveState(state);
    checkSessionAndRender();
  });

  document.getElementById('student-register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const rollId = document.getElementById('reg-roll-id').value.trim().toUpperCase();
    const year = document.getElementById('reg-year').value;
    const pass = document.getElementById('reg-password').value;
    if (state.members.some(m => m.id.toUpperCase() === rollId)) { setAuthAlert('error', `Roll ID ${rollId} already exists.`); return; }
    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    state.members.push({
      name, id: rollId, year, initials, passwordHash: await hashPassword(pass), status: 'pending',
      registeredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      streak: 1, xp: 500, faceRegistered: Boolean(signupFaceData),
      facePhoto: signupFaceData ? signupFaceData.thumbnail : null,
      faceDescriptor: signupFaceData ? signupFaceData.vector : null,
      performanceHistory: [75, 78, 80, 82, 85, 88], subjects: createBTechSubjects()
    });
    logActivity(`New self-registration: ${name} (${rollId}) — Pending Approval`, 'Registration');
    window.saveState(state);
    e.target.reset();
    signupFaceData = null;
    stopAuthCamera();
    document.querySelector('.auth-tab-btn[data-auth-tab="student-login"]').click();
    document.getElementById('login-roll-id').value = rollId;
    setAuthAlert('warning', `✅ Registered ${name} (${rollId})! Sign in as Coordinator to approve.`);
  });

  document.getElementById('coordinator-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('coord-id').value.trim().toUpperCase();
    const pass = document.getElementById('coord-password').value;
    if (id !== 'HOD-ADMIN' || (await hashPassword(pass)) !== state.coordinatorHash) {
      setAuthAlert('error', 'Invalid Coordinator credentials (Use HOD-ADMIN / admin123).');
      return;
    }
    stopAuthCamera();
    state.session = { role: 'coordinator', memberId: 'HOD-ADMIN' };
    window.saveState(state);
    checkSessionAndRender();
  });

  document.getElementById('reg-capture-face-btn').addEventListener('click', async () => {
    const video = document.getElementById('reg-video');
    const preview = document.getElementById('reg-face-preview');
    const btn = document.getElementById('reg-capture-face-btn');
    if (!authCamStream) {
      try {
        authCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = authCamStream;
        video.style.display = 'block';
        btn.textContent = '📸 Capture Face Snapshot';
      } catch { setAuthAlert('error', 'Allow camera permission in browser.'); }
      return;
    }
    if (video.readyState >= 2) {
      signupFaceData = extractFaceDescriptor(video);
      preview.src = signupFaceData.thumbnail;
      preview.style.display = 'block';
      stopAuthCamera();
      btn.textContent = '✅ Face ID Captured';
    }
  });

  document.getElementById('face-login-toggle-btn').addEventListener('click', startFaceSignIn);
  document.getElementById('signout-btn').addEventListener('click', () => {
    stopCamera();
    stopAuthCamera();
    state.session = null;
    window.saveState(state);
    checkSessionAndRender();
  });
}

async function startFaceSignIn() {
  const box = document.getElementById('face-login-box');
  const video = document.getElementById('face-login-video');
  const enrolled = state.members.map((m, idx) => ({ m, idx })).filter(x => x.m.faceRegistered && x.m.faceDescriptor);
  if (!enrolled.length) { setAuthAlert('warning', 'No Face IDs enrolled yet. Sign in with Roll ID first.'); return; }
  try {
    authCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = authCamStream;
    box.style.display = 'block';
    faceLoginTimer = setInterval(() => {
      if (!authCamStream || video.readyState < 2) return;
      const sample = extractFaceDescriptor(video);
      let bestIdx = -1, bestSim = -1;
      enrolled.forEach(({ m, idx }) => { const sim = cosineSimilarity(sample.vector, m.faceDescriptor); if (sim > bestSim) { bestSim = sim; bestIdx = idx; } });
      if (bestSim >= 0.90 && bestIdx !== -1) {
        const matched = state.members[bestIdx];
        stopAuthCamera();
        if (matched.status !== 'approved') { setAuthAlert('warning', `Face matched (${matched.name}), awaiting Coordinator Approval.`); return; }
        state.activeMemberIndex = bestIdx;
        state.session = { role: 'student', memberId: matched.id };
        window.saveState(state);
        checkSessionAndRender();
      }
    }, 500);
  } catch { setAuthAlert('error', 'Camera blocked.'); }
}

function stopAuthCamera() {
  if (faceLoginTimer) { clearInterval(faceLoginTimer); faceLoginTimer = null; }
  if (authCamStream) { authCamStream.getTracks().forEach(t => t.stop()); authCamStream = null; }
  const v = document.getElementById('reg-video'); if (v) { v.srcObject = null; v.style.display = 'none'; }
  const b = document.getElementById('face-login-box'); if (b) b.style.display = 'none';
}

function setAuthAlert(type, msg) {
  const el = document.getElementById('auth-alert-box');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.className = `auth-alert ${type}`;
  el.textContent = msg;
}

function checkSessionAndRender() {
  const authScreen = document.getElementById('auth-screen');
  const appLayout = document.getElementById('app-layout');
  const coordBtn = document.getElementById('nav-coordinator-btn');
  const switcher = document.getElementById('member-switcher');

  if (!state.session) {
    authScreen.style.display = 'flex';
    appLayout.style.display = 'none';
    return;
  }
  authScreen.style.display = 'none';
  appLayout.style.display = 'grid';

  if (state.session.role === 'coordinator') {
    coordBtn.style.display = 'block';
    switcher.style.display = 'inline-block';
    coordBtn.click();
  } else {
    coordBtn.style.display = 'none';
    switcher.style.display = 'none';
    const idx = state.members.findIndex(m => m.id === state.session.memberId);
    if (idx !== -1) state.activeMemberIndex = idx;
    document.querySelector('.nav-btn[data-view="dashboard"]').click();
  }
  renderAll();
}

function renderCoordinatorPortal() {
  const pending = state.members.filter(m => m.status === 'pending');
  const approved = state.members.filter(m => m.status === 'approved');
  const faces = state.members.filter(m => m.faceRegistered).length;

  const badge = document.getElementById('coord-pending-badge');
  if (badge) { badge.textContent = pending.length; badge.style.display = pending.length ? 'inline-block' : 'none'; }
  if (document.getElementById('coord-kpi-pending')) document.getElementById('coord-kpi-pending').textContent = pending.length;
  if (document.getElementById('coord-kpi-approved')) document.getElementById('coord-kpi-approved').textContent = approved.length;
  if (document.getElementById('coord-kpi-faces')) document.getElementById('coord-kpi-faces').textContent = `${faces} / ${state.members.length}`;

  const pBody = document.getElementById('pending-approvals-body');
  if (pBody) {
    pBody.innerHTML = !pending.length
      ? `<tr><td colspan="5" style="color:var(--text-muted);text-align:center;">🎉 No pending registrations!</td></tr>`
      : pending.map(m => `<tr><td>${m.facePhoto ? `<img src="${m.facePhoto}" class="roster-face-thumb"/>` : `<span class="badge badge-amber">No Photo</span>`}</td><td><strong>${m.name}</strong></td><td><span class="badge badge-cyan">${m.id}</span></td><td>${m.year}</td><td style="display:flex;gap:8px;"><button class="btn-primary" style="padding:5px 10px;" onclick="setMemberApproval('${m.id}','approved')">✅ Approve</button><button class="btn-outline" style="padding:5px 10px;" onclick="setMemberApproval('${m.id}','rejected')">Reject</button></td></tr>`).join('');
  }

  const aBody = document.getElementById('all-members-admin-body');
  if (aBody) {
    aBody.innerHTML = state.members.map(m => `<tr><td><strong>${m.id}</strong></td><td>${m.name}</td><td>${m.year}</td><td><span class="badge ${m.status === 'approved' ? 'badge-green' : 'badge-amber'}">${m.status.toUpperCase()}</span></td><td style="display:flex;gap:6px;"><button class="btn-primary" style="padding:4px 8px;font-size:0.75rem;" onclick="setMemberApproval('${m.id}','approved')">Approve</button><button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick="coordinatorResetPassword('${m.id}')">🔑 Reset Pass</button></td></tr>`).join('');
  }
}

function setMemberApproval(rollId, status) {
  const m = state.members.find(x => x.id === rollId);
  if (!m) return;
  m.status = status;
  logActivity(`Coordinator ${status.toUpperCase()} ${m.name} (${m.id})`, 'Coordinator');
  window.saveState(state);
  renderAll();
  showToast(`Updated ${m.name} (${m.id}) to ${status.toUpperCase()}`);
}

async function coordinatorResetPassword(rollId) {
  const m = state.members.find(x => x.id === rollId);
  if (!m) return;
  m.passwordHash = await hashPassword('pass123');
  window.saveState(state);
  showToast(`🔑 Password for ${m.name} reset to "pass123"`);
}

function fillDemoLogin(id, pass) { document.getElementById('login-roll-id').value = id; document.getElementById('login-password').value = pass; }
function fillCoordinatorDemo() { document.getElementById('coord-id').value = 'HOD-ADMIN'; document.getElementById('coord-password').value = 'admin123'; }
