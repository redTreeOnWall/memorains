import * as fs from "fs";

// Inject the package.json version and enable the service worker.
// PACKAGE_HASH is filled in later by build_web_package.sh.
const packageJson = fs.readFileSync("./package.json", "utf8");
const version = JSON.parse(packageJson).version;

const swJs = fs.readFileSync("./dist/sw.js", "utf8");

let newSwJs = swJs.replace("SW_VERSION", version);
newSwJs = newSwJs.replace("var useSW = false", "var useSW = true");

fs.writeFileSync("./dist/sw.js", newSwJs);
console.log("SW_VERSION replaced with " + version);
