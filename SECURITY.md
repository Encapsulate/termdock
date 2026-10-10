# Security policy

## Supported versions

Security fixes are applied to the current release on the `main` branch. Until
the project has multiple maintained release lines, older versions should be
upgraded before reporting a reproducible issue.

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability. Use GitHub's
private vulnerability reporting feature for this repository. Include the
affected version or commit, deployment topology, reproduction steps, impact,
and any proposed mitigation. Do not include real credentials, SSH keys,
terminal output, or host-identifying data.

## Deployment boundary

TermDock defaults to `127.0.0.1` deliberately. Its built-in HTTP Basic
authentication protects access but does not encrypt traffic. For access from
another machine, use either:

1. an SSH tunnel, or
2. an authenticated HTTPS reverse proxy with WebSocket support.

Never bind TermDock directly to an untrusted network over plain HTTP. Keep the
ttyd backend loopback-only. Treat anyone who can use TermDock as having an
interactive login to the configured SSH account.

## Private material

The installer keeps the web password hash, SSH identity path, generated local
SSH key, known-hosts file, and tab registry outside the source checkout. The
repository intentionally ignores common key, environment, state, and host-key
files. Before publishing a fork, inspect the complete Git history—not only the
working tree—for secrets and machine-specific data.
