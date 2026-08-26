import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const serverJson = JSON.parse(fs.readFileSync("server.json", "utf8"));

serverJson.version = packageJson.version;

for (const pkg of serverJson.packages ?? []) {
  if (pkg.registryType === "npm" && pkg.identifier === packageJson.name) {
    pkg.version = packageJson.version;
  }
}

fs.writeFileSync("server.json", `${JSON.stringify(serverJson, null, 2)}\n`);

console.log(`Synced server.json to ${packageJson.version}`);
