let authCamStream = null;
let signupFaceData = null;
let facultyFaceData = null;
let faceLoginTimer = null;
let editingRollId = null;

const otpSessions = {
  reg: { hash: null, mobile: null, verified: false, timer: null },
  fac: { hash: null, mobile: null, verified: false, timer: null },
  forgot: { hash: null, mobile: null, targetId: null, accountType: 'student', verified: false, timer: null }
};

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
      name: 'Department HOD (Master)', id: 'HOD-ADMIN', designation: 'Head of Department (HOD)',
      department: 'CSE & AIML', email: '', mobile: '', mobileVerified: true, initials: 'HD', status: 'approved',
      passwordHash: masterHodHash, faceRegistered: false, facePhoto: null, faceDescriptor: null
    }];
    changed = true;
  }
  state.coordinators.forEach(c => {
    if (!c.passwordHash) { c.passwordHash = masterHodHash; changed = true; }
  });
  if (changed) window.saveState(state);
}

function togglePasswordField(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btnEl.textContent = input.type === 'password' ? '👁️' : '🙈';
}

function buildOtpBoxes(containerId, flowKey, onAllFilled) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = Array.from({ length: 6 })
    .map((_, idx) => `<input type="text" inputmode="numeric" maxlength="1" class="otp-box" data-flow="${flowKey}" data-idx="${idx}" />`)
    .join('');

  const boxes = Array.from(container.querySelectorAll('.otp-box'));
  boxes.forEach((box, idx) => {
    box.addEventListener('input', e => {
      const val = e.target.value.replace(/\D/g, '');
      e.target.value = val.slice(-1);
      if (e.target.value && idx < 5) boxes[idx + 1].focus();
      const fullCode = boxes.map(b => b.value).join('');
      if (fullCode.length === 6 && typeof onAllFilled === 'function') onAllFilled(fullCode, boxes);
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) boxes[idx - 1].focus();
    });
    box.addEventListener('paste', e => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!pasted) return;
      pasted.split('').forEach((ch, i) => { if (boxes[i]) boxes[i].value = ch; });
      boxes[Math.min(5, pasted.length - 1)]?.focus();
      if (pasted.length === 6 && typeof onAllFilled === 'function') onAllFilled(pasted, boxes);
    });
  });
  boxes[0]?.focus();
}

function getOtpBoxesValue(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  return Array.from(container.querySelectorAll('.otp-box')).map(b => b.value).join('');
}

async function dispatchRealLiveOtp({ flowKey, targetId, mobile, email, purposeLabel, boxesContainerId, timerElId, hintElId, onAutoVerify }) {
  const cleanMobile = mobile.replace(/\D/g, '');
  if (cleanMobile.length !== 10) {
    setAuthAlert('error', 'Enter a valid 10-digit mobile number (+91).');
    return false;
  }

  let otpCode = String(Math.floor(100000 + Math.random() * 900000));
  if (window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    otpCode = String(100000 + (arr[0] % 900000));
  }

  const otpHash = await hashPassword(`${cleanMobile}:${otpCode}`);
  const deliveredChannels = [];

  const phoneTopic = `edupulse-otp-${cleanMobile}`;
  try {
    const pushRes = await fetch(`https://ntfy.sh/${phoneTopic}`, {
      method: 'POST',
      headers: { 'Title': 'EduPulse Live Security OTP', 'Priority': 'urgent', 'Tags': 'lock,key' },
      body: `OTP: ${otpCode} | ${purposeLabel} (Valid 60s — Do not share)`
    });
    if (pushRes.ok) deliveredChannels.push(`Phone Push (${phoneTopic})`);
  } catch {}

  const ejs = state.emailjsConfig || {};
  if (ejs.publicKey && ejs.serviceId && ejs.templateId && email) {
    try {
      const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: ejs.serviceId,
          template_id: ejs.templateId,
          user_id: ejs.publicKey,
          template_params: { to_email: email, to_name: targetId || 'User', otp_code: otpCode, mobile_no: `+91-${cleanMobile}`, purpose: purposeLabel }
        })
      });
      if (emailRes.ok) deliveredChannels.push(`Email (${email})`);
    } catch {}
  }

  try {
    const pyRes = await fetch('/api/send-sms-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roll_id: targetId || 'NEW-USER', mobile_no: cleanMobile, email: email || '', otp_code: otpCode })
    });
    if (pyRes.ok) {
      const d = await pyRes.json();
      if (Array.isArray(d.channels) && d.channels.length) deliveredChannels.push(...d.channels);
    }
  } catch {}

  const sess = otpSessions[flowKey];
  sess.hash = otpHash;
  sess.mobile = cleanMobile;
  sess.verified = false;
  if (sess.timer) clearInterval(sess.timer);

  buildOtpBoxes(boxesContainerId, flowKey, async (enteredCode, boxes) => {
    const enteredHash = await hashPassword(`${cleanMobile}:${enteredCode}`);
    if (sess.hash && enteredHash === sess.hash) {
      sess.verified = true;
      if (sess.timer) clearInterval(sess.timer);
      boxes.forEach(b => b.classList.add('verified-box'));
      if (typeof onAutoVerify === 'function') onAutoVerify();
    } else {
      setAuthAlert('error', 'Invalid 6-digit OTP. Check your real phone notification or email inbox.');
    }
  });

  let secondsLeft = 60;
  const timerEl = document.getElementById(timerElId);
  if (timerEl) timerEl.textContent = '60s';
  sess.timer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(sess.timer);
      sess.hash = null;
      if (timerEl) timerEl.textContent = 'Expired';
    } else if (timerEl) {
      timerEl.textContent = `${secondsLeft}s`;
    }
  }, 1000);

  const hintEl = document.getElementById(hintElId);
  if (hintEl) {
    const via = deliveredChannels.length ? deliveredChannels.join(' + ') : 'Phone Push Channel';
    hintEl.innerHTML = `✅ <strong>Dispatched live</strong> via ${via}.<br/>📱 <strong>Receive on your phone:</strong> Open <em>ntfy</em> or visit <a href="https://ntfy.sh/${phoneTopic}" target="_blank" style="color:var(--cyan);">ntfy.sh/${phoneTopic}</a>.`;
  }

  return true;
}

