const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const db = require("../db");
const {
  requireAuth,
  requireAdmin,
  redirectIfAuthenticated
} = require("../middleware/auth");
const { buildEntriesWorkbook } = require("../services/exportService");
const { getClientIp, setFlash, createTimestampParts } = require("../utils/security");
const {
  validateAttractionName,
  validateInteger,
  validateUsername,
  validatePassword,
  cleanText
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
        SELECT id, username, password_hash, is_admin
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
    username: user.username,
    isAdmin: Boolean(user.is_admin)
  };

  setFlash(req, "success", `Bienvenue ${user.username}.`);
  res.redirect(user.is_admin ? "/admin" : "/dashboard");
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

router.post("/account/password", requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPasswordValidation = validatePassword(req.body.newPassword);
  const confirmPassword = String(req.body.confirmNewPassword || "");

  if (!newPasswordValidation.valid) {
    setFlash(req, "error", newPasswordValidation.message);
    return res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
  }

  if (newPasswordValidation.value !== confirmPassword) {
    setFlash(req, "error", "La confirmation du nouveau mot de passe ne correspond pas.");
    return res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
  }

  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ? LIMIT 1")
    .get(req.session.user.id);

  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    setFlash(req, "error", "Mot de passe actuel incorrect.");
    return res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
  }

  db.prepare(
    `
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(bcrypt.hashSync(newPasswordValidation.value, 12), new Date().toISOString(), req.session.user.id);

  setFlash(req, "success", "Mot de passe mis a jour.");
  res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
});

router.post("/account/username", requireAuth, (req, res) => {
  const usernameValidation = validateUsername(req.body.username);

  if (!usernameValidation.valid) {
    setFlash(req, "error", usernameValidation.message);
    return res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
  }

  const existingUser = db
    .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ? LIMIT 1")
    .get(usernameValidation.value, req.session.user.id);

  if (existingUser) {
    setFlash(req, "error", "Ce nom d'utilisateur est deja utilise.");
    return res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
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
  res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
});

router.get("/admin", requireAdmin, (req, res) => {
  const search = cleanText(req.query.search || "");
  const searchPattern = `%${search.toLowerCase()}%`;
  const calculations = db
    .prepare(
      `
        SELECT calculations.*, users.username
        FROM calculations
        LEFT JOIN users ON users.id = calculations.user_id
        ORDER BY calculations.id DESC
      `
    )
    .all();

  const users = db
    .prepare(
      `
        SELECT
          users.id,
          users.username,
          users.is_admin,
          users.created_at,
          (
            SELECT calculations.ip_address
            FROM calculations
            WHERE calculations.user_id = users.id
            ORDER BY calculations.id DESC
            LIMIT 1
          ) AS latest_ip,
          (
            SELECT COUNT(*)
            FROM calculations
            WHERE calculations.user_id = users.id
          ) AS calculations_count
        FROM users
        WHERE
          ? = ''
          OR LOWER(users.username) LIKE ?
          OR LOWER(COALESCE((
            SELECT calculations.ip_address
            FROM calculations
            WHERE calculations.user_id = users.id
            ORDER BY calculations.id DESC
            LIMIT 1
          ), '')) LIKE ?
        ORDER BY users.is_admin DESC, LOWER(users.username) ASC
      `
    )
    .all(search, searchPattern, searchPattern);

  const ipBans = db
    .prepare(
      `
        SELECT ip_bans.*, users.username AS admin_username
        FROM ip_bans
        LEFT JOIN users ON users.id = ip_bans.created_by_user_id
        ORDER BY ip_bans.is_active DESC, ip_bans.id DESC
      `
    )
    .all();

  res.render("admin", {
    pageTitle: "Gestion privee",
    calculations,
    ipBans,
    users,
    search
  });
});

router.post("/admin/entries/:id/delete", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM calculations WHERE id = ?").run(Number(req.params.id));
  setFlash(req, "success", "Entree supprimee.");
  res.redirect("/admin");
});

router.post("/admin/ip-bans", requireAdmin, (req, res) => {
  const ipAddress = cleanText(req.body.ipAddress);
  const reason = cleanText(req.body.reason);

  const ipValid = ipAddress.length >= 3 && ipAddress.length <= 64;
  const reasonValid = reason.length >= 5 && reason.length <= 160;

  if (!ipValid || !reasonValid) {
    setFlash(req, "error", "Adresse IP ou motif invalide.");
    return res.redirect("/admin");
  }

  const timestamp = createTimestampParts(appTimeZone);

  db.prepare(
    `
      INSERT INTO ip_bans (ip_address, reason, is_active, created_at, created_by_user_id, lifted_at, lifted_by_user_id)
      VALUES (?, ?, 1, ?, ?, NULL, NULL)
      ON CONFLICT(ip_address) DO UPDATE SET
        reason = excluded.reason,
        is_active = 1,
        created_at = excluded.created_at,
        created_by_user_id = excluded.created_by_user_id,
        lifted_at = NULL,
        lifted_by_user_id = NULL
    `
  ).run(ipAddress, reason, timestamp.iso, req.session.user.id);

  setFlash(req, "success", "Adresse IP bannie.");
  res.redirect("/admin");
});

router.post("/admin/ip-bans/:id/lift", requireAdmin, (req, res) => {
  db.prepare(
    `
      UPDATE ip_bans
      SET is_active = 0, lifted_at = ?, lifted_by_user_id = ?
      WHERE id = ?
    `
  ).run(new Date().toISOString(), req.session.user.id, Number(req.params.id));

  setFlash(req, "success", "Ban leve.");
  res.redirect("/admin");
});

router.post("/admin/users/:id/toggle-admin", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const targetUser = db
    .prepare("SELECT id, is_admin, username FROM users WHERE id = ? LIMIT 1")
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", "Compte introuvable.");
    return res.redirect("/admin");
  }

  const nextAdminState = targetUser.is_admin ? 0 : 1;

  if (req.session.user.id === userId && nextAdminState === 0) {
    setFlash(req, "error", "Vous ne pouvez pas retirer vos propres droits de gestion.");
    return res.redirect("/admin");
  }

  if (targetUser.is_admin) {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE is_admin = 1")
      .get().total;

    if (adminCount <= 1) {
      setFlash(req, "error", "Il doit toujours rester au moins un compte de gestion.");
      return res.redirect("/admin");
    }
  }

  db.prepare(
    `
      UPDATE users
      SET is_admin = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(nextAdminState, new Date().toISOString(), userId);

  if (req.session.user.id === userId) {
    req.session.user.isAdmin = Boolean(nextAdminState);
  }

  setFlash(req, "success", nextAdminState ? "Droits de gestion accordes." : "Droits de gestion retires.");
  res.redirect("/admin");
});

