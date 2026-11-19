# Releasing KeyBlaze

KeyBlaze is published to the Visual Studio Code Marketplace by the GitHub Actions workflow
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), using **Trusted Publishing**
(OpenID Connect). There is no Personal Access Token: GitHub issues a short-lived OIDC token that `vsce`
exchanges for a Marketplace credential, valid for 15 minutes and usable once. No publishing secret is
stored in the repository or in GitHub secrets.

| Item               | Value                                       |
| ------------------ | ------------------------------------------- |
| Publisher          | `CLdForge` (`package.json` → `publisher`)   |
| Extension ID       | `CLdForge.keyblaze`                         |
| Repository         | `acarlewis/KeyBlaze`                        |
| Publish workflow   | `publish.yml` (manual, `workflow_dispatch`) |
| GitHub environment | `marketplace`                               |

## One-time setup

### 1. Marketplace publisher

The publisher `CLdForge` must exist at <https://marketplace.visualstudio.com/manage>. The publisher
ID must match `package.json` exactly, including its letter case.

### 2. GitHub environment (approval gate)

In the repository, open **Settings → Environments → New environment**, name it `marketplace`, and add
**Required reviewers** (you). Every publish run then waits for your approval. Optionally, restrict
**Deployment branches** to `main`.

### 3. Trusted Publishing policy

1. Sign in to <https://marketplace.visualstudio.com/manage> and open the publisher **CLdForge**.
2. Select **Trusted Publishing**, expand **Create**, and enter:

   | Field            | Value                       |
   | ---------------- | --------------------------- |
   | Policy name      | `KeyBlaze release workflow` |
   | Repository owner | `acarlewis`                 |
   | Repository       | `KeyBlaze`                  |
   | Workflow         | `publish.yml`               |
   | Environment      | `marketplace`               |

3. Select **Create**.

The values must match exactly. For a **private** repository, the policy must be activated by a
successful run of the workflow within 48 hours of creating it, so create the policy only when you're
ready to publish.

### 4. README images

`vsce` rewrites the README's relative image links to
`https://github.com/acarlewis/KeyBlaze/raw/HEAD/…` (the default branch). Marketplace visitors load those
images anonymously, so they only render if the repository is **public** and the images are on
`main`.

## Release checklist (each version)

1. `CHANGELOG.md` has an entry for the version, and `package.json` `version` is set.
2. All changes are merged into `main`.
3. Local validation (Windows):
   ```sh
   npm run check
   npm test                 # unit + integration (current stable VS Code)
   npm run test:min-vscode  # integration on VS Code 1.90.0
   npm run test:vsix        # installs the packaged VSIX into a clean VS Code
   npm run test:visual      # placement, combo, Control Panel and sound in a real VS Code
   ```
4. CI on `main` is green on Windows, macOS and Linux.
5. **Actions → Publish to VS Code Marketplace → Run workflow** on `main`, entering the version (for
   example `0.1.0`).
6. Approve the `marketplace` environment deployment when prompted.
7. Check the listing at `https://marketplace.visualstudio.com/items?itemName=CLdForge.keyblaze`:
   icon, Preview badge, README images, changelog and licence.
8. Create the GitHub release and tag `v<version>` on the published commit.

The workflow publishes exactly the VSIX it built and verified (`vsce publish --oidc --packagePath …`).
It does not create commits or tags.
