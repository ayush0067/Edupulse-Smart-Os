const BOT_HISTORY_KEY = 'edupulse_bot_history_v2';
let botMessages = loadBotHistory();

function loadBotHistory() {
  try {
    const saved = localStorage.getItem(BOT_HISTORY_KEY);
    return saved ? JSON.parse(saved) : [{ role: 'bot', text: 'Hello! I am your **EduPulse Live Online AI Study Tutor**. Ask ANY B.Tech question online and earn **+10 XP**!' }];
  } catch { return []; }
}

function saveBotHistory() { localStorage.setItem(BOT_HISTORY_KEY, JSON.stringify(botMessages.slice(-30))); }

function initStudyBot() {
  renderBotMessages();
  document.getElementById('bot-chat-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('bot-user-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendBotMessage(text);
  });
  document.getElementById('bot-clear-btn')?.addEventListener('click', () => {
    localStorage.removeItem(BOT_HISTORY_KEY);
    botMessages = loadBotHistory();
    renderBotMessages();
  });
  document.getElementById('bot-apikey-btn')?.addEventListener('click', () => {
    const current = localStorage.getItem('edupulse_gemini_key') || '';
    const key = prompt('Optional: Paste Google Gemini API Key:', current);
    if (key !== null) localStorage.setItem('edupulse_gemini_key', key.trim());
  });
  document.querySelectorAll('.bot-chip').forEach(chip => chip.addEventListener('click', () => sendBotMessage(chip.dataset.prompt)));
}

function formatBotText(raw) {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bot-inline-code">$1</code>')
    .replace(/\n/g, '<br/>');
}

function renderBotMessages() {
  const container = document.getElementById('bot-messages');
  if (!container) return;
  container.innerHTML = botMessages.map(m => `<div class="chat-bubble ${m.role}"><div class="chat-meta">${m.role === 'user' ? 'You' : '🤖 EduPulse Live AI Tutor'}</div><div class="chat-body">${formatBotText(m.text)}</div></div>`).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendBotMessage(userText) {
  const member = getActiveMember(state);
  botMessages.push({ role: 'user', text: userText });
  botMessages.push({ role: 'bot', text: '🌐 Generating live AI answer...' });
  renderBotMessages();

  let reply = '';
  try {
    reply = await window.fetchLiveOnlineAIReply(userText, member);
  } catch {
    reply = `**Study Note (${member.name}):** Focus on core concepts in **${member.subjects[0].name}** and solve practice MCQs in the Problem Solver tab!`;
  }

  botMessages.pop();
  botMessages.push({ role: 'bot', text: reply });
  saveBotHistory();
  renderBotMessages();

  member.xp += 10;
  logActivity(`${member.name} used Live AI Tutor (+10 XP)`, 'Live AI');
  window.saveState(state);
  renderHeaderAndKPIs();
  renderRecentActivity();
}

window.fetchLiveOnlineAIReply = async function (question, member) {
  const res = await fetch('https://text.pollinations.ai/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: `Assist B.Tech student ${member.name}: ${question}` }], model: 'openai' })
  });
  if (!res.ok) throw new Error('Offline');
  return (await res.text()).trim();
};
