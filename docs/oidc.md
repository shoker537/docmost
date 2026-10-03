# OpenID Connect in Community Edition

Self-hosted workspaces can configure OIDC under **Settings → Security & SSO**.
Only owners and administrators using an interactive session can manage providers.
This implementation lives in the open-source core and CE client; it does not load
the enterprise client or require a license.

## Setup

1. Set `APP_URL` to the public Docmost origin. Use HTTPS for production so session
   and OIDC transaction cookies are secure. Keep `APP_SECRET` stable: it encrypts
   stored provider secrets.
2. Apply the normal database migrations, including
   `20261003T120000-oidc-subject-unique`. This migration adds a unique provider/subject
   index. Existing duplicate provider/subject mappings must be resolved before it
   can succeed. No migration is applied by this change itself.
3. Create a confidential web client in your identity provider with the
   authorization code flow and `openid email profile` scopes. Its discovery
   document must support `client_secret_basic` or `client_secret_post` and publish
   an asymmetric signing key through `jwks_uri`.
4. Add a provider in Docmost using its HTTPS **issuer URL** (not the full
   `/.well-known/openid-configuration` URL), client ID and client secret. Docmost
   checks discovery when creating or enabling providers. Save it disabled initially.
5. Copy the displayed callback URL into the identity provider's allowed redirect
   URIs, then enable the provider. The exact URL is:
   `APP_URL/api/sso/oidc/PROVIDER_ID/callback`.
6. Sign out and use **Continue with …** on the login page.

Requests for discovery, tokens, UserInfo and signing keys use Docmost's outbound
network guard. Private identity providers require an appropriate
`ALLOWED_PRIVATE_NETWORKS` entry (for example `10.20.0.5:443`). TLS certificate
validation stays enabled, and outbound redirects are refused.

## Accounts and security

- On first login, a strictly boolean `email_verified: true` and a valid email
  address are required. The claims can come from the ID token or the UserInfo
  endpoint. An existing account in this workspace with the same email is linked
  to the provider subject. Configure the identity provider to verify email
  ownership; this assertion grants access to matching Docmost accounts.
- Enable **Allow new accounts** to provision missing users. They join as members,
  receive normal default group/space access, and must meet the workspace email
  domain restrictions. Signup is disabled by default.
- Subsequent logins identify users by provider and immutable `sub`, so an email
  change does not silently link another account. Disabled and deleted accounts
  cannot sign in. A user cannot acquire a second subject on the same provider.
- Authorization requests use state, nonce and S256 PKCE. Redis stores each
  transaction for ten minutes and consumes it once, bound to the initiating
  browser, workspace and provider. ID token signatures, issuer, audience, expiry
  and nonce are checked by `openid-client`.
- Secrets are encrypted at rest and omitted from settings responses. Leave the
  secret blank when editing to retain it. Provider changes invalidate pending
  logins. Create a new provider when changing an issuer that has linked accounts.
- Successful login creates the same session and HTTP-only auth cookie as password
  login. Logout and session revocation use the existing session endpoints.
- Existing MFA-enabled accounts or MFA-enforced workspaces are refused by this
  CE flow because CE does not implement an MFA challenge. Use the password/MFA
  flow available in your deployment or enforce MFA at the identity provider.
- Deleting a provider removes its identity links, not its users. The last enabled
  provider cannot be disabled or deleted while workspace SSO enforcement is on.

Concurrent login attempts in different browser tabs share one transaction cookie;
only the most recently started attempt can finish. Retry the login if an older
tab reports an error. Error redirects display a generic message without exposing
authorization codes, tokens or identity-provider responses.

## Troubleshooting

Callback failures log a `stage` and a safe `reason` in the Docmost container logs.
The log omits tokens, authorization codes, cookies, identity claims and raw
identity-provider error responses. Retry from the login button after correcting
the cause; callback URLs and authorization codes cannot be reused.

- `OIDC transaction cookie is missing`: check the callback **request** Cookie
  header. The callback **response** intentionally clears `oidcTransaction`, so an
  empty Set-Cookie value there is expected. Open Docmost using the same scheme
  and hostname configured in `APP_URL` and registered in the provider callback.
- `OIDC email_verified claim must be true`: the custom identity provider must
  assert a boolean `email_verified: true` for users whose email ownership it has
  verified, in the ID token or UserInfo response.
- `code exchange and ID token validation`: check the reported protocol code,
  client credentials, registered callback URI, issuer, audience, nonce and signing
  keys. A redirect response from the authorization endpoint alone does not prove
  the code exchange or token validation succeeded.
- `OIDC signup is disabled`: enable **Allow new accounts** or first create the
  matching workspace account through the normal invitation flow.
