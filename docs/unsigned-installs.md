# Unsigned Install Notes

Pixel Agent Garden releases are currently unsigned. The app is still intended
for public use, but macOS Gatekeeper and Windows SmartScreen may warn because
the installer does not yet carry an OS-trusted publisher signature.

Before installing, verify the release came from the official repository:

1. Download only from
   <https://github.com/DipsySu/pixel-agent-garden/releases>.
2. Check that the release tag matches the version you intended to install.
3. If you are security-sensitive, read `PRIVACY.md` and run the zero-network
   verification recipe after first launch.

## macOS

Use the `.dmg` attached to the release.

1. Open the `.dmg` and drag `Local Agent Garden.app` into Applications.
2. If double-clicking says the app cannot be opened because it is from an
   unidentified developer, right-click the app and choose **Open**.
3. If macOS still blocks it, open **System Settings -> Privacy & Security** and
   allow the blocked app.

This warning is expected until macOS Developer ID signing and notarization are
enabled.

## Windows

Use the `Local.Agent.Garden_*_x64-setup.exe` installer.

1. Run the installer from the GitHub release asset.
2. If SmartScreen appears, choose **More info**.
3. Confirm the publisher is unknown because the build is unsigned, then choose
   **Run anyway** if you trust this release.

This warning is expected until Windows code signing is enabled. A future signed
release should show a publisher identity instead of an unknown publisher.

## Linux

Linux builds are not OS-code-signed in the same desktop-notarization sense.
Use either:

- `.AppImage`: make it executable with `chmod +x *.AppImage`, then run it.
- `.deb`: install with your package manager.

## Signing Roadmap

Code signing policy:
[docs/code-signing-policy.md](code-signing-policy.md).

The release workflow already has guarded signing hooks:

- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`
- Windows: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`,
  `WINDOWS_CERTIFICATE_THUMBPRINT`, optional `WINDOWS_TIMESTAMP_URL`

When those secrets are present, the release job switches the matching platform
from unsigned to signed. Missing secrets keep unsigned builds working.

For Windows open-source signing, the project is applying for SignPath
Foundation signing. Free code signing provided by SignPath.io, certificate by
SignPath Foundation.

## 未签名安装说明

Pixel Agent Garden 当前 release 仍是未签名构建。应用可以公开安装，但 macOS
Gatekeeper 和 Windows SmartScreen 可能会提醒，因为安装包还没有系统信任的发布者签名。

安装前请先确认来源：

1. 只从 <https://github.com/DipsySu/pixel-agent-garden/releases> 下载。
2. 确认 release tag 是你想安装的版本。
3. 如果你对安全更敏感，先读 `PRIVACY.md`，首次启动后按里面的方法验证零网络请求。

### macOS

下载 release 附带的 `.dmg`。

1. 打开 `.dmg`，把 `Local Agent Garden.app` 拖到 Applications。
2. 如果双击提示来自未识别开发者，右键 app，选择 **Open**。
3. 如果仍被拦截，打开 **System Settings -> Privacy & Security**，允许刚才被拦截的 app。

这是启用 Developer ID 签名和 notarization 前的预期提示。

### Windows

下载 `Local.Agent.Garden_*_x64-setup.exe`。

1. 从 GitHub release asset 运行安装器。
2. 如果 SmartScreen 弹出，选择 **More info**。
3. 确认 unknown publisher 来自未签名构建；如果你信任该 release，选择 **Run anyway**。

启用 Windows code signing 后，后续 release 应显示发布者身份，而不是 unknown publisher。

### Linux

Linux 构建没有同样的桌面签名/公证流程：

- `.AppImage`: 执行 `chmod +x *.AppImage` 后运行。
- `.deb`: 用系统包管理器安装。

### 签名路线

代码签名策略见：[docs/code-signing-policy.md](code-signing-policy.md)。

release workflow 已经预埋 secret-gated 签名钩子：

- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`
- Windows: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`,
  `WINDOWS_CERTIFICATE_THUMBPRINT`, 可选 `WINDOWS_TIMESTAMP_URL`

这些 secrets 存在时，对应平台会从 unsigned build 切到 signed build；缺少 secrets
时，unsigned release 仍会照常发布。

Windows 开源签名方向会先申请 SignPath Foundation。Free code signing
provided by SignPath.io, certificate by SignPath Foundation.
