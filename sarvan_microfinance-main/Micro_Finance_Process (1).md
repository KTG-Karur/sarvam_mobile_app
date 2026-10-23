
# Micro Finance Loan Processing Flow (Optimized with Merged KYC)

This document explains the complete Micro Finance loan processing system in a clear and developer-friendly format with **Member Creation + KYC merged into a single step**.

---

## 👥 Roles Involved

- **BM** – Branch Manager  
- **AM** – Area Manager  
- **FDO** – Field Development Officer  
- **Member** – Customer / Client  

---

## ✅ Step-by-Step Process Flow (Updated)

### 1️⃣ Center Creation (BM)
BM creates a new center.

**Path:**  
`BM → Center Creation → Save`

---

### 2️⃣ Center Approval (AM)
AM approves the center created by BM.

**Path:**  
`AM → Unapproved Centers → Approve → Save`

---

### 3️⃣ Member Enrollment + KYC Upload (FDO) ✅ *Merged Step*
FDO adds members **and uploads KYC documents in the same step**.

**Path:**  
`FDO → Client Enrollment + KYC → Select Center → Add Member → Upload KYC → Save`

✅ No member can be created without valid KYC.

---

### 4️⃣ Member + KYC Verification (BM) ✅ *One-Shot Verification*
BM verifies both **member details and KYC together**.

**Path:**  
`BM → Verification → Member + KYC → Verify & Approve`

---

### 5️⃣ Loan Application Creation (FDO)
FDO creates loan applications for all verified members.

**Path:**  
`FDO → Loan Module → Application → Select Center → Create Loan`

---

### 6️⃣ Loan Verification (BM)
BM verifies the loan applications.

**Path:**  
`BM → Loan Module → Index → Select Center → Verify Loan`

---

### 7️⃣ Loan Disbursement – Level 1 (BM)
BM distributes the loan.

**Path:**  
`BM → Loan Disbursement → Select Center → Distribute`

---

### 8️⃣ Final Loan Disbursement – Level 2 (AM)
AM gives final approval and loan is delivered to members.

**Path:**  
`AM → Loan Disbursement → Select Center → Final Distribution ✅`

---

## 📊 Complete Updated Process Flow Diagram

```
BM
│
│ 1️⃣ Create Center
▼
AM
│
│ 2️⃣ Approve Center
▼
FDO
│
│ 3️⃣ Create Member + Upload KYC ✅
▼
BM
│
│ 4️⃣ Verify Member + KYC ✅
▼
FDO
│
│ 5️⃣ Create Loan Application
▼
BM
│
│ 6️⃣ Verify Loan
▼
BM
│
│ 7️⃣ Disburse Loan (Level 1)
▼
AM
│
│ 8️⃣ Final Disbursement ✅
▼
MEMBERS RECEIVE LOAN 💰
```

---

## 🧠 One-Line Summary

**Center → Member + KYC → Verification → Loan → Approval → Disbursement → Final Approval → Money Given ✅**
