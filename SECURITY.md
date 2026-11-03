# Security policy

Report suspected vulnerabilities privately using the repository's **Security → Report a vulnerability** feature when available. Otherwise request a private reporting channel from the maintainer without posting exploit details, credentials or personal records in a public issue.

Use the latest maintained revision. Published experimental features and passing automated tests do not establish production readiness.

Never commit credentials, session cookies, private keys, personal documents or runtime databases. Supply service credentials through environment variables or the platform credential store. If a credential was exposed, revoke it with its provider before replacing it; deleting a file does not revoke a key or remove copies from Git history.

See [the repository audit](SECURITY_AUDIT.md) for the reviewed scope and remaining validation limits.
