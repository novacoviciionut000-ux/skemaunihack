import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
    getStoredToken,
    getStoredUser,
    setStoredAuth,
    clearStoredAuth,
    authLogin,
    authRegister,
    authOAuth,
    authCheckUsername,
    authGetMe,
    authUpdateProfile
} from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [token, setToken] = useState(() => getStoredToken());
    const [user, setUser] = useState(() => getStoredUser());
    const [loading, setLoading] = useState(true);

    // Verifică token-ul la pornirea aplicației
    useEffect(() => {
        let mounted = true;
        const initAuth = async () => {
            const currentToken = getStoredToken();
            if (!currentToken) {
                if (mounted) setLoading(false);
                return;
            }

            try {
                const currentUser = await authGetMe();
                if (mounted && currentUser) {
                    setUser(currentUser);
                    setToken(currentToken);
                }
            } catch (err) {
                console.warn('Sesiunea a expirat sau backend-ul nu este disponibil:', err.message);
                // Dacă tokenul a fost respins (401), ștergem starea
                if (err.status === 401) {
                    clearStoredAuth();
                    if (mounted) {
                        setUser(null);
                        setToken(null);
                    }
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        initAuth();
        return () => { mounted = false; };
    }, []);

    const login = useCallback(async (usernameOrEmail, password) => {
        const response = await authLogin({ usernameOrEmail, password });
        setToken(response.token);
        setUser(response);
        return response;
    }, []);

    const register = useCallback(async (userData) => {
        const response = await authRegister(userData);
        setToken(response.token);
        setUser(response);
        return response;
    }, []);

    const loginWithOAuth = useCallback(async (provider, oauthData) => {
        const response = await authOAuth(provider, oauthData);
        setToken(response.token);
        setUser(response);
        return response;
    }, []);

    const logout = useCallback(() => {
        clearStoredAuth();
        setToken(null);
        setUser(null);
    }, []);

    const updateProfile = useCallback(async (data) => {
        const updated = await authUpdateProfile(data);
        setUser(prev => ({ ...prev, ...updated }));
        return updated;
    }, []);

    const value = {
        user,
        token,
        isAuthenticated: Boolean(user && token),
        loading,
        login,
        register,
        checkUsername: authCheckUsername,
        loginWithOAuth,
        logout,
        updateProfile,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return ctx;
};
