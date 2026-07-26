# GMH Suite 3.2.0 - Hostinger MySQL Cutover

This release makes Hostinger MySQL the only live application database. Firebase Authentication and Firebase Storage remain enabled. Firestore is a write-only disaster-recovery mirror populated by a five-hour PHP cron worker.

Do not run old Firestore clients and the 3.2.0 MySQL clients at the same time. Do not configure automatic application fallback writes to Firestore.

## Deployment Files

- `gmh-hostinger-subdomain-v3.2.0.zip`: public web application. Its archive root contains `.htaccess`, `index.html`, `logo.png`, `assets/`, and `api/`.
- `gmh-hostinger-backend-v3.2.0.zip`: private PHP application, Composer dependencies, schema, CLI tools, tests, and deployment rules.
- `GMH-Suite-Setup-3.2.0.exe` and `GMH-Suite-3.2.0.exe`: Windows installer and portable client built with the absolute Hostinger API URL.
- `GMH-Suite-3.2.0-android-debug.apk`: installable Android test/client build produced with Java 21 in GitHub Actions.
- `backend/database/schema.sql`: MySQL/MariaDB schema.
- `backend/.env.example`: private environment template.
- `backend/deployment/firestore.rules.pre-mysql`: rules to retain for rollback.
- `backend/deployment/firestore.rules.mirror-only`: final client lockout rules.

## Private Layout

Use a layout equivalent to this, adjusting the Hostinger account and domain paths:

```text
/home/ACCOUNT/gmh-backend/                         private backend archive contents
/home/ACCOUNT/private/gmh-firebase-service-account.json
/home/ACCOUNT/private/gmh-backups/
/home/ACCOUNT/domains/DOMAIN/public_html/gmh/      frontend archive contents
```

Never place `.env`, the service-account JSON, database credentials, backup JSON, or the private backend source under `public_html`.

## GitHub Build Workflow

Use `.github/workflows/release.yml` for release tooling that is not installed locally. The workflow builds and retains the web archive, private backend archive, Windows clients, and Android APK from the same commit. Its PHP job also runs the unit suite and MariaDB integration tests before packaging.

Configure these repository settings before running it:

1. Add the existing `FIREBASE_CONFIG_JSON` Actions secret, or all of the individual Firebase public configuration secrets listed by `scripts/write-firebase-config.mjs`.
2. Add the Actions repository variable `VITE_API_BASE_URL` with the absolute URL ending in `/api`, for example `https://gmh.yourdomain.com/api`. A manual run can provide the same value through the `api_base_url` input.
3. Open **Actions**, choose **Build Release Artifacts**, select **Run workflow**, and enter `3.2.0` as the optional expected version.
4. Download the `hostinger-frontend`, `hostinger-backend`, `windows`, and `android` workflow artifacts after every job passes.

A manual run creates downloadable workflow artifacts without changing a GitHub Release. Pushing a matching tag such as `v3.2.0` additionally publishes the verified files to that GitHub Release. The workflow never uploads a patient-data backup, `.env`, database password, or Firebase service-account file.

The Android job intentionally uses GitHub's Ubuntu runner, Temurin Java 21, Android SDK 36, and Gradle caching. This avoids adding a second JDK or Android toolchain to a local workstation. The generated debug APK is installable for coordinated testing; configure a private Android signing workflow before public Play Store distribution.

## MySQL And PHP

1. In hPanel, create a MySQL database and user with a long unique password.
2. Import `backend/database/schema.sql` through phpMyAdmin or the MySQL command line.
3. Extract the backend archive to `/home/ACCOUNT/gmh-backend`.
4. Copy `backend/.env.example` to `/home/ACCOUNT/gmh-backend/.env` and enter the real database, domain, project, service-account, and backup paths.
5. Keep `BACKEND_FEATURE_ENABLED=true` only when the schema and credentials are ready.
6. If the archive does not contain `vendor/`, run `composer install --no-dev --classmap-authoritative` in the private backend directory.
7. Require PHP 8.3 with PDO MySQL, JSON, cURL, OpenSSL, mbstring, fileinfo, and sodium enabled.

Edit the public `api/.htaccess` and set the absolute private path if Hostinger does not expose `GMH_BACKEND_ROOT` globally:

```apache
SetEnv GMH_BACKEND_ROOT /home/ACCOUNT/gmh-backend
```

Then verify `https://SUBDOMAIN/api/v1/health` returns JSON with `status: ok`.

## Backup Validation And Import

The development backup `gmh-suite-backup-2026-07-18.json` contains 35 collection entries and 4,597 documents. Local dry-run validation found zero malformed documents and one legacy warning: purchase `1ukZuiYJhWXaYyGzAyJv` references missing medicine `PWFRHaCcDcdej4qG29FL`.

Before production cutover, stop all users and take a fresh Firestore backup from the existing Settings page. Upload it outside `public_html`, then run:

```bash
cd /home/ACCOUNT/gmh-backend
php scripts/validate-backup.php /home/ACCOUNT/private/gmh-final-cutover.json
php scripts/import-backup.php /home/ACCOUNT/private/gmh-final-cutover.json --dry-run
php scripts/import-backup.php /home/ACCOUNT/private/gmh-final-cutover.json --replace
```

Keep the validation manifest, collection counts, document count, and SHA-256 hash with the release record. Do not continue if the final backup has validation errors or unexplained count differences.

## Five-Hour Firestore Mirror

Test one manual run first:

```bash
php /home/ACCOUNT/gmh-backend/scripts/mirror-firestore.php --manual
```

