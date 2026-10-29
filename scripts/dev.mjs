import { spawn } from 'node:child_process';

const children = [];
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const [command, args] of [
  [process.env.OPTICS_PYTHON || 'python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8000']],
  [process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort']],
]) {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', (error) => { console.error(`服务启动失败：${error.message}。请先按README安装依赖。`); shutdown(1); });
  child.on('exit', (code) => { if (!stopping) shutdown(code || 0); });
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
