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
const galleryError = document.querySelector("#gallery-error");
const loadMore = document.querySelector("#btn-load-more");
const categorySelect = document.querySelector("#gallery_category");
const filterSelect = document.querySelector("#filter-category");
const pageSize = 20;
let page = 0;
let hasMore = true;
let loadingPage = false;
let galleryNeedsRefresh = false;

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
  if (gallerySelected && (galleryNeedsRefresh || galleryGrid.childElementCount === 0)) {
    galleryNeedsRefresh = false;
    loadClips(true);
  }
}

function showError(message) {
  errorArea.textContent = message;
  errorArea.classList.remove("hidden");
}

function createClipCard(clip) {
  const card = document.createElement("article");
  card.className = "clip-card";
  const media = clip.mediaUrl
    ? document.createElement(clip.mediaType.startsWith("video/") ? "video" : "img")
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
  }

  const content = document.createElement("div");
  content.className = "clip-content";
  const title = document.createElement("h3");
  title.textContent = clip.caption;
  const category = document.createElement("p");
  category.className = "clip-category";
  category.textContent = clip.category;
  const author = document.createElement("p");
  author.textContent = `Autor: ${clip.name}`;
  content.append(title, category, author);

  if (clip.videoUrl) {
    const link = document.createElement("a");
    link.href = clip.videoUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Otwórz klip";
    content.append(link);
  }

  const actions = document.createElement("div");
  actions.className = "clip-actions";
  const count = document.createElement("span");
  count.textContent = `Głosy: ${clip.votes}`;
  const vote = document.createElement("button");
  vote.type = "button";
  vote.className = `btn-secondary vote-button${clip.hasVoted ? " voted" : ""}`;
  vote.textContent = clip.hasVoted ? "Oddano głos" : "Głosuj";
  vote.disabled = clip.hasVoted;
  vote.addEventListener("click", async () => {
    vote.disabled = true;
    try {
      const response = await fetch(`/api/clips/${encodeURIComponent(clip.id)}/vote`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Nie udało się oddać głosu.");
      count.textContent = `Głosy: ${result.votes}`;
      vote.textContent = "Oddano głos";
      vote.classList.add("voted");
    } catch (error) {
      vote.disabled = false;
      window.alert(error.message);
    }
  });
  actions.append(count, vote);
  content.append(actions);
  card.append(content);
  return card;
}

async function loadClips(reset = false) {
  if (loadingPage || (!hasMore && !reset)) return;
  loadingPage = true;
  loading.classList.remove("hidden");
  empty.classList.add("hidden");
  galleryError.classList.add("hidden");
  filterSelect.disabled = true;
  if (reset) {
    page = 0;
    hasMore = true;
    galleryGrid.replaceChildren();
  }
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
  if (filterSelect.value) params.set("category", filterSelect.value);
  try {
    const response = await fetch(`/api/clips?${params}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się załadować galerii.");
    for (const clip of result.clips) galleryGrid.append(createClipCard(clip));
    hasMore = result.hasMore;
    page += 1;
    empty.classList.toggle("hidden", galleryGrid.childElementCount !== 0);
    loadMore.classList.toggle("hidden", !hasMore);
  } catch (error) {
    galleryError.textContent = error.message;
    galleryError.classList.remove("hidden");
  } finally {
    loading.classList.add("hidden");
    loadingPage = false;
    filterSelect.disabled = false;
  }
}

document.querySelector("#btn-tab-submit").addEventListener("click", () => showTab("submit"));
document.querySelector("#btn-tab-gallery").addEventListener("click", () => showTab("gallery"));
document.querySelector("#btn-go-gallery").addEventListener("click", () => showTab("gallery"));
document.querySelector("#btn-submit-another").addEventListener("click", () => {
  form.reset();
  successArea.classList.add("hidden");
  submitArea.classList.remove("hidden");
  errorArea.classList.add("hidden");
});
filterSelect.addEventListener("change", () => loadClips(true));
loadMore.addEventListener("click", () => loadClips());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorArea.classList.add("hidden");
  const media = document.querySelector("#media").files[0];
  const videoUrl = document.querySelector("#video_url").value.trim();
  if (Boolean(media) === Boolean(videoUrl)) {
    showError("Wybierz plik albo podaj link do klipu — nie oba naraz.");
    return;
  }

  const submitButton = document.querySelector("#btn-submit-clip");
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/clips", { method: "POST", body: new FormData(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nie udało się wysłać zgłoszenia.");
    galleryNeedsRefresh = true;
    submitArea.classList.add("hidden");
    successArea.classList.remove("hidden");
  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
  }
});
