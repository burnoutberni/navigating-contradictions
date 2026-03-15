#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const FEED_URL =
  "https://events.bhayden.at/api/v1/feeds/navigating_contradictions.json";
const INDEX_PATH = new URL("../index.html", import.meta.url);
const TIME_ZONE = "Europe/Vienna";

const WEEKDAY_DATE_FORMATTER = new Intl.DateTimeFormat("de-AT", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("de-AT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const TIME_FORMATTER = new Intl.DateTimeFormat("de-AT", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
});

const SITE_ORIGIN = "https://navigating-contradictions.com";
const ALLOWED_HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll(/&nbsp;/g, " ")
    .replaceAll(/&amp;/g, "&")
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&#39;/g, "'")
    .replaceAll(/&lt;/g, "<")
    .replaceAll(/&gt;/g, ">")
    .replaceAll(/&#x([\da-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replaceAll(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}

function stripTags(value) {
  return decodeHtmlEntities(value.replaceAll(/<[^>]+>/g, "")).trim();
}

function stripOuterQuotes(value) {
  let output = value.trim();
  const quoteChars = /^["'“”„«»‚‘’‹›]+|["'“”„«»‚‘’‹›]+$/g;

  while (output !== output.replace(quoteChars, "")) {
    output = output.replace(quoteChars, "").trim();
  }

  return output;
}

function normalizeHref(href = "") {
  if (!href) {
    return "";
  }

  const trimmed = href.trim();
  const withoutOrigin = trimmed.startsWith(SITE_ORIGIN)
    ? trimmed.slice(SITE_ORIGIN.length)
    : trimmed;

  try {
    return decodeURI(withoutOrigin);
  } catch {
    return withoutOrigin;
  }
}

function sanitizeUrl(rawHref = "", { allowRelative = true } = {}) {
  if (!rawHref) {
    return "";
  }

  const trimmed = rawHref.trim();
  try {
    const parsed = new URL(trimmed, SITE_ORIGIN);
    if (!ALLOWED_HTTP_PROTOCOLS.has(parsed.protocol)) {
      return "";
    }

    if (allowRelative && parsed.origin === SITE_ORIGIN) {
      return normalizeHref(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function parseAuthorAndYear(line) {
  const match = line.match(/^(.*)\s+\(([^()]+)\)\s*$/);
  if (!match) {
    return { author: line || "Unbekannt", year: "" };
  }

  return {
    author: match[1].trim() || "Unbekannt",
    year: match[2].trim(),
  };
}

function parseDescription(description = "") {
  const normalized = description.replaceAll(/\r\n?/g, "\n");

  const readingMatch = normalized.match(
    /<p>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/p>/i,
  );
  const emMatch = normalized.match(/<p>\s*<em>([\s\S]*?)<\/em>\s*<\/p>/i);

  const firstParagraph = normalized.match(/<p>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  const locationLinkMatch = firstParagraph.match(
    /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
  );

  const title = readingMatch ? stripTags(readingMatch[2]) : "";
  const href = normalizeHref(readingMatch?.[1]?.trim() || "");
  const authorLine = emMatch ? stripTags(emMatch[1]) : "";
  const { author, year } = parseAuthorAndYear(authorLine);

  return {
    title: stripOuterQuotes(title),
    href,
    author,
    year,
    locationLink: locationLinkMatch?.[1]?.trim() || "",
    locationLabel: locationLinkMatch ? stripTags(locationLinkMatch[2]) : "",
  };
}

function parseStartDate(event) {
  if (event.start_at_utc) {
    const date = new Date(event.start_at_utc);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  if (event.start_date) {
    const date = new Date(event.start_date);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function renderLocation(event) {
  const parts = [];
  const label = event.locationLabel || event.location_name || "";
  const link = sanitizeUrl(event.location_url || event.locationLink || "");

  if (label) {
    if (link) {
      parts.push(`<a href="${escapeHtml(link)}">${escapeHtml(label)}</a>`);
    } else {
      parts.push(escapeHtml(label));
    }
  }

  if (event.location_address) {
    parts.push(escapeHtml(event.location_address));
  }

  if (parts.length === 0) {
    return "";
  }

  return `                <p>📍 ${parts.join(", ")}</p>`;
}

function renderUpcomingItem(event) {
  const dateLabel = WEEKDAY_DATE_FORMATTER.format(event.startAt);
  const timeLabel = TIME_FORMATTER.format(event.startAt);
  const title = escapeHtml(stripOuterQuotes(event.title || event.feedTitle || "Termin"));
  const href = escapeHtml(sanitizeUrl(event.href || event.url || "") || "#");
  const eventPageUrl =
    event.account_username && event.slug
      ? `https://events.bhayden.at/@${encodeURIComponent(event.account_username)}/${encodeURIComponent(event.slug)}`
      : "";
  const safeEventPageUrl = sanitizeUrl(eventPageUrl, { allowRelative: false });
  const authorText = event.year
    ? `${event.author || "Unbekannt"} (${event.year})`
    : event.author || "Unbekannt";
  const locationLine = renderLocation(event);
  const eventPageLine = safeEventPageUrl
    ? `                <p class="event-page-link"><a href="${escapeHtml(safeEventPageUrl)}">Event auf EveryCal</a></p>`
    : "";

  return [
    "            <li>",
    `                <a href="${href}">${title}</a>`,
    `                <p>${escapeHtml(authorText)}</p>`,
    `                <p>🗓️ ${dateLabel} ab ${timeLabel} Uhr</p>`,
    ...(locationLine ? [locationLine] : []),
    ...(eventPageLine ? [eventPageLine] : []),
    "            </li>",
  ].join("\n");
}

function renderPastItem(event) {
  const dateLabel = DATE_FORMATTER.format(event.startAt);
  const title = escapeHtml(stripOuterQuotes(event.title || event.feedTitle || "Termin"));
  const href = escapeHtml(sanitizeUrl(event.href || event.url || "") || "#");
  const authorText = event.year
    ? `${event.author || "Unbekannt"} (${event.year})`
    : event.author || "Unbekannt";

  return [
    "            <li>",
    `                <a href="${href}">${title}</a>`,
    `                <p>${escapeHtml(authorText)}</p>`,
    `                <p>${dateLabel}</p>`,
    "            </li>",
  ].join("\n");
}

function replaceMarkedBlock(html, blockName, content) {
  const markerRegex = new RegExp(
    `([ \\t]*<!-- ${blockName}_START -->\\n)([\\s\\S]*?)([ \\t]*<!-- ${blockName}_END -->)`,
  );

  if (!markerRegex.test(html)) {
    throw new Error(`Marker block ${blockName} not found in index.html`);
  }

  return html.replace(markerRegex, `$1${content}\n$3`);
}

function getMarkedBlockContent(html, blockName) {
  const markerRegex = new RegExp(
    `[ \\t]*<!-- ${blockName}_START -->\\n([\\s\\S]*?)[ \\t]*<!-- ${blockName}_END -->`,
  );
  const match = html.match(markerRegex);
  if (!match) {
    throw new Error(`Marker block ${blockName} not found in index.html`);
  }

  return match[1].replace(/\s+$/, "");
}

function getPastSectionHtml(html) {
  const sectionMatch = html.match(
    /<section>\s*<h2>Bisherige Termine<\/h2>\s*<ol>([\s\S]*?)<\/ol>\s*<\/section>/,
  );

  if (!sectionMatch) {
    throw new Error("Could not find 'Bisherige Termine' section");
  }

  return sectionMatch[1];
}

function extractPastKeys(pastSectionHtml) {
  const keys = new Set();
  const liBlocks = pastSectionHtml.match(/<li>[\s\S]*?<\/li>/g) ?? [];

  for (const li of liBlocks) {
    const hrefRaw = li.match(/<a\b[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const pTags = [...li.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((m) => stripTags(m[1]));
    const dateLabel = pTags.at(-1) ?? "";
    if (!hrefRaw || !dateLabel) {
      continue;
    }

    keys.add(`${normalizeHref(hrefRaw)}|${dateLabel}`);
  }

  return keys;
}

async function loadFeed() {
  const response = await fetch(FEED_URL, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Feed request failed (${response.status})`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.events)) {
    throw new Error("Feed payload does not contain an events array");
  }

  return payload.events;
}

function buildEventModel(feedEvents) {
  return feedEvents
    .map((event) => {
      const startAt = parseStartDate(event);
      if (!startAt) {
        return null;
      }

      const parsed = parseDescription(event.description);
      return {
        ...event,
        ...parsed,
        feedTitle: event.title,
        startAt,
      };
    })
    .filter(Boolean);
}

async function main() {
  const [indexHtml, rawFeedEvents] = await Promise.all([
    readFile(INDEX_PATH, "utf8"),
    loadFeed(),
  ]);

  const events = buildEventModel(rawFeedEvents);
  const now = new Date();

  const upcoming = events
    .filter((event) => event.startAt.getTime() >= now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const past = events
    .filter((event) => event.startAt.getTime() < now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const upcomingContent =
    upcoming.length === 0
      ? "            <li>Der nächste Termin wird bald angekündigt.</li>"
      : upcoming.map(renderUpcomingItem).join("\n");

  const pastSectionHtml = getPastSectionHtml(indexHtml);
  const existingPastKeys = extractPastKeys(pastSectionHtml);

  const newPastItems = past.filter((event) => {
    const dateLabel = DATE_FORMATTER.format(event.startAt);
    const href = normalizeHref(event.href || event.url || "");
    if (!href || !dateLabel) {
      return false;
    }

    const key = `${href}|${dateLabel}`;
    return !existingPastKeys.has(key);
  });

  const existingGeneratedPast = getMarkedBlockContent(indexHtml, "PAST_EVENTS");
  const appendedPastBlocks = newPastItems.map(renderPastItem).join("\n");
  const pastContent = [existingGeneratedPast, appendedPastBlocks]
    .filter((chunk) => chunk && chunk.trim().length > 0)
    .join("\n");

  const withUpcoming = replaceMarkedBlock(
    indexHtml,
    "UPCOMING_EVENTS",
    upcomingContent,
  );
  const updatedHtml = replaceMarkedBlock(withUpcoming, "PAST_EVENTS", pastContent);

  if (updatedHtml !== indexHtml) {
    await writeFile(INDEX_PATH, updatedHtml, "utf8");
  }
}

main().catch((error) => {
  console.error(`Failed to update events: ${error.message}`);
  process.exitCode = 1;
});
