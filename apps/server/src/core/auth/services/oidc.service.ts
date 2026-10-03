import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import Redis from 'ioredis';
import * as oidc from 'openid-client';
import { fetch as undiciFetch } from 'undici';
import { isEmail } from 'class-validator';
import { randomBytes, createHash } from 'node:crypto';
import { Selectable } from 'kysely';
import { AuthProviders } from '@docmost/db/types/db';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { Workspace } from '@docmost/db/types/entity.types';
import { EncryptionService } from '../../../integrations/encryption/encryption.service';
import { DomainService } from '../../../integrations/environment/domain.service';
import { OutboundAgentFactory } from '../../../integrations/outbound/outbound-agent.factory';
import { SignupService } from './signup.service';
import { SessionService } from '../../session/session.service';
import { isUserDisabled } from '../../../common/helpers';
import { SaveOidcProviderDto } from '../dto/oidc-provider.dto';
import { UserRole } from '../../../common/helpers/types/permission';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import { OidcFlowError } from '../oidc-error';

type Provider = Selectable<AuthProviders>;
type LoginState = {
  workspaceId: string;
  providerId: string;
  revision: string;
  verifier: string;
  nonce: string;
  browser: string;
  redirect: string;
};

export const OIDC_COOKIE = 'oidcTransaction';
const publicFields = [
  'id',
  'name',
  'type',
  'oidcIssuer',
  'oidcClientId',
  'isEnabled',
  'allowSignup',
] as const;

@Injectable()
export class OidcService {
  private readonly redis: Redis;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    redisService: RedisService,
    private readonly encryption: EncryptionService,
    private readonly domain: DomainService,
    private readonly outbound: OutboundAgentFactory,
    private readonly users: UserRepo,
    private readonly signup: SignupService,
    private readonly sessions: SessionService,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {
    this.redis = redisService.getOrThrow();
  }

  async list(workspace: Workspace) {
    const providers = await this.db
      .selectFrom('authProviders')
      .select(publicFields)
      .where('workspaceId', '=', workspace.id)
      .where('type', '=', 'oidc')
      .where('deletedAt', 'is', null)
      .orderBy('createdAt')
      .execute();
    return providers.map((provider) => ({
      ...provider,
      callbackUrl: this.callbackUrl(workspace, provider.id),
    }));
  }

