export const CATEGORIES = Object.freeze([
  "Niefart roku",
  "Fart roku",
  "Moment radości",
  "Ucięty shot",
  "Cringe roku",
  "Najlepsze zagranie roku",
  "Zwrot akcji",
  "Rizz roku",
  "Schiza roku",
  "Najlepszy voice actor",
  "Najlepszy horror Roblox",
  "Piękny steal",
  "Najstraszniejszy klip",
  "Najśmieszniejszy klip",
  "Najlepszy crashout",
  "Mucha",
  "Pentakill",
  "Aura",
]);

export class ValidationError extends Error {}

function readText(value, label, maxLength) {
  if (typeof value !== "string") throw new ValidationError(`Pole „${label}” jest wymagane.`);
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new ValidationError(`Pole „${label}” musi mieć od 1 do ${maxLength} znaków.`);
  }
  return text;
}

export function validateClipInput(body, hasFile) {
  const caption = readText(body.caption, "tytuł klipu", 120);
  const category = readText(body.gallery_category, "kategoria", 80);
  const videoUrl = typeof body.video_url === "string" ? body.video_url.trim() : "";

  if (!CATEGORIES.includes(category)) {
    throw new ValidationError("Wybierz prawidłową kategorię.");
  }
  if (hasFile === Boolean(videoUrl)) {
    throw new ValidationError("Wybierz plik albo podaj link do klipu — nie oba naraz.");
  }
  if (videoUrl) {
    if (videoUrl.length > 2048) throw new ValidationError("Link do klipu jest za długi.");
    let parsedUrl;
    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      throw new ValidationError("Podaj prawidłowy link do klipu.");
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new ValidationError("Link do klipu musi zaczynać się od http:// lub https://.");
    }
  }

  return { caption, category, videoUrl: videoUrl || null };
}
