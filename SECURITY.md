# Security

Please report vulnerabilities privately to **hello@videmak.net** with "Security" in the subject, not in a public issue. Include what you found, how to reproduce it and what an attacker could do with it. We will reply and tell you when it is fixed.

This covers this repository and the services at videmak.net and api.videmak.net. Please don't access other people's data, run load tests or use social engineering while testing.

## Running your own copy safely

- Keep `JWT_SECRET`, `SETTINGS_KEY` and `.env` private. `SETTINGS_KEY` encrypts the provider keys admins save in the browser.
- Put Videmak behind HTTPS (see the README) before real people use it.
- People become admins only from `ADMIN_EMAILS` after confirming their email, or with `admin-grant` from the server's shell.
- Live Stripe keys work only with `BILLING_LIVE=1` in the server's environment, so payments can't be switched on from the browser.
