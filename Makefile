.PHONY: up dev down logs test migrate pull setup

setup:
	@test -f .env || (cp .env.example .env && echo "✓ Created .env from .env.example — fill in your credentials")
	@test -f .env && echo "✓ .env already exists"
	@mkdir -p frontend/certs
	@test -f frontend/certs/localhost.pem || (mkcert -install && mkcert \
	  -key-file frontend/certs/localhost-key.pem \
	  -cert-file frontend/certs/localhost.pem \
	  localhost 127.0.0.1 && echo "✓ TLS certs generated in frontend/certs/")
	@test -f frontend/certs/localhost.pem && echo "✓ TLS certs already exist"

up:
	docker compose up --build -d

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

down:
	docker compose down

logs:
	docker compose logs -f

test:
	docker compose exec backend pytest tests/ -v

migrate:
	@for f in backend/db/migrations/*.sql; do \
	  echo "Running $$f..."; \
	  docker compose exec -T postgres psql -U app -d ai_workforce < $$f; \
	done

pull:
	docker compose pull
