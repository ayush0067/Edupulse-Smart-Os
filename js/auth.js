let authCamStream = null;
let signupFaceData = null;
let faceLoginTimer = null;
let activeRecoveryOTP = null;
let activeRecoveryRollId = null;
let otpVerifiedStage = false;
let otpCountdownInterval = null;
let editingRollId = null;

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
  state.members.forEach((m, i) => {
    if (!m.passwordHash) { m.passwordHash = defHash; changed = true; }
    if (!m.mobile) { m.mobile = `98765010${String(10 + i).slice(-2)}`; changed = true; }
  });
  if (changed) window.saveState(state);
}

function togglePasswordField(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btnEl.textContent = input.type === 'password' ? '👁️' : '🙈';
}

function updatePipelineStageUI(activeStage) {
  const s1 = document.getElementById('pipe-step-1');
  const s2 = document.getElementById('pipe-step-2');
  const s3 = document.getElementById('pipe-step-3');
  if (!s1 || !s2 || !s3) return;

  [s1, s2, s3].forEach((el, idx) => {
    const stepNum = idx + 1;
    if (stepNum < activeStage) {
      el.className = 'badge badge-green';
      el.style.background = '';
      el.style.color = '';
    } else if (stepNum === activeStage) {
      el.className = 'badge badge-cyan';
      el.style.background = '';
      el.style.color = '';
    } else {
      el.className = 'badge';
      el.style.background = 'rgba(255,255,255,0.05)';
      el.style.color = 'var(--text-muted)';
    }
  });
}

function resetForgotPipeline() {
  activeRecoveryOTP = null;
  activeRecoveryRollId = null;
  otpVerifiedStage = false;
  if (otpCountdownInterval) clearInterval(otpCountdownInterval);
  updatePipelineStageUI(1);
  if (document.getElementById('otp-display-banner')) document.getElementById('otp-display-banner').style.display = 'none';
  if (document.getElementById('forgot-stage-2')) document.getElementById('forgot-stage-2').style.display = 'none';
  if (document.getElementById('forgot-stage-3')) document.getElementById('forgot-stage-3').style.display = 'none';
}

function autoFillForgotDemo() {
  const roll = document.getElementById('forgot-roll-id').value.trim().toUpperCase() || 'CS-067';
  const m = state.members.find(x => x.id.toUpperCase() === roll) || state.members[0];
  document.getElementById('forgot-roll-id').value = m.id;
  document.getElementById('forgot-mobile-input').value = m.mobile || '9876501067';
}

