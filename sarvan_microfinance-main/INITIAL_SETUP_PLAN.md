# 🚀 INITIAL SETUP PLAN - Microfinance Project

This document provides a **step-by-step guide** for setting up the initial foundation of the microfinance application.

---

## 📋 Prerequisites Checklist

Before starting, ensure you have:
- [ ] Node.js 18+ installed
- [ ] PostgreSQL database installed and running (or access to a PostgreSQL instance)
- [ ] Git installed
- [ ] Code editor (VS Code recommended)
- [ ] Terminal/Command Prompt access

---

## 🎯 Setup Steps Overview

1. **Project Structure & Dependencies**
2. **Database Setup (PostgreSQL + Prisma)**
3. **shadcn/ui Installation & Configuration**
4. **Authentication Setup (JWT)**
5. **Environment Configuration**
6. **Basic Folder Structure**
7. **RBAC Middleware Setup**
8. **Initial Layout & Theme**

---

## 📦 STEP 1: Install Core Dependencies

### 1.1 Install Required Packages

```bash
# Database & ORM
npm install @prisma/client
npm install -D prisma

# Authentication & Security
npm install jsonwebtoken bcryptjs
npm install -D @types/jsonwebtoken @types/bcryptjs

# Form Handling & Validation
npm install react-hook-form zod @hookform/resolvers

# HTTP Client (if needed)
npm install axios

# Date handling
npm install date-fns

# Utilities
npm install clsx tailwind-merge

# File upload handling (for KYC documents)
npm install react-dropzone

# PDF generation (for reports)
npm install jspdf jspdf-autotable

# Excel export (for reports)
npm install xlsx
```

### 1.2 Update package.json scripts

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:studio": "prisma studio",
    "db:seed": "tsx prisma/seed.ts"
  }
}
```

---

## 🗄️ STEP 2: Database Setup (PostgreSQL + Prisma)

### 2.1 Initialize Prisma

```bash
npx prisma init
```

This creates:
- `prisma/schema.prisma` - Database schema file
- `.env` - Environment variables file

### 2.2 Configure Database Connection

Update `.env` file:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/k3_microfinance?schema=public"

# JWT Secrets
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-change-in-production"

# App Configuration
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"

# File Storage (S3/MinIO - to be configured later)
# AWS_ACCESS_KEY_ID=""
# AWS_SECRET_ACCESS_KEY=""
# AWS_REGION=""
# AWS_S3_BUCKET=""
```

### 2.3 Create Initial Prisma Schema

Create `prisma/schema.prisma` with basic models:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// User & Authentication
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  password      String
  firstName     String
  lastName      String
  role          UserRole  @default(FDO)
  branchId      String?
  branch        Branch?   @relation(fields: [branchId], references: [id])
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  refreshTokens RefreshToken[]
  
  @@map("users")
}

enum UserRole {
  ADMIN
  BRANCH_MANAGER
  FDO
  AREA_MANAGER
}

model RefreshToken {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
  
  @@map("refresh_tokens")
}

// Branch Management
model Branch {
  id          String   @id @default(cuid())
  name        String
  code        String   @unique
  address     String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  users       User[]
  centers     Center[]
  
  @@map("branches")
}

// Center Management
model Center {
  id          String   @id @default(cuid())
  name        String
  code        String   @unique
  branchId    String
  branch      Branch   @relation(fields: [branchId], references: [id])
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  clients     Client[]
  
  @@map("centers")
}

// Client Management (Basic structure)
model Client {
  id          String   @id @default(cuid())
  clientId    String   @unique
  firstName   String
  lastName    String
  phone       String?
  email       String?
  centerId    String
  center      Center   @relation(fields: [centerId], references: [id])
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@map("clients")
}
```

### 2.4 Generate Prisma Client & Push Schema

```bash
# Generate Prisma Client
npm run db:generate

# Push schema to database (for development)
npm run db:push

# OR create a migration (for production)
npm run db:migrate
```

---

## 🎨 STEP 3: shadcn/ui Installation & Configuration

### 3.1 Initialize shadcn/ui

```bash
npx shadcn@latest init
```

During initialization, choose:
- **TypeScript**: Yes
- **Style**: Default
- **Base color**: Slate (or your preference)
- **CSS variables**: Yes
- **Tailwind config**: Use app directory
- **Components**: app/components
- **Utils**: app/lib/utils

### 3.2 Install Essential shadcn/ui Components

```bash
# Layout & Navigation
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add sidebar
npx shadcn@latest add dropdown-menu
npx shadcn@latest add navigation-menu

