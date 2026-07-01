const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const db = require("../db");
const { getLanguage, translate } = require("../i18n");
const {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
  requireHelperOrAdmin,
  requirePublicationOrAdmin,
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

function t(req, key, params) {
  return translate(req.session.lang, key, params);
}

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

function buildSessionUser(user) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: Boolean(user.is_admin || user.is_super_admin),
    isHelper: Boolean(user.is_helper || user.is_super_admin),
    isPublication: Boolean(user.is_publication || user.is_super_admin),
    isSuperAdmin: Boolean(user.is_super_admin)
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

  if (user.isPublication) {
    targets.push("publication");
  }

  return targets;
}

function getPublishedTimestamp(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return new Date().toISOString();
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
          notifications.category,
          notifications.target_role,
          notifications.created_at,
          notifications.updated_at,
          notifications.published_at,
          sender.username AS sender_username,
          CASE WHEN notification_reads.id IS NULL THEN 0 ELSE 1 END AS is_read
        FROM notifications
        LEFT JOIN users AS sender ON sender.id = notifications.created_by_user_id
        LEFT JOIN notification_reads
          ON notification_reads.notification_id = notifications.id
         AND notification_reads.user_id = ?
        WHERE notifications.target_role IN (${placeholders})
          AND notifications.published_at <= ?
        ORDER BY notifications.id DESC
      `
    )
    .all(userId, ...targets, new Date().toISOString());
}

function resolveNotificationCategoryLabel(category, lang) {
  const normalizedLang = getLanguage(lang);

  if (category === "polls") {
    return translate(normalizedLang, "notifications.categoryPolls");
  }

  return translate(normalizedLang, "notifications.categorySiteUpdates");
}

function getNewsPosts() {
  return db
    .prepare(
      `
        SELECT
          news_posts.id,
          news_posts.title,
          news_posts.summary,
          news_posts.content,
          news_posts.created_at,
          news_posts.updated_at,
          news_posts.published_at,
          users.username AS author_username
        FROM news_posts
        LEFT JOIN users ON users.id = news_posts.created_by_user_id
        WHERE news_posts.published_at <= ?
        ORDER BY news_posts.id DESC
      `
    )
    .all(new Date().toISOString());
}

function getPollsForUser(userId) {
  const polls = db
    .prepare(
      `
        SELECT
          polls.id,
          polls.title,
          polls.question,
          polls.allow_multiple,
          polls.created_at,
          polls.updated_at,
          polls.published_at,
          users.username AS author_username
        FROM polls
        LEFT JOIN users ON users.id = polls.created_by_user_id
        WHERE polls.published_at <= ?
        ORDER BY polls.id DESC
      `
    )
    .all(new Date().toISOString());

  const optionsStatement = db.prepare(
    `
      SELECT
        poll_options.id,
        poll_options.label,
        poll_options.position,
        (
          SELECT COUNT(*)
          FROM poll_answers
          WHERE poll_answers.poll_option_id = poll_options.id
        ) AS votes
      FROM poll_options
      WHERE poll_options.poll_id = ?
      ORDER BY poll_options.position ASC, poll_options.id ASC
    `
  );
  const selectedStatement = db.prepare(
    "SELECT poll_option_id FROM poll_answers WHERE poll_id = ? AND user_id = ?"
  );

  return polls.map((poll) => {
    const options = optionsStatement.all(poll.id);
    const selected = userId
      ? selectedStatement.all(poll.id, userId).map((entry) => entry.poll_option_id)
      : [];

    return {
      ...poll,
      options,
      selectedOptionIds: selected
    };
  });
}

function resolveNotificationTargetLabel(targetRole, lang) {
  const normalizedLang = getLanguage(lang);
  if (targetRole === "admins") {
    return translate(normalizedLang, "admin.admins");
  }

  if (targetRole === "helpers") {
    return translate(normalizedLang, "admin.helpers");
  }

  if (targetRole === "publication") {
    return translate(normalizedLang, "admin.publicationRole");
  }

  return translate(normalizedLang, "admin.allAccounts");
}

function buildNotificationFeedItems(notifications, newsPosts, lang) {
  const notificationItems = notifications.map((notification) => ({
    id: `notification-${notification.id}`,
    kind: "notification",
    title: notification.title,
    body: notification.message,
    summary: "",
    publishedAt: notification.published_at || notification.created_at,
    author: notification.sender_username || translate(lang, "notifications.system"),
    pills: [
      translate(lang, "notifications.typeNotification"),
      resolveNotificationTargetLabel(notification.target_role, lang)
    ],
    isRead: Boolean(notification.is_read),
    readActionId: notification.id
  }));

  const newsItems = newsPosts.map((post) => ({
    id: `news-${post.id}`,
    kind: "news",
    title: post.title,
    body: post.content,
    summary: post.summary,
    publishedAt: post.published_at || post.created_at,
    author: post.author_username || translate(lang, "notifications.system"),
    pills: [translate(lang, "notifications.typeNews")],
    isRead: true,
    readActionId: null
  }));

  return [...notificationItems, ...newsItems].sort((left, right) => {
    return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
  });
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
  const catalogInfo = getCatalogInfo();

  res.render("index", {
    pageTitle: t(req, "home.title"),
    catalogInfo
  });
});

router.get("/lang/:lang", (req, res) => {
  req.session.lang = getLanguage(req.params.lang);
  const referer = req.get("referer");

  if (referer && referer.startsWith(siteUrl)) {
    return res.redirect(referer);
  }

  res.redirect("/");
});

router.get("/actus", (req, res) => res.redirect("/notifications"));

router.get("/fonctionnement", (req, res) => {
  renderSeoPage(res, {
    path: "/fonctionnement",
    pageTitle: "Fonctionnement",
    seoTitle: "Fonctionnement du calculateur de debit | Roller Flow",
    seoDescription: "Comprenez comment fonctionne le calculateur de debit Roller Flow pour les roller coasters et attractions.",
    eyebrow: "Guide",
    title: "Fonctionnement du calculateur",
    intro: "Un apercu simple du calcul actuel, du catalogue d'attractions et des fonctions du compte.",
    sections: [
      {
        title: "Intro",
        paragraphs: [
          "Roller Flow permet d'estimer rapidement le debit horaire d'une attraction a partir du temps observe entre deux departs et de la capacite du train.",
          "L'objectif est d'obtenir un resultat clair, rapide a comparer et simple a enregistrer dans son espace personnel."
        ]
      },
      {
        title: "Comment faire un calcul",
        paragraphs: [
          "1. Rechercher une attraction dans le catalogue. Le site recupere automatiquement le nombre de personnes par train.",
          "2. Lancer le chrono et ajouter un train a chaque depart observe. Les temps sont enregistres en secondes.",
          "3. Enregistrer le calcul. Roller Flow calcule alors une moyenne et affiche une estimation en personnes par heure."
        ]
      },
      {
        title: "La formule utilisee",
        paragraphs: [
          "La formule utilisee est la suivante : debit horaire = 3600 / T x N.",
          "T correspond a la moyenne du temps entre deux departs, en secondes. N correspond au nombre de personnes par train."
        ]
      },
      {
        title: "Exemple",
        paragraphs: [
          "Si une attraction embarque 24 personnes par train et que la moyenne entre deux departs est de 40 secondes, le calcul devient : 3600 / 40 x 24.",
          "Le debit estime est alors de 2160 personnes par heure."
        ]
      },
      {
        title: "Catalogue et demandes",
        paragraphs: [
          "Le calcul s'appuie sur un catalogue d'attractions pour garder une base fiable sur les capacites par train.",
          "Si une attraction manque, les comptes connectes peuvent envoyer une demande d'ajout qui pourra ensuite etre validee."
        ]
      },
      {
        title: "Compte et historique",
        paragraphs: [
          "Avec un compte, vous pouvez enregistrer vos calculs, consulter votre historique, modifier votre pseudo et votre mot de passe, et supprimer vos anciens enregistrements.",
          "Le but est de garder un suivi simple et personnel de vos observations."
        ]
      },
      {
        title: "Notifications et sondages",
        paragraphs: [
          "Le centre de notifications regroupe les messages du site, les actus publiees et les sondages actifs.",
          "Selon votre role, certaines publications peuvent etre reservees a des groupes precis, tandis que les sondages peuvent etre ouverts a tous les comptes."
        ]
      },
      {
        title: "Important a savoir",
        paragraphs: [
          "Le resultat affiche par Roller Flow reste une estimation basee sur les temps observes et les donnees du catalogue.",
          "Le debit reel peut varier selon le chargement, le taux de remplissage, les ralentissements, le nombre de trains en ligne ou les conditions d'exploitation du moment."
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
          "Roller Flow est un outil qui permet d'estimer le debit horaire d'un roller coaster ou d'une attraction a trains, a partir d'observations simples sur le terrain."
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
          "Le calcul repose sur la formule suivante : debit horaire = 3600 / T x N.",
          "T est la moyenne du temps entre deux departs, en secondes, et N est le nombre de personnes par train."
        ]
      },
      {
        title: "Pourquoi utilisez-vous des secondes ?",
        paragraphs: [
          "Le site fonctionne maintenant a partir des temps reels observes entre deux departs.",
          "Cela permet une estimation plus fine et plus proche du rythme reel d'exploitation."
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
        title: "Faut-il creer un compte ?",
        paragraphs: [
          "Le calculateur reste consultable simplement, mais creer un compte permet de sauvegarder ses calculs et d'acceder a son historique.",
          "Le compte donne aussi acces aux demandes d'ajout et au centre de notifications personnalise."
        ]
      },
      {
        title: "Puis-je enregistrer mes calculs ?",
        paragraphs: [
          "Oui, l'enregistrement des calculs est disponible pour les utilisateurs connectes."
        ]
      },
      {
        title: "A quoi sert le catalogue d'attractions ?",
        paragraphs: [
          "Le catalogue permet de recuperer la capacite par train sans avoir a la ressaisir a chaque calcul.",
          "Cela aide a garder des calculs plus fiables et plus rapides a faire."
        ]
      },
      {
        title: "Que faire si une attraction n'existe pas dans la recherche ?",
        paragraphs: [
          "Si vous avez un compte, vous pouvez envoyer une demande d'ajout.",
          "Une fois validee, l'attraction pourra etre utilisee normalement dans le calculateur."
        ]
      },
      {
        title: "A quoi servent les notifications et les sondages ?",
        paragraphs: [
          "Le centre de notifications rassemble les messages du site, les actus et les sondages actifs.",
          "Les sondages permettent de repondre directement depuis votre compte, avec un choix unique ou plusieurs reponses selon le cas."
        ]
      },
      {
        title: "Le site fonctionne-t-il sur mobile ?",
        paragraphs: [
          "Oui. Roller Flow est maintenant reserve a un usage sur smartphone."
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
    intro: "Un projet simple pour calculer, comparer et suivre plus facilement le debit d'une attraction.",
    sections: [
      {
        title: "Le projet",
        paragraphs: [
          "Roller Flow est un projet cree pour proposer un outil simple de calcul de debit d'attractions, centre avant tout sur les roller coasters.",
          "L'idee est nee d'un besoin clair : pouvoir estimer rapidement la capacite horaire d'une attraction a partir de donnees faciles a relever, sans avoir a repasser par un tableur ou un calcul manuel."
        ]
      },
      {
        title: "L'objectif du site",
        paragraphs: [
          "Le site a ete pense pour etre rapide a utiliser sur smartphone et utile aussi bien pour les passionnes que pour les personnes qui veulent comparer plusieurs attractions.",
          "Aujourd'hui, Roller Flow permet de rechercher une attraction, chronometrer les departs, enregistrer un historique personnel et suivre les messages, actus et sondages du site."
        ]
      },
      {
        title: "Une base qui evolue",
        paragraphs: [
          "Le projet continue d'evoluer avec l'objectif de rendre l'analyse d'exploitation plus simple, plus accessible et plus centralisee.",
          "Le catalogue d'attractions, les demandes d'ajout et les outils de publication font partie de cette logique d'evolution continue."
        ]
      },
      {
        title: "Merci",
        paragraphs: [
          "Merci de faire partie des premiers utilisateurs de Roller Flow.",
          "Chaque retour aide a faire grandir un outil plus clair, plus utile et plus coherent pour la suite."
        ]
      }
    ]
  });
});

router.get("/cgu", (req, res) => {
  renderSeoPage(res, {
    path: "/cgu",
    pageTitle: "Conditions Generales d'Utilisation",
    seoTitle: "CGU | Roller Flow",
    seoDescription: "Consultez les Conditions Generales d'Utilisation du site Roller Flow.",
    eyebrow: "Legal",
    title: "Conditions Generales d'Utilisation",
    intro: "Les conditions encadrant l'acces et l'utilisation de Roller Flow.",
    sections: [
      {
        title: "Introduction",
        paragraphs: [
          "Les presentes Conditions Generales d'Utilisation ont pour objet de definir les modalites et conditions dans lesquelles les utilisateurs peuvent acceder et utiliser le site Roller Flow.",
          "L'utilisation du site implique l'acceptation pleine et entiere des presentes conditions par tout utilisateur.",
          "Le site Roller Flow est accessible a l'adresse suivante : https://roller-flow.xyz"
        ]
      },
      {
        title: "Article 1 - Description du service",
        paragraphs: [
          "Roller Flow est un outil en ligne permettant d'estimer le debit horaire d'une attraction, notamment des roller coasters, a partir de donnees saisies par l'utilisateur.",
          "Le service permet notamment de calculer une estimation de debit horaire, comparer differentes configurations d'exploitation, enregistrer des calculs dans un historique utilisateur et acceder a differentes fonctionnalites selon le mode utilise.",
          "Les resultats fournis par l'outil sont donnes a titre indicatif et reposent exclusivement sur les donnees renseignees par l'utilisateur."
        ]
      },
      {
        title: "Article 2 - Acces au site",
        paragraphs: [
          "Le site est accessible gratuitement a toute personne disposant d'un acces a Internet.",
          "Certaines fonctionnalites peuvent necessiter la creation d'un compte utilisateur.",
          "L'editeur du site s'efforce d'assurer une accessibilite permanente au service, mais ne peut garantir l'absence d'interruptions, notamment pour des raisons techniques, de maintenance ou de mise a jour."
        ]
      },
      {
        title: "Article 3 - Compte utilisateur",
        paragraphs: [
          "Certaines fonctionnalites du site necessitent la creation d'un compte.",
          "Lors de l'inscription, l'utilisateur s'engage a fournir des informations exactes et a jour.",
          "L'utilisateur est responsable de la confidentialite de ses identifiants de connexion et de toute activite realisee depuis son compte.",
          "En cas d'utilisation frauduleuse du compte, l'utilisateur s'engage a en informer l'editeur du site dans les plus brefs delais."
        ]
      },
      {
        title: "Article 4 - Utilisation du service",
        paragraphs: [
          "L'utilisateur s'engage a utiliser le site dans le respect des lois en vigueur et des presentes conditions.",
          "Il est notamment interdit d'utiliser le service a des fins illegales, de perturber le fonctionnement du site, de tenter d'acceder de maniere non autorisee aux systemes informatiques du service, et d'exploiter les donnees ou le fonctionnement du site a des fins abusives."
        ]
      },
      {
        title: "Article 5 - Fiabilite des resultats",
        paragraphs: [
          "Le calculateur propose par Roller Flow fournit des estimations basees sur les informations saisies par l'utilisateur.",
          "Ces resultats ne constituent pas des donnees officielles et peuvent varier en fonction de nombreux facteurs, notamment les conditions d'exploitation reelles, le taux de remplissage des trains, les temps de chargement, ainsi que les interruptions ou ralentissements d'exploitation.",
          "L'utilisateur reconnait que les resultats sont fournis a titre informatif."
        ]
      },
      {
        title: "Article 6 - Responsabilite",
        paragraphs: [
          "L'editeur du site ne pourra etre tenu responsable d'erreurs resultant des donnees saisies par l'utilisateur, d'une mauvaise interpretation des resultats, d'interruptions temporaires du service, ou de dommages indirects lies a l'utilisation du site.",
          "L'utilisateur reste seul responsable de l'utilisation qu'il fait des informations fournies par le site."
        ]
      },
      {
        title: "Article 7 - Propriete intellectuelle",
        paragraphs: [
          "L'ensemble du contenu present sur le site Roller Flow, incluant notamment les textes, le design, le code, les elements graphiques et la structure du site, est protege par les lois relatives a la propriete intellectuelle.",
          "Toute reproduction, modification ou diffusion du contenu sans autorisation prealable est interdite."
        ]
      },
      {
        title: "Article 8 - Modification des conditions",
        paragraphs: [
          "Les presentes Conditions Generales d'Utilisation peuvent etre modifiees a tout moment.",
          "La version applicable est celle publiee sur le site au moment de l'utilisation."
        ]
      },
      {
        title: "Article 9 - Droit applicable",
        paragraphs: [
          "Les presentes conditions sont regies par le droit francais.",
          "En cas de litige, une solution amiable sera privilegiee avant toute procedure judiciaire."
        ]
      }
    ]
  });
});

router.get("/mentions-legales", (req, res) => {
  renderSeoPage(res, {
    path: "/mentions-legales",
    pageTitle: "Mentions legales",
    seoTitle: "Mentions legales | Roller Flow",
    seoDescription: "Consultez les mentions legales du site Roller Flow.",
    eyebrow: "Legal",
    title: "Mentions legales",
    intro: "Les informations legales relatives au site Roller Flow.",
    sections: [
      {
        title: "Editeur du site",
        paragraphs: [
          "Le site Roller Flow est edite par :",
          "Editeur : Hugo bienne",
          "Site web : https://roller-flow.xyz",
          "Le responsable de la publication est l'administrateur du site."
        ]
      },
      {
        title: "Hebergement",
        paragraphs: [
          "Le site est heberge par un prestataire d'hebergement web.",
          "Les infrastructures d'hebergement assurent la disponibilite, la securite et le stockage des donnees du site."
        ]
      },
      {
        title: "Acces au site",
        paragraphs: [
          "Le site est accessible a tout moment, sauf en cas de maintenance technique ou de probleme independant de la volonte de l'editeur.",
          "L'editeur ne pourra etre tenu responsable d'une indisponibilite temporaire du service."
        ]
      },
      {
        title: "Propriete intellectuelle",
        paragraphs: [
          "L'ensemble du contenu present sur le site Roller Flow, incluant notamment les textes, les elements graphiques, la structure du site et le code source, est protege par les lois relatives a la propriete intellectuelle.",
          "Toute reproduction ou utilisation sans autorisation prealable est interdite."
        ]
      },
      {
        title: "Responsabilite",
        paragraphs: [
          "Les informations presentes sur le site sont fournies a titre informatif.",
          "Malgre le soin apporte a la redaction et a la mise a jour du contenu, l'editeur ne peut garantir l'exactitude ou l'exhaustivite des informations.",
          "L'utilisation des informations presentes sur le site se fait sous la responsabilite de l'utilisateur."
        ]
      }
    ]
  });
});

router.get("/politique-confidentialite", (req, res) => {
  renderSeoPage(res, {
    path: "/politique-confidentialite",
    pageTitle: "Politique de confidentialite",
    seoTitle: "Politique de confidentialite | Roller Flow",
    seoDescription: "Consultez la politique de confidentialite du site Roller Flow.",
    eyebrow: "Legal",
    title: "Politique de confidentialite",
    intro: "Les informations essentielles sur la collecte et l'utilisation des donnees personnelles sur Roller Flow.",
    sections: [
      {
        title: "Introduction",
        paragraphs: [
          "La presente politique de confidentialite explique comment les donnees personnelles des utilisateurs du site Roller Flow peuvent etre collectees et utilisees.",
          "Le respect de la vie privee des utilisateurs constitue une priorite."
        ]
      },
      {
        title: "Donnees collectees",
        paragraphs: [
          "Lors de l'utilisation du site, certaines informations peuvent etre collectees, notamment : informations liees a la creation d'un compte, donnees necessaires au fonctionnement du service, informations techniques liees a la navigation.",
          "Ces donnees sont collectees uniquement dans le cadre du fonctionnement du service."
        ]
      },
      {
        title: "Utilisation des donnees",
        paragraphs: [
          "Les donnees collectees peuvent etre utilisees pour permettre l'acces aux fonctionnalites du site, gerer les comptes utilisateurs, enregistrer l'historique des calculs, ameliorer l'experience utilisateur et assurer la securite du service.",
          "Les donnees ne sont pas vendues ni cedees a des tiers."
        ]
      },
      {
        title: "Conservation des donnees",
        paragraphs: [
          "Les donnees sont conservees pendant la duree necessaire au fonctionnement du service et a la gestion des comptes utilisateurs.",
          "Les utilisateurs peuvent demander la suppression de leurs donnees personnelles."
        ]
      },
      {
        title: "Securite",
        paragraphs: [
          "Des mesures techniques et organisationnelles sont mises en oeuvre afin de proteger les donnees personnelles contre tout acces non autorise, perte ou modification."
        ]
      },
      {
        title: "Droits des utilisateurs",
        paragraphs: [
          "Conformement a la reglementation en vigueur, les utilisateurs disposent de plusieurs droits concernant leurs donnees personnelles : droit d'acces, droit de rectification, droit de suppression et droit de limitation du traitement.",
          "Toute demande concernant les donnees personnelles peut etre adressee a l'administrateur du site."
        ]
      },
      {
        title: "Modification de la politique",
        paragraphs: [
          "La presente politique de confidentialite peut etre modifiee a tout moment afin de refleter l'evolution du service ou de la reglementation.",
          "La version en vigueur est celle publiee sur le site."
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
  const pages = [
    { path: "/", changefreq: "weekly", priority: "1.0" },
    { path: "/fonctionnement", changefreq: "monthly", priority: "0.8" },
    { path: "/faq", changefreq: "monthly", priority: "0.8" },
    { path: "/a-propos", changefreq: "monthly", priority: "0.7" },
    { path: "/cgu", changefreq: "yearly", priority: "0.4" },
    { path: "/mentions-legales", changefreq: "yearly", priority: "0.4" },
    { path: "/politique-confidentialite", changefreq: "yearly", priority: "0.4" }
  ];
  const lastmod = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (page) => `  <url>
    <loc>${siteUrl}${page.path === "/" ? "" : page.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  res.type("application/xml").send(xml);
});

