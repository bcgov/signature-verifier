import { BadGatewayException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type {
  DssDiagnosticCertificate,
  DssDiagnosticSignature,
  DssSimpleSignature,
  DssTimestamp,
  DssValidationResponse,
  UploadedDocumentFile,
  ValidatedSignatureDto,
  ValidationResponseDto,
  ValidationStatus,
} from './dss.types'
import { matchApprovedOrg, type TrustProfileConfig } from './trust-profiles'

const DSS_VALIDATE_PATH = '/services/rest/validation/validateSignature'
const DSS_TIMEOUT_MS = 55_000
const HISTORICAL_SUB_INDICATIONS = new Set([
  'OUT_OF_BOUNDS_NO_POE',
  'REVOCATION_OUT_OF_BOUNDS_NO_POE',
])

/**
 * Orchestrates signature validation via the configured EU DSS REST service
 * and normalizes results against a trust profile.
 */
@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name)
  private readonly dssUrl: string

  constructor(private readonly configService: ConfigService) {
    const rawUrl = this.configService.get<string>('DSS_URL') ?? 'http://localhost:8080'
    this.dssUrl = rawUrl.replace(/\/+$/, '')
  }

  /**
   * Validate an uploaded document against the selected trust profile.
   */
  async validateDocument(
    file: UploadedDocumentFile,
    profile: TrustProfileConfig,
  ): Promise<ValidationResponseDto> {
    const initial = await this.callDssValidate(file.buffer, file.originalname)
    const simple = initial.SimpleReport
    const sigWrappers = simple?.signatureOrTimestampOrEvidenceRecord ?? []
    const signaturesCount = simple?.SignaturesCount ?? sigWrappers.length

    if (signaturesCount === 0 || sigWrappers.length === 0) {
      return {
        status: 'unsigned',
        profile: profile.name,
        documentName: file.originalname,
        signaturesCount: 0,
        validSignaturesCount: 0,
        approvedSignaturesCount: 0,
        signatures: [],
      }
    }

    const diagSigs = new Map<string, DssDiagnosticSignature>()
    for (const ds of initial.DiagnosticData?.Signature ?? []) {
      if (ds.Id) {
        diagSigs.set(ds.Id, ds)
      }
    }
    const diagCerts = new Map<string, DssDiagnosticCertificate>()
    for (const cert of initial.DiagnosticData?.Certificate ?? []) {
      if (cert.Id) {
        diagCerts.set(cert.Id, cert)
      }
    }

    const historicalCache = new Map<string, DssValidationResponse>()
    const signatures: ValidatedSignatureDto[] = []

    for (const wrapper of sigWrappers) {
      const sig = wrapper.Signature
      if (!sig) {
        continue
      }
      const normalized = await this.evaluateSignature(
        sig,
        diagSigs.get(sig.Id ?? ''),
        diagCerts,
        profile,
        file,
        historicalCache,
      )
      signatures.push(normalized)
    }

    const validSignaturesCount = signatures.filter((s) => s.valid).length
    const approvedSignaturesCount = signatures.filter(
      (s) => s.valid && s.approvedOrg !== null,
    ).length
    const status = this.computeOverallStatus(signatures, profile)

    return {
      status,
      profile: profile.name,
      documentName: file.originalname,
      signaturesCount: signatures.length,
      validSignaturesCount,
      approvedSignaturesCount,
      signatures,
    }
  }

  private computeOverallStatus(
    signatures: readonly ValidatedSignatureDto[],
    profile: TrustProfileConfig,
  ): ValidationStatus {
    if (signatures.length === 0) {
      return 'unsigned'
    }
    if (signatures.some((s) => !s.valid)) {
      return 'invalid'
    }
    if (profile.approvedOrgRules.length > 0 && !signatures.some((s) => s.approvedOrg !== null)) {
      return 'unapproved_org'
    }
    return 'valid'
  }

  private async evaluateSignature(
    sig: DssSimpleSignature,
    diagSig: DssDiagnosticSignature | undefined,
    diagCerts: ReadonlyMap<string, DssDiagnosticCertificate>,
    profile: TrustProfileConfig,
    file: UploadedDocumentFile,
    historicalCache: Map<string, DssValidationResponse>,
  ): Promise<ValidatedSignatureDto> {
    const id = sig.Id ?? ''
    const subjectName = this.extractSubjectName(diagSig, diagCerts)
    const approvedOrg = matchApprovedOrg(subjectName, profile)
    const trustedChain = this.reachesTrustedRoot(sig)
    const indication = sig.Indication ?? 'UNKNOWN'
    const subIndication = sig.SubIndication ?? null
    const trustedTsa = this.findTrustedTimestamp(sig)
    const errors = this.collectMessages(sig.AdESValidationDetails?.Error)
    const warnings = this.collectMessages(sig.AdESValidationDetails?.Warning)

    if (indication === 'TOTAL_PASSED' && trustedChain) {
      return this.buildSignatureDto({
        id,
        valid: true,
        sig,
        subjectName,
        approvedOrg,
        indication,
        subIndication,
        timestampTime: trustedTsa?.ProductionTime ?? null,
        historicalLtv: false,
        errors,
        warnings,
      })
    }

    const cryptoIntact =
      diagSig?.BasicSignature?.SignatureIntact === true &&
      diagSig?.BasicSignature?.SignatureValid === true

    if (
      profile.allowHistoricalTsaValidation &&
      indication === 'INDETERMINATE' &&
      subIndication !== null &&
      HISTORICAL_SUB_INDICATIONS.has(subIndication) &&
      cryptoIntact &&
      trustedChain &&
      trustedTsa?.ProductionTime
    ) {
      const tsaTime = trustedTsa.ProductionTime
      let historicalResp = historicalCache.get(tsaTime)
      if (!historicalResp) {
        historicalResp = await this.callDssValidate(file.buffer, file.originalname, tsaTime)
        historicalCache.set(tsaTime, historicalResp)
      }

      const historicalSig = historicalResp.SimpleReport?.signatureOrTimestampOrEvidenceRecord
        ?.map((w) => w.Signature)
        .find((s) => s?.Id === id)

      if (historicalSig?.Indication === 'TOTAL_PASSED' && this.reachesTrustedRoot(historicalSig)) {
        return this.buildSignatureDto({
          id,
          valid: true,
          sig,
          subjectName,
          approvedOrg,
          indication: historicalSig.Indication,
          subIndication: historicalSig.SubIndication ?? null,
          timestampTime: tsaTime,
          historicalLtv: true,
          errors: [],
          warnings: [
            ...warnings,
            `Validated at trusted TSA timestamp ${tsaTime} (signing or OCSP certificate expired without archival B-LTA timestamp)`,
          ],
        })
      }
    }

    return this.buildSignatureDto({
      id,
      valid: false,
      sig,
      subjectName,
      approvedOrg,
      indication,
      subIndication,
      timestampTime: trustedTsa?.ProductionTime ?? null,
      historicalLtv: false,
      errors,
      warnings,
    })
  }

  private buildSignatureDto(params: {
    id: string
    valid: boolean
    sig: DssSimpleSignature
    subjectName: string | null
    approvedOrg: string | null
    indication: string
    subIndication: string | null
    timestampTime: string | null
    historicalLtv: boolean
    errors: readonly string[]
    warnings: readonly string[]
  }): ValidatedSignatureDto {
    const { sig } = params
    return {
      id: params.id,
      valid: params.valid,
      signedBy: sig.SignedBy ?? null,
      subjectName: params.subjectName,
      approvedOrg: params.approvedOrg,
      indication: params.indication,
      subIndication: params.subIndication,
      format: sig.SignatureFormat ?? null,
      signingTime: sig.SigningTime ?? null,
      bestSignatureTime: params.timestampTime ?? sig.BestSignatureTime ?? null,
      timestampTime: params.timestampTime,
      historicalLtv: params.historicalLtv,
      errors: params.errors,
      warnings: params.warnings,
    }
  }

  private extractSubjectName(
    diagSig: DssDiagnosticSignature | undefined,
    diagCerts: ReadonlyMap<string, DssDiagnosticCertificate>,
  ): string | null {
    const certId = diagSig?.SigningCertificate?.Certificate
    if (!certId) {
      return null
    }
    const cert = diagCerts.get(certId)
    const dn = cert?.SubjectDistinguishedName?.find((item) => item.Format === 'RFC2253')?.value
    return dn ?? null
  }

  private reachesTrustedRoot(sig: DssSimpleSignature): boolean {
    return (sig.CertificateChain?.Certificate ?? []).some((cert) => cert.trusted === true)
  }

  private findTrustedTimestamp(sig: DssSimpleSignature): DssTimestamp | undefined {
    return (sig.Timestamps?.Timestamp ?? []).find(
      (ts) =>
        ts.Indication === 'PASSED' &&
        Boolean(ts.ProductionTime) &&
        (ts.CertificateChain?.Certificate ?? []).some((cert) => cert.trusted === true),
    )
  }

  private collectMessages(messages?: readonly { readonly value?: string }[]): string[] {
    return (messages ?? []).map((m) => m.value).filter((v): v is string => Boolean(v))
  }

  private async callDssValidate(
    bytes: Buffer,
    documentName: string,
    validationTime?: string,
  ): Promise<DssValidationResponse> {
    const body: Record<string, unknown> = {
      signedDocument: {
        bytes: bytes.toString('base64'),
        name: documentName,
      },
      tokenExtractionStrategy: 'EXTRACT_CERTIFICATES_ONLY',
    }
    if (validationTime) {
      body['validationTime'] = validationTime
    }

    let response: Response
    try {
      response = await fetch(`${this.dssUrl}${DSS_VALIDATE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DSS_TIMEOUT_MS),
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      this.logger.error(`EU DSS request failed: ${message}`)
      throw new BadGatewayException('Signature validation engine is unavailable')
    }

    if (!response.ok) {
      this.logger.error(`EU DSS returned HTTP ${response.status}`)
      throw new BadGatewayException(`Signature validation engine returned HTTP ${response.status}`)
    }

    return (await response.json()) as DssValidationResponse
  }
}
