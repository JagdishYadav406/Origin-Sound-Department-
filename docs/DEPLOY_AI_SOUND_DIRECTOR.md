# Deploy the optional OSD AI Sound Director

The web editor can run without AI. To enable visual and audio-aware cue proposals, deploy the separate `ai-service/` backend. The backend is not deployed by GitHub Pages.

## Fast path: Render Blueprint

1. Open the repository on GitHub and choose **Deploy to Render** only if the hosting provider offers the blueprint import flow for this repository; otherwise create a new **Blueprint** in Render and connect this repository.
2. Render should detect `render.yaml`. Review the service name and Singapore region, then create the service.
3. In the service's environment settings, provide:
   - `OPENAI_API_KEY`: your own provider API key, stored as a secret on the server only.
   - `OSD_SERVICE_TOKEN`: a long, random private token you generate and keep safe. Do not commit it to GitHub or share it.
4. Wait for the deploy to finish. Open `https://YOUR-SERVICE.onrender.com/v1/health`. A healthy configured service reports `status: ok` and `configured: true`. It does not return secret values. If `configured` is false, recheck the two server secrets.
5. In OSD, open **Sound Director**, enter the service base URL (the URL without `/v1/health`) and the same service token, and grant the relevant consent before starting an analysis.
6. In OSD, click **Test AI connection**. This checks `/v1/health`, shows whether server secrets are configured, and reports the configured model names. It does not spend model credits or prove the key has access.
7. The first visual analysis sends up to eight sampled frames; audio analysis separately sends the selected WAV/MP3 audio (up to 90 seconds and 4.5 MB) after separate consent. Review cue times and audition assets yourself.

## Important security and cost notes

- The provider API key belongs only in the hosting provider's secret settings. Never place it in `web/index.html`, project JSON, or a public commit.
- The browser must send the service token to call the backend. Treat that token as exposed to anyone who can use that browser session or inspect its network traffic. This blueprint is suitable for a personal, low-volume trial—not a multi-user public service. Rotate the token immediately if it may have been shared.
- The backend has basic IP rate and concurrency limits, not per-user identity, account quotas, or a hard provider-spend cap. Monitor provider usage. Do not share the service URL/token publicly.
- `OSD_ALLOWED_ORIGINS` permits the published GitHub Pages origin and local smoke-test origins. CORS is not authentication.
- A free hosting service may sleep when idle, have cold starts, and change availability or limits. First-request timeouts can be retried.
- Health success proves the server is running and secrets are configured; it does not prove that the provider key has usable credits/model access. A consented real analysis is a separate acceptance test.
- AI suggestions are proposals, not automatic edits. Sparse video frames cannot prove every event or cut; audio timestamps may be wrong. OSD does not claim to have found a real sound asset unless it is in your indexed library.
- The browser mixer still exports a WAV; it does not mux the final soundtrack into the video.

## Local service test

Use Node.js 20 or newer:

```sh
node --check ai-service/server.mjs
node --test ai-service/server.test.mjs
```

These tests use fake provider responses and do not incur API charges. They do not replace a real consented provider test or Android Chrome testing.
