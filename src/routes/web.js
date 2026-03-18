const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const db = require("../db");
const {
  requireAuth,
  requireAdmin,
  requireHelperOrAdmin,
  redirectIfAuthenticated
} = require("../middleware/auth");
const {
  appendAttractionToCatalog,
  findAttractionById,
  getCatalogInfo,
  searchAttractions
} = require("../services/attractionsCatalog");
const { getClientIp, setFlash, createTimestampParts } = require("../utils/security");
const {
  cleanText,
  validateAttractionName,
  validateInteger,
  validateUsername,
  validatePassword
} = require("../utils/validation");

const router = express.Router();
const appTimeZone = process.env.APP_TIMEZONE || "Europe/Paris";
const siteUrl = process.env.SITE_URL || "https://roller-flow.xyz";

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

function buildSessionUser(user) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: Boolean(user.is_admin),
    isHelper: Boolean(user.is_helper)
  };
}

function getNotificationTargets(user) {
  const targets = ["all"];

  if (user.isAdmin) {
    targets.push("admins");
  }

  if (user.isHelper) {
    targets.push("helpers");
  }

  return targets;
}

function getNotificationsForUser(userId, sessionUser) {
  const targets = getNotificationTargets(sessionUser);
  const placeholders = targets.map(() => "?").join(", ");

  return db
    .prepare(
      `
        SELECT
          notifications.id,
          notifications.title,
          notifications.message,
          notifications.target_role,
          notifications.created_at,
          sender.username AS sender_username,
          CASE WHEN notification_reads.id IS NULL THEN 0 ELSE 1 END AS is_read
        FROM notifications
        LEFT JOIN users AS sender ON sender.id = notifications.created_by_user_id
        LEFT JOIN notification_reads
          ON notification_reads.notification_id = notifications.id
         AND notification_reads.user_id = ?
        WHERE notifications.target_role IN (${placeholders})
        ORDER BY notifications.id DESC
      `
    )
    .all(userId, ...targets);
}

function resolveNotificationTargetLabel(targetRole) {
  if (targetRole === "admins") {
    return "Admins";
  }

  if (targetRole === "helpers") {
    return "Helpers";
  }

  return "Tous les comptes";
}