router.get("/api/attractions/search", (req, res) => {
  const catalogInfo = getCatalogInfo();

  if (!catalogInfo.available) {
    return res.json({ results: [] });
  }

  return res.json({
    results: searchAttractions(req.query.q || "")
  });
});

router.post("/calculate", calculationLimiter, (req, res) => {
  const selectedAttraction = findAttractionById(req.body.catalogAttractionId);

  if (!selectedAttraction) {
    setFlash(req, "error", t(req, "flash.selectValidRide"));
    return res.redirect("/");
  }

  const rawDispatchTimes = (Array.isArray(req.body.dispatchTimes) ? req.body.dispatchTimes : [req.body.dispatchTimes])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const dispatchTimes = rawDispatchTimes.map((value) =>
    validateInteger(value, t(req, "flash.dispatchTimeLabel"), { min: 1, max: 600 })
  );

  if (dispatchTimes.length === 0) {
    setFlash(req, "error", t(req, "flash.enterAtLeastOneTime"));
    return res.redirect("/");
  }

  if (dispatchTimes.length > 10) {
    setFlash(req, "error", t(req, "flash.maxTenTimes"));
    return res.redirect("/");
  }

  const invalidDispatchTime = dispatchTimes.find((entry) => !entry.valid);

  if (invalidDispatchTime) {
    setFlash(req, "error", invalidDispatchTime.message);
    return res.redirect("/");
  }

  const validDispatchTimes = dispatchTimes.map((entry) => entry.value);
  const averageDispatchSeconds = Number(
    (validDispatchTimes.reduce((sum, value) => sum + value, 0) / validDispatchTimes.length).toFixed(2)
  );
  const attractionName = selectedAttraction.displayName;
  const peoplePerTrain = selectedAttraction.peoplePerTrain;

  const ipAddress = getClientIp(req);
  const timestamp = createTimestampParts(appTimeZone);
  const throughput = Math.round((3600 / averageDispatchSeconds) * peoplePerTrain);

  db.prepare(
    `
      INSERT INTO calculations (
        attraction_name,
        people_per_train,
        trains_in_two_minutes,
        train_window_minutes,
        average_dispatch_seconds,
        time_samples_count,
        throughput_per_hour,
        recorded_date,
        recorded_time,
        created_at,
        ip_address,
        user_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    attractionName,
    peoplePerTrain,
    0,
    0,
    averageDispatchSeconds,
    validDispatchTimes.length,
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
    averageDispatchSeconds,
    timeSamplesCount: validDispatchTimes.length
  };

  setFlash(req, "success", t(req, "flash.calculationSaved"));
  res.redirect("/");
});

router.get("/login", redirectIfAuthenticated, (req, res) => {
  res.render("login", {
    pageTitle: t(req, "nav.login")
  });
});

router.post("/login", authLimiter, redirectIfAuthenticated, (req, res) => {
  const usernameValidation = validateUsername(req.body.username);
  const password = String(req.body.password || "");

  if (!usernameValidation.valid || password.length === 0) {
    setFlash(req, "error", t(req, "flash.invalidCredentials"));
    return res.redirect("/login");
  }

  const user = db
    .prepare(
      `
        SELECT id, username, password_hash, is_admin, is_helper, is_publication, is_super_admin
        FROM users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
      `
    )
    .get(usernameValidation.value);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    setFlash(req, "error", t(req, "flash.invalidCredentials"));
    return res.redirect("/login");
  }

  req.session.user = buildSessionUser(user);

  setFlash(req, "success", t(req, "flash.welcomeUser", { username: user.username }));
  res.redirect("/dashboard");
});

router.get("/register", redirectIfAuthenticated, (req, res) => {
  res.render("register", {
    pageTitle: t(req, "nav.register")
  });
});

router.get("/attraction-requests/new", requireAuth, (req, res) => {
  res.render("attraction-request", {
    pageTitle: t(req, "requests.requestRide")
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
    setFlash(req, "error", t(req, "flash.parkNameLength"));
    return res.redirect("/attraction-requests/new");
  }

  if (countryName.length < 2 || countryName.length > 60) {
    setFlash(req, "error", t(req, "flash.countryNameLength"));
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

  setFlash(req, "success", t(req, "flash.requestSent"));
  res.redirect("/");
});

router.post("/register", registerLimiter, redirectIfAuthenticated, (req, res) => {
  const usernameValidation = validateUsername(req.body.username);
  const passwordValidation = validatePassword(req.body.password);
  const confirmPassword = String(req.body.confirmPassword || "");
  const acceptsCgu = req.body.acceptCgu === "on";
  const acceptsLegal = req.body.acceptLegal === "on";
  const acceptsPrivacy = req.body.acceptPrivacy === "on";

  if (!usernameValidation.valid) {
    setFlash(req, "error", usernameValidation.message);
    return res.redirect("/register");
  }

  if (!passwordValidation.valid) {
    setFlash(req, "error", passwordValidation.message);
    return res.redirect("/register");
  }

  if (passwordValidation.value !== confirmPassword) {
    setFlash(req, "error", t(req, "flash.passwordConfirmationMismatch"));
    return res.redirect("/register");
  }

  if (!acceptsCgu || !acceptsLegal || !acceptsPrivacy) {
    setFlash(req, "error", t(req, "flash.legalConsentRequired"));
    return res.redirect("/register");
  }

  const existingUser = db
    .prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1")
    .get(usernameValidation.value);

  if (existingUser) {
    setFlash(req, "error", t(req, "flash.usernameTaken"));
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
    isHelper: false,
    isPublication: false,
    isSuperAdmin: false
  };

  setFlash(req, "success", t(req, "flash.accountCreated"));
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
          SELECT id, attraction_name, people_per_train, average_dispatch_seconds, time_samples_count, throughput_per_hour, recorded_date, recorded_time
          FROM calculations
        WHERE user_id = ?
        ORDER BY id DESC
      `
    )
    .all(req.session.user.id);
  const notifications = getNotificationsForUser(req.session.user.id, req.session.user).slice(0, 3);

  res.render("dashboard", {
    pageTitle: t(req, "dashboard.title"),
    calculations,
    notifications,
    resolveNotificationTargetLabel: (targetRole) => resolveNotificationTargetLabel(targetRole, req.session.lang),
    resolveNotificationCategoryLabel: (category) => resolveNotificationCategoryLabel(category, req.session.lang)
  });
});

