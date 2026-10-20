import { expect, test } from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const screens: Array<{ path: string; heading: RegExp }> = [
  { path: "/", heading: /Dashboard/ },
  { path: "/organize", heading: /Organize files/ },
  { path: "/search", heading: /Smart search/ },
  { path: "/duplicates", heading: /Duplicates/ },
  { path: "/automation", heading: /Automation/ },
  { path: "/history", heading: /Activity history/ },
  { path: "/settings", heading: /Settings/ },
];

test.describe.configure({ mode: "serial" });

test("renders every screen without console errors", async ({ page }) => {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const screen of screens) {
    await page.goto(screen.path, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: screen.heading }).first()).toBeVisible();
  }

  // Theme toggle works and persists in the document.
  await page.goto("/settings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
  expect(
    await page.evaluate(() => document.documentElement.classList.contains("dark")),
  ).toBe(true);

  expect(pageErrors, "uncaught page errors").toEqual([]);
  expect(errors, "console errors").toEqual([]);
});

test("scan, plan, apply, undo, then search a disposable copy", async ({ page }) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "lazydesk-e2e-"));
  const folder = path.join(workspace, "MessyDownloads");
  const source = path.resolve("demo", "MessyDownloads");
  await cp(source, folder, { recursive: true });
  const fileCount = 11;

  try {
    await page.goto("/organize", { waitUntil: "networkidle" });
    await page.locator("#folder-path").fill(folder);
    await page.getByRole("button", { name: /Scan folder/ }).click();
    await expect(page.getByText(`${fileCount} indexed`)).toBeVisible();

    await page.locator("#ai-scope").selectOption("none");
    await page.getByRole("button", { name: /Generate plan/ }).click();
    await expect(page.getByText("3. Review before anything moves")).toBeVisible();

    await page.getByRole("button", { name: new RegExp(`Apply ${fileCount} approved move`) }).click();
    await page.getByRole("button", { name: /Confirm and move/ }).click();
    await expect(page.getByRole("heading", { name: `Moved ${fileCount} files.` })).toBeVisible();

    await page.getByRole("button", { name: /Undo last operation/ }).click();
    await expect(page.getByText(`Restored ${fileCount} files.`).first()).toBeVisible();

    await page.goto("/search", { waitUntil: "networkidle" });
    await page.locator('input[aria-label="Search query"]').fill("find pdf documents");
    await page.locator('[role="switch"][aria-label="AI query understanding"]').click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("tax_return_2024.pdf").first()).toBeVisible();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
