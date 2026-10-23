# MICROFINANCE SYSTEM – FULL MIGRATION & ESTIMATION DOCUMENT (MEGA DOCUMENT)

---

# 📌 1. PROJECT OVERVIEW
This document provides the **complete system flow, screen inventory, migration plan, estimation, tech stack, and RBAC mapping** for the new Microfinance Application migration.

It consolidates:
- **Admin Flow**
- **Branch Manager Flow**
- **Field Development Officer Flow**
- **Area Manager Flow**
- **All Screens (Deduped)**
- **System-wide Estimate & Timeline**
- **Tech Stack & Architecture**
- **Cursor Prompt Guide for Vibe Coding**

This is the *single reference document* your team and Cursor will use.

---

# 📌 2. SYSTEM ROLES & RESPONSIBILITIES

## **2.1 Admin**
- System-level configuration
- Accounts, MIS Reports
- Company settings, employees, funders, loan products
- High-level reports & utilities

## **2.2 Branch Manager (BM)**
- Operational control of branch
- Center creation, client enrollment, KYC verification
- Loan induction, disbursement, collections

## **2.3 Field Development Officer (FDO)**
- Client onboarding
- KYC collection
- Loan application creation
- Collection handling
- FDO-specific reports

## **2.4 Area Manager (AM)**
- Hybrid permissions of Admin + BM
- Supervisory functions only
- No unique screens—RBAC-only adjustments

---

# 📌 3. COMPLETE SCREEN INVENTORY (DEDUPED)

A total of **~72 unique screens** exist across Admin, BM, FDO, and AM.

## **3.1 Admin Screens (42)**
- Change Branch
- Client Search
- Daily Monitoring
- New Zero Collection
- Collection Followup
- Advance Collection
- Inter Branch
- Masters
- Funder
- Loan Product
- Employee
- Creation
- Assign Password
- Reset Password
- Releave Employee
- All Password
- Accounts
- Accounts Group
- Accounts Ledger
- Transactions
- Cash Receipt
- Cash Payment
- Bank Receipt
- Bank Payment
- Journal
- Contra
- Modification
- Reports
- Portfolio
- Account
- Funders
- Others
- MIS Reports
- Company Profile
- All DCB
- Branch Demand
- Disbursement
- Loan OS Details
- Agewise Arrear
- Preclosure
- Performance
- Ledger Report
- Utilities → Set GL Balance

---

## **3.2 Branch Manager Unique Screens (26 total)**
### **Center Operations**
- Locate Center
- Center Creation
- Center Transfer
- Center Locator

### **Client Operations**
- Locate Client
- Enrollment
- Group Assign
- Transfer
- Inactive
- Re-active
- Client Locator

### **Verification**
- KYC Verification

### **Loan Module**
- Induction
- Disbursement (shared with Admin)
- Change Funder
- Delete Disbursement

### **Collections**
- Demand Collection
- Client / Late Collection
- Single Collection
- Bulk Collection
- Foreclosure
- Delete Demand Collection
- Delete Client Collection
- Delete Foreclosure

### **Payroll & Attendance**
- Payroll
- Attendance

---

## **3.3 Field Development Unique Screens (11 total)**
### **Client**
- KYC Documents
- KYC Update
- Co Applicant

### **Loan Module**
- Application (FDO-specific)

### **Collections** (shared with BM)
- Demand Collection
- Client / Late Collection
- Single Collection
- Bulk Collection

### **Reports** (unique structure)
- Demand
- Demand Sheet
- Client Report
- Application Form
- Balance Information
- Loan Schedule
- Loan Ledger

---

## **3.4 Area Manager (AM) Screens**
⚠️ **AM has no unique screens.**
AM = Admin + BM functionalities combined (minus Accounts & Masters).

---

# 📌 4. MIGRATION ESTIMATION SUMMARY

## **4.1 Per-role Effort (deduped)**
| Role | Unique PD | Notes |
|------|-----------:|-------|
| Admin | 186 pd | 42 core screens |
| Branch Manager | 76 pd | 26 unique screens |
| Field Development | 39 pd | 11 unique screens |
| Area Manager | 12 pd | RBAC only |
| **Total (raw)** | **313 pd** |  |

### Add 25% migration overhead
313 × 0.25 = **78 pd**