router.get("/notifications", requireAuth, (req, res) => {
  const notifications = getNotificationsForUser(req.session.user.id, req.session.user);
  const newsPosts = getNewsPosts();
  const polls = getPollsForUser(req.session.user.id);
  const feedItems = buildNotificationFeedItems(notifications, newsPosts, req.session.lang);

  res.render("notifications", {
    pageTitle: t(req, "notifications.title"),
    notifications,
    newsPosts,
    polls,
    feedItems,
    resolveNotificationTargetLabel: (targetRole) => resolveNotificationTargetLabel(targetRole, req.session.lang),
    resolveNotificationCategoryLabel: (category) => resolveNotificationCategoryLabel(category, req.session.lang)
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
          is_publication,
          is_super_admin,
          created_at,
          (
            SELECT COUNT(*)
            FROM calculations
            WHERE calculations.user_id = users.id
          ) AS calculations_count
        FROM users
        ORDER BY is_super_admin DESC, is_admin DESC, LOWER(username) ASC
      `
    )
    .all();

  res.render("admin-accounts", {
    pageTitle: t(req, "admin.title"),
    users
  });
});

router.get("/publications/manage", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const notifications = db
    .prepare(
      `
        SELECT id, title, message, category, target_role, created_at, updated_at, published_at
        FROM notifications
        ORDER BY published_at DESC, id DESC
      `
    )
    .all();
  const newsPosts = db
    .prepare(
      `
        SELECT id, title, summary, content, created_at, updated_at, published_at
        FROM news_posts
        ORDER BY published_at DESC, id DESC
      `
    )
    .all();
  const polls = db
    .prepare(
      `
        SELECT id, title, question, allow_multiple, created_at, updated_at, published_at
        FROM polls
        ORDER BY published_at DESC, id DESC
      `
    )
    .all()
    .map((poll) => ({
      ...poll,
      options: db.prepare("SELECT id, label, position FROM poll_options WHERE poll_id = ? ORDER BY position ASC, id ASC").all(poll.id)
    }));

  res.render("publications-manage", {
    pageTitle: t(req, "publication.title"),
    notifications,
    newsPosts,
    polls,
    resolveNotificationTargetLabel: (targetRole) => resolveNotificationTargetLabel(targetRole, req.session.lang),
    resolveNotificationCategoryLabel: (category) => resolveNotificationCategoryLabel(category, req.session.lang)
  });
});

router.post("/publications/notifications/create", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const title = cleanText(req.body.title);
  const publishedAt = getPublishedTimestamp(req.body.publishedAt);

  if (title.length < 3 || title.length > 120) {
    setFlash(req, "error", t(req, "flash.titleLength"));
    return res.redirect("/publications/manage");
  }

  if (!publishedAt) {
    setFlash(req, "error", t(req, "flash.invalidPublicationDate"));
    return res.redirect("/publications/manage");
  }

  const message = cleanText(req.body.message);
  const allowedTargets = new Set(["all", "helpers", "admins", "publication"]);
  const targetRole = allowedTargets.has(req.body.targetRole) ? req.body.targetRole : "";

  if (message.length < 5 || message.length > 500) {
    setFlash(req, "error", t(req, "flash.messageLength"));
    return res.redirect("/publications/manage");
  }

  if (!targetRole) {
    setFlash(req, "error", t(req, "flash.chooseValidTarget"));
    return res.redirect("/publications/manage");
  }

  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO notifications (title, message, category, target_role, created_at, updated_at, published_at, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(title, message, "site_updates", targetRole, now, now, publishedAt, req.session.user.id);

  setFlash(req, "success", t(req, "flash.notificationSent"));
  return res.redirect("/publications/manage");
});

router.post("/publications/news/create", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const title = cleanText(req.body.title);
  const summary = cleanText(req.body.summary);
  const content = cleanText(req.body.content);
  const publishedAt = getPublishedTimestamp(req.body.publishedAt);

  if (title.length < 3 || title.length > 120) {
    setFlash(req, "error", t(req, "flash.titleLength"));
    return res.redirect("/publications/manage");
  }

  if (!publishedAt) {
    setFlash(req, "error", t(req, "flash.invalidPublicationDate"));
    return res.redirect("/publications/manage");
  }

  if (summary.length < 10 || summary.length > 220) {
    setFlash(req, "error", t(req, "flash.newsSummaryLength"));
    return res.redirect("/publications/manage");
  }

  if (content.length < 30 || content.length > 5000) {
    setFlash(req, "error", t(req, "flash.newsContentLength"));
    return res.redirect("/publications/manage");
  }

  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO news_posts (title, summary, content, created_at, updated_at, published_at, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(title, summary, content, now, now, publishedAt, req.session.user.id);

  setFlash(req, "success", t(req, "flash.newsPublished"));
  return res.redirect("/publications/manage");
});

router.post("/publications/polls/create", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const title = cleanText(req.body.title);
  const question = cleanText(req.body.question);
  const allowMultiple = req.body.allowMultiple === "on" ? 1 : 0;
  const options = String(req.body.options || "")
    .split(/\r?\n/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  const publishedAt = getPublishedTimestamp(req.body.publishedAt);

  if (title.length < 3 || title.length > 120) {
    setFlash(req, "error", t(req, "flash.titleLength"));
    return res.redirect("/publications/manage");
  }

  if (!publishedAt) {
    setFlash(req, "error", t(req, "flash.invalidPublicationDate"));
    return res.redirect("/publications/manage");
  }

  if (question.length < 10 || question.length > 300) {
    setFlash(req, "error", t(req, "flash.pollQuestionLength"));
    return res.redirect("/publications/manage");
  }

  if (options.length < 2 || options.length > 10) {
    setFlash(req, "error", t(req, "flash.pollOptionsLength"));
    return res.redirect("/publications/manage");
  }

  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const result = db.prepare(
      `
        INSERT INTO polls (title, question, allow_multiple, created_at, updated_at, published_at, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(title, question, allowMultiple, now, now, publishedAt, req.session.user.id);

    const pollId = Number(result.lastInsertRowid);
    const insertOption = db.prepare(
      `
        INSERT INTO poll_options (poll_id, label, position)
        VALUES (?, ?, ?)
      `
    );

    options.forEach((option, index) => {
      insertOption.run(pollId, option, index + 1);
    });
  });

  transaction();
  setFlash(req, "success", t(req, "flash.pollPublished"));
  return res.redirect("/publications/manage");
});

router.get("/publications/notifications/:id/edit", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const item = db.prepare("SELECT * FROM notifications WHERE id = ? LIMIT 1").get(Number(req.params.id));
  if (!item) {
    setFlash(req, "error", t(req, "flash.notificationNotFound"));
    return res.redirect("/publications/manage");
  }
  return res.render("publication-edit", {
    pageTitle: t(req, "publication.editNotification"),
    publicationKind: "notification",
    item,
    options: [],
    actionUrl: `/publications/notifications/${item.id}/update`
  });
});

