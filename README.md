# Bifrost UI

Management console for [Bifrost](https://github.com/bifrost-compute/bifrost), the
Go control plane for Ray and Dask clusters — a self-hosted, FOSS replacement
for the Anyscale console. The UI is backend-agnostic: every API shape comes
from the generated OpenAPI client, never hand-written.

The authoritative product/UX spec is [`docs/ui-ux-spec.md`](docs/ui-ux-spec.md).

**Status: Milestone A (Foundation)** — app shell, design system, dev-mode auth,
health indicator, and read-only screens against the Phase-2 backend. Cluster
list and Registry render the typed table UI now and gracefully show
"not implemented yet" empty states until the Phase 3 management API
(spec §8) exists.

## API types are the source of truth

This app does **not** hand-write API shapes or point a codegen tool at a
running server. It depends on a TypeScript client generated from the frozen
Bifrost API contract (see
[bifrost-api](https://github.com/bifrost-compute/bifrost-api)), published to the
GitHub Packages npm registry whenever the API changes.
`src/lib/api.ts` re-exports those types.

GitHub Packages npm requires a token even for public packages, so `.npmrc`
reads `NODE_AUTH_TOKEN`:

```sh
export NODE_AUTH_TOKEN=$(gh auth token)   # or a classic PAT w/ read:packages
npm install
```

CI supplies `secrets.GITHUB_TOKEN`. Types annotated "UI-ahead" in
`src/lib/api.ts` (identity, registry, the cluster list view model) are
screens built before the matching endpoint/shape exists in the backend;
each carries a migration note for when it lands.

## Stack

React 19 + TypeScript + Vite · TanStack Query (polling) · TanStack Table ·
react-router v7 · Tailwind CSS v4 + Radix primitives (hand-rolled shadcn-style
components in `src/components/ui`) · class-based dark mode.

## Prerequisites

- Node.js 20+
- The backend running locally: `bifrost serve --dev-allow-unauthenticated`
  (serves `http://127.0.0.1:8484`; the Vite dev server proxies `/api`,
  `/healthz`, and `/docs` to it)

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

## Scripts

| Command           | What it does                                                          |
| ----------------- | --------------------------------------------------------------------- |
| `npm run dev`     | Vite dev server with proxy to the control plane                        |
| `npm run build`   | Type-check (`tsc -b`) + production build to `dist/`                    |
| `npm test`        | Vitest unit tests                                                      |
| `npm run lint`    | ESLint (flat config)                                                   |

API types are not generated here — they come from the published
`@bifrost-compute/bifrost-client` package (see above).

## Auth (provider-driven: SSO redirect or local login)

`/login` discovers its sign-in methods from `GET /api/v1/auth/providers`
(api-v1.md §5.15, ADR-0011): a **local username/password form** when the
backend runs `--local-auth` (opaque tokens — Bifrost stores credentials,
never signs them), **"Sign in with SSO"** when OIDC is configured, or both.
The SSO path is Authorization Code + PKCE (S256) directly against the
issuer — the standard SPA pattern, no client secret and no backend session
endpoints (api-v1.md §5.11's backend-mediated login remains the future
standalone-mode contract). The flow: `/login` redirects to
`{issuer}/protocol/openid-connect/auth`, `/auth/callback` validates `state`
and exchanges the code, the access token is stored in localStorage and sent
as `Authorization: Bearer` on every API call, and a stored refresh token
drives silent refresh on expiry. Sign out follows the session source: SSO
sessions redirect through the issuer's logout endpoint so the IdP session
dies too; local sessions revoke the PAT server-side first. A 401 on an
authenticated request clears the session and pages render a "sign in
required" state with an SSO button.

Two demo stacks exercise this (see the backend's `deploy/README.md`):

- `./deploy/up.sh auth` — Keycloak at `http://localhost:8090` (realm
  `bifrost`, public client `bifrost`, users `admin`/`operator`/`developer`/
  `viewer`, password = username). The login page offers SSO.
- The local-auth demo variant (`bifrost serve --local-auth` with
  `BIFROST_LOCAL_ADMIN_PASSWORD=admin`) — the login page renders the
  username/password form (`admin`/`admin`).

The SSO issuer falls back to `VITE_BIFROST_ISSUER` (default
`http://localhost:8090/realms/bifrost`) only on backends that predate
`/api/v1/auth/providers`; when the backend reports an issuer it wins.
Paste-a-JWT sign-in remains as a collapsed "advanced" option on `/login`
for `bifrost token`-minted service tokens (see the curl password-grant
one-liner rendered there).

The OIDC **client id** is set with `VITE_BIFROST_SSO_CLIENT_ID`, defaulting to
the local demo realm's client when unset. This has to be settable because the
id is chosen by whoever provisions the Keycloak client, not by this repo:
Nebari's operator derives a deterministic `<namespace>-<nebariapp-name>` (e.g.
`bifrost-bifrost-ui-spa`), which no literal in our bundle could match. A
standalone build that sets nothing behaves exactly as before.

> Setting the client id is necessary but not sufficient for a gateway-fronted
> deployment. Separate NebariApps for the API and the UI mean separate client
> ids, so a token minted for this client carries an `aud` that Bifrost's
> validator rejects until either a Keycloak audience mapper adds Bifrost's
> audience or Bifrost is configured with an explicit `auth.oidc.audience`. The
> client id and the audience are independent values — do not derive one from
> the other.

With no token, a feature flag still controls the dev-auth stub that assumes
a fake **Admin** identity, so the unauthenticated demo stack
(`bifrost serve --dev-allow-unauthenticated`) keeps working:

- `VITE_BIFROST_DEV_AUTH=true|false` — defaults to **on** under `vite dev`,
  **off** in production builds.
- With the flag off and no token, the shell offers a "Sign in" chip.

## Project layout

```
src/
├── auth/auth-context.tsx      # Token session (SSO/paste) + dev-mode auth stub
├── components/
│   ├── ui/                    # Base components (button, card, badge, table, input, dialog)
│   ├── layout/                # App shell: sidebar, top bar, health indicator, identity chip
│   ├── cluster-state-badge.tsx# The one ClusterState badge — 9 variants (spec §6)
│   ├── data-table.tsx         # TanStack Table renderer
│   └── empty-state.tsx        # first-run / no-results / unreachable / denied variants
├── lib/
│   ├── api.ts                 # Typed fetch wrapper + BifrostApiError (status, required/granted role)
│   ├── auth-token.ts          # JWT decode, groups→roles mapping, session precedence, token store
│   ├── pkce.ts                # SSO redirect: PKCE S256, authorize/logout URLs, code exchange, refresh
│   ├── providers.ts           # /auth/providers discovery, local-login errors, sign-out path selection
│   ├── cluster-state.ts       # ClusterState → presentation mapping (single source of truth)
│   ├── health.ts              # /healthz + /version → green/amber/red reducer
│   └── theme.tsx              # Class-based dark mode
└── routes/                    # One file per route in the IA (spec §4)
```

## Conventions worth knowing

- **State-machine fidelity**: the UI never invents cluster states. All badge
  rendering goes through `src/lib/cluster-state.ts`, which maps 1:1 to the
  backend's 9-state `ClusterState`.
- **Fail-closed errors**: API errors surface as `BifrostApiError` with
  `requiredRole`/`grantedRole` so 403s can render the denial (spec §1.4.6);
  404s from not-yet-implemented endpoints render a dedicated empty state.
- **Secrets are write-only**: the registry table shows "token set / not set",
  never a value or a reveal button.
- **No iframes anywhere** (D3/D6); the Swagger UI is linked, not embedded.
