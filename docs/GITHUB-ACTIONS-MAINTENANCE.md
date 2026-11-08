# GitHub Actions maintenance

CI checks the `runs.using` declaration of each action at the exact commit SHA referenced by every workflow. JavaScript actions must declare Node.js 24 or newer. Changing `setup-node` or the version comment beside a SHA does not satisfy this check.

Dependabot checks GitHub Actions weekly and opens a grouped pull request for available updates, including major versions. Full commit SHA pins remain required. Update PRs must pass CI before merging.

The GitHub Actions Health workflow runs the same runtime check every Monday and can also be run manually. Both schedules become active when their files reach the repository's default branch. Update PRs need to be merged to take effect.

Run the checks locally:

```powershell
npm run check:dependency-pins
npm run test:action-runtimes
npm run check:action-runtimes
```

The live runtime check requires GitHub API access. In CI it uses the job's read-only `GITHUB_TOKEN`. An unavailable manifest, an API failure, or an uninspectable runtime fails the check rather than being treated as success.

Use normal block-style YAML `uses:` entries. Composite actions and remote reusable workflows require nested-action inspection before they can be introduced. Keep `minimumNodeMajor` in `scripts/check-action-runtimes.mjs` aligned with GitHub's supported JavaScript action runtimes as future runtimes are retired.
