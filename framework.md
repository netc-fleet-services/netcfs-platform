# Consolidated Monorepo Platform Framework

## Overview

Build a centralized internal operations platform that combines multiple existing React/Next.js tools into one scalable monorepo. Each app keeps its own functionality while sharing authentication, navigation, styling, and common infrastructure.

## Goals

* One homepage for all tools
* One login session across all apps
* Shared UI and branding
* Apps remain modular and independently maintainable
* Migrate existing repos one at a time
* Scalable foundation for future tools

---

# Recommended Architecture

```text
company-platform/
├── apps/
│   ├── portal/
│   ├── fleet/
│   ├── transport/
│   ├── inspections/
│   ├── swaps/
│   └── future-app/
│
├── packages/
│   ├── ui/
│   ├── auth/
│   ├── db/
│   ├── styles/
│   ├── config/
│   └── utils/
│
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

---

# Tech Stack

## Frontend

* Next.js (App Router)
* React
* TypeScript
* Tailwind CSS
* shadcn/ui

## Monorepo Tooling

* Turborepo
* pnpm

## Backend

* Supabase

  * Auth
  * Postgres
  * Storage
  * Edge Functions
  * Row Level Security

## Hosting

* Vercel

---

# Route Structure

```text
/                  Home dashboard
/fleet             Fleet tracker
/transport         Dispatch / scheduler
/inspections       Driver inspections
/swaps             Swap optimizer
/reports           Reporting center
/settings          User settings
/admin             Admin panel
```

---

# Shared Packages

## packages/ui

Reusable components:

* Buttons
* Inputs
* Tables
* Modals
* Cards
* Tabs
* Status badges
* Layout containers

## packages/auth

* Supabase client
* Session provider
* Login/logout helpers
* Role guards
* Middleware helpers

## packages/db

* Typed database client
* Shared queries
* Generated Supabase types
* Audit logging helpers

## packages/styles

* Tailwind preset
* Theme tokens
* Typography scale
* Spacing system
* Shared CSS variables

## packages/utils

* Date formatting
* CSV export
* Validation helpers
* Common hooks
* Generic utilities

---

# Authentication Model

Use one centralized Supabase Auth system.

## Roles

* Admin
* Dispatcher
* Mechanic
* Viewer

## Access Examples

* Admin: full access
* Dispatcher: fleet + transport + reports
* Mechanic: fleet + inspections
* Viewer: read-only access

## Middleware Flow

1. User visits protected route
2. Check session cookie
3. If no session -> redirect to login
4. If unauthorized role -> redirect to denied page
5. If valid -> continue

---

# UI / UX Standards

## Shared Layout

* Top header
* Left sidebar navigation
* Mobile drawer nav
* Search bar
* User profile menu

## Visual System

* Same typography across all apps
* Same button styles
* Same spacing rules
* Same table styling
* Same color rules for statuses

## Example Status Colors

* Green = healthy / complete / future safe
* Yellow = warning / due soon
  n- Red = overdue / blocked / failed

---

# Home Portal Dashboard

## Purpose

Single launch point for all tools.

## Suggested Sections

* Quick links to modules
* Recent activity feed
* Alerts requiring attention
* KPIs / summaries
* Favorites / pinned tools
* Search all units, users, records

---

# Migration Plan

## Phase 1: Build Skeleton Platform

Create:

* monorepo structure
* auth
* dashboard
* nav shell
* shared UI package
* theme

## Phase 2: Migrate First App

Recommended first migration:

* Fleet tracker or easiest existing repo

Steps:

1. Copy repo into apps/fleet
2. Fix imports
3. Move repeated UI into packages/ui
4. Hook into shared auth
5. Test routes and permissions

## Phase 3: Migrate Remaining Apps

Order:

1. Fleet
2. Inspections
3. Transport
4. Swaps

## Phase 4: Consolidate Data Models

After frontend stability:

* unify duplicate tables
* standardize naming
* centralize reports

---

# Development Standards

## Code Rules

* TypeScript everywhere
* Reusable components first
* No duplicate business logic across apps
* Use shared packages when possible
* Keep app-specific logic inside each app folder

## Branch Strategy

* main = production
* develop = integration
* feature/* = new work

## CI/CD

On push:

* lint
* typecheck
* tests
* build changed apps only
* deploy preview

---

# Example Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
```

Run one app:

```bash
pnpm --filter fleet dev
```

---

# Suggested Initial File Creation

```text
apps/portal/app/page.tsx
apps/fleet/app/page.tsx
packages/ui/src/button.tsx
packages/auth/src/client.ts
packages/styles/tailwind-preset.ts
middleware.ts
```

---

# Build Prompt

```text
Build a scalable internal operations platform using Next.js monorepo architecture.

Requirements:
- Multiple apps inside one repo
- Shared authentication using Supabase
- Shared sidebar/header/navigation
- Shared Tailwind/shadcn design system
- Home dashboard linking to each tool
- Apps remain modular and independently maintainable
- Route structure:
  /fleet
  /transport
  /inspections
  /swaps

Use Turborepo + pnpm workspace.

Create packages for:
- ui
- auth
- db
- styles
- utils

Use role-based permissions:
- Admin
- Dispatcher
- Mechanic
- Viewer

Create responsive desktop/mobile layout.
Prepare structure so existing repos can be migrated one at a time.
```

---

# Final Recommendation

Start with a new parent repo now. Move existing applications in gradually. Standardize design and authentication immediately, but delay deep database consolidation until each migrated app is stable.

