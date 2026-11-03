import { hashPassword } from "../src/auth.js";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const password = Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/, "");
if (!password) {
  console.error("Read the password from standard input; command-line password arguments are refused.");
  process.exitCode = 1;
} else {
  process.stdout.write(`${await hashPassword(password)}\n`);
}
