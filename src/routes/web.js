const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const db = require("../db");
const {
  requireAuth,
  requireAdmin,
  requireBoundIp,
  redirectIfAuthenticated
} = require("../middleware/auth");
const {
  findAttractionById,
  getCatalogInfo,
  searchAttractions
} = require("../services/attractionsCatalog");
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
  const catalogInfo = getCatalogInfo();

  res.render("index", {
    pageTitle: "Calculateur de debit roller coaster",
    anonymousDailyCount,
    catalogInfo
  });
});

router.get("/api/attractions/search", (req, res) => {
  if (!req.session.user) {
    return res.json({ results: [] });
  }

  const catalogInfo = getCatalogInfo();

  if (!catalogInfo.available) {
    return res.json({ results: [] });
  }

  return res.json({
    results: searchAttractions(req.query.q || "")
  });
});

router.post("/calculate", calculationLimiter, (req, res) => {
  const calculationMode = req.body.calculationMode === "auto" ? "auto" : "manual";
  let attractionName = "";
  let peoplePerTrain = 0;

  if (calculationMode === "auto") {
    if (!req.session.user) {
      setFlash(req, "error", "Connectez-vous pour utiliser le mode auto.");
      return res.redirect("/login");
    }

    const selectedAttraction = findAttractionById(req.body.catalogAttractionId);

    if (!selectedAttraction) {
      setFlash(req, "error", "Selectionnez une attraction valide en mode auto.");
      return res.redirect("/");
    }

    attractionName = selectedAttraction.displayName;
    peoplePerTrain = selectedAttraction.peoplePerTrain;
  } else {
    const attractionValidation = validateAttractionName(req.body.attractionName);
    const peopleValidation = validateInteger(req.body.peoplePerTrain, "Le nombre de personnes par train", {
      min: 1,
      max: 100
    });

    if (!attractionValidation.valid) {
      setFlash(req, "error", attractionValidation.message);
      return res.redirect("/");
    }

    if (!peopleValidation.valid) {
      setFlash(req, "error", peopleValidation.message);
      return res.redirect("/");
    }

    attractionName = attractionValidation.value;
    peoplePerTrain = peopleValidation.value;
  }

  const trainsValidation = validateInteger(
    req.body.trainsInTwoMinutes,
    "Le nombre de trains en 2 minutes",
    {
      min: 1,
      max: 50
    }
  );

  if (!trainsValidation.valid) {
    setFlash(req, "error", trainsValidation.message);
    return res.redirect("/");
  }

  const ipAddress = getClientIp(req);
  const timestamp = createTimestampParts(appTimeZone);

  if (req.session.user) {
    const boundUser = db
      .prepare("SELECT locked_ip FROM users WHERE id = ? LIMIT 1")
      .get(req.session.user.id);

    if (boundUser && boundUser.locked_ip && boundUser.locked_ip !== ipAddress) {
      req.session.destroy(() => {
        res.redirect("/login");
      });
      return;
    }
  } else {
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

  const throughput = peoplePerTrain * 30 * trainsValidation.value;

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
    attractionName,
    peoplePerTrain,
    trainsValidation.value,
    throughput,
    timestamp.date,
    timestamp.time,
    timestamp.iso,
    ipAddress,
    req.session.user ? req.session.user.id : null
  );

  req.session.lastCalculation = {
    attractionName,
    throughput,
    peoplePerTrain,
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
        SELECT id, username, password_hash, is_admin, locked_ip
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

  const currentIp = getClientIp(req);

  if (user.locked_ip && user.locked_ip !== currentIp) {
    setFlash(req, "error", "Ce compte est deja associe a une autre adresse IP.");
    return res.redirect("/login");
  }

  if (!user.locked_ip) {
    db.prepare("UPDATE users SET locked_ip = ?, updated_at = ? WHERE id = ?").run(
      currentIp,
      new Date().toISOString(),
      user.id
    );
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    isAdmin: Boolean(user.is_admin)
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
  const currentIp = getClientIp(req);

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

  const existingIpUser = db
    .prepare("SELECT id FROM users WHERE locked_ip = ? LIMIT 1")
    .get(currentIp);

  if (existingIpUser) {
    setFlash(req, "error", "Un compte existe deja pour cette adresse IP.");
    return res.redirect("/login");
  }

  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(passwordValidation.value, 12);
  const result = db
    .prepare(
      `
        INSERT INTO users (username, password_hash, locked_ip, is_admin, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `
    )
    .run(usernameValidation.value, passwordHash, currentIp, now, now);

  req.session.user = {
    id: Number(result.lastInsertRowid),
    username: usernameValidation.value,
    isAdmin: false
  };

  setFlash(req, "success", "Compte cree. Vous pouvez desormais faire autant de calculs que necessaire.");
  res.redirect("/dashboard");
});

router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

router.get("/dashboard", requireAuth, requireBoundIp, (req, res) => {
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

router.get("/admin/accounts", requireAuth, requireBoundIp, requireAdmin, (req, res) => {
  const users = db
    .prepare(
      `
        SELECT
          id,
          username,
          is_admin,
          created_at,
          (
            SELECT COUNT(*)
            FROM calculations
            WHERE calculations.user_id = users.id
          ) AS calculations_count
        FROM users
        ORDER BY is_admin DESC, LOWER(username) ASC
      `
    )
    .all();

  res.render("admin-accounts", {
    pageTitle: "Comptes",
    users
  });
});

router.post("/admin/users/:id/toggle-admin", requireAuth, requireBoundIp, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const targetUser = db
    .prepare("SELECT id, is_admin, username FROM users WHERE id = ? LIMIT 1")
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", "Compte introuvable.");
    return res.redirect("/admin/accounts");
  }

  const nextAdminState = targetUser.is_admin ? 0 : 1;

  if (req.session.user.id === userId && nextAdminState === 0) {
    setFlash(req, "error", "Vous ne pouvez pas retirer votre propre statut admin.");
    return res.redirect("/admin/accounts");
  }

  if (targetUser.is_admin) {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE is_admin = 1")
      .get().total;

    if (adminCount <= 1) {
      setFlash(req, "error", "Il doit toujours rester au moins un admin.");
      return res.redirect("/admin/accounts");
    }
  }

  db.prepare(
    `
      UPDATE users
      SET is_admin = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(nextAdminState, new Date().toISOString(), userId);

  setFlash(
    req,
    "success",
    nextAdminState ? "Compte passe admin." : "Statut admin retire."
  );
  res.redirect("/admin/accounts");
});

router.post("/calculations/:id/delete", requireAuth, requireBoundIp, (req, res) => {
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

router.post("/account/password", requireAuth, requireBoundIp, (req, res) => {
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

router.post("/account/username", requireAuth, requireBoundIp, (req, res) => {
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

router.post("/account/delete", requireAuth, requireBoundIp, (req, res) => {
  const userId = req.session.user.id;

  if (req.session.user.isAdmin) {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE is_admin = 1")
      .get().total;

    if (adminCount <= 1) {
      setFlash(req, "error", "Impossible de supprimer le dernier admin.");
      return res.redirect("/dashboard");
    }
  }

  db.prepare("DELETE FROM calculations WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);

  req.session.destroy(() => {
    res.redirect("/");
  });
});

module.exports = {
  router
};