router.post("/publications/notifications/:id/update", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const notificationId = Number(req.params.id);
  const title = cleanText(req.body.title);
  const message = cleanText(req.body.message);
  const allowedTargets = new Set(["all", "helpers", "admins", "publication"]);
  const targetRole = allowedTargets.has(req.body.targetRole) ? req.body.targetRole : "";
  const publishedAt = getPublishedTimestamp(req.body.publishedAt);

  if (title.length < 3 || title.length > 120) {
    setFlash(req, "error", t(req, "flash.titleLength"));
    return res.redirect(`/publications/notifications/${notificationId}/edit`);
  }

  if (!publishedAt) {
    setFlash(req, "error", t(req, "flash.invalidPublicationDate"));
    return res.redirect(`/publications/notifications/${notificationId}/edit`);
  }

  if (message.length < 5 || message.length > 500 || !targetRole) {
    setFlash(req, "error", t(req, !targetRole ? "flash.chooseValidTarget" : "flash.messageLength"));
    return res.redirect(`/publications/notifications/${notificationId}/edit`);
  }

  db.prepare("UPDATE notifications SET title = ?, message = ?, category = ?, target_role = ?, updated_at = ?, published_at = ? WHERE id = ?")
    .run(title, message, "site_updates", targetRole, new Date().toISOString(), publishedAt, notificationId);

  setFlash(req, "success", t(req, "flash.notificationUpdated"));
  return res.redirect("/publications/manage");
});

