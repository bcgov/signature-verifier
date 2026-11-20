# Spike #2: Validate EU DSS with Portage/Notarius EGBC PDFs and OpenShift Constraints

**Status: spike complete.** Proved `esig/dss-demonstrations` (`dss-demo-webapp` `6.5.1`) validates Portage/Notarius EGBC-sealed PDFs at `$0` vendor licensing inside a non-root Tomcat container with EU LOTL fetching disabled.

## Setup Tested

- **Engine:** `esig/dss-demonstrations` `6.5.1` (`dss-demo-webapp-6.5.1.war` on `tomcat:11.0.27-jdk25-temurin`, `-Xms512m -Xmx1536m`).
- **Trust store:** PKCS12 keystore (`notarius-truststore.p12`) containing both Notarius Root CAs extracted from real fixtures:
  - `CN=Notarius Root Certificate Authority, O=Notarius Inc, C=CA` (`2014-12-17` .. `2034-12-17`, SHA-256 `C7:B8:94:8F:EC:CA:AC:E5:B5:09:A3:43:F3:8D:03:01:D0:79:01:88:56:04:B3:F2:67:27:0E:1E:BB:EF:0F:E7`)
  - `CN=Notarius Root Certificate Authority, O=Notarius Inc, C=CA` (`2021-05-17` .. `2036-05-17`, SHA-256 `AA:A1:5B:DD:B1:C9:24:AD:7A:7F:22:F8:9E:5C:D3:E2:C6:14:07:A0:64:E0:11:B7:CF:4C:B6:18:71:64:49:A4`)
- **Configuration overrides (`dss.properties`):**
  - `cron.tl.loader.enable = false` (avoids downloading EU Member State Trusted Lists at startup)
  - `trusted.source.keystore.type = PKCS12`
  - `trusted.source.keystore.filename = notarius-truststore.p12`
  - `trusted.source.keystore.password = <storepass>`
- **Non-root OpenShift SCC check:**
  - `chgrp -R 0 /usr/local/tomcat && chmod -R g=u /usr/local/tomcat` with `/usr/local/tomcat/conf/Catalina` pre-created.
  - Booted cleanly under non-root `USER 10001:0` in ~4s (`Started DssDemoApplication in 7.148 seconds` on first cold start; `Ready after 2x2s` on restart).
- **Test fixtures:** Public PDFs from `bcgov/HOUS-permit-portal` (`spec/support/`), plus a byte-flipped tampered copy of the sealed EGBC PDF.

## Verification Results (`POST /services/rest/validation/validateSignature`)

| Test PDF | `validationTime` | DSS Result | Key Details |
| :--- | :--- | :--- | :--- |
| `TEST OF ENGINEERING DIGITAL SEAL RECOGNITION - Sealed.pdf` | `2024-07-18T22:39:46Z` | `TOTAL_PASSED` (`1/1`) | Signer `Joshua Bartley -- P. Eng. - EGBC`, `OU=EGBC - Engineers and Geoscientists of British Columbia`, `PAdES-BASELINE-T`, TSA `2024-06-12T23:22:44Z` |
| `TEST OF ENGINEERING DIGITAL SEAL RECOGNITION - Sealed.pdf` | Current (`2026-11-20`) | `INDETERMINATE` / `OUT_OF_BOUNDS_NO_POE` | See `PAdES-BASELINE-T` expiry finding below |
| `tampered_sealed.pdf` (1 byte flipped) | `2024-07-18T22:39:46Z` | `TOTAL_FAILED` / `HASH_FAILURE` | `BBB_CV_IRDOI_ANS`: `The reference data object is not intact!` |
| `Signed_invisible.pdf` | `2022-09-01T12:00:00Z` | `TOTAL_PASSED` (`1/1`) | Signer `Test - H2 -- Notarius`, `OU=Solutions Notarius` (caught as non-EGBC/AIBC via `subjectName`) |
| `signed_two_people.pdf` | `2023-04-01T12:00:00Z` | `TOTAL_PASSED` (`2/2`) | Both signatures parsed and returned independently |
| `Test Document Seal - unsigned.pdf` | Current | `0/0` | Clean empty signature list, no HTTP error |

