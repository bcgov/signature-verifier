import { BadRequestException } from '@nestjs/common'
import type { TestingModule } from '@nestjs/testing'
import { Test } from '@nestjs/testing'
import { ValidationController } from './validation.controller'
import { ValidationService } from './validation.service'
import type { UploadedDocumentFile, ValidationResponseDto } from './dss.types'

describe('ValidationController', () => {
  let controller: ValidationController
  let validateDocument: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    validateDocument = vi.fn()
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ValidationController],
      providers: [{ provide: ValidationService, useValue: { validateDocument } }],
    }).compile()

    controller = module.get<ValidationController>(ValidationController)
  })

  it('rejects missing or empty file upload', async () => {
    await expect(controller.validate(undefined)).rejects.toThrow(BadRequestException)
    await expect(
      controller.validate({
        originalname: 'empty.pdf',
        mimetype: 'application/pdf',
        size: 0,
        buffer: Buffer.alloc(0),
      }),
    ).rejects.toThrow(BadRequestException)
  })

  it('rejects unknown trust profile', async () => {
    const file: UploadedDocumentFile = {
      originalname: 'doc.pdf',
      mimetype: 'application/pdf',
      size: 4,
      buffer: Buffer.from('%PDF'),
    }
    await expect(controller.validate(file, 'nonexistent')).rejects.toThrow(BadRequestException)
  })

  it('delegates to ValidationService with portage-notarius by default', async () => {
    const expected: ValidationResponseDto = {
      status: 'unsigned',
      profile: 'portage-notarius',
      documentName: 'doc.pdf',
      signaturesCount: 0,
      validSignaturesCount: 0,
      approvedSignaturesCount: 0,
      signatures: [],
    }
    validateDocument.mockResolvedValueOnce(expected)

    const file: UploadedDocumentFile = {
      originalname: 'doc.pdf',
      mimetype: 'application/pdf',
      size: 4,
      buffer: Buffer.from('%PDF'),
    }
    const result = await controller.validate(file)
    expect(result).toEqual(expected)
    expect(validateDocument).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ name: 'portage-notarius' }),
    )
  })
})
