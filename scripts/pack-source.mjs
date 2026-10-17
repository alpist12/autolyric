import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve("public/source");
const archive = resolve(output, "autolyric-scoreflow-0.1.0.tgz");
mkdirSync(output, { recursive: true });
rmSync(archive, { force: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm 실행 경로를 찾지 못했습니다.");
execFileSync(process.execPath, [npmCli, "pack", "--silent", "--pack-destination", output], { stdio: "inherit" });
