# The Cocoon Luxury Suites Hotel — Invoice Generator

A single-page invoice studio for **The Cocoon Luxury Suites Hotel**. Add line items,
watch the totals recalculate live, then download the invoice as a PDF or send it to
the guest by email or WhatsApp.

No build step, no framework, no server, no tracking — everything runs in the browser.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell: brand header, editor form, live A4 preview, action toolbar |
| `styles.css` | The hotel's website palette (near-black + brand gold), responsive layout, invoice (A4) styling, print rules |
| `assets/cocoon-logo.png` | The hotel's own wordmark from cocoonogudu.com — shown in the app header and inlined as a data URI on the invoice |
| `app.js` | State, totals maths, live rendering, PDF export, email / WhatsApp / clipboard sharing |

## Run it

Open `index.html` directly in a browser, or serve the folder (recommended, so
`localStorage` drafts behave on every browser):

```powershell
cd C:\Users\HP\Documents\cocoon
python -m http.server 8000
# then open http://localhost:8000/
```

## Features

* **Line items** — description, quantity and unit price with hotel-flavoured
  autocomplete suggestions (suite accommodation, airport pickup, laundry, spa …).
  `Enter` moves description → qty → price, and from the last price it adds a new row.
* **Automatic maths** — line amounts, subtotal, optional discount %, optional tax/VAT %,
  and the total, all calculated in integer cents so rounding is always exact.
* **Amount in words** — e.g. “One Hundred and Thirty Thousand Six Hundred and Twelve Naira and 50/100 only”.
* **Live preview** — a real A4 invoice (logo, issuer block, billed-to facts, itemised
  table, totals, notes, payment instructions) that updates on every keystroke.
* **Download PDF** — rendered in the browser with [html2pdf.js](https://github.com/eKoopmans/html2pdf.js)
  (jsPDF + html2canvas) from an off-screen A4-width clone, so the PDF looks identical
  on desktop and mobile. If the CDN is unreachable, the app falls back to the browser's
  print dialog (“Save as PDF”). `Ctrl`/`Cmd` + `S` does the same thing.
* **Email invoice** — opens the default mail client with the subject and a complete
  itemised plain-text summary, pre-filled with the guest's address.
* **WhatsApp** — opens `wa.me` with a WhatsApp-formatted (bold) version of the invoice;
  if the guest's phone number includes a country code the chat opens directly.
* **Share PDF file** — on devices that support the Web Share API with files
  (most mobile browsers), the real PDF is handed to the share sheet so it can be
  attached in WhatsApp, Mail, etc. Hidden where unsupported.
* **Copy summary** — puts the plain-text invoice on the clipboard.
* **Draft autosave** — the invoice, hotel details and guest details are stored in
  `localStorage` on this device only; “New invoice” keeps the hotel details and
  issues the next invoice number (COC-YYYY-NNNN).
* **Print** — `Ctrl`/`Cmd` + `P` prints just the invoice (`@media print` hides the editor).
* **Invoice & receipt history** — the *Save to history* toolbar button files a full
  snapshot of the current document in `localStorage` (`cocoon.history.v1`, this device
  only — never uploaded). The *History* card lists every filed invoice and receipt with
  its number, guest, total and saved time: **Open** restores it into the editor,
  **Duplicate** issues it again as a fresh document with the next number, and **Delete**
  removes one entry (*Clear all* empties the archive). Re-filing the same document
  number updates its entry instead of piling up copies, the newest 100 documents are
  ever kept, and a corrupted history degrades to an empty list rather than breaking
  the app.

## Customising for the hotel

* **Hotel details** are edited in the first card of the form and saved with the draft —
  `DEFAULT_HOTEL` at the top of `app.js` holds the shipped defaults (name, branch,
  address, phone, email, website, tagline). Change that object to change the defaults
  for a new device.
* **Branch** — the picker is a closed `<select>` listing the hotel's branches, and it
  ships with the single **Ogudu** branch. `DEFAULT_BRANCHES` in `app.js` holds the
  street / city / phone / email / website profile per branch; picking a branch pre-fills
  those fields, and any edit to them is remembered on the device (under
  `cocoon.hotel.branches.v3`). Drafts that name a branch which is no longer listed fall
  back to the Ogudu flagship.
* **Rooms & rates** — `ROOMS` at the top of `app.js` is the single source of the rate
  card: the rooms published at [cocoonogudu.com/rooms-and-suites](https://cocoonogudu.com/rooms-and-suites),
  each room carrying its category's nightly rate (Studio ₦50,000 · Standard ₦55,000 ·
  Superior ₦60,000 · Deluxe ₦65,000 · Executive ₦75,000 · Presidential Suite ₦95,000).
  The category and room pickers, the rate card and every new line item all read from
  that one list, so a room's name, its category and its rate always agree. Change a
  rate (or add/rename a room) there and the whole app follows — the invoice description
  suggestions pick the new room labels up too.
* **Currency** — pick from the list in *Invoice details*; add or remove entries in the
  `CURRENCIES` array in `app.js` (and `CURRENCY_WORDS` if you want the amount-in-words
  line to name a new currency).
* **Tax** — set the label (VAT, GST, Sales tax …) and the percentage; leave the rate at
  `0` for tax-free invoices and the tax row disappears from the invoice.
* **Branding** — the palette and type come from the hotel's own site
  (cocoonogudu.com): near-black chrome, the brand orange-gold `#FE801A` with the
  deeper `#D7981C`, white content and the site's greys. It all lives in the `:root`
  block of `styles.css`. The logo is `assets/cocoon-logo.png` (the site's wordmark,
  used as-is in the app header and as the favicon) and is inlined as a data URI in
  `LOGO_INVOICE_PNG` (`app.js`) for the invoice/PDF, so neither the printout nor the
  offline app ever needs the network.

## Testing (developer tooling, optional)

The app itself has no dependencies. A small [jsdom](https://github.com/jsdom/jsdom)
harness drives the real page — typing into the fields, clicking the buttons — and
checks the totals maths, the rendered invoice, the email/WhatsApp links, the draft
autosave and the PDF options:

```powershell
cd C:\Users\HP\Documents\cocoon\tests
npm install jsdom     # creates tests\node_modules; nothing in node_modules ships with the app
node smoke.js
```

Expected output ends with `368 checks passed, 0 failed` and exits with code `0`.

## Notes & limitations

* The PDF engine is loaded from cdnjs with a Subresource Integrity hash. Offline the
  buttons still work through the print dialog, but a page reload is needed once online.
* `mailto:` cannot attach files. Use **Download PDF** / **Share PDF file** to send the
  actual file, or attach the downloaded PDF to the mail yourself.
* WhatsApp deep links carry text only, so the WhatsApp message contains the full
  itemised summary; attach the PDF from **Share PDF file** on mobile.
* Very long invoices (dozens of items) paginate across A4 pages; rows and the totals
  block are kept whole across page breaks.
* Guest data never leaves the device — nothing is uploaded, and the preview is built
  with escaped text so pasted HTML cannot inject markup.