function switchPortalGate(gate) {
  stopAuthCamera();
  setAuthAlert('', '');
  const sGate = document.getElementById('student-gate-container');
  const fGate = document.getElementById('faculty-gate-container');
  const forgotPanel = document.getElementById('panel-forgot-password');
  const sBtn = document.getElementById('gate-student-btn');
  const fBtn = document.getElementById('gate-faculty-btn');

  if (forgotPanel) forgotPanel.classList.remove('active');

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
    activateAuthSubTab(state.members.length ? 'student-login' : 'student-register', sGate);
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

function extractDescriptorFromImageElement(imgEl) {
  const canvas = document.getElementById('face-process-canvas');
  const ctx = canvas.getContext('2d');
  const iw = imgEl.naturalWidth || 300;
  const ih = imgEl.naturalHeight || 300;
  const size = Math.min(iw, ih);
  ctx.drawImage(imgEl, (iw - size) / 2, (ih - size) / 2, size, size, 0, 0, 140, 140);
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

function openUnifiedForgotPanel(accountType) {
  stopAuthCamera();
  document.getElementById('student-gate-container').style.display = 'none';
  document.getElementById('faculty-gate-container').style.display = 'none';
  document.getElementById('panel-forgot-password').classList.add('active');

  otpSessions.forgot.verified = false;
  otpSessions.forgot.hash = null;
  otpSessions.forgot.accountType = accountType;
  document.getElementById('forgot-account-type').value = accountType;
  updatePipelineStageUI(1);
  document.getElementById('forgot-stage-2').style.display = 'none';
  document.getElementById('forgot-stage-3').style.display = 'none';
  setAuthAlert('', '');
}

async function triggerForgotPasswordOtp() {
  const type = document.getElementById('forgot-account-type').value;
  const targetId = document.getElementById('forgot-roll-id').value.trim().toUpperCase();
  const mobile = document.getElementById('forgot-mobile-input').value.trim().replace(/\D/g, '');

  const list = type === 'faculty' ? state.coordinators : state.members;
  if (!list.length) {
    setAuthAlert('error', 'No accounts registered yet. Please register first.');
    return;
  }
  const account = list.find(x => x.id.toUpperCase() === targetId);
  if (!account) {
    setAuthAlert('error', `${type === 'faculty' ? 'Admin/HOD ID' : 'Student Roll ID'} "${targetId}" not found.`);
    return;
  }
  if (!account.mobile || account.mobile !== mobile) {
    setAuthAlert('error', `Mobile +91-${mobile} does not match the registered number for ${targetId}.`);
    return;
  }

  otpSessions.forgot.targetId = targetId;
  otpSessions.forgot.accountType = type;

  const sent = await dispatchRealLiveOtp({
    flowKey: 'forgot',
    targetId,
    mobile,
    email: account.email || '',
    purposeLabel: `Password Reset for ${account.name} (${targetId})`,
    boxesContainerId: 'forgot-otp-boxes',
    timerElId: 'otp-timer-text',
    hintElId: 'forgot-otp-channel-hint',
    onAutoVerify: () => {
      updatePipelineStageUI(3);
      document.getElementById('forgot-stage-3').style.display = 'block';
      setAuthAlert('success', '✅ Real Phone OTP Verified! Set your new password below.');
    }
  });

  if (sent) {
    updatePipelineStageUI(2);
    document.getElementById('forgot-stage-2').style.display = 'block';
    document.getElementById('forgot-stage-3').style.display = 'none';
    setAuthAlert('', '');
  }
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

  document.getElementById('open-forgot-btn').addEventListener('click', () => openUnifiedForgotPanel('student'));
  document.getElementById('open-fac-forgot-btn').addEventListener('click', () => openUnifiedForgotPanel('faculty'));

  document.getElementById('back-to-login-btn').addEventListener('click', () => {
    const type = document.getElementById('forgot-account-type').value;
    switchPortalGate(type === 'faculty' ? 'faculty' : 'student');
  });

  document.getElementById('send-otp-btn').addEventListener('click', triggerForgotPasswordOtp);
  document.getElementById('resend-otp-btn').addEventListener('click', triggerForgotPasswordOtp);

  document.getElementById('verify-otp-btn').addEventListener('click', async () => {
    const code = getOtpBoxesValue('forgot-otp-boxes');
    const enteredHash = await hashPassword(`${otpSessions.forgot.mobile}:${code}`);
    if (otpSessions.forgot.hash && enteredHash === otpSessions.forgot.hash) {
      otpSessions.forgot.verified = true;
      updatePipelineStageUI(3);
      document.getElementById('forgot-stage-3').style.display = 'block';
      setAuthAlert('success', '✅ Real OTP Verified! Create your new password below.');
    } else {
      setAuthAlert('error', 'Incorrect 6-digit OTP.');
    }
  });

  document.getElementById('forgot-password-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!otpSessions.forgot.verified) { setAuthAlert('error', 'Verify your phone OTP first.'); return; }
    const p1 = document.getElementById('forgot-new-pass').value;
    const p2 = document.getElementById('forgot-confirm-pass').value;
    if (p1.length < 4 || p1 !== p2) { setAuthAlert('error', 'Passwords must match (min 4 characters).'); return; }

    const isFac = otpSessions.forgot.accountType === 'faculty';
    const list = isFac ? state.coordinators : state.members;
    const acc = list.find(x => x.id.toUpperCase() === otpSessions.forgot.targetId);
    if (!acc) return;

    acc.passwordHash = await hashPassword(p1);
    if (isFac && acc.id === 'HOD-ADMIN') state.coordinatorHash = acc.passwordHash;
    logActivity(`Password reset via Live Phone OTP for ${acc.name} (${acc.id})`, 'Security');
    window.saveState(state);

    const savedId = acc.id;
    e.target.reset();
    switchPortalGate(isFac ? 'faculty' : 'student');
    if (isFac) document.getElementById('coord-id').value = savedId;
    else {
      activateAuthSubTab('student-login', document.getElementById('student-gate-container'));
      document.getElementById('login-roll-id').value = savedId;
    }
    setAuthAlert('success', `✅ Password updated on Firebase Live Database for ${acc.name} (${savedId})!`);
  });

  // Student Registration Real Phone OTP Dispatch
  document.getElementById('reg-send-otp-btn').addEventListener('click', async () => {
    const mobile = document.getElementById('reg-mobile').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const rollId = document.getElementById('reg-roll-id').value.trim().toUpperCase() || 'NEW-STUDENT';
    const sent = await dispatchRealLiveOtp({
      flowKey: 'reg',
      targetId: rollId,
      mobile,
      email,
      purposeLabel: `Student Registration (${rollId})`,
      boxesContainerId: 'reg-otp-boxes',
      timerElId: 'reg-otp-timer',
      hintElId: 'reg-otp-channel-hint',
      onAutoVerify: () => {
        const badge = document.getElementById('reg-otp-badge');
        badge.className = 'badge badge-green';
        badge.textContent = '✅ Phone Verified';
        setAuthAlert('success', '✅ Real Mobile Number Verified via Live OTP!');
      }
    });
    if (sent) {
      document.getElementById('reg-otp-section').style.display = 'block';
      setAuthAlert('', '');
    }
  });

  // Admin / HOD Registration Real Phone OTP Dispatch
  document.getElementById('fac-send-otp-btn').addEventListener('click', async () => {
    const mobile = document.getElementById('fac-reg-mobile').value.trim();
    const email = document.getElementById('fac-reg-email').value.trim();
    const facId = document.getElementById('fac-reg-id').value.trim().toUpperCase() || 'NEW-HOD';
    const sent = await dispatchRealLiveOtp({
      flowKey: 'fac',
      targetId: facId,
      mobile,
      email,
      purposeLabel: `Admin / HOD Registration (${facId})`,
      boxesContainerId: 'fac-otp-boxes',
      timerElId: 'fac-otp-timer',
      hintElId: 'fac-otp-channel-hint',
      onAutoVerify: () => {
        const badge = document.getElementById('fac-otp-badge');
        badge.className = 'badge badge-green';
        badge.textContent = '✅ Admin Phone Verified';
        setAuthAlert('success', '✅ Official Admin / HOD Mobile Verified via Live OTP!');
      }
    });
    if (sent) {
      document.getElementById('fac-otp-section').style.display = 'block';
      setAuthAlert('', '');
    }
  });

  // Student Sign In
  document.getElementById('student-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.members.length) {
      setAuthAlert('warning', 'No students are registered yet. Switch to "📝 New Student Register" to create your account.');
      return;
    }
    const rollId = document.getElementById('login-roll-id').value.trim().toUpperCase();
    const pass = document.getElementById('login-password').value;
    const idx = state.members.findIndex(m => m.id.toUpperCase() === rollId);
    if (idx === -1) { setAuthAlert('error', `Roll ID "${rollId}" not found in Firebase Database.`); return; }
    const member = state.members[idx];
    if ((await hashPassword(pass)) !== member.passwordHash) { setAuthAlert('error', 'Incorrect password.'); return; }
    if (member.status === 'pending') { setAuthAlert('warning', `⏳ Account Pending Admin / HOD Approval for ${member.name} (${member.id}).`); return; }
    if (member.status === 'rejected') { setAuthAlert('error', `❌ Registration Rejected for ${member.id}.`); return; }
    stopAuthCamera();
    state.activeMemberIndex = idx;
    state.session = { role: 'student', memberId: member.id };
    window.saveState(state);
    checkSessionAndRender();
  });

  // Student Self-Registration Submit -> Direct Atomic Save to Firebase Realtime Database
  document.getElementById('student-register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const rollId = document.getElementById('reg-roll-id').value.trim().toUpperCase();
    const email = document.getElementById('reg-email').value.trim();
    const mobile = document.getElementById('reg-mobile').value.trim().replace(/\D/g, '');
    const year = document.getElementById('reg-year').value;
    const pass = document.getElementById('reg-password').value;
    const submitBtn = e.target.querySelector('button[type="submit"]');

    if (!otpSessions.reg.verified || otpSessions.reg.mobile !== mobile) {
      setAuthAlert('error', '📲 Please click "Send Live OTP" and enter the 6-digit code sent to your phone.');
      return;
    }
    if (state.members.some(m => m.id.toUpperCase() === rollId)) {
      setAuthAlert('error', `Roll ID ${rollId} is already registered in Firebase Database.`);
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '☁️ Saving Student to Firebase Realtime DB...';
    }

    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const newStudent = {
      name,
      id: rollId,
      email,
      mobile,
      mobileVerified: true,
      year,
      initials,
      passwordHash: await hashPassword(pass),
      status: 'pending',
      registeredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      registeredIso: new Date().toISOString(),
      streak: 1,
      xp: 100,
      faceRegistered: Boolean(signupFaceData),
      facePhoto: signupFaceData ? signupFaceData.thumbnail : null,
      faceDescriptor: signupFaceData ? signupFaceData.vector : null,
      performanceHistory: [0, 0, 0, 0, 0, 0],
      subjects: createBTechSubjects()
    };

    state.members.push(newStudent);
    logActivity(`Live Student Registration: ${name} (${rollId}) — Saved to Firebase & Awaiting HOD Approval`, 'Firebase Reg');
    window.saveState(state);

    let savedToFirebase = false;
    if (typeof window.saveStudentRecordToFirebase === 'function') {
      savedToFirebase = await window.saveStudentRecordToFirebase(newStudent);
    }

    updatePendingBadges();

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Live Registration for HOD Approval ✓';
    }

    e.target.reset();
    signupFaceData = null;
    otpSessions.reg.verified = false;
    document.getElementById('reg-otp-section').style.display = 'none';
    document.getElementById('reg-otp-badge').className = 'badge badge-amber';
    document.getElementById('reg-otp-badge').textContent = 'Unverified';
    document.getElementById('reg-face-preview').style.display = 'none';
    stopAuthCamera();
    activateAuthSubTab('student-login', document.getElementById('student-gate-container'));
    document.getElementById('login-roll-id').value = rollId;

    setAuthAlert(
      'warning',
      savedToFirebase
        ? `🔥 Saved ${name} (${rollId}) directly to Firebase Realtime Database! Waiting for HOD / Coordinator Approval before sign-in.`
        : `✅ Registered ${name} (${rollId})! Connect Firebase URL in HOD Portal to sync across all devices.`
    );
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

  // Admin / HOD Sign In
  document.getElementById('coordinator-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('coord-id').value.trim().toUpperCase();
    const pass = document.getElementById('coord-password').value;
    const enteredHash = await hashPassword(pass);

    const fac = state.coordinators.find(c => c.id.toUpperCase() === id);
    if (!fac) { setAuthAlert('error', `Admin / HOD ID "${id}" not found.`); return; }
    if (enteredHash !== fac.passwordHash && !(id === 'HOD-ADMIN' && enteredHash === state.coordinatorHash)) {
      setAuthAlert('error', 'Incorrect Admin / HOD password.');
      return;
    }
    if (fac.status !== 'approved') {
      setAuthAlert('warning', `⏳ ${fac.name} (${fac.id}) is awaiting Master HOD verification.`);
      return;
    }

    stopAuthCamera();
    state.session = { role: 'coordinator', memberId: fac.id };
    window.saveState(state);
    checkSessionAndRender();
  });

  // Admin / HOD Live Webcam Capture
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
        status.textContent = 'Camera active — align face and snap.';
        status.style.color = 'var(--cyan)';
      } catch { setAuthAlert('error', 'Webcam blocked — use "📁 Upload Live Photo"!'); }
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

  // Admin / HOD Photo Upload
  document.getElementById('fac-photo-upload').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopAuthCamera();
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        facultyFaceData = extractDescriptorFromImageElement(img);
        document.getElementById('fac-reg-preview').src = facultyFaceData.thumbnail;
        document.getElementById('fac-reg-preview').style.display = 'block';
        document.getElementById('fac-photo-status').textContent = `✅ Live Photo Uploaded (${file.name}) & 392-D Encoded!`;
        document.getElementById('fac-photo-status').style.color = 'var(--green)';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Admin / HOD Registration Submit
  document.getElementById('coordinator-register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('fac-reg-name').value.trim();
    const facId = document.getElementById('fac-reg-id').value.trim().toUpperCase();
    const designation = document.getElementById('fac-reg-role').value;
    const department = document.getElementById('fac-reg-dept').value;
    const email = document.getElementById('fac-reg-email').value.trim();
    const mobile = document.getElementById('fac-reg-mobile').value.trim().replace(/\D/g, '');
    const pass = document.getElementById('fac-reg-password').value;
    const deptCode = document.getElementById('fac-reg-code').value.trim().toUpperCase();

    if (!otpSessions.fac.verified || otpSessions.fac.mobile !== mobile) {
      setAuthAlert('error', '📲 Please click "Send Live OTP" and verify your 6-digit phone OTP first.');
      return;
    }
    if (!facultyFaceData) {
      setAuthAlert('error', '🪪 Mandatory Verification: Capture a live webcam picture or upload a photo.');
      return;
    }
    if (state.coordinators.some(c => c.id.toUpperCase() === facId)) {
      setAuthAlert('error', `Admin / Faculty ID "${facId}" is already registered.`);
      return;
    }

    const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const autoApproved = deptCode === 'FAC2026';

    state.coordinators.push({
      name, id: facId, designation, department, email, mobile, mobileVerified: true, initials,
      passwordHash: await hashPassword(pass), status: autoApproved ? 'approved' : 'pending',
      registeredAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      faceRegistered: true, facePhoto: facultyFaceData.thumbnail, faceDescriptor: facultyFaceData.vector
    });

    logActivity(`New ${designation}: ${name} (${facId}) registered with Live OTP & Photo`, 'Admin Reg');
    window.saveState(state);
    updatePendingBadges();

    e.target.reset();
    facultyFaceData = null;
    otpSessions.fac.verified = false;
    document.getElementById('fac-otp-section').style.display = 'none';
    document.getElementById('fac-otp-badge').className = 'badge badge-amber';
    document.getElementById('fac-otp-badge').textContent = 'Unverified';
    document.getElementById('fac-reg-preview').style.display = 'none';

    activateAuthSubTab('coordinator-login', document.getElementById('faculty-gate-container'));
    document.getElementById('coord-id').value = facId;
    setAuthAlert(autoApproved ? 'success' : 'warning', autoApproved
      ? `✅ ${name} (${facId}) verified & saved to Firebase! Sign in now.`
      : `⏳ ${name} (${facId}) registered in Firebase! Sign in as HOD-ADMIN to verify & approve.`);
  });

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
  if (!enrolled.length) { setAuthAlert('warning', 'No Admin/HOD live pictures enrolled yet.'); return; }
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
        if (matched.status !== 'approved') { setAuthAlert('warning', `Face matched (${matched.name}), awaiting Master HOD approval.`); return; }
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
  if (!enrolled.length) { setAuthAlert('warning', 'No Student Face IDs registered yet.'); return; }
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
  ['reg-video', 'fac-reg-video'].forEach(id => { const v = document.getElementById(id); if (v) { v.srcObject = null; v.style.display = 'none'; } });
  ['face-login-box', 'faculty-face-box'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = 'none'; });
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
    if (el) { el.textContent = totalPending; el.style.display = totalPending ? 'inline-block' : 'none'; }
  });

  const countEl = document.getElementById('auth-student-count');
  if (countEl) countEl.textContent = `${state.members.length} Student${state.members.length === 1 ? '' : 's'} in Firebase DB`;
}

