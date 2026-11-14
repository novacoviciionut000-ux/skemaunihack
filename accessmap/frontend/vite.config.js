import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0', // Allows testing on local mobile devices
        port: 3000,
        allowedHosts: true,
        proxy: {
            '/api': {
                target: 'http://localhost:8080', // Spring Boot Backend
                changeOrigin: true,
                xfwd: true // pass the client IP so backend rate limiting is per user, not per proxy
            }
        }
    }
})