#!/usr/bin/env bash
# check_supabase_boundaries.sh
#
# Read-only validation for the Supabase client boundary and migration-010
# preconditions. Never writes, never prints secret values, never queries
# Supabase.
#
# Exit codes:
#   0 - all checks pass
#   1 - one or more boundary violations (reviewer action required)
#   2 - script misconfiguration (missing dep, not in repo root, etc.)
#
# Related: docs/supabase-client-boundaries.md,
#          docs/supabase-remediation-checklist.md (sections 4, 6, 14).

set -u

# --------------------------------------------------------------------------
# preamble
# --------------------------------------------------------------------------

red()    { printf '\033[31m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
green()  { printf '\033[32m%s\033[0m\n' "$1"; }
cyan()   { printf '\033[36m%s\033[0m\n' "$1"; }

fail_count=0
warn_count=0

report_fail() {
  red "  FAIL: $1"
  fail_count=$((fail_count + 1))
}
report_warn() {
  yellow "  WARN: $1"
  warn_count=$((warn_count + 1))
}
report_pass() {
  green "  PASS: $1"
}

# --------------------------------------------------------------------------
# dependencies + repo-root guard
# --------------------------------------------------------------------------

if ! command -v rg >/dev/null 2>&1; then
  red "ripgrep (rg) not installed; required for secret/import scans"
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  red "git not installed; required for repo-root detection"
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "${repo_root}" ]; then
  red "not inside a git repository"
  exit 2
fi

cd "${repo_root}" || { red "cd to repo root failed"; exit 2; }

# Structural sanity: expected file layout for this repo.
if [ ! -d "src/lib" ] || [ ! -d "supabase/migrations" ]; then
  red "expected src/lib and supabase/migrations under repo root"
  red "current dir: ${repo_root}"
  exit 2
fi

cyan "checking Supabase client boundaries in ${repo_root}"
printf '\n'

# --------------------------------------------------------------------------
# helper: redact matched lines so we never print secret values
#
# rg --no-heading output looks like:
#   path:line:content
# we keep path:line and drop content when content may contain a key.
# --------------------------------------------------------------------------

redact_rg_output() {
  # read stdin, print "path:line" only, drop value
  awk -F: '{ if (NF >= 2) print $1 ":" $2 }'
}

# --------------------------------------------------------------------------
# check 1: src/lib/supabase-server.ts starts with `import "server-only";`
# --------------------------------------------------------------------------

cyan "1. server-only guard in src/lib/supabase-server.ts"
if [ ! -f "src/lib/supabase-server.ts" ]; then
  report_fail "src/lib/supabase-server.ts missing"
else
  # find the first non-blank, non-comment line — it must be `import "server-only";`
  # so the guard precedes every other import / code statement. Header comment
  # blocks are allowed above it.
  first_code="$(awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*\/\// { next }
    /^[[:space:]]*\/\*/ { in_block = 1; next }
    in_block && /\*\// { in_block = 0; next }
    in_block { next }
    { print; exit }
  ' src/lib/supabase-server.ts)"
  if printf '%s' "${first_code}" | grep -qE '^[[:space:]]*import[[:space:]]+"server-only";[[:space:]]*$'; then
    report_pass "first code statement is the server-only guard"
  else
    report_fail "src/lib/supabase-server.ts: first code statement is not 'import \"server-only\";'"
    yellow "        first non-comment line was: ${first_code}"
  fi
fi
printf '\n'

# --------------------------------------------------------------------------
# check 2: SERVICE_ROLE references live only in src/lib/supabase-server.ts
# --------------------------------------------------------------------------

cyan "2. SERVICE_ROLE appears only in src/lib/supabase-server.ts"
offenders="$(rg --no-heading -n 'SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE' src 2>/dev/null \
              | grep -v '^src/lib/supabase-server\.ts:' \
              | redact_rg_output || true)"
if [ -z "${offenders}" ]; then
  report_pass "SERVICE_ROLE confined to src/lib/supabase-server.ts"
else
  report_fail "SERVICE_ROLE found outside src/lib/supabase-server.ts (locations below, values redacted)"
  printf '%s\n' "${offenders}" | sed 's/^/       /'
fi
printf '\n'

# --------------------------------------------------------------------------
# check 3: NEXT_PUBLIC_SUPABASE_ANON_KEY references live only in
#          src/lib/supabase-browser.ts
# --------------------------------------------------------------------------

cyan "3. NEXT_PUBLIC_SUPABASE_ANON_KEY appears only in src/lib/supabase-browser.ts"
offenders="$(rg --no-heading -n 'NEXT_PUBLIC_SUPABASE_ANON_KEY' src 2>/dev/null \
              | grep -v '^src/lib/supabase-browser\.ts:' \
              | redact_rg_output || true)"
if [ -z "${offenders}" ]; then
  report_pass "NEXT_PUBLIC_SUPABASE_ANON_KEY confined to src/lib/supabase-browser.ts"
else
  report_fail "NEXT_PUBLIC_SUPABASE_ANON_KEY found outside src/lib/supabase-browser.ts"
  printf '%s\n' "${offenders}" | sed 's/^/       /'
fi
printf '\n'

# --------------------------------------------------------------------------
# check 4: no legacy @/lib/supabase imports (the deleted single-file client)
# --------------------------------------------------------------------------

cyan "4. no legacy @/lib/supabase or ./supabase imports remain"
# match imports that are NOT supabase-server or supabase-browser
legacy="$(rg --no-heading -n 'from "@/lib/supabase"|from "\./supabase"|from "\.\./lib/supabase"' src 2>/dev/null \
          | redact_rg_output || true)"