# Forms
npx shadcn@latest add input
npx shadcn@latest add label
npx shadcn@latest add select
npx shadcn@latest add textarea
npx shadcn@latest add checkbox
npx shadcn@latest add radio-group
npx shadcn@latest add form

# Data Display
npx shadcn@latest add table
npx shadcn@latest add badge
npx shadcn@latest add avatar
npx shadcn@latest add separator

# Feedback
npx shadcn@latest add dialog
npx shadcn@latest add alert
npx shadcn@latest add toast
npx shadcn@latest add skeleton

# Overlay
npx shadcn@latest add sheet
npx shadcn@latest add popover
npx shadcn@latest add tooltip

# Date Picker (if needed)
npx shadcn@latest add calendar
npx shadcn@latest add date-picker
```

### 3.3 Configure TailwindCSS

Ensure `tailwind.config.ts` includes shadcn/ui configuration:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // shadcn/ui theme configuration
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
```

---

## 🔐 STEP 4: Authentication Setup (JWT)

### 4.1 Create Authentication Utilities

Create `app/lib/auth.ts`:

```typescript
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
}

export function generateRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

export function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}
```

### 4.2 Create Auth Middleware

Create `app/middleware.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAccessToken } from './lib/auth';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('accessToken')?.value;
  const { pathname } = request.nextUrl;

  // Public routes
  const publicRoutes = ['/login', '/api/auth/login'];
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Protected routes
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    verifyAccessToken(token);
    return NextResponse.next();
  } catch (error) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
```

---

## 📁 STEP 5: Create Folder Structure

Create the following folder structure:

```
app/
├── (auth)/
│   └── login/
│       └── page.tsx
├── (dashboard)/
│   ├── layout.tsx
│   └── page.tsx
├── api/
│   ├── auth/
│   │   ├── login/
│   │   │   └── route.ts
│   │   └── refresh/
│   │       └── route.ts
│   └── users/
│       └── route.ts
├── components/
│   ├── ui/          # shadcn/ui components (auto-generated)
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── Navbar.tsx
│   └── auth/
│       └── LoginForm.tsx
├── lib/
│   ├── auth.ts
│   ├── db.ts        # Prisma client instance
│   └── utils.ts     # shadcn/ui utils (auto-generated)
├── hooks/
│   └── use-auth.ts
├── types/
│   └── index.ts
└── globals.css

prisma/
├── schema.prisma
└── seed.ts

public/
└── (existing files)
```

### 5.1 Create Prisma Client Instance

Create `app/lib/db.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## 🎨 STEP 6: Initial Layout & Theme Setup

### 6.1 Update Root Layout

Update `app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: companyNameShort+" Microfinance System",
  description: "Microfinance Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

### 6.2 Create Dashboard Layout

Create `app/(dashboard)/layout.tsx`:

```typescript
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

---

## 🔧 STEP 7: Environment Configuration

### 7.1 Create .env.example

Create `.env.example`:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/k3_microfinance?schema=public"

# JWT Secrets
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-change-in-production"

# App Configuration
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NODE_ENV="development"
```

### 7.2 Update .gitignore

Ensure `.gitignore` includes:

```
.env
.env.local
.env*.local
node_modules
.next
.prisma
```

---

## ✅ STEP 8: Verification Checklist

After completing all steps, verify:

- [ ] All dependencies installed successfully
- [ ] Prisma schema created and pushed to database
- [ ] shadcn/ui components installed
- [ ] Authentication utilities created
- [ ] Folder structure created
- [ ] Environment variables configured
- [ ] Database connection working (`npm run db:studio` to verify)
- [ ] Next.js dev server runs without errors (`npm run dev`)

---

## 🚀 Next Steps (After Initial Setup)

Once initial setup is complete, proceed with:

1. **Create Login Page** - Implement authentication UI
2. **Create Dashboard** - Basic dashboard layout with navigation
3. **Implement RBAC** - Role-based access control middleware
4. **Create User Management** - Basic CRUD for users
5. **Set up Branch Management** - Basic branch operations

---

## 📝 Notes

- Always run `npm run db:generate` after schema changes
- Use `npm run db:studio` to visually inspect your database
- Keep `.env` file secure and never commit it
- Test authentication flow before proceeding with other features

---

**Ready to start? Begin with STEP 1 and work through each step sequentially!** 🎉


