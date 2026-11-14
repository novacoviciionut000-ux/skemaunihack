import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                // Split the libraries out of the app code. They change far less often than
                // our own files, so a returning visitor keeps them cached, and the browser
                // can fetch them in parallel instead of parsing one large file.
                // TensorFlow is already a separate chunk because it is imported
                // dynamically, and only downloads when the camera is opened.
                manualChunks: {
                    react: ['react', 'react-dom'],
                    map: ['leaflet', 'react-leaflet'],
                    icons: ['lucide-react'],
                },
            },
        },
    },
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