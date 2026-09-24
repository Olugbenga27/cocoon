/**
 * Smoke test for the Cocoon invoice generator.
 * Loads index.html from the project folder in jsdom (with the CDN script
 * stripped so the test runs offline), drives the UI the way a user would,
 * and asserts the money maths, the preview and the share links.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM, VirtualConsole } = require('jsdom');

const PROJECT = path.resolve(__dirname, '..');
const INDEX = path.join(PROJECT, 'index.html');

let passed = 0;
const failures = [];
let ACTIVE_WIN = null;

function check(label, condition, extra) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failures.push(label + (extra ? ' -> ' + extra : ''));
    console.log('  FAIL  ' + label + (extra ? ' -> ' + extra : ''));
  }
}

function eq(label, actual, expected) {
  check(label, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function contains(label, haystack, needle) {
  const text = String(haystack);
  check(label, text.indexOf(needle) !== -1, JSON.stringify(needle) + ' not found in ' + JSON.stringify(text.slice(0, 200)));
}

function notContains(label, haystack, needle) {
  const text = String(haystack);
  check(label, text.indexOf(needle) === -1, JSON.stringify(needle) + ' unexpectedly found');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bootstrap(seed) {
  const rawHtml = fs.readFileSync(INDEX, 'utf8');
  const appSource = fs.readFileSync(path.join(PROJECT, 'app.js'), 'utf8');
  const cssSource = fs.readFileSync(path.join(PROJECT, 'styles.css'), 'utf8');

  /* The CDN engine is irrelevant for logic tests — strip it so nothing is fetched. */
  const cdnTag = /<script[^>]*cdnjs[^>]*>\s*<\/script>/i;
  if (!cdnTag.test(rawHtml)) throw new Error('Could not find the html2pdf CDN script tag');
  const html = rawHtml
    .replace(cdnTag, '<!-- cdn stripped for the offline test -->')
    .replace(/<script src="app\.js" defer><\/script>/i, '');

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => { /* window.print / navigation are jsdom stubs */ });
  virtualConsole.on('error', (msg) => console.log('  [console.error] ' + msg));

  const dom = new JSDOM(html, {
    url: 'https://cocoon.local/',           /* https origin so localStorage works */
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });
  const win = dom.window;
  const doc = win.document;

  await new Promise((resolve) => {
    if (doc.readyState === 'complete') return resolve();
    win.addEventListener('load', resolve);
  });

  /* `seed` runs against the fresh window before app.js, so a test can pre-load
     localStorage exactly like a returning visitor's browser would. */
  if (seed) seed(win);

  /* app.js is evaluated at load time, exactly like the deferred <script> would be. */
  win.eval(appSource);
  await sleep(20);

  ACTIVE_WIN = win;
  return { dom, win, doc, rawHtml: rawHtml, cssSource: cssSource };
}

