function cleanText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function validateAttractionName(value) {
  const attractionName = cleanText(value);
  const isValid =
    attractionName.length >= 3 &&
    attractionName.length <= 80 &&
    /^[\p{L}\p{N}][\p{L}\p{N}\s'’().-]*$/u.test(attractionName);

  if (!isValid) {
    return {
      valid: false,
      message:
        "Le nom de l'attraction doit contenir entre 3 et 80 caracteres valides."
    };
  }

  return {
    valid: true,
    value: attractionName
  };
}

function validateInteger(value, label, { min, max }) {
  const cleaned = String(value || "").trim();

  if (!/^\d+$/.test(cleaned)) {
    return {
      valid: false,
      message: `${label} doit etre un nombre entier.`
    };
  }

  const parsed = Number(cleaned);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return {
      valid: false,
      message: `${label} doit etre compris entre ${min} et ${max}.`
    };
  }

  return {
    valid: true,
    value: parsed
  };
}

function validateUsername(value) {
  const username = cleanText(value);
  const isValid =
    username.length >= 3 &&
    username.length <= 30 &&
    /^[\p{L}\p{N}_-]+$/u.test(username);

  if (!isValid) {
    return {
      valid: false,
      message:
        "Le nom d'utilisateur doit contenir entre 3 et 30 caracteres sans espace."
    };
  }

  return {
    valid: true,
    value: username
  };
}

function validatePassword(value) {
  const password = String(value || "");
  const isValid =
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);

  if (!isValid) {
    return {
      valid: false,
      message:
        "Le mot de passe doit contenir au moins 8 caracteres, une majuscule, une minuscule et un chiffre."
    };
  }

  return {
    valid: true,
    value: password
  };
}

module.exports = {
  cleanText,
  validateAttractionName,
  validateInteger,
  validateUsername,
  validatePassword
};
