# Sarvam Charitable Trust — System Architecture & Hierarchy Documentation

## 1. Organizational Hierarchy

```
Region (Zonal)
  └── Division
        └── Area
              └── Branch
                    └── Center
                          └── Client
```

### Level Descriptions

| Level    | Description |
|----------|-------------|
| **Region** | Top-level geographic zone (e.g. South Zone, North Zone). Managed by Admin only. |
| **Division** | A sub-region within a Region containing 3–4 Areas. Managed by a Division Manager. |
| **Area** | A cluster of 3–4 Branches within a Division. Managed by an Area Manager. |
| **Branch** | A physical office that operates Centers. Managed by a Branch Manager. |
| **Center** | A group of Clients who meet regularly. Managed by an FDO. |
| **Client** | An individual borrower enrolled in a Center. |

---

## 2. User Roles & Responsibilities

| Role | Assigned To | Manages |
|------|-------------|---------|
| **ADMIN** | Head Office staff | Full system — all levels |
| **DIVISION_MANAGER** | One per Division | Their division, all its Areas, Branches, Centers, Clients |
| **AREA_MANAGER** | One per Area (can oversee up to 4 branches) | Their area's branches, centers, clients |
| **BRANCH_MANAGER** | One per Branch | Their branch's centers and clients |
| **FDO** (Field Development Officer) | One per Branch (may cover multiple centers) | Assigned centers and their clients |

---

## 3. Database Models

### New Models (added in this implementation)

**Region**
```
id, name, code (unique), isActive, createdAt, updatedAt
→ has many Divisions
```

**Division**
```
id, name, code (unique), regionId, isActive, createdAt, updatedAt
→ belongs to Region
→ has many Areas
→ has many Division Managers (User with DIVISION_MANAGER role)
```

**Area**
```
id, name, code (unique), divisionId, isActive, createdAt, updatedAt
→ belongs to Division
→ has many Branches
```

### Existing Models (modified)

**Branch** — added `areaId` (optional FK to Area)  
**User** — added `divisionId` (optional FK to Division, set when role = DIVISION_MANAGER)

---

## 4. Access Control Matrix

| Role | Region | Division | Area | Branch | Center | Client | Reports |
|------|--------|----------|------|--------|--------|--------|---------|
| ADMIN | Full CRUD | Full CRUD | Full CRUD | Full CRUD | Full CRUD | Full CRUD | All |
| DIVISION_MANAGER | View own | View own | All under division | All under division | All | All | Division-wide |
| AREA_MANAGER | — | — | View own | All under area | All | All | Area-wide |
| BRANCH_MANAGER | — | — | — | Own branch | All in branch | All in branch | Branch-wide |
| FDO | — | — | — | — | Assigned | Assigned | Center-level |

---

## 5. Hierarchy Creation Workflow

### Step 1 — Create Regions (Admin only)
```
Admin → Masters → Regions → Add Region
  - Enter: Name, Code (e.g. "South Zone", "SZ")
  - Result: Region created, visible in Division form dropdown
```

### Step 2 — Create Divisions (Admin only)
```
Admin → Masters → Divisions → Add Division
  - Enter: Name, Code, select Region, optionally assign Division Manager
  - Result: Division created under Region
```

### Step 3 — Create Areas (Admin only)
```
Admin → Masters → Areas → Add Area
  - Enter: Name, Code, select Division
  - Result: Area created under Division
```

### Step 4 — Link Branch to Area (Admin)
```
Admin → Branch Management → Edit Branch → select Area
  - Branch.areaId is set
  - Branch now belongs to: Area → Division → Region
```

### Step 5 — Assign Division Manager
```
Admin → Masters → Divisions → Edit Division → select Manager user
  - User.divisionId is set to this division
  - User.role is set/confirmed as DIVISION_MANAGER
  - Division Manager can now log in and see all data under their division
```

---

## 6. Reporting Access Flow

### Admin (Full Access)
```
Admin sees: All Regions → All Divisions → All Areas → All Branches → All Centers → All Clients
```

### Division Manager
```
Login → sees their Division
  → All Areas in that Division
      → All Branches in those Areas
          → All Centers in those Branches
              → All Clients in those Centers
Reports: Filtered to divisionId = user.divisionId
```

### Area Manager
```
Login → sees their Area (via AreaManagerBranch junction)
  → All Branches assigned to them (up to 4)
      → All Centers in those Branches
          → All Clients in those Centers
Reports: Filtered to branchId IN [their assigned branches]
```

### Branch Manager
```
Login → sees their single Branch (branchId on User)
  → All Centers in that Branch
      → All Clients in those Centers
Reports: Filtered to branchId = user.branchId
```

### FDO
```
Login → sees Branches under their branchId
  → Centers assigned to them (Center.fdoId = user.id)
      → Clients in those Centers
Reports: Filtered to center.fdoId = user.id
```

---

## 7. Text Hierarchy Diagram

```
REGION (South Zone - SZ)
├── DIVISION (Coimbatore Division - CBD)
│   ├── AREA (Coimbatore North - CBN)
│   │   ├── BRANCH (Gandhipuram Branch - GB001)
│   │   │   ├── CENTER (Gandhinagar Center - GC001)
│   │   │   │   ├── Client: Murugan R.
│   │   │   │   └── Client: Kavitha S.
│   │   │   └── CENTER (Anna Nagar Center - AC001)
│   │   └── BRANCH (RS Puram Branch - RS001)
│   └── AREA (Coimbatore South - CBS)
│       └── BRANCH (Peelamedu Branch - PB001)
└── DIVISION (Tiruppur Division - TPD)
    └── AREA (Tiruppur Central - TPC)
        └── BRANCH (Tiruppur Branch - TB001)
```

---

## 8. API Endpoints Reference

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/regions` | All roles | List all active regions |
| POST | `/api/regions` | ADMIN | Create region |
| PUT | `/api/regions/[id]` | ADMIN | Update region / toggle status |
| GET | `/api/divisions` | All roles | List divisions (filter: ?regionId=) |
| POST | `/api/divisions` | ADMIN | Create division |
| PUT | `/api/divisions/[id]` | ADMIN | Update division, assign manager |
| GET | `/api/areas` | All roles | List areas (filter: ?divisionId=) |
| POST | `/api/areas` | ADMIN | Create area |
| PUT | `/api/areas/[id]` | ADMIN | Update area / toggle status |

---

## 9. Navigation (Admin only)

```
Masters
├── Regions           /dashboard/masters/regions
├── Divisions         /dashboard/masters/divisions
├── Areas             /dashboard/masters/areas
├── Gold Price        /dashboard/masters/gold-price
└── ... (other master pages)
```

---

## 10. Future Phase Notes

- **Branch → Area linking UI**: A dropdown to link an existing branch to an area should be added to the Branch edit form.
- **Division Manager report filtering**: Existing report APIs (collections, loans, clients) need a `divisionId` filter scope added for the DIVISION_MANAGER role — this is a Phase 6 implementation.
- **Area Manager reporting by area**: Currently AMs are linked to branches via `AreaManagerBranch` junction. With the new Area model, a direct `areaId` link on the User model can be considered for cleaner filtering.
