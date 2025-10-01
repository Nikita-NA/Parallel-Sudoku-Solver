async function fetchTests() {
  const sel = document.getElementById('testCase');
  sel.innerHTML = '';
  try {
    const res = await fetch('/api/tests');
    const data = await res.json();
    if (data.ok) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '(none)';
      sel.appendChild(emptyOpt);
      data.files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = `Test_Cases/${f}`;
        opt.textContent = f;
        sel.appendChild(opt);
      });
    } else {
      sel.innerHTML = '<option value="">(error loading)</option>';
    }
  } catch (e) {
    sel.innerHTML = '<option value="">(error loading)</option>';
  }
}

function enableThreadInput() {
  const mode = Number(document.getElementById('mode').value);
  const threads = document.getElementById('threads');
  threads.disabled = !(mode === 2 || mode === 4);
}

document.getElementById('mode').addEventListener('change', enableThreadInput);
document.getElementById('reloadTests').addEventListener('click', fetchTests);

enableThreadInput();
fetchTests();

function setSummary({ok, solved, timeSeconds, code, note}) {
  const el = document.getElementById('summary');
  el.innerHTML = '';
  const items = [];
  const shownCode = (code === undefined || code === null) ? (ok ? 0 : '—') : code;
  items.push(`<div><strong>Status:</strong> ${ok ? 'OK' : 'Error'} (code ${shownCode})</div>`);
  if (solved !== undefined) items.push(`<div><strong>Solved:</strong> ${solved ? 'Yes' : 'No'}</div>`);
  if (timeSeconds != null) items.push(`<div><strong>Time:</strong> ${timeSeconds.toFixed(4)} s</div>`);
  if (note) items.push(`<div><strong>Note:</strong> ${note.replace(/\n/g, '<br/>')}</div>`);
  el.innerHTML = items.join('');
}

async function runSolver() {
  const logs = document.getElementById('logs');
  logs.textContent = 'Running...';

  const fileInput = document.getElementById('file');
  const testCase = document.getElementById('testCase').value;
  const inlineText = document.getElementById('inlineText').value;
  const mode = document.getElementById('mode').value;
  const threads = document.getElementById('threads').value;
  const timeout = document.getElementById('timeout').value;
  const writeToFile = document.getElementById('writeToFile').checked;

  const form = new FormData();
  form.append('mode', mode);
  form.append('writeToFile', writeToFile ? '1' : '0');
  if (mode === '2' || mode === '4') form.append('numThreads', threads);
  if (timeout) form.append('timeoutSeconds', timeout);

  if (fileInput.files && fileInput.files[0]) {
    form.append('file', fileInput.files[0]);
  } else if (inlineText && inlineText.trim().length) {
    form.append('inlineText', inlineText);
  } else if (testCase) {
    form.append('testCasePath', testCase);
  }

  try {
    const res = await fetch('/api/solve', { method: 'POST', body: form });
    let data;
    try { data = await res.json(); } catch { data = null; }

    if (!res.ok) {
      const msg = data && (data.error || data.note) ? `${data.error || ''}${data.note ? '\n' + data.note : ''}` : `HTTP ${res.status}`;
      setSummary({ ok: false, code: res.status });
      logs.textContent = msg;
      return;
    }

    setSummary(data);
    const extra = data && data.note ? `\n[note]\n${data.note}` : '';
    logs.textContent = (data && data.stdout ? data.stdout : '')
      + (data && data.stderr ? `\n[stderr]\n${data.stderr}` : '')
      + extra;
  } catch (e) {
    setSummary({ ok: false, code: -1 });
    logs.textContent = String(e);
  }
}

document.getElementById('run').addEventListener('click', runSolver);
