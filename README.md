# Anibhi Textile website

Live site: https://aryan-novice.github.io/anibhi-textile/
Admin (for the owner): https://aryan-novice.github.io/anibhi-textile/admin.html

A static site hosted on GitHub Pages. Customers see `index.html`. The owner manages products,
categories and contact details from `admin.html`, which saves changes straight into this repository
through the GitHub API. Pages republishes about a minute after each save.

## Files
- `index.html`, `assets/site.css`, `assets/site.js`: the public site
- `admin.html`, `assets/admin.js`: the admin page
- `data/site.json`: business details and categories
- `data/products.json`: products, newest first
- `images/`: product photos (resized to 1600px JPEG on upload)
- `assets/config.js`: which repository the admin page writes to

## Signing in to the admin page
Create a fine-grained GitHub token at https://github.com/settings/personal-access-tokens/new with
access to only this repository and **Contents: Read and write**, then paste it on the admin page.
The token is kept only in that browser.
