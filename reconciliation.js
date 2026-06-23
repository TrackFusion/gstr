/* ============================================================
   reconciliation.js — RECONCILIATION ENGINE
   Matches Purchase Invoices (books) against GSTR-2B records
   the user has entered for practice. Pure function logic —
   operates only on whatever data exists for the selected period.
   ============================================================ */

const Recon = (() => {

  const TOLERANCE = 1; // ₹1 tolerance for "matched" classification

  /**
   * @param {Array} purchaseInvoices - rows from PurchaseInvoices sheet for the period
   * @param {Array} gstr2bRecords - rows from GSTR2BData sheet for the period
   * @returns {{matched, mismatch, missingIn2B, missingInBooks, summary}}
   */
  function reconcile(purchaseInvoices, gstr2bRecords) {
    const matched = [];
    const mismatch = [];
    const missingIn2B = [];   // in books, not in 2B
    const missingInBooks = []; // in 2B, not in books

    const used2B = new Set();

    purchaseInvoices.forEach(book => {
      const candidate = gstr2bRecords.find(g =>
        !used2B.has(g.id) &&
        normalizeGSTIN(g.vendorGSTIN) === normalizeGSTIN(book.vendorGSTIN) &&
        normalizeInvoiceNo(g.invoiceNumber) === normalizeInvoiceNo(book.invoiceNumber)
      );

      if (!candidate) {
        missingIn2B.push({ book, reason: 'Vendor has not filed/uploaded this invoice in their GSTR-1' });
        return;
      }

      used2B.add(candidate.id);

      const taxableDiff = Math.abs((parseFloat(book.taxableValue) || 0) - (parseFloat(candidate.taxableValue) || 0));
      const cgstDiff = Math.abs((parseFloat(book.cgst) || 0) - (parseFloat(candidate.cgst) || 0));
      const sgstDiff = Math.abs((parseFloat(book.sgst) || 0) - (parseFloat(candidate.sgst) || 0));
      const igstDiff = Math.abs((parseFloat(book.igst) || 0) - (parseFloat(candidate.igst) || 0));

      const isMatch = taxableDiff <= TOLERANCE && cgstDiff <= TOLERANCE && sgstDiff <= TOLERANCE && igstDiff <= TOLERANCE;

      if (isMatch) {
        matched.push({ book, twoB: candidate });
      } else {
        mismatch.push({
          book, twoB: candidate,
          diffs: { taxableValue: round2(taxableDiff), cgst: round2(cgstDiff), sgst: round2(sgstDiff), igst: round2(igstDiff) },
        });
      }
    });

    gstr2bRecords.forEach(g => {
      if (!used2B.has(g.id)) {
        missingInBooks.push({ twoB: g, reason: 'Appears in GSTR-2B but no matching purchase entry recorded in books' });
      }
    });

    const eligibleITC = matched.reduce((sum, m) => {
      return sum + (parseFloat(m.book.cgst) || 0) + (parseFloat(m.book.sgst) || 0) + (parseFloat(m.book.igst) || 0);
    }, 0);

    const atRiskITC = missingIn2B.reduce((sum, m) => {
      return sum + (parseFloat(m.book.cgst) || 0) + (parseFloat(m.book.sgst) || 0) + (parseFloat(m.book.igst) || 0);
    }, 0);

    const disputedITC = mismatch.reduce((sum, m) => {
      return sum + (parseFloat(m.book.cgst) || 0) + (parseFloat(m.book.sgst) || 0) + (parseFloat(m.book.igst) || 0);
    }, 0);

    return {
      matched, mismatch, missingIn2B, missingInBooks,
      summary: {
        totalBooks: purchaseInvoices.length,
        total2B: gstr2bRecords.length,
        matchedCount: matched.length,
        mismatchCount: mismatch.length,
        missingIn2BCount: missingIn2B.length,
        missingInBooksCount: missingInBooks.length,
        eligibleITC: round2(eligibleITC),
        atRiskITC: round2(atRiskITC),
        disputedITC: round2(disputedITC),
      },
    };
  }

  /** Detect duplicate invoices within the same array (same vendor GSTIN + invoice number). */
  function detectDuplicates(invoices) {
    const seen = new Map();
    const duplicates = [];
    invoices.forEach(inv => {
      const key = normalizeGSTIN(inv.vendorGSTIN || inv.buyerGSTIN) + '::' + normalizeInvoiceNo(inv.invoiceNumber);
      if (seen.has(key)) {
        duplicates.push({ original: seen.get(key), duplicate: inv });
      } else {
        seen.set(key, inv);
      }
    });
    return duplicates;
  }

  /** Check whether an ITC line is blocked under Section 17(5)-style category flags set by the user. */
  function classifyITCEligibility(invoiceRow) {
    if (invoiceRow.isBlockedCredit) {
      return { status: 'blocked', reason: invoiceRow.blockedReason || 'Marked as blocked credit (Section 17(5))' };
    }
    if (invoiceRow.itcMatchStatus === 'missing') {
      return { status: 'blocked', reason: 'Not appearing in GSTR-2B — ineligible under Rule 36(4) until matched' };
    }
    if (invoiceRow.itcMatchStatus === 'mismatch') {
      return { status: 'partial', reason: 'Value mismatch with GSTR-2B — resolve with vendor before claiming full ITC' };
    }
    return { status: 'eligible', reason: 'Matched with GSTR-2B' };
  }

  function normalizeGSTIN(g) { return (g || '').toString().trim().toUpperCase(); }
  function normalizeInvoiceNo(n) { return (n || '').toString().trim().toUpperCase().replace(/\s+/g, ''); }
  function round2(n) { return Math.round((parseFloat(n) || 0) * 100) / 100; }

  return { reconcile, detectDuplicates, classifyITCEligibility };
})();
