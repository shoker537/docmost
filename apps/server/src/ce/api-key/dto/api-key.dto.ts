import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string;
}

export class ApiKeyIdDto {
  @IsUUID()
  apiKeyId: string;
}

export class UpdateApiKeyDto extends ApiKeyIdDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
