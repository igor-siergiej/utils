import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import type { UseAuthRedirectOptions } from '../types';

export const useAuthRedirect = (options: UseAuthRedirectOptions = {}) => {
    const { redirectTo = '/home', redirectFrom = '/', condition = 'authenticated' } = options;

    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated } = useAuth();

    useEffect(() => {
        const shouldRedirect =
            condition === 'authenticated'
                ? isAuthenticated && location.pathname === redirectFrom
                : !isAuthenticated && location.pathname !== redirectFrom;

        if (shouldRedirect) {
            navigate(redirectTo);
        }
    }, [isAuthenticated, navigate, location.pathname, redirectTo, redirectFrom, condition]);

    return { isAuthenticated };
};

export const useRedirectIfAuthenticated = (to = '/home', from = '/') => {
    return useAuthRedirect({ redirectTo: to, redirectFrom: from, condition: 'authenticated' });
};

export const useRedirectIfUnauthenticated = (to = '/login') => {
    return useAuthRedirect({ redirectTo: to, condition: 'unauthenticated' });
};
