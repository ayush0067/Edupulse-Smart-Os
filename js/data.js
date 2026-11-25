const STORAGE_KEY = 'edupulse_student_data_v5';

function createBTechSubjects(offsets = [0, 0, 0, 0, 0, 0, 0]) {
  const base = [
    { code: 'BCS-301', name: 'Data Structures & Algo', yearTag: '2nd Yr • Sem 3', attended: 26, total: 30, internal: 28, midterm: 27, assignments: 38 },
    { code: 'BCS-302', name: 'Computer Org. & Arch.', yearTag: '2nd Yr • Sem 3', attended: 22, total: 28, internal: 24, midterm: 22, assignments: 33 },
    { code: 'BCS-303', name: 'Discrete Structures', yearTag: '2nd Yr • Sem 3', attended: 24, total: 26, internal: 27, midterm: 26, assignments: 36 },
    { code: 'BAS-303', name: 'Engg. Mathematics-III', yearTag: '2nd Yr • Sem 3', attended: 21, total: 26, internal: 26, midterm: 25, assignments: 35 },
    { code: 'BCS-401', name: 'Operating Systems', yearTag: '2nd Yr • Sem 4', attended: 17, total: 24, internal: 21, midterm: 20, assignments: 30 },
    { code: 'BCS-403', name: 'Database Mgmt. Systems', yearTag: '2nd Yr • Sem 4', attended: 20, total: 25, internal: 25, midterm: 24, assignments: 34 },
    { code: 'BCS-502', name: 'Computer Networks', yearTag: '3rd Yr • Sem 5', attended: 19, total: 22, internal: 27, midterm: 25, assignments: 36 }
  ];
  return base.map((s, i) => {
    const delta = offsets[i] || 0;
    return {
      ...s,
      attended: Math.max(10, Math.min(s.total, s.attended + delta)),
      internal: Math.max(15, Math.min(30, s.internal + delta)),
      todayStatus: null,
      todayTime: null
    };
  });
}

const DEFAULT_DATA = {
  lastDate: new Date().toDateString(),
  session: null,
  coordinatorHash: null,
  activeMemberIndex: 0,
  members: [
    { name: 'Ayush Kumar Modanwal', id: 'CS-067', year: 'B.Tech 2nd Year CSE', initials: 'AK', status: 'approved', streak: 12, xp: 1450, faceRegistered: false, facePhoto: null, faceDescriptor: null, performanceHistory: [78, 82, 80, 86, 89, 92], subjects: createBTechSubjects([0, 0, 0, 0, 0, 0, 0]) },
    { name: 'Priya Sharma', id: 'CS-052', year: 'B.Tech 2nd Year CSE', initials: 'PS', status: 'approved', streak: 15, xp: 1680, faceRegistered: false, facePhoto: null, faceDescriptor: null, performanceHistory: [84, 86, 88, 90, 91, 94], subjects: createBTechSubjects([2, 3, 1, 2, 4, 2, 1]) },
    { name: 'Rohan Verma', id: 'CS-041', year: 'B.Tech 2nd Year CSE', initials: 'RV', status: 'approved', streak: 6, xp: 980, faceRegistered: false, facePhoto: null, faceDescriptor: null, performanceHistory: [70, 72, 69, 74, 76, 79], subjects: createBTechSubjects([-3, -2, -2, -1, 0, -2, -1]) },
    { name: 'Ananya Singh', id: 'CS-019', year: 'B.Tech 3rd Year CSE', initials: 'AS', status: 'approved', streak: 18, xp: 1920, faceRegistered: false, facePhoto: null, faceDescriptor: null, performanceHistory: [86, 88, 87, 91, 93, 95], subjects: createBTechSubjects([3, 4, 2, 3, 5, 3, 2]) },
    { name: 'Vikramaditya Patel', id: 'CS-084', year: 'B.Tech 3rd Year CSE', initials: 'VP', status: 'approved', streak: 9, xp: 1210, faceRegistered: false, facePhoto: null, faceDescriptor: null, performanceHistory: [74, 77, 75, 80, 82, 84], subjects: createBTechSubjects([-1, 1, 0, -1, 2, 0, 1]) },
    { name: 'Rahul Yadav', id: 'CS-091', year: 'B.Tech 2nd Year CSE', initials: 'RY', status: 'pending', registeredAt: 'Today', streak: 1, xp: 500, faceRegistered: false, facePhoto: null, faceDescriptor: null, performanceHistory: [75, 77, 79, 80, 82, 84], subjects: createBTechSubjects([0, 0, 0, 0, 0, 0, 0]) }
  ],
  questions: getInitialBTechQuestions(),
  rewards: [
    { id: 'r1', icon: '🏅', title: '85% Attendance Badge', desc: 'Exclusive Gold Scholar profile badge', cost: 200, claimed: false },
    { id: 'r2', icon: '📘', title: 'B.Tech Quantum Notes Pack', desc: 'Unlock curated unit-wise formula & PYQ sheets', cost: 400, claimed: false },
    { id: 'r3', icon: '☕', title: 'Campus Canteen Voucher', desc: 'Rs. 100 reward coupon for high streaks', cost: 750, claimed: false },
    { id: 'r4', icon: '🚀', title: 'HOD Project Merit Slot', desc: 'Priority showcase & lab mentor review', cost: 1200, claimed: false }
  ],
  liveLogs: [],
  activities: [
    { text: 'Ayush Kumar Modanwal (CS-067) active on B.Tech CSE Portal', time: 'Today', tag: 'Verified' },
    { text: 'Rahul Yadav (CS-091) submitted self-registration for approval', time: 'Today', tag: 'Pending' }
  ]
};

function getActiveMember(state) { return state.members[state.activeMemberIndex] || state.members[0]; }

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(DEFAULT_DATA);
    const parsed = JSON.parse(saved);
    const today = new Date().toDateString();
    if (parsed.lastDate !== today) {
      parsed.lastDate = today;
      parsed.members.forEach(m => m.subjects.forEach(s => { s.todayStatus = null; s.todayTime = null; }));
      saveState(parsed);
    }
    return parsed;
  } catch { return structuredClone(DEFAULT_DATA); }
}

function saveState(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function resetState() { localStorage.removeItem(STORAGE_KEY); return structuredClone(DEFAULT_DATA); }