router.post("/publications/notifications/:id/delete", requireAuth, requirePublicationOrAdmin, (req, res) => {
  db.prepare("DELETE FROM notifications WHERE id = ?").run(Number(req.params.id));
  setFlash(req, "success", t(req, "flash.notificationDeleted"));
  return res.redirect("/publications/manage");
});

router.get("/publications/news/:id/edit", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const item = db.prepare("SELECT * FROM news_posts WHERE id = ? LIMIT 1").get(Number(req.params.id));
  if (!item) {
    setFlash(req, "error", t(req, "flash.newsNotFound"));
    return res.redirect("/publications/manage");
  }
  return res.render("publication-edit", {
    pageTitle: t(req, "publication.editNews"),
    publicationKind: "news",
    item,
    options: [],
    actionUrl: `/publications/news/${item.id}/update`
  });
});

router.post("/publications/news/:id/update", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const newsId = Number(req.params.id);
  const title = cleanText(req.body.title);
  const summary = cleanText(req.body.summary);
  const content = cleanText(req.body.content);
  const publishedAt = getPublishedTimestamp(req.body.publishedAt);

  if (title.length < 3 || title.length > 120) {
    setFlash(req, "error", t(req, "flash.titleLength"));
    return res.redirect(`/publications/news/${newsId}/edit`);
  }

  if (!publishedAt) {
    setFlash(req, "error", t(req, "flash.invalidPublicationDate"));
    return res.redirect(`/publications/news/${newsId}/edit`);
  }

  if (summary.length < 10 || summary.length > 220) {
    setFlash(req, "error", t(req, "flash.newsSummaryLength"));
    return res.redirect(`/publications/news/${newsId}/edit`);
  }

  if (content.length < 30 || content.length > 5000) {
    setFlash(req, "error", t(req, "flash.newsContentLength"));
    return res.redirect(`/publications/news/${newsId}/edit`);
  }

  db.prepare("UPDATE news_posts SET title = ?, summary = ?, content = ?, updated_at = ?, published_at = ? WHERE id = ?")
    .run(title, summary, content, new Date().toISOString(), publishedAt, newsId);

  setFlash(req, "success", t(req, "flash.newsUpdated"));
  return res.redirect("/publications/manage");
});

