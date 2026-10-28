import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequireSessionAuth } from '../../common/decorators/require-session-auth.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { ApiKeyService } from './api-key.service';
import {
  ApiKeyIdDto,
  CreateApiKeyDto,
  UpdateApiKeyDto,
} from './dto/api-key.dto';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
@RequireSessionAuth()
export class ApiKeyController {
  constructor(private readonly keys: ApiKeyService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  list(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: PaginationOptions,
  ) {
    return this.keys.list(user, workspace, dto);
  }

  @Post('create')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  create(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.keys.create(dto, user, workspace);
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  update(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.keys.rename(dto, user, workspace);
  }

  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: ApiKeyIdDto,
  ) {
    return this.keys.revoke(dto.apiKeyId, user, workspace);
  }
}
