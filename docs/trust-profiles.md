# Trust Profiles & Extending CA Support

`bcgov/signature-verifier` separates **cryptographic trust anchors** (configured in `dss/`) from **consumer policy filtering** (configured in `backend/src/validation/trust-profiles.ts`).

## Current Profiles

| Profile | Description | Org Allowlist (`subjectName`) | Historical `PAdES-T` TSA Re-check |
| :--- | :--- | :--- | :--- |
| `portage-notarius` *(default)* | Portage CyberTech / Notarius seals for BC regulated professionals | `EGBC`, `AIBC`, `FPBC` (`ABCFP`) | Enabled (`allowHistoricalTsaValidation: true`) |
| `default` | General standards-based validation against the configured DSS trust store | None (any trusted signature passes) | Enabled (`allowHistoricalTsaValidation: true`) |

### `portage-notarius` Root CAs
`dss/Dockerfile` imports two public Portage/Notarius Root CAs into `notarius-truststore.p12`:
- `dss/certs/notarius-root-2014.crt` (`2014-12-17` .. `2034-12-17`)
- `dss/certs/notarius-root-2021.crt` (`2021-05-17` .. `2036-05-17`)

EU Member State Trusted List downloading is disabled (`cron.tl.loader.enable = false` in `dss/dss.properties`), so startup takes only a few seconds and trusts only the configured truststore.

### Historical `PAdES-BASELINE-T` Handling
Many Portage/Notarius PDFs are `PAdES-BASELINE-T` (signature + embedded OCSP + Notarius TSA timestamp) without an archival `/DocTimeStamp` (`B-LTA`). Once Notarius's short-lived OCSP responder cert (~2 years) or the signer's leaf cert expires, strict current-time validation returns `INDETERMINATE` (`OUT_OF_BOUNDS_NO_POE` or `REVOCATION_OUT_OF_BOUNDS_NO_POE`).

When `allowHistoricalTsaValidation` is `true` and the signature is cryptographically intact with a `PASSED` trusted TSA timestamp, `ValidationService` re-invokes EU DSS at the TSA-proven `ProductionTime`. Only if EU DSS returns `TOTAL_PASSED` at that timestamp is the signature marked `valid: true` with `historicalLtv: true` and a warning.

## Adding New CAs or Formats

EU DSS natively parses and validates **PAdES** (PDF), **XAdES** (XML), **JAdES** (JSON), **CAdES** (CMS/binary), and **ASiC** (`ASiC-S` / `ASiC-E` ZIP containers) via `POST /services/rest/validation/validateSignature`.

To add a new trust profile (for example, OCIO DCS, Government of Canada CAs, or another regulated body):

1. **Add public Root CA certificate(s)** as PEM-encoded `.crt` files under `dss/certs/` (`.pem` is ignored by `.gitignore` to avoid committing private keys).
2. **Import into `notarius-truststore.p12`** (or rename the keystore in `dss/dss.properties`) via `keytool -importcert` in `dss/Dockerfile`.
3. **Add a profile entry** in `backend/src/validation/trust-profiles.ts` with the canonical `TrustProfileName`, `approvedOrgRules` regexes against RFC 2253 `subjectName`, and `allowHistoricalTsaValidation`.
4. **Update controller OpenAPI enum & tests** in `backend/src/validation/validation.controller.ts` and `backend/src/validation/trust-profiles.spec.ts`.
