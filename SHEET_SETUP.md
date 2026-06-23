# GST Practice Portal — Google Sheet Column Reference

All sheets are auto-created by running `setupSheets()` in the Apps Script editor.
This document describes every column in every sheet for reference.

---

## Users
| Column        | Type   | Notes                                    |
|---------------|--------|------------------------------------------|
| id            | String | Auto-generated unique ID                 |
| firstName     | String |                                          |
| lastName      | String |                                          |
| email         | String | Must be unique                           |
| username      | String | Must be unique, used for login           |
| passwordHash  | String | Simple hash (see auth.js)                |
| role          | String | `user` or `admin`                        |
| status        | String | `active` or `disabled`                  |
| createdAt     | String | ISO timestamp                            |
| updatedAt     | String | ISO timestamp                            |

---

## TaxpayerProfiles
| Column          | Type   | Notes                                      |
|-----------------|--------|--------------------------------------------|
| id              | String | Auto-generated                             |
| userId          | String | FK → Users.id                              |
| gstin           | String | 15-char practice GSTIN                     |
| legalName       | String | As per practice registration               |
| tradeName       | String | Optional trade name                        |
| regType         | String | `regular`, `composition`, `casual`, `nri`  |
| state           | String | Auto-filled from GSTIN state code          |
| address         | String | Registered address                         |
| industry        | String | Business type (e.g., Manufacturing, EPC)  |
| turnoverBracket | String | `below_1.5cr`, `1.5cr_5cr`, `above_5cr`   |
| createdAt       | String | ISO timestamp                              |
| updatedAt       | String | ISO timestamp                              |

---

## SalesInvoices
| Column       | Type    | Notes                                       |
|--------------|---------|---------------------------------------------|
| id           | String  | Auto-generated                              |
| taxpayerId   | String  | FK → TaxpayerProfiles.id                    |
| period       | String  | Format: `YYYY-MM` (e.g., `2025-06`)         |
| invoiceNumber| String  | User-entered                                |
| invoiceDate  | String  | ISO date                                    |
| buyerName    | String  | Buyer legal/trade name                      |
| buyerGSTIN   | String  | Blank = B2C (unregistered buyer)            |
| hsnCode      | String  | HSN/SAC code                                |
| description  | String  | Goods/service description                   |
| supplyType   | String  | `intra` or `inter`                          |
| taxableValue | Number  | Base taxable amount                         |
| gstRate      | Number  | GST rate % (0, 5, 12, 18, 28)               |
| cgst         | Number  | Computed by calc engine                     |
| sgst         | Number  | Computed by calc engine                     |
| igst         | Number  | Computed by calc engine                     |
| cess         | Number  | Cess amount (if applicable)                 |
| invoiceTotal | Number  | taxableValue + all taxes                    |
| createdAt    | String  | ISO timestamp                               |
| updatedAt    | String  | ISO timestamp                               |

---

## PurchaseInvoices
| Column          | Type    | Notes                                            |
|-----------------|---------|--------------------------------------------------|
| id              | String  | Auto-generated                                   |
| taxpayerId      | String  | FK → TaxpayerProfiles.id                         |
| period          | String  | Format: `YYYY-MM`                                |
| invoiceNumber   | String  | MUST match GSTR-2B record for reconciliation     |
| invoiceDate     | String  | ISO date                                         |
| vendorName      | String  | Vendor/supplier name                             |
| vendorGSTIN     | String  | MUST match GSTR-2B record; blank = unregistered  |
| category        | String  | Expense category (Goods, Freight, Labour, etc.)  |
| supplyType      | String  | `intra` or `inter`                               |
| taxableValue    | Number  |                                                  |
| gstRate         | Number  |                                                  |
| cgst            | Number  |                                                  |
| sgst            | Number  |                                                  |
| igst            | Number  |                                                  |
| cess            | Number  |                                                  |
| invoiceTotal    | Number  |                                                  |
| isRCM           | Boolean | TRUE = Reverse Charge applies                    |
| isBlockedCredit | Boolean | TRUE = blocked under Sec 17(5)                   |
| blockedReason   | String  | Reason for blocking (e.g., personal vehicle)     |
| itcMatchStatus  | String  | `pending`, `matched`, `mismatch`, `missing`      |
| createdAt       | String  |                                                  |
| updatedAt       | String  |                                                  |

