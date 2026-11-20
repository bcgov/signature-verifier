[![MIT License](https://img.shields.io/github/license/bcgov/signature-verifier.svg)](/LICENSE)
[![Merge](https://github.com/bcgov/signature-verifier/actions/workflows/merge.yml/badge.svg)](https://github.com/bcgov/signature-verifier/actions/workflows/merge.yml)
[![Analysis](https://github.com/bcgov/signature-verifier/actions/workflows/analysis.yml/badge.svg)](https://github.com/bcgov/signature-verifier/actions/workflows/analysis.yml)
[![Scheduled](https://github.com/bcgov/signature-verifier/actions/workflows/scheduled.yml/badge.svg)](https://github.com/bcgov/signature-verifier/actions/workflows/scheduled.yml)

# Signature Verifier

Shared, stateless digital signature verification service on OpenShift for BC Government applications.

## Scope

- **Verification only:** Validates incoming cryptographically signed documents in memory and returns structured signature/certificate metadata. Uploaded files and PII are never persisted.
- **Not a signing service:** This service does not issue certificates or apply signatures.
  - Regulated professionals (e.g., EGBC, AIBC, FPBC) still require their own Portage CyberTech / Notarius `CertifiO` credential (or manual authentication) to sign documents.
  - General non-regulated e-signatures in BC Gov use existing options such as OneSpan, CHEFS, or OCIO DCS.

## Architecture

- **`backend/` (NestJS / TypeScript):** Stateless HTTP facade exposed via OpenShift `Route`. Accepts `multipart/form-data` uploads, evaluates results against configured trust profiles, and exposes `/api/health`, `/api/metrics`, and Swagger docs at `/api/docs`.
- **`dss/` (EU DSS `6.5.1`):** Upstream [`esig/dss-demonstrations`](https://github.com/esig/dss-demonstrations) (`dss-demo-webapp`) Tomcat WAR configured with Portage/Notarius Root CAs (`cron.tl.loader.enable = false`). Deployed as an internal `ClusterIP`-only Service (`NetworkPolicy` restricts ingress solely to `backend` pods; runs as non-root `USER 10001` with `readOnlyRootFilesystem: true`).

## Live Environments

- **TEST:** `https://signature-verifier-test.apps.silver.devops.gov.bc.ca/api` ([Swagger](https://signature-verifier-test.apps.silver.devops.gov.bc.ca/api/docs))
- **PROD:** `https://signature-verifier-prod.apps.silver.devops.gov.bc.ca/api` ([Swagger](https://signature-verifier-prod.apps.silver.devops.gov.bc.ca/api/docs))

## API Contract (`POST /api/v1/validate`)

### Request

Upload a document as `multipart/form-data` with field name `file` (up to `50 MiB`) and optional `profile` query parameter (`portage-notarius` default, or `default`):

```bash
curl -sS \
  -F "file=@sealed-drawing.pdf" \
  "https://signature-verifier-test.apps.silver.devops.gov.bc.ca/api/v1/validate?profile=portage-notarius"
```

### Response Status Codes

| HTTP Status | Meaning |
| :--- | :--- |
| `200 OK` | Validation completed; check JSON `status` (`valid`, `unsigned`, `unapproved_org`, `invalid`) |
| `400 Bad Request` | Missing/empty `file` field or unknown `profile` |
| `502 Bad Gateway` | Upstream `dss` validation engine unreachable or returned an error |

### Example `200 OK` Response

```json
{
  "status": "valid",
  "profile": "portage-notarius",
  "documentName": "sealed-drawing.pdf",
  "signaturesCount": 1,
  "validSignaturesCount": 1,
  "approvedSignaturesCount": 1,
  "signatures": [
    {
      "id": "S-F6234579BCF5F9FAA81E06291C3E31FE027D9B94EFEB3B10A18AA873D783CC47",
      "valid": true,
      "signedBy": "Signer Name -- P. Eng. - EGBC",
      "subjectName": "UID=41368+CN=Signer Name -- P. Eng. - EGBC,OU=EGBC - Engineers and Geoscientists of British Columbia,O=CertifiO Pro,C=CA",
      "approvedOrg": "EGBC",
      "indication": "TOTAL_PASSED",
      "subIndication": null,
      "format": "PAdES-BASELINE-T",
      "signingTime": "2024-06-12T23:22:43Z",
      "bestSignatureTime": "2024-06-12T23:22:44Z",
      "timestampTime": "2024-06-12T23:22:44Z",
      "historicalLtv": true,
      "errors": [],
      "warnings": [
        "Validated at trusted TSA timestamp 2024-06-12T23:22:44Z (signing or OCSP certificate expired without archival B-LTA timestamp)"
      ]
    }
  ]
}
```

### Sample Consumer Call (Node `fetch`)

```ts
const form = new FormData()
form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'drawing.pdf')

const res = await fetch(
  'https://signature-verifier-prod.apps.silver.devops.gov.bc.ca/api/v1/validate?profile=portage-notarius',
  { method: 'POST', body: form },
)
if (!res.ok) {
  throw new Error(`Signature validation failed: HTTP ${res.status}`)
}
const result = await res.json()
// result.status === 'valid' && result.approvedSignaturesCount > 0
```

### Migrating from `ConsignO Server Automation` (`validatePDF`)

Apps currently calling `POST /validatePDF` on a per-app `consigno-verifio-notarius-server` sidecar (such as `bcgov/HOUS-permit-portal`) can replace the sidecar + `CSA_LICENSE` secret with a single `POST /api/v1/validate` call:

- `status: "valid"` + `signatures[].approvedOrg` (`EGBC`, `AIBC`, `FPBC`) and `signatures[].subjectName` replace `DigitalSealSignatureFilter` regex checks.
- `status: "unsigned"` replaces inspecting `response.result == "UNSIGNED"`.
- `status: "unapproved_org"` indicates a cryptographically valid Notarius signature whose `subjectName` does not match the configured regulatory bodies.
- `status: "invalid"` indicates hash tampering (`HASH_FAILURE`), untrusted chain, or failed validation (`signatures[].errors` / `subIndication`).

## Trust Profiles & Extending

See [`docs/trust-profiles.md`](docs/trust-profiles.md) for details on the `portage-notarius` and `default` profiles, historical `PAdES-BASELINE-T` handling, and adding new X.509 CAs or formats (`PAdES`, `XAdES`, `JAdES`, `CAdES`, `ASiC`). Background spike findings live in [`docs/spike-2-eu-dss-portage.md`](docs/spike-2-eu-dss-portage.md).

## Local Development

```bash
# Start dss (8080) and backend (3000) locally
docker compose up

# Run backend lint, build, and tests
cd backend
npm ci
npm run lint
npm run format:check
npm run build
npm run test:cov
```

## OpenShift Deployment Prerequisites

- **Namespaces & GitHub wiring:** Provision DEV/TEST/PROD OpenShift namespaces and run `scripts/setup.sh --plate <plate> --apply` (previews without `--apply`).
- **Secrets/Variables:** Requires `vars.OC_SERVER`, `vars.OC_NAMESPACE`, and `secrets.OC_TOKEN` (repo, `test`, and `prod` environments); no database or `DB_PASSWORD` is used by the application.
- **Resources:** `dss` requests `512Mi` / limits `2Gi` RAM (`JAVA_OPTS=-Xms512m -Xmx1536m`); `backend` limits `512Mi` RAM.
- **Network egress:** `dss` pods require outbound HTTP/HTTPS (`80`/`443`) access to Notarius OCSP/CRL responders (e.g., `ocsp1.notarius.com`) for live revocation checks.
