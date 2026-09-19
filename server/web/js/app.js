document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  fetchDashboardData();
  initChat();
  initLogs();

  // Poll status every 8 seconds
  setInterval(fetchDashboardData, 8000);
});

function initTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      btns.forEach((b) => b.classList.remove('active'));
      panes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = `tab-${btn.dataset.tab}`;
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
        if (typeof gsap !== 'undefined') {
          gsap.fromTo(targetPane, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3 });
        }
      }
    });
  });
}

async function fetchDashboardData() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('active-persona-name').textContent = data.active_persona || 'None';
    document.getElementById('dsi-score').textContent = data.dsi_score ? `${(data.dsi_score * 100).toFixed(1)}%` : 'N/A';
    document.getElementById('total-memories').textContent = (data.total_memories || 0).toLocaleString();
    document.getElementById('total-sessions').textContent = (data.total_sessions || 0).toLocaleString();

    document.getElementById('m-l0').textContent = data.l0_count || 0;
    document.getElementById('m-l1').textContent = data.l1_count || 0;
    document.getElementById('m-l2').textContent = data.l2_count || 0;
    document.getElementById('m-l3').textContent = data.l3_count || 0;
  } catch (err) {
    console.error('Status fetch error:', err);
  }

  fetchPersonaData();
  fetchEvaluationData();
  fetchMemoryData();
}

async function fetchPersonaData() {
  try {
    const res = await fetch('/api/persona');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.active) return;

    document.getElementById('active-persona-id').textContent = `ID: ${data.id}`;
    document.getElementById('chat-persona-title').textContent = `Conversation with ${data.persona.name}`;

    // Linguistic fingerprint
    const fp = data.persona.linguistic_fingerprint || {};
    const msgMetrics = fp.message_metrics || {};
    const punct = fp.punctuation || {};

    document.getElementById('fp-median-len').textContent = `${msgMetrics.median || '--'} chars`;
    document.getElementById('fp-p90-len').textContent = `${msgMetrics.p90 || '--'} chars`;
    document.getElementById('fp-ellipsis').textContent = `${Math.round((punct.ellipsis_rate || 0) * 100)}%`;
    document.getElementById('fp-question').textContent = `${Math.round((punct.question_rate || 0) * 100)}%`;

    const catchphrases = fp.vocabulary?.catchphrases || [];
    const container = document.getElementById('fp-catchphrases');
    container.innerHTML = catchphrases
      .map((cp) => `<span class="tag-badge">${escapeHtml(cp)}</span>`)
      .join('');
  } catch (err) {
    console.error('Persona fetch error:', err);
  }
}