---

## GSTR2BData (and GSTR2AData — same structure)
| Column        | Type   | Notes                                         |
|---------------|--------|-----------------------------------------------|
| id            | String | Auto-generated                                |
| taxpayerId    | String | FK → TaxpayerProfiles.id                      |
| period        | String | Format: `YYYY-MM`                             |
| vendorName    | String | Must match PurchaseInvoices.vendorName        |
| vendorGSTIN   | String | Must match PurchaseInvoices.vendorGSTIN       |
| invoiceNumber | String | Must match PurchaseInvoices.invoiceNumber     |
| invoiceDate   | String | ISO date                                      |
| taxableValue  | Number |                                               |
| gstRate       | Number |                                               |
| cgst          | Number |                                               |
| sgst          | Number |                                               |
| igst          | Number |                                               |
| vendorFilingStatus | String | `filed` or `pending` (2A only)          |
| createdAt     | String |                                               |
| updatedAt     | String |                                               |

> **Reconciliation key:** vendorGSTIN + invoiceNumber must match exactly
> between PurchaseInvoices and GSTR2BData for a record to be "Matched".

---

## FilingHistory
| Column      | Type   | Notes                                     |
|-------------|--------|-------------------------------------------|
| id          | String | Auto-generated                            |
| taxpayerId  | String |                                           |
| period      | String | `YYYY-MM`                                 |
| returnType  | String | `GSTR-1`, `GSTR-3B`, `GSTR-9`, etc.      |
| status      | String | `draft`, `filed`                          |
| filedOn     | String | ISO timestamp of simulated filing         |
| arn         | String | Simulated ARN (practice reference number) |
| createdAt   | String |                                           |
| updatedAt   | String |                                           |

---

## Periods
| Column    | Type   | Notes                          |
|-----------|--------|--------------------------------|
| id        | String | Auto-generated                 |
| userId    | String | FK → Users.id                  |
| value     | String | Format: `YYYY-MM` (e.g. 2025-06)|
| createdAt | String |                                |
| updatedAt | String |                                |

---

## AuditLogs
| Column      | Type   | Notes                            |
|-------------|--------|----------------------------------|
| id          | String | Auto-generated                   |
| action      | String | Action code (e.g. USER_LOGIN)    |
| description | String | Human-readable description       |
| userId      | String | FK → Users.id                    |
| timestamp   | String | ISO timestamp                    |

---

## Settings
| Column    | Type   | Notes                          |
|-----------|--------|--------------------------------|
| id        | String | Auto-generated                 |
| key       | String | Setting key                    |
| value     | String | Setting value                  |
| createdAt | String |                                |
| updatedAt | String |                                |

### Default Settings Keys
| Key              | Description                    |
|------------------|--------------------------------|
| portal_name      | Display name of the portal     |
| default_fy       | Default financial year         |
| admin_access_code| Code for admin registration    |

---

## Reconciliation Key — How Matching Works

The reconciliation engine (`reconciliation.js`) matches:

```
PurchaseInvoices.vendorGSTIN  ==  GSTR2BData.vendorGSTIN
PurchaseInvoices.invoiceNumber == GSTR2BData.invoiceNumber
```

Both comparisons are **case-insensitive** and **whitespace-trimmed**.

**Result categories:**
- **Matched** — Both GSTIN + invoice number found, values within ₹1 tolerance
- **Mismatch** — Found but taxable value / tax differs by more than ₹1
- **Missing in 2B** — In PurchaseInvoices but not in GSTR2BData (vendor hasn't filed)
- **Missing in Books** — In GSTR2BData but not in PurchaseInvoices (not yet booked)
