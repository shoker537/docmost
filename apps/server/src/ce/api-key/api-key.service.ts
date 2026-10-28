import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectKysely } from 'nestjs-kysely';
import { randomUUID } from 'node:crypto';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { JwtApiKeyPayload, JwtType } from '../../core/auth/dto/jwt-payload';
import { isUserDisabled } from '../../common/helpers';
import { UserRole } from '../../common/helpers/types/permission';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly jwt: JwtService,
    private readonly environment: EnvironmentService,
    private readonly users: UserRepo,
    private readonly workspaces: WorkspaceRepo,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {}

  private isAdmin(user: User) {
    return user.role === UserRole.ADMIN || user.role === UserRole.OWNER;
  }

  private assertAccess(user: User, workspace: Workspace) {
    if (workspace.id !== user.workspaceId || isUserDisabled(user))
      throw new UnauthorizedException();
    const settings = workspace.settings as {
      api?: { restrictToAdmins?: boolean };
    } | null;
    if (settings?.api?.restrictToAdmins && !this.isAdmin(user)) {
      throw new ForbiddenException(
        'API access is restricted to workspace administrators',
      );
    }
  }

  async list(user: User, workspace: Workspace, pagination: PaginationOptions) {
    if (pagination.adminView && !this.isAdmin(user))
      throw new ForbiddenException();
    let query = this.db
      .selectFrom('apiKeys as key')
      .select([
        'key.id',
        'key.name',
        'key.expiresAt',
        'key.lastUsedAt',
        'key.createdAt',
        'key.updatedAt',
        'key.creatorId',
        'key.workspaceId',
      ])
      .select((eb) =>
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select([
              'users.id',
              'users.name',
              'users.email',
              'users.avatarUrl',
            ])
            .whereRef('users.id', '=', 'key.creatorId'),
        ).as('creator'),
      )
      .where('key.workspaceId', '=', workspace.id)
      .where('key.deletedAt', 'is', null);
    if (!pagination.adminView)
      query = query.where('key.creatorId', '=', user.id);
    if (pagination.query)
      query = query.where('key.name', 'ilike', `%${pagination.query}%`);
    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [
        { expression: 'key.createdAt', direction: 'desc', key: 'createdAt' },
        { expression: 'key.id', direction: 'desc', key: 'id' },
      ],
      parseCursor: (cursor) => ({
        createdAt: new Date(cursor.createdAt),
        id: cursor.id,
      }),
    });
  }

  async create(dto: CreateApiKeyDto, user: User, workspace: Workspace) {
    this.assertAccess(user, workspace);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    // JWT NumericDate has whole-second precision; do not round an expiry later.
    const expires = expiresAt
      ? Math.floor(expiresAt.getTime() / 1000)
      : undefined;
    if (
      expires !== undefined &&
      (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000))
    ) {
      throw new BadRequestException('Expiration must be in the future');
    }
    const id = randomUUID();
    const payload: JwtApiKeyPayload & { jti: string; exp?: number } = {
      sub: user.id,
      workspaceId: workspace.id,
      apiKeyId: id,
      type: JwtType.API_KEY,
      jti: randomUUID(),
      ...(expires !== undefined ? { exp: expires } : {}),
    };
    // This module's JwtService has no default expiresIn. No-expiration keys truly
    // have no exp claim, unlike the normal browser session's configured lifetime.
    const token = await this.jwt.signAsync(payload, {
      secret: this.environment.getAppSecret(),
      algorithm: 'HS256',
      issuer: 'Docmost',
    });
    const key = await this.db
      .insertInto('apiKeys')
      .values({
        id,
        name: dto.name,
        creatorId: user.id,
        workspaceId: workspace.id,
        expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    this.audit.log({
      event: AuditEvent.API_KEY_CREATED,
      resourceType: AuditResource.API_KEY,
      resourceId: key.id,
    });
    // The token is returned once and is never persisted or recoverable via list.
    return { ...key, token };
  }

  private async manageable(id: string, user: User, workspace: Workspace) {
    const key = await this.db
      .selectFrom('apiKeys')
      .select('id')
      .where('id', '=', id)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .$if(!this.isAdmin(user), (qb) => qb.where('creatorId', '=', user.id))
      .executeTakeFirst();
    if (!key) throw new NotFoundException('API key not found');
  }

  async rename(dto: UpdateApiKeyDto, user: User, workspace: Workspace) {
    await this.manageable(dto.apiKeyId, user, workspace);
    const key = await this.db
      .updateTable('apiKeys')
      .set({ name: dto.name, updatedAt: new Date() })
      .where('id', '=', dto.apiKeyId)
      .where('workspaceId', '=', workspace.id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
    this.audit.log({
      event: AuditEvent.API_KEY_UPDATED,
      resourceType: AuditResource.API_KEY,
      resourceId: key.id,
    });
    return key;
  }

  async revoke(id: string, user: User, workspace: Workspace) {
    await this.manageable(id, user, workspace);
    await this.db
      .updateTable('apiKeys')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspace.id)
      .execute();
    this.audit.log({
      event: AuditEvent.API_KEY_DELETED,
      resourceType: AuditResource.API_KEY,
      resourceId: id,
    });
  }

  async validateApiKey(payload: JwtApiKeyPayload) {
    const key = await this.db
      .selectFrom('apiKeys')
      .select(['id', 'expiresAt'])
      .where('id', '=', payload.apiKeyId)
      .where('workspaceId', '=', payload.workspaceId)
      .where('creatorId', '=', payload.sub)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!key || (key.expiresAt && key.expiresAt.getTime() <= Date.now())) {
      throw new UnauthorizedException('Invalid or expired API key');
    }
    const [user, workspace] = await Promise.all([
      this.users.findById(payload.sub, payload.workspaceId),
      this.workspaces.findById(payload.workspaceId),
    ]);
    if (!user || !workspace || isUserDisabled(user))
      throw new UnauthorizedException();
    this.assertAccess(user, workspace);
    await this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', key.id)
      .where((eb) =>
        eb.or([
          eb('lastUsedAt', 'is', null),
          eb('lastUsedAt', '<', new Date(Date.now() - 60_000)),
        ]),
      )
      .execute();
    this.audit.setActorType('api_key');
    return { user, workspace, apiKeyId: key.id };
  }
}
