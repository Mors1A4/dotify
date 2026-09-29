import http from 'http';
import { exec } from 'child_process';
import url from 'url';

const PORT = 42888;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/api/exec') {
    const cmd = parsed.query.cmd;
    if (!cmd) {
      return res.end(JSON.stringify({ ok: false, error: 'Missing cmd parameter' }));
    }

    const start = Date.now();
    exec(cmd, { cwd: 'C:\\Users\\monty', shell: 'powershell.exe', maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      const durationMs = Date.now() - start;
      const exitCode = err ? (err.code ?? 1) : 0;
      res.end(JSON.stringify({
        ok: exitCode === 0,
        command: cmd,
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode,
        durationMs
      }));
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] Bridge runner active at http://127.0.0.1:${PORT}/api/exec`);
});
