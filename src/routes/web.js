const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const db = require("../db");
const { requireAuth, redirectIfAuthenticated } = require("../middleware/auth");
const { getClientIp, setFlash, createTimestampParts } = require("../utils/security");
const {
  validateAttractionName,
  validateInteger,
  validateUsername,
  validatePassword
} = require("../utils/validation");

const router = express.Router();
const appTimeZone = process.env.APP_TIMEZONE || "Europe/Paris";

function makeRedirectLimiter({ windowMs, max, message, redirectTo }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      setFlash(req, "error", message);
      res.redirect(redirectTo);
    }
  });
}

const authLimiter = makeRedirectLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Trop de tentatives. Reessayez dans quelques minutes.",
  redirectTo: "/login"
});

const registerLimiter = makeRedirectLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Trop de tentatives. Reessayez dans quelques minutes.",
  redirectTo: "/register"
});

const calculationLimiter = makeRedirectLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: "Trop de calculs envoyes trop rapidement. Patientez un peu.",
  redirectTo: "/"
});

function getAnonymousDailyCount(ipAddress, currentDate) {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS total
        FROM calculations
        WHERE ip_address = ? AND user_id IS NULL AND recorded_date = ?
      `
    )
    .get(ipAddress, currentDate);

  return row ? row.total : 0;
}

router.get("/", (req, res) => {
  const ipAddress = getClientIp(req);
  const today = createTimestampParts(appTimeZone).date;
  const anonymousDailyCount = req.session.user ? 0 : getAnonymousDailyCount(ipAddress, today);

  res.render("index", {
    pageTitle: "Calculateur de debit roller coaster",
    anonymousDailyCount
  });
});

router.post("/calculate", calculationLimiter, (req, res) => {
  const attractionValidation = validateAttractionName(req.body.attractionName);
  const peopleValidation = validateInteger(req.body.peoplePerTrain, "Le nombre de personnes par train", {
    min: 1,
    max: 100
  });
  const trainsValidation = validateInteger(
    req.body.trainsInTwoMinutes,
    "Le nombre de trains en 2 minutes",
    {
      min: 1,
      max: 50
    }
  );

  const validations = [attractionValidation, peopleValidation, trainsValidation];
  const invalid = validations.find((result) => !result.valid);

  if (invalid) {
    setFlash(req, "error", invalid.message);
    return res.redirect("/");
  }

  const ipAddress = getClientIp(req);
  const timestamp = createTimestampParts(appTimeZone);

  if (!req.session.user) {
    const anonymousDailyCount = getAnonymousDailyCount(ipAddress, timestamp.date);

    if (anonymousDailyCount >= 2) {
      setFlash(
        req,
        "error",
        "Les visiteurs sont limites a 2 calculs par jour. Connectez-vous pour continuer."
      );
      return res.redirect("/register");
    }
  }

  const throughput = peopleValidation.value * 30 * trainsValidation.value;

  db.prepare(
    `
      INSERT INTO calculations (
        attraction_name,
        people_per_train,
        trains_in_two_minutes,
        throughput_per_hour,
        recorded_date,
        recorded_time,
        created_at,
        ip_address,
        user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    attractionValidation.value,
    peopleValidation.value,
    trainsValidation.value,
    throughput,
    timestamp.date,
    timestamp.time,
    timestamp.iso,
    ipAddress,
    req.session.user ? req.session.user.id : null
  );

  req.session.lastCalculation = {
    attractionName: attractionValidation.value,
    throughput,
    peoplePerTrain: peopleValidation.value,
    trainsInTwoMinutes: trainsValidation.value
  };

  setFlash(req, "success", "Calcul enregistre avec succes.");
  res.redirect("/");
});

router.get("/login", redirectIfAuthenticated, (req, res) => {
  res.render("login", {
    pageTitle: "Connexion"
  });
});

router.post("/login", authLimiter, redirectIfAuthenticated, (req, res) => {
  const usernameValidation = validateUsername(req.body.username);
  const password = String(req.body.password || "");

  if (!usernameValidation.valid || password.length === 0) {
    setFlash(req, "error", "Identifiants invalides.");
    return res.redirect("/login");
  }

  const user = db
    .prepare(
      `
        SELECT id, username, password_hash
        FROM users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
      `
    )
    .get(usernameValidation.value);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    setFlash(req, "error", "Identifiants invalides.");
    return res.redirect("/login");
  }

  req.session.user = {
    id: user.id,
    username: user.username
  };

  setFlash(req, "success", `Bienvenue ${user.username}.`);
  res.redirect("/dashboard");
});