function scrollToHodSection(sectionId) {
  setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
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
    document.body.classList.remove('role-student');
    document.body.classList.add('role-hod');
    document.getElementById('sidebar-brand-icon').textContent = '🛡️';
    document.getElementById('sidebar-brand-title').textContent = 'Admin OS';
    document.getElementById('sidebar-brand-sub').textContent = 'HOD & Faculty Governance';
    document.getElementById('sidebar-footer-icon').textContent = '🏛️';
    document.getElementById('sidebar-streak').textContent = 'Admin / HOD Portal';
    document.getElementById('sidebar-xp').textContent = 'Live Governance';

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('nav-coordinator-btn').classList.add('active');
    document.getElementById('view-coordinator').classList.add('active');
    document.getElementById('page-title').textContent = 'Admin, HOD & Coordinator Governance Portal';
    document.getElementById('page-subtitle').textContent = 'Real-Time Approvals, Firebase Live DB & Biometric Audit';
  } else {
    const idx = state.members.findIndex(m => m.id === state.session.memberId);
    if (idx === -1) {
      state.session = null;
      window.saveState(state);
      checkSessionAndRender();
      return;
    }
    state.activeMemberIndex = idx;
    document.body.classList.remove('role-hod');
    document.body.classList.add('role-student');
    document.getElementById('sidebar-brand-icon').textContent = 'EP';
    document.getElementById('sidebar-brand-title').textContent = 'EduPulse';
    document.getElementById('sidebar-brand-sub').textContent = 'Smart Student OS';
    document.getElementById('sidebar-footer-icon').textContent = '🔥';

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector('.student-only[data-view="dashboard"]')?.classList.add('active');
    document.getElementById('view-dashboard').classList.add('active');
    document.getElementById('page-title').textContent = 'Dashboard Overview';
    document.getElementById('page-subtitle').textContent = 'Real-time attendance, biometric ID & study insights';
  }

  renderAll();
}

