const categories = [
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
];

const form = document.querySelector("#clip-form");
const submitArea = document.querySelector("#submit-form-area");
const successArea = document.querySelector("#submit-success-area");
const errorArea = document.querySelector("#form-error");
const galleryGrid = document.querySelector("#gallery-grid");
const loading = document.querySelector("#gallery-loading");
const empty = document.querySelector("#gallery-empty");
const searchEmpty = document.querySelector("#search-empty");
const galleryError = document.querySelector("#gallery-error");
const loadMore = document.querySelector("#btn-load-more");
const categorySelect = document.querySelector("#gallery_category");
const filterSelect = document.querySelector("#filter-category");
const gallerySearch = document.querySelector("#gallery-search");
const galleryCount = document.querySelector("#gallery-count");
const refreshButton = document.querySelector("#btn-refresh-gallery");
const mediaInput = document.querySelector("#media");
const mediaPreview = document.querySelector("#media-preview");
const toast = document.querySelector("#toast");
const pageSize = 20;
let page = 0;
let hasMore = true;
let loadingPage = false;
let galleryNeedsRefresh = false;
let galleryRequestId = 0;
let toastTimeout;
let previewUrl;

for (const category of categories) {
  const option = document.createElement("option");
  option.value = category;
  option.textContent = category;
  categorySelect.append(option);

  const filterOption = option.cloneNode(true);
  filterSelect.append(filterOption);
}

function showTab(tab) {
  const gallerySelected = tab === "gallery";
  document.querySelector("#section-submit").classList.toggle("hidden", gallerySelected);
  document.querySelector("#section-gallery").classList.toggle("hidden", !gallerySelected);
  document.querySelector("#btn-tab-submit").classList.toggle("active", !gallerySelected);
  document.querySelector("#btn-tab-gallery").classList.toggle("active", gallerySelected);
  document.querySelector("#btn-tab-submit").setAttribute("aria-selected", String(!gallerySelected));
  document.querySelector("#btn-tab-gallery").setAttribute("aria-selected", String(gallerySelected));
  if (gallerySelected && (galleryNeedsRefresh || galleryGrid.childElementCount === 0)) {
    galleryNeedsRefresh = false;
    loadClips(true);
  }
}

function showError(message) {
  errorArea.textContent = message;
  errorArea.classList.remove("hidden");
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  toastTimeout = window.setTimeout(() => toast.classList.add("hidden"), 3600);
}

