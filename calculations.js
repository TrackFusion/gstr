/* ============================================================
   calculations.js — GST CALCULATION ENGINE
   All tax math is derived live from entered invoice data.
   Nothing here is a fixed/hardcoded GST figure — rates and
   amounts always come from what the user typed into a form.
   ============================================================ */

const GSTCalc = (() => {

  /**
   * Compute tax split for a single line/invoice.
   * @param {number} taxableValue
   * @param {number} gstRate - total GST % (e.g. 18 means 18% total)
   * @param {'intra'|'inter'} supplyType
   * @param {number} cessRate - optional cess % (default 0)
   */
  function computeTax(taxableValue, gstRate, supplyType, cessRate = 0) {
    const tv = parseFloat(taxableValue) || 0;
    const rate = parseFloat(gstRate) || 0;
    const cess = parseFloat(cessRate) || 0;

    let cgst = 0, sgst = 0, igst = 0;
    if (supplyType === 'inter') {
      igst = round2(tv * rate / 100);
    } else {
      cgst = round2(tv * rate / 200);
      sgst = round2(tv * rate / 200);
    }
    const cessAmt = round2(tv * cess / 100);
    const totalTax = round2(cgst + sgst + igst + cessAmt);
    const invoiceTotal = round2(tv + totalTax);

    return { taxableValue: tv, cgst, sgst, igst, cess: cessAmt, totalTax, invoiceTotal };
  }

  /** Reverse-calculate taxable value from an invoice total (inclusive of tax). */
  function computeTaxFromInclusive(invoiceTotal, gstRate, supplyType, cessRate = 0) {
    const total = parseFloat(invoiceTotal) || 0;
    const rate = parseFloat(gstRate) || 0;
    const cess = parseFloat(cessRate) || 0;
    const divisor = 1 + (rate + cess) / 100;
    const taxableValue = round2(total / divisor);
    return computeTax(taxableValue, gstRate, supplyType, cessRate);
  }

  function round2(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
  }

  /** Sum an array of {cgst, sgst, igst, cess, taxableValue} objects. */
  function aggregate(rows) {
    return rows.reduce((acc, r) => {
      acc.taxableValue += parseFloat(r.taxableValue) || 0;
      acc.cgst += parseFloat(r.cgst) || 0;
      acc.sgst += parseFloat(r.sgst) || 0;
      acc.igst += parseFloat(r.igst) || 0;
      acc.cess += parseFloat(r.cess) || 0;
      return acc;
    }, { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 });
  }

  /**
   * ITC utilization order per CGST Act:
   * IGST credit -> first IGST liability, then CGST, then SGST.
   * CGST credit -> CGST liability only (then IGST if CGST credit remains, per current rules CGST can also offset IGST).
   * SGST credit -> SGST liability only (then IGST).
   * CGST credit can NEVER be used against SGST liability and vice versa.
   */
  function computeNetLiability(liability, itcAvailable) {
    let { cgst: liabCgst = 0, sgst: liabSgst = 0, igst: liabIgst = 0, cess: liabCess = 0 } = liability;
    let { cgst: itcCgst = 0, sgst: itcSgst = 0, igst: itcIgst = 0, cess: itcCess = 0 } = itcAvailable;

    const ledger = []; // utilization trail for transparency in UI

    // Step 1: IGST credit offsets IGST liability first
    let useIgstForIgst = Math.min(itcIgst, liabIgst);
    liabIgst -= useIgstForIgst; itcIgst -= useIgstForIgst;
    ledger.push({ from: 'IGST', to: 'IGST', amount: round2(useIgstForIgst) });

    // Step 2: Remaining IGST credit offsets CGST liability
    let useIgstForCgst = Math.min(itcIgst, liabCgst);
    liabCgst -= useIgstForCgst; itcIgst -= useIgstForCgst;
    ledger.push({ from: 'IGST', to: 'CGST', amount: round2(useIgstForCgst) });

    // Step 3: Remaining IGST credit offsets SGST liability
    let useIgstForSgst = Math.min(itcIgst, liabSgst);
    liabSgst -= useIgstForSgst; itcIgst -= useIgstForSgst;
    ledger.push({ from: 'IGST', to: 'SGST', amount: round2(useIgstForSgst) });

    // Step 4: CGST credit offsets CGST liability
    let useCgstForCgst = Math.min(itcCgst, liabCgst);
    liabCgst -= useCgstForCgst; itcCgst -= useCgstForCgst;
    ledger.push({ from: 'CGST', to: 'CGST', amount: round2(useCgstForCgst) });

    // Step 5: Remaining CGST credit can offset IGST liability
    let useCgstForIgst = Math.min(itcCgst, liabIgst);
    liabIgst -= useCgstForIgst; itcCgst -= useCgstForIgst;
    ledger.push({ from: 'CGST', to: 'IGST', amount: round2(useCgstForIgst) });

    // Step 6: SGST credit offsets SGST liability
    let useSgstForSgst = Math.min(itcSgst, liabSgst);
    liabSgst -= useSgstForSgst; itcSgst -= useSgstForSgst;
    ledger.push({ from: 'SGST', to: 'SGST', amount: round2(useSgstForSgst) });

    // Step 7: Remaining SGST credit can offset IGST liability
    let useSgstForIgst = Math.min(itcSgst, liabIgst);
    liabIgst -= useSgstForIgst; itcSgst -= useSgstForIgst;
    ledger.push({ from: 'SGST', to: 'IGST', amount: round2(useSgstForIgst) });

    // Cess: only cess credit can offset cess liability
    let useCessForCess = Math.min(itcCess, liabCess);
    liabCess -= useCessForCess; itcCess -= useCessForCess;
    ledger.push({ from: 'CESS', to: 'CESS', amount: round2(useCessForCess) });

    return {
      cashPayable: {
        cgst: round2(Math.max(liabCgst, 0)),
        sgst: round2(Math.max(liabSgst, 0)),
        igst: round2(Math.max(liabIgst, 0)),
        cess: round2(Math.max(liabCess, 0)),
      },
      itcRemaining: {
        cgst: round2(Math.max(itcCgst, 0)),
        sgst: round2(Math.max(itcSgst, 0)),
        igst: round2(Math.max(itcIgst, 0)),
        cess: round2(Math.max(itcCess, 0)),
      },
      utilizationLedger: ledger.filter(l => l.amount > 0),
    };
  }

  /** Simple interest calculation for late payment (illustrative, 18% p.a. standard rate). */
  function computeLateInterest(taxAmount, daysLate, annualRatePct = 18) {
    const amt = parseFloat(taxAmount) || 0;
    const days = parseFloat(daysLate) || 0;
    if (amt <= 0 || days <= 0) return 0;
    return round2((amt * annualRatePct * days) / (100 * 365));
  }

  return { computeTax, computeTaxFromInclusive, aggregate, computeNetLiability, computeLateInterest, round2 };
})();
