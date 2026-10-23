# Mobile API — FDO Task (monthly targets vs achievement)

Shows the logged-in **FDO's own** monthly task: the targets the admin set in
*HR → Performance → FDO Tasks* (Enr. Target, New Member, Renewal, Disbursement Target)
against what the FDO has achieved that month. Numbers come from the same code as the
admin **FDO Task Report**, so the app and the report always match.

## Request

```
GET /api/mobile/fdo-task?month=9&year=2026
Authorization: Bearer <session token>   (the same token the app already sends to the other /api/mobile/* endpoints, issued after MPIN login)
```

| Param | Required | Notes |
|---|---|---|
| `month` | no | 1–12. Defaults to the current month (IST). |
| `year`  | no | 2020–2100. Defaults to the current year (IST). |

- Only users with role `FDO` are allowed. The FDO is taken from the token — you cannot ask for another FDO.
- Achievement is computed live, so it is the current position for a running month.

## Response `200`

```json
{
  "success": true,
  "message": "FDO task retrieved",
  "data": {
    "employee": { "employeeId": "ST123", "name": "Anbu R", "branch": "B001 - Karur" },
    "period": { "month": 9, "year": 2026, "monthName": "September 2026" },
    "targets":     { "enrollment": 20, "newMember": 12, "renewal": 8, "loanDisbursement": 500000 },
    "achievement": { "enrollment": 7, "newMember": 7, "renewal": 3, "loanDisbursement": 210000 },
    "progress": {
      "enrollmentPct": 35, "newMemberPct": 58.33, "renewalPct": 37.5, "loanDisbursementPct": 42
    },
    "enrollmentBalance": 13,
    "collection": { "targetPct": 100, "actualPct": 96.4, "differencePct": 3.6 },
    "operations": {
      "numberOfCenters": 6, "activeClients": 180, "activeMembers": 22,
      "activeClientsWithLoan": 158, "totalDisbursementMembers": 10
    },
    "goldLoan": { "members": 1, "amount": 40000, "goldReturn": 0 },
    "portfolio": { "principalOutstanding": 3200000, "interestOutstanding": 410000 },
    "arrear": { "clients": 9, "principal": 54000, "interest": 6200, "memberPct": 5 }
  }
}
```

Field notes for the four task fields:

| App label | `targets.*` | `achievement.*` |
|---|---|---|
| Enr. Target | `enrollment` | `enrollment` |
| New Member | `newMember` | `newMember` |
| Renewal | `renewal` | `renewal` |
| Disbmt Target (₹) | `loanDisbursement` | `loanDisbursement` (₹, loans disbursed by the BM this month) |

- `progress.*Pct` is `achieved / target × 100`, or **`null` when no target is set** for that month — show "—", not 0%.
- `enrollmentBalance` = enrollment target − enrollment achieved (can be negative when the target is exceeded).
- An FDO with no target row for the month gets all targets `0`.

## Errors

| Status | When |
|---|---|
| 400 | `month` not 1–12 or `year` out of range |
| 401 | Missing / invalid / expired token |
| 403 | Caller is not an FDO |
| 404 | No FDO task data for this user (e.g. inactive FDO) |
| 500 | Server error |
