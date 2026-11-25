let authCamStream = null;
let signupFaceData = null;
let facultyFaceData = null;
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
  const masterHodHash = await hashPassword('admin123');
  if (!state.coordinatorHash) { state.coordinatorHash = masterHodHash; changed = true; }
  if (!Array.isArray(state.coordinators) || !state.coordinators.length) {
    state.coordinators = [{
      name: 'Dr. S. K. Singh', id: 'HOD-ADMIN', designation: 'Head of Department (HOD)',
      department: 'CSE & AIML', mobile: '9876500001', initials: 'SS', status: 'approved',
      passwordHash: masterHodHash, faceRegistered: false, facePhoto: null, faceDescriptor: null
    }];
    changed = true;
  }
  state.coordinators.forEach(c => {
    if (!c.passwordHash) { c.passwordHash = masterHodHash; changed = true; }
  });

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

// Switch top-level portal gate between Student Gate and HOD/Coordinator (Teachers) Gate
function switchPortalGate(gate) {
  stopAuthCamera();
  setAuthAlert('', '');
  const sGate = document.getElementById('student-gate-container');
  const fGate = document.getElementById('faculty-gate-container');
  const sBtn = document.getElementById('gate-student-btn');
  const fBtn = document.getElementById('gate-faculty-btn');

  if (gate === 'faculty') {
    sGate.style.display = 'none';
    fGate.style.display = 'block';
    sBtn.classList.remove('active');
    fBtn.classList.add('active');
    activateAuthSubTab('coordinator-login', fGate);
  } else {
    fGate.style.display = 'none';
    sGate.style.display = 'block';
    fBtn.classList.remove('active');
    sBtn.classList.add('active');
    activateAuthSubTab('student-login', sGate);
  }
}

function activateAuthSubTab(tabName, scopeEl = document) {
  scopeEl.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
  scopeEl.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  const btn = scopeEl.querySelector(`.auth-tab-btn[data-auth-tab="${tabName}"]`);
  const panel = document.getElementById(`panel-${tabName}`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
}

// Extract 392-D Biometric Vector from an Uploaded Image Element (for HOD/Coordinator Live Photo Upload)
function extractDescriptorFromImageElement(imgEl) {
  const canvas = document.getElementById('face-process-canvas');
  const ctx = canvas.getContext('2d');
  const iw = imgEl.naturalWidth || 300;
  const ih = imgEl.naturalHeight || 300;
  const size = Math.min(iw, ih);
  ctx.drawImage(imgEl, (iw - size) / 2, (ih - size) / 2, size, size, 0, 0, 140, 140);
  const imgData = ctx.getImageData(0, 0, 140, 140).data;

  const desc = [];
  const block = 10;
  for (let by = 0; by < 14; by++) {
    for (let bx = 0; bx < 14; bx++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let y = by * block; y < (by + 1) * block; y += 2) {
        for (let x = bx * block; x < (bx + 1) * block; x += 2) {
          const idx = (y * 140 + x) * 4;
          r += imgData[idx]; g += imgData[idx + 1]; b += imgData[idx + 2]; c++;
        }
      }
      desc.push((0.299 * r + 0.587 * g + 0.114 * b) / (c * 255), (r - g) / (c * 255));
    }
  }
  const norm = Math.sqrt(desc.reduce((s, v) => s + v * v, 0)) || 1;
  return {
    vector: desc.map(v => v / norm),
    thumbnail: canvas.toDataURL('image/jpeg', 0.85)
  };
}