function renderSeoPage(res, options) {
  res.render("content-page", {
    pageTitle: options.pageTitle,
    seoTitle: options.seoTitle,
    seoDescription: options.seoDescription,
    canonicalUrl: `${siteUrl}${options.path}`,
    eyebrow: options.eyebrow,
    title: options.title,
    intro: options.intro,
    sections: options.sections
  });
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

router.get("/fonctionnement", (req, res) => {
  renderSeoPage(res, {
    path: "/fonctionnement",
    pageTitle: "Fonctionnement",
    seoTitle: "Fonctionnement du calculateur de debit | Roller Flow",
    seoDescription: "Comprenez comment fonctionne le calculateur de debit Roller Flow pour les roller coasters et attractions.",
    eyebrow: "Guide",
    title: "Fonctionnement du calculateur",
    intro: "Un apercu simple du calcul, des modes disponibles et de l'usage du site.",
    sections: [
      {
        title: "Intro",
        paragraphs: [
          "Roller Flow est un outil qui permet d'estimer rapidement le debit horaire d'une attraction a partir de deux donnees simples : le nombre de personnes par train et le nombre de trains qui passent en 2 minutes.",
          "L'objectif est d'obtenir une estimation claire, rapide et facile a comparer entre plusieurs attractions."
        ]
      },
      {
        title: "Comment faire un calcul",
        paragraphs: [
          "1. Renseigner le nom de l'attraction : vous pouvez saisir librement le nom de l'attraction pour retrouver plus facilement vos calculs.",
          "2. Entrer les donnees d'exploitation : vous devez indiquer le nombre de personnes par train et le nombre de trains observes en 2 minutes.",
          "3. Valider le calcul : Roller Flow affiche alors une estimation du debit de l'attraction en personnes par heure."
        ]
      },
      {
        title: "La formule utilisee",
        paragraphs: [
          "La formule utilisee par Roller Flow est la suivante : personnes par train x 30 x trains en 2 minutes.",
          "Pourquoi x 30 ? Parce qu'une heure contient 30 periodes de 2 minutes."
        ]
      },
      {
        title: "Exemple",
        paragraphs: [
          "Si une attraction embarque 24 personnes par train et que 3 trains passent en 2 minutes : 24 x 30 x 3 = 2160 personnes/heure.",
          "Le debit estime est donc de 2160 personnes par heure."
        ]
      },
      {
        title: "Les deux modes disponibles",
        paragraphs: [
          "Mode manuel : le mode manuel permet de saisir les informations soi-meme. Il est ideal pour faire un calcul rapide a partir d'une observation terrain ou d'une estimation personnelle.",
          "Mode auto : le mode auto s'appuie sur un catalogue d'attractions. Il permet de gagner du temps en facilitant la saisie, selon les donnees disponibles dans l'outil."
        ]
      },
      {
        title: "Historique et compte utilisateur",
        paragraphs: [
          "En creant un compte, vous pouvez enregistrer vos calculs, consulter votre historique et retrouver facilement vos estimations precedentes."
        ]
      },
      {
        title: "Important a savoir",
        paragraphs: [
          "Le resultat affiche par Roller Flow est une estimation theorique ou observee, selon les donnees saisies.",
          "Le debit reel peut varier en fonction de nombreux facteurs : temps de chargement, efficacite des operateurs, taux de remplissage, pannes ou ralentissements, conditions d'exploitation."
        ]
      },
      {
        title: "Conclusion",
        paragraphs: [
          "Roller Flow a ete concu pour proposer un calcul simple, rapide et lisible du debit d'un roller coaster, sur mobile comme sur ordinateur."
        ]
      }
    ]
  });
});

router.get("/faq", (req, res) => {
  renderSeoPage(res, {
    path: "/faq",
    pageTitle: "FAQ",
    seoTitle: "FAQ calculateur de debit attraction | Roller Flow",
    seoDescription: "Questions frequentes sur le calcul du debit d'un roller coaster, le mode auto et l'historique personnel.",
    eyebrow: "FAQ",
    title: "Questions frequentes",
    intro: "Les reponses aux questions les plus utiles sur Roller Flow.",
    sections: [
      {
        title: "Qu'est-ce que Roller Flow ?",
        paragraphs: [
          "Roller Flow est un calculateur qui permet d'estimer le debit horaire d'un roller coaster ou d'une attraction a trains, a partir de donnees simples d'exploitation."
        ]
      },
      {
        title: "A quoi correspond le debit horaire ?",
        paragraphs: [
          "Le debit horaire correspond au nombre estime de personnes pouvant etre transportees en une heure."
        ]
      },
      {
        title: "Comment est calcule le resultat ?",
        paragraphs: [
          "Le calcul repose sur la formule suivante : personnes par train x 30 x trains en 2 minutes.",
          "Cette formule permet d'obtenir une estimation en personnes par heure."
        ]
      },
      {
        title: "Pourquoi utilisez-vous une base de 2 minutes ?",
        paragraphs: [
          "Le passage en 2 minutes permet d'obtenir une base simple, rapide a observer sur le terrain et facile a convertir en debit horaire."
        ]
      },
      {
        title: "Le resultat est-il exact ?",
        paragraphs: [
          "Le resultat est une estimation.",
          "Il depend directement de la qualite des donnees saisies et ne remplace pas une mesure d'exploitation officielle."
        ]
      },
      {
        title: "Quelle est la difference entre le mode manuel et le mode auto ?",
        paragraphs: [
          "Mode manuel : vous entrez vous-meme les donnees.",
          "Mode auto : l'outil s'appuie sur un catalogue d'attractions pour simplifier la saisie."
        ]
      },
      {
        title: "Faut-il creer un compte ?",
        paragraphs: [
          "Non, une partie de l'outil peut etre utilisee en visiteur.",
          "En revanche, creer un compte permet d'acceder a plus de fonctionnalites, comme l'historique et l'enregistrement des calculs."
        ]
      },
      {
        title: "Pourquoi suis-je limite en mode visiteur ?",
        paragraphs: [
          "Le mode visiteur permet de tester rapidement l'outil.",
          "La creation d'un compte debloque une utilisation plus complete et un meilleur suivi de vos calculs."
        ]
      },
      {
        title: "Puis-je enregistrer mes calculs ?",
        paragraphs: [
          "Oui, l'enregistrement des calculs est disponible pour les utilisateurs connectes."
        ]
      },
      {
        title: "Le site fonctionne-t-il sur mobile ?",
        paragraphs: [
          "Oui, Roller Flow est pense pour etre utilise aussi bien sur ordinateur que sur mobile."
        ]
      },
      {
        title: "Est-ce reserve aux roller coasters ?",
        paragraphs: [
          "Le site est principalement pense pour les roller coasters, mais il peut aussi servir a estimer le debit d'autres attractions fonctionnant avec une logique similaire de trains ou vehicules."
        ]
      },
      {
        title: "Le debit reel peut-il etre different ?",
        paragraphs: [
          "Oui. Le debit reel peut varier selon le temps de chargement, le taux de remplissage, le nombre de trains reellement en ligne, les arrets temporaires et l'exploitation du moment."
        ]
      },
      {
        title: "Mes donnees sont-elles publiques ?",
        paragraphs: [
          "Les calculs enregistres dans votre compte sont associes a votre espace personnel.",
          "Nous ne publions pas automatiquement vos historiques."
        ]
      }
    ]
  });
});

router.get("/a-propos", (req, res) => {
  renderSeoPage(res, {
    path: "/a-propos",
    pageTitle: "A propos",
    seoTitle: "A propos de Roller Flow | Calculateur de debit attraction",
    seoDescription: "Presentation de Roller Flow, outil de calcul de debit attraction pour roller coasters et parcs.",
    eyebrow: "Site",
    title: "A propos de Roller Flow",
    intro: "Un projet simple pour calculer, comparer et retrouver plus facilement le debit d'une attraction.",
    sections: [
      {
        title: "Le projet",
        paragraphs: [
          "Roller Flow est un projet cree pour proposer un outil simple de calcul de debit d'attractions, centre avant tout sur les roller coasters.",
          "L'idee est nee d'un besoin clair : pouvoir estimer rapidement la capacite horaire d'une attraction a partir de donnees faciles a relever, sans avoir a utiliser un tableur ou refaire le calcul a la main."
        ]
      },
      {
        title: "L'objectif du site",
        paragraphs: [
          "Le site a ete pense pour etre rapide a utiliser, lisible sur mobile comme sur ordinateur, et utile aussi bien pour les passionnes que pour les personnes qui veulent comparer plusieurs attractions.",
          "Roller Flow permet aujourd'hui de faire des calculs en mode manuel, d'utiliser un mode auto base sur un catalogue d'attractions, et d'enregistrer son historique avec un compte utilisateur."
        ]
      },
      {
        title: "Une evolution continue",
        paragraphs: [
          "Le projet continue d'evoluer avec l'objectif de rendre l'analyse d'exploitation plus simple, plus accessible et plus centralisee.",
          "Merci de faire partie des premiers utilisateurs de Roller Flow."
        ]
      }
    ]
  });
});

router.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /notifications
Disallow: /admin
Disallow: /requests
Disallow: /login
Disallow: /register
Disallow: /attraction-requests

Sitemap: ${siteUrl}/sitemap.xml
`);
});

router.get("/sitemap.xml", (req, res) => {
  const pages = ["/", "/fonctionnement", "/faq", "/a-propos"];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (page) => `  <url>
    <loc>${siteUrl}${page === "/" ? "" : page}</loc>
  </url>`
  )
  .join("\n")}
</urlset>`;

  res.type("application/xml").send(xml);
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
        SELECT id, username, password_hash, is_admin, is_helper
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

  req.session.user = buildSessionUser(user);

  setFlash(req, "success", `Bienvenue ${user.username}.`);
  res.redirect("/dashboard");
});

