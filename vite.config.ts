import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Default: HTTPS on the LAN (self-signed cert) so the Quest can open https://<pc-ip>:5173.
// Mode "usb": plain HTTP on localhost, used with `adb reverse tcp:5173 tcp:5173`.
// Shown in the Account tab so it is clear which build the headset is running: commit + build time.
function buildId(): string {
  let commit = 'nogit';
  try {
    commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  return `${commit} ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`;
}

export default defineConfig(({ mode }) => {
  const usb = mode === 'usb';
  return {
    plugins: usb ? [] : [basicSsl()],
    define: { __BUILD_ID__: JSON.stringify(buildId()) },
    // USB mode binds IPv4 explicitly: on Windows "localhost" can resolve to ::1 only,
    // which adb reverse (127.0.0.1) cannot reach.
    server: { host: usb ? '127.0.0.1' : true, port: 5173, strictPort: true },
  };
});
