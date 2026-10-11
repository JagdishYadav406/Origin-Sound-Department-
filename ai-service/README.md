# OSD AI Sound Director service

This is an optional, self-hostable backend for sampled-frame visual analysis. It is not part of GitHub Pages hosting; the static browser cannot keep provider API keys secret.

## Requirements

- Node.js 20 or newer
- An OpenAI API key with access to the configured vision-capable model
- A long random service token that you keep private
- HTTPS and a deployment-level access policy for any public deployment

## Configure and run

Set these environment variables on the server only:

- `OPENAI_API_KEY`: provider key; never put it in the web page or repository.
- `OSD_SERVICE_TOKEN`: bearer token required by `POST /v1/analyze`.
- `OSD_ALLOWED_ORIGINS`: comma-separated exact origins allowed to call the service, e.g. `https://YOUR-USERNAME.github.io`. CORS is a browser policy, not authentication.
- `OSD_AI_MODEL`: optional model override; default is `gpt-4.1-mini`.
- `PORT`: optional listening port; default `8787`.

Then run:

```sh
node ai-service/server.mjs
```

Check `GET /v1/health`. It reports whether provider/service configuration exists, never the secrets. The analysis endpoint expects an Authorization bearer token that matches `OSD_SERVICE_TOKEN`.

## Request shape

```json
{
  "durationSeconds": 42.5,
  "intent": "Keep dialogue clear; restrained cinematic tension.",
  "frames": [
    {
      "timestampSeconds": 0,
      "imageDataUrl": "data:image/jpeg;base64,..."
    }
  ]
}
```

The service accepts at most 12 sampled frames, a clip duration up to 600 seconds, a 10 MiB request, and a bounded number of concurrent/rate-limited requests. The browser implementation currently sends up to eight resized JPEG frames after explicit consent. It does **not** upload the original video or its soundtrack.

## Scope and limitations

The service produces time-coded visual scene observations and suggested BGM/SFX/ambience cues. Sparse images cannot prove continuous action or exact cuts. The service explicitly labels its coverage as sampled-frame visual analysis only; audio is not analyzed. Search terms are not library matches, and this service does not download, license-check, or mix any sound asset.

No job data is intentionally persisted by this service. The provider request uses `store: false`, but provider handling still depends on account and service terms. Deployments should add suitable access controls, request accounting, and deletion/retention policy before public use.

## Test

```sh
node --test ai-service/server.test.mjs
```

The tests use a fake provider response; they do not spend API credits or prove that a real provider key/model is available. Do not merge or deploy based only on the fake-provider test: run the web browser smoke test and a consented real-service test as separate acceptance checks.
