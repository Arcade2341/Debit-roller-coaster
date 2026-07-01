function isPhoneRequest(req) {
  const userAgent = String(req.get("user-agent") || "").toLowerCase();
  const secChUaMobile = String(req.get("sec-ch-ua-mobile") || "").trim();

  if (secChUaMobile === "?1") {
    return true;
  }

  if (!userAgent) {
    return false;
  }

  const tabletPatterns = [
    /ipad/,
    /tablet/,
    /playbook/,
    /silk/,
    /kindle/,
    /nexus 7/,
    /nexus 9/,
    /nexus 10/,
    /sm-t/,
    /tab\b/,
    /android(?!.*mobile)/
  ];

  if (tabletPatterns.some((pattern) => pattern.test(userAgent))) {
    return false;
  }

  const phonePatterns = [
    /iphone/,
    /ipod/,
    /android.*mobile/,
    /windows phone/,
    /\bmobi\b/,
    /blackberry/,
    /opera mini/,
    /mobile safari/
  ];

  return phonePatterns.some((pattern) => pattern.test(userAgent));
}

function blockDesktopAndTablet(req, res, next) {
  if (isPhoneRequest(req)) {
    return next();
  }

  return res.status(403).render("device-blocked", {
    pageTitle: res.locals.t("status.deviceBlockedTitle")
  });
}

module.exports = {
  blockDesktopAndTablet
};
