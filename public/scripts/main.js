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

  function syncResult() {
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

    resultAttraction.textContent = attractionName || "Attraction en attente";
    resultPeople.textContent = Number.isInteger(peoplePerTrain) ? String(peoplePerTrain) : "--";
    resultTrains.textContent = Number.isInteger(trainsInTwoMinutes)
      ? String(trainsInTwoMinutes)
      : "--";

    if (!formReady) {
      resultValue.textContent = "-- pers/heure";
      resultStatus.textContent = "Completez tous les champs avec des valeurs valides.";
      return;
    }

    const throughput = peoplePerTrain * 30 * trainsInTwoMinutes;
    resultValue.textContent = `${throughput} pers/heure`;
    resultStatus.textContent = "Le calcul est pret a etre enregistre.";
  }

  [attractionInput, peopleInput, trainsInput].forEach((input) => {
    input.addEventListener("input", syncResult);
  });

  syncResult();
}
