import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path;
  });
}

test("client modules do not reference privileged secrets", () => {
  const forbidden = ["SUPABASE_SERVICE_ROLE_KEY", "SLACK_SIGNING_SECRET", "SLACK_BOT_TOKEN", "DASHBOARD_ACCESS_CODE", "OPENAI_API_KEY"];
  const files = walk(join(root, "src")).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  const clients = files.filter((file) => readFileSync(file, "utf8").includes("use client"));
  assert.ok(clients.length > 0);
  for (const file of clients) {
    const source = readFileSync(file, "utf8");
    for (const key of forbidden) {
      assert.equal(source.includes(key), false, `${file} mentions ${key}`);
    }
    assert.equal(source.includes("@supabase/supabase-js"), false, `${file} imports supabase`);
  }
});

test("secret files are gitignored and the example file has no real secrets", () => {
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  const example = readFileSync(join(root, ".env.example"), "utf8");
  assert.equal(example.includes("xoxb-"), false);
  assert.equal(example.includes("service_role"), false);
  assert.match(example, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.match(example, /SLACK_SIGNING_SECRET=/);
});
