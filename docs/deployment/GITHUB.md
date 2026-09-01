# Pushing the project to GitHub

The workspace already has a `.gitignore` (ignores `node_modules`, `.next`, `.env*`, logs, coverage) so certs/secrets won't be committed. Secrets are **never** committed — only `.env.example` is tracked.

## Option A — Link an existing local Git repo (recommended)

```bash
cd cloudcols

# 1. Start a repo if not already one
git init
git add -A
git commit -m "CloudCols: Phase 1 + Phase 2 (mock data, Supabase auth, Backblaze B2)"

# 2. Create a remote and push
git remote add origin https://github.com/<your-username>/cloudcols.git
git branch -M main
git push -u origin main
```

## Option B — Push an existing GitHub repo you created

If you already made an empty `cloudcols` repo on GitHub, just:

```bash
cd cloudcols
git add -A
git commit -m "CloudCols: Phase 1 + Phase 2"
git remote add origin https://github.com/<your-username>/cloudcols.git
git branch -M main
git push -u origin main
```

## Authenticating with GitHub

- **HTTPS (easiest):** use a PAT — `https://<TOKEN>@github.com/<user>/<repo>.git`, or configure a credential helper so you're not prompted.
- **SSH:** `git remote add origin git@github.com:<user>/cloudcols.git` (needs an SSH key in `~/.ssh` and added to your GitHub account).

> Tip: set your Git identity first so commits are attributed to you:
> `git config --global user.name "Your Name"`
> `git config --global user.email "you@example.com"`

## What's safe for GitHub

- The full source (Next.js app, API routes, Supabase migration, docs, tests).
- `.env.example` (placeholders only).

## Never commit

- `.env`, `.env.local`, or any `.env*` file containing real keys.
- Real Supabase service-role keys, B2 application keys, Cloudflare API tokens, payment secrets.
- `node_modules/`, `.next/`, `dist/`, logs, or coverage.

The `.gitignore` already excludes these. If you accidentally stage a real secret, remove it from history with `git rm --cached` and rotate the key.

## Recommended structure to push

If `cloudcols/` lives inside `/home/user/cloudcols`, push that folder as the repo root:

```bash
cd /home/user/cloudcols
git init && git add -A && git commit -m "init"
git remote add origin <your-repo-url>
git push -u origin main
```
