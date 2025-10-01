import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Remove noisy progress lines like "[====> ] 16 %" and CR-based updates
function scrubStdout(s) {
  if (!s) return s;
  // Normalize line endings and remove carriage returns used for in-place updates
  let t = s.replace(/\r/g, '');
  // Remove inline progress blocks even if many are concatenated on one line
  // Example: "[==> ] 5 %[==> ] 6 % ..."
  t = t.replace(/(\s*\[[=>\s-]+\]\s*\d+\s*%)+/g, '');
  // Also drop entire lines that are only a progress block
  const lines = t.split(/\n/);
  const progressLineRe = /^\s*\[[=>\s-]+\]\s*\d+\s*%\s*$/;
  const filtered = lines.filter(line => !progressLineRe.test(line));
  t = filtered.join('\n');
  // Collapse excessive blank lines
  t = t.replace(/\n{3,}/g, '\n\n');
  return t;
}

// Normalize pasted grid text: ensure first line is N and subsequent N rows of N integers (0..N)
function normalizeInlineGrid(raw) {
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
  if (lines.length === 0) throw new Error('Empty pasted grid');

  // Helper to split a line into tokens (space or no-space digits)
  const splitTokens = (line) => {
    // If line contains spaces, split by whitespace; else split into single chars
    if (/\s/.test(line)) {
      return line.trim().split(/\s+/);
    }
    return line.trim().split('');
  };

  let N = null;
  let rowStartIdx = 0;

  // Detect N from the very first line if it's purely numeric (e.g., "25")
  if (/^\d+$/.test(lines[0])) {
    N = parseInt(lines[0], 10);
    rowStartIdx = 1;
  }

  // Build rows from remaining lines
  const rows = lines.slice(rowStartIdx).map(splitTokens);
  if (rows.length === 0) throw new Error('No rows found in pasted grid');

  // If N not specified, infer it
  if (N == null) {
    const width = rows[0].length;
    const height = rows.length;
    if (width !== height) {
      throw new Error(`Grid must be square. Got ${height} rows x ${width} columns`);
    }
    N = width;
  }

  // Validate dimensions and content
  if (rows.length !== N) {
    throw new Error(`Expected ${N} rows, got ${rows.length}`);
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== N) {
      throw new Error(`Row ${i + 1} length ${rows[i].length} != ${N}`);
    }
    for (let j = 0; j < N; j++) {
      const tok = rows[i][j];
      if (!/^\d+$/.test(tok)) throw new Error(`Non-numeric token at row ${i + 1}, col ${j + 1}: "${tok}"`);
      const v = parseInt(tok, 10);
      if (v < 0 || v > N) throw new Error(`Value out of range 0..${N} at row ${i + 1}, col ${j + 1}: ${v}`);
    }
  }

  // Return normalized text with first line N and space-separated rows
  const out = [String(N), ...rows.map(r => r.join(' '))].join('\n');
  return out;
}

// Resolve solver executable path (Windows)
function resolveSolverPath() {
  const root = path.join(__dirname, '..');
  const exePath = path.join(root, 'sudoku_main.exe');
  const binPath = path.join(root, 'sudoku_main');
  if (fs.existsSync(exePath)) return exePath;
  if (fs.existsSync(binPath)) return binPath;
  return null;
}

// List available test cases
app.get('/api/tests', (req, res) => {
  const dir = path.join(__dirname, '..', 'Test_Cases');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));
    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Solve via uploaded file or inline text
