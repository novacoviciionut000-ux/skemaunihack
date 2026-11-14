import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
    authLogin,
    authRegister,
    authOAuth,
    authLogout,
    authCheckUsername,
    authGetMe,
    authUpdateProfile
} from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // The session is an HttpOnly cookie we can't see from JS; ask the server who we are
    useEffect(() => {
        let mounted = true;
        authGetMe()
            .then((currentUser) => {
                if (mounted && currentUser) setUser(currentUser);
            })
            .catch((err) => {
                if (err.status !== 401) {
                    console.warn('Backend-ul nu este disponibil pentru verificarea sesiunii:', err.message);
                }
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => { mounted = false; };
    }, []);

    const login = useCallback(async (usernameOrEmail, password) => {
        const response = await authLogin({ usernameOrEmail, password });
        setUser(response);
        return response;
    }, []);

    const register = useCallback(async (userData) => {
        const response = await authRegister(userData);
        setUser(response);
        return response;
    }, []);

    const loginWithOAuth = useCallback(async (provider, oauthData) => {
        const response = await authOAuth(provider, oauthData);
        setUser(response);
        return response;
    }, []);

    const logout = useCallback(async () => {
        setUser(null);
        try {
            await authLogout();
        } catch (err) {
            console.warn('Logout request failed:', err.message);
        }
    }, []);

    const updateProfile = useCallback(async (data) => {
        const updated = await authUpdateProfile(data);
        setUser(prev => ({ ...prev, ...updated }));
        return updated;
    }, []);

    // Re-reads the profile (e.g. Deed points after a confirmed deed)
    const refreshUser = useCallback(async () => {
        try {
            const fresh = await authGetMe();
            if (fresh) setUser((prev) => ({ ...prev, ...fresh }));
        } catch {
            /* keep the current state */
        }
    }, []);

    const value = {
        user,
        isAuthenticated: Boolean(user),
        loading,
        login,
        register,
        checkUsername: authCheckUsername,
        loginWithOAuth,
        logout,
        updateProfile,
        refreshUser,
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
