"""GitHub Actions entry point for statement reconciliation.

Called by .github/workflows/reconcile.yml with these environment variables:
  SUPABASE_URL              — project URL
  SUPABASE_SERVICE_ROLE_KEY — service role key (GitHub secret)
  JOB_ID                    — UUID of the reconciliation_jobs row
  VENDOR_KEY                — parser key (e.g. "fleetpride")

The vendor parser is selected automatically from VENDOR_KEY, so the correct
parser runs for whichever vendor was chosen in the web UI.
"""
from __future__ import annotations

import os
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from supabase import create_client, Client  # noqa: E402

from reconciler.parsers import get_parser, merge_parsed_statements  # noqa: E402
from reconciler.qb_loader import load_qb, merge_qb_statements       # noqa: E402
from reconciler.reconcile import export_to_excel, reconcile         # noqa: E402

SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
JOB_ID          = os.environ["JOB_ID"]
VENDOR_KEY      = os.environ["VENDOR_KEY"]
QB_FILE_COUNT   = int(os.environ.get("QB_FILE_COUNT", "1"))
STMT_FILE_COUNT = int(os.environ.get("STMT_FILE_COUNT", "1"))
_exts_raw       = os.environ.get("STMT_FILE_EXTS", "")
STMT_FILE_EXTS  = _exts_raw.split(",") if _exts_raw else ["pdf"] * STMT_FILE_COUNT
BUCKET          = "reconciliation-files"

sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def update_job(status: str, **kwargs: object) -> None:
    sb.table("reconciliation_jobs").update({"status": status, **kwargs}).eq("id", JOB_ID).execute()


def download_file(storage_path: str, local_path: str) -> None:
    data = sb.storage.from_(BUCKET).download(storage_path)
    with open(local_path, "wb") as f:
        f.write(data)


def upload_bytes(storage_path: str, data: bytes, content_type: str) -> None:
    sb.storage.from_(BUCKET).upload(storage_path, data, {"content-type": content_type})


def main() -> None:
    update_job("running")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            stmt_path = os.path.join(tmp, "statement.pdf")

            print(f"[{JOB_ID}] Downloading files… (QB: {QB_FILE_COUNT}, stmt: {STMT_FILE_COUNT})")
            qb_paths: list[str] = []
            for i in range(QB_FILE_COUNT):
                p = os.path.join(tmp, f"qb_{i}.xlsx")
                download_file(f"{JOB_ID}/qb_{i}.xlsx", p)
                qb_paths.append(p)

            stmt_paths: list[str] = []
            for i in range(STMT_FILE_COUNT):
                ext = STMT_FILE_EXTS[i] if i < len(STMT_FILE_EXTS) else "pdf"
                p = os.path.join(tmp, f"statement_{i}.{ext}")
                download_file(f"{JOB_ID}/statement_{i}.{ext}", p)
                stmt_paths.append(p)

            print(f"[{JOB_ID}] Parsing — vendor: {VENDOR_KEY}")
            parser    = get_parser(VENDOR_KEY)
            qb_stmts  = [load_qb(p) for p in qb_paths]
            qb_stmt   = merge_qb_statements(qb_stmts)
            vend_stmts = [parser.parse(p) for p in stmt_paths]
            vend_stmt  = merge_parsed_statements(vend_stmts)

            print(f"[{JOB_ID}] Running reconciliation…")
            result = reconcile(vend_stmt, qb_stmt)

            print(
                f"[{JOB_ID}] matched={len(result.matched)} "
                f"discrepancies={len(result.discrepancies)} "
                f"fuzzy={len(result.fuzzy_matches)} "
                f"stmt_only={len(result.stmt_only)} "
                f"qb_only={len(result.qb_only)}"
            )

            xlsx_path = f"{JOB_ID}/result.xlsx"
            json_path = f"{JOB_ID}/result.json"

            print(f"[{JOB_ID}] Uploading Excel and JSON results…")
            upload_bytes(
                xlsx_path,
                export_to_excel(result),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            upload_bytes(
                json_path,
                result.to_json(),
                "application/json",
            )

            update_job(
                "done",
                result_file_path=xlsx_path,
                result_json_path=json_path,
                matched_count=len(result.matched),
                mismatch_count=len(result.discrepancies),
                fuzzy_match_count=len(result.fuzzy_matches),
                stmt_only_count=len(result.stmt_only),
                qb_only_count=len(result.qb_only),
                stmt_total=result.stmt_total,
                qb_total=result.qb_total,
            )
            print(f"[{JOB_ID}] Done.")

    except Exception as exc:
        print(f"[{JOB_ID}] ERROR: {exc}", file=sys.stderr)
        import traceback; traceback.print_exc()
        update_job("error", error_message=str(exc))
        sys.exit(1)


if __name__ == "__main__":
    main()
