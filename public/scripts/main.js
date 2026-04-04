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
    chronoStart: form.dataset.textChronoStart || "Start",
    chronoStop: form.dataset.textChronoStop || "Stop",
    chronoPlusOne: form.dataset.textChronoPlusOne || "+1 train",
    chronoHelp: form.dataset.textChronoHelp || "Start the stopwatch, then record each train.",
    chronoEmpty: form.dataset.textChronoEmpty || "No recorded times yet.",
    chronoRunning: form.dataset.textChronoRunning || "Chrono running..."
  };
  const catalogIdInput = form.querySelector("[data-catalog-id-input]");
  const attractionInput = form.querySelector("[data-attraction-input]");
  const searchBlock = form.querySelector("[data-search-block]");
  const requestLink = form.querySelector("[data-request-link]");
  const chronoPanel = form.querySelector("[data-chrono-panel]");
  const chronoDisplay = form.querySelector("[data-chrono-display]");
  const chronoStartButton = form.querySelector("[data-chrono-start-button]");
  const chronoRunningControls = form.querySelector("[data-chrono-running-controls]");
  const chronoStopButton = form.querySelector("[data-chrono-stop-button]");
  const chronoLapButton = form.querySelector("[data-chrono-lap-button]");
  const chronoTimesList = form.querySelector("[data-chrono-times-list]");
  const chronoEmpty = form.querySelector("[data-chrono-empty]");
  const chronoHelp = form.querySelector("[data-chrono-help]");
  const chronoHiddenInputs = form.querySelector("[data-chrono-hidden-inputs]");
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
  let chronoStartTime = null;
  let chronoLastTrainTime = null;
  let chronoIntervalId = null;
  let chronoValues = [];

  function isFilled(value) {
    return String(value || "").trim().length > 0;
  }

  function toInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : NaN;
  }

  function getChronoInputs() {
    return Array.from(form.querySelectorAll("[data-chrono-time-input]"));
  }

  function formatChrono(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function renderChronoValues() {
    if (!chronoTimesList || !chronoHiddenInputs) {
      return;
    }

    chronoTimesList.innerHTML = "";
    chronoHiddenInputs.innerHTML = "";

    if (chronoValues.length === 0) {
      if (chronoEmpty) {
        chronoTimesList.appendChild(chronoEmpty);
        chronoEmpty.hidden = false;
      }
    } else if (chronoEmpty) {
      chronoEmpty.hidden = true;
    }

    chronoValues.forEach((value, index) => {
      const item = document.createElement("div");
      item.className = "search-empty chrono-time-item";
      item.innerHTML = `<strong>${texts.timeLabel} ${index + 1}</strong><span>${value} s</span>`;
      chronoTimesList.appendChild(item);

      const hiddenInput = document.createElement("input");
      hiddenInput.type = "hidden";
      hiddenInput.name = "dispatchTimes";
      hiddenInput.value = String(value);
      hiddenInput.setAttribute("data-chrono-time-input", "");
      chronoHiddenInputs.appendChild(hiddenInput);
    });
  }

  function setChronoRunning(isRunning) {
    if (chronoStartButton) {
      chronoStartButton.hidden = isRunning;
    }
    if (chronoRunningControls) {
      chronoRunningControls.hidden = !isRunning;
    }
    if (chronoHelp) {
      chronoHelp.textContent = isRunning ? texts.chronoRunning : texts.chronoHelp;
    }
  }

  function startChrono() {
    const now = Date.now();
    chronoStartTime = now;
    chronoLastTrainTime = now;
    setChronoRunning(true);

    if (chronoIntervalId) {
      clearInterval(chronoIntervalId);
    }

    chronoIntervalId = window.setInterval(() => {
      if (chronoDisplay && chronoLastTrainTime) {
        chronoDisplay.textContent = formatChrono(Date.now() - chronoLastTrainTime);
      }
    }, 250);
  }

  function stopChrono() {
    if (chronoIntervalId) {
      clearInterval(chronoIntervalId);
      chronoIntervalId = null;
    }
    chronoStartTime = null;
    chronoLastTrainTime = null;
    setChronoRunning(false);
    if (chronoDisplay) {
      chronoDisplay.textContent = "00:00";
    }
  }

  function recordChronoTrain() {
    if (!chronoLastTrainTime || chronoValues.length >= maxTimeInputs) {
      return;
    }

    const now = Date.now();
    const seconds = Math.max(1, Math.round((now - chronoLastTrainTime) / 1000));
    chronoValues.push(seconds);
    chronoLastTrainTime = now;
    renderChronoValues();
    syncFormState();
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
    const timeValues = getChronoInputs().map((input) => toInteger(input.value));
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

  if (chronoStartButton) {
    chronoStartButton.addEventListener("click", startChrono);
  }

  if (chronoStopButton) {
    chronoStopButton.addEventListener("click", stopChrono);
  }

  if (chronoLapButton) {
    chronoLapButton.addEventListener("click", () => {
      recordChronoTrain();
      if (chronoValues.length >= maxTimeInputs) {
        stopChrono();
      }
    });
  }

  if (resultValue.textContent.trim().startsWith("--")) {
    resultAttraction.textContent = texts.waitingRide;
    resultPeople.textContent = "--";
    resultAverage.textContent = "--";
    resultSamples.textContent = "--";
    resultStatus.textContent = texts.fillAllFields;
  }

  renderChronoValues();
  setChronoRunning(false);
  if (chronoPanel) {
    chronoPanel.hidden = false;
  }
  if (searchBlock) {
    searchBlock.hidden = false;
  }
  if (requestLink) {
    requestLink.hidden = false;
  }
  syncFormState();
}
