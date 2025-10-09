import { useCallback, useRef } from 'react';

import { useAuthConfig } from '../contexts/AuthConfigContext';
import { useAuth } from '../contexts/AuthContext';
import type { RefreshTokenResponse } from '../types';
import { clearRefreshTokenCookie } from '../utils';

export const useTokenRefresh = () => {
    const { login, logout, accessToken } = useAuth();
    const config = useAuthConfig();
    const refreshPromiseRef = useRef<Promise<string> | null>(null);

    const hasRefreshToken = useCallback((): boolean => {
        if (typeof document === 'undefined') return false;

        return document.cookie
            .split(';')
            .some((cookie) => cookie.trim().startsWith(`${config.refreshTokenCookieName}=`));
    }, [config.refreshTokenCookieName]);

    const clearTokens = useCallback(() => {
        logout();
        refreshPromiseRef.current = null;
        clearRefreshTokenCookie(config.refreshTokenCookieName);
    }, [logout, config.refreshTokenCookieName]);

    const performTokenRefresh = useCallback(async (): Promise<string> => {
        try {
            const refreshEndpoint = config.endpoints?.refresh || '/refresh';
            const response = await fetch(`${config.authUrl}${refreshEndpoint}`, {
                method: 'POST',
                credentials: 'include',
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    clearTokens();
                    throw new Error('Refresh token expired. Please log in again.');
                } else {
                    throw new Error(`Failed to refresh token: ${response.status}`);
                }
            }

            const data: RefreshTokenResponse = await response.json();

            login(data.accessToken);

            return data.accessToken;
        } catch (error) {
            clearTokens();
            throw error;
        }
    }, [login, clearTokens, config.authUrl, config.endpoints?.refresh]);

    const refreshTokens = useCallback(async (): Promise<string> => {
        if (refreshPromiseRef.current) {
            return refreshPromiseRef.current;
        }

        refreshPromiseRef.current = performTokenRefresh();

        try {
            const newAccessToken = await refreshPromiseRef.current;

            refreshPromiseRef.current = null;

            return newAccessToken;
        } catch (error) {
            refreshPromiseRef.current = null;
            throw error;
        }
    }, [performTokenRefresh]);

    const getValidAccessToken = useCallback(async (): Promise<string> => {
        if (!accessToken) {
            throw new Error('No access token available. Please log in.');
        }

        return accessToken;
    }, [accessToken]);

    return {
        refreshTokens,
        getValidAccessToken,
        hasRefreshToken,
        clearTokens,
    };
};
