# Download Page QA Checklist

## Required gate

- [ ] Platform selection remains inline in the download card.
- [ ] Email input is always visible.
- [ ] Download stays visually gated until both legal/content checkboxes are checked and a valid email is entered.
- [ ] Email is required before download.
- [ ] The “Send me important release/setup updates for Paperweight.” checkbox is optional.
- [ ] Toggling the updates checkbox does not enable or disable the download button.

## Lead capture

- [ ] Clicking download posts `/api/download-lead` with `{ email, platform, updatesOptIn }`.
- [ ] With updates enabled, the page shows “Saving update preference…” then “Updates enabled for <email>.” on success.
- [ ] With updates disabled, the page shows “Saving email…” then “Email saved for this download.” on success.
- [ ] If lead capture fails, the page shows a non-blocking error and still opens the selected download URL.
- [ ] Invalid email cannot pass the client-side gate.

## Platform help modal

- [ ] Windows shows the installer help button and opens SmartScreen guidance.
- [ ] macOS Apple Silicon shows the installer help button and opens Gatekeeper guidance.
- [ ] macOS Intel shows the installer help button and opens Gatekeeper guidance.
- [ ] Linux x64 hides the installer help button.
- [ ] Raspberry Pi / Linux ARM64 hides the installer help button.
- [ ] Modal closes via close button, backdrop click, and Escape.

## Regression checks

- [ ] Existing Discord placeholder download URLs are unchanged.
- [ ] Landing/index links are unchanged.
- [ ] Download URL opens in a new tab/window after the lead capture attempt.
- [ ] Download page JavaScript parses without syntax errors.