async function run() {
  const { win, doc, rawHtml, cssSource } = await bootstrap();
  const api = win.CocoonInvoice;

  console.log('\n0. Static document & stylesheet checks');
  contains('stylesheet is linked', rawHtml, '<link rel="stylesheet" href="styles.css" />');
  contains('app script is deferred', rawHtml, '<script src="app.js" defer></script>');
  contains('PDF engine loads html2pdf from cdnjs', rawHtml, 'html2pdf.bundle.min.js');
  contains('the CDN script is pinned with an SRI hash', rawHtml,
    'integrity="sha512-+9GoO5OUX2MmPRHUH5dnOY+KGReMLcxywEvQxvAI0y5JxXh/lkz99dKj4xdYfODP3dMFsoZRz4CF/vHcaqa2Ag=="');
  contains('the CDN script is requested with CORS', rawHtml, 'crossorigin="anonymous"');
  ['btn-pdf', 'btn-email', 'btn-whatsapp', 'btn-share', 'btn-print', 'btn-copy', 'btn-new',
    'btn-save-history', 'btn-history-clear', 'history-card', 'history-list', 'history-count',
    'items', 'invoice', 'field-currency', 'pdf-stage', 'toast'].forEach((id) => {
    check('required element #' + id + ' exists', !!doc.getElementById(id));
  });
  eq('stylesheet has balanced braces', (cssSource.match(/\{/g) || []).length, (cssSource.match(/\}/g) || []).length);
  ['oklch(', 'oklab(', 'color-mix(', 'light-dark(', 'lab('].forEach((token) => {
    notContains('stylesheet avoids ' + token + ' (html2canvas cannot parse it)', cssSource, token);
  });
  contains('print rules are present for the fallback', cssSource, '@media print');

  check('app exposes window.CocoonInvoice', !!api);
  if (!api) { win.close(); return; }

  const $ = (selector) => doc.querySelector(selector);
  const $$ = (selector) => Array.prototype.slice.call(doc.querySelectorAll(selector));
  const roleText = (role) => {
    const node = $('[data-role="' + role + '"] span:last-child');
    return node ? node.textContent : null;
  };
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));
  const setField = (dataPath, value) => {
    const el = $('[data-path="' + dataPath + '"]');
    if (!el) throw new Error('missing field ' + dataPath);
    el.value = value;
    fire(el, 'input');
    fire(el, 'change');
    return el;
  };

  console.log('\n1. Initial render');
  eq('starts with one empty line-item row', $$('.item').length, 1);
  eq('invoice shows the empty state', $$('.inv-items__empty').length, 1);
  eq('subtotal starts at zero', roleText('subtotal'), api.formatMoney(0));
  eq('total starts at zero', api.currentTotals().totalCents, 0);
  contains('invoice number is generated', $('[data-role="number"]').textContent, 'COC-' + new Date().getFullYear() + '-');
  /* The wordmark alone brands the printed page — no name/tagline/branch text. */
  eq('no brand text block on the invoice', $$('.inv-name, .inv-tagline, .inv-branch').length, 0);
  check('the wordmark still leads the header', !!$('.inv-brand .inv-logo'));
  eq('default currency is NGN', api.state.meta.currency, 'NGN');
  eq('currency select is populated', $$('#field-currency option').length, 12);
  eq('due date is 14 days after the invoice date', Math.round(
    (new Date(api.state.meta.dueDate) - new Date(api.state.meta.date)) / 86400000), 14);

  console.log('\n2. Line-item maths');
  const row = $('.item');
  const desc = row.querySelector('.item__desc');
  const qty = row.querySelector('.item__qty');
  const price = row.querySelector('.item__price');
  desc.value = 'Executive Suite accommodation';
  fire(desc, 'input');
  qty.value = '3';
  fire(qty, 'input');
  price.value = '45000';
  fire(price, 'input');

  eq('quantity stored in state', api.state.items[0].qty, 3);
  eq('price stored in state', api.state.items[0].price, 45000);
  eq('line amount = 3 x 45,000', row.querySelector('.item__amount').textContent, api.formatMoney(135000));
  eq('subtotal after the first item', api.currentTotals().subtotalCents, 13500000);
  eq('total = subtotal when there is no tax or discount', api.currentTotals().totalCents, 13500000);
  eq('invoice table has one row', $$('.inv-item').length, 1);
  contains('description reaches the invoice', $('.inv-item__desc').textContent, 'Executive Suite accommodation');
  eq('pasted amounts with separators still parse', api.toNumber('1,500.50'), 1500.5);

  console.log('\n3. Discount and tax');
  setField('meta.taxLabel', 'VAT');
  setField('meta.taxRate', '7.5');
  setField('meta.discountRate', '10');
  const totals = api.currentTotals();
  eq('subtotal is unaffected by the discount', totals.subtotalCents, 13500000);
  eq('discount = 10% of subtotal', totals.discountCents, 1350000);
  eq('taxable = subtotal - discount', totals.taxableCents, 12150000);
  eq('VAT = 7.5% of taxable', totals.taxCents, 911250);
  eq('total = taxable + VAT', totals.totalCents, 13061250);
  eq('preview subtotal text', roleText('subtotal'), api.formatMoney(135000));
  eq('preview total text', roleText('total'), api.formatMoney(130612.5));
  contains('discount row rendered in the preview', $('[data-role="discount"]').textContent, '10%');
  contains('tax row uses the custom label', $('[data-role="tax"]').textContent, 'VAT');
  eq('amount in words', api.amountInWords('NGN'),
    'One Hundred and Thirty Thousand Six Hundred and Twelve Naira and 50/100 only');

  console.log('\n3b. Stay dates are editable on the line item');
  const ci = row.querySelector('.item__checkin');
  const co = row.querySelector('.item__checkout');
  check('line item has an editable check-in date', !!ci && ci.type === 'date');
  check('line item has an editable check-out date', !!co && co.type === 'date');
  ci.value = '2026-09-12';
  fire(ci, 'input');
  co.value = '2026-09-15';
  fire(co, 'input');
  eq('stay dates are stored', api.state.items[0].checkin, '2026-09-12');
  eq('check-out is stored', api.state.items[0].checkout, '2026-09-15');
  eq('nights follow the edited dates', api.state.items[0].qty, 3);
  const invDesc = $('.inv-item__desc').textContent;
  contains('invoice shows the stay dates', invDesc, '2026');
  contains('invoice shows both stay nights and range', invDesc, '3 nights');
  ci.value = '';
  fire(ci, 'input');
  co.value = '';
  fire(co, 'input');
  qty.value = '3';
  fire(qty, 'input');
  eq('dates clear cleanly', api.state.items[0].checkin, '');

  console.log('\n3c. Room picker dates drive the nights');
  check('picker has a check-in field', !!doc.getElementById('room-checkin'));
  check('picker has a check-out field', !!doc.getElementById('room-checkout'));
  doc.getElementById('room-checkin').value = '2026-09-12';
  fire(doc.getElementById('room-checkin'), 'input');
  eq('check-out defaults to the next night', doc.getElementById('room-checkout').value, '2026-09-13');
  doc.getElementById('room-checkout').value = '2026-09-15';
  fire(doc.getElementById('room-checkout'), 'input');
  eq('nights follow the picker dates', doc.getElementById('room-nights').value, '3');
  eq('date maths helper counts the nights', api.nightsBetween('2026-09-12', '2026-09-15'), 3);

  console.log('\n3d. Editing dates after adding a room');
  doc.getElementById('room-checkin').value = '2026-09-12';
  fire(doc.getElementById('room-checkin'), 'input');
  doc.getElementById('room-checkout').value = '2026-09-15';
  fire(doc.getElementById('room-checkout'), 'input');
  const countBefore = api.state.items.length;
  doc.getElementById('btn-add-room').click();
  eq('adding a room appends a line item', api.state.items.length, countBefore + 1);
  const added = api.state.items[api.state.items.length - 1];
  eq('added room keeps an editable check-in', added.checkin, '2026-09-12');
  eq('added room keeps an editable check-out', added.checkout, '2026-09-15');
  const addedRow = $$('.item')[$$('.item').length - 1];
  check('added room row has an editable check-in', !!addedRow.querySelector('.item__checkin'));
  check('added room row has an editable check-out', !!addedRow.querySelector('.item__checkout'));
  const addedCi = addedRow.querySelector('.item__checkin');
  const addedCo = addedRow.querySelector('.item__checkout');
  addedCi.value = '2026-09-13';
  fire(addedCi, 'input');
  fire(addedCi, 'change');
  addedCo.value = '2026-09-16';
  fire(addedCo, 'input');
  fire(addedCo, 'change');
  eq('stay start can be moved after adding', added.checkin, '2026-09-13');
  eq('stay end can be moved after adding', added.checkout, '2026-09-16');
  eq('nights follow the moved dates', added.qty, 3);
  const addedDesc = $$('.inv-item')[$$( '.inv-item').length - 1].querySelector('.inv-item__desc').textContent;
  contains('invoice follows the moved dates', addedDesc, '2026');
  check('dates print only once on the invoice', (addedDesc.match(/2026/g) || []).length <= 2);
  api.state.items.pop();
  api.renderItemRows();
  api.render();
  doc.getElementById('room-checkin').value = '';
  fire(doc.getElementById('room-checkin'), 'input');
  doc.getElementById('room-checkout').value = '';
  fire(doc.getElementById('room-checkout'), 'input');
  doc.getElementById('room-nights').value = '1';
  fire(doc.getElementById('room-nights'), 'input');

  console.log('\n3e. Room catalogue: name, category and rate line up');
  const catalogue = api.rooms;
  const groups = api.roomCategories();
  const roomNames = catalogue.map((entry) => entry.name);
  eq('catalogue holds the published room list', catalogue.length, 18);
  eq('every room name is unique', new Set(roomNames).size, roomNames.length);
  eq('rate card covers every category', groups.length, 6);

  const pickCategory = doc.getElementById('room-category');
  const pickRoom = doc.getElementById('room-name');
  const pickRate = doc.getElementById('room-rate');
  const pickNights = doc.getElementById('room-nights');
  const categoryOptions = $$('#room-category option');
  const cardRows = $$('#rate-card .rate-card__item');
  eq('category picker lists every category', categoryOptions.length, groups.length);
  eq('rate card has one row per category', cardRows.length, groups.length);

  let priced = 0;
  groups.forEach((group, index) => {
    const inCategory = catalogue.filter((entry) => entry.category === group.category);
    const optionText = group.label + ' (' + (inCategory.length === 1 ? '1 room' : inCategory.length + ' rooms') + ')';
    const cardText = cardRows[index].textContent;
    eq(group.label + ': picker value is the category', categoryOptions[index].value, group.category);
    eq(group.label + ': picker shows its label and room count', categoryOptions[index].textContent, optionText);
    check(group.label + ': every room carries the category label',
      inCategory.every((entry) => entry.label === group.label));
    eq(group.label + ': every room uses the published rate',
      new Set(inCategory.map((entry) => entry.rate)).size, 1);
    contains(group.label + ': rate card names the category', cardText, group.label);
    contains(group.label + ': rate card shows the published rate', cardText, api.formatMoney(group.minRate));
    contains(group.label + ': rate card counts its rooms', cardText, inCategory.length + ' room');

    pickCategory.value = group.category;
    fire(pickCategory, 'change');
    eq(group.label + ': picker offers exactly its rooms',
      Array.prototype.slice.call(pickRoom.options).map((option) => option.value).join(' | '),
      inCategory.map((entry) => entry.name).join(' | '));

    inCategory.forEach((entry) => {
      pickRoom.value = entry.name;
      fire(pickRoom, 'change');
      eq(group.label + ' — ' + entry.name + ': loads the published rate', pickRate.value, String(entry.rate));
      eq(group.label + ' — ' + entry.name + ': line total is rate x nights',
        doc.getElementById('room-total').textContent, api.formatMoney(entry.rate * Number(pickNights.value)));
      priced += 1;
    });
  });
  eq('every room in the catalogue was priced from the picker', priced, catalogue.length);

  /* The room left in the picker is billed under its own category, name and rate. */
  const linesBeforeRoom = api.state.items.length;
  $('#btn-add-room').click();
  const billedRoom = api.state.items[api.state.items.length - 1];
  eq('one more line item was added', api.state.items.length, linesBeforeRoom + 1);
  eq('the line reads category — room', billedRoom.description, 'Presidential Suite — Iroko');
  eq('the line carries the published rate', billedRoom.price, 95000);
  eq('the line carries the picked nights', billedRoom.qty, 1);
  api.state.items.pop();
  api.renderItemRows();
  api.render();

  console.log('\n3f. Branding: the site\'s logo and palette');
  const headLogo = $('.brand__logo');
  check('header shows the wordmark', !!headLogo);
  eq('header logo points at the shipped file', headLogo && headLogo.getAttribute('src'), 'assets/cocoon-logo.png');
  eq('header logo keeps its intrinsic width', headLogo && headLogo.getAttribute('width'), '130');
  eq('header logo keeps its intrinsic height', headLogo && headLogo.getAttribute('height'), '48');
  const favicon = doc.querySelector('link[rel="icon"]');
  check('the page declares a favicon', !!favicon);
  eq('favicon is the same wordmark', favicon && favicon.getAttribute('href'), 'assets/cocoon-logo.png');
  eq('theme colour matches the site header',
    doc.querySelector('meta[name="theme-color"]').getAttribute('content'), '#020101');

  const invLogo = $('.inv-logo');
  check('the invoice carries the wordmark', !!invLogo);
  const invSrc = (invLogo && invLogo.getAttribute('src')) || '';
  check('invoice logo is an inlined PNG data URI', invSrc.indexOf('data:image/png;base64,') === 0, invSrc.slice(0, 60));
  eq('invoice logo is byte-identical to assets/cocoon-logo.png',
    invSrc.replace('data:image/png;base64,', ''),
    fs.readFileSync(path.join(PROJECT, 'assets', 'cocoon-logo.png')).toString('base64'));

  const css = fs.readFileSync(path.join(PROJECT, 'styles.css'), 'utf8');
  contains('palette has the site accent gold', css, '--gold-500: #fe801a;');
  contains('palette has the site deeper gold', css, '--gold-600: #d7981c;');
  contains('palette has the site header black', css, '--brand-900: #020101;');
  contains('palette has the site hairline grey', css, '--line: #e5e5e5;');
  notContains('the old green palette is gone from the stylesheet', css.toLowerCase(), '0f3d33');
  notContains('the old gold lettering is gone from the stylesheet', css.toLowerCase(), 'e8d9a8');

  console.log('\n4. Extra line item with a fractional quantity');
  $('#btn-add-item').click();
  eq('add-item button appends a row', $$('.item').length, 2);
  const second = $$('.item')[1];
  const sDesc = second.querySelector('.item__desc');
  const sQty = second.querySelector('.item__qty');
  const sPrice = second.querySelector('.item__price');
  sDesc.value = 'Airport pickup';
  fire(sDesc, 'input');
  sQty.value = '1.5';
  fire(sQty, 'input');
  sPrice.value = '20000';
  fire(sPrice, 'input');
  eq('fractional line amount = 1.5 x 20,000', second.querySelector('.item__amount').textContent, api.formatMoney(30000));
  eq('subtotal includes both lines', api.currentTotals().subtotalCents, 16500000);
  eq('invoice now has two rows', $$('.inv-item').length, 2);
  eq('item counter badge updates', $('#item-count').textContent, '2 items');

  console.log('\n5. Removing a line item');
  second.querySelector('.item__remove').click();
  eq('row removed from the editor', $$('.item').length, 1);
  eq('subtotal back to a single line', api.currentTotals().subtotalCents, 13500000);
  eq('invoice back to one row', $$('.inv-item').length, 1);

  console.log('\n6. Enter-key flow');
  $('.item').querySelector('.item__price')
    .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  eq('Enter on the last unit price adds a row', $$('.item').length, 2);
  eq('the new row starts blank', api.state.items[1].description, '');
  eq('an unpriced blank row stays off the invoice', $$('.inv-item').length, 1);
  $$('.item')[1].querySelector('.item__remove').click();
  eq('back to one row again', $$('.item').length, 1);

  console.log('\n7. Guest details feed the email and WhatsApp links');
  setField('billTo.name', 'Ama Mensah');
  setField('billTo.room', 'Executive Suite 204');
  setField('billTo.email', 'ama@example.com');
  setField('billTo.phone', '+234 803 000 0000');

  const wa = api.whatsappUrl();
  check('WhatsApp link opens the guest chat directly', wa.indexOf('https://wa.me/2348030000000?text=') === 0, wa.slice(0, 70));
  const waText = decodeURIComponent(wa.split('?text=')[1]);
  contains('WhatsApp text carries the invoice number', waText, 'INVOICE ' + api.state.meta.number);
  contains('WhatsApp text bolds the total', waText, '*Total due:');
  contains('WhatsApp text itemises the suite', waText, 'Executive Suite accommodation');
  contains('WhatsApp text shows the quantity maths', waText, '3 x');

  const mail = api.emailUrl();
  check('mailto link targets the guest address', mail.indexOf('mailto:ama%40example.com?subject=') === 0, mail.slice(0, 70));
  const mailText = decodeURIComponent(mail);
  contains('mail subject names the invoice', mailText, 'Invoice ' + api.state.meta.number + ' from Cocoon Luxury Suites Ogudu');
  contains('mail body lists the guest', mailText, 'Billed to: Ama Mensah');
  notContains('plain-text mail body drops WhatsApp asterisks', mailText.split('&body=')[1], '*Total due');
  eq('toolbar hint picks up the guest email', $('#toolbar-hint').textContent.indexOf('ama@example.com') !== -1, true);
  eq('a local number without a country code is not forced into wa.me', api.phoneDigits('0803 000 0000'), '');

  console.log('\n8. Currency switch');
  setField('meta.currency', 'USD');
  eq('totals are unchanged by the currency', api.currentTotals().totalCents, 13061250);
  eq('preview follows the new currency', roleText('total'), api.formatMoney(130612.5, 'USD'));
  contains('currency label on the invoice', $('.inv-meta__item:last-child dd').textContent, 'USD');
  contains('amount in words follows the currency', api.amountInWords('USD'), 'Dollars');
  setField('meta.currency', 'NGN');

  console.log('\n9. Untrusted text is escaped');
  setField('billTo.name', '<img src=x onerror="window.__pwned = true">');
  setField('meta.notes', '<script>window.__pwned = true;</script>\nSecond line of notes');
  /* The invoice header's inlined wordmark (assets/cocoon-logo.png) is the only
     trusted <img>; anything else — script tags or injected markup — must vanish. */
  const stray = Array.prototype.slice.call(doc.querySelectorAll('#invoice script, #invoice img'))
    .filter((el) => !el.classList.contains('inv-logo'));
  eq('no injected elements survive', stray.length, 0);
  eq('no injected script ran', win.__pwned, undefined);
  contains('the markup is rendered as literal text', $('.inv-party__name').textContent, '<img src=x');
  contains('multi-line notes are kept', $('#invoice .inv-notes').textContent, 'Second line of notes');
  setField('billTo.name', 'Ama Mensah');

  console.log('\n10. Draft autosave');
  await sleep(450);
  const raw = win.localStorage.getItem('cocoon.invoice.draft.v1');
  check('draft written to localStorage', !!raw);
  const draft = raw ? JSON.parse(raw) : {};
  eq('draft keeps the guest details', draft.billTo && draft.billTo.email, 'ama@example.com');
  eq('draft keeps the line items', draft.items && draft.items.length, 1);
  eq('draft keeps the raw tax input', draft.meta && draft.meta.taxRate, '7.5');

  console.log('\n11. PDF download');
  $('#btn-pdf').click();
  await sleep(40);
  contains('a missing engine falls back to printing', $('#toast').textContent, 'PDF engine could not load');
  eq('off-screen PDF stage is cleaned up', $('#pdf-stage').innerHTML, '');

  let captured = null;
  win.html2pdf = function stubEngine() {
    const worker = {
      set(options) { captured = options; return worker; },
      from() { return worker; },
      save() { return Promise.resolve('saved'); },
      outputPdf() { return Promise.resolve(new win.Blob(['%PDF-1.4'], { type: 'application/pdf' })); }
    };
    return worker;
  };

  $('#btn-pdf').click();
  await sleep(60);
  check('html2pdf receives A4 portait settings', !!captured && captured.jsPDF.format === 'a4' &&
    captured.jsPDF.unit === 'pt' && captured.jsPDF.orientation === 'portrait');
  eq('PDF file name carries the invoice number', captured && captured.filename,
    'Invoice-' + api.state.meta.number + '-Ama-Mensah.pdf');
  check('page-break rules protect rows and totals', !!captured && captured.pagebreak.avoid.indexOf('tr') !== -1);
  eq('stage cleaned up after a successful render', $('#pdf-stage').innerHTML, '');
  contains('success toast shown after rendering', $('#toast').textContent, 'PDF saved as');
  eq('the PDF button is re-enabled afterwards', $('#btn-pdf').hasAttribute('disabled'), false);

  console.log('\n12. Share-PDF fallback');
  $('#btn-share').click();
  await sleep(60);
  contains('unsupported file sharing explains itself', $('#toast').textContent, 'cannot share files from a browser');
  eq('stage cleaned up after the share attempt', $('#pdf-stage').innerHTML, '');

  console.log('\n13a. Invoice / receipt switch');
  eq('document starts as an invoice', api.state.meta.docType, 'invoice');
  contains('preview title is Invoice', $('.inv-title').textContent, 'Invoice');
  contains('total row says Total due', $('[data-role="total"]').textContent, 'Total due');
  setField('meta.docType', 'receipt');
  eq('receipt mode is stored', api.state.meta.docType, 'receipt');
  eq('paid stamp replaces the due status', api.state.meta.status, 'Paid — thank you');
  contains('preview title becomes Receipt', $('.inv-title').textContent, 'Receipt');
  contains('total row becomes Total received', $('[data-role="total"]').textContent, 'Total received');
  contains('editor card heading follows the switch', $('[data-role-label="card-title"]').textContent, 'Receipt details');
  eq('due-date editor is hidden on receipts', $('[data-role-field="due-date"]').style.display, 'none');
  const receiptText = decodeURIComponent(api.whatsappUrl().split('?text=')[1]);
  contains('WhatsApp header becomes RECEIPT', receiptText, 'RECEIPT ' + api.state.meta.number);
  contains('WhatsApp total becomes Total received', receiptText, '*Total received:');
  const receiptMail = decodeURIComponent(api.emailUrl());
  contains('mail subject says Receipt', receiptMail, 'Receipt ' + api.state.meta.number);
  eq('PDF file name says Receipt', api.pdfFileName().indexOf('Receipt-') === 0, true);
  await sleep(450);
  const draftType = win.localStorage.getItem('cocoon.invoice.draft.v1');
  eq('draft remembers the receipt switch', draftType && JSON.parse(draftType).meta.docType, 'receipt');
  setField('meta.docType', 'invoice');
  eq('switching back restores the invoice', api.state.meta.docType, 'invoice');
  contains('preview title returns to Invoice', $('.inv-title').textContent, 'Invoice');
  eq('due-date editor returns on invoices', $('[data-role-field="due-date"]').style.display, '');

  console.log('\n13b. Staff name & hotel branch');
  check('branch field exists', !!$('#field-branch'));
  check('staff field exists', !!$('#field-staff'));
  eq('no Prepared by line before a name is typed', $$('.inv-signoff__staff').length, 0);
  contains('branch line shows the default branch', $('.inv-signoff__branch').textContent, 'Ogudu GRA, Lagos');

  setField('hotel.staff', 'Adaeze O.');
  contains('staff name reaches the document', $('.inv-signoff__staff').textContent, 'Adaeze O.');
  contains('sign-off says Prepared by', $('.inv-signoff__staff').textContent, 'Prepared by');
  contains('share text credits the staff', api.buildShareText({ bold: false }), 'Prepared by: Adaeze O.');
  contains('staff datalist remembers the name', $('#staff-options').innerHTML, 'Adaeze O.');

  /* A branch the hotel no longer offers can still sit in a returning device's
     storage (saved under the older branch key) or in an old draft: it must not
     be selectable again, and none of its details may reach the Ogudu invoice. */
  win.localStorage.setItem('cocoon.hotel.branches.v2', JSON.stringify([
    { label: 'Retired Branch, Lagos', city: 'Retired Branch, Lagos, Nigeria',
      address: '1 Example Close', phone: '0800 000 0000',
      email: 'info@example.com', website: 'example.com' }
  ]));
  eq('branch picker offers only the Ogudu branch', $$('select#field-branch option').length, 1);
  notContains('branch picker drops the retired branch', $('#field-branch').innerHTML, 'Retired Branch');
  notContains('no saved profile survives for the retired branch', JSON.stringify(api.branchOptions()), 'Retired Branch');

  setField('hotel.branch', 'Ogudu GRA, Lagos');
  eq('Ogudu becomes the stored branch', api.state.hotel.branch, 'Ogudu GRA, Lagos');
  eq('Ogudu city profile applied', api.state.hotel.city, 'Ogudu GRA, Lagos, Nigeria');
  eq('Ogudu street shipped', api.state.hotel.address, '2 Adebayo Ogunrombi Close');
  eq('Ogudu phone shipped', api.state.hotel.phone, '+234 701 449 6106');
  eq('Ogudu email shipped', api.state.hotel.email, 'info@cocoonogudu.com');
  eq('Ogudu website shipped', api.state.hotel.website, 'cocoonogudu.com');
  eq('Ogudu phone dials as wa.me', api.phoneDigits(api.state.hotel.phone), '2347014496106');
  contains('sign-off shows the Ogudu branch', $('.inv-signoff__branch').textContent, 'Ogudu GRA, Lagos');
  eq('no brand text block after a branch switch', $$('.inv-name, .inv-tagline, .inv-branch').length, 0);
  eq('footer holds only the thank-you line', $$('.inv-foot > *').length, 1);
  contains('footer keeps the thank-you line', $('.inv-foot__thanks').textContent, 'Thank you for staying with');
  notContains('footer no longer prints the number', $('.inv-foot').textContent, '#' + api.state.meta.number);
  notContains('footer no longer prints the email', $('.inv-foot').textContent, 'info@cocoonogudu.com');
  notContains('footer no longer prints the phone', $('.inv-foot').textContent, '+234 701 449 6106');
  const footRule = (cssSource.match(/\.inv-foot\s*\{[^}]*\}/) || [''])[0];
  contains('footer line is centred', footRule, 'text-align: center');

  setField('hotel.address', '12 Millennium Estate Road');
  eq('Ogudu is the only branch profile on file', api.branchOptions().length, 1);
  const ogudu = api.branchOptions().filter((entry) => entry.label === 'Ogudu GRA, Lagos')[0];
  eq('edited street is remembered under Ogudu', ogudu && ogudu.address, '12 Millennium Estate Road');
  eq('the rest of the Ogudu contact is untouched by the edit', ogudu && ogudu.phone, '+234 701 449 6106');

  setField('hotel.branch', 'Ogudu GRA, Lagos');
  eq('re-picking Ogudu restores the edited street', api.state.hotel.address, '12 Millennium Estate Road');
  eq('re-picking Ogudu restores the Ogudu city', api.state.hotel.city, 'Ogudu GRA, Lagos, Nigeria');
  eq('re-picking Ogudu restores the Ogudu phone', api.state.hotel.phone, '+234 701 449 6106');
  eq('re-picking Ogudu restores the Ogudu email', api.state.hotel.email, 'info@cocoonogudu.com');

  await sleep(450);
  contains('staff name saved for next time', win.localStorage.getItem('cocoon.hotel.staff.v1'), 'Adaeze O.');
  contains('branch profile saved for next time', win.localStorage.getItem('cocoon.hotel.branches.v3'), '12 Millennium Estate Road');
  notContains('the retired branch is never written back', win.localStorage.getItem('cocoon.hotel.branches.v3'), 'Retired Branch');

  $('#btn-new').click();
  eq('staff survives the reset', api.state.hotel.staff, 'Adaeze O.');
  eq('branch survives the reset', api.state.hotel.branch, 'Ogudu GRA, Lagos');
  contains('sign-off still shows the staff after the reset', $('.inv-signoff__staff').textContent, 'Adaeze O.');
  setField('hotel.staff', '');
  eq('clearing the name removes the Prepared by line', $$('.inv-signoff__staff').length, 0);
  contains('branch line survives a cleared name', $('.inv-signoff__branch').textContent, 'Ogudu GRA, Lagos');

  /* A saved draft that still names the retired branch carries that branch's
     street / phone. Loading it must swap in the Ogudu profile instead, so no
     retired detail is ever printed under the Ogudu flagship. */
  console.log('\n13c. Retired branch left in an old draft');
  const legacy = await bootstrap((legacyWin) => {
    legacyWin.localStorage.setItem('cocoon.invoice.draft.v1', JSON.stringify({
      meta: { number: 'COC-2025-0042', currency: 'NGN' },
      hotel: {
        branch: 'Retired Branch, Lagos', city: 'Retired Branch, Lagos, Nigeria',
        address: '1 Example Close',
        phone: '+234 800 000 0000', email: 'info@example.com',
        website: 'https://example.com/'
      }
    }));
  });
  const legacyApi = legacy.win.CocoonInvoice;
  check('the legacy window exposes the API', !!legacyApi);
  eq('the retired branch falls back to Ogudu', legacyApi.state.hotel.branch, 'Ogudu GRA, Lagos');
  eq('the retired street is replaced by the Ogudu street', legacyApi.state.hotel.address, '2 Adebayo Ogunrombi Close');
  eq('the retired phone is replaced by the Ogudu phone', legacyApi.state.hotel.phone, '+234 701 449 6106');
  eq('the retired email is replaced by the Ogudu email', legacyApi.state.hotel.email, 'info@cocoonogudu.com');
  notContains('the loaded state never mentions the retired branch', JSON.stringify(legacyApi.state.hotel), 'Retired Branch');
  notContains('the rendered invoice never mentions the retired branch', legacy.win.document.body.textContent, 'Retired Branch');
  legacy.win.close();

  console.log('\n13. New invoice & restore defaults');
  const previousNumber = api.state.meta.number;
  $('#btn-new').click();
  eq('guest details cleared', api.state.billTo.name, '');
  eq('tax rate reset', api.currentTotals().taxRate, 0);
  eq('back to one blank line item', api.state.items.length, 1);
  check('a fresh invoice number is issued', api.state.meta.number !== previousNumber, api.state.meta.number);
  eq('hotel details survive the reset', api.state.hotel.name, 'Cocoon Luxury Suites Ogudu');
  eq('the brand text block stays off the reset invoice', $$('.inv-name, .inv-tagline, .inv-branch').length, 0);
  setField('hotel.phone', '+234 000 000 0000');
  $('#btn-restore-hotel').click();
  eq('restore defaults brings the shipped phone back', api.state.hotel.phone, '+234 701 449 6106');

  console.log('\n14. Invoice & receipt history');
  check('history card is on the page', !!$('#history-card'));
  eq('history badge starts at zero', $('#history-count').textContent, '0 documents');
  contains('the empty state explains what to do', $('#history-list').textContent, 'Nothing filed yet');
  contains('the empty state names the save button', $('#history-list').textContent, 'Save to history');
  check('save button is wired', !!$('#btn-save-history'));
  check('clear button is wired', !!$('#btn-history-clear'));
  eq('one blank line to file', $$('.item').length, 1);

  /* File the working document. */
  setField('meta.number', 'COC-2026-0101');
  setField('billTo.name', 'Chidi Okonkwo');
  const hDesc = $('.item .item__desc');
  hDesc.value = 'Suite accommodation';
  fire(hDesc, 'input');
  const hPrice = $('.item .item__price');
  hPrice.value = '50000';
  fire(hPrice, 'input');
  eq('the working line is 50,000 with no tax or discount', api.currentTotals().totalCents, 5000000);
  $('#btn-save-history').click();
  eq('one document is filed', $$('#history-list .history__item').length, 1);
  eq('badge counts it', $('#history-count').textContent, '1 document');
  const filed = JSON.parse(win.localStorage.getItem('cocoon.history.v1'));
  eq('snapshot written to storage', filed.length, 1);
  eq('snapshot typed as an invoice', filed[0].docType, 'invoice');
  eq('snapshot carries the guest', filed[0].guest, 'Chidi Okonkwo');
  eq('snapshot carries the live total', filed[0].totalCents, 5000000);
  check('snapshot keeps the full editor state',
    !!(filed[0].state && filed[0].state.meta && filed[0].state.billTo && filed[0].state.items));
  contains('row shows the number', $('#history-list .history__title').textContent, 'COC-2026-0101');
  contains('row shows the guest', $('#history-list .history__title').textContent, 'Chidi Okonkwo');
  contains('row shows the total', $('#history-list .history__total').textContent, api.formatMoney(50000));
  contains('row labels the type', $('#history-list .history__type').textContent, 'Invoice');
  contains('row shows the line count', $('#history-list .history__meta').textContent, '1 item');
  contains('saving confirms with a toast', $('#toast').textContent, 'Saved invoice COC-2026-0101 to history');

  /* Re-filing the same number updates its entry instead of piling up. */
  setField('billTo.name', 'Chidi Okonkwo (edited)');
  $('#btn-save-history').click();
  eq('re-filing does not pile up copies', $$('#history-list .history__item').length, 1);
  eq('storage still holds one entry', JSON.parse(win.localStorage.getItem('cocoon.history.v1')).length, 1);
  contains('the entry carries the edit', $('#history-list .history__title').textContent, 'Chidi Okonkwo (edited)');

  /* The same stay can be filed as a receipt as well. */
  setField('meta.docType', 'receipt');
  contains('the save button follows the switch', $('[data-role-label="save-history-btn"]').textContent,
    'Save receipt to history');
  $('#btn-save-history').click();
  eq('the receipt files beside its invoice', $$('#history-list .history__item').length, 2);
  eq('badge counts both', $('#history-count').textContent, '2 documents');
  check('receipt row carries the receipt badge', !!$('#history-list .history__type--receipt'));
  contains('the newest entry is listed first', $$('#history-list .history__type')[0].textContent, 'Receipt');
  eq('both types are stored', JSON.parse(win.localStorage.getItem('cocoon.history.v1'))
    .map((entry) => entry.docType).join(','), 'receipt,invoice');
  setField('meta.docType', 'invoice');

  /* Open puts a filed document back into the editor. */
  setField('billTo.name', 'WRECKED');
  setField('meta.number', 'COC-9999-9999');
  const wreckDesc = $('.item .item__desc');
  wreckDesc.value = '';
  fire(wreckDesc, 'input');
  $$('#history-list [data-history-action="open"]')[1].click();
  eq('open restores the guest', api.state.billTo.name, 'Chidi Okonkwo (edited)');
  eq('open restores the number', api.state.meta.number, 'COC-2026-0101');
  eq('open restores the document type', api.state.meta.docType, 'invoice');
  eq('open restores the line items', api.state.items[0].description, 'Suite accommodation');
  eq('the editor form follows', $('[data-path="billTo.name"]').value, 'Chidi Okonkwo (edited)');
  contains('the restored invoice renders', $('.inv-title').textContent, 'Invoice');
  contains('opening confirms with a toast', $('#toast').textContent, 'Opened invoice COC-2026-0101');

  /* Duplicate issues a fresh copy without touching the archive. */
  $$('#history-list [data-history-action="duplicate"]')[1].click();
  check('duplicate issues a fresh number', api.state.meta.number !== 'COC-2026-0101', api.state.meta.number);
  eq('duplicate keeps the guest', api.state.billTo.name, 'Chidi Okonkwo (edited)');
  eq('duplicate keeps the lines', api.state.items[0].description, 'Suite accommodation');
  contains('duplicating confirms with a toast', $('#toast').textContent, 'Duplicated as invoice');
  eq('duplicate is not auto-filed', $$('#history-list .history__item').length, 2);

  /* Delete removes one entry. */
  $$('#history-list [data-history-action="delete"]')[0].click();
  eq('the receipt row is removed', $$('#history-list .history__item').length, 1);
  eq('storage follows the delete', JSON.parse(win.localStorage.getItem('cocoon.history.v1')).length, 1);
  eq('badge follows the delete', $('#history-count').textContent, '1 document');
  contains('deleting confirms with a toast', $('#toast').textContent, 'removed from history');

  /* Rows escape stored text, exactly like the invoice does. */
  setField('billTo.name', '<b id="hist-pwn">x</b>');
  $('#btn-save-history').click();
  check('the history row does not execute stored markup', !doc.getElementById('hist-pwn'));
  contains('stored markup is shown as literal text', $('#history-list .history__title').textContent,
    '<b id="hist-pwn">');

  /* Clear all empties the archive. */
  $('#btn-history-clear').click();
  eq('the list is empty again', $$('#history-list .history__item').length, 0);
  eq('storage is emptied', JSON.parse(win.localStorage.getItem('cocoon.history.v1')).length, 0);
  eq('badge is back to zero', $('#history-count').textContent, '0 documents');
  contains('clearing confirms with a toast', $('#toast').textContent, 'History cleared');

  /* The archive is capped at MAX_HISTORY (100). */
  const seeded = [];
  for (let i = 0; i < 105; i += 1) {
    seeded.push({
      id: 'seed-' + i, savedAt: Date.now(), docType: 'invoice',
      number: 'COC-1999-' + String(1000 + i), date: '1999-01-01',
      guest: 'Guest ' + i, totalCents: 0, currency: 'NGN',
      state: { hotel: {}, meta: {}, billTo: {}, items: [] }
    });
  }
  win.localStorage.setItem('cocoon.history.v1', JSON.stringify(seeded));
  $('#btn-save-history').click();
  eq('the archive is capped at 100', JSON.parse(win.localStorage.getItem('cocoon.history.v1')).length, 100);
  eq('badge shows the cap', $('#history-count').textContent, '100 documents');
  eq('the list renders the capped archive', $$('#history-list .history__item').length, 100);
  contains('the current document leads the list', $('#history-list .history__title').textContent,
    api.state.meta.number);

  /* A corrupted archive must never stop the app from booting. */
  const broken = await bootstrap((w) => w.localStorage.setItem('cocoon.history.v1', '{not json'));
  const brokenApi = broken.win.CocoonInvoice;
  check('the app boots with a corrupted history', !!(brokenApi && brokenApi.state));
  eq('a corrupted history reads as empty',
    brokenApi && brokenApi.readHistory ? brokenApi.readHistory().length : -1, 0);
  eq('the badge shows the empty archive', broken.doc.getElementById('history-count').textContent, '0 documents');
  contains('the empty state still renders', broken.doc.getElementById('history-list').textContent,
    'Nothing filed yet');
  broken.win.close();

  console.log('\n----------------------------------------------');
  finish();
}

function finish() {
  console.log(passed + ' checks passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((failure) => console.log('  - ' + failure));
  }
  /* jsdom's animation-frame loop keeps Node alive, so always tear it down. */
  if (ACTIVE_WIN) { try { ACTIVE_WIN.close(); } catch (err) { /* already closed */ } }
  process.exit(failures.length ? 1 : 0);
}

const timeoutGuard = setTimeout(() => {
  failures.push('the test run timed out');
  finish();
}, 60000);
if (timeoutGuard.unref) timeoutGuard.unref();

run().catch((error) => {
  failures.push('crashed: ' + (error && error.message ? error.message : error));
  console.error('\nSmoke test crashed:');
  console.error(error && error.stack ? error.stack : error);
  finish();
});