function renderCoordinatorPortal() {
  updatePendingBadges();
  const pendingStudents = state.members.filter(m => m.status === 'pending');
  const pendingFaculty = (state.coordinators || []).filter(c => c.status === 'pending');
  const approvedStudents = state.members.filter(m => m.status === 'approved');
  const faces = state.members.filter(m => m.faceRegistered).length;

  let deptAttSum = 0;
  let countedAtt = 0;
  const defaulters = [];
  state.members.forEach(m => {
    const totAtt = m.subjects.reduce((s, x) => s + x.attended, 0);
    const totCls = m.subjects.reduce((s, x) => s + x.total, 0);
    if (totCls > 0) {
      const pct = Number(((totAtt / totCls) * 100).toFixed(1));
      deptAttSum += pct;
      countedAtt++;
      if (pct < 75) defaulters.push({ member: m, pct, classesNeeded: Math.max(1, Math.ceil((0.75 * totCls - totAtt) / 0.25)) });
    }
  });

  const deptAvgAtt = countedAtt ? (deptAttSum / countedAtt).toFixed(1) : '0.0';
  if (document.getElementById('coord-kpi-pending')) document.getElementById('coord-kpi-pending').textContent = pendingStudents.length + pendingFaculty.length;
  if (document.getElementById('coord-kpi-approved')) document.getElementById('coord-kpi-approved').textContent = approvedStudents.length;
  if (document.getElementById('coord-kpi-avg-att')) document.getElementById('coord-kpi-avg-att').textContent = `${deptAvgAtt}%`;
  if (document.getElementById('coord-kpi-defaulters')) document.getElementById('coord-kpi-defaulters').textContent = defaulters.length;
  if (document.getElementById('coord-kpi-faces')) document.getElementById('coord-kpi-faces').textContent = `Biometric IDs: ${faces} / ${state.members.length}`;

  const pBody = document.getElementById('pending-approvals-body');
  if (pBody) {
    pBody.innerHTML = !pendingStudents.length
      ? `<tr><td colspan="6" style="color:var(--text-muted);text-align:center;">Waiting for new student registrations... Share your live link so students can register!</td></tr>`
      : pendingStudents.map(m => `
        <tr>
          <td>${m.facePhoto ? `<img src="${m.facePhoto}" class="roster-face-thumb"/>` : `<span class="badge badge-amber">No Photo</span>`}</td>
          <td><strong>${m.name}</strong><div style="font-size:0.72rem;color:var(--text-muted);">${m.registeredAt || 'Live'}</div></td>
          <td><span class="badge badge-cyan">${m.id}</span></td>
          <td style="font-family:'JetBrains Mono',monospace;">+91-${m.mobile} <span class="badge badge-green" style="font-size:0.65rem;">OTP ✓</span><div style="font-size:0.72rem;color:var(--text-muted);">${m.email || ''}</div></td>
          <td>${m.year}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-primary" style="padding:5px 11px;font-size:0.78rem;" onclick="setMemberApproval('${m.id}','approved')">✅ Approve</button>
            <button class="btn-outline" style="padding:5px 10px;font-size:0.78rem;" onclick="startEditMember('${m.id}')">✏️ Edit</button>
            <button class="btn-outline" style="padding:5px 10px;font-size:0.78rem;border-color:var(--red);color:var(--red);" onclick="setMemberApproval('${m.id}','rejected')">Reject</button>
          </td>
        </tr>`).join('');
  }

  const facBadge = document.getElementById('faculty-count-badge');
  if (facBadge) facBadge.textContent = `${(state.coordinators || []).length} Registered Admins/HODs`;

  const facBody = document.getElementById('faculty-registry-body');
  if (facBody) {
    facBody.innerHTML = (state.coordinators || []).map(c => {
      const picCell = c.facePhoto
        ? `<img src="${c.facePhoto}" class="roster-face-thumb" style="width:40px;height:40px;border-color:var(--green);" alt="${c.name}" />`
        : `<div class="avatar" style="width:36px;height:36px;font-size:0.78rem;">${c.initials}</div>`;
      const stBadge = c.status === 'approved' ? `<span class="badge badge-green">Verified ✓</span>` : `<span class="badge badge-amber">Pending Review ⏳</span>`;
      const actionBtn = c.id === 'HOD-ADMIN'
        ? `<span class="badge badge-purple">Master HOD</span>`
        : c.status !== 'approved'
        ? `<button class="btn-primary" style="padding:4px 10px;font-size:0.75rem;" onclick="setFacultyApproval('${c.id}','approved')">✅ Verify & Approve</button>`
        : `<button class="btn-outline" style="padding:4px 10px;font-size:0.75rem;" onclick="setFacultyApproval('${c.id}','pending')">Suspend</button>`;
      return `<tr><td>${picCell}</td><td><strong>${c.name}</strong><div style="font-size:0.72rem;color:var(--text-muted);">${c.registeredAt || ''}</div></td><td><span class="badge badge-amber">${c.id}</span></td><td><strong>${c.designation}</strong><div style="font-size:0.74rem;color:var(--text-muted);">${c.department}</div></td><td style="font-family:'JetBrains Mono',monospace;">${c.mobile ? '+91-' + c.mobile : 'Master'}</td><td>${stBadge}</td><td>${actionBtn}</td></tr>`;
    }).join('');
  }

  const defBody = document.getElementById('hod-defaulters-body');
  if (defBody) {
    defBody.innerHTML = !defaulters.length
      ? `<tr><td colspan="3" style="color:var(--text-muted);text-align:center;">No attendance defaulters currently flagged.</td></tr>`
      : defaulters.map(d => `<tr><td><strong>${d.member.name}</strong><div style="font-size:0.74rem;color:var(--text-muted);">${d.member.id}</div></td><td><span class="badge badge-red">${d.pct}%</span></td><td style="color:var(--amber);font-size:0.82rem;">Needs +${d.classesNeeded} classes</td></tr>`).join('');
  }

  const auditBody = document.getElementById('hod-live-audit-body');
  if (auditBody) {
    auditBody.innerHTML = !state.liveLogs?.length
      ? `<tr><td colspan="4" style="color:var(--text-muted);text-align:center;">No live biometric scans recorded yet.</td></tr>`
      : state.liveLogs.slice(0, 8).map(l => `<tr><td>${l.time}</td><td><strong>${l.studentName}</strong> (${l.studentId})</td><td>${l.subject}</td><td><span class="badge badge-green">${l.confidence}</span></td></tr>`).join('');
  }

  const searchQuery = (document.getElementById('hod-search-input')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('hod-status-filter')?.value || 'ALL';
  const filteredMembers = state.members.filter(m => {
    const matchesStatus = statusFilter === 'ALL' || m.status === statusFilter;
    const matchesSearch = !searchQuery || m.name.toLowerCase().includes(searchQuery) || m.id.toLowerCase().includes(searchQuery) || (m.mobile || '').includes(searchQuery);
    return matchesStatus && matchesSearch;
  });

  const aBody = document.getElementById('all-members-admin-body');
  if (aBody) {
    if (!filteredMembers.length) {
      aBody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);text-align:center;">No students registered yet. Students who sign up live will appear here immediately.</td></tr>`;
    } else {
      aBody.innerHTML = filteredMembers.map(m => {
        const totAtt = m.subjects.reduce((s, x) => s + x.attended, 0);
        const totCls = m.subjects.reduce((s, x) => s + x.total, 0);
        const attPct = totCls ? Math.round((totAtt / totCls) * 100) : 0;
        const avgMarks = m.subjects.reduce((s, x) => s + x.internal + x.midterm + x.assignments, 0) / m.subjects.length;
        const cgpa = Math.min(10, avgMarks / 9.5).toFixed(2);

        if (editingRollId === m.id) {
          return `<tr style="background:rgba(34,211,238,0.08);"><td><input type="text" id="edit-id-${m.id}" value="${m.id}" class="select-input" style="width:95px;padding:5px 8px;" /></td><td><input type="text" id="edit-name-${m.id}" value="${m.name}" class="select-input" style="width:145px;padding:5px 8px;" /></td><td><input type="tel" id="edit-mobile-${m.id}" value="${m.mobile || ''}" maxlength="10" class="select-input" style="width:110px;padding:5px 8px;" /></td><td><select id="edit-year-${m.id}" class="select-input" style="padding:5px 8px;"><option value="B.Tech 2nd Year CSE" ${m.year.includes('2nd') ? 'selected' : ''}>2nd Yr CSE</option><option value="B.Tech 3rd Year CSE" ${m.year.includes('3rd') ? 'selected' : ''}>3rd Yr CSE</option></select></td><td><select id="edit-status-${m.id}" class="select-input" style="padding:5px 8px;"><option value="approved" ${m.status === 'approved' ? 'selected' : ''}>Approved</option><option value="pending" ${m.status === 'pending' ? 'selected' : ''}>Pending</option><option value="rejected" ${m.status === 'rejected' ? 'selected' : ''}>Rejected</option></select></td><td><input type="number" id="edit-xp-${m.id}" value="${m.xp}" class="select-input" style="width:75px;padding:5px 8px;" /> XP</td><td style="display:flex;gap:6px;"><button class="btn-primary" style="padding:5px 10px;font-size:0.76rem;" onclick="saveEditedMember('${m.id}')">💾 Save</button><button class="btn-outline" style="padding:5px 9px;font-size:0.76rem;" onclick="cancelEditMember()">Cancel</button></td></tr>`;
        }

        const badgeCls = m.status === 'approved' ? 'badge-green' : m.status === 'pending' ? 'badge-amber' : 'badge-red';
        return `<tr><td><strong>${m.id}</strong></td><td>${m.name}</td><td style="font-family:'JetBrains Mono',monospace;">+91-${m.mobile || 'N/A'}<div style="font-size:0.72rem;color:var(--text-muted);">${m.email || ''}</div></td><td>${m.year}</td><td><span class="badge ${badgeCls}">${m.status.toUpperCase()}</span></td><td><strong>${attPct}%</strong> • ${cgpa} CGPA</td><td style="display:flex;gap:5px;flex-wrap:wrap;"><button class="btn-outline" style="padding:4px 8px;font-size:0.74rem;" onclick="startEditMember('${m.id}')">✏️ Edit</button>${m.status !== 'approved' ? `<button class="btn-primary" style="padding:4px 8px;font-size:0.74rem;" onclick="setMemberApproval('${m.id}','approved')">Approve</button>` : `<button class="btn-outline" style="padding:4px 8px;font-size:0.74rem;" onclick="setMemberApproval('${m.id}','pending')">Hold</button>`}<button class="btn-outline" style="padding:4px 7px;font-size:0.74rem;border-color:var(--red);color:var(--red);" onclick="deleteMemberRecord('${m.id}')">🗑️</button></td></tr>`;
      }).join('');
    }
  }
}