function updatePipelineStageUI(activeStage) {
  const s1 = document.getElementById('pipe-step-1');
  const s2 = document.getElementById('pipe-step-2');
  const s3 = document.getElementById('pipe-step-3');
  if (!s1 || !s2 || !s3) return;
  [s1, s2, s3].forEach((el, idx) => {
    const stepNum = idx + 1;
    if (stepNum < activeStage) { el.className = 'badge badge-green'; el.style.background = ''; el.style.color = ''; }
    else if (stepNum === activeStage) { el.className = 'badge badge-cyan'; el.style.background = ''; el.style.color = ''; }
    else { el.className = 'badge'; el.style.background = 'rgba(255,255,255,0.05)'; el.style.color = 'var(--text-muted)'; }
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
  if (!rollId || mobile.length !== 10) { setAuthAlert('error', 'Enter a valid Roll ID and 10-digit registered Mobile Number.'); return; }
  const member = state.members.find(m => m.id.toUpperCase() === rollId);
  if (!member) { setAuthAlert('error', `Roll ID "${rollId}" not found.`); return; }
  if (member.mobile && member.mobile !== mobile) { setAuthAlert('error', `Mobile +91-${mobile} does not match ${rollId}.`); return; }

  let otpCode = String(Math.floor(100000 + Math.random() * 900000));
  try {
    const res = await fetch('/api/send-sms-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roll_id: rollId, mobile_no: mobile })
    });
    if (res.ok) otpCode = (await res.json()).otp;
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

  let secondsLeft = 60;
  const timerEl = document.getElementById('otp-timer-text');
  if (otpCountdownInterval) clearInterval(otpCountdownInterval);
  otpCountdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(otpCountdownInterval);
      activeRecoveryOTP = null;
      if (timerEl) timerEl.textContent = 'Expired! Click Resend';
    } else if (timerEl) timerEl.textContent = `Valid: ${secondsLeft}s`;
  }, 1000);
}

