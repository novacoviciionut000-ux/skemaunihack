import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import 'leaflet/dist/leaflet.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <AuthProvider>
        <App />
    </AuthProvider>
)

// PWA: offline app shell + cached AI model. Needs HTTPS (or localhost), e.g. the Cloudflare tunnel.
// Registered right away: waiting for window "load" can take very long (or never happen)
// while map tiles and fonts load over a slow tunnel, and Chrome won't offer "Install app" without it.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
    });
}
