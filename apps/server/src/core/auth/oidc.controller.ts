import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  ALL_NAMED_THROTTLERS_SKIPPED,
  AUTH_THROTTLER,
} from '../../integrations/throttle/throttler-names';
import { OIDC_COOKIE, OidcService } from './services/oidc.service';
import {
  OidcProviderIdDto,
  SaveOidcProviderDto,
} from './dto/oidc-provider.dto';
import { OidcFlowError, oidcErrorReason } from './oidc-error';

@Controller('sso/oidc')
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly environment: EnvironmentService,
  ) {}

  private checkAdmin(user: User) {
    if (
      !this.environment.isSelfHosted() ||
      ![UserRole.OWNER, UserRole.ADMIN].includes(user.role as UserRole)
    ) {
      throw new ForbiddenException();
    }
  }

  @Post('providers')
  @UseGuards(JwtAuthGuard)
  @RequireSessionAuth()
  @HttpCode(HttpStatus.OK)
  list(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    this.checkAdmin(user);
    return this.oidc.list(workspace);
  }

  @Post('save')
  @UseGuards(JwtAuthGuard)
  @RequireSessionAuth()
  @HttpCode(HttpStatus.OK)
  save(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: SaveOidcProviderDto,
  ) {
    this.checkAdmin(user);
    return this.oidc.save(dto, workspace, user.id);
  }

  @Post('delete')
  @UseGuards(JwtAuthGuard)
  @RequireSessionAuth()
  @HttpCode(HttpStatus.OK)
  remove(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: OidcProviderIdDto,
  ) {
    this.checkAdmin(user);
    return this.oidc.remove(dto.providerId, workspace.id);
  }

  @Get(':providerId/login')
  @SkipThrottle({ ...ALL_NAMED_THROTTLERS_SKIPPED, [AUTH_THROTTLER]: false })
  @UseGuards(ThrottlerGuard)
  async login(
    @Param('providerId', ParseUUIDPipe) id: string,
    @AuthWorkspace() workspace: Workspace,
    @Query('redirect') redirect: string,
    @Res() reply: FastifyReply,
  ) {
    if (!this.environment.isSelfHosted()) throw new ForbiddenException();
    reply.header('Cache-Control', 'no-store');
    try {
      const result = await this.oidc.start(
        id,
        workspace,
        typeof redirect === 'string' ? redirect : undefined,
      );
      reply.setCookie(OIDC_COOKIE, result.browser, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.environment.isHttps(),
        path: '/api/sso/oidc',
        maxAge: 600,
      });
      return reply.redirect(result.url, HttpStatus.FOUND);
    } catch (error) {
      this.logger.warn(
        `OIDC login could not start for provider ${id}: ${oidcErrorReason(error)}`,
      );
      return reply.redirect('/login?oidcError=1', HttpStatus.FOUND);
    }
  }

  @Get(':providerId/callback')
  @SkipThrottle({ ...ALL_NAMED_THROTTLERS_SKIPPED, [AUTH_THROTTLER]: false })
  @UseGuards(ThrottlerGuard)
  async callback(
    @Param('providerId', ParseUUIDPipe) id: string,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    if (!this.environment.isSelfHosted()) throw new ForbiddenException();
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.clearCookie(OIDC_COOKIE, { path: '/api/sso/oidc' });
    try {
      const queryIndex = request.url.indexOf('?');
      const result = await this.oidc.finish(
        id,
        workspace,
        queryIndex < 0 ? '' : request.url.slice(queryIndex),
        request.cookies[OIDC_COOKIE],
      );
      reply.setCookie('authToken', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        expires: this.environment.getCookieExpiresIn(),
        secure: this.environment.isHttps(),
      });
      return reply.redirect(result.redirect, HttpStatus.FOUND);
    } catch (error) {
      // Avoid exposing identity-provider responses, codes, tokens or secrets.
      const reason =
        error instanceof OidcFlowError ? error.message : oidcErrorReason(error);
      this.logger.warn(`OIDC callback failed for provider ${id}: ${reason}`);
      return reply.redirect('/login?oidcError=1', HttpStatus.FOUND);
    }
  }
}