async function dispatchMobileOTP() {
  const rollId = document.getElementById('forgot-roll-id').value.trim().toUpperCase();
  const mobile = document.getElementById('forgot-mobile-input').value.trim().replace(/\D/g, '');

  if (!rollId || mobile.length !== 10) {
    setAuthAlert('error', 'Enter a valid Roll ID and 10-digit registered Mobile Number.');
    return;
  }

  const member = state.members.find(m => m.id.toUpperCase() === rollId);
  if (!member) {
    setAuthAlert('error', `Roll ID "${rollId}" not found in live database.`);
    return;
  }

  if (member.mobile && member.mobile !== mobile) {
    setAuthAlert('error', `Mobile +91-${mobile} does not match the registered number for ${rollId}.`);
    return;
  }

  // Generate 6-digit OTP via Python backend if online, or Web Crypto locally
  let otpCode = String(Math.floor(100000 + Math.random() * 900000));
  try {
    const res = await fetch('/api/send-sms-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roll_id: rollId, mobile_no: mobile })
    });
    if (res.ok) {
      const data = await res.json();
      otpCode = data.otp;
    }
  } catch {}

  activeRecoveryOTP = otpCode;
  activeRecoveryRollId = rollId;
  otpVerifiedStage = false;

  updatePipelineStageUI(2);
  setAuthAlert('', '');

  const banner = document.getElementById('otp-display-banner');
  banner.style.display = 'block';
  banner.innerHTML = `📲 <strong>SMS Gateway Dispatched</strong> to <strong>+91-XXXXXX${mobile.slice(-4)}</strong> (${member.name})<br/>Verification OTP: <strong style="font-size:1.15rem; letter-spacing:3px; color:#fff;">${otpCode}</strong>`;

  document.getElementById('forgot-stage-2').style.display = 'block';
  document.getElementById('forgot-stage-3').style.display = 'none';
  document.getElementById('forgot-otp-input').value = '';

  // Start 60s countdown
  let secondsLeft = 60;
  const timerEl = document.getElementById('otp-timer-text');
  if (otpCountdownInterval) clearInterval(otpCountdownInterval);
  otpCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(otpCountdownInterval);
      activeRecoveryOTP = null;
      if (timerEl) timerEl.textContent = 'Expired! Click Resend';
    } else if (timerEl) {
      timerEl.textContent = `Valid: ${secondsLeft}s`;
    }
  }, 1000);
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
    resetForgotPipeline();
    const prefill = document.getElementById('login-roll-id').value.trim().toUpperCase();
    if (prefill) {
      document.getElementById('forgot-roll-id').value = prefill;
      const m = state.members.find(x => x.id.toUpperCase() === prefill);
      if (m?.mobile) document.getElementById('forgot-mobile-input').value = m.mobile;
    }
    setAuthAlert('', '');
  });

  document.getElementById('back-to-login-btn').addEventListener('click', () => {
    resetForgotPipeline();
    document.querySelector('.auth-tab-btn[data-auth-tab="student-login"]').click();
  });

  document.getElementById('send-otp-btn').addEventListener('click', dispatchMobileOTP);
  document.getElementById('resend-otp-btn').addEventListener('click', dispatchMobileOTP);

  document.getElementById('verify-otp-btn').addEventListener('click', () => {
    const entered = document.getElementById('forgot-otp-input').value.trim();
    if (!activeRecoveryOTP) {
      setAuthAlert('error', 'OTP expired or not sent. Click Resend.');
      return;
    }
    if (entered !== activeRecoveryOTP) {
      setAuthAlert('error', 'Incorrect 6-digit OTP. Check the SMS Gateway banner.');
      return;
    }
    otpVerifiedStage = true;
    if (otpCountdownInterval) clearInterval(otpCountdownInterval);
    document.getElementById('otp-timer-text').textContent = '✅ Verified';
    updatePipelineStageUI(3);
    document.getElementById('forgot-stage-3').style.display = 'block';
    setAuthAlert('success', '✅ Mobile OTP Verified! Set your new password below.');
  });

  document.getElementById('forgot-password-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!otpVerifiedStage || !activeRecoveryRollId) {
      setAuthAlert('error', 'Complete Stage 2 OTP Verification first.');
      return;
    }
    const p1 = document.getElementById('forgot-new-pass').value;
    const p2 = document.getElementById('forgot-confirm-pass').value;
    if (p1.length < 4 || p1 !== p2) {
      setAuthAlert('error', 'Passwords must match and be at least 4 characters.');
      return;
    }
    const member = state.members.find(m => m.id.toUpperCase() === activeRecoveryRollId);
    if (!member) return;

    member.passwordHash = await hashPassword(p1);
    logActivity(`Password reset via Mobile OTP (+91-${member.mobile}) for ${member.name}`, 'Security');
    window.saveState(state);

    const savedId = member.id;
    e.target.reset();
    resetForgotPipeline();
    document.querySelector('.auth-tab-btn[data-auth-tab="student-login"]').click();
    document.getElementById('login-roll-id').value = savedId;
    setAuthAlert('success', `✅ Password synced to Live Database for ${member.name} (${savedId})! Sign in now.`);
  });

  document.getElementById('student-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rollId = document.getElementById('login-roll-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-password').value;
    const idx = state.members.findIndex(m => m.id.toUpperCase() === rollId);
    if (idx === -1) { setAuthAlert('error', `Roll ID "${rollId}" not found.`); return; }
    const member = state.members[idx];
    if ((await hashPassword(pass)) !== member.passwordHash) {
      setAuthAlert('error', 'Incorrect password. Use "Forgot Password (SMS OTP)?" to reset.');
      return;
    }
    if (member.status === 'pending') {
      setAuthAlert('warning', `⏳ Pending Admin Approval for ${member.name} (${member.id}). Open Admin tab to approve.`);
      return;
    }
    if (member.status === 'rejected') {
      setAuthAlert('error', `❌ Registration Rejected by Admin for ${member.id}.`);
      return;
    }
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
    const mobile = document.getElementById('reg-mobile').value.trim().replace(/\D/g, '');
    const year = document.getElementById('reg-year').value;
    const pass = document.getElementById('reg-password').value;

    if (mobile.length !== 10) { setAuthAlert('error', 'Enter a valid 10-digit mobile number.'); return; }
    if (state.members.some(m => m.id.toUpperCase() === rollId)) { setAuthAlert('error', `Roll ID ${rollId} already exists.`); return; }

    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    state.members.push({
      name, id: rollId, mobile, year, initials, passwordHash: await hashPassword(pass), status: 'pending',
      registeredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      streak: 1, xp: 500, faceRegistered: Boolean(signupFaceData),
      facePhoto: signupFaceData ? signupFaceData.thumbnail : null,
      faceDescriptor: signupFaceData ? signupFaceData.vector : null,
      performanceHistory: [75, 78, 80, 82, 85, 88], subjects: createBTechSubjects()
    });

    logActivity(`New registration: ${name} (${rollId} | +91-${mobile}) — Awaiting Admin Approval`, 'Registration');
    window.saveState(state);
    updatePendingBadges();

    e.target.reset();
    signupFaceData = null;
    stopAuthCamera();
    document.querySelector('.auth-tab-btn[data-auth-tab="student-login"]').click();
    document.getElementById('login-roll-id').value = rollId;
    setAuthAlert('warning', `✅ Registered ${name} (${rollId}) on Live DB! Switch to "🛡️ Admin" tab to approve in real time.`);
  });

  document.getElementById('coordinator-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('coord-id').value.trim().toUpperCase();
    const pass = document.getElementById('coord-password').value;
    if (id !== 'HOD-ADMIN' || (await hashPassword(pass)) !== state.coordinatorHash) {
      setAuthAlert('error', 'Invalid Admin credentials (Use HOD-ADMIN / admin123).');
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
      enrolled.forEach(({ m, idx }) => {
        if (m.faceDescriptor.length === sample.vector.length) {
          const sim = cosineSimilarity(sample.vector, m.faceDescriptor);
          if (sim > bestSim) { bestSim = sim; bestIdx = idx; }
        }
      });
      if (bestSim >= 0.90 && bestIdx !== -1) {
        const matched = state.members[bestIdx];
        stopAuthCamera();
        if (matched.status !== 'approved') { setAuthAlert('warning', `Face matched (${matched.name}), awaiting Admin Approval.`); return; }
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

function updatePendingBadges() {
  const count = state.members.filter(m => m.status === 'pending').length;
  ['coord-pending-badge', 'login-pending-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = count;
      el.style.display = count ? 'inline-block' : 'none';
    }
  });
}

function checkSessionAndRender() {
  updatePendingBadges();
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

// --- REAL-TIME ADMIN APPROVAL & LIVE DATABASE INLINE EDITOR ---
function renderCoordinatorPortal() {
  updatePendingBadges();
  const pending = state.members.filter(m => m.status === 'pending');
  const approved = state.members.filter(m => m.status === 'approved');
  const faces = state.members.filter(m => m.faceRegistered).length;

  if (document.getElementById('coord-kpi-pending')) document.getElementById('coord-kpi-pending').textContent = pending.length;
  if (document.getElementById('coord-kpi-approved')) document.getElementById('coord-kpi-approved').textContent = approved.length;
  if (document.getElementById('coord-kpi-faces')) document.getElementById('coord-kpi-faces').textContent = `${faces} / ${state.members.length}`;

  const pBody = document.getElementById('pending-approvals-body');
  if (pBody) {
    pBody.innerHTML = !pending.length
      ? `<tr><td colspan="6" style="color:var(--text-muted);text-align:center;">🎉 No pending registrations! Queue is clear.</td></tr>`
      : pending.map(m => `
        <tr>
          <td>${m.facePhoto ? `<img src="${m.facePhoto}" class="roster-face-thumb"/>` : `<span class="badge badge-amber">No Photo</span>`}</td>
          <td><strong>${m.name}</strong><div style="font-size:0.72rem;color:var(--text-muted);">${m.registeredAt || 'Live'}</div></td>
          <td><span class="badge badge-cyan">${m.id}</span></td>
          <td style="font-family:'JetBrains Mono',monospace;">+91-${m.mobile || 'N/A'}</td>
          <td>${m.year}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-primary" style="padding:5px 11px;font-size:0.78rem;" onclick="setMemberApproval('${m.id}','approved')">✅ Approve</button>
            <button class="btn-outline" style="padding:5px 10px;font-size:0.78rem;" onclick="startEditMember('${m.id}')">✏️ Edit</button>
            <button class="btn-outline" style="padding:5px 10px;font-size:0.78rem;border-color:var(--red);color:var(--red);" onclick="setMemberApproval('${m.id}','rejected')">Reject</button>
          </td>
        </tr>`).join('');
  }

  const aBody = document.getElementById('all-members-admin-body');
  if (aBody) {
    aBody.innerHTML = state.members.map(m => {
      const totAtt = m.subjects.reduce((s, x) => s + x.attended, 0);
      const totCls = m.subjects.reduce((s, x) => s + x.total, 0);
      const attPct = totCls ? Math.round((totAtt / totCls) * 100) : 0;

      if (editingRollId === m.id) {
        return `
          <tr style="background:rgba(34,211,238,0.08);">
            <td><input type="text" id="edit-id-${m.id}" value="${m.id}" class="select-input" style="width:92px;padding:5px 8px;" /></td>
            <td><input type="text" id="edit-name-${m.id}" value="${m.name}" class="select-input" style="width:155px;padding:5px 8px;" /></td>
            <td><input type="tel" id="edit-mobile-${m.id}" value="${m.mobile || ''}" maxlength="10" class="select-input" style="width:115px;padding:5px 8px;" /></td>
            <td>
              <select id="edit-year-${m.id}" class="select-input" style="padding:5px 8px;">
                <option value="B.Tech 2nd Year CSE" ${m.year.includes('2nd') ? 'selected' : ''}>2nd Yr CSE</option>
                <option value="B.Tech 3rd Year CSE" ${m.year.includes('3rd') ? 'selected' : ''}>3rd Yr CSE</option>
              </select>
            </td>
            <td>
              <select id="edit-status-${m.id}" class="select-input" style="padding:5px 8px;">
                <option value="approved" ${m.status === 'approved' ? 'selected' : ''}>Approved</option>
                <option value="pending" ${m.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="rejected" ${m.status === 'rejected' ? 'selected' : ''}>Rejected</option>
              </select>
            </td>
            <td><input type="number" id="edit-xp-${m.id}" value="${m.xp}" class="select-input" style="width:82px;padding:5px 8px;" /> XP</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn-primary" style="padding:5px 10px;font-size:0.76rem;" onclick="saveEditedMember('${m.id}')">💾 Save</button>
              <button class="btn-outline" style="padding:5px 9px;font-size:0.76rem;" onclick="cancelEditMember()">Cancel</button>
            </td>
          </tr>`;
      }

      const badgeCls = m.status === 'approved' ? 'badge-green' : m.status === 'pending' ? 'badge-amber' : 'badge-red';
      return `
        <tr>
          <td><strong>${m.id}</strong></td>
          <td>${m.name}</td>
          <td style="font-family:'JetBrains Mono',monospace;">+91-${m.mobile || 'N/A'}</td>
          <td>${m.year}</td>
          <td><span class="badge ${badgeCls}">${m.status.toUpperCase()}</span></td>
          <td><strong>${attPct}%</strong> • <span style="color:var(--cyan);">${m.xp} XP</span></td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-outline" style="padding:4px 9px;font-size:0.75rem;" onclick="startEditMember('${m.id}')">✏️ Edit</button>
            ${m.status !== 'approved'
              ? `<button class="btn-primary" style="padding:4px 9px;font-size:0.75rem;" onclick="setMemberApproval('${m.id}','approved')">Approve</button>`
              : `<button class="btn-outline" style="padding:4px 9px;font-size:0.75rem;" onclick="setMemberApproval('${m.id}','pending')">Hold</button>`}
            <button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;" onclick="coordinatorResetPassword('${m.id}')" title="Reset password to pass123">🔑</button>
            <button class="btn-outline" style="padding:4px 8px;font-size:0.75rem;border-color:var(--red);color:var(--red);" onclick="deleteMemberRecord('${m.id}')" title="Delete student">🗑️</button>
          </td>
        </tr>`;
    }).join('');
  }
}

function startEditMember(rollId) {
  editingRollId = rollId;
  renderCoordinatorPortal();
}

function cancelEditMember() {
  editingRollId = null;
  renderCoordinatorPortal();
}

function saveEditedMember(oldRollId) {
  const m = state.members.find(x => x.id === oldRollId);
  if (!m) return;

  const newId = document.getElementById(`edit-id-${oldRollId}`).value.trim().toUpperCase();
  const newName = document.getElementById(`edit-name-${oldRollId}`).value.trim();
  const newMobile = document.getElementById(`edit-mobile-${oldRollId}`).value.trim().replace(/\D/g, '');
  const newYear = document.getElementById(`edit-year-${oldRollId}`).value;
  const newStatus = document.getElementById(`edit-status-${oldRollId}`).value;
  const newXp = Number(document.getElementById(`edit-xp-${oldRollId}`).value) || 0;

  if (!newId || !newName) { showToast('Name and Roll ID are required.'); return; }
  if (newMobile && newMobile.length !== 10) { showToast('Mobile number must be 10 digits.'); return; }

  m.id = newId;
  m.name = newName;
  m.mobile = newMobile;
  m.year = newYear;
  m.status = newStatus;
  m.xp = newXp;
  m.initials = newName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  editingRollId = null;
  logActivity(`Admin edited record: ${m.name} (${m.id} | +91-${m.mobile})`, 'Admin Edit');
  window.saveState(state);
  renderAll();
  if (typeof recordTamperProofEvent === 'function') {
    recordTamperProofEvent(m.id, `ADMIN_LIVE_EDIT:STATUS_${m.status.toUpperCase()}:XP_${m.xp}`);
  }
  showToast(`💾 Saved & synced ${m.name} (${m.id}) to Live Database!`);
}

function deleteMemberRecord(rollId) {
  if (state.members.length <= 1) { showToast('At least one student must remain in the database.'); return; }
  const idx = state.members.findIndex(x => x.id === rollId);
  if (idx === -1) return;
  const removed = state.members[idx];
  state.members.splice(idx, 1);
  if (state.activeMemberIndex >= state.members.length) state.activeMemberIndex = 0;
  logActivity(`Admin deleted record: ${removed.name} (${removed.id})`, 'Admin');
  window.saveState(state);
  renderAll();
  showToast(`🗑️ Removed ${removed.name} from Live Database.`);
}

function setMemberApproval(rollId, status) {
  const m = state.members.find(x => x.id === rollId);
  if (!m) return;
  m.status = status;
  logActivity(`Admin ${status.toUpperCase()} ${m.name} (${m.id})`, 'Admin Approval');
  window.saveState(state);
  renderAll();
  if (typeof recordTamperProofEvent === 'function') {
    recordTamperProofEvent(m.id, `ADMIN_APPROVAL:${status.toUpperCase()}`);
  }
  showToast(`✅ ${m.name} (${m.id}) set to ${status.toUpperCase()} on Live DB!`);
}

async function coordinatorResetPassword(rollId) {
  const m = state.members.find(x => x.id === rollId);
  if (!m) return;
  m.passwordHash = await hashPassword('pass123');
  logActivity(`Admin reset password for ${m.name} (${rollId})`, 'Security');
  window.saveState(state);
  showToast(`🔑 Password for ${m.name} reset to "pass123" on Live DB.`);
}

function fillDemoLogin(id, pass) { document.getElementById('login-roll-id').value = id; document.getElementById('login-password').value = pass; }
function fillCoordinatorDemo() { document.getElementById('coord-id').value = 'HOD-ADMIN'; document.getElementById('coord-password').value = 'admin123'; }
