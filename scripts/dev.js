const path = require('path');
const { spawn } = require('child_process');

const viteCli = path.join(path.dirname(require.resolve('vite')), '..', '..', 'bin', 'vite.js');
const processes = [
  spawn(process.execPath, ['backend/server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, [viteCli, '--host', '0.0.0.0', '--port', '5173', '--configLoader', 'runner'], { stdio: 'inherit' }),
];

function stop(exitCode = 0) {
  processes.forEach((child) => {
    if (!child.killed) child.kill('SIGTERM');
  });
  process.exit(exitCode);
}

processes.forEach((child) => {
  child.on('exit', (code) => {
    if (code && !process.exitCode) {
      console.error(`A development process stopped with exit code ${code}.`);
      stop(code);
    }
  });
});

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
