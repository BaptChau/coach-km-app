# COACH-KM-APP

This is an application for french association where coaches can deduct the kilometers done for the assocition from their taxes
## Run it

- **With Docker** (API + nginx reverse proxy serving the PWA): `cp .env.example .env`, set `JWT_SECRET`,
  then `docker compose up -d --build` and open http://localhost:8080. Details and the security setup:
  [docker/README.md](docker/README.md).
- **For development:** the API is described in [api/API.md](api/API.md); the front (with a mock API)
  in [front/README.md](front/README.md).