router.get("/register", redirectIfAuthenticated, (req, res) => {
  res.render("register", {
    pageTitle: "Creer un compte"
  });
});

router.get("/attraction-requests/new", requireAuth, (req, res) => {
  res.render("attraction-request", {
    pageTitle: "Demander une attraction"
  });
});

router.post("/attraction-requests", requireAuth, (req, res) => {
  const attractionValidation = validateAttractionName(req.body.attractionName);
  const parkName = cleanText(req.body.parkName);
  const countryName = cleanText(req.body.countryName);
  const peopleValidation = validateInteger(
    req.body.peoplePerTrain,
    "Le nombre de personnes par train",
    { min: 1, max: 100 }
  );

  if (!attractionValidation.valid) {
    setFlash(req, "error", attractionValidation.message);
    return res.redirect("/attraction-requests/new");
  }

  if (parkName.length < 2 || parkName.length > 80) {
    setFlash(req, "error", "Le nom du parc doit contenir entre 2 et 80 caracteres.");
    return res.redirect("/attraction-requests/new");
  }

  if (countryName.length < 2 || countryName.length > 60) {
    setFlash(req, "error", "Le pays doit contenir entre 2 et 60 caracteres.");
    return res.redirect("/attraction-requests/new");
  }

  if (!peopleValidation.valid) {
    setFlash(req, "error", peopleValidation.message);
    return res.redirect("/attraction-requests/new");
  }

  db.prepare(
    `
      INSERT INTO attraction_requests (
        attraction_name,
        park_name,
        country_name,
        people_per_train,
        requested_by_user_id,
        requested_by_username,
        requester_ip,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `
  ).run(
    attractionValidation.value,
    parkName,
    countryName,
    peopleValidation.value,
    req.session.user ? req.session.user.id : null,
    req.session.user ? req.session.user.username : null,
    getClientIp(req),
    new Date().toISOString()
  );

  setFlash(req, "success", "Votre demande a bien ete envoyee.");
  res.redirect("/");
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
        INSERT INTO users (username, password_hash, locked_ip, is_admin, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `
    )
    .run(usernameValidation.value, passwordHash, null, now, now);

  req.session.user = {
    id: Number(result.lastInsertRowid),
    username: usernameValidation.value,
    isAdmin: false,
    isHelper: false
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
  const notifications = getNotificationsForUser(req.session.user.id, req.session.user).slice(0, 3);

  res.render("dashboard", {
    pageTitle: "Mon espace",
    calculations,
    notifications,
    resolveNotificationTargetLabel
  });
});

router.get("/notifications", requireAuth, (req, res) => {
  const notifications = getNotificationsForUser(req.session.user.id, req.session.user);

  res.render("notifications", {
    pageTitle: "Notifications",
    notifications,
    resolveNotificationTargetLabel
  });
});

router.get("/admin/accounts", requireAuth, requireAdmin, (req, res) => {
  const users = db
    .prepare(
      `
        SELECT
          id,
          username,
          is_admin,
          is_helper,
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

router.post("/admin/notifications", requireAuth, requireAdmin, (req, res) => {
  const title = cleanText(req.body.title);
  const message = cleanText(req.body.message);
  const allowedTargets = new Set(["all", "helpers", "admins"]);
  const targetRole = allowedTargets.has(req.body.targetRole) ? req.body.targetRole : "";

  if (title.length < 3 || title.length > 80) {
    setFlash(req, "error", "Le titre doit contenir entre 3 et 80 caracteres.");
    return res.redirect("/admin/accounts");
  }

  if (message.length < 5 || message.length > 500) {
    setFlash(req, "error", "Le message doit contenir entre 5 et 500 caracteres.");
    return res.redirect("/admin/accounts");
  }

  if (!targetRole) {
    setFlash(req, "error", "Choisissez une cible valide.");
    return res.redirect("/admin/accounts");
  }

  db.prepare(
    `
      INSERT INTO notifications (title, message, target_role, created_at, created_by_user_id)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(title, message, targetRole, new Date().toISOString(), req.session.user.id);

  setFlash(req, "success", "Notification envoyee.");
  res.redirect("/admin/accounts");
});

router.post("/admin/users/:id/toggle-admin", requireAuth, requireAdmin, (req, res) => {
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

router.post("/admin/users/:id/toggle-helper", requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const targetUser = db
    .prepare("SELECT id, is_helper FROM users WHERE id = ? LIMIT 1")
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", "Compte introuvable.");
    return res.redirect("/admin/accounts");
  }

  const nextHelperState = targetUser.is_helper ? 0 : 1;

  db.prepare(
    `
      UPDATE users
      SET is_helper = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(nextHelperState, new Date().toISOString(), userId);

  if (req.session.user.id === userId) {
    req.session.user.isHelper = Boolean(nextHelperState);
  }

  setFlash(
    req,
    "success",
    nextHelperState ? "Compte passe helper." : "Statut helper retire."
  );
  res.redirect("/admin/accounts");
});

router.get("/requests/review", requireAuth, requireHelperOrAdmin, (req, res) => {
  const attractionRequests = db
    .prepare(
      `
        SELECT *
        FROM attraction_requests
        ORDER BY
          CASE status
            WHEN 'pending' THEN 0
            WHEN 'accepted' THEN 1
            ELSE 2
          END,
          id DESC
      `
    )
    .all();

  res.render("requests-review", {
    pageTitle: "Demandes",
    attractionRequests
  });
});

router.post("/requests/:id/accept", requireAuth, requireHelperOrAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const requestEntry = db
    .prepare("SELECT * FROM attraction_requests WHERE id = ? LIMIT 1")
    .get(requestId);

  if (!requestEntry) {
    setFlash(req, "error", "Demande introuvable.");
    return res.redirect("/requests/review");
  }

  if (requestEntry.status !== "pending") {
    setFlash(req, "error", "Cette demande a deja ete traitee.");
    return res.redirect("/requests/review");
  }

  appendAttractionToCatalog({
    countryName: requestEntry.country_name,
    parkName: requestEntry.park_name,
    attractionName: requestEntry.attraction_name,
    peoplePerTrain: requestEntry.people_per_train
  });

  db.prepare(
    `
      UPDATE attraction_requests
      SET status = 'accepted', processed_at = ?, processed_by_user_id = ?
      WHERE id = ?
    `
  ).run(new Date().toISOString(), req.session.user.id, requestId);

  setFlash(req, "success", "Demande acceptee et ajoutee au fichier Excel.");
  res.redirect("/requests/review");
});

router.post("/requests/:id/reject", requireAuth, requireHelperOrAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const requestEntry = db
    .prepare("SELECT id, status FROM attraction_requests WHERE id = ? LIMIT 1")
    .get(requestId);

  if (!requestEntry) {
    setFlash(req, "error", "Demande introuvable.");
    return res.redirect("/requests/review");
  }

  if (requestEntry.status !== "pending") {
    setFlash(req, "error", "Cette demande a deja ete traitee.");
    return res.redirect("/requests/review");
  }

  db.prepare(
    `
      UPDATE attraction_requests
      SET status = 'rejected', processed_at = ?, processed_by_user_id = ?
      WHERE id = ?
    `
  ).run(new Date().toISOString(), req.session.user.id, requestId);

  setFlash(req, "success", "Demande refusee.");
  res.redirect("/requests/review");
});

router.post("/notifications/read-all", requireAuth, (req, res) => {
  const notifications = getNotificationsForUser(req.session.user.id, req.session.user);
  const unreadNotifications = notifications.filter((notification) => !notification.is_read);
  const insertRead = db.prepare(
    `
      INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at)
      VALUES (?, ?, ?)
    `
  );
  const now = new Date().toISOString();

  const markAllAsRead = db.transaction(() => {
    unreadNotifications.forEach((notification) => {
      insertRead.run(notification.id, req.session.user.id, now);
    });
  });

  markAllAsRead();

  setFlash(req, "success", "Notifications marquees comme lues.");
  res.redirect("/notifications");
});

router.post("/notifications/:id/read", requireAuth, (req, res) => {
  const notificationId = Number(req.params.id);
  const notifications = getNotificationsForUser(req.session.user.id, req.session.user);
  const notification = notifications.find((entry) => entry.id === notificationId);

  if (!notification) {
    setFlash(req, "error", "Notification introuvable.");
    return res.redirect("/notifications");
  }

  db.prepare(
    `
      INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at)
      VALUES (?, ?, ?)
    `
  ).run(notificationId, req.session.user.id, new Date().toISOString());

  res.redirect("/notifications");
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
