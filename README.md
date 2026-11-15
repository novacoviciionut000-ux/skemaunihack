AccessMap
Aplicație web de navigare pietonală pentru persoane cu dizabilități (nevăzători/slab-văzători, utilizatori de scaun cu rotile, mobilitate limitată), construită la hackathon-ul UniHack (Timișoara).

Ce face
🗺️ Rutare pietonală accesibilă — evită obstacole raportate de comunitate (trotuare blocate, lifturi stricate etc.), cu profiluri dedicate (wheelchair, low_vision, limited_mobility).
🎙️ Asistent vocal în română — comenzi naturale ("Du-mă la Kaufland"), cu corectare fonetică pentru nume de branduri mișauzite.
📷 Detectare obstacole prin cameră (TensorFlow.js / COCO-SSD) — distanță estimată, culoare semafor, treceri de pietoni, margine trotuar, în timp real.
🆘 Semnal de ajutor — un client cheamă voluntari din apropiere; voluntarii acumulează puncte ("Deed points") pentru fapte confirmate.
📍 Hartă Leaflet cu mai multe stiluri gratuite (stradal, satelit, accesibilitate, topo, contrast ridicat).
Stack tehnic
Componentă	Tehnologie
Backend	Java 17, Spring Boot 3.3.5, Spring Security + JWT, PostgreSQL/Supabase
Frontend	React 18, Vite, Leaflet, TensorFlow.js
Rutare	GraphHopper (Docker) + fallback OSRM
Auth	Local (BCrypt) + Google OAuth (verificat server-side)
Structură
accessmap/
├── backend/   → API Spring Boot (auth, route, geocode, crossing, report, help, tts)
├── frontend/  → SPA React (hartă, voce, cameră, auth)
├── routing/   → profiluri custom GraphHopper
└── data/      → config GraphHopper
Rulare locală
./start.sh            # pornește GraphHopper (Docker) + backend + frontend
./start.sh --status   # verifică porturile 8989 / 8080 / 3000
./start.sh --stop
Necesită: Java 17+, Node 18+, Docker (opțional, pentru rutare prin GraphHopper — altfel se folosește fallback OSRM).

Copiază accessmap/.env.example → accessmap/.env și completează secretele (DB Supabase, JWT_SECRET, GOOGLE_CLIENT_ID, SMTP). Niciun secret nu e hard-codat în cod.
