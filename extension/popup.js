const API_URL = "http://127.0.0.1:19827";
const TOKEN_KEY = "potatoBoxApiToken";
const PENDING_CLIP_KEY = "potatoBoxPendingClip";

const statusBar = document.getElementById("statusBar");
const titleInput = document.getElementById("titleInput");
const urlPreview = document.getElementById("urlPreview");
const contentPreview = document.getElementById("contentPreview");
const clipBtn = document.getElementById("clipBtn");
const projectSelect = document.getElementById("projectSelect");
const tokenPanel = document.getElementById("tokenPanel");
const tokenInput = document.getElementById("tokenInput");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const changeTokenBtn = document.getElementById("changeTokenBtn");

let extractedContent = "";
let pageUrl = "";
let apiToken = "";
let connected = false;

function setStatus(tone, message) {
  statusBar.className = `status ${tone}`;
  statusBar.textContent = message;
}

function authHeaders(includeJson = false) {
  return {
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
    "X-Potato-Box-Token": apiToken,
  };
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...authHeaders(options.body !== undefined),
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function idempotencyKeyFor(payload) {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const stored = await chrome.storage.local.get(PENDING_CLIP_KEY);
  const pending = stored[PENDING_CLIP_KEY];
  if (
    pending?.fingerprint === fingerprint &&
    typeof pending?.idempotencyKey === "string"
  ) {
    return pending.idempotencyKey;
  }
  const idempotencyKey = crypto.randomUUID();
  await chrome.storage.local.set({
    [PENDING_CLIP_KEY]: { fingerprint, idempotencyKey },
  });
  return idempotencyKey;
}

async function loadStoredToken() {
  const stored = await chrome.storage.local.get(TOKEN_KEY);
  apiToken = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY].trim() : "";
  tokenInput.value = apiToken;
  tokenPanel.hidden = Boolean(apiToken);
  changeTokenBtn.hidden = !apiToken;
}

async function checkConnection() {
  connected = false;
  clipBtn.disabled = true;
  if (!apiToken) {
    tokenPanel.hidden = false;
    setStatus("disconnected", "API token required");
    projectSelect.replaceChildren(new Option("Connect first", ""));
    return false;
  }

  try {
    const response = await apiFetch("/status", { method: "GET" });
    if (response.status === 401) {
      tokenPanel.hidden = false;
      changeTokenBtn.hidden = true;
      setStatus("error", "Token rejected. Check API + MCP settings.");
      return false;
    }
    const data = await response.json();
    if (response.ok && data.ok) {
      if (!(await loadProjects())) return false;
      connected = true;
      tokenPanel.hidden = true;
      changeTokenBtn.hidden = false;
      setStatus("connected", "Connected to potato box");
      updateClipButton();
      return true;
    }
    setStatus("error", data.error || `Connection failed (${response.status})`);
  } catch (error) {
    const message = error?.name === "AbortError" ? "Connection timed out" : "potato box is not running";
    setStatus("disconnected", message);
  }

  projectSelect.replaceChildren(new Option("App unavailable", ""));
  return false;
}

