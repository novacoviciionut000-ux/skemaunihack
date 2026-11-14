import React, { useState } from 'react';
import { geocodeQuery } from '../api/client';
import { Search } from 'lucide-react';

export default function SearchBar({ onSelectStart, onSelectDestination }) {
    const [query, setQuery] = useState('');

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!query) return;

        try {
            const results = await geocodeQuery(query);
            if (results && results.length > 0) {
                // For simplicity, auto-assigning to destination. 
                // In a full app, you'd show a list and pick start/end.
                onSelectDestination({ lat: results[0].lat, lng: results[0].lon });
            }
        } catch (error) {
            console.error("Geocoding failed", error);
        }
    };
    
    return (
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
            <label htmlFor="destination-search" className="sr-only">Search Destination</label>
            <input
                id="destination-search"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Where to?"
                aria-label="Search for a destination"
                style={{
                    flex: 1, padding: '16px', fontSize: '18px',
                    borderRadius: '12px', border: '2px solid #334155',
                    boxShadow: '0 4px 6px rgba(15, 23, 42, 0.1)'
                }}
            />
            <button
                type="submit"
                aria-label="Search"
                style={{
                    padding: '16px', background: '#1D4ED8', color: 'white',
                    borderRadius: '12px', border: 'none', cursor: 'pointer',
                    minWidth: '56px', display: 'flex', justifyContent: 'center', alignItems: 'center'
                }}
            >
                <Search size={24} />
            </button>
        </form>
    );
}