const themeToggle = document.querySelector("[data-theme-toggle]");

if (themeToggle) {
  const root = document.documentElement;

  function syncThemeLabel() {
    const isDark = root.dataset.theme === "dark";
    themeToggle.textContent = isDark ? "Mode clair" : "Mode sombre";
  }

  themeToggle.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    localStorage.setItem("roller-theme", nextTheme);
    syncThemeLabel();
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
      resultStatus.textContent = "Completez tous les champs avec des valeurs valides.";
      return;
    }

    resultStatus.textContent = "Le resultat s'affichera apres avoir clique sur le bouton.";
  }

  [attractionInput, peopleInput, trainsInput].forEach((input) => {
    input.addEventListener("input", syncFormState);
  });

  if (resultValue.textContent.trim() === "-- pers/heure") {
    resultAttraction.textContent = "Attraction en attente";
    resultPeople.textContent = "--";
    resultTrains.textContent = "--";
    resultStatus.textContent = "Remplissez les champs puis cliquez pour afficher le resultat.";
  }

  syncFormState();
}
