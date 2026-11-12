import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'three',
      'three/addons/controls/OrbitControls.js',
      'three/addons/environments/RoomEnvironment.js',
      'three/addons/loaders/GLTFLoader.js',
    ],
  },
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
