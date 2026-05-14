# Roles & Permissions Reference

All roles are defined in `packages/auth/src/types.ts`. Module-level access is enforced in the portal (tiles are hidden for disallowed modules) and via server-side redirects in each app. Within each app, specific actions are further gated by role checks in the UI and Supabase RLS policies.

---

## Role Summary

| Role | Portal access | Description |
|------|--------------|-------------|
| `admin` | All apps | Full access to everything across the platform. Can manage trucks, users, notification rules, and review equipment requests. |
| `dispatcher` | Fleet, Transport, Inspections, Swaps, Reports, Impounds, Quote Calculator, Scheduler | Operational role. Can manage truck status, dispatch jobs, view safety data, manage impounds, build quotes, and manage driver schedules. Cannot manage notification settings. |
| `shop_manager` | Fleet, Scheduler, Fullbay WIP | Shop-floor role. Full fleet access including status changes, notes, and admin settings page. Can manage driver schedules and view WIP reports. Cannot manage notification settings. |
| `mechanic` | Fleet, Inspections | Can change truck status, add mechanic/work notes, and submit inspections. No admin access. |
| `driver` | Fleet | Can view all trucks, add driver notes, and flag a truck as Known Issues or Out of Service. Cannot mark a truck Ready — that requires a mechanic or higher. |
| `impound_manager` | Impounds | Can view and edit impound records. No access to fleet or other apps. |
| `viewer` | Fleet, Transport, Inspections, Swaps, Reports | Read-only observer. Cannot change status, add notes, or take any action. |
| `accounts` | Statement Reconciler, Fullbay WIP | Accounting role. Can run vendor statement reconciliations and view Fullbay WIP reports. No access to operational apps. |

---

## Fleet App

| Action | admin | dispatcher | shop_manager | mechanic | driver | viewer |
|--------|:-----:|:----------:|:------------:|:--------:|:------:|:------:|
| View truck dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Set status → Known Issues or Out of Service | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Set status → Ready for Use | ✓ | ✓ | ✓ | ✓ | — | — |
| Edit "Waiting On" field | ✓ | ✓ | ✓ | ✓ | — | — |
| Add driver notes | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Add mechanic / work done notes | ✓ | ✓ | ✓ | ✓ | — | — |
| Submit vehicle inspection | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| View inspection history | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Submit equipment request | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Export history report (XLSX) | ✓ | ✓ | ✓ | — | — | — |
| Access admin settings page | ✓ | ✓ | ✓ | — | — | — |
| Add / edit / deactivate trucks | ✓ | ✓ | ✓ | — | — | — |
| Review / approve equipment requests | ✓ | ✓ | ✓ | — | — | — |
| Manage status-change notification rules | ✓ | — | — | — | — | — |
| Manage inspection notification rules | ✓ | — | — | — | — | — |

---

## Inspections (Safety) App

All access is read-only for the roles that can reach this app. The safety manager (typically an `admin` or `dispatcher`) can manually override missed DVIR records. Data is populated automatically by the Samsara sync job.

| Action | admin | dispatcher | mechanic |
|--------|:-----:|:----------:|:--------:|
| View safety leaderboard | ✓ | ✓ | ✓ |
| View driver safety detail | ✓ | ✓ | ✓ |
| Override missed DVIR | ✓ | ✓ | — |

---

## Impounds App

| Action | admin | dispatcher | impound_manager |
|--------|:-----:|:----------:|:---------------:|
| View impound list | ✓ | ✓ | ✓ |
| Edit impound record | ✓ | ✓ | ✓ |
| Record disposition (sold/scrapped/released) | ✓ | ✓ | ✓ |

---

## Transport App

Dispatchers and admins use the Transport board. It is read-only for `viewer`.

| Action | admin | dispatcher | viewer |
|--------|:-----:|:----------:|:------:|
| View dispatch board | ✓ | ✓ | ✓ |
| Assign driver to job | ✓ | ✓ | — |
| Update job status | ✓ | ✓ | — |

---

## Quote Calculator App

All users who can access this app can build and save quotes. There is no read-only mode.

| Action | admin | dispatcher |
|--------|:-----:|:----------:|
| Build and save quotes | ✓ | ✓ |
| Override fuel surcharge | ✓ | ✓ |
| Download / share PDF | ✓ | ✓ |
| View recent quotes | ✓ | ✓ |

---

## Scheduler App

| Action | admin | dispatcher | shop_manager |
|--------|:-----:|:----------:|:------------:|
| View schedule | ✓ | ✓ | ✓ |
| Add / edit / delete shifts | ✓ | ✓ | ✓ |
| Bulk copy shifts | ✓ | ✓ | ✓ |
| View coverage analytics | ✓ | ✓ | ✓ |
| Export schedule CSV | ✓ | ✓ | ✓ |
| Manage driver list | ✓ | ✓ | ✓ |

---

## Statement Reconciler App

| Action | admin | accounts |
|--------|:-----:|:--------:|
| Upload files and run reconciliation | ✓ | ✓ |
| View reconciliation history | ✓ | ✓ |
| Download reconciliation reports | ✓ | ✓ |
| Run Fullbay WIP reconciliation | ✓ | ✓ |

---

## Fullbay WIP App

| Action | admin | shop_manager | accounts |
|--------|:-----:|:------------:|:--------:|
| Trigger WIP report run | ✓ | ✓ | ✓ |
| View results and history | ✓ | ✓ | ✓ |
| Download summary / detail files | ✓ | ✓ | ✓ |

---

## How Permissions Are Enforced

**Module access** (which apps a user can reach) is defined in `ROLE_PERMISSIONS` in `packages/auth/src/types.ts`. The portal filters tiles and the individual apps redirect unauthenticated or unauthorized users server-side.

**Action-level access** within the Fleet app is controlled by constants in `apps/fleet/lib/constants.ts`:

```
CAN_CHANGE_STATUS   — can set any status including Ready
CAN_REPORT_ISSUES   — can set Known Issues / Out of Service only (includes drivers)
CAN_ADD_MECHANIC_NOTE
CAN_MANAGE_TRUCKS
CAN_MANAGE_NOTIFICATIONS
```

Supabase RLS policies add a second enforcement layer so that even direct API calls from unauthorized roles are rejected at the database level.
