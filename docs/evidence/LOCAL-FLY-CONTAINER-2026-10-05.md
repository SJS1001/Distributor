# Local Fly container verification — 2026-10-05

Scope: local Linux/amd64 Docker packaging only. No Fly deployment or acceptance gate verified.

Base HEAD: `bfb82337ea6938088283610c0e8c18a4373ff837`
Image: `sha256:594f53178852269a661b99338890aded60c15e7200eba452b2692b8e69c0a3aa`

## Outcomes

- Missing persistent mount refuses startup.
- CA/CAD bootstrap succeeds using protected stdin.
- PID 1 runs as uid 1000; native canvas works: v24.16.0 linux/x64.
- Built frontend, health, authentication, Secure cookie and warehouse write pass.
- New container on same volume preserves login and exact warehouse replay.
- Both SIGTERM shutdowns exit 0 without OOM or forced kill.

Fly configuration validation and entrypoint shell syntax checks passed. Existing Vite bundle-size warning remains.

## Deployment inputs

- `Dockerfile`: `ccadc08b2e2d5b1ec1d0765d55fbc0957bd2230f6e62aa18fc45614d440a2047`
- `.dockerignore`: `56836e3817ff771b104d267e32eb786cdaea2b9a41ab2cb1b6f41c30fbfee9f9`
- `fly.toml`: `054add158620c0ab57f4ceebdb7fb00c8e01bfb6bfb1c3e0614c6d70f8d1f7d5`
- `scripts/container-entrypoint.sh`: `e6684cce632b418b4607641266d36514d7fd210bdbe453562b0f80e88ff9c0e6`

Local linux/amd64 Docker packaging smoke only; no Fly deployment, TLS edge, backup restore, browser journey, full suite, providers or acceptance gates verified.

The synthetic test container and volume were removed. Private receipts remain under ignored `local-evidence/fly-preflight/`. Provisioning and recurring charges await owner approval.
