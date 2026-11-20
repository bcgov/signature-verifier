import type { TrustProfileName } from './trust-profiles'

export type ValidationStatus = 'valid' | 'unsigned' | 'unapproved_org' | 'invalid'

export interface UploadedDocumentFile {
  readonly originalname: string
  readonly mimetype: string
  readonly size: number
  readonly buffer: Buffer
}

export interface DssValidationMessage {
  readonly value?: string
  readonly Key?: string
}

export interface DssChainCertificate {
  readonly Id?: string
  readonly QualifiedName?: string
  readonly trusted?: boolean | null
}

export interface DssTimestamp {
  readonly Id?: string
  readonly ProductionTime?: string
  readonly ProducedBy?: string
  readonly Indication?: string
  readonly SubIndication?: string | null
  readonly CertificateChain?: {
    readonly Certificate?: readonly DssChainCertificate[]
  } | null
}

export interface DssSimpleSignature {
  readonly Id?: string
  readonly SigningTime?: string | null
  readonly BestSignatureTime?: string | null
  readonly SignedBy?: string | null
  readonly SignatureFormat?: string | null
  readonly Indication?: string
  readonly SubIndication?: string | null
  readonly CertificateChain?: {
    readonly Certificate?: readonly DssChainCertificate[]
  } | null
  readonly Timestamps?: {
    readonly Timestamp?: readonly DssTimestamp[]
  } | null
  readonly AdESValidationDetails?: {
    readonly Error?: readonly DssValidationMessage[]
    readonly Warning?: readonly DssValidationMessage[]
  } | null
}

export interface DssSignatureTokenWrapper {
  readonly Signature?: DssSimpleSignature
}

export interface DssDistinguishedName {
  readonly value?: string
  readonly Format?: string
}

export interface DssDiagnosticCertificate {
  readonly Id?: string
  readonly SubjectDistinguishedName?: readonly DssDistinguishedName[]
}

export interface DssDiagnosticSignature {
  readonly Id?: string
  readonly BasicSignature?: {
    readonly SignatureIntact?: boolean
    readonly SignatureValid?: boolean
  } | null
  readonly SigningCertificate?: {
    readonly Certificate?: string
  } | null
}

export interface DssValidationResponse {
  readonly SimpleReport?: {
    readonly DocumentName?: string | null
    readonly ValidSignaturesCount?: number
    readonly SignaturesCount?: number
    readonly signatureOrTimestampOrEvidenceRecord?: readonly DssSignatureTokenWrapper[]
  }
  readonly DiagnosticData?: {
    readonly Signature?: readonly DssDiagnosticSignature[]
    readonly Certificate?: readonly DssDiagnosticCertificate[]
  }
}

export interface ValidatedSignatureDto {
  readonly id: string
  readonly valid: boolean
  readonly signedBy: string | null
  readonly subjectName: string | null
  readonly approvedOrg: string | null
  readonly indication: string
  readonly subIndication: string | null
  readonly format: string | null
  readonly signingTime: string | null
  readonly bestSignatureTime: string | null
  readonly timestampTime: string | null
  readonly historicalLtv: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

export interface ValidationResponseDto {
  readonly status: ValidationStatus
  readonly profile: TrustProfileName
  readonly documentName: string
  readonly signaturesCount: number
  readonly validSignaturesCount: number
  readonly approvedSignaturesCount: number
  readonly signatures: readonly ValidatedSignatureDto[]
}
