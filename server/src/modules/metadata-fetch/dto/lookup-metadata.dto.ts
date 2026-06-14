import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { MetadataProviderKey } from '@bookorbit/types';

export class LookupMetadataDto {
  @IsEnum(MetadataProviderKey)
  provider: MetadataProviderKey;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  id: string;

  @IsOptional()
  isAudiobook?: boolean;

  @IsOptional()
  pageCount?: number;
}