if [ -z "${legacy}" ]; then
  report_pass "no legacy bare @/lib/supabase imports"
else
  report_fail "legacy bare supabase imports still present"
  printf '%s\n' "${legacy}" | sed 's/^/       /'
fi
printf '\n'

# --------------------------------------------------------------------------
# check 5: no "use client" file imports supabase-server
# --------------------------------------------------------------------------

cyan "5. no client component imports supabase-server"
violations=""
while IFS= read -r f; do
  if head -n 3 "$f" | grep -qE '^[[:space:]]*"use client"'; then
    if rg -q '@/lib/supabase-server|\./lib/supabase-server|\.\./lib/supabase-server' "$f"; then
      violations="${violations}${f}\n"
    fi
  fi
done < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \))

if [ -z "${violations}" ]; then
  report_pass "no \"use client\" file imports supabase-server"
else
  report_fail "client components importing supabase-server (service_role would ship to browser)"
  printf '%b' "${violations}" | sed 's/^/       /'
fi
printf '\n'

# --------------------------------------------------------------------------
# check 6: service_role string does not appear in any file that also has
#          "use client" (belt-and-suspenders against check 5)
# --------------------------------------------------------------------------

cyan "6. no \"use client\" file mentions service_role"
violations=""
while IFS= read -r f; do
  if head -n 3 "$f" | grep -qE '^[[:space:]]*"use client"'; then
    if rg -q 'service_role|SERVICE_ROLE' "$f"; then
      violations="${violations}${f}\n"
    fi
  fi
done < <(find src -type f \( -name '*.ts' -o -name '*.tsx' \))

if [ -z "${violations}" ]; then
  report_pass "no \"use client\" file references service_role"
else
  report_fail "\"use client\" file references service_role (possible leak)"
  printf '%b' "${violations}" | sed 's/^/       /'
fi
printf '\n'

# --------------------------------------------------------------------------
# check 7: migration 010 exists
# --------------------------------------------------------------------------

cyan "7. migration 010 present on disk"
if [ -f "supabase/migrations/010_lockdown_anon_access.sql" ]; then
  report_pass "supabase/migrations/010_lockdown_anon_access.sql exists"
  yellow "  NOTE: existence of the migration file does NOT imply it has been"
  yellow "        applied. Whether 010 has actually been run against any"
  yellow "        Supabase project cannot be proven from the local filesystem."
  yellow "        Verify via docs/supabase-remediation-checklist.md section 11"
  yellow "        (V1-V4 queries) against the target project."
else
  report_fail "supabase/migrations/010_lockdown_anon_access.sql missing"
fi
printf '\n'

# --------------------------------------------------------------------------
# check 8: no JWT-shaped literals in tracked source or docs
#
# Supabase anon/service_role keys are JWTs that start with "eyJ" and are
# well over 40 chars. Any such literal in src/ or docs/ is suspicious.
# We intentionally do NOT print the match; redact to file:line.
# --------------------------------------------------------------------------

cyan "8. no JWT-shaped literals in src/, docs/, or scripts/"
jwt_hits="$(rg --no-heading -n 'eyJ[A-Za-z0-9_-]{40,}' src docs scripts 2>/dev/null \
            | redact_rg_output || true)"
if [ -z "${jwt_hits}" ]; then
  report_pass "no JWT-shaped literals found"
else
  report_fail "JWT-shaped literals present (values redacted)"
  printf '%s\n' "${jwt_hits}" | sed 's/^/       /'
fi
printf '\n'

# --------------------------------------------------------------------------
# check 9: no Stripe keys in tracked files
# --------------------------------------------------------------------------

cyan "9. no Stripe key literals in src/, docs/, or scripts/"
stripe_hits="$(rg --no-heading -n 'sk_live_[A-Za-z0-9]{10,}|sk_test_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}' src docs scripts 2>/dev/null \
               | redact_rg_output || true)"
if [ -z "${stripe_hits}" ]; then
  report_pass "no Stripe secret literals found"
else
  report_fail "Stripe secret literals present (values redacted)"
  printf '%s\n' "${stripe_hits}" | sed 's/^/       /'
fi
printf '\n'

# --------------------------------------------------------------------------
# check 10: .env.local is not tracked
# --------------------------------------------------------------------------

cyan "10. .env.local is git-ignored"
if git check-ignore -q .env.local 2>/dev/null; then
  report_pass ".env.local is git-ignored"
else
  if [ -f ".env.local" ]; then
    report_fail ".env.local exists but is NOT git-ignored"
  else
    report_warn ".env.local does not exist (ok, but confirm intended)"
  fi
fi
printf '\n'

# --------------------------------------------------------------------------
# optional: tsc note
# --------------------------------------------------------------------------

cyan "11. optional: TypeScript check"
if command -v pnpm >/dev/null 2>&1; then
  if [ -f "pnpm-lock.yaml" ]; then
    yellow "  NOTE: this script does NOT run tsc automatically. To typecheck, run:"
    yellow "        pnpm exec tsc --noEmit"
  fi
else
  yellow "  NOTE: pnpm not on PATH; skipping tsc hint"
fi
printf '\n'

# --------------------------------------------------------------------------
# summary
# --------------------------------------------------------------------------

printf 'summary: %d failure(s), %d warning(s)\n' "${fail_count}" "${warn_count}"

if [ "${fail_count}" -gt 0 ]; then
  red "boundary check FAILED - do not stage migration 010 until failures are resolved"
  exit 1
fi

green "boundary check PASSED - all rules intact"
exit 0