function setMediaPreview(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  mediaPreview.replaceChildren();
  mediaPreview.classList.toggle("hidden", !file);
  document.querySelector(".media-option").classList.toggle("has-file", Boolean(file));
  if (!file) return;

  previewUrl = URL.createObjectURL(file);
  const preview = file.type.startsWith("video/") ? document.createElement("video") : document.createElement("img");
  preview.src = previewUrl;
  preview.setAttribute("aria-label", `Podgląd pliku ${file.name}`);
  if (preview instanceof HTMLVideoElement) {
    preview.muted = true;
    preview.playsInline = true;
  }

  const copy = document.createElement("div");
  copy.className = "media-preview-copy";
  const name = document.createElement("strong");
  name.textContent = file.name;
  const ready = document.createElement("span");
  ready.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB · gotowy do wysłania`;
  copy.append(name, ready);

  const clear = document.createElement("button");
  clear.className = "media-clear";
  clear.type = "button";
  clear.textContent = "Usuń";
  clear.addEventListener("click", () => {
    mediaInput.value = "";
    setMediaPreview(null);
  });
  mediaPreview.append(preview, copy, clear);
}

function createClipCard(clip) {
  const card = document.createElement("article");
  card.className = "clip-card";
  card.style.setProperty("--card-index", String(galleryGrid.childElementCount % pageSize));
  card.dataset.search = `${clip.caption} ${clip.name} ${clip.category}`.toLocaleLowerCase("pl");
  const media = clip.mediaUrl
    ? document.createElement(clip.mediaType?.startsWith("video/") ? "video" : "img")
    : null;
  if (media) {
    media.className = "clip-media";
    media.src = clip.mediaUrl;
    if (media instanceof HTMLVideoElement) {
      media.controls = true;
      media.preload = "metadata";
      media.playsInline = true;
    } else {
      media.alt = clip.caption;
      media.loading = "lazy";
    }
    card.append(media);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "clip-placeholder";
    const play = document.createElement("span");
    play.textContent = clip.videoUrl ? "↗" : "✦";
    placeholder.append(play);
    card.append(placeholder);
  }

  const content = document.createElement("div");
  content.className = "clip-content";
  const titleRow = document.createElement("div");
  titleRow.className = "clip-title-row";
  const title = document.createElement("h3");
  title.textContent = clip.caption;
  const rank = document.createElement("span");
  rank.className = "clip-rank";
  rank.textContent = `#${String(galleryGrid.childElementCount + 1).padStart(2, "0")}`;
  titleRow.append(title, rank);
  const category = document.createElement("p");
  category.className = "clip-category";
  category.textContent = clip.category;
  const author = document.createElement("p");
  author.className = "clip-author";
  author.textContent = `Autor: ${clip.name}`;
  content.append(titleRow, category, author);

  if (clip.videoUrl) {
    const link = document.createElement("a");
    link.className = "clip-open-link";
    link.href = clip.videoUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Otwórz klip ↗";
    content.append(link);
  }

  const actions = document.createElement("div");
  actions.className = "clip-actions";
  const count = document.createElement("span");
  count.className = "vote-count";
  const voteIcon = document.createElement("span");
  voteIcon.textContent = "✦";
  count.append(voteIcon, document.createTextNode(`${clip.votes} głosów`));
  const vote = document.createElement("button");
  vote.type = "button";
  vote.className = `btn-secondary vote-button${clip.hasVoted ? " voted" : ""}`;
  vote.textContent = clip.hasVoted ? "✓ Zagłosowano" : "✦ Głosuj";
  vote.disabled = clip.hasVoted;
  vote.addEventListener("click", async () => {
    vote.disabled = true;
    vote.textContent = "Wysyłanie…";
    try {
      const response = await fetch(`/api/clips/${encodeURIComponent(clip.id)}/vote`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Nie udało się oddać głosu.");
      voteIcon.textContent = "♥";
      count.lastChild.textContent = `${result.votes} głosów`;
      vote.textContent = "✓ Zagłosowano";
      vote.classList.add("voted");
      vote.classList.add("vote-pop");
      window.setTimeout(() => vote.classList.remove("vote-pop"), 400);
      showToast("Głos oddany! Dzięki za wsparcie ✦");
    } catch (error) {
      vote.disabled = clip.hasVoted;
      vote.textContent = clip.hasVoted ? "✓ Zagłosowano" : "✦ Głosuj";
      showToast(error.message, true);
    }
  });
  actions.append(count, vote);
  content.append(actions);
  card.append(content);
  if (clip.hasVoted) card.dataset.voted = "true";
  return card;
}

function applyGallerySearch() {
  const query = gallerySearch.value.trim().toLocaleLowerCase("pl");
  let matches = 0;
  for (const card of galleryGrid.children) {
    const visible = !query || card.dataset.search.includes(query);
    card.classList.toggle("filtered-out", !visible);
    if (visible) matches += 1;
  }
  searchEmpty.classList.toggle("hidden", !query || matches > 0 || galleryGrid.childElementCount === 0);
}

async function loadClips(reset = false) {
  if (loadingPage || (!hasMore && !reset)) return;
  loadingPage = true;
  const requestId = ++galleryRequestId;
  loading.classList.remove("hidden");
  empty.classList.add("hidden");
  searchEmpty.classList.add("hidden");
  galleryError.classList.add("hidden");
  filterSelect.disabled = true;
  refreshButton.classList.add("is-loading");
  if (reset) {
    page = 0;
    hasMore = true;
    galleryGrid.replaceChildren();
    galleryCount.textContent = "—";
  }
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  if (filterSelect.value) params.set("category", filterSelect.value);
  try {
    const response = await fetch(`/api/clips?${params}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Nie udało się załadować galerii.");
    if (requestId !== galleryRequestId) return;
    for (const clip of result.clips) galleryGrid.append(createClipCard(clip));
    hasMore = result.hasMore;
    page += 1;
    galleryCount.textContent = String(galleryGrid.childElementCount);
    empty.classList.toggle("hidden", galleryGrid.childElementCount !== 0);
    loadMore.classList.toggle("hidden", !hasMore);
    applyGallerySearch();
  } catch (error) {
    if (requestId !== galleryRequestId) return;
    galleryError.textContent = error.message;
    galleryError.classList.remove("hidden");
  } finally {
    if (requestId === galleryRequestId) {
      loading.classList.add("hidden");
      loadingPage = false;
      filterSelect.disabled = false;
      refreshButton.classList.remove("is-loading");
    }
  }
}

document.querySelector("#btn-tab-submit").addEventListener("click", () => showTab("submit"));
document.querySelector("#btn-tab-gallery").addEventListener("click", () => showTab("gallery"));
document.querySelector("#btn-go-gallery").addEventListener("click", () => showTab("gallery"));
document.querySelector("#hero-gallery-link").addEventListener("click", () => showTab("gallery"));
document.querySelector("#footer-top").addEventListener("click", (event) => {
  event.preventDefault();
  showTab("submit");
  window.scrollTo({ top: 0, behavior: "smooth" });
});
document.querySelector("#btn-submit-another").addEventListener("click", () => {
  form.reset();
  setMediaPreview(null);
  successArea.classList.add("hidden");
  submitArea.classList.remove("hidden");
  errorArea.classList.add("hidden");
});
filterSelect.addEventListener("change", () => {
  gallerySearch.value = "";
  loadClips(true);
});
gallerySearch.addEventListener("input", applyGallerySearch);
refreshButton.addEventListener("click", () => loadClips(true));
loadMore.addEventListener("click", () => loadClips());
mediaInput.addEventListener("change", () => setMediaPreview(mediaInput.files[0] || null));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorArea.classList.add("hidden");
  if (!form.reportValidity()) return;
  const media = mediaInput.files[0];
  const videoUrl = document.querySelector("#video_url").value.trim();
  if (Boolean(media) === Boolean(videoUrl)) {
    showError("Wybierz plik albo podaj link do klipu — nie oba naraz.");
    return;
  }

  const submitButton = document.querySelector("#btn-submit-clip");
  const originalLabel = submitButton.querySelector("span").textContent;
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Wysyłanie zgłoszenia…";
  try {
    const response = await fetch("/api/clips", { method: "POST", body: new FormData(form) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Nie udało się wysłać zgłoszenia.");
    galleryNeedsRefresh = true;
    submitArea.classList.add("hidden");
    successArea.classList.remove("hidden");
    showToast("Zgłoszenie wysłane — powodzenia w turnieju! ✦");
  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = originalLabel;
  }
});
