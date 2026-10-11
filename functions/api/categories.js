import { CATEGORIES } from "../../src/clip-validation.js";

export function onRequestGet() {
  return Response.json({ categories: CATEGORIES });
}
