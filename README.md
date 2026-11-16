# Chore Chart

Family chore chart for the Fire TV, with a parent view for phones.

- `apps-script/Code.gs` is the backend. Paste it into script.google.com, run `setup`, then deploy it as a web app (Execute as: Me, Access: Anyone).
- `app/` is the Fire TV app. Every push to `main` builds a signed APK and publishes it under Releases.

## Setup
1. Add the web app URL as a repository secret named `WEB_APP_URL` (Settings → Secrets and variables → Actions).
2. Open Actions → "Build Fire TV app" → Run workflow.
3. On the Fire TV, use the Downloader app to open:
   `https://github.com/<owner>/<repo>/releases/latest/download/chore-chart.apk`

Phones use the web app URL followed by `?mode=parent`.
