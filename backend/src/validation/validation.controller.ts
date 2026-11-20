import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { UploadedDocumentFile, ValidationResponseDto } from './dss.types'
import { resolveTrustProfile } from './trust-profiles'
import { ValidationService } from './validation.service'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

@ApiTags('validation')
@Controller({ path: 'validate', version: '1' })
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiOperation({ summary: 'Validate digital signatures on an uploaded document' })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'profile',
    required: false,
    enum: ['portage-notarius', 'default'],
    description: 'Trust profile to evaluate against (defaults to portage-notarius)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Normalized signature validation result' })
  @ApiResponse({ status: 400, description: 'Missing file or unknown trust profile' })
  @ApiResponse({ status: 502, description: 'Validation engine unavailable' })
  async validate(
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Query('profile') profileName?: string,
  ): Promise<ValidationResponseDto> {
    if (!file || file.buffer.length === 0) {
      throw new BadRequestException('A non-empty file upload field named "file" is required')
    }
    const profile = resolveTrustProfile(profileName)
    if (!profile) {
      throw new BadRequestException(`Unknown trust profile: ${profileName}`)
    }
    return this.validationService.validateDocument(file, profile)
  }
}
