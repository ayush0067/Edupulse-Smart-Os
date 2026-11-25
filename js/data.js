const STORAGE_KEY = 'edupulse_live_prod_v1';

function createBTechSubjects() {
  return [
    { code: 'BCS-301', name: 'Data Structures & Algo', yearTag: '2nd Yr • Sem 3', attended: 0, total: 0, internal: 0, midterm: 0, assignments: 0, todayStatus: null, todayTime: null },
    { code: 'BCS-302', name: 'Computer Org. & Arch.', yearTag: '2nd Yr • Sem 3', attended: 0, total: 0, internal: 0, midterm: 0, assignments: 0, todayStatus: null, todayTime: null },
    { code: 'BCS-303', name: 'Discrete Structures', yearTag: '2nd Yr • Sem 3', attended: 0, total: 0, internal: 0, midterm: 0, assignments: 0, todayStatus: null, todayTime: null },
    { code: 'BAS-303', name: 'Engg. Mathematics-III', yearTag: '2nd Yr • Sem 3', attended: 0, total: 0, internal: 0, midterm: 0, assignments: 0, todayStatus: null, todayTime: null },
    { code: 'BCS-401', name: 'Operating Systems', yearTag: '2nd Yr • Sem 4', attended: 0, total: 0, internal: 0, midterm: 0, assignments: 0, todayStatus: null, todayTime: null },
    { code: 'BCS-403', name: 'Database Mgmt. Systems', yearTag: '2nd Yr • Sem 4', attended: 0, total: 0, internal: 0, midterm: 0, assignments: 0, todayStatus: null, todayTime: null },
    { code: 'BCS-502', name: 'Computer Networks', yearTag: '3rd Yr • Sem 5', attended: 0, total: 0, internal: 0, midterm: 0, assignments: 0, todayStatus: null, todayTime: null }
  ];
}

const DEFAULT_DATA = {
  updatedAt: 0,
  syncRoom: 'edupulse-live-ayush0067',
  firebaseUrl: '',
  emailjsConfig: { publicKey: '', serviceId: '', templateId: '' },
  lastDate: new Date().toDateString(),
  session: null,
  coordinatorHash: null,
  activeMemberIndex: 0,
  coordinators: [
    {
      name: 'Department HOD (Master)',
      id: 'HOD-ADMIN',
      designation: 'Head of Department (HOD)',
      department: 'CSE & AIML',
      email: '',
      mobile: '',
      mobileVerified: true,
      initials: 'HD',
      status: 'approved',
      registeredAt: 'System Master',
      faceRegistered: false,
      facePhoto: null,
      faceDescriptor: null
    }
  ],
  members: [], // 0 STUDENTS REGISTERED — 100% REAL LIVE REGISTRATIONS ONLY
  questions: getInitialBTechQuestions(),
  rewards: [
    { id: 'r1', icon: '🏅', title: '85% Attendance Badge', desc: 'Exclusive Gold Scholar profile badge', cost: 200, claimed: false },
    { id: 'r2', icon: '📘', title: 'B.Tech Quantum Notes Pack', desc: 'Unlock curated unit-wise formula & PYQ sheets', cost: 400, claimed: false },
    { id: 'r3', icon: '☕', title: 'Campus Canteen Voucher', desc: 'Rs. 100 reward coupon for high streaks', cost: 750, claimed: false },
    { id: 'r4', icon: '🚀', title: 'HOD Project Merit Slot', desc: 'Priority showcase & lab mentor review', cost: 1200, claimed: false }
  ],
  liveLogs: [],
  activities: [
    { text: 'Live Production Database Initialized — 0 students registered yet', time: 'Live', tag: 'System' }
  ]
};

function getActiveMember(state) {
  if (!state.members || !state.members.length) return null;
  return state.members[state.activeMemberIndex] || state.members[0];
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(DEFAULT_DATA);
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.coordinators) || !parsed.coordinators.length) {
      parsed.coordinators = structuredClone(DEFAULT_DATA.coordinators);
    }
    if (!Array.isArray(parsed.members)) parsed.members = [];
    if (!parsed.questions || !parsed.questions.length) parsed.questions = getInitialBTechQuestions();
    if (!parsed.emailjsConfig) parsed.emailjsConfig = { publicKey: '', serviceId: '', templateId: '' };

    const today = new Date().toDateString();
    if (parsed.lastDate !== today) {
      parsed.lastDate = today;
      parsed.members.forEach(m => m.subjects.forEach(s => { s.todayStatus = null; s.todayTime = null; }));
      saveState(parsed);
    }
    return parsed;
  } catch { return structuredClone(DEFAULT_DATA); }
}

function saveState(state) {
  state.updatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  return structuredClone(DEFAULT_DATA);
}
