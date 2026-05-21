# Funding Gilbert Codex

Gilbert Codex can show voluntary project-funding options inside the app without handling payments directly. The desktop app only opens public hosted provider links in the user's browser.

## Current Setup

Funding links are disabled by default unless a local build is configured with public hosted links. Stripe and Cash App stay hidden until real hosted links are configured. PayPal stays visible as `Coming soon` until the real PayPal link is added.

## Optional Stripe Setup

Use Stripe Payment Links first:

- Create a one-time pay-what-you-want Payment Link for `Fund Gilbert Codex`.
- Create a separate recurring Payment Link for monthly support if you want subscriptions.
- Keep dynamic payment methods enabled in Stripe so Stripe can decide which eligible methods to show.
- Let Stripe handle checkout, receipts, payment method collection, disputes, and payment security.

Stripe references:

- [Payment Links](https://docs.stripe.com/no-code/payment-links)
- [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- [Cash App Pay](https://docs.stripe.com/payments/cash-app-pay)

## App Configuration

Add only public hosted funding URLs to `.env` before building:

```env
VITE_SUPPORT_STRIPE_ONE_TIME_URL=https://buy.stripe.com/...
VITE_SUPPORT_STRIPE_MONTHLY_URL=https://buy.stripe.com/...
VITE_SUPPORT_PAYPAL_URL=
VITE_SUPPORT_CASHAPP_URL=
```

Empty Stripe and Cash App values are hidden until configured. Empty PayPal stays visible as `Coming soon`. Gilbert Codex should never invent placeholder payment links.

The public GitHub release workflow does not require `VITE_SUPPORT_*` variables. If a maintainer makes a custom local build with support links, those values are baked into the packaged frontend and can be inspected by app users, so use only public hosted URLs; never use private account secrets, access tokens, webhook secrets, or raw API keys.

## Safety Rules

- Never put Stripe `sk_...`, `rk_...`, `whsec_...`, API keys, webhook secrets, access tokens, or private account data in Vite environment values.
- Do not collect card data inside Gilbert Codex.
- Do not add a custom payment backend unless the project is ready to host secrets, configure webhooks, and handle production payment operations.
- Keep funding voluntary. No popups, paywalls, locked features, or guilt messaging.

## Release Checklist

1. Create the provider links in the provider dashboard.
2. Put the public hosted links in `.env`.
3. Run `npm.cmd run typecheck`.
4. Run `npm.cmd run build`.
5. Open the funding page and confirm configured hosted links open externally.
6. Confirm PayPal is the only visible `Coming soon` provider while it has no URL.