Configure this Hostinger cron schedule:

```cron
0 */5 * * * /usr/bin/php /home/ACCOUNT/gmh-backend/scripts/mirror-firestore.php >> /home/ACCOUNT/private/gmh-mirror.log 2>&1
```

The worker takes a MySQL advisory lock, processes events in sequence, performs no Firestore reads, and leaves quota or temporary failures queued. Admin Settings shows the pending count, oldest event, last success, last run, and manual re-queue action.

## Coordinated Client Cutover

1. Announce a maintenance window and stop data entry on every web, Android, and Windows client.
2. Take and validate the fresh final Firestore JSON backup.
3. Import it into the empty production MySQL schema and compare counts/hashes.
4. Upload the 3.2.0 Hostinger frontend archive contents to the subdomain root.
5. Distribute the 3.2.0 Windows and Android builds. Native builds must be compiled with `VITE_API_BASE_URL=https://SUBDOMAIN/api`.
6. Log in as admin and verify patients, Billing, purchase, return approval, customer payment, IPD order, discharge, reports, and Settings.
7. Confirm the browser network panel performs no Firestore document requests. Firebase Auth and Storage traffic is expected.
8. Run and verify the mirror worker.
9. Deploy `backend/deployment/firestore.rules.mirror-only` only after every client is updated and MySQL workflows are confirmed.

## Rollback

Keep the 3.1.58 frontend/native artifacts and `firestore.rules.pre-mysql` until the acceptance window ends.

If rollback is required before any MySQL-only writes, disable the backend with `BACKEND_FEATURE_ENABLED=false`, restore the previous frontend/native clients, and redeploy `firestore.rules.pre-mysql`.

If MySQL has accepted writes, first stop all 3.2.0 clients and export MySQL:

```bash
php /home/ACCOUNT/gmh-backend/scripts/export-backup.php /home/ACCOUNT/private/gmh-mysql-rollback.json
```

Validate the export and restore it through the previous admin backup tool before reopening old clients. Never reopen Firestore clients before reconciling those MySQL changes, or stock, bills, balances, and approvals can split.

## Routine Backups

Keep automated Hostinger database backups enabled. Also run a private JSON export before upgrades:

```bash
php /home/ACCOUNT/gmh-backend/scripts/export-backup.php /home/ACCOUNT/private/gmh-backups/gmh-$(date +\%F).json
```

## Automatic GitHub Deployment

The `Build Release Artifacts` workflow can deploy the tested web and backend artifacts over SSH. Tagged releases deploy automatically. A manual workflow run deploys only when `deploy_hostinger` is enabled.

1. In hPanel, enable SSH/SFTP remote access and add a dedicated deployment public key.
2. In the GitHub repository, open **Settings > Secrets and variables > Actions**.
3. Add these repository secrets:
   - `HOSTINGER_SSH_HOST`: the Hostinger SSH IP or hostname.
   - `HOSTINGER_SSH_PORT`: normally `65002`.
   - `HOSTINGER_SSH_USER`: the hosting SSH username.
   - `HOSTINGER_SSH_PRIVATE_KEY`: the complete dedicated private key.
   - `HOSTINGER_SSH_KNOWN_HOSTS`: optional trusted `ssh-keyscan` output for the Hostinger host and port. When omitted, the GitHub runner records the host key on first use and then enables strict checking.
4. Add these repository variables:
   - `HOSTINGER_FRONTEND_PATH=/home/u457184656/domains/aleemcore.com/public_html/gmh`
   - `HOSTINGER_BACKEND_PATH=/home/u457184656/domains/aleemcore.com/gmh-backend`
   - `HOSTINGER_HEALTH_URL=https://gmh.aleemcore.com/api/v1/health`
5. Keep `FIREBASE_CONFIG_JSON` in GitHub Actions secrets and set repository variable `VITE_API_BASE_URL` to the absolute API URL used by Android and Windows.
6. Run **Actions > Build Release Artifacts > Run workflow**, enable `deploy_hostinger`, and enter the API URL. For normal releases, push a version-matching tag such as `v3.2.2` after CI passes.

The workflow references a GitHub environment named `production` for deployment history. Creating that environment is optional; use its protection rules for a manual approval gate when the repository plan supports them.

The workflow never uploads or removes the server `.env`, service-account key, database backup, or MySQL credentials. It uploads frontend assets before `index.html` and verifies the live health endpoint after deployment.

Delete expired `idempotency_keys` periodically and monitor `document_events` for `dead` events. A Firestore mirror error never rolls back a successful MySQL operation.

## MRN Integrity Repair

Release 3.2.2 makes patient creation and MRN allocation one atomic backend command. It also reconciles a missing or stale MRN counter against the highest active patient MRN before allocating a new number.

Use the **Repair Production MRNs** GitHub workflow only during a patient-registration maintenance window:

1. Run it in `dry-run` mode and review the PHI-free mappings and `planSha256`.
2. Keep registration paused and rerun it in `apply` mode with that exact SHA and confirmation `REPAIR_MRNS`.
3. The apply command locks MRN allocation, creates and verifies a private full backup under `BACKUP_DIRECTORY`, renumbers only newer duplicate patients, updates linked `patientMRN` fields, and verifies record counts before committing.
4. Run `dry-run` again. It must report zero duplicate groups and zero pending changes before registration reopens.

The same commands can be run over SSH from the private backend directory:

```bash
php scripts/repair-mrns.php --dry-run
php scripts/repair-mrns.php --apply --expected-plan-sha=DRY_RUN_SHA256
```
