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
  "Najstraszniejszy klip",
  "Najśmieszniejszy klip",
  "Najlepszy crashout",
  "Mucha",
  "Pentakill",
  "Aura",
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
const clipFormFields = document.querySelector("#clip-form-fields");
const submissionStatus = document.querySelector("#submission-status");
const gallerySubtitle = document.querySelector("#gallery-subtitle");
const adminLoginForm = document.querySelector("#admin-login-form");
const adminDashboard = document.querySelector("#admin-dashboard");
const adminLoginError = document.querySelector("#admin-login-error");
const adminSettingsError = document.querySelector("#admin-settings-error");
const adminClipsError = document.querySelector("#admin-clips-error");
const adminClipsList = document.querySelector("#admin-clips");
const adminVotingCategories = document.querySelector("#admin-voting-categories");
const pageSize = 20;
let page = 0;
let hasMore = true;
let loadingPage = false;
let siteSettings = null;
let adminPage = 0;
let adminHasMore = false;
let updatingSettings = false;

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
  const adminSelected = tab === "admin";
  document.querySelector("#section-submit").classList.toggle("hidden", gallerySelected || adminSelected);
  document.querySelector("#section-gallery").classList.toggle("hidden", !gallerySelected);
  document.querySelector("#section-admin").classList.toggle("hidden", !adminSelected);
  document.querySelector("#btn-tab-submit").classList.toggle("active", !gallerySelected && !adminSelected);
  document.querySelector("#btn-tab-gallery").classList.toggle("active", gallerySelected);
  document.querySelector("#btn-tab-admin").classList.toggle("active", adminSelected);
  if (gallerySelected) {
    refreshSiteSettings().then(() => loadClips(true));
  } else if (!adminSelected) {
    refreshSiteSettings();
  }
  if (adminSelected) loadAdminSession();
}

function applySiteSettings() {
  const uploadsEnabled = siteSettings?.uploadsEnabled === true;
  const votingEnabled = (siteSettings?.votingCategories?.length ?? 0) > 0;
  clipFormFields.disabled = !uploadsEnabled;
  gallerySubtitle.textContent = votingEnabled
    ? "Obejrzyj wszystkie zgłoszenia i oddaj swój głos na najlepszy klip w każdej z kategorii!"
    : "Obejrzyj wszystkie zgłoszenia z konkursu. Głosowanie jeszcze się nie rozpoczęło.";
  document.querySelector("#btn-tab-gallery").textContent = votingEnabled ? "Głosowanie i Galeria" : "Galeria";
  submissionStatus.textContent = siteSettings
    ? "Przesyłanie klipów jest obecnie wyłączone."
    : "Nie udało się pobrać ustawień konkursu. Odśwież stronę i spróbuj ponownie.";
  submissionStatus.classList.toggle("hidden", uploadsEnabled);
}

async function readJson(response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Wystąpił błąd. Spróbuj ponownie.");
  return result;
}

async function refreshSiteSettings() {
  try {
    siteSettings = await readJson(await fetch("/api/site-settings"));
  } catch {
    siteSettings = null;
  }
  applySiteSettings();
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
  content.append(title, category);

  if (clip.videoUrl) {
    const link = document.createElement("a");
    link.href = clip.videoUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Otwórz klip";
    content.append(link);
  }

  if (siteSettings?.votingCategories?.includes(clip.category)) {
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
        const result = await readJson(await fetch(`/api/clips/${encodeURIComponent(clip.id)}/vote`, { method: "POST" }));
        count.textContent = `Głosy: ${result.votes}`;
        vote.textContent = "Oddano głos";
        vote.classList.add("voted");
      } catch (error) {
        vote.disabled = false;
        if (error.message === "Głosowanie jest obecnie wyłączone.") {
          await refreshSiteSettings();
          loadClips(true);
        }
        window.alert(error.message);
      }
    });
    actions.append(count, vote);
    content.append(actions);
  }
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
document.querySelector("#btn-tab-admin").addEventListener("click", () => showTab("admin"));
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
    await readJson(await fetch("/api/clips", { method: "POST", body: new FormData(form) }));
    submitArea.classList.add("hidden");
    successArea.classList.remove("hidden");
  } catch (error) {
    showError(error.message);
    if (error.message === "Przesyłanie klipów jest obecnie wyłączone.") {
      await refreshSiteSettings();
    }
  } finally {
    submitButton.disabled = !siteSettings?.uploadsEnabled;
  }
});

function showAdminLogin() {
  adminLoginForm.classList.remove("hidden");
  adminDashboard.classList.add("hidden");
}

function showAdminDashboard() {
  adminLoginForm.classList.add("hidden");
  adminDashboard.classList.remove("hidden");
}

async function loadAdminSession() {
  try {
    const response = await fetch("/api/admin/session");
    if (!response.ok) {
      showAdminLogin();
      return;
    }
    const session = await readJson(response);
    siteSettings = session.settings;
    applySiteSettings();
    updateAdminSettingControls();
    showAdminDashboard();
    adminSettingsError.classList.add("hidden");
    adminClipsError.classList.add("hidden");
    await loadAdminClips(true);
  } catch (error) {
    showAdminLogin();
    adminLoginError.textContent = error.message;
    adminLoginError.classList.remove("hidden");
  }
}

