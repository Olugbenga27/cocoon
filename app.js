/* ==========================================================================
   The Cocoon Luxury Suites Hotel — invoice generator
   Plain browser JavaScript (no build step, no framework, no tracking).
   Responsibilities: keep the draft state, recalculate totals, render the
   live A4 invoice preview, and export / share it (PDF, email, WhatsApp).
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------ constants -- */

  var DEFAULT_HOTEL = {
    name: 'Cocoon Luxury Suites Ogudu',
    branch: 'Ogudu GRA, Lagos',
    tagline: 'Luxury \u00b7 Service \u00b7 Excellence',
    address: '2 Adebayo Ogunrombi Close',
    city: 'Ogudu GRA, Lagos, Nigeria',
    phone: '+234 701 449 6106',
    email: 'info@cocoonogudu.com',
    website: 'cocoonogudu.com',
    staff: ''
  };

  /**
   * The hotel trades from a single branch: Ogudu. Picking it pre-fills the
   * street / city fields from its profile; a blank `address` stays blank until
   * the hotel fills it in once (the edit is then remembered on this device).
   */
  var DEFAULT_BRANCHES = [
    { label: 'Ogudu GRA, Lagos', city: 'Ogudu GRA, Lagos, Nigeria', address: '2 Adebayo Ogunrombi Close',
      phone: '+234 701 449 6106', email: 'info@cocoonogudu.com', website: 'cocoonogudu.com' }
  ];

  /** Which editor fields each branch profile carries, and their state paths. */
  var BRANCH_FIELDS = ['city', 'address', 'phone', 'email', 'website'];

  /* v3: the hotel went from two branches to one. A new storage key drops any
     profile an older version remembered for the retired branch, so a retired
     branch can never be offered again and the Ogudu details always come from
     the shipped defaults first. */
  var BRANCH_STORAGE_KEY = 'cocoon.hotel.branches.v3';

  var CURRENCIES = [
    { code: 'NGN', label: 'NGN \u2014 Nigerian Naira' },
    { code: 'USD', label: 'USD \u2014 US Dollar' },
    { code: 'EUR', label: 'EUR \u2014 Euro' },
    { code: 'GBP', label: 'GBP \u2014 Pound Sterling' },
    { code: 'GHS', label: 'GHS \u2014 Ghanaian Cedi' },
    { code: 'KES', label: 'KES \u2014 Kenyan Shilling' },
    { code: 'ZAR', label: 'ZAR \u2014 South African Rand' },
    { code: 'XOF', label: 'XOF \u2014 West African CFA Franc' },
    { code: 'AED', label: 'AED \u2014 UAE Dirham' },
    { code: 'CAD', label: 'CAD \u2014 Canadian Dollar' },
    { code: 'AUD', label: 'AUD \u2014 Australian Dollar' },
    { code: 'INR', label: 'INR \u2014 Indian Rupee' }
  ];

  var CURRENCY_WORDS = {
    NGN: 'Naira', USD: 'Dollars', EUR: 'Euros', GBP: 'Pounds', GHS: 'Cedis',
    KES: 'Shillings', ZAR: 'Rand', XOF: 'CFA Francs', AED: 'Dirhams',
    CAD: 'Dollars', AUD: 'Dollars', INR: 'Rupees'
  };

  var STORAGE_KEY = 'cocoon.invoice.draft.v1';
  var SEQ_KEY = 'cocoon.invoice.sequence.v1';
  /* Invoices and receipts filed from this app, kept on this device only. */
  var HISTORY_KEY = 'cocoon.history.v1';
  var MAX_HISTORY = 100;
  var DUE_DAYS = 14;
  var RECEIPT_STATUS = 'Paid — thank you';
  var INVOICE_STATUS = 'Due on receipt';
  var MAX_SHARE_ITEMS = 15;
  var MAX_MAILTO_BODY = 1800;
  var PDF_WIDTH = 794; /* A4 content width in CSS px at 96dpi */

  /**
   * Room catalogue for Cocoon Luxury Suites Ogudu, taken from the rate card
   * published on cocoonogudu.com/rooms-and-suites: every room of a category
   * carries that category's published rate, so the name, the category and the
   * rate always agree. The room picker, the rate card and every line item read
   * from this single list. `label` is how the room is written on an invoice
   * line; `rate` is the nightly rate in the hotel's home currency (NGN).
   */
  var ROOMS = [
    { category: 'Studio', label: 'Studio', name: 'Cape Town', rate: 50000 },
    { category: 'Standard', label: 'Standard Room', name: 'Soweto', rate: 55000 },
    { category: 'Standard', label: 'Standard Room', name: 'Swahili', rate: 55000 },
    { category: 'Standard', label: 'Standard Room', name: 'Zambezi', rate: 55000 },
    { category: 'Standard', label: 'Standard Room', name: 'Limpopo', rate: 55000 },
    { category: 'Standard', label: 'Standard Room', name: 'Mombasa', rate: 55000 },
    { category: 'Standard', label: 'Standard Room', name: 'Sankara', rate: 55000 },
    { category: 'Superior', label: 'Superior Room', name: 'Kigali', rate: 60000 },
    { category: 'Deluxe', label: 'Deluxe Room', name: 'Zuma', rate: 65000 },
    { category: 'Deluxe', label: 'Deluxe Room', name: 'Yankari', rate: 65000 },
    { category: 'Deluxe', label: 'Deluxe Room', name: 'Badagry', rate: 65000 },
    { category: 'Deluxe', label: 'Deluxe Room', name: 'Kalakuta', rate: 65000 },
    { category: 'Deluxe', label: 'Deluxe Room', name: 'Kumasi', rate: 65000 },
    { category: 'Deluxe', label: 'Deluxe Room', name: 'Ikogosi', rate: 65000 },
    { category: 'Executive', label: 'Executive Room', name: 'Mandela', rate: 75000 },
    { category: 'Executive', label: 'Executive Room', name: 'Addis Ababa', rate: 75000 },
    { category: 'Executive', label: 'Executive Room', name: 'Kilimanjaro', rate: 75000 },
    { category: 'Presidential Suite', label: 'Presidential Suite', name: 'Iroko', rate: 95000 }
  ];

  /* --------------------------------------------------------------- helpers -- */

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) target[key] = src[key];
      }
    }
    return target;
  }

  function getPath(obj, path) {
    var parts = String(path).split('.');
    var cursor = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cursor === null || typeof cursor !== 'object') return undefined;
      cursor = cursor[parts[i]];
    }
    return cursor;
  }

  function setPath(obj, path, value) {
    var parts = String(path).split('.');
    var cursor = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cursor[parts[i]] === null || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
    return obj;
  }

  function createId() {
    return 'item-' + Math.random().toString(36).slice(2, 10);
  }

  /** Accepts "1,200.50", "\u20a645 000", 1500.5, "" -> always a finite number. */
  function toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (value === null || value === undefined) return 0;
    var cleaned = String(value).replace(/[^0-9.\-]/g, '');
    var parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : 0;
  }

  function toCents(value) { return Math.round(toNumber(value) * 100); }
  function fromCents(cents) { return cents / 100; }

  function clampRate(value) {
    var rate = toNumber(value);
    if (rate < 0) return 0;
    if (rate > 100) return 100;
    return rate;
  }

  function pad2(value) { return (value < 10 ? '0' : '') + value; }

  function toISODate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function todayISO() { return toISODate(new Date()); }

  function addDaysISO(iso, days) {
    var parts = String(iso || todayISO()).split('-');
    var base = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(base.getTime())) base = new Date();
    base.setDate(base.getDate() + days);
    return toISODate(base);
  }

  function formatDate(iso) {
    var parts = String(iso || '').split('-');
    if (parts.length === 3) {
      var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
      }
    }
    return String(iso || '\u2014');
  }

  function formatQuantity(value) {
    var qty = toNumber(value);
    return Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 10000) / 10000);
  }

  /** 'YYYY-MM-DD' -> ms at local midnight, or NaN when blank/invalid. */
  function dateOnlyMs(iso) {
    var parts = String(iso || '').split('-');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return NaN;
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (!year || !month || !day) return NaN;
    var date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return NaN;
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return NaN;
    return date.getTime();
  }

  /** Whole nights between two 'YYYY-MM-DD' dates; NaN when either is blank/invalid. */
  function nightsBetween(checkin, checkout) {
    var start = dateOnlyMs(checkin);
    var end = dateOnlyMs(checkout);
    if (isNaN(start) || isNaN(end)) return NaN;
    return Math.round((end - start) / 86400000);
  }

  /** '2 nights', '1 night', or '' when the value is not a positive number. */
  function stayNightsText(value) {
    var nights = Math.round(toNumber(value));
    if (!(nights > 0)) return '';
    return nights + (nights === 1 ? ' night' : ' nights');
  }

  /**
   * Dates printed after a room description, e.g.
   * ' Â· 3 nights (12 Sep 2026 “ 15 Sep 2026)'.
   */
  function staySuffix(item) {
    if (!item) return '';
    var startMs = dateOnlyMs(item.checkin);
    var endMs = dateOnlyMs(item.checkout);
    if (isNaN(startMs) && isNaN(endMs)) return '';
    var range = '';
    if (!isNaN(startMs) && !isNaN(endMs)) {
      range = formatDate(item.checkin) + ' \u2013 ' + formatDate(item.checkout);
    } else if (!isNaN(startMs)) {
      range = 'from ' + formatDate(item.checkin);
    } else {
      range = 'until ' + formatDate(item.checkout);
    }
    var nights = nightsBetween(item.checkin, item.checkout);
    var nightsText = (isNaN(nights) || nights <= 0) ? stayNightsText(item.qty) : stayNightsText(nights);
    return ' \u00b7 ' + (nightsText ? nightsText + ' (' + range + ')' : range);
  }

  /**
   * Older drafts baked the stay text into the description itself
   * ('Deluxe Room — Badagry Â· 3 nights (…)'). Strip it so the editable
   * check-in / check-out dates stay the single source of truth and the
   * dates cannot appear twice on the invoice.
   */
  function stripStaySuffix(description) {
    var text = String(description || '');
    var marker = text.indexOf(' \u00b7 ');
    if (marker === -1) return text;
    var tail = text.slice(marker + 2).trim().toLowerCase();
    if (/^\d+\s+nights?\b/.test(tail) || /^(from|until)\b/.test(tail)) {
      return text.slice(0, marker).trim();
    }
    return text;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * wa.me needs a full international number. Local numbers that start with a
   * trunk 0 (e.g. 0803…) cannot be turned into one, so we return "" and the
   * WhatsApp button opens the contact picker instead of a broken chat.
   */
  function phoneDigits(phone) {
    var digits = String(phone || '').replace(/[^0-9]/g, '');
    if (digits === '' || digits.charAt(0) === '0') return '';
    return (digits.length >= 10 && digits.length <= 15) ? digits : '';
  }

  function sanitizeFileName(value) {
    var name = String(value || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
    name = name.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return name || 'document';
  }

  function oneLine(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s*\n\s*/g, ' ').trim();
  }

  /* ---------------------------------------------------------- room catalogue -- */

  function roomCategories() {
    var out = [];
    var index = {};
    for (var i = 0; i < ROOMS.length; i++) {
      var room = ROOMS[i];
      if (index[room.category]) {
        index[room.category].count += 1;
        index[room.category].maxRate = Math.max(index[room.category].maxRate, room.rate);
        index[room.category].minRate = Math.min(index[room.category].minRate, room.rate);
        continue;
      }
      index[room.category] = {
        category: room.category, label: room.label,
        minRate: room.rate, maxRate: room.rate, count: 1
      };
      out.push(index[room.category]);
    }
    return out;
  }

  function roomsInCategory(category) {
    var out = [];
    for (var i = 0; i < ROOMS.length; i++) {
      if (ROOMS[i].category === category) out.push(ROOMS[i]);
    }
    return out;
  }

  function findRoom(category, name) {
    for (var i = 0; i < ROOMS.length; i++) {
      if (ROOMS[i].category === category && ROOMS[i].name === name) return ROOMS[i];
    }
    return null;
  }

  /** "Deluxe Room — Badagry" — how a room reads on an invoice line. */
  function roomLabel(room) {
    return room.label + ' \u2014 ' + room.name;
  }

  /* --------------------------------------------------------------- storage -- */

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* Private mode or storage disabled — the app simply runs without drafts. */
    }
  }

  function nextSequence() {
    var stored = parseInt(readStorage(SEQ_KEY) || '0', 10);
    var seq = (isFinite(stored) && stored > 0 ? stored : 0) + 1;
    writeStorage(SEQ_KEY, String(seq));
    return seq;
  }

  function nextInvoiceNumber() {
    return 'COC-' + new Date().getFullYear() + '-' + String(nextSequence()).padStart(4, '0');
  }

  /* ---------------------------------------------------- branches & staff -- */

  /**
   * True once the street/city fields were edited for the branch that is
   * currently selected. Until then the live address still belongs to the
   * previous branch, so it must not be remembered under the new name.
   */
  var branchDetailsDirty = false;

  /** Saved branch profiles shared across invoices on this device. */
  function branchOptions(includeLive) {
    var options = [];
    var index = {};
    function add(entry, isCurrent) {
      var label = oneLine(entry && entry.label);
      if (!label) return;
      var key = label.toLowerCase();
      if (index[key]) {
        /* The live editor values are fresher than a remembered snapshot. */
        if (isCurrent) {
          for (var f = 0; f < BRANCH_FIELDS.length; f++) {
            var fresh = oneLine(entry[BRANCH_FIELDS[f]]);
            if (fresh) index[key][BRANCH_FIELDS[f]] = fresh;
          }
        }
        return;
      }
      var profile = { label: label };
      for (var g = 0; g < BRANCH_FIELDS.length; g++) {
        profile[BRANCH_FIELDS[g]] = oneLine(entry[BRANCH_FIELDS[g]]);
      }
      index[key] = profile;
      options.push(profile);
    }
    try {
      var saved = JSON.parse(readStorage(BRANCH_STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        /* Profiles the hotel edited before win over the shipped defaults. */
        for (var j = 0; j < saved.length; j++) add(saved[j]);
      }
    } catch (err) { /* corrupted branch list — fall back to defaults */ }
    for (var i = 0; i < DEFAULT_BRANCHES.length; i++) add(DEFAULT_BRANCHES[i]);
    var current = oneLine(state.hotel && state.hotel.branch);
    if (includeLive !== false && current) {
      /* Only trust the live street/city for this branch once they were
         actually edited while it was selected (branchDetailsDirty) —
         otherwise the previous branch's address would be remembered
         under the new branch's name. */
      add({ label: current, city: state.hotel.city, address: state.hotel.address }, branchDetailsDirty);
    }
    return options;
  }

  function rememberBranch() {
    var label = oneLine(state.hotel.branch);
    if (!label) return;
    var options = branchOptions();
    writeStorage(BRANCH_STORAGE_KEY, JSON.stringify(options.slice(0, 20)));
  }

  /** Prefill city/street/phone/email/website when the branch profile has them. */
  function applyBranchProfile(label) {
    var wanted = oneLine(label).toLowerCase();
    /* Look up saved profiles only — the live editor values still belong to
       the previous branch until this profile is applied. */
    var options = branchOptions(false);
    for (var i = 0; i < options.length; i++) {
      if (options[i].label.toLowerCase() === wanted) {
        /* Assign every profile field even when empty — the previous branch's
           details must never survive a branch switch. */
        for (var f = 0; f < BRANCH_FIELDS.length; f++) {
          state.hotel[BRANCH_FIELDS[f]] = options[i][BRANCH_FIELDS[f]] || '';
        }
        return true;
      }
    }
    /* No profile on file: blank every field so a wrong address can never
       print under a branch that has no details of its own. */
    for (var g = 0; g < BRANCH_FIELDS.length; g++) {
      state.hotel[BRANCH_FIELDS[g]] = '';
    }
    return false;
  }

  /**
   * The branch picker is a closed <select> with the one Cocoon branch —
   * nothing else can be typed or saved. Old drafts that name a different or
   * retired branch fall back to the Ogudu flagship.
   */
  function canonicalBranch(value) {
    var clean = oneLine(value).toLowerCase();
    if (clean) {
      for (var i = 0; i < DEFAULT_BRANCHES.length; i++) {
        if (DEFAULT_BRANCHES[i].label.toLowerCase() === clean) return DEFAULT_BRANCHES[i].label;
      }
    }
    return DEFAULT_HOTEL.branch;
  }

  /** Fill the branch <select> with the fixed branch profile. */
  function fillBranchOptions() {
    var field = document.getElementById('field-branch');
    if (!field) return;
    field.innerHTML = DEFAULT_BRANCHES.map(function (entry) {
      return '<option value="' + escapeHtml(entry.label) + '">' + escapeHtml(entry.label) + '</option>';
    }).join('');
  }

  var STAFF_STORAGE_KEY = 'cocoon.hotel.staff.v1';
  var MAX_SAVED_STAFF = 20;

  /** Front-desk names typed before, so the next invoice can pick them again. */
  function staffOptions() {
    var out = [];
    var seen = {};
    function add(name) {
      var clean = oneLine(name);
      if (!clean) return;
      var key = clean.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(clean);
    }
    try {
      var saved = JSON.parse(readStorage(STAFF_STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) {
        for (var i = 0; i < saved.length; i++) add(saved[i]);
      }
    } catch (err) { /* corrupted staff list — fall back to what is typed now */ }
    add(state.hotel && state.hotel.staff);
    return out;
  }

  function rememberStaff(name) {
    var clean = oneLine(name);
    if (!clean) return;
    writeStorage(STAFF_STORAGE_KEY, JSON.stringify(staffOptions().slice(0, MAX_SAVED_STAFF)));
  }

  function renderStaffOptions() {
    var list = document.getElementById('staff-options');
    if (!list) return;
    list.innerHTML = staffOptions().map(function (name) {
      return '<option value="' + escapeHtml(name) + '"></option>';
    }).join('');
  }

  /* ----------------------------------------------------------------- state -- */

  var state = {
    hotel: assign({}, DEFAULT_HOTEL),
    meta: {
      docType: 'invoice', number: '', date: '', dueDate: '', currency: 'NGN',
      taxLabel: 'VAT', taxRate: 0, discountRate: 0,
      status: 'Due on receipt', notes: '', payment: ''
    },
    billTo: { name: '', room: '', stay: '', email: '', phone: '', address: '' },
    items: []
  };

  var els = {};
  var toastTimer = null;
  var saveTimer = null;

  /** The printed document is either an invoice (bill) or a receipt (proof of payment). */
  function isReceipt() {
    return String(state.meta.docType || 'invoice').toLowerCase() === 'receipt';
  }

  function docWord() { return isReceipt() ? 'Receipt' : 'Invoice'; }
  function docWordUpper() { return isReceipt() ? 'RECEIPT' : 'INVOICE'; }
  function totalWord() { return isReceipt() ? 'Total received' : 'Total due'; }

  function formatMoney(value, currency) {
    var code = currency || state.meta.currency || 'NGN';
    var amount = toNumber(value);
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: code, currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2, maximumFractionDigits: 2
      }).format(amount);
    } catch (err) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency', currency: code,
          minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(amount);
      } catch (err2) {
        return code + ' ' + amount.toFixed(2);
      }
    }
  }

  function currencyLabel(code) {
    var match = null;
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].code === code) match = CURRENCIES[i];
    }
    return (match ? match.code : code) + ' (' + formatMoney(0, code) + ')';
  }

  /* ------------------------------------------------------ totals & wording -- */

  /**
   * All money maths is done in integer cents so 0.1 + 0.2 style drift can
   * never show up on a guest's bill.
   * totals = subtotal - discount + tax
   */
  function computeTotals(items, meta) {
    var list = items || [];
    var settings = meta || state.meta;
    var lines = [];
    var subtotalCents = 0;

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var qty = toNumber(item.qty);
      var priceCents = toCents(item.price);
      var amountCents = Math.round(qty * priceCents);
      subtotalCents += amountCents;
      lines.push({
        id: item.id,
        description: stripStaySuffix(String(item.description || '').trim()),
        quantity: qty,
        unitPrice: fromCents(priceCents),
        amount: fromCents(amountCents),
        amountCents: amountCents,
        checkin: cleanISODate(item.checkin),
        checkout: cleanISODate(item.checkout)
      });
    }

    var discountRate = clampRate(settings.discountRate);
    var taxRate = clampRate(settings.taxRate);
    var discountCents = Math.round(subtotalCents * discountRate / 100);
    var taxableCents = subtotalCents - discountCents;
    var taxCents = Math.round(taxableCents * taxRate / 100);

    return {
      lines: lines,
      subtotalCents: subtotalCents,
      discountCents: discountCents,
      discountRate: discountRate,
      taxableCents: taxableCents,
      taxCents: taxCents,
      taxRate: taxRate,
      taxLabel: oneLine(settings.taxLabel) || 'Tax',
      totalCents: taxableCents + taxCents,
      subtotal: fromCents(subtotalCents),
      discount: fromCents(discountCents),
      tax: fromCents(taxCents),
      total: fromCents(taxableCents + taxCents)
    };
  }

  var WORD_ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  var WORD_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  var WORD_SCALES = ['', ' Thousand', ' Million', ' Billion', ' Trillion'];

  function wordsUnderThousand(value) {
    var words = [];
    var hundreds = Math.floor(value / 100);
    var rest = value % 100;
    if (hundreds > 0) words.push(WORD_ONES[hundreds] + ' Hundred');
    if (rest > 0) {
      if (hundreds > 0) words.push('and');
      if (rest < 20) {
        words.push(WORD_ONES[rest]);
      } else {
        var tens = Math.floor(rest / 10);
        var ones = rest % 10;
        words.push(ones > 0 ? WORD_TENS[tens] + '-' + WORD_ONES[ones] : WORD_TENS[tens]);
      }
    }
    return words.join(' ');
  }

  function numberToWords(value) {
    var number = Math.floor(Math.abs(toNumber(value)));
    if (number === 0) return 'Zero';
    var groups = [];
    var scale = 0;
    while (number > 0 && scale < WORD_SCALES.length) {
      var chunk = number % 1000;
      if (chunk > 0) groups.unshift(wordsUnderThousand(chunk) + WORD_SCALES[scale]);
      number = Math.floor(number / 1000);
      scale++;
    }
    if (number > 0) groups.unshift(String(number));
    return groups.join(' ');
  }

  function amountInWords(cents, currency) {
    var safe = Math.max(0, Math.round(toNumber(cents)));
    var major = Math.floor(safe / 100);
    var minor = safe % 100;
    var unit = CURRENCY_WORDS[currency] || currency;
    var words = numberToWords(major) + ' ' + unit;
    /* "and 50/100" is the usual financial convention for the fractional part. */
    if (minor > 0) words += ' and ' + minor + '/100';
    return words + ' only';
  }

    /* ------------------------------------------------------------- rendering -- */

  /* The hotel's own wordmark (assets/cocoon-logo.png, from cocoonogudu.com)
     inlined as a data URI: the invoice, the PDF export and the offline app never
     need the network, and html2canvas can draw it without tainting the canvas. */
  var LOGO_INVOICE_PNG =
    '<img class="inv-logo" src="data:image/png;base64,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" width="150" height="55" alt="" />';

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  function createItemRow(item) {
    var row = document.createElement('div');
    row.className = 'item';
    row.setAttribute('data-id', item.id);
    row.innerHTML =
      '<input class="item__desc" type="text" list="service-options" ' +
        'placeholder="Suite, service or charge" aria-label="Item description" />' +
      '<input class="item__qty" type="number" min="0" step="any" inputmode="decimal" ' +
        'placeholder="Qty" aria-label="Quantity" />' +
      '<input class="item__price" type="number" min="0" step="0.01" inputmode="decimal" ' +
        'placeholder="Unit price" aria-label="Unit price" />' +
      '<input class="item__checkin" type="date" aria-label="Check-in date" title="Check-in date" />' +
      '<input class="item__checkout" type="date" aria-label="Check-out date" title="Check-out date" />' +
      '<output class="item__amount" aria-label="Line amount"></output>' +
      '<button class="item__remove" type="button" title="Remove line item" ' +
        'aria-label="Remove line item">\u00d7</button>';
    syncItemRow(row, item);
    return row;
  }

  /** Pushes the state of one item into its row, without stealing focus. */
  function syncItemRow(row, item) {
    var entry = item || findItem(row.getAttribute('data-id'));
    if (!entry) return;
    var fields = {
      '.item__desc': entry.description === undefined || entry.description === null ? '' : entry.description,
      '.item__qty': entry.qty === undefined || entry.qty === null ? '' : entry.qty,
      '.item__price': entry.price === undefined || entry.price === null ? '' : entry.price,
      '.item__checkin': entry.checkin === undefined || entry.checkin === null ? '' : entry.checkin,
      '.item__checkout': entry.checkout === undefined || entry.checkout === null ? '' : entry.checkout
    };
    Object.keys(fields).forEach(function (selector) {
      var input = row.querySelector(selector);
      if (!input) return;
      /* Never rewrite the field the guest is typing in (e.g. "3.50" -> "3.5"),
         and leave values alone when only the formatting differs. */
      if (document.activeElement === input) return;
      var target = fields[selector];
      if (input.type === 'number') {
        if (toNumber(input.value) === toNumber(target)) return;
      } else if (input.value === String(target)) {
        return;
      }
      input.value = target;
    });

    var cents = Math.round(toNumber(entry.qty) * toCents(entry.price));
    var output = row.querySelector('.item__amount');
    if (output) output.textContent = formatMoney(fromCents(cents));

    var missingDescription = !String(entry.description || '').trim() && cents !== 0;
    row.classList.toggle('is-invalid', missingDescription);
    row.setAttribute('data-amount', String(fromCents(cents)));
  }

  function isBlankItem(item) {
    return !item
      ? false
      : String(item.description || '').trim() === '' && toNumber(item.price) === 0 &&
        oneLine(item.checkin || '') === '' && oneLine(item.checkout || '') === '';
  }

  /**
   * Appends a line item — or fills the empty row already sitting at the bottom
   * of the list, which is what a receptionist expects when adding charges.
   */
  function addItem(options) {
    var settings = options || {};
    var item = {
      id: createId(),
      description: settings.description || '',
      qty: settings.qty === undefined ? 1 : settings.qty,
      price: settings.price === undefined ? '' : settings.price,
      checkin: settings.checkin === undefined ? '' : settings.checkin,
      checkout: settings.checkout === undefined ? '' : settings.checkout
    };

    var lastRow = state.items[state.items.length - 1];
    if (settings.reuseBlank !== false && isBlankItem(lastRow)) {
      lastRow.description = item.description;
      lastRow.qty = item.qty;
      lastRow.price = item.price;
      lastRow.checkin = item.checkin;
      lastRow.checkout = item.checkout;
      item = lastRow;
      renderItemRows();
    } else {
      state.items.push(item);
      if (els.items) els.items.appendChild(createItemRow(item));
    }

    render();
    if (els.items && settings.focus !== false) {
      var row = els.items.querySelector('[data-id="' + item.id + '"]');
      var target = row && row.querySelector(settings.focusPrice ? '.item__price' : '.item__desc');
      if (target) target.focus();
    }
    return item;
  }

  function removeItem(id) {
    var index = -1;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) index = i;
    }
    if (index === -1) return;
    state.items.splice(index, 1);
    var row = els.items && els.items.querySelector('[data-id="' + id + '"]');
    if (row && row.parentNode) row.parentNode.removeChild(row);
    render();
  }

  function renderItemRows() {
    if (!els.items) return;
    var rows = els.items.querySelectorAll('.item');
    for (var i = 0; i < rows.length; i++) {
      if (!findItem(rows[i].getAttribute('data-id'))) els.items.removeChild(rows[i]);
    }
    for (var j = 0; j < state.items.length; j++) {
      var item = state.items[j];
      var row = els.items.querySelector('[data-id="' + item.id + '"]');
      if (!row) els.items.appendChild(createItemRow(item));
      else syncItemRow(row, item);
    }
  }

  /* ----------------------------------------------------------- room picker -- */

  function currentRoom() {
    if (!els.roomCategory || !els.roomName) return null;
    return findRoom(els.roomCategory.value, els.roomName.value);
  }

  function roomNights() {
    var nights = dateNights();
    if (!isNaN(nights) && nights > 0) return nights;
    if (!els.roomNights) return 1;
    var fallback = Math.round(toNumber(els.roomNights.value));
    return fallback > 0 ? fallback : 1;
  }

  /** Whole nights from the check-in / check-out inputs; NaN when either is empty. */
  function dateNights() {
    if (!els.roomCheckin || !els.roomCheckout) return NaN;
    return nightsBetween(els.roomCheckin.value, els.roomCheckout.value);
  }

  /** Editable dates look like '2026-09-22'; anything else is treated as empty. */
  function cleanISODate(value) {
    var text = oneLine(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    return isNaN(dateOnlyMs(text)) ? '' : text;
  }

  function roomDates() {
    return {
      checkin: els.roomCheckin ? cleanISODate(els.roomCheckin.value) : '',
      checkout: els.roomCheckout ? cleanISODate(els.roomCheckout.value) : ''
    };
  }

  /**
   * Dates drive the nights: picking a check-in defaults the check-out to the
   * next night, and changing either date recomputes the nights field.
   */
  function syncRoomDates(changed) {
    if (!els.roomCheckin || !els.roomCheckout || !els.roomNights) return;
    var dates = roomDates();
    var current = Math.round(toNumber(els.roomNights.value));

    if (changed === 'checkin' && dates.checkin && !dates.checkout) {
      els.roomCheckout.value = addDaysISO(dates.checkin, current > 0 ? current : 1);
      dates.checkout = cleanISODate(els.roomCheckout.value);
    }

    var nights = nightsBetween(dates.checkin, dates.checkout);
    if (!isNaN(nights)) {
      if (nights !== current) els.roomNights.value = String(nights);
    }
  }

  function roomLineCents() {
    if (!els.roomRate) return 0;
    return Math.round(roomNights() * toCents(els.roomRate.value));
  }

  function fillRoomCategories() {
    if (!els.roomCategory) return;
    els.roomCategory.innerHTML = roomCategories().map(function (group) {
      var count = group.count === 1 ? '1 room' : group.count + ' rooms';
      return '<option value="' + escapeHtml(group.category) + '">' +
        escapeHtml(group.label + ' (' + count + ')') + '</option>';
    }).join('');
    fillRoomNames();
  }

  function fillRoomNames() {
    if (!els.roomName) return;
    var rooms = roomsInCategory(els.roomCategory ? els.roomCategory.value : '');
    els.roomName.innerHTML = rooms.map(function (room) {
      return '<option value="' + escapeHtml(room.name) + '">' + escapeHtml(room.name) + '</option>';
    }).join('');
    syncRateFromRoom();
  }

  /** Loads the published nightly rate whenever a different room is chosen. */
  function syncRateFromRoom() {
    var room = currentRoom();
    if (room && els.roomRate) els.roomRate.value = String(room.rate);
    renderRoomPicker();
  }

  function renderRoomPicker() {
    var room = currentRoom();
    var nights = roomNights();
    var rate = els.roomRate ? toNumber(els.roomRate.value) : 0;

    if (els.roomTotal) els.roomTotal.textContent = formatMoney(fromCents(roomLineCents()));
    if (els.rateCurrency) els.rateCurrency.textContent = state.meta.currency;
    if (!els.roomHint) return;

    if (!room) {
      els.roomHint.textContent = 'Pick a category and a room to load its published rate.';
      els.roomHint.classList.remove('is-warning');
      return;
    }

    var nightsText = formatQuantity(nights) + (nights === 1 ? ' night' : ' nights');
    var dates = roomDates();
    var stayRange = '';
    if (dates.checkin || dates.checkout) {
      stayRange = ' \u00b7 ';
      if (dates.checkin && dates.checkout) {
        stayRange += formatDate(dates.checkin) + ' \u2013 ' + formatDate(dates.checkout);
      } else if (dates.checkin) {
        stayRange += 'from ' + formatDate(dates.checkin);
      } else {
        stayRange += 'until ' + formatDate(dates.checkout);
      }
    }
    if (rate === room.rate) {
      els.roomHint.textContent = roomLabel(room) + ' \u00b7 ' + nightsText + stayRange +
        ' at the published rate of ' + formatMoney(room.rate) + ' per night.';
      els.roomHint.classList.remove('is-warning');
    } else {
      els.roomHint.textContent = roomLabel(room) + ' \u00b7 ' + nightsText + stayRange +
        ' at a custom rate of ' + formatMoney(rate) + ' (published rate: ' + formatMoney(room.rate) + ').';
      els.roomHint.classList.add('is-warning');
    }
    if (dates.checkin && dates.checkout && dateNights() <= 0) {
      els.roomHint.textContent += ' Check-out must be after check-in.';
      els.roomHint.classList.add('is-warning');
    }
  }

  function renderRateCard() {
    if (!els.rateCard) return;
    els.rateCard.innerHTML = roomCategories().map(function (group) {
      var from = group.minRate === group.maxRate ? '' : 'from ';
      var count = group.count === 1 ? '1 room' : group.count + ' rooms';
      return '<li class="rate-card__item">' +
        '<span class="rate-card__label">' + escapeHtml(group.label) + '</span>' +
        '<span class="rate-card__rate">' + escapeHtml(from + formatMoney(group.minRate)) + '</span>' +
        '<span class="rate-card__count">' + escapeHtml(count) + '</span>' +
        '</li>';
    }).join('');
  }

  /** Adds every room name to the description suggestions of the item rows. */
  function fillServiceOptions() {
    var list = document.getElementById('service-options');
    if (!list) return;
    var known = {};
    var options = list.querySelectorAll('option');
    for (var i = 0; i < options.length; i++) known[options[i].value] = true;
    for (var j = 0; j < ROOMS.length; j++) {
      var value = roomLabel(ROOMS[j]);
      if (known[value]) continue;
      var option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    }
  }

  /**
   * Turns the picker into an ordinary line item so the totals, the PDF and the
   * share links all pick it up. Adding the same room again for the same dates
   * and rate extends the existing nights instead of billing the room twice.
   */
  function addRoomToInvoice() {
    var room = currentRoom();
    if (!room) {
      toast('Pick a room category and a room first.', true);
      return;
    }

    var dates = roomDates();
    if (dates.checkin && dates.checkout && dateNights() <= 0) {
      toast('Check-out must be after check-in.', true);
      return;
    }

    var nights = roomNights();
    var rate = Math.max(0, toNumber(els.roomRate.value));
    var description = roomLabel(room);
    var suffix = staySuffix({ qty: nights, checkin: dates.checkin, checkout: dates.checkout });
    var existing = null;

    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].description === description &&
          cleanISODate(state.items[i].checkin) === dates.checkin &&
          cleanISODate(state.items[i].checkout) === dates.checkout &&
          toNumber(state.items[i].price) === rate) {
        existing = state.items[i];
      }
    }

    if (existing) {
      existing.qty = toNumber(existing.qty) + nights;
      renderItemRows();
      render();
      toast(description + suffix + ' extended to ' + formatQuantity(existing.qty) + ' nights.');
    } else {
      addItem({
        description: description,
        qty: nights,
        price: rate,
        checkin: dates.checkin,
        checkout: dates.checkout,
        focus: false
      });
      toast(description + suffix + ' added \u2014 ' + formatQuantity(nights) + (nights === 1 ? ' night' : ' nights') +
        ' at ' + formatMoney(rate) + '.');
    }

    if (oneLine(state.billTo.room) === '') {
      setPath(state, 'billTo.room', room.name);
      syncForm();
      render();
    }
  }

  function asList(value) {
    return String(value === null || value === undefined ? '' : value)
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line !== ''; });
  }

  function formatRate(rate) {
    return String(Math.round(toNumber(rate) * 100) / 100) + '%';
  }

  /** Builds the printable document (invoice or receipt). All guest text is escaped. */
  function invoiceHTML(totals) {
    var hotel = state.hotel;
    var meta = state.meta;
    var guest = state.billTo;
    var currency = meta.currency;
    var title = docWord();
    var totalLabel = totalWord();
    var staff = oneLine(hotel.staff);
    var branch = oneLine(hotel.branch);

    function money(value) { return escapeHtml(formatMoney(value, currency)); }
    function moneyRaw(value) { return formatMoney(value, currency); }

    var fromLines = asList(hotel.address).concat([hotel.city, hotel.phone, hotel.email, hotel.website])
      .filter(function (line) { return oneLine(line) !== ''; })
      .map(function (line) { return '<p>' + escapeHtml(line) + '</p>'; })
      .join('');

    var facts = [];
    if (oneLine(guest.room)) facts.push(['Suite / room', guest.room]);
    if (oneLine(guest.stay)) facts.push(['Stay', guest.stay]);
    if (oneLine(guest.email)) facts.push(['Email', guest.email]);
    if (oneLine(guest.phone)) facts.push(['Phone', guest.phone]);
    var factsHtml = facts.map(function (pair) {
      return '<div><dt>' + escapeHtml(pair[0]) + '</dt><dd>' + escapeHtml(pair[1]) + '</dd></div>';
    }).join('');

    var guestLines = asList(guest.address).map(function (line) {
      return '<p class="inv-party__line">' + escapeHtml(line) + '</p>';
    }).join('');

    var visible = totals.lines.filter(function (line) {
      return line.description !== '' || line.amountCents !== 0;
    });
    var rowsHtml = visible.map(function (line, index) {
      var label = line.description || 'Charge';
      var sub = staySuffix({ qty: line.quantity, checkin: line.checkin, checkout: line.checkout });
      return '<tr class="inv-item">' +
        '<td>' + (index + 1) + '</td>' +
        '<td class="inv-item__desc">' + escapeHtml(label) +
          (sub ? '<span class="inv-item__stay">' + escapeHtml(sub) + '</span>' : '') + '</td>' +
        '<td class="ta-r inv-num">' + escapeHtml(formatQuantity(line.quantity)) + '</td>' +
        '<td class="ta-r inv-num">' + escapeHtml(moneyRaw(line.unitPrice)) + '</td>' +
        '<td class="ta-r inv-item__amt">' + escapeHtml(moneyRaw(line.amount)) + '</td>' +
        '</tr>';
    }).join('');
    if (rowsHtml === '') {
      rowsHtml = '<tr class="inv-items__empty"><td colspan="5">' +
        'No line items yet &mdash; add a charge in the editor and the totals appear here.' +
        '</td></tr>';
    }

    var totalsHtml = '<div class="inv-trow" data-role="subtotal"><span>Subtotal</span><span>' +
      money(totals.subtotal) + '</span></div>';
    if (totals.discountRate > 0) {
      totalsHtml += '<div class="inv-trow" data-role="discount"><span>Discount (' +
        escapeHtml(formatRate(totals.discountRate)) + ')</span><span>&minus;' + money(totals.discount) + '</span></div>';
    }
    if (totals.taxRate > 0) {
      totalsHtml += '<div class="inv-trow" data-role="tax"><span>' + escapeHtml(totals.taxLabel) + ' (' +
        escapeHtml(formatRate(totals.taxRate)) + ')</span><span>' + money(totals.tax) + '</span></div>';
    }
    totalsHtml += '<div class="inv-trow inv-trow--total" data-role="total"><span>' +
      escapeHtml(totalLabel) + '</span><span>' +
      money(totals.total) + '</span></div>';

    var notesHtml = '';
    if (oneLine(meta.notes) !== '') {
      notesHtml += '<div class="inv-notes__block"><p class="inv-label">Notes</p>' + escapeHtml(meta.notes) + '</div>';
    }
    if (oneLine(meta.payment) !== '') {
      notesHtml += '<div class="inv-notes__block"><p class="inv-label">Payment instructions</p>' +
        escapeHtml(meta.payment) + '</div>';
    }

    return '' +
      '<header class="inv-head">' +
        /* The wordmark alone brands the page: the hotel name, tagline and
           branch are deliberately not printed beside the logo. */
        '<div class="inv-brand">' + LOGO_INVOICE_PNG + '</div>' +
        '<div class="inv-from">' +
          '<p class="inv-from__name">Issued by</p>' + fromLines +
        '</div>' +
      '</header>' +
      '<div class="inv-meta">' +
        '<div>' +
          '<h1 class="inv-title">' + escapeHtml(title) + '</h1>' +
          '<p class="inv-number" data-role="number">#' + escapeHtml(oneLine(meta.number) || '\u2014') + '</p>' +
          (oneLine(meta.status) ? '<p class="inv-status">' + escapeHtml(meta.status) + '</p>' : '') +
        '</div>' +
        '<dl class="inv-meta__list">' +
          '<div class="inv-meta__item"><dt>' + escapeHtml(title) + ' date</dt><dd>' + escapeHtml(formatDate(meta.date)) + '</dd></div>' +
          (isReceipt() ? '' :
            '<div class="inv-meta__item"><dt>Due date</dt><dd>' + escapeHtml(formatDate(meta.dueDate)) + '</dd></div>') +
          '<div class="inv-meta__item"><dt>Currency</dt><dd>' + escapeHtml(currencyLabel(currency)) + '</dd></div>' +
        '</dl>' +
      '</div>' +
      '<section class="inv-party">' +
        '<div>' +
          '<p class="inv-label">Billed to</p>' +
          '<p class="inv-party__name">' + escapeHtml(oneLine(guest.name) || 'Guest') + '</p>' +
          guestLines +
        '</div>' +
        (factsHtml ? '<dl class="inv-facts">' + factsHtml + '</dl>' : '<div></div>') +
      '</section>' +
      '<table class="inv-items">' +
        '<thead><tr>' +
          '<th scope="col">#</th>' +
          '<th scope="col">Description</th>' +
          '<th scope="col" class="ta-r">Qty</th>' +
          '<th scope="col" class="ta-r">Unit price</th>' +
          '<th scope="col" class="ta-r">Amount</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
      '<section class="inv-totals">' +
        '<p class="inv-words" data-role="words"><strong>Amount in words</strong><em>' +
          escapeHtml(amountInWords(totals.totalCents, currency)) + '</em></p>' +
        '<div class="inv-totals__box">' + totalsHtml + '</div>' +
      '</section>' +
      (notesHtml ? '<section class="inv-notes">' + notesHtml + '</section>' : '') +
      (staff || branch ? '<section class="inv-signoff">' +
        (staff ? '<p class="inv-signoff__staff">Prepared by: <strong>' + escapeHtml(staff) + '</strong></p>' : '') +
        (branch ? '<p class="inv-signoff__branch">' + escapeHtml(branch) + ' branch</p>' : '') +
      '</section>' : '') +
      '<footer class="inv-foot">' +
        '<span class="inv-foot__thanks">Thank you for staying with ' +
          escapeHtml(oneLine(hotel.name) || DEFAULT_HOTEL.name) + '.</span>' +
      '</footer>';
  }

  /* ------------------------------------------------------ render plumbing -- */

  /** Single place that refreshes preview + totals badge after any change. */
  function render() {
    var totals = computeTotals(state.items, state.meta);
    if (els.invoice) els.invoice.innerHTML = invoiceHTML(totals);
    renderDocTypeLabels();
    if (els.itemCount) {
      els.itemCount.textContent = state.items.length + (state.items.length === 1 ? ' item' : ' items');
    }
    renderToolbarHint();
    renderRoomPicker();
    renderRateCard();
    scheduleSave();
    return totals;
  }

  /**
   * The static HTML is written as an invoice, so relabel the editor chrome
   * (card heading, number/date labels) whenever the receipt switch is used.
   * Receipts are proof of payment: no due date, and the payment status
   * defaults to a paid stamp instead of "Due on receipt".
   */
  function renderDocTypeLabels() {
    var receipt = isReceipt();
    var title = docWord();
    var labels = document.querySelectorAll('[data-role-label]');
    for (var i = 0; i < labels.length; i++) {
      var role = labels[i].getAttribute('data-role-label');
      if (role === 'card-title') labels[i].textContent = title + ' details';
      else if (role === 'number') labels[i].textContent = title + ' number';
      else if (role === 'date') labels[i].textContent = title + ' date';
      else if (role === 'email-btn') labels[i].textContent = 'Email ' + title.toLowerCase();
      else if (role === 'new-btn') labels[i].textContent = 'New ' + title.toLowerCase();
      else if (role === 'save-history-btn') labels[i].textContent = 'Save ' + title.toLowerCase() + ' to history';
    }
    var due = document.querySelector('[data-role-field="due-date"]');
    if (due) due.style.display = receipt ? 'none' : '';
    try {
      if (document.title) {
        document.title = 'Cocoon Luxury Suites Ogudu \u2014 ' + title + ' Generator';
      }
    } catch (err) { /* headless test DOM — ignore */ }
  }

  /** Flipping the switch keeps the draft but swaps the payment-status default. */
  function onDocTypeChange(previous) {
    var receipt = isReceipt();
    if (receipt && (previous === INVOICE_STATUS || oneLine(state.meta.status) === '')) {
      state.meta.status = RECEIPT_STATUS;
    } else if (!receipt && previous === RECEIPT_STATUS) {
      state.meta.status = INVOICE_STATUS;
    }
    syncForm();
    render();
  }

  function renderToolbarHint() {
    if (!els.toolbarHint) return;
    var email = oneLine(state.billTo.email);
    var digits = phoneDigits(state.billTo.phone);
    var bits = [
      'The PDF is built in your browser \u2014 nothing is uploaded.',
      email ? 'Email \u2192 ' + email : 'Email \u2192 your mail app will ask for the address',
      digits ? 'WhatsApp \u2192 +' + digits : 'WhatsApp \u2192 pick a contact inside WhatsApp'
    ];
    els.toolbarHint.textContent = bits.join('  \u00b7  ');
  }

  function saveDraft() {
    writeStorage(STORAGE_KEY, JSON.stringify({
      hotel: state.hotel,
      meta: state.meta,
      billTo: state.billTo,
      items: state.items
    }));
  }

  function scheduleSave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      saveDraft();
    }, 250);
  }

  /* -------------------------------------------------------------- state I/O -- */

  function parseStoredDraft() {
    var raw = readStorage(STORAGE_KEY);
    if (!raw) return null;
    try {
      var draft = JSON.parse(raw);
      return draft && typeof draft === 'object' ? draft : null;
    } catch (err) {
      return null;
    }
  }

  function blankMeta() {
    return {
      docType: state.meta.docType === 'receipt' ? 'receipt' : 'invoice',
      number: '', date: '', dueDate: '', currency: state.meta.currency || 'NGN',
      taxLabel: 'VAT', taxRate: 0, discountRate: 0,
      status: state.meta.docType === 'receipt' ? RECEIPT_STATUS : INVOICE_STATUS,
      notes: '', payment: ''
    };
  }

  /** Old drafts predate the receipt switch, so default them to an invoice. */
  function normaliseDocType() {
    var type = String(state.meta.docType || 'invoice').toLowerCase();
    state.meta.docType = type === 'receipt' ? 'receipt' : 'invoice';
  }

  /** Shapes stored items (from a draft or a history snapshot) into line rows. */
  function loadItems(items) {
    var out = [];
    if (Array.isArray(items)) {
      for (var i = 0; i < items.length; i++) {
        var raw = items[i] || {};
        out.push({
          id: raw.id ? String(raw.id) : createId(),
          description: raw.description === undefined || raw.description === null ? '' : stripStaySuffix(String(raw.description)),
          qty: raw.qty === undefined || raw.qty === null ? 1 : raw.qty,
          price: raw.price === undefined || raw.price === null ? '' : raw.price,
          checkin: cleanISODate(raw.checkin),
          checkout: cleanISODate(raw.checkout)
        });
      }
    }
    return out;
  }

  function setupStateFromDraft() {
    var draft = parseStoredDraft();
    var meta = blankMeta();

    state.hotel = assign({}, DEFAULT_HOTEL, (draft && draft.hotel) || {});
    var draftBranch = oneLine(state.hotel.branch);
    state.hotel.branch = canonicalBranch(draftBranch);
    /* A draft that names a retired branch keeps that branch's street / phone,
       so hand the draft back to the profile of the branch it falls back to —
       Ogudu details must never print alongside a retired branch's. */
    if (draftBranch && state.hotel.branch !== draftBranch) applyBranchProfile(state.hotel.branch);
    state.meta = assign(meta, (draft && draft.meta) || {});
    normaliseDocType();
    state.billTo = assign({ name: '', room: '', stay: '', email: '', phone: '', address: '' }, (draft && draft.billTo) || {});

    state.items = loadItems(draft && draft.items);

    if (!state.meta.date) state.meta.date = todayISO();
    if (!state.meta.dueDate) state.meta.dueDate = addDaysISO(state.meta.date, DUE_DAYS);
    if (!state.meta.number) state.meta.number = nextInvoiceNumber();
    if (state.items.length === 0) {
      state.items.push({ id: createId(), description: '', qty: 1, price: '', checkin: '', checkout: '' });
    }
  }

  /** Pushes state into every [data-path] field of the editor form. */
  function syncForm() {
    var fields = document.querySelectorAll('[data-path]');
    for (var i = 0; i < fields.length; i++) {
      var path = fields[i].getAttribute('data-path');
      var value = getPath(state, path);
      fields[i].value = value === undefined || value === null ? '' : String(value);
    }
  }

  function startNewInvoice() {
    var today = todayISO();
    var keepType = state.meta.docType === 'receipt' ? 'receipt' : 'invoice';
    state.meta = assign(blankMeta(), {
      docType: keepType,
      number: nextInvoiceNumber(),
      date: today,
      dueDate: addDaysISO(today, DUE_DAYS),
      status: keepType === 'receipt' ? RECEIPT_STATUS : INVOICE_STATUS
    });
    state.billTo = { name: '', room: '', stay: '', email: '', phone: '', address: '' };
    state.items = [{ id: createId(), description: '', qty: 1, price: '', checkin: '', checkout: '' }];
    syncForm();
    renderItemRows();
    render();
    toast('Started a fresh ' + keepType + ' ' + state.meta.number + '.');
  }

  function restoreHotelDefaults() {
    state.hotel = assign({}, DEFAULT_HOTEL);
    branchDetailsDirty = false;
    syncForm();
    render();
    toast('Hotel details restored to the Cocoon defaults.');
  }

  /* ------------------------------------------------------------- history -- */

  /**
   * Every invoice and receipt the front desk files is snapshotted into
   * localStorage (cocoon.history.v1), so past documents can be reopened,
   * duplicated or printed again — on this device only, never uploaded.
   * Entries are keyed by document type + number: re-filing the same number
   * updates its entry instead of piling up duplicates, and only the newest
   * MAX_HISTORY entries are ever kept.
   */
  function readHistory() {
    try {
      var list = JSON.parse(readStorage(HISTORY_KEY) || '[]');
      if (!Array.isArray(list)) return [];
      return list.filter(function (entry) {
        return !!entry && typeof entry === 'object' && !!entry.state;
      });
    } catch (err) {
      return []; /* a corrupted history must never stop the app from booting */
    }
  }

  function writeHistory(list) {
    writeStorage(HISTORY_KEY, JSON.stringify((list || []).slice(0, MAX_HISTORY)));
  }

  function historyWord(entry) {
    return entry && entry.docType === 'receipt' ? 'receipt' : 'invoice';
  }

  /** A full snapshot of the working document: hotel, meta, guest and lines. */
  function historyEntry() {
    var totals = computeTotals(state.items, state.meta);
    return {
      id: 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      savedAt: Date.now(),
      docType: isReceipt() ? 'receipt' : 'invoice',
      number: oneLine(state.meta.number),
      date: oneLine(state.meta.date),
      guest: oneLine(state.billTo.name),
      totalCents: totals.totalCents,
      currency: state.meta.currency || 'NGN',
      state: {
        hotel: assign({}, state.hotel),
        meta: assign({}, state.meta),
        billTo: assign({}, state.billTo),
        items: state.items.map(function (item) { return assign({}, item); })
      }
    };
  }

  /** Files the current document; re-filing the same number updates its entry. */
  function saveToHistory(options) {
    var entry = historyEntry();
    var key = (entry.docType + '#' + entry.number).toLowerCase();
    var list = readHistory().filter(function (existing) {
      if (!entry.number || !existing) return true;
      var existingKey = ((existing.docType || 'invoice') + '#' + (existing.number || '')).toLowerCase();
      return existingKey !== key;
    });
    list.unshift(entry);
    writeHistory(list);
    renderHistory();
    if (!(options && options.silent)) {
      toast('Saved ' + historyWord(entry) + (entry.number ? ' ' + entry.number : '') + ' to history.');
    }
    return entry;
  }

  function deleteHistoryEntry(id) {
    writeHistory(readHistory().filter(function (entry) { return entry.id !== id; }));
    renderHistory();
  }

  function clearHistory() {
    writeHistory([]);
    renderHistory();
    toast('History cleared — nothing is filed on this device.');
  }

  /** Locale-aware "saved ..." stamp, with a safe fallback for odd input. */
  function formatSavedAt(value) {
    var date = new Date(Number(value) || 0);
    if (isNaN(date.getTime())) return '';
    try {
      return date.toLocaleString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (err) {
      return date.toISOString();
    }
  }

  /** One row of the saved-documents list; every stored field is escaped. */
  function historyRowHTML(entry) {
    var receipt = entry.docType === 'receipt';
    var title = receipt ? 'Receipt' : 'Invoice';
    var number = oneLine(entry.number) || 'No number';
    var guest = oneLine(entry.guest) || 'Guest';
    var count = entry.state && Array.isArray(entry.state.items) ? entry.state.items.length : 0;
    return '<li class="history__item" data-history-id="' + escapeHtml(String(entry.id || '')) + '">' +
      '<span class="history__type' + (receipt ? ' history__type--receipt' : '') + '">' + title + '</span>' +
      '<div class="history__body">' +
        '<p class="history__title"><strong>#' + escapeHtml(number) + '</strong> &middot; ' + escapeHtml(guest) + '</p>' +
        '<p class="history__meta">' + escapeHtml(formatDate(entry.date)) + ' &middot; ' +
          count + (count === 1 ? ' item' : ' items') + ' &middot; saved ' +
          escapeHtml(formatSavedAt(entry.savedAt)) + '</p>' +
      '</div>' +
      '<span class="history__total">' +
        escapeHtml(formatMoney((Number(entry.totalCents) || 0) / 100, entry.currency)) + '</span>' +
      '<span class="history__actions">' +
        '<button type="button" class="btn btn--sm btn--soft" data-history-action="open">Open</button>' +
        '<button type="button" class="btn btn--sm" data-history-action="duplicate">Duplicate</button>' +
        '<button type="button" class="btn btn--sm btn--ghost btn--danger" data-history-action="delete">Delete</button>' +
      '</span>' +
    '</li>';
  }

  /** Rebuilds the saved-documents list from storage (empty state included). */
  function renderHistory() {
    if (!els.historyList) return;
    var list = readHistory();
    if (els.historyCount) {
      els.historyCount.textContent = list.length + (list.length === 1 ? ' document' : ' documents');
    }
    if (list.length === 0) {
      els.historyList.innerHTML =
        '<li class="history__empty">Nothing filed yet &mdash; press <strong>Save to history</strong> ' +
        'to keep this ' + docWord().toLowerCase() + ' (or any past one) on this device.</li>';
      return;
    }
    els.historyList.innerHTML = list.map(function (entry) { return historyRowHTML(entry); }).join('');
  }

  /** Restores a filed snapshot into the editor; duplicate issues a new number. */
  function openHistoryEntry(id, duplicate) {
    var list = readHistory();
    var entry = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) { entry = list[i]; break; }
    }
    if (!entry || !entry.state) return false;
    var snapshot = entry.state;

    state.hotel = assign({}, DEFAULT_HOTEL, snapshot.hotel || {});
    var snapshotBranch = oneLine(state.hotel.branch);
    state.hotel.branch = canonicalBranch(snapshotBranch);
    if (snapshotBranch && state.hotel.branch !== snapshotBranch) applyBranchProfile(state.hotel.branch);
    state.meta = assign(blankMeta(), snapshot.meta || {});
    normaliseDocType();
    state.billTo = assign({ name: '', room: '', stay: '', email: '', phone: '', address: '' }, snapshot.billTo || {});
    state.items = loadItems(snapshot.items);
    if (!state.meta.date) state.meta.date = todayISO();
    if (!state.meta.dueDate) state.meta.dueDate = addDaysISO(state.meta.date, DUE_DAYS);
    if (!state.meta.number) state.meta.number = nextInvoiceNumber();
    if (state.items.length === 0) {
      state.items.push({ id: createId(), description: '', qty: 1, price: '', checkin: '', checkout: '' });
    }
    if (duplicate) {
      state.meta.number = nextInvoiceNumber();
      state.meta.date = todayISO();
      if (!isReceipt()) state.meta.dueDate = addDaysISO(state.meta.date, DUE_DAYS);
      state.meta.status = isReceipt() ? RECEIPT_STATUS : INVOICE_STATUS;
    }

    syncForm();
    renderItemRows();
    render();
    toast((duplicate ? 'Duplicated as ' : 'Opened ') + docWord().toLowerCase() + ' ' + state.meta.number + '.');
    return true;
  }

  /** Open / duplicate / delete buttons inside the saved-documents list. */
  function onHistoryClick(event) {
    var target = event && event.target;
    var button = target && target.closest ? target.closest('[data-history-action]') : null;
    if (!button) return;
    var row = button.closest('[data-history-id]');
    if (!row) return;
    var action = button.getAttribute('data-history-action');
    var id = row.getAttribute('data-history-id');
    if (action === 'delete') {
      deleteHistoryEntry(id);
      toast('Document removed from history.');
    } else if (action === 'open') {
      openHistoryEntry(id, false);
    } else if (action === 'duplicate') {
      openHistoryEntry(id, true);
    }
  }

  /* ---------------------------------------------------------------- toast -- */

  function toast(message, isError) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', !!isError);
    els.toast.classList.add('is-visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastTimer = null;
      els.toast.classList.remove('is-visible');
    }, 4600);
  }

  /* ------------------------------------------------- share text & channels -- */

  /**
   * Human-readable version of the document, used for email, WhatsApp and the
   * clipboard. `bold: true` adds WhatsApp's *asterisk* formatting.
   */
  function buildShareText(options) {
    var bold = !!(options && options.bold);
    var totals = computeTotals(state.items, state.meta);
    var meta = state.meta;
    var hotel = state.hotel;
    var guest = state.billTo;
    var currency = meta.currency;
    var title = docWord();
    var titleUpper = docWordUpper();
    var totalLabel = totalWord();
    var out = [];

    function money(value) { return formatMoney(value, currency); }
    function strong(text) { return bold ? '*' + text + '*' : text; }

    out.push(strong(titleUpper + ' ' + (oneLine(meta.number) || '\u2014')));
    out.push(oneLine(hotel.name) || DEFAULT_HOTEL.name);
    if (oneLine(hotel.branch)) out.push(oneLine(hotel.branch));
    var contact = [oneLine(hotel.phone), oneLine(hotel.email), oneLine(hotel.website)]
      .filter(function (part) { return part !== ''; }).join(' | ');
    if (contact) out.push(contact);
    if (oneLine(hotel.staff)) out.push('Prepared by: ' + oneLine(hotel.staff));
    out.push('');
    out.push('Billed to: ' + (oneLine(guest.name) || 'Guest'));
    if (oneLine(guest.room)) out.push('Suite / room: ' + oneLine(guest.room));
    if (oneLine(guest.stay)) out.push('Stay: ' + oneLine(guest.stay));
    out.push(title + ' date: ' + formatDate(meta.date));
    if (!isReceipt()) out.push('Due date: ' + formatDate(meta.dueDate));
    if (oneLine(meta.status)) out.push('Status: ' + oneLine(meta.status));
    out.push('');
    out.push(strong('Charges'));

    var lines = totals.lines.filter(function (line) {
      return line.description !== '' || line.amountCents !== 0;
    });
    if (lines.length === 0) {
      out.push('1. No line items added yet.');
    } else {
      var shown = lines.slice(0, MAX_SHARE_ITEMS);
      for (var i = 0; i < shown.length; i++) {
        var label = (shown[i].description || 'Charge') +
          staySuffix({ qty: shown[i].quantity, checkin: shown[i].checkin, checkout: shown[i].checkout });
        out.push((i + 1) + '. ' + label + ' \u2014 ' +
          formatQuantity(shown[i].quantity) + ' x ' + money(shown[i].unitPrice) + ' = ' + money(shown[i].amount));
      }
      if (lines.length > shown.length) {
        out.push('... plus ' + (lines.length - shown.length) + ' more line item(s).');
      }
    }

    out.push('');
    out.push('Subtotal: ' + money(totals.subtotal));
    if (totals.discountRate > 0) {
      out.push('Discount (' + formatRate(totals.discountRate) + '): -' + money(totals.discount));
    }
    if (totals.taxRate > 0) {
      out.push(totals.taxLabel + ' (' + formatRate(totals.taxRate) + '): ' + money(totals.tax));
    }
    out.push(strong(totalLabel + ': ' + money(totals.total)));
    out.push('');

    if (oneLine(meta.notes)) out.push(String(meta.notes).trim());
    if (oneLine(meta.payment)) {
      out.push('Payment instructions:');
      out.push(String(meta.payment).trim());
    }
    out.push('');
    out.push('Thank you for staying with ' + (oneLine(hotel.name) || DEFAULT_HOTEL.name) + '.');
    out.push('A PDF copy of this ' + title.toLowerCase() + ' is available on request.');
    return out.join('\n');
  }

  function emailUrl() {
    var kind = docWord();
    var subject = kind + ' ' + (oneLine(state.meta.number) || '') +
      ' from ' + (oneLine(state.hotel.name) || DEFAULT_HOTEL.name);
    var body = buildShareText({ bold: false });
    if (body.length > MAX_MAILTO_BODY) {
      body = body.slice(0, MAX_MAILTO_BODY) +
        '\n\n(message shortened \u2014 see the PDF ' + kind.toLowerCase() + ' for the full itemised bill)';
    }
    return 'mailto:' + encodeURIComponent(oneLine(state.billTo.email)) +
      '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  function whatsappUrl() {
    var text = buildShareText({ bold: true });
    if (text.length > 4000) text = text.slice(0, 4000) + '\n\u2026';
    return 'https://wa.me/' + phoneDigits(state.billTo.phone) + '?text=' + encodeURIComponent(text);
  }

  function openEmail() {
    window.location.href = emailUrl();
    toast('Opening your email app with the ' + docWord().toLowerCase() + ' details. Attach the downloaded PDF if you need the file copy.');
  }

  function openWhatsApp() {
    var url = whatsappUrl();
    var opened = null;
    try {
      opened = window.open(url, '_blank', 'noopener');
    } catch (err) {
      opened = null;
    }
    if (!opened) window.location.href = url;
    toast('Handing the ' + docWord().toLowerCase() + ' over to WhatsApp\u2026');
  }

  function copyFallback(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      var copied = document.execCommand('copy');
      document.body.removeChild(area);
      return !!copied;
    } catch (err) {
      return false;
    }
  }

  function copySummary() {
    var text = buildShareText({ bold: false });
    function report(ok) {
      toast(ok ? docWord() + ' summary copied \u2014 paste it anywhere.' : 'Copying is blocked in this browser \u2014 select the preview text manually.', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { report(true); }, function () { report(copyFallback(text)); });
    } else {
      report(copyFallback(text));
    }
  }

  /* ------------------------------------------------------------------- pdf -- */

  function pdfFileName() {
    var parts = [docWord(), oneLine(state.meta.number), oneLine(state.billTo.name)]
      .filter(function (part) { return part !== ''; });
    return sanitizeFileName(parts.join('-')) + '.pdf';
  }

  /**
   * The on-screen preview may be narrower than A4 on small screens, so the PDF
   * is always rendered from an off-screen clone at full A4 content width.
   */
  function buildPdfSource() {
    var stage = document.getElementById('pdf-stage');
    if (!stage || !els.invoice) return null;
    stage.innerHTML = '';
    var node = els.invoice.cloneNode(true);
    node.removeAttribute('id');
    node.removeAttribute('aria-live');
    stage.appendChild(node);
    return { stage: stage, node: node };
  }

  function releasePdfSource(source) {
    if (source && source.stage) source.stage.innerHTML = '';
  }

  function pdfOptions() {
    return {
      margin: 14, /* pt — keeps continuation pages off the paper edge */
      filename: pdfFileName(),
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 3,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: PDF_WIDTH,
        scrollX: 0,
        scrollY: 0
      },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait', compress: true },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.inv-totals', '.inv-notes', '.inv-foot', '.inv-party'] }
    };
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) button.setAttribute('disabled', 'disabled');
    else button.removeAttribute('disabled');
  }

  /** Last-resort export: the browser's own print-to-PDF dialog. */
  function printInvoice() {
    try {
      window.print();
    } catch (err) {
      toast('Printing is not available in this browser.', true);
    }
  }

  function downloadPdf() {
    var source = buildPdfSource();
    if (!source) { printInvoice(); return; }

    if (typeof window.html2pdf !== 'function') {
      releasePdfSource(source);
      toast('The PDF engine could not load (offline?). Opening the print dialog \u2014 choose "Save as PDF".', true);
      printInvoice();
      return;
    }

    setBusy(els.btnPdf, true);
    toast('Building your PDF\u2026');
    Promise.resolve()
      .then(function () {
        return window.html2pdf().set(pdfOptions()).from(source.node).save();
      })
      .then(function () {
        toast('PDF saved as ' + pdfFileName());
      })
      .catch(function (error) {
        if (window.console && window.console.error) window.console.error(error);
        toast('The PDF could not be generated \u2014 opening the print dialog so you can save it manually.', true);
        printInvoice();
      })
      .then(function () {
        releasePdfSource(source);
        setBusy(els.btnPdf, false);
      });
  }

  function saveBlob(blob, fileName) {
    try {
      var url = window.URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 4000);
    } catch (err) {
      printInvoice();
    }
  }

  /** True when this browser can hand a real PDF file to the system share sheet. */
  function supportsFileShare() {
    try {
      if (!navigator.canShare || typeof window.File !== 'function' || typeof window.Blob !== 'function') return false;
      var probe = new window.File([new window.Blob(['probe'], { type: 'text/plain' })], 'probe.txt', { type: 'text/plain' });
      return !!navigator.canShare({ files: [probe] });
    } catch (err) {
      return false;
    }
  }

  /** Shares the finished PDF itself (WhatsApp, Mail, AirDrop …) where supported. */
  function sharePdfFile() {
    var source = buildPdfSource();
    if (!source) return;

    if (typeof window.html2pdf !== 'function') {
      releasePdfSource(source);
      toast('Sharing a PDF file needs the PDF engine, which did not load here. Use "Download PDF" instead.', true);
      return;
    }

    var fileName = pdfFileName();
    setBusy(els.btnShare, true);
    toast('Preparing the PDF to share\u2026');
    Promise.resolve()
      .then(function () {
        return window.html2pdf().set(pdfOptions()).from(source.node).outputPdf('blob');
      })
      .then(function (blob) {
        var file = new window.File([blob], fileName, { type: 'application/pdf' });
        if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
          saveBlob(blob, fileName);
          toast('This device cannot share files from a browser, so the PDF was downloaded instead.');
          return null;
        }
        return navigator.share({
          files: [file],
          title: docWord() + ' ' + (oneLine(state.meta.number) || ''),
          text: docWord() + ' from ' + (oneLine(state.hotel.name) || DEFAULT_HOTEL.name)
        }).then(function () {
          toast(docWord() + ' PDF shared.');
        }, function (error) {
          if (error && error.name === 'AbortError') return;
          saveBlob(blob, fileName);
          toast('Sharing was cancelled \u2014 the PDF was downloaded instead.', true);
        });
      })
      .catch(function (error) {
        if (window.console && window.console.error) window.console.error(error);
        toast('Could not prepare the PDF for sharing \u2014 try "Download PDF" instead.', true);
      })
      .then(function () {
        releasePdfSource(source);
        setBusy(els.btnShare, false);
      });
  }

  /* ---------------------------------------------------------------- events -- */

  function on(element, handler) {
    if (element) element.addEventListener('click', handler);
  }

  function onFieldChange(event) {
    var field = event.target;
    var path = field.getAttribute('data-path');
    if (!path) return;
    var previousStatus = path === 'meta.docType' ? String(state.meta.status) : null;
    setPath(state, path, field.value);
    if (path === 'meta.docType') {
      normaliseDocType();
      onDocTypeChange(previousStatus);
      return;
    }
    if (path === 'hotel.branch' && event.type === 'change') {
      /* Picking a branch on `change` pre-fills its saved street / city
         profile and keeps any edited details on this device for next time. */
      var matched = applyBranchProfile(field.value);
      /* Refresh the stored profiles only when a saved profile matched, so
         the previous branch's address is never remembered under the new
         branch's name. */
      if (matched) rememberBranch();
      branchDetailsDirty = false;
      syncForm();
      render();
      if (matched) toast('Branch details applied from the saved profile.');
      return;
    }
    if (path === 'hotel.address' || path === 'hotel.city' ||
        path === 'hotel.phone' || path === 'hotel.email' || path === 'hotel.website') {
      branchDetailsDirty = true;
      if (event.type === 'change') rememberBranch();
    }
    if (path === 'hotel.staff' && event.type === 'change') {
      rememberStaff(field.value);
      renderStaffOptions();
    }
    render();
  }

  function onItemInput(event) {
    var input = event.target;
    var row = input.closest ? input.closest('.item') : null;
    if (!row) return;
    var item = findItem(row.getAttribute('data-id'));
    if (!item) return;

    if (input.classList.contains('item__desc')) {
      item.description = input.value;
    } else if (input.classList.contains('item__qty')) {
      item.qty = Math.max(0, toNumber(input.value));
    } else if (input.classList.contains('item__price')) {
      item.price = Math.max(0, toNumber(input.value));
    } else if (input.classList.contains('item__checkin')) {
      var nextIn = cleanISODate(input.value);
      if (event.type === 'change' && nextIn && input.value !== nextIn) input.value = nextIn;
      item.checkin = nextIn;
      if (item.checkin && item.checkout) {
        var stay = nightsBetween(item.checkin, item.checkout);
        if (!isNaN(stay) && stay > 0) item.qty = stay;
      }
    } else if (input.classList.contains('item__checkout')) {
      var nextOut = cleanISODate(input.value);
      if (event.type === 'change' && nextOut && input.value !== nextOut) input.value = nextOut;
      item.checkout = nextOut;
      if (item.checkin && item.checkout) {
        var nights = nightsBetween(item.checkin, item.checkout);
        if (!isNaN(nights) && nights > 0) item.qty = nights;
      }
    } else {
      return;
    }

    syncItemRow(row, item);
    render();
  }

  function onItemsClick(event) {
    var button = event.target.closest ? event.target.closest('.item__remove') : null;
    if (!button) return;
    var row = button.closest('.item');
    if (!row) return;
    removeItem(row.getAttribute('data-id'));
    if (state.items.length === 0) toast('All line items removed \u2014 add one to start billing again.');
  }

  function onItemsKeydown(event) {
    if (event.key !== 'Enter') return;
    var input = event.target;
    var row = input.closest ? input.closest('.item') : null;
    if (!row || !els.items) return;

    if (input.classList.contains('item__desc')) {
      event.preventDefault();
      var qty = row.querySelector('.item__qty');
      if (qty) qty.focus();
      return;
    }
    if (input.classList.contains('item__qty')) {
      event.preventDefault();
      var price = row.querySelector('.item__price');
      if (price) price.focus();
      return;
    }
    if (input.classList.contains('item__price')) {
      event.preventDefault();
      var rows = els.items.querySelectorAll('.item');
      if (rows.length > 0 && rows[rows.length - 1] === row) {
        addItem({});
      } else {
        var index = -1;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] === row) index = i;
        }
        var next = rows[index + 1];
        var nextDesc = next && next.querySelector('.item__desc');
        if (nextDesc) nextDesc.focus();
      }
    }
  }

  function onShortcut(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (String(event.key).toLowerCase() !== 's') return;
    event.preventDefault();
    downloadPdf();
  }

  function cacheElements() {
    els.form = document.getElementById('editor');
    els.items = document.getElementById('items');
    els.invoice = document.getElementById('invoice');
    els.itemCount = document.getElementById('item-count');
    els.toolbarHint = document.getElementById('toolbar-hint');
    els.toast = document.getElementById('toast');
    els.currencyField = document.getElementById('field-currency');
    els.btnAddItem = document.getElementById('btn-add-item');
    els.btnPdf = document.getElementById('btn-pdf');
    els.btnEmail = document.getElementById('btn-email');
    els.btnWhatsApp = document.getElementById('btn-whatsapp');
    els.btnShare = document.getElementById('btn-share');
    els.btnPrint = document.getElementById('btn-print');
    els.btnCopy = document.getElementById('btn-copy');
    els.btnNew = document.getElementById('btn-new');
    els.btnRestoreHotel = document.getElementById('btn-restore-hotel');
    els.btnNextNumber = document.getElementById('btn-next-number');
    els.roomCategory = document.getElementById('room-category');
    els.roomName = document.getElementById('room-name');
    els.roomCheckin = document.getElementById('room-checkin');
    els.roomCheckout = document.getElementById('room-checkout');
    els.roomNights = document.getElementById('room-nights');
    els.roomRate = document.getElementById('room-rate');
    els.roomTotal = document.getElementById('room-total');
    els.roomHint = document.getElementById('room-hint');
    els.rateCurrency = document.getElementById('rate-currency');
    els.rateCard = document.getElementById('rate-card');
    els.btnAddRoom = document.getElementById('btn-add-room');
    els.btnSaveHistory = document.getElementById('btn-save-history');
    els.btnHistoryClear = document.getElementById('btn-history-clear');
    els.historyCount = document.getElementById('history-count');
    els.historyList = document.getElementById('history-list');
  }

  function fillCurrencyOptions() {
    if (!els.currencyField) return;
    els.currencyField.innerHTML = CURRENCIES.map(function (entry) {
      return '<option value="' + escapeHtml(entry.code) + '">' + escapeHtml(entry.label) + '</option>';
    }).join('');
  }

  function bindEvents() {
    if (els.form) {
      els.form.addEventListener('submit', function (event) { event.preventDefault(); });
      var fields = els.form.querySelectorAll('[data-path]');
      for (var i = 0; i < fields.length; i++) {
        fields[i].addEventListener('input', onFieldChange);
        fields[i].addEventListener('change', onFieldChange);
      }
    }

    if (els.items) {
      els.items.addEventListener('input', onItemInput);
      els.items.addEventListener('change', onItemInput);
      els.items.addEventListener('click', onItemsClick);
      els.items.addEventListener('keydown', onItemsKeydown);
    }

    on(els.btnAddItem, function () { addItem({}); });
    on(els.btnPdf, downloadPdf);
    on(els.btnEmail, openEmail);
    on(els.btnWhatsApp, openWhatsApp);
    on(els.btnShare, sharePdfFile);
    on(els.btnPrint, printInvoice);
    on(els.btnCopy, copySummary);
    on(els.btnNew, startNewInvoice);
    on(els.btnRestoreHotel, restoreHotelDefaults);
    on(els.btnSaveHistory, function () { saveToHistory(); });
    on(els.btnHistoryClear, clearHistory);
    if (els.historyList) els.historyList.addEventListener('click', onHistoryClick);
    on(els.btnNextNumber, function () {
      state.meta.number = nextInvoiceNumber();
      syncForm();
      render();
      toast(docWord() + ' number set to ' + state.meta.number + '.');
    });

    if (els.roomCategory) els.roomCategory.addEventListener('change', fillRoomNames);
    if (els.roomName) els.roomName.addEventListener('change', syncRateFromRoom);
    if (els.roomCheckin) {
      els.roomCheckin.addEventListener('input', function () { syncRoomDates('checkin'); renderRoomPicker(); });
      els.roomCheckin.addEventListener('change', function () { syncRoomDates('checkin'); renderRoomPicker(); });
    }
    if (els.roomCheckout) {
      els.roomCheckout.addEventListener('input', function () { syncRoomDates('checkout'); renderRoomPicker(); });
      els.roomCheckout.addEventListener('change', function () { syncRoomDates('checkout'); renderRoomPicker(); });
    }
    if (els.roomNights) els.roomNights.addEventListener('input', renderRoomPicker);
    if (els.roomRate) els.roomRate.addEventListener('input', renderRoomPicker);
    on(els.btnAddRoom, addRoomToInvoice);

    document.addEventListener('keydown', onShortcut);
  }

  function init() {
    cacheElements();
    fillCurrencyOptions();
    fillRoomCategories();
    fillServiceOptions();
    setupStateFromDraft();
    fillBranchOptions();
    syncForm();
    renderStaffOptions();
    renderItemRows();
    bindEvents();
    render();
    renderHistory();
    if (els.btnShare && supportsFileShare()) els.btnShare.removeAttribute('hidden');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Small read-only API: handy in the console, and used by the smoke test. */
  window.CocoonInvoice = {
    state: state,
    rooms: ROOMS,
    isReceipt: isReceipt,
    docWord: docWord,
    roomCategories: roomCategories,
    roomLabel: roomLabel,
    addRoomToInvoice: addRoomToInvoice,
    toNumber: toNumber,
    computeTotals: computeTotals,
    currentTotals: function () { return computeTotals(state.items, state.meta); },
    formatMoney: formatMoney,
    numberToWords: numberToWords,
    amountInWords: function (currency) {
      return amountInWords(computeTotals(state.items, state.meta).totalCents, currency || state.meta.currency);
    },
    buildShareText: buildShareText,
    emailUrl: emailUrl,
    whatsappUrl: whatsappUrl,
    pdfFileName: pdfFileName,
    phoneDigits: phoneDigits,
    nightsBetween: nightsBetween,
    staySuffix: staySuffix,
    branchOptions: branchOptions,
    staffOptions: staffOptions,
    applyBranchProfile: applyBranchProfile,
    addItem: addItem,
    removeItem: removeItem,
    render: render,
    renderItemRows: renderItemRows,
    startNewInvoice: startNewInvoice,
    readHistory: readHistory,
    saveToHistory: saveToHistory,
    openHistoryEntry: openHistoryEntry
  };
})();
