# Code Signing Policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

Pixel Agent Garden is applying for SignPath Foundation signing for official
Windows release artifacts. Until that application is accepted and wired into
the release workflow, published builds may remain unsigned and should be
installed using the unsigned-install guidance.

## Scope

Signing applies only to official Pixel Agent Garden release artifacts built
from this repository:

- Source repository: <https://github.com/DipsySu/pixel-agent-garden>
- Download page: <https://github.com/DipsySu/pixel-agent-garden/releases>
- Windows artifact: the NSIS `*-setup.exe` installer produced by the release
  workflow

The signing process must not sign third-party upstream project binaries under
the Pixel Agent Garden subscription. Bundled system libraries or open-source
dependencies may be included only as part of the normal application package.

## Team Roles

- Committers and reviewers: `DipsySu`
- Signing approvers: `DipsySu`

For a solo-maintained release, the signing approver is responsible for checking
that the artifact comes from the intended source revision and release workflow.

## Release Requirements

Before a release artifact is submitted for signing:

1. The release must be built from source code in the public repository.
2. The release workflow must run from a version tag or an explicit release
   dispatch.
3. CI should pass for formatting, linting, and tests.
4. Release notes should identify the version being published.
5. The package must preserve the project privacy contract: no telemetry, no
   analytics, and no network calls in scan/render paths.

## Verification

Users should download releases only from the official GitHub Releases page and
verify that the release tag matches the intended version. Signed Windows
releases should show a trusted publisher instead of an unknown publisher.
