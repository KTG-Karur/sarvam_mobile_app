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
