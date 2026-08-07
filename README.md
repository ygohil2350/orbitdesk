# OrbitDesk

OrbitDesk is a portfolio-ready, multi-tenant project workspace with a Kanban workflow, role-controlled provisioning, task rooms, live comments, and secure attachments. It is designed to run as an isolated three-container Portfolio Launcher session.

## Run it

```bash
cp .env.example .env       # optional for local demo; Compose has safe demo defaults
docker compose up --build -d
```

Open `http://localhost:8080`. Migrations and idempotent demo seeding run automatically before the API starts.

### Demo accounts

| Role | Email | Password | Purpose |
|---|---|---|---|
| System super user | `super@orbitdesk.demo` | `SuperDemo123!` | Provision organizations and their first admin |
| Organization admin | `admin@northstar.demo` | `AdminDemo123!` | Board access and member provisioning |
| Developer/member | `dev@northstar.demo` | `MemberDemo123!` | Create, move, discuss, and attach files to tasks |
| Member | `member@northstar.demo` | `MemberDemo123!` | A second collaborator for assignments and chat |

The login screen uses one email/password form prefilled with the organization-admin demo. Roles are resolved from the authenticated `/auth/me` response and are never selected or trusted in the browser. These credentials are deliberately obvious and are only for ephemeral demos.

## Architecture

- **web :80** — React 19 + TypeScript + Tailwind CSS 4 + Material UI + Vite, compiled and served by Nginx with SPA fallback and iframe-compatible headers.
- **api :8000** — FastAPI, Pydantic validation, SQLAlchemy async ORM, JWT bearer auth, streaming multipart uploads, and authenticated task-room WebSockets.
- **db :5432** — PostgreSQL 17 with Alembic migration, composite tenant foreign keys, useful indexes, and a partial unique index that permits exactly one system super user.

The browser uses only same-origin `/api/v1` URLs. Portfolio Launcher routes that prefix to `api`; Nginx serves everything else. Task-room sockets authenticate with their first frame instead of putting bearer tokens in query strings. The included in-memory room broadcaster is appropriate for the single lightweight API replica; a multi-replica deployment should swap it for a shared pub/sub adapter.

## Security model

- Tenant IDs are derived from the verified user, never trusted from payloads.
- Composite `(resource_id, organization_id)` foreign keys prevent cross-tenant references at the database layer.
- A PostgreSQL partial unique index makes a second `superuser` row impossible, including under concurrency.
- Only the super user provisions organizations; only an organization admin provisions members.
- Pydantic rejects unknown payload properties and validates UUIDs, bounds, email addresses, enums, and workflow transitions.
- Uploads use generated storage keys, stream to a tenant directory, enforce a 10 MB default limit, compare declared MIME with magic bytes, hash content, and never serve paths supplied by users.
- Cross-tenant resource probes return 404 to avoid leaking record existence.

For a public production deployment, replace both secrets in `.env`, use object storage plus malware scanning for uploads, put TLS at the edge, and use short-lived access tokens with a refresh-token flow.

## Development checks

Frontend:

```bash
cd frontend
npm install
npm run lint
npm run typecheck
npm run build
```

Backend:

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
JWT_SECRET=test-only-secret-that-is-at-least-32-characters .venv/bin/ruff check .
JWT_SECRET=test-only-secret-that-is-at-least-32-characters .venv/bin/mypy app
JWT_SECRET=test-only-secret-that-is-at-least-32-characters .venv/bin/pytest
```

Windows PowerShell users should use `.venv\Scripts\python` and `$env:JWT_SECRET='…'`.

## API highlights

- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- `POST /api/v1/admin/organizations` (super user)
- `POST /api/v1/members` (organization admin)
- `GET|POST /api/v1/tasks`, `PATCH /api/v1/tasks/{id}`, `PATCH /api/v1/tasks/{id}/status`
- `POST /api/v1/tasks/{id}/attachments`, `POST /api/v1/comments/{id}/attachments`
- `WS /api/v1/ws/tasks/{id}` with `{ "type": "auth", "token": "..." }` as the first frame
- `GET /api/v1/health` verifies database readiness

## Portfolio catalog object

```json
{
  "slug": "orbitdesk",
  "name": "OrbitDesk — Secure Team Workspace",
  "description": "A multi-tenant Kanban workspace with strict RBAC, live task conversations, and secure attachments.",
  "repositoryUrl": "https://github.com/OWNER/orbitdesk",
  "taskDefinition": "portfolio-orbitdesk",
  "containerPort": 80,
  "healthPath": "/"
}
```
