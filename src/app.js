const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const helmet = require("helmet");
const FileStoreFactory = require("session-file-store");

const { banCheckMiddleware } = require("./middleware/ipBan");
const { attachLocals } = require("./middleware/locals");
const { router } = require("./routes/web");
require("./db");

const app = express();
const FileStore = FileStoreFactory(session);
const sessionsPath = path.join(__dirname, "..", "data", "sessions");
const secureSessionCookie = process.env.SESSION_COOKIE_SECURE === "true";

fs.mkdirSync(sessionsPath, { recursive: true });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : 0);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null
      }
    },
    crossOriginOpenerPolicy: { policy: "same-origin" }
  })
);

app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    store: new FileStore({
      path: sessionsPath,
      retries: 1
    }),
    name: "roller.sid",
    secret: process.env.SESSION_SECRET || "change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: secureSessionCookie,
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(attachLocals);
app.use(banCheckMiddleware);
app.use(router);

app.use((req, res) => {
  res.status(404).render("404", {
    pageTitle: "Page introuvable"
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).render("500", {
    pageTitle: "Erreur serveur"
  });
});

module.exports = app;
