const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

const viteCli = path.join(path.dirname(require.resolve('vite')), '..', '..', 'bin', 'vite.js');
const processes = [];

function waitForApiPort(port, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) reject(new Error(`API server did not start on port ${port} within ${timeoutMs / 1000} seconds.`));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function stop(exitCode = 0) {
  processes.forEach((child) => {
    if (!child.killed) child.kill('SIGTERM');
  });
  process.exit(exitCode);
}

function track(child) {
  processes.push(child);
  child.on('exit', (code) => {
    if (code && !process.exitCode) {
      console.error(`A development process stopped with exit code ${code}.`);
      stop(code);
    }
  });
  return child;
}

async function start() {
  const backend = track(spawn(process.execPath, ['backend/server.js'], { stdio: 'inherit' }));
  await waitForApiPort(3000);
  if (backend.exitCode !== null) throw new Error('API server stopped before Vite could start.');
  track(spawn(process.execPath, [viteCli, '--host', '0.0.0.0', '--port', '5173', '--configLoader', 'runner'], { stdio: 'inherit' }));
}

start().catch((error) => {
  console.error(error.message);
  stop(1);
});

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
