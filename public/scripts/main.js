const themeToggles = document.querySelectorAll("[data-theme-toggle]");

if (themeToggles.length > 0) {
  const root = document.documentElement;

  function syncThemeLabel() {
    const isDark = root.dataset.theme === "dark";
    themeToggles.forEach((themeToggle) => {
      const themeToggleLabel = themeToggle.querySelector(".theme-switch-label");
      themeToggle.setAttribute("aria-pressed", isDark ? "true" : "false");
      if (themeToggleLabel) {
        themeToggleLabel.textContent = isDark
          ? themeToggle.dataset.labelLight || "Light mode"
          : themeToggle.dataset.labelDark || "Dark mode";
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
  const texts = {
    attractionName: form.dataset.textAttractionName || "Ride name",
    attractionSearch: form.dataset.textAttractionSearch || "Search for a ride",
    attractionHelp: form.dataset.textAttractionHelp || "Enter the ride name freely.",
    attractionAutoHelp: form.dataset.textAttractionAutoHelp || "Choose a ride from the Excel file.",
    peopleHelp: form.dataset.textPeopleHelp || "Enter the train capacity manually.",
    peopleAutoHelp: form.dataset.textPeopleAutoHelp || "Filled automatically from the catalog.",
    selectAttraction: form.dataset.textSelectAttraction || "Choose a ride and then enter the trains.",
    fillAllFields: form.dataset.textFillAllFields || "Fill in all fields.",
    clickSubmit: form.dataset.textClickSubmit || "Click the button to show the result.",
    searchLoading: form.dataset.textSearchLoading || "Searching...",
    searchNoResult: form.dataset.textSearchNoResult || "No results",
    searchNoResultBody: form.dataset.textSearchNoResultBody || "No matching ride found.",
    searchSuggestionSingular: form.dataset.textSearchSuggestionSingular || "suggestion",
    searchSuggestionPlural: form.dataset.textSearchSuggestionPlural || "suggestions",
    waitingRide: form.dataset.textWaitingRide || "Waiting for a ride",
    peopleTrainShort: form.dataset.textPeopleTrainShort || "people/train",
    trainsTwoMinutes: form.dataset.textTrainsTwoMinutes || "Trains in 2 minutes",
    trainsFiveMinutes: form.dataset.textTrainsFiveMinutes || "Trains in 5 minutes"
  };
  const modeInput = form.querySelector("[data-mode-input]");
  const catalogIdInput = form.querySelector("[data-catalog-id-input]");
  const trainWindowInput = form.querySelector("[data-train-window-input]");
  const modeButtons = form.querySelectorAll("[data-mode-button]");
  const trainWindowButtons = form.querySelectorAll("[data-train-window-button]");
  const attractionInput = form.querySelector("[data-attraction-input]");
  const attractionLabel = form.querySelector("[data-attraction-label]");
  const attractionHelp = form.querySelector("[data-attraction-help]");
  const peopleInput = form.querySelector("[data-people-input]");
  const peopleHelp = form.querySelector("[data-people-help]");
  const trainsInput = form.querySelector("[data-trains-input]");
  const trainsLabel = form.querySelector("[data-trains-label]");
  const submitButton = form.querySelector("[data-submit-button]");
  const searchPanel = form.querySelector("[data-search-panel]");
  const searchResults = form.querySelector("[data-search-results]");
  const searchMeta = form.querySelector("[data-search-meta]");
  const autoOnlyElements = form.querySelectorAll("[data-auto-only]");

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
    const limitedResults = results.slice(0, 3);

    if (limitedResults.length === 0) {
      if (searchPanel) {
        searchPanel.hidden = false;
      }
      if (searchMeta) {
        searchMeta.textContent = texts.searchNoResult;
      }
      const emptyState = document.createElement("div");
      emptyState.className = "search-empty";
      emptyState.textContent = texts.searchNoResultBody;
      searchResults.appendChild(emptyState);
      return;
    }

    if (searchPanel) {
      searchPanel.hidden = false;
    }
    if (searchMeta) {
      searchMeta.textContent = `${limitedResults.length} ${
        limitedResults.length > 1 ? texts.searchSuggestionPlural : texts.searchSuggestionSingular
      }`;
    }

    limitedResults.forEach((result) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "search-result-option";
      optionButton.innerHTML = `
        <strong>${result.attractionName}</strong>
        <span>${result.displayName}</span>
        <small>${result.peoplePerTrain} ${texts.peopleTrainShort}</small>
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

  function syncTrainWindowUi() {
    const trainWindowMinutes = trainWindowInput && trainWindowInput.value === "5" ? "5" : "2";
    const isFiveMinutes = trainWindowMinutes === "5";

    trainWindowButtons.forEach((button) => {
      const isActive = button.dataset.trainWindowValue === trainWindowMinutes;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    if (trainsLabel) {
      trainsLabel.textContent = isFiveMinutes ? texts.trainsFiveMinutes : texts.trainsTwoMinutes;
    }
  }

  function syncModeUi() {
    const mode = modeInput.value;
    const isAutoMode = mode === "auto";

    modeButtons.forEach((button) => {
      const isActive = button.dataset.modeValue === mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    autoOnlyElements.forEach((element) => {
      element.hidden = !isAutoMode;
    });

    if (isAutoMode) {
      attractionLabel.textContent = "Rechercher une attraction";
      attractionLabel.textContent = texts.attractionSearch;
      attractionHelp.textContent = texts.attractionAutoHelp;
      peopleHelp.textContent = texts.peopleAutoHelp;
      attractionInput.placeholder = texts.attractionSearch;
      peopleInput.readOnly = true;
    } else {
      attractionLabel.textContent = texts.attractionName;
      attractionHelp.textContent = texts.attractionHelp;
      peopleHelp.textContent = texts.peopleHelp;
      attractionInput.placeholder = texts.attractionName;
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
          ? texts.selectAttraction
          : texts.fillAllFields;
      return;
    }

    resultStatus.textContent = texts.clickSubmit;
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
      searchMeta.textContent = texts.searchLoading;
    }
    searchResults.innerHTML = `<div class="search-empty">${texts.searchLoading}</div>`;
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

  trainWindowButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!trainWindowInput) {
        return;
      }

      trainWindowInput.value = button.dataset.trainWindowValue === "5" ? "5" : "2";
      syncTrainWindowUi();
      syncFormState();
    });
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

  if (resultValue.textContent.trim().startsWith("--")) {
    resultAttraction.textContent = texts.waitingRide;
    resultPeople.textContent = "--";
    resultTrains.textContent = "--";
    resultStatus.textContent = texts.fillAllFields;
  }

  syncTrainWindowUi();
  syncModeUi();
  syncFormState();
}
