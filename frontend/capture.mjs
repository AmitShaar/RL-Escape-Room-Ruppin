/**
 * capture.mjs — screenshots + videos for all 5 rooms
 * Usage: node capture.mjs
 * Requires: backend running on :8000, frontend on :5173
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const VIDEOS_DIR = path.join(__dirname, '..', 'docs', 'videos');
const APP_URL = 'http://localhost:5173';

// How long to train each room before screenshotting (ms)
const TRAIN_WAIT = {
  1: 12000,  // DP converges fast
  2: 25000,  // SARSA 500 ep
  3: 25000,  // Q-Learning 500 ep
  4: 40000,  // DQN 100 ep
  5: 60000,  // Storm 300 ep
};

const ROOM_NAMES = {
  1: 'The Mapped Yard',
  2: 'The Foggy Park',
  3: 'Treasure Sniff',
  4: 'The Open Field',
  5: 'The Storm',
};

async function selectRoom(page, roomId) {
  await page.locator(`button:has-text("${ROOM_NAMES[roomId]}")`).first().click();
  await page.waitForTimeout(1000);
}

async function clickTrain(page) {
  // All 5 rooms are always mounted; only the active one is display:block.
  // Use :visible to skip the hidden room buttons.
  await page.locator('button:visible').filter({ hasText: 'Train' }).first().click();
}

async function takeScreenshot(page, roomId) {
  const file = path.join(SCREENSHOTS_DIR, `room${roomId}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ screenshot saved: room${roomId}.png`);
}

async function captureRoom(browser, roomId, recordVideo) {
  console.log(`\nRoom ${roomId} — ${recordVideo ? 'screenshot + video' : 'screenshot only'}`);

  const contextOpts = { viewport: { width: 1400, height: 860 } };
  if (recordVideo) {
    contextOpts.recordVideo = {
      dir: VIDEOS_DIR,
      size: { width: 1400, height: 860 },
    };
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // let 3D scene init

  await selectRoom(page, roomId);
  await clickTrain(page);

  const wait = TRAIN_WAIT[roomId];
  console.log(`  training for ${wait / 1000}s...`);
  await page.waitForTimeout(wait);

  await takeScreenshot(page, roomId);

  if (recordVideo) {
    const videoPath = await page.video().path();
    // rename to a stable name
    const finalPath = path.join(VIDEOS_DIR, `room${roomId}.webm`);
    try {
      const { rename } = await import('fs/promises');
      await context.close();                     // flushes the video
      await rename(videoPath, finalPath);
      console.log(`  ✓ video saved:      room${roomId}.webm`);
      return;                                    // already closed
    } catch (e) {
      console.warn('  ! could not rename video:', e.message);
    }
  }

  await context.close();
}

(async () => {
  const browser = await chromium.launch({ headless: false }); // headless:false so WebGL works

  try {
    // Rooms 1-3: screenshot only
    for (const id of [1, 2, 3]) {
      await captureRoom(browser, id, false);
    }
    // Rooms 4-5: screenshot + video
    for (const id of [4, 5]) {
      await captureRoom(browser, id, true);
    }
  } finally {
    await browser.close();
  }

  console.log('\nAll done.');
})();
