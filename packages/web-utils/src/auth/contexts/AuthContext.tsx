import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { AuthContextType } from '../types';
import { getStorageItem, removeStorageItem, setStorageItem } from '../utils';
import { useAuthConfig } from './AuthConfigContext';
import { useUser } from './UserContext';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const config = useAuthConfig();
    const { updateUserFromToken, clearUser } = useUser();

    const [accessToken, setAccessToken] = useState<string | null>(() => {
        const stored = getStorageItem(config.accessTokenKey!, config.storageType);

        return stored || null;
    });

    useEffect(() => {
        if (accessToken) {
            updateUserFromToken(accessToken);
        } else {
            clearUser();
        }
    }, [accessToken, updateUserFromToken, clearUser]);

    const login = useCallback(
        (token: string) => {
            setAccessToken(token);
            setStorageItem(config.accessTokenKey!, token, config.storageType);
        },
        [config.accessTokenKey, config.storageType]
    );

    const logout = useCallback(async () => {
        try {
            const logoutEndpoint = config.endpoints?.logout || '/logout';

            await fetch(`${config.authUrl}${logoutEndpoint}`, {
                method: 'POST',
                credentials: 'include',
            });
        } catch (error) {
            console.error('Logout request failed:', error);
        } finally {
            setAccessToken(null);
            removeStorageItem(config.accessTokenKey!, config.storageType);
        }
    }, [config.authUrl, config.endpoints?.logout, config.accessTokenKey, config.storageType]);

    const contextValue = useMemo(() => {
        const isAuth = !!accessToken;

        return {
            accessToken,
            isAuthenticated: isAuth,
            login,
            logout,
        };
    }, [accessToken, login, logout]);

    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }

    return context;
};