## Comparison vs. `bcgov/HOUS-permit-portal` (`signed_approved_orgs.yml`)

`EU DSS` returns all fields needed to match `HOUS-permit-portal`'s `Wrappers::DigitalSealValidator` and `DigitalSealSignatureFilter`:

- **Org allowlist (`subjectName`):** `DiagnosticData.Certificate[].SubjectDistinguishedName` (`Format=RFC2253`) returns `UID=41368+CN=Joshua Bartley -- P. Eng. - EGBC,OU=EGBC - Engineers and Geoscientists of British Columbia,O=CertifiO Pro,C=CA`.
- **Integrity, timestamp, revocation, and PDF/A:** `SimpleReport` + `DiagnosticData` include `SignatureIntact`/`SignatureValid`, `Timestamp[].ProductionTime`, `Revocation[]` (embedded `OCSP` + `CRL`, plus live external `OCSP` against `http://ocsp1.notarius.com/ocsp1-ca1`), and `PDFAInfo`.

## Findings and Gotchas for Implementation (#3 / #4)

1. **Historical `PAdES-BASELINE-T` seals fail strict eIDAS current-time checks once the OCSP cert expires:**
   - Notarius's `ConsignO Desktop` fixtures are `PAdES-BASELINE-T` (signature + embedded OCSP response + signature timestamp) without an archival `/DocTimeStamp` (`B-LTA`).
   - Once the short-lived `OCSP Responder 1` cert (`2022-09-28` .. `2024-09-29`) and leaf cert (`2023-07-07` .. `2025-07-07`) expire, validating at current time (`2026-11-20`) passes `ValidationProcessBasicTimestamp` (`PASSED`) and `BestSignatureTime` (`2024-06-12`), but fails `LTV_ISCKNR` (`Current time is not in the validity range of the revocation data issuer's certificate!`).
   - **Action for #4:** Decide in policy/wrapper whether historical `PAdES-BASELINE-T` documents with a valid Notarius TSA timestamp and valid-at-signing-time OCSP are accepted (custom DSS `constraint.xml` or evaluating `ValidationProcessBasicTimestamp` + `DiagnosticData`), or whether only active-cert / `B-LTA` seals pass.
2. **External OCSP egress works (`ocsp1.notarius.com`):**
   - DSS queried `http://ocsp1.notarius.com/ocsp1-ca1` over HTTP port 80; OpenShift namespace `NetworkPolicy` must allow outbound HTTP/HTTPS to Notarius OCSP/CRL responders if egress is restricted.
3. **`ClassPathResource.getFile()` requires an exploded WAR (not a fat JAR):**
   - `DSSBeanConfig.java` loads `trusted.source.keystore.filename` via `ClassPathResource(...).getFile()`, which fails inside an unexploded Spring Boot fat JAR; keep Tomcat WAR deployment (or load via `Resource.getInputStream()` / filesystem path in a custom wrapper).
4. **Drop `-P linux` standalone packaging in #3:**
   - Building with `-P quick,linux` bundled the standalone desktop app into `dss-demo-webapp-6.5.1.war` (`484 MB`); omit the standalone bundle in the production image build.

## Assurance / Policy Note

Standard X.509 / PAdES cryptographic validation against Portage/Notarius's published Root CAs verifies the exact same cryptographic signatures, certificate chains, TSA timestamps, and OCSP/CRL revocation status as `ConsignO Server Automation` `validatePDF`. Only legal/assurance preference (whether a ministry requires Portage's vendor-supported `CSA_LICENSE` validator binary rather than open-source PKI validation) remains a policy sign-off outside engineering.
