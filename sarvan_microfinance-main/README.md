This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Foreclosure Collection (Maker–Checker)

The foreclosure collection flow uses a maker–checker workflow:

- **Maker (BM)**: submits a foreclosure collection, creating a pending request + pending transaction.
- **Checker (AM)**: reviews requests in `dashboard/collections/foreclosure-approval` and **approves/rejects**.
- **On approve**: schedules are settled and the loan is closed (foreclosed) atomically.
- **On reject**: the loan remains active; the request/transaction are marked rejected.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.




# Sarvam Charitable Trust — Complete System Process Documentation

**Version:** 1.0 | **Date:** May 2026 | **Audience:** Staff, Management, Customers

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Roles & Responsibilities](#2-roles--responsibilities)
3. [Customer Onboarding & Client Lifecycle](#3-customer-onboarding--client-lifecycle)
4. [Loan Process](#4-loan-process)
5. [Loan Disbursement Approval Flow](#5-loan-disbursement-approval-flow)
6. [Gold Loan Process](#6-gold-loan-process)
7. [Repayment & Collection Flow](#7-repayment--collection-flow)
8. [Reports Module](#8-reports-module)
9. [Role-Based Access Control](#9-role-based-access-control)
10. [End-to-End Project Flow](#10-end-to-end-project-flow)
11. [Glossary](#11-glossary)

---

## 1. System Overview

Sarvam Charitable Trust is a fully digital loan management platform that handles the complete lifecycle of microfinance operations — from customer onboarding and KYC verification to loan disbursement, repayment collection, and financial reporting.

The system is organized around **Branches**, **Centers**, and **Groups** — following the standard microfinance group-lending model. Every financial action is tracked, audited, and approved through a multi-level hierarchy to ensure accuracy, compliance, and accountability.

**Core Modules:**

| Module | Purpose |
|--------|---------|
| Client Management | Onboard customers, collect KYC, manage approvals |
| Loan Management | Create loan applications, track status, manage products |
| Disbursement | Control multi-level cash release to approved clients |
| Gold Loan | Specialized gold-collateral loan with valuation tracking |
| Collections | Record and approve repayment installments |
| Accounting | General ledger, vouchers, financial transactions |
| Reports | Over 50 reports across demand, portfolio, accounting, and MIS |
| Payroll & Attendance | Employee leave, salary, and attendance management |

---

## 2. Roles & Responsibilities

The system has four distinct roles, each with specific authorities and access levels.

### Role Hierarchy

```
ADMIN (Highest Authority)
    └── AREA MANAGER (AM)
            └── BRANCH MANAGER (BM)
                    └── FDO - Field Development Officer
```

### Role Descriptions

#### FDO — Field Development Officer
The FDO is the frontline staff who works directly with customers in the field.

**Primary Responsibilities:**
- Enroll new clients and collect KYC documents
- Create loan applications on behalf of clients
- Record daily attendance at center meetings
- Submit collection receipts for customer repayments
- Resubmit client applications when documents are returned for correction

#### BM — Branch Manager
The BM oversees all operations within a single branch.

**Primary Responsibilities:**
- Review and approve client KYC submitted by FDOs
- Verify loan applications before disbursement indexing
- Create loan indexes for batch disbursement
- Perform final cash disbursement to clients (BM Disburse)
- Approve repayment collections submitted by FDOs
- Create financial vouchers (cash receipts, payments, journal entries)
- Manage center operations and staff attendance
- Trigger End-of-Day (EOD) process to advance the working date
- Initiate gold return transactions

#### AM — Area Manager
The AM supervises multiple branches (up to 4) under their area.

**Primary Responsibilities:**
- Review and approve client KYC passed by BM
- Approve or reject loan disbursement batches (Level 2 approval)
- Approve or reject gold return requests
- Approve financial vouchers created by BMs
- Review MIS reports for their branches
- Monitor portfolio health across assigned branches
- Approve foreclosure requests

#### ADMIN — System Administrator / Head Office
The Admin has full access to all system functions across all branches.

**Primary Responsibilities:**
- Final approval of client KYC (PENDING_FINAL_REVIEW → APPROVED)
- Final approval of financial transactions (PENDING_ADMIN_APPROVAL → APPROVED)
- Manage master data (loan products, branches, users, account chart)
- Approve EOD catch-up when a branch is behind schedule
- View and export all reports across all branches
- Configure system settings and manage user accounts

### Custom Roles — "FDO Responsibilities" Toggle

Admins can create custom roles (e.g. *Senior FDO*, *Assistant Branch Manager*) at
**Admin → Role Management** (`/dashboard/admin/roles`). The Create/Edit Role modal
has an **FDO Responsibilities** toggle, styled like the **Sub Admin** toggle:

- When **on**, every user assigned this role can do everything a Field Development
  Officer does — client enrollment & KYC upload, loan application creation, and
  collections for their **own** centers. It clears the same gates as the built-in
  FDO (API `withRole`, sidebar menu visibility, page routing, feature permissions,
  own-center scoping) and the users show up in FDO task targets and
  center-assignment pickers.
- Under the hood the toggle writes `Role.legacyRole = 'FDO'`, which is resolved into
  `User.role` (and the JWT `role` claim) when the role is assigned to a user.
  Turning it back off restores the role's own auto-generated code.
- Page-level checkboxes (Manage Permissions) and role priority still apply on top —
  so *Senior FDO* can be given extra pages an ordinary FDO doesn't have.
- Toggling it re-syncs already-assigned users automatically; each user's existing
  session picks up the change on its next access-token refresh (up to 72h), or
  immediately on re-login.
- The toggle is hidden for the built-in system roles (`admin`, `area-manager`,
  `branch-manager`, `fdo`, `quality-checkers`, `division-manager`) — their base
  role is fixed.
- For someone who must do BM work *and* FDO field work, assign both roles — one
  role only ever maps to a single `User.role`.

---

## 3. Customer Onboarding & Client Lifecycle

Before a customer can receive a loan, they must complete a 4-stage verification process. This ensures compliance with KYC norms and reduces lending risk.

### Stage 1 — FDO Enrollment

The FDO visits the customer's location and collects the following:

**Personal Details:**
- Full name, date of birth, gender, marital status
- Father's / Spouse's name
- Occupation and monthly income
- Residential address

**KYC Documents Collected:**
- Identity proof (Aadhaar, PAN, Voter ID, Passport, Driving License)
- Address proof
- Photograph
- Bank account details

**Co-Applicant Details** (if applicable):
- A co-applicant can be linked to each client for additional security

After completing the form, the FDO submits the application — status changes to **SUBMITTED**.

---

### Stage 2 — Branch Manager (BM) Review

The BM receives the client file in their review queue.

**BM Actions:**
- Reviews all personal details and KYC documents
- Verifies document authenticity and completeness
- May request corrections from FDO if documents are incomplete

**BM Decision:**

| Action | Outcome | Next Status |
|--------|---------|-------------|
| Approve | Passes to AM review | PENDING_AM_REVIEW |
| Return for Correction | FDO must re-submit with corrections | BM_RETAKE_REQUIRED |
| Reject | Application permanently closed | REJECTED |

---

### Stage 3 — Area Manager (AM) Review

The AM reviews clients that the BM has approved.

**AM Actions:**
- Verifies BM's approval decisions
- Reviews KYC documents for area compliance
- May require additional clarifications

**AM Decision:**

| Action | Outcome | Next Status |
|--------|---------|-------------|
| Approve | Passes to final Admin review | PENDING_FINAL_REVIEW |
| Return for Correction | FDO must re-submit | AM_RETAKE_REQUIRED |
| Reject | Application permanently closed | REJECTED |

---

### Stage 4 — Admin Final Approval

The Admin performs the final review before activating the client.

**Admin Decision:**

| Action | Outcome | Next Status |
|--------|---------|-------------|
| Approve | Client is fully active, eligible for loans | **APPROVED** |
| Return for Correction | FDO must re-submit | FINAL_RETAKE_REQUIRED |
| Reject | Application permanently closed | REJECTED |

---

### Client Approval Status Flow

```
FDO Submits
     ↓
SUBMITTED
     ↓
PENDING_BM_REVIEW ──→ BM_RETAKE_REQUIRED ──→ (FDO resubmits) ──→ SUBMITTED
     ↓
PENDING_AM_REVIEW ──→ AM_RETAKE_REQUIRED ──→ (FDO resubmits) ──→ SUBMITTED
     ↓
PENDING_FINAL_REVIEW ──→ FINAL_RETAKE_REQUIRED ──→ (FDO resubmits) ──→ SUBMITTED
     ↓
  APPROVED ✓
```

> **Note:** At any stage, an application can be permanently REJECTED. Once APPROVED, the client is eligible to apply for loans.

---

### Organization Structure (Branch → Center → Group)

Clients are organized in a hierarchical structure:

```
Branch
  └── Center (Field collection unit; assigned FDO, meeting schedule)
        └── Group (Collection of 5–20 clients)
              └── Client (Individual borrower)
```

- A **Center** has a fixed meeting day and time for collection.
- A **Group** is the primary accountability unit — group members are jointly responsible.
- Each center is managed by an FDO who conducts meetings and collects repayments.

---

## 4. Loan Process

### 4.1 Loan Types & Products

Loans are configured through **Loan Products**, each defining the interest structure, fees, and repayment schedule.

**Interest Calculation Methods:**

| Method | Description |
|--------|-------------|
| FLAT Rate | Interest calculated on original principal throughout the tenure |
| REDUCING Balance | Interest calculated on outstanding principal (decreasing each period) |

**Repayment Frequencies:**

| Frequency | Description |
|-----------|-------------|
| Daily | Collected every working day |
| Weekly | Collected every week |
| ForthNight | Collected every two weeks |
| Monthly | Collected once per month |
| Quarterly | Collected every three months |

**Loan Product Parameters:**
- Loan amount range (minimum / maximum)
- Interest rate (%)
- Insurance fee
- Document charges
- Admission fee
- Number of installments (dues)
- Advance savings amount

**Loan Purposes (Examples):**
- Business / Trade
- Agriculture
- Education
- Health / Medical
- Housing / Construction
- Other (custom description)

---

### 4.2 Loan Application Creation

**Who creates:** FDO, Branch Manager, Area Manager, or Admin

**Pre-conditions:**
- Client must be in **APPROVED** status
- Client must be assigned to a Center

**Steps to Create a Loan Application:**

1. Select the approved client
2. Choose the loan product appropriate for the client's need
3. Enter the requested loan amount
4. Select repayment frequency
5. Select loan purpose
6. Set the proposed first due date
7. Submit the application

**Upon submission:**
- A unique **Loan Number** is generated (format: `LN` + Year + 6-digit sequence, e.g., `LN26001234`)
- Application Status is set to **DRAFT**
- Disbursement Status is set to **PENDING_LEVEL1**

---

### 4.3 Loan Application Status Flow

```
Application Created (FDO/BM)
          ↓
        DRAFT
          ↓
  PENDING_VERIFICATION  (submitted for BM verification)
          ↓
       VERIFIED  (BM approves; ready for indexing)
          ↓
    [Disbursement Flow begins — see Section 5]
          ↓
     REJECTED  (if BM rejects the application)
```

---

### 4.4 Loan Indexing

Before disbursement, verified loans are grouped into a **Loan Index**. This enables batch disbursement to an entire center on a single date.

**Who creates the index:** Branch Manager

**Index contains:**
- Center reference
- Funder (if applicable)
- List of verified loan IDs to be disbursed together

**First Due Date cap:** For non-Admin logins, the First Due Date set here (and re-checked at Level 3 Final Disbursement) must fall within a configurable number of days of the branch working date — 8 days by default. **Admin logins are always exempt.** Admin can turn this cap on/off and change the day count from **Masters → Member Approval Workflow** (`/dashboard/masters/client-approval-workflow`); that control is visible to Admin only.

---

## 5. Loan Disbursement Approval Flow

Disbursement follows a 3-level approval chain to ensure verified funds reach the right clients.

### Disbursement Status Flow

```
PENDING_LEVEL1
      ↓ (FDO marks ready for Level 2)
APPROVED_LEVEL1
      ↓ (BM creates Loan Index)
PENDING_LEVEL2
      ↓ (AM reviews and approves)
APPROVED_LEVEL2
      ↓ (BM performs final disbursement)
   DISBURSED ✓

    → REJECTED (possible at Level 2 review by AM)
```

---

### Level 1 — FDO/BM Submits for Disbursement

**Actor:** FDO or Branch Manager

**Action:**
- Reviews the verified loan batch
- Attaches funder information (optional)
- Sets proposed first due date
- Submits the index for Level 2 review

**Status change:** PENDING_LEVEL1 → PENDING_LEVEL2

---

### Level 2 — Area Manager (AM) Approval

**Actor:** Area Manager or Admin

**Action:**
- Reviews the loan index submitted by BM
- Verifies client eligibility and loan details
- Approves or rejects the batch

**AM Decision:**

| Action | Outcome | Status |
|--------|---------|--------|
| Approve | Ready for BM final disbursement | APPROVED_LEVEL2 |
| Reject | Batch returned; reason recorded | REJECTED |

---

### Level 3 — BM Final Disbursement

**Actor:** Branch Manager or Admin

**Action:**
- Reviews the AM-approved loan batch
- Confirms client attendance at the center meeting
- Records admission fee, document charges, insurance
- For Gold Loans: Records gold details (see Section 6)
- Completes the disbursement

**Upon Final Disbursement:**
- Status changes to **DISBURSED**
- **Loan Schedule** is generated automatically (all installment due dates and amounts)
- **GL Entries** are posted to the accounting system:
  - Loan principal (debit: Loan Portfolio / credit: Cash or Bank)
  - Admission fee receipt
  - Document charge receipt
  - Insurance fee receipt
- **Attendance** is recorded for all center clients

> From this point, the loan is live. The client begins repaying according to the generated schedule.

---

## 6. Gold Loan Process

The Gold Loan module handles loans secured by gold ornaments. It includes gold price management, collateral valuation, and a tracked return process.

### 6.1 Gold Price Management

Before any gold loan can be disbursed, current gold prices must be set in the system.

**Who sets prices:** Admin, Area Manager, or Branch Manager

**Price Structure:**

| Karat | Type |
|-------|------|
| 24K | Purest gold |
| 22K | Standard jewellery |
| 20K | Lower purity |
| 18K | Mixed alloy |
| 16K | Low-purity items |

- Each price entry specifies the rate per gram for each karat type.
- Only **one active price record** exists at a time. Setting a new price automatically deactivates the previous one.
- All gold valuations reference the active price record.

---

### 6.2 Gold Loan Creation — Step-by-Step

**Step 1 — Create Loan Application**
- FDO or BM creates a loan application linked to a Gold Loan product.
- The loan follows the standard application flow (DRAFT → VERIFIED → PENDING_LEVEL2).

**Step 2 — AM Approves Disbursement**
- AM reviews and approves the gold loan batch at Level 2.
- Status becomes APPROVED_LEVEL2.

**Step 3 — BM Final Disbursement with Gold Details**

During BM final disbursement, the BM records the gold collateral:

| Field | Description |
|-------|-------------|
| Karat Type | Purity of the gold (24K, 22K, 20K, 18K, 16K) |
| Gram Count | Weight of gold ornaments (up to 3 decimal places) |
| Gold Taken Value | Value of gold at current price (auto-calculated) |
| Cash Given | Actual loan amount disbursed to client |

- A **TAKE** Gold Transaction is created automatically when the BM disburses.
- The system records which gold price was used for this loan.
- GL entries are posted for the disbursement.

**Step 4 — Loan is Disbursed**
- Status changes to DISBURSED.
- Client receives cash; gold ornaments are held by the branch as collateral.
- Repayment schedule is generated.

---

### 6.3 Gold Repayment & Return Process

When the client repays the gold loan (fully or partially), the gold can be returned.

**Step 1 — BM Initiates Gold Return**
- BM navigates to Gold Transactions and initiates a **GIVE** transaction.
- Enters: Loan ID, gram count being returned, and remarks.
- Transaction is created with status **PENDING**.

**Step 2 — AM Approves Gold Return**
- AM reviews the gold return request.
- AM Decision:

| Action | Outcome | Status |
|--------|---------|--------|
| Approve | Gold physically returned to client | APPROVED |
| Reject | Return cancelled; reason recorded | REJECTED |

**Step 3 — Gold Returned to Client**
- Upon AM approval, the gold collateral is physically returned.
- The GL records the return transaction.

---

### 6.4 Gold Loan Full Lifecycle

```
Admin sets Gold Price
          ↓
FDO creates Gold Loan application
          ↓
BM verifies → Loan Index created
          ↓
AM approves at Level 2
          ↓
BM disburses: gold TAKEN, cash GIVEN (DISBURSED)
          ↓
Client repays installments (per schedule)
          ↓
Full repayment → BM initiates gold RETURN (PENDING)
          ↓
AM approves gold return (APPROVED)
          ↓
Gold physically returned to client ✓
```

---

## 7. Repayment & Collection Flow

### 7.1 How Repayments Are Collected

Repayments follow the group meeting schedule set for each center.

**Step 1 — Center Meeting**
- FDO conducts the scheduled center meeting.
- Client attendance is recorded.
- Cash repayments are collected from present members.

**Step 2 — FDO Submits Collection**
- FDO enters repayment amounts per client into the system.
- Each collection entry is created with status **PENDING**.

**Step 3 — BM Approves Collection**
- BM reviews the pending collection batch.
- BM Decision:

| Action | Outcome |
|--------|---------|
| Approve | GL entries posted; loan schedule updated |
| Reject | Collection returned to FDO for correction |

**Step 4 — Schedule Updated**
- Upon BM approval, the installment's paid status is updated.
- Principal paid, interest paid, and penalties paid are tracked separately.
- Running balance (outstanding principal) is recalculated.

---

### 7.2 Foreclosure & Preclosure

If a client wishes to close their loan early:

**Foreclosure (Maker-Checker Process):**
1. BM initiates the foreclosure request — calculates outstanding balance + penalties.
2. AM reviews and approves the foreclosure.
3. Upon AM approval, the loan is marked closed.
4. Final GL entries are posted.

---

### 7.3 End-of-Day (EOD) Process

The EOD process advances the branch's working date at the end of each business day.

**BM EOD Checklist** (all must be completed before EOD):
1. Attendance recorded for all center meetings scheduled today
2. All pending collections reviewed and approved
3. All pending disbursements cleared
4. Denomination entry submitted
5. No unresolved pending items

**Working Date Rules:**
- Each branch has a **current working date** (not today's calendar date).
- Transactions are posted against the working date, not the system clock.
- Sundays are automatically skipped.
- Business hours window: 09:00 – 18:00 IST (configurable). Operations outside this window are blocked.
- If the branch falls behind (catch-up required), Admin approval is needed.

---

## 8. Reports Module

The Reports module provides over 50 pre-built reports across six major categories.

### 8.1 Demand Reports

Track installments due from clients.

| Report | Description |
|--------|-------------|
| Demand Sheet | Summary of installments due on a given date by center |
| Future Demand | Projected installments due in upcoming days/weeks |
| Client Demand Report | Individual client-level demand detail |

---

### 8.2 Client Reports

Track the status and history of individual clients.

| Report | Description |
|--------|-------------|
| Application Form | Complete client KYC and application printout |
| Balance Information | Current outstanding balance per client |
| Loan Ledger | Full transaction history for a client's loan |
| Loan Ledger (with Dues) | Ledger including overdue installments |
| Addition & Deletion | Clients added or removed in a period |
| Addition Disbursed | Newly disbursed clients in a period |
| Dropouts | Clients who have exited the program |
| Meeting Attendance | Client attendance record for center meetings |
| Client Transfer | Clients transferred between centers/branches |
| Double Clients | Clients enrolled in more than one active loan |
| Waiting Borrowers | Approved clients yet to receive a loan |

---

### 8.3 Collection Reports

Track repayment performance and officer-wise productivity.

| Report | Description |
|--------|-------------|
| Meeting Check Report | Attendance and collection status by meeting |
| Collection Receipts | All receipts issued for a date range |
| Officer-wise Receipts | Collections grouped by FDO/BM |
| Loan Savings Report | Savings deposits linked to loan repayments |

---

### 8.4 Portfolio Reports

Monitor the overall loan book and risk.

| Report | Description |
|--------|-------------|
| Individual Ledger | Loan-level outstanding and transaction history |
| Loan Disbursement Report | All disbursements in a period |
| PAR Report | Portfolio At Risk (overdue loans by bucket) |
| Preclosure Report | Loans closed before scheduled maturity |
| Center Master | Complete center-wise portfolio summary |

---

### 8.5 Daily Monitoring Reports

Operational reports for day-to-day management.

| Report | Description |
|--------|-------------|
| Zero Collection | Centers/clients with no collection today |
| Collection Follow-up | Overdue collections requiring follow-up |
| Advance Collection | Clients who paid ahead of schedule |
| Inter-Branch Transfers | Fund movements between branches |

---

### 8.6 Accounting Reports

Financial statement and ledger reports — all filtered to **APPROVED** transactions only.

| Report | Description |
|--------|-------------|
| Day Book | Day-wise GL transaction listing |
| GL Report (Single Ledger) | All entries for one account ledger |
| GL Report (All Ledgers) | Consolidated general ledger |
| Receipts & Payments | Summary of cash/bank inflows and outflows |
| Trial Balance | Debit/credit balance summary for all accounts |
| Ledger Report | Account-wise detailed transaction ledger |
| Voucher Print | Print any financial voucher (cash/bank/journal) |

> **Important:** Only transactions with approval status **APPROVED** appear in accounting reports. Pending and rejected transactions have no accounting impact.

---

### 8.7 Employee Reports

HR and performance tracking for field staff.

| Report | Description |
|--------|-------------|
| Attendance (Detailed) | Day-wise attendance for each employee |
| Attendance (Summary) | Monthly attendance summary per employee |
| FDO Performance | Productivity metrics for field officers |

---

### 8.8 MIS Reports (Management Information System)

High-level strategic reports — accessible to Admin and Area Manager only.

| Report | Description |
|--------|-------------|
| Company Profile | Organisation-wide financial and operational snapshot |
| Age-wise Arrear | Overdue loans grouped by days past due |
| Branch Demand | Demand summary broken down by branch |
| Loan OS Details | Outstanding loan details across all branches |
| Branch-wise OS | Outstanding grouped by branch |
| Center-wise OS | Outstanding grouped by center |
| Client-wise DCB | Demand, Collection, Balance per client |
| All DCB | Full DCB across the portfolio |
| Performance Report | Key performance metrics across branches |
| NEFT Format | Bank transfer file for bulk disbursement |

---

### 8.9 Other Reports

| Report | Description |
|--------|-------------|
| Funder Report | Funds utilized against each funder |
| Funder Interest | Interest accrued per funding source |
| Denomination Collection | Cash denomination breakdown for collections |
| Insurance Report | Insurance records across clients |
| Loan Index Report | All loan index entries and statuses |
| Disbursement Report | Detailed disbursement summary |
| Branch Profile | Branch-level operational statistics |
| Pending Items | Unresolved items requiring attention |

---

### 8.10 Request Report (Async Export Queue)

Every report page still generates Excel/PDF/CSV/Word client-side by default. For a growing subset of reports, the export dropdown routes through an async **Request Report** queue instead: the request is queued immediately, processed in the background, and the finished file appears as a download link on `/dashboard/reports/request-report` — no need to keep the browser tab open while a large export builds.

**How it works:**
1. User clicks Export on a report page. If that report is wired to the queue, the export request (report type, date range, branch scope, any extra filters, file format) is submitted to `POST /api/report-requests` instead of generating the file in the browser.
2. A background worker (`app/lib/reports/report-request-worker.ts`, started via `instrumentation.ts`) picks up pending requests, generates the file server-side, and uploads it to storage.
3. The Request Report page lists every request with live status (Pending / Processing / Completed / Failed / Cancelled), a download link once complete, and a cancel action while still pending.
4. Submitting the same report/date range/branch/filters/format again on the same day surfaces the existing request instead of silently duplicating it — the user can reuse it or force a fresh one.

**Export access is gated separately from report *view* access** via the `ReportPermission` table (`canExport` per role per report) — managed from the admin **Report Permissions** screen (`/dashboard/admin/report-permissions`). A role that can view a report but has no `canExport` grant sees the export buttons hidden, not erroring.

**Coverage:** As of this writing, 24 of ~50 reports are wired to the async queue (Meeting Attendance, Addition & Deletion, Addition Disbursed, Attendance Summary/Detailed, Dropouts, Double Clients, Balance Information, Client Transfer, CCR, MCR, Gold Taken/Returned, Preclosure, Loan OS Details, DCR, DCB, Center Master, Waiting Borrowers, Meeting Check, Denomination Collection, Future Demand, Future Report, FDO Performance). The remainder — reports with multi-sheet Excel output, per-record drill-downs (a single loan's schedule, a single loan-index batch), region/division/area cascading filters, or single-record snapshot dumps (Company Profile, Branch Profile) — don't fit the queue's "date range + branch scope → one flat table" contract and keep exporting client-side as before. Unwired reports are unaffected; nothing about them changed.

---

## 9. Role-Based Access Control

This section defines exactly what each role can do in every module.

### 9.1 Client Management

| Action | ADMIN | AM | BM | FDO |
|--------|-------|----|----|-----|
| Enroll new client | ✓ | — | — | ✓ |
| Upload KYC documents | ✓ | — | — | ✓ |
| View client details | ✓ | ✓ | ✓ | ✓ |
| BM-level review / approval | ✓ | — | ✓ | — |
| AM-level review / approval | ✓ | ✓ | — | — |
| Final approval (Admin) | ✓ | — | — | — |
| Reject client | ✓ | ✓ | ✓ | — |
| Resubmit returned application | ✓ | — | — | ✓ |

### 9.2 Loan Management

| Action | ADMIN | AM | BM | FDO |
|--------|-------|----|----|-----|
| Create loan application | ✓ | ✓ | ✓ | ✓ |
| View loans (all branches) | ✓ | ✓ | — | — |
| View loans (own branch) | ✓ | ✓ | ✓ | ✓ |
| Verify loan application (BM) | ✓ | — | ✓ | — |
| Create loan index | ✓ | — | ✓ | — |
| Delete draft loan | ✓ | — | ✓ | ✓ |

### 9.3 Disbursement

| Action | ADMIN | AM | BM | FDO |
|--------|-------|----|----|-----|
| Submit for Level 2 (Level 1) | ✓ | — | — | ✓ |
| Level 2 Approval (AM) | ✓ | ✓ | — | — |
| Final Disbursement (BM) | ✓ | — | ✓ | — |
| View disbursed loans | ✓ | ✓ | ✓ | ✓ |

### 9.4 Gold Loan

| Action | ADMIN | AM | BM | FDO |
|--------|-------|----|----|-----|
| Set / update gold price | ✓ | ✓ | ✓ | — |
| View gold price | ✓ | ✓ | ✓ | ✓ |
| Initiate gold return (GIVE) | ✓ | — | ✓ | — |
| Approve gold return | ✓ | ✓ | — | — |
| View gold transactions | ✓ | ✓ | ✓ | ✓ |

### 9.5 Collections

| Action | ADMIN | AM | BM | FDO |
|--------|-------|----|----|-----|
| Submit collection | ✓ | ✓ | ✓ | ✓ |
| Approve collection batch | ✓ | — | ✓ | — |
| View collection history | ✓ | ✓ | ✓ | ✓ |

### 9.6 Financial Transactions (Accounting)

| Action | ADMIN | AM | BM | FDO |
|--------|-------|----|----|-----|
| Create vouchers (cash/bank/journal) | ✓ | — | ✓ | — |
| AM approval of voucher | ✓ | ✓ | — | — |
| Admin approval of voucher | ✓ | — | — | — |
| View approved transactions | ✓ | ✓ | ✓ | — |
| View pending transactions | ✓ | ✓ | ✓ | — |
| Manage chart of accounts | ✓ | — | — | — |

> A voucher created by Admin is automatically approved. A voucher created by BM requires AM approval → then Admin approval before it affects any balances or reports.

### 9.7 Reports

| Report Category | ADMIN | AM | BM | FDO |
|----------------|-------|----|----|-----|
| Demand Reports | ✓ | ✓ | ✓ | ✓ |
| Client Reports | ✓ | ✓ | ✓ | ✓ |
| Collection Reports | ✓ | ✓ | ✓ | ✓ |
| Portfolio Reports | ✓ | ✓ | ✓ | ✓ |
| Daily Monitoring Reports | ✓ | ✓ | ✓ | ✓ |
| Accounting Reports | ✓ | — | ✓ | — |
| Employee Reports | ✓ | ✓ | ✓ | — |
| MIS Reports | ✓ | ✓ | — | — |
| Funder Reports | ✓ | — | — | — |

### 9.8 Administration & Masters

| Action | ADMIN | AM | BM | FDO |
|--------|-------|----|----|-----|
| Manage branches | ✓ | — | — | — |
| Manage centers | ✓ | ✓ | ✓ | — |
| Manage users | ✓ | — | — | — |
| Manage loan products | ✓ | — | — | — |
| Manage account masters | ✓ | — | — | — |
| Trigger EOD process | ✓ | — | ✓ | — |
| Approve EOD catch-up | ✓ | — | — | — |
| Payroll management | ✓ | ✓ | ✓ | — |

---

### 9.9 Legacy Data Upload (Masters → Upload)

One-time migration tools for bringing a legacy MFI's members and loans into Sarvam. **ADMIN only** (every page and API under `/dashboard/masters/uploan/**`).

| Tool | Route | Purpose |
|------|-------|---------|
| Member Upload | `/dashboard/masters/uploan/member` | Bulk-migrate legacy members + their one ongoing loan from Excel — resolves/creates Center & Group, creates/reuses the Client, replays a real repayment transaction trail. Background job; same-day whole-job revert. |
| Loan Upload | `/dashboard/masters/uploan/loan` | Per-client historical loan + repayment import for an already-verified client (optionally with Loan Card / Repayment CSVs). |
| Loan History Edit | `/dashboard/masters/uploan/loan-history` | Open an already-migrated / backup loan, edit its **Loan Card schedule** and **Repayment history** grids (add / edit / delete rows) plus loan meta — or **upload the original Loan Card Report / Repayment Report CSVs** to replace the grids wholesale — then **rebuild** the real `LoanSchedule` + `LoanTransaction` trail from the result. |
| Individual Funder Change (Super Control) | `/dashboard/masters/super-control/individual-funder-change` | ADMIN only. Pick a live (DISBURSED/CLOSED) loan and **change its funder**: `Loan.funderId` is updated and every posted GL voucher (index disbursement `CP`, EOD funder `CR` principal/interest, legacy EOD collection/closure vouchers) is **rewritten on its original date** from the old funder ledgers to the new funder's ledgers. A read-only preview lists each voucher before applying; one `$transaction`; audit row in `LoanFunderChangeLog`. Schedule/transactions are never touched. Service: `app/lib/services/loan-funder-change.service.ts`. |
| Bulk Funder Change (Super Control) | `/dashboard/masters/super-control/bulk-funder-change` | ADMIN only. Select a **branch** + the **funder to move from** → that funder's loans in the branch are listed; tick the loans (or select all on the page), pick the **target funder**, preview per-loan GL entries, then transfer. Same engine as Individual Funder Change (`loan-funder-change.service.ts`): original vouchers rewritten on original dates, all selected loans in one `$transaction` (max 200, all-or-nothing), one `LoanFunderChangeLog` row per loan (reason prefixed `[Bulk]`). Old-ledger source (e.g. `OWN FUND GOLD`, GL fix only; "Keep each loan's current funder"), loans applied one per transaction with progress, and a **GL reconcile** card (`eod-funder-reconcile.service.ts`) that moves leftover EOD amounts from the wrong funder ledger to the right one per day (GL total unchanged). API: `app/api/super-control/bulk-funder-change/`. |
| User Login Activity — Current (Live) | `/dashboard/reports/others/user-login-activity` (Group By → **Current (Live)**) | ADMIN only. Auto-refreshes every 30 s: who is online now (last 10 min) on **Web** vs **Mobile app** with branch/device, plus API load for server sizing — calls/min now, peak/min today, avg/min last hour, last-60-min chart, top APIs today, 30-day daily peak. Every authenticated API call is counted in memory and flushed every 30 s by `api-traffic-tracker.ts` into `api_traffic_minutes` / `api_traffic_endpoint_days` (120-day retention); users come from `user_login_activities`. API: `app/api/reports/others/user-login-activity/live/`. |
| Live Loan Schedule Edit (Super Control) | `/dashboard/masters/super-control/loan-schedule-edit` | ADMIN only. Edits the Loan Card of a **live DISBURSED loan in place** (no wipe/rebuild): per-installment due date, principal/interest/savings due, plus *shift from installment N by ±days* and *set new first due date*. Only **pending** installments are editable (PAID / part-paid rows are locked), so nothing is replayed — collections, lines and paid columns are never touched; Loan Advance already collected is never redistributed. Migrated loans are allowed (their stored `migratedLoanSource.loanCard` is patched too). Amount edits blocked for: pending collections, pre-closure/write-off, open foreclosure. Preview diff + audit row in `LoanScheduleEditLog`. Collection dates are NOT editable here; CCR snapshot columns on old transactions are not recomputed. Service: `app/lib/services/loan-schedule-edit.service.ts`. |
| Member ID Edit (Super Control) | `/dashboard/masters/super-control/member-id-edit` | ADMIN only. Search a client by Member ID / name / phone and change `Client.clientId` (format `branch-center-group-no`, e.g. `33-44-1-3`). Check step **allows duplicate IDs** but warns (must acknowledge) when another client already uses it, and likewise warns when the prefix doesn't match the client's current branch/center. Only the ID column changes (everything else references the client by internal id); audit row in `ClientIdChangeLog`. API: `app/api/super-control/member-id-edit/`. |
| Super Control Audit History | `/dashboard/masters/super-control/audit-history` | ADMIN only. One newest-first timeline of every Super Control change — **who** (user), **when** (IST), **which menu** (Individual / Bulk Funder Change, Live Loan Schedule Edit, Member ID Edit), **on what** (loan no. / Member ID + name), **what changed** (old → new; expand a row for per-voucher / per-installment lines) and the **reason**. Filters: menu, date range, loan/member search. Reads `LoanFunderChangeLog` (bulk rows carry a `[Bulk]` reason), `LoanScheduleEditLog`, `ClientIdChangeLog`. API: `app/api/super-control/audit-history/`. |
| Closed Member Upload | `/dashboard/masters/uploan/closed-member` | Bulk import of closed loans with unreturned savings / gold. |
| Import History | `/dashboard/masters/uploan/history` | List of past Member / Closed-Member import jobs + same-day revert. |

Loans list either currently `DISBURSED` or since `CLOSED` (full repayment, foreclosure, or a direct Closed Member Upload) — a `?status=` filter narrows to one; both are shown by default. Never-indexed only (`indexId` null) either way.

**Full rebuild (DISBURSED loans) — `PUT`**

```
Pick a backup loan
  → grids loaded from Loan.migratedLoanSource (exact) OR an approximate
    reconstruction from LoanSchedule/LoanTransaction (loans imported before
    the source was stored — flagged "Approx." in the list, warned in the editor)
  → edit meta + Loan Card + Repayment grids
     (optional: upload the original Loan Card / Repayment CSVs — parsed client-side,
      replace the matching grid; the "Carried-over Loan Advance" lump is then forced
      to 0 since the uploaded events carry their own wallet movement)
  → Save & Rebuild  (reason required — logged to BackupLoanEditLog with a before-snapshot)
      guard: if the loan has had real (non-import) collection activity since import
             (any LoanTransaction NOT flagged excludeFromEodAllocation), an extra
             "Delete real transactions?" confirmation is required
      → one $transaction: wipe gold + transactions + schedule + collection-stats
        → reset Loan aggregates, apply edited meta, re-stamp migratedLoanSource
        → decrement Client.loanAdvance by the loan's prior savingsPaid
        → replay: schedule + transactions + gold + savings lump (applyBackupLoanHistory)
```

**Quick edit (CLOSED loans) — `PATCH`**

A closed loan's schedule/history is done — what still needs correcting is usually just the unreturned **Gold Pledge** or unreturned **Loan Advance** figure. Opening a `CLOSED` loan swaps the full editor above for a 2-field form (Gold karat/gram/value/cash + Loan Advance ₹) with no loan product/purpose/frequency/date requirement:

```
Save  (reason required — logged to BackupLoanEditLog)
  → replaces GoldLoanDetail + its TAKE GoldTransaction (only if the gold fields actually
    changed; an existing GIVE/return record is left alone) and/or sets Loan.savingsPaid +
    applies the delta to Client.loanAdvance (only if the figure actually changed)
  → NEVER touches LoanSchedule / LoanTransaction / migratedLoanSource / loan product /
    purpose / dates — no real-activity gate, since nothing collection-related is deleted
```

The old `PUT /api/ongoing-loan-backup/[id]` (used by Loan Upload) rejects any loan that carries a migrated history — those must be edited here, where the schedule + transactions are rebuilt rather than flattened.

---

## 10. End-to-End Project Flow

This section combines every module into a single complete workflow — from a customer's first contact to loan closure.

---

### Phase 1 — Customer Joins the Program

```
Customer contacts branch or FDO
          ↓
FDO enrolls customer (personal details + KYC)
          ↓
FDO assigns customer to a Center and Group
          ↓
BM reviews and approves KYC
          ↓
AM reviews and approves KYC
          ↓
Admin gives final approval
          ↓
Customer status: APPROVED — eligible for loan ✓
```

**Timeline:** Typically 3–7 working days depending on document completeness.

---

### Phase 2 — Loan Application

```
Customer requests a loan
          ↓
FDO/BM creates loan application (selects product, amount, frequency)
          ↓
Loan Number generated (e.g., LN26001234)
          ↓
BM verifies the application
          ↓
BM creates Loan Index (groups multiple loans for same center)
          ↓
Loan ready for disbursement process
```

---

### Phase 3 — Loan Disbursement

```
BM submits index for Level 2 review
          ↓
AM reviews batch — approves if eligible
          ↓
BM schedules center meeting for disbursement day
          ↓
Clients attend meeting (attendance recorded)
          ↓
BM confirms disbursement:
  - Collects admission fee
  - Collects document charges
  - Records insurance
  - [Gold Loan: records gold ornaments and weight]
          ↓
Cash/Transfer disbursed to client(s)
          ↓
Repayment schedule auto-generated ✓
GL entries posted to accounting ✓
Loan status: DISBURSED ✓
```

---

### Phase 4 — Repayment (Ongoing)

```
Each collection day (per center meeting schedule):
          ↓
FDO conducts center meeting
          ↓
FDO collects cash from clients
          ↓
FDO records collection in system (PENDING)
          ↓
BM reviews and approves the collection
          ↓
Schedule updated; GL posted
          ↓
[Repeat for each installment until loan is fully repaid]
```

---

### Phase 5 — Loan Closure

**Normal Closure (all installments paid):**
```
All installments paid as per schedule
          ↓
Final installment approved by BM
          ↓
Loan automatically marked as CLOSED ✓
[Gold Loan: BM initiates gold return → AM approves → Gold returned to customer]
```

**Early Closure (Foreclosure/Preclosure):**
```
Customer wants to close loan early
          ↓
BM calculates outstanding principal + penalties
          ↓
BM initiates foreclosure request
          ↓
AM approves foreclosure
          ↓
Customer pays outstanding amount
          ↓
Loan closed; GL entries posted ✓
```

---

### Phase 6 — Financial Accounting (Parallel Process)

Running alongside all operations:

```
BM creates vouchers (cash receipts, payments, journals)
          ↓
Status: PENDING_AM_APPROVAL (no effect on books yet)
          ↓
AM reviews and approves
          ↓
Status: PENDING_ADMIN_APPROVAL
          ↓
Admin approves
          ↓
Status: APPROVED → Posted to General Ledger ✓
          ↓
Appears in: Day Book, Trial Balance, Ledger Reports, Receipts & Payments
```

> **Admin-created transactions** skip the approval queue and are posted immediately.

> **Chart of Accounts setup:** Before any voucher can be posted, Admin/BM configure the **Account Group** hierarchy (`/dashboard/accounts/group`) and the **Account Ledgers** (`/dashboard/accounts/ledger`) that sit under it.
> - A group name only needs to be unique *within its own parent* — the same name is allowed under two different parent groups. Two primary (root, no-parent) groups still can't share a name, since they belong to the same "no parent" scope.
> - A group can't be deleted while it still has sub-groups or ledgers under it.
> - Each ledger is grouped under one Account Group and flagged for **H.O** and/or **B.O** access — a ledger can be visible to both offices at once.
> - Once a ledger has recorded transactions, only its name can still be edited (its group and access flags lock), and the ledger itself can no longer be deleted.

---

### Phase 7 — EOD and Reporting

```
BM completes all daily operations:
  ✓ Center meetings conducted
  ✓ Collections approved
  ✓ Disbursements cleared
  ✓ Denomination entry submitted
          ↓
BM triggers End-of-Day
          ↓
Working date advances to next business day
          ↓
Management reviews daily/monthly reports:
  - Portfolio performance (PAR, OS reports)
  - Collection efficiency (demand vs. collection)
  - Accounting statements (trial balance, day book)
  - MIS reports (Admin and AM only)
```

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **Loan Number** | Unique identifier for each loan (format: LN + Year + 6-digit number) |
| **LoanIndex** | A batch grouping of loans from the same center for simultaneous disbursement |
| **Loan Schedule** | Auto-generated table of all due dates, principal, and interest per installment |
| **FLAT Rate** | Interest calculated on original loan principal throughout the tenure |
| **Reducing Balance** | Interest calculated on the outstanding (reducing) principal each period |
| **EOD** | End-of-Day process — advances the branch's working date |
| **Working Date** | The branch's active transaction date (may differ from calendar date) |
| **KYC** | Know Your Customer — identity and address verification documents |
| **PAR** | Portfolio At Risk — measure of overdue loans as % of total portfolio |
| **DCB** | Demand, Collection, Balance — core portfolio tracking metric |
| **GL** | General Ledger — the master accounting record of all financial transactions |
| **Foreclosure** | Early loan closure; balance paid off before scheduled end date |
| **Preclosure** | Same as Foreclosure; used interchangeably in the system |
| **Funder** | External funding source that provides capital for loan disbursements |
| **BM** | Branch Manager — manages operations for one branch |
| **AM** | Area Manager — oversees multiple branches (up to 4) |
| **FDO** | Field Development Officer — frontline staff who works directly with clients |
| **ADMIN** | System Administrator / Head Office with full access to all data |
| **Center** | A field group of clients who meet on a regular schedule for repayment |
| **Group** | A sub-unit within a Center; clients jointly responsible for repayments |
| **Karat (Gold)** | Purity measure of gold; 24K = pure gold, lower karat = mixed alloy |
| **Gold TAKE** | System event when gold is taken as collateral during loan disbursement |
| **Gold GIVE** | System event when gold is returned to client after loan repayment |
| **Maker-Checker** | Two-person control process — one initiates, another approves |
| **Voucher** | Financial document recording a cash, bank, or journal transaction |

---

*This document reflects the complete operational workflow of the Sarvam Charitable Trust system. For technical integration or API documentation, refer to the project's API specification. For system configuration or user administration, contact the Head Office Admin.*
