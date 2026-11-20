# Trust Profiles & Adding Certificate Authorities

Signature Verifier splits **cryptography** from **business rules**:

1. **Cryptographic trust (`dss/`)** answers: *"Was this file genuinely signed by a real certificate issued by an authority in our trust store, and was the document left untouched?"*
2. **Policy rules (`backend/src/validation/trust-profiles.ts`)** answer: *"Even if the signature is mathematically real, does this signer belong to one of the organizations our app accepts?"*

---

## Built-in profiles (`?profile=...`)

| Profile | When to use it | Approved organizations (`subjectName`) | Accepts older `PAdES-T` PDFs via TSA timestamp? |
| :--- | :--- | :--- | :--- |
| **`portage-notarius`** *(default)* | Checking professional seals from BC engineers, architects, or foresters | `EGBC`, `AIBC`, `FPBC` (also recognizes legacy `ABCFP`) | Yes (`allowHistoricalTsaValidation: true`) |
| **`default`** | Checking any valid signature issued by a CA in `dss`'s trust store, regardless of organization | None (any valid trusted signature passes) | Yes (`allowHistoricalTsaValidation: true`) |

---

## How `dss` knows who to trust

`dss/Dockerfile` builds a Java trust store (`notarius-truststore.p12`) containing two public Portage CyberTech / Notarius Root CA certificates:

- `dss/certs/notarius-root-2014.crt` (valid `2014-12-17` to `2034-12-17`)
- `dss/certs/notarius-root-2021.crt` (valid `2021-05-17` to `2036-05-17`)

Out of the box, EU DSS tries to download lists of hundreds of European government Certificate Authorities at startup. We disable that (`cron.tl.loader.enable = false` in `dss/dss.properties`) so the container boots in a few seconds and trusts **only** the certificates you explicitly put in `dss/certs/`.

### What about revocation checks (`OCSP` / `CRL`)?

When a signature is verified, `dss` checks whether the signer's certificate was cancelled ("revoked") before it expired:
- First it looks at any revocation proof already embedded inside the PDF.
- It can also reach out to Notarius over HTTP/HTTPS (for example `ocsp1.notarius.com`) to ask live.

### Why older `PAdES-BASELINE-T` PDFs need a timestamp check

Many Notarius PDFs use the `PAdES-BASELINE-T` format (signature + embedded OCSP proof + trusted TSA timestamp), without an extra long-term archival timestamp (`B-LTA`). Because Notarius's OCSP responder certificates expire roughly every 2 years (and leaf signing certs expire every 1–2 years), validating an older PDF against *today's* date causes EU DSS to return `INDETERMINATE` (`OUT_OF_BOUNDS_NO_POE` or `REVOCATION_OUT_OF_BOUNDS_NO_POE`).

When `allowHistoricalTsaValidation` is `true` and EU DSS confirms the signature itself is intact and carries a `PASSED` trusted TSA timestamp, `backend` automatically asks EU DSS to re-check the PDF **at that timestamp's `ProductionTime`**. If EU DSS returns `TOTAL_PASSED` at that moment in history, `backend` accepts the signature (`valid: true`, `historicalLtv: true`) and records an informational note in `warnings`.

---

## Supported document formats

EU DSS parses and validates all of these automatically via `POST /services/rest/validation/validateSignature`:
- **PAdES** (signed PDFs)
- **XAdES** (signed XML)
- **JAdES** (signed JSON)
- **CAdES** (signed binary / CMS files)
- **ASiC** (`ASiC-S` / `ASiC-E` signed ZIP containers)

---

## How to add a new Certificate Authority or profile

For example, to trust OCIO DCS or Government of Canada certificates:

1. **Add the public Root CA certificate(s)** as PEM-encoded `.crt` files inside `dss/certs/`. (`.pem` files are ignored by `.gitignore` so private keys are never committed by mistake.)
2. **Import them into the trust store** by adding a `keytool -importcert` line in `dss/Dockerfile` (importing into `notarius-truststore.p12`, or renaming the keystore in `dss/dss.properties` if desired).
3. **Add the profile rules** in `backend/src/validation/trust-profiles.ts` (define the `TrustProfileName`, optional regex rules matching the signer's RFC 2253 `subjectName`, and `allowHistoricalTsaValidation`).
4. **Update OpenAPI docs and unit tests** in `backend/src/validation/validation.controller.ts` and `backend/src/validation/trust-profiles.spec.ts`.
