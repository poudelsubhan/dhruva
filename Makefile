# Dhruva — developer entrypoints.
# GNU make 3.81 compatible (stock macOS). Recipes are tab-indented.
# Backend targets run through `uv run`, so no venv activation is needed.

SHELL := /bin/bash

BACKEND_PORT  ?= 8000
FRONTEND_PORT ?= 5173

.DEFAULT_GOAL := help

.PHONY: help install dev dev-backend dev-frontend test lint typecheck check build clean demo-mock demo demo-all measure

help:
	@echo ""
	@echo "  Dhruva — make targets"
	@echo ""
	@echo "    install       install backend (uv sync) and frontend (npm) dependencies"
	@echo "    dev           boot backend + frontend together (Ctrl-C stops both)"
	@echo "    dev-backend   boot the FastAPI backend only  (port $(BACKEND_PORT))"
	@echo "    dev-frontend  boot the Vite frontend only    (port $(FRONTEND_PORT))"
	@echo "    test          pytest (backend) then vitest (frontend)"
	@echo "    lint          ruff check + ruff format --check, then oxlint"
	@echo "    typecheck     mypy then tsc"
	@echo "    check         lint + typecheck + test"
	@echo "    build         production build of the frontend"
	@echo "    clean         remove caches, dist, and run artifacts"
	@echo "    demo-mock     regenerate the mock run logs"
	@echo "    demo          one scenario end to end, offline (SCENARIO=s1|s2|s3)"
	@echo "    demo-all      all three scenarios twice; proves determinism"
	@echo "    measure       eviction precision vs naive policies"
	@echo ""

install:
	uv sync --all-groups
	@if [ -f frontend/package-lock.json ]; then \
		npm --prefix frontend ci; \
	else \
		echo "no frontend/package-lock.json — falling back to npm install"; \
		npm --prefix frontend install; \
	fi

dev:
	@echo ""
	@echo "  Dhruva dev stack"
	@echo "    backend   http://localhost:$(BACKEND_PORT)   (health: /api/health)"
	@echo "    frontend  http://localhost:$(FRONTEND_PORT)"
	@echo "    Ctrl-C stops both."
	@echo ""
	@set -m; \
	back=""; front=""; \
	trap 'trap - INT TERM EXIT; echo ""; echo "  stopping dev stack..."; \
	      for p in $$back $$front; do \
	        kill -TERM -$$p 2>/dev/null || kill -TERM $$p 2>/dev/null; \
	      done; \
	      wait 2>/dev/null; exit 0' INT TERM EXIT; \
	uv run uvicorn backend.main:app --reload --port $(BACKEND_PORT) & \
	back=$$!; \
	npm --prefix frontend run dev -- --port $(FRONTEND_PORT) & \
	front=$$!; \
	wait

dev-backend:
	uv run uvicorn backend.main:app --reload --port $(BACKEND_PORT)

dev-frontend:
	npm --prefix frontend run dev -- --port $(FRONTEND_PORT)

test:
	uv run pytest backend -q
	npm --prefix frontend run test

lint:
	uv run ruff check .
	uv run ruff format --check .
	npm --prefix frontend run lint

typecheck:
	uv run mypy backend
	npm --prefix frontend run typecheck

check: lint typecheck test
	@echo "  check: lint + typecheck + test passed"

build:
	npm --prefix frontend run build

clean:
	@rm -rf .pytest_cache .mypy_cache .ruff_cache frontend/dist frontend/node_modules/.vite
	@find . -path ./.venv -prune -o -path ./frontend/node_modules -prune -o \
		-type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@find . -path ./.venv -prune -o -type f -name '*.pyc' -exec rm -f {} + 2>/dev/null || true
	@if [ -d runs ]; then find runs -mindepth 1 ! -name .gitkeep -delete; fi
	@echo "  clean: caches, dist, and runs/* removed (runs/.gitkeep kept)"

demo-mock:
	uv run python scripts/mock_run.py --out fixtures/mock

demo:
	uv run python scripts/demo_scenario.py --scenario $(or $(SCENARIO),s2)

measure:
	@for s in s1 s2 s3; do uv run python scripts/measure_retention.py --scenario $$s; done

demo-all:
	@for s in s1 s2 s3; do \
		a=$$(uv run python scripts/demo_scenario.py --scenario $$s 2>&1 | grep -vE 'log:|events:' | sed 's/[0-9a-f]\{16\}/ID/g'); \
		b=$$(uv run python scripts/demo_scenario.py --scenario $$s 2>&1 | grep -vE 'log:|events:' | sed 's/[0-9a-f]\{16\}/ID/g'); \
		if [ "$$a" = "$$b" ]; then echo "  $$s: deterministic across two consecutive runs"; \
		else echo "  $$s: DIVERGED"; exit 1; fi; \
	done