router.post("/publications/news/:id/delete", requireAuth, requirePublicationOrAdmin, (req, res) => {
  db.prepare("DELETE FROM news_posts WHERE id = ?").run(Number(req.params.id));
  setFlash(req, "success", t(req, "flash.newsDeleted"));
  return res.redirect("/publications/manage");
});

router.get("/publications/polls/:id/edit", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const pollId = Number(req.params.id);
  const item = db.prepare("SELECT * FROM polls WHERE id = ? LIMIT 1").get(pollId);
  if (!item) {
    setFlash(req, "error", t(req, "flash.pollNotFound"));
    return res.redirect("/publications/manage");
  }
  const options = db.prepare("SELECT label FROM poll_options WHERE poll_id = ? ORDER BY position ASC, id ASC").all(pollId);
  return res.render("publication-edit", {
    pageTitle: t(req, "publication.editPoll"),
    publicationKind: "poll",
    item,
    options,
    actionUrl: `/publications/polls/${item.id}/update`
  });
});

router.post("/publications/polls/:id/update", requireAuth, requirePublicationOrAdmin, (req, res) => {
  const pollId = Number(req.params.id);
  const title = cleanText(req.body.title);
  const question = cleanText(req.body.question);
  const allowMultiple = req.body.allowMultiple === "on" ? 1 : 0;
  const options = String(req.body.options || "")
    .split(/\r?\n/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  const publishedAt = getPublishedTimestamp(req.body.publishedAt);

  if (title.length < 3 || title.length > 120) {
    setFlash(req, "error", t(req, "flash.titleLength"));
    return res.redirect(`/publications/polls/${pollId}/edit`);
  }

  if (!publishedAt) {
    setFlash(req, "error", t(req, "flash.invalidPublicationDate"));
    return res.redirect(`/publications/polls/${pollId}/edit`);
  }

  if (question.length < 10 || question.length > 300) {
    setFlash(req, "error", t(req, "flash.pollQuestionLength"));
    return res.redirect(`/publications/polls/${pollId}/edit`);
  }

  if (options.length < 2 || options.length > 10) {
    setFlash(req, "error", t(req, "flash.pollOptionsLength"));
    return res.redirect(`/publications/polls/${pollId}/edit`);
  }

  const transaction = db.transaction(() => {
    db.prepare("UPDATE polls SET title = ?, question = ?, allow_multiple = ?, updated_at = ?, published_at = ? WHERE id = ?")
      .run(title, question, allowMultiple, new Date().toISOString(), publishedAt, pollId);
    db.prepare("DELETE FROM poll_options WHERE poll_id = ?").run(pollId);
    const insertOption = db.prepare("INSERT INTO poll_options (poll_id, label, position) VALUES (?, ?, ?)");
    options.forEach((option, index) => insertOption.run(pollId, option, index + 1));
    db.prepare("DELETE FROM poll_answers WHERE poll_id = ?").run(pollId);
  });

  transaction();
  setFlash(req, "success", t(req, "flash.pollUpdated"));
  return res.redirect("/publications/manage");
});

router.post("/publications/polls/:id/delete", requireAuth, requirePublicationOrAdmin, (req, res) => {
  db.prepare("DELETE FROM polls WHERE id = ?").run(Number(req.params.id));
  setFlash(req, "success", t(req, "flash.pollDeleted"));
  return res.redirect("/publications/manage");
});

router.post("/admin/notifications/clear", requireAuth, requireAdmin, (req, res) => {
  const deleteReads = db.prepare("DELETE FROM notification_reads");
  const deleteNotifications = db.prepare("DELETE FROM notifications");

  const transaction = db.transaction(() => {
    deleteReads.run();
    deleteNotifications.run();
  });

  transaction();

  setFlash(req, "success", t(req, "flash.notificationsCleared"));
  res.redirect("/admin/accounts");
});

router.post("/admin/users/:id/toggle-admin", requireAuth, requireSuperAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const targetUser = db
    .prepare("SELECT id, is_admin, is_super_admin, username FROM users WHERE id = ? LIMIT 1")
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", t(req, "flash.accountNotFound"));
    return res.redirect("/admin/accounts");
  }

  const nextAdminState = targetUser.is_admin ? 0 : 1;

  if (targetUser.is_super_admin) {
    setFlash(req, "error", t(req, "flash.cannotEditSuperAdmin"));
    return res.redirect("/admin/accounts");
  }

  if (req.session.user.id === userId && nextAdminState === 0) {
    setFlash(req, "error", t(req, "flash.cannotRemoveOwnAdmin"));
    return res.redirect("/admin/accounts");
  }

  if (targetUser.is_admin) {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE is_admin = 1")
      .get().total;

    if (adminCount <= 1) {
      setFlash(req, "error", t(req, "flash.lastAdminRequired"));
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
    nextAdminState ? t(req, "flash.accountPromotedAdmin") : t(req, "flash.accountDemotedAdmin")
  );
  res.redirect("/admin/accounts");
});

