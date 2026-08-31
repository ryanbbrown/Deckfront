# Render deployment

Status: implemented and validated (direct mode; one implementation writer).

## Goal

Deploy Deckfront as one Render Docker web service. The service serves the built Vite client and Node API, runs only the existing pretrained AI catalog, and persists games on a 1 GB disk.

## Decisions

- Use a multi-stage Node 22 Docker build. The build stage installs dependencies, builds Vite, and bundles the production server as one minified ESM file with the existing esbuild dependency.
- Use a distroless Node 22 final stage. Copy only the Vite `dist` directory, bundled server file, and empty `/var/data` mount directory. Do not copy project source, npm dependencies, scripts, tests, Rust, Modal files, package tools, or build tools.
- Keep `npm run dev` unchanged. `HEXDECK_STATIC_DIR` overrides the local static path only when production sets it.
- Set the image defaults to `HOST=0.0.0.0`, `/app/dist`, and `/var/data/games`. Keep `PORT` unset so Render supplies it.
- Define one `0.5c-512mb` Docker web instance from `main` in `render.yaml`, with `/api/health` as its health check and a 1 GB disk at `/var/data`.
- Keep the existing 30-kingdom pretrained catalog as the only AI selection path. Do not change game, AI, training, search, optimization, or balance behavior and artifacts.

## Validation

- Run the focused HTTP test, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:production`, and `git diff --check`.
- Build the final Docker image and export its filesystem. List the application and data paths and check that the image has no project source, npm dependencies, scripts, tests, Rust, Modal files, npm, shell, or build tools.
- Run the image with a writable host volume and a non-default `PORT`. Check `/api/health`, `/`, the 30 trained setup sets, local game creation, AI game creation, and the saved JSON file under the mounted `/var/data/games` path.
- Review the complete diff and confirm that no generated balance artifact changed.

## Acceptance

- Render can build and start the service from the root Blueprint without a separate build command.
- The final image contains only the Node runtime, production client files, bundled server, and empty data mount path.
- A game survives outside the container through the `/var/data` mount.
- Local development behavior is unchanged.
