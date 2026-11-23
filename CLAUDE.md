# Job Pricer: notes for Claude

Plain Node (no framework): `server.mjs` (static files + /api), `src/pricing.js` (all maths, shared by page and tests), `src/parse.mjs` (Claude API), `public/` (page, Avg Joe system v3 frame and kit).
- Any pricing change goes in `src/pricing.js` with a hand-worked test in `test/pricing.test.mjs`. Run `npm test`.
- Data (quotes/, invoices/, settings.json) lives in Google Drive `My Drive/06_Claude_Work/Job Pricer` (`dataDir()` in server.mjs), shared by every Mac. Avg Notch on the MacBook starts the server.
- Fonts, quotes, invoices and settings.json are gitignored (Nuckle desktop licence; client and bank details). Invoices are frozen records: never rewrite an issued one. Never serve them publicly; the server binds to 127.0.0.1 and each Mac runs its own server (no Tailscale, no phone: Joe, 23 Nov).
- The browser pane does not run CSS transitions or service workers; check those in headless Chrome.
- Status and decisions: Joe's Brain, Projects/job-pricer.md.
