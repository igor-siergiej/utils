import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

import type { UserContextType, UserInfo } from '../types';
import { extractUserFromToken } from '../utils';

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<UserInfo | null>(null);

    const updateUserFromToken = useCallback((token: string) => {
        const userInfo = extractUserFromToken(token);

        if (userInfo) {
            setUser(userInfo);
        } else {
            console.warn('Could not extract user information from token');
            setUser(null);
        }
    }, []);

    const clearUser = useCallback(() => {
        setUser(null);
    }, []);

    return (
        <UserContext.Provider value={{ user, setUser, updateUserFromToken, clearUser }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = (): UserContextType => {
    const context = useContext(UserContext);

    if (!context) {
        throw new Error('useUser must be used within a UserProvider');
    }

    return context;
};
