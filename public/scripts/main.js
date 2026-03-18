const themeToggles = document.querySelectorAll("[data-theme-toggle]");

if (themeToggles.length > 0) {
  const root = document.documentElement;

  function syncThemeLabel() {
    const isDark = root.dataset.theme === "dark";
    themeToggles.forEach((themeToggle) => {
      const themeToggleLabel = themeToggle.querySelector(".theme-switch-label");
      themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
      if (themeToggleLabel) {
        themeToggleLabel.textContent = isDark ? "Mode clair" : "Mode sombre";
      }
    });
  }

  themeToggles.forEach((themeToggle) => {
    themeToggle.addEventListener("click", () => {
      const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = nextTheme;
      localStorage.setItem("roller-theme", nextTheme);
      syncThemeLabel();
    });
  });

  window.addEventListener("storage", (event) => {
    if (event.key === "roller-theme" && event.newValue) {
      root.dataset.theme = event.newValue;
      syncThemeLabel();
    }
  });

  syncThemeLabel();
}

const form = document.querySelector("[data-calculator-form]");

if (form) {
  const modeInput = form.querySelector("[data-mode-input]");
  const catalogIdInput = form.querySelector("[data-catalog-id-input]");
  const modeButtons = form.querySelectorAll("[data-mode-button]");
  const attractionInput = form.querySelector("[data-attraction-input]");
  const attractionLabel = form.querySelector("[data-attraction-label]");
  const attractionHelp = form.querySelector("[data-attraction-help]");
  const peopleInput = form.querySelector("[data-people-input]");
  const peopleHelp = form.querySelector("[data-people-help]");
  const trainsInput = form.querySelector("[data-trains-input]");
  const submitButton = form.querySelector("[data-submit-button]");
  const searchPanel = form.querySelector("[data-search-panel]");
  const searchResults = form.querySelector("[data-search-results]");
  const searchMeta = form.querySelector("[data-search-meta]");

  const resultAttraction = document.querySelector("[data-result-attraction]");
  const resultValue = document.querySelector("[data-result-value]");
  const resultPeople = document.querySelector("[data-result-people]");
  const resultTrains = document.querySelector("[data-result-trains]");
  const resultStatus = document.querySelector("[data-result-status]");
  let searchRequestId = 0;

  function isFilled(value) {
    return String(value || "").trim().length > 0;
  }

  function toInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : NaN;
  }

  function clearSuggestions() {
    searchResults.innerHTML = "";
    if (searchPanel) {
      searchPanel.hidden = true;
    }
  }

  function renderSuggestions(results) {
    searchResults.innerHTML = "";

    if (results.length === 0) {
      if (searchPanel) {
        searchPanel.hidden = false;
      }
      if (searchMeta) {
        searchMeta.textContent = "Aucun resultat";
      }
      const emptyState = document.createElement("div");
      emptyState.className = "search-empty";
      emptyState.textContent = "Aucune attraction correspondante.";
      searchResults.appendChild(emptyState);
      return;
    }

    if (searchPanel) {
      searchPanel.hidden = false;
    }
    if (searchMeta) {
      searchMeta.textContent = `${results.length} resultat${results.length > 1 ? "s" : ""}`;
    }

    results.forEach((result) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "search-result-option";
      optionButton.innerHTML = `
        <strong>${result.attractionName}</strong>
        <span>${result.displayName}</span>
        <small>${result.peoplePerTrain} pers./train</small>
      `;
      optionButton.addEventListener("click", () => {
        attractionInput.value = result.displayName;
        catalogIdInput.value = result.id;
        peopleInput.value = String(result.peoplePerTrain);
        clearSuggestions();
        syncFormState();
      });
      searchResults.appendChild(optionButton);
    });

  }

  function syncModeUi() {
    const mode = modeInput.value;

    modeButtons.forEach((button) => {
      const isActive = button.dataset.modeValue === mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    if (mode === "auto") {
      attractionLabel.textContent = "Rechercher une attraction";
      attractionHelp.textContent = "Choisissez une attraction dans le fichier Excel.";
      peopleHelp.textContent = "Rempli automatiquement depuis la base.";
      attractionInput.placeholder = "Ex. Attraction 1";
      peopleInput.readOnly = true;
    } else {
      attractionLabel.textContent = "Nom de l'attraction";
      attractionHelp.textContent = "Saisissez librement le nom de l'attraction.";
      peopleHelp.textContent = "Entrez manuellement la capacite d'un train.";
      attractionInput.placeholder = "Ex. Dragon Rush";
      peopleInput.readOnly = false;
      catalogIdInput.value = "";
      clearSuggestions();
    }
  }

  function syncFormState() {
    const mode = modeInput.value;
    const attractionName = attractionInput.value.trim();
    const peoplePerTrain = toInteger(peopleInput.value);
    const trainsInTwoMinutes = toInteger(trainsInput.value);
    const modeReady =
      mode === "auto"
        ? isFilled(catalogIdInput.value) && isFilled(attractionName)
        : isFilled(attractionName) &&
          Number.isInteger(peoplePerTrain) &&
          peoplePerTrain >= 1 &&
          peoplePerTrain <= 100;
    const formReady =
      modeReady &&
      Number.isInteger(trainsInTwoMinutes) &&
      trainsInTwoMinutes >= 1 &&
      trainsInTwoMinutes <= 50;

    submitButton.disabled = !formReady;

    if (!formReady) {
      resultStatus.textContent =
        mode === "auto"
          ? "Choisissez une attraction puis entrez les trains."
          : "Remplissez tous les champs.";
      return;
    }

    resultStatus.textContent = "Cliquez sur le bouton pour afficher le resultat.";
  }

  async function fetchSuggestions() {
    if (modeInput.value !== "auto") {
      clearSuggestions();
      return;
    }

    const query = attractionInput.value.trim();

    if (query.length < 2) {
      clearSuggestions();
      return;
    }

    const requestId = ++searchRequestId;
    if (searchPanel) {
      searchPanel.hidden = false;
    }
    if (searchMeta) {
      searchMeta.textContent = "Recherche...";
    }
    searchResults.innerHTML = '<div class="search-empty">Chargement...</div>';
    const response = await fetch(`/api/attractions/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();

    if (requestId !== searchRequestId) {
      return;
    }

    renderSuggestions(payload.results || []);
  }

  [attractionInput, peopleInput, trainsInput].forEach((input) => {
    input.addEventListener("input", syncFormState);
  });

  attractionInput.addEventListener("input", () => {
    if (modeInput.value !== "auto") {
      return;
    }

    catalogIdInput.value = "";
    peopleInput.value = "";
    fetchSuggestions().catch(() => clearSuggestions());
  });

  attractionInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      clearSuggestions();
    }, 150);
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }

      modeInput.value = button.dataset.modeValue;
      attractionInput.value = "";
      peopleInput.value = "";
      catalogIdInput.value = "";
      syncModeUi();
      syncFormState();
    });
  });

  if (resultValue.textContent.trim() === "-- pers/heure") {
    resultAttraction.textContent = "Attraction en attente";
    resultPeople.textContent = "--";
    resultTrains.textContent = "--";
    resultStatus.textContent = "Remplissez les champs puis validez.";
  }

  syncModeUi();
  syncFormState();
}
