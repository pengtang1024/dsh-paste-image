# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

The plugin is pre-1.0; security fixes land in a new 0.1.x patch release.

## Reporting a vulnerability

Please report privately. Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. If that flow is unavailable, contact the maintainer [@pengtang1024](https://github.com/pengtang1024) on GitHub and ask for a private channel — do not open a public issue with exploit details.

A good report includes:

- DSH version and how the plugin was installed.
- OS and desktop session.
- The affected format or decoder (XPM, BMP, sniffing, the reroute path).
- A minimal reproducer: the file or the exact bytes, plus the steps.
- The Console output at Verbose level, including any `[dsh-paste-image]` line.

You can expect an acknowledgement on a best-effort basis, a fix in a patch release when the report is confirmed, and credit in the release notes unless you prefer otherwise.

## Scope

`dsh-paste-image` runs entirely in the DSH renderer. It has no network access, no background process, no clipboard polling and does not modify DSH host code. Its whole job is: read a file from a `paste` or `drop` event, decode it locally, re-encode it as PNG, and dispatch a synthetic `drop` event in the same window.

In scope:

- Crashes, hangs or memory exhaustion caused by a crafted XPM or BMP file.
- Parser bugs that produce wrong pixels in a way that could mislead a user.
- Bypasses of the documented limits (8 files per event, 4096 px longest side for converted images).
- Ways to make the plugin read or transmit data beyond the pasted or dropped file.

Out of scope:

- Vulnerabilities in DSH itself, in Electron/Chromium, or in the operating system.
- Attacks that already require control of the renderer or the ability to install a plugin; such code already has full page privileges.
- Social-engineering reports and denial-of-service through enormous but ordinary files that the browser itself cannot handle.

## Design notes

- The plugin reads bytes only from the event's `clipboardData.files` or `dataTransfer.files`.
- Decoding happens with the browser's own codecs plus two small local parsers; nothing is sent anywhere.
- Converted files are new in-memory `File` objects. Nothing is written to disk and nothing persists after the page unloads.
- There are no third-party runtime dependencies.
