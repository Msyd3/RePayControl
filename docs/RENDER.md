# Temporary Render trial

The owner explicitly chose the FREE ephemeral trial after being told that data is lost on restart or redeploy. render.yaml uses plan: free and has no disk or other paid resource.

1. Create a Blueprint for Msyd3/RePayControl.
2. The owner enters ADMIN_PASSWORD in Render only. Render generates SESSION_SECRET and SERVER_INGEST_KEY.
3. Verify /health and admin login. data/control.sqlite is ephemeral in this trial.
4. Re-run the GitHub Pages workflow with the actual API origin from Render. Keep ADMIN_FRONTEND_ORIGIN=https://control.repay.sa. DNS and HTTPS for the frontend remain unchanged.
5. Point the consent-based website collectors at the actual API origin. WhatsApp and financial data need their separate authorized upstream connections.
6. Never commit customer snapshots, databases, passwords, or ingestion keys to GitHub.

## Migration

The app is independent of Render and includes a Dockerfile. Preserve environment variables and secrets outside images. Export a consistent database before moving, with writes paused during final cutover. SQLite needs durable storage; Google Cloud Run's temporary container filesystem is not a durable database. Choose durable storage or migrate to a managed database before moving there.
