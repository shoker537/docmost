import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class OidcProviderIdDto {
  @IsUUID()
  providerId: string;
}

export class SaveOidcProviderDto {
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  oidcIssuer: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  oidcClientId: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  oidcClientSecret?: string;

  @IsBoolean()
  isEnabled: boolean;

  @IsBoolean()
  allowSignup: boolean;
}
