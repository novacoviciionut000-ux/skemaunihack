// import axios from 'axios';

// const api = axios.create({
//   baseURL: '/api',
//   headers: { 'Content-Type': 'application/json' }
// });

export const geocodeQuery = async (query) => {
    console.log(`[MOCK] Searching for: ${query}`);
    return new Promise((resolve) => {
        setTimeout(() => {
            // Mock result: Piata Unirii, Timisoara
            resolve([{ lat: 45.7537, lon: 21.2257, display_name: "Piața Unirii" }]);
        }, 500);
    });
};

export const getRoute = async (startCoords, endCoords, profile) => {
    console.log(`[MOCK] Calculating ${profile} route from`, startCoords, `to`, endCoords);
    return new Promise((resolve) => {
        setTimeout(() => {
            // Mock Polyline path connecting start, a middle waypoint, and end
            resolve({
                coordinates: [
                    [startCoords.lat, startCoords.lng],
                    [45.7513, 21.2245], // Waypoint near Piata Victoriei
                    [endCoords.lat, endCoords.lng]
                ]
            });
        }, 600);
    });
};

export const getReports = async () => {
    console.log(`[MOCK] Fetching obstacles`);
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve([
                { id: 1, lat: 45.7495, lng: 21.2260, type: "BROKEN_ELEVATOR" },
                { id: 2, lat: 45.7510, lng: 21.2230, type: "BLOCKED_SIDEWALK" }
            ]);
        }, 400);
    });
};

export const submitReport = async (lat, lng, type) => {
    console.log(`[MOCK] Submitting report: ${type} at ${lat}, ${lng}`);
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve({ id: Date.now(), lat, lng, type });
        }, 500);
    });
};