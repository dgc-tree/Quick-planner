#!/usr/bin/env node
/**
 * Smoke test — verifies Quick Planner loads without critical errors.
 * Usage: node scripts/smoke-test.js [url]
 * Default URL: http://localhost:8000
 */
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://localhost:8000';
const TIMEOUT = 15_000;

let browser;
const errors = [];

function fail(msg) {
  errors.push(msg);
  console.error(`FAIL: ${msg}`);
}

try {
  console.log(`Smoke testing: ${url}\n`);
  browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Track console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Track uncaught page errors
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  // Track failed network requests + MIME issues
  const mimeIssues = [];
  const failedRequests = [];
  page.on('response', response => {
    const reqUrl = response.url();
    if (reqUrl.endsWith('.js') || reqUrl.includes('.js?')) {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('text/html')) {
        mimeIssues.push(reqUrl);
      }
    }
    if (response.status() >= 400 && !reqUrl.includes('favicon')) {
      failedRequests.push(`${response.status()} ${reqUrl}`);
    }
  });

  // Navigate
  await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT });

  // Check 1: No JS files served as text/html
  if (mimeIssues.length) {
    mimeIssues.forEach(u => fail(`JS file served as text/html: ${u}`));
  } else {
    console.log('PASS: No MIME type issues');
  }

  // Check 2: No module/MIME console errors
  const moduleErrors = consoleErrors.filter(e =>
    /module|mime/i.test(e)
  );
  if (moduleErrors.length) {
    moduleErrors.forEach(e => fail(`Console error: ${e}`));
  } else {
    console.log('PASS: No module/MIME console errors');
  }

  // Check 3: No uncaught page errors
  if (pageErrors.length) {
    pageErrors.forEach(e => fail(`Uncaught error: ${e}`));
  } else {
    console.log('PASS: No uncaught page errors');
  }

  // Check 4: No failed network requests
  if (failedRequests.length) {
    failedRequests.forEach(r => fail(`Failed request: ${r}`));
  } else {
    console.log('PASS: No failed network requests');
  }

  // Check 5: #loading gets hidden class (app initialised)
  try {
    await page.waitForFunction(
      () => document.querySelector('#loading')?.classList.contains('hidden'),
      { timeout: TIMEOUT }
    );
    console.log('PASS: #loading is hidden (app initialised)');
  } catch {
    fail('#loading never received .hidden class — app may not have initialised');
  }

  // Check 6: Either onboarding shows OR kanban has content OR auth gate is active
  const hasContent = await page.evaluate(() => {
    const authOverlay = document.querySelector('#auth-overlay');
    if (authOverlay && !authOverlay.classList.contains('hidden')) return true;
    const onboarding = document.querySelector('.onboarding-overlay');
    if (onboarding && !onboarding.classList.contains('hidden')) return true;
    const kanban = document.querySelector('#kanban-view');
    if (kanban && kanban.children.length > 0) return true;
    const todolist = document.querySelector('#todolist-view');
    if (todolist && !todolist.classList.contains('hidden') && todolist.children.length > 0) return true;
    return false;
  });
  if (hasContent) {
    console.log('PASS: Onboarding or board content visible');
  } else {
    fail('Neither onboarding overlay nor board content found');
  }

} catch (err) {
  fail(`Fatal: ${err.message}`);
} finally {
  if (browser) await browser.close();
}

console.log('');
if (errors.length) {
  console.error(`${errors.length} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('All smoke checks passed.');
  process.exit(0);
}