app.post('/api/solve', upload.single('file'), async (req, res) => {
  try {
    const solver = resolveSolverPath();
    if (!solver) {
      return res.status(500).json({ ok: false, error: 'sudoku_main executable not found. Build it in the project root with `make`.' });
    }

    const { mode, numThreads, writeToFile, inlineText, timeoutSeconds } = req.body;

    // Determine input file
    let inputPath = null;
    let tempFileToDelete = null;

    if (req.file) {
      inputPath = req.file.path; // uploaded temp file
      // Validate uploaded file format: first line N, then N rows with N integers 0..N
      try {
        const content = fs.readFileSync(inputPath, 'utf8');
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        if (!lines.length) throw new Error('File is empty');
        if (!/^\d+$/.test(lines[0])) throw new Error('First line must be a single integer N');
        const N = parseInt(lines[0], 10);
        const rows = lines.slice(1);
        if (rows.length !== N) throw new Error(`Expected ${N} rows, found ${rows.length}`);
        for (let i = 0; i < rows.length; i++) {
          const toks = rows[i].split(/\s+/).filter(Boolean);
          if (toks.length !== N) throw new Error(`Row ${i + 1} length ${toks.length} != ${N}`);
          for (let j = 0; j < N; j++) {
            const tok = toks[j];
            if (!/^\d+$/.test(tok)) throw new Error(`Non-numeric token at row ${i + 1}, col ${j + 1}: "${tok}"`);
            const v = parseInt(tok, 10);
            if (v < 0 || v > N) throw new Error(`Value out of range 0..${N} at row ${i + 1}, col ${j + 1}: ${v}`);
          }
        }
      } catch (ve) {
        return res.status(400).json({ ok: false, error: 'Invalid uploaded file: ' + (ve.message || String(ve)) });
      }
    } else if (inlineText && inlineText.trim().length) {
      // Write inline text to a temp file
      const tmpDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpPath = path.join(tmpDir, `inline-${Date.now()}.txt`);
      let normalized;
      try {
        normalized = normalizeInlineGrid(inlineText);
      } catch (err) {
        return res.status(400).json({ ok: false, error: 'Invalid pasted grid: ' + String(err.message || err) });
      }
      fs.writeFileSync(tmpPath, normalized, 'utf8');
      inputPath = tmpPath;
      tempFileToDelete = tmpPath;
    } else if (req.body.testCasePath) {
      // Relative path under Test_Cases
      inputPath = path.join(__dirname, '..', req.body.testCasePath);
    }

    if (!inputPath) {
      return res.status(400).json({ ok: false, error: 'No input provided. Upload a file, paste a grid, or choose a test case.' });
    }

    // Build args
    const args = [inputPath, String(mode ?? 3)];
    const m = Number(mode);
    if (m === 2 || m === 4) {
      args.push(String(numThreads ?? 2));
      if (writeToFile !== undefined) args.push(String(writeToFile ? 1 : 0));
    } else if (writeToFile !== undefined) {
      args.push(String(writeToFile ? 1 : 0));
    }

    // Try to read puzzle size N from the input file for better hints
    let puzzleSize = null;
    try {
      const firstLine = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/).find(l => l.trim().length > 0);
      if (firstLine && /^\s*\d+\s*$/.test(firstLine)) puzzleSize = parseInt(firstLine, 10);
    } catch {}

    // Ensure PATH contains MSYS2 UCRT64 bin so required DLLs (e.g., libgomp-1.dll) are found on Windows
    const env = { ...process.env };
    try {
      const candidates = [
        'C:/msys64/ucrt64/bin',
        'C:/msys64/mingw64/bin',
        'C:/msys64/usr/bin'
      ];
      const found = candidates.filter(p => fs.existsSync(p));
      if (found.length) {
        env.PATH = `${found.join(';')};${env.PATH || ''}`;
      }
    } catch {}

    const proc = spawn(solver, args, { cwd: path.join(__dirname, '..'), env });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    let spawnErr = null;
    proc.on('error', (err) => {
      spawnErr = err;
    });

    // Timeout handling
    const timeoutMs = Math.max(5, parseInt(timeoutSeconds || '30', 10)) * 1000;
    const killer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
    }, timeoutMs);

    proc.on('close', (code, signal) => {
      clearTimeout(killer);
      if (tempFileToDelete) {
        fs.unlink(tempFileToDelete, () => {});
      }
      // Try to detect time and solved
      const solved = /SOLVED!/i.test(stdout);
      const timeMatch = stdout.match(/\[Solved in\s+([0-9.]+)\s+seconds\.?\]/);
      const timeSeconds = timeMatch ? Number(timeMatch[1]) : null;

      // Friendly notes / diagnostics
      let note = undefined;
      if (code === 3221225781) {
        note = 'Process failed to start due to missing runtime DLLs. Ensure MSYS2 UCRT64 is installed and its bin folder is on PATH (e.g., C:/msys64/ucrt64/bin).';
      }
      if (code == null && signal) {
        note = `Process terminated by signal: ${signal}` + (note ? `\n${note}` : '');
      }
      if (spawnErr) {
        note = `Failed to spawn process: ${spawnErr.message || String(spawnErr)}` + (note ? `\n${note}` : '');
      }
      if (signal === 'SIGKILL') {
        note = `Stopped after ${timeoutMs/1000}s timeout. Try a faster algorithm (DLX modes 3/4), reduce puzzle size, or increase timeout.` + (note ? `\n${note}` : '');
      }

      // Map common assertion messages to user-friendly explanations
      const add = (msg) => { note = (note ? note + '\n' : '') + msg; };
      if (/checkValidRows/i.test(stderr)) {
        add('Invalid puzzle: a row has duplicate or illegal values. Please fix the row conflicts and try again.');
      }
      if (/checkValidColumns/i.test(stderr)) {
        add('Invalid puzzle: a column has duplicate or illegal values. Please fix the column conflicts and try again.');
      }
      if (/checkValidBoxes/i.test(stderr)) {
        add('Invalid puzzle: a subgrid/box has duplicate or illegal values. Please fix the box conflicts and try again.');
      }
      if (puzzleSize && (m === 0 || m === 1 || m === 2) && puzzleSize >= 16) {
        add(`Tip: For ${puzzleSize}x${puzzleSize} puzzles, use DLX (mode 3 or 4). Brute force/backtracking can take a very long time.`);
      }

      const cleanStdout = scrubStdout(stdout);
      res.json({ ok: code === 0, code, signal, solved, timeSeconds, stdout: cleanStdout, stderr, args, note });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sudoku web app server listening on http://localhost:${PORT}`);
});
