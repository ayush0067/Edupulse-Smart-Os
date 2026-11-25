let perfChartInstance = null;
let attChartInstance = null;
let gradeChartInstance = null;

function getGradeLetter(totalScore) {
  if (totalScore >= 90) return 'A+';
  if (totalScore >= 80) return 'A';
  if (totalScore >= 70) return 'B';
  if (totalScore >= 60) return 'C';
  return 'D';
}

function renderAllCharts(state) {
  if (typeof Chart === 'undefined') return;
  renderPerformanceChart(state);
  renderAttendanceBarChart(state);
  renderGradePieChart(state);
}

function renderPerformanceChart(state) {
  const el = document.getElementById('performanceChart');
  if (!el) return;
  const ctx = el.getContext('2d');
  if (perfChartInstance) perfChartInstance.destroy();
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(34, 211, 238, 0.35)');
  gradient.addColorStop(1, 'rgba(168, 85, 247, 0.02)');

  perfChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: state.performanceHistory.labels,
      datasets: [{ label: 'Academic Score %', data: state.performanceHistory.scores, borderColor: '#22d3ee', backgroundColor: gradient, borderWidth: 3, fill: true, tension: 0.4, pointBackgroundColor: '#a855f7', pointRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }, y: { min: 50, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } } } }
  });
}

function renderAttendanceBarChart(state) {
  const el = document.getElementById('attendanceBarChart');
  if (!el) return;
  const ctx = el.getContext('2d');
  if (attChartInstance) attChartInstance.destroy();
  const labels = state.subjects.map(s => s.code);
  const percentages = state.subjects.map(s => (s.total ? Math.round((s.attended / s.total) * 100) : 0));
  const colors = percentages.map(p => (p >= 75 ? '#22d3ee' : '#f43f5e'));

  attChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Attendance %', data: percentages, backgroundColor: colors, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#94a3b8' } }, y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } } } }
  });
}

function renderGradePieChart(state) {
  const el = document.getElementById('gradePieChart');
  if (!el) return;
  const ctx = el.getContext('2d');
  if (gradeChartInstance) gradeChartInstance.destroy();
  const counts = { 'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0 };
  state.subjects.forEach(s => { counts[getGradeLetter(s.internal + s.midterm + s.assignments)]++; });

  gradeChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['A+ (90+)', 'A (80-89)', 'B (70-79)', 'C (60-69)', 'D (<60)'],
      datasets: [{ data: [counts['A+'], counts['A'], counts['B'], counts['C'], counts['D']], backgroundColor: ['#22d3ee', '#a855f7', '#10b981', '#f59e0b', '#f43f5e'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { color: '#f1f5f9', boxWidth: 12 } } } }
  });
}
