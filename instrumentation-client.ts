// Next.js 15.3+ client-side instrumentation hook (Phase 1 of build_website_for_evolutiOn_20260626).
// Lives at the repo root alongside instrumentation.ts (Next.js auto-discovers based on file
// location). DO NOT move under src/ — it would not be auto-loaded.
//
// Initializes Vercel BotID's invisible challenge on the /edit POST path so the public
// surface gets bot protection at the perimeter. Combined with the server-side checkBotId()
// inside submitPublicEditAction, this is the defense layer that distinguishes "human
// visitor" from "automated requester" at scale (residential-proxy bots otherwise rotate
// through unlimited per-IP caps).

import { initBotId } from 'botid/client/core';

initBotId({
  protect: [
    { path: '/edit', method: 'POST' },
  ],
});
