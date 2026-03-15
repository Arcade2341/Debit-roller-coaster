require("dotenv").config();

const app = require("./src/app");

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Serveur demarre sur http://localhost:${port}`);
});