router.post("/admin/users/:id/delete", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);

  if (req.session.user.id === userId) {
    setFlash(req, "error", "Vous ne pouvez pas supprimer votre propre compte.");
    return res.redirect("/admin");
  }

  const targetUser = db
    .prepare("SELECT id, is_admin FROM users WHERE id = ? LIMIT 1")
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", "Compte introuvable.");
    return res.redirect("/admin");
  }

  if (targetUser.is_admin) {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE is_admin = 1")
      .get().total;

    if (adminCount <= 1) {
      setFlash(req, "error", "Impossible de supprimer le dernier compte de gestion.");
      return res.redirect("/admin");
    }
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(userId);

  setFlash(req, "success", "Compte supprime.");
  res.redirect("/admin");
});

router.post("/admin/users/:id/ban-ip", requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const reason = cleanText(req.body.reason);
  const targetUser = db
    .prepare(
      `
        SELECT
          users.id,
          users.username,
          (
            SELECT calculations.ip_address
            FROM calculations
            WHERE calculations.user_id = users.id
            ORDER BY calculations.id DESC
            LIMIT 1
          ) AS latest_ip
        FROM users
        WHERE users.id = ?
        LIMIT 1
      `
    )
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", "Compte introuvable.");
    return res.redirect("/admin");
  }

  if (!targetUser.latest_ip) {
    setFlash(req, "error", "Aucune adresse IP connue pour ce compte.");
    return res.redirect("/admin");
  }

  if (reason.length < 5 || reason.length > 160) {
    setFlash(req, "error", "Le motif du ban doit contenir entre 5 et 160 caracteres.");
    return res.redirect("/admin");
  }

  const timestamp = createTimestampParts(appTimeZone);

  db.prepare(
    `
      INSERT INTO ip_bans (ip_address, reason, is_active, created_at, created_by_user_id, lifted_at, lifted_by_user_id)
      VALUES (?, ?, 1, ?, ?, NULL, NULL)
      ON CONFLICT(ip_address) DO UPDATE SET
        reason = excluded.reason,
        is_active = 1,
        created_at = excluded.created_at,
        created_by_user_id = excluded.created_by_user_id,
        lifted_at = NULL,
        lifted_by_user_id = NULL
    `
  ).run(targetUser.latest_ip, reason, timestamp.iso, req.session.user.id);

  setFlash(req, "success", "Adresse IP du compte bannie.");
  res.redirect("/admin");
});

router.get("/admin/export.xlsx", requireAdmin, (req, res) => {
  const calculations = db
    .prepare(
      `
        SELECT calculations.*, users.username
        FROM calculations
        LEFT JOIN users ON users.id = calculations.user_id
        ORDER BY calculations.id DESC
      `
    )
    .all();

  const workbookBuffer = buildEntriesWorkbook(calculations);

  res.setHeader(
    "Content-Disposition",
    'attachment; filename="historique-debit-roller-coaster.xlsx"'
  );
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(workbookBuffer);
});

module.exports = {
  router
};
