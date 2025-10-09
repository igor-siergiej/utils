import type { ReactNode } from 'react';

export interface AuthConfig {
    authUrl: string;
    storageType?: 'localStorage' | 'sessionStorage';
    accessTokenKey?: string;
    refreshTokenCookieName?: string;
    endpoints?: {
        refresh?: string;
        logout?: string;
    };
}

export interface UserInfo {
    username: string;
    id: string;
    [key: string]: string | number | boolean;
}

export interface DecodedToken {
    username: string;
    id: string;
    exp: number;
    iat: number;
    [key: string]: string | number | boolean;
}

export interface RefreshTokenResponse {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
}

export interface AuthContextType {
    accessToken: string | null;
    isAuthenticated: boolean;
    login: (accessToken: string) => void;
    logout: () => Promise<void>;
}

export interface UserContextType {
    user: UserInfo | null;
    setUser: (user: UserInfo | null) => void;
    updateUserFromToken: (token: string) => void;
    clearUser: () => void;
}

export interface ConfigState {
    config: AuthConfig | null;
    isLoading: boolean;
    error: string | null;
}

export interface AuthProviderProps {
    children: ReactNode;
    config?: AuthConfig;
}

export interface UserProviderProps {
    children: ReactNode;
}

export interface ProtectedRouteProps {
    children: ReactNode;
    fallbackPath?: string;
}

export interface UseAuthRedirectOptions {
    redirectTo?: string;
    redirectFrom?: string;
    condition?: 'authenticated' | 'unauthenticated';
}
