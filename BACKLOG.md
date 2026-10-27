# Backlog

One line per idea or bug. Move items up as priorities change; check them off when done.
Work on one item (or a small group of related ones) per session, then commit.

## 🐞 Bugs
- [ ] Verify Apple Pencil on a real iPad (only tested with simulated pen events): pressure, palm rejection, no scrolling while writing
- [ ] Editing the same page on two devices at the same time: last save wins and can drop the other device's edits
- [ ] Lint errors from React-compiler rules (ref updated during render in `DrawingBlock.tsx`, etc.)

## 🔜 Now (needed for studying)
- [ ] Lasso select: move or resize part of a drawing
- [ ] Image/PDF slide import with ink on top (annotate lecture slides)
- [ ] Search inside page content, not just titles

## 📋 Later
- [x] Dark mode (toolbar toggle; follows the OS until toggled; black ink shows white)
- [ ] Drag pages in the sidebar to reorder or nest them
- [ ] Page icons / emoji
- [ ] Export a page as PDF (for printing or sharing)
- [ ] Offline support on iPad (cache pages, sync when back online)
- [ ] Stroke-to-text (handwriting recognition) for search
- [ ] Shape tool: straighten lines and snap circles/boxes
- [ ] Optional ruled/grid paper background per drawing
- [ ] Split the 1.2 MB JS bundle (lazy-load the editor) for faster first load

## 🎨 Visual / polish
- [ ] Give the app its own visual identity (colors, icon, typography)
- [ ] Toolbar: show the current pen color/size when Type is selected
- [ ] Better empty state for a new page

## 🚀 Launch (sharing with friends → product)
- [ ] Pick a final product name + trademark check
- [ ] Accounts / login; scope data per user
- [ ] Move storage from JSON files to a database (SQLite/Postgres)
- [ ] Host online (Fly.io / Railway / VPS) with HTTPS + backups
- [ ] Resolve the `@blocknote/xl-multi-column` GPL license (buy, open-source, or replace columns)
- [ ] Terms of Service + Privacy Policy

## 💭 Maybe someday
- [ ] Share a page with a friend (read-only link, then real-time collaboration)
- [ ] Native iPad app (wrap the web app, e.g. Capacitor) for App Store distribution
- [ ] Flashcards generated from notes for exam revision