function setupAuthUI() {
  document.querySelectorAll('.auth-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopAuthCamera();
      const parentGate = btn.closest('#student-gate-container, #faculty-gate-container') || document;
      activateAuthSubTab(btn.dataset.authTab, parentGate);
      setAuthAlert('', '');
    });
  });

  // Student Forgot Password Pipeline
  document.getElementById('open-forgot-btn').addEventListener('click', () => {
    stopAuthCamera();
    activateAuthSubTab('forgot-password', document.getElementById('student-gate-container'));
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
    activateAuthSubTab('student-login', document.getElementById('student-gate-container'));
  });

  document.getElementById('send-otp-btn').addEventListener('click', dispatchMobileOTP);
  document.getElementById('resend-otp-btn').addEventListener('click', dispatchMobileOTP);

  document.getElementById('verify-otp-btn').addEventListener('click', () => {
    const entered = document.getElementById('forgot-otp-input').value.trim();
    if (!activeRecoveryOTP) { setAuthAlert('error', 'OTP expired. Click Resend.'); return; }
    if (entered !== activeRecoveryOTP) { setAuthAlert('error', 'Incorrect 6-digit OTP.'); return; }
    otpVerifiedStage = true;
    if (otpCountdownInterval) clearInterval(otpCountdownInterval);
    document.getElementById('otp-timer-text').textContent = '✅ Verified';
    updatePipelineStageUI(3);
    document.getElementById('forgot-stage-3').style.display = 'block';
    setAuthAlert('success', '✅ Mobile OTP Verified! Set your new password below.');
  });

  document.getElementById('forgot-password-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!otpVerifiedStage || !activeRecoveryRollId) { setAuthAlert('error', 'Verify OTP first.'); return; }
    const p1 = document.getElementById('forgot-new-pass').value;
    const p2 = document.getElementById('forgot-confirm-pass').value;
    if (p1.length < 4 || p1 !== p2) { setAuthAlert('error', 'Passwords must match (min 4 chars).'); return; }
    const member = state.members.find(m => m.id.toUpperCase() === activeRecoveryRollId);
    if (!member) return;
    member.passwordHash = await hashPassword(p1);
    logActivity(`Password reset via Mobile OTP for ${member.name}`, 'Security');
    window.saveState(state);
    const savedId = member.id;
    e.target.reset();
    resetForgotPipeline();
    activateAuthSubTab('student-login', document.getElementById('student-gate-container'));
    document.getElementById('login-roll-id').value = savedId;
    setAuthAlert('success', `✅ Password updated on Live DB for ${member.name} (${savedId})!`);
  });

  // Student Sign In
  document.getElementById('student-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rollId = document.getElementById('login-roll-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-password').value;
    const idx = state.members.findIndex(m => m.id.toUpperCase() === rollId);
    if (idx === -1) { setAuthAlert('error', `Roll ID "${rollId}" not found.`); return; }
    const member = state.members[idx];
    if ((await hashPassword(pass)) !== member.passwordHash) { setAuthAlert('error', 'Incorrect password.'); return; }
    if (member.status === 'pending') { setAuthAlert('warning', `⏳ Account Pending HOD/Coordinator Approval for ${member.name} (${member.id}).`); return; }
    if (member.status === 'rejected') { setAuthAlert('error', `❌ Registration Rejected for ${member.id}.`); return; }
    stopAuthCamera();
    state.activeMemberIndex = idx;
    state.session = { role: 'student', memberId: member.id };
    window.saveState(state);
    checkSessionAndRender();
  });

  // Student Self-Registration
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
    logActivity(`New student registration: ${name} (${rollId}) — Pending Approval`, 'Registration');
    window.saveState(state);
    updatePendingBadges();
    e.target.reset();
    signupFaceData = null;
    stopAuthCamera();
    activateAuthSubTab('student-login', document.getElementById('student-gate-container'));
    document.getElementById('login-roll-id').value = rollId;
    setAuthAlert('warning', `✅ Registered ${name} (${rollId})! Switch to "👨‍🏫 HOD / Coordinator" portal to approve.`);
  });

  // Student Face Capture on Register
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

  // ================= HOD / COORDINATOR SIGN IN & LIVE-PICTURE REGISTRATION =================
  document.getElementById('coordinator-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('coord-id').value.trim().toUpperCase();
    const pass = document.getElementById('coord-password').value;
    const enteredHash = await hashPassword(pass);

    const fac = state.coordinators.find(c => c.id.toUpperCase() === id);
    if (!fac) {
      setAuthAlert('error', `Faculty / HOD ID "${id}" not found. Click "📝 Register HOD / Coord" to register.`);
      return;
    }
    if (enteredHash !== fac.passwordHash && !(id === 'HOD-ADMIN' && enteredHash === state.coordinatorHash)) {
      setAuthAlert('error', 'Incorrect HOD / Coordinator password.');
      return;
    }
    if (fac.status !== 'approved') {
      setAuthAlert('warning', `⏳ ${fac.name} (${fac.id}) is awaiting Master HOD verification in the Faculty Registry.`);
      return;
    }

    stopAuthCamera();
    state.session = { role: 'coordinator', memberId: fac.id };
    window.saveState(state);
    checkSessionAndRender();
  });

  // HOD / Coordinator Live Webcam Capture for Registration Verification
  document.getElementById('fac-cam-capture-btn').addEventListener('click', async () => {
    const video = document.getElementById('fac-reg-video');
    const preview = document.getElementById('fac-reg-preview');
    const status = document.getElementById('fac-photo-status');
    const btn = document.getElementById('fac-cam-capture-btn');

    if (!authCamStream) {
      try {
        authCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        video.srcObject = authCamStream;
        video.style.display = 'block';
        btn.textContent = '📸 Snap Live Picture Now';
        status.textContent = 'Camera active — align face and click "📸 Snap Live Picture Now".';
        status.style.color = 'var(--cyan)';
      } catch {
        setAuthAlert('error', 'Webcam blocked — use "📁 Upload Live Photo" right next to it!');
      }
      return;
    }

    if (video.readyState >= 2) {
      facultyFaceData = extractFaceDescriptor(video);
      preview.src = facultyFaceData.thumbnail;
      preview.style.display = 'block';
      stopAuthCamera();
      btn.textContent = '✅ Retake Live Picture';
      status.textContent = '✅ Live Webcam Photo Captured & 392-D Biometric Encoded!';
      status.style.color = 'var(--green)';
    }
  });

  // HOD / Coordinator Live Photo File Upload for Registration Verification
  document.getElementById('fac-photo-upload').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopAuthCamera();
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        facultyFaceData = extractDescriptorFromImageElement(img);
        const preview = document.getElementById('fac-reg-preview');
        const status = document.getElementById('fac-photo-status');
        preview.src = facultyFaceData.thumbnail;
        preview.style.display = 'block';
        status.textContent = `✅ Live Photo Uploaded (${file.name}) & 392-D Biometric Encoded!`;
        status.style.color = 'var(--green)';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Submit New HOD / Coordinator Registration
  document.getElementById('coordinator-register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('fac-reg-name').value.trim();
    const facId = document.getElementById('fac-reg-id').value.trim().toUpperCase();
    const designation = document.getElementById('fac-reg-role').value;
    const department = document.getElementById('fac-reg-dept').value;
    const mobile = document.getElementById('fac-reg-mobile').value.trim().replace(/\D/g, '');
    const pass = document.getElementById('fac-reg-password').value;
    const deptCode = document.getElementById('fac-reg-code').value.trim().toUpperCase();

    if (!facultyFaceData) {
      setAuthAlert('error', '🪪 Mandatory Verification: Capture a live webcam picture or upload a live photo before registering.');
      return;
    }
    if (mobile.length !== 10) {
      setAuthAlert('error', 'Enter a valid 10-digit mobile number.');
      return;
    }
    if (state.coordinators.some(c => c.id.toUpperCase() === facId)) {
      setAuthAlert('error', `Faculty ID "${facId}" is already registered.`);
      return;
    }

    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const autoApproved = deptCode === 'FAC2026';

    state.coordinators.push({
      name,
      id: facId,
      designation,
      department,
      mobile,
      initials,
      passwordHash: await hashPassword(pass),
      status: autoApproved ? 'approved' : 'pending',
      registeredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      faceRegistered: true,
      facePhoto: facultyFaceData.thumbnail,
      faceDescriptor: facultyFaceData.vector
    });

    logActivity(`New ${designation}: ${name} (${facId}) registered with Live Picture`, 'Faculty');
    window.saveState(state);
    updatePendingBadges();

    e.target.reset();
    facultyFaceData = null;
    document.getElementById('fac-reg-preview').style.display = 'none';
    document.getElementById('fac-photo-status').textContent = 'No live verification picture captured yet.';
    document.getElementById('fac-photo-status').style.color = 'var(--text-muted)';

    activateAuthSubTab('coordinator-login', document.getElementById('faculty-gate-container'));
    document.getElementById('coord-id').value = facId;

    if (autoApproved) {
      setAuthAlert('success', `✅ ${name} (${facId}) verified via Dept Key & Live Picture! Sign in now.`);
    } else {
      setAuthAlert('warning', `⏳ ${name} (${facId}) registered with Live Picture! Sign in as Master HOD (HOD-ADMIN) to verify & approve.`);
    }
  });

  // Faculty Face ID Sign-In
  document.getElementById('faculty-face-login-btn').addEventListener('click', startFacultyFaceSignIn);

  document.getElementById('face-login-toggle-btn').addEventListener('click', startFaceSignIn);
  document.getElementById('signout-btn').addEventListener('click', () => {
    stopCamera();
    stopAuthCamera();
    state.session = null;
    window.saveState(state);
    checkSessionAndRender();
  });
}

