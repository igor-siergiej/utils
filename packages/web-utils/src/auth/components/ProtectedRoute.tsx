import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import type { ProtectedRouteProps } from '../types';

export const ProtectedRoute = ({ children, fallbackPath = '/login' }: ProtectedRouteProps) => {
    const location = useLocation();
    const { isAuthenticated } = useAuth();

    if (!isAuthenticated) {
        return <Navigate to={fallbackPath} state={{ from: location }} replace />;
    }

    return <>{children}</>;
};
