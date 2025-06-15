import * as fs from "fs";

const packageJson = fs.readFileSync("./package.json", "utf8");

const packageObject = JSON.parse(packageJson);

const version = packageObject.version;

const swJs = fs.readFileSync("./dist/sw.js", "utf8");

let newSwJs = swJs.replace("SW_VERSION", version);
newSwJs = newSwJs.replace("var useSW = false", "var useSW = true");

fs.writeFileSync("./dist/sw.js", newSwJs);
console.log("SW_VERSION changed to " + version);
