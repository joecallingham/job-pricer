# Job Pricer

Joe's freelance quoting tool. Paste a brief, get a task list in half days, edit it, and send a price range with an itemised breakdown. Runs on the Mac mini; installs as an app on the laptop and the phone.

## Run it

    npm install
    npm run fonts      # copies Nuckle from ~/Projects/sumo-joe-studio (gitignored: desktop licence)
    cp .env.example .env   # then add ANTHROPIC_API_KEY to switch on "Price the brief"
    npm start          # http://127.0.0.1:4350
    npm test           # the pricing maths, hand-worked cases

Without a key everything works except reading a brief: use "Start blank" and type the tasks.

## On the phone and laptop

The server only listens on the Mac mini itself. To reach it from other devices without putting it on the internet, use Tailscale (free personal plan):

1. Install Tailscale on the Mac mini, the laptop and the iPhone, signed in to the same account.
2. On the Mac mini: `tailscale serve --bg 4350`. It prints an https address like `https://mac-mini.<tailnet>.ts.net`.
3. iPhone: open that address in Safari → Share → Add to Home Screen. Laptop: open it in Chrome → Install.
4. Keep the server running: install `scripts/com.sumojoe.jobpricer.plist` as a login item (instructions inside the file).

Quotes stay on the Mac mini (`quotes/`, gitignored). Offline, the app opens but cannot load or save quotes.

## Pricing decisions

From the "Job Pricer — Pricing Logic" Claude Doc, with Joe's answers of 7 Nov 2026. All in `src/pricing.js` (`RULES`).

- Day rate £350, half days pro rata (£175). £200 is the minimum for any job.
- High estimate per task = low × 1.3, rounded up to the half day. Joe edits the low figure.
- Included, shown as lines: 2 major amend rounds = 25% of design + production days (Concept and Design stages); 10 minor tweaks, no charge; project management = 10% of task days + amends days; contingency = 10% of the high side only.
- Fixed extras: weekend or evening days +50% of the day rate; extra major rounds £350–700 each (suggested from project size, editable); extra tweaks £50 per 4; extra formats £50 each.
- Percentage uplifts apply to the fee (work + included lines + fixed extras, plus contingency on the high side) at both ends, added not compounded: rush +25%, advertising usage 20/30/40/50%, source files +10%.
- Pass-through costs (stock, fonts, print, travel) at cost +10%, never uplifted.
- Both totals rounded to the nearest £50.

Not decided yet, so set as above: whether discovery counts as design days (it doesn't), whether a single extra tweak still costs £50 (it does: £50 per batch of up to 4), and what counts as a major round versus tweaks (Joe decides; scope watch will flag).

## Products

Pricing is built from the product catalogue in `data/catalogue.json` (17 products, sizes S/M/L, draft days). Switch a product on and pick a size in the Job view: its template tasks, pass-through costs and monthly figure come in, and every task's days stay editable. Each product shows its own cost: its work plus its share of amends, project management and contingency, plus its pass-through. One kick-off per job (half a day, a full day with three or more products). The day rate is editable per quote. Monthly figures are a separate line, never in the one-off total. `node scripts/catalogue-table.mjs` prints the catalogue priced for review.

## Brief reading

`src/parse.mjs` sends the brief to the Claude API (`claude-opus-5-5`, structured JSON output, server-side refusal fallback on). About 3–4p per brief (measured 9 Nov). The model picks catalogue products and sizes, plus any extra tasks, and returns deliverables, assumptions, exclusions and suggested add-ons with reasons; the server cleans the numbers before the page sees them.

## Invoices

Invoice tab, on the open quote. Set the days actually worked per task; the invoice is priced with the same rules as the quote's low side, as one figure (no contingency, no VAT: not VAT registered). Lines are whole pounds and the total is their sum. Monthly figures are billed separately, never on these invoices.

- Full: one invoice for the work. Deposit: a % of the quoted low total (default 50%). Final: the actual total less the deposits already invoiced for that quote.
- "Make the PDF" takes the next number (INV-0001 onwards, never reused), freezes the invoice in `invoices/INV-xxxx.json` and prints `invoices/INV-xxxx.pdf` with headless Chrome from the server's own page (`src/invoice-pdf.mjs`). Only paid/unpaid changes after that; the PDF is re-printed to show Paid.
- Your details (name, trading name, address, email, bank details, days to pay, next number) live in `settings.json`. Both it and `invoices/` are gitignored and exist only on the Mac mini: back them up.

## Stored quote (for scope watch, later)

Each quote is one JSON file: client, project, deadline, brief, deliverables, tasks, assumptions, exclusions, add-ons, `included` (2 major rounds, 10 tweaks), `status` (draft/sent/agreed), `scopeLog` (empty, for scope watch) and a `totals` snapshot.

## Avg Joe hub

`src/pricing.js` is plain JavaScript with no page or network code, so the hub app can import it as is. The page (`public/`) is one view set that can move into the hub as a feature.
