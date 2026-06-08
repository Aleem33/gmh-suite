# Hostinger Subdomain Deployment

Use this when the main business website must stay on the root domain and GMH Suite should run on a Hostinger subdomain such as `gmh.yourdomain.com`.

## Hostinger Setup

1. Open Hostinger hPanel.
2. Go to **Websites** and open **Dashboard** for the existing business domain.
3. Open **Subdomains**.
4. Create subdomain `gmh`.
5. Use a separate folder for the subdomain, for example `public_html/gmh`, so the existing business website is not touched.
6. In **File Manager**, open the folder assigned to `gmh`.
7. Upload the contents of this repo's `dist` folder into that subdomain folder.

Do not upload the `dist` folder itself. Upload the files inside it, including `index.html`, `assets`, `logo.png`, and `.htaccess`.

## Build Files

From this repo:

```bash
npm run build
```

The deployable files are created in `dist`.

The included `public/.htaccess` is copied into `dist` during the build. It keeps Hostinger from returning 404 for app paths and lets the React app load `index.html`.

## Firebase Auth

Firebase must trust the subdomain before employee login works:

1. Open Firebase Console.
2. Go to **Authentication**.
3. Open **Settings**.
4. Open **Authorized domains**.
5. Add `gmh.yourdomain.com`.

Replace `yourdomain.com` with the real business domain.

## Test

1. Open `https://gmh.yourdomain.com`.
2. Log in as admin.
3. Open a hospital page and a pharmacy page.
4. Test a direct hash route such as `https://gmh.yourdomain.com/#/pharmacy/billing`.
5. Refresh the page and confirm the app still loads.

GMH Suite currently uses hash routing for Windows, Android, and static hosting compatibility, so deep links should use `/#/`, not plain `/pharmacy/billing`.
