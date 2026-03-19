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
    selectAttraction: form.dataset.textSelectAttraction || "Choose a ride and enter your times.",
    fillAllFields: form.dataset.textFillAllFields || "Fill in all fields.",
    clickSubmit: form.dataset.textClickSubmit || "Click the button to show the result.",
    searchLoading: form.dataset.textSearchLoading || "Searching...",
    searchNoResult: form.dataset.textSearchNoResult || "No results",
    searchNoResultBody: form.dataset.textSearchNoResultBody || "No matching ride found.",
    searchSuggestionSingular: form.dataset.textSearchSuggestionSingular || "suggestion",
    searchSuggestionPlural: form.dataset.textSearchSuggestionPlural || "suggestions",
    waitingRide: form.dataset.textWaitingRide || "Waiting for a ride",
    peopleTrainShort: form.dataset.textPeopleTrainShort || "people/train",
    timeLabel: form.dataset.textTimeLabel || "Time",
    averageSeconds: form.dataset.textAverageSeconds || "Average (s)",
    timeHelp: form.dataset.textTimeHelp || "Add between 1 and 10 times in seconds.",
    addTime: form.dataset.textAddTime || "Add time",
    removeTime: form.dataset.textRemoveTime || "Remove",
    maxTimes: form.dataset.textMaxTimes || "Maximum reached.",
    timePlaceholder: form.dataset.textTimePlaceholder || "e.g. 45"
  };
  const catalogIdInput = form.querySelector("[data-catalog-id-input]");
  const attractionInput = form.querySelector("[data-attraction-input]");
  const addTimeButton = form.querySelector("[data-add-time-button]");
  const timeInputList = form.querySelector("[data-time-input-list]");
  const timeHelp = form.querySelector("[data-time-help]");
  const submitButton = form.querySelector("[data-submit-button]");
  const searchPanel = form.querySelector("[data-search-panel]");
  const searchResults = form.querySelector("[data-search-results]");
  const searchMeta = form.querySelector("[data-search-meta]");

  const resultAttraction = document.querySelector("[data-result-attraction]");
  const resultValue = document.querySelector("[data-result-value]");
  const resultPeople = document.querySelector("[data-result-people]");
  const resultAverage = document.querySelector("[data-result-average]");
  const resultSamples = document.querySelector("[data-result-samples]");
  const resultStatus = document.querySelector("[data-result-status]");
  let searchRequestId = 0;
  const maxTimeInputs = 10;

  function isFilled(value) {
    return String(value || "").trim().length > 0;
  }

  function toInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : NaN;
  }

  function getTimeInputs() {
    return Array.from(form.querySelectorAll("[data-time-input]"));
  }

  function updateTimeLabels() {
    getTimeInputs().forEach((input, index) => {
      const label = input.closest(".time-field")?.querySelector("span");
      if (label) {
        label.textContent = `${texts.timeLabel} ${index + 1}`;
      }
    });
  }

  function syncTimeUi() {
    const timeInputs = getTimeInputs();
    const canAddMore = timeInputs.length < maxTimeInputs;

    if (addTimeButton) {
      addTimeButton.disabled = !canAddMore;
    }

    if (timeHelp) {
      timeHelp.textContent = canAddMore ? texts.timeHelp : texts.maxTimes;
    }

    timeInputs.forEach((input) => {
      const removeButton = input.closest(".time-field")?.querySelector("[data-remove-time-button]");
      if (removeButton) {
        removeButton.hidden = timeInputs.length <= 1;
      }
    });
  }

  function createTimeField() {
    const wrapper = document.createElement("label");
    wrapper.className = "field time-field";
    wrapper.innerHTML = `
      <span>${texts.timeLabel}</span>
      <div class="time-input-row">
        <input
          type="number"
          name="dispatchTimes"
          min="1"
          max="600"
          required
          placeholder="${texts.timePlaceholder}"
          data-time-input
        />
        <button type="button" class="history-delete-button time-remove-button" data-remove-time-button>${texts.removeTime}</button>
      </div>
    `;

    const input = wrapper.querySelector("[data-time-input]");
    const removeButton = wrapper.querySelector("[data-remove-time-button]");

    input.addEventListener("input", syncFormState);
    removeButton.addEventListener("click", () => {
      wrapper.remove();
      updateTimeLabels();
      syncTimeUi();
      syncFormState();
    });

    return wrapper;
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
        clearSuggestions();
        syncFormState();
      });
      searchResults.appendChild(optionButton);
    });
  }

  function syncFormState() {
    const attractionName = attractionInput.value.trim();
    const timeValues = getTimeInputs().map((input) => toInteger(input.value));
    const timesReady =
      timeValues.length >= 1 &&
      timeValues.every((value) => Number.isInteger(value) && value >= 1 && value <= 600);
    const formReady = isFilled(catalogIdInput.value) && isFilled(attractionName) && timesReady;

    submitButton.disabled = !formReady;

    if (!formReady) {
      resultStatus.textContent = isFilled(catalogIdInput.value) ? texts.fillAllFields : texts.selectAttraction;
      return;
    }

    resultStatus.textContent = texts.clickSubmit;
  }

  async function fetchSuggestions() {
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

  attractionInput.addEventListener("input", () => {
    catalogIdInput.value = "";
    fetchSuggestions().catch(() => clearSuggestions());
    syncFormState();
  });

  attractionInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      clearSuggestions();
    }, 150);
  });

  getTimeInputs().forEach((input) => {
    input.addEventListener("input", syncFormState);
  });

  if (addTimeButton) {
    addTimeButton.addEventListener("click", () => {
      if (getTimeInputs().length >= maxTimeInputs) {
        syncTimeUi();
        return;
      }

      const newField = createTimeField();
      timeInputList.appendChild(newField);
      updateTimeLabels();
      syncTimeUi();
      syncFormState();
      newField.querySelector("[data-time-input]")?.focus();
    });
  }

  if (resultValue.textContent.trim().startsWith("--")) {
    resultAttraction.textContent = texts.waitingRide;
    resultPeople.textContent = "--";
    resultAverage.textContent = "--";
    resultSamples.textContent = "--";
    resultStatus.textContent = texts.fillAllFields;
  }

  updateTimeLabels();
  syncTimeUi();
  syncFormState();
}
