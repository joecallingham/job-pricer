# Job Pricer: notes for Claude

Plain Node (no framework): `server.mjs` (static files + /api), `src/pricing.js` (all maths, shared by page and tests), `src/parse.mjs` (Claude API), `public/` (page, Avg Joe system v3 frame and kit).
- Any pricing change goes in `src/pricing.js` with a hand-worked test in `test/pricing.test.mjs`. Run `npm test`.
- Fonts and quotes are gitignored (Nuckle desktop licence; client data). Never serve them publicly; the server binds to 127.0.0.1 and phones reach it through `tailscale serve`.
- The browser pane does not run CSS transitions or service workers; check those in headless Chrome.
- Status and decisions: Joe's Brain, Projects/job-pricer.md.
