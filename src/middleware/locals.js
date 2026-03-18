const db = require("../db");
const { getLanguage, translate } = require("../i18n");

function getNotificationFilter(user) {
  const targets = ["all"];

  if (user.isAdmin) {
    targets.push("admins");
  }

  if (user.isHelper) {
    targets.push("helpers");
  }

  return targets;
}

function attachLocals(req, res, next) {
  req.session.lang = getLanguage(req.session.lang);

  if (req.session.user) {
    const freshUser = db
      .prepare("SELECT id, username, is_admin, is_helper FROM users WHERE id = ? LIMIT 1")
      .get(req.session.user.id);

    if (!freshUser) {
      req.session.user = null;
    } else {
      req.session.user = {
        id: freshUser.id,
        username: freshUser.username,
        isAdmin: Boolean(freshUser.is_admin),
        isHelper: Boolean(freshUser.is_helper)
      };
    }
  }

  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.currentPath = req.path;
  res.locals.lastCalculation = req.session.lastCalculation || null;
  res.locals.unreadNotificationsCount = 0;
  res.locals.siteUrl = process.env.SITE_URL || "https://roller-flow.xyz";
  res.locals.currentLang = req.session.lang;
  res.locals.t = (key, params) => translate(req.session.lang, key, params);

  if (req.session.user) {
    const targets = getNotificationFilter(req.session.user);
    const placeholders = targets.map(() => "?").join(", ");
    const row = db
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM notifications
          WHERE target_role IN (${placeholders})
            AND id NOT IN (
              SELECT notification_id
              FROM notification_reads
              WHERE user_id = ?
            )
        `
      )
      .get(...targets, req.session.user.id);

    res.locals.unreadNotificationsCount = row ? row.total : 0;
  }

  delete req.session.flash;

  next();
}

module.exports = {
  attachLocals
};
