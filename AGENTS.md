# Agent Notes — friendlies

## Supabase Connection

- **Connection string:** stored in root `.env` as `DATABASE_URL` (not committed to git)
- Use this for migrations, debugging RLS issues, and direct SQL queries.

## Version Bump & Release Process

Every release MUST update the version in ALL THREE locations:

1. `apps/agent/package.json` → `"version": "X.Y.Z"`
2. `apps/agent/src/renderer/components/Navigation.tsx` → `vX.Y.Z` string in the sidebar
3. `apps/agent/src/renderer/pages/Settings.tsx` → `friendlies vX.Y.Z` string in settings

### Release Steps (in order)

```bash
# 1. Stage and commit all changes
git add -A
git commit -m "description of changes, bump to vX.Y.Z"

# 2. Push to master (default branch is master, NOT main)
git push origin master

# 3. Create and push the tag (triggers GitHub Actions build)
git tag vX.Y.Z
git push origin vX.Y.Z

# 4. Wait for GitHub Actions to finish (~10-15 min)
#    Monitor: gh run list --limit 3

# 5. CRITICAL: Publish the release (it may land as draft despite workflow config)
gh release edit vX.Y.Z --draft=false

# 6. Verify it's published
gh release view vX.Y.Z
```

### Why `gh release edit --draft=false` is required

The `softprops/action-gh-release@v2` action in `build.yml` has `draft: false`, but
GitHub sometimes still creates releases as drafts (possibly due to repo settings or
race conditions with artifact uploads). ALWAYS run `gh release edit` after the
workflow completes to guarantee the release is published. The electron-updater in
the app only sees non-draft releases marked "Latest".

### Checking for draft releases

```bash
gh release list --limit 5
```

Any release showing "Draft" must be published with `gh release edit vX.Y.Z --draft=false`.