### Add Infrastructure + Monitoring + Deployment Setup
= **15 pd**

### **🎯 Final Migration Estimate = ~406 person-days**
Rounded to: **408 person-days**

---

# 📌 5. UPDATED PROJECT TIMELINE (6-WEEK PLAN)

You requested a **6‑week delivery plan**, optimized for **Next.js (FE + BE), PostgreSQL, shadcn/ui, and JWT Auth**, executed by **2 developers using Cursor for vibe coding**.

Below is the revised aggressive—but realistic—6‑week execution roadmap.

## **Week 1 — Foundation Setup & Core Architecture**
- Next.js 14+ App Router setup (FE + BE routes)
- Database setup (PostgreSQL + Prisma)
- JWT Authentication (access + refresh tokens)
- RBAC (Admin, BM, FDO, AM) with middleware
- shadcn/ui components + TailwindCSS theme + layout scaffolding
- File server integration decision (S3 / MinIO placeholder)
- Cursor-based scaffolding for models & base components

## **Week 2 — Centers + Client Enrollment (FDO) + Approvals (BM)**
- Center creation + listing (BM)
- Client enrollment (FDO)
- BM approval flow for client enrollment
- Lookups: locate client / center (FDO + BM)
- Initial Daily Monitoring basic stats

## **Week 3 — KYC Module + Verification + Core Loan Flow**
- KYC Document Upload (FDO)
- KYC Update/Edit (FDO)
- KYC Verification (BM)
- Loan Application (FDO)
- Loan Induction/Approval (BM)

## **Week 4 — Disbursement + Single Collection + Basic Reports**
- Loan Disbursement (BM)
- Single Collection (BM/FDO)
- Loan Schedule generation (basic)
- Balance Information screen
- Minimal reporting foundation (PDF/CSV generation)

## **Week 5 — Collections Suite + Stabilization**
- Demand Collection (BM/FDO)
- Late/Client Collection (BM/FDO)
- Bulk Collection (BM/FDO)
- Payment reversals (delete collection) basic version
- Branch Demand basic version
- Integration tests & hardening

## **Week 6 — Finalization + QA + Deployment Prep**
- Final report set (Loan Ledger, Application Form)
- Fine-tune RBAC
- Performance optimization
- Security audit (JWT, file uploads, role checks)
- Data validations
- UAT and client revisions
- Deployment pipeline + staging release

📌 **This 6‑week plan assumes:**
- Daily heavy usage of Cursor for code generation
- Only MVP-level functionality of each screen (full 72-screen system is *not* target within 6 weeks)
- 2 developers working in parallel

---

# 📌 6. UPDATED TECH STACK (Finalized as per Your Requirement)

## **Frontend & Backend (Unified)**
### ✅ **Next.js (App Router)**
Used for both UI and backend API routes.
- React + TypeScript
- Server Actions / Route Handlers for API
- Automatic routing + optimized rendering

## **UI / Component Library**
### ✅ **shadcn/ui + Radix UI**
- shadcn/ui components built on Radix UI primitives
- TailwindCSS for styling and theming
- Fully customizable and accessible components
- Form components (React Hook Form integration) + tables + dialogs
- Copy-paste component architecture for easy customization

## **Database**
### ✅ **PostgreSQL**
- Core relational DB for all modules
- Prisma ORM migrations

## **Authentication**
### ✅ **JWT Auth**
- Access token + refresh token
- Role-based middleware
- No external IdP required

## **File Storage**
### ✅ **To be confirmed by client** — recommended options:
- Amazon S3
- MinIO (self-hosted S3 alternative)

Used for KYC documents, application forms, PDFs, image uploads.

## **Other Dependencies**
- TailwindCSS (styling framework for shadcn/ui)
- Zod (form validation)
- React Hook Form (form management, integrated with shadcn/ui)
- Prisma (ORM)
- NextAuth (optional — if you want session-based auth instead of raw JWT)
- Nodemailer / SMS provider for notifications
- Radix UI (underlying primitives for shadcn/ui components)

---

# 📌 7. PROPOSED TECH STACK

## **Frontend**
- React + TypeScript (Next.js optional)
- TailwindCSS
- shadcn/ui + Radix
- React Query
- React Hook Form + Zod

