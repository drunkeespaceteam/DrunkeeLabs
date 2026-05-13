import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,

    cors: true,

    // Do not set clientPort to 443 on local HTTP dev — the HMR client would try
    // ws://localhost:443 and fail. Omit clientPort so HMR uses the dev server port (e.g. 3000).
    hmr: {
      overlay: false,
    },

    watch: {
      ignored: [
        "**/server/tmp/**",
        "**/server/snapshots/**",
      ],
    },

    proxy: {
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
        onError: (err) => {
          if (err.code !== 'ECONNRESET' && err.code !== 'ECONNREFUSED' && err.code !== 'EPIPE') {
            console.error('[Vite Proxy] Socket.io error:', err.message);
          }
        },
        onProxyReqWs: (_proxyReq, _req, socket) => {
          socket.on('error', () => {}); // Suppress WS socket errors
        },
      },
      "/preview/review": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
        onError: (err) => {
          if (err.code !== 'ECONNRESET' && err.code !== 'ECONNREFUSED' && err.code !== 'EPIPE') {
            console.error('[Vite Proxy] Review preview error:', err.message);
          }
        },
        onProxyReqWs: (_proxyReq, _req, socket) => {
          socket.on('error', () => {});
        },
      },
      "/preview": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
        // Suppress ECONNRESET errors when containers stop
        onError: (err) => {
          if (err.code !== 'ECONNRESET' && err.code !== 'ECONNREFUSED' && err.code !== 'EPIPE') {
            console.error('[Vite Proxy] Preview error:', err.message);
          }
        },
        onProxyReqWs: (_proxyReq, _req, socket) => {
          socket.on('error', () => {}); // Suppress WS socket errors
        },
      },
      "/upload-project": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/upload-image": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/job-status": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/logs": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/stop-preview": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/start-preview": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/send-message": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/submit-kyc": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/kyc-status": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/request-withdrawal": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/create-checkout-order": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/verify-checkout-payment": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/feature-task": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/verify-feature-task-payment": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/announce-winner": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/submit-final-code": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/approve-delivery": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/download-submission": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/mark-notifications-read": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/generate-task": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Only proxy API-style paths under /admin/... — NOT bare GET /admin (SPA route).
      // A blanket "/admin" prefix also matched the page route and returned Express's dist HTML
      // (with /assets/*.js) while the browser was still on Vite :3000 → 404 on chunks → white screen.
      "^/admin/": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/razorpay-webhook": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
