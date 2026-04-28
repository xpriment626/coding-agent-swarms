# Project prompt

> This is the verbatim prompt fed to **both** arms (pair and single). It is intentionally written in 50th-percentile-user voice: casual, ~2 paragraphs, under-specified. Do not edit to add hints about open redirects, race conditions, redirect status codes, or any other "danger zone" — surfacing those is exactly what we're measuring.

---

Hey, can you build me a URL shortener web app? Users should be able to paste a long URL into a form, get back a short link they can copy and share, and visit that short link to be redirected to the original page. There should also be a simple dashboard view that shows the links that have been created along with how many times each one has been clicked, so I can see which ones people are actually using.

Make it nice to use — clean enough that I'd be comfortable showing it to a friend. Use SQLite so the data persists across restarts, and please make it runnable locally with a single command. I don't need user accounts or anything fancy with auth, just the core shortening and stats functionality. Tests would be good to have. Keep the stack simple, no need for anything heavyweight. Put the code under `/workspace`.
