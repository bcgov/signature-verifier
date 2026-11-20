# AGENTS.md

Repository facts for automated coding assistants. Teams may edit or remove this file.

## Layout
- `backend/` (stateless NestJS API facade), `dss/` (upstream `esig/dss-demonstrations` Tomcat WAR + Portage/Notarius truststore, internal `ClusterIP` only)
- OpenShift templates (not Helm): `common/openshift.init.yml`, `backend/openshift.deploy.yml`, `dss/openshift.deploy.yml`
- Workflows: `.github/workflows/` (PR deploys via `reusable-deploy.yml`, tests via `reusable-tests.yml`); integration and load tests in `common/tests/`
- HTTP requests: Prefer native `fetch` over Axios for new HTTP requests; use Axios only when native fetch is insufficient (e.g. upload progress tracking, complex interceptors).

## Build, test, run
- Full stack locally: `docker compose up`
- Backend (`cd backend`): `npm ci`, `npm run build`, `npm run lint`, `npm test`, `npm run test:cov`
- Deploys to OpenShift run from GitHub Actions (PR open, merge), not from a workstation

## Shared actions
- Uses bcgov shared actions and workflows (`bcgov/action-*`, `bcgov/actions/*`, `bcgov/actions-openshift/*`, `bcgov/quickstart-openshift-helpers`). Use them as provided; don't copy or fork them.
- Never pin `@main`. Pin bcgov shared actions to a published release SHA with a `# vX.Y.Z` comment.
- Vanity Route TLS (`bcgov/actions-openshift/cert-keeper`) is strictly managed via the standalone workflow `.github/workflows/cert-keeper.yml` (daily schedule and `workflow_dispatch`, runs only when `vars.ROUTE_HOST` is set, uses the `prod` environment). Never embed `cert-keeper` into `pr-open.yml`, `merge.yml`, `release.yml`, or continuous deployment pipelines.

## Settings
- Automated agents must not change repository or organization settings. Settings changes are made by a person on the team with the setup scripts in `scripts/`; agents may run them only without `--apply`, which previews.
- After a repository is created from the template, suggest running `scripts/setup.sh`.
