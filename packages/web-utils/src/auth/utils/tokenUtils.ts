import type { AuthConfig, RefreshTokenResponse } from '../types';

export const tryRefreshToken = async (config: AuthConfig): Promise<string | null> => {
    try {
        const refreshEndpoint = config.endpoints?.refresh || '/refresh';
        const response = await fetch(`${config.authUrl}${refreshEndpoint}`, {
            method: 'POST',
            credentials: 'include',
        });

        if (!response.ok) {
            return null;
        }

        const data: RefreshTokenResponse = await response.json();

        return data.accessToken;
    } catch {
        return null;
    }
};

export const clearRefreshTokenCookie = (cookieName = 'refreshToken'): void => {
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
};

export const refreshAccessToken = async (config: AuthConfig): Promise<string> => {
    try {
        const refreshEndpoint = config.endpoints?.refresh || '/refresh';
        const response = await fetch(`${config.authUrl}${refreshEndpoint}`, {
            method: 'POST',
            credentials: 'include',
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                clearRefreshTokenCookie(config.refreshTokenCookieName);
                throw new Error('Refresh token expired. Please log in again.');
            } else {
                throw new Error(`Failed to refresh token: ${response.status}`);
            }
        }

        const data: RefreshTokenResponse = await response.json();

        return data.accessToken;
    } catch (error) {
        clearRefreshTokenCookie(config.refreshTokenCookieName);
        throw error;
    }
};

export const withTokenRefresh = async <T>(
    requestFn: () => Promise<T>,
    onTokenRefresh: (newToken: string) => void,
    onTokenClear: () => void,
    config: AuthConfig
): Promise<T> => {
    try {
        return await requestFn();
    } catch (error) {
        if (error instanceof Error && error.message.includes('401')) {
            try {
                const newAccessToken = await tryRefreshToken(config);

                if (newAccessToken) {
                    onTokenRefresh(newAccessToken);

                    return await requestFn();
                } else {
                    onTokenClear();
                    clearRefreshTokenCookie(config.refreshTokenCookieName);
                    throw new Error('No valid refresh token available');
                }
            } catch (refreshError) {
                onTokenClear();
                clearRefreshTokenCookie(config.refreshTokenCookieName);
                throw refreshError;
            }
        }

        throw error;
    }
};

export const getStorageItem = (
    key: string,
    storageType: 'localStorage' | 'sessionStorage' = 'localStorage'
): string | null => {
    if (typeof window === 'undefined') return null;

    const storage = storageType === 'localStorage' ? window.localStorage : window.sessionStorage;

    return storage.getItem(key);
};

export const setStorageItem = (
    key: string,
    value: string,
    storageType: 'localStorage' | 'sessionStorage' = 'localStorage'
): void => {
    if (typeof window === 'undefined') return;

    const storage = storageType === 'localStorage' ? window.localStorage : window.sessionStorage;

    storage.setItem(key, value);
};

export const removeStorageItem = (
    key: string,
    storageType: 'localStorage' | 'sessionStorage' = 'localStorage'
): void => {
    if (typeof window === 'undefined') return;

    const storage = storageType === 'localStorage' ? window.localStorage : window.sessionStorage;

    storage.removeItem(key);
};