async function startFacultyFaceSignIn() {
  const box = document.getElementById('faculty-face-box');
  const video = document.getElementById('faculty-face-video');
  const enrolled = state.coordinators.map((c, idx) => ({ c, idx })).filter(x => x.c.faceRegistered && x.c.faceDescriptor);
  if (!enrolled.length) {
    setAuthAlert('warning', 'No HOD/Coordinator live pictures enrolled yet. Register first!');
    return;
  }
  try {
    authCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = authCamStream;
    box.style.display = 'block';
    faceLoginTimer = setInterval(() => {
      if (!authCamStream || video.readyState < 2) return;
      const sample = extractFaceDescriptor(video);
      let bestIdx = -1, bestSim = -1;
      enrolled.forEach(({ c, idx }) => {
        if (c.faceDescriptor.length === sample.vector.length) {
          const sim = cosineSimilarity(sample.vector, c.faceDescriptor);
          if (sim > bestSim) { bestSim = sim; bestIdx = idx; }
        }
      });
      if (bestSim >= 0.89 && bestIdx !== -1) {
        const matched = state.coordinators[bestIdx];
        stopAuthCamera();
        if (matched.status !== 'approved') {
          setAuthAlert('warning', `Face matched (${matched.name}), awaiting Master HOD approval.`);
          return;
        }
        state.session = { role: 'coordinator', memberId: matched.id };
        window.saveState(state);
        checkSessionAndRender();
      }
    }, 500);
  } catch { setAuthAlert('error', 'Camera blocked.'); }
}