function updateAdminSettingControls() {
  const uploadsEnabled = siteSettings?.uploadsEnabled === true;
  const votingCategories = siteSettings?.votingCategories ?? [];
  const votingEnabled = votingCategories.length > 0;
  document.querySelector("#admin-uploads-status").textContent = uploadsEnabled ? "Włączone" : "Wyłączone";
  document.querySelector("#admin-voting-status").textContent = uploadsEnabled
    ? "Aby zmieniać głosowanie, najpierw wyłącz przesyłanie klipów."
    : `Włączone w ${votingCategories.length} z ${categories.length} kategorii.`;
  const uploadsButton = document.querySelector("#btn-toggle-uploads");
  uploadsButton.textContent = uploadsEnabled ? "Wyłącz przesyłanie" : "Włącz przesyłanie";
  uploadsButton.disabled = updatingSettings;
  document.querySelector("#btn-enable-all-voting").disabled = updatingSettings || uploadsEnabled;
  document.querySelector("#btn-disable-all-voting").disabled = updatingSettings || uploadsEnabled || !votingEnabled;
  adminVotingCategories.replaceChildren(...categories.map((category) => {
    const row = document.createElement("div");
    row.className = "admin-voting-category";
    const label = document.createElement("span");
    label.textContent = category;
    const enabled = votingCategories.includes(category);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.textContent = enabled ? "Wyłącz" : "Włącz";
    button.disabled = updatingSettings || uploadsEnabled;
    button.setAttribute("aria-pressed", String(enabled));
    button.addEventListener("click", () => {
      updateAdminSetting("votingCategory", !enabled, category);
    });
    row.append(label, button);
    return row;
  }));
}

async function updateAdminSetting(setting, enabled, category) {
  updatingSettings = true;
  updateAdminSettingControls();
  adminSettingsError.classList.add("hidden");
  try {
    const result = await readJson(await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setting, enabled, ...(category ? { category } : {}) }),
    }));
    siteSettings = result.settings;
    applySiteSettings();
    updateAdminSettingControls();
    if (!document.querySelector("#section-gallery").classList.contains("hidden")) loadClips(true);
  } catch (error) {
    adminSettingsError.textContent = error.message;
    adminSettingsError.classList.remove("hidden");
  } finally {
    updatingSettings = false;
    updateAdminSettingControls();
  }
}

function createAdminClipRow(clip) {
  const row = document.createElement("article");
  row.className = "admin-clip";
  const description = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = clip.caption;
  const category = document.createElement("p");
  category.textContent = `${clip.category} · Głosy: ${clip.votes}`;
  description.append(title, category);

  const actions = document.createElement("div");
  actions.className = "admin-clip-actions";
  const clearVotes = document.createElement("button");
  clearVotes.type = "button";
  clearVotes.className = "btn-secondary";
  clearVotes.textContent = "Usuń głosy";
  clearVotes.disabled = clip.votes === 0;
  clearVotes.addEventListener("click", async () => {
    if (!window.confirm(`Usunąć wszystkie głosy na klip „${clip.caption}”?`)) return;
    await manageAdminClip(`/api/admin/clips/${encodeURIComponent(clip.id)}/votes`, "DELETE");
  });

  const deleteClip = document.createElement("button");
  deleteClip.type = "button";
  deleteClip.className = "btn-secondary danger-button";
  deleteClip.textContent = "Usuń klip";
  deleteClip.addEventListener("click", async () => {
    if (!window.confirm(`Usunąć klip „${clip.caption}” wraz z głosami i plikiem?`)) return;
    await manageAdminClip(`/api/admin/clips/${encodeURIComponent(clip.id)}`, "DELETE");
  });
  actions.append(clearVotes, deleteClip);
  row.append(description, actions);
  return row;
}

async function manageAdminClip(url, method) {
  adminClipsError.classList.add("hidden");
  try {
    await readJson(await fetch(url, { method }));
    await loadAdminClips(true);
  } catch (error) {
    adminClipsError.textContent = error.message;
    adminClipsError.classList.remove("hidden");
  }
}

async function loadAdminClips(reset = false) {
  if (reset) adminPage = 0;
  adminClipsError.classList.add("hidden");
  try {
    const result = await readJson(await fetch(`/api/admin/clips?page=${adminPage}&limit=30`));
    adminClipsList.replaceChildren(...result.clips.map(createAdminClipRow));
    adminHasMore = result.hasMore;
    document.querySelector("#admin-clips-empty").classList.toggle("hidden", result.clips.length !== 0);
    document.querySelector("#btn-admin-previous").disabled = adminPage === 0;
    document.querySelector("#btn-admin-next").disabled = !adminHasMore;
    document.querySelector("#admin-page-label").textContent = `Strona ${adminPage + 1}`;
  } catch (error) {
    adminClipsError.textContent = error.message;
    adminClipsError.classList.remove("hidden");
  }
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminLoginError.classList.add("hidden");
  const data = new FormData(adminLoginForm);
  try {
    await readJson(await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    }));
    adminLoginForm.reset();
    await loadAdminSession();
  } catch (error) {
    adminLoginError.textContent = error.message;
    adminLoginError.classList.remove("hidden");
  }
});

document.querySelector("#btn-admin-logout").addEventListener("click", async () => {
  try {
    await readJson(await fetch("/api/admin/logout", { method: "POST" }));
    showAdminLogin();
  } catch (error) {
    adminSettingsError.textContent = error.message;
    adminSettingsError.classList.remove("hidden");
  }
});

document.querySelector("#btn-toggle-uploads").addEventListener("click", () => {
  updateAdminSetting("uploadsEnabled", !siteSettings?.uploadsEnabled);
});
document.querySelector("#btn-enable-all-voting").addEventListener("click", () => {
  updateAdminSetting("votingAll", true);
});
document.querySelector("#btn-disable-all-voting").addEventListener("click", () => {
  updateAdminSetting("votingAll", false);
});
document.querySelector("#btn-admin-previous").addEventListener("click", () => {
  if (adminPage > 0) {
    adminPage -= 1;
    loadAdminClips();
  }
});
document.querySelector("#btn-admin-next").addEventListener("click", () => {
  if (adminHasMore) {
    adminPage += 1;
    loadAdminClips();
  }
});

refreshSiteSettings();
