import json
import os
import re
import sqlite3
from contextlib import contextmanager
from fractions import Fraction
from pathlib import Path
from typing import Any, Optional, Union

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

DB_PATH = os.environ.get("DB_PATH", "/data/recipes.db")
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DEFAULT_CATEGORIES = ["breakfast", "dinner", "dessert", "snack"]  # suggested until used/added

UNICODE_FRACTIONS = {
    "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
    "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6",
    "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}


def parse_quantity(value: Any) -> Optional[float]:
    """Accept numbers or strings like '1 1/2', '½', '1½', '0.5', '2-3' (uses the low end)."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    for ch, rep in UNICODE_FRACTIONS.items():
        text = text.replace(ch, " " + rep)
    text = re.split(r"\s*(?:-|–|to)\s*", text)[0].strip()
    try:
        return float(sum(Fraction(p) for p in text.split()))
    except (ValueError, ZeroDivisionError):
        raise ValueError(f"Cannot parse quantity: {value!r}")


def clean_list(values: Any) -> list[str]:
    if values is None:
        return []
    if isinstance(values, str):
        values = [v for v in values.split(",")]
    seen, out = set(), []
    for v in values:
        v = str(v).strip().lower()
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


class Ingredient(BaseModel):
    quantity: Optional[float] = None
    unit: str = ""
    name: str
    note: str = ""

    @field_validator("quantity", mode="before")
    @classmethod
    def _qty(cls, v):
        return parse_quantity(v)

    @field_validator("unit", "note", mode="before")
    @classmethod
    def _str(cls, v):
        return "" if v is None else str(v).strip()


class RecipeIn(BaseModel):
    title: str = Field(min_length=1)
    source: str = ""
    description: str = ""
    categories: list[str] = []
    tags: list[str] = []
    servings: Optional[float] = None
    instructions: list[str] = []
    ingredients: list[Ingredient] = []

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v):
        return str(v or "").strip()

    @field_validator("source", "description", mode="before")
    @classmethod
    def _text(cls, v):
        return "" if v is None else str(v).strip()

    @field_validator("categories", "tags", mode="before")
    @classmethod
    def _lists(cls, v):
        return clean_list(v)

    @field_validator("servings", mode="before")
    @classmethod
    def _servings(cls, v):
        return parse_quantity(v)

    @field_validator("instructions", mode="before")
    @classmethod
    def _steps(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            v = v.split("\n")
        steps = []
        for s in v:
            s = re.sub(r"^\s*(?:step\s*)?\d+[.):]\s*", "", str(s).strip(), flags=re.I)
            if s:
                steps.append(s)
        return steps

    @field_validator("ingredients", mode="before")
    @classmethod
    def _ingredients(cls, v):
        # Allow plain strings ("2 eggs") as a fallback from sloppy AI output.
        out = []
        for item in v or []:
            out.append({"name": item} if isinstance(item, str) else item)
        return out


class Recipe(RecipeIn):
    id: int
    created_at: str
    updated_at: str


# ---------- database ----------

SCHEMA = """
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    servings REAL,
    categories TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    instructions TEXT NOT NULL DEFAULT '[]',
    ingredients TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@contextmanager
def db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.executescript(SCHEMA)


def row_to_recipe(row: sqlite3.Row) -> dict:
    d = dict(row)
    for k in ("categories", "tags", "instructions", "ingredients"):
        d[k] = json.loads(d[k])
    return d


def values(r: RecipeIn) -> tuple:
    return (
        r.title, r.source, r.description, r.servings,
        json.dumps(r.categories), json.dumps(r.tags),
        json.dumps(r.instructions),
        json.dumps([i.model_dump() for i in r.ingredients]),
    )


def insert(conn, r: RecipeIn) -> int:
    cur = conn.execute(
        "INSERT INTO recipes (title, source, description, servings, categories, tags,"
        " instructions, ingredients) VALUES (?,?,?,?,?,?,?,?)",
        values(r),
    )
    return cur.lastrowid


# ---------- app ----------

app = FastAPI(title="Recipe Tracker")
init_db()


@app.get("/api/recipes", response_model=list[Recipe])
def list_recipes(
    category: list[str] = Query(default=[]),
    tag: list[str] = Query(default=[]),
    q: str = "",
):
    """Filter: all selected categories AND all selected tags must match."""
    with db() as conn:
        rows = conn.execute("SELECT * FROM recipes ORDER BY title COLLATE NOCASE").fetchall()
    cats = {c.lower() for c in category}
    tags = {t.lower() for t in tag}
    needle = q.strip().lower()
    out = []
    for row in rows:
        r = row_to_recipe(row)
        if not cats <= set(r["categories"]) or not tags <= set(r["tags"]):
            continue
        if needle:
            hay = " ".join([r["title"], r["description"], r["source"], *r["tags"],
                            *(i["name"] for i in r["ingredients"])]).lower()
            if needle not in hay:
                continue
        out.append(r)
    return out


@app.get("/api/recipes/{recipe_id}", response_model=Recipe)
def get_recipe(recipe_id: int):
    with db() as conn:
        row = conn.execute("SELECT * FROM recipes WHERE id=?", (recipe_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Recipe not found")
    return row_to_recipe(row)


@app.post("/api/recipes", response_model=Recipe, status_code=201)
def create_recipe(recipe: RecipeIn):
    with db() as conn:
        new_id = insert(conn, recipe)
    return get_recipe(new_id)


@app.put("/api/recipes/{recipe_id}", response_model=Recipe)
def update_recipe(recipe_id: int, recipe: RecipeIn):
    with db() as conn:
        cur = conn.execute(
            "UPDATE recipes SET title=?, source=?, description=?, servings=?, categories=?,"
            " tags=?, instructions=?, ingredients=?, updated_at=datetime('now') WHERE id=?",
            (*values(recipe), recipe_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Recipe not found")
    return get_recipe(recipe_id)


@app.delete("/api/recipes/{recipe_id}", status_code=204)
def delete_recipe(recipe_id: int):
    with db() as conn:
        cur = conn.execute("DELETE FROM recipes WHERE id=?", (recipe_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Recipe not found")


@app.get("/api/meta")
def meta():
    """All categories (defaults + any in use) and tags with counts, for the filter/form UI."""
    with db() as conn:
        rows = conn.execute("SELECT categories, tags FROM recipes").fetchall()
    tag_counts: dict[str, int] = {}
    cat_counts = {c: 0 for c in DEFAULT_CATEGORIES}
    for row in rows:
        for t in json.loads(row["tags"]):
            tag_counts[t] = tag_counts.get(t, 0) + 1
        for c in json.loads(row["categories"]):
            cat_counts[c] = cat_counts.get(c, 0) + 1
    return {"categories": dict(sorted(cat_counts.items())), "tags": dict(sorted(tag_counts.items()))}


class ImportRequest(BaseModel):
    data: Union[dict, list]
    dry_run: bool = False


@app.post("/api/import")
def import_recipes(req: ImportRequest):
    """Import one recipe object, an array of them, or {"recipes": [...]}.

    Each recipe is validated independently; failures are reported, not fatal.
    With dry_run=true nothing is saved (used for the preview step).
    """
    data = req.data
    if isinstance(data, dict) and isinstance(data.get("recipes"), list):
        data = data["recipes"]
    items = data if isinstance(data, list) else [data]

    created, errors, preview = [], [], []
    with db() as conn:
        for idx, item in enumerate(items):
            try:
                if not isinstance(item, dict):
                    raise ValueError("Recipe must be a JSON object")
                recipe = RecipeIn.model_validate(item)
            except Exception as e:
                msg = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()) \
                    if hasattr(e, "errors") else str(e)
                errors.append({"index": idx, "title": item.get("title") if isinstance(item, dict) else None,
                               "error": msg})
                continue
            dup = conn.execute("SELECT id FROM recipes WHERE lower(title)=lower(?)",
                               (recipe.title,)).fetchone()
            entry = {"index": idx, "title": recipe.title, "duplicate": bool(dup),
                     "recipe": recipe.model_dump()}
            preview.append(entry)
            if not req.dry_run:
                created.append({"id": insert(conn, recipe), "title": recipe.title,
                                "duplicate": bool(dup)})
    return {"dry_run": req.dry_run, "created": created, "preview": preview, "errors": errors}


@app.get("/api/export")
def export_recipes():
    with db() as conn:
        rows = conn.execute("SELECT * FROM recipes ORDER BY title COLLATE NOCASE").fetchall()
    out = []
    for row in rows:
        r = row_to_recipe(row)
        for k in ("id", "created_at", "updated_at"):
            r.pop(k)
        out.append(r)
    return JSONResponse(out, headers={"Content-Disposition": 'attachment; filename="recipes.json"'})


@app.get("/api/import-prompt", response_class=PlainTextResponse)
def import_prompt():
    return (BASE_DIR / "import_prompt.md").read_text()


@app.get("/healthz")
def healthz():
    return {"ok": True}


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
