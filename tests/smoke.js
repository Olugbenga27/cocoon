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

async function bootstrap() {
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
  contains('brand name is on the invoice', $('.inv-name').textContent, 'Cocoon Luxury Suites Ogudu');
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
  eq('no injected elements survive', $$('#invoice script, #invoice img').length, 0);
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

  /* Picking a saved branch applies its own city/street profile — even when an
     older version of the app remembered outdated details for that branch. */
  win.localStorage.setItem('cocoon.hotel.branches.v1', JSON.stringify([
    { label: 'Gbagada, Lagos', city: 'Gbagada, Lagos, Nigeria',
      address: '6 Oguntona Crescent, Gbagada', phone: '0807 086 3696',
      email: 'info@cocoongbagada.com', website: 'cocoongbagada.com' }
  ]));
  eq('branch picker offers only two branches', $$('select#field-branch option').length, 2);
  contains('branch picker lists Gbagada', $('#field-branch').innerHTML, 'Gbagada, Lagos');
  setField('hotel.branch', 'Gbagada, Lagos');
  eq('Gbagada becomes the stored branch', api.state.hotel.branch, 'Gbagada, Lagos');
  eq('Gbagada city profile applied', api.state.hotel.city, 'Gbagada, Lagos, Nigeria');
  eq('Gbagada street shipped', api.state.hotel.address, '9, 4/6 Oguntona Crescent, Gbagada Phase 1');
  eq('Gbagada phone shipped', api.state.hotel.phone, '+234 8070 863696');
  eq('Gbagada email shipped', api.state.hotel.email, 'info@cocoongbagada.com');
  eq('Gbagada website shipped', api.state.hotel.website, 'https://cocoongbagada.com/');
  contains('stale remembered details cannot shadow the shipped profile', api.state.hotel.address, 'Phase 1');
  eq('Gbagada phone dials as wa.me', api.phoneDigits(api.state.hotel.phone), '2348070863696');
  contains('sign-off shows the Gbagada branch', $('.inv-signoff__branch').textContent, 'Gbagada, Lagos');
  contains('document name follows the branch', $('.inv-name').textContent, 'Cocoon Luxury Suites Ogudu');

  setField('hotel.address', '12 Millennium Estate Road');
  const gbagada = api.branchOptions().filter((entry) => entry.label === 'Gbagada, Lagos')[0];
  eq('edited street is remembered under Gbagada only', gbagada && gbagada.address, '12 Millennium Estate Road');
  eq("Ogudu's phone is untouched by the Gbagada edit", api.branchOptions().filter((e) => e.label === 'Ogudu GRA, Lagos')[0].phone, '+234 701 449 6106');

  setField('hotel.branch', 'Ogudu GRA, Lagos');
  eq('switching back restores the Ogudu street', api.state.hotel.address, '2 Adebayo Ogunrombi Close');
  eq('switching back restores the Ogudu city', api.state.hotel.city, 'Ogudu GRA, Lagos, Nigeria');
  eq('switching back restores the Ogudu phone', api.state.hotel.phone, '+234 701 449 6106');
  eq('switching back restores the Ogudu email', api.state.hotel.email, 'info@cocoonogudu.com');
  setField('hotel.branch', 'Gbagada, Lagos');
  eq('switching back restores the Gbagada street', api.state.hotel.address, '12 Millennium Estate Road');
  eq('Gbagada contact survives the round trip', api.state.hotel.phone, '+234 8070 863696');
  setField('hotel.branch', 'Ogudu GRA, Lagos');

  await sleep(450);
  contains('staff name saved for next time', win.localStorage.getItem('cocoon.hotel.staff.v1'), 'Adaeze O.');
  contains('branch profiles saved for next time', win.localStorage.getItem('cocoon.hotel.branches.v2'), '12 Millennium Estate Road');

  $('#btn-new').click();
  eq('staff survives the reset', api.state.hotel.staff, 'Adaeze O.');
  eq('branch survives the reset', api.state.hotel.branch, 'Ogudu GRA, Lagos');
  contains('sign-off still shows the staff after the reset', $('.inv-signoff__staff').textContent, 'Adaeze O.');
  setField('hotel.staff', '');
  eq('clearing the name removes the Prepared by line', $$('.inv-signoff__staff').length, 0);
  contains('branch line survives a cleared name', $('.inv-signoff__branch').textContent, 'Ogudu GRA, Lagos');

  console.log('\n13. New invoice & restore defaults');
  const previousNumber = api.state.meta.number;
  $('#btn-new').click();
  eq('guest details cleared', api.state.billTo.name, '');
  eq('tax rate reset', api.currentTotals().taxRate, 0);
  eq('back to one blank line item', api.state.items.length, 1);
  check('a fresh invoice number is issued', api.state.meta.number !== previousNumber, api.state.meta.number);
  contains('hotel details survive the reset', $('.inv-name').textContent, 'Cocoon Luxury Suites Ogudu');
  setField('hotel.phone', '+234 000 000 0000');
  $('#btn-restore-hotel').click();
  eq('restore defaults brings the shipped phone back', api.state.hotel.phone, '+234 701 449 6106');

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