## **Backend**
- Node.js + TypeScript
- NestJS Framework
- Prisma ORM
- PostgreSQL
- Redis (caching, queues)
- S3 for KYC / file storage

## **Auth & RBAC**
- Keycloak or Auth0
- JWT tokens
- Fine-grained RBAC per role

## **Reports & Search**
- PostgreSQL + Materialized Views
- Elasticsearch (optional)
- PDF/Excel generation modules

## **DevOps**
- Docker + K8s (production)
- GitHub Actions CI/CD
- Terraform (infra-as-code)
- Prometheus + Grafana
- Sentry

---

# 📌 7. SYSTEM ARCHITECTURE OVERVIEW

### **Layers**:
- Presentation Layer (React)
- API Gateway / REST Services (NestJS)
- Business Logic Services
- Data Layer (Prisma + PostgreSQL)
- File Storage (S3)
- Caching Layer (Redis)
- Auth Layer (Keycloak)
- Reporting Layer (views + scheduled jobs)
- Notification Layer (SMS/Email)

---

# 📌 8. FINAL DEDUPED MASTER SCREEN LIST (~72 Screens)

A shortened version is below; full details preserved in sections above.

### **Functional Modules**
- Branch Management
- Center Management
- Client Enrollment & Client Lifecycle
- KYC Processing
- Loan Induction / Application / Disbursement
- Collections (all variants)
- Accounts Management
- Transactions
- Reports (Admin + BM + FDO variants)
- MIS Reports
- Utilities & Company Profile
- Payroll & Attendance

---

# 📌 9. RBAC MATRIX (HIGH-LEVEL)

| Feature | Admin | BM | FDO | AM |
|---------|:-----:|:--:|:---:|:--:|
| Center Creation | ❌ | ✅ | ❌ | ✅ |
| Client Enrollment | ❌ | ✅ | ✅ | ✅ |
| KYC Upload | ❌ | ❌ | ✅ | ❌ |
| KYC Verification | ❌ | ✅ | ❌ | ✅ |
| Loan Induction | ❌ | ✅ | ❌ | ✅ |
| Loan Application | ❌ | ❌ | ✅ | ❌ |
| Disbursement | ✅ | ✅ | ❌ | ✅ |
| Collections | ❌ | ✅ | ✅ | ✅ |
| Accounts | ✅ | ❌ | ❌ | ❌ |
| MIS Reports | ✅ | ❌ | ❌ | ✅ |
| Employee Ops | ✅ | ✅ | Reset Only | ✅ |

*(Full matrix can be expanded later.)*

---

# 📌 10. MIGRATION PLAN (PHASED RELEASE)

### **Phase 1 – Setup & Foundations (3–4 weeks)**
- Tech stack setup
- DB schema baseline
- Auth system (Keycloak)
- CI/CD + Infrastructure

### **Phase 2 – Core Modules (Center + Client) (6–8 weeks)**
- Center creation, transfer workflows
- Client onboarding, enrollment, KYC upload

### **Phase 3 – KYC → Loan Workflows (6–8 weeks)**
- KYC verification
- Loan induction, application, approval
- Disbursement flows

### **Phase 4 – Collections (8–10 weeks)**
- All collection screens (single, bulk, demand, foreclosure)
- Reverse/delete flows

### **Phase 5 – Reports + MIS + Accounts (8–10 weeks)**
- Admin reports
- FDO reports
- MIS suite
- Accounts + Ledger + Transactions

### **Phase 6 – QA + UAT + Hardening (4–6 weeks)**
- Testing
- Data migration
- Performance
- Production readiness

---

# 📌 11. CURSOR PROMPT GUIDE (VIBE CODING)

### To instruct Cursor to build a feature:

**"Refer to the MICROFINANCE_MIGRATION_MEGA_DOCUMENT and implement the following screen: `<SCREEN_NAME>`"**

Cursor will understand:
- role permissions
- data flow
- API+UI requirements
- dependencies
- estimated complexity
- full navigation context

### Examples
- "Refer to the mega document and generate UI + API for Client → Enrollment"
- "Implement Reports → Loan Schedule using the referenced business logic"
- "Build the Loan Induction flow as defined in the mega document"

---

# 📌 12. END OF DOCUMENT
This file is the **single source of truth** for development, estimation, and migration planning.

Use this document for: architecture, planning, vibe coding in Cursor, and onboarding new developers.

