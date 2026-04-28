import express from "express";
import { createShortUrl, getUrl, incrementClicks, getAllLinks } from "./db";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Create short URL
app.post("/api/shorten", (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "URL is required" });
    return;
  }
  
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }
  
  const id = createShortUrl(url);
  const shortUrl = `${req.protocol}://${req.get("host")}/${id}`;
  res.json({ id, shortUrl, url });
});

// Get all links (dashboard data)
app.get("/api/links", (_req, res) => {
  const links = getAllLinks();
  res.json(links);
});

// Redirect short URL
app.get("/:id", (req, res) => {
  const { id } = req.params;
  const link = getUrl(id);
  if (!link) {
    res.status(404).send("Link not found");
    return;
  }
  incrementClicks(id);
  res.redirect(link.url);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app;
