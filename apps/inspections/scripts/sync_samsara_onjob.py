"""
Samsara → Supabase "On Job" Sync

Sets trucks.on_job for the fleet maintenance tracker's "On Job" badge, and
stamps settings.last_synced_on_job. Replaces an out-of-repo process that
silently stopped on 2026-06-19; running it here (GitHub Actions) makes it
visible, logged, and un-losable.

Definition of "out on a job", per Samsara vehicle telematics:
  on_job = moving (>5 mph)  OR  (engine On/Idle AND not parked at a company yard)
A truck idling at its own yard is NOT on a job; a truck running out in the
field (or moving) IS. "At a yard" is detected from Samsara's geofence name
(gps.address.name), which reads e.g. "NETC Exeter", "Ray's Saco", "MBTR Lee".

A truck with no samsara_vehicle_id can't be confirmed, so it's set on_job=false
(never left showing a stale badge).

Required env:
  SAMSARA_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
Optional env:
  DRY_RUN=1   — compute and print, write nothing
"""

import os
from datetime import datetime, timezone
import requests
from supabase import create_client

SAMSARA_API_KEY = os.environ["SAMSARA_API_KEY"].strip()
SUPABASE_URL    = os.environ["SUPABASE_URL"].strip()
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"].strip()
DRY_RUN         = os.environ.get("DRY_RUN", "").strip() not in ("", "0", "false", "False")

BASE_URL = "https://api.samsara.com"
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# Samsara geofence-name prefixes for OUR yards. A vehicle sitting inside one of
# these geofences is at base, not on a job. Extend if a new yard is added.
BASE_PREFIXES = ("netc", "interstate", "ray", "mbtr")
MOVING_MPH = 5.0


def samsara_vehicle_stats() -> dict[str, dict]:
    """Latest engine state + GPS for every vehicle, keyed by Samsara vehicle id."""
    out: dict[str, dict] = {}
    cursor = None
    while True:
        params = {"types": "engineStates,gps"}
        if cursor:
            params["after"] = cursor
        r = requests.get(f"{BASE_URL}/fleet/vehicles/stats",
                         headers={"Authorization": f"Bearer {SAMSARA_API_KEY}"},
                         params=params, timeout=30)
        r.raise_for_status()
        body = r.json()
        for v in body.get("data", []):
            out[str(v["id"])] = v
        page = body.get("pagination", {})
        if page.get("hasNextPage"):
            cursor = page["endCursor"]
        else:
            break
    return out


def at_base(stat: dict) -> bool:
    name = ((stat.get("gps") or {}).get("address") or {}).get("name")
    return bool(name) and name.strip().lower().startswith(BASE_PREFIXES)


def is_on_job(stat: dict) -> bool:
    gps = stat.get("gps") or {}
    if (gps.get("speedMilesPerHour") or 0) > MOVING_MPH:
        return True                                   # moving = out
    engine = (stat.get("engineState") or {}).get("value")
    return engine in ("On", "Idle") and not at_base(stat)  # running & away from base


def load_trucks() -> list[dict]:
    rows, offset = [], 0
    while True:
        batch = (sb.table("trucks").select("id, unit_number, on_job, samsara_vehicle_id")
                 .eq("active", True).range(offset, offset + 999).execute().data or [])
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Samsara → on_job sync"
          + ("  (DRY RUN)" if DRY_RUN else ""))

    stats = samsara_vehicle_stats()
    print(f"  Samsara vehicles: {len(stats)}")

    trucks = load_trucks()
    print(f"  Active trucks: {len(trucks)}")

    changes = []   # (truck, old, new)
    for t in trucks:
        vid = str(t.get("samsara_vehicle_id") or "").strip()
        stat = stats.get(vid) if vid else None
        desired = is_on_job(stat) if stat else False   # unlinked/unknown → not on job
        if bool(t.get("on_job")) != desired:
            changes.append((t, bool(t.get("on_job")), desired))

    on_now = sum(1 for t in trucks
                 if (stats.get(str(t.get("samsara_vehicle_id") or "")) and
                     is_on_job(stats[str(t["samsara_vehicle_id"])])))
    print(f"  Computed on_job=true: {on_now}    changes to write: {len(changes)}")
    for t, old, new in changes:
        print(f"    {t['unit_number']:<10} {old} -> {new}")

    if DRY_RUN:
        print("  DRY RUN — nothing written.")
        return

    for t, _old, new in changes:
        sb.table("trucks").update({"on_job": new}).eq("id", t["id"]).execute()

    sb.table("settings").upsert(
        {"key": "last_synced_on_job", "value": datetime.now(timezone.utc).isoformat()},
        on_conflict="key",
    ).execute()
    print(f"  Wrote {len(changes)} truck updates; stamped last_synced_on_job.")


if __name__ == "__main__":
    main()
