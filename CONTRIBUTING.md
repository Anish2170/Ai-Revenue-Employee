# Contributing

Thank you for contributing to AI Revenue Employee. This project is a full-stack SaaS application, so safe changes start with a clean local setup, clear boundaries, and build verification.

## Local Setup

1. Clone the repository.
2. Install dependencies in each package:

```bash
cd backend
npm install

cd ../dashboard
npm install

cd ../widget
npm install
```

3. Configure backend environment:

```bash
cd backend
cp .env.example .env
```

4. Fill in local values for `DATABASE_URL`, `GEMINI_API_KEY`, `SESSION_SECRET`, `FRONTEND_URL`, `DASHBOARD_ORIGIN`, `WIDGET_BASE_URL`, and `CORS_ORIGIN`.

5. Prepare Prisma:

```bash
cd backend
npm run prisma:generate
npm run prisma:migrate
```

6. Start local services:

```bash
cd backend
npm run dev
```

```bash
cd dashboard
npm run dev
```

```bash
cd widget
npm run watch
```

## Development Workflow

- Create a feature branch from `main`.
- Keep changes focused and avoid mixing unrelated refactors.
- Do not commit `.env`, logs, `node_modules`, `.next`, `dist`, generated widget bundles, local database files, or cache files.
- Add or update tests when changing backend validation, AI decision logic, retrieval, or data persistence.
- Keep model prompts and validators versioned carefully because they define product behavior.
- Update documentation when changing setup, deployment, user flows, or architecture.

## Validation Before Commit

Run the production build checks:

```bash
cd backend
npm run build

cd ../dashboard
npm run build

cd ../widget
npm run build
```

Recommended additional checks:

```bash
cd backend
npm test
```

```bash
cd dashboard
npm run lint
```

## Pull Request Checklist

- The branch is up to date with `main`.
- No secrets or generated artifacts are committed.
- Build checks pass for backend, dashboard, and widget.
- Database schema changes include Prisma migrations.
- Environment variable changes are reflected in `backend/.env.example`.
- User-facing workflow changes are reflected in README or docs.
- Deployment risks are called out in the PR description.

## Security

Never include real API keys, database credentials, session secrets, private keys, or customer data in commits, issues, screenshots, logs, or pull requests. If a secret is accidentally committed, rotate it immediately before continuing work.