async function startFaceSignIn() {
  const box = document.getElementById('face-login-box');
  const video = document.getElementById('face-login-video');
  const enrolled = state.members.map((m, idx) => ({ m, idx })).filter(x => x.m.faceRegistered && x.m.faceDescriptor);
  if (!enrolled.length) { setAuthAlert('warning', 'No Student Face IDs enrolled yet.'); return; }
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
        if (matched.status !== 'approved') { setAuthAlert('warning', `Face matched (${matched.name}), awaiting HOD Approval.`); return; }
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
  ['reg-video', 'fac-reg-video'].forEach(id => {
    const v = document.getElementById(id);
    if (v) { v.srcObject = null; v.style.display = 'none'; }
  });
  ['face-login-box', 'faculty-face-box'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.style.display = 'none';
  });
}

function setAuthAlert(type, msg) {
  const el = document.getElementById('auth-alert-box');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.className = `auth-alert ${type}`;
  el.textContent = msg;
}

function updatePendingBadges() {
  const pendingStudents = state.members.filter(m => m.status === 'pending').length;
  const pendingFaculty = (state.coordinators || []).filter(c => c.status === 'pending').length;
  const totalPending = pendingStudents + pendingFaculty;

  ['coord-pending-badge', 'login-pending-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = totalPending;
      el.style.display = totalPending ? 'inline-block' : 'none';
    }
  });
}

