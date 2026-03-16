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
  const attractionInput = form.querySelector("[data-attraction-input]");
  const peopleInput = form.querySelector("[data-people-input]");
  const trainsInput = form.querySelector("[data-trains-input]");
  const submitButton = form.querySelector("[data-submit-button]");

  const resultAttraction = document.querySelector("[data-result-attraction]");
  const resultValue = document.querySelector("[data-result-value]");
  const resultPeople = document.querySelector("[data-result-people]");
  const resultTrains = document.querySelector("[data-result-trains]");
  const resultStatus = document.querySelector("[data-result-status]");

  function isFilled(value) {
    return String(value || "").trim().length > 0;
  }

  function toInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : NaN;
  }

  function syncFormState() {
    const attractionName = attractionInput.value.trim();
    const peoplePerTrain = toInteger(peopleInput.value);
    const trainsInTwoMinutes = toInteger(trainsInput.value);
    const formReady =
      isFilled(attractionName) &&
      Number.isInteger(peoplePerTrain) &&
      Number.isInteger(trainsInTwoMinutes) &&
      peoplePerTrain >= 1 &&
      peoplePerTrain <= 100 &&
      trainsInTwoMinutes >= 1 &&
      trainsInTwoMinutes <= 50;

    submitButton.disabled = !formReady;

    if (!formReady) {
      resultStatus.textContent = "Remplissez tous les champs.";
      return;
    }

    resultStatus.textContent = "Cliquez sur le bouton pour afficher le resultat.";
  }

  [attractionInput, peopleInput, trainsInput].forEach((input) => {
    input.addEventListener("input", syncFormState);
  });

  if (resultValue.textContent.trim() === "-- pers/heure") {
    resultAttraction.textContent = "Attraction en attente";
    resultPeople.textContent = "--";
    resultTrains.textContent = "--";
    resultStatus.textContent = "Remplissez les champs puis validez.";
  }

  syncFormState();
}
