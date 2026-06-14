import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

import { MetadataProviderKey } from '@bookorbit/types';

export class LookupMetadataDto {
  @IsEnum(MetadataProviderKey)
  provider: MetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  id: string;

  @IsOptional()
  @IsBoolean()
  isAudiobook?: boolean;

  @IsOptional()
  @IsNumber()
  pageCount?: number;
}
