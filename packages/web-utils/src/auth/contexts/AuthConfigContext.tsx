import { createContext, type ReactNode, useContext } from 'react';

import type { AuthConfig } from '../types';

interface AuthConfigContextType {
    config: AuthConfig;
}

const AuthConfigContext = createContext<AuthConfigContextType | undefined>(undefined);

interface AuthConfigProviderProps {
    children: ReactNode;
    config: AuthConfig;
}

export const AuthConfigProvider = ({ children, config }: AuthConfigProviderProps) => {
    const configWithDefaults: AuthConfig = {
        storageType: 'localStorage',
        accessTokenKey: 'accessToken',
        refreshTokenCookieName: 'refreshToken',
        endpoints: {
            refresh: '/refresh',
            logout: '/logout',
            ...config.endpoints,
        },
        ...config,
    };

    return <AuthConfigContext.Provider value={{ config: configWithDefaults }}>{children}</AuthConfigContext.Provider>;
};

export const useAuthConfig = (): AuthConfig => {
    const context = useContext(AuthConfigContext);

    if (!context) {
        throw new Error('useAuthConfig must be used within an AuthConfigProvider');
    }

    return context.config;
};
