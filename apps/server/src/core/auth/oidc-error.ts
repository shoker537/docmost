// Log only fixed application messages and protocol/transport codes. Never log an
// Error object: OIDC errors can contain token responses, claims and credentials.
const safeMessages = new Set([
  'OIDC provider not found',
  'OIDC provider is disabled',
  'Invalid OIDC transaction',
  'OIDC transaction cookie is missing',
  'Invalid or expired OIDC transaction',
  'OIDC provider changed',
  'Missing OIDC subject',
  'OIDC email claim is missing or invalid',
  'OIDC email_verified claim must be true',
  'OIDC signup is disabled; ask an administrator to create your account',
  'Email domain is not allowed',
  'Account is disabled',
  'Account is already linked to a different OIDC subject',
  'This account requires MFA, which is not supported by the CE OIDC flow',
  'Required OIDC endpoint is missing',
  'OIDC endpoints must use HTTPS without credentials or fragments',
  'Provider must support client_secret_basic or client_secret_post',
]);

const protocolErrors = new Set([
  'access_denied',
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  'login_required',
  'interaction_required',
  'consent_required',
]);

export function oidcErrorReason(error: unknown): string {
  const reasons: string[] = [];
  let current = error;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === 'object';
    depth++
  ) {
    const value = current as Record<string, unknown>;
    if (typeof value.message === 'string' && safeMessages.has(value.message)) {
      reasons.push(value.message);
    }
    if (
      typeof value.code === 'string' &&
      /^(?:OAUTH_[A-Z_]+|ERR_[A-Z_]+|UND_ERR_[A-Z_]+|E(?:CONNRESET|CONNREFUSED|TIMEDOUT|NOTFOUND|AI_AGAIN)|CERT_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_[A-Z_]+|\d{5})$/.test(
        value.code,
      )
    ) {
      reasons.push(value.code);
    }
    if (typeof value.error === 'string' && protocolErrors.has(value.error)) {
      reasons.push(value.error);
    }
    if (
      typeof value.status === 'number' &&
      Number.isInteger(value.status) &&
      value.status >= 100 &&
      value.status <= 599
    ) {
      reasons.push(`HTTP ${value.status}`);
    }
    current = value.cause;
  }
  return [...new Set(reasons)].join('; ') || 'Unclassified failure';
}

export class OidcFlowError extends Error {
  constructor(stage: string, error: unknown) {
    super(`stage=${stage}; reason=${oidcErrorReason(error)}`);
    this.name = 'OidcFlowError';
  }
}