  private async provider(id: string, workspaceId: string) {
    const provider = await this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('type', '=', 'oidc')
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!provider) throw new NotFoundException('OIDC provider not found');
    return provider;
  }

  async save(
    dto: SaveOidcProviderDto,
    workspace: Workspace,
    creatorId: string,
  ) {
    const existing = dto.providerId
      ? await this.provider(dto.providerId, workspace.id)
      : undefined;
    if (!dto.oidcClientSecret && !existing?.oidcClientSecret) {
      throw new BadRequestException('Client secret is required');
    }
    const issuer = new URL(dto.oidcIssuer);
    if (
      issuer.protocol !== 'https:' ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    ) {
      throw new BadRequestException(
        'Issuer must be an HTTPS URL without credentials, query or fragment',
      );
    }
    const values = {
      name: dto.name.trim(),
      oidcIssuer: dto.oidcIssuer,
      oidcClientId: dto.oidcClientId.trim(),
      oidcClientSecret: dto.oidcClientSecret
        ? this.encryption.encrypt(dto.oidcClientSecret)
        : existing.oidcClientSecret,
      isEnabled: dto.isEnabled,
      allowSignup: dto.allowSignup,
      updatedAt: new Date(),
    };
    if (!values.name || !values.oidcClientId)
      throw new BadRequestException('Name and client ID are required');
    // Administrators must still be able to disable an unreachable provider.
    if (dto.isEnabled || !existing) {
      try {
        await this.configuration(values);
      } catch {
        throw new BadRequestException(
          'OIDC discovery failed. Check the issuer, TLS and outbound network policy.',
        );
      }
    }
    const result = await this.db.transaction().execute(async (trx) => {
      // Serialize provider changes with identity linking and prevent locking out enforced workspaces.
      await trx
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', workspace.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (existing) {
        const current = await trx
          .selectFrom('authProviders')
          .selectAll()
          .where('id', '=', existing.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (current.updatedAt.getTime() !== existing.updatedAt.getTime())
          throw new BadRequestException('Provider changed; reload and retry');
        if (current.oidcIssuer !== values.oidcIssuer) {
          const account = await trx
            .selectFrom('authAccounts')
            .select('id')
            .where('authProviderId', '=', existing.id)
            .executeTakeFirst();
          if (account)
            throw new BadRequestException(
              'Create a new provider to change an issuer with linked accounts',
            );
        }
        if (!values.isEnabled)
          await this.checkRemainingProvider(trx, workspace.id, existing.id);
        return trx
          .updateTable('authProviders')
          .set(values)
          .where('id', '=', existing.id)
          .returning(publicFields)
          .executeTakeFirstOrThrow();
      }
      return trx
        .insertInto('authProviders')
        .values({
          ...values,
          type: 'oidc',
          workspaceId: workspace.id,
          creatorId,
        })
        .returning(publicFields)
        .executeTakeFirstOrThrow();
    });
    this.audit.log({
      event: existing
        ? AuditEvent.SSO_PROVIDER_UPDATED
        : AuditEvent.SSO_PROVIDER_CREATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: result.id,
    });
    return { ...result, callbackUrl: this.callbackUrl(workspace, result.id) };
  }

  private async checkRemainingProvider(
    trx: KyselyTransaction,
    workspaceId: string,
    id: string,
  ) {
    const workspace = await trx
      .selectFrom('workspaces')
      .select('enforceSso')
      .where('id', '=', workspaceId)
      .executeTakeFirstOrThrow();
    if (!workspace.enforceSso) return;
    const other = await trx
      .selectFrom('authProviders')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('id', '!=', id)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!other)
      throw new BadRequestException(
        'Cannot remove the last enabled provider while SSO is enforced',
      );
  }

  async remove(id: string, workspaceId: string) {
    await this.provider(id, workspaceId);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', workspaceId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await this.checkRemainingProvider(trx, workspaceId, id);
      await trx
        .deleteFrom('authProviders')
        .where('id', '=', id)
        .where('workspaceId', '=', workspaceId)
        .where('type', '=', 'oidc')
        .execute();
    });
    this.audit.log({
      event: AuditEvent.SSO_PROVIDER_DELETED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: id,
    });
  }

  callbackUrl(workspace: Workspace, id: string) {
    return `${this.domain.getUrl(workspace.hostname)}/api/sso/oidc/${id}/callback`;
  }

  private async configuration(
    provider: Pick<
      Provider,
      'oidcIssuer' | 'oidcClientId' | 'oidcClientSecret'
    >,
  ) {
    const secret = this.encryption.decrypt(provider.oidcClientSecret);
    const guardedFetch: oidc.CustomFetch = async (url, options) => {
      // Pin every discovery, token, UserInfo and JWKS request; never follow redirects.
      const lease = await this.outbound.lease(url);
      try {
        const response = await undiciFetch(url, {
          ...options,
          body: options.body as NonNullable<
            Parameters<typeof undiciFetch>[1]
          >['body'],
          dispatcher: lease.dispatcher,
          redirect: 'manual',
        });
        return new Response(await response.arrayBuffer(), {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers),
        });
      } finally {
        await lease.release();
      }
    };
    const discovered = await oidc.discovery(
      new URL(provider.oidcIssuer),
      provider.oidcClientId,
      secret,
      undefined,
      {
        timeout: 10,
        [oidc.customFetch]: guardedFetch,
      },
    );
    const metadata = discovered.serverMetadata();
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri,
    ]) {
      if (!endpoint)
        throw new BadRequestException('Required OIDC endpoint is missing');
      const url = new URL(endpoint);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new BadRequestException(
          'OIDC endpoints must use HTTPS without credentials or fragments',
        );
      }
    }
    const methods = metadata.token_endpoint_auth_methods_supported ?? [
      'client_secret_basic',
    ];
    if (
      !methods.includes('client_secret_basic') &&
      !methods.includes('client_secret_post')
    ) {
      throw new BadRequestException(
        'Provider must support client_secret_basic or client_secret_post',
      );
    }
    const config = new oidc.Configuration(
      metadata,
      provider.oidcClientId,
      secret,
      methods.includes('client_secret_basic')
        ? oidc.ClientSecretBasic(secret)
        : oidc.ClientSecretPost(secret),
    );
    config[oidc.customFetch] = guardedFetch;
    config.timeout = 10;
    oidc.enableNonRepudiationChecks(config);
    return config;
  }

  private revision(provider: Provider) {
    return createHash('sha256')
      .update(
        JSON.stringify([
          provider.oidcIssuer,
          provider.oidcClientId,
          provider.oidcClientSecret,
          provider.updatedAt,
        ]),
      )
      .digest('hex');
  }

  async start(id: string, workspace: Workspace, redirect?: string) {
    const provider = await this.provider(id, workspace.id);
    if (!provider.isEnabled)
      throw new UnauthorizedException('OIDC provider is disabled');
    const config = await this.configuration(provider);
    const state = oidc.randomState();
    const verifier = oidc.randomPKCECodeVerifier();
    const nonce = oidc.randomNonce();
    const browser = randomBytes(32).toString('base64url');
    // Parse against a fixed origin so protocol-relative paths and backslashes cannot escape it.
    const base = this.domain.getUrl(workspace.hostname);
    let destination = '/home';
    if (redirect?.startsWith('/')) {
      const parsed = new URL(redirect, base);
      if (
        parsed.origin === new URL(base).origin &&
        !parsed.pathname.startsWith('/api/') &&
        !parsed.pathname.startsWith('/login')
      ) {
        destination = parsed.pathname + parsed.search + parsed.hash;
      }
    }
    const transaction: LoginState = {
      workspaceId: workspace.id,
      providerId: id,
      revision: this.revision(provider),
      verifier,
      nonce,
      browser,
      redirect: destination,
    };
    await this.redis.set(
      `oidc:state:${state}`,
      JSON.stringify(transaction),
      'EX',
      600,
    );
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.callbackUrl(workspace, id),
      scope: 'openid email profile',
      response_type: 'code',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    });
    return { url: url.href, browser };
  }

  async finish(
    id: string,
    workspace: Workspace,
    query: string,
    browser?: string,
  ) {
    let stage = 'transaction validation';
    try {
      const url = new URL(this.callbackUrl(workspace, id) + query);
      const state = url.searchParams.get('state');
      if (!browser)
        throw new UnauthorizedException('OIDC transaction cookie is missing');
      if (
        !state ||
        state.length > 128 ||
        url.searchParams.getAll('state').length !== 1
      )
        throw new UnauthorizedException('Invalid OIDC transaction');
      const key = `oidc:state:${state}`;
      // Consume once, only for the initiating browser, workspace and provider.
      const raw = await this.redis.eval(
        "local v = redis.call('GET', KEYS[1]); if not v then return nil end; local s = cjson.decode(v); if s.browser ~= ARGV[1] or s.workspaceId ~= ARGV[2] or s.providerId ~= ARGV[3] then return nil end; redis.call('DEL', KEYS[1]); return v",
        1,
        key,
        browser,
        workspace.id,
        id,
      );
      if (typeof raw !== 'string')
        throw new UnauthorizedException('Invalid or expired OIDC transaction');
      const transaction = JSON.parse(raw) as LoginState;
      stage = 'provider lookup';
      const provider = await this.provider(id, workspace.id);
      if (
        !provider.isEnabled ||
        this.revision(provider) !== transaction.revision
      )
        throw new UnauthorizedException('OIDC provider changed');
      stage = 'provider discovery';
      const config = await this.configuration(provider);
      stage = 'code exchange and ID token validation';
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new UnauthorizedException('Missing OIDC subject');
      stage = 'UserInfo retrieval';
      let profile: {
        email?: unknown;
        email_verified?: unknown;
        name?: unknown;
      } = {
        email: claims.email,
        email_verified: claims.email_verified,
        name: claims.name,
      };
      if (
        (!profile.email || profile.email_verified === undefined) &&
        config.serverMetadata().userinfo_endpoint
      ) {
        profile = await oidc.fetchUserInfo(
          config,
          tokens.access_token,
          claims.sub,
        );
      }
      stage = 'account linking and provisioning';
      const user = await this.db.transaction().execute(async (trx) => {
        const current = await trx
          .selectFrom('authProviders')
          .selectAll()
          .where('id', '=', id)
          .where('workspaceId', '=', workspace.id)
          .forUpdate()
          .executeTakeFirst();
        if (
          !current?.isEnabled ||
          current.deletedAt ||
          this.revision(current) !== transaction.revision
        )
          throw new UnauthorizedException('OIDC provider changed');
        const account = await trx
          .selectFrom('authAccounts')
          .selectAll()
          .where('authProviderId', '=', id)
          .where('providerUserId', '=', claims.sub)
          .where('workspaceId', '=', workspace.id)
          .executeTakeFirst();
        if (account?.deletedAt)
          throw new UnauthorizedException('Account is disabled');
        let user = account
          ? await this.users.findById(account.userId, workspace.id, {
              trx,
              includeUserMfa: true,
            })
          : undefined;
        if (!account) {
          if (typeof profile.email !== 'string' || !isEmail(profile.email)) {
            throw new UnauthorizedException(
              'OIDC email claim is missing or invalid',
            );
          }
          if (profile.email_verified !== true) {
            throw new UnauthorizedException(
              'OIDC email_verified claim must be true',
            );
          }
          const email = profile.email.toLowerCase();
          user = await this.users.findByEmail(email, workspace.id, {
            trx,
            includeUserMfa: true,
          });
          if (!user) {
            if (!current.allowSignup)
              throw new UnauthorizedException(
                'OIDC signup is disabled; ask an administrator to create your account',
              );
            if (
              workspace.emailDomains?.length &&
              !workspace.emailDomains.some(
                (domain) => domain.toLowerCase() === email.split('@')[1],
              )
            ) {
              throw new UnauthorizedException('Email domain is not allowed');
            }
            user = await this.signup.signup(
              {
                email,
                name:
                  typeof profile.name === 'string'
                    ? profile.name.slice(0, 50)
                    : undefined,
                password: randomBytes(32).toString('base64url'),
              },
              workspace.id,
              trx,
            );
            await this.users.updateUser(
              {
                emailVerifiedAt: new Date(),
                hasGeneratedPassword: true,
                role: UserRole.MEMBER,
              },
              user.id,
              workspace.id,
              trx,
            );
            user.role = UserRole.MEMBER;
          }
          if (isUserDisabled(user))
            throw new UnauthorizedException('Account is disabled');
          const linked = await trx
            .selectFrom('authAccounts')
            .select('id')
            .where('authProviderId', '=', id)
            .where('userId', '=', user.id)
            .executeTakeFirst();
          if (linked)
            throw new UnauthorizedException(
              'Account is already linked to a different OIDC subject',
            );
          await trx
            .insertInto('authAccounts')
            .values({
              userId: user.id,
              providerUserId: claims.sub,
              authProviderId: id,
              workspaceId: workspace.id,
            })
            .execute();
        }
        if (!user || isUserDisabled(user))
          throw new UnauthorizedException('Account is disabled');
        // CE has no MFA challenge implementation. Fail closed for existing MFA policies.
        if (workspace.enforceMfa || user['mfa']?.isEnabled)
          throw new UnauthorizedException(
            'This account requires MFA, which is not supported by the CE OIDC flow',
          );
        await this.users.updateUser(
          { lastLoginAt: new Date() },
          user.id,
          workspace.id,
          trx,
        );
        return user;
      });
      stage = 'session creation';
      this.audit.setActorId(user.id);
      this.audit.log({
        event: AuditEvent.USER_LOGIN,
        resourceType: AuditResource.USER,
        resourceId: user.id,
        metadata: { source: 'oidc', providerId: id },
      });
      return {
        token: await this.sessions.createSessionAndToken(user),
        redirect: transaction.redirect,
      };
    } catch (error) {
      throw new OidcFlowError(stage, error);
    }
  }
}