function setFacultyApproval(facId, status) {
  const c = (state.coordinators || []).find(x => x.id === facId);
  if (!c) return;
  c.status = status;
  window.saveState(state);
  renderAll();
  showToast(`✅ ${c.name} (${c.id}) set to ${status.toUpperCase()}!`);
}

function approveAllPending() {
  const pS = state.members.filter(m => m.status === 'pending');
  const pF = (state.coordinators || []).filter(c => c.status === 'pending');
  if (!pS.length && !pF.length) { showToast('No pending registrations.'); return; }
  pS.forEach(m => { m.status = 'approved'; });
  pF.forEach(c => { c.status = 'approved'; });
  window.saveState(state);
  renderAll();
  showToast(`✅ Approved all ${pS.length + pF.length} pending accounts on Firebase!`);
}

function startEditMember(rollId) { editingRollId = rollId; renderCoordinatorPortal(); }
function cancelEditMember() { editingRollId = null; renderCoordinatorPortal(); }

function saveEditedMember(oldRollId) {
  const m = state.members.find(x => x.id === oldRollId);
  if (!m) return;
  m.id = document.getElementById(`edit-id-${oldRollId}`).value.trim().toUpperCase();
  m.name = document.getElementById(`edit-name-${oldRollId}`).value.trim();
  m.mobile = document.getElementById(`edit-mobile-${oldRollId}`).value.trim().replace(/\D/g, '');
  m.year = document.getElementById(`edit-year-${oldRollId}`).value;
  m.status = document.getElementById(`edit-status-${oldRollId}`).value;
  m.xp = Number(document.getElementById(`edit-xp-${oldRollId}`).value) || 0;
  m.initials = m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  editingRollId = null;
  window.saveState(state);
  if (typeof window.saveStudentRecordToFirebase === 'function') window.saveStudentRecordToFirebase(m);
  renderAll();
  showToast(`💾 Updated ${m.name} on Firebase Live Database!`);
}

function deleteMemberRecord(rollId) {
  const idx = state.members.findIndex(x => x.id === rollId);
  if (idx === -1) return;
  const removed = state.members[idx];
  state.members.splice(idx, 1);
  if (state.activeMemberIndex >= state.members.length) state.activeMemberIndex = 0;
  window.saveState(state);
  if (typeof window.deleteStudentRecordFromFirebase === 'function') window.deleteStudentRecordFromFirebase(rollId);
  renderAll();
  showToast(`🗑️ Removed ${removed.name} from Firebase Live Database.`);
}

function setMemberApproval(rollId, status) {
  const m = state.members.find(x => x.id === rollId);
  if (!m) return;
  m.status = status;
  window.saveState(state);
  if (typeof window.saveStudentRecordToFirebase === 'function') window.saveStudentRecordToFirebase(m);
  renderAll();
  showToast(`✅ ${m.name} (${m.id}) set to ${status.toUpperCase()} on Firebase!`);
}
