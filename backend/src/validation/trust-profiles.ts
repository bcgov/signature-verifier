export type TrustProfileName = 'portage-notarius' | 'default'

export interface OrgRule {
  readonly code: string
  readonly pattern: RegExp
}

export interface TrustProfileConfig {
  readonly name: TrustProfileName
  readonly description: string
  readonly approvedOrgRules: readonly OrgRule[]
  readonly allowHistoricalTsaValidation: boolean
}

export const TRUST_PROFILES: Record<TrustProfileName, TrustProfileConfig> = {
  'portage-notarius': {
    name: 'portage-notarius',
    description: 'Portage CyberTech / Notarius seals for BC regulated professionals',
    approvedOrgRules: [
      {
        code: 'EGBC',
        pattern: /\bEGBC\b|Engineers and Geoscientists(?:\s+of)?\s+British Columbia/i,
      },
      {
        code: 'AIBC',
        pattern: /\bAIBC\b|Architectural Institute of British Columbia/i,
      },
      {
        code: 'FPBC',
        pattern:
          /\bFPBC\b|\bABCFP\b|Forest Professionals British Columbia|Association of BC Forest Professionals/i,
      },
    ],
    allowHistoricalTsaValidation: true,
  },
  default: {
    name: 'default',
    description: 'General standards-based X.509/PAdES validation without org allowlist',
    approvedOrgRules: [],
    allowHistoricalTsaValidation: true,
  },
}

/**
 * Resolve a configured trust profile by canonical name.
 */
export function resolveTrustProfile(name?: string): TrustProfileConfig | null {
  const key = (name ?? 'portage-notarius') as TrustProfileName
  if (!Object.prototype.hasOwnProperty.call(TRUST_PROFILES, key)) {
    return null
  }
  return TRUST_PROFILES[key]
}

/**
 * Match a certificate RFC2253 subject DN against a trust profile's org allowlist.
 */
export function matchApprovedOrg(
  subjectName: string | null,
  profile: TrustProfileConfig,
): string | null {
  if (!subjectName) {
    return null
  }
  for (const rule of profile.approvedOrgRules) {
    if (rule.pattern.test(subjectName)) {
      return rule.code
    }
  }
  return null
}
