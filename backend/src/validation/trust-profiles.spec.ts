import { matchApprovedOrg, resolveTrustProfile, TRUST_PROFILES } from './trust-profiles'

describe('trust-profiles', () => {
  it('defaults to portage-notarius when profile is omitted', () => {
    expect(resolveTrustProfile(undefined)?.name).toBe('portage-notarius')
  })

  it('resolves default profile and rejects unknown profiles', () => {
    expect(resolveTrustProfile('default')?.name).toBe('default')
    expect(resolveTrustProfile('unknown-ca')).toBeNull()
  })

  it('matches EGBC, AIBC, and FPBC/ABCFP subject DNs', () => {
    const profile = TRUST_PROFILES['portage-notarius']
    expect(
      matchApprovedOrg(
        'UID=41368+CN=Joshua Bartley -- P. Eng. - EGBC,OU=EGBC - Engineers and Geoscientists of British Columbia,O=CertifiO Pro,C=CA',
        profile,
      ),
    ).toBe('EGBC')
    expect(
      matchApprovedOrg(
        'OU=Architectural Institute of British Columbia,O=CertifiO Pro,C=CA',
        profile,
      ),
    ).toBe('AIBC')
    expect(
      matchApprovedOrg(
        'OU=FPBC - Forest Professionals British Columbia,O=CertifiO Pro,C=CA',
        profile,
      ),
    ).toBe('FPBC')
    expect(
      matchApprovedOrg('UID=h2test+CN=Test - H2 -- Notarius,OU=Solutions Notarius,C=CA', profile),
    ).toBeNull()
    expect(matchApprovedOrg(null, profile)).toBeNull()
  })
})
