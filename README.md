[![MIT License](https://img.shields.io/github/license/bcgov/signature-verifier.svg)](/LICENSE)
[![Merge](https://github.com/bcgov/signature-verifier/actions/workflows/merge.yml/badge.svg)](https://github.com/bcgov/signature-verifier/actions/workflows/merge.yml)
[![Analysis](https://github.com/bcgov/signature-verifier/actions/workflows/analysis.yml/badge.svg)](https://github.com/bcgov/signature-verifier/actions/workflows/analysis.yml)
[![Scheduled](https://github.com/bcgov/signature-verifier/actions/workflows/scheduled.yml/badge.svg)](https://github.com/bcgov/signature-verifier/actions/workflows/scheduled.yml)

# Signature Verifier

**In one sentence:** Send this API a signed PDF (like an engineer's sealed drawing), and it tells your app whether the digital signature is real, untouched, and from an approved BC professional—without saving the file anywhere.

---

## Wait—what problem does this solve?

When an engineer, architect, or forester applies a digital seal (using Portage CyberTech / Notarius **CertifiO**), checking that PDF in code is surprisingly hard:

- You cannot tell from the visual stamp image on the PDF whether the signature is real—anyone can paste a picture of a stamp.
- Previously, each BC Gov app had to run its own paid **ConsignO Server Automation** sidecar container and manage a `CSA_LICENSE` secret just to call `validatePDF`.
- Checking signatures properly requires full cryptographic certificate math, revocation checks ("was this person's licence cancelled?"), and timestamp handling.

This repo replaces that per-app paid sidecar with **one shared, free, open-source API** on OpenShift.

### What it does—and what it does NOT do

- **Checks signatures in memory only:** Your file stays in RAM while being checked and is discarded immediately after. No database, no disk storage, no saved PII.
- **Does NOT sign documents:** It only *checks* existing signatures.
  - Regulated professionals (EGBC, AIBC, FPBC) still sign using their own Portage/Notarius CertifiO credential.
  - Regular (non-sealed) e-signatures in BC Gov use OneSpan, CHEFS, or OCIO DCS.

---

## How it works (the two-container setup, in plain English)

There is **no web UI** and **no database**. The service runs just two containers in OpenShift:

```text
Your App / curl / Swagger UI
        │
        │  HTTPS (public OpenShift Route)
        ▼
┌───────────────────────────────┐
│  1. backend (NestJS / Node)   │  ◄── The "Receptionist" (only container with a public URL)
│     /api/v1/validate          │
└───────────────┬───────────────┘
                │
                │  Internal OpenShift Service (locked down by NetworkPolicy)
                ▼
┌───────────────────────────────┐
│  2. dss (EU DSS 6.5.1 Tomcat) │  ◄── The "Back-Room Math Checker" (no public URL)
└───────────────┬───────────────┘
                │
                │  Outbound HTTP/HTTPS (port 80/443)
                ▼
     Notarius OCSP / CRL        ◄── Checks whether the signer's cert was ever revoked
```

1. **`backend/` — The Receptionist (NestJS / TypeScript):**
   - The **only** part reachable from outside OpenShift (via the OpenShift `Route`).
   - Accepts your uploaded file (`POST /api/v1/validate`), hands it to `dss`, checks BC Gov policy rules (e.g., *"Does this belong to EGBC, AIBC, or FPBC?"*), and returns simple JSON.
   - Also provides `/api/health` (for OpenShift readiness checks), `/api/metrics` (for Prometheus), and `/api/docs` (an interactive Swagger page where you can test uploads right in your browser).

2. **`dss/` — The Back-Room Math Checker (EU DSS `6.5.1`):**
   - An off-the-shelf, open-source Java web app ([`esig/dss-demonstrations`](https://github.com/esig/dss-demonstrations)) built by the European Union for validating digital signatures. **We maintain zero custom Java code**—only a `Dockerfile` and config files (`dss/dss.properties` + public Notarius root certificates in `dss/certs/`).
   - Has **no public Route**. It sits on an internal `ClusterIP` Service, and an OpenShift `NetworkPolicy` blocks everything except `backend` pods from talking to it.
   - EU Trusted List downloading is disabled (`cron.tl.loader.enable = false`), so it starts in a few seconds and only trusts the root certificates we explicitly added (`dss/certs/`).

---

## Try it in 10 seconds

- **TEST API:** `https://signature-verifier-test.apps.silver.devops.gov.bc.ca/api` ([Interactive Swagger UI](https://signature-verifier-test.apps.silver.devops.gov.bc.ca/api/docs))
- **PROD API:** `https://signature-verifier-prod.apps.silver.devops.gov.bc.ca/api` ([Interactive Swagger UI](https://signature-verifier-prod.apps.silver.devops.gov.bc.ca/api/docs))

### Option 1: Use your browser (no code needed)

Open the **Interactive Swagger UI** link above, click **`POST /api/v1/validate`**, click **Try it out**, pick a PDF file, and click **Execute**.

### Option 2: `curl` from your terminal

Upload a file as `multipart/form-data` using form field `file` (max `50 MiB`) and optional query parameter `profile` (`portage-notarius` by default, or `default`):

```bash
curl -sS \
  -F "file=@sealed-drawing.pdf" \
  "https://signature-verifier-test.apps.silver.devops.gov.bc.ca/api/v1/validate?profile=portage-notarius"
```

### Option 3: Call it from Node / TypeScript (`fetch`)

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
// Accepted when result.status === 'valid' && result.approvedSignaturesCount > 0
```

---

## Understanding the response

### HTTP status codes

| HTTP Status | What happened | What to do |
| :--- | :--- | :--- |
| **`200 OK`** | The file was checked. (Even an *invalid* or *unsigned* PDF returns `200 OK`!) | Read `result.status` in the JSON body. |
| **`400 Bad Request`** | You forgot the `file` upload, uploaded a `0`-byte file, or passed an unknown `?profile=` name. | Fix the request your app is sending. |
| **`502 Bad Gateway`** | `backend` could not reach `dss`, or `dss` returned an error. | Retry or check `dss` pod logs in OpenShift. |

### JSON `status` values (when HTTP is `200 OK`)

| `status` | Plain-English meaning | Typical next step |
| :--- | :--- | :--- |
| **`valid`** | Real cryptographic signature, file was NOT modified after signing, AND (under `portage-notarius`) at least one signer belongs to an approved org (`EGBC`, `AIBC`, or `FPBC`). | Accept the document. |
| **`unsigned`** | There are zero digital signatures in the file (for example, a plain PDF or an image of a stamp). | Reject and ask the user to digitally sign/seal the PDF. |
| **`unapproved_org`** | The signature is mathematically real and trusted by Notarius, **but** none of the signers belong to `EGBC`, `AIBC`, or `FPBC` (for example, a generic Notarius test cert). | Reject if your workflow requires a BC regulated professional. |
| **`invalid`** | Something failed—someone modified the document after signing (`HASH_FAILURE`), the issuer isn't trusted, or validation failed. | Reject and inspect `signatures[].errors` / `subIndication`. |

### Example `200 OK` JSON response

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

### Wait—why does `"historicalLtv": true` show a warning on an older valid PDF?

Signing certificates expire every 1–2 years, just like a driver's licence. If an engineer sealed a drawing in 2024 and you verify it in 2026, a strict "is the certificate valid *today*?" check fails because the 2024 cert has since expired.

However, most Notarius seals (`PAdES-BASELINE-T`) include a cryptographic **timestamp (`TSA`)**—essentially a tamper-proof digital postmark proving *when* the document was signed. When `backend` sees that a signature has a valid Notarius timestamp, it asks `dss`: *"Pretend it is `2024-06-12` (the timestamp time)—was the signature 100% valid then?"* If `dss` says `TOTAL_PASSED`, `backend` marks the signature `valid: true`, sets `historicalLtv: true`, and adds the informational message in `warnings`.

---

## Migrating from ConsignO Server Automation (`validatePDF`)

If your app currently calls `POST /validatePDF` on a `consigno-verifio-notarius-server` sidecar (such as `bcgov/HOUS-permit-portal`), you can remove that sidecar and `CSA_LICENSE` secret and call `POST /api/v1/validate` instead:

| Old ConsignO check | Signature Verifier equivalent |
| :--- | :--- |
| `DigitalSealSignatureFilter` regex on signer DN | `status === "valid"` + `signatures[].approvedOrg` (`EGBC`, `AIBC`, `FPBC`) and `signatures[].subjectName` |
| `response.result == "UNSIGNED"` | `status === "unsigned"` |
| Trusted signature from non-regulated org | `status === "unapproved_org"` |
| Tampered file / bad chain | `status === "invalid"` (see `signatures[].errors` and `subIndication`) |

---

## What is in each folder?

| Path | What it is |
| :--- | :--- |
| `backend/` | NestJS API (`POST /api/v1/validate`, Swagger, trust profiles, Vitest unit tests, `openshift.deploy.yml`). |
| `dss/` | EU DSS Tomcat container config, Notarius Root CA `.crt` files, and internal-only `openshift.deploy.yml`. |
| `common/` | Shared OpenShift namespace init template (`openshift.init.yml`) and quickstart integration/load tests. |
| `docs/` | [Trust profiles & adding CAs](docs/trust-profiles.md), architecture decision records (`docs/adr/`), and spike notes. |
| `scripts/` | One-time repo/OpenShift/environment setup scripts (`setup.sh --plate <plate>`). |
| `.github/workflows/` | CI/CD pipelines (build containers, deploy to DEV/TEST/PROD, security scans, Dependabot/Renovate). |

---

## Trust profiles & adding new certificate authorities

See **[docs/trust-profiles.md](docs/trust-profiles.md)** for a plain-English guide to:
- How `portage-notarius` vs `default` profiles differ.
- Why EU Trusted Lists are turned off.
- How to trust a new Certificate Authority (such as OCIO DCS or Government of Canada CAs) or other formats (`PAdES`, `XAdES`, `JAdES`, `CAdES`, `ASiC`).

---

## Local development

```bash
# Run both containers locally: dss on :8080, backend on :3000
docker compose up

# Run backend linter, formatting check, build, and unit tests
cd backend
npm ci
npm run lint
npm run format:check
npm run build
npm run test:cov
```

---

## OpenShift deployment notes

- **Initial setup:** Provision DEV/TEST/PROD OpenShift namespaces and run `./scripts/setup.sh --plate <plate> --apply` (omit `--apply` to preview).
- **GitHub secrets & variables:** Workflows expect `vars.OC_SERVER`, `vars.OC_NAMESPACE`, and `secrets.OC_TOKEN` for repo (DEV), `test`, and `prod` environments. The app itself uses **no database** and does not read `DB_PASSWORD`.
- **Container memory:** `dss` requests `512Mi` / limits `2Gi` RAM (`JAVA_OPTS=-Xms512m -Xmx1536m`) because Java + PDF parsing needs headroom; `backend` limits `512Mi` RAM.
- **Outbound internet from `dss`:** `dss` pods need outbound HTTP/HTTPS (`80`/`443`) to Notarius revocation servers (like `ocsp1.notarius.com`) so they can check whether a signer's certificate was ever revoked.