async function fetchEvaluationData() {
  try {
    const res = await fetch('/api/evaluation');
    if (!res.ok) return;
    const report = await res.json();

    const metrics = report.metrics || {};
    setBar('lexical', metrics.lexical);
    setBar('style', metrics.style);
    setBar('behavior', metrics.behavior);
    setBar('context', metrics.context);
    setBar('judge', metrics.blind_judge);

    document.getElementById('dsi-status').textContent = `Quality Gate: ${report.status || 'PASS'}`;

    // Failures
    const failures = report.failure_cases || [];
    const container = document.getElementById('failures-container');
    if (failures.length === 0) {
      container.innerHTML = '<p class="section-desc" style="color: var(--success);">✔ Zero style divergence detected. All quality gates satisfied.</p>';
    } else {
      container.innerHTML = failures.slice(0, 5).map((f, i) => `
        <div class="failure-box">
          <div class="failure-head">
            <span style="color: var(--accent);">Sample #${i + 1} (${f.sample_id})</span>
            <span style="color: ${f.score >= 0.75 ? 'var(--warn)' : 'var(--danger)'};">${(f.score * 100).toFixed(1)}%</span>
          </div>
          <div class="compare-grid">
            <div>
              <label style="font-size: 11px; color: var(--text-dim);">Historical Target</label>
              <div class="bubble target">${escapeHtml(f.original_target)}</div>
            </div>
            <div>
              <label style="font-size: 11px; color: var(--text-dim);">Generated Candidate</label>
              <div class="bubble candidate">${escapeHtml(f.generated_candidate)}</div>
            </div>
          </div>
          <p style="font-size: 12px; color: var(--danger); margin-top: 8px;">Divergence: ${escapeHtml(f.issues.join(', '))}</p>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Evaluation fetch error:', err);
  }
}

function setBar(id, val) {
  const pct = Math.round((val || 0) * 100);
  const textEl = document.getElementById(`dim-${id}`);
  const fillEl = document.getElementById(`fill-${id}`);
  if (textEl) textEl.textContent = `${pct}%`;
  if (fillEl) {
    if (typeof gsap !== 'undefined') {
      gsap.to(fillEl, { width: `${pct}%`, duration: 0.6 });
    } else {
      fillEl.style.width = `${pct}%`;
    }
  }
}

async function fetchMemoryData(layer = '') {
  try {
    const url = layer ? `/api/memory?layer=${layer}` : '/api/memory';
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    const tbody = document.getElementById('memory-tbody');
    const items = data.memories || [];
    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-hint">No memory items found in selected layer.</td></tr>';
      return;
    }

    tbody.innerHTML = items.slice(-50).reverse().map((m) => `
      <tr>
        <td><strong style="color: var(--accent);">${escapeHtml(m.layer)}</strong></td>
        <td>${escapeHtml(m.category || m.key)}</td>
        <td>${escapeHtml(m.value)}</td>
        <td>${(m.importance_score * 100).toFixed(0)}%</td>
        <td>${escapeHtml(m.valid_from ? m.valid_from.slice(0, 10) : 'Permanent')}</td>
        <td>${escapeHtml(m.created_at ? m.created_at.slice(0, 19).replace('T', ' ') : '')}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Memory fetch error:', err);
  }
}

// Memory filter pills
document.querySelectorAll('.filter-pills .pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pills .pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    fetchMemoryData(pill.dataset.layer);
  });
});

function initChat() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const stream = document.getElementById('chat-stream');
  const typingBar = document.getElementById('typing-indicator');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    // Append user message
    appendBubble('user', text);
    input.value = '';
    stream.scrollTop = stream.scrollHeight;

    // Show simulated typing indicator
    typingBar.style.display = 'flex';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      typingBar.style.display = 'none';

      if (!res.ok) {
        appendBubble('system', 'Error processing message');
        return;
      }

      const data = await res.json();

      // Zero-streaming policy: simulate typing duration before rendering
      const sched = data.schedule || {};
      if (sched.should_double_message && sched.double_message_part1) {
        appendBubble('bot', sched.double_message_part1);
        setTimeout(() => {
          appendBubble('bot', sched.double_message_part2);
          stream.scrollTop = stream.scrollHeight;
        }, 1200);
      } else {
        appendBubble('bot', data.final_message);
      }
      stream.scrollTop = stream.scrollHeight;
    } catch (err) {
      typingBar.style.display = 'none';
      appendBubble('system', `Network Error: ${err.message}`);
    }
  });

  function appendBubble(sender, content) {
    const div = document.createElement('div');
    div.className = `msg-bubble ${sender}`;
    div.textContent = content;
    stream.appendChild(div);
  }
}

function initLogs() {
  const btn = document.getElementById('refresh-logs-btn');
  const logView = document.getElementById('log-view');

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      if (!res.ok) return;
      const data = await res.json();
      const logs = data.logs || [];
      logView.textContent = logs.map((l) => `[${l.timestamp}] [${l.level}] [${l.subsystem}]: ${l.message}`).join('\n') || 'No logs recorded.';
      logView.scrollTop = logView.scrollHeight;
    } catch (_) {}
  };

  btn.addEventListener('click', fetchLogs);
  fetchLogs();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
