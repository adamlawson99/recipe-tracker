Read the recipe at the URL / video I give you and output ONLY a JSON object (no prose, no markdown fences) in exactly this shape:

{
  "title": "string (required)",
  "source": "URL of the page or video",
  "description": "1-2 sentence summary",
  "categories": ["dinner"],
  "tags": ["short lowercase labels, e.g. high protein, pasta, fruit, vegetarian, 30 minutes"],
  "servings": 4,
  "ingredients": [
    { "quantity": 1.5, "unit": "cup", "name": "all-purpose flour", "note": "sifted" }
  ],
  "instructions": [
    "First step, as a complete sentence.",
    "Second step."
  ]
}

Rules:
- "quantity" is a number (use 0.5, not "1/2"); use null if unspecified ("salt to taste").
- "unit" is a short singular unit such as g, kg, ml, l, tsp, tbsp, cup, oz, lb, clove, pinch; use "" for countable items (e.g. 2 eggs).
- "name" is just the ingredient; put prep details like "chopped" or "room temperature" in "note".
- "categories" are meal types, e.g. breakfast, dinner, dessert, snack (other short lowercase labels like "side" or "drink" are fine).
- Keep instructions as separate steps without numbering prefixes.
- For a video, use the transcript/description if the recipe is given there; do not invent quantities that are not stated.
- To output several recipes, return a JSON array of such objects.
