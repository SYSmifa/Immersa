import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Default: HTTPS on the LAN (self-signed cert) so the Quest can open https://<pc-ip>:5173.
// Mode "usb": plain HTTP on localhost, used with `adb reverse tcp:5173 tcp:5173`.
export default defineConfig(({ mode }) => {
  const usb = mode === 'usb';
  return {
    plugins: usb ? [] : [basicSsl()],
    server: { host: !usb, port: 5173, strictPort: true },
  };
});