router.get("/register", redirectIfAuthenticated, (req, res) => {
  res.render("register", {
    pageTitle: "Creer un compte"
  });
});

router.post("/register", registerLimiter, redirectIfAuthenticated, (req, res) => {
  const usernameValidation = validateUsername(req.body.username);
  const passwordValidation = validatePassword(req.body.password);
  const confirmPassword = String(req.body.confirmPassword || "");

  if (!usernameValidation.valid) {
    setFlash(req, "error", usernameValidation.message);
    return res.redirect("/register");
  }

  if (!passwordValidation.valid) {
    setFlash(req, "error", passwordValidation.message);
    return res.redirect("/register");
  }

  if (passwordValidation.value !== confirmPassword) {
    setFlash(req, "error", "La confirmation du mot de passe ne correspond pas.");
    return res.redirect("/register");
  }

  const existingUser = db
    .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1")
    .get(usernameValidation.value);

  if (existingUser) {
    setFlash(req, "error", "Ce nom d'utilisateur est deja utilise.");
    return res.redirect("/register");
  }

  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(passwordValidation.value, 12);
  const result = db
    .prepare(
      `
        INSERT INTO users (username, password_hash, is_admin, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
      `
    )
    .run(usernameValidation.value, passwordHash, now, now);

  req.session.user = {
    id: Number(result.lastInsertRowid),
    username: usernameValidation.value
  };

  setFlash(req, "success", "Compte cree. Vous pouvez desormais faire autant de calculs que necessaire.");
  res.redirect("/dashboard");
});

router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

router.get("/dashboard", requireAuth, (req, res) => {
  const calculations = db
    .prepare(
      `
        SELECT id, attraction_name, people_per_train, trains_in_two_minutes, throughput_per_hour, recorded_date, recorded_time
        FROM calculations
        WHERE user_id = ?
        ORDER BY id DESC
      `
    )
    .all(req.session.user.id);

  res.render("dashboard", {
    pageTitle: "Mon espace",
    calculations
  });
});

router.post("/calculations/:id/delete", requireAuth, (req, res) => {
  const calculationId = Number(req.params.id);

  const calculation = db
    .prepare("SELECT id FROM calculations WHERE id = ? AND user_id = ? LIMIT 1")
    .get(calculationId, req.session.user.id);

  if (!calculation) {
    setFlash(req, "error", "Calcul introuvable.");
    return res.redirect("/dashboard");
  }

  db.prepare("DELETE FROM calculations WHERE id = ?").run(calculationId);

  setFlash(req, "success", "Calcul supprime.");
  res.redirect("/dashboard");
});

router.post("/account/password", requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPasswordValidation = validatePassword(req.body.newPassword);
  const confirmPassword = String(req.body.confirmNewPassword || "");

  if (!newPasswordValidation.valid) {
    setFlash(req, "error", newPasswordValidation.message);
    return res.redirect("/dashboard");
  }

  if (newPasswordValidation.value !== confirmPassword) {
    setFlash(req, "error", "La confirmation du nouveau mot de passe ne correspond pas.");
    return res.redirect("/dashboard");
  }

  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ? LIMIT 1")
    .get(req.session.user.id);

  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    setFlash(req, "error", "Mot de passe actuel incorrect.");
    return res.redirect("/dashboard");
  }

  db.prepare(
    `
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(bcrypt.hashSync(newPasswordValidation.value, 12), new Date().toISOString(), req.session.user.id);

  setFlash(req, "success", "Mot de passe mis a jour.");
  res.redirect("/dashboard");
});

router.post("/account/username", requireAuth, (req, res) => {
  const usernameValidation = validateUsername(req.body.username);

  if (!usernameValidation.valid) {
    setFlash(req, "error", usernameValidation.message);
    return res.redirect("/dashboard");
  }

  const existingUser = db
    .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1")
    .get(usernameValidation.value, req.session.user.id);

  if (existingUser) {
    setFlash(req, "error", "Ce nom d'utilisateur est deja utilise.");
    return res.redirect("/dashboard");
  }

  db.prepare(
    `
      UPDATE users
      SET username = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(usernameValidation.value, new Date().toISOString(), req.session.user.id);

  req.session.user.username = usernameValidation.value;

  setFlash(req, "success", "Pseudo mis a jour.");
  res.redirect("/dashboard");
});

router.post("/account/delete", requireAuth, (req, res) => {
  const userId = req.session.user.id;

  db.prepare("DELETE FROM calculations WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);

  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = {
  router
};
