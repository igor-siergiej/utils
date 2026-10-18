# @imapps/web-utils

Shared React auth layer for IM Apps frontends. Built with tsup to ESM + CJS (`build/`).

## Install

```sh
bun add @imapps/web-utils
```

Peer deps: `react >= 18`, `react-router-dom >= 6`.

## Exports

Everything is re-exported from `src/auth`:

| Area | Exports |
| --- | --- |
| contexts | `AuthConfigProvider` / `useAuthConfig`, `AuthProvider`, `UserContext` |
| components | `ProtectedRoute` |
| hooks | `useAuthRedirect`, `useTokenInitialization`, `useTokenRefresh` |
| utils | `decodeJWT`, `extractUserFromToken`, `isTokenExpired`, `getTokenExpirationTime`, `getStorageItem`, `clearRefreshTokenCookie`, ... |
| types | `AuthConfig` and related types |

`AuthConfigProvider` defaults: `storageType: 'localStorage'`, `accessTokenKey: 'accessToken'`, `refreshTokenCookieName: 'refreshToken'`, endpoints `refresh: '/refresh'`, `logout: '/logout'` (see `src/auth/contexts/AuthConfigContext.tsx`).

```tsx
import { AuthConfigProvider, AuthProvider, ProtectedRoute } from '@imapps/web-utils';
```

Note: older docs (`CLAUDE.md`, previous README) describe `cn`, `isBrowser`, `clamp` helpers; these are not exported by the current source.

## Develop

```sh
bun run build   # tsup
```

No test script is defined for this package.

Consumers (from `package.json` scan): `packages/web` of shoppingo, mixtape, jewellery-catalogue.