router.post("/admin/users/:id/toggle-helper", requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const targetUser = db
    .prepare("SELECT id, is_helper, is_super_admin FROM users WHERE id = ? LIMIT 1")
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", t(req, "flash.accountNotFound"));
    return res.redirect("/admin/accounts");
  }

  if (targetUser.is_super_admin) {
    setFlash(req, "error", t(req, "flash.cannotEditSuperAdmin"));
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
    req.session.user.isHelper = Boolean(nextHelperState) || req.session.user.isSuperAdmin;
  }

  setFlash(
    req,
    "success",
    nextHelperState ? t(req, "flash.accountPromotedHelper") : t(req, "flash.accountDemotedHelper")
  );
  res.redirect("/admin/accounts");
});

router.post("/admin/users/:id/toggle-publication", requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const targetUser = db
    .prepare("SELECT id, is_publication, is_super_admin FROM users WHERE id = ? LIMIT 1")
    .get(userId);

  if (!targetUser) {
    setFlash(req, "error", t(req, "flash.accountNotFound"));
    return res.redirect("/admin/accounts");
  }

  if (targetUser.is_super_admin) {
    setFlash(req, "error", t(req, "flash.cannotEditSuperAdmin"));
    return res.redirect("/admin/accounts");
  }

  const nextPublicationState = targetUser.is_publication ? 0 : 1;

  db.prepare(
    `
      UPDATE users
      SET is_publication = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(nextPublicationState, new Date().toISOString(), userId);

  if (req.session.user.id === userId) {
    req.session.user.isPublication = Boolean(nextPublicationState) || req.session.user.isSuperAdmin;
  }

  setFlash(
    req,
    "success",
    nextPublicationState ? t(req, "flash.accountPromotedPublication") : t(req, "flash.accountDemotedPublication")
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
    pageTitle: t(req, "requests.title"),
    attractionRequests
  });
});

router.post("/requests/:id/accept", requireAuth, requireHelperOrAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const requestEntry = db
    .prepare("SELECT * FROM attraction_requests WHERE id = ? LIMIT 1")
    .get(requestId);

  if (!requestEntry) {
    setFlash(req, "error", t(req, "flash.requestNotFound"));
    return res.redirect("/requests/review");
  }

  if (requestEntry.status !== "pending") {
    setFlash(req, "error", t(req, "flash.requestAlreadyProcessed"));
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

  setFlash(req, "success", t(req, "flash.requestAccepted"));
  res.redirect("/requests/review");
});

router.post("/requests/:id/reject", requireAuth, requireHelperOrAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const requestEntry = db
    .prepare("SELECT id, status FROM attraction_requests WHERE id = ? LIMIT 1")
    .get(requestId);

  if (!requestEntry) {
    setFlash(req, "error", t(req, "flash.requestNotFound"));
    return res.redirect("/requests/review");
  }

  if (requestEntry.status !== "pending") {
    setFlash(req, "error", t(req, "flash.requestAlreadyProcessed"));
    return res.redirect("/requests/review");
  }

  db.prepare(
    `
      UPDATE attraction_requests
      SET status = 'rejected', processed_at = ?, processed_by_user_id = ?
      WHERE id = ?
    `
  ).run(new Date().toISOString(), req.session.user.id, requestId);

  setFlash(req, "success", t(req, "flash.requestRejected"));
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

  setFlash(req, "success", t(req, "flash.notificationsRead"));
  res.redirect("/notifications");
});

router.post("/notifications/:id/read", requireAuth, (req, res) => {
  const notificationId = Number(req.params.id);
  const notifications = getNotificationsForUser(req.session.user.id, req.session.user);
  const notification = notifications.find((entry) => entry.id === notificationId);

  if (!notification) {
    setFlash(req, "error", t(req, "flash.notificationNotFound"));
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

router.post("/polls/:id/respond", requireAuth, (req, res) => {
  const pollId = Number(req.params.id);
  const poll = db.prepare("SELECT id, allow_multiple FROM polls WHERE id = ? LIMIT 1").get(pollId);

  if (!poll) {
    setFlash(req, "error", t(req, "flash.pollNotFound"));
    return res.redirect("/notifications");
  }

  const optionIds = Array.isArray(req.body.optionIds)
    ? req.body.optionIds
    : typeof req.body.optionIds === "string"
      ? [req.body.optionIds]
      : [];
  const normalizedOptionIds = [...new Set(optionIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  const pollOptions = db.prepare("SELECT id FROM poll_options WHERE poll_id = ?").all(pollId).map((entry) => entry.id);

  if (normalizedOptionIds.length === 0) {
    setFlash(req, "error", t(req, "flash.pollChooseOption"));
    return res.redirect("/notifications");
  }

  if (!poll.allow_multiple && normalizedOptionIds.length > 1) {
    setFlash(req, "error", t(req, "flash.pollSingleChoiceOnly"));
    return res.redirect("/notifications");
  }

  const validIds = normalizedOptionIds.filter((id) => pollOptions.includes(id));
  if (validIds.length !== normalizedOptionIds.length) {
    setFlash(req, "error", t(req, "flash.pollChooseOption"));
    return res.redirect("/notifications");
  }

  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM poll_answers WHERE poll_id = ? AND user_id = ?").run(pollId, req.session.user.id);
    const insertAnswer = db.prepare(
      `
        INSERT INTO poll_answers (poll_id, poll_option_id, user_id, created_at)
        VALUES (?, ?, ?, ?)
      `
    );
    const now = new Date().toISOString();
    validIds.forEach((optionId) => {
      insertAnswer.run(pollId, optionId, req.session.user.id, now);
    });
  });

  transaction();
  setFlash(req, "success", t(req, "flash.pollAnswered"));
  res.redirect("/notifications");
});

router.post("/calculations/:id/delete", requireAuth, (req, res) => {
  const calculationId = Number(req.params.id);

  const calculation = db
    .prepare("SELECT id FROM calculations WHERE id = ? AND user_id = ? LIMIT 1")
    .get(calculationId, req.session.user.id);

  if (!calculation) {
    setFlash(req, "error", t(req, "flash.calculationNotFound"));
    return res.redirect("/dashboard");
  }

  db.prepare("DELETE FROM calculations WHERE id = ?").run(calculationId);

  setFlash(req, "success", t(req, "flash.calculationDeleted"));
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
    setFlash(req, "error", t(req, "flash.newPasswordConfirmationMismatch"));
    return res.redirect("/dashboard");
  }

  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE id = ? LIMIT 1")
    .get(req.session.user.id);

  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    setFlash(req, "error", t(req, "flash.currentPasswordIncorrect"));
    return res.redirect("/dashboard");
  }

  db.prepare(
    `
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(bcrypt.hashSync(newPasswordValidation.value, 12), new Date().toISOString(), req.session.user.id);

  setFlash(req, "success", t(req, "flash.passwordUpdated"));
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
    setFlash(req, "error", t(req, "flash.usernameTaken"));
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

  setFlash(req, "success", t(req, "flash.usernameUpdated"));
  res.redirect("/dashboard");
});

router.post("/account/delete", requireAuth, (req, res) => {
  const userId = req.session.user.id;

  if (req.session.user.isAdmin) {
    const adminCount = db
      .prepare("SELECT COUNT(*) AS total FROM users WHERE is_admin = 1")
      .get().total;

    if (adminCount <= 1) {
      setFlash(req, "error", t(req, "flash.cannotDeleteLastAdmin"));
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