function scrollToHodSection(sectionId) {
  setTimeout(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function checkSessionAndRender() {
  updatePendingBadges();
  const authScreen = document.getElementById('auth-screen');
  const appLayout = document.getElementById('app-layout');

  if (!state.session) {
    authScreen.style.display = 'flex';
    appLayout.style.display = 'none';
    return;
  }

  authScreen.style.display = 'none';
  appLayout.style.display = 'grid';

  if (state.session.role === 'coordinator') {
    // STRICT HOD / COORDINATOR (TEACHERS ONLY) WORKSPACE
    document.body.classList.remove('role-student');
    document.body.classList.add('role-hod');

    document.getElementById('sidebar-brand-icon').textContent = '🛡️';
    document.getElementById('sidebar-brand-title').textContent = 'Faculty OS';
    document.getElementById('sidebar-brand-sub').textContent = 'HOD & Coordinator Portal';
    document.getElementById('sidebar-footer-icon').textContent = '🏛️';
    document.getElementById('sidebar-streak').textContent = 'Teachers / HOD Only';
    document.getElementById('sidebar-xp').textContent = 'Governance Mode';

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('nav-coordinator-btn').classList.add('active');
    document.getElementById('view-coordinator').classList.add('active');
    document.getElementById('page-title').textContent = 'HOD & Coordinator Governance Portal';
    document.getElementById('page-subtitle').textContent = 'Dedicated Teachers & Admin Portal — Approve registrations, verify live photos & audit attendance';
  } else {
    // STRICT STUDENT WORKSPACE
    document.body.classList.remove('role-hod');
    document.body.classList.add('role-student');

    document.getElementById('sidebar-brand-icon').textContent = 'EP';
    document.getElementById('sidebar-brand-title').textContent = 'EduPulse';
    document.getElementById('sidebar-brand-sub').textContent = 'Smart Student OS';
    document.getElementById('sidebar-footer-icon').textContent = '🔥';

    const idx = state.members.findIndex(m => m.id === state.session.memberId);
    if (idx !== -1) state.activeMemberIndex = idx;

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const dashBtn = document.querySelector('.student-only[data-view="dashboard"]');
    if (dashBtn) dashBtn.classList.add('active');
    document.getElementById('view-dashboard').classList.add('active');
    document.getElementById('page-title').textContent = 'Dashboard Overview';
    document.getElementById('page-subtitle').textContent = 'B.Tech 2nd & 3rd Year attendance, biometric ID & study insights';
  }

  renderAll();
}

// --- RENDER DEDICATED HOD / COORDINATOR PORTAL ---
function renderCoordinatorPortal() {
  updatePendingBadges();
  const pendingStudents = state.members.filter(m => m.status === 'pending');
  const pendingFaculty = (state.coordinators || []).filter(c => c.status === 'pending');
  const approvedStudents = state.members.filter(m => m.status === 'approved');
  const faces = state.members.filter(m => m.faceRegistered).length;

  let deptAttSum = 0;
  const defaulters = [];
  state.members.forEach(m => {
    const totAtt = m.subjects.reduce((s, x) => s + x.attended, 0);
    const totCls = m.subjects.reduce((s, x) => s + x.total, 0);
    const pct = totCls ? Number(((totAtt / totCls) * 100).toFixed(1)) : 0;
    deptAttSum += pct;
    if (pct < 75) {
      defaulters.push({ member: m, pct, classesNeeded: Math.max(1, Math.ceil((0.75 * totCls - totAtt) / 0.25)) });
    }
  });

  const deptAvgAtt = state.members.length ? (deptAttSum / state.members.length).toFixed(1) : '0.0';

  if (document.getElementById('coord-kpi-pending')) document.getElementById('coord-kpi-pending').textContent = pendingStudents.length + pendingFaculty.length;
  if (document.getElementById('coord-kpi-approved')) document.getElementById('coord-kpi-approved').textContent = approvedStudents.length;
  if (document.getElementById('coord-kpi-avg-att')) document.getElementById('coord-kpi-avg-att').textContent = `${deptAvgAtt}%`;
  if (document.getElementById('coord-kpi-defaulters')) document.getElementById('coord-kpi-defaulters').textContent = defaulters.length;
  if (document.getElementById('coord-kpi-faces')) document.getElementById('coord-kpi-faces').textContent = `Biometric IDs: ${faces} / ${state.members.length}`;

  // 1. Pending Student Approvals
  const pBody = document.getElementById('pending-approvals-body');
  if (pBody) {
    pBody.innerHTML = !pendingStudents.length
      ? `<tr><td colspan="6" style="color:var(--text-muted);text-align:center;">🎉 All student registrations reviewed! No pending queue.</td></tr>`
      : pendingStudents.map(m => `
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

  // 2. Registered HODs & Coordinators Table (With Live Verification Pictures)
  const facBadge = document.getElementById('faculty-count-badge');
  if (facBadge) facBadge.textContent = `${(state.coordinators || []).length} Registered Faculty`;

  const facBody = document.getElementById('faculty-registry-body');
  if (facBody) {
    facBody.innerHTML = (state.coordinators || []).map(c => {
      const picCell = c.facePhoto
        ? `<img src="${c.facePhoto}" class="roster-face-thumb" style="width:40px;height:40px;border-color:var(--green);" alt="${c.name}" />`
        : `<div class="avatar" style="width:36px;height:36px;font-size:0.78rem;">${c.initials}</div>`;
      const stBadge = c.status === 'approved'
        ? `<span class="badge badge-green">Verified ✓</span>`
        : `<span class="badge badge-amber">Pending Review ⏳</span>`;
      const actionBtn = c.id === 'HOD-ADMIN'
        ? `<span class="badge badge-purple">Master HOD</span>`
        : c.status !== 'approved'
        ? `<button class="btn-primary" style="padding:4px 10px;font-size:0.75rem;" onclick="setFacultyApproval('${c.id}','approved')">✅ Verify & Approve</button>`
        : `<button class="btn-outline" style="padding:4px 10px;font-size:0.75rem;" onclick="setFacultyApproval('${c.id}','pending')">Suspend</button>`;

      return `
        <tr>
          <td>${picCell}</td>
          <td><strong>${c.name}</strong><div style="font-size:0.72rem;color:var(--text-muted);">${c.registeredAt || 'Verified'}</div></td>
          <td><span class="badge badge-amber">${c.id}</span></td>
          <td><strong>${c.designation}</strong><div style="font-size:0.74rem;color:var(--text-muted);">${c.department}</div></td>
          <td style="font-family:'JetBrains Mono',monospace;">+91-${c.mobile || 'N/A'}</td>
          <td>${stBadge}</td>
          <td>${actionBtn}</td>
        </tr>`;
    }).join('');
  }

  // 3. Defaulters Watchlist (<75%)
  const defBody = document.getElementById('hod-defaulters-body');
  if (defBody) {
    defBody.innerHTML = !defaulters.length
      ? `<tr><td colspan="3" style="color:var(--green);text-align:center;">✅ Zero defaulters! Every student is above 75%.</td></tr>`
      : defaulters.map(d => `
        <tr>
          <td><strong>${d.member.name}</strong><div style="font-size:0.74rem;color:var(--text-muted);">${d.member.id} • +91-${d.member.mobile || 'N/A'}</div></td>
          <td><span class="badge badge-red">${d.pct}%</span></td>
          <td style="color:var(--amber);font-size:0.82rem;">Needs +${d.classesNeeded} classes</td>
        </tr>`).join('');
  }

  // 4. Recent Biometric Check-Ins
  const auditBody = document.getElementById('hod-live-audit-body');
  if (auditBody) {
    auditBody.innerHTML = !state.liveLogs?.length
      ? `<tr><td colspan="4" style="color:var(--text-muted);text-align:center;">No live biometric scans recorded yet.</td></tr>`
      : state.liveLogs.slice(0, 8).map(l => `
        <tr>
          <td>${l.time}</td>
          <td><strong>${l.studentName}</strong> (${l.studentId})</td>
          <td>${l.subject}</td>
          <td><span class="badge badge-green">${l.confidence}</span></td>
        </tr>`).join('');
  }

  // 5. Searchable & Editable Complete Batch Student Registry
  const searchQuery = (document.getElementById('hod-search-input')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('hod-status-filter')?.value || 'ALL';
  const filteredMembers = state.members.filter(m => {
    const matchesStatus = statusFilter === 'ALL' || m.status === statusFilter;
    const matchesSearch = !searchQuery || m.name.toLowerCase().includes(searchQuery) || m.id.toLowerCase().includes(searchQuery) || (m.mobile || '').includes(searchQuery);
    return matchesStatus && matchesSearch;
  });

  const aBody = document.getElementById('all-members-admin-body');
  if (aBody) {
    aBody.innerHTML = filteredMembers.map(m => {
      const totAtt = m.subjects.reduce((s, x) => s + x.attended, 0);
      const totCls = m.subjects.reduce((s, x) => s + x.total, 0);
      const attPct = totCls ? Math.round((totAtt / totCls) * 100) : 0;
      const avgMarks = m.subjects.reduce((s, x) => s + x.internal + x.midterm + x.assignments, 0) / m.subjects.length;
      const cgpa = Math.min(10, avgMarks / 9.5).toFixed(2);

      if (editingRollId === m.id) {
        return `
          <tr style="background:rgba(34,211,238,0.08);">
            <td><input type="text" id="edit-id-${m.id}" value="${m.id}" class="select-input" style="width:90px;padding:5px 8px;" /></td>
            <td><input type="text" id="edit-name-${m.id}" value="${m.name}" class="select-input" style="width:150px;padding:5px 8px;" /></td>
            <td><input type="tel" id="edit-mobile-${m.id}" value="${m.mobile || ''}" maxlength="10" class="select-input" style="width:110px;padding:5px 8px;" /></td>
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
            <td><input type="number" id="edit-xp-${m.id}" value="${m.xp}" class="select-input" style="width:78px;padding:5px 8px;" /> XP</td>
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
          <td><strong style="color:${attPct < 75 ? 'var(--red)' : 'var(--green)'};">${attPct}%</strong> • ${cgpa} CGPA</td>
          <td style="display:flex;gap:5px;flex-wrap:wrap;">
            <button class="btn-outline" style="padding:4px 8px;font-size:0.74rem;" onclick="startEditMember('${m.id}')">✏️ Edit</button>
            ${m.status !== 'approved'
              ? `<button class="btn-primary" style="padding:4px 8px;font-size:0.74rem;" onclick="setMemberApproval('${m.id}','approved')">Approve</button>`
              : `<button class="btn-outline" style="padding:4px 8px;font-size:0.74rem;" onclick="setMemberApproval('${m.id}','pending')">Hold</button>`}
            <button class="btn-outline" style="padding:4px 7px;font-size:0.74rem;" onclick="coordinatorResetPassword('${m.id}')" title="Reset password to pass123">🔑</button>
            <button class="btn-outline" style="padding:4px 7px;font-size:0.74rem;border-color:var(--red);color:var(--red);" onclick="deleteMemberRecord('${m.id}')" title="Delete student">🗑️</button>
          </td>
        </tr>`;
    }).join('');
  }
}

function setFacultyApproval(facId, status) {
  const c = (state.coordinators || []).find(x => x.id === facId);
  if (!c) return;
  c.status = status;
  logActivity(`Master HOD ${status.toUpperCase()} ${c.designation} ${c.name} (${c.id})`, 'Faculty');
  window.saveState(state);
  renderAll();
  showToast(`✅ ${c.name} (${c.id}) set to ${status.toUpperCase()}!`);
}

function approveAllPending() {
  const pendingS = state.members.filter(m => m.status === 'pending');
  const pendingF = (state.coordinators || []).filter(c => c.status === 'pending');
  if (!pendingS.length && !pendingF.length) {
    showToast('No pending registrations to approve.');
    return;
  }
  pendingS.forEach(m => { m.status = 'approved'; });
  pendingF.forEach(c => { c.status = 'approved'; });
  window.saveState(state);
  renderAll();
  showToast(`✅ Approved all ${pendingS.length + pendingF.length} pending registrations!`);
}

function startEditMember(rollId) { editingRollId = rollId; renderCoordinatorPortal(); }
function cancelEditMember() { editingRollId = null; renderCoordinatorPortal(); }

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
  m.id = newId; m.name = newName; m.mobile = newMobile; m.year = newYear; m.status = newStatus; m.xp = newXp;
  m.initials = newName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  editingRollId = null;
  window.saveState(state);
  renderAll();
  showToast(`💾 Saved & synced ${m.name} (${m.id}) to Live Database!`);
}

function deleteMemberRecord(rollId) {
  if (state.members.length <= 1) { showToast('At least one student must remain.'); return; }
  const idx = state.members.findIndex(x => x.id === rollId);
  if (idx === -1) return;
  const removed = state.members[idx];
  state.members.splice(idx, 1);
  if (state.activeMemberIndex >= state.members.length) state.activeMemberIndex = 0;
  window.saveState(state);
  renderAll();
  showToast(`🗑️ Removed ${removed.name} from Live Database.`);
}

function setMemberApproval(rollId, status) {
  const m = state.members.find(x => x.id === rollId);
  if (!m) return;
  m.status = status;
  window.saveState(state);
  renderAll();
  showToast(`✅ ${m.name} (${m.id}) set to ${status.toUpperCase()}!`);
}

async function coordinatorResetPassword(rollId) {
  const m = state.members.find(x => x.id === rollId);
  if (!m) return;
  m.passwordHash = await hashPassword('pass123');
  window.saveState(state);
  showToast(`🔑 Password for ${m.name} reset to "pass123".`);
}

function fillDemoLogin(id, pass) { document.getElementById('login-roll-id').value = id; document.getElementById('login-password').value = pass; }
function fillCoordinatorDemo() { document.getElementById('coord-id').value = 'HOD-ADMIN'; document.getElementById('coord-password').value = 'admin123'; }
