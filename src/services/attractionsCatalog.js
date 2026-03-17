const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const workbookPath = path.join(__dirname, "..", "..", "data", "attractions.xlsx");

let cachedCatalog = [];
let cachedMtimeMs = 0;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumnKey(headers, candidates) {
  const normalizedCandidates = candidates.map((candidate) => normalizeText(candidate));
  return headers.find((header) => normalizedCandidates.includes(normalizeText(header)));
}

function loadCatalog() {
  if (!fs.existsSync(workbookPath)) {
    cachedCatalog = [];
    cachedMtimeMs = 0;
    return cachedCatalog;
  }

  const stats = fs.statSync(workbookPath);

  if (stats.mtimeMs === cachedMtimeMs && cachedCatalog.length > 0) {
    return cachedCatalog;
  }

  const workbook = XLSX.readFile(workbookPath);
  const [firstSheetName] = workbook.SheetNames;

  if (!firstSheetName) {
    cachedCatalog = [];
    cachedMtimeMs = stats.mtimeMs;
    return cachedCatalog;
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });

  if (rows.length === 0) {
    cachedCatalog = [];
    cachedMtimeMs = stats.mtimeMs;
    return cachedCatalog;
  }

  const headers = Object.keys(rows[0]);
  const attractionKey = findColumnKey(headers, [
    "attraction",
    "nom",
    "nom attraction",
    "nom_attraction",
    "ride",
    "name"
  ]);
  const peopleKey = findColumnKey(headers, [
    "people per train",
    "people_per_train",
    "personnes par train",
    "personnes_par_train",
    "capacite",
    "capacity",
    "places"
  ]);

  if (!attractionKey || !peopleKey) {
    cachedCatalog = [];
    cachedMtimeMs = stats.mtimeMs;
    return cachedCatalog;
  }

  cachedCatalog = rows
    .map((row) => {
      const attractionName = String(row[attractionKey] || "").trim();
      const peoplePerTrain = Number(row[peopleKey]);

      if (!attractionName || !Number.isInteger(peoplePerTrain) || peoplePerTrain <= 0) {
        return null;
      }

      return {
        attractionName,
        normalizedName: normalizeText(attractionName),
        peoplePerTrain
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.attractionName.localeCompare(right.attractionName, "fr"));

  cachedMtimeMs = stats.mtimeMs;
  return cachedCatalog;
}

function searchAttractions(query, limit = 8) {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  return loadCatalog()
    .filter((entry) => entry.normalizedName.includes(normalizedQuery))
    .slice(0, limit)
    .map((entry) => ({
      attractionName: entry.attractionName,
      peoplePerTrain: entry.peoplePerTrain
    }));
}

function findAttractionByName(name) {
  const normalizedName = normalizeText(name);

  if (!normalizedName) {
    return null;
  }

  return (
    loadCatalog().find((entry) => entry.normalizedName === normalizedName) || null
  );
}

function getCatalogInfo() {
  const catalog = loadCatalog();

  return {
    available: catalog.length > 0,
    total: catalog.length,
    workbookPath
  };
}

module.exports = {
  findAttractionByName,
  getCatalogInfo,
  searchAttractions
};
