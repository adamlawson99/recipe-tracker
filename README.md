# Recipe Tracker

Self-hosted recipe manager: FastAPI + SQLite + a small vanilla-JS web UI, in one container.

```bash
docker compose up -d --build
```

Open http://localhost:25601. Data lives in the `recipe-data` Docker volume and survives rebuilds.
There is no authentication, so keep it on a trusted network (or put a reverse proxy in front).

## Features
- Create / edit / delete recipes (title, source, description, categories (free-form, reused across recipes), tags, servings, ingredients with quantity + unit, step list)
- Filter by category and tag (selected filters combine with AND) plus free-text search
- Servings scaling on the recipe page
- JSON import with preview, JSON export for backup (`/api/export`, same schema as import)

## Importing recipes with an AI agent
1. Open **Import** in the UI and click **Copy prompt** (also at `/api/import-prompt`).
2. Give the prompt plus a recipe URL/video to your agent; it returns JSON.
3. Paste or upload the JSON, check the preview, confirm.

Schema: see `example-recipe.json`. Import is lenient: quantities may be `"1 1/2"`, `"½"` or numbers;
a single object, an array, or `{"recipes": [...]}` all work; markdown code fences are stripped.
Agents can also POST straight to the API: `POST /api/import` with `{"data": <recipe or array>}`.

## API
Interactive docs at `/docs`. Main routes: `GET/POST /api/recipes`, `GET/PUT/DELETE /api/recipes/{id}`,
`GET /api/recipes?category=dinner&tag=pasta&q=chicken`, `POST /api/import`, `GET /api/export`.

## Local development without Docker
```bash
pip install -r requirements.txt
DB_PATH=./data/recipes.db uvicorn app.main:app --reload
```