async function loadProjects() {
  try {
    const response = await apiFetch("/projects", { method: "GET" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      connected = false;
      projectSelect.replaceChildren(new Option("Projects unavailable", ""));
      setStatus("error", data.error || `Could not load projects (${response.status})`);
      updateClipButton();
      return false;
    }
    projectSelect.replaceChildren();
    if (Array.isArray(data.projects) && data.projects.length > 0) {
      for (const project of data.projects) {
        if (typeof project.id !== "string" || typeof project.name !== "string") continue;
        const option = new Option(`${project.name}${project.current ? " (current)" : ""}`, project.id);
        option.selected = Boolean(project.current);
        projectSelect.appendChild(option);
      }
    }
    if (projectSelect.options.length === 0) {
      projectSelect.appendChild(new Option("Open a project in potato box", ""));
    }
    return true;
  } catch (error) {
    connected = false;
    projectSelect.replaceChildren(new Option("Projects unavailable", ""));
    setStatus("error", error?.name === "AbortError" ? "Project list timed out" : "Could not load projects");
    updateClipButton();
    return false;
  }
}

function updateClipButton() {
  clipBtn.disabled = !(connected && extractedContent && projectSelect.value);
  if (!connected) clipBtn.textContent = "Connect to save";
  else if (!extractedContent) clipBtn.textContent = "Extracting page";
  else clipBtn.textContent = "Save clip";
}

async function extractContent() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    pageUrl = tab.url || "";
    titleInput.value = tab.title || "Untitled";
    urlPreview.textContent = pageUrl;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["Readability.js", "Turndown.js"],
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        try {
          const article = new window.Readability(document.cloneNode(true)).parse();
          if (!article?.content) return { error: "Article content was not found" };

          const turndown = new window.TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            bulletListMarker: "-",
          });
          turndown.addRule("tableCell", {
            filter: ["th", "td"],
            replacement: (content) => ` ${content.trim()} |`,
          });
          turndown.addRule("tableRow", {
            filter: "tr",
            replacement: (content) => `|${content}\n`,
          });
          turndown.addRule("table", {
            filter: "table",
            replacement: (content) => {
              const lines = content.trim().split("\n");
              if (lines.length > 0) {
                const columns = Math.max(1, (lines[0].match(/\|/g) || []).length - 1);
                lines.splice(1, 0, `|${" --- |".repeat(columns)}`);
              }
              return `\n\n${lines.join("\n")}\n\n`;
            },
          });
          turndown.addRule("removeSmallImages", {
            filter: (node) => {
              if (node.nodeName !== "IMG") return false;
              const width = Number.parseInt(node.getAttribute("width") || "999", 10);
              const height = Number.parseInt(node.getAttribute("height") || "999", 10);
              return width < 10 || height < 10;
            },
            replacement: () => "",
          });
          return {
            title: article.title || "",
            content: turndown.turndown(article.content),
            excerpt: article.excerpt || "",
          };
        } catch (error) {
          return { error: error instanceof Error ? error.message : "Extraction failed" };
        }
      },
    });

    const result = results?.[0]?.result;
    if (!result || result.error) {
      await fallbackExtract(tab.id);
      return;
    }
    if (result.title && result.title.length > 5) titleInput.value = result.title;
    extractedContent = String(result.content || "").slice(0, 1_500_000);
    contentPreview.textContent = result.excerpt
      ? `${result.excerpt}\n\n---\n\n${extractedContent}`
      : extractedContent;
  } catch (error) {
    contentPreview.textContent = error instanceof Error ? error.message : "Page extraction failed";
  } finally {
    updateClipButton();
  }
}

async function fallbackExtract(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clone = document.body?.cloneNode(true);
      if (!clone) return "";
      ["script", "style", "nav", "header", "footer", ".sidebar", ".ad", ".comments"]
        .forEach((selector) => clone.querySelectorAll(selector).forEach((element) => element.remove()));
      return clone.innerText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 1_500_000);
    },
  });
  extractedContent = String(results?.[0]?.result || "");
  contentPreview.textContent = extractedContent || "No readable page content found";
}

async function sendClip() {
  if (!projectSelect.value || !extractedContent) return;
  clipBtn.disabled = true;
  setStatus("sending", "Saving clip...");
  try {
    const payload = {
      projectId: projectSelect.value,
      title: titleInput.value,
      url: pageUrl,
      content: extractedContent,
    };
    const idempotencyKey = await idempotencyKeyFor(payload);
    const response = await apiFetch("/clip", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        idempotencyKey,
      }),
    });
    const data = await response.json();
    if (response.ok && data.ok) {
      await chrome.storage.local.remove(PENDING_CLIP_KEY);
      const projectName = projectSelect.options[projectSelect.selectedIndex]?.textContent || "project";
      setStatus(
        "success",
        data.status === "processed"
          ? `Already saved and processed in ${projectName}`
          : data.autoIngestQueued
          ? `Saved and queued in ${projectName}`
          : `Saved in ${projectName}, but automatic ingest was not queued`,
      );
      clipBtn.textContent = "Saved";
      return;
    }
    setStatus("error", data.error || `Save failed (${response.status})`);
  } catch (error) {
    setStatus(
      "error",
      error?.name === "AbortError"
        ? "Save status is unknown. Check Sources before retrying."
        : "Connection failed",
    );
  }
  updateClipButton();
}

saveTokenBtn.addEventListener("click", async () => {
  apiToken = tokenInput.value.trim();
  if (!apiToken) {
    setStatus("error", "Enter an API token");
    return;
  }
  await chrome.storage.local.set({ [TOKEN_KEY]: apiToken });
  await checkConnection();
});

changeTokenBtn.addEventListener("click", () => {
  tokenPanel.hidden = false;
  changeTokenBtn.hidden = true;
  tokenInput.focus();
});

tokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveTokenBtn.click();
});
projectSelect.addEventListener("change", updateClipButton);
clipBtn.addEventListener("click", sendClip);

(async () => {
  await loadStoredToken();
  await Promise.all([checkConnection(), extractContent()]);
})();
