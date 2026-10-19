# TeamTrace

TeamTrace is a local-first project workspace for student teams, team leaders, and faculty. Project membership, tasks, evidence, repository activity, disputes, and audit history are stored in SQLite. Contribution scores are calculated by the API from submitted evidence.

## Run locally

Requires Node.js 20.19 or later and npm.

```sh
npm install
npm run dev
```

Open **http://localhost:5173**. The API listens on **http://localhost:4000**. On startup, the API applies the schema migrations and creates `server/data/teamtrace.sqlite` if needed. New databases start empty; there are no demo accounts or sample projects.

Useful commands:

```sh
npm run dev       # Vite frontend and Express API together
npm run build     # production frontend build
npm test          # isolated API and GitHub integration tests
npm start         # API only (build the frontend separately for production)
npm run seed      # safe legacy command; does not create sample data
```

For a production-style local run, build with `npm run build`, then run `npm start`. Express serves the built frontend and API from **http://localhost:4000**.

## Accounts and roles

Use **Create account** to register as a Team Member or Team Leader. Passwords must contain at least 10 characters. Faculty cannot self-register. A first faculty account can only be provisioned when the operator sets `FACULTY_BOOTSTRAP_SECRET`; the protected, one-time `POST /api/auth/bootstrap-faculty` endpoint also requires a valid name, email, password, and that secret. Once a faculty account exists, the endpoint refuses further use. Keep this secret private and remove it after provisioning.

## GitHub OAuth and repository activity

GitHub sign-in and real repository sync are optional. Without OAuth credentials, email/password sign-in, account creation, and the rest of TeamTrace continue to work; the interface reports that GitHub is not configured. No placeholder activity is generated.

To enable GitHub OAuth for local development:

1. Create a GitHub OAuth App in GitHub Developer settings.
2. Set its **Authorization callback URL** to `http://localhost:4000/api/auth/github/callback`.
3. Copy `server/.env.example` to `server/.env` and add the app's credentials (never commit `server/.env`):

   ```text
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

4. Restart the API. The browser will return to the Vite app at `http://localhost:5173` after GitHub verifies sign-in. The API loads `server/.env` automatically.

Optional variables:

- `GITHUB_CALLBACK_URL` — callback URI registered in the OAuth App (defaults to the local callback above).
- `CLIENT_ORIGIN` — frontend origin for OAuth return and CORS (defaults to `http://localhost:5173`; use the production HTTPS origin when deployed).
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` — OAuth App credentials. OAuth state is short-lived, verified, and held in an HttpOnly SameSite cookie. Access tokens are stored server-side and are never included in API responses.
- `TEAMTRACE_JWT_SECRET` — a long, random signing key. If omitted, a process-local random key is used and sessions expire when the API restarts.
- `TEAMTRACE_DB_PATH` — SQLite database location (default `server/data/teamtrace.sqlite`).
- `PORT` — API port (default `4000`).
- `FACULTY_BOOTSTRAP_SECRET` — temporary operator-controlled secret for provisioning the first faculty account.

OAuth requests use only `read:user user:email` scopes. Repository reads use the GitHub API; public repository data is available with these scopes. Private repository access is not enabled by default. GitHub's broader `repo` OAuth scope grants access to private repository content (and broader repository control), so only add it deliberately if private repository support is required and the authorization model has been reviewed.

A project leader or faculty member can enter a repository URL in the Evidence view's repository panel. Only HTTPS URLs in the form `https://github.com/owner/repository` are accepted; the supplied URL is parsed and never fetched directly by the server. A local email/password account must explicitly connect GitHub while authenticated; OAuth will not attach an identity to an existing account solely because the email strings match. To sync, the user must connect the GitHub account that can read that repository. TeamTrace fetches capped commit and pull-request history from fixed `api.github.com` endpoints, stores provider identifiers for deduplication, and reports API access, timeout, and rate-limit errors honestly. Imported activity is not assigned contribution points or linked to a task unless that relationship is explicitly supported; TeamTrace does not invent evidence.

## Data and migrations

Migrations run automatically when the API starts and are idempotent. The legacy `npm run seed` command is retained only for compatibility and does not recreate demo content. Migration cleanup targets the six known legacy demo identities, the `Fieldwork Atlas` workspace owned by the legacy Riley account, and records/audit entries identified by the previous mock sync's exact signatures. It does not reset the database or delete unrelated projects. If a legacy identity still owns or authors records in an unrelated workspace, that account is disabled and anonymized so the project history remains intact.

The contribution report weights evidence categories as follows: Development 35%, Testing 25%, Documentation 20%, Collaboration 10%, and Planning 10%. Each category contributes its weighted average to a 0–100 score; empty categories contribute zero. The report is a transparent conversation aid, not a measure of personal worth.

## Application features

- Responsive React, Vite, Tailwind CSS, and Recharts workspace with overview, task board/list, evidence, contribution report, disputes, and audit history.
- Faculty-only **Faculty review** overview of all projects, with completion calculated as completed tasks ÷ all tasks (0% when there are no tasks). Stages are derived from task statuses: all tasks completed = Complete; otherwise any task in review = Review; otherwise any in-progress or completed work = In progress; no tasks or all tasks to do = Planning. These are task-based progress signals, not official grades.
- Express REST API with JWT sessions, bcrypt password accounts, role/project membership authorization, and validated input.
- CRUD flows for projects, tasks, and evidence; members may update status on tasks assigned to them and manage their own evidence.
- Real GitHub commits and pull requests for a configured project repository, with duplicate-safe imports and a project audit entry.
- Role-authorized dispute resolution and append-only audit history.
