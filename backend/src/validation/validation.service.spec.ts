import { BadGatewayException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { DssValidationResponse, UploadedDocumentFile } from './dss.types'
import { TRUST_PROFILES } from './trust-profiles'
import { ValidationService } from './validation.service'

const SAMPLE_FILE: UploadedDocumentFile = {
  originalname: 'sealed.pdf',
  mimetype: 'application/pdf',
  size: 10,
  buffer: Buffer.from('%PDF-1.7'),
}

function makeDssResponse(overrides: {
  indication?: string
  subIndication?: string | null
  trustedRoot?: boolean
  tsaTrusted?: boolean
  tsaIndication?: string
  tsaTime?: string
  subjectDn?: string
  intact?: boolean
  sigValid?: boolean
  signaturesCount?: number
}): DssValidationResponse {
  const count = overrides.signaturesCount ?? 1
  if (count === 0) {
    return {
      SimpleReport: {
        ValidSignaturesCount: 0,
        SignaturesCount: 0,
        signatureOrTimestampOrEvidenceRecord: [],
      },
      DiagnosticData: { Signature: [], Certificate: [] },
    }
  }
  const tsaTime = overrides.tsaTime ?? '2024-06-12T23:22:44Z'
  return {
    SimpleReport: {
      ValidSignaturesCount: overrides.indication === 'TOTAL_PASSED' ? 1 : 0,
      SignaturesCount: 1,
      signatureOrTimestampOrEvidenceRecord: [
        {
          Signature: {
            Id: 'SIG-1',
            SignedBy: 'Signer Name',
            SignatureFormat: 'PAdES-BASELINE-T',
            SigningTime: '2024-06-12T23:22:43Z',
            BestSignatureTime: '2026-11-20T02:53:22Z',
            Indication: overrides.indication ?? 'TOTAL_PASSED',
            SubIndication: overrides.subIndication ?? null,
            CertificateChain: {
              Certificate: [
                { Id: 'CERT-1', trusted: null },
                { Id: 'ROOT-1', trusted: overrides.trustedRoot ?? true },
              ],
            },
            Timestamps: {
              Timestamp: [
                {
                  Id: 'TS-1',
                  ProductionTime: tsaTime,
                  Indication: overrides.tsaIndication ?? 'PASSED',
                  CertificateChain: {
                    Certificate: [{ Id: 'ROOT-1', trusted: overrides.tsaTrusted ?? true }],
                  },
                },
              ],
            },
            AdESValidationDetails: {
              Error:
                overrides.indication === 'TOTAL_PASSED'
                  ? []
                  : [{ value: 'Validation issue', Key: 'ERR' }],
              Warning: [],
            },
          },
        },
      ],
    },
    DiagnosticData: {
      Signature: [
        {
          Id: 'SIG-1',
          BasicSignature: {
            SignatureIntact: overrides.intact ?? true,
            SignatureValid: overrides.sigValid ?? true,
          },
          SigningCertificate: { Certificate: 'CERT-1' },
        },
      ],
      Certificate: [
        {
          Id: 'CERT-1',
          SubjectDistinguishedName: [
            {
              Format: 'RFC2253',
              value:
                overrides.subjectDn ??
                'UID=41368+CN=Joshua Bartley -- P. Eng. - EGBC,OU=EGBC - Engineers and Geoscientists of British Columbia,O=CertifiO Pro,C=CA',
            },
          ],
        },
      ],
    },
  }
}

describe('ValidationService', () => {
  let service: ValidationService
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const config = { get: vi.fn().mockReturnValue('http://dss:8080/') } as unknown as ConfigService
    service = new ValidationService(config)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns unsigned when SignaturesCount is 0', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeDssResponse({ signaturesCount: 0 })), { status: 200 }),
    )

    const result = await service.validateDocument(SAMPLE_FILE, TRUST_PROFILES['portage-notarius'])
    expect(result.status).toBe('unsigned')
    expect(result.signatures).toEqual([])
  })

  it('returns valid for TOTAL_PASSED EGBC signature without historical re-check', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(makeDssResponse({ indication: 'TOTAL_PASSED' })), {
        status: 200,
      }),
    )

    const result = await service.validateDocument(SAMPLE_FILE, TRUST_PROFILES['portage-notarius'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('valid')
    expect(result.approvedSignaturesCount).toBe(1)
    expect(result.signatures[0]?.approvedOrg).toBe('EGBC')
    expect(result.signatures[0]?.historicalLtv).toBe(false)
  })

  it('re-validates historical PAdES-T seal at trusted TSA timestamp and accepts when TOTAL_PASSED', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeDssResponse({
              indication: 'INDETERMINATE',
              subIndication: 'OUT_OF_BOUNDS_NO_POE',
            }),
          ),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeDssResponse({ indication: 'TOTAL_PASSED' })), {
          status: 200,
        }),
      )

    const result = await service.validateDocument(SAMPLE_FILE, TRUST_PROFILES['portage-notarius'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as { body: string }).body) as {
      validationTime?: string
    }
    expect(secondBody.validationTime).toBe('2024-06-12T23:22:44Z')
    expect(result.status).toBe('valid')
    expect(result.signatures[0]?.historicalLtv).toBe(true)
    expect(result.signatures[0]?.warnings[0]).toContain('Validated at trusted TSA timestamp')
  })

  it('flags valid non-EGBC/AIBC/FPBC signature as unapproved_org under portage-notarius but valid under default', async () => {
    const nonApproved = makeDssResponse({
      indication: 'TOTAL_PASSED',
      subjectDn:
        'UID=h2test+CN=Test - H2 -- Notarius,OU=Solutions Notarius,O=CertifiO Test - AATL,C=CA',
    })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(nonApproved), { status: 200 }))
    const restricted = await service.validateDocument(
      SAMPLE_FILE,
      TRUST_PROFILES['portage-notarius'],
    )
    expect(restricted.status).toBe('unapproved_org')
    expect(restricted.approvedSignaturesCount).toBe(0)

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(nonApproved), { status: 200 }))
    const general = await service.validateDocument(SAMPLE_FILE, TRUST_PROFILES['default'])
    expect(general.status).toBe('valid')
  })

  it('rejects tampered PDF (TOTAL_FAILED) without performing historical re-check', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeDssResponse({
            indication: 'TOTAL_FAILED',
            subIndication: 'HASH_FAILURE',
            intact: false,
            sigValid: false,
          }),
        ),
        { status: 200 },
      ),
    )

    const result = await service.validateDocument(SAMPLE_FILE, TRUST_PROFILES['portage-notarius'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('invalid')
    expect(result.signatures[0]?.valid).toBe(false)
    expect(result.signatures[0]?.subIndication).toBe('HASH_FAILURE')
  })

  it('throws BadGatewayException and logs when DSS is unreachable or returns HTTP 500', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(
      service.validateDocument(SAMPLE_FILE, TRUST_PROFILES['portage-notarius']),
    ).rejects.toThrow(BadGatewayException)
    expect(logSpy).toHaveBeenCalledWith('EU DSS request failed: ECONNREFUSED')

    fetchMock.mockResolvedValueOnce(new Response('Internal Error', { status: 500 }))
    await expect(
      service.validateDocument(SAMPLE_FILE, TRUST_PROFILES['portage-notarius']),
    ).rejects.toThrow(BadGatewayException)
    expect(logSpy).toHaveBeenCalledWith('EU DSS returned HTTP 500')
  })
})
